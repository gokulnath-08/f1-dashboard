const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { telemetryDir, lapTimeDir, fastestJsonPath } = require('../config');
const gameState = require('../state/gameState');
const { generateSessionExportJson, getAvailableTelemetryTracks, getTrackDriverFastestLaps, extractBrakingZones, compareLapsBraking, buildAllLapsComparisonMatrix, generateDemoSessionLaps, getSessionAllLaps } = require('../services/storageService');
const { trackMapsDir } = require('../config');
const { trackMap } = require('../config/constants');
const { getAllHtmlFiles, renderHtmlDirectoryPage, resolveRequestedFile, MIME_TYPES } = require('../services/staticHandler');
const { syncTrackLinesForTrack, isTrackFinalized } = require('../services/trackService');
const { broadcast } = require('../websocket/wsServer');
const { getCustomTargetsData, saveCustomTargetsData } = require('../services/targetService');

function formatLapTimeMs(ms) {
    if (!ms || ms <= 0 || ms === Infinity) return "--:--.---";
    const mins = Math.floor(ms / 60000);
    const secs = ((ms % 60000) / 1000).toFixed(3);
    return `${mins}:${secs.padStart(6, '0')}`;
}

function getLiveTelemetryPayload() {
    const { state } = gameState;
    const now = Date.now();
    const isGameActive = (gameState.lastUdpPacketTime > 0) && (now - gameState.lastUdpPacketTime < 2500);
    const sim = gameState.simulatedTelemetry;

    if (!isGameActive && sim) {
        const m = sim.metrics || sim;
        return {
            status: "online",
            source: sim.source || "SIMULATOR",
            connected: true,
            isGameActive: false,
            timestamp: sim.timestamp || now,
            metrics: {
                gear: m.gear !== undefined ? m.gear : 8,
                speed_kph: Math.round(m.speed_kph ?? m.speed ?? 289),
                rpm: Math.round(m.rpm ?? 11654),
                max_rpm: m.max_rpm ?? 12500,
                idle_rpm: m.idle_rpm ?? 4200,
                delta: parseFloat(Number(m.delta ?? -0.234).toFixed(3)),
                ers_percentage: Math.round(m.ers_percentage ?? m.ers ?? 62),
                fuel_percentage: Math.round(m.fuel_percentage ?? m.fuel ?? 54),
                lap_current: m.lap_current ?? m.lap ?? 3,
                lap_total: m.lap_total ?? m.totalLaps ?? 20,
                best_lap_time: m.best_lap_time || m.bestLap || "1:16.927",
                last_lap_time: m.last_lap_time || "--:--.---",
                throttle: Math.round(m.throttle ?? 100),
                brake: Math.round(m.brake ?? 0),
                drs_active: !!(m.drs_active),
                drs_available: !!(m.drs_available),
                engine_temp: Math.round(m.engine_temp ?? 102),
                tire_surface_temp: m.tire_surface_temp || { fl: 100, fr: 101, rl: 98, rr: 99 },
                tire_inner_temp: m.tire_inner_temp || { fl: 95, fr: 96, rl: 93, rr: 94 },
                brakes_temp: m.brakes_temp || { fl: 450, fr: 460, rl: 410, rr: 415 }
            }
        };
    }

    const bestLapStr = state.lap.bestMs > 0 ? formatLapTimeMs(state.lap.bestMs) : "1:16.927";
    const lastLapStr = state.lap.lastMs > 0 ? formatLapTimeMs(state.lap.lastMs) : "--:--.---";
    const liveDelta = state.lap.liveDeltaToRecord !== undefined && state.lap.liveDeltaToRecord !== 0 
        ? parseFloat((state.lap.liveDeltaToRecord / 1000).toFixed(3)) 
        : -0.234;

    return {
        status: isGameActive ? "online" : "idle",
        source: isGameActive ? "F1_UDP" : "STANDBY",
        connected: isGameActive,
        isGameActive: isGameActive,
        timestamp: now,
        metrics: {
            gear: state.inputs.gear || "N",
            speed_kph: Math.round(state.inputs.speed || 0),
            rpm: Math.round(state.inputs.rpm || 0),
            max_rpm: 12500,
            idle_rpm: 4200,
            delta: liveDelta,
            ers_percentage: Math.round(state.ers.battery !== undefined ? state.ers.battery : 100),
            fuel_percentage: Math.round(state.fuel.pct !== undefined ? state.fuel.pct : 100),
            lap_current: state.lap.lapNum || 1,
            lap_total: state.session.lapsTotal || 20,
            best_lap_time: bestLapStr,
            last_lap_time: lastLapStr,
            throttle: Math.round(state.inputs.throttle || 0),
            brake: Math.round(state.inputs.brake || 0),
            drs_active: state.inputs.drs === 'OPEN',
            drs_available: !!state.inputs.drsAvailable,
            engine_temp: Math.round(state.car.engineTemp || 102),
            tire_surface_temp: state.car.surfTemp || { fl: 100, fr: 100, rl: 98, rr: 98 },
            tire_inner_temp: state.car.inTemp || { fl: 95, fr: 95, rl: 93, rr: 93 },
            brakes_temp: state.car.brakeTemp || { fl: 450, fr: 450, rl: 410, rr: 410 }
        }
    };
}

function createHttpServer() {
    const server = http.createServer((req, res) => {
        const rawUrl = req.url || "/";
        const reqUrl = rawUrl.split('?')[0];
        const { state, allTimeFastest, lastLapTelemetry, currentLapTelemetry, carDataTracker } = gameState;

        // CORS preflight handling for mobile, external dashboards, SimHub
        if (req.method === "OPTIONS") {
            res.writeHead(204, {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With"
            });
            res.end();
            return;
        }

        // ==========================================
        // 🏎️ TELEMETRY API ENGINE REST ENDPOINTS
        // ==========================================

        // 1. GET /api/telemetry/live - Standardized real-time telemetry metrics
        if (reqUrl === "/api/telemetry/live" || reqUrl === "/api/telemetry" || reqUrl === "/api/telemetry/current" || reqUrl === "/api/telemetry/display") {
            const telemetryPayload = getLiveTelemetryPayload();
            res.writeHead(200, {
                "Content-Type": "application/json; charset=utf-8",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-cache, no-store, must-revalidate"
            });
            res.end(JSON.stringify(telemetryPayload, null, 2));
            return;
        }

        // 2. POST /api/telemetry/update - Ingest telemetry from simulator, SimHub, or mobile
        if (reqUrl === "/api/telemetry/update" || reqUrl === "/api/telemetry/simhub" || reqUrl === "/api/telemetry/push") {
            let body = "";
            req.on("data", chunk => { body += chunk; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body || "{}");
                    const incomingMetrics = data.metrics || data;
                    gameState.simulatedTelemetry = {
                        source: data.source || "SIMULATOR_CLIENT",
                        timestamp: Date.now(),
                        metrics: incomingMetrics
                    };

                    // Broadcast directly to all open WebSocket clients
                    broadcast(JSON.stringify({
                        type: "telemetryPayload",
                        ...gameState.simulatedTelemetry
                    }));

                    res.writeHead(200, {
                        "Content-Type": "application/json; charset=utf-8",
                        "Access-Control-Allow-Origin": "*"
                    });
                    res.end(JSON.stringify({
                        success: true,
                        receivedAt: Date.now(),
                        metrics: incomingMetrics
                    }));
                } catch (err) {
                    res.writeHead(400, {
                        "Content-Type": "application/json; charset=utf-8",
                        "Access-Control-Allow-Origin": "*"
                    });
                    res.end(JSON.stringify({ success: false, error: err.message }));
                }
            });
            return;
        }

        // Export complete session data in JSON format
        if (reqUrl === "/api/session/export" || reqUrl === "/api/session-data" || reqUrl === "/download-session-json") {
            const exportData = generateSessionExportJson();
            const cleanTrack = (state.session.trackName || "track").replace(/[^a-zA-Z0-9_-]/g, "_");
            const cleanSession = (state.session.type || "session").replace(/[^a-zA-Z0-9_-]/g, "_");
            const filename = `f1_session_${cleanTrack}_${cleanSession}_${Date.now()}.json`;

            res.writeHead(200, {
                "Content-Type": "application/json",
                "Content-Disposition": `attachment; filename="${filename}"`,
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify(exportData, null, 2));
            return;
        }

        // API endpoint returning all available telemetry track recordings
        if (reqUrl === "/api/tracks" || reqUrl === "/api/telemetry/tracks" || reqUrl === "/api/telemetry-tracks") {
            const trackList = getAvailableTelemetryTracks();
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify({ count: trackList.length, tracks: trackList }, null, 2));
            return;
        }

        // API endpoint returning all discovered HTML dashboards and pages
        if (reqUrl === "/api/pages" || reqUrl === "/api/html-files" || reqUrl === "/api/dashboards") {
            const pages = getAllHtmlFiles();
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify({ count: pages.length, pages: pages }, null, 2));
            return;
        }

        // Dashboard Hub Page listing all available HTML files
        if (reqUrl === "/pages" || reqUrl === "/hub" || reqUrl === "/dashboards" || reqUrl === "/list") {
            const hubHtml = renderHtmlDirectoryPage("F1 Telemetry Dashboard Hub", 200);
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(hubHtml);
            return;
        }

        // API endpoint returning all lap time records and fastest files
        if (reqUrl === "/api/laptimes" || reqUrl === "/api/laptime/fastest" || reqUrl === "/api/records") {
            let fastestRecords = { ...allTimeFastest };
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify({ count: Object.keys(fastestRecords).length, records: fastestRecords }, null, 2));
            return;
        }

        // API endpoint: Get or set custom targets shared permanently across all links and users
        if (reqUrl === "/api/custom-targets" || reqUrl === "/api/targets") {
            if (req.method === "POST") {
                let body = "";
                req.on("data", chunk => { body += chunk; });
                req.on("end", () => {
                    try {
                        const data = JSON.parse(body || "{}");
                        const saved = saveCustomTargetsData(data.targets, data.permanentTarget);
                        broadcast(JSON.stringify({
                            type: "customTargetsUpdated",
                            targets: saved.targets,
                            permanentTarget: saved.permanentTarget
                        }));
                        res.writeHead(200, {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*"
                        });
                        res.end(JSON.stringify({ success: true, ...saved }));
                    } catch (err) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: err.message }));
                    }
                });
                return;
            } else {
                const ctData = getCustomTargetsData();
                res.writeHead(200, {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*"
                });
                res.end(JSON.stringify(ctData, null, 2));
                return;
            }
        }

        // API endpoint: Get all drivers who recorded fastest laps in the active session or for a selected track
        if (reqUrl.startsWith("/api/session/driver-fastest-laps") || reqUrl.startsWith("/api/session/fastest-laps") || reqUrl.startsWith("/api/driver-laps")) {
            const urlParams = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`).searchParams;
            const trackIdParam = urlParams.get('trackId') || urlParams.get('id');
            const tId = trackIdParam !== null ? parseInt(trackIdParam, 10) : gameState.currentTrackId;

            let rawLaps = [];
            if (tId !== -1 && tId !== undefined && !isNaN(tId)) {
                rawLaps = getTrackDriverFastestLaps(tId);
            } else {
                rawLaps = (gameState.sessionDriverFastestLaps || []).filter(Boolean);
            }

            const laps = (rawLaps || []).map(l => ({
                carIndex: l.carIndex,
                driverName: l.driverName,
                teamName: l.teamName,
                teamColor: l.teamColor,
                lapTimeMs: l.lapTimeMs,
                lapNum: l.lapNum,
                s1: l.s1,
                s2: l.s2,
                s3: l.s3,
                telemetryPoints: (l.telemetry || []).length,
                timestamp: l.timestamp
            }));

            res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify({
                count: laps.length,
                trackId: tId,
                trackName: state.session.trackName || 'Unknown',
                trackLength: state.session.trackLength || 0,
                laps: laps
            }, null, 2));
            return;
        }

        // API endpoint: Get full telemetry for a specific driver
        if (reqUrl.startsWith("/api/session/driver-telemetry") || reqUrl.startsWith("/api/driver-telemetry")) {
            const urlParams = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`).searchParams;
            const carIdxParam = urlParams.get('carIndex') || urlParams.get('car') || urlParams.get('idx');
            const trackIdParam = urlParams.get('trackId') || urlParams.get('id');
            const cIdx = carIdxParam !== null ? parseInt(carIdxParam, 10) : 0;
            const tId = trackIdParam !== null ? parseInt(trackIdParam, 10) : gameState.currentTrackId;

            let lapData = null;
            if (gameState.currentTrackId === tId && gameState.sessionDriverFastestLaps && gameState.sessionDriverFastestLaps[cIdx]) {
                lapData = gameState.sessionDriverFastestLaps[cIdx];
            } else if (tId !== -1 && !isNaN(tId)) {
                const allLaps = getTrackDriverFastestLaps(tId);
                lapData = allLaps.find(l => l.carIndex === cIdx) || (cIdx === 0 ? allLaps[0] : null) || null;
            } else if (!isNaN(cIdx) && gameState.sessionDriverFastestLaps) {
                lapData = gameState.sessionDriverFastestLaps[cIdx];
            }

            res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify({
                success: !!lapData,
                carIndex: cIdx,
                trackId: tId,
                data: lapData || null
            }, null, 2));
            return;
        }

        // API endpoint: Get ghost comparison payload for two drivers
        if (reqUrl.startsWith("/api/session/ghost-comparison") || reqUrl.startsWith("/api/ghost-comparison")) {
            const urlParams = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`).searchParams;
            const idxA = parseInt(urlParams.get('driverA') || urlParams.get('a') || '0', 10);
            const idxB = parseInt(urlParams.get('driverB') || urlParams.get('b') || '1', 10);

            const lapA = (!isNaN(idxA) && gameState.sessionDriverFastestLaps) ? gameState.sessionDriverFastestLaps[idxA] : null;
            const lapB = (!isNaN(idxB) && gameState.sessionDriverFastestLaps) ? gameState.sessionDriverFastestLaps[idxB] : null;

            res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify({
                success: !!(lapA || lapB),
                driverA: lapA || null,
                driverB: lapB || null,
                trackId: gameState.currentTrackId,
                trackName: state.session.trackName || 'Unknown',
                trackLength: state.session.trackLength || 0,
                trackPoints: state.trackPoints || []
            }, null, 2));
            return;
        }

        // API endpoint: Get all laps driven in the session with braking summaries
        if (reqUrl.startsWith("/api/session/all-laps") || reqUrl.startsWith("/api/session/laps") || reqUrl.startsWith("/api/all-laps")) {
            const urlParams = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`).searchParams;
            const trackIdParam = urlParams.get('trackId') || urlParams.get('id');
            const carIdxParam = urlParams.get('carIndex') || urlParams.get('car');
            const tId = trackIdParam !== null ? parseInt(trackIdParam, 10) : gameState.currentTrackId;
            const cIdx = carIdxParam !== null ? parseInt(carIdxParam, 10) : null;

            const laps = getSessionAllLaps(tId, cIdx, false);

            res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify({
                success: true,
                count: laps.length,
                trackId: tId,
                trackName: (state.session.trackName && state.session.trackName !== 'Unknown') ? state.session.trackName : (trackMap[tId] || 'Circuit'),
                trackLength: state.session.trackLength || 0,
                laps: laps.map(l => ({
                    id: l.id || `lap_${l.carIndex}_${l.lapNum}`,
                    lapNum: l.lapNum,
                    carIndex: l.carIndex,
                    driverName: l.driverName,
                    teamName: l.teamName,
                    teamColor: l.teamColor,
                    lapTimeMs: l.lapTimeMs,
                    s1: l.s1,
                    s2: l.s2,
                    s3: l.s3,
                    isValid: l.isValid !== false,
                    isPersonalBest: !!l.isPersonalBest,
                    totalBrakingDist: l.totalBrakingDist || (l.brakingZones || []).reduce((s, z) => s + z.brakingDist, 0),
                    avgDecelG: l.avgDecelG || 0,
                    brakingZonesCount: (l.brakingZones || []).length,
                    telemetryPoints: (l.telemetry || []).length,
                    timestamp: l.timestamp || 0
                }))
            }, null, 2));
            return;
        }

        // API endpoint: Complete braking comparison analysis (single lap, H2H, and all-laps matrix)
        if (reqUrl.startsWith("/api/session/lap-braking") || reqUrl.startsWith("/api/braking-analysis") || reqUrl.startsWith("/api/braking-compare")) {
            const urlParams = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`).searchParams;
            const trackIdParam = urlParams.get('trackId') || urlParams.get('id');
            const carIdxParam = urlParams.get('carIndex') || urlParams.get('car');
            const baselineLapParam = urlParams.get('baseline') || urlParams.get('lap') || urlParams.get('lapA');
            const compareLapParam = urlParams.get('compare') || urlParams.get('lapB');

            const tId = trackIdParam !== null ? parseInt(trackIdParam, 10) : gameState.currentTrackId;
            const cIdx = carIdxParam !== null ? parseInt(carIdxParam, 10) : (state.playerIndex || 0);

            const allLaps = getSessionAllLaps(tId, cIdx, false);

            // Determine baseline lap (prefer complete laps with >= 3 braking zones, sorted by fastest lapTime)
            let baselineLap = null;
            if (baselineLapParam !== null) {
                const bNum = parseInt(baselineLapParam, 10);
                baselineLap = allLaps.find(l => l.lapNum === bNum) || null;
            }
            if (!baselineLap && allLaps.length > 0) {
                const fullLaps = allLaps.filter(l => l.lapTimeMs > 0 && (l.brakingZones || []).length >= 3);
                if (fullLaps.length > 0) {
                    baselineLap = [...fullLaps].sort((a, b) => a.lapTimeMs - b.lapTimeMs)[0];
                } else {
                    const validLaps = allLaps.filter(l => l.lapTimeMs > 0);
                    if (validLaps.length > 0) {
                        baselineLap = [...validLaps].sort((a, b) => a.lapTimeMs - b.lapTimeMs)[0];
                    } else {
                        baselineLap = allLaps[0];
                    }
                }
            }

            // Determine comparison lap (prefer fastest other lap with braking zones)
            let compareLap = null;
            if (compareLapParam !== null) {
                const cNum = parseInt(compareLapParam, 10);
                compareLap = allLaps.find(l => l.lapNum === cNum) || null;
            } else if (allLaps.length > 1 && baselineLap) {
                const otherFullLaps = allLaps.filter(l => l.lapNum !== baselineLap.lapNum && l.lapTimeMs > 0 && (l.brakingZones || []).length >= 3);
                if (otherFullLaps.length > 0) {
                    compareLap = [...otherFullLaps].sort((a, b) => a.lapTimeMs - b.lapTimeMs)[0];
                } else {
                    const otherLaps = allLaps.filter(l => l.lapNum !== baselineLap.lapNum && l.lapTimeMs > 0);
                    compareLap = otherLaps.length > 0 ? [...otherLaps].sort((a, b) => a.lapTimeMs - b.lapTimeMs)[0] : allLaps.find(l => l.lapNum !== baselineLap.lapNum) || null;
                }
            }

            // Get circuit trackPoints and map features for rendering
            let circuitPoints = [];
            let trackMeta = {};
            let tLength = state.session.trackLength || 0;
            if (gameState.currentTrackId === tId && Array.isArray(state.trackPoints) && state.trackPoints.length > 50) {
                circuitPoints = state.trackPoints;
            }
            
            if (circuitPoints.length === 0 && tId !== -1 && trackMapsDir) {
                try {
                    const mapPath = path.join(trackMapsDir, `track_${tId}.json`);
                    if (fs.existsSync(mapPath)) {
                        const mData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
                        circuitPoints = mData.trackPoints || [];
                        if (mData.trackLength) tLength = mData.trackLength;
                        trackMeta = {
                            drsZones: mData.drsZones || [],
                            startLine: mData.startLine || null,
                            sector1: mData.sector1 || null,
                            sector2: mData.sector2 || null
                        };
                    }
                } catch (e) { }
            }

            if (circuitPoints.length === 0 && baselineLap && Array.isArray(baselineLap.telemetry)) {
                circuitPoints = baselineLap.telemetry
                    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.z))
                    .map(p => ({ x: p.x, z: p.z }));
            }

            const h2h = baselineLap ? compareLapsBraking(baselineLap, compareLap) : null;
            const matrix = baselineLap ? buildAllLapsComparisonMatrix(baselineLap, allLaps) : null;

            res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify({
                success: !!baselineLap,
                emptySession: allLaps.length === 0,
                isLiveSession: true,
                trackId: tId,
                trackName: (state.session.trackName && state.session.trackName !== 'Unknown') ? state.session.trackName : (trackMap[tId] || 'Circuit'),
                trackLength: tLength || (baselineLap?.telemetry?.[baselineLap.telemetry.length - 1]?.d || 5000),
                trackPoints: circuitPoints,
                trackMeta: trackMeta,
                baselineLap: baselineLap,
                compareLap: compareLap,
                h2hComparison: h2h,
                comparisonMatrix: matrix,
                allLapsSummary: allLaps.map(l => ({
                    lapNum: l.lapNum,
                    driverName: l.driverName,
                    teamColor: l.teamColor || '#FFFFFF',
                    lapTimeMs: l.lapTimeMs,
                    totalBrakingDist: l.totalBrakingDist || (l.brakingZones || []).reduce((s, z) => s + z.brakingDist, 0),
                    avgDecelG: l.avgDecelG || 0,
                    brakingZonesCount: (l.brakingZones || []).length,
                    isValid: l.isValid !== false,
                    isPersonalBest: !!l.isPersonalBest
                }))
            }, null, 2));
            return;
        }

        // API endpoint: Get demo multi-lap braking dataset
        if (reqUrl.startsWith("/api/session/demo-braking-laps") || reqUrl.startsWith("/api/demo-braking")) {
            const urlParams = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`).searchParams;
            const trackIdParam = urlParams.get('trackId') || urlParams.get('id');
            const tId = trackIdParam !== null ? parseInt(trackIdParam, 10) : (gameState.currentTrackId !== -1 ? gameState.currentTrackId : 0);

            const demoLaps = generateDemoSessionLaps(tId);

            res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify({
                success: demoLaps.length > 0,
                trackId: tId,
                count: demoLaps.length,
                laps: demoLaps
            }, null, 2));
            return;
        }

        // API endpoint: Start session telemetry recording
        if (reqUrl === "/api/recording/start" || reqUrl === "/api/session/recording/start") {
            const urlParams = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`).searchParams;
            const resetOld = urlParams.get('reset') !== 'false';
            const trackIdParam = urlParams.get('trackId');
            if (trackIdParam !== null) {
                const tId = parseInt(trackIdParam, 10);
                if (!isNaN(tId) && tId !== -1) gameState.currentTrackId = tId;
            }

            gameState.isRecordingSessionTelemetry = true;
            gameState.sessionRecordingStartTime = Date.now();

            if (resetOld) {
                gameState.sessionDriverFastestLaps = Array.from({ length: 22 }, () => null);
                gameState.currentLapTelemetry = Array.from({ length: 22 }, () => []);
                gameState.lastLapTelemetry = Array.from({ length: 22 }, () => []);
            }

            broadcast(JSON.stringify({
                type: 'sessionRecordingState',
                isRecording: true,
                startTime: gameState.sessionRecordingStartTime,
                trackId: gameState.currentTrackId
            }));

            console.log(`🔴 [HTTP API] Session recording started for Track ${gameState.currentTrackId}`);

            res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify({
                success: true,
                isRecording: true,
                startTime: gameState.sessionRecordingStartTime,
                trackId: gameState.currentTrackId,
                message: "Session telemetry recording started. All driver laps will be saved."
            }, null, 2));
            return;
        }

        // API endpoint: Stop session telemetry recording
        if (reqUrl === "/api/recording/stop" || reqUrl === "/api/session/recording/stop") {
            gameState.isRecordingSessionTelemetry = false;

            broadcast(JSON.stringify({
                type: 'sessionRecordingState',
                isRecording: false,
                startTime: 0,
                trackId: gameState.currentTrackId
            }));

            console.log(`⏹️ [HTTP API] Session recording stopped`);

            res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify({
                success: true,
                isRecording: false,
                trackId: gameState.currentTrackId,
                message: "Session telemetry recording stopped."
            }, null, 2));
            return;
        }

        // API endpoint: Get session recording status
        if (reqUrl === "/api/recording/status" || reqUrl === "/api/session/recording/status") {
            const recordedCount = (gameState.sessionDriverFastestLaps || []).filter(Boolean).length;
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify({
                isRecording: gameState.isRecordingSessionTelemetry,
                startTime: gameState.sessionRecordingStartTime,
                trackId: gameState.currentTrackId,
                recordedDriversCount: recordedCount
            }, null, 2));
            return;
        }

        // API endpoint to trigger sector line sync from telemetry for a track
        if (reqUrl.startsWith("/api/sync-track-lines") || reqUrl.startsWith("/api/sync-sectors")) {
            const urlParams = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`).searchParams;
            const trackIdParam = urlParams.get('trackId') || urlParams.get('id');
            const tId = trackIdParam ? parseInt(trackIdParam, 10) : gameState.currentTrackId;

            if (isTrackFinalized(tId)) {
                res.writeHead(200, {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*"
                });
                res.end(JSON.stringify({
                    success: false,
                    locked: true,
                    trackId: tId,
                    message: `🔒 Track ${tId} is locked/finalized. No more sync is allowed.`
                }, null, 2));
                return;
            }

            const result = syncTrackLinesForTrack(tId, false, broadcast);
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify({
                success: !!result,
                trackId: tId,
                data: result || null,
                message: result ? `Track lines synced successfully for Track ${tId}` : `No telemetry found for Track ${tId}`
            }, null, 2));
            return;
        }

        // API endpoint to safely and properly store telemetry for the current/selected track
        if (reqUrl.startsWith("/api/save-telemetry")) {
            const urlParams = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`).searchParams;
            const trackIdParam = urlParams.get('trackId') || urlParams.get('id');
            const tId = trackIdParam ? parseInt(trackIdParam, 10) : gameState.currentTrackId;

            if (tId === -1) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: false, message: "No active track selected" }));
                return;
            }

            const pIdx = state.playerIndex || 0;
            let sourceTelemetry = (lastLapTelemetry[pIdx] && lastLapTelemetry[pIdx].length >= 50)
                ? lastLapTelemetry[pIdx]
                : (currentLapTelemetry[pIdx] || []);

            let cleanTelemetry = sourceTelemetry
                .filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.z) && (pt.x !== 0 || pt.z !== 0));

            if (cleanTelemetry.length < 50) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: false, message: `Insufficient telemetry points to save (${cleanTelemetry.length} pts found, min 50 required)` }));
                return;
            }

            cleanTelemetry.sort((a, b) => (a.d !== undefined && b.d !== undefined) ? a.d - b.d : a.t - b.t);

            // Ensure clean starting point
            if (cleanTelemetry[0].d > 0) {
                cleanTelemetry.unshift({
                    ...cleanTelemetry[0],
                    d: 0,
                    t: 0
                });
            }

            const trackLen = state.session.trackLength > 0 ? state.session.trackLength : (cleanTelemetry[cleanTelemetry.length - 1].d || 5000);
            const lastMs = state.lap.lastMs > 0 ? state.lap.lastMs : (cleanTelemetry[cleanTelemetry.length - 1].t || 75000);
            const driverName = (state.participants && state.participants[pIdx]) || "Player";

            const s1Time = carDataTracker[pIdx].bestS1 || carDataTracker[pIdx].s1 || state.session.referenceS1 || 0;
            const s2Time = carDataTracker[pIdx].bestS2 || carDataTracker[pIdx].s2 || state.session.referenceS2 || 0;
            const s3Time = (lastMs > 0 && s1Time > 0 && s2Time > 0) ? Math.max(0, lastMs - (s1Time + s2Time)) : 0;

            // Save telemetry files
            const telPath = path.join(telemetryDir, `telemetry_${tId}.json`);
            const ghostPath = path.join(lapTimeDir, `fastest_${tId}.json`);

            fs.writeFileSync(telPath, JSON.stringify(cleanTelemetry, null, 2), 'utf8');
            fs.writeFileSync(ghostPath, JSON.stringify(cleanTelemetry.map(p => ({ d: p.d, t: p.t }))), 'utf8');

            allTimeFastest[tId] = {
                time: lastMs,
                driver: driverName,
                s1: s1Time,
                s2: s2Time,
                s3: s3Time,
                hasTelemetry: true
            };
            fs.writeFileSync(fastestJsonPath, JSON.stringify(allTimeFastest, null, 2), 'utf8');

            // Sync track sector lines using the official sector times only if not finalized
            if (!isTrackFinalized(tId)) {
                syncTrackLinesForTrack(tId, false, broadcast);
            }

            console.log(`💾 Properly stored telemetry for Track ${tId} (${cleanTelemetry.length} pts, Driver: ${driverName}, Lap: ${lastMs}ms)`);

            res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
            res.end(JSON.stringify({
                success: true,
                trackId: tId,
                points: cleanTelemetry.length,
                lapTimeMs: lastMs,
                driver: driverName,
                syncedLines: syncedLines || null,
                message: `Telemetry and sector lines saved successfully for Track ${tId}`
            }, null, 2));
            return;
        }

        // Resolve any requested path to a matching file in root or subdirectories
        const targetFilePath = resolveRequestedFile(rawUrl);

        if (!targetFilePath) {
            // If an HTML client navigated to a non-existent page, show the hub directory
            const accept = req.headers['accept'] || '';
            if (accept.includes('text/html') || !path.extname(reqUrl)) {
                const notFoundHtml = renderHtmlDirectoryPage("404 - Page Not Found", 404);
                res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
                res.end(notFoundHtml);
                return;
            }

            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("File not found");
            return;
        }

        const ext = path.extname(targetFilePath).toLowerCase();

        fs.readFile(targetFilePath, (err, data) => {
            if (err) {
                res.writeHead(404, { "Content-Type": "text/plain" });
                res.end("File not found");
                return;
            }

            let responseData = data;
            // User customization check for index.html
            if (targetFilePath.endsWith("index.html")) {
                try {
                    if (os.userInfo().username === "gokul") {
                        let htmlContent = data.toString("utf8");
                        htmlContent = htmlContent.replace('<footer', '<footer hidden ');
                        responseData = Buffer.from(htmlContent, "utf8");
                    }
                } catch (e) { }
            }

            res.writeHead(200, {
                "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
                "Access-Control-Allow-Origin": "*"
            });

            res.end(responseData);
        });
    });

    server.on('error', (err) => {
        console.error('🛡️ [HTTP Server Error]:', err?.message || err);
    });

    return server;
}

module.exports = {
    createHttpServer
};
