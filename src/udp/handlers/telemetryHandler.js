const { teamMap, teamNameMap } = require('../../config/constants');
const gameState = require('../../state/gameState');
const { touchUdpPacket, setPlayerIndex, getParticipantTeamId } = require('../../state/stateHelpers');

function handleCarTelemetry(data) {
    touchUdpPacket();
    setPlayerIndex(data.m_header);
    const { state, carPhysics, carDataTracker } = gameState;
    const pIdx = state.playerIndex;

    for (let i = 0; i < 22; i++) {
        const speed = data.m_carTelemetryData[i].m_speed;
        carPhysics[i].speed = speed;
        if (speed > carDataTracker[i].maxSpeed) carDataTracker[i].maxSpeed = speed;
    }

    const t = data.m_carTelemetryData[pIdx];
    state.inputs.speed = t.m_speed;
    state.inputs.throttle = t.m_throttle * 100;
    state.inputs.steer = t.m_steer;
    state.inputs.brake = t.m_brake * 100;
    state.inputs.clutch = t.m_clutch;
    state.inputs.rpm = t.m_engineRPM;

    const gear = t.m_gear;
    state.inputs.gear = gear === 0 ? 'N' : (gear === -1 ? 'R' : gear);
    state.inputs.drs = t.m_drs === 1 ? 'OPEN' : 'CLOSED';

    state.car.brakeTemp.rl = t.m_brakesTemperature[0];
    state.car.brakeTemp.rr = t.m_brakesTemperature[1];
    state.car.brakeTemp.fl = t.m_brakesTemperature[2];
    state.car.brakeTemp.fr = t.m_brakesTemperature[3];
    state.car.surfTemp.rl = t.m_tyresSurfaceTemperature[0];
    state.car.surfTemp.rr = t.m_tyresSurfaceTemperature[1];
    state.car.surfTemp.fl = t.m_tyresSurfaceTemperature[2];
    state.car.surfTemp.fr = t.m_tyresSurfaceTemperature[3];
    state.car.inTemp.rl = t.m_tyresInnerTemperature[0];
    state.car.inTemp.rr = t.m_tyresInnerTemperature[1];
    state.car.inTemp.fl = t.m_tyresInnerTemperature[2];
    state.car.inTemp.fr = t.m_tyresInnerTemperature[3];
    state.car.press.rl = t.m_tyresPressure[0];
    state.car.press.rr = t.m_tyresPressure[1];
    state.car.press.fl = t.m_tyresPressure[2];
    state.car.press.fr = t.m_tyresPressure[3];
    state.car.engineTemp = t.m_engineTemperature;
}

function handleParticipants(data) {
    touchUdpPacket();
    setPlayerIndex(data.m_header);
    const { state, carDataTracker } = gameState;
    let newNames = [];
    for (let i = 0; i < 22; i++) {
        if (data.m_participants[i]) {
            const p = data.m_participants[i];
            const name = p.m_name ? p.m_name.replace(/\0/g, '').trim() : `CAR ${i}`;
            const teamId = getParticipantTeamId(p);
            const lowerName = name.toLowerCase();

            const isSC = lowerName.includes('safety') || lowerName.includes('medical') || lowerName === 'sc' || lowerName.startsWith('sc ') || (p.m_driverId === 255 && teamId === 255);

            newNames.push(name);
            if (isSC) {
                carDataTracker[i].teamColor = '#FFB000';
                carDataTracker[i].teamName = 'Safety Car';
                carDataTracker[i].isSafetyCar = true;
            } else {
                carDataTracker[i].teamColor = teamMap[teamId] || '#FFFFFF';
                carDataTracker[i].teamName = teamNameMap[teamId] || 'Unknown';
                carDataTracker[i].isSafetyCar = false;
            }
        }
    }
    state.participants = newNames;
}

module.exports = {
    handleCarTelemetry,
    handleParticipants
};
