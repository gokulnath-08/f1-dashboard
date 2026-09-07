// Test permanent custom target persistence across multiple sessions and track transitions

const mockLocalStorage = {};
global.localStorage = {
    getItem: (key) => mockLocalStorage[key] || null,
    setItem: (key, val) => { mockLocalStorage[key] = String(val); },
    removeItem: (key) => { delete mockLocalStorage[key]; }
};

global.showToast = (msg) => console.log('[TOAST]', msg);
global.formatMs = (ms) => {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const mss = Math.floor(ms % 1000);
    return `${m}:${String(s).padStart(2, '0')}.${String(mss).padStart(3, '0')}`;
};
global.formatSectorMs = (ms) => (ms / 1000).toFixed(3);
global.formatDeltaMs = (ms) => (ms <= 0 ? '' : '+') + (ms / 1000).toFixed(3);

const mockElements = {};
global.document = {
    getElementById: (id) => {
        if (!mockElements[id]) {
            mockElements[id] = {
                value: '',
                textContent: '',
                checked: true,
                style: {},
                classList: {
                    toggle: () => {},
                    add: () => {},
                    remove: () => {}
                }
            };
        }
        return mockElements[id];
    },
    querySelectorAll: () => []
};

// Load TargetPaceManager logic
const fs = require('fs');
const dashboardCode = fs.readFileSync('js/dashboard.js', 'utf8');

// Extract TargetPaceManager class definition
const startIdx = dashboardCode.indexOf('class TargetPaceManager {');
const endIdx = dashboardCode.indexOf('// Initialize global TargetPaceManager instance');
const classCode = dashboardCode.substring(startIdx, endIdx);

const vm = require('vm');
vm.runInThisContext(classCode);

console.log('=== TEST SUITE: PERMANENT CUSTOM TARGET ACROSS SESSIONS ===\n');

// 1. Session 1: User sets target on Silverstone (trackId: 2)
console.log('--- SESSION 1: Silverstone (trackId: 2) ---');
const mgr1 = new TargetPaceManager();
mgr1.onTrackDetected(2, 'Silverstone Circuit');

document.getElementById('tgt-lap-min').value = '1';
document.getElementById('tgt-lap-sec').value = '24';
document.getElementById('tgt-lap-ms').value = '500';
document.getElementById('tgt-sec-1').value = '25.350';
document.getElementById('tgt-sec-2').value = '33.800';
document.getElementById('tgt-sec-3').value = '25.350';
document.getElementById('target-enable-switch').checked = true;

mgr1.saveSettings();

console.log('Session 1 Active:', mgr1.isEnabled());
console.log('Session 1 Target Lap:', mgr1.getTargetLapMs(), formatMs(mgr1.getTargetLapMs()));
console.log('Session 1 Target S1:', mgr1.getTargetSectorMs('s1'));

if (!mgr1.isEnabled() || mgr1.getTargetLapMs() !== 84500) {
    throw new Error('Session 1 target not saved correctly!');
}

// 2. Session 2: NEW SESSION on different circuit (Monaco, trackId: 5)
console.log('\n--- SESSION 2: NEW SESSION on Monaco (trackId: 5) ---');
const mgr2 = new TargetPaceManager();
mgr2.onTrackDetected(5, 'Monaco');

console.log('Session 2 Track:', mgr2.activeTrackName, '(ID:', mgr2.activeTrackId, ')');
console.log('Session 2 Target Stayed Active:', mgr2.isEnabled());
console.log('Session 2 Target Lap Ms:', mgr2.getTargetLapMs(), formatMs(mgr2.getTargetLapMs()));
console.log('Session 2 Target S1:', mgr2.getTargetSectorMs('s1'), 'S2:', mgr2.getTargetSectorMs('s2'), 'S3:', mgr2.getTargetSectorMs('s3'));

if (!mgr2.isEnabled() || mgr2.getTargetLapMs() !== 84500 || mgr2.getTargetSectorMs('s1') !== 25350) {
    throw new Error('FAIL: Target did NOT stay active across new session on different track!');
}
console.log('✓ PASS: Custom target stayed active in new session without resetting!');

// 3. Session 3: Cold start / Disconnected state (trackId: -1)
console.log('\n--- SESSION 3: COLD START / DISCONNECTED (trackId: -1) ---');
const mgr3 = new TargetPaceManager();
console.log('Session 3 Active Track:', mgr3.activeTrackName);
console.log('Session 3 Target Stayed Active:', mgr3.isEnabled());
console.log('Session 3 Target Lap:', formatMs(mgr3.getTargetLapMs()));

if (!mgr3.isEnabled() || mgr3.getTargetLapMs() !== 84500) {
    throw new Error('FAIL: Target did NOT stay active on cold start / default track!');
}
console.log('✓ PASS: Custom target stayed active on cold start / new tab!');

// 4. User explicitly turns target OFF via toggleActive()
console.log('\n--- USER ACTION: TURN TARGET OFF ---');
mgr3.toggleActive();
console.log('Target Active now:', mgr3.isEnabled());
if (mgr3.isEnabled() !== false) {
    throw new Error('FAIL: toggleActive() should turn target off!');
}
console.log('✓ PASS: Target turned off as requested.');

// 5. Session 4: New Session while turned OFF
console.log('\n--- SESSION 4: NEW SESSION while Target is Turned Off ---');
const mgr4 = new TargetPaceManager();
mgr4.onTrackDetected(10, 'Spa Francorchamps');
console.log('Session 4 isEnabled:', mgr4.isEnabled());
console.log('Session 4 stored lapMs is still preserved:', mgr4.getCurrentTarget().lapMs);

if (mgr4.isEnabled() !== false || mgr4.getCurrentTarget().lapMs !== 84500) {
    throw new Error('FAIL: Target should remain turned off until user turns it back on!');
}
console.log('✓ PASS: Stays turned off until user turns it back on, with numbers preserved.');

// 6. User turns target back ON
console.log('\n--- USER ACTION: TURN TARGET BACK ON ---');
mgr4.toggleActive();
console.log('Target Active now:', mgr4.isEnabled());
console.log('Target Lap restored:', formatMs(mgr4.getTargetLapMs()));

if (!mgr4.isEnabled() || mgr4.getTargetLapMs() !== 84500) {
    throw new Error('FAIL: Target should be active again with restored lap time!');
}
console.log('✓ PASS: Target restored seamlessly.');

// 7. User changes target to 1:22.000 (82000 ms)
console.log('\n--- USER ACTION: CHANGE TARGET TO 1:22.000 ---');
document.getElementById('tgt-lap-min').value = '1';
document.getElementById('tgt-lap-sec').value = '22';
document.getElementById('tgt-lap-ms').value = '0';
document.getElementById('tgt-sec-1').value = '24.600';
document.getElementById('tgt-sec-2').value = '32.800';
document.getElementById('tgt-sec-3').value = '24.600';
mgr4.saveSettings();

console.log('Changed Target Lap:', formatMs(mgr4.getTargetLapMs()));

// 8. Session 5: Brand new session after change
console.log('\n--- SESSION 5: BRAND NEW SESSION AFTER CHANGE ---');
const mgr5 = new TargetPaceManager();
mgr5.onTrackDetected(22, 'Las Vegas');
console.log('Session 5 Track:', mgr5.activeTrackName);
console.log('Session 5 Target Stayed Active:', mgr5.isEnabled());
console.log('Session 5 Target Lap:', formatMs(mgr5.getTargetLapMs()));

if (!mgr5.isEnabled() || mgr5.getTargetLapMs() !== 82000) {
    throw new Error('FAIL: Changed target did not persist in new session!');
}
console.log('✓ PASS: Changed target permanently stays across all subsequent sessions!');

console.log('\n✨ ALL TESTS PASSED SUCCESSFULLY! The custom target stays permanently until changed or turned off.');
