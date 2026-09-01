const fs = require('fs');
const path = require('path');
const { trackMapsDir, telemetryDir, lapTimeDir } = require('../config');
const { OFFICIAL_TRACK_SECTOR_DISTANCES, OFFICIAL_TRACK_DRS_ZONES } = require('../config/catalogs');
const { safeSaveTrackMap } = require('../utils/fileSystem');
const gameState = require('../state/gameState');

function buildSyncedDrsZones(tId, totalDist) {
    const zones = OFFICIAL_TRACK_DRS_ZONES[tId];
    if (!Array.isArray(zones) || zones.length === 0 || !Number.isFinite(totalDist) || totalDist <= 0) return [];

    return zones.map(zone => {
        const synced = {
            start: zone.start,
            end: zone.end,
            startDistance: Math.round(zone.start * totalDist),
            endDistance: Math.round(zone.end * totalDist)
        };
        if (zone.det !== undefined) {
            synced.det = zone.det;
            synced.detDistance = Math.round(zone.det * totalDist);
        }
        return synced;
    });
}

/**
 * Extracts a coordinate from recorded telemetry by EXACT DISTANCE along the track.
 * Linearly interpolates coordinates and yaw between adjacent points.
 */
function extractCoordinateFromTelemetryByDistance(telemetry, targetDistance) {
    if (!telemetry || telemetry.length === 0 || targetDistance === undefined || targetDistance === null || targetDistance < 0) return null;
    if (targetDistance === 0) {
        const d0Candidate = telemetry.find(pt => Math.abs(pt.d || 0) < 60 && (pt.x !== 0 || pt.z !== 0));
        return d0Candidate || telemetry[0];
    }
    let idx = telemetry.findIndex(pt => (pt.d !== undefined ? pt.d : 0) >= targetDistance);
    if (idx === 0) return telemetry[0];
    if (idx > 0) {
        const pt1 = telemetry[idx - 1];
        const pt2 = telemetry[idx];
        const d1 = pt1.d !== undefined ? pt1.d : 0;
        const d2 = pt2.d !== undefined ? pt2.d : 0;
        const rangeD = d2 - d1;
        if (rangeD > 0) {
            const ratio = Math.max(0, Math.min(1, (targetDistance - d1) / rangeD));
            return {
                x: pt1.x + (pt2.x - pt1.x) * ratio,
                z: pt1.z + (pt2.z - pt1.z) * ratio,
                yaw: pt1.yaw !== undefined ? pt1.yaw + (pt2.yaw - pt1.yaw) * ratio : (pt2.yaw || 0),
                d: targetDistance
            };
        }
        return pt2;
    }
    return null;
}

/**
 * Detects and synchronizes DRS activation zones and detection points using:
 * 1. Live/Recorded telemetry points where DRS was active (drs / drsOpen / drsAvailable)
 * 2. Exact track distance interpolation from the official FIA catalog
 */
function getTelemetryDrsZonesForTrack(tId, totalDist, telData = null, fallbackZones = null) {
    const { state } = gameState;
    if (!Number.isFinite(totalDist) || totalDist <= 0) {
        totalDist = OFFICIAL_TRACK_SECTOR_DISTANCES[tId]?.len || (state.session?.trackLength > 0 ? state.session.trackLength : 5000);
    }

    // 1. Check if telData has explicit DRS telemetry events (drs === 1 / drsOpen === 1 / drsAvailable === 1)
    if (Array.isArray(telData) && telData.length > 50) {
        const drsIntervals = [];
        let curInterval = null;
        for (let i = 0; i < telData.length; i++) {
            const pt = telData[i];
            const isDrs = (pt.drs === 1 || pt.drs === true || pt.drsOpen === 1 || pt.drsAvailable === 1);
            if (isDrs && Number.isFinite(pt.d)) {
                if (!curInterval) curInterval = { startD: pt.d, endD: pt.d, pts: [pt] };
                else { curInterval.endD = pt.d; curInterval.pts.push(pt); }
            } else {
                if (curInterval) {
                    if (curInterval.endD - curInterval.startD > 100) {
                        drsIntervals.push(curInterval);
                    }
                    curInterval = null;
                }
            }
        }
        if (curInterval && (curInterval.endD - curInterval.startD > 100)) {
            drsIntervals.push(curInterval);
        }

        if (drsIntervals.length > 0) {
            return drsIntervals.map(inter => {
                const sCoord = extractCoordinateFromTelemetryByDistance(telData, inter.startD);
                const eCoord = extractCoordinateFromTelemetryByDistance(telData, inter.endD);
                const detD = Math.max(0, inter.startD - 150);
                const detCoord = extractCoordinateFromTelemetryByDistance(telData, detD);
                return {
                    start: sCoord || { x: 0, z: 0, yaw: 0, d: Math.round(inter.startD) },
                    end: eCoord || { x: 0, z: 0, yaw: 0, d: Math.round(inter.endD) },
                    detection: detCoord || { x: 0, z: 0, yaw: 0, d: Math.round(detD) },
                    startDistance: Math.round(inter.startD),
                    endDistance: Math.round(inter.endD),
                    detDistance: Math.round(detD),
                    startFrac: inter.startD / totalDist,
                    endFrac: inter.endD / totalDist,
                    detFrac: detD / totalDist
                };
            });
        }
    }

    // 2. Official catalog by distance & fraction
    const catalog = (Array.isArray(fallbackZones) && fallbackZones.length > 0) ? fallbackZones : OFFICIAL_TRACK_DRS_ZONES[tId];
    if (Array.isArray(catalog) && catalog.length > 0) {
        return catalog.map(z => {
            const sD = (z.startDistance !== undefined && Number.isFinite(z.startDistance))
                ? z.startDistance
                : (typeof z.start === 'object' && Number.isFinite(z.start?.d) ? z.start.d : (Number.isFinite(z.start) ? (z.start * totalDist) : 0));
            const eD = (z.endDistance !== undefined && Number.isFinite(z.endDistance))
                ? z.endDistance
                : (typeof z.end === 'object' && Number.isFinite(z.end?.d) ? z.end.d : (Number.isFinite(z.end) ? (z.end * totalDist) : 0));
            const detD = (z.detDistance !== undefined && Number.isFinite(z.detDistance))
                ? z.detDistance
                : (typeof z.det === 'object' && Number.isFinite(z.det?.d) ? z.det.d : (typeof z.detection === 'object' && Number.isFinite(z.detection?.d) ? z.detection.d : (Number.isFinite(z.det) ? (z.det * totalDist) : Math.max(0, sD - 150))));

            let sCoord = null, eCoord = null, detCoord = null;
            if (Array.isArray(telData) && telData.length > 10) {
                sCoord = extractCoordinateFromTelemetryByDistance(telData, sD);
                eCoord = extractCoordinateFromTelemetryByDistance(telData, eD);
                detCoord = extractCoordinateFromTelemetryByDistance(telData, detD);
            }

            return {
                start: sCoord || (typeof z.start === 'object' ? z.start : { x: 0, z: 0, yaw: 0, d: Math.round(sD) }),
                end: eCoord || (typeof z.end === 'object' ? z.end : { x: 0, z: 0, yaw: 0, d: Math.round(eD) }),
                detection: detCoord || (typeof z.det === 'object' ? z.det : (typeof z.detection === 'object' ? z.detection : { x: 0, z: 0, yaw: 0, d: Math.round(detD) })),
                startDistance: Math.round(sD),
                endDistance: Math.round(eD),
                detDistance: Math.round(detD),
                startFrac: z.startFrac !== undefined ? z.startFrac : (Number.isFinite(z.start) ? z.start : (sD / totalDist)),
                endFrac: z.endFrac !== undefined ? z.endFrac : (Number.isFinite(z.end) ? z.end : (eD / totalDist)),
                detFrac: z.detFrac !== undefined ? z.detFrac : (Number.isFinite(z.det) ? z.det : (detD / totalDist))
            };
        });
    }

    return [];
}

/**
 * Checks if a track map has been finalized
 */
function isTrackFinalized(tId) {
    if (tId === undefined || tId === null || tId === -1) return false;
    if (gameState.finalizedTracks[tId] !== undefined) return !!gameState.finalizedTracks[tId];
    const mapPath = path.join(trackMapsDir, `track_${tId}.json`);
    if (fs.existsSync(mapPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
            gameState.finalizedTracks[tId] = !!data.finalized;
            return gameState.finalizedTracks[tId];
        } catch (e) { }
    }
    gameState.finalizedTracks[tId] = false;
    return false;
}

/**
 * Re-synchronizes start line, sector 1, sector 2, and DRS lines for a circuit using EXACT TRACK DISTANCES.
 * Uses official session sector markers from the game engine, recorded telemetry, or the official FIA catalog.
 * @param {number} tId Track ID
 * @param {boolean} force Force sync even if finalized
 * @param {Function} [broadcastFn] Optional broadcast callback for connected clients
 */
function syncTrackLinesForTrack(tId, force = false, broadcastFn = null) {
    if (tId === undefined || tId === null || tId === -1) return null;
    if (!force && isTrackFinalized(tId)) {
        console.log(`🔒 Track ${tId} is finalized. Auto-sync skipped.`);
        return null;
    }
    const telPath = path.join(telemetryDir, `telemetry_${tId}.json`);
    const mapPath = path.join(trackMapsDir, `track_${tId}.json`);
    const { state, allTimeFastest } = gameState;

    try {
        let telData = [];
        let trackPoints = [];

        // Load recorded lap telemetry if present
        if (fs.existsSync(telPath)) {
            try {
                const rawTel = JSON.parse(fs.readFileSync(telPath, 'utf8'));
                if (Array.isArray(rawTel) && rawTel.length > 10) {
                    telData = rawTel.filter(p => Number.isFinite(p.x) && Number.isFinite(p.z) && (p.x !== 0 || p.z !== 0));
                    telData.sort((a, b) => (a.d !== undefined && b.d !== undefined) ? a.d - b.d : a.t - b.t);
                }
            } catch (e) { }
        }

        // Load track map geometry if present
        if (fs.existsSync(mapPath)) {
            try {
                const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
                trackPoints = Array.isArray(mapData) ? mapData : (mapData.trackPoints || []);
            } catch (e) { }
        }

        // If no telemetry file exists, compute cumulative distances from trackPoints
        if (telData.length < 10) {
            if (trackPoints.length >= 20) {
                let cumulative = 0;
                telData = [{ x: trackPoints[0].x, z: trackPoints[0].z, yaw: 0, d: 0 }];
                for (let i = 1; i < trackPoints.length; i++) {
                    const seg = Math.hypot(trackPoints[i].x - trackPoints[i - 1].x, trackPoints[i].z - trackPoints[i - 1].z);
                    cumulative += seg;
                    const dx = trackPoints[i].x - trackPoints[i - 1].x;
                    const dz = trackPoints[i].z - trackPoints[i - 1].z;
                    const yaw = Math.atan2(dx, dz);
                    telData.push({ x: trackPoints[i].x, z: trackPoints[i].z, yaw, d: cumulative });
                }
            } else {
                return null;
            }
        }

        // Total circuit distance
        const totalDist = (telData[telData.length - 1].d > 0)
            ? telData[telData.length - 1].d
            : (state.session.trackLength || 5000);

        // 1. Start line: point closest to d = 0
        const startCandidates = telData.filter(p => Math.abs(p.d || 0) < 150);
        const startLinePt = (startCandidates.length > 0)
            ? startCandidates.reduce((prev, curr) => Math.abs(curr.d || 0) < Math.abs(prev.d || 0) ? curr : prev)
            : telData[0];

        const newStart = {
            x: startLinePt.x,
            z: startLinePt.z,
            yaw: startLinePt.yaw || 0,
            d: startLinePt.d || 0
        };

        // Determine exact sector distances in metres
        let targetS1Distance = null;
        let targetS2Distance = null;

        // Priority 1: Live official sector distance from game engine (PacketSessionData) if track matches
        if (tId === gameState.currentTrackId && state.session.sector2Distance > 100 && state.session.sector3Distance > state.session.sector2Distance) {
            const liveS1 = state.session.sector2Distance;
            const liveS2 = state.session.sector3Distance;
            if (liveS1 > (totalDist * 0.15) && liveS1 < (totalDist * 0.55) && liveS2 > (liveS1 + 500) && liveS2 < (totalDist * 0.95)) {
                targetS1Distance = liveS1;
                targetS2Distance = liveS2;
                if (OFFICIAL_TRACK_SECTOR_DISTANCES[tId]) {
                    OFFICIAL_TRACK_SECTOR_DISTANCES[tId].s1 = Math.round(liveS1);
                    OFFICIAL_TRACK_SECTOR_DISTANCES[tId].s2 = Math.round(liveS2);
                }
            }
        }

        // Priority 2: Official FIA sector distance catalog
        if ((!targetS1Distance || !targetS2Distance) && OFFICIAL_TRACK_SECTOR_DISTANCES[tId]) {
            targetS1Distance = OFFICIAL_TRACK_SECTOR_DISTANCES[tId].s1;
            targetS2Distance = OFFICIAL_TRACK_SECTOR_DISTANCES[tId].s2;
        }

        // Priority 3: Existing valid map file distance
        if (!targetS1Distance || !targetS2Distance) {
            if (fs.existsSync(mapPath)) {
                try {
                    const existingMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
                    if (existingMap.sector1 && existingMap.sector2 && existingMap.sector1.d > 200 && existingMap.sector2.d > existingMap.sector1.d + 500) {
                        targetS1Distance = existingMap.sector1.d;
                        targetS2Distance = existingMap.sector2.d;
                    }
                } catch (e) { }
            }
        }

        // Priority 4: Proportional split from lap times (fastest.json)
        if (!targetS1Distance || !targetS2Distance) {
            const rec = allTimeFastest[tId] || {};
            if (rec.s1 > 0 && rec.s2 > 0 && rec.time > (rec.s1 + rec.s2)) {
                targetS1Distance = Math.round(totalDist * (rec.s1 / rec.time));
                targetS2Distance = Math.round(totalDist * ((rec.s1 + rec.s2) / rec.time));
            }
        }

        // Fallback: 30% and 70% of total distance
        if (!targetS1Distance || targetS1Distance <= 0) targetS1Distance = Math.round(totalDist * 0.30);
        if (!targetS2Distance || targetS2Distance <= targetS1Distance) targetS2Distance = Math.round(totalDist * 0.70);

        // Extract precise 3D coordinates using EXACT TRACK DISTANCES
        const coordS1 = extractCoordinateFromTelemetryByDistance(telData, targetS1Distance);
        const coordS2 = extractCoordinateFromTelemetryByDistance(telData, targetS2Distance);

        const newS1 = coordS1 ? { x: coordS1.x, z: coordS1.z, yaw: coordS1.yaw || 0, d: coordS1.d || targetS1Distance } : null;
        const newS2 = coordS2 ? { x: coordS2.x, z: coordS2.z, yaw: coordS2.yaw || 0, d: coordS2.d || targetS2Distance } : null;

        // Synchronize DRS zones using exact telemetry interpolation
        const syncedDrsZones = getTelemetryDrsZonesForTrack(tId, totalDist, telData);

        if (tId === gameState.currentTrackId) {
            if (newStart) state.startLine = newStart;
            if (newS1) state.sector1 = newS1;
            if (newS2) state.sector2 = newS2;
            state.drsZones = syncedDrsZones;
            gameState.trackPointsDirty = true;
        }

        if (trackPoints.length === 0) {
            let lastD = -999;
            for (const p of telData) {
                if (Math.abs(p.d - lastD) >= 18) {
                    trackPoints.push({ x: p.x, z: p.z });
                    lastD = p.d;
                }
            }
        }

        const updatedData = {
            trackPoints: trackPoints,
            startLine: newStart,
            sector1: newS1,
            sector2: newS2,
            drsZones: syncedDrsZones,
            finalized: isTrackFinalized(tId)
        };
        safeSaveTrackMap(mapPath, updatedData);
        console.log(`✅ Synced track lines for Map ${tId} using exact distance (S1: d=${Math.round(newS1?.d || 0)}m, S2: d=${Math.round(newS2?.d || 0)}m of ${Math.round(totalDist)}m, DRS zones: ${syncedDrsZones.length})`);

        // Broadcast to clients if callback provided
        if (typeof broadcastFn === 'function') {
            const msg = JSON.stringify({
                type: 'trackLinesUpdated',
                trackId: tId,
                startLine: newStart,
                sector1: newS1,
                sector2: newS2,
                drsZones: updatedData.drsZones,
                finalized: updatedData.finalized
            });
            const tMsg = JSON.stringify({
                type: 'trackDataResponse',
                trackId: tId,
                data: updatedData
            });
            broadcastFn(msg);
            broadcastFn(tMsg);
        }

        return updatedData;
    } catch (e) {
        console.error(`Error syncing track lines for Track ${tId}:`, e);
        return null;
    }
}

/**
 * Mathematically approximates the shape of the pit lane based on the main track coordinates.
 */
function buildApproxPitLane(trackPoints) {
    if (!Array.isArray(trackPoints) || trackPoints.length < 18) return [];

    const laneLength = Math.min(Math.max(Math.floor(trackPoints.length * 0.18), 12), 34);
    const laneStart = Math.max(0, Math.floor(trackPoints.length * 0.01));
    const laneEnd = Math.min(trackPoints.length - 1, laneStart + laneLength);
    const lanePoints = [];

    for (let i = laneStart; i <= laneEnd; i++) {
        const prev = trackPoints[Math.max(0, i - 1)];
        const curr = trackPoints[i];
        const next = trackPoints[Math.min(trackPoints.length - 1, i + 1)];
        const dx = next.x - prev.x;
        const dz = next.z - prev.z;
        const len = Math.hypot(dx, dz) || 1;
        const offset = 42 + Math.sin(((i - laneStart) / Math.max(1, laneEnd - laneStart)) * Math.PI) * 34;

        lanePoints.push({
            x: curr.x + (-dz / len) * offset,
            z: curr.z + (dx / len) * offset
        });
    }

    return lanePoints;
}

/**
 * Loads the ghost lap telemetry reference for delta calculations for a specific track.
 */
function loadTrackDeltaReference(trackId) {
    const { allTimeFastest, state, carDataTracker } = gameState;
    const record = allTimeFastest[trackId];
    gameState.fastestLapGhostData = [];

    const telPath = path.join(telemetryDir, `telemetry_${trackId}.json`);
    const trackFastestPath = path.join(lapTimeDir, `fastest_${trackId}.json`);

    let loadedTelemetry = [];
    if (fs.existsSync(telPath)) {
        try {
            const raw = JSON.parse(fs.readFileSync(telPath, 'utf8'));
            if (Array.isArray(raw) && raw.length > 0) {
                loadedTelemetry = raw;
            }
        } catch (e) {
            console.error(`⚠️ Error reading telemetry_${trackId}.json:`, e.message);
        }
    }

    if (loadedTelemetry.length === 0 && fs.existsSync(trackFastestPath)) {
        try {
            const raw = JSON.parse(fs.readFileSync(trackFastestPath, 'utf8'));
            const pts = Array.isArray(raw) ? raw : (raw.telemetry || []);
            if (pts.length > 0) loadedTelemetry = pts;
        } catch (e) {
            console.error(`⚠️ Error reading fastest_${trackId}.json:`, e.message);
        }
    }

    if (record) {
        state.session.allTimeFastestLapMs = record.time;
        state.session.allTimeFastestDriver = record.driver;
    } else if (loadedTelemetry.length > 0) {
        const lastPt = loadedTelemetry[loadedTelemetry.length - 1];
        if (lastPt && lastPt.t > 0) {
            state.session.allTimeFastestLapMs = lastPt.t;
            state.session.allTimeFastestDriver = 'Track Reference';
        }
    } else {
        state.session.allTimeFastestLapMs = Infinity;
        state.session.allTimeFastestDriver = 'Unknown';
    }

    if (loadedTelemetry.length > 0) {
        const ghostData = loadedTelemetry
            .filter(pt => Number.isFinite(pt.d) && Number.isFinite(pt.t))
            .sort((a, b) => a.d - b.d);

        if (ghostData.length > 0 && ghostData[0].d > 0) {
            ghostData.unshift({
                d: 0,
                t: 0,
                x: ghostData[0].x || 0,
                z: ghostData[0].z || 0,
                yaw: ghostData[0].yaw || 0,
                throttle: 0, brake: 0, speed: 0, steer: 0, gear: 0
            });
        }
        gameState.fastestLapGhostData = ghostData;

        // Calculate reference sectors from official record if available; otherwise telemetry distance markers
        const finalTime = ghostData[ghostData.length - 1].t;
        let refS1 = (record && record.s1 > 0) ? record.s1 : 0;
        let refS2 = (record && record.s2 > 0) ? record.s2 : 0;
        let refS3 = (record && record.s3 > 0) ? record.s3 : 0;

        if (!refS1 || !refS2 || !refS3) {
            const totalDist = (state.session.trackLength > 0) ? state.session.trackLength : (ghostData[ghostData.length - 1].d || 5000);
            const s2Dist = (state.session.sector2Distance > 0) ? state.session.sector2Distance : Math.round(totalDist / 3);
            const s3Dist = (state.session.sector3Distance > 0) ? state.session.sector3Distance : Math.round((totalDist / 3) * 2);

            const ptS1 = ghostData.reduce((prev, curr) => Math.abs(curr.d - s2Dist) < Math.abs(prev.d - s2Dist) ? curr : prev, ghostData[0]);
            const ptS2 = ghostData.reduce((prev, curr) => Math.abs(curr.d - s3Dist) < Math.abs(prev.d - s3Dist) ? curr : prev, ghostData[0]);

            refS1 = refS1 || (ptS1 ? ptS1.t : Math.round(finalTime * 0.28));
            refS2 = refS2 || ((ptS2 && ptS1) ? Math.max(0, ptS2.t - ptS1.t) : Math.round(finalTime * 0.40));
            refS3 = refS3 || Math.max(0, finalTime - (refS1 + refS2));
        }

        if (refS1 > 0 && refS2 > 0 && refS3 > 0) {
            state.session.referenceS1 = refS1;
            state.session.referenceS2 = refS2;
            state.session.referenceS3 = refS3;
            state.session.allTimeBestS1 = refS1;
            state.session.allTimeBestS2 = refS2;
            state.session.allTimeBestS3 = refS3;

            if (state.session.sessionBestS1 === Infinity || state.session.sessionBestS1 === 0) state.session.sessionBestS1 = refS1;
            if (state.session.sessionBestS2 === Infinity || state.session.sessionBestS2 === 0) state.session.sessionBestS2 = refS2;
            if (state.session.sessionBestS3 === Infinity || state.session.sessionBestS3 === 0) state.session.sessionBestS3 = refS3;

            const pIdx = state.playerIndex || 0;
            if (!carDataTracker[pIdx].bestS1 || carDataTracker[pIdx].bestS1 === 0) carDataTracker[pIdx].bestS1 = refS1;
            if (!carDataTracker[pIdx].bestS2 || carDataTracker[pIdx].bestS2 === 0) carDataTracker[pIdx].bestS2 = refS2;
            if (!carDataTracker[pIdx].bestS3 || carDataTracker[pIdx].bestS3 === 0) carDataTracker[pIdx].bestS3 = refS3;
            if (!state.lap.bestS1) state.lap.bestS1 = refS1;
            if (!state.lap.bestS2) state.lap.bestS2 = refS2;
            if (!state.lap.bestS3) state.lap.bestS3 = refS3;
        }

        console.log(`Loaded delta reference for Track ${trackId} (${ghostData.length} points, S1: ${refS1}ms, S2: ${refS2}ms, S3: ${refS3}ms).`);
    }
}

/**
 * Helper function to interpolate and extract a precise coordinate (x, z, yaw, distance)
 * from an array of telemetry points for a given timestamp.
 */
function extractCoordinateFromTelemetry(telemetry, targetTimeMs) {
    if (!telemetry || telemetry.length === 0 || targetTimeMs === undefined || targetTimeMs === null || targetTimeMs < 0) return null;
    if (targetTimeMs === 0) return telemetry[0];
    let idx = telemetry.findIndex(pt => pt.t >= targetTimeMs);
    if (idx === 0) return telemetry[0];
    if (idx > 0) {
        const pt1 = telemetry[idx - 1];
        const pt2 = telemetry[idx];
        const rangeTime = pt2.t - pt1.t;
        if (rangeTime > 0) {
            const ratio = (targetTimeMs - pt1.t) / rangeTime;
            return {
                x: pt1.x + (pt2.x - pt1.x) * ratio,
                z: pt1.z + (pt2.z - pt1.z) * ratio,
                yaw: pt1.yaw || 0,
                d: pt1.d + (pt2.d - pt1.d) * ratio
            };
        }
    }
    return null;
}

function hasTelemetryCoordinate(point) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.z);
}

function shouldSetSectorLine(existing, coord) {
    if (!hasTelemetryCoordinate(coord)) return false;
    return !existing || !Number.isFinite(existing.x) || !Number.isFinite(existing.z) || (existing.x === 0 && existing.z === 0);
}

/**
 * Replays telemetry to determine exactly where a car was on track when it crossed 
 * sector 1 and sector 2 lines. This locks the visual sector lines to the track map.
 */
function lockOfficialSectorLinesFromTelemetry(carIndex, sector1Ms, sector2Ms, telemetry, broadcastFn = null) {
    const { currentTrackId, state } = gameState;
    if (currentTrackId === -1 || !Array.isArray(telemetry) || telemetry.length < 50) return false;
    const lastPt = telemetry[telemetry.length - 1];
    if (!lastPt || (lastPt.d || 0) < 2000) return false;

    let trackUpdated = false;
    if (sector1Ms > 0) {
        const coord = extractCoordinateFromTelemetry(telemetry, sector1Ms);
        if (coord && hasTelemetryCoordinate(coord) && (coord.x !== 0 || coord.z !== 0)) {
            state.sector1 = { x: coord.x, z: coord.z, yaw: coord.yaw || 0, d: coord.d };
            trackUpdated = true;
        }
    }

    if (sector1Ms > 0 && sector2Ms > 0) {
        const coord = extractCoordinateFromTelemetry(telemetry, sector1Ms + sector2Ms);
        if (coord && hasTelemetryCoordinate(coord) && (coord.x !== 0 || coord.z !== 0)) {
            state.sector2 = { x: coord.x, z: coord.z, yaw: coord.yaw || 0, d: coord.d };
            trackUpdated = true;
        }
    }

    // Also lock startLine if near d = 0
    const startCandidate = telemetry.find(pt => Math.abs(pt.d || 0) < 60 && (pt.x !== 0 || pt.z !== 0));
    if (startCandidate && (!state.startLine || state.startLine.x === 0 || Math.abs(startCandidate.d) < Math.abs(state.startLine.d || 999))) {
        state.startLine = { x: startCandidate.x, z: startCandidate.z, yaw: startCandidate.yaw || 0, d: startCandidate.d || 0 };
        trackUpdated = true;
    }

    if (trackUpdated) {
        gameState.trackPointsDirty = true;
        if (currentTrackId !== -1) {
            const filePath = path.join(trackMapsDir, `track_${currentTrackId}.json`);
            let trackPoints = state.trackPoints || [];
            if (fs.existsSync(filePath)) {
                try {
                    const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    trackPoints = Array.isArray(existing) ? existing : (existing.trackPoints || trackPoints);
                } catch (e) { }
            }
            safeSaveTrackMap(filePath, {
                trackPoints: trackPoints,
                startLine: state.startLine,
                sector1: state.sector1,
                sector2: state.sector2
            });
        }

        if (typeof broadcastFn === 'function') {
            const msg = JSON.stringify({
                type: 'trackLinesUpdated',
                trackId: currentTrackId,
                startLine: state.startLine,
                sector1: state.sector1,
                sector2: state.sector2
            });
            broadcastFn(msg);
        }
    }

    return trackUpdated;
}

module.exports = {
    buildSyncedDrsZones,
    extractCoordinateFromTelemetryByDistance,
    getTelemetryDrsZonesForTrack,
    isTrackFinalized,
    syncTrackLinesForTrack,
    buildApproxPitLane,
    loadTrackDeltaReference,
    extractCoordinateFromTelemetry,
    hasTelemetryCoordinate,
    shouldSetSectorLine,
    lockOfficialSectorLinesFromTelemetry
};
