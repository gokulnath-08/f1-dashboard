const WebSocket = require('ws');

async function testTrackMapLifecycle() {
    console.log('--- TESTING TRACK MAP LIFECYCLE ON REFRESH & SWITCHING ---');
    const ws = new WebSocket('ws://localhost:3000');

    let initialTrackReceived = false;
    let track3Received = false;

    ws.on('open', () => {
        console.log('Connected to server!');
    });

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.type === 'trackDataResponse') {
                console.log(`✅ Received trackDataResponse for trackId ${msg.trackId}:`);
                const pts = msg.data.trackPoints || [];
                console.log(`   Points count: ${pts.length}, has startLine: ${Boolean(msg.data.startLine)}`);
                if (!initialTrackReceived) {
                    initialTrackReceived = true;
                    if (pts.length < 20) {
                        console.error('❌ FAIL: Track points count is less than 20!');
                        process.exit(1);
                    }
                    console.log('   (Simulating user selecting another track: Track 3 / Sakhir)');
                    ws.send(JSON.stringify({ action: 'getTrackData', trackId: 3 }));
                } else if (!track3Received) {
                    track3Received = true;
                    if (msg.trackId === 3 && pts.length >= 20) {
                        console.log('✅ Track 3 preview successfully returned and verified!');
                        console.log('🎉 ALL TRACK MAP LIFECYCLE TESTS PASSED!');
                        ws.close();
                        process.exit(0);
                    } else {
                        console.error('❌ FAIL: Track 3 returned invalid data:', msg);
                        process.exit(1);
                    }
                }
            }
        } catch (e) { }
    });

    setTimeout(() => {
        if (!initialTrackReceived) {
            console.error('❌ FAIL: Timed out waiting for trackDataResponse on connect!');
            process.exit(1);
        }
    }, 4000);
}

testTrackMapLifecycle();
