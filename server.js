const { F1TelemetryClient } = require('@deltazeroproduction/f1-udp-parser');
const WebSocket = require('ws');
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = 3000;

const args = process.argv.slice(2);
let hz = parseInt(args[0], 10);
const validHz = [10, 20, 30, 60];
if (!validHz.includes(hz)) {
    hz = 20;
}
const intervalMs = Math.round(1000 / hz);


const trackMapsDir = path.join(__dirname, 'track_maps');
if (!fs.existsSync(trackMapsDir)) {
    fs.mkdirSync(trackMapsDir);
    console.log('📁 Created track_maps directory for saving circuits.');
}

const lapTimeDir = path.join(__dirname, 'laptime');
if (!fs.existsSync(lapTimeDir)) {
    fs.mkdirSync(lapTimeDir);
    console.log('📁 Created laptime directory for saving track records.');
}

const telemetryDir = path.join(__dirname, 'telemetry');
if (!fs.existsSync(telemetryDir)) {
    fs.mkdirSync(telemetryDir);
    console.log('📁 Created telemetry directory for full lap data.');
}

let allTimeFastest = {};
const fastestJsonPath = path.join(lapTimeDir, 'fastest.json');

if (fs.existsSync(fastestJsonPath)) {
    try {
        allTimeFastest = JSON.parse(fs.readFileSync(fastestJsonPath, 'utf8'));
    } catch (e) {
        console.error('⚠️ Error reading fastest.json:', e);
    }
}


const server = http.createServer((req, res) => {

    let filePath = path.join(__dirname, req.url === "/" ? "index.html" : req.url);

    const ext = path.extname(filePath);

    const contentTypes = {
        ".html": "text/html",
        ".css": "text/css",
        ".js": "application/javascript"
    };

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end("File not found");
            return;
        }

        let responseData = data;
        if (req.url === "/" || req.url === "/index.html") {
            try {
                if (os.userInfo().username === "gokul") {
                    let htmlContent = data.toString("utf8");
                    htmlContent = htmlContent.replace('id="os-footer"', 'id="os-footer" hidden');
                    responseData = Buffer.from(htmlContent, "utf8");
                }
            } catch(e) {}
        }

        res.writeHead(200, {
            "Content-Type": contentTypes[ext] || "text/plain"
        });

        res.end(responseData);
    });
});



function abs_diff(a, b) { return Math.abs((a || 0) - (b || 0)); }

let clients = [];

function handleWsConnection(ws) {
    console.log('✅ Advanced Strategy Command Center Connected!');
    clients.push(ws);
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            
            if (data.action === 'getAvailableTracks') {
                fs.readdir(trackMapsDir, (err, files) => {
                    if (!err) {
                        const tracks = files.filter(f => f.startsWith('track_') && f.endsWith('.json'))
                                            .map(f => parseInt(f.match(/\d+/)[0]))
                                            .filter(id => !isNaN(id));
                        ws.send(JSON.stringify({ type: 'availableTracks', tracks }));
                    }
                });
                return;
            }

            if (data.action === 'getTrackData') {
                const trackId = parseInt(data.trackId);
                if (!isNaN(trackId)) {
                    const tPath = path.join(trackMapsDir, `track_${trackId}.json`);
                    if (fs.existsSync(tPath)) {
                        try {
                            const tData = JSON.parse(fs.readFileSync(tPath, 'utf8'));
                            ws.send(JSON.stringify({ type: 'trackDataResponse', trackId, data: tData }));
                        } catch(e) {}
                    }
                }
                return;
            }

            if (data.action === 'resetSectors') {
                state.customSectorLines = [0];
                return;
            }

            if (data.action === 'addSector' && data.timeMs >= 0) {
                if (data.timeMs === 0) {
                    if (!state.customSectorLines.find(s => s.d === 0)) state.customSectorLines.push({ x: state.startLine?.x || 0, z: state.startLine?.z || 0, yaw: state.startLine?.yaw || 0, d: 0 });
                    return;
                }
                if (fastestLapGhostData && fastestLapGhostData.length > 0) {
                    let bestPt = null;
                    let idx = fastestLapGhostData.findIndex(pt => pt.t >= data.timeMs);
                    if (idx === 0) {
                        bestPt = fastestLapGhostData[0];
                    } else if (idx > 0) {
                        const pt1 = fastestLapGhostData[idx - 1];
                        const pt2 = fastestLapGhostData[idx];
                        const rangeTime = pt2.t - pt1.t;
                        if (rangeTime > 0) {
                            const ratio = (data.timeMs - pt1.t) / rangeTime;
                            bestPt = {
                                x: pt1.x + (pt2.x - pt1.x) * ratio,
                                z: pt1.z + (pt2.z - pt1.z) * ratio,
                                yaw: pt1.yaw, // Approximated
                                d: pt1.d + (pt2.d - pt1.d) * ratio
                            };
                        } else {
                            bestPt = pt2;
                        }
                    } else {
                        bestPt = fastestLapGhostData[fastestLapGhostData.length - 1];
                    }
                    if (bestPt) {
                        state.customSectorLines.push({ x: bestPt.x, z: bestPt.z, yaw: bestPt.yaw || 0, d: bestPt.d });
                        console.log(`📍 Custom Sector Line coordinates calculated and added (for time: ${data.timeMs}ms)`);
                    }
                }
            }
        } catch (e) {
            console.error('Error parsing WS message:', e);
        }
    });
    ws.on('close', () => { clients = clients.filter(client => client !== ws); });
}

const wss = new WebSocket.Server({ server });
wss.on('connection', handleWsConnection);

const legacyWss = new WebSocket.Server({ port: 8085, host: '0.0.0.0' });
legacyWss.on('connection', handleWsConnection);


const weatherMap = { 0: 'Clear', 1: 'Light Cloud', 2: 'Overcast', 3: 'Light Rain', 4: 'Heavy Rain', 5: 'Storm', 6: 'Unknown' };
const scMap = { 0: 'Clear', 1: 'Full SC', 2: 'VSC', 3: 'Formation', 4: 'SC Ending' };
const ersMap = { 0: 'None', 1: 'Medium', 2: 'Hotlap', 3: 'Overtake' };

const sessionMap = {
    0: 'Unknown', 1: 'Practice 1', 2: 'Practice 2', 3: 'Practice 3', 4: 'Short Practice',
    5: 'Q1', 6: 'Q2', 7: 'Q3', 8: 'Short Q', 9: 'One-Shot Q',
    10: 'Race', 11: 'Race 2', 12: 'Race 3', 13: 'Time Trial', 14: 'Sprint',
    15: 'Sprint Shootout 1', 16: 'Sprint Shootout 2', 17: 'Sprint Shootout 3',
    18: 'Time Trial', 19: 'One-Shot Sprint Shootout'
};

const formulaMap = {
    0: 'F1', 1: 'F1 Classic', 2: 'F2', 3: 'F1 Generic',
    4: 'Beta', 5: 'Supercars', 6: 'Esports', 7: 'F1 World'
};

const trackMap = {
    0: 'Melbourne', 2: 'Shanghai', 3: 'Sakhir (Bahrain)', 4: 'Catalunya',
    5: 'Monaco', 6: 'Montreal', 7: 'Silverstone', 9: 'Hungaroring',
    10: 'Spa', 11: 'Monza', 12: 'Singapore', 13: 'Suzuka', 14: 'Abu Dhabi',
    15: 'Texas', 16: 'Brazil', 17: 'Austria', 19: 'Mexico',
    20: 'Baku (Azerbaijan)', 26: 'Zandvoort', 27: 'Imola', 29: 'Jeddah',
    30: 'Miami', 31: 'Las Vegas', 32: 'Losail', 39: 'Silverstone (Reverse)',
    40: 'Austria (Reverse)', 41: 'Zandvoort (Reverse)', 42: 'Madrid'
};

const flagMap = { '-1': 'GREEN', 0: 'GREEN', 1: 'GREEN', 2: 'BLUE', 3: 'YELLOW', 4: 'RED' };
const pitMap = { 0: 'ON TRACK', 1: 'PITTING', 2: 'IN PIT LANE' };
const teamMap = {
    220: '#27F4D2', 221: '#E8002D', 222: '#3671C6', 223: '#64C4FF', 224: '#229971', 225: '#0093CC',
    226: '#6692FF', 227: '#B6BABD', 228: '#FF8000', 229: '#52E252', 230: '#FFFFFF'
};
const teamNameMap = {
    220: 'Mercedes', 221: 'Ferrari', 222: 'Red Bull Racing', 223: 'Williams', 224: 'Aston Martin', 225: 'Alpine',
    226: 'RB', 227: 'Haas', 228: 'McLaren', 229: 'Kick Sauber', 230: 'F1 Generic'
};

let lastPrintedSessionTeamUID = null;

function getParticipantTeamId(participant) {
    if (!participant) return undefined;
    return participant.m_teamId !== undefined ? participant.m_teamId : participant.teamId;
}

let currentSessionUID = null;
let currentTrackId = -1;
let isTrackMapped = false;

let carDataTracker = Array.from({ length: 22 }, () => ({
    pos: 0, lapNum: 0, pitStatus: 0, driverStatus: 0, bestLapMs: 0, gapText: '', maxSpeed: 0, tyre: 'UNK', tyreClass: '#FFFFFF', teamColor: '#FFFFFF', teamName: 'Unknown',
    s1: 0, s2: 0, s3: 0, bestS1: 0, bestS2: 0, bestS3: 0
}));

let carPhysics = Array.from({ length: 22 }, () => ({
    speed: 0, lapDistance: 0, lapNum: 0, officialDelta: 0
}));

let allLapHistories = {};
let currentLapTelemetry = Array.from({ length: 22 }, () => []);
let lastLapTelemetry = Array.from({ length: 22 }, () => []);
let fastestLapGhostData = [];

let state = {
    type: 'telemetry', playerIndex: 0, allCars: Array.from({ length: 22 }, () => ({ x: 0, z: 0, yaw: 0, teamColor: '#FFFFFF', teamName: 'Unknown', lapDistance: 0, speed: 0 })),
    trackPoints: [], pitLanePoints: [], participants: [], leaderboard: [], startLine: null, sector1Line: null, sector2Line: null, sector1: null, sector2: null, customSectorLines: [0],
    session: {
        trackName: 'Unknown', trackLength: 0, raceDistance: 0, lapsLeft: 0, type: 'Unknown', weather: '--',
        trackTemp: 0, airTemp: 0, sc: 'Clear', lapsTotal: 0, pitLimit: 80, fastestLapCarIndex: -1,
        sessionFastestLapMs: Infinity, sessionBestS1: Infinity, sessionBestS2: Infinity, sessionBestS3: Infinity,
        sessionCategory: 'Race', allTimeFastestLapMs: Infinity, allTimeFastestDriver: 'Unknown'
    },
    lap: { currentMs: 0, lastMs: 0, bestMs: 0, s1: 0, s2: 0, s3: 0, liveS1: 0, liveS2: 0, liveS3: 0, s1State: 'pending', s2State: 'pending', s3State: 'pending', pos: 0, lapNum: 0, gapFront: 0, pitStatus: 'ON TRACK', currentSector: 0, pendingS1: false, pendingS2: false, liveDeltaToRecord: 0, deltaToLeader: 0, ghostLapTimeMs: 0 },
    motion: { pitch: 0, roll: 0, gLat: 0, gLong: 0, gVert: 0, susp: { fl: 0, fr: 0, rl: 0, rr: 0 } },
    inputs: { speed: 0, gear: 'N', rpm: 0, throttle: 0, brake: 0, clutch: 0, steer: 0, drs: 'CLOSED' },
    ers: { mode: 'None', battery: 0 },
    setup: { wingF: 0, wingR: 0, diffOn: 0, diffOff: 0, camberF: 0, camberR: 0, toeF: 0, toeR: 0, bBias: 50, fuel: 0 },
    car: { tyreAge: 0, flag: 'GREEN', compound: 'Unknown', engineTemp: 0, wear: { fl: 0, fr: 0, rl: 0, rr: 0 }, surfTemp: { fl: 0, fr: 0, rl: 0, rr: 0 }, inTemp: { fl: 0, fr: 0, rl: 0, rr: 0 }, press: { fl: 0, fr: 0, rl: 0, rr: 0 }, brakeTemp: { fl: 0, fr: 0, rl: 0, rr: 0 } }
};

function buildApproxPitLane(trackPoints) {
    if (!Array.isArray(trackPoints) || trackPoints.length < 18) return [];

    const laneLength = Math.min(Math.max(Math.floor(trackPoints.length * 0.18), 12), 34);
    const laneStart = Math.max(0, Math.floor(trackPoints.length * 0.01));
    const laneEnd = Math.min(trackPoints.length - 1, laneStart + laneLength);
    const lanePoints = [];

    for (let i = laneStart; i <= laneEnd; i++) {
        const prev = trackPoints[Math.max(0, i - 1)];
        const curr = trackPoints[i];
        const next = trackPoints[Math.min(trackPoints.length - 1, i + 1)];
        const dx = next.x - prev.x;
        const dz = next.z - prev.z;
        const len = Math.hypot(dx, dz) || 1;
        const offset = 42 + Math.sin(((i - laneStart) / Math.max(1, laneEnd - laneStart)) * Math.PI) * 34;

        lanePoints.push({
            x: curr.x + (-dz / len) * offset,
            z: curr.z + (dx / len) * offset
        });
    }

    return lanePoints;
}


const f1Client = new F1TelemetryClient({ port: 20777, format: 2026 });


function getSectorTime(obj, sectorNum) {
    if (!obj) return 0;

    const msKey1 = `m_sector${sectorNum}TimeMSPart`;
    const msKey2 = `sector${sectorNum}TimeMSPart`;
    const msKey3 = `m_sector${sectorNum}TimeMsPart`;
    const msKey4 = `sector${sectorNum}TimeMsPart`;
    const msKey5 = `m_sector${sectorNum}TimeInMS`;
    const msKey6 = `sector${sectorNum}TimeInMS`;
    
    const minKey1 = `m_sector${sectorNum}TimeMinutesPart`;
    const minKey2 = `sector${sectorNum}TimeMinutesPart`;
    const minKey3 = `m_sector${sectorNum}TimeMinutes`;
    const minKey4 = `sector${sectorNum}TimeMinutes`;
    
    const fallbackKey1 = `m_sector${sectorNum}Time`;

    let ms = 0;
    if (obj[msKey1] !== undefined) ms = obj[msKey1];
    else if (obj[msKey2] !== undefined) ms = obj[msKey2];
    else if (obj[msKey3] !== undefined) ms = obj[msKey3];
    else if (obj[msKey4] !== undefined) ms = obj[msKey4];
    else if (obj[msKey5] !== undefined) ms = obj[msKey5];
    else if (obj[msKey6] !== undefined) ms = obj[msKey6];

    let mins = 0;
    if (obj[minKey1] !== undefined) mins = obj[minKey1];
    else if (obj[minKey2] !== undefined) mins = obj[minKey2];
    else if (obj[minKey3] !== undefined) mins = obj[minKey3];
    else if (obj[minKey4] !== undefined) mins = obj[minKey4];

    let totalMs = (mins * 60000) + ms;

    if (totalMs === 0) {
        const fallback = obj[fallbackKey1] || obj[`sector${sectorNum}Time`] || 0;
        if (fallback > 0) {
            return fallback < 1000 && fallback % 1 !== 0 ? Math.floor(fallback * 1000) : fallback;
        }
    }
    return totalMs;
}

function getLiveSectorTiming(currentMs, sector, s1, s2, s3) {
    const completedS1 = s1 > 0 ? s1 : 0;
    const completedS2 = s2 > 0 ? s2 : 0;
    const completedS3 = s3 > 0 ? s3 : 0;
    const live = {
        s1: completedS1,
        s2: completedS2,
        s3: completedS3,
        s1State: completedS1 > 0 ? 'complete' : 'pending',
        s2State: completedS2 > 0 ? 'complete' : 'pending',
        s3State: completedS3 > 0 ? 'complete' : 'pending'
    };

    if (sector === 0) {
        live.s1 = Math.max(0, currentMs);
        live.s1State = 'live';
        live.s2 = 0;
        live.s2State = 'pending';
        live.s3 = 0;
        live.s3State = 'pending';
    } else if (sector === 1) {
        live.s1 = completedS1;
        live.s1State = completedS1 > 0 ? 'complete' : 'pending';
        live.s2 = Math.max(0, currentMs - completedS1);
        live.s2State = 'live';
        live.s3 = 0;
        live.s3State = 'pending';
    } else if (sector === 2) {
        live.s1 = completedS1;
        live.s1State = completedS1 > 0 ? 'complete' : 'pending';
        live.s2 = completedS2;
        live.s2State = completedS2 > 0 ? 'complete' : 'pending';
        live.s3 = Math.max(0, currentMs - completedS1 - completedS2);
        live.s3State = 'live';
    }

    return live;
}

function setPlayerIndex(header) {
    if (header && header.m_playerCarIndex !== undefined) {
        state.playerIndex = header.m_playerCarIndex;
    }
}

function getAccurateSessionName(sessionType, formula) {
    const baseSession = sessionMap[sessionType] || `ID: ${sessionType}`;
    if (formula === 2) {
        if (sessionType === 10) return 'F2 Feature Race';
        if (sessionType === 11) return 'F2 Sprint Race';
        return `F2 ${baseSession}`;
    }
    if (formula !== 0 && formulaMap[formula]) {
        return `${formulaMap[formula]} ${baseSession}`;
    }
    return baseSession;
}


f1Client.on('motion', (data) => {
    setPlayerIndex(data.m_header);
    const pIdx = state.playerIndex;
    let newCars = [];

    for (let i = 0; i < 22; i++) {
        if (data.m_carMotionData[i]) {
            newCars.push({
                x: data.m_carMotionData[i].m_worldPositionX,
                z: data.m_carMotionData[i].m_worldPositionZ,
                yaw: data.m_carMotionData[i].m_yaw,
                teamColor: carDataTracker[i].teamColor,
                teamName: carDataTracker[i].teamName,
                lapDistance: carPhysics[i].lapDistance,
                speed: carPhysics[i].speed
            });
        }
    }
    state.allCars = newCars;

    const pMotion = data.m_carMotionData[pIdx];
    if (pMotion) {
        state.motion.gLat = pMotion.m_gForceLateral !== undefined ? pMotion.m_gForceLateral / 1000 : 0;
        state.motion.gLong = pMotion.m_gForceLongitudinal !== undefined ? pMotion.m_gForceLongitudinal / 1000 : 0;
        state.motion.gVert = pMotion.m_gForceVertical !== undefined ? pMotion.m_gForceVertical / 1000 : 0;
        state.motion.pitch = pMotion.m_pitch || 0;
        state.motion.roll = pMotion.m_roll || 0;

        const lapDist = carPhysics[pIdx].lapDistance;
        const speed = carPhysics[pIdx].speed;

        if (speed > 10 && lapDist >= 0 && lapDist < 10) {
            if (!state.startLine || lapDist < state.startLine.lapDistance) {
                state.startLine = {
                    x: pMotion.m_worldPositionX,
                    z: pMotion.m_worldPositionZ,
                    yaw: pMotion.m_yaw || 0,
                    lapDistance: lapDist
                };
                if (isTrackMapped && currentTrackId !== -1) {
                    const filePath = path.join(trackMapsDir, `track_${currentTrackId}.json`);
                    fs.writeFileSync(filePath, JSON.stringify({ trackPoints: state.trackPoints, startLine: state.startLine, sector1: state.sector1, sector2: state.sector2 }));
                }
            }
        }

        if (!isTrackMapped && currentTrackId !== -1) {
            const x = pMotion.m_worldPositionX;
            const z = pMotion.m_worldPositionZ;
            const pts = state.trackPoints;
            const lastPt = pts.length > 0 ? pts[pts.length - 1] : null;

            if (!lastPt || Math.hypot(lastPt.x - x, lastPt.z - z) > 10) {
                if (lastPt && Math.hypot(lastPt.x - x, lastPt.z - z) > 500) {
                    pts.length = 0;
                } else {
                    pts.push({ x, z });
                    if (pts.length > 150) {
                        const firstPt = pts[0];
                        if (Math.hypot(firstPt.x - x, firstPt.z - z) < 30) {
                            isTrackMapped = true;
                            fs.writeFileSync(path.join(trackMapsDir, `track_${currentTrackId}.json`), JSON.stringify({ trackPoints: pts, startLine: state.startLine, sector1: state.sector1, sector2: state.sector2 }));
                            state.pitLanePoints = buildApproxPitLane(state.trackPoints);
                            console.log(`✅ Track ID ${currentTrackId} fully mapped and saved!`);
                        }
                    }
                }
            }
        }
    }
});

f1Client.on('motionEx', (data) => {
    if (data.m_suspensionPosition) {
        state.motion.susp.rl = data.m_suspensionPosition[0] || 0;
        state.motion.susp.rr = data.m_suspensionPosition[1] || 0;
        state.motion.susp.fl = data.m_suspensionPosition[2] || 0;
        state.motion.susp.fr = data.m_suspensionPosition[3] || 0;
    }
});

function loadTrackDeltaReference(trackId) {
    const record = allTimeFastest[trackId];
    if (!record) {
        state.session.allTimeFastestLapMs = Infinity;
        state.session.allTimeFastestDriver = 'Unknown';
        fastestLapGhostData = [];
        return;
    }

    state.session.allTimeFastestLapMs = record.time;
    state.session.allTimeFastestDriver = record.driver;
    fastestLapGhostData = [];

    const trackFastestPath = path.join(lapTimeDir, `fastest_${trackId}.json`);
    if (!fs.existsSync(trackFastestPath)) return;

    try {
        const parsedData = JSON.parse(fs.readFileSync(trackFastestPath, 'utf8'));
        fastestLapGhostData = (Array.isArray(parsedData) ? parsedData : (parsedData.telemetry || []))
            .filter(pt => Number.isFinite(pt.d) && Number.isFinite(pt.t))
            .sort((a, b) => a.d - b.d);

        if (fastestLapGhostData.length > 0 && fastestLapGhostData[0].d > 0) {
            fastestLapGhostData.unshift({ d: 0, t: 0 });
        }

        console.log(`Loaded delta reference for Track ${trackId} (${fastestLapGhostData.length} points).`);
    } catch (e) {
        console.error(`Error reading delta reference for Track ${trackId}:`, e);
    }
}


f1Client.on('session', (data) => {
    const uid = data.m_header.m_sessionUID;
    const newSessionUID = typeof uid === 'bigint' ? uid.toString() : String(uid);

    if (currentSessionUID !== null && currentSessionUID !== newSessionUID) {
        console.log('🔄 New Session Detected! Wiping old telemetry data...');
        carDataTracker = Array.from({ length: 22 }, () => ({
            pos: 0, lapNum: 0, pitStatus: 0, driverStatus: 0, bestLapMs: 0, gapText: '', maxSpeed: 0, tyre: 'UNK', tyreClass: '#FFFFFF', teamColor: '#FFFFFF', teamName: 'Unknown',
            s1: 0, s2: 0, s3: 0, bestS1: 0, bestS2: 0, bestS3: 0
        }));
        carPhysics = Array.from({ length: 22 }, () => ({ speed: 0, lapDistance: 0, lapNum: 0, officialDelta: 0 }));
        allLapHistories = {};
        currentLapTelemetry = Array.from({ length: 22 }, () => []);
        lastLapTelemetry = Array.from({ length: 22 }, () => []);
        state.leaderboard = [];
        state.pitLanePoints = [];
        state.customSectorLines = [0];
        state.lap = { currentMs: 0, lastMs: 0, bestMs: 0, s1: 0, s2: 0, s3: 0, liveS1: 0, liveS2: 0, liveS3: 0, s1State: 'pending', s2State: 'pending', s3State: 'pending', pos: 0, lapNum: 0, gapFront: 0, pitStatus: 'ON TRACK', currentSector: 0, pendingS1: false, pendingS2: false, liveDeltaToRecord: 0, deltaToLeader: 0, ghostLapTimeMs: 0 };

        state.session.fastestLapCarIndex = -1;
        state.session.sessionFastestLapMs = Infinity;
        state.session.sessionBestS1 = Infinity;
        state.session.sessionBestS2 = Infinity;
        state.session.sessionBestS3 = Infinity;
    }
    currentSessionUID = newSessionUID;

    const tId = data.m_trackId;
    if (tId !== currentTrackId) {
        currentTrackId = tId;
        state.customSectorLines = [0];
        const filePath = path.join(trackMapsDir, `track_${tId}.json`);

        if (fs.existsSync(filePath)) {
            const parsedData = JSON.parse(fs.readFileSync(filePath));
            if (Array.isArray(parsedData)) {
                state.trackPoints = parsedData;
                state.startLine = null;
                state.sector1 = null;
                state.sector2 = null;
            } else {
                state.trackPoints = parsedData.trackPoints || [];
                state.startLine = parsedData.startLine || null;
                state.sector1 = (parsedData.sector1 && typeof parsedData.sector1 === 'object') ? parsedData.sector1 : ((parsedData.sector1Line && typeof parsedData.sector1Line === 'object') ? parsedData.sector1Line : null);
                state.sector2 = (parsedData.sector2 && typeof parsedData.sector2 === 'object') ? parsedData.sector2 : ((parsedData.sector2Line && typeof parsedData.sector2Line === 'object') ? parsedData.sector2Line : null);
            }
            state.pitLanePoints = buildApproxPitLane(state.trackPoints);
            isTrackMapped = true;
        } else {
            state.trackPoints = [];
            state.pitLanePoints = [];
            state.customSectorLines = [0];
            state.startLine = null;
            state.sector1 = null;
            state.sector2 = null;
            isTrackMapped = false;
        }

        if (currentTrackId !== -1) loadTrackDeltaReference(currentTrackId);
    }

    setPlayerIndex(data.m_header);

    const trackTemp = data.m_trackTemperature !== undefined ? data.m_trackTemperature : (data.trackTemperature || 0);
    const airTemp = data.m_airTemperature !== undefined ? data.m_airTemperature : (data.airTemperature || 0);
    const lapsTotal = data.m_totalLaps;
    const sessionTypeRaw = data.m_sessionType;
    const formulaRaw = data.m_formula || 0;

    state.session.weather = weatherMap[data.m_weather] || 'Unknown';
    state.session.trackTemp = trackTemp;
    state.session.airTemp = airTemp;
    state.session.trackLength = data.m_trackLength !== undefined ? data.m_trackLength : (data.trackLength || 5000);
    state.session.lapsTotal = lapsTotal;


    state.session.type = getAccurateSessionName(sessionTypeRaw, formulaRaw);


    const timeAttackIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 17, 18, 19];
    state.session.sessionCategory = timeAttackIds.includes(sessionTypeRaw) ? 'TimeAttack' : 'Race';

    state.session.trackName = trackMap[data.m_trackId] || `TRACK NOT FOUND`;
    state.session.pitLimit = data.m_pitSpeedLimit;
    state.session.sc = scMap[data.m_safetyCarStatus] || 'Clear';

    const newTrackId = data.m_trackId;
    if (currentTrackId !== newTrackId && newTrackId !== -1) {
        console.log(`🏁 Track Changed to ID: ${newTrackId}. Loading mapped circuit and telemetry data...`);
        currentTrackId = newTrackId;
        isTrackMapped = false;

        const filePath = path.join(trackMapsDir, `track_${currentTrackId}.json`);
        if (fs.existsSync(filePath)) {
            try {
                const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (saved.trackPoints && saved.trackPoints.length > 0) {
                    state.trackPoints = saved.trackPoints;
                    state.startLine = saved.startLine || null;
                    state.sector1 = (saved.sector1 && typeof saved.sector1 === 'object') ? saved.sector1 : ((saved.sector1Line && typeof saved.sector1Line === 'object') ? saved.sector1Line : null);
                    state.sector2 = (saved.sector2 && typeof saved.sector2 === 'object') ? saved.sector2 : ((saved.sector2Line && typeof saved.sector2Line === 'object') ? saved.sector2Line : null);
                    isTrackMapped = true;
                    state.pitLanePoints = buildApproxPitLane(state.trackPoints);
                    console.log(`🗺️ Loaded Track ${currentTrackId} map (${state.trackPoints.length} points)`);
                }
            } catch (e) {
                console.error('Error parsing track map JSON:', e);
            }
        } else {
            state.trackPoints = [];
            state.startLine = null;
            state.sector1 = null;
            state.sector2 = null;
        }

        const record = allTimeFastest[currentTrackId];
        if (record) {
            state.session.allTimeFastestLapMs = record.time;
            state.session.allTimeFastestDriver = record.driver;

            fastestLapGhostData = [];
            const trackFastestPath = path.join(lapTimeDir, `fastest_${currentTrackId}.json`);
            if (fs.existsSync(trackFastestPath)) {
                try {
                    const parsedData = JSON.parse(fs.readFileSync(trackFastestPath, 'utf8'));
                    fastestLapGhostData = Array.isArray(parsedData) ? parsedData : (parsedData.telemetry || []);

                    // Inject 0,0 starting point to fix the initial interpolation gap
                    if (fastestLapGhostData.length > 0 && fastestLapGhostData[0].d > 0) {
                        fastestLapGhostData.unshift({ d: 0, t: 0 });
                    }

                    console.log(`📊 Loaded delta reference for Track ${currentTrackId} (${fastestLapGhostData.length} points) from fastest_${currentTrackId}.json`);
                } catch (e) {
                    console.error(`⚠️ Error reading delta reference for Track ${currentTrackId}:`, e);
                }
            }
        } else {
            state.session.allTimeFastestLapMs = Infinity;
            state.session.allTimeFastestDriver = 'Unknown';
            fastestLapGhostData = [];
        }
    }
});


f1Client.on('sessionHistory', (data) => {
    const carIndex = data.m_carIdx !== undefined ? data.m_carIdx : data.carIdx;
    const numLaps = data.m_numLaps !== undefined ? data.m_numLaps : data.numLaps;
    const historyArray = data.m_lapHistoryData || data.lapHistoryData || [];

    allLapHistories[carIndex] = historyArray.slice(0, numLaps).map(lap => {
        const lapTime = lap.m_lapTimeInMS || lap.lapTimeInMS || 0;
        return {
            lapTime: lapTime,
            s1: getSectorTime(lap, 1),
            s2: getSectorTime(lap, 2),
            s3: getSectorTime(lap, 3),
            validFlags: lap.m_lapValidBitFlags !== undefined ? lap.m_lapValidBitFlags : 0x0f
        };
    });

    if (numLaps > 0) {
        const bS1Lap = data.m_bestSector1LapNum !== undefined ? data.m_bestSector1LapNum : data.bestSector1LapNum;
        const bS2Lap = data.m_bestSector2LapNum !== undefined ? data.m_bestSector2LapNum : data.bestSector2LapNum;
        const bS3Lap = data.m_bestSector3LapNum !== undefined ? data.m_bestSector3LapNum : data.bestSector3LapNum;

        const bestS1 = bS1Lap ? getSectorTime(historyArray[bS1Lap - 1], 1) : 0;
        const bestS2 = bS2Lap ? getSectorTime(historyArray[bS2Lap - 1], 2) : 0;
        const bestS3 = bS3Lap ? getSectorTime(historyArray[bS3Lap - 1], 3) : 0;

        carDataTracker[carIndex].bestS1 = bestS1;
        carDataTracker[carIndex].bestS2 = bestS2;
        carDataTracker[carIndex].bestS3 = bestS3;

        if (bestS1 > 0 && bestS1 < state.session.sessionBestS1) state.session.sessionBestS1 = bestS1;
        if (bestS2 > 0 && bestS2 < state.session.sessionBestS2) state.session.sessionBestS2 = bestS2;
        if (bestS3 > 0 && bestS3 < state.session.sessionBestS3) state.session.sessionBestS3 = bestS3;

        const lastCompletedLapIdx = numLaps - 2;
        if (lastCompletedLapIdx >= 0) {
            const finalS3 = getSectorTime(historyArray[lastCompletedLapIdx], 3);
            carDataTracker[carIndex].s3 = finalS3;
            if (carIndex === state.playerIndex) state.lap.s3 = finalS3;
        }
    }
});

function extractCoordinateFromTelemetry(telemetry, targetTimeMs) {
    if (!telemetry || telemetry.length === 0 || targetTimeMs <= 0) return null;
    let idx = telemetry.findIndex(pt => pt.t >= targetTimeMs);
    if (idx === 0) return telemetry[0];
    if (idx > 0) {
        const pt1 = telemetry[idx - 1];
        const pt2 = telemetry[idx];
        const rangeTime = pt2.t - pt1.t;
        if (rangeTime > 0) {
            const ratio = (targetTimeMs - pt1.t) / rangeTime;
            return {
                x: pt1.x + (pt2.x - pt1.x) * ratio,
                z: pt1.z + (pt2.z - pt1.z) * ratio,
                yaw: pt1.yaw || 0,
                d: pt1.d + (pt2.d - pt1.d) * ratio
            };
        }
        return pt2;
    }
    return telemetry[telemetry.length - 1];
}

function hasTelemetryCoordinate(point) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.z);
}

function shouldSetSectorLine(existing, coord) {
    if (!hasTelemetryCoordinate(coord)) return false;
    return !existing || !Number.isFinite(existing.x) || !Number.isFinite(existing.z) || (existing.x === 0 && existing.z === 0);
}

function lockOfficialSectorLinesFromTelemetry(carIndex, sector1Ms, sector2Ms, telemetry) {
    if (currentTrackId === -1 || !Array.isArray(telemetry) || telemetry.length < 5) return false;

    let trackUpdated = false;
    if (sector1Ms > 0) {
        const coord = extractCoordinateFromTelemetry(telemetry, sector1Ms);
        if (shouldSetSectorLine(state.sector1, coord)) {
            state.sector1 = { x: coord.x, z: coord.z, yaw: coord.yaw || 0, d: coord.d };
            trackUpdated = true;
        }
    }

    if (sector1Ms > 0 && sector2Ms > 0) {
        const coord = extractCoordinateFromTelemetry(telemetry, sector1Ms + sector2Ms);
        if (shouldSetSectorLine(state.sector2, coord)) {
            state.sector2 = { x: coord.x, z: coord.z, yaw: coord.yaw || 0, d: coord.d };
            trackUpdated = true;
        }
    }

    if (trackUpdated) {
        if (isTrackMapped && currentTrackId !== -1) {
            const filePath = path.join(trackMapsDir, `track_${currentTrackId}.json`);
            fs.writeFileSync(filePath, JSON.stringify({ trackPoints: state.trackPoints, startLine: state.startLine, sector1: state.sector1, sector2: state.sector2 }));
        }
        console.log(`Official sector lines updated from car ${carIndex} split telemetry.`);
    }

    return trackUpdated;
}

f1Client.on('lapData', (data) => {
    setPlayerIndex(data.m_header);
    const pIdx = state.playerIndex;
    let sessionFastestLapMs = Infinity;
    let fastestLapIndex = -1;

    for (let i = 0; i < 22; i++) {
        const lap = data.m_lapData ? data.m_lapData[i] : data.lapData[i];

        // Lap Transition Logic
        if (lap.m_currentLapNum > carPhysics[i].lapNum || (lap.m_lapDistance < 50 && carPhysics[i].lapDistance > (state.session.trackLength - 200))) {
            // Crossed the line
            lastLapTelemetry[i] = currentLapTelemetry[i];
            currentLapTelemetry[i] = [];

            // Capture ghost telemetry upon lap completion
            const lastTime = lap.m_lastLapTimeInMS || (lap.m_lastLapTime * 1000) || 0;
            if (lastTime > 0 && currentTrackId !== -1 && lastLapTelemetry[i] && lastLapTelemetry[i].length > 50) {

                // FORCE the final point of the telemetry array to perfectly match the official lap time
                const lastPoint = lastLapTelemetry[i][lastLapTelemetry[i].length - 1];
                if (lastPoint && lastPoint.t !== lastTime) {
                    const trackLen = state.session.trackLength > 0 ? state.session.trackLength : (lastPoint.d + 20);
                    lastLapTelemetry[i].push({ ...lastPoint, d: trackLen, t: lastTime });
                }

                let record = allTimeFastest[currentTrackId];

                const isFaster = record && lastTime < record.time;
                // Only capture missing ghosts if the lap time is within 5 seconds of the record to prevent out-lap corruption
                const needsGhost = record && !record.hasTelemetry && Math.abs(lastTime - record.time) < 5000;

                if (!record || isFaster) {
                    allTimeFastest[currentTrackId] = {
                        time: lastTime,
                        driver: state.participants[i] || carDataTracker[i].teamName,
                        hasTelemetry: true
                    };
                    fastestLapGhostData = lastLapTelemetry[i];
                    fs.writeFileSync(fastestJsonPath, JSON.stringify(allTimeFastest, null, 2), 'utf8');
                    const trackFastestPath = path.join(lapTimeDir, `fastest_${currentTrackId}.json`);
                    fs.writeFileSync(trackFastestPath, JSON.stringify(lastLapTelemetry[i].map(pt => ({ d: pt.d, t: pt.t }))), 'utf8');
                    fs.writeFileSync(path.join(telemetryDir, `telemetry_${currentTrackId}.json`), JSON.stringify(fastestLapGhostData), 'utf8');
                    state.session.allTimeFastestLapMs = lastTime;
                    state.session.allTimeFastestDriver = allTimeFastest[currentTrackId].driver;
                    console.log(`🏆 NEW TRACK RECORD! Track ${currentTrackId}: ${state.session.allTimeFastestDriver} - ${lastTime}ms`);
                } else if (needsGhost) {
                    allTimeFastest[currentTrackId].hasTelemetry = true;
                    fastestLapGhostData = lastLapTelemetry[i];
                    fs.writeFileSync(fastestJsonPath, JSON.stringify(allTimeFastest, null, 2), 'utf8');
                    const trackFastestPath = path.join(lapTimeDir, `fastest_${currentTrackId}.json`);
                    fs.writeFileSync(trackFastestPath, JSON.stringify(lastLapTelemetry[i].map(pt => ({ d: pt.d, t: pt.t }))), 'utf8');
                    fs.writeFileSync(path.join(telemetryDir, `telemetry_${currentTrackId}.json`), JSON.stringify(fastestLapGhostData), 'utf8');
                    console.log(`👻 REFERENCE GHOST CAPTURED! Track ${currentTrackId} - ${lastTime}ms (Track Record remains ${record.time}ms)`);
                }

                lockOfficialSectorLinesFromTelemetry(i, carDataTracker[i].s1, carDataTracker[i].s2, lastLapTelemetry[i]);
            }
        }

        carPhysics[i].lapDistance = lap.m_lapDistance;
        carPhysics[i].lapNum = lap.m_currentLapNum;
        
        const dtcMsPart = lap.m_deltaToCarInFrontMSPart !== undefined ? lap.m_deltaToCarInFrontMSPart : 0;
        const dtcMinPart = lap.m_deltaToCarInFrontMinutesPart !== undefined ? lap.m_deltaToCarInFrontMinutesPart : 0;
        const dtcMs = (dtcMinPart * 60000) + dtcMsPart;
        carPhysics[i].officialDelta = (dtcMs || lap.m_deltaToCarInFrontInMS || 0) / 1000;
        
        carPhysics[i].sector = lap.m_sector !== undefined ? lap.m_sector : (lap.sector || 0);

        // Record Live Telemetry for Delta and Track Mapping
        const curMs = lap.m_currentLapTimeInMS || (lap.m_currentLapTime * 1000) || 0;
        if (curMs >= 0 && lap.m_lapDistance >= 0 && lap.m_resultStatus !== 0) {
            const carObj = state.allCars && state.allCars[i] ? state.allCars[i] : {};
            let pt = {
                d: lap.m_lapDistance,
                t: curMs,
                x: carObj.x || 0,
                z: carObj.z || 0,
                yaw: carObj.yaw || 0,
                throttle: 0, brake: 0, speed: carObj.speed || 0, steer: 0, gear: 0
            };
            if (i === state.playerIndex) {
                pt.throttle = state.inputs.throttle;
                pt.brake = state.inputs.brake;
                pt.speed = state.inputs.speed;
                pt.steer = state.inputs.steer;
                pt.gear = state.inputs.gear;
            }
            currentLapTelemetry[i].push(pt);
        }

        const liveS1 = getSectorTime(lap, 1);
        const liveS2 = getSectorTime(lap, 2);
        const liveS3 = getSectorTime(lap, 3);

        if (liveS1 > 0) carDataTracker[i].s1 = liveS1;
        if (liveS2 > 0) carDataTracker[i].s2 = liveS2;
        if (liveS3 > 0) carDataTracker[i].s3 = liveS3;

        if ((liveS1 > 0 || liveS2 > 0) && currentLapTelemetry[i].length > 5) {
            lockOfficialSectorLinesFromTelemetry(i, liveS1 || carDataTracker[i].s1, liveS2 || carDataTracker[i].s2, currentLapTelemetry[i]);
        }

        let calculatedBestMs = Infinity;
        if (allLapHistories[i] && allLapHistories[i].length > 0) {
            allLapHistories[i].forEach(lapData => {
                const time = typeof lapData === 'object' ? lapData.lapTime : lapData;
                if (time > 0 && time < calculatedBestMs) calculatedBestMs = time;
            });
        }

        const currentBestMs = lap.m_bestLapTimeInMS || (lap.m_bestLapTime * 1000) || 0;
        const finalBestMs = calculatedBestMs !== Infinity ? calculatedBestMs : currentBestMs;

        if (finalBestMs > 0) carDataTracker[i].bestLapMs = finalBestMs;

        if (carDataTracker[i].bestLapMs > 0 && carDataTracker[i].bestLapMs < sessionFastestLapMs) {
            sessionFastestLapMs = carDataTracker[i].bestLapMs;
            fastestLapIndex = i;
        }

        if (carDataTracker[i].lapNum !== lap.m_currentLapNum) {
            carDataTracker[i].s1 = 0;
            carDataTracker[i].s2 = 0;
            carDataTracker[i].s3 = 0;
        }
        carDataTracker[i].pos = lap.m_carPosition;
        carDataTracker[i].lapNum = lap.m_currentLapNum;
        carDataTracker[i].pitStatus = lap.m_pitStatus;
        carDataTracker[i].driverStatus = lap.m_resultStatus;

        if (i === pIdx) {
            const sector = lap.m_sector !== undefined ? lap.m_sector : (lap.sector || 0);
            if (sector === 1 && state.lap.currentSector === 0) state.lap.pendingS1 = true;
            if (sector === 2 && state.lap.currentSector === 1) state.lap.pendingS2 = true;
            state.lap.currentSector = sector;

            if (state.lap.lapNum !== lap.m_currentLapNum) {
                state.lap.s1 = 0;
                state.lap.s2 = 0;
                state.lap.s3 = 0;
                state.lap.liveS1 = 0;
                state.lap.liveS2 = 0;
                state.lap.liveS3 = 0;
                state.lap.s1State = 'pending';
                state.lap.s2State = 'pending';
                state.lap.s3State = 'pending';
            }

            state.lap.lastMs = lap.m_lastLapTimeInMS || (lap.m_lastLapTime * 1000) || 0;
            state.lap.currentMs = curMs;
            state.lap.pos = lap.m_carPosition;
            state.lap.lapNum = lap.m_currentLapNum;
            state.lap.pitStatus = pitMap[lap.m_pitStatus] || 'ON TRACK';
            state.lap.bestMs = finalBestMs;

            if (liveS1 > 0) state.lap.s1 = liveS1;
            if (liveS2 > 0) state.lap.s2 = liveS2;
            if (liveS3 > 0) state.lap.s3 = liveS3;

            const liveSectorTiming = getLiveSectorTiming(
                state.lap.currentMs,
                state.lap.currentSector,
                state.lap.s1,
                state.lap.s2,
                state.lap.s3
            );
            state.lap.liveS1 = liveSectorTiming.s1;
            state.lap.liveS2 = liveSectorTiming.s2;
            state.lap.liveS3 = liveSectorTiming.s3;
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
        }
    }

    state.session.fastestLapCarIndex = fastestLapIndex;
    state.session.sessionFastestLapMs = sessionFastestLapMs;
    state.pitLanePoints = buildApproxPitLane(state.trackPoints);

    state.session.raceDistance = state.session.trackLength * state.session.lapsTotal;
    state.session.lapsLeft = Math.max(0, state.session.lapsTotal - state.lap.lapNum);
});


f1Client.on('participants', (data) => {
    setPlayerIndex(data.m_header);
    let newNames = [];
    for (let i = 0; i < 22; i++) {
        if (data.m_participants[i]) {
            const teamId = getParticipantTeamId(data.m_participants[i]);
            newNames.push(data.m_participants[i].m_name ? data.m_participants[i].m_name.replace(/\0/g, '').trim() : `CAR ${i}`);
            carDataTracker[i].teamColor = teamMap[teamId] || '#FFFFFF';
            carDataTracker[i].teamName = teamNameMap[teamId] || 'Unknown';
        }
    }
    state.participants = newNames;
});


f1Client.on('carSetups', (data) => {
    setPlayerIndex(data.m_header);
    const setup = data.m_carSetups[state.playerIndex];
    if (setup) {
        state.setup.wingF = setup.m_frontWing; state.setup.wingR = setup.m_rearWing;
        state.setup.diffOn = setup.m_onThrottle; state.setup.diffOff = setup.m_offThrottle;
        state.setup.camberF = setup.m_frontCamber; state.setup.camberR = setup.m_rearCamber;
        state.setup.toeF = setup.m_frontToe; state.setup.toeR = setup.m_rearToe;
        state.setup.bBias = setup.m_brakeBias;
        state.setup.fuel = setup.m_fuelLoad || state.setup.fuel;
    }
});


f1Client.on('carTelemetry', (data) => {
    setPlayerIndex(data.m_header);
    const pIdx = state.playerIndex;

    for (let i = 0; i < 22; i++) {
        const speed = data.m_carTelemetryData[i].m_speed;
        carPhysics[i].speed = speed;
        if (speed > carDataTracker[i].maxSpeed) carDataTracker[i].maxSpeed = speed;
    }

    const t = data.m_carTelemetryData[pIdx];
    state.inputs.speed = t.m_speed; state.inputs.throttle = t.m_throttle * 100;
    state.inputs.steer = t.m_steer; state.inputs.brake = t.m_brake * 100;
    state.inputs.clutch = t.m_clutch; state.inputs.rpm = t.m_engineRPM;

    const gear = t.m_gear;
    state.inputs.gear = gear === 0 ? 'N' : (gear === -1 ? 'R' : gear);
    state.inputs.drs = t.m_drs === 1 ? 'OPEN' : 'CLOSED';

    state.car.brakeTemp.rl = t.m_brakesTemperature[0]; state.car.brakeTemp.rr = t.m_brakesTemperature[1];
    state.car.brakeTemp.fl = t.m_brakesTemperature[2]; state.car.brakeTemp.fr = t.m_brakesTemperature[3];
    state.car.surfTemp.rl = t.m_tyresSurfaceTemperature[0]; state.car.surfTemp.rr = t.m_tyresSurfaceTemperature[1];
    state.car.surfTemp.fl = t.m_tyresSurfaceTemperature[2]; state.car.surfTemp.fr = t.m_tyresSurfaceTemperature[3];
    state.car.inTemp.rl = t.m_tyresInnerTemperature[0]; state.car.inTemp.rr = t.m_tyresInnerTemperature[1];
    state.car.inTemp.fl = t.m_tyresInnerTemperature[2]; state.car.inTemp.fr = t.m_tyresInnerTemperature[3];
    state.car.press.rl = t.m_tyresPressure[0]; state.car.press.rr = t.m_tyresPressure[1];
    state.car.press.fl = t.m_tyresPressure[2]; state.car.press.fr = t.m_tyresPressure[3];
    state.car.engineTemp = t.m_engineTemperature;
});


f1Client.on('carStatus', (data) => {
    setPlayerIndex(data.m_header);
    const pIdx = state.playerIndex;

    const visualTyreNames = { 16: 'SOFT', 17: 'MEDIUM', 18: 'HARD', 7: 'INTER', 8: 'WET' };
    const visualTyreColors = { 16: '#E10600', 17: '#FFC72C', 18: '#FFFFFF', 7: '#00E676', 8: '#00D2FF' };
    const fallbackTyreNames = { 7: 'INTER', 8: 'WET', 9: 'DRY', 10: 'WET', 11: 'SUPER SOFT', 12: 'SOFT', 13: 'MEDIUM', 14: 'HARD', 15: 'WET' };

    for (let i = 0; i < 22; i++) {
        const s = data.m_carStatusData[i];
        const visual = s.m_visualTyreCompound;
        const actual = s.m_actualTyreCompound;

        carDataTracker[i].tyre = visualTyreNames[visual] || fallbackTyreNames[actual] || 'UNK';
        carDataTracker[i].tyreClass = visualTyreColors[visual] || '#808080';
    }

    const pStat = data.m_carStatusData[pIdx];
    state.car.compound = carDataTracker[pIdx].tyre;
    state.car.flag = flagMap[pStat.m_vehicleFiaFlags] || 'GREEN';
    state.ers.battery = (pStat.m_ersStoreEnergy / 4000000) * 100;
    state.ers.mode = ersMap[pStat.m_ersDeployMode] || pStat.m_ersDeployMode;
    state.setup.fuel = pStat.m_fuelInTank || pStat.m_fuelMass || state.setup.fuel;
    state.car.tyreAge = pStat.m_tyresAgeLaps || 0;
});


f1Client.on('carDamage', (data) => {
    setPlayerIndex(data.m_header);
    const wear = data.m_carDamageData[state.playerIndex].m_tyresWear;
    state.car.wear.rl = wear[0]; state.car.wear.rr = wear[1];
    state.car.wear.fl = wear[2]; state.car.wear.fr = wear[3];
});


setInterval(() => {
    let newLeaderboard = [];


    for (let i = 0; i < 22; i++) {
        if (carDataTracker[i].driverStatus !== 0) {
            newLeaderboard.push({
                carIndex: i,
                ...carDataTracker[i],
                lapDistance: carPhysics[i].lapDistance,
                speed: carPhysics[i].speed,
                lapHistory: allLapHistories[i] || []
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
            } else if (idx === 0) {

                const mins = Math.floor(driver.bestLapMs / 60000);
                const secs = ((driver.bestLapMs % 60000) / 1000).toFixed(3);
                driver.gapText = `${mins}:${secs.padStart(6, '0')}`;
            } else {
                const diff = (driver.bestLapMs - poleTimeMs) / 1000;
                driver.gapText = `+${diff.toFixed(3)}`;
            }
        });

    } else {


        newLeaderboard = newLeaderboard.filter(d => d.pos > 0 && d.pos <= 22);
        newLeaderboard.sort((a, b) => a.pos - b.pos);

        newLeaderboard.forEach((driver, idx) => {
            if (driver.pitStatus === 1 || driver.pitStatus === 2) {
                driver.gapText = 'PIT';
            } else if (idx === 0) {
                driver.gapText = 'Interval';
            } else {
                const driverAhead = newLeaderboard[idx - 1];
                const pCurr = carPhysics[driver.carIndex];
                const pAhead = carPhysics[driverAhead.carIndex];

                let delta = pCurr.officialDelta;
                let lapDiff = pAhead.lapNum - pCurr.lapNum;

                if (driverAhead.pitStatus > 0) {
                    driver.gapText = delta > 0 ? `+${delta.toFixed(3)}` : 'PIT AHEAD';
                } else if (lapDiff >= 1 && delta === 0) {
                    driver.gapText = `+${lapDiff} LAP${lapDiff > 1 ? 'S' : ''}`;
                } else if (delta > 0 && delta < 150) {
                    driver.gapText = `+${delta.toFixed(3)}`;
                } else {
                    let distanceGap = 0;
                    const tLen = state.session.trackLength || 5000;

                    if (pAhead.lapNum === pCurr.lapNum) {
                        distanceGap = pAhead.lapDistance - pCurr.lapDistance;
                    } else if (pAhead.lapNum > pCurr.lapNum) {
                        distanceGap = (tLen - pCurr.lapDistance) + pAhead.lapDistance + (tLen * (pAhead.lapNum - pCurr.lapNum - 1));
                    }

                    if (distanceGap > 0) {
                        const speedMs = Math.max(pCurr.speed, 30) / 3.6;
                        const timeGap = distanceGap / speedMs;

                        if (lapDiff >= 1 && timeGap > 80) {
                            driver.gapText = `+${lapDiff} LAP${lapDiff > 1 ? 'S' : ''}`;
                        } else {
                            driver.gapText = `+${timeGap.toFixed(3)}*`;
                        }
                    } else {
                        driver.gapText = '+0.000';
                    }
                }
            }
        });
    }


    state.leaderboard = newLeaderboard;
    const pIdx = state.playerIndex;
    const playerLbInfo = state.leaderboard.find(d => d.carIndex === pIdx);
    if (playerLbInfo) state.lap.gapFront = playerLbInfo.gapText;

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
                // If pDist is further than ghost ever reached
                ghostTimeAtDist = fastestLapGhostData[fastestLapGhostData.length - 1].t;
            }

            if (ghostTimeAtDist > 0) {
                state.lap.liveDeltaToRecord = state.lap.currentMs - ghostTimeAtDist;
            }
        }
    }

    const payload = JSON.stringify(state);
    clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    });
}, intervalMs);

f1Client.start();
console.log(`🏎️  UNIFIED COMMAND CENTER ONLINE (${hz}Hz)`);
console.log('Listening for UDP on port 20777...');

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
    console.log(`➡️ http://localhost:${PORT}`);
    console.log('--------------------------------------\n');
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on all IPs at port ${PORT}`);
    displayAllLocalIPv4();
});

