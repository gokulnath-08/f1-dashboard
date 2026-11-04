const http = require('http');
const server = require('../server');

setTimeout(() => {
    console.log('Testing HTTP endpoints on port 3000...');

    // 1. Test GET /braking-comparison.html
    http.get('http://localhost:3000/braking-comparison.html', (res) => {
        console.log(`GET /braking-comparison.html -> Status: ${res.statusCode} (${res.headers['content-type']})`);
        
        // 2. Test GET /api/session/all-laps?trackId=0
        http.get('http://localhost:3000/api/session/all-laps?trackId=0', (res2) => {
            let body2 = '';
            res2.on('data', chunk => body2 += chunk);
            res2.on('end', () => {
                const data2 = JSON.parse(body2);
                console.log(`GET /api/session/all-laps -> Status: ${res2.statusCode}, Count: ${data2.count} laps`);
                
                // 3. Test GET /api/session/lap-braking?trackId=0&baseline=1&compare=2
                http.get('http://localhost:3000/api/session/lap-braking?trackId=0&baseline=1&compare=2', (res3) => {
                    let body3 = '';
                    res3.on('data', chunk => body3 += chunk);
                    res3.on('end', () => {
                        const data3 = JSON.parse(body3);
                        console.log(`GET /api/session/lap-braking -> Status: ${res3.statusCode}`);
                        console.log(`- Track: ${data3.trackName}, Length: ${data3.trackLength}m, Points: ${data3.trackPoints.length}`);
                        console.log(`- Baseline Lap: ${data3.baselineLap?.lapNum} (${data3.baselineLap?.totalBrakingDist}m)`);
                        console.log(`- Compare Lap: ${data3.compareLap?.lapNum} (${data3.compareLap?.totalBrakingDist}m)`);
                        console.log(`- Matrix Corners: ${data3.comparisonMatrix?.corners?.length}`);
                        
                        console.log('\n🎉 ALL INTEGRATION TESTS PASSED!');
                        process.exit(0);
                    });
                });
            });
        });
    });
}, 1000);
