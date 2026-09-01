const os = require('os');
const { PORT } = require('../config');

/**
 * Helper to display all available local network IP addresses for the dashboard server.
 */
function displayAllLocalIPv4() {
    const interfaces = os.networkInterfaces();
    console.log('\n📡 --- Available Network Dashboards ---');

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                console.log(`➡️  ${name}: http://${iface.address}:${PORT}`);
            }
        }
    }
    console.log(`➡️  Localhost: http://localhost:${PORT}`);
    console.log('--------------------------------------\n');
}

module.exports = {
    displayAllLocalIPv4
};
