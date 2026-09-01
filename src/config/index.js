const path = require('path');

const PORT = 3000;
const LEGACY_WS_PORT = 8085;
const UDP_PORT = 20777;

// Root workspace directory
const rootDir = path.resolve(__dirname, '..', '..');

// Parse the tick rate from command line arguments (default: 20Hz)
const args = process.argv.slice(2);
let hz = parseInt(args[0], 10);
const validHz = [10, 20, 30, 60];
if (!validHz.includes(hz)) {
    hz = 20;
}
const intervalMs = Math.round(1000 / hz);

// File system directory paths
const trackMapsDir = path.join(rootDir, 'track_maps');
const lapTimeDir = path.join(rootDir, 'laptime');
const telemetryDir = path.join(rootDir, 'telemetry');
const setupsDir = path.join(rootDir, 'setups');
const sessionTelemetryDir = path.join(rootDir, 'session_telemetry');
const fastestJsonPath = path.join(lapTimeDir, 'fastest.json');

const IGNORED_SCAN_DIRS = new Set(['node_modules', '.git', '.agents', 'telemetry', 'track_maps', 'laptime', 'setups', 'session_telemetry', 'backup', 'scratch', 'css', 'js', 'src']);

module.exports = {
    PORT,
    LEGACY_WS_PORT,
    UDP_PORT,
    rootDir,
    hz,
    validHz,
    intervalMs,
    trackMapsDir,
    lapTimeDir,
    telemetryDir,
    setupsDir,
    sessionTelemetryDir,
    fastestJsonPath,
    IGNORED_SCAN_DIRS
};
