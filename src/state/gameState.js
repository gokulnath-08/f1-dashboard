const fs = require('fs');
const { fastestJsonPath } = require('../config');
const { gForceData } = require('../services/gforceService');

let allTimeFastest = {};
if (fs.existsSync(fastestJsonPath)) {
    try {
        allTimeFastest = JSON.parse(fs.readFileSync(fastestJsonPath, 'utf8'));
    } catch (e) {
        console.error('⚠️ Error reading fastest.json:', e);
    }
}

// Cache for finalized tracks (tracks where auto-sync has been locked/stopped)
const finalizedTracks = {};

let currentSessionUID = null;
let currentSessionType = null;
let lastSessionTime = 0;
let currentTrackId = -1;
let isTrackMapped = false;
let currentGameYear = 26; // Default to 26 if not set
let lastUdpPacketTime = 0;
let lastPrintedSessionTeamUID = null;

let trackPointsDirty = true;
let lapHistoryDirty = true;
let broadcastTick = 0;

let carDataTracker = Array.from({ length: 22 }, () => ({
    pos: 0, lapNum: 0, pitStatus: 0, driverStatus: 0, bestLapMs: 0, gapText: '', maxSpeed: 0, tyre: 'UNK', tyreClass: '#FFFFFF', teamColor: '#FFFFFF', teamName: 'Unknown',
    s1: 0, s2: 0, s3: 0, bestS1: 0, bestS2: 0, bestS3: 0,
    penalties: 0, warnings: 0, cornerCutting: 0, unservedDT: 0, unservedSG: 0, invalidLap: false
}));

let carPhysics = Array.from({ length: 22 }, () => ({
    speed: 0, lapDistance: 0, lapNum: 0, officialDelta: 0, officialLeaderDelta: 0, lastValidDelta: 0, lastValidLeaderDelta: 0, sector: 0
}));

let allLapHistories = {};
let allTyreStints = {};
let currentLapTelemetry = Array.from({ length: 22 }, () => []);
let lastLapTelemetry = Array.from({ length: 22 }, () => []);
let fastestLapGhostData = [];

let state = {
    type: 'telemetry',
    playerIndex: 0,
    allCars: Array.from({ length: 22 }, () => ({ x: 0, z: 0, yaw: 0, teamColor: '#FFFFFF', teamName: 'Unknown', lapDistance: 0, speed: 0 })),
    trackPoints: [],
    pitLanePoints: [],
    participants: [],
    leaderboard: [],
    startLine: null,
    sector1Line: null,
    sector2Line: null,
    sector1: null,
    sector2: null,
    customSectorLines: [0],
    session: {
        trackName: 'Unknown', trackLength: 0, raceDistance: 0, lapsLeft: 0, type: 'Unknown', weather: '--',
        trackTemp: 0, airTemp: 0, sc: 'Clear', lapsTotal: 0, pitLimit: 80, fastestLapCarIndex: -1,
        sessionFastestLapMs: Infinity, sessionFastestDriver: 'None', sessionBestS1: 0, sessionBestS2: 0, sessionBestS3: 0,
        referenceS1: 0, referenceS2: 0, referenceS3: 0, allTimeBestS1: 0, allTimeBestS2: 0, allTimeBestS3: 0,
        trackId: -1, timeRemaining: 0, timeTotal: 0, safetyCarStatus: 'NONE', sessionType: 'NONE', sessionCategory: 'Race', allTimeFastestLapMs: Infinity, allTimeFastestDriver: 'Unknown', sector2Distance: 0, sector3Distance: 0,
        gamePaused: false
    },
    weatherForecast: [],
    damage: null,
    penalties: { timePenalties: 0, warnings: 0, cornerCuts: 0, driveThrough: 0, stopGo: 0, invalidLap: 0 },
    lap: {
        currentMs: 0, lastMs: 0, bestMs: 0, s1: 0, s2: 0, s3: 0, liveS1: 0, liveS2: 0, liveS3: 0,
        bestS1: 0, bestS2: 0, bestS3: 0, s1Status: 'pending', s2Status: 'pending', s3Status: 'pending',
        s1State: 'pending', s2State: 'pending', s3State: 'pending', pos: 0, lapNum: 0, gapFront: '+0.000',
        driverAhead: 'LEADER', driverAheadCarIndex: -1, driverAheadTyre: '', driverAheadTeamColor: '#FFD700',
        driverBehind: 'NONE', driverBehindCarIndex: -1, gapBehind: '--', driverBehindTyre: '', driverBehindTeamColor: '#888888',
        drsThreat: false, gapBehindSec: null, deltaToSessionFastest: null, lastLapDeltaToSessionFastest: null, isSessionFastest: false,
        pitStatus: 'ON TRACK', currentSector: 0, pendingS1: false, pendingS2: false, liveDeltaToRecord: 0, deltaToLeader: 0, ghostLapTimeMs: 0,
        penalties: 0, warnings: 0, cornerCutting: 0, unservedDT: 0, unservedSG: 0, scDelta: 0, invalid: false
    },
    motion: {
        pitch: 0, roll: 0, gLat: 0, gLong: 0, gVert: 0,
        susp: { fl: 0, fr: 0, rl: 0, rr: 0 },
        gEnvelopeArray: gForceData.envelopeArray,
        gHistory: gForceData.history,
        maxGSeen: gForceData.maxGSeen
    },
    inputs: { speed: 0, gear: 'N', rpm: 0, throttle: 0, brake: 0, clutch: 0, steer: 0, drs: 'CLOSED', drsAvailable: false, drsActivationDistance: null },
    ers: {
        mode: 'Medium',
        battery: 100,
        storeJoules: 4000000,
        deployModeInt: 1,
        deployedLapJoules: 0,
        deployedLapPct: 0,
        harvestedMGUKJoules: 0,
        harvestedMGUHJoules: 0,
        harvestedTotalJoules: 0,
        icePower: 0,
        mgukPower: 0,
        ersRecommendation: 'BALANCED'
    },
    fuel: {
        tankKg: 0,
        capacityKg: 110,
        pct: 0,
        remainingLapsDelta: 0,
        mix: 'Standard',
        mixInt: 1,
        targetBurnPerLap: 0,
        lapsLeft: 0,
        status: 'OPTIMAL'
    },
    setup: {
        wingF: 0, wingR: 0,
        diffOn: 50, diffOff: 50, engineBraking: 100,
        camberF: 0, camberR: 0, toeF: 0, toeR: 0,
        suspF: 0, suspR: 0, arbF: 0, arbR: 0, heightF: 0, heightR: 0,
        bPressure: 100, bBias: 50,
        pressFLeft: 0, pressFRight: 0, pressRLeft: 0, pressRRight: 0,
        ballast: 0, fuel: 0, fuelLaps: 0
    },
    car: {
        tyreAge: 0, flag: 'GREEN', compound: 'Unknown', engineTemp: 0,
        wear: { fl: 0, fr: 0, rl: 0, rr: 0 },
        surfTemp: { fl: 0, fr: 0, rl: 0, rr: 0 },
        inTemp: { fl: 0, fr: 0, rl: 0, rr: 0 },
        press: { fl: 0, fr: 0, rl: 0, rr: 0 },
        brakeTemp: { fl: 0, fr: 0, rl: 0, rr: 0 }
    }
};

module.exports = {
    state,
    allTimeFastest,
    finalizedTracks,
    carDataTracker,
    carPhysics,
    allLapHistories,
    allTyreStints,
    currentLapTelemetry,
    lastLapTelemetry,
    fastestLapGhostData,
    get currentSessionUID() { return currentSessionUID; },
    set currentSessionUID(v) { currentSessionUID = v; },
    get currentSessionType() { return currentSessionType; },
    set currentSessionType(v) { currentSessionType = v; },
    get lastSessionTime() { return lastSessionTime; },
    set lastSessionTime(v) { lastSessionTime = v; },
    get currentTrackId() { return currentTrackId; },
    set currentTrackId(v) { currentTrackId = v; },
    get isTrackMapped() { return isTrackMapped; },
    set isTrackMapped(v) { isTrackMapped = v; },
    get currentGameYear() { return currentGameYear; },
    set currentGameYear(v) { currentGameYear = v; },
    get lastUdpPacketTime() { return lastUdpPacketTime; },
    set lastUdpPacketTime(v) { lastUdpPacketTime = v; },
    get lastPrintedSessionTeamUID() { return lastPrintedSessionTeamUID; },
    set lastPrintedSessionTeamUID(v) { lastPrintedSessionTeamUID = v; },
    get trackPointsDirty() { return trackPointsDirty; },
    set trackPointsDirty(v) { trackPointsDirty = v; },
    get lapHistoryDirty() { return lapHistoryDirty; },
    set lapHistoryDirty(v) { lapHistoryDirty = v; },
    get broadcastTick() { return broadcastTick; },
    set broadcastTick(v) { broadcastTick = v; }
};
