const fs = require('fs');
const path = require('path');

function extractBrakingZones(pts) {
    if (!Array.isArray(pts) || pts.length < 20) return [];
    
    // Sort by distance
    const sorted = [...pts].filter(p => Number.isFinite(p.d) && Number.isFinite(p.speed))
                           .sort((a, b) => a.d - b.d);
                           
    const rawZones = [];
    let inZone = false;
    let cur = null;
    let zeroBrakeCount = 0;
    
    for (let i = 0; i < sorted.length; i++) {
        const p = sorted[i];
        const brk = p.brake || 0;
        const spd = p.speed || 0;
        
        if (!inZone) {
            // Braking initiated
            if (brk > 8 && spd > 50) {
                inZone = true;
                zeroBrakeCount = 0;
                cur = {
                    startIdx: i,
                    startDist: p.d,
                    startTime: p.t,
                    entrySpeed: spd,
                    minSpeed: spd,
                    minSpeedDist: p.d,
                    peakBrake: brk,
                    startX: p.x,
                    startY: p.y || 0,
                    startZ: p.z,
                    points: [p]
                };
            }
        } else {
            cur.points.push(p);
            if (brk > cur.peakBrake) cur.peakBrake = brk;
            if (spd < cur.minSpeed) {
                cur.minSpeed = spd;
                cur.minSpeedDist = p.d;
            }
            
            if (brk <= 5) {
                zeroBrakeCount++;
            } else {
                zeroBrakeCount = 0;
            }
            
            // Release condition: 3 points with low brake or speed recovering
            const isReleased = (zeroBrakeCount >= 3) || (p.throttle > 25 && spd > cur.minSpeed + 8) || (i === sorted.length - 1);
            if (isReleased) {
                inZone = false;
                const endPt = sorted[Math.max(cur.startIdx, i - zeroBrakeCount)];
                cur.endDist = endPt.d;
                cur.endTime = endPt.t;
                cur.endX = endPt.x;
                cur.endY = endPt.y || 0;
                cur.endZ = endPt.z;
                cur.exitSpeed = endPt.speed;
                cur.brakingDist = Math.max(1, Math.round((cur.endDist - cur.startDist) * 10) / 10);
                cur.speedDrop = Math.max(0, Math.round(cur.entrySpeed - cur.minSpeed));
                cur.durationMs = Math.max(50, Math.round(cur.endTime - cur.startTime));
                
                // Calculate G-force deceleration
                const v1 = cur.entrySpeed / 3.6;
                const v2 = cur.minSpeed / 3.6;
                const d = cur.brakingDist;
                const decelG = d > 0 ? Number(((v1 * v1 - v2 * v2) / (2 * d * 9.80665)).toFixed(2)) : 0;
                cur.avgDecelG = Math.max(0, decelG);
                
                // Validation filter for genuine corner braking zone
                if (cur.brakingDist >= 8 && (cur.speedDrop >= 12 || cur.peakBrake >= 30) && cur.durationMs >= 150) {
                    delete cur.points;
                    rawZones.push(cur);
                }
                cur = null;
            }
        }
    }
    
    // Merge consecutive zones that are separated by < 20 meters (trail braking re-application)
    const merged = [];
    for (let i = 0; i < rawZones.length; i++) {
        const z = rawZones[i];
        if (merged.length > 0) {
            const prev = merged[merged.length - 1];
            if (z.startDist - prev.endDist < 20) {
                // Merge
                prev.endDist = z.endDist;
                prev.endTime = z.endTime;
                prev.endX = z.endX;
                prev.endY = z.endY;
                prev.endZ = z.endZ;
                prev.exitSpeed = z.exitSpeed;
                prev.minSpeed = Math.min(prev.minSpeed, z.minSpeed);
                prev.peakBrake = Math.max(prev.peakBrake, z.peakBrake);
                prev.brakingDist = Math.round((prev.endDist - prev.startDist) * 10) / 10;
                prev.speedDrop = Math.round(prev.entrySpeed - prev.minSpeed);
                prev.durationMs = Math.round(prev.endTime - prev.startTime);
                const v1 = prev.entrySpeed / 3.6;
                const v2 = prev.minSpeed / 3.6;
                prev.avgDecelG = prev.brakingDist > 0 ? Number(((v1 * v1 - v2 * v2) / (2 * prev.brakingDist * 9.80665)).toFixed(2)) : 0;
                continue;
            }
        }
        merged.push({ ...z });
    }
    
    return merged.map((z, idx) => ({
        zoneIndex: idx + 1,
        name: `Turn ${idx + 1}`,
        startDist: Math.round(z.startDist),
        endDist: Math.round(z.endDist),
        brakingDist: Math.round(z.brakingDist),
        entrySpeed: Math.round(z.entrySpeed),
        minSpeed: Math.round(z.minSpeed),
        speedDrop: Math.round(z.speedDrop),
        peakBrake: Math.round(z.peakBrake),
        durationMs: Math.round(z.durationMs),
        durationSec: Number((z.durationMs / 1000).toFixed(2)),
        avgDecelG: Math.min(6.5, Math.max(0.5, z.avgDecelG)),
        startX: z.startX,
        startZ: z.startZ,
        endX: z.endX,
        endZ: z.endZ
    }));
}

// Test on telemetry_0.json
const telPath = path.join(__dirname, '..', 'telemetry', 'telemetry_0.json');
if (fs.existsSync(telPath)) {
    const data = JSON.parse(fs.readFileSync(telPath, 'utf8'));
    const zones = extractBrakingZones(data);
    console.log(`Extracted ${zones.length} braking zones from Melbourne telemetry_0.json:`);
    console.table(zones);
} else {
    console.log('File not found:', telPath);
}
