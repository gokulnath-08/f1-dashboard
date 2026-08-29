const WebSocket = require('ws');
const assert = require('assert');

async function testSyncDistance() {
    console.log('--- TESTING EXACT DISTANCE-BASED TRACK LINE SYNC ---');
    const ws = new WebSocket('ws://localhost:3000');

    let testedTrack16 = false;
    let testedTrack10 = false;
    let testedTrack3 = false;

    ws.on('open', () => {
        console.log('Connected to server! Requesting sync for Track 16 (Interlagos)...');
        ws.send(JSON.stringify({ action: 'syncTrackLines', trackId: 16 }));
    });

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw);
            if (data.type === 'trackLinesUpdated') {
                const tId = data.trackId;
                const s1D = Math.round(data.sector1?.d || 0);
                const s2D = Math.round(data.sector2?.d || 0);
                console.log(`📡 Received trackLinesUpdated for Track ${tId}: S1 = ${s1D}m, S2 = ${s2D}m`);

                if (tId === 16 && !testedTrack16) {
                    testedTrack16 = true;
                    assert(Math.abs(s1D - 1215) <= 5, `Track 16 S1 should be ~1215m, got ${s1D}m`);
                    assert(Math.abs(s2D - 3161) <= 5, `Track 16 S2 should be ~3161m, got ${s2D}m`);
                    console.log('✅ Track 16 (Interlagos) distance verified: S1 ~1215m, S2 ~3161m');

                    console.log('Requesting sync for Track 10 (Spa)...');
                    ws.send(JSON.stringify({ action: 'syncTrackLines', trackId: 10 }));
                } else if (tId === 10 && !testedTrack10) {
                    testedTrack10 = true;
                    assert(Math.abs(s1D - 2323) <= 10, `Track 10 S1 should be ~2323m, got ${s1D}m`);
                    assert(Math.abs(s2D - 5150) <= 20, `Track 10 S2 should be ~5150m, got ${s2D}m`);
                    console.log('✅ Track 10 (Spa) distance verified: S1 ~2323m, S2 ~5150m');

                    console.log('Requesting sync for Track 3 (Bahrain)...');
                    ws.send(JSON.stringify({ action: 'syncTrackLines', trackId: 3 }));
                } else if (tId === 3 && !testedTrack3) {
                    testedTrack3 = true;
                    assert(Math.abs(s1D - 1800) <= 10, `Track 3 S1 should be ~1800m, got ${s1D}m`);
                    assert(Math.abs(s2D - 4001) <= 10, `Track 3 S2 should be ~4001m, got ${s2D}m`);
                    console.log('✅ Track 3 (Bahrain) distance verified: S1 ~1800m, S2 ~4001m');

                    console.log('🎉 ALL DISTANCE-BASED TRACK SYNCS VERIFIED SUCCESSFULLY!');
                    ws.close();
                    process.exit(0);
                }
            }
        } catch (e) { }
    });

    setTimeout(() => {
        console.error('❌ Test timed out waiting for sync responses');
        process.exit(1);
    }, 6000);
}

testSyncDistance();
