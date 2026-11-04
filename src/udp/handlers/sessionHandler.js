const fs = require('fs');
const path = require('path');
const { trackMapsDir } = require('../../config');
const { weatherMap, scMap, trackMap } = require('../../config/constants');
const gameState = require('../../state/gameState');
const { touchUdpPacket, setPlayerIndex, getAccurateSessionName, isRaceOrSprintSession, resetSessionData } = require('../../state/stateHelpers');
const { loadTrackDeltaReference, buildApproxPitLane, isTrackFinalized } = require('../../services/trackService');
const { loadActiveSessionSnapshot, saveActiveSessionSnapshot } = require('../../services/storageService');
const wsServer = require('../../websocket/wsServer');

function handleSession(data) {
    touchUdpPacket();
    const { state } = gameState;
    const uid = data.m_header ? data.m_header.m_sessionUID : data.m_sessionUID;
    const newSessionUID = typeof uid === 'bigint' ? uid.toString() : String(uid || '');
    const sessionTime = (data.m_header && data.m_header.m_sessionTime !== undefined) ? data.m_header.m_sessionTime : (data.m_sessionTime || 0);
    const sessionTypeRaw = data.m_sessionType;
    const tId = data.m_trackId;
    const sessionLinkIdentifier = data.m_sessionLinkIdentifier !== undefined ? data.m_sessionLinkIdentifier : null;
    const weekendLinkIdentifier = data.m_weekendLinkIdentifier !== undefined ? data.m_weekendLinkIdentifier : null;

    state.weatherForecast = data.m_weatherForecastSamples ? data.m_weatherForecastSamples.slice(0, data.m_numWeatherForecastSamples) : [];
    if (data.m_sector2LapDistanceStart) {
        state.session.sector2Distance = data.m_sector2LapDistanceStart;
        state.session.sector3Distance = data.m_sector3LapDistanceStart;
    }

    // Mid-Session Save / Resume Detection:
    // F1 persists m_sessionLinkIdentifier across saves even when m_sessionUID changes upon reload
    const isSameSessionLink = Boolean(sessionLinkIdentifier && gameState.currentSessionLinkIdentifier && gameState.currentSessionLinkIdentifier === sessionLinkIdentifier);

    // If server cold-started during a mid-session save, attempt to restore snapshot
    if (!gameState.currentSessionLinkIdentifier && sessionLinkIdentifier && sessionLinkIdentifier !== 0) {
        loadActiveSessionSnapshot(sessionLinkIdentifier, tId, sessionTypeRaw);
    }

    const isSessionTypeChanged = gameState.currentSessionType !== null && gameState.currentSessionType !== sessionTypeRaw;
    const isTrackChanged = gameState.currentTrackId !== -1 && tId !== undefined && tId !== -1 && gameState.currentTrackId !== tId;
    const isSessionRestarted = !isSameSessionLink && gameState.currentSessionUID === newSessionUID && gameState.lastSessionTime > 10 && sessionTime < gameState.lastSessionTime - 5 && sessionTime < 15;
    
    // A session is truly new ONLY if it's not a mid-session resume and track/type/UID changed
    let isNewSession = false;
    if (isSameSessionLink) {
        // Same persistent session resumed from save: DO NOT reset!
        isNewSession = false;
    } else if (sessionLinkIdentifier && gameState.currentSessionLinkIdentifier && gameState.currentSessionLinkIdentifier !== sessionLinkIdentifier) {
        isNewSession = true;
    } else if (gameState.currentSessionUID !== null && gameState.currentSessionUID !== newSessionUID && !isSameSessionLink) {
        // Fallback check when sessionLinkIdentifier is not present (e.g. older formats)
        // If sessionTime is high (> 30s) on first packet with new UID, it's likely a mid-session resume
        if (sessionTime > 30 && gameState.currentTrackId === tId && gameState.currentSessionType === sessionTypeRaw) {
            console.log('🏎️ [Session Resume Detected via Timing] Preserving session telemetry & lap histories!');
            isNewSession = false;
        } else {
            isNewSession = true;
        }
    }

    gameState.currentSessionUID = newSessionUID;
    gameState.currentSessionType = sessionTypeRaw;
    gameState.currentSessionLinkIdentifier = sessionLinkIdentifier;
    gameState.currentWeekendLinkIdentifier = weekendLinkIdentifier;
    gameState.lastSessionTime = sessionTime;

    if (isNewSession || isSessionRestarted || isSessionTypeChanged || isTrackChanged) {
        resetSessionData(wsServer.broadcast);
    }

    setPlayerIndex(data.m_header);

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
                        let parsedFinalized = false;
                        let parsedGameYear = gameState.currentGameYear || 26;
                        if (Array.isArray(parsedData)) {
                            state.trackPoints = parsedData;
                            state.startLine = null;
                            state.sector1 = null;
                            state.sector2 = null;
                            state.drsZones = [];
                            state.straightModeZones = [];
                            gameState.isTrackMapped = true;
                        } else {
                            state.trackPoints = parsedData.trackPoints || [];
                            state.startLine = parsedData.startLine || null;
                            state.sector1 = (parsedData.sector1 && typeof parsedData.sector1 === 'object') ? parsedData.sector1 : ((parsedData.sector1Line && typeof parsedData.sector1Line === 'object') ? parsedData.sector1Line : null);
                            state.sector2 = (parsedData.sector2 && typeof parsedData.sector2 === 'object') ? parsedData.sector2 : ((parsedData.sector2Line && typeof parsedData.sector2Line === 'object') ? parsedData.sector2Line : null);
                            state.drsZones = Array.isArray(parsedData.drsZones) ? parsedData.drsZones : [];
                            state.straightModeZones = Array.isArray(parsedData.straightModeZones) ? parsedData.straightModeZones : [];
                            if (parsedData.finalized !== undefined) {
                                parsedFinalized = !!parsedData.finalized;
                                gameState.finalizedTracks[tId] = parsedFinalized;
                            } else {
                                parsedFinalized = isTrackFinalized(tId);
                            }
                            if (parsedData.gameYear) {
                                parsedGameYear = parsedData.gameYear;
                            } else if (state.drsZones.length > 0 && state.straightModeZones.length === 0) {
                                parsedGameYear = 25;
                            }
                            if (state.trackPoints.length > 0) gameState.isTrackMapped = true;
                        }
                        state.gameYear = parsedGameYear;
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
                                sector2: state.sector2,
                                drsZones: state.drsZones || [],
                                straightModeZones: state.straightModeZones || [],
                                gameYear: parsedGameYear,
                                finalized: parsedFinalized
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
                state.drsZones = [];
                state.straightModeZones = [];
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
                        sector2: null,
                        drsZones: [],
                        straightModeZones: [],
                        gameYear: gameState.currentGameYear || 26
                    }
                });
                wsServer.broadcast(clearMsg);
            }

            if (gameState.currentTrackId !== -1) loadTrackDeltaReference(gameState.currentTrackId);
        }
    }

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
    state.session.sessionTypeRaw = sessionTypeRaw;

    const isRaceOrSprint = isRaceOrSprintSession(sessionTypeRaw, state.session.type, gameState.currentGameYear, formulaRaw);
    state.session.isRaceOrSprint = isRaceOrSprint;
    state.session.sessionCategory = isRaceOrSprint ? 'Race' : 'TimeAttack';

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
