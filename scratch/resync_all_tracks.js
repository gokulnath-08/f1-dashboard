const fs = require('fs');
const path = require('path');

const trackMapsDir = path.join(__dirname, '../track_maps');
const telemetryDir = path.join(__dirname, '../telemetry');

const OFFICIAL_TRACK_SECTOR_DISTANCES = {
    0:  { s1: 1720, s2: 3680, len: 5278 }, // Melbourne (Albert Park)
    2:  { s1: 1418, s2: 2985, len: 5451 }, // Shanghai
    3:  { s1: 1800, s2: 4001, len: 5412 }, // Sakhir (Bahrain)
    4:  { s1: 1512, s2: 3194, len: 4657 }, // Catalunya (Barcelona)
    5:  { s1: 1059, s2: 2470, len: 3337 }, // Monaco
    6:  { s1: 1450, s2: 3100, len: 4361 }, // Montreal (Circuit Gilles Villeneuve)
    7:  { s1: 1750, s2: 3980, len: 5891 }, // Silverstone
    9:  { s1: 1268, s2: 2953, len: 4381 }, // Hungaroring
    10: { s1: 2323, s2: 5150, len: 7004 }, // Spa-Francorchamps
    11: { s1: 1898, s2: 3726, len: 5793 }, // Monza
    12: { s1: 1464, s2: 3133, len: 4940 }, // Singapore (Marina Bay)
    13: { s1: 1820, s2: 4120, len: 5807 }, // Suzuka
    14: { s1: 1420, s2: 3450, len: 5281 }, // Abu Dhabi (Yas Marina)
    15: { s1: 1661, s2: 3923, len: 5513 }, // Circuit of the Americas (Austin)
    16: { s1: 1215.4, s2: 3160.7, len: 4294 }, // Interlagos (Brazil)
    17: { s1: 1209, s2: 2913, len: 4318 }, // Red Bull Ring (Austria)
    19: { s1: 2038, s2: 3592, len: 4304 }, // Mexico (Autodromo Hermanos Rodriguez)
    20: { s1: 1880, s2: 4150, len: 6003 }, // Baku
    26: { s1: 1290, s2: 2850, len: 4259 }, // Zandvoort
    27: { s1: 1660, s2: 3520, len: 4909 }, // Imola
    29: { s1: 1890, s2: 4210, len: 6174 }, // Jeddah
    30: { s1: 1750, s2: 3850, len: 5412 }, // Miami
    31: { s1: 1704, s2: 3376, len: 6201 }, // Las Vegas
    32: { s1: 1680, s2: 3720, len: 5419 }, // Losail (Qatar)
    42: { s1: 1215, s2: 3162, len: 5474 }  // Madrid
};

function extractCoordinateFromTelemetryByDistance(telemetry, targetDistance) {
    if (!telemetry || telemetry.length === 0 || targetDistance === undefined || targetDistance === null || targetDistance < 0) return null;
    if (targetDistance === 0) {
        const d0Candidate = telemetry.find(pt => Math.abs(pt.d || 0) < 60 && (pt.x !== 0 || pt.z !== 0));
        return d0Candidate || telemetry[0];
    }
    let idx = telemetry.findIndex(pt => (pt.d !== undefined ? pt.d : 0) >= targetDistance);
    if (idx === 0) return telemetry[0];
    if (idx > 0) {
        const pt1 = telemetry[idx - 1];
        const pt2 = telemetry[idx];
        const d1 = pt1.d !== undefined ? pt1.d : 0;
        const d2 = pt2.d !== undefined ? pt2.d : 0;
        const rangeD = d2 - d1;
        if (rangeD > 0) {
            const ratio = Math.max(0, Math.min(1, (targetDistance - d1) / rangeD));
            return {
                x: pt1.x + (pt2.x - pt1.x) * ratio,
                z: pt1.z + (pt2.z - pt1.z) * ratio,
                yaw: pt1.yaw !== undefined ? pt1.yaw + (pt2.yaw - pt1.yaw) * ratio : (pt2.yaw || 0),
                d: targetDistance
            };
        }
        return pt2;
    }
    return null;
}

const files = fs.readdirSync(trackMapsDir).filter(f => f.startsWith('track_') && f.endsWith('.json'));

console.log('--- RE-SYNCING ALL TRACK MAPS USING EXACT OFFICIAL DISTANCES ---');
files.forEach(file => {
    const tId = parseInt(file.match(/\d+/)[0], 10);
    const mapPath = path.join(trackMapsDir, file);
    const telPath = path.join(telemetryDir, `telemetry_${tId}.json`);

    let telData = [];
    let trackPoints = [];

    if (fs.existsSync(telPath)) {
        try {
            const rawTel = JSON.parse(fs.readFileSync(telPath, 'utf8'));
            if (Array.isArray(rawTel) && rawTel.length > 10) {
                telData = rawTel.filter(p => Number.isFinite(p.x) && Number.isFinite(p.z) && (p.x !== 0 || p.z !== 0));
                telData.sort((a, b) => (a.d !== undefined && b.d !== undefined) ? a.d - b.d : a.t - b.t);
            }
        } catch (e) { }
    }

    if (fs.existsSync(mapPath)) {
        try {
            const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
            trackPoints = Array.isArray(mapData) ? mapData : (mapData.trackPoints || []);
        } catch (e) { }
    }

    if (telData.length < 10) {
        if (trackPoints.length >= 20) {
            let cumulative = 0;
            telData = [{ x: trackPoints[0].x, z: trackPoints[0].z, yaw: 0, d: 0 }];
            for (let i = 1; i < trackPoints.length; i++) {
                const seg = Math.hypot(trackPoints[i].x - trackPoints[i-1].x, trackPoints[i].z - trackPoints[i-1].z);
                cumulative += seg;
                const dx = trackPoints[i].x - trackPoints[i-1].x;
                const dz = trackPoints[i].z - trackPoints[i-1].z;
                const yaw = Math.atan2(dx, dz);
                telData.push({ x: trackPoints[i].x, z: trackPoints[i].z, yaw, d: cumulative });
            }
        } else {
            console.log(`Skipping track ${tId} (insufficient data)`);
            return;
        }
    }

    const totalDist = (telData[telData.length - 1].d > 0) ? telData[telData.length - 1].d : 5000;
    const startLinePt = telData[0];
    const newStart = { x: startLinePt.x, z: startLinePt.z, yaw: startLinePt.yaw || 0, d: 0 };

    const targetS1Distance = OFFICIAL_TRACK_SECTOR_DISTANCES[tId]?.s1 || Math.round(totalDist * 0.30);
    const targetS2Distance = OFFICIAL_TRACK_SECTOR_DISTANCES[tId]?.s2 || Math.round(totalDist * 0.70);

    const coordS1 = extractCoordinateFromTelemetryByDistance(telData, targetS1Distance);
    const coordS2 = extractCoordinateFromTelemetryByDistance(telData, targetS2Distance);

    const newS1 = coordS1 ? { x: coordS1.x, z: coordS1.z, yaw: coordS1.yaw || 0, d: coordS1.d || targetS1Distance } : null;
    const newS2 = coordS2 ? { x: coordS2.x, z: coordS2.z, yaw: coordS2.yaw || 0, d: coordS2.d || targetS2Distance } : null;

    const updated = {
        trackPoints,
        startLine: newStart,
        sector1: newS1,
        sector2: newS2
    };

    fs.writeFileSync(mapPath, JSON.stringify(updated, null, 2), 'utf8');
    console.log(`✅ Track ${tId.toString().padStart(2)}: Total ${Math.round(totalDist)}m | S1: ${Math.round(newS1.d)}m | S2: ${Math.round(newS2.d)}m`);
});
console.log('🎉 ALL TRACK MAPS SYNCED TO OFFICIAL SECTOR DISTANCES!');
