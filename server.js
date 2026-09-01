// --- Process Crash Guards ---
process.on('uncaughtException', (err, origin) => {
    console.error('🛡️ [Process Guard] Uncaught Exception:', err?.message || err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🛡️ [Process Guard] Unhandled Rejection:', reason);
});

// --- Modular Subsystems ---
const { PORT, UDP_PORT, hz } = require('./src/config');
const { initDirectories } = require('./src/utils/fileSystem');
const { displayAllLocalIPv4 } = require('./src/utils/network');
const { createHttpServer } = require('./src/http/httpServer');
const { initWebSocketServer } = require('./src/websocket/wsServer');
const { startBroadcastLoop } = require('./src/services/broadcastService');
const { initUdpClient } = require('./src/udp/udpClient');

// 1. Initialize file system storage directories
initDirectories();

// 2. Initialize HTTP Server
const server = createHttpServer();

// 3. Initialize WebSocket Servers (Port 3000 & Legacy Port 8085)
initWebSocketServer(server);

// 4. Start Live Broadcast Streaming Loop (Configured Hz)
startBroadcastLoop();

// 5. Initialize & Start F1 Telemetry UDP Client
const f1Client = initUdpClient(UDP_PORT);
f1Client.start();
console.log(`🏎️  UNIFIED COMMAND CENTER ONLINE (${hz}Hz)`);
console.log(`Listening for UDP on port ${UDP_PORT}...`);

// 6. Start HTTP Server Listener
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on all IPs at port ${PORT}`);
    displayAllLocalIPv4();
});

module.exports = server;
