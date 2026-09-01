const path = require('path');
const WebSocket = require('ws');
const { trackMapsDir } = require('../../config');
const gameState = require('../../state/gameState');
const { touchUdpPacket, setPlayerIndex } = require('../../state/stateHelpers');
const { processServerGForce, gForceData } = require('../../services/gforceService');
const { safeSaveTrackMap } = require('../../utils/fileSystem');
const { buildApproxPitLane, syncTrackLinesForTrack } = require('../../services/trackService');
const wsServer = require('../../websocket/wsServer');

/**
 * Completes and saves a newly mapped circuit from live recorded telemetry.
 * Automatically closes the loop, computes pit lane, sets official sector lines,
 * saves to disk, and broadcasts the completed circuit map to all clients.
 */
function completeLiveTrackMapping() {
    const { state, currentTrackId } = gameState;
    if (gameState.isTrackMapped || currentTrackId === -1 || !state.trackPoints || state.trackPoints.length < 50) return;
    gameState.isTrackMapped = true;

    const pts = state.trackPoints;
    const firstPt = pts[0];
    const lastPt = pts[pts.length - 1];
    if (Math.hypot(lastPt.x - firstPt.x, lastPt.z - firstPt.z) > 5) {
        pts.push({ x: firstPt.x, z: firstPt.z });
    }

    state.pitLanePoints = buildApproxPitLane(pts);

    const filePath = path.join(trackMapsDir, `track_${currentTrackId}.json`);
    safeSaveTrackMap(filePath, {
        trackPoints: pts,
        startLine: state.startLine,
        sector1: state.sector1,
        sector2: state.sector2
    });

    // Synchronize official sector lines using exact distance
    syncTrackLinesForTrack(currentTrackId, false, wsServer.broadcast);

    // Broadcast full trackDataResponse to all clients
    const completeMsg = JSON.stringify({
        type: 'trackDataResponse',
        trackId: currentTrackId,
        data: {
            trackPoints: state.trackPoints,
            pitLanePoints: state.pitLanePoints || [],
            startLine: state.startLine,
            sector1: state.sector1,
            sector2: state.sector2
        }
    });
    wsServer.broadcast(completeMsg);
    console.log(`🎉 Track ID ${currentTrackId} fully mapped, synchronized and saved! (${pts.length} pts)`);
}

function handleMotion(data) {
    touchUdpPacket();
    setPlayerIndex(data.m_header);
    const { state, carDataTracker, carPhysics } = gameState;
    const pIdx = state.playerIndex;
    let newCars = [];

    for (let i = 0; i < 22; i++) {
        if (data.m_carMotionData[i]) {
            const pName = state.participants[i] || '';
            const lowerName = String(pName).toLowerCase();
            const isSCByName = lowerName.includes('safety') || lowerName.includes('medical') || lowerName === 'sc' || lowerName.startsWith('sc ');
            const isSCByTracker = carDataTracker[i] ? Boolean(carDataTracker[i].isSafetyCar) : false;
            const isSC = isSCByName || isSCByTracker;

            newCars.push({
                x: data.m_carMotionData[i].m_worldPositionX,
                y: data.m_carMotionData[i].m_worldPositionY || 0,
                z: data.m_carMotionData[i].m_worldPositionZ,
                yaw: data.m_carMotionData[i].m_yaw,
                pitch: data.m_carMotionData[i].m_pitch || 0,
                roll: data.m_carMotionData[i].m_roll || 0,
                teamColor: isSC ? '#FFB000' : carDataTracker[i].teamColor,
                teamName: isSC ? 'Safety Car' : carDataTracker[i].teamName,
                isSafetyCar: isSC,
                lapDistance: carPhysics[i].lapDistance,
                speed: carPhysics[i].speed
            });
        }
    }
    state.allCars = newCars;

    const pMotion = data.m_carMotionData[pIdx];
    if (pMotion) {
        const rawLat = pMotion.m_gForceLateral !== undefined ? pMotion.m_gForceLateral : 0;
        const rawLong = pMotion.m_gForceLongitudinal !== undefined ? pMotion.m_gForceLongitudinal : 0;
        const rawVert = pMotion.m_gForceVertical !== undefined ? pMotion.m_gForceVertical : 0;

        state.motion.gLat = Math.abs(rawLat) > 20 ? rawLat / 1000 : rawLat;
        state.motion.gLong = Math.abs(rawLong) > 20 ? rawLong / 1000 : rawLong;
        state.motion.gVert = Math.abs(rawVert) > 20 ? rawVert / 1000 : rawVert;
        state.motion.pitch = pMotion.m_pitch || 0;
        state.motion.roll = pMotion.m_roll || 0;

        processServerGForce(state.motion.gLat, state.motion.gLong, state.motion.gVert);
        state.motion.maxGSeen = gForceData.maxGSeen;

        const lapDist = carPhysics[pIdx].lapDistance;
        const speed = carPhysics[pIdx].speed;

        if (speed > 10 && lapDist >= 0 && lapDist < 50) {
            if (!state.startLine || lapDist < state.startLine.lapDistance) {
                state.startLine = {
                    x: pMotion.m_worldPositionX,
                    z: pMotion.m_worldPositionZ,
                    yaw: pMotion.m_yaw || 0,
                    lapDistance: lapDist
                };
                if (gameState.isTrackMapped && gameState.currentTrackId !== -1) {
                    const filePath = path.join(trackMapsDir, `track_${gameState.currentTrackId}.json`);
                    safeSaveTrackMap(filePath, { trackPoints: state.trackPoints, startLine: state.startLine, sector1: state.sector1, sector2: state.sector2 });
                }
            }
        }

        if (!gameState.isTrackMapped && gameState.currentTrackId !== -1) {
            const currentSpeed = carPhysics[pIdx] ? carPhysics[pIdx].speed : 0;
            const pitStatus = carDataTracker[pIdx] ? carDataTracker[pIdx].pitStatus : 0;

            // Only record track coordinates when actively driving on track (not stationary in pit lane)
            if (currentSpeed > 15 && pitStatus === 0) {
                const x = pMotion.m_worldPositionX;
                const z = pMotion.m_worldPositionZ;
                const pts = state.trackPoints;
                const lastPt = pts.length > 0 ? pts[pts.length - 1] : null;
                const distFromLast = lastPt ? Math.hypot(lastPt.x - x, lastPt.z - z) : 999;

                if (distFromLast >= 10 && distFromLast < 400) {
                    pts.push({ x, z });
                    if (pts.length > 3000) pts.shift();

                    // Stream recording progress to clients every 5 points (~0.5s)
                    if (pts.length % 5 === 0) {
                        const progressMsg = JSON.stringify({
                            type: 'trackRecordingProgress',
                            trackId: gameState.currentTrackId,
                            pointsCount: pts.length,
                            trackPoints: pts
                        });
                        wsServer.broadcast(progressMsg);
                    }

                    // Check if car returned to start after a substantial lap
                    if (pts.length >= 70) {
                        const firstPt = pts[0];
                        if (Math.hypot(firstPt.x - x, firstPt.z - z) < 55) {
                            completeLiveTrackMapping();
                        }
                    }
                }
            }
        }
    }
}

function handleMotionEx(data) {
    touchUdpPacket();
    if (data.m_suspensionPosition) {
        gameState.state.motion.susp.rl = data.m_suspensionPosition[0] || 0;
        gameState.state.motion.susp.rr = data.m_suspensionPosition[1] || 0;
        gameState.state.motion.susp.fl = data.m_suspensionPosition[2] || 0;
        gameState.state.motion.susp.fr = data.m_suspensionPosition[3] || 0;
    }
}

module.exports = {
    handleMotion,
    handleMotionEx,
    completeLiveTrackMapping
};
