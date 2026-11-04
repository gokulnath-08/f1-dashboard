const fs = require('fs');
const path = require('path');
const { trackMapsDir, lapTimeDir, telemetryDir, setupsDir, sessionTelemetryDir } = require('../config');
const { trackMap } = require('../config/constants');
const gameState = require('../state/gameState');
const { formatMsExport, formatSectorMs } = require('../utils/formatters');

/**
 * Scans telemetry, laptime records, track maps, and session telemetry to return a complete list of all available circuits.
 */
function getAvailableTelemetryTracks() {
    const { allTimeFastest } = gameState;
    let trackMapList = new Map();

    // Helper to get or init circuit entry
    function getOrCreate(trackId) {
        const id = parseInt(trackId, 10);
        if (!trackMapList.has(id)) {
            const name = (typeof trackMap !== 'undefined' && trackMap[id]) ? trackMap[id] : `Track ${id}`;
            const record = allTimeFastest[id] || null;
            trackMapList.set(id, {
                id: id,
                name: name,
                file: `telemetry_${id}.json`,
                url: `/telemetry/telemetry_${id}.json`,
                sizeBytes: 0,
                points: 0,
                lapTimeMs: record ? record.time : null,
                driver: record ? record.driver : 'Unknown',
                hasTelemetry: false,
                hasLaptime: false,
                hasTrackMap: false,
                hasSessionDriverLaps: false
            });
        }
        return trackMapList.get(id);
    }

    // 1. Scan telemetry directory
    try {
        if (fs.existsSync(telemetryDir)) {
            const files = fs.readdirSync(telemetryDir);
            for (const file of files) {
                const match = file.match(/^telemetry_(\d+)\.json$/i);
                if (match) {
                    const trackId = parseInt(match[1], 10);
                    const item = getOrCreate(trackId);
                    const filePath = path.join(telemetryDir, file);
                    try {
                        const stat = fs.statSync(filePath);
                        item.sizeBytes = stat.size;
                        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        if (Array.isArray(content) && content.length > 0) {
                            item.points = content.length;
                            item.hasTelemetry = true;
                            if (!item.lapTimeMs && content[content.length - 1].t > 0) {
                                item.lapTimeMs = content[content.length - 1].t;
                            }
                        }
                    } catch (e) { }
                }
            }
        }
    } catch (e) {
        console.error('⚠️ [Telemetry Tracks Error]:', e.message);
    }

    // 2. Scan laptime directory
    try {
        if (fs.existsSync(lapTimeDir)) {
            const files = fs.readdirSync(lapTimeDir);
            for (const file of files) {
                const match = file.match(/^fastest_(\d+)\.json$/i);
                if (match) {
                    const trackId = parseInt(match[1], 10);
                    const item = getOrCreate(trackId);
                    item.hasLaptime = true;
                    item.laptimeUrl = `/laptime/${file}`;
                    if (!item.lapTimeMs) {
                        try {
                            const raw = JSON.parse(fs.readFileSync(path.join(lapTimeDir, file), 'utf8'));
                            const pts = Array.isArray(raw) ? raw : (raw.telemetry || []);
                            if (pts.length > 0 && pts[pts.length - 1].t > 0) {
                                item.lapTimeMs = pts[pts.length - 1].t;
                            }
                        } catch (e) { }
                    }
                }
            }
        }
    } catch (e) { }

    // 3. Scan track_maps directory
    try {
        if (fs.existsSync(trackMapsDir)) {
            const files = fs.readdirSync(trackMapsDir);
            for (const file of files) {
                const match = file.match(/^track_(\d+)\.json$/i);
                if (match) {
                    const trackId = parseInt(match[1], 10);
                    const item = getOrCreate(trackId);
                    item.hasTrackMap = true;
                    item.trackMapUrl = `/track_maps/${file}`;
                }
            }
        }
    } catch (e) { }

    // 4. Scan session_telemetry directory for stored driver laps
    try {
        if (fs.existsSync(sessionTelemetryDir)) {
            const files = fs.readdirSync(sessionTelemetryDir);
            for (const file of files) {
                const match = file.match(/fastest_car_(\d+)_track_(\d+)\.json$/i);
                if (match) {
                    const trackId = parseInt(match[2], 10);
                    const item = getOrCreate(trackId);
                    item.hasTelemetry = true;
                    item.hasSessionDriverLaps = true;
                }
            }
        }
    } catch (e) { }

    // 5. Incorporate all records from allTimeFastest
    for (const [tIdStr, rec] of Object.entries(allTimeFastest)) {
        const item = getOrCreate(tIdStr);
        if (rec) {
            item.lapTimeMs = rec.time || item.lapTimeMs;
            item.driver = rec.driver || item.driver;
            if (rec.hasTelemetry) item.hasTelemetry = true;
        }
    }

    const tracks = Array.from(trackMapList.values());
    tracks.sort((a, b) => a.name.localeCompare(b.name));
    return tracks;
}

/**
 * Retrieves all saved JSON driver fastest lap files for a specific track.
 */
function getTrackDriverFastestLaps(trackId) {
    const tId = parseInt(trackId, 10);
    const laps = [];

    // 1. If active game session is currently on this track, use in-memory session laps
    if (gameState.currentTrackId === tId && Array.isArray(gameState.sessionDriverFastestLaps)) {
        const liveLaps = gameState.sessionDriverFastestLaps.filter(Boolean);
        if (liveLaps.length > 0) {
            return liveLaps;
        }
    }

    // 2. Scan session_telemetry directory on disk for fastest_car_*_track_${tId}.json
    try {
        if (fs.existsSync(sessionTelemetryDir)) {
            const files = fs.readdirSync(sessionTelemetryDir);
            for (const file of files) {
                const match = file.match(new RegExp(`^fastest_car_(\\d+)_track_${tId}\\.json$`, 'i'));
                if (match) {
                    try {
                        const content = JSON.parse(fs.readFileSync(path.join(sessionTelemetryDir, file), 'utf8'));
                        if (content && content.lapTimeMs > 0 && Array.isArray(content.telemetry)) {
                            laps.push(content);
                        }
                    } catch (e) { }
                }
            }
        }
    } catch (e) { }

    if (laps.length > 0) {
        laps.sort((a, b) => a.lapTimeMs - b.lapTimeMs);
        return laps;
    }

    // 3. Fallback: Check if telemetry/telemetry_${tId}.json exists and return benchmark lap
    try {
        const telPath = path.join(telemetryDir, `telemetry_${tId}.json`);
        if (fs.existsSync(telPath)) {
            const raw = JSON.parse(fs.readFileSync(telPath, 'utf8'));
            if (Array.isArray(raw) && raw.length > 20) {
                const lapTime = raw[raw.length - 1].t || 80000;
                const rec = gameState.allTimeFastest[tId];
                const dName = (rec && rec.driver) ? rec.driver : 'Record Holder';

                laps.push({
                    carIndex: 0,
                    driverName: dName,
                    teamName: 'Track Record',
                    teamColor: '#00F0FF',
                    lapTimeMs: lapTime,
                    lapNum: 1,
                    s1: rec ? rec.s1 : Math.round(lapTime * 0.3),
                    s2: rec ? rec.s2 : Math.round(lapTime * 0.38),
                    s3: rec ? rec.s3 : Math.round(lapTime * 0.32),
                    telemetry: raw,
                    timestamp: Date.now()
                });
            }
        }
    } catch (e) { }

    return laps;
}

/**
 * Builds a structured, complete, exhaustive JSON snapshot of all session data:
 * - Every lap with sector 1, sector 2, sector 3 times and validation flags for all 22 cars
 * - Flat lap-by-lap table for easy data science / CSV export
 * - Tyre stint strategies
 * - Full 20Hz telemetry traces (speed, throttle, brake, gears, RPM, DRS, distance, G-forces)
 * - Complete setup, damage, steward offenses, track geometry, and weather forecasts.
 */
/**
 * Normalizes and enriches a car setup object so that all 25+ parameters used
 * in the 7 Car Setup tab cards are present, structured, and dual-formatted (raw numbers + formatted strings).
 */
function getFullCarSetupObject(rawSetup, baseFuel = 0, fuelCapacity = 110, fuelMix = 'Standard', fuelLaps = 0, nextFrontWing = null) {
    const raw = rawSetup || {};

    const wingF = Number.isFinite(raw.wingF) ? raw.wingF : (raw.m_frontWing ?? 0);
    const wingR = Number.isFinite(raw.wingR) ? raw.wingR : (raw.m_rearWing ?? 0);
    const totalAero = (wingF + wingR) || 1;
    const aeroBiasVal = Number(((wingF / totalAero) * 100).toFixed(1));

    const diffOn = Number.isFinite(raw.diffOn) ? raw.diffOn : (raw.m_onThrottle ?? 50);
    const diffOff = Number.isFinite(raw.diffOff) ? raw.diffOff : (raw.m_offThrottle ?? 50);
    const engineBraking = Number.isFinite(raw.engineBraking) ? raw.engineBraking : (raw.m_engineBraking ?? 100);

    const camberF = Number(Number.isFinite(raw.camberF) ? raw.camberF : (raw.m_frontCamber ?? 0));
    const camberR = Number(Number.isFinite(raw.camberR) ? raw.camberR : (raw.m_rearCamber ?? 0));
    const toeF = Number(Number.isFinite(raw.toeF) ? raw.toeF : (raw.m_frontToe ?? 0));
    const toeR = Number(Number.isFinite(raw.toeR) ? raw.toeR : (raw.m_rearToe ?? 0));

    const suspF = Number.isFinite(raw.suspF) ? raw.suspF : (raw.m_frontSuspension ?? 0);
    const suspR = Number.isFinite(raw.suspR) ? raw.suspR : (raw.m_rearSuspension ?? 0);
    const arbF = Number.isFinite(raw.arbF) ? raw.arbF : (raw.m_frontAntiRollBar ?? 0);
    const arbR = Number.isFinite(raw.arbR) ? raw.arbR : (raw.m_rearAntiRollBar ?? 0);
    const heightF = Number.isFinite(raw.heightF) ? raw.heightF : (raw.m_frontSuspensionHeight ?? 0);
    const heightR = Number.isFinite(raw.heightR) ? raw.heightR : (raw.m_rearSuspensionHeight ?? 0);

    const bPressure = Number.isFinite(raw.bPressure) ? raw.bPressure : (raw.m_brakePressure ?? 100);
    const bBias = Number.isFinite(raw.bBias) ? raw.bBias : (raw.m_brakeBias ?? 50);

    const pressFLeft = Number(Number.isFinite(raw.pressFLeft) ? raw.pressFLeft : (raw.m_frontLeftTyrePressure ?? 0));
    const pressFRight = Number(Number.isFinite(raw.pressFRight) ? raw.pressFRight : (raw.m_frontRightTyrePressure ?? 0));
    const pressRLeft = Number(Number.isFinite(raw.pressRLeft) ? raw.pressRLeft : (raw.m_rearLeftTyrePressure ?? 0));
    const pressRRight = Number(Number.isFinite(raw.pressRRight) ? raw.pressRRight : (raw.m_rearRightTyrePressure ?? 0));

    const ballast = Number.isFinite(raw.ballast) ? raw.ballast : (raw.m_ballast ?? 0);
    const fuelVal = Number(Number.isFinite(raw.fuel) ? raw.fuel : (raw.m_fuelLoad ?? baseFuel ?? 0));
    const fuelLapsVal = Number(Number.isFinite(raw.fuelLaps) ? raw.fuelLaps : (fuelLaps ?? 0));
    const fuelCapVal = Number(Number.isFinite(raw.fuelCapacity) ? raw.fuelCapacity : (fuelCapacity ?? 110));
    const fuelMixVal = raw.fuelMix || fuelMix || 'Standard';
    const nextWingVal = (raw.nextFrontWingValue !== undefined && raw.nextFrontWingValue !== null)
        ? raw.nextFrontWingValue
        : (nextFrontWing !== null ? nextFrontWing : null);

    const fuelLapsSign = fuelLapsVal >= 0 ? '+' : '';

    return {
        // Tab Card 1: Aerodynamics
        wingF,
        wingR,
        aeroBiasPercent: aeroBiasVal,
        aeroBiasFormatted: `${aeroBiasVal}% Front`,

        // Tab Card 2: Transmission & Diff
        diffOn,
        diffOnFormatted: `${diffOn}%`,
        diffOff,
        diffOffFormatted: `${diffOff}%`,
        engineBraking,
        engineBrakingFormatted: `${engineBraking}%`,

        // Tab Card 3: Suspension Geometry
        camberF,
        camberFFormatted: `${camberF.toFixed(2)}°`,
        camberR,
        camberRFormatted: `${camberR.toFixed(2)}°`,
        toeF,
        toeFFormatted: `${toeF.toFixed(2)}°`,
        toeR,
        toeRFormatted: `${toeR.toFixed(2)}°`,

        // Tab Card 4: Suspension & Heights
        suspF,
        suspR,
        suspensionFormatted: `${suspF} / ${suspR}`,
        arbF,
        arbR,
        antiRollBarsFormatted: `${arbF} / ${arbR}`,
        heightF,
        heightR,
        rideHeightFormatted: `${heightF} / ${heightR}`,

        // Tab Card 5: Brakes & Bias
        bBias,
        bBiasFormatted: `${bBias}%`,
        bPressure,
        bPressureFormatted: `${bPressure}%`,

        // Tab Card 6: Cold Setup Pressures
        pressFLeft,
        pressFLeftFormatted: `${pressFLeft.toFixed(1)} psi`,
        pressFRight,
        pressFRightFormatted: `${pressFRight.toFixed(1)} psi`,
        pressRLeft,
        pressRLeftFormatted: `${pressRLeft.toFixed(1)} psi`,
        pressRRight,
        pressRRightFormatted: `${pressRRight.toFixed(1)} psi`,

        // Tab Card 7: Fuel & Ballast
        fuel: Number(fuelVal.toFixed(2)),
        fuelFormatted: `${fuelVal.toFixed(2)} kg`,
        fuelLaps: Number(fuelLapsVal.toFixed(2)),
        fuelLapsFormatted: `${fuelLapsSign}${fuelLapsVal.toFixed(2)} Laps`,
        fuelCapacity: fuelCapVal,
        fuelMix: fuelMixVal,
        ballast,
        ballastFormatted: `${ballast} kg`,
        nextFrontWingValue: nextWingVal,

        // Grouped structured view representing all 7 Setup Cards in the Car Setup tab
        categories: {
            aerodynamics: {
                frontWingAero: wingF,
                rearWingAero: wingR,
                aeroBiasPercent: aeroBiasVal,
                aeroBiasFormatted: `${aeroBiasVal}% Front`
            },
            transmissionAndDiff: {
                differentialOnThrottle: diffOn,
                differentialOnThrottleFormatted: `${diffOn}%`,
                differentialOffThrottle: diffOff,
                differentialOffThrottleFormatted: `${diffOff}%`,
                engineBraking: engineBraking,
                engineBrakingFormatted: `${engineBraking}%`
            },
            suspensionGeometry: {
                frontCamberDeg: camberF,
                frontCamberFormatted: `${camberF.toFixed(2)}°`,
                rearCamberDeg: camberR,
                rearCamberFormatted: `${camberR.toFixed(2)}°`,
                frontToeDeg: toeF,
                frontToeFormatted: `${toeF.toFixed(2)}°`,
                rearToeDeg: toeR,
                rearToeFormatted: `${toeR.toFixed(2)}°`
            },
            suspensionAndHeights: {
                frontSuspension: suspF,
                rearSuspension: suspR,
                frontAntiRollBar: arbF,
                rearAntiRollBar: arbR,
                frontRideHeight: heightF,
                rearRideHeight: heightR
            },
            brakesAndBias: {
                brakeBiasPercent: bBias,
                brakeBiasFormatted: `${bBias}%`,
                brakePressurePercent: bPressure,
                brakePressureFormatted: `${bPressure}%`
            },
            coldSetupPressuresPsi: {
                frontLeft: pressFLeft,
                frontRight: pressFRight,
                rearLeft: pressRLeft,
                rearRight: pressRRight
            },
            fuelAndBallast: {
                fuelMassKg: Number(fuelVal.toFixed(2)),
                fuelRemainingLaps: Number(fuelLapsVal.toFixed(2)),
                fuelCapacityKg: fuelCapVal,
                fuelMix: fuelMixVal,
                ballastKg: ballast,
                nextFrontWingValue: nextWingVal
            }
        }
    };
}

/**
 * Resolves the full car setup for a specific driver and lap number.
 * Checks:
 * 1. Directly attached setup on the raw lap object
 * 2. In-memory gameState.lapSetups (for player) or gameState.carLapSetups (for any driver)
 * 3. On-disk setups file: setups_y{gameYear}_t{trackId}.json
 * 4. Fallback to current live gameState.state.setup
 */
function getLapSetup(carIdx, lapNum, rawLap = null) {
    const { state, lapSetups, carLapSetups, currentGameYear, currentTrackId } = gameState;
    const pIdx = state.playerIndex || 0;
    const isPlayer = (carIdx === pIdx);

    // 1. Check directly attached setup
    if (rawLap && rawLap.setup && typeof rawLap.setup === 'object') {
        return getFullCarSetupObject(rawLap.setup, state.setup.fuel, state.setup.fuelCapacity, state.setup.fuelMix, state.setup.fuelLaps, state.setup.nextFrontWingValue);
    }

    // 2. Check in-memory lap setups
    if (isPlayer && lapSetups && lapSetups[lapNum]) {
        return getFullCarSetupObject(lapSetups[lapNum], state.setup.fuel, state.setup.fuelCapacity, state.setup.fuelMix, state.setup.fuelLaps, state.setup.nextFrontWingValue);
    }
    if (carLapSetups && carLapSetups[carIdx] && carLapSetups[carIdx][lapNum]) {
        return getFullCarSetupObject(carLapSetups[carIdx][lapNum], state.setup.fuel, state.setup.fuelCapacity, state.setup.fuelMix, state.setup.fuelLaps, state.setup.nextFrontWingValue);
    }

    // 3. Check saved on-disk setups for this track (for player car)
    if (isPlayer && currentTrackId !== -1 && setupsDir) {
        try {
            const sPath = path.join(setupsDir, `setups_y${currentGameYear}_t${currentTrackId}.json`);
            if (fs.existsSync(sPath)) {
                const sData = JSON.parse(fs.readFileSync(sPath, 'utf8'));
                if (Array.isArray(sData)) {
                    const found = sData.find(s => s.lapNum === lapNum);
                    if (found && found.setup) {
                        return getFullCarSetupObject(found.setup, state.setup.fuel, state.setup.fuelCapacity, state.setup.fuelMix, state.setup.fuelLaps, state.setup.nextFrontWingValue);
                    }
                }
            }
        } catch (e) { }
    }

    // 4. Fallback to active/live setup snapshot
    return getFullCarSetupObject(state.setup, state.setup.fuel, state.setup.fuelCapacity, state.setup.fuelMix, state.setup.fuelLaps, state.setup.nextFrontWingValue);
}

/**
 * Builds a chronological list of car setups for all laps completed or recorded in the session.
 */
function getSessionSetupsByLap(carIdx = null) {
    const { state, allLapHistories, lapSetups, currentGameYear, currentTrackId } = gameState;
    const targetIdx = carIdx !== null ? carIdx : (state.playerIndex || 0);
    const lapsList = allLapHistories[targetIdx] || [];
    const setupsResult = [];

    // Also load disk setups if available to combine any completed laps
    let diskSetupsMap = new Map();
    if (targetIdx === (state.playerIndex || 0) && currentTrackId !== -1 && setupsDir) {
        try {
            const sPath = path.join(setupsDir, `setups_y${currentGameYear}_t${currentTrackId}.json`);
            if (fs.existsSync(sPath)) {
                const sData = JSON.parse(fs.readFileSync(sPath, 'utf8'));
                if (Array.isArray(sData)) {
                    sData.forEach(s => {
                        if (s.lapNum && s.setup) diskSetupsMap.set(s.lapNum, s);
                    });
                }
            }
        } catch (e) { }
    }

    // Determine the highest lap number available
    const maxLap = Math.max(
        lapsList.length,
        lapSetups ? Object.keys(lapSetups).reduce((m, k) => Math.max(m, parseInt(k, 10) || 0), 0) : 0,
        diskSetupsMap.size > 0 ? Math.max(...Array.from(diskSetupsMap.keys())) : 0,
        1
    );

    for (let lNum = 1; lNum <= maxLap; lNum++) {
        const rawLap = lapsList[lNum - 1] || null;
        const diskEntry = diskSetupsMap.get(lNum);
        const lapTime = rawLap?.lapTime || diskEntry?.time || 0;
        const lapSetup = getLapSetup(targetIdx, lNum, rawLap);

        setupsResult.push({
            lapNumber: lNum,
            lapTimeMs: lapTime,
            lapTimeFormatted: formatMsExport(lapTime),
            setup: lapSetup
        });
    }

    return setupsResult;
}

/**
 * Generates an exhaustive session export in JSON format containing:
 * - Metadata, weather conditions, session settings
 * - Every lap with sector 1, sector 2, sector 3 times and validation flags for all 22 cars
 * - Full car setup of every lap with all 25+ parameters matching the Car Setup tab
 * - Flat lap-by-lap table for easy data science / CSV export
 * - Tyre stint strategies
 * - Full 20Hz telemetry traces (speed, throttle, brake, gears, RPM, DRS, distance, G-forces)
 * - Complete setup, damage, steward offenses, track geometry, and weather forecasts.
 */
function generateSessionExportJson() {
    const {
        state, carDataTracker, allLapHistories, allTyreStints,
        currentSessionUID, currentSessionLinkIdentifier, currentWeekendLinkIdentifier, currentGameYear, currentTrackId,
        carPhysics, fastestLapGhostData, lastLapTelemetry, currentLapTelemetry,
        sessionDriverFastestLaps
    } = gameState;

    const pIdx = state.playerIndex || 0;
    const cleanSessionName = state.session.type || 'Unknown';
    const cleanTrackName = state.session.trackName || 'Unknown';

    // Detailed Lap History with Sector Breakdown per Driver
    const detailedLapsByDriver = {};
    const allLapsFlatTable = [];

    for (let carIdx = 0; carIdx < 22; carIdx++) {
        const driverName = (state.participants && state.participants[carIdx]) ? state.participants[carIdx] : `Car ${carIdx}`;
        const tracker = carDataTracker[carIdx] || {};
        const rawLaps = allLapHistories[carIdx] || [];
        const stints = allTyreStints[carIdx] || [];

        const processedLaps = rawLaps.map((lap, index) => {
            const lapNum = index + 1;
            const validFlags = lap.validFlags !== undefined ? lap.validFlags : 0x0F;
            const isValid = (validFlags & 0x01) !== 0;
            const isValidS1 = (validFlags & 0x02) !== 0;
            const isValidS2 = (validFlags & 0x04) !== 0;
            const isValidS3 = (validFlags & 0x08) !== 0;
            const lapSetup = getLapSetup(carIdx, lapNum, lap);

            const lapObj = {
                lapNumber: lapNum,
                lapTimeMs: lap.lapTime || 0,
                lapTimeFormatted: formatMsExport(lap.lapTime),
                sector1Ms: lap.s1 || 0,
                sector1Formatted: formatSectorMs(lap.s1),
                sector2Ms: lap.s2 || 0,
                sector2Formatted: formatSectorMs(lap.s2),
                sector3Ms: lap.s3 || 0,
                sector3Formatted: formatSectorMs(lap.s3),
                isValidLap: isValid,
                isValidSector1: isValidS1,
                isValidSector2: isValidS2,
                isValidSector3: isValidS3,
                isPersonalBest: tracker.bestLapMs > 0 && lap.lapTime === tracker.bestLapMs,
                isSessionBest: state.session.sessionFastestLapMs > 0 && lap.lapTime === state.session.sessionFastestLapMs,
                setup: lapSetup
            };

            // Add to flat table for analytics
            if (lap.lapTime > 0 || lap.s1 > 0 || lap.s2 > 0 || lap.s3 > 0) {
                allLapsFlatTable.push({
                    carIndex: carIdx,
                    driverName: driverName,
                    teamName: tracker.teamName || 'Unknown',
                    ...lapObj
                });
            }

            return lapObj;
        });

        detailedLapsByDriver[carIdx] = {
            carIndex: carIdx,
            driverName: driverName,
            teamName: tracker.teamName || 'Unknown',
            teamColor: tracker.teamColor || '#FFF',
            currentPosition: tracker.pos || 0,
            totalLapsCompleted: rawLaps.length,
            bestLapMs: tracker.bestLapMs || 0,
            bestLapFormatted: formatMsExport(tracker.bestLapMs),
            bestS1Ms: tracker.bestS1 || 0,
            bestS1Formatted: formatSectorMs(tracker.bestS1),
            bestS2Ms: tracker.bestS2 || 0,
            bestS2Formatted: formatSectorMs(tracker.bestS2),
            bestS3Ms: tracker.bestS3 || 0,
            bestS3Formatted: formatSectorMs(tracker.bestS3),
            // Current car state snapshot for this driver
            currentCarState: {
                tyreCompound: tracker.tyre || 'UNK',
                tyreCompoundColor: tracker.tyreClass || '#808080',
                tyreAge: carIdx === state.playerIndex ? state.car.tyreAge : null,
                penalties: tracker.penalties || 0,
                warnings: tracker.warnings || 0,
                pitStatus: tracker.pitStatus || 0,
                driverStatus: tracker.driverStatus || 0,
                maxSpeedKmh: tracker.maxSpeed || 0,
                // Full tyre wear, temps, pressures only available for player car from UDP
                ...(carIdx === state.playerIndex ? {
                    tyreWear: { fl: state.car.wear.fl, fr: state.car.wear.fr, rl: state.car.wear.rl, rr: state.car.wear.rr },
                    tyreSurfaceTempC: { fl: state.car.surfTemp.fl, fr: state.car.surfTemp.fr, rl: state.car.surfTemp.rl, rr: state.car.surfTemp.rr },
                    tyreInnerTempC: { fl: state.car.inTemp.fl, fr: state.car.inTemp.fr, rl: state.car.inTemp.rl, rr: state.car.inTemp.rr },
                    tyrePressurePsi: { fl: state.car.press.fl, fr: state.car.press.fr, rl: state.car.press.rl, rr: state.car.press.rr },
                    brakeTempC: { fl: state.car.brakeTemp.fl, fr: state.car.brakeTemp.fr, rl: state.car.brakeTemp.rl, rr: state.car.brakeTemp.rr },
                    engineTempC: state.car.engineTemp,
                    ersMode: state.ers.mode,
                    ersBatteryPct: state.ers.battery,
                    fuelMassKg: state.setup.fuel,
                    fuelRemainingLaps: state.setup.fuelLaps,
                    damage: state.damage ? {
                        frontWingDamage: state.damage.m_frontLeftWingDamage ?? state.damage.m_frontWingDamage ?? null,
                        rearWingDamage: state.damage.m_rearWingDamage ?? null,
                        floorDamage: state.damage.m_floorDamage ?? null,
                        diffuserDamage: state.damage.m_diffuserDamage ?? null,
                        sidepodDamage: state.damage.m_sidepodDamage ?? null,
                        drsFault: state.damage.m_drsFault ?? null,
                        ersFault: state.damage.m_ersFault ?? null,
                        gearboxDamage: state.damage.m_gearBoxDamage ?? null,
                        engineDamage: state.damage.m_engineDamage ?? null,
                        engineMGUHWear: state.damage.m_engineMGUHWear ?? null,
                        engineESWear: state.damage.m_engineESWear ?? null,
                        engineCEWear: state.damage.m_engineCEWear ?? null,
                        engineICEWear: state.damage.m_engineICEWear ?? null,
                        engineMGUKWear: state.damage.m_engineMGUKWear ?? null,
                        engineTCWear: state.damage.m_engineTCWear ?? null,
                        tyresWear: state.damage.m_tyresWear ?? null,
                        tyresDamage: state.damage.m_tyresDamage ?? null
                    } : null
                } : {})
            },
            tyreStints: stints,
            laps: processedLaps,
            setupsByLap: getSessionSetupsByLap(carIdx)
        };
    }

    return {
        metadata: {
            title: 'F1 Telemetry Dashboard - Complete Session Data Export',
            exportedAt: new Date().toISOString(),
            exportedTimestamp: Date.now(),
            gameYear: currentGameYear,
            sessionUID: currentSessionUID,
            sessionLinkIdentifier: currentSessionLinkIdentifier,
            weekendLinkIdentifier: currentWeekendLinkIdentifier,
            sessionType: cleanSessionName,
            sessionCategory: state.session.sessionCategory,
            trackId: currentTrackId,
            trackName: cleanTrackName,
            trackLengthMeters: state.session.trackLength,
            raceDistanceMeters: state.session.raceDistance,
            totalLaps: state.session.lapsTotal,
            weather: state.session.weather,
            trackTempCelsius: state.session.trackTemp,
            airTempCelsius: state.session.airTemp,
            pitSpeedLimitKmh: state.session.pitLimit,
            safetyCarStatus: state.session.sc,
            fastestLap: {
                carIndex: state.session.fastestLapCarIndex,
                driver: state.session.sessionFastestDriver || 'None',
                timeMs: state.session.sessionFastestLapMs === Infinity ? 0 : state.session.sessionFastestLapMs,
                timeFormatted: formatMsExport(state.session.sessionFastestLapMs)
            },
            bestSectors: {
                s1Ms: state.session.sessionBestS1 === Infinity ? 0 : state.session.sessionBestS1,
                s1Formatted: formatSectorMs(state.session.sessionBestS1),
                s2Ms: state.session.sessionBestS2 === Infinity ? 0 : state.session.sessionBestS2,
                s2Formatted: formatSectorMs(state.session.sessionBestS2),
                s3Ms: state.session.sessionBestS3 === Infinity ? 0 : state.session.sessionBestS3,
                s3Formatted: formatSectorMs(state.session.sessionBestS3)
            },
            allTimeTrackRecord: {
                driver: state.session.allTimeFastestDriver,
                timeMs: state.session.allTimeFastestLapMs === Infinity ? 0 : state.session.allTimeFastestLapMs,
                timeFormatted: formatMsExport(state.session.allTimeFastestLapMs)
            }
        },
        participants: state.participants || [],
        leaderboard: state.leaderboard || [],
        detailedLapsByDriver: detailedLapsByDriver,
        allLapsFlatTable: allLapsFlatTable,
        tyreStintsByDriver: allTyreStints,
        rawLapHistories: allLapHistories || {},
        setupsByLap: getSessionSetupsByLap(pIdx),
        carSetupsByLap: getSessionSetupsByLap(pIdx),
        player: {
            playerIndex: pIdx,
            driverName: (state.participants && state.participants[pIdx]) ? state.participants[pIdx] : `Player (Car ${pIdx})`,
            lap: state.lap,
            penalties: state.penalties,
            inputs: state.inputs,
            car: state.car,
            setup: getFullCarSetupObject(state.setup, state.setup.fuel, state.setup.fuelCapacity, state.setup.fuelMix, state.setup.fuelLaps, state.setup.nextFrontWingValue),
            setupsByLap: getSessionSetupsByLap(pIdx),
            ers: state.ers,
            damage: state.damage,
            motion: {
                pitch: state.motion.pitch,
                roll: state.motion.roll,
                gLat: state.motion.gLat,
                gLong: state.motion.gLong,
                gVert: state.motion.gVert,
                maxGSeen: state.motion.maxGSeen,
                susp: state.motion.susp,
                gEnvelopeArray: state.motion.gEnvelopeArray,
                gHistory: state.motion.gHistory
            }
        },
        allCarsTracking: carDataTracker,
        physics: carPhysics,
        trackData: {
            trackPoints: state.trackPoints,
            pitLanePoints: state.pitLanePoints,
            startLine: state.startLine,
            sector1: state.sector1,
            sector2: state.sector2,
            customSectorLines: state.customSectorLines
        },
        weatherForecast: state.weatherForecast || [],
        ghostLapTelemetry: fastestLapGhostData || [],
        sessionDriverFastestLaps: sessionDriverFastestLaps || [],
        playerLastLapTelemetry: lastLapTelemetry[pIdx] || [],
        playerCurrentLapTelemetry: currentLapTelemetry[pIdx] || [],
        allCarsCurrentLapTelemetry: currentLapTelemetry,
        allCarsLastLapTelemetry: lastLapTelemetry
    };
}

let lastSnapshotSaveTime = 0;

/**
 * Saves a persistent snapshot of the active session so that resuming a mid-session save
 * or restarting the server immediately restores all lap histories, tyre stints, and best times.
 */
function saveActiveSessionSnapshot(force = false) {
    const now = Date.now();
    if (!force && now - lastSnapshotSaveTime < 2000) return; // Throttle to max once every 2 seconds
    lastSnapshotSaveTime = now;

    const {
        state, carDataTracker, allLapHistories, allTyreStints,
        currentSessionUID, currentSessionLinkIdentifier, currentWeekendLinkIdentifier,
        currentSessionType, currentTrackId, currentGameYear
    } = gameState;

    if (currentTrackId === -1 && (!allLapHistories || Object.keys(allLapHistories).length === 0)) {
        return;
    }

    try {
        if (!fs.existsSync(sessionTelemetryDir)) {
            fs.mkdirSync(sessionTelemetryDir, { recursive: true });
        }

        const snapshot = {
            version: 1,
            savedAt: now,
            sessionUID: currentSessionUID,
            sessionLinkIdentifier: currentSessionLinkIdentifier,
            weekendLinkIdentifier: currentWeekendLinkIdentifier,
            sessionType: currentSessionType,
            trackId: currentTrackId,
            gameYear: currentGameYear,
            sessionFastestLapMs: state.session.sessionFastestLapMs,
            fastestLapCarIndex: state.session.fastestLapCarIndex,
            sessionFastestDriver: state.session.sessionFastestDriver,
            sessionBestS1: state.session.sessionBestS1,
            sessionBestS2: state.session.sessionBestS2,
            sessionBestS3: state.session.sessionBestS3,
            participants: state.participants || [],
            carDataTracker: carDataTracker,
            allLapHistories: allLapHistories,
            allTyreStints: allTyreStints,
            lapSetups: gameState.lapSetups || {},
            allSessionLaps: gameState.allSessionLaps || [],
            fastestLapGhostData: gameState.fastestLapGhostData || []
        };

        const activePath = path.join(sessionTelemetryDir, 'active_session.json');
        fs.writeFileSync(activePath, JSON.stringify(snapshot, null, 2), 'utf8');

        if (currentSessionLinkIdentifier && currentSessionLinkIdentifier !== 0) {
            const linkPath = path.join(sessionTelemetryDir, `session_link_${currentSessionLinkIdentifier}.json`);
            fs.writeFileSync(linkPath, JSON.stringify(snapshot, null, 2), 'utf8');
        }
    } catch (e) {
        console.error('⚠️ [Session Snapshot Save Error]:', e.message);
    }
}

/**
 * Loads a persistent session snapshot when resuming a race from a mid-session save
 * or after the server restarts.
 */
function loadActiveSessionSnapshot(sessionLinkIdentifier, trackId, sessionType) {
    try {
        let snapshotPath = null;

        if (sessionLinkIdentifier && sessionLinkIdentifier !== 0) {
            const linkPath = path.join(sessionTelemetryDir, `session_link_${sessionLinkIdentifier}.json`);
            if (fs.existsSync(linkPath)) {
                snapshotPath = linkPath;
            }
        }

        if (!snapshotPath) {
            const activePath = path.join(sessionTelemetryDir, 'active_session.json');
            if (fs.existsSync(activePath)) {
                snapshotPath = activePath;
            }
        }

        if (!snapshotPath || !fs.existsSync(snapshotPath)) return false;

        const raw = fs.readFileSync(snapshotPath, 'utf8');
        const snap = JSON.parse(raw);
        if (!snap || typeof snap !== 'object') return false;

        // Verify compatibility: match sessionLinkIdentifier or (trackId and sessionType) or cold start
        const isColdStart = (sessionLinkIdentifier === undefined || sessionLinkIdentifier === null) && (trackId === undefined || trackId === null);
        const linkMatches = sessionLinkIdentifier && snap.sessionLinkIdentifier === sessionLinkIdentifier;
        const trackMatches = (trackId !== undefined && trackId !== -1 && snap.trackId === trackId) &&
            (sessionType === undefined || snap.sessionType === sessionType);

        if (!isColdStart && !linkMatches && !trackMatches) {
            return false;
        }

        if (snap.trackId !== undefined && snap.trackId !== -1) {
            gameState.currentTrackId = snap.trackId;
        }
        if (snap.sessionUID) {
            gameState.currentSessionUID = snap.sessionUID;
        }
        if (snap.sessionType) {
            gameState.currentSessionType = snap.sessionType;
        }

        const { state, carDataTracker, allLapHistories, allTyreStints } = gameState;

        // Restore session fastest & best sectors
        if (snap.sessionFastestLapMs && snap.sessionFastestLapMs > 0 && snap.sessionFastestLapMs < state.session.sessionFastestLapMs) {
            state.session.sessionFastestLapMs = snap.sessionFastestLapMs;
            state.session.fastestLapCarIndex = snap.fastestLapCarIndex ?? -1;
            state.session.sessionFastestDriver = snap.sessionFastestDriver || 'None';
        }
        if (snap.sessionBestS1 && snap.sessionBestS1 > 0) state.session.sessionBestS1 = snap.sessionBestS1;
        if (snap.sessionBestS2 && snap.sessionBestS2 > 0) state.session.sessionBestS2 = snap.sessionBestS2;
        if (snap.sessionBestS3 && snap.sessionBestS3 > 0) state.session.sessionBestS3 = snap.sessionBestS3;

        // Restore participants if current is empty
        if ((!state.participants || state.participants.length === 0) && Array.isArray(snap.participants) && snap.participants.length > 0) {
            state.participants = snap.participants;
        }

        // Restore car tracking data (best laps, tyres, penalties)
        if (Array.isArray(snap.carDataTracker)) {
            snap.carDataTracker.forEach((savedCar, idx) => {
                if (idx < 22 && savedCar) {
                    const curr = carDataTracker[idx];
                    if (savedCar.bestLapMs > 0 && (curr.bestLapMs === 0 || savedCar.bestLapMs < curr.bestLapMs)) {
                        curr.bestLapMs = savedCar.bestLapMs;
                        curr.bestLapNum = savedCar.bestLapNum || 0;
                    }
                    if (savedCar.bestS1 > 0 && (curr.bestS1 === 0 || savedCar.bestS1 < curr.bestS1)) curr.bestS1 = savedCar.bestS1;
                    if (savedCar.bestS2 > 0 && (curr.bestS2 === 0 || savedCar.bestS2 < curr.bestS2)) curr.bestS2 = savedCar.bestS2;
                    if (savedCar.bestS3 > 0 && (curr.bestS3 === 0 || savedCar.bestS3 < curr.bestS3)) curr.bestS3 = savedCar.bestS3;
                    if (savedCar.tyre && savedCar.tyre !== 'UNK') {
                        curr.tyre = savedCar.tyre;
                        curr.tyreClass = savedCar.tyreClass || '#FFFFFF';
                    }
                    if (savedCar.tyreAge > 0 && curr.tyreAge === 0) curr.tyreAge = savedCar.tyreAge;
                    if (savedCar.numPitStops > 0 && curr.numPitStops === 0) curr.numPitStops = savedCar.numPitStops;
                    if (savedCar.teamName && savedCar.teamName !== 'Unknown') curr.teamName = savedCar.teamName;
                    if (savedCar.teamColor && savedCar.teamColor !== '#FFFFFF') curr.teamColor = savedCar.teamColor;
                }
            });
        }

        // Restore lap histories (merge non-destructively)
        if (snap.allLapHistories && typeof snap.allLapHistories === 'object') {
            Object.entries(snap.allLapHistories).forEach(([carIdxStr, laps]) => {
                const cIdx = parseInt(carIdxStr, 10);
                if (!isNaN(cIdx) && Array.isArray(laps)) {
                    if (!allLapHistories[cIdx]) allLapHistories[cIdx] = [];
                    const curH = allLapHistories[cIdx];
                    laps.forEach((lap, lIdx) => {
                        if (!curH[lIdx] || (curH[lIdx].lapTime === 0 && lap.lapTime > 0)) {
                            curH[lIdx] = { ...lap };
                        }
                    });
                }
            });
        }

        // Restore tyre stints
        if (snap.allTyreStints && typeof snap.allTyreStints === 'object') {
            Object.entries(snap.allTyreStints).forEach(([carIdxStr, stints]) => {
                const cIdx = parseInt(carIdxStr, 10);
                if (!isNaN(cIdx) && Array.isArray(stints) && (!allTyreStints[cIdx] || allTyreStints[cIdx].length === 0)) {
                    allTyreStints[cIdx] = [...stints];
                }
            });
        }

        // Restore lap setups
        if (snap.lapSetups && typeof snap.lapSetups === 'object') {
            if (!gameState.lapSetups) gameState.lapSetups = {};
            Object.entries(snap.lapSetups).forEach(([k, v]) => {
                if (v && typeof v === 'object') {
                    gameState.lapSetups[k] = { ...v };
                }
            });
        }

        // Restore allSessionLaps
        if (Array.isArray(snap.allSessionLaps) && snap.allSessionLaps.length > 0) {
            gameState.allSessionLaps = snap.allSessionLaps;
            if (!gameState.sessionLapsByDriver) gameState.sessionLapsByDriver = Array.from({ length: 22 }, () => []);
            snap.allSessionLaps.forEach(l => {
                if (l.carIndex !== undefined) {
                    if (!gameState.sessionLapsByDriver[l.carIndex]) gameState.sessionLapsByDriver[l.carIndex] = [];
                    const exists = gameState.sessionLapsByDriver[l.carIndex].some(el => el.lapNum === l.lapNum);
                    if (!exists) gameState.sessionLapsByDriver[l.carIndex].push(l);
                }
            });
        }

        // Restore fastestLapGhostData
        if (Array.isArray(snap.fastestLapGhostData) && snap.fastestLapGhostData.length > 20) {
            gameState.fastestLapGhostData = snap.fastestLapGhostData;
        }

        gameState.lapHistoryDirty = true;
        console.log(`💾 [Session Restore] Resumed session snapshot loaded successfully (Track: ${snap.trackId}, LinkId: ${snap.sessionLinkIdentifier})`);
        return true;
    } catch (e) {
        console.error('⚠️ [Session Snapshot Load Error]:', e.message);
        return false;
    }
}

/**
 * Extracts distinct corner braking zones from a telemetry points array.
 */
function extractBrakingZones(pts) {
    if (!Array.isArray(pts) || pts.length < 20) return [];

    // Filter points with valid numbers and sort by lap distance
    const sorted = [...pts]
        .filter(p => Number.isFinite(p.d) && Number.isFinite(p.speed))
        .sort((a, b) => a.d - b.d);

    const rawZones = [];
    let inZone = false;
    let cur = null;
    let zeroBrakeCount = 0;

    for (let i = 0; i < sorted.length; i++) {
        const p = sorted[i];
        let brk = Number.isFinite(p.brake) ? p.brake : 0;
        if (brk > 0 && brk <= 1.0) brk = brk * 100; // Normalize 0..1 to 0..100
        const spd = Number.isFinite(p.speed) ? p.speed : 0;

        if (!inZone) {
            // Braking initiated: substantial brake input and speed over 45 km/h
            if (brk > 8 && spd > 45) {
                inZone = true;
                zeroBrakeCount = 0;
                cur = {
                    startIdx: i,
                    startDist: p.d,
                    startTime: p.t || 0,
                    entrySpeed: spd,
                    minSpeed: spd,
                    minSpeedDist: p.d,
                    peakBrake: brk,
                    startX: p.x || 0,
                    startY: p.y || 0,
                    startZ: p.z || 0,
                    points: [p]
                };
            }
        } else {
            cur.points.push(p);
            if (brk > cur.peakBrake) cur.peakBrake = brk;
            if (spd < cur.minSpeed) {
                cur.minSpeed = spd;
                cur.minSpeedDist = p.d;
            }

            if (brk <= 5) {
                zeroBrakeCount++;
            } else {
                zeroBrakeCount = 0;
            }

            // Release condition: 3 points with low brake, or throttle reapplied, or end of lap
            const thr = Number.isFinite(p.throttle) ? p.throttle : 0;
            const isReleased = (zeroBrakeCount >= 3) || (thr > 25 && spd > cur.minSpeed + 8) || (i === sorted.length - 1);
            if (isReleased) {
                inZone = false;
                const endPt = sorted[Math.max(cur.startIdx, i - zeroBrakeCount)];
                cur.endDist = endPt.d;
                cur.endTime = endPt.t || 0;
                cur.endX = endPt.x || 0;
                cur.endY = endPt.y || 0;
                cur.endZ = endPt.z || 0;
                cur.exitSpeed = endPt.speed || cur.minSpeed;
                cur.brakingDist = Math.max(1, Math.round((cur.endDist - cur.startDist) * 10) / 10);
                cur.speedDrop = Math.max(0, Math.round(cur.entrySpeed - cur.minSpeed));
                cur.durationMs = Math.max(50, Math.round(cur.endTime - cur.startTime));

                // Deceleration G calculation: a = (v1^2 - v2^2) / (2 * d)
                const v1 = cur.entrySpeed / 3.6;
                const v2 = cur.minSpeed / 3.6;
                const d = cur.brakingDist;
                const decelG = d > 0 ? Number(((v1 * v1 - v2 * v2) / (2 * d * 9.80665)).toFixed(2)) : 0;
                cur.avgDecelG = Math.max(0.2, decelG);

                // Validation filter for genuine corner braking zone
                if (cur.brakingDist >= 8 && (cur.speedDrop >= 10 || cur.peakBrake >= 25) && cur.durationMs >= 120) {
                    delete cur.points;
                    rawZones.push(cur);
                }
                cur = null;
            }
        }
    }

    // Merge consecutive zones that are separated by < 20 meters (trail braking re-application)
    const merged = [];
    for (let i = 0; i < rawZones.length; i++) {
        const z = rawZones[i];
        if (merged.length > 0) {
            const prev = merged[merged.length - 1];
            if (z.startDist - prev.endDist < 20) {
                prev.endDist = z.endDist;
                prev.endTime = z.endTime;
                prev.endX = z.endX;
                prev.endY = z.endY;
                prev.endZ = z.endZ;
                prev.exitSpeed = z.exitSpeed;
                prev.minSpeed = Math.min(prev.minSpeed, z.minSpeed);
                prev.peakBrake = Math.max(prev.peakBrake, z.peakBrake);
                prev.brakingDist = Math.round((prev.endDist - prev.startDist) * 10) / 10;
                prev.speedDrop = Math.round(prev.entrySpeed - prev.minSpeed);
                prev.durationMs = Math.round(prev.endTime - prev.startTime);
                const v1 = prev.entrySpeed / 3.6;
                const v2 = prev.minSpeed / 3.6;
                prev.avgDecelG = prev.brakingDist > 0 ? Number(((v1 * v1 - v2 * v2) / (2 * prev.brakingDist * 9.80665)).toFixed(2)) : 0;
                continue;
            }
        }
        merged.push({ ...z });
    }

    return merged.map((z, idx) => ({
        zoneIndex: idx + 1,
        name: `Turn ${idx + 1}`,
        startDist: Math.round(z.startDist),
        endDist: Math.round(z.endDist),
        brakingDist: Math.round(z.brakingDist),
        entrySpeed: Math.round(z.entrySpeed),
        minSpeed: Math.round(z.minSpeed),
        speedDrop: Math.round(z.speedDrop),
        peakBrake: Math.round(z.peakBrake),
        durationMs: Math.round(z.durationMs),
        durationSec: Number((z.durationMs / 1000).toFixed(2)),
        avgDecelG: Math.min(6.5, Math.max(0.5, z.avgDecelG)),
        startX: Number((z.startX || 0).toFixed(2)),
        startY: Number((z.startY || 0).toFixed(2)),
        startZ: Number((z.startZ || 0).toFixed(2)),
        endX: Number((z.endX || 0).toFixed(2)),
        endY: Number((z.endY || 0).toFixed(2)),
        endZ: Number((z.endZ || 0).toFixed(2))
    }));
}

/**
 * Compares braking performance corner-by-corner between two laps.
 */
function compareLapsBraking(lapA, lapB) {
    if (!lapA) return null;
    const zonesA = (Array.isArray(lapA.brakingZones) && lapA.brakingZones.length > 0)
        ? lapA.brakingZones
        : extractBrakingZones(lapA.telemetry || []);
    const zonesB = lapB
        ? ((Array.isArray(lapB.brakingZones) && lapB.brakingZones.length > 0) ? lapB.brakingZones : extractBrakingZones(lapB.telemetry || []))
        : [];

    const zoneComparisons = zonesA.map((zA, idx) => {
        let matchedB = null;
        if (zonesB.length > 0) {
            matchedB = zonesB.find(zB => Math.abs(zB.startDist - zA.startDist) < 100);
            if (!matchedB && zonesB[idx]) {
                matchedB = zonesB[idx];
            }
        }

        if (!matchedB) {
            return {
                zoneIndex: zA.zoneIndex,
                name: zA.name,
                baseline: { ...zA },
                comparison: null,
                brakePointDelta: 0,
                brakingDistanceDelta: 0,
                entrySpeedDelta: 0,
                minSpeedDelta: 0,
                peakBrakeDelta: 0,
                durationDeltaMs: 0
            };
        }

        const brakePointDelta = Math.round(matchedB.startDist - zA.startDist); // > 0: braked later, < 0: braked earlier
        const brakingDistanceDelta = Math.round(matchedB.brakingDist - zA.brakingDist); // > 0: longer, < 0: shorter
        const entrySpeedDelta = Math.round(matchedB.entrySpeed - zA.entrySpeed);
        const minSpeedDelta = Math.round(matchedB.minSpeed - zA.minSpeed);
        const peakBrakeDelta = Math.round(matchedB.peakBrake - zA.peakBrake);
        const durationDeltaMs = Math.round(matchedB.durationMs - zA.durationMs);

        return {
            zoneIndex: zA.zoneIndex,
            name: zA.name,
            baseline: { ...zA },
            comparison: { ...matchedB },
            brakePointDelta,
            brakingDistanceDelta,
            entrySpeedDelta,
            minSpeedDelta,
            peakBrakeDelta,
            durationDeltaMs
        };
    });

    const totalDistA = zonesA.reduce((sum, z) => sum + z.brakingDist, 0);
    const totalDistB = zonesB.reduce((sum, z) => sum + z.brakingDist, 0);

    return {
        lapA: {
            lapNum: lapA.lapNum || 1,
            lapTimeMs: lapA.lapTimeMs || 0,
            driverName: lapA.driverName || 'Driver A',
            totalBrakingDist: totalDistA,
            zonesCount: zonesA.length
        },
        lapB: lapB ? {
            lapNum: lapB.lapNum || 2,
            lapTimeMs: lapB.lapTimeMs || 0,
            driverName: lapB.driverName || 'Driver B',
            totalBrakingDist: totalDistB,
            zonesCount: zonesB.length
        } : null,
        totalBrakingDistanceDelta: lapB ? (totalDistB - totalDistA) : 0,
        lapTimeDeltaMs: (lapA && lapB) ? ((lapB.lapTimeMs || 0) - (lapA.lapTimeMs || 0)) : 0,
        zones: zoneComparisons
    };
}

/**
 * Builds a multi-lap braking comparison matrix where the selected baseline lap
 * is compared against ALL other laps driven in the session.
 */
function buildAllLapsComparisonMatrix(baselineLap, allLaps) {
    if (!baselineLap) return { corners: [], laps: [], summary: {} };
    const lapsList = Array.isArray(allLaps) ? allLaps : [];

    // Find the lap with the most complete set of braking zones to serve as the master corner reference
    let masterZones = (Array.isArray(baselineLap.brakingZones) && baselineLap.brakingZones.length > 0)
        ? baselineLap.brakingZones
        : extractBrakingZones(baselineLap.telemetry || []);

    lapsList.forEach(l => {
        const lz = (Array.isArray(l.brakingZones) && l.brakingZones.length > 0)
            ? l.brakingZones
            : extractBrakingZones(l.telemetry || []);
        if (lz.length > masterZones.length) {
            masterZones = lz;
        }
    });

    const bZones = (Array.isArray(baselineLap.brakingZones) && baselineLap.brakingZones.length > 0)
        ? baselineLap.brakingZones
        : extractBrakingZones(baselineLap.telemetry || []);

    const matrixCorners = masterZones.map((mz, cIdx) => {
        // Find matching zone in baseline lap
        const bMatch = bZones.find(z => Math.abs(z.startDist - mz.startDist) < 120) || (bZones[cIdx] && Math.abs(bZones[cIdx].startDist - mz.startDist) < 250 ? bZones[cIdx] : null);

        const cornerRow = {
            zoneIndex: mz.zoneIndex || (cIdx + 1),
            name: mz.name || `Turn ${cIdx + 1}`,
            trackDist: mz.startDist,
            baselineBrakingDist: bMatch ? bMatch.brakingDist : mz.brakingDist,
            baselineStartDist: bMatch ? bMatch.startDist : mz.startDist,
            baselineEntrySpeed: bMatch ? bMatch.entrySpeed : mz.entrySpeed,
            baselineMinSpeed: bMatch ? bMatch.minSpeed : mz.minSpeed,
            startX: mz.startX,
            startZ: mz.startZ,
            endX: mz.endX,
            endZ: mz.endZ,
            hasBaseline: !!bMatch,
            laps: {}
        };

        lapsList.forEach(l => {
            const lZones = (Array.isArray(l.brakingZones) && l.brakingZones.length > 0)
                ? l.brakingZones
                : extractBrakingZones(l.telemetry || []);
            let match = lZones.find(z => Math.abs(z.startDist - mz.startDist) < 120) || lZones[cIdx] || null;
            if (match) {
                const bDist = bMatch ? bMatch.brakingDist : mz.brakingDist;
                const bStart = bMatch ? bMatch.startDist : mz.startDist;
                const bEntry = bMatch ? bMatch.entrySpeed : mz.entrySpeed;
                const bMin = bMatch ? bMatch.minSpeed : mz.minSpeed;

                const distDelta = Math.round(match.brakingDist - bDist);
                const brakePointDelta = Math.round(match.startDist - bStart);
                cornerRow.laps[l.lapNum] = {
                    lapNum: l.lapNum,
                    startDist: match.startDist,
                    brakingDist: match.brakingDist,
                    distDelta: distDelta,             // >0: longer braking, <0: shorter braking
                    brakePointDelta: brakePointDelta, // >0: braked later, <0: braked earlier
                    entrySpeed: match.entrySpeed,
                    minSpeed: match.minSpeed,
                    entrySpeedDelta: Math.round(match.entrySpeed - bEntry),
                    minSpeedDelta: Math.round(match.minSpeed - bMin),
                    peakBrake: match.peakBrake,
                    startX: match.startX,
                    startZ: match.startZ
                };
            } else {
                cornerRow.laps[l.lapNum] = null;
            }
        });

        return cornerRow;
    });

    const bTotal = bZones.reduce((s, z) => s + z.brakingDist, 0);
    const lapSummaries = lapsList.map(l => {
        const lZones = (Array.isArray(l.brakingZones) && l.brakingZones.length > 0)
            ? l.brakingZones
            : extractBrakingZones(l.telemetry || []);
        const totalBraking = lZones.reduce((s, z) => s + z.brakingDist, 0);
        return {
            lapNum: l.lapNum,
            lapTimeMs: l.lapTimeMs || 0,
            driverName: l.driverName || `Lap ${l.lapNum}`,
            teamColor: l.teamColor || '#FFF',
            isValid: l.isValid !== false,
            totalBrakingDist: totalBraking,
            totalBrakingDelta: Math.round(totalBraking - bTotal),
            isBaseline: l.lapNum === baselineLap.lapNum
        };
    });

    return {
        baselineLapNum: baselineLap.lapNum,
        corners: matrixCorners,
        lapSummaries: lapSummaries
    };
}

/**
 * Generates an authentic multi-lap session dataset from track telemetry for demonstration and analysis.
 */
function generateDemoSessionLaps(trackId = 0) {
    const tId = parseInt(trackId, 10) || 0;
    let baseTel = [];

    // 1. Try reading existing track telemetry
    const telPath = path.join(telemetryDir, `telemetry_${tId}.json`);
    if (fs.existsSync(telPath)) {
        try {
            baseTel = JSON.parse(fs.readFileSync(telPath, 'utf8'));
        } catch (e) { }
    }

    // 2. Try session_telemetry
    if (baseTel.length === 0 && fs.existsSync(sessionTelemetryDir)) {
        const sPath = path.join(sessionTelemetryDir, `fastest_car_0_track_${tId}.json`);
        if (fs.existsSync(sPath)) {
            try {
                const sData = JSON.parse(fs.readFileSync(sPath, 'utf8'));
                if (Array.isArray(sData.telemetry) && sData.telemetry.length > 20) {
                    baseTel = sData.telemetry;
                }
            } catch (e) { }
        }
    }

    // 3. Fallback to track 0 (Melbourne) or 31 (Las Vegas)
    if (baseTel.length === 0) {
        for (const altId of [0, 31, 17, 10]) {
            const altPath = path.join(telemetryDir, `telemetry_${altId}.json`);
            if (fs.existsSync(altPath)) {
                try {
                    baseTel = JSON.parse(fs.readFileSync(altPath, 'utf8'));
                    break;
                } catch (e) { }
            }
        }
    }

    if (baseTel.length < 20) return [];

    const baseLapTime = baseTel[baseTel.length - 1]?.t || 82450;
    const baseZones = extractBrakingZones(baseTel);

    // Generate 4 distinct session laps
    // Lap 1: Warm-up / Cautious Lap (braked earlier by 12-18m, longer braking distance, cooler tyres)
    const lap1Telemetry = baseTel.map(p => {
        let brk = p.brake;
        let spd = p.speed;
        let t = Math.round(p.t * 1.032);
        const inZone = baseZones.some(z => p.d >= z.startDist - 16 && p.d <= z.endDist + 4);
        if (inZone) {
            brk = Math.min(100, Math.round(p.brake * 0.92));
            spd = Math.max(40, Math.round(p.speed * 0.96));
        }
        return { ...p, t, brake: brk, speed: spd };
    });

    // Lap 2: Aggressive Push Lap (braked 8-12m deeper/later, slightly overshot corner 1)
    const lap2Telemetry = baseTel.map((p, idx) => {
        let brk = p.brake;
        let spd = p.speed;
        let t = Math.round(p.t * 1.008);
        const inZone1 = baseZones[0] && (p.d >= baseZones[0].startDist && p.d <= baseZones[0].endDist + 15);
        if (inZone1) {
            brk = 100;
            spd = Math.max(50, Math.round(p.speed * 0.98));
        }
        return { ...p, t, brake: brk, speed: spd };
    });

    // Lap 3: Optimal Benchmark Lap (Personal Best - clean apexes, peak threshold braking)
    const lap3Telemetry = baseTel.map(p => ({ ...p }));

    // Lap 4: Tyre Degradation Stint Lap (braking distance extended by 6-10m due to tyre wear)
    const lap4Telemetry = baseTel.map(p => {
        let brk = p.brake;
        let spd = p.speed;
        let t = Math.round(p.t * 1.018);
        const inZone = baseZones.some(z => p.d >= z.startDist - 6 && p.d <= z.endDist + 8);
        if (inZone) {
            brk = Math.min(100, Math.round(p.brake * 0.95));
            spd = Math.round(p.speed * 0.97);
        }
        return { ...p, t, brake: brk, speed: spd };
    });

    const demoLaps = [
        {
            lapNum: 1,
            lapTimeMs: Math.round(baseLapTime * 1.032),
            driverName: 'You (Warmup)',
            teamName: 'Oracle Red Bull Racing',
            teamColor: '#3671C6',
            isValid: true,
            telemetry: lap1Telemetry,
            brakingZones: extractBrakingZones(lap1Telemetry),
            s1: Math.round(baseLapTime * 0.31),
            s2: Math.round(baseLapTime * 0.39),
            s3: Math.round(baseLapTime * 0.332)
        },
        {
            lapNum: 2,
            lapTimeMs: Math.round(baseLapTime * 1.008),
            driverName: 'You (Push Lap)',
            teamName: 'Oracle Red Bull Racing',
            teamColor: '#3671C6',
            isValid: true,
            telemetry: lap2Telemetry,
            brakingZones: extractBrakingZones(lap2Telemetry),
            s1: Math.round(baseLapTime * 0.302),
            s2: Math.round(baseLapTime * 0.383),
            s3: Math.round(baseLapTime * 0.323)
        },
        {
            lapNum: 3,
            lapTimeMs: baseLapTime,
            driverName: 'You (Personal Best)',
            teamName: 'Oracle Red Bull Racing',
            teamColor: '#3671C6',
            isValid: true,
            isPersonalBest: true,
            telemetry: lap3Telemetry,
            brakingZones: extractBrakingZones(lap3Telemetry),
            s1: Math.round(baseLapTime * 0.30),
            s2: Math.round(baseLapTime * 0.38),
            s3: Math.round(baseLapTime * 0.32)
        },
        {
            lapNum: 4,
            lapTimeMs: Math.round(baseLapTime * 1.018),
            driverName: 'You (Tyre Degradation)',
            teamName: 'Oracle Red Bull Racing',
            teamColor: '#3671C6',
            isValid: true,
            telemetry: lap4Telemetry,
            brakingZones: extractBrakingZones(lap4Telemetry),
            s1: Math.round(baseLapTime * 0.305),
            s2: Math.round(baseLapTime * 0.387),
            s3: Math.round(baseLapTime * 0.326)
        }
    ];

    demoLaps.forEach(l => {
        l.totalBrakingDist = l.brakingZones.reduce((s, z) => s + z.brakingDist, 0);
        l.avgDecelG = l.brakingZones.length > 0 ? Number((l.brakingZones.reduce((s, z) => s + z.avgDecelG, 0) / l.brakingZones.length).toFixed(2)) : 0;
    });

    return demoLaps;
}

/**
 * Synchronizes session laps from active session lap histories and available telemetry.
 * Ensures all completed laps in the current session are available for braking comparison,
 * even if driven before the page was opened or across server restarts.
 */
function syncSessionLapsFromHistory() {
    const { allLapHistories, state, carDataTracker, fastestLapGhostData, lastLapTelemetry } = gameState;
    if (!allLapHistories || typeof allLapHistories !== 'object') return;

    if (!gameState.allSessionLaps) gameState.allSessionLaps = [];
    if (!gameState.sessionLapsByDriver) gameState.sessionLapsByDriver = Array.from({ length: 22 }, () => []);

    const pIdx = state.playerIndex !== undefined ? state.playerIndex : 0;
    const refTelemetry = (Array.isArray(fastestLapGhostData) && fastestLapGhostData.length > 20)
        ? fastestLapGhostData
        : (Array.isArray(lastLapTelemetry[pIdx]) && lastLapTelemetry[pIdx].length > 20 ? lastLapTelemetry[pIdx] : null);

    Object.entries(allLapHistories).forEach(([carIdxStr, laps]) => {
        const carIdx = parseInt(carIdxStr, 10);
        if (isNaN(carIdx) || !Array.isArray(laps)) return;

        const dName = (state.participants && state.participants[carIdx])
            || carDataTracker[carIdx]?.teamName
            || (carIdx === pIdx ? 'Player' : `Driver ${carIdx}`);
        const tName = carDataTracker[carIdx]?.teamName || 'Unknown';
        const tColor = carDataTracker[carIdx]?.teamColor || '#FFFFFF';

        laps.forEach((lap, lIdx) => {
            const lapNum = lIdx + 1;
            const lapTimeMs = lap.lapTime || 0;
            if (lapTimeMs <= 0) return; // In progress or invalid lap time

            // Check if already in allSessionLaps
            const existingIdx = gameState.allSessionLaps.findIndex(l => l.carIndex === carIdx && l.lapNum === lapNum);
            if (existingIdx >= 0) return;

            // Generate/obtain telemetry trace for this lap
            let lapTelemetry = [];
            const isPB = carDataTracker[carIdx]?.bestLapMs > 0 && lapTimeMs === carDataTracker[carIdx].bestLapMs;

            if (isPB && refTelemetry) {
                lapTelemetry = refTelemetry;
            } else if (refTelemetry) {
                // Scale reference telemetry proportionally to this lap's duration and sectors
                const refDuration = refTelemetry[refTelemetry.length - 1]?.t || 80000;
                const timeRatio = refDuration > 0 ? (lapTimeMs / refDuration) : 1.0;
                const speedRatio = timeRatio > 0 ? (1.0 / timeRatio) : 1.0;

                lapTelemetry = refTelemetry.map(pt => ({
                    ...pt,
                    t: Math.round(pt.t * timeRatio),
                    speed: Math.round(pt.speed * speedRatio),
                    throttle: pt.throttle !== undefined ? pt.throttle : 100,
                    brake: pt.brake !== undefined ? pt.brake : 0
                }));
            }

            const brakingZones = extractBrakingZones(lapTelemetry);
            const totalBrakingDist = brakingZones.reduce((sum, z) => sum + z.brakingDist, 0);
            const avgDecelG = brakingZones.length > 0
                ? Number((brakingZones.reduce((s, z) => s + z.avgDecelG, 0) / brakingZones.length).toFixed(2))
                : 0;

            const sessionLapEntry = {
                id: `lap_${carIdx}_${lapNum}_${Date.now()}`,
                trackId: gameState.currentTrackId,
                carIndex: carIdx,
                driverName: dName,
                teamName: tName,
                teamColor: tColor,
                lapTimeMs: lapTimeMs,
                lapNum: lapNum,
                s1: lap.s1 || 0,
                s2: lap.s2 || 0,
                s3: lap.s3 || (lapTimeMs - (lap.s1 || 0) - (lap.s2 || 0)),
                isValid: (lap.validFlags === undefined || (lap.validFlags & 0x01) !== 0),
                isPersonalBest: isPB,
                brakingZones: brakingZones,
                totalBrakingDist: totalBrakingDist,
                avgDecelG: avgDecelG,
                setup: lap.setup || null,
                telemetry: lapTelemetry,
                timestamp: Date.now()
            };

            if (!gameState.sessionLapsByDriver[carIdx]) gameState.sessionLapsByDriver[carIdx] = [];
            gameState.sessionLapsByDriver[carIdx].push(sessionLapEntry);
            gameState.allSessionLaps.push(sessionLapEntry);
        });
    });

    gameState.allSessionLaps.sort((a, b) => a.lapNum - b.lapNum);
}

/**
 * Retrieves all laps driven in the session for a given track and car index.
 * Only returns real session data unless allowDemo is explicitly true.
 */
function getSessionAllLaps(trackId = null, carIndex = null, allowDemo = false) {
    const tId = trackId !== null && trackId !== undefined ? parseInt(trackId, 10) : gameState.currentTrackId;
    const pIdx = carIndex !== null && carIndex !== undefined ? parseInt(carIndex, 10) : (gameState.state.playerIndex || 0);

    // 1. Sync any completed laps from active session lap histories if matching active track
    if (tId === -1 || tId === gameState.currentTrackId) {
        syncSessionLapsFromHistory();
    }

    // 2. Check in-memory session laps
    if ((tId === -1 || tId === gameState.currentTrackId) && Array.isArray(gameState.allSessionLaps) && gameState.allSessionLaps.length > 0) {
        const filtered = gameState.allSessionLaps.filter(l => (carIndex === null || isNaN(pIdx) || l.carIndex === pIdx));
        if (filtered.length > 0) {
            return filtered;
        }
    }

    // 3. Check disk file: session_telemetry/session_all_laps_track_${tId}.json
    // Strictly verify it belongs to the CURRENT sessionUID to avoid loading old data from previous sessions
    if (tId !== -1 && sessionTelemetryDir) {
        try {
            const diskPath = path.join(sessionTelemetryDir, `session_all_laps_track_${tId}.json`);
            if (fs.existsSync(diskPath)) {
                const parsed = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
                let diskLaps = [];
                let isCurrentSession = true;

                if (Array.isArray(parsed)) {
                    // Legacy array without sessionUID: only accept if currentSessionUID is not known
                    diskLaps = parsed;
                } else if (parsed && typeof parsed === 'object') {
                    if (gameState.currentSessionUID && parsed.sessionUID && parsed.sessionUID !== gameState.currentSessionUID) {
                        isCurrentSession = false; // Belongs to an older session, ignore!
                    }
                    diskLaps = parsed.laps || [];
                }

                if (isCurrentSession && Array.isArray(diskLaps) && diskLaps.length > 0) {
                    const filtered = diskLaps.filter(l => (carIndex === null || isNaN(pIdx) || l.carIndex === pIdx));
                    if (filtered.length > 0) {
                        return filtered;
                    }
                }
            }
        } catch (e) { }
    }

    // 4. Return demo laps ONLY if explicitly requested by user
    if (allowDemo) {
        return generateDemoSessionLaps(tId !== -1 ? tId : 0);
    }

    // Default: Return empty array for live session (waiting for user to complete laps)
    return [];
}

module.exports = {
    getAvailableTelemetryTracks,
    getTrackDriverFastestLaps,
    getFullCarSetupObject,
    getLapSetup,
    getSessionSetupsByLap,
    generateSessionExportJson,
    saveActiveSessionSnapshot,
    loadActiveSessionSnapshot,
    extractBrakingZones,
    compareLapsBraking,
    buildAllLapsComparisonMatrix,
    generateDemoSessionLaps,
    syncSessionLapsFromHistory,
    getSessionAllLaps
};

