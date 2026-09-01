// --- G-Force Processing (In-Memory Only) ---
const gForceData = {
    maxGSeen: 0,
    envelopeArray: [],
    history: []
};
const gEnvelopeSetServer = new Set();
const MAX_REASONABLE_SENSOR_G_SERVER = 8;
const MAX_ENVELOPE_POINTS_SERVER = 30;

function processServerGForce(gLat, gLong, gVert) {
    if (gLat === 0 && gLong === 0 && gVert === 0) return;
    const sensorG = Math.hypot(gLat, gLong, gVert);
    if (sensorG > MAX_REASONABLE_SENSOR_G_SERVER) return;

    if (sensorG > gForceData.maxGSeen) {
        gForceData.maxGSeen = sensorG;
    }

    const qLat = Math.round(gLat * 10) / 10;
    const qLong = Math.round(gLong * 10) / 10;
    const key = `${qLat},${qLong}`;

    if (!gEnvelopeSetServer.has(key)) {
        gEnvelopeSetServer.add(key);
        gForceData.envelopeArray.push({ lat: qLat, long: qLong });
        if (gForceData.envelopeArray.length > MAX_ENVELOPE_POINTS_SERVER) {
            const removed = gForceData.envelopeArray.shift();
            if (removed) gEnvelopeSetServer.delete(`${removed.lat},${removed.long}`);
        }
    }

    gForceData.history.push({ lat: gLat, long: gLong, total: sensorG });
    if (gForceData.history.length > 30) {
        gForceData.history.shift();
    }
}

function resetGForceData() {
    gForceData.maxGSeen = 0;
    gForceData.envelopeArray.length = 0;
    gForceData.history.length = 0;
    gEnvelopeSetServer.clear();
}

module.exports = {
    gForceData,
    gEnvelopeSetServer,
    processServerGForce,
    resetGForceData
};
