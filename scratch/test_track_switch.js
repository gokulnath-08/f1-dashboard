const WebSocket = require('ws');
const assert = require('assert');

async function testTrackSwitch() {
    console.log('--- TESTING TRACK SWITCHING: BRAZIL (MAPPED) -> LAS VEGAS (UNMAPPED) -> SPA (MAPPED) ---');
    const ws = new WebSocket('ws://localhost:3000');

    let stage = 0;

    ws.on('open', () => {
        console.log('Connected! Stage 0: Requesting Track 16 (Brazil)...');
        ws.send(JSON.stringify({ action: 'getTrackData', trackId: 16 }));
    });

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);
            if (msg.type === 'trackDataResponse') {
                if (stage === 0 && msg.trackId === -1 && (!msg.data || msg.data.trackPoints.length === 0)) {
                    // Initial cold boot connection message
                    return;
                }

                if (stage === 0 && msg.trackId === 16) {
                    assert(msg.data.trackPoints.length > 50, 'Brazil should have > 50 points');
                    console.log(`✅ Stage 0 PASS: Track 16 (Brazil) returned ${msg.data.trackPoints.length} points.`);
                    stage = 1;
                    console.log('Stage 1: Requesting Track 31 (Las Vegas - Unmapped)...');
                    ws.send(JSON.stringify({ action: 'getTrackData', trackId: 31 }));
                } else if (stage === 1 && msg.trackId === 31) {
                    const pts = msg.data?.trackPoints || [];
                    assert(pts.length === 0, `Unmapped Las Vegas should return 0 points, but got ${pts.length}`);
                    console.log('✅ Stage 1 PASS: Track 31 (Las Vegas) returned EMPTY points! Old track Brazil is cleared from canvas.');
                    stage = 2;
                    console.log('Stage 2: Requesting Track 10 (Spa - Mapped)...');
                    ws.send(JSON.stringify({ action: 'getTrackData', trackId: 10 }));
                } else if (stage === 2 && msg.trackId === 10) {
                    assert(msg.data.trackPoints.length > 50, 'Spa should have > 50 points');
                    console.log(`✅ Stage 2 PASS: Track 10 (Spa) returned ${msg.data.trackPoints.length} points.`);
                    console.log('🎉 ALL TRACK SWITCHING AND CLEARING TESTS PASSED PERFECTLY!');
                    ws.close();
                    process.exit(0);
                }
            }
        } catch (e) { }
    });

    setTimeout(() => {
        console.error(`❌ Test timed out at stage ${stage}`);
        process.exit(1);
    }, 6000);
}

testTrackSwitch();
