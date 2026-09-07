const assert = require('assert');
const { teamMap, teamNameMap } = require('../src/config/constants');
const { getParticipantTeamId } = require('../src/state/stateHelpers');
const { getTelemetryStraightModeZonesForTrack, getTelemetryDrsZonesForTrack, syncTrackLinesForTrack } = require('../src/services/trackService');
const gameState = require('../src/state/gameState');

console.log('--- Test 1: Team ID 232 & Custom Team Mapping ---');
assert.strictEqual(teamMap[232], '#FFFFFF', 'Team ID 232 should map to #FFFFFF');
assert.strictEqual(teamNameMap[232], 'Custom Team', 'Team ID 232 should map to Custom Team');
assert.strictEqual(teamNameMap[231], 'Custom Team', 'Team ID 231 should map to Custom Team');
assert.strictEqual(teamNameMap[233], 'Custom Team', 'Team ID 233 should map to Custom Team');

const p = { m_teamId: 232, m_name: 'gokulnath_08' };
const detectedId = getParticipantTeamId(p);
assert.strictEqual(detectedId, 232, 'Participant team ID should be 232');
console.log('✅ Test 1 Passed: Team ID 232 cleanly recognized without warnings.');

console.log('\n--- Test 2: Straight Mode Zones & Telemetry Extraction ---');
// Melbourne: Track ID 0, approx 5278m
const melbourneStraightZones = getTelemetryStraightModeZonesForTrack(0, 5278);
assert(Array.isArray(melbourneStraightZones) && melbourneStraightZones.length > 0, 'Melbourne must have Straight Mode zones');
console.log(`Melbourne Straight Mode Zones: ${melbourneStraightZones.length} zones found.`);
melbourneStraightZones.forEach((z, i) => {
    assert(Number.isFinite(z.startDistance), `Zone ${i} must have startDistance`);
    assert(Number.isFinite(z.endDistance), `Zone ${i} must have endDistance`);
    console.log(`  Zone ${i + 1}: ${z.startDistance}m -> ${z.endDistance}m`);
});

// Monza: Track ID 11, approx 5793m
const monzaStraightZones = getTelemetryStraightModeZonesForTrack(11, 5793);
assert(Array.isArray(monzaStraightZones) && monzaStraightZones.length >= 2, 'Monza must have Straight Mode zones');
console.log(`Monza Straight Mode Zones: ${monzaStraightZones.length} zones found.`);
console.log('✅ Test 2 Passed: 2026 Straight Mode catalog zones generated with distances.');

console.log('\n--- Test 3: Track Line Synchronization (F1 25 DRS vs F1 26 Straight Mode) ---');
let broadcastMessages = [];
const mockBroadcast = (msg) => {
    broadcastMessages.push(JSON.parse(msg));
};

// Test sync for track 11 (Monza) with gameYear 26
syncTrackLinesForTrack(11, true, mockBroadcast, 26);
assert(broadcastMessages.length >= 2, 'Sync should broadcast both trackLinesUpdated and trackDataResponse');
const trackLinesMsg = broadcastMessages.find(m => m.type === 'trackLinesUpdated');
const trackDataMsg = broadcastMessages.find(m => m.type === 'trackDataResponse');

assert(trackLinesMsg, 'Should broadcast trackLinesUpdated');
assert.strictEqual(trackLinesMsg.trackId, 11, 'Track ID should be 11');
assert(Array.isArray(trackLinesMsg.straightModeZones) && trackLinesMsg.straightModeZones.length > 0, 'Should include straightModeZones');
assert(Array.isArray(trackLinesMsg.drsZones) && trackLinesMsg.drsZones.length > 0, 'Should include drsZones');
assert.strictEqual(trackLinesMsg.gameYear, 26, 'gameYear should be 26');

assert(trackDataMsg, 'Should broadcast trackDataResponse');
assert.strictEqual(trackDataMsg.data.gameYear, 26, 'trackData.gameYear should be 26');
assert(Array.isArray(trackDataMsg.data.straightModeZones), 'trackData.straightModeZones should be array');
console.log(`✅ F1 26 Sync Successful: Broadcast contains ${trackLinesMsg.straightModeZones.length} straightModeZones and ${trackLinesMsg.drsZones.length} drsZones.`);

// Test sync with gameYear 25
broadcastMessages = [];
syncTrackLinesForTrack(11, true, mockBroadcast, 25);
const trackLinesMsg25 = broadcastMessages.find(m => m.type === 'trackLinesUpdated');
assert.strictEqual(trackLinesMsg25.gameYear, 25, 'gameYear should be 25');
console.log(`✅ F1 25 Sync Successful: Broadcast contains gameYear 25.`);

console.log('\n===========================================');
console.log('ALL VERIFICATION TESTS COMPLETED SUCCESSFULLY!');
console.log('===========================================');
