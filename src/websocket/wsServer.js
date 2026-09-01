const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { trackMapsDir, setupsDir, LEGACY_WS_PORT } = require('../config');
const { OFFICIAL_TRACK_SECTOR_DISTANCES } = require('../config/catalogs');
const gameState = require('../state/gameState');
const { safeSaveTrackMap } = require('../utils/fileSystem');
const { getTelemetryDrsZonesForTrack, isTrackFinalized, syncTrackLinesForTrack } = require('../services/trackService');
const { generateSessionExportJson } = require('../services/storageService');
const { resetSessionData } = require('../state/stateHelpers');

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

    // Send full 3D track map immediately on connection so the dashboard renders right away
    if (state.trackPoints && state.trackPoints.length >= 20) {
        try {
            ws.send(JSON.stringify({
                type: 'trackDataResponse',
                trackId: gameState.currentTrackId,
                data: {
                    trackPoints: state.trackPoints,
                    pitLanePoints: state.pitLanePoints || [],
                    startLine: state.startLine,
                    sector1: state.sector1,
                    sector2: state.sector2,
                    drsZones: (Array.isArray(state.drsZones) && state.drsZones.length > 0) ? state.drsZones : getTelemetryDrsZonesForTrack(gameState.currentTrackId, state.session.trackLength || OFFICIAL_TRACK_SECTOR_DISTANCES[gameState.currentTrackId]?.len || 0, null, state.drsZones),
                    finalized: isTrackFinalized(gameState.currentTrackId)
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
                                        if (!Array.isArray(tData.drsZones) || tData.drsZones.length === 0) {
                                            tData.drsZones = getTelemetryDrsZonesForTrack(trackId, tData.trackLength || OFFICIAL_TRACK_SECTOR_DISTANCES[trackId]?.len || gameState.state.session.trackLength || 0, null, tData.drsZones);
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
                        ws.send(JSON.stringify({
                            type: 'trackDataResponse',
                            trackId: gameState.currentTrackId,
                            data: {
                                trackPoints: gameState.state.trackPoints,
                                pitLanePoints: gameState.state.pitLanePoints || [],
                                startLine: gameState.state.startLine,
                                sector1: gameState.state.sector1,
                                sector2: gameState.state.sector2,
                                drsZones: (Array.isArray(gameState.state.drsZones) && gameState.state.drsZones.length > 0) ? gameState.state.drsZones : getTelemetryDrsZonesForTrack(gameState.currentTrackId, gameState.state.session.trackLength || OFFICIAL_TRACK_SECTOR_DISTANCES[gameState.currentTrackId]?.len || 0, null, gameState.state.drsZones),
                                finalized: isTrackFinalized(gameState.currentTrackId)
                            }
                        }));
                        return;
                    }

                    // Track file does not exist: return empty track for this specific trackId
                    ws.send(JSON.stringify({
                        type: 'trackDataResponse',
                        trackId: trackId,
                        data: { trackPoints: [], pitLanePoints: [], startLine: null, sector1: null, sector2: null, drsZones: [], finalized: false }
                    }));
                    return;
                }

                // No track requested and no track active
                ws.send(JSON.stringify({
                    type: 'trackDataResponse',
                    trackId: -1,
                    data: { trackPoints: [], pitLanePoints: [], startLine: null, sector1: null, sector2: null, drsZones: [], finalized: false }
                }));
                return;
            }

            if (data.action === 'exportSession' || data.action === 'getSessionExport' || data.action === 'downloadSession') {
                ws.send(JSON.stringify({ type: 'sessionExportResponse', data: generateSessionExportJson() }));
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

            if (data.action === 'clearSession' || data.action === 'resetSession') {
                resetSessionData(broadcast);
                return;
            }

            if (data.action === 'syncTrackLines') {
                const tId = data.trackId !== undefined ? data.trackId : gameState.currentTrackId;
                syncTrackLinesForTrack(tId, data.force === true, broadcast);
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
