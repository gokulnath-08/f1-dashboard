const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

async function runTests() {
    console.log('=== TESTING SERVER-SIDE CUSTOM TARGET PERSISTENCE & SYNC ===\n');

    // Test 1: GET /api/custom-targets
    console.log('1. Testing GET /api/custom-targets...');
    const initial = await new Promise((resolve, reject) => {
        http.get('http://localhost:3000/api/custom-targets', (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(JSON.parse(body)));
        }).on('error', reject);
    });
    console.log('   Initial server response:', initial);

    // Test 2: POST /api/custom-targets to save a shared target
    console.log('\n2. Testing POST /api/custom-targets (Device A sets target 1:23.456)...');
    const testPayload = {
        targets: {
            "2": {
                trackId: 2,
                trackName: "Silverstone Circuit",
                enabled: true,
                lapMs: 83456,
                s1Ms: 25000,
                s2Ms: 33456,
                s3Ms: 25000,
                showOnDdu: true,
                celebrate: true,
                updatedAt: Date.now()
            }
        },
        permanentTarget: {
            trackId: -1,
            trackName: "Shared Permanent Target",
            enabled: true,
            lapMs: 83456,
            s1Ms: 25000,
            s2Ms: 33456,
            s3Ms: 25000,
            showOnDdu: true,
            celebrate: true,
            updatedAt: Date.now()
        }
    };

    const postResult = await new Promise((resolve, reject) => {
        const req = http.request('http://localhost:3000/api/custom-targets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(JSON.parse(body)));
        });
        req.on('error', reject);
        req.write(JSON.stringify(testPayload));
        req.end();
    });

    console.log('   POST Response:', postResult.success ? 'SUCCESS' : 'FAILED');

    // Test 3: Verify disk persistence in laptime/custom_targets.json
    console.log('\n3. Verifying custom_targets.json file on disk...');
    const targetFilePath = path.join(__dirname, '..', 'laptime', 'custom_targets.json');
    if (!fs.existsSync(targetFilePath)) {
        throw new Error(`File ${targetFilePath} does not exist!`);
    }
    const diskContent = JSON.parse(fs.readFileSync(targetFilePath, 'utf8'));
    console.log('   Disk permanentTarget lapMs:', diskContent.permanentTarget?.lapMs);
    if (diskContent.permanentTarget?.lapMs !== 83456) {
        throw new Error('Disk file content does not match expected lapMs!');
    }
    console.log('   ✓ File verified on disk (persistent even after server reboot)!');

    // Test 4: Device B connects via WebSocket (simulating another user on WiFi link)
    console.log('\n4. Simulating Device B (e.g. phone/tablet) connecting via WebSocket...');
    const wsClient = new WebSocket('ws://localhost:3000');

    await new Promise((resolve, reject) => {
        wsClient.on('open', () => {
            console.log('   Device B connected to WebSocket.');
        });

        wsClient.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw);
                if (msg.type === 'customTargetsData') {
                    console.log('   Device B received customTargetsData immediately upon connection:');
                    console.log('   Permanent Target Lap:', msg.permanentTarget?.lapMs, 'ms (Enabled:', msg.permanentTarget?.enabled, ')');
                    if (msg.permanentTarget?.lapMs === 83456) {
                        console.log('   ✓ Device B automatically has the shared permanent target!');
                        wsClient.close();
                        resolve();
                    }
                }
            } catch (e) { }
        });

        wsClient.on('error', reject);
        setTimeout(() => reject(new Error('Timeout waiting for customTargetsData')), 4000);
    });

    console.log('\n✨ ALL SERVER PERSISTENCE & MULTI-DEVICE TESTS PASSED!');
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
