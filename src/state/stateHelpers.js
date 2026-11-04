const fs = require('fs');
const path = require('path');
const { sessionTelemetryDir } = require('../config');
const gameState = require('./gameState');
const { teamMap, sessionMap, formulaMap } = require('../config/constants');
const { resetGForceData, gForceData } = require('../services/gforceService');

function touchUdpPacket() {
    gameState.lastUdpPacketTime = Date.now();
}

const warnedUnknownTeamIds = new Set();

function getParticipantTeamId(participant) {
    if (!participant) return undefined;
    const tid = participant.m_teamId !== undefined ? participant.m_teamId : participant.teamId;
    if (tid !== undefined && !teamMap[tid]) {
        if (!warnedUnknownTeamIds.has(tid)) {
            warnedUnknownTeamIds.add(tid);
            console.log(`UNKNOWN TEAM ID DETECTED: ${tid} for driver ${participant.m_name || 'unknown'}`);
        }
    }
    return tid;
}

function setPlayerIndex(header) {
    if (header) {
        if (header.m_playerCarIndex !== undefined) {
            gameState.state.playerIndex = header.m_playerCarIndex;
        }
        if (header.m_gameYear !== undefined) {
            gameState.currentGameYear = header.m_gameYear;
        }
    }
}

function getAccurateSessionName(sessionType, formula) {
    const baseSession = sessionMap[sessionType] || `ID: ${sessionType}`;
    if (formula === 2) {
        if (sessionType === 10) return 'F2 Feature Race';
        if (sessionType === 11) return 'F2 Sprint Race';
        return `F2 ${baseSession}`;
    }
    if (formula !== 0 && formulaMap[formula]) {
        return `${formulaMap[formula]} ${baseSession}`;
    }
    return baseSession;
}

/**
 * Accurately determines whether a session is a Race or Sprint (race).
 * Non-race sessions (Practice 1-3, Qualifying 1-3, Sprint Shootout 1-3, Time Trial)
 * return false so the system uses best lap time classification.
 */
function isRaceOrSprintSession(sessionType, sessionName, gameYear, formula) {
    if (formula === 2) {
        if (sessionType === 10 || sessionType === 11 || sessionType === 15 || sessionType === 16) {
            return true;
        }
    }

    if (sessionName && typeof sessionName === 'string') {
        const sLower = sessionName.toLowerCase();
        // Any session that is Shootout, Qualifying, Practice, or Time Trial is NEVER a race or sprint
        if (sLower.includes('shootout') || sLower.includes('qualifying') || sLower.includes('practice') || sLower.includes('time trial')) {
            return false;
        }
        if (sLower.includes('race')) {
            return true;
        }
        if (sLower.includes('sprint') && !sLower.includes('shootout') && !sLower.includes('qualifying')) {
            return true;
        }
    }

    const raw = Number(sessionType);
    const gy = Number(gameYear) || 25;
    if (gy <= 23) {
        // F1 2023 format: 10 = Race, 11 = Race 2 (Sprint), 12 = Race 3
        return [10, 11, 12].includes(raw);
    } else {
        // F1 2024 / 2025 / 2026 format: 15 = Race, 16 = Race 2 (Sprint), 17 = Race 3
        return [15, 16, 17].includes(raw);
    }
}

/**
 * Robust helper function to extract sector times from the F1 UDP packet.
 * Due to version differences and inconsistencies in the parser library, 
 * this checks multiple possible key names.
 * 
 * @param {Object} obj - The lap data object from the packet
 * @param {number} sectorNum - The sector number (1, 2, or 3)
 * @returns {number} The sector time in milliseconds
 */
function getSectorTime(obj, sectorNum) {
    if (!obj) return 0;

    const msKey1 = `m_sector${sectorNum}TimeMSPart`;
    const msKey2 = `sector${sectorNum}TimeMSPart`;
    const msKey3 = `m_sector${sectorNum}TimeMsPart`;
    const msKey4 = `sector${sectorNum}TimeMsPart`;
    const msKey5 = `m_sector${sectorNum}TimeInMS`;
    const msKey6 = `sector${sectorNum}TimeInMS`;

    const minKey1 = `m_sector${sectorNum}TimeMinutesPart`;
    const minKey2 = `sector${sectorNum}TimeMinutesPart`;
    const minKey3 = `m_sector${sectorNum}TimeMinutes`;
    const minKey4 = `sector${sectorNum}TimeMinutes`;

    const fallbackKey1 = `m_sector${sectorNum}Time`;

    let ms = 0;
    if (obj[msKey1] !== undefined) ms = obj[msKey1];
    else if (obj[msKey2] !== undefined) ms = obj[msKey2];
    else if (obj[msKey3] !== undefined) ms = obj[msKey3];
    else if (obj[msKey4] !== undefined) ms = obj[msKey4];
    else if (obj[msKey5] !== undefined) ms = obj[msKey5];
    else if (obj[msKey6] !== undefined) ms = obj[msKey6];

    let mins = 0;
    if (obj[minKey1] !== undefined) mins = obj[minKey1];
    else if (obj[minKey2] !== undefined) mins = obj[minKey2];
    else if (obj[minKey3] !== undefined) mins = obj[minKey3];
    else if (obj[minKey4] !== undefined) mins = obj[minKey4];

    let totalMs = (mins * 60000) + ms;

    if (totalMs === 0) {
        const fallback = obj[fallbackKey1] || obj[`sector${sectorNum}Time`] || 0;
        if (fallback > 0) {
            return fallback < 1000 && fallback % 1 !== 0 ? Math.floor(fallback * 1000) : fallback;
        }
    }
    return totalMs;
}

/**
 * Calculates the current live timing for the active sector based on the total lap time
 * and the completed sector times. Returns an object with the timing state.
 */
function getLiveSectorTiming(currentMs, sector, s1, s2, s3) {
    const live = {
        s1: s1 || 0,
        s2: s2 || 0,
        s3: s3 || 0,
        liveS1: s1 || 0,
        liveS2: s2 || 0,
        liveS3: s3 || 0,
        s1State: 'pending',
        s2State: 'pending',
        s3State: 'pending'
    };

    if (sector === 0) {
        live.s1State = 'live';
        live.liveS1 = Math.max(0, currentMs);
    } else if (sector === 1) {
        live.s1State = 'complete';
        live.s2State = 'live';
        live.liveS2 = Math.max(0, currentMs - live.s1);
    } else if (sector === 2) {
        live.s1State = 'complete';
        live.s2State = 'complete';
        live.s3State = 'live';
        live.liveS3 = Math.max(0, currentMs - live.s1 - live.s2);
    }

    return live;
}

/**
 * Wipes all old session telemetry data, lap histories, leaderboards, and car tracking
 * when a new session is detected, session type changes, session is restarted, or track changes.
 */
function resetSessionData(broadcastFn) {
    const { state, carDataTracker, carPhysics, allLapHistories, allTyreStints, lapSetups, carLapSetups, currentLapTelemetry, lastLapTelemetry } = gameState;

    // Keep reference sectors if previously loaded
    const refS1 = state.session.referenceS1 || 0;
    const refS2 = state.session.referenceS2 || 0;
    const refS3 = state.session.referenceS3 || 0;

    for (let i = 0; i < 22; i++) {
        carDataTracker[i] = {
            pos: 0, lapNum: 0, pitStatus: 0, driverStatus: 0, bestLapMs: 0, bestLapNum: 0, gapText: '', maxSpeed: 0, tyre: 'UNK', tyreClass: '#FFFFFF', tyreAge: 0, numPitStops: 0, teamColor: '#FFFFFF', teamName: 'Unknown',
            s1: 0, s2: 0, s3: 0, bestS1: refS1, bestS2: refS2, bestS3: refS3,
            s1Status: 'pending', s2Status: 'pending', s3Status: 'pending',
            penalties: 0, warnings: 0, cornerCutting: 0, unservedDT: 0, unservedSG: 0, invalidLap: false
        };
        carPhysics[i] = { speed: 0, lapDistance: 0, lapNum: 0, officialDelta: 0, officialLeaderDelta: 0, lastValidDelta: 0, lastValidLeaderDelta: 0, sector: 0 };
        currentLapTelemetry[i] = [];
        lastLapTelemetry[i] = [];
        if (gameState.sessionDriverFastestLaps) gameState.sessionDriverFastestLaps[i] = null;
    }

    Object.keys(allLapHistories).forEach(k => delete allLapHistories[k]);
    Object.keys(allTyreStints).forEach(k => delete allTyreStints[k]);
    if (lapSetups) Object.keys(lapSetups).forEach(k => delete lapSetups[k]);
    if (carLapSetups) carLapSetups.forEach(m => Object.keys(m).forEach(k => delete m[k]));
    gameState.allSessionLaps = [];
    gameState.sessionLapsByDriver = Array.from({ length: 22 }, () => []);
    if (gameState.currentTrackId !== -1 && sessionTelemetryDir) {
        try {
            const diskPath = path.join(sessionTelemetryDir, `session_all_laps_track_${gameState.currentTrackId}.json`);
            if (fs.existsSync(diskPath)) {
                fs.unlinkSync(diskPath);
            }
        } catch (e) { }
    }

    resetGForceData();

    state.motion.maxGSeen = 0;
    state.leaderboard = [];
    state.participants = [];
    state.allCars = Array.from({ length: 22 }, () => ({ x: 0, z: 0, yaw: 0, teamColor: '#FFFFFF', teamName: 'Unknown', lapDistance: 0, speed: 0 }));
    state.pitLanePoints = [];
    state.customSectorLines = [0];
    state.weatherForecast = [];
    state.damage = null;
    state.drsZones = [];
    state.inputs.drs = 'CLOSED';
    state.inputs.drsAvailable = false;
    state.inputs.drsActivationDistance = null;
    state.penalties = { timePenalties: 0, warnings: 0, cornerCuts: 0, driveThrough: 0, stopGo: 0, invalidLap: 0 };
    state.lap = {
        currentMs: 0, lastMs: 0, bestMs: 0, s1: 0, s2: 0, s3: 0, liveS1: 0, liveS2: 0, liveS3: 0,
        bestS1: refS1, bestS2: refS2, bestS3: refS3, s1Status: 'pending', s2Status: 'pending', s3Status: 'pending',
        s1State: 'pending', s2State: 'pending', s3State: 'pending', pos: 0, lapNum: 0, gapFront: '+0.000',
        driverAhead: 'LEADER', driverAheadCarIndex: -1, driverAheadTyre: '', driverAheadTeamColor: '#FFD700',
        driverBehind: 'NONE', driverBehindCarIndex: -1, gapBehind: '--', driverBehindTyre: '', driverBehindTeamColor: '#888888',
        drsThreat: false, gapBehindSec: null, deltaToSessionFastest: null, lastLapDeltaToSessionFastest: null, isSessionFastest: false,
        pitStatus: 'ON TRACK', currentSector: 0, pendingS1: false, pendingS2: false, liveDeltaToRecord: 0, deltaToLeader: 0, ghostLapTimeMs: 0,
        penalties: 0, warnings: 0, cornerCutting: 0, unservedDT: 0, unservedSG: 0, scDelta: 0, invalid: false
    };

    state.session.fastestLapCarIndex = -1;
    state.session.sessionFastestLapMs = Infinity;
    state.session.sessionFastestDriver = 'None';
    state.session.sessionBestS1 = refS1;
    state.session.sessionBestS2 = refS2;
    state.session.sessionBestS3 = refS3;

    gameState.lapHistoryDirty = true;

    // Immediately push reset state to all WebSocket clients if broadcast function provided
    if (typeof broadcastFn === 'function') {
        broadcastFn(JSON.stringify(state));
        broadcastFn(JSON.stringify({ type: 'sessionDriverFastestLapsResponse', data: [] }));
    }
}

module.exports = {
    touchUdpPacket,
    getParticipantTeamId,
    setPlayerIndex,
    getAccurateSessionName,
    isRaceOrSprintSession,
    getSectorTime,
    getLiveSectorTiming,
    resetSessionData
};
