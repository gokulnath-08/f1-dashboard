const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { trackMapsDir, setupsDir, LEGACY_WS_PORT } = require('../config');
const { OFFICIAL_TRACK_SECTOR_DISTANCES } = require('../config/catalogs');
const gameState = require('../state/gameState');
const { safeSaveTrackMap } = require('../utils/fileSystem');
const { getTelemetryDrsZonesForTrack, getTelemetryStraightModeZonesForTrack, isTrackFinalized, syncTrackLinesForTrack } = require('../services/trackService');
const { generateSessionExportJson, getTrackDriverFastestLaps, compareLapsBraking, buildAllLapsComparisonMatrix, getSessionAllLaps } = require('../services/storageService');
const { resetSessionData } = require('../state/stateHelpers');
const { getCustomTargetsData, saveCustomTargetsData } = require('../services/targetService');

let clients = [];
let wss = null;
let legacyWss = null;

function broadcast(msg) {
    clients = clients.filter(c => c.readyState === WebSocket.OPEN);
    clients.forEach(c => {
        try {
            c.send(msg);
        } catch (e) { }
    });
}

function handleWsConnection(ws) {
    const { state, currentTrackId, fastestLapGhostData } = gameState;
    console.log('✅ Advanced Strategy Command Center Connected!');
    clients.push(ws);

    // Send persistent custom target pace immediately to newly connected client
    try {
        const ctData = getCustomTargetsData();
        ws.send(JSON.stringify({
            type: 'customTargetsData',
            targets: ctData.targets || {},
            permanentTarget: ctData.permanentTarget || null
        }));
    } catch (e) { }

    // Send full 3D track map immediately on connection so the dashboard renders right away
    if (state.trackPoints && state.trackPoints.length >= 20) {
        try {
            const trkLen = state.session.trackLength || OFFICIAL_TRACK_SECTOR_DISTANCES[gameState.currentTrackId]?.len || 0;
            let drsToSend = (Array.isArray(state.drsZones) && state.drsZones.length > 0) ? state.drsZones : null;
            let straightToSend = (Array.isArray(state.straightModeZones) && state.straightModeZones.length > 0) ? state.straightModeZones : null;
            let isFinalized = isTrackFinalized(gameState.currentTrackId);

            if ((!drsToSend || !straightToSend) && gameState.currentTrackId !== -1) {
                const mapPath = path.join(trackMapsDir, `track_${gameState.currentTrackId}.json`);
                if (fs.existsSync(mapPath)) {
                    try {
                        const fData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
                        if (!drsToSend && Array.isArray(fData.drsZones) && fData.drsZones.length > 0) {
                            drsToSend = fData.drsZones;
                            state.drsZones = drsToSend;
                        }
                        if (!straightToSend && Array.isArray(fData.straightModeZones) && fData.straightModeZones.length > 0) {
                            straightToSend = fData.straightModeZones;
                            state.straightModeZones = straightToSend;
                        }
                        if (fData.finalized !== undefined) isFinalized = !!fData.finalized;
                    } catch (e) { }
                }
            }

            if (!drsToSend) {
                drsToSend = getTelemetryDrsZonesForTrack(gameState.currentTrackId, trkLen, null, null);
            }
            if (!straightToSend) {
                straightToSend = (gameYear === 26) ? getTelemetryStraightModeZonesForTrack(gameState.currentTrackId, trkLen, null, null) : [];
            }

            const gameYear = state.gameYear || (drsToSend.length > 0 && straightToSend.length === 0 ? 25 : (gameState.currentGameYear || 26));
            ws.send(JSON.stringify({
                type: 'trackDataResponse',
                trackId: gameState.currentTrackId,
                data: {
                    trackPoints: state.trackPoints,
                    pitLanePoints: state.pitLanePoints || [],
                    startLine: state.startLine,
                    sector1: state.sector1,
                    sector2: state.sector2,
                    drsZones: drsToSend,
                    straightModeZones: straightToSend,
                    gameYear: gameYear,
                    finalized: isFinalized
                }
            }));
        } catch (e) { }
    } else {
        // Cold start or no active session: send empty track map
        try {
            ws.send(JSON.stringify({
                type: 'trackDataResponse',
                trackId: gameState.currentTrackId,
                data: {
                    trackPoints: [],
                    pitLanePoints: [],
                    startLine: null,
                    sector1: null,
                    sector2: null,
                    drsZones: [],
                    straightModeZones: [],
                    gameYear: gameState.currentGameYear || 26,
                    finalized: isTrackFinalized(gameState.currentTrackId)
                }
            }));
        } catch (e) { }
    }
    gameState.trackPointsDirty = true;
    gameState.lapHistoryDirty = true;

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);

            // Telemetry API Engine WebSocket handlers
            if (data.action === 'telemetry_update' || data.type === 'telemetry_update' || data.action === 'broadcast_telemetry') {
                const incomingMetrics = data.metrics || data.data || data;
                gameState.simulatedTelemetry = {
                    source: data.source || "SIMULATOR_WS",
                    timestamp: Date.now(),
                    metrics: incomingMetrics
                };
                broadcast(JSON.stringify({
                    type: 'telemetryPayload',
                    ...gameState.simulatedTelemetry
                }));
                return;
            }

            if (data.action === 'get_telemetry' || data.action === 'getLiveTelemetry') {
                const { state } = gameState;
                const now = Date.now();
                const isGameActive = (gameState.lastUdpPacketTime > 0) && (now - gameState.lastUdpPacketTime < 2500);
                const sim = gameState.simulatedTelemetry;
                let payload;
                if (!isGameActive && sim) {
                    payload = {
                        type: 'telemetryPayload',
                        status: 'online',
                        source: sim.source || 'SIMULATOR',
                        timestamp: sim.timestamp || now,
                        metrics: sim.metrics || sim
                    };
                } else {
                    payload = {
                        type: 'telemetryPayload',
                        status: isGameActive ? 'online' : 'idle',
                        source: isGameActive ? 'F1_UDP' : 'STANDBY',
                        timestamp: now,
                        metrics: {
                            gear: state.inputs.gear || 'N',
                            speed_kph: Math.round(state.inputs.speed || 0),
                            rpm: Math.round(state.inputs.rpm || 0),
                            max_rpm: 12500,
                            idle_rpm: 4200,
                            delta: state.lap.liveDeltaToRecord !== undefined ? parseFloat((state.lap.liveDeltaToRecord / 1000).toFixed(3)) : -0.234,
                            ers_percentage: Math.round(state.ers.battery || 0),
                            fuel_percentage: Math.round(state.fuel.pct || 0),
                            lap_current: state.lap.lapNum || 1,
                            lap_total: state.session.lapsTotal || 20,
                            best_lap_time: "1:16.927",
                            throttle: Math.round(state.inputs.throttle || 0),
                            brake: Math.round(state.inputs.brake || 0),
                            engine_temp: Math.round(state.car.engineTemp || 102)
                        }
                    };
                }
                ws.send(JSON.stringify(payload));
                return;
            }

            if (data.action === 'getCustomTargets') {
                const ctData = getCustomTargetsData();
                ws.send(JSON.stringify({
                    type: 'customTargetsData',
                    targets: ctData.targets || {},
                    permanentTarget: ctData.permanentTarget || null
                }));
                return;
            }

            if (data.action === 'saveCustomTargets') {
                const saved = saveCustomTargetsData(data.targets, data.permanentTarget);
                broadcast(JSON.stringify({
                    type: 'customTargetsUpdated',
                    targets: saved.targets,
                    permanentTarget: saved.permanentTarget
                }));
                return;
            }

            if (data.action === 'getAvailableTracks') {
                fs.readdir(trackMapsDir, (err, files) => {
                    if (!err) {
                        const tracks = files.filter(f => f.startsWith('track_') && f.endsWith('.json'))
                            .map(f => parseInt(f.match(/\d+/)[0]))
                            .filter(id => !isNaN(id));
                        ws.send(JSON.stringify({ type: 'availableTracks', tracks }));
                    }
                });
                return;
            }

            if (data.action === 'toggleFinalizeTrack') {
                let trackId = data.trackId !== undefined && data.trackId !== null ? parseInt(data.trackId, 10) : gameState.currentTrackId;
                if (!isNaN(trackId) && trackId !== -1) {
                    const isCurrentlyFinalized = isTrackFinalized(trackId);
                    const newFinalizedState = !isCurrentlyFinalized;
                    gameState.finalizedTracks[trackId] = newFinalizedState;

                    const mapPath = path.join(trackMapsDir, `track_${trackId}.json`);
                    if (fs.existsSync(mapPath)) {
                        try {
                            const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
                            mapData.finalized = newFinalizedState;
                            safeSaveTrackMap(mapPath, mapData);
                        } catch (e) { }
                    }

                    console.log(`🔒 Track ${trackId} finalized state toggled to: ${newFinalizedState}`);

                    const statusMsg = JSON.stringify({
                        type: 'trackFinalizedState',
                        trackId: trackId,
                        finalized: newFinalizedState
                    });
                    const toastMsg = JSON.stringify({
                        type: 'toast',
                        message: newFinalizedState ? `Track ${trackId} Map Locked & Finalized! Auto-sync disabled.` : `Track ${trackId} Map Unlocked! Auto-sync re-enabled.`
                    });

                    broadcast(statusMsg);
                    broadcast(toastMsg);
                }
                return;
            }

            if (data.action === 'getTrackFinalizedState') {
                let trackId = data.trackId !== undefined && data.trackId !== null ? parseInt(data.trackId, 10) : gameState.currentTrackId;
                if (!isNaN(trackId) && trackId !== -1) {
                    ws.send(JSON.stringify({
                        type: 'trackFinalizedState',
                        trackId: trackId,
                        finalized: isTrackFinalized(trackId)
                    }));
                }
                return;
            }

            if (data.action === 'getTrackData') {
                let trackId = data.trackId !== undefined ? parseInt(data.trackId, 10) : gameState.currentTrackId;
                if (isNaN(trackId) || trackId === -1) {
                    trackId = gameState.currentTrackId;
                }

                if (!isNaN(trackId) && trackId !== -1) {
                    const tPath = path.join(trackMapsDir, `track_${trackId}.json`);
                    if (fs.existsSync(tPath)) {
                        try {
                            const raw = fs.readFileSync(tPath, 'utf8').trim();
                            if (raw && raw.length > 2) {
                                const tData = JSON.parse(raw);
                                const pts = Array.isArray(tData) ? tData : (tData.trackPoints || []);
                                if (pts.length >= 20) {
                                    if (tData && typeof tData === 'object' && !Array.isArray(tData)) {
                                        tData.finalized = isTrackFinalized(trackId);
                                        const trkLen = tData.trackLength || OFFICIAL_TRACK_SECTOR_DISTANCES[trackId]?.len || gameState.state.session.trackLength || 0;
                                        const hasSavedDrs = Array.isArray(tData.drsZones) && tData.drsZones.length > 0;
                                        const hasSavedStraight = Array.isArray(tData.straightModeZones) && tData.straightModeZones.length > 0;

                                        if (!hasSavedDrs && !hasSavedStraight) {
                                            tData.drsZones = getTelemetryDrsZonesForTrack(trackId, trkLen, null, tData.drsZones);
                                        }

                                        if (tData.gameYear) {
                                            // Keep saved gameYear
                                        } else if (hasSavedDrs && !hasSavedStraight) {
                                            tData.gameYear = 25;
                                        } else if (hasSavedStraight && !hasSavedDrs) {
                                            tData.gameYear = 26;
                                        } else {
                                            tData.gameYear = (gameState.currentGameYear === 25 || gameState.currentGameYear === 26) ? gameState.currentGameYear : 25;
                                        }

                                        if (!tData.straightModeZones) {
                                            tData.straightModeZones = (tData.gameYear === 26) ? getTelemetryStraightModeZonesForTrack(trackId, trkLen, null, null) : [];
                                        }
                                    }
                                    ws.send(JSON.stringify({ type: 'trackDataResponse', trackId, data: tData }));
                                    return;
                                }
                            }
                        } catch (e) { }
                    }

                    // If requesting the current active game track and live points exist for it
                    if (trackId === gameState.currentTrackId && gameState.state.trackPoints && gameState.state.trackPoints.length >= 20) {
                        const trkLen = gameState.state.session.trackLength || OFFICIAL_TRACK_SECTOR_DISTANCES[gameState.currentTrackId]?.len || 0;
                        let drsToSend = (Array.isArray(gameState.state.drsZones) && gameState.state.drsZones.length > 0) ? gameState.state.drsZones : null;
                        let straightToSend = (Array.isArray(gameState.state.straightModeZones) && gameState.state.straightModeZones.length > 0) ? gameState.state.straightModeZones : null;
                        let isFin = isTrackFinalized(gameState.currentTrackId);

                        if ((!drsToSend || !straightToSend) && gameState.currentTrackId !== -1) {
                            const mapPath = path.join(trackMapsDir, `track_${gameState.currentTrackId}.json`);
                            if (fs.existsSync(mapPath)) {
                                try {
                                    const fData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
                                    if (!drsToSend && Array.isArray(fData.drsZones) && fData.drsZones.length > 0) {
                                        drsToSend = fData.drsZones;
                                        gameState.state.drsZones = drsToSend;
                                    }
                                    if (!straightToSend && Array.isArray(fData.straightModeZones) && fData.straightModeZones.length > 0) {
                                        straightToSend = fData.straightModeZones;
                                        gameState.state.straightModeZones = straightToSend;
                                    }
                                    if (fData.finalized !== undefined) isFin = !!fData.finalized;
                                } catch (e) { }
                            }
                        }

                        if (!drsToSend) {
                            drsToSend = getTelemetryDrsZonesForTrack(gameState.currentTrackId, trkLen, null, null);
                        }
                        if (!straightToSend) {
                            straightToSend = (gameState.state.gameYear === 26) ? getTelemetryStraightModeZonesForTrack(gameState.currentTrackId, trkLen, null, null) : [];
                        }

                        const liveGameYear = gameState.state.gameYear || (drsToSend.length > 0 && straightToSend.length === 0 ? 25 : (gameState.currentGameYear || 26));

                        ws.send(JSON.stringify({
                            type: 'trackDataResponse',
                            trackId: gameState.currentTrackId,
                            data: {
                                trackPoints: gameState.state.trackPoints,
                                pitLanePoints: gameState.state.pitLanePoints || [],
                                startLine: gameState.state.startLine,
                                sector1: gameState.state.sector1,
                                sector2: gameState.state.sector2,
                                drsZones: drsToSend,
                                straightModeZones: straightToSend,
                                gameYear: liveGameYear,
                                finalized: isFin
                            }
                        }));
                        return;
                    }

                    // Track file does not exist: return empty track for this specific trackId
                    ws.send(JSON.stringify({
                        type: 'trackDataResponse',
                        trackId: trackId,
                        data: { trackPoints: [], pitLanePoints: [], startLine: null, sector1: null, sector2: null, drsZones: [], straightModeZones: [], gameYear: gameState.currentGameYear || 26, finalized: false }
                    }));
                    return;
                }

                // No track requested and no track active
                ws.send(JSON.stringify({
                    type: 'trackDataResponse',
                    trackId: -1,
                    data: { trackPoints: [], pitLanePoints: [], startLine: null, sector1: null, sector2: null, drsZones: [], straightModeZones: [], gameYear: gameState.currentGameYear || 26, finalized: false }
                }));
                return;
            }

            if (data.action === 'exportSession' || data.action === 'getSessionExport' || data.action === 'downloadSession') {
                ws.send(JSON.stringify({ type: 'sessionExportResponse', data: generateSessionExportJson() }));
                return;
            }

            if (data.action === 'getSessionDriverFastestLaps') {
                const tId = data.trackId !== undefined ? parseInt(data.trackId, 10) : gameState.currentTrackId;
                let rawLaps = [];
                if (!isNaN(tId) && tId !== -1) {
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
                ws.send(JSON.stringify({ type: 'sessionDriverFastestLapsResponse', trackId: tId, data: laps }));
                return;
            }

            if (data.action === 'getDriverLapTelemetry') {
                const cIdx = parseInt(data.carIndex, 10);
                const tId = data.trackId !== undefined ? parseInt(data.trackId, 10) : gameState.currentTrackId;
                let lapData = null;

                if (gameState.currentTrackId === tId && gameState.sessionDriverFastestLaps && gameState.sessionDriverFastestLaps[cIdx]) {
                    lapData = gameState.sessionDriverFastestLaps[cIdx];
                } else if (!isNaN(tId) && tId !== -1) {
                    const allLaps = getTrackDriverFastestLaps(tId);
                    lapData = allLaps.find(l => l.carIndex === cIdx) || (cIdx === 0 ? allLaps[0] : null) || null;
                } else if (!isNaN(cIdx) && gameState.sessionDriverFastestLaps) {
                    lapData = gameState.sessionDriverFastestLaps[cIdx];
                }

                ws.send(JSON.stringify({
                    type: 'driverLapTelemetryResponse',
                    carIndex: cIdx,
                    trackId: tId,
                    data: lapData || null
                }));
                return;
            }

            if (data.action === 'getGhostComparisonData') {
                const idxA = parseInt(data.driverA, 10);
                const idxB = parseInt(data.driverB, 10);
                const tId = data.trackId !== undefined ? parseInt(data.trackId, 10) : gameState.currentTrackId;

                let lapA = null;
                let lapB = null;

                if (gameState.currentTrackId === tId && gameState.sessionDriverFastestLaps) {
                    lapA = gameState.sessionDriverFastestLaps[idxA] || null;
                    lapB = gameState.sessionDriverFastestLaps[idxB] || null;
                } else if (!isNaN(tId) && tId !== -1) {
                    const allLaps = getTrackDriverFastestLaps(tId);
                    lapA = allLaps.find(l => l.carIndex === idxA) || allLaps[0] || null;
                    lapB = allLaps.find(l => l.carIndex === idxB) || allLaps[1] || null;
                }

                ws.send(JSON.stringify({
                    type: 'ghostComparisonDataResponse',
                    driverA: lapA || null,
                    driverB: lapB || null,
                    trackId: tId,
                    trackPoints: gameState.state.trackPoints || []
                }));
                return;
            }

            if (data.action === 'getSessionAllLaps') {
                const tId = data.trackId !== undefined ? parseInt(data.trackId, 10) : gameState.currentTrackId;
                const cIdx = data.carIndex !== undefined ? parseInt(data.carIndex, 10) : null;
                const laps = getSessionAllLaps(tId, cIdx, false);

                ws.send(JSON.stringify({
                    type: 'sessionAllLapsResponse',
                    trackId: tId,
                    data: laps.map(l => ({
                        id: l.id,
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
                        totalBrakingDist: l.totalBrakingDist,
                        avgDecelG: l.avgDecelG,
                        brakingZonesCount: (l.brakingZones || []).length,
                        telemetryPoints: (l.telemetry || []).length,
                        timestamp: l.timestamp
                    }))
                }));
                return;
            }

            if (data.action === 'getLapBrakingData') {
                const tId = data.trackId !== undefined ? parseInt(data.trackId, 10) : gameState.currentTrackId;
                const cIdx = data.carIndex !== undefined ? parseInt(data.carIndex, 10) : (gameState.state.playerIndex || 0);
                const allLaps = getSessionAllLaps(tId, cIdx, false);

                let baselineLap = null;
                if (data.baseline !== undefined) {
                    const bNum = parseInt(data.baseline, 10);
                    baselineLap = allLaps.find(l => l.lapNum === bNum) || null;
                }
                if (!baselineLap && allLaps.length > 0) {
                    const validLaps = allLaps.filter(l => l.lapTimeMs > 0);
                    baselineLap = validLaps.length > 0 ? [...validLaps].sort((a, b) => a.lapTimeMs - b.lapTimeMs)[0] : allLaps[0];
                }

                let compareLap = null;
                if (data.compare !== undefined) {
                    const cNum = parseInt(data.compare, 10);
                    compareLap = allLaps.find(l => l.lapNum === cNum) || null;
                } else if (allLaps.length > 1 && baselineLap) {
                    compareLap = allLaps.find(l => l.lapNum !== baselineLap.lapNum) || null;
                }

                const h2h = baselineLap ? compareLapsBraking(baselineLap, compareLap) : null;
                const matrix = baselineLap ? buildAllLapsComparisonMatrix(baselineLap, allLaps) : null;

                ws.send(JSON.stringify({
                    type: 'lapBrakingDataResponse',
                    trackId: tId,
                    trackName: gameState.state.session.trackName || 'Circuit',
                    trackLength: gameState.state.session.trackLength || 5000,
                    trackPoints: gameState.state.trackPoints || [],
                    baselineLap: baselineLap,
                    compareLap: compareLap,
                    h2hComparison: h2h,
                    comparisonMatrix: matrix,
                    allLapsSummary: allLaps.map(l => ({
                        lapNum: l.lapNum,
                        driverName: l.driverName,
                        teamColor: l.teamColor,
                        lapTimeMs: l.lapTimeMs,
                        totalBrakingDist: l.totalBrakingDist,
                        avgDecelG: l.avgDecelG,
                        brakingZonesCount: (l.brakingZones || []).length,
                        isValid: l.isValid !== false
                    }))
                }));
                return;
            }

            if (data.action === 'getTrackSetups') {
                const trackId = data.trackId !== undefined ? parseInt(data.trackId) : gameState.currentTrackId;
                if (!isNaN(trackId) && trackId !== -1) {
                    const sPath = path.join(setupsDir, `setups_y${gameState.currentGameYear}_t${trackId}.json`);
                    if (fs.existsSync(sPath)) {
                        try {
                            const sData = JSON.parse(fs.readFileSync(sPath, 'utf8'));
                            ws.send(JSON.stringify({ type: 'trackSetupsResponse', trackId, data: sData }));
                        } catch (e) { }
                    } else {
                        ws.send(JSON.stringify({ type: 'trackSetupsResponse', trackId, data: [] }));
                    }
                }
                return;
            }

            if (data.action === 'resetSectors') {
                gameState.state.customSectorLines = [0];
                return;
            }

            if (data.action === 'startSessionRecording') {
                const trackId = data.trackId !== undefined && data.trackId !== -1 ? parseInt(data.trackId, 10) : gameState.currentTrackId;
                if (!isNaN(trackId) && trackId !== -1) {
                    gameState.currentTrackId = trackId;
                }

                gameState.isRecordingSessionTelemetry = true;
                gameState.sessionRecordingStartTime = Date.now();

                if (data.reset !== false) {
                    gameState.sessionDriverFastestLaps = Array.from({ length: 22 }, () => null);
                    gameState.currentLapTelemetry = Array.from({ length: 22 }, () => []);
                    gameState.lastLapTelemetry = Array.from({ length: 22 }, () => []);
                }

                console.log(`🔴 [WS] Session recording active for Track ${gameState.currentTrackId}`);
                broadcast(JSON.stringify({
                    type: 'sessionRecordingState',
                    isRecording: true,
                    startTime: gameState.sessionRecordingStartTime,
                    trackId: gameState.currentTrackId
                }));
                return;
            }

            if (data.action === 'stopSessionRecording') {
                gameState.isRecordingSessionTelemetry = false;
                console.log(`⏹️ [WS] Session recording stopped`);
                broadcast(JSON.stringify({
                    type: 'sessionRecordingState',
                    isRecording: false,
                    startTime: 0,
                    trackId: gameState.currentTrackId
                }));
                return;
            }

            if (data.action === 'getSessionRecordingStatus') {
                ws.send(JSON.stringify({
                    type: 'sessionRecordingState',
                    isRecording: gameState.isRecordingSessionTelemetry,
                    startTime: gameState.sessionRecordingStartTime,
                    trackId: gameState.currentTrackId
                }));
                return;
            }

            if (data.action === 'clearSession' || data.action === 'resetSession') {
                resetSessionData(broadcast);
                return;
            }

            if (data.action === 'syncTrackLines') {
                const tId = data.trackId !== undefined ? data.trackId : gameState.currentTrackId;
                if (isTrackFinalized(tId)) {
                    console.log(`🔒 Track ${tId} is finalized/locked. Sync request rejected.`);
                    ws.send(JSON.stringify({
                        type: 'toast',
                        message: `🔒 Track ${tId} is locked/finalized. Unlock to allow sync.`
                    }));
                    ws.send(JSON.stringify({
                        type: 'trackFinalizedState',
                        trackId: tId,
                        finalized: true
                    }));
                    return;
                }
                syncTrackLinesForTrack(tId, false, broadcast, data.gameYear || gameState.currentGameYear);
                return;
            }

            if (data.action === 'addSector' && data.timeMs >= 0) {
                if (data.timeMs === 0) {
                    if (!gameState.state.customSectorLines.find(s => s.d === 0)) gameState.state.customSectorLines.push({ x: gameState.state.startLine?.x || 0, z: gameState.state.startLine?.z || 0, yaw: gameState.state.startLine?.yaw || 0, d: 0 });
                    return;
                }
                const ghostData = gameState.fastestLapGhostData;
                if (ghostData && ghostData.length > 0) {
                    let bestPt = null;
                    let idx = ghostData.findIndex(pt => pt.t >= data.timeMs);
                    if (idx === 0) {
                        bestPt = ghostData[0];
                    } else if (idx > 0) {
                        const pt1 = ghostData[idx - 1];
                        const pt2 = ghostData[idx];
                        const rangeTime = pt2.t - pt1.t;
                        if (rangeTime > 0) {
                            const ratio = (data.timeMs - pt1.t) / rangeTime;
                            bestPt = {
                                x: pt1.x + (pt2.x - pt1.x) * ratio,
                                z: pt1.z + (pt2.z - pt1.z) * ratio,
                                yaw: pt1.yaw, // Approximated
                                d: pt1.d + (pt2.d - pt1.d) * ratio
                            };
                        } else {
                            bestPt = pt2;
                        }
                    } else {
                        bestPt = ghostData[ghostData.length - 1];
                    }
                    if (bestPt) {
                        gameState.state.customSectorLines.push({ x: bestPt.x, z: bestPt.z, yaw: bestPt.yaw || 0, d: bestPt.d });
                        console.log(`📍 Custom Sector Line coordinates calculated and added (for time: ${data.timeMs}ms)`);
                    }
                }
            }
        } catch (e) {
            console.error('Error parsing WS message:', e);
        }
    });
    ws.on('error', (err) => {
        clients = clients.filter(client => client !== ws);
    });
    ws.on('close', () => {
        clients = clients.filter(client => client !== ws);
    });
}

function initWebSocketServer(server) {
    wss = new WebSocket.Server({ server });
    wss.on('error', (err) => { console.error('🛡️ [WSS Error]:', err.message); });
    wss.on('connection', handleWsConnection);

    try {
        legacyWss = new WebSocket.Server({ port: LEGACY_WS_PORT, host: '0.0.0.0' });
        legacyWss.on('error', (err) => { console.error('🛡️ [Legacy WSS Error]:', err.message); });
        legacyWss.on('connection', handleWsConnection);
    } catch (e) {
        console.error('🛡️ [Legacy WSS Init Error]:', e.message);
    }

    return { wss, legacyWss };
}

module.exports = {
    initWebSocketServer,
    handleWsConnection,
    broadcast,
    get clients() { return clients; }
};
