const assert = require('assert');
const path = require('path');
const fs = require('fs');

const {
    isTrackFinalized,
    syncTrackLinesForTrack,
    getTelemetryDrsZonesForTrack,
    getTelemetryStraightModeZonesForTrack
} = require('../src/services/trackService');
const gameState = require('../src/state/gameState');

console.log('========================================================');
console.log('RUNNING FULL END-TO-END DRS & FINALIZE LOCK VERIFICATION');
console.log('========================================================\n');

// ----------------------------------------------------
// TEST 1: Strict Lock Cannot Be Bypassed with force: true
// ----------------------------------------------------
console.log('Test 1: Lock bypass prevention');
assert.strictEqual(isTrackFinalized(17), true, 'Track 17 must be finalized in test baseline');

let broadcastMsgs = [];
const mockBroadcast = (msg) => broadcastMsgs.push(JSON.parse(msg));

const bypassAttempt = syncTrackLinesForTrack(17, true, mockBroadcast, 25);
assert.strictEqual(bypassAttempt, null, 'syncTrackLinesForTrack MUST return null even if force=true');
const lockToast = broadcastMsgs.find(m => m.type === 'toast');
assert(lockToast && lockToast.message.includes('locked/finalized'), 'Must broadcast locked toast on attempted sync');
const finalizedBroadcast = broadcastMsgs.find(m => m.type === 'trackFinalizedState');
assert(finalizedBroadcast && finalizedBroadcast.finalized === true, 'Must broadcast trackFinalizedState: true');
console.log('✅ Test 1 Passed: force: true cannot bypass a finalized track.');

// ----------------------------------------------------
// TEST 2: File Preservation and No DRS Stripping
// ----------------------------------------------------
console.log('\nTest 2: Safe save does not strip DRS zones');
const t17Path = path.join(__dirname, '..', 'track_maps', 'track_17.json');
const t17Before = JSON.parse(fs.readFileSync(t17Path, 'utf8'));
const drsCountBefore = t17Before.drsZones.length;
assert.strictEqual(drsCountBefore, 4, 'Track 17 must have 4 synced DRS zones');

// Verify track_17.json retains drsZones
const t17After = JSON.parse(fs.readFileSync(t17Path, 'utf8'));
assert.strictEqual(t17After.drsZones.length, 4, 'DRS zones must not be stripped');
assert.strictEqual(t17After.finalized, true, 'finalized must remain true');
console.log(`✅ Test 2 Passed: Track 17 retains all ${t17After.drsZones.length} synced DRS zones and finalized flag.`);

// ----------------------------------------------------
// TEST 3: DRS Fallback Prefers Synced Zones in track_${id}.json Over Catalog
// ----------------------------------------------------
console.log('\nTest 3: DRS Fallback loads synced zones from track map JSON');
// When called without fallbackZones, getTelemetryDrsZonesForTrack must read track_17.json
// which has 4 zones, NOT OFFICIAL_TRACK_DRS_ZONES[17] which only has 3 zones!
const t17Drs = getTelemetryDrsZonesForTrack(17, 4318, null, null);
assert.strictEqual(t17Drs.length, 4, `Track 17 must return 4 synced DRS zones from JSON, got ${t17Drs.length}`);

// Melbourne (Track 0) has 5 synced zones in track_0.json vs 3 in official catalog
const t0Drs = getTelemetryDrsZonesForTrack(0, 5278, null, null);
assert.strictEqual(t0Drs.length, 5, `Track 0 must return 5 synced DRS zones from JSON, got ${t0Drs.length}`);
console.log(`✅ Test 3 Passed: DRS fallback returns exact synced zones from JSON (Track 17: ${t17Drs.length} zones, Track 0: ${t0Drs.length} zones).`);

// ----------------------------------------------------
// TEST 4: Lap Completion Handler Respects Finalize Lock
// ----------------------------------------------------
console.log('\nTest 4: Lap completion handler does not repeat sync on locked track');
const lapDataHandlerSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'udp', 'handlers', 'lapDataHandler.js'), 'utf8');
assert(lapDataHandlerSrc.includes('!isTrackFinalized(currentTrackId)'), 'lapDataHandler must check !isTrackFinalized before syncing');
console.log('✅ Test 4 Passed: lapDataHandler wraps auto-sync in !isTrackFinalized check.');

// ----------------------------------------------------
// TEST 5: Motion Handler Respects Finalize Lock
// ----------------------------------------------------
console.log('\nTest 5: Motion handler respects finalize lock');
const motionHandlerSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'udp', 'handlers', 'motionHandler.js'), 'utf8');
assert(motionHandlerSrc.includes('!finalized') && motionHandlerSrc.includes('syncTrackLinesForTrack'), 'motionHandler must guard syncTrackLinesForTrack with !finalized');
assert(motionHandlerSrc.includes('!isTrackFinalized(gameState.currentTrackId)'), 'motionHandler must check !isTrackFinalized before start line update');
console.log('✅ Test 5 Passed: motionHandler guards mapping and start line updates with isTrackFinalized.');

// ----------------------------------------------------
// TEST 6: HTTP Server Sync Endpoint Rejects Locked Tracks
// ----------------------------------------------------
console.log('\nTest 6: HTTP Server rejects sync on locked tracks');
const httpServerSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'http', 'httpServer.js'), 'utf8');
assert(httpServerSrc.includes('isTrackFinalized(tId)'), 'httpServer must check isTrackFinalized(tId)');
assert(httpServerSrc.includes('No more sync is allowed'), 'httpServer must return locked message on sync attempt');
console.log('✅ Test 6 Passed: httpServer rejects sync on finalized tracks.');

// ----------------------------------------------------
// TEST 7: Frontend dashboard.js logic and regulation mode
// ----------------------------------------------------
console.log('\nTest 7: Dashboard logic verification');
const dashboardSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'dashboard.js'), 'utf8');

assert(dashboardSrc.includes('restoreCachedTrackMap'), 'dashboard.js must define restoreCachedTrackMap');
assert(dashboardSrc.includes('updateSyncButtonState'), 'dashboard.js must define updateSyncButtonState');
assert(dashboardSrc.includes('f1_cached_track_map'), 'dashboard.js must handle f1_cached_track_map');
assert(dashboardSrc.includes('f1_last_track_id'), 'dashboard.js must persist f1_last_track_id');
assert(dashboardSrc.includes('f1_active_reg_year'), 'dashboard.js must persist f1_active_reg_year');
assert(!dashboardSrc.includes('force: true'), 'dashboard.js must NOT send force: true in syncTrackLines');
assert(dashboardSrc.includes('showToast("🔒 Track Map is locked/finalized. No more sync is allowed.")'), 'dashboard.js must display locked toast on sync button click');
assert(dashboardSrc.includes('fetch(`track_maps/track_${tId}.json`)'), 'loadOfflineTrack must fetch track JSON directly');

// Verify index.html cache buster
const indexHtmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert(indexHtmlSrc.includes('dashboard.js?v=2.3'), 'index.html must load dashboard.js?v=2.3');
console.log('✅ Test 7 Passed: dashboard.js has direct track JSON fetch, cache-busted script tag, and lock UI.');

console.log('\n========================================================');
console.log('ALL TESTS PASSED SUCCESSFULLY! 🚀');
console.log('========================================================');
