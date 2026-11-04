const fs = require('fs');
const path = require('path');
const { telemetryDir, lapTimeDir, setupsDir, fastestJsonPath, sessionTelemetryDir } = require('../../config');
const { visualTyreNames, fallbackTyreNames, pitMap } = require('../../config/constants');
const gameState = require('../../state/gameState');
const { touchUdpPacket, setPlayerIndex, getSectorTime, getLiveSectorTiming } = require('../../state/stateHelpers');
const { syncTrackLinesForTrack, lockOfficialSectorLinesFromTelemetry, buildApproxPitLane, isTrackFinalized } = require('../../services/trackService');
const { saveActiveSessionSnapshot, extractBrakingZones } = require('../../services/storageService');
const { completeLiveTrackMapping } = require('./motionHandler');
const wsServer = require('../../websocket/wsServer');

function handleSessionHistory(data) {
    touchUdpPacket();
    const { allLapHistories, allTyreStints, carDataTracker, state } = gameState;
    const carIndex = data.m_carIdx !== undefined ? data.m_carIdx : data.carIdx;
    const numLaps = data.m_numLaps !== undefined ? data.m_numLaps : data.numLaps;
    const historyArray = data.m_lapHistoryData || data.lapHistoryData || [];

    if (!allLapHistories[carIndex]) allLapHistories[carIndex] = [];
    const currentHist = allLapHistories[carIndex];
    const maxLen = Math.max(numLaps, currentHist.length);
    const updated = [];

    for (let k = 0; k < maxLen; k++) {
        const lapRaw = (k < numLaps && k < historyArray.length) ? historyArray[k] : null;
        const existing = currentHist[k] || null;

        let lapTime = 0;
        let s1 = 0, s2 = 0, s3 = 0;
        let validFlags = 0x0f;

        if (lapRaw) {
            lapTime = lapRaw.m_lapTimeInMS || lapRaw.lapTimeInMS || (lapRaw.m_lapTime ? Math.round(lapRaw.m_lapTime * 1000) : 0) || (lapRaw.lapTime ? Math.round(lapRaw.lapTime * 1000) : 0) || 0;
            s1 = getSectorTime(lapRaw, 1);
            s2 = getSectorTime(lapRaw, 2);
            s3 = getSectorTime(lapRaw, 3);
            validFlags = lapRaw.m_lapValidBitFlags !== undefined ? lapRaw.m_lapValidBitFlags : 0x0f;
        }

        // Non-destructive merge: never overwrite valid existing lap/sector data with zeroes
        if (existing) {
            if (lapTime === 0 && existing.lapTime > 0) lapTime = existing.lapTime;
            if (s1 === 0 && existing.s1 > 0) s1 = existing.s1;
            if (s2 === 0 && existing.s2 > 0) s2 = existing.s2;
            if (s3 === 0 && existing.s3 > 0) s3 = existing.s3;
            if (!lapRaw && existing.validFlags !== undefined) validFlags = existing.validFlags;
        }

        // Auto-calculate S3 if S1, S2 and lapTime are available
        if (s3 === 0 && lapTime > 0 && s1 > 0 && s2 > 0 && lapTime > (s1 + s2)) {
            s3 = lapTime - (s1 + s2);
        }
        // Auto-calculate lapTime if all 3 sectors are available
        if (lapTime === 0 && s1 > 0 && s2 > 0 && s3 > 0) {
            lapTime = s1 + s2 + s3;
        }

        const lapNum = k + 1;
        const lapSetup = existing?.setup || gameState.lapSetups?.[lapNum] || gameState.carLapSetups?.[carIndex]?.[lapNum] || (carIndex === state.playerIndex ? { ...state.setup } : null);

        updated.push({
            lapTime,
            s1,
            s2,
            s3,
            validFlags,
            setup: lapSetup ? { ...lapSetup } : null
        });
    }
    allLapHistories[carIndex] = updated;
    gameState.lapHistoryDirty = true;

    const tyreStints = data.m_tyreStintsHistoryData || data.tyreStintsHistoryData || [];
    const numTyreStints = data.m_numTyreStints !== undefined ? data.m_numTyreStints : (data.numTyreStints || tyreStints.length);
    allTyreStints[carIndex] = tyreStints.slice(0, numTyreStints).map(stint => ({
        endLap: stint.m_endLap !== undefined ? stint.m_endLap : stint.endLap,
        actualTyreCompound: stint.m_tyreActualCompound !== undefined ? stint.m_tyreActualCompound : stint.tyreActualCompound,
        visualTyreCompound: stint.m_tyreVisualCompound !== undefined ? stint.m_tyreVisualCompound : stint.tyreVisualCompound,
        tyreName: visualTyreNames[stint.m_tyreVisualCompound] || fallbackTyreNames[stint.m_tyreActualCompound] || 'UNK'
    }));

    if (numLaps > 0) {
        const bLapNum = data.m_bestLapTimeLapNum !== undefined ? data.m_bestLapTimeLapNum : data.bestLapTimeLapNum;
        const bS1Lap = data.m_bestSector1LapNum !== undefined ? data.m_bestSector1LapNum : data.bestSector1LapNum;
        const bS2Lap = data.m_bestSector2LapNum !== undefined ? data.m_bestSector2LapNum : data.bestSector2LapNum;
        const bS3Lap = data.m_bestSector3LapNum !== undefined ? data.m_bestSector3LapNum : data.bestSector3LapNum;

        // DIRECT BEST LAP TIME FROM GAME (NO ARBITRARY RECALCULATION)
        let directBestLapMs = 0;
        if (bLapNum && bLapNum > 0 && bLapNum <= historyArray.length) {
            const bLapObj = historyArray[bLapNum - 1];
            directBestLapMs = bLapObj ? (bLapObj.m_lapTimeInMS || bLapObj.lapTimeInMS || (bLapObj.m_lapTime ? Math.round(bLapObj.m_lapTime * 1000) : 0) || 0) : 0;
        }

        if (directBestLapMs > 0) {
            carDataTracker[carIndex].bestLapMs = directBestLapMs;
            carDataTracker[carIndex].bestLapNum = bLapNum;
            if (carIndex === state.playerIndex) {
                state.lap.bestMs = directBestLapMs;
            }
            if (state.session.sessionFastestLapMs === Infinity || directBestLapMs < state.session.sessionFastestLapMs) {
                state.session.sessionFastestLapMs = directBestLapMs;
                state.session.fastestLapCarIndex = carIndex;
                state.session.sessionFastestDriver = (state.participants && state.participants[carIndex]) ? state.participants[carIndex] : `Car ${carIndex}`;
            }
        }

        const bestS1 = (bS1Lap && bS1Lap > 0 && bS1Lap <= historyArray.length) ? getSectorTime(historyArray[bS1Lap - 1], 1) : 0;
        const bestS2 = (bS2Lap && bS2Lap > 0 && bS2Lap <= historyArray.length) ? getSectorTime(historyArray[bS2Lap - 1], 2) : 0;
        const bestS3 = (bS3Lap && bS3Lap > 0 && bS3Lap <= historyArray.length) ? getSectorTime(historyArray[bS3Lap - 1], 3) : 0;

        if (bestS1 > 0) carDataTracker[carIndex].bestS1 = bestS1;
        if (bestS2 > 0) carDataTracker[carIndex].bestS2 = bestS2;
        if (bestS3 > 0) carDataTracker[carIndex].bestS3 = bestS3;

        if (bestS1 > 0 && (state.session.sessionBestS1 === Infinity || bestS1 < state.session.sessionBestS1)) state.session.sessionBestS1 = bestS1;
        if (bestS2 > 0 && (state.session.sessionBestS2 === Infinity || bestS2 < state.session.sessionBestS2)) state.session.sessionBestS2 = bestS2;
        if (bestS3 > 0 && (state.session.sessionBestS3 === Infinity || bestS3 < state.session.sessionBestS3)) state.session.sessionBestS3 = bestS3;

        const lastCompletedLapIdx = numLaps - 2;
        if (lastCompletedLapIdx >= 0 && lastCompletedLapIdx < historyArray.length) {
            const finalS1 = getSectorTime(historyArray[lastCompletedLapIdx], 1);
            const finalS2 = getSectorTime(historyArray[lastCompletedLapIdx], 2);
            const finalS3 = getSectorTime(historyArray[lastCompletedLapIdx], 3);
            if (finalS1 > 0) carDataTracker[carIndex].s1 = finalS1;
            if (finalS2 > 0) carDataTracker[carIndex].s2 = finalS2;
            if (finalS3 > 0) carDataTracker[carIndex].s3 = finalS3;
            if (carIndex === state.playerIndex) {
                if (finalS1 > 0) state.lap.s1 = finalS1;
                if (finalS2 > 0) state.lap.s2 = finalS2;
                if (finalS3 > 0) state.lap.s3 = finalS3;
            }
        }
    }

    saveActiveSessionSnapshot();
}

function handleLapData(data) {
    touchUdpPacket();
    setPlayerIndex(data.m_header);
    const {
        state, carPhysics, carDataTracker, lastLapTelemetry, currentLapTelemetry,
        allLapHistories, allTimeFastest, currentTrackId, currentGameYear
    } = gameState;
    const pIdx = state.playerIndex;
    let sessionFastestLapMs = Infinity;
    let fastestLapIndex = -1;

    for (let i = 0; i < 22; i++) {
        const lap = data.m_lapData ? data.m_lapData[i] : (data.lapData ? data.lapData[i] : null);
        if (!lap) continue;

        // Lap Transition Logic
        if (carPhysics[i].lapNum === 0) {
            // Initial packet for this car - record lap number without triggering false lap completion
            carPhysics[i].lapNum = lap.m_currentLapNum;
        } else if (lap.m_currentLapNum > carPhysics[i].lapNum) {
            // True lap transition across start/finish line - copy full rich telemetry trace
            lastLapTelemetry[i] = (currentLapTelemetry[i] || []).map(pt => ({
                d: pt.d,
                t: pt.t,
                x: pt.x,
                y: pt.y !== undefined ? pt.y : 0,
                z: pt.z,
                yaw: pt.yaw,
                pitch: pt.pitch || 0,
                roll: pt.roll || 0,
                throttle: pt.throttle !== undefined ? pt.throttle : 0,
                brake: pt.brake !== undefined ? pt.brake : 0,
                speed: pt.speed !== undefined ? pt.speed : 0,
                steer: pt.steer !== undefined ? pt.steer : 0,
                gear: pt.gear !== undefined ? pt.gear : 0,
                drs: pt.drs !== undefined ? pt.drs : 0,
                drsOpen: pt.drsOpen !== undefined ? pt.drsOpen : 0,
                drsAvailable: pt.drsAvailable !== undefined ? pt.drsAvailable : 0,
                drsActivationDistance: pt.drsActivationDistance !== undefined ? pt.drsActivationDistance : null,
                straightMode: pt.straightMode !== undefined ? pt.straightMode : (currentGameYear === 26 && pt.drs === 1 ? 1 : 0),
                activeAeroMode: pt.activeAeroMode !== undefined ? pt.activeAeroMode : (currentGameYear === 26 && pt.drs === 1 ? 1 : 0),
                gameYear: pt.gameYear || currentGameYear
            }));
            currentLapTelemetry[i] = [];

            // Capture ghost telemetry upon lap completion with full lap validation
            const lastTime = lap.m_lastLapTimeInMS || (lap.m_lastLapTime * 1000) || 0;
            const tLen = state.session.trackLength > 0 ? state.session.trackLength : 4000;

            // Preserve sector times of the completed lap before reset
            const finishedS1 = carDataTracker[i].s1 || 0;
            const finishedS2 = carDataTracker[i].s2 || 0;
            const finishedS3 = (lastTime > 0 && finishedS1 > 0 && finishedS2 > 0) ? Math.max(0, lastTime - (finishedS1 + finishedS2)) : (carDataTracker[i].s3 || 0);

            // Record completed lap in allLapHistories for immediate pace analysis and classification
            if (lastTime > 0) {
                if (!allLapHistories[i]) allLapHistories[i] = [];
                const completedLapNum = (lap.m_currentLapNum > 1) ? (lap.m_currentLapNum - 1) : (carPhysics[i].lapNum || 1);
                const lapIdx = Math.max(0, completedLapNum - 1);
                const existing = allLapHistories[i][lapIdx] || {};
                const completedLapSetup = (i === pIdx)
                    ? { ...state.setup }
                    : (gameState.carLapSetups?.[i]?.[completedLapNum] || existing.setup || null);

                allLapHistories[i][lapIdx] = {
                    lapTime: lastTime || existing.lapTime || 0,
                    s1: finishedS1 || existing.s1 || 0,
                    s2: finishedS2 || existing.s2 || 0,
                    s3: finishedS3 || existing.s3 || (lastTime > 0 && finishedS1 > 0 && finishedS2 > 0 ? Math.max(0, lastTime - (finishedS1 + finishedS2)) : 0),
                    validFlags: (carDataTracker[i].penalties === 0 && !carDataTracker[i].invalidLap) ? 0x01 : (existing.validFlags !== undefined ? existing.validFlags : 0x00),
                    setup: completedLapSetup ? { ...completedLapSetup } : (existing.setup || null)
                };
                if (i === pIdx && gameState.lapSetups) {
                    gameState.lapSetups[completedLapNum] = { ...state.setup };
                }
                if (gameState.carLapSetups && gameState.carLapSetups[i]) {
                    gameState.carLapSetups[i][completedLapNum] = completedLapSetup ? { ...completedLapSetup } : { ...state.setup };
                }
                gameState.lapHistoryDirty = true;
            }

            // Clean up telemetry: remove points with invalid coordinates
            let validTelemetry = (lastLapTelemetry[i] || [])
                .filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.z) && (pt.x !== 0 || pt.z !== 0));

            const firstD = validTelemetry.length > 0 ? (validTelemetry[0].d || 0) : 9999;
            const lastD = validTelemetry.length > 0 ? (validTelemetry[validTelemetry.length - 1].d || 0) : 0;
            const spansDistance = (lastD - firstD) >= (tLen * 0.65);
            const hasMinPoints = validTelemetry.length >= 40;
            const startsNearLine = validTelemetry.some(pt => (pt.d || 0) < 150);
            const lastTelemetryPt = validTelemetry.length > 0 ? validTelemetry[validTelemetry.length - 1] : null;
            const completesLap = lastTelemetryPt && (lastTelemetryPt.d || 0) >= (tLen * 0.75);
            const isCleanLap = hasMinPoints && startsNearLine && completesLap;

            // --- PROCESS & STORE SESSION LAP WITH BRAKING TELEMETRY ---
            if (validTelemetry.length >= 10) {
                validTelemetry.sort((a, b) => (a.d !== undefined && b.d !== undefined) ? a.d - b.d : a.t - b.t);

                // Ensure the starting point is cleanly anchored at d = 0, t = 0
                if (validTelemetry[0].d > 0) {
                    validTelemetry.unshift({
                        ...validTelemetry[0],
                        d: 0,
                        t: 0
                    });
                }

                // Match final point to official lap time and track distance
                if (lastTime > 0) {
                    const lastPoint = validTelemetry[validTelemetry.length - 1];
                    if (lastPoint) {
                        const trackLen = state.session.trackLength > 0 ? state.session.trackLength : (lastPoint.d + 20);
                        validTelemetry.push({ ...lastPoint, d: trackLen, t: lastTime });
                    }
                }

                const isPlayer = (i === pIdx);
                const dName = (state.participants && state.participants[i]) || carDataTracker[i].teamName || (isPlayer ? 'Player' : `Driver ${i}`);
                const completedLapNum = (lap.m_currentLapNum > 1) ? (lap.m_currentLapNum - 1) : (carPhysics[i].lapNum || 1);

                // Extract corner braking zones for this lap
                const lapBrakingZones = extractBrakingZones(validTelemetry);
                const totalBrakingDist = lapBrakingZones.reduce((sum, z) => sum + z.brakingDist, 0);

                const sessionLapEntry = {
                    id: `lap_${i}_${completedLapNum}_${Date.now()}`,
                    trackId: currentTrackId,
                    carIndex: i,
                    driverName: dName,
                    teamName: carDataTracker[i].teamName || 'Unknown',
                    teamColor: carDataTracker[i].teamColor || '#FFFFFF',
                    lapTimeMs: lastTime || (validTelemetry[validTelemetry.length - 1]?.t || 0),
                    lapNum: completedLapNum,
                    s1: finishedS1,
                    s2: finishedS2,
                    s3: finishedS3,
                    isValid: (carDataTracker[i].penalties === 0 && !carDataTracker[i].invalidLap),
                    brakingZones: lapBrakingZones,
                    totalBrakingDist: Math.round(totalBrakingDist),
                    avgDecelG: lapBrakingZones.length > 0 ? Number((lapBrakingZones.reduce((s, z) => s + z.avgDecelG, 0) / lapBrakingZones.length).toFixed(2)) : 0,
                    setup: (i === pIdx) ? { ...state.setup } : (gameState.carLapSetups?.[i]?.[completedLapNum] || null),
                    telemetry: validTelemetry,
                    timestamp: Date.now()
                };

                // Store in session laps collections (tracking every lap driven in the session)
                if (!gameState.allSessionLaps) gameState.allSessionLaps = [];
                if (!gameState.sessionLapsByDriver) gameState.sessionLapsByDriver = Array.from({ length: 22 }, () => []);
                if (!gameState.sessionLapsByDriver[i]) gameState.sessionLapsByDriver[i] = [];

                const dLapIdx = gameState.sessionLapsByDriver[i].findIndex(l => l.lapNum === completedLapNum);
                if (dLapIdx >= 0) {
                    gameState.sessionLapsByDriver[i][dLapIdx] = sessionLapEntry;
                } else {
                    gameState.sessionLapsByDriver[i].push(sessionLapEntry);
                }

                const allLapsIdx = gameState.allSessionLaps.findIndex(l => l.carIndex === i && l.lapNum === completedLapNum);
                if (allLapsIdx >= 0) {
                    gameState.allSessionLaps[allLapsIdx] = sessionLapEntry;
                } else {
                    gameState.allSessionLaps.push(sessionLapEntry);
                }

                // Persist session laps to session_telemetry on disk
                if (currentTrackId !== -1) {
                    try {
                        if (!fs.existsSync(sessionTelemetryDir)) {
                            fs.mkdirSync(sessionTelemetryDir, { recursive: true });
                        }
                        const allLapsFilePath = path.join(sessionTelemetryDir, `session_all_laps_track_${currentTrackId}.json`);
                        const sessionLapsPayload = {
                            sessionUID: gameState.currentSessionUID,
                            sessionLinkIdentifier: gameState.currentSessionLinkIdentifier,
                            trackId: currentTrackId,
                            savedAt: Date.now(),
                            laps: gameState.allSessionLaps
                        };
                        fs.writeFileSync(allLapsFilePath, JSON.stringify(sessionLapsPayload, null, 2), 'utf8');
                    } catch (e) {
                        console.error('⚠️ [Session All Laps Save Error]:', e.message);
                    }
                }

                // Broadcast completed lap event with braking summary to all WebSockets
                try {
                    wsServer.broadcast(JSON.stringify({
                        type: 'sessionLapCompleted',
                        carIndex: i,
                        data: {
                            id: sessionLapEntry.id,
                            carIndex: i,
                            driverName: dName,
                            teamName: sessionLapEntry.teamName,
                            teamColor: sessionLapEntry.teamColor,
                            lapTimeMs: sessionLapEntry.lapTimeMs,
                            lapNum: completedLapNum,
                            s1: finishedS1,
                            s2: finishedS2,
                            s3: finishedS3,
                            isValid: sessionLapEntry.isValid,
                            brakingZonesCount: lapBrakingZones.length,
                            totalBrakingDist: sessionLapEntry.totalBrakingDist,
                            avgDecelG: sessionLapEntry.avgDecelG,
                            timestamp: sessionLapEntry.timestamp
                        }
                    }));
                } catch (e) { }

                // --- SESSION FASTEST LAP STORAGE (DRIVER FASTEST) ---
                const existingDriverBest = gameState.sessionDriverFastestLaps && gameState.sessionDriverFastestLaps[i];
                const isFirstLap = !existingDriverBest;
                const isFasterTime = lastTime > 0 && (!existingDriverBest || existingDriverBest.lapTimeMs === 0 || lastTime < existingDriverBest.lapTimeMs);
                const isFullerLap = existingDriverBest && (existingDriverBest.lapTimeMs === 0) && (validTelemetry.length > (existingDriverBest.telemetry?.length || 0) * 1.3);

                if (isFirstLap || isFasterTime || isFullerLap) {
                    if (!gameState.sessionDriverFastestLaps) gameState.sessionDriverFastestLaps = Array.from({ length: 22 }, () => null);
                    gameState.sessionDriverFastestLaps[i] = sessionLapEntry;

                    if (currentTrackId !== -1) {
                        try {
                            const sessionFilePath = path.join(sessionTelemetryDir, `fastest_car_${i}_track_${currentTrackId}.json`);
                            fs.writeFileSync(sessionFilePath, JSON.stringify(sessionLapEntry, null, 2), 'utf8');
                        } catch (e) { }
                    }

                    try {
                        wsServer.broadcast(JSON.stringify({
                            type: 'driverFastestLapUpdate',
                            carIndex: i,
                            data: {
                                carIndex: i,
                                driverName: dName,
                                teamName: carDataTracker[i].teamName || 'Unknown',
                                teamColor: carDataTracker[i].teamColor || '#FFFFFF',
                                lapTimeMs: sessionLapEntry.lapTimeMs,
                                lapNum: completedLapNum,
                                s1: finishedS1,
                                s2: finishedS2,
                                s3: finishedS3,
                                telemetryLength: validTelemetry.length,
                                timestamp: Date.now()
                            }
                        }));
                    } catch (e) { }

                    console.log(`⏱️ Car ${i} (${dName}) - Lap ${completedLapNum}: ${sessionLapEntry.lapTimeMs}ms (${validTelemetry.length} pts, Braking: ${totalBrakingDist}m across ${lapBrakingZones.length} zones)`);
                }
            }

            if (lastTime > 50000 && currentTrackId !== -1 && isCleanLap) {
                const isPlayer = (i === pIdx);
                const dName = (state.participants && state.participants[i]) || carDataTracker[i].teamName || (isPlayer ? 'Player' : `Driver ${i}`);
                let record = allTimeFastest[currentTrackId];
                const trackTelemetryPath = path.join(telemetryDir, `telemetry_${currentTrackId}.json`);
                const trackFastestPath = path.join(lapTimeDir, `fastest_${currentTrackId}.json`);
                const telMissing = !fs.existsSync(trackTelemetryPath);

                const shouldSaveTelemetry = isPlayer || telMissing || (!record || lastTime < record.time);

                if (shouldSaveTelemetry) {
                    const driverName = dName;

                    allTimeFastest[currentTrackId] = {
                        time: (!record || lastTime < record.time) ? lastTime : record.time,
                        driver: (!record || lastTime < record.time) ? driverName : (record.driver || driverName),
                        s1: finishedS1 || (record && record.s1) || 0,
                        s2: finishedS2 || (record && record.s2) || 0,
                        s3: finishedS3 || (record && record.s3) || 0,
                        hasTelemetry: true
                    };
                    gameState.fastestLapGhostData = validTelemetry;
                    fs.writeFileSync(fastestJsonPath, JSON.stringify(allTimeFastest, null, 2), 'utf8');

                    // Save compact ghost lap [ { d, t } ]
                    fs.writeFileSync(trackFastestPath, JSON.stringify(validTelemetry.map(pt => ({ d: pt.d, t: pt.t }))), 'utf8');

                    // Save full rich telemetry
                    fs.writeFileSync(trackTelemetryPath, JSON.stringify(validTelemetry, null, 2), 'utf8');

                    if (!record || lastTime < record.time) {
                        state.session.allTimeFastestLapMs = lastTime;
                        state.session.allTimeFastestDriver = driverName;
                        console.log(`🏆 NEW TRACK RECORD & FULL TELEMETRY SAVED! Track ${currentTrackId}: ${driverName} - ${lastTime}ms (${validTelemetry.length} pts)`);
                    } else {
                        console.log(`💾 PLAYER TELEMETRY SAVED! Track ${currentTrackId}: ${driverName} - ${lastTime}ms (${validTelemetry.length} pts)`);
                    }

                    // Update sector lines in track map using official sector times only if not finalized
                    if (!isTrackFinalized(currentTrackId)) {
                        syncTrackLinesForTrack(currentTrackId, false, wsServer.broadcast, currentGameYear);
                    }
                } else if (!isTrackFinalized(currentTrackId)) {
                    lockOfficialSectorLinesFromTelemetry(i, finishedS1, finishedS2, validTelemetry, wsServer.broadcast);
                }
            }

            if (!gameState.isTrackMapped && currentTrackId !== -1 && state.trackPoints && state.trackPoints.length >= 50 && i === pIdx && !isTrackFinalized(currentTrackId)) {
                completeLiveTrackMapping();
            }

            // RESET sector tracking for the new lap
            carDataTracker[i].s1 = 0;
            carDataTracker[i].s2 = 0;
            carDataTracker[i].s3 = 0;
            carDataTracker[i].s1Status = 'pending';
            carDataTracker[i].s2Status = 'pending';
            carDataTracker[i].s3Status = 'pending';

            if (i === pIdx) {
                state.lap.s1 = 0;
                state.lap.s2 = 0;
                state.lap.s3 = 0;
                state.lap.liveS1 = 0;
                state.lap.liveS2 = 0;
                state.lap.liveS3 = 0;
                state.lap.s1State = 'live';
                state.lap.s2State = 'pending';
                state.lap.s3State = 'pending';
                state.lap.s1Status = 'pending';
                state.lap.s2Status = 'pending';
                state.lap.s3Status = 'pending';
            }

            // Save setup at the end of the lap for the player
            if (i === pIdx && currentTrackId !== -1) {
                try {
                    const sPath = path.join(setupsDir, `setups_y${currentGameYear}_t${currentTrackId}.json`);
                    let setupsData = [];
                    if (fs.existsSync(sPath)) {
                        setupsData = JSON.parse(fs.readFileSync(sPath, 'utf8'));
                    }

                    const existingLapIndex = setupsData.findIndex(s => s.lapNum === carPhysics[i].lapNum);
                    const setupEntry = {
                        lapNum: carPhysics[i].lapNum,
                        time: lastTime,
                        setup: { ...state.setup },
                        timestamp: Date.now()
                    };

                    if (existingLapIndex >= 0) {
                        setupsData[existingLapIndex] = setupEntry;
                    } else {
                        setupsData.push(setupEntry);
                    }

                    fs.writeFileSync(sPath, JSON.stringify(setupsData, null, 2), 'utf8');

                    const setupMsg = JSON.stringify({ type: 'trackSetupsResponse', trackId: currentTrackId, data: setupsData });
                    wsServer.broadcast(setupMsg);
                } catch (e) {
                    console.error('⚠️ Error saving setup for lap:', e);
                }
            }
        }

        carPhysics[i].lapDistance = lap.m_lapDistance;
        carPhysics[i].lapNum = lap.m_currentLapNum;

        const dtcMsPart = lap.m_deltaToCarInFrontMSPart !== undefined ? lap.m_deltaToCarInFrontMSPart : 0;
        const dtcMinPart = lap.m_deltaToCarInFrontMinutesPart !== undefined ? lap.m_deltaToCarInFrontMinutesPart : 0;
        const dtcMs = (dtcMinPart * 60000) + dtcMsPart;
        const officialDtc = (dtcMs || lap.m_deltaToCarInFrontInMS || 0) / 1000;
        carPhysics[i].officialDelta = officialDtc;
        if (officialDtc > 0 && officialDtc < 180) {
            carPhysics[i].lastValidDelta = officialDtc;
        }

        const dtlMsPart = lap.m_deltaToRaceLeaderMSPart !== undefined ? lap.m_deltaToRaceLeaderMSPart : 0;
        const dtlMinPart = lap.m_deltaToRaceLeaderMinutesPart !== undefined ? lap.m_deltaToRaceLeaderMinutesPart : 0;
        const dtlMs = (dtlMinPart * 60000) + dtlMsPart;
        const officialDtl = (dtlMs || lap.m_deltaToRaceLeaderInMS || 0) / 1000;
        carPhysics[i].officialLeaderDelta = officialDtl;
        if (officialDtl > 0 && officialDtl < 360) {
            carPhysics[i].lastValidLeaderDelta = officialDtl;
        }

        carPhysics[i].sector = lap.m_sector !== undefined ? lap.m_sector : (lap.sector || 0);

        // Record Live Telemetry
        const curMs = lap.m_currentLapTimeInMS || (lap.m_lastLapTime * 1000) || (lap.m_currentLapTime * 1000) || 0;
        if (curMs >= 0 && lap.m_lapDistance >= 0 && lap.m_resultStatus !== 0) {
            const carObj = state.allCars && state.allCars[i] ? state.allCars[i] : {};
            if (carObj.x !== undefined && Number.isFinite(carObj.x) && (carObj.x !== 0 || carObj.z !== 0)) {
                const arr = currentLapTelemetry[i] || (currentLapTelemetry[i] = []);
                const lastPt = arr.length > 0 ? arr[arr.length - 1] : null;

                const distDiff = lastPt ? Math.abs(lap.m_lapDistance - lastPt.d) : 999;
                const timeDiff = lastPt ? Math.abs(curMs - lastPt.t) : 999;

                if (!lastPt || distDiff >= 2.0 || timeDiff >= 100) {
                    const carPhys = carPhysics[i] || {};
                    let pt = {
                        d: Math.round(lap.m_lapDistance * 10) / 10,
                        t: curMs,
                        x: Math.round(carObj.x * 100) / 100,
                        y: Math.round((carObj.y || 0) * 100) / 100,
                        z: Math.round(carObj.z * 100) / 100,
                        yaw: Math.round((carObj.yaw || 0) * 1000) / 1000,
                        pitch: Math.round((carObj.pitch || 0) * 1000) / 1000,
                        roll: Math.round((carObj.roll || 0) * 1000) / 1000,
                        throttle: carPhys.throttle !== undefined ? carPhys.throttle : 0,
                        brake: carPhys.brake !== undefined ? carPhys.brake : 0,
                        speed: Math.round(carPhys.speed || carObj.speed || 0),
                        steer: carPhys.steer !== undefined ? carPhys.steer : 0,
                        gear: carPhys.gear !== undefined ? carPhys.gear : 0,
                        drs: carPhys.drsInt === 1 || carPhys.drs === 'OPEN' ? 1 : 0,
                        drsOpen: carPhys.drsInt === 1 || carPhys.drs === 'OPEN' ? 1 : 0,
                        drsAvailable: 0,
                        drsActivationDistance: null,
                        straightMode: (currentGameYear === 26 && (carPhys.drsInt === 1 || carPhys.drs === 'OPEN')) ? 1 : 0,
                        activeAeroMode: (currentGameYear === 26 && (carPhys.drsInt === 1 || carPhys.drs === 'OPEN')) ? 1 : 0,
                        gameYear: currentGameYear
                    };
                    if (i === state.playerIndex) {
                        const is26 = currentGameYear === 26;
                        pt.throttle = Math.round(state.inputs.throttle);
                        pt.brake = Math.round(state.inputs.brake);
                        pt.speed = Math.round(state.inputs.speed);
                        pt.steer = Math.round(state.inputs.steer * 100) / 100;
                        pt.gear = state.inputs.gear;
                        pt.drs = state.inputs.drs === 'OPEN' ? 1 : 0;
                        pt.drsOpen = pt.drs;
                        pt.drsAvailable = state.inputs.drsAvailable ? 1 : 0;
                        pt.drsActivationDistance = Number.isFinite(state.inputs.drsActivationDistance) ? state.inputs.drsActivationDistance : null;
                        pt.straightMode = (is26 && (state.inputs.drs === 'OPEN' || state.inputs.straightMode === 1)) ? 1 : (state.inputs.straightMode || 0);
                        pt.activeAeroMode = pt.straightMode;
                        pt.gameYear = currentGameYear;
                    }
                    arr.push(pt);
                    if (arr.length > 10000) {
                        arr.shift();
                    }
                }
            }
        }

        const liveS1 = getSectorTime(lap, 1);
        const liveS2 = getSectorTime(lap, 2);
        const liveS3 = getSectorTime(lap, 3);
        const curSector = lap.m_sector !== undefined ? lap.m_sector : (lap.sector || 0);
        carDataTracker[i].currentSector = curSector;

        if (liveS1 > 0) {
            const priorBestS1 = carDataTracker[i].bestS1 || 0;
            const sb1 = (state.session.sessionBestS1 && state.session.sessionBestS1 !== Infinity) ? state.session.sessionBestS1 : 0;
            carDataTracker[i].s1 = liveS1;

            if (sb1 > 0 && liveS1 <= sb1) {
                carDataTracker[i].s1Status = 'sb';
            } else if (priorBestS1 > 0 && liveS1 < priorBestS1) {
                carDataTracker[i].s1Status = 'pb';
            } else if (priorBestS1 === 0) {
                carDataTracker[i].s1Status = (sb1 > 0 && liveS1 <= sb1) ? 'sb' : 'pb';
            } else {
                carDataTracker[i].s1Status = 'yellow';
            }

            if (!carDataTracker[i].bestS1 || liveS1 < carDataTracker[i].bestS1) {
                carDataTracker[i].bestS1 = liveS1;
            }
            if (state.session.sessionBestS1 === Infinity || state.session.sessionBestS1 === 0 || liveS1 < state.session.sessionBestS1) {
                state.session.sessionBestS1 = liveS1;
                state.session.sessionBestS1Driver = (state.participants && state.participants[i]) ? state.participants[i] : `Car ${i}`;
            }
        }
        if (liveS2 > 0) {
            const priorBestS2 = carDataTracker[i].bestS2 || 0;
            const sb2 = (state.session.sessionBestS2 && state.session.sessionBestS2 !== Infinity) ? state.session.sessionBestS2 : 0;
            carDataTracker[i].s2 = liveS2;

            if (sb2 > 0 && liveS2 <= sb2) {
                carDataTracker[i].s2Status = 'sb';
            } else if (priorBestS2 > 0 && liveS2 < priorBestS2) {
                carDataTracker[i].s2Status = 'pb';
            } else if (priorBestS2 === 0) {
                carDataTracker[i].s2Status = (sb2 > 0 && liveS2 <= sb2) ? 'sb' : 'pb';
            } else {
                carDataTracker[i].s2Status = 'yellow';
            }

            if (!carDataTracker[i].bestS2 || liveS2 < carDataTracker[i].bestS2) {
                carDataTracker[i].bestS2 = liveS2;
            }
            if (state.session.sessionBestS2 === Infinity || state.session.sessionBestS2 === 0 || liveS2 < state.session.sessionBestS2) {
                state.session.sessionBestS2 = liveS2;
                state.session.sessionBestS2Driver = (state.participants && state.participants[i]) ? state.participants[i] : `Car ${i}`;
            }
        }
        if (liveS3 > 0) {
            const priorBestS3 = carDataTracker[i].bestS3 || 0;
            const sb3 = (state.session.sessionBestS3 && state.session.sessionBestS3 !== Infinity) ? state.session.sessionBestS3 : 0;
            carDataTracker[i].s3 = liveS3;

            if (sb3 > 0 && liveS3 <= sb3) {
                carDataTracker[i].s3Status = 'sb';
            } else if (priorBestS3 > 0 && liveS3 < priorBestS3) {
                carDataTracker[i].s3Status = 'pb';
            } else if (priorBestS3 === 0) {
                carDataTracker[i].s3Status = (sb3 > 0 && liveS3 <= sb3) ? 'sb' : 'pb';
            } else {
                carDataTracker[i].s3Status = 'yellow';
            }

            if (!carDataTracker[i].bestS3 || liveS3 < carDataTracker[i].bestS3) {
                carDataTracker[i].bestS3 = liveS3;
            }
            if (state.session.sessionBestS3 === Infinity || state.session.sessionBestS3 === 0 || liveS3 < state.session.sessionBestS3) {
                state.session.sessionBestS3 = liveS3;
                state.session.sessionBestS3Driver = (state.participants && state.participants[i]) ? state.participants[i] : `Car ${i}`;
            }
        }

        // Preserve official best lap time from PacketSessionHistoryData (or PacketLapData if present)
        const currentBestMs = lap.m_bestLapTimeInMS || (lap.m_bestLapTime ? Math.round(lap.m_bestLapTime * 1000) : 0) || 0;
        if (currentBestMs > 0 && (carDataTracker[i].bestLapMs === 0 || currentBestMs < carDataTracker[i].bestLapMs)) {
            carDataTracker[i].bestLapMs = currentBestMs;
        }

        if (carDataTracker[i].bestLapMs > 0 && carDataTracker[i].bestLapMs < sessionFastestLapMs) {
            sessionFastestLapMs = carDataTracker[i].bestLapMs;
            fastestLapIndex = i;
        }

        carDataTracker[i].pos = lap.m_carPosition;
        carDataTracker[i].lapNum = lap.m_currentLapNum;
        carDataTracker[i].pitStatus = lap.m_pitStatus;
        carDataTracker[i].numPitStops = lap.m_numPitStops !== undefined ? lap.m_numPitStops : (carDataTracker[i].numPitStops || 0);
        carDataTracker[i].driverStatus = lap.m_resultStatus;
        carDataTracker[i].penalties = lap.m_penalties || 0;
        carDataTracker[i].warnings = lap.m_totalWarnings || 0;
        carDataTracker[i].cornerCutting = lap.m_cornerCuttingWarnings || 0;
        carDataTracker[i].unservedDT = lap.m_numUnservedDriveThroughPens || 0;
        carDataTracker[i].unservedSG = lap.m_numUnservedStopGoPens || 0;
        carDataTracker[i].invalidLap = lap.m_currentLapInvalid === 1;

        if (i === pIdx) {
            const sector = lap.m_sector !== undefined ? lap.m_sector : (lap.sector || 0);
            if (sector === 1 && state.lap.currentSector === 0) state.lap.pendingS1 = true;
            if (sector === 2 && state.lap.currentSector === 1) state.lap.pendingS2 = true;
            state.lap.currentSector = sector;

            state.lap.lastMs = lap.m_lastLapTimeInMS || (lap.m_lastLapTime * 1000) || 0;
            state.lap.currentMs = curMs;
            state.lap.pos = lap.m_carPosition;
            state.lap.lapNum = lap.m_currentLapNum;
            state.lap.pitStatus = pitMap[lap.m_pitStatus] || 'ON TRACK';
            state.lap.numPitStops = carDataTracker[pIdx].numPitStops || 0;
            state.lap.bestMs = carDataTracker[pIdx].bestLapMs || 0;

            if (liveS1 > 0) state.lap.s1 = liveS1;
            if (liveS2 > 0) state.lap.s2 = liveS2;
            if (liveS3 > 0) state.lap.s3 = liveS3;

            state.lap.bestS1 = carDataTracker[pIdx].bestS1 || state.session.referenceS1 || 0;
            state.lap.bestS2 = carDataTracker[pIdx].bestS2 || state.session.referenceS2 || 0;
            state.lap.bestS3 = carDataTracker[pIdx].bestS3 || state.session.referenceS3 || 0;

            state.lap.s1Status = carDataTracker[pIdx].s1Status || 'pending';
            state.lap.s2Status = carDataTracker[pIdx].s2Status || 'pending';
            state.lap.s3Status = carDataTracker[pIdx].s3Status || 'pending';

            const liveSectorTiming = getLiveSectorTiming(
                state.lap.currentMs,
                state.lap.currentSector,
                state.lap.s1,
                state.lap.s2,
                state.lap.s3
            );
            state.lap.liveS1 = liveSectorTiming.liveS1;
            state.lap.liveS2 = liveSectorTiming.liveS2;
            state.lap.liveS3 = liveSectorTiming.liveS3;
            state.lap.s1State = liveSectorTiming.s1State;
            state.lap.s2State = liveSectorTiming.s2State;
            state.lap.s3State = liveSectorTiming.s3State;

            const dtlMsPart = lap.m_deltaToRaceLeaderMSPart !== undefined ? lap.m_deltaToRaceLeaderMSPart : 0;
            const dtlMinPart = lap.m_deltaToRaceLeaderMinutesPart !== undefined ? lap.m_deltaToRaceLeaderMinutesPart : 0;
            const dtlMs = (dtlMinPart * 60000) + dtlMsPart;
            state.lap.deltaToLeader = dtlMs || lap.m_deltaToRaceLeaderInMS || 0;

            state.lap.penalties = lap.m_penalties || 0;
            state.lap.warnings = lap.m_totalWarnings || 0;
            state.lap.cornerCutting = lap.m_cornerCuttingWarnings || 0;
            state.lap.unservedDT = lap.m_numUnservedDriveThroughPens || 0;
            state.lap.unservedSG = lap.m_numUnservedStopGoPens || 0;
            state.lap.scDelta = lap.m_safetyCarDelta || 0;
            state.lap.invalid = lap.m_currentLapInvalid === 1;

            state.penalties = {
                timePenalties: state.lap.penalties,
                warnings: state.lap.warnings,
                cornerCuts: state.lap.cornerCutting,
                driveThrough: state.lap.unservedDT,
                stopGo: state.lap.unservedSG,
                invalidLap: state.lap.invalid ? 1 : 0
            };
        }
    }

    state.session.fastestLapCarIndex = fastestLapIndex;
    state.session.sessionFastestLapMs = sessionFastestLapMs;
    state.session.sessionFastestDriver = fastestLapIndex >= 0 ? (state.participants[fastestLapIndex] || `Car ${fastestLapIndex}`) : 'None';
    state.pitLanePoints = buildApproxPitLane(state.trackPoints);

    state.session.raceDistance = state.session.trackLength * state.session.lapsTotal;
    state.session.lapsLeft = Math.max(0, state.session.lapsTotal - state.lap.lapNum);
}

module.exports = {
    handleSessionHistory,
    handleLapData
};
