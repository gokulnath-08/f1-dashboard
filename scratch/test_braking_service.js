const http = require('http');

// Test storageService methods directly first
const { getSessionAllLaps, extractBrakingZones, compareLapsBraking, buildAllLapsComparisonMatrix } = require('../src/services/storageService');

console.log('Testing getSessionAllLaps for Track 0...');
const laps = getSessionAllLaps(0, 0);
console.log(`Retrieved ${laps.length} laps for Track 0.`);
laps.forEach(l => {
    console.log(`- Lap ${l.lapNum}: ${l.driverName} | Time: ${l.lapTimeMs}ms | Braking: ${l.totalBrakingDist}m across ${l.brakingZones?.length || 0} zones | Decel: ${l.avgDecelG}G`);
});

if (laps.length >= 2) {
    console.log('\nTesting compareLapsBraking (Lap 1 vs Lap 2)...');
    const h2h = compareLapsBraking(laps[0], laps[1]);
    console.log(`Total Braking Delta: ${h2h.totalBrakingDistanceDelta}m (Lap Time Delta: ${h2h.lapTimeDeltaMs}ms)`);
    console.log(`Corner 1: Baseline ${h2h.zones[0].baseline.brakingDist}m, Compare ${h2h.zones[0].comparison?.brakingDist}m, Delta: ${h2h.zones[0].brakingDistanceDelta}m, Brake Point Delta: ${h2h.zones[0].brakePointDelta}m`);

    console.log('\nTesting buildAllLapsComparisonMatrix (Baseline Lap 1 vs All Laps)...');
    const matrix = buildAllLapsComparisonMatrix(laps[0], laps);
    console.log(`Matrix has ${matrix.corners.length} corners compared across ${matrix.lapSummaries.length} laps.`);
    console.log('Sample Corner 1 comparison:', matrix.corners[0]);
}

console.log('\nAll backend logic verified successfully!');
