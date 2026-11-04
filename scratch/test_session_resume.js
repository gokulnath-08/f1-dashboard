const assert = require('assert');
const path = require('path');
const fs = require('fs');

const gameState = require('../src/state/gameState');
const { handleSession } = require('../src/udp/handlers/sessionHandler');
const { handleSessionHistory, handleLapData } = require('../src/udp/handlers/lapDataHandler');
const { handleCarStatus } = require('../src/udp/handlers/carStatusHandler');
const { saveActiveSessionSnapshot, loadActiveSessionSnapshot } = require('../src/services/storageService');
const { resetSessionData } = require('../src/state/stateHelpers');

console.log('🧪 Starting Mid-Session Save & Resume Verification Tests...');

// 1. Setup initial active session
resetSessionData();
gameState.currentTrackId = 0; // Melbourne
gameState.currentSessionType = 10; // Race

const sessionLinkID = 88776655;
const originalSessionUID = '1122334455667788';

// Send initial session packet
handleSession({
    m_header: {
        m_sessionUID: originalSessionUID,
        m_sessionTime: 600.0,
        m_playerCarIndex: 0,
        m_gameYear: 25
    },
    m_sessionType: 10,
    m_trackId: 0,
    m_sessionLinkIdentifier: sessionLinkID,
    m_totalLaps: 50,
    m_trackLength: 5278
});

assert.strictEqual(gameState.currentSessionLinkIdentifier, sessionLinkID, 'Session link ID should be set');
assert.strictEqual(gameState.currentSessionUID, originalSessionUID, 'Session UID should be set');

// Simulate 5 completed laps for player (Car 0) and Car 1 in session history directly from game
const mockHistoryCar0 = [
    { m_lapTimeInMS: 85000, m_sector1TimeMSPart: 28000, m_sector1TimeMinutesPart: 0, m_sector2TimeMSPart: 29000, m_sector2TimeMinutesPart: 0, m_sector3TimeMSPart: 28000, m_sector3TimeMinutesPart: 0, m_lapValidBitFlags: 0x0F },
    { m_lapTimeInMS: 84200, m_sector1TimeMSPart: 27800, m_sector1TimeMinutesPart: 0, m_sector2TimeMSPart: 28900, m_sector2TimeMinutesPart: 0, m_sector3TimeMSPart: 27500, m_sector3TimeMinutesPart: 0, m_lapValidBitFlags: 0x0F },
    { m_lapTimeInMS: 83500, m_sector1TimeMSPart: 27500, m_sector1TimeMinutesPart: 0, m_sector2TimeMSPart: 28700, m_sector2TimeMinutesPart: 0, m_sector3TimeMSPart: 27300, m_sector3TimeMinutesPart: 0, m_lapValidBitFlags: 0x0F }, // Best lap!
    { m_lapTimeInMS: 84000, m_sector1TimeMSPart: 27700, m_sector1TimeMinutesPart: 0, m_sector2TimeMSPart: 28800, m_sector2TimeMinutesPart: 0, m_sector3TimeMSPart: 27500, m_sector3TimeMinutesPart: 0, m_lapValidBitFlags: 0x0F },
    { m_lapTimeInMS: 0, m_sector1TimeMSPart: 0, m_sector1TimeMinutesPart: 0, m_sector2TimeMSPart: 0, m_sector2TimeMinutesPart: 0, m_sector3TimeMSPart: 0, m_sector3TimeMinutesPart: 0, m_lapValidBitFlags: 0x0F } // Lap 5 in progress
];

handleSessionHistory({
    m_header: { m_sessionUID: originalSessionUID, m_sessionTime: 650.0 },
    m_carIdx: 0,
    m_numLaps: 5,
    m_numTyreStints: 1,
    m_bestLapTimeLapNum: 3,
    m_bestSector1LapNum: 3,
    m_bestSector2LapNum: 3,
    m_bestSector3LapNum: 3,
    m_lapHistoryData: mockHistoryCar0,
    m_tyreStintsHistoryData: [
        { m_endLap: 255, m_tyreActualCompound: 18, m_tyreVisualCompound: 18 } // Hard tyre
    ]
});

// Verify direct ingestion
assert.strictEqual(gameState.carDataTracker[0].bestLapMs, 83500, 'Best lap should be 83500ms directly from game');
assert.strictEqual(gameState.carDataTracker[0].bestLapNum, 3, 'Best lap num should be 3 directly from game');
assert.strictEqual(gameState.carDataTracker[0].bestS1, 27500, 'Best S1 should be 27500ms directly from game');
assert.strictEqual(gameState.state.session.sessionFastestLapMs, 83500, 'Session fastest lap should be 83500ms');

// Ingest car status (tyre age for all cars)
handleCarStatus({
    m_header: { m_sessionUID: originalSessionUID, m_playerCarIndex: 0 },
    m_carStatusData: [
        { m_visualTyreCompound: 18, m_actualTyreCompound: 18, m_tyresAgeLaps: 4, m_vehicleFiaFlags: 0, m_drsAllowed: 1 },
        { m_visualTyreCompound: 16, m_actualTyreCompound: 16, m_tyresAgeLaps: 4, m_vehicleFiaFlags: 0, m_drsAllowed: 1 }
    ]
});

assert.strictEqual(gameState.carDataTracker[0].tyreAge, 4, 'Car 0 tyre age should be 4');
assert.strictEqual(gameState.carDataTracker[1].tyreAge, 4, 'Car 1 tyre age should be 4');

// Ingest lap data (pit stops)
handleLapData({
    m_header: { m_sessionUID: originalSessionUID, m_playerCarIndex: 0 },
    m_lapData: [
        { m_currentLapNum: 5, m_carPosition: 1, m_pitStatus: 0, m_numPitStops: 1, m_resultStatus: 2, m_lapDistance: 1200 },
        { m_currentLapNum: 5, m_carPosition: 2, m_pitStatus: 0, m_numPitStops: 0, m_resultStatus: 2, m_lapDistance: 1100 }
    ]
});

assert.strictEqual(gameState.carDataTracker[0].numPitStops, 1, 'Car 0 pit stops should be 1');
assert.strictEqual(gameState.carDataTracker[1].numPitStops, 0, 'Car 1 pit stops should be 0');

// Save persistent snapshot
saveActiveSessionSnapshot(true);
console.log('✅ Initial session populated & saved.');

// 2. SIMULATE MID-SESSION SAVE RESUME
// The game is reloaded: m_sessionUID changes to a brand new random 64-bit UID,
// but m_sessionLinkIdentifier remains 88776655!
const newResumedUID = '9988776655443322';

handleSession({
    m_header: {
        m_sessionUID: newResumedUID,
        m_sessionTime: 652.0,
        m_playerCarIndex: 0,
        m_gameYear: 25
    },
    m_sessionType: 10,
    m_trackId: 0,
    m_sessionLinkIdentifier: sessionLinkID, // Persistent link ID
    m_totalLaps: 50,
    m_trackLength: 5278
});

// VERIFY: Session data was NOT wiped!
assert.strictEqual(gameState.currentSessionUID, newResumedUID, 'Session UID should update to resumed UID');
assert.strictEqual(gameState.currentSessionLinkIdentifier, sessionLinkID, 'Session link ID should persist');
assert.strictEqual(gameState.carDataTracker[0].bestLapMs, 83500, 'Best lap must be preserved across resume');
assert.strictEqual(gameState.allLapHistories[0].length, 5, 'Lap histories must be preserved across resume');
assert.strictEqual(gameState.allTyreStints[0].length, 1, 'Tyre stints must be preserved across resume');
assert.strictEqual(gameState.state.session.sessionFastestLapMs, 83500, 'Session fastest lap must be preserved');
console.log('✅ Mid-session resume without data wipe verified.');

// 3. SIMULATE SERVER RESTART COLD-BOOT DURING MID-SESSION SAVE
// Reset in-memory state completely as if server just started
resetSessionData();
gameState.currentSessionUID = null;
gameState.currentSessionLinkIdentifier = null;
gameState.currentTrackId = -1;

assert.strictEqual(gameState.carDataTracker[0].bestLapMs, 0, 'Memory is cold/empty');
assert.strictEqual(Object.keys(gameState.allLapHistories).length, 0, 'Lap history is cold/empty');

// First packet from game arrives for resumed race
handleSession({
    m_header: {
        m_sessionUID: newResumedUID,
        m_sessionTime: 655.0,
        m_playerCarIndex: 0,
        m_gameYear: 25
    },
    m_sessionType: 10,
    m_trackId: 0,
    m_sessionLinkIdentifier: sessionLinkID,
    m_totalLaps: 50,
    m_trackLength: 5278
});

// VERIFY: Cold start automatically restored from persistent snapshot!
assert.strictEqual(gameState.carDataTracker[0].bestLapMs, 83500, 'Cold-boot restored best lap');
assert.strictEqual(gameState.allLapHistories[0].length, 5, 'Cold-boot restored lap history');
assert.strictEqual(gameState.allTyreStints[0].length, 1, 'Cold-boot restored tyre stints');
assert.strictEqual(gameState.state.session.sessionFastestLapMs, 83500, 'Cold-boot restored session fastest lap');
console.log('✅ Cold-boot session restore from snapshot verified.');

console.log('🎉 ALL MID-SESSION SAVE & RESUME TESTS PASSED SUCCESSFULLY!');
