const fs = require('fs');
const path = require('path');
const { trackMapsDir } = require('../../config');
const { weatherMap, scMap, trackMap } = require('../../config/constants');
const gameState = require('../../state/gameState');
const { touchUdpPacket, setPlayerIndex, getAccurateSessionName, resetSessionData } = require('../../state/stateHelpers');
const { loadTrackDeltaReference, buildApproxPitLane } = require('../../services/trackService');
const wsServer = require('../../websocket/wsServer');

function handleSession(data) {
    touchUdpPacket();
    const { state } = gameState;
    const uid = data.m_header ? data.m_header.m_sessionUID : data.m_sessionUID;
    const newSessionUID = typeof uid === 'bigint' ? uid.toString() : String(uid || '');
    const sessionTime = (data.m_header && data.m_header.m_sessionTime !== undefined) ? data.m_header.m_sessionTime : (data.m_sessionTime || 0);
    const sessionTypeRaw = data.m_sessionType;
    const tId = data.m_trackId;

    state.weatherForecast = data.m_weatherForecastSamples ? data.m_weatherForecastSamples.slice(0, data.m_numWeatherForecastSamples) : [];
    if (data.m_sector2LapDistanceStart) {
        state.session.sector2Distance = data.m_sector2LapDistanceStart;
        state.session.sector3Distance = data.m_sector3LapDistanceStart;
    }

    const isNewSession = gameState.currentSessionUID !== null && gameState.currentSessionUID !== newSessionUID;
    const isSessionRestarted = gameState.currentSessionUID === newSessionUID && gameState.lastSessionTime > 10 && sessionTime < gameState.lastSessionTime - 5;
    const isSessionTypeChanged = gameState.currentSessionType !== null && gameState.currentSessionType !== sessionTypeRaw;
    const isTrackChanged = gameState.currentTrackId !== -1 && tId !== undefined && tId !== -1 && gameState.currentTrackId !== tId;

    gameState.currentSessionUID = newSessionUID;
    gameState.currentSessionType = sessionTypeRaw;
    gameState.lastSessionTime = sessionTime;

    if (isNewSession || isSessionRestarted || isSessionTypeChanged || isTrackChanged) {
        resetSessionData(wsServer.broadcast);
    }

    if (tId !== undefined && tId !== -1) {
        if (tId !== gameState.currentTrackId || !state.trackPoints || state.trackPoints.length < 20) {
            gameState.currentTrackId = tId;
            state.customSectorLines = [0];
            gameState.isTrackMapped = false;
            const filePath = path.join(trackMapsDir, `track_${tId}.json`);

            if (fs.existsSync(filePath)) {
                try {
                    const raw = fs.readFileSync(filePath, 'utf8').trim();
                    if (raw && raw.length > 2) {
                        const parsedData = JSON.parse(raw);
                        if (Array.isArray(parsedData)) {
                            state.trackPoints = parsedData;
                            state.startLine = null;
                            state.sector1 = null;
                            state.sector2 = null;
                            gameState.isTrackMapped = true;
                        } else {
                            state.trackPoints = parsedData.trackPoints || [];
                            state.startLine = parsedData.startLine || null;
                            state.sector1 = (parsedData.sector1 && typeof parsedData.sector1 === 'object') ? parsedData.sector1 : ((parsedData.sector1Line && typeof parsedData.sector1Line === 'object') ? parsedData.sector1Line : null);
                            state.sector2 = (parsedData.sector2 && typeof parsedData.sector2 === 'object') ? parsedData.sector2 : ((parsedData.sector2Line && typeof parsedData.sector2Line === 'object') ? parsedData.sector2Line : null);
                            if (state.trackPoints.length > 0) gameState.isTrackMapped = true;
                        }
                        state.pitLanePoints = buildApproxPitLane(state.trackPoints);
                        gameState.trackPointsDirty = true;
                        // Broadcast trackDataResponse to all clients so they immediately have the track map
                        const tMsg = JSON.stringify({
                            type: 'trackDataResponse',
                            trackId: gameState.currentTrackId,
                            data: {
                                trackPoints: state.trackPoints,
                                pitLanePoints: state.pitLanePoints || [],
                                startLine: state.startLine,
                                sector1: state.sector1,
                                sector2: state.sector2
                            }
                        });
                        wsServer.broadcast(tMsg);
                    }
                } catch (e) {
                    console.error('Error parsing track map JSON:', e);
                }
            } else {
                state.trackPoints = [];
                state.pitLanePoints = [];
                state.customSectorLines = [0];
                state.startLine = null;
                state.sector1 = null;
                state.sector2 = null;
                gameState.isTrackMapped = false;
                gameState.trackPointsDirty = true;

                // Broadcast empty track to all clients so they immediately clear old track
                const clearMsg = JSON.stringify({
                    type: 'trackDataResponse',
                    trackId: gameState.currentTrackId,
                    data: {
                        trackPoints: [],
                        pitLanePoints: [],
                        startLine: null,
                        sector1: null,
                        sector2: null
                    }
                });
                wsServer.broadcast(clearMsg);
            }

            if (gameState.currentTrackId !== -1) loadTrackDeltaReference(gameState.currentTrackId);
        }
    }

    setPlayerIndex(data.m_header);

    const trackTemp = data.m_trackTemperature !== undefined ? data.m_trackTemperature : (data.trackTemperature || 0);
    const airTemp = data.m_airTemperature !== undefined ? data.m_airTemperature : (data.airTemperature || 0);
    const lapsTotal = data.m_totalLaps;
    const formulaRaw = data.m_formula || 0;

    state.session.weather = weatherMap[data.m_weather] || 'Unknown';
    state.session.trackTemp = trackTemp;
    state.session.airTemp = airTemp;
    state.session.trackLength = data.m_trackLength !== undefined ? data.m_trackLength : (data.trackLength || 5000);
    state.session.lapsTotal = lapsTotal;

    state.session.type = getAccurateSessionName(sessionTypeRaw, formulaRaw);

    const timeAttackIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 17, 18, 19];
    state.session.sessionCategory = timeAttackIds.includes(sessionTypeRaw) ? 'TimeAttack' : 'Race';

    state.session.trackId = data.m_trackId !== undefined ? data.m_trackId : gameState.currentTrackId;
    state.session.trackName = trackMap[data.m_trackId] || `TRACK NOT FOUND`;
    state.session.pitLimit = data.m_pitSpeedLimit;
    state.session.sc = scMap[data.m_safetyCarStatus] || 'Clear';
    state.session.gamePaused = Boolean(data.m_gamePaused !== undefined ? data.m_gamePaused : data.gamePaused);
}

function handleEvent(data) {
    touchUdpPacket();
    const { state } = gameState;
    let eventCode = '';
    if (data.m_eventStringCode) {
        if (typeof data.m_eventStringCode === 'string') {
            eventCode = data.m_eventStringCode;
        } else if (Array.isArray(data.m_eventStringCode) || Buffer.isBuffer(data.m_eventStringCode)) {
            eventCode = Buffer.from(data.m_eventStringCode).toString('utf8').replace(/\0/g, '');
        }
    } else if (data.eventStringCode) {
        eventCode = String(data.eventStringCode);
    }

    if (eventCode === 'SSTA') {
        resetSessionData(wsServer.broadcast);
    } else if (eventCode === 'FTLP' && data.m_eventDetails) {
        const vIdx = data.m_eventDetails.vehicleIdx;
        const lTime = data.m_eventDetails.lapTime;
        const lapTimeMs = typeof lTime === 'number' ? Math.round(lTime * 1000) : 0;
        if (lapTimeMs > 0 && (state.session.sessionFastestLapMs === Infinity || lapTimeMs < state.session.sessionFastestLapMs)) {
            state.session.sessionFastestLapMs = lapTimeMs;
            state.session.fastestLapCarIndex = vIdx;
            state.session.sessionFastestDriver = (state.participants && state.participants[vIdx]) ? state.participants[vIdx] : `Car ${vIdx}`;
        }
    }
}

module.exports = {
    handleSession,
    handleEvent
};
