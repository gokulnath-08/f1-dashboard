const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('========================================================');
console.log('TESTING LAST LOADED MAP & STARTING EMPTY STATE');
console.log('========================================================');

const dashboardPath = path.join(__dirname, '..', 'js', 'dashboard.js');
const indexPath = path.join(__dirname, '..', 'index.html');

const dashboardSrc = fs.readFileSync(dashboardPath, 'utf8');
const indexSrc = fs.readFileSync(indexPath, 'utf8');

// 1. Verify index.html initial state
console.log('\nTest 1: index.html markup inspection');
assert(indexSrc.includes('<div class="kpi-val" id="track-name">NO ACTIVE TRACK</div>'), 'index.html must display NO ACTIVE TRACK initially');
assert(!indexSrc.includes('<div class="kpi-val" id="track-name">LOADING...</div>'), 'index.html must NOT display LOADING... for track-name');
assert(indexSrc.includes('id="syncbttn" onclick="syncTrackLines()" style="\r\n                                display: none;') || 
       indexSrc.includes('id="syncbttn" onclick="syncTrackLines()" style="\n                                display: none;'), 
       'syncbttn must have display: none initially');
assert(indexSrc.includes('id="finalizebttn" onclick="toggleFinalizeTrack()" style="\r\n                                display: none;') || 
       indexSrc.includes('id="finalizebttn" onclick="toggleFinalizeTrack()" style="\n                                display: none;'), 
       'finalizebttn must have display: none initially');
console.log('✅ Test 1 Passed: index.html defaults to NO ACTIVE TRACK and hidden buttons.');

// 2. Verify dashboard.js does not default to track 17 on startup
console.log('\nTest 2: Dashboard startup does NOT default to Track 17');
assert(!dashboardSrc.includes('defaultTrackId'), 'dashboard.js must not contain defaultTrackId fallback to 17');
assert(!dashboardSrc.includes(': 17;'), 'dashboard.js must not hardcode : 17;');
assert(dashboardSrc.includes('setText("track-name", "NO ACTIVE TRACK");'), 'dashboard.js must set track-name to NO ACTIVE TRACK when no last map is saved');
console.log('✅ Test 2 Passed: No hardcoded fallback to track 17 on startup.');

// 3. Verify loadOfflineTrack handles empty/clear reset
console.log('\nTest 3: loadOfflineTrack handles reset/empty state');
assert(dashboardSrc.includes('localStorage.removeItem(\'f1_last_track_id\')'), 'loadOfflineTrack must remove f1_last_track_id on clear');
assert(dashboardSrc.includes('localStorage.removeItem(\'f1_cached_track_map\')'), 'loadOfflineTrack must remove f1_cached_track_map on clear');
assert(dashboardSrc.includes('mapData.trackId = tId;'), 'loadOfflineTrack must inject trackId into mapData before renderTrackGeometry');
console.log('✅ Test 3 Passed: loadOfflineTrack properly clears map storage and sets mapData.trackId.');

// 4. Verify restoreCachedTrackMap validates against last track ID
console.log('\nTest 4: restoreCachedTrackMap validation');
assert(dashboardSrc.includes('if (savedId === null || isNaN(savedId) || savedId === -1)'), 'restoreCachedTrackMap must not restore if no last track was saved');
assert(dashboardSrc.includes('if (tId === null || isNaN(tId) || tId !== savedId)'), 'restoreCachedTrackMap must reject stale cache that does not match last saved track');
console.log('✅ Test 4 Passed: restoreCachedTrackMap ensures cache matches last loaded track.');

// 5. Verify live telemetry updates f1_last_track_id
console.log('\nTest 5: Live telemetry session saves last track');
assert(dashboardSrc.includes("localStorage.setItem('f1_last_track_id', liveTrackId);"), 'Live session must update f1_last_track_id');
console.log('✅ Test 5 Passed: Live session saves last loaded track to localStorage.');

console.log('\n========================================================');
console.log('ALL LAST LOADED MAP TESTS PASSED! 🚀');
console.log('========================================================\n');
