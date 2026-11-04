const assert = require('assert');
const gameState = require('../src/state/gameState');
const { resetSessionData } = require('../src/state/stateHelpers');
const { generateSessionExportJson, saveActiveSessionSnapshot, loadActiveSessionSnapshot, getFullCarSetupObject } = require('../src/services/storageService');
const { handleCarSetups } = require('../src/udp/handlers/carStatusHandler');
const { handleLapData, handleSessionHistory } = require('../src/udp/handlers/lapDataHandler');

console.log('🧪 Starting Car Setup Session Export Verification Tests...\n');

// 1. Reset state
resetSessionData();
gameState.currentTrackId = 0;
gameState.currentGameYear = 25;
gameState.currentSessionType = 'Qualifying';
gameState.state.session.trackName = 'Melbourne';
gameState.state.session.type = 'Qualifying';

// 2. Simulate incoming UDP setup packet
const mockSetupPacket = {
    m_header: { m_playerCarIndex: 0 },
    m_carSetups: [
        {
            m_frontWing: 28,
            m_rearWing: 24,
            m_onThrottle: 65,
            m_offThrottle: 45,
            m_engineBraking: 60,
            m_frontCamber: -3.20,
            m_rearCamber: -1.80,
            m_frontToe: 0.05,
            m_rearToe: 0.12,
            m_frontSuspension: 30,
            m_rearSuspension: 14,
            m_frontAntiRollBar: 7,
            m_rearAntiRollBar: 4,
            m_frontSuspensionHeight: 25,
            m_rearSuspensionHeight: 48,
            m_brakePressure: 100,
            m_brakeBias: 56,
            m_frontLeftTyrePressure: 23.5,
            m_frontRightTyrePressure: 23.5,
            m_rearLeftTyrePressure: 21.8,
            m_rearRightTyrePressure: 21.8,
            m_ballast: 5,
            m_fuelLoad: 12.5
        }
    ],
    m_nextFrontWingValue: 27.0
};

handleCarSetups(mockSetupPacket);

// Verify live state.setup populated
assert.strictEqual(gameState.state.setup.wingF, 28, 'Front wing should match');
assert.strictEqual(gameState.state.setup.wingR, 24, 'Rear wing should match');
assert.strictEqual(gameState.state.setup.diffOn, 65, 'Diff on-throttle should match');
assert.strictEqual(gameState.state.setup.nextFrontWingValue, 27.0, 'Next front wing value should match');
console.log('✅ Test 1: UDP Car Setup packet successfully parsed and applied to state.setup.');

// 3. Simulate multi-lap completion
// Lap 1
gameState.carPhysics[0].lapNum = 1;
gameState.carDataTracker[0].s1 = 28000;
gameState.carDataTracker[0].s2 = 24000;
gameState.carDataTracker[0].s3 = 32000;

handleLapData({
    m_header: { m_playerCarIndex: 0 },
    m_lapData: [
        {
            m_lastLapTimeInMS: 84000,
            m_currentLapNum: 2,
            m_lapDistance: 100,
            m_carPosition: 1,
            m_pitStatus: 0,
            m_driverStatus: 4
        }
    ]
});

// Change setup slightly for Lap 2
mockSetupPacket.m_carSetups[0].m_frontWing = 30;
mockSetupPacket.m_carSetups[0].m_rearWing = 26;
handleCarSetups(mockSetupPacket);

// Lap 2
gameState.carPhysics[0].lapNum = 2;
gameState.carDataTracker[0].s1 = 27500;
gameState.carDataTracker[0].s2 = 23800;
gameState.carDataTracker[0].s3 = 31700;

handleLapData({
    m_header: { m_playerCarIndex: 0 },
    m_lapData: [
        {
            m_lastLapTimeInMS: 83000,
            m_currentLapNum: 3,
            m_lapDistance: 150,
            m_carPosition: 1,
            m_pitStatus: 0,
            m_driverStatus: 4
        }
    ]
});

assert(gameState.lapSetups[1], 'Lap 1 setup must be recorded');
assert(gameState.lapSetups[2], 'Lap 2 setup must be recorded');
assert.strictEqual(gameState.lapSetups[1].wingF, 28, 'Lap 1 wingF must be 28');
assert.strictEqual(gameState.lapSetups[2].wingF, 30, 'Lap 2 wingF must be 30');
console.log('✅ Test 2: Lap 1 and Lap 2 setups recorded independently in memory.');

// 4. Test generateSessionExportJson()
const exportData = generateSessionExportJson();

// Assert root level fields
assert(exportData.setupsByLap, 'Root setupsByLap must exist');
assert(Array.isArray(exportData.setupsByLap), 'Root setupsByLap must be an array');
assert.strictEqual(exportData.setupsByLap.length >= 2, true, 'Should contain at least 2 lap setups');
assert(exportData.carSetupsByLap, 'carSetupsByLap must exist at root');
console.log('✅ Test 3: Root exportData.setupsByLap and exportData.carSetupsByLap verified.');

// Assert player level fields
assert(exportData.player, 'exportData.player must exist');
assert(exportData.player.setup, 'exportData.player.setup must exist');
assert(exportData.player.setupsByLap, 'exportData.player.setupsByLap must exist');
assert.strictEqual(exportData.player.setupsByLap.length >= 2, true, 'Player setupsByLap must contain both laps');
console.log('✅ Test 4: Player setup snapshot and setupsByLap verified.');

// Assert detailed laps
const playerDetailed = exportData.detailedLapsByDriver[0];
assert(playerDetailed, 'Player detailed laps must exist');
assert.strictEqual(playerDetailed.laps.length, 2, 'Player must have 2 completed laps');

playerDetailed.laps.forEach((lap, idx) => {
    const lNum = idx + 1;
    assert(lap.setup, `Lap ${lNum} must have setup object`);
    
    // Check all 7 Car Setup tab card parameters
    // Card 1: Aerodynamics
    assert(lap.setup.wingF !== undefined, `Lap ${lNum} wingF missing`);
    assert(lap.setup.wingR !== undefined, `Lap ${lNum} wingR missing`);
    assert(lap.setup.aeroBiasPercent !== undefined, `Lap ${lNum} aeroBiasPercent missing`);
    assert(lap.setup.aeroBiasFormatted.includes('% Front'), `Lap ${lNum} aeroBiasFormatted missing units`);
    
    // Card 2: Transmission & Diff
    assert(lap.setup.diffOn !== undefined, `Lap ${lNum} diffOn missing`);
    assert(lap.setup.diffOnFormatted.includes('%'), `Lap ${lNum} diffOnFormatted missing %`);
    assert(lap.setup.diffOff !== undefined, `Lap ${lNum} diffOff missing`);
    assert(lap.setup.engineBraking !== undefined, `Lap ${lNum} engineBraking missing`);
    
    // Card 3: Suspension Geometry
    assert(lap.setup.camberF !== undefined, `Lap ${lNum} camberF missing`);
    assert(lap.setup.camberFFormatted.includes('°'), `Lap ${lNum} camberFFormatted missing °`);
    assert(lap.setup.camberR !== undefined, `Lap ${lNum} camberR missing`);
    assert(lap.setup.toeF !== undefined, `Lap ${lNum} toeF missing`);
    assert(lap.setup.toeR !== undefined, `Lap ${lNum} toeR missing`);
    
    // Card 4: Suspension & Heights
    assert(lap.setup.suspF !== undefined, `Lap ${lNum} suspF missing`);
    assert(lap.setup.suspR !== undefined, `Lap ${lNum} suspR missing`);
    assert(lap.setup.arbF !== undefined, `Lap ${lNum} arbF missing`);
    assert(lap.setup.arbR !== undefined, `Lap ${lNum} arbR missing`);
    assert(lap.setup.heightF !== undefined, `Lap ${lNum} heightF missing`);
    assert(lap.setup.heightR !== undefined, `Lap ${lNum} heightR missing`);
    
    // Card 5: Brakes & Bias
    assert(lap.setup.bBias !== undefined, `Lap ${lNum} bBias missing`);
    assert(lap.setup.bBiasFormatted.includes('%'), `Lap ${lNum} bBiasFormatted missing %`);
    assert(lap.setup.bPressure !== undefined, `Lap ${lNum} bPressure missing`);
    assert(lap.setup.bPressureFormatted.includes('%'), `Lap ${lNum} bPressureFormatted missing %`);
    
    // Card 6: Cold Setup Pressures
    assert(lap.setup.pressFLeft !== undefined, `Lap ${lNum} pressFLeft missing`);
    assert(lap.setup.pressFLeftFormatted.includes('psi'), `Lap ${lNum} pressFLeftFormatted missing psi`);
    assert(lap.setup.pressFRight !== undefined, `Lap ${lNum} pressFRight missing`);
    assert(lap.setup.pressRLeft !== undefined, `Lap ${lNum} pressRLeft missing`);
    assert(lap.setup.pressRRight !== undefined, `Lap ${lNum} pressRRight missing`);
    
    // Card 7: Fuel & Ballast
    assert(lap.setup.fuel !== undefined, `Lap ${lNum} fuel missing`);
    assert(lap.setup.fuelFormatted.includes('kg'), `Lap ${lNum} fuelFormatted missing kg`);
    assert(lap.setup.fuelLaps !== undefined, `Lap ${lNum} fuelLaps missing`);
    assert(lap.setup.fuelLapsFormatted.includes('Laps'), `Lap ${lNum} fuelLapsFormatted missing Laps`);
    assert(lap.setup.fuelCapacity !== undefined, `Lap ${lNum} fuelCapacity missing`);
    assert(lap.setup.fuelMix !== undefined, `Lap ${lNum} fuelMix missing`);
    assert(lap.setup.ballast !== undefined, `Lap ${lNum} ballast missing`);
    assert(lap.setup.ballastFormatted.includes('kg'), `Lap ${lNum} ballastFormatted missing kg`);
    
    // Categories
    assert(lap.setup.categories, `Lap ${lNum} categories missing`);
    assert(lap.setup.categories.aerodynamics, `Lap ${lNum} categories.aerodynamics missing`);
    assert(lap.setup.categories.transmissionAndDiff, `Lap ${lNum} categories.transmissionAndDiff missing`);
    assert(lap.setup.categories.suspensionGeometry, `Lap ${lNum} categories.suspensionGeometry missing`);
    assert(lap.setup.categories.suspensionAndHeights, `Lap ${lNum} categories.suspensionAndHeights missing`);
    assert(lap.setup.categories.brakesAndBias, `Lap ${lNum} categories.brakesAndBias missing`);
    assert(lap.setup.categories.coldSetupPressuresPsi, `Lap ${lNum} categories.coldSetupPressuresPsi missing`);
    assert(lap.setup.categories.fuelAndBallast, `Lap ${lNum} categories.fuelAndBallast missing`);
});
console.log('✅ Test 5: All 25+ Car Setup tab values verified with dual formatting on every lap.');

// Assert allLapsFlatTable contains setup
assert.strictEqual(exportData.allLapsFlatTable.length, 2, 'Flat table must contain 2 rows');
exportData.allLapsFlatTable.forEach((row, idx) => {
    assert(row.setup, `Flat table row ${idx + 1} must have setup object`);
    assert(row.setup.wingF !== undefined, `Flat table row ${idx + 1} setup.wingF missing`);
    assert(row.setup.categories !== undefined, `Flat table row ${idx + 1} setup.categories missing`);
});
console.log('✅ Test 6: allLapsFlatTable entries each contain complete setup object.');

// 5. Test Snapshot save & restore
saveActiveSessionSnapshot(true);
// Clear memory
gameState.lapSetups = {};
assert.strictEqual(Object.keys(gameState.lapSetups).length, 0, 'Memory lapSetups cleared');

const restored = loadActiveSessionSnapshot(null, 0, 'Qualifying');
assert.strictEqual(restored, true, 'Snapshot must restore successfully');
assert.strictEqual(gameState.lapSetups[1].wingF, 28, 'Restored Lap 1 wingF must be 28');
assert.strictEqual(gameState.lapSetups[2].wingF, 30, 'Restored Lap 2 wingF must be 30');
console.log('✅ Test 7: Snapshot save and restore of lapSetups verified.');

console.log('\n🎉 ALL CAR SETUP SESSION EXPORT TESTS PASSED SUCCESSFULLY! 🚀');
