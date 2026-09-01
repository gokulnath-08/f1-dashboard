const WebSocket = require('ws');
const { intervalMs } = require('../config');
const gameState = require('../state/gameState');
const { gForceData } = require('./gforceService');
const wsServer = require('../websocket/wsServer');

let broadcastTimer = null;

function startBroadcastLoop() {
    if (broadcastTimer) clearInterval(broadcastTimer);

    broadcastTimer = setInterval(() => {
        const {
            state, carDataTracker, carPhysics, allLapHistories,
            fastestLapGhostData
        } = gameState;

        let newLeaderboard = [];

        for (let i = 0; i < 22; i++) {
            if (carDataTracker[i].driverStatus !== 0) {
                newLeaderboard.push({
                    carIndex: i,
                    ...carDataTracker[i],
                    lapDistance: carPhysics[i].lapDistance,
                    speed: carPhysics[i].speed,
                    lapHistory: (i === state.playerIndex) ? (allLapHistories[i] || []) : []
                });
            }
        }

        if (state.session.sessionCategory === 'TimeAttack') {
            newLeaderboard.sort((a, b) => {
                if (a.bestLapMs === 0 && b.bestLapMs === 0) return a.carIndex - b.carIndex;
                if (a.bestLapMs === 0) return 1;
                if (b.bestLapMs === 0) return -1;
                return a.bestLapMs - b.bestLapMs;
            });

            const poleTimeMs = newLeaderboard.length > 0 ? newLeaderboard[0].bestLapMs : 0;

            newLeaderboard.forEach((driver, idx) => {
                driver.pos = idx + 1;
                if (driver.bestLapMs === 0) {
                    driver.gapText = driver.pitStatus > 0 ? 'IN PIT' : 'OUT LAP';
                    driver.leadSec = 9999;
                    driver.intSec = 9999;
                } else if (idx === 0) {
                    const mins = Math.floor(driver.bestLapMs / 60000);
                    const secs = ((driver.bestLapMs % 60000) / 1000).toFixed(3);
                    driver.gapText = `${mins}:${secs.padStart(6, '0')}`;
                    driver.leadSec = 0;
                    driver.intSec = 0;
                } else {
                    const diff = (driver.bestLapMs - poleTimeMs) / 1000;
                    driver.gapText = `+${diff.toFixed(3)}`;
                    driver.leadSec = diff;
                    const prev = newLeaderboard[idx - 1];
                    const intDiff = (driver.bestLapMs - (prev.bestLapMs || poleTimeMs)) / 1000;
                    driver.intSec = Math.max(0, intDiff);
                }
            });

        } else {
            newLeaderboard = newLeaderboard.filter(d => d.pos > 0 && d.pos <= 22);
            newLeaderboard.sort((a, b) => a.pos - b.pos);

            const leader = newLeaderboard.length > 0 ? newLeaderboard[0] : null;
            const pLeader = leader ? carPhysics[leader.carIndex] : null;
            const tLen = (state.session.trackLength > 0) ? state.session.trackLength : 5000;
            const avgSpeedMs = Math.max(45, (tLen / 80)); // Circuit average racing speed (~180-230 km/h)

            newLeaderboard.forEach((driver, idx) => {
                if (driver.pitStatus === 1 || driver.pitStatus === 2) {
                    driver.gapText = 'PIT';
                    driver.gapInt = 'PIT';
                    driver.gapLead = 'PIT';
                    driver.leadSec = 9999;
                    driver.intSec = 9999;
                } else if (idx === 0) {
                    driver.gapText = 'Interval';
                    driver.gapInt = 'LEAD';
                    driver.gapLead = 'LEAD';
                    driver.leadSec = 0;
                    driver.intSec = 0;
                } else {
                    const driverAhead = newLeaderboard[idx - 1];
                    const pCurr = carPhysics[driver.carIndex];
                    const pAhead = carPhysics[driverAhead.carIndex];

                    // Calculate distance to car ahead across lap boundary
                    const lapDiffAhead = (pAhead && pAhead.lapNum !== undefined) ? (pAhead.lapNum - pCurr.lapNum) : 0;
                    let distToAhead = 0;
                    if (pAhead) {
                        if (lapDiffAhead === 0) {
                            distToAhead = Math.max(0, pAhead.lapDistance - pCurr.lapDistance);
                        } else if (lapDiffAhead === 1) {
                            distToAhead = Math.max(0, (tLen - pCurr.lapDistance) + pAhead.lapDistance);
                        } else if (lapDiffAhead > 1) {
                            distToAhead = Math.max(0, (tLen - pCurr.lapDistance) + pAhead.lapDistance + (tLen * (lapDiffAhead - 1)));
                        }
                    }

                    // Check if car ahead is in pit
                    if (driverAhead.pitStatus > 0 && distToAhead > 100) {
                        driver.gapText = pCurr.lastValidDelta > 0 ? `+${pCurr.lastValidDelta.toFixed(3)}` : 'PIT AHEAD';
                        driver.gapInt = driver.gapText;
                        driver.intSec = pCurr.lastValidDelta || 0;
                    } else if (lapDiffAhead >= 1 && distToAhead >= tLen * 0.75) {
                        // Truly a lap down on the car directly ahead
                        driver.gapText = `+${lapDiffAhead} LAP${lapDiffAhead > 1 ? 'S' : ''}`;
                        driver.gapInt = driver.gapText;
                        driver.intSec = lapDiffAhead * 80;
                    } else {
                        // Same race lap or just crossed the finish line earlier
                        let intervalSec = 0;
                        if (pCurr.officialDelta > 0 && pCurr.officialDelta < 150) {
                            intervalSec = pCurr.officialDelta;
                            pCurr.lastValidDelta = intervalSec;
                        } else if (pCurr.lastValidDelta > 0 && Math.abs(lapDiffAhead) <= 1) {
                            // Smoothly hold last valid delta across finish line until next sector beacon
                            intervalSec = pCurr.lastValidDelta;
                        } else {
                            // Smooth fallback using circuit average speed (no jitter when braking)
                            intervalSec = Math.max(0.001, distToAhead / avgSpeedMs);
                        }
                        driver.gapText = `+${intervalSec.toFixed(3)}`;
                        driver.gapInt = `+${intervalSec.toFixed(3)}`;
                        driver.intSec = intervalSec;
                    }

                    // Calculate Gap to Race Leader (gapLead)
                    if (pLeader) {
                        const lapsDownLeader = (pLeader.lapNum !== undefined) ? (pLeader.lapNum - pCurr.lapNum) : 0;
                        let distToLeader = 0;
                        if (lapsDownLeader === 0) {
                            distToLeader = Math.max(0, pLeader.lapDistance - pCurr.lapDistance);
                        } else if (lapsDownLeader === 1) {
                            distToLeader = Math.max(0, (tLen - pCurr.lapDistance) + pLeader.lapDistance);
                        } else if (lapsDownLeader > 1) {
                            distToLeader = Math.max(0, (tLen - pCurr.lapDistance) + pLeader.lapDistance + (tLen * (lapsDownLeader - 1)));
                        }

                        if (lapsDownLeader >= 1 && distToLeader >= tLen * 0.75) {
                            driver.gapLead = `+${lapsDownLeader} LAP${lapsDownLeader > 1 ? 'S' : ''}`;
                            driver.leadSec = lapsDownLeader * 80;
                        } else {
                            let leadSec = 0;
                            if (pCurr.officialLeaderDelta > 0 && pCurr.officialLeaderDelta < 300) {
                                leadSec = pCurr.officialLeaderDelta;
                                pCurr.lastValidLeaderDelta = leadSec;
                            } else if (pCurr.lastValidLeaderDelta > 0 && Math.abs(lapsDownLeader) <= 1) {
                                leadSec = pCurr.lastValidLeaderDelta;
                            } else {
                                leadSec = Math.max(0.001, distToLeader / avgSpeedMs);
                            }
                            driver.gapLead = `+${leadSec.toFixed(3)}`;
                            driver.leadSec = leadSec;
                        }
                    } else {
                        driver.gapLead = driver.gapText;
                        driver.leadSec = driver.intSec || 0;
                    }
                }
            });
        }

        state.leaderboard = newLeaderboard;
        state.allLapHistories = allLapHistories;
        const pIdx = state.playerIndex;
        const playerLbIndex = state.leaderboard.findIndex(d => d.carIndex === pIdx);
        const playerLbInfo = playerLbIndex >= 0 ? state.leaderboard[playerLbIndex] : null;

        if (playerLbInfo) {
            state.lap.gapFront = playerLbInfo.gapText || '+0.000';

            // Driver Ahead Info (Race Interval or Quali Target)
            if (playerLbIndex > 0) {
                const carAhead = state.leaderboard[playerLbIndex - 1];
                state.lap.driverAhead = (state.participants && state.participants[carAhead.carIndex]) ? state.participants[carAhead.carIndex] : (carAhead.teamName || `Car ${carAhead.carIndex}`);
                state.lap.driverAheadCarIndex = carAhead.carIndex;
                state.lap.driverAheadTyre = carAhead.tyre || 'UNK';
                state.lap.driverAheadTeamColor = carAhead.teamColor || '#FFF';
                state.lap.targetAheadDriver = state.lap.driverAhead;
                state.lap.targetAheadBestMs = carAhead.bestLapMs || 0;
                state.lap.targetAheadDeltaMs = (playerLbInfo.bestLapMs > 0 && carAhead.bestLapMs > 0) ? (playerLbInfo.bestLapMs - carAhead.bestLapMs) : null;
            } else {
                state.lap.driverAhead = 'LEADER';
                state.lap.driverAheadCarIndex = -1;
                state.lap.driverAheadTyre = '';
                state.lap.driverAheadTeamColor = '#FFD700';
                state.lap.targetAheadDriver = 'PROVISIONAL POLE';
                state.lap.targetAheadBestMs = playerLbInfo.bestLapMs || 0;
                state.lap.targetAheadDeltaMs = 0;
            }

            // Driver Behind Info & DRS Threat Calculation
            if (playerLbIndex < state.leaderboard.length - 1 && playerLbIndex >= 0) {
                const carBehind = state.leaderboard[playerLbIndex + 1];
                state.lap.driverBehind = (state.participants && state.participants[carBehind.carIndex]) ? state.participants[carBehind.carIndex] : (carBehind.teamName || `Car ${carBehind.carIndex}`);
                state.lap.driverBehindCarIndex = carBehind.carIndex;
                state.lap.gapBehind = carBehind.gapInt || carBehind.gapText || '+0.000';
                state.lap.driverBehindTyre = carBehind.tyre || 'UNK';
                state.lap.driverBehindTeamColor = carBehind.teamColor || '#FFF';

                // Check if car behind is within DRS range (< 1.000s)
                let gapBehindSec = 999;
                const parsedGap = parseFloat(String(state.lap.gapBehind || '').replace(/[^0-9.]/g, ''));
                if (!isNaN(parsedGap) && !String(state.lap.gapBehind).includes('LAP') && !String(state.lap.gapBehind).includes('PIT')) {
                    gapBehindSec = parsedGap;
                }
                state.lap.drsThreat = gapBehindSec <= 1.0 && gapBehindSec > 0;
                state.lap.gapBehindSec = gapBehindSec < 999 ? gapBehindSec : null;
            } else {
                state.lap.driverBehind = 'NONE';
                state.lap.driverBehindCarIndex = -1;
                state.lap.gapBehind = '--';
                state.lap.driverBehindTyre = '';
                state.lap.driverBehindTeamColor = '#888888';
                state.lap.drsThreat = false;
                state.lap.gapBehindSec = null;
            }
        }

        // Physical On-Track Proximity (Traffic / Clean Air Radar in meters)
        let nearestAheadDist = Infinity;
        let nearestAheadDriver = 'CLEAR AIR';
        let nearestBehindDist = Infinity;
        let nearestBehindDriver = 'CLEAR';
        const playerDist = carPhysics[pIdx]?.lapDistance || 0;
        const tLen = state.session.trackLength || 5000;

        if (playerDist > 0 && tLen > 0) {
            for (let cIdx = 0; cIdx < 22; cIdx++) {
                if (cIdx === pIdx || carDataTracker[cIdx].driverStatus === 0) continue;
                const otherDist = carPhysics[cIdx]?.lapDistance || 0;
                if (otherDist <= 0) continue;
                const dName = (state.participants && state.participants[cIdx]) ? state.participants[cIdx] : `Car ${cIdx}`;

                // Distance ahead on circuit
                let distAhead = otherDist - playerDist;
                if (distAhead < 0) distAhead += tLen;
                if (distAhead > 0 && distAhead < nearestAheadDist) {
                    nearestAheadDist = distAhead;
                    nearestAheadDriver = dName;
                }

                // Distance behind on circuit
                let distBehind = playerDist - otherDist;
                if (distBehind < 0) distBehind += tLen;
                if (distBehind > 0 && distBehind < nearestBehindDist) {
                    nearestBehindDist = distBehind;
                    nearestBehindDriver = dName;
                }
            }
        }

        state.lap.trafficAheadDist = Number.isFinite(nearestAheadDist) && nearestAheadDist < tLen ? Math.round(nearestAheadDist) : null;
        state.lap.trafficAheadDriver = nearestAheadDriver;
        state.lap.trafficBehindDist = Number.isFinite(nearestBehindDist) && nearestBehindDist < tLen ? Math.round(nearestBehindDist) : null;
        state.lap.trafficBehindDriver = nearestBehindDriver;

        // Delta vs Session Fastest Lap Calculation (Quali Pole Delta)
        const sessFastest = (state.session.sessionFastestLapMs !== Infinity && state.session.sessionFastestLapMs > 0) ? state.session.sessionFastestLapMs : 0;
        state.session.sessionFastestLapMs = sessFastest;

        const sb1 = (state.session.sessionBestS1 !== Infinity && state.session.sessionBestS1 > 0) ? state.session.sessionBestS1 : (state.session.referenceS1 || 0);
        const sb2 = (state.session.sessionBestS2 !== Infinity && state.session.sessionBestS2 > 0) ? state.session.sessionBestS2 : (state.session.referenceS2 || 0);
        const sb3 = (state.session.sessionBestS3 !== Infinity && state.session.sessionBestS3 > 0) ? state.session.sessionBestS3 : (state.session.referenceS3 || 0);
        state.session.sessionBestS1 = sb1;
        state.session.sessionBestS2 = sb2;
        state.session.sessionBestS3 = sb3;
        state.session.theoreticalBestLapMs = (sb1 > 0 && sb2 > 0 && sb3 > 0) ? (sb1 + sb2 + sb3) : 0;

        if (sessFastest > 0) {
            state.lap.deltaToSessionFastest = state.lap.bestMs > 0 ? (state.lap.bestMs - sessFastest) : null;
            state.lap.lastLapDeltaToSessionFastest = state.lap.lastMs > 0 ? (state.lap.lastMs - sessFastest) : null;
            state.lap.isSessionFastest = (state.lap.bestMs > 0 && state.lap.bestMs <= sessFastest);
        } else {
            state.lap.deltaToSessionFastest = null;
            state.lap.lastLapDeltaToSessionFastest = null;
            state.lap.isSessionFastest = false;
        }

        // --- Live Ghost Delta Calculation ---
        state.lap.liveDeltaToRecord = 0;
        state.lap.ghostLapTimeMs = 0;
        if (fastestLapGhostData && fastestLapGhostData.length > 0) {
            state.lap.ghostLapTimeMs = fastestLapGhostData[fastestLapGhostData.length - 1].t;

            if (state.lap.currentMs > 0 && carPhysics[pIdx].lapDistance > 0) {
                const pDist = carPhysics[pIdx].lapDistance;

                let ghostTimeAtDist = 0;
                let idx = fastestLapGhostData.findIndex(pt => pt.d >= pDist);

                if (idx === 0) {
                    ghostTimeAtDist = fastestLapGhostData[0].t;
                } else if (idx > 0) {
                    const pt1 = fastestLapGhostData[idx - 1];
                    const pt2 = fastestLapGhostData[idx];
                    const rangeDist = pt2.d - pt1.d;
                    if (rangeDist > 0) {
                        const ratio = (pDist - pt1.d) / rangeDist;
                        ghostTimeAtDist = pt1.t + (pt2.t - pt1.t) * ratio;
                    } else {
                        ghostTimeAtDist = pt2.t;
                    }
                } else {
                    ghostTimeAtDist = fastestLapGhostData[fastestLapGhostData.length - 1].t;
                }

                if (ghostTimeAtDist > 0) {
                    state.lap.liveDeltaToRecord = state.lap.currentMs - ghostTimeAtDist;
                }
            }
        }

        // Check if telemetry packets are actively being received from F1 UDP
        const now = Date.now();
        const isGameActive = (gameState.lastUdpPacketTime > 0) && (now - gameState.lastUdpPacketTime < 2500);
        state.isGameActive = isGameActive;
        state.lastUdpAgeMs = gameState.lastUdpPacketTime > 0 ? (now - gameState.lastUdpPacketTime) : null;

        if (!isGameActive) {
            state.inputs.throttle = 0;
            state.inputs.brake = 0;
            state.inputs.clutch = 0;
            state.inputs.steer = 0;
            state.inputs.speed = 0;
            state.inputs.rpm = 0;
        }

        let activeClients = wsServer.clients.filter(ws => ws.readyState === WebSocket.OPEN);

        gameState.broadcastTick++;

        // Send full trackPoints ONLY on track change or initial load (trackPointsDirty),
        // otherwise send [] during continuous 20Hz streaming
        const sendTrack = gameState.trackPointsDirty && state.trackPoints && state.trackPoints.length > 0;
        if (gameState.trackPointsDirty) gameState.trackPointsDirty = false;

        // Send bulky allLapHistories dictionary at 1Hz or when a lap finishes/updates (lapHistoryDirty)
        const sendLapHistory = gameState.lapHistoryDirty || (gameState.broadcastTick % 20 === 0);
        if (gameState.lapHistoryDirty) gameState.lapHistoryDirty = false;

        const streamState = {
            ...state,
            trackPoints: sendTrack ? state.trackPoints : [],
            pitLanePoints: sendTrack ? state.pitLanePoints : [],
            leaderboard: state.leaderboard,
            allLapHistories: sendLapHistory ? allLapHistories : {},
            motion: {
                ...state.motion,
                gEnvelopeArray: (gForceData.envelopeArray || []).slice(-25),
                gHistory: (gForceData.history || []).slice(-15)
            }
        };

        const payload = JSON.stringify(streamState);
        activeClients.forEach((ws) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            if (ws.bufferedAmount > 64 * 1024) {
                return;
            }
            try {
                ws.send(payload);
            } catch (e) { }
        });
    }, intervalMs);
}

function stopBroadcastLoop() {
    if (broadcastTimer) {
        clearInterval(broadcastTimer);
        broadcastTimer = null;
    }
}

module.exports = {
    startBroadcastLoop,
    stopBroadcastLoop
};
