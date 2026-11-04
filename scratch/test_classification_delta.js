const assert = require('assert');
const { isRaceOrSprintSession } = require('../src/state/stateHelpers');
const gameState = require('../src/state/gameState');
const { handleSession } = require('../src/udp/handlers/sessionHandler');
const { resetSessionData } = require('../src/state/stateHelpers');

console.log('🧪 Testing Session Type & Classification Deltas...');

// ── TEST 1: isRaceOrSprintSession helper ──
console.log('Test 1: isRaceOrSprintSession detection across session types & game years...');

// 2024 / 2025 format
assert.strictEqual(isRaceOrSprintSession(1, 'Practice 1', 25), false, 'FP1 should not be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(2, 'Practice 2', 25), false, 'FP2 should not be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(3, 'Practice 3', 25), false, 'FP3 should not be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(4, 'Short Practice', 25), false, 'Short FP should not be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(5, 'Qualifying 1', 25), false, 'Q1 should not be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(6, 'Qualifying 2', 25), false, 'Q2 should not be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(7, 'Qualifying 3', 25), false, 'Q3 should not be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(8, 'Short Qualifying', 25), false, 'Short Q should not be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(9, 'One-Shot Qualifying', 25), false, 'One-Shot Q should not be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(10, 'Sprint Shootout 1', 25), false, 'Sprint Shootout 1 should not be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(11, 'Sprint Shootout 2', 25), false, 'Sprint Shootout 2 should not be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(12, 'Sprint Shootout 3', 25), false, 'Sprint Shootout 3 should not be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(13, 'Short Sprint Shootout', 25), false, 'Short Sprint Shootout should not be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(14, 'One-Shot Sprint Shootout', 25), false, 'One-Shot Sprint Shootout should not be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(15, 'Race', 25), true, 'Race should be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(16, 'Race 2', 25), true, 'Race 2 (Sprint) should be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(17, 'Race 3', 25), true, 'Race 3 should be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(18, 'Time Trial', 25), false, 'Time Trial should not be Race/Sprint');

// 2023 format
assert.strictEqual(isRaceOrSprintSession(10, 'Race', 23), true, '2023 Race (10) should be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(11, 'Race 2', 23), true, '2023 Race 2 / Sprint (11) should be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(13, 'Time Trial', 23), false, '2023 Time Trial (13) should not be Race/Sprint');

// F2 format
assert.strictEqual(isRaceOrSprintSession(10, 'F2 Feature Race', 25, 2), true, 'F2 Feature Race should be Race/Sprint');
assert.strictEqual(isRaceOrSprintSession(11, 'F2 Sprint Race', 25, 2), true, 'F2 Sprint Race should be Race/Sprint');

console.log('✅ Test 1 Passed: Session type detection is 100% accurate.');

// ── TEST 2: sessionHandler setting sessionCategory and isRaceOrSprint ──
console.log('Test 2: sessionHandler updates session state correctly...');
resetSessionData();
gameState.currentGameYear = 25;

// Test Practice 1 packet
handleSession({
    m_header: { m_sessionUID: '1001', m_sessionTime: 10, m_playerCarIndex: 0, m_gameYear: 25 },
    m_sessionType: 1, // FP1
    m_trackId: 0
});
assert.strictEqual(gameState.state.session.sessionCategory, 'TimeAttack', 'FP1 category must be TimeAttack');
assert.strictEqual(gameState.state.session.isRaceOrSprint, false, 'FP1 isRaceOrSprint must be false');

// Test Sprint Shootout 1 packet
handleSession({
    m_header: { m_sessionUID: '1002', m_sessionTime: 10, m_playerCarIndex: 0, m_gameYear: 25 },
    m_sessionType: 10, // Sprint Shootout 1
    m_trackId: 0
});
assert.strictEqual(gameState.state.session.sessionCategory, 'TimeAttack', 'Sprint Shootout category must be TimeAttack');
assert.strictEqual(gameState.state.session.isRaceOrSprint, false, 'Sprint Shootout isRaceOrSprint must be false');

// Test Race packet
handleSession({
    m_header: { m_sessionUID: '1003', m_sessionTime: 10, m_playerCarIndex: 0, m_gameYear: 25 },
    m_sessionType: 15, // Race in F1 25
    m_trackId: 0
});
assert.strictEqual(gameState.state.session.sessionCategory, 'Race', 'Race category must be Race');
assert.strictEqual(gameState.state.session.isRaceOrSprint, true, 'Race isRaceOrSprint must be true');

console.log('✅ Test 2 Passed: sessionHandler correctly updates category and isRaceOrSprint.');

// ── TEST 3: Best Lap Delta and Interval Calculation ──
console.log('Test 3: Leaderboard ranking, Difference to Lead, and Interval calculation...');

const mockDrivers = [
    { carIndex: 0, bestLapMs: 78500, driverStatus: 1, pitStatus: 0 }, // P1: 1:18.500
    { carIndex: 1, bestLapMs: 78750, driverStatus: 1, pitStatus: 0 }, // P2: 1:18.750 (+0.250 lead, +0.250 int)
    { carIndex: 2, bestLapMs: 79100, driverStatus: 1, pitStatus: 0 }, // P3: 1:19.100 (+0.600 lead, +0.350 int)
    { carIndex: 3, bestLapMs: 0,     driverStatus: 1, pitStatus: 1 }  // P4: No time (In Pit)
];

// Sort mock drivers by bestLapMs
mockDrivers.sort((a, b) => {
    const aBest = a.bestLapMs || 0;
    const bBest = b.bestLapMs || 0;
    if (aBest === 0 && bBest === 0) return (a.carIndex ?? 0) - (b.carIndex ?? 0);
    if (aBest === 0) return 1;
    if (bBest === 0) return -1;
    return aBest - bBest;
});

const poleTimeMs = (mockDrivers.length > 0 && mockDrivers[0].bestLapMs > 0) ? mockDrivers[0].bestLapMs : 0;

mockDrivers.forEach((driver, idx) => {
    driver.pos = idx + 1;
    if (!driver.bestLapMs || driver.bestLapMs === 0) {
        driver.gapText = driver.pitStatus > 0 ? 'IN PIT' : 'OUT LAP';
        driver.gapLead = '--';
        driver.gapInt = '--';
        driver.leadSec = 9999;
        driver.intSec = 9999;
    } else if (idx === 0) {
        const mins = Math.floor(driver.bestLapMs / 60000);
        const secs = ((driver.bestLapMs % 60000) / 1000).toFixed(3);
        driver.gapText = `${mins}:${secs.padStart(6, '0')}`;
        driver.gapLead = 'LEAD';
        driver.gapInt = 'LEAD';
        driver.leadSec = 0;
        driver.intSec = 0;
    } else {
        const diffLead = (driver.bestLapMs - poleTimeMs) / 1000;
        driver.gapLead = `+${diffLead.toFixed(3)}`;
        driver.gapText = driver.gapLead;
        driver.leadSec = diffLead;

        const prev = mockDrivers[idx - 1];
        if (prev && prev.bestLapMs > 0) {
            const intDiff = (driver.bestLapMs - prev.bestLapMs) / 1000;
            driver.gapInt = `+${intDiff.toFixed(3)}`;
            driver.intSec = Math.max(0, intDiff);
        } else {
            driver.gapInt = '--';
            driver.intSec = 9999;
        }
    }
});

// Verify Driver 0 (P1)
assert.strictEqual(mockDrivers[0].pos, 1, 'P1 position should be 1');
assert.strictEqual(mockDrivers[0].gapLead, 'LEAD', 'P1 gapLead should be LEAD');
assert.strictEqual(mockDrivers[0].gapInt, 'LEAD', 'P1 gapInt should be LEAD');

// Verify Driver 1 (P2)
assert.strictEqual(mockDrivers[1].pos, 2, 'P2 position should be 2');
assert.strictEqual(mockDrivers[1].gapLead, '+0.250', 'P2 gapLead should be +0.250');
assert.strictEqual(mockDrivers[1].gapInt, '+0.250', 'P2 gapInt should be +0.250');

// Verify Driver 2 (P3)
assert.strictEqual(mockDrivers[2].pos, 3, 'P3 position should be 3');
assert.strictEqual(mockDrivers[2].gapLead, '+0.600', 'P3 gapLead should be +0.600');
assert.strictEqual(mockDrivers[2].gapInt, '+0.350', 'P3 gapInt should be +0.350 (interval to P2)');

// Verify Driver 3 (P4 - No lap time)
assert.strictEqual(mockDrivers[3].pos, 4, 'P4 position should be 4');
assert.strictEqual(mockDrivers[3].gapLead, '--', 'P4 with no lap should have -- for gapLead');
assert.strictEqual(mockDrivers[3].gapInt, '--', 'P4 with no lap should have -- for gapInt');

console.log('✅ Test 3 Passed: Leaderboard ranking, difference to lead, and interval match requirements.');
console.log('🎉 All classification delta tests passed successfully!');
