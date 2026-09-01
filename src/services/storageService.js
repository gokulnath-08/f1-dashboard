const fs = require('fs');
const path = require('path');
const { trackMapsDir, lapTimeDir, telemetryDir } = require('../config');
const { trackMap } = require('../config/constants');
const gameState = require('../state/gameState');
const { formatMsExport, formatSectorMs } = require('../utils/formatters');

/**
 * Scans telemetry, laptime records, and track maps to return a complete list of all available circuits.
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
                hasTrackMap: false
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

    // 4. Incorporate all records from allTimeFastest
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
 * Builds a structured, complete, exhaustive JSON snapshot of all session data:
 * - Every lap with sector 1, sector 2, sector 3 times and validation flags for all 22 cars
 * - Flat lap-by-lap table for easy data science / CSV export
 * - Tyre stint strategies
 * - Full 20Hz telemetry traces (speed, throttle, brake, gears, RPM, DRS, distance, G-forces)
 * - Complete setup, damage, steward offenses, track geometry, and weather forecasts.
 */
function generateSessionExportJson() {
    const {
        state, carDataTracker, allLapHistories, allTyreStints,
        currentSessionUID, currentGameYear, currentTrackId,
        carPhysics, fastestLapGhostData, lastLapTelemetry, currentLapTelemetry
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
                isSessionBest: state.session.sessionFastestLapMs > 0 && lap.lapTime === state.session.sessionFastestLapMs
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
            laps: processedLaps
        };
    }

    return {
        metadata: {
            title: 'F1 Telemetry Dashboard - Complete Session Data Export',
            exportedAt: new Date().toISOString(),
            exportedTimestamp: Date.now(),
            gameYear: currentGameYear,
            sessionUID: currentSessionUID,
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
        player: {
            playerIndex: pIdx,
            driverName: (state.participants && state.participants[pIdx]) ? state.participants[pIdx] : `Player (Car ${pIdx})`,
            lap: state.lap,
            penalties: state.penalties,
            inputs: state.inputs,
            car: state.car,
            setup: state.setup,
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
        playerLastLapTelemetry: lastLapTelemetry[pIdx] || [],
        playerCurrentLapTelemetry: currentLapTelemetry[pIdx] || [],
        allCarsCurrentLapTelemetry: currentLapTelemetry,
        allCarsLastLapTelemetry: lastLapTelemetry
    };
}

module.exports = {
    getAvailableTelemetryTracks,
    generateSessionExportJson
};
