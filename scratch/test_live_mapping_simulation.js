const WebSocket = require('ws');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

async function testLiveMappingSimulation() {
    console.log('--- TESTING UNMAPPED TRACK SWITCH & LIVE RECORDING SIMULATION ---');
    const ws = new WebSocket('ws://localhost:3000');
    const udp = dgram.createSocket('udp4');

    let receivedEmptyTrack88 = false;
    let receivedRecordingProgress = false;
    let receivedCompletedTrack88 = false;

    ws.on('open', () => {
        console.log('WebSocket connected! Simulating F1 game session for unmapped Track 88...');
        // Send PacketSessionData (Packet ID 1) for Track 88
        const sessionPacket = Buffer.alloc(1400);
        // Header
        sessionPacket.writeUInt16LE(2024, 0); // packetFormat
        sessionPacket.writeUInt8(1, 2); // gameYear
        sessionPacket.writeUInt8(1, 3); // gameMajorVersion
        sessionPacket.writeUInt8(0, 4); // gameMinorVersion
        sessionPacket.writeUInt8(0, 5); // packetVersion
        sessionPacket.writeUInt8(1, 6); // packetId: PacketSessionData
        sessionPacket.writeBigUInt64LE(123456789n, 7); // sessionUID
        sessionPacket.writeFloatLE(100.0, 15); // sessionTime
        sessionPacket.writeUInt32LE(1, 19); // frameIdentifier
        sessionPacket.writeUInt8(0, 23); // playerCarIndex
        sessionPacket.writeUInt8(0, 24); // secondaryPlayerCarIndex

        // PacketSessionData fields
        sessionPacket.writeUInt8(0, 25); // weather
        sessionPacket.writeInt8(30, 26); // trackTemp
        sessionPacket.writeInt8(25, 27); // airTemp
        sessionPacket.writeUInt8(50, 28); // totalLaps
        sessionPacket.writeUInt16LE(5000, 29); // trackLength
        sessionPacket.writeUInt8(10, 31); // sessionType
        sessionPacket.writeInt8(88, 32); // m_trackId: 88 (Unmapped Track)

        udp.send(sessionPacket, 20777, '127.0.0.1');
    });

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw);
            if (data.type === 'trackDataResponse' && data.trackId === 88 && (!data.data?.trackPoints || data.data.trackPoints.length === 0)) {
                if (!receivedEmptyTrack88) {
                    receivedEmptyTrack88 = true;
                    console.log('✅ PASS: Server broadcasted EMPTY trackDataResponse for unmapped Track 88! Old track cleared.');
                    startSimulatingMotion();
                }
            } else if (data.type === 'trackRecordingProgress' && data.trackId === 88) {
                if (!receivedRecordingProgress) {
                    receivedRecordingProgress = true;
                    console.log(`✅ PASS: Received trackRecordingProgress! Points count: ${data.pointsCount}`);
                }
            } else if (data.type === 'trackDataResponse' && data.trackId === 88 && data.data?.trackPoints?.length >= 50) {
                if (!receivedCompletedTrack88) {
                    receivedCompletedTrack88 = true;
                    console.log(`🎉 SUCCESS: Track 88 fully mapped, closed and saved! Total points: ${data.data.trackPoints.length}`);
                    cleanupAndExit();
                }
            }
        } catch (e) { }
    });

    function startSimulatingMotion() {
        console.log('Simulating car driving around Track 88...');
        // Generate a circle of 80 points with radius 200m
        let step = 0;
        const totalSteps = 85;
        const interval = setInterval(() => {
            if (step >= totalSteps || receivedCompletedTrack88) {
                clearInterval(interval);
                return;
            }
            const angle = (step / 80) * 2 * Math.PI;
            const x = Math.cos(angle) * 200;
            const z = Math.sin(angle) * 200;

            const motionPacket = Buffer.alloc(1500);
            motionPacket.writeUInt16LE(2024, 0);
            motionPacket.writeUInt8(1, 2);
            motionPacket.writeUInt8(1, 3);
            motionPacket.writeUInt8(0, 4);
            motionPacket.writeUInt8(0, 5);
            motionPacket.writeUInt8(0, 6); // packetId: PacketMotionData
            motionPacket.writeBigUInt64LE(123456789n, 7);
            motionPacket.writeFloatLE(100.0 + step * 0.1, 15);
            motionPacket.writeUInt32LE(step + 10, 19);
            motionPacket.writeUInt8(0, 23);

            // Car 0 motion: 25th byte onwards
            // m_worldPositionX (float at 25), m_worldPositionY (29), m_worldPositionZ (33)
            motionPacket.writeFloatLE(x, 25);
            motionPacket.writeFloatLE(0.0, 29);
            motionPacket.writeFloatLE(z, 33);
            // m_yaw (float at 53)
            motionPacket.writeFloatLE(angle, 53);

            // Also send telemetry packet to simulate car speed = 150 km/h so speed > 15
            const telPacket = Buffer.alloc(1400);
            telPacket.writeUInt16LE(2024, 0);
            telPacket.writeUInt8(1, 2);
            telPacket.writeUInt8(1, 3);
            telPacket.writeUInt8(0, 4);
            telPacket.writeUInt8(0, 5);
            telPacket.writeUInt8(6, 6); // packetId: PacketCarTelemetryData
            telPacket.writeBigUInt64LE(123456789n, 7);
            telPacket.writeFloatLE(100.0 + step * 0.1, 15);
            telPacket.writeUInt32LE(step + 10, 19);
            telPacket.writeUInt8(0, 23);

            // Car 0 speed: uint16 at 25
            telPacket.writeUInt16LE(150, 25);

            udp.send(telPacket, 20777, '127.0.0.1');
            udp.send(motionPacket, 20777, '127.0.0.1');

            step++;
        }, 40);
    }

    function cleanupAndExit() {
        const testFile = path.join(__dirname, '../track_maps/track_88.json');
        if (fs.existsSync(testFile)) {
            try { fs.unlinkSync(testFile); } catch (e) { }
            console.log('Cleaned up temporary test file track_88.json');
        }
        ws.close();
        udp.close();
        process.exit(0);
    }

    setTimeout(() => {
        if (!receivedCompletedTrack88) {
            console.error('❌ Test timed out before mapping completed');
            const testFile = path.join(__dirname, '../track_maps/track_88.json');
            if (fs.existsSync(testFile)) {
                try { fs.unlinkSync(testFile); } catch (e) { }
            }
            ws.close();
            udp.close();
            process.exit(1);
        }
    }, 10000);
}

testLiveMappingSimulation();
