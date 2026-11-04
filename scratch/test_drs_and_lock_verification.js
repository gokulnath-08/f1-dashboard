const assert = require('assert');
const path = require('path');
const fs = require('fs');

const {
    isTrackFinalized,
    syncTrackLinesForTrack,
    lockOfficialSectorLinesFromTelemetry
} = require('../src/services/trackService');

console.log('--- Starting Comprehensive DRS & Finalize Lock Test ---');

// 1. Verify Track 17 is recognized as finalized
const track17Finalized = isTrackFinalized(17);
console.log(`1. Track 17 finalized status: ${track17Finalized}`);
assert.strictEqual(track17Finalized, true, 'Track 17 must be finalized (locked)');

// 2. Test syncTrackLinesForTrack rejection on locked track
console.log('2. Testing syncTrackLinesForTrack on locked Track 17...');
const syncResult = syncTrackLinesForTrack(17);
assert.strictEqual(syncResult, null, 'syncTrackLinesForTrack MUST return null for finalized tracks');
console.log('   ✅ syncTrackLinesForTrack correctly returned null for locked track.');

// 3. Test lockOfficialSectorLinesFromTelemetry rejection on locked track
console.log('3. Testing lockOfficialSectorLinesFromTelemetry on locked Track 17...');
const lockResult = lockOfficialSectorLinesFromTelemetry(17);
assert.strictEqual(lockResult, false, 'lockOfficialSectorLinesFromTelemetry MUST return false for finalized tracks');
console.log('   ✅ lockOfficialSectorLinesFromTelemetry correctly returned false for locked track.');

// 4. Verify track_17.json file content integrity
const t17Path = path.join(__dirname, '..', 'track_maps', 'track_17.json');
const t17Raw = JSON.parse(fs.readFileSync(t17Path, 'utf8'));
assert(Array.isArray(t17Raw.drsZones), 'track_17.json must contain drsZones array');
assert(t17Raw.drsZones.length > 0, 'track_17.json must have DRS zones defined');
console.log(`4. Track 17 DRS Zones in file: ${t17Raw.drsZones.length} zones`);
assert.strictEqual(t17Raw.finalized, true, 'track_17.json finalized must be true');

// 5. Simulate wsServer getTrackData response logic for Track 17
console.log('5. Testing getTrackData logic for Track 17...');
const trackId = 17;
const tData = JSON.parse(fs.readFileSync(t17Path, 'utf8'));
const hasSavedDrs = Array.isArray(tData.drsZones) && tData.drsZones.length > 0;
const hasSavedStraight = Array.isArray(tData.straightModeZones) && tData.straightModeZones.length > 0;

if (tData.gameYear) {
    // keep
} else if (hasSavedDrs && !hasSavedStraight) {
    tData.gameYear = 25;
}

if (!tData.straightModeZones) {
    tData.straightModeZones = (tData.gameYear === 26) ? [/* dummy */] : [];
}
tData.finalized = isTrackFinalized(trackId);

console.log('   Resulting payload properties:');
console.log(`   - gameYear: ${tData.gameYear}`);
console.log(`   - drsZones: ${tData.drsZones?.length}`);
console.log(`   - straightModeZones: ${tData.straightModeZones?.length}`);
console.log(`   - finalized: ${tData.finalized}`);

assert.strictEqual(tData.gameYear, 25, 'gameYear must default to 25 when DRS zones exist');
assert.strictEqual(tData.straightModeZones.length, 0, 'straightModeZones must be empty when DRS zones exist');
assert.strictEqual(tData.finalized, true, 'finalized must be true');
assert.strictEqual(tData.drsZones.length, t17Raw.drsZones.length, 'drsZones must match file exactly');

console.log('\n🎉 ALL DRS AND LOCK VERIFICATION CHECKS PASSED!');
