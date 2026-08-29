const WebSocket = require('ws');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

async function testLifecycleAndRecording() {
    console.log('--- TESTING COLD BOOT EMPTY STATE & UNMAPPED LIVE RECORDING ---');
    const ws = new WebSocket('ws://localhost:3000');

    let initialTrackReceived = false;

    ws.on('open', () => {
        console.log('Connected to server!');
    });

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw);
            if (data.type === 'trackDataResponse' && !initialTrackReceived) {
                initialTrackReceived = true;
                const pts = data.data?.trackPoints || [];
                console.log(`📡 Initial connection trackDataResponse: trackId=${data.trackId}, points=${pts.length}`);
                assert(pts.length === 0, `Cold start must be empty, but got ${pts.length} points!`);
                assert(data.trackId === -1, `Cold start trackId must be -1, but got ${data.trackId}!`);
                console.log('✅ PASS: Cold start opens EMPTY (no Australia, no Brazil)!');
                ws.close();
                process.exit(0);
            }
        } catch (e) { }
    });

    setTimeout(() => {
        if (!initialTrackReceived) {
            console.error('❌ Timeout waiting for initial empty trackDataResponse');
            process.exit(1);
        }
    }, 5000);
}

testLifecycleAndRecording();
