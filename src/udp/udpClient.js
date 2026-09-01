const { F1TelemetryClient } = require('@deltazeroproduction/f1-udp-parser');
const { UDP_PORT } = require('../config');
const { handleMotion, handleMotionEx } = require('./handlers/motionHandler');
const { handleSession, handleEvent } = require('./handlers/sessionHandler');
const { handleSessionHistory, handleLapData } = require('./handlers/lapDataHandler');
const { handleCarSetups, handleCarStatus, handleCarDamage } = require('./handlers/carStatusHandler');
const { handleCarTelemetry, handleParticipants } = require('./handlers/telemetryHandler');

let f1Client = null;

function initUdpClient(port = UDP_PORT) {
    f1Client = new F1TelemetryClient({ port, format: 2025 });

    if (f1Client && typeof f1Client.on === 'function') {
        f1Client.on('error', (err) => {
            console.error('🛡️ [F1 UDP Client Error]:', err?.message || err);
        });

        f1Client.on('motion', handleMotion);
        f1Client.on('motionEx', handleMotionEx);
        f1Client.on('session', handleSession);
        f1Client.on('event', handleEvent);
        f1Client.on('sessionHistory', handleSessionHistory);
        f1Client.on('lapData', handleLapData);
        f1Client.on('participants', handleParticipants);
        f1Client.on('carSetups', handleCarSetups);
        f1Client.on('carTelemetry', handleCarTelemetry);
        f1Client.on('carStatus', handleCarStatus);
        f1Client.on('carDamage', handleCarDamage);
    }

    return f1Client;
}

module.exports = {
    initUdpClient,
    get f1Client() { return f1Client; }
};
