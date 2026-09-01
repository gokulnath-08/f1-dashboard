const { visualTyreNames, visualTyreColors, fallbackTyreNames, flagMap, ersMap } = require('../../config/constants');
const gameState = require('../../state/gameState');
const { touchUdpPacket, setPlayerIndex } = require('../../state/stateHelpers');

function handleCarSetups(data) {
    touchUdpPacket();
    setPlayerIndex(data.m_header);
    const { state } = gameState;
    const setup = data.m_carSetups[state.playerIndex];
    if (setup) {
        state.setup.wingF = setup.m_frontWing !== undefined ? setup.m_frontWing : state.setup.wingF;
        state.setup.wingR = setup.m_rearWing !== undefined ? setup.m_rearWing : state.setup.wingR;
        state.setup.diffOn = setup.m_onThrottle !== undefined ? setup.m_onThrottle : state.setup.diffOn;
        state.setup.diffOff = setup.m_offThrottle !== undefined ? setup.m_offThrottle : state.setup.diffOff;
        state.setup.engineBraking = setup.m_engineBraking !== undefined ? setup.m_engineBraking : state.setup.engineBraking;
        state.setup.camberF = setup.m_frontCamber !== undefined ? setup.m_frontCamber : state.setup.camberF;
        state.setup.camberR = setup.m_rearCamber !== undefined ? setup.m_rearCamber : state.setup.camberR;
        state.setup.toeF = setup.m_frontToe !== undefined ? setup.m_frontToe : state.setup.toeF;
        state.setup.toeR = setup.m_rearToe !== undefined ? setup.m_rearToe : state.setup.toeR;
        state.setup.suspF = setup.m_frontSuspension !== undefined ? setup.m_frontSuspension : state.setup.suspF;
        state.setup.suspR = setup.m_rearSuspension !== undefined ? setup.m_rearSuspension : state.setup.suspR;
        state.setup.arbF = setup.m_frontAntiRollBar !== undefined ? setup.m_frontAntiRollBar : state.setup.arbF;
        state.setup.arbR = setup.m_rearAntiRollBar !== undefined ? setup.m_rearAntiRollBar : state.setup.arbR;
        state.setup.heightF = setup.m_frontSuspensionHeight !== undefined ? setup.m_frontSuspensionHeight : state.setup.heightF;
        state.setup.heightR = setup.m_rearSuspensionHeight !== undefined ? setup.m_rearSuspensionHeight : state.setup.heightR;
        state.setup.bPressure = setup.m_brakePressure !== undefined ? setup.m_brakePressure : state.setup.bPressure;
        state.setup.bBias = setup.m_brakeBias !== undefined ? setup.m_brakeBias : state.setup.bBias;
        state.setup.pressFLeft = setup.m_frontLeftTyrePressure !== undefined ? setup.m_frontLeftTyrePressure : state.setup.pressFLeft;
        state.setup.pressFRight = setup.m_frontRightTyrePressure !== undefined ? setup.m_frontRightTyrePressure : state.setup.pressFRight;
        state.setup.pressRLeft = setup.m_rearLeftTyrePressure !== undefined ? setup.m_rearLeftTyrePressure : state.setup.pressRLeft;
        state.setup.pressRRight = setup.m_rearRightTyrePressure !== undefined ? setup.m_rearRightTyrePressure : state.setup.pressRRight;
        state.setup.ballast = setup.m_ballast !== undefined ? setup.m_ballast : state.setup.ballast;
        state.setup.fuel = setup.m_fuelLoad !== undefined ? setup.m_fuelLoad : state.setup.fuel;
    }
}

function handleCarStatus(data) {
    touchUdpPacket();
    setPlayerIndex(data.m_header);
    const { state, carDataTracker, carPhysics } = gameState;
    const pIdx = state.playerIndex;

    for (let i = 0; i < 22; i++) {
        const s = data.m_carStatusData[i];
        const visual = s.m_visualTyreCompound;
        const actual = s.m_actualTyreCompound;

        carDataTracker[i].tyre = visualTyreNames[visual] || fallbackTyreNames[actual] || 'UNK';
        carDataTracker[i].tyreClass = visualTyreColors[visual] || '#808080';
    }

    const pStat = data.m_carStatusData[pIdx];
    if (pStat) {
        state.car.compound = carDataTracker[pIdx].tyre;
        state.car.flag = flagMap[pStat.m_vehicleFiaFlags] || 'GREEN';
        state.inputs.drsAvailable = pStat.m_drsAllowed === 1;
        state.inputs.drsActivationDistance = (pStat.m_drsActivationDistance !== undefined && Number.isFinite(pStat.m_drsActivationDistance)) ? pStat.m_drsActivationDistance : null;

        // ERS Deep Telemetry & Strategy
        const ersStore = pStat.m_ersStoreEnergy !== undefined ? pStat.m_ersStoreEnergy : 0;
        const ersDeployMode = pStat.m_ersDeployMode !== undefined ? pStat.m_ersDeployMode : 1;
        const ersHarvestMGUK = pStat.m_ersHarvestedThisLapMGUK || 0;
        const ersHarvestMGUH = pStat.m_ersHarvestedThisLapMGUH || 0;
        const ersDeployed = pStat.m_ersDeployedThisLap || 0;
        const batteryPct = Math.min(100, Math.max(0, (ersStore / 4000000) * 100));

        state.ers = {
            storeJoules: ersStore,
            battery: batteryPct,
            mode: ersMap[ersDeployMode] || 'Medium',
            deployModeInt: ersDeployMode,
            harvestedMGUKJoules: ersHarvestMGUK,
            harvestedMGUHJoules: ersHarvestMGUH,
            harvestedTotalJoules: ersHarvestMGUK + ersHarvestMGUH,
            deployedLapJoules: ersDeployed,
            deployedLapPct: Math.min(100, Math.max(0, (ersDeployed / 4000000) * 100)),
            icePower: pStat.m_enginePowerICE || 0,
            mgukPower: pStat.m_enginePowerMGUK || 0,
            ersRecommendation: (batteryPct < 25) ? 'HARVEST (LOW STORE)' : ((batteryPct > 75) ? 'OVERTAKE AVAILABLE' : 'BALANCED')
        };

        // Fuel Deep Telemetry & Strategy
        const fuelInTank = pStat.m_fuelInTank !== undefined ? pStat.m_fuelInTank : (pStat.m_fuelMass || state.setup.fuel || 0);
        const fuelCapacity = pStat.m_fuelCapacity || 110;
        const fuelRemainingLaps = pStat.m_fuelRemainingLaps || 0;
        const fuelMix = pStat.m_fuelMix !== undefined ? pStat.m_fuelMix : 1;
        const fuelMixMap = { 0: 'Lean', 1: 'Standard', 2: 'Rich', 3: 'Max' };

        state.setup.fuel = fuelInTank;
        state.setup.fuelCapacity = fuelCapacity;
        state.setup.fuelLaps = fuelRemainingLaps;
        state.setup.fuelMix = fuelMixMap[fuelMix] || 'Standard';
        state.car.tyreAge = pStat.m_tyresAgeLaps || 0;

        const completedLaps = carPhysics[pIdx].lapNum > 1 ? (carPhysics[pIdx].lapNum - 1) : 0;
        const lapsLeft = state.session.lapsLeft || Math.max(0, (state.session.lapsTotal || 0) - completedLaps);
        const fuelPerLapNeeded = (lapsLeft > 0 && fuelInTank > 0) ? (fuelInTank / lapsLeft) : 0;

        state.fuel = {
            tankKg: fuelInTank,
            capacityKg: fuelCapacity,
            pct: fuelCapacity > 0 ? Math.min(100, Math.max(0, (fuelInTank / fuelCapacity) * 100)) : 0,
            remainingLapsDelta: fuelRemainingLaps,
            mix: fuelMixMap[fuelMix] || 'Standard',
            mixInt: fuelMix,
            lapsLeft: lapsLeft,
            targetBurnPerLap: fuelPerLapNeeded,
            status: fuelRemainingLaps >= 0.3 ? 'SURPLUS' : (fuelRemainingLaps >= -0.15 ? 'OPTIMAL' : 'DEFICIT (LIFT & COAST)')
        };
    }
}

function handleCarDamage(data) {
    touchUdpPacket();
    setPlayerIndex(data.m_header);
    const { state } = gameState;
    const dmg = data.m_carDamageData[state.playerIndex];
    if (dmg) {
        state.car.wear.rl = dmg.m_tyresWear[0];
        state.car.wear.rr = dmg.m_tyresWear[1];
        state.car.wear.fl = dmg.m_tyresWear[2];
        state.car.wear.fr = dmg.m_tyresWear[3];
        state.damage = dmg;
    }
}

module.exports = {
    handleCarSetups,
    handleCarStatus,
    handleCarDamage
};
