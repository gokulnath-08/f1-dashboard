/**
 * ═════════════════════════════════════════════════════════════════════════════
 * F1 GHOST LAP TELEMETRY COMPARISON & REAL-TIME GHOST CAR VISUALIZATION ENGINE
 * ═════════════════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    // --- State Management ---
    const GhostState = {
        ws: null,
        isConnected: false,
        isLiveGameActive: false,
        currentTrackId: -1,
        trackName: 'Unknown Circuit',
        trackLength: 5000,
        trackPoints: [],
        drsZones: [],
        sector1: null,
        sector2: null,
        startLine: null,

        // Available Drivers / Fastest Laps in Session
        availableDrivers: [],
        selectedDriverAIdx: -1,
        selectedDriverBIdx: -1,

        // Driver Full Telemetry Data
        driverA: null, // { carIndex, driverName, teamName, teamColor, lapTimeMs, s1, s2, s3, telemetry: [] }
        driverB: null,

        // Interpolated Synchronized Curves
        alignedData: [], // Array of points sampled at fixed distance intervals: { d, timeA, timeB, delta, speedA, speedB, thrA, thrB, brkA, brkB, gearA, gearB, drsA, drsB, posA: {x,z,yaw}, posB: {x,z,yaw} }
        microSectors: [], // Array of mini sectors with faster driver classification

        // Playback Engine State
        isPlaying: false,
        playbackSpeed: 1.0,
        currentDistance: 0,
        currentTimeMs: 0,
        maxDistance: 5000,
        maxLapTimeMs: 90000,
        isLiveSync: false,
        isLooping: true,
        lastAnimTime: 0,

        // Hover & Scrubbing State
        isDraggingScrubber: false,
        hoverDistance: null,

        // Canvas Elements
        circuitCanvas: null,
        circuitCtx: null,
        deltaCanvas: null,
        deltaCtx: null,
        speedCanvas: null,
        speedCtx: null,
        pedalsCanvas: null,
        pedalsCtx: null
    };

    // Default Team Colors Palette
    const DEFAULT_TEAM_COLORS = {
        'red bull': '#3671C6',
        'ferrari': '#E8002D',
        'mercedes': '#27F4D2',
        'mclaren': '#FF8000',
        'aston martin': '#229971',
        'alpine': '#0093CC',
        'williams': '#64C4FF',
        'rb': '#6692FF',
        'kick sauber': '#52E252',
        'haas': '#B6BABD'
    };

    // --- DOM Elements Cache ---
    const DOM = {};

    function initDOMElements() {
        DOM.circuitSelect = document.getElementById('circuitSelect');
        DOM.liveStatusBadge = document.getElementById('liveStatusBadge');
        DOM.liveStatusText = document.getElementById('liveStatusText');
        DOM.btnRefresh = document.getElementById('btnRefresh');
        DOM.btnDemo = document.getElementById('btnDemo');
        DOM.btnDetectLive = document.getElementById('btnDetectLive');

        DOM.driverASelect = document.getElementById('driverASelect');
        DOM.driverBSelect = document.getElementById('driverBSelect');
        DOM.driverATime = document.getElementById('driverATime');
        DOM.driverBTime = document.getElementById('driverBTime');
        DOM.driverAS1 = document.getElementById('driverAS1');
        DOM.driverAS2 = document.getElementById('driverAS2');
        DOM.driverAS3 = document.getElementById('driverAS3');
        DOM.driverBS1 = document.getElementById('driverBS1');
        DOM.driverBS2 = document.getElementById('driverBS2');
        DOM.driverBS3 = document.getElementById('driverBS3');

        DOM.overallGapTag = document.getElementById('overallGapTag');
        DOM.gapAdvantageLbl = document.getElementById('gapAdvantageLbl');

        DOM.circuitMapCanvas = document.getElementById('circuitMapCanvas');
        DOM.hudTrackDist = document.getElementById('hudTrackDist');
        DOM.hudLiveDelta = document.getElementById('hudLiveDelta');

        // Playback Controls
        DOM.timelineSlider = document.getElementById('timelineSlider');
        DOM.timelineTime = document.getElementById('timelineTime');
        DOM.microSectorStrip = document.getElementById('microSectorStrip');
        DOM.btnPlayPause = document.getElementById('btnPlayPause');
        DOM.btnRestart = document.getElementById('btnRestart');
        DOM.btnLiveSync = document.getElementById('btnLiveSync');
        DOM.btnLoop = document.getElementById('btnLoop');
        DOM.speedButtons = document.querySelectorAll('.speed-btn');

        // Live Telemetry Gauges
        DOM.gaugeDriverAName = document.getElementById('gaugeDriverAName');
        DOM.gaugeDriverBName = document.getElementById('gaugeDriverBName');
        DOM.gaugeSpeedA = document.getElementById('gaugeSpeedA');
        DOM.gaugeSpeedB = document.getElementById('gaugeSpeedB');
        DOM.gaugeGearA = document.getElementById('gaugeGearA');
        DOM.gaugeGearB = document.getElementById('gaugeGearB');
        DOM.gaugeThrValA = document.getElementById('gaugeThrValA');
        DOM.gaugeThrValB = document.getElementById('gaugeThrValB');
        DOM.gaugeBrkValA = document.getElementById('gaugeBrkValA');
        DOM.gaugeBrkValB = document.getElementById('gaugeBrkValB');
        DOM.gaugeThrBarA = document.getElementById('gaugeThrBarA');
        DOM.gaugeThrBarB = document.getElementById('gaugeThrBarB');
        DOM.gaugeBrkBarA = document.getElementById('gaugeBrkBarA');
        DOM.gaugeBrkBarB = document.getElementById('gaugeBrkBarB');
        DOM.instantGapVal = document.getElementById('instantGapVal');
        DOM.instantDistVal = document.getElementById('instantDistVal');

        // Telemetry Graphs
        DOM.deltaGraphCanvas = document.getElementById('deltaGraphCanvas');
        DOM.speedGraphCanvas = document.getElementById('speedGraphCanvas');
        DOM.pedalsGraphCanvas = document.getElementById('pedalsGraphCanvas');

        // Stats Table Body
        DOM.statsTableBody = document.getElementById('statsTableBody');

        // Toast
        DOM.ghostToast = document.getElementById('ghostToast');
    }

    // --- Toast Notification Helper ---
    function showToast(msg, duration = 3000) {
        if (!DOM.ghostToast) return;
        DOM.ghostToast.innerText = msg;
        DOM.ghostToast.classList.add('show');
        setTimeout(() => {
            DOM.ghostToast.classList.remove('show');
        }, duration);
    }

    // --- Formatters ---
    function formatMs(ms) {
        if (!ms || ms <= 0 || ms === Infinity || isNaN(ms)) return '--:--.---';
        const mins = Math.floor(ms / 60000);
        const secs = Math.floor((ms % 60000) / 1000);
        const millis = Math.floor(ms % 1000);
        return `${mins}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
    }

    function formatSector(ms) {
        if (!ms || ms <= 0 || ms === Infinity || isNaN(ms)) return '--.---';
        return (ms / 1000).toFixed(3);
    }

    function formatDeltaSec(diffMs) {
        if (diffMs === 0 || isNaN(diffMs)) return '±0.000s';
        const sign = diffMs > 0 ? '+' : '-';
        return `${sign}${(Math.abs(diffMs) / 1000).toFixed(3)}s`;
    }

    // --- WebSocket Connection ---
    function initWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname || 'localhost';
        const port = window.location.port || '3000';
        const wsUrl = `${protocol}//${host}:${port}`;

        try {
            GhostState.ws = new WebSocket(wsUrl);

            GhostState.ws.onopen = () => {
                GhostState.isConnected = true;
                updateLiveStatus(true);
                showToast('Connected to Unified Command Center');
                
                // Request available tracks and session driver fastest laps
                GhostState.ws.send(JSON.stringify({ action: 'getAvailableTracks' }));
                GhostState.ws.send(JSON.stringify({ action: 'getSessionDriverFastestLaps' }));
                if (GhostState.currentTrackId !== -1) {
                    GhostState.ws.send(JSON.stringify({ action: 'getTrackData', trackId: GhostState.currentTrackId }));
                }
            };

            GhostState.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    handleWebSocketMessage(msg);
                } catch (e) {
                    console.error('Error parsing WS message:', e);
                }
            };

            GhostState.ws.onclose = () => {
                GhostState.isConnected = false;
                updateLiveStatus(false);
                setTimeout(initWebSocket, 3000);
            };

            GhostState.ws.onerror = () => {
                GhostState.isConnected = false;
                updateLiveStatus(false);
            };
        } catch (e) {
            console.error('WS init error:', e);
            fallbackFetchTracksAndLaps();
        }
    }

    function updateLiveStatus(isOnline) {
        if (!DOM.liveStatusBadge) return;
        if (isOnline) {
            DOM.liveStatusBadge.classList.add('online');
            DOM.liveStatusText.innerText = 'ONLINE';
        } else {
            DOM.liveStatusBadge.classList.remove('online');
            DOM.liveStatusText.innerText = 'OFFLINE (STANDBY)';
        }
    }

    // --- Handle Incoming WebSocket Messages ---
    function handleWebSocketMessage(msg) {
        if (!msg) return;

        // 1. Live Telemetry stream packet
        if (msg.type === 'telemetry') {
            handleLiveTelemetryPacket(msg);
            return;
        }

        // 2. Track Data Response (3D / 2D Circuit Points)
        if (msg.type === 'trackDataResponse') {
            if (msg.data && msg.data.trackPoints && msg.data.trackPoints.length > 10) {
                GhostState.trackPoints = msg.data.trackPoints;
                GhostState.startLine = msg.data.startLine || null;
                GhostState.sector1 = msg.data.sector1 || null;
                GhostState.sector2 = msg.data.sector2 || null;
                GhostState.drsZones = msg.data.drsZones || [];
                renderCircuitMap();
            }
            return;
        }

        // 3. Driver Fastest Laps List in Session
        if (msg.type === 'sessionDriverFastestLapsResponse') {
            if (Array.isArray(msg.data)) {
                updateAvailableDriversList(msg.data);
            }
            return;
        }

        // 4. Live update when a driver records a new fastest lap
        if (msg.type === 'driverFastestLapUpdate') {
            handleDriverFastestLapUpdate(msg.data);
            return;
        }

        // 5. Driver Telemetry Response
        if (msg.type === 'driverLapTelemetryResponse') {
            handleDriverLapTelemetryResponse(msg.carIndex, msg.data);
            return;
        }

        // 6. Ghost Comparison Data Response
        if (msg.type === 'ghostComparisonDataResponse') {
            if (msg.driverA) setDriverData('A', msg.driverA);
            if (msg.driverB) setDriverData('B', msg.driverB);
            recalculateAlignedComparison();
            return;
        }
    }

    // --- Live Telemetry Packet Handler ---
    function handleLiveTelemetryPacket(data) {
        GhostState.isLiveGameActive = data.isGameActive || false;

        // Note: Track selection is MANUAL (no automatic track override from live packets)

        // If Live Sync Mode is active AND current game track matches the manually selected track, sync scrubber
        if (GhostState.isLiveSync && data.lap && data.session && data.session.trackId === GhostState.currentTrackId) {
            const pIdx = data.playerIndex || 0;
            const pCar = data.allCars && data.allCars[pIdx];
            if (pCar && pCar.lapDistance !== undefined && pCar.lapDistance >= 0) {
                GhostState.currentDistance = pCar.lapDistance;
                updatePlaybackPosition(GhostState.currentDistance, false);
            }
        }
    }

    // --- Update Available Drivers List in Dropdowns ---
    function updateAvailableDriversList(driverLaps) {
        if (!Array.isArray(driverLaps) || driverLaps.length === 0) {
            GhostState.availableDrivers = [];
            clearComparisonData();
            return;
        }

        GhostState.availableDrivers = driverLaps;
        populateDriverDropdowns();
    }

    function clearComparisonData() {
        GhostState.driverA = null;
        GhostState.driverB = null;
        GhostState.alignedData = [];
        GhostState.microSectors = [];
        GhostState.selectedDriverAIdx = -1;
        GhostState.selectedDriverBIdx = -1;

        if (DOM.driverASelect) DOM.driverASelect.innerHTML = '<option value="">No Laps Recorded for This Track</option>';
        if (DOM.driverBSelect) DOM.driverBSelect.innerHTML = '<option value="">No Laps Recorded for This Track</option>';

        if (DOM.driverATime) DOM.driverATime.innerText = '--:--.---';
        if (DOM.driverAS1) DOM.driverAS1.innerText = '--.---';
        if (DOM.driverAS2) DOM.driverAS2.innerText = '--.---';
        if (DOM.driverAS3) DOM.driverAS3.innerText = '--.---';

        if (DOM.driverBTime) DOM.driverBTime.innerText = '--:--.---';
        if (DOM.driverBS1) DOM.driverBS1.innerText = '--.---';
        if (DOM.driverBS2) DOM.driverBS2.innerText = '--.---';
        if (DOM.driverBS3) DOM.driverBS3.innerText = '--.---';

        if (DOM.overallGapTag) DOM.overallGapTag.innerText = '±0.000s';
        if (DOM.gapAdvantageLbl) DOM.gapAdvantageLbl.innerText = 'NO LAP DATA ON SELECTED CIRCUIT';

        if (DOM.statsTableBody) {
            DOM.statsTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:rgba(255,255,255,0.4); padding:20px; font-weight:600;">No telemetry laps available for this track yet. Drive laps in session or click Demo Data.</td></tr>';
        }
        if (DOM.microSectorStrip) DOM.microSectorStrip.innerHTML = '';

        renderCircuitMap();
        renderAllTelemetryGraphs();
    }

    function populateDriverDropdowns() {
        if (!DOM.driverASelect || !DOM.driverBSelect) return;

        const valA = DOM.driverASelect.value;
        const valB = DOM.driverBSelect.value;

        DOM.driverASelect.innerHTML = '';
        DOM.driverBSelect.innerHTML = '';

        GhostState.availableDrivers.forEach((d, idx) => {
            const optA = document.createElement('option');
            optA.value = d.carIndex;
            optA.text = `${d.driverName} (${d.teamName}) - ${formatMs(d.lapTimeMs)}`;
            DOM.driverASelect.appendChild(optA);

            const optB = document.createElement('option');
            optB.value = d.carIndex;
            optB.text = `${d.driverName} (${d.teamName}) - ${formatMs(d.lapTimeMs)}`;
            DOM.driverBSelect.appendChild(optB);
        });

        // Set default selection (P1 vs P2 or Car 0 vs Car 1)
        if (GhostState.availableDrivers.length > 0) {
            const defaultA = (valA !== '' && GhostState.availableDrivers.some(d => String(d.carIndex) === String(valA))) ? valA : GhostState.availableDrivers[0].carIndex;
            const defaultB = (valB !== '' && GhostState.availableDrivers.some(d => String(d.carIndex) === String(valB))) ? valB : (GhostState.availableDrivers[1] ? GhostState.availableDrivers[1].carIndex : GhostState.availableDrivers[0].carIndex);

            DOM.driverASelect.value = defaultA;
            DOM.driverBSelect.value = defaultB;

            onDriverASelected(defaultA);
            onDriverBSelected(defaultB);
        }
    }

    // --- On Driver Selected Handlers ---
    function onDriverASelected(carIndex) {
        if (!carIndex && carIndex !== 0) return;
        carIndex = parseInt(carIndex, 10);
        GhostState.selectedDriverAIdx = carIndex;
        fetchDriverTelemetry(carIndex, 'A');
    }

    function onDriverBSelected(carIndex) {
        if (!carIndex && carIndex !== 0) return;
        carIndex = parseInt(carIndex, 10);
        GhostState.selectedDriverBIdx = carIndex;
        fetchDriverTelemetry(carIndex, 'B');
    }

    // --- Live Event when a Driver Records a New Fastest Lap ---
    function handleDriverFastestLapUpdate(data) {
        if (!data) return;
        showToast(`⏱️ Stored Telemetry: ${data.driverName} - ${formatMs(data.lapTimeMs)} (${data.telemetryLength || 0} pts)`);

        // Check if driver already in available list
        const existingIdx = GhostState.availableDrivers.findIndex(d => d.carIndex === data.carIndex);
        if (existingIdx >= 0) {
            GhostState.availableDrivers[existingIdx] = data;
        } else {
            GhostState.availableDrivers.push(data);
        }

        // Sort by lap time ascending (placing valid times first)
        GhostState.availableDrivers.sort((a, b) => {
            if (a.lapTimeMs <= 0 && b.lapTimeMs <= 0) return 0;
            if (a.lapTimeMs <= 0) return 1;
            if (b.lapTimeMs <= 0) return -1;
            return a.lapTimeMs - b.lapTimeMs;
        });

        populateDriverDropdowns();

        // If this driver is currently selected as A or B, refresh their telemetry trace
        if (GhostState.selectedDriverAIdx === data.carIndex || GhostState.selectedDriverAIdx === -1) {
            fetchDriverTelemetry(data.carIndex, 'A');
        }
        if (GhostState.selectedDriverBIdx === data.carIndex || (GhostState.selectedDriverBIdx === -1 && GhostState.availableDrivers.length > 1)) {
            fetchDriverTelemetry(data.carIndex, 'B');
        }
    }

    // --- Fetch Driver Telemetry ---
    function fetchDriverTelemetry(carIndex, slot) {
        const tId = GhostState.currentTrackId;
        if (GhostState.ws && GhostState.ws.readyState === WebSocket.OPEN) {
            GhostState.ws.send(JSON.stringify({
                action: 'getDriverLapTelemetry',
                carIndex: carIndex,
                trackId: tId
            }));
        }
        fetch(`/api/session/driver-telemetry?carIndex=${carIndex}&trackId=${tId}`)
            .then(r => r.json())
            .then(res => {
                if (res.success && res.data) {
                    setDriverData(slot, res.data);
                    recalculateAlignedComparison();
                }
            })
            .catch(err => {
                console.warn(`Could not fetch driver ${carIndex} telemetry:`, err);
            });
    }

    function handleDriverLapTelemetryResponse(carIndex, lapData) {
        if (!lapData) return;
        if (GhostState.selectedDriverAIdx === carIndex) {
            setDriverData('A', lapData);
        }
        if (GhostState.selectedDriverBIdx === carIndex) {
            setDriverData('B', lapData);
        }
        recalculateAlignedComparison();
    }

    function setDriverData(slot, data) {
        if (slot === 'A') {
            GhostState.driverA = data;
            if (data.teamColor) {
                document.documentElement.style.setProperty('--driver-a-color', data.teamColor);
            }
            if (DOM.driverATime) DOM.driverATime.innerText = formatMs(data.lapTimeMs);
            if (DOM.driverAS1) DOM.driverAS1.innerText = formatSector(data.s1);
            if (DOM.driverAS2) DOM.driverAS2.innerText = formatSector(data.s2);
            if (DOM.driverAS3) DOM.driverAS3.innerText = formatSector(data.s3);
            if (DOM.gaugeDriverAName) DOM.gaugeDriverAName.innerText = data.driverName || 'DRIVER A';
        } else if (slot === 'B') {
            GhostState.driverB = data;
            if (data.teamColor) {
                document.documentElement.style.setProperty('--driver-b-color', data.teamColor);
            }
            if (DOM.driverBTime) DOM.driverBTime.innerText = formatMs(data.lapTimeMs);
            if (DOM.driverBS1) DOM.driverBS1.innerText = formatSector(data.s1);
            if (DOM.driverBS2) DOM.driverBS2.innerText = formatSector(data.s2);
            if (DOM.driverBS3) DOM.driverBS3.innerText = formatSector(data.s3);
            if (DOM.gaugeDriverBName) DOM.gaugeDriverBName.innerText = data.driverName || 'DRIVER B';
        }

        // Compare overall lap time difference
        if (GhostState.driverA && GhostState.driverB) {
            const timeA = GhostState.driverA.lapTimeMs || 0;
            const timeB = GhostState.driverB.lapTimeMs || 0;
            const diff = timeB - timeA; // Positive means A is faster

            if (DOM.overallGapTag) {
                DOM.overallGapTag.innerText = formatDeltaSec(diff);
                DOM.overallGapTag.className = 'overall-gap-tag ' + (diff > 0 ? 'gap-a-faster' : 'gap-b-faster');
            }
            if (DOM.gapAdvantageLbl) {
                if (diff > 0) {
                    DOM.gapAdvantageLbl.innerText = `${GhostState.driverA.driverName} Faster`;
                } else if (diff < 0) {
                    DOM.gapAdvantageLbl.innerText = `${GhostState.driverB.driverName} Faster`;
                } else {
                    DOM.gapAdvantageLbl.innerText = 'Equal Lap Time';
                }
            }
        }
    }

    // --- Synchronize & Align Telemetry Along Lap Distance ---
    function recalculateAlignedComparison() {
        if (!GhostState.driverA || !GhostState.driverB) return;

        const telA = GhostState.driverA.telemetry || [];
        const telB = GhostState.driverB.telemetry || [];

        if (telA.length === 0 || telB.length === 0) return;

        const maxDistA = telA[telA.length - 1].d || 5000;
        const maxDistB = telB[telB.length - 1].d || 5000;
        const totalDist = Math.max(maxDistA, maxDistB, GhostState.trackLength || 5000);
        GhostState.maxDistance = totalDist;

        if (DOM.timelineSlider) {
            DOM.timelineSlider.max = Math.round(totalDist);
        }

        const step = 5; // Sample every 5 meters
        const numSamples = Math.ceil(totalDist / step);
        const aligned = [];

        let idxA = 0;
        let idxB = 0;

        for (let i = 0; i <= numSamples; i++) {
            const d = Math.min(totalDist, i * step);

            // Advance pointer in A
            while (idxA < telA.length - 1 && telA[idxA + 1].d < d) {
                idxA++;
            }
            // Advance pointer in B
            while (idxB < telB.length - 1 && telB[idxB + 1].d < d) {
                idxB++;
            }

            const ptA = interpolateTelemetryAtDistance(telA, idxA, d);
            const ptB = interpolateTelemetryAtDistance(telB, idxB, d);

            // Time Delta: delta = timeB - timeA.
            // Positive delta means Driver A was at this distance earlier (Driver A is faster / leading).
            const deltaMs = (ptB.t - ptA.t);

            aligned.push({
                d: d,
                timeA: ptA.t,
                timeB: ptB.t,
                deltaMs: deltaMs,
                speedA: ptA.speed,
                speedB: ptB.speed,
                thrA: ptA.throttle,
                thrB: ptB.throttle,
                brkA: ptA.brake,
                brkB: ptB.brake,
                gearA: ptA.gear,
                gearB: ptB.gear,
                drsA: ptA.drs,
                drsB: ptB.drs,
                posA: { x: ptA.x, z: ptA.z, yaw: ptA.yaw },
                posB: { x: ptB.x, z: ptB.z, yaw: ptB.yaw }
            });
        }

        GhostState.alignedData = aligned;

        // Build Micro-Sector Strip (e.g. 50 segments)
        buildMicroSectors(aligned, totalDist);

        // Build Key Corners & Apex Analysis Table
        buildStatsTable(aligned);

        // Render Telemetry Graphs
        renderAllTelemetryGraphs();

        // Update Playback HUD for current position
        updatePlaybackPosition(GhostState.currentDistance, false);
    }

    function interpolateTelemetryAtDistance(tel, idx, targetD) {
        if (!tel || tel.length === 0) {
            return { d: targetD, t: 0, speed: 0, throttle: 0, brake: 0, gear: 1, drs: 0, x: 0, z: 0, yaw: 0 };
        }
        if (idx >= tel.length - 1) {
            return tel[tel.length - 1];
        }
        const p1 = tel[idx];
        const p2 = tel[idx + 1];
        const rangeD = p2.d - p1.d;

        if (rangeD <= 0) return p1;

        const ratio = Math.max(0, Math.min(1, (targetD - p1.d) / rangeD));

        return {
            d: targetD,
            t: p1.t + (p2.t - p1.t) * ratio,
            speed: p1.speed + (p2.speed - p1.speed) * ratio,
            throttle: p1.throttle + (p2.throttle - p1.throttle) * ratio,
            brake: p1.brake + (p2.brake - p1.brake) * ratio,
            gear: ratio < 0.5 ? p1.gear : p2.gear,
            drs: ratio < 0.5 ? p1.drs : p2.drs,
            x: p1.x + (p2.x - p1.x) * ratio,
            z: p1.z + (p2.z - p1.z) * ratio,
            yaw: interpolateYaw(p1.yaw, p2.yaw, ratio)
        };
    }

    function interpolateYaw(yaw1, yaw2, ratio) {
        if (yaw1 === undefined) return 0;
        if (yaw2 === undefined) return yaw1;
        let diff = yaw2 - yaw1;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        return yaw1 + diff * ratio;
    }

    // --- Build Micro-Sector Strip ---
    function buildMicroSectors(aligned, totalDist) {
        if (!DOM.microSectorStrip || aligned.length === 0) return;

        const numSegments = 50;
        const segDist = totalDist / numSegments;
        const microSecs = [];
        DOM.microSectorStrip.innerHTML = '';

        for (let s = 0; s < numSegments; s++) {
            const startD = s * segDist;
            const endD = (s + 1) * segDist;

            // Find samples in this segment
            const samples = aligned.filter(pt => pt.d >= startD && pt.d < endD);
            let avgDelta = 0;
            if (samples.length > 0) {
                // Rate of delta change across segment: delta at end - delta at start
                const dStart = samples[0].deltaMs;
                const dEnd = samples[samples.length - 1].deltaMs;
                avgDelta = dEnd - dStart;
            }

            const cell = document.createElement('div');
            cell.className = 'micro-sec-cell ' + (avgDelta > 0 ? 'sec-a' : 'sec-b');
            cell.title = `Sector ${s + 1} (${Math.round(startD)}m - ${Math.round(endD)}m): ${avgDelta > 0 ? 'Driver A Faster' : 'Driver B Faster'}`;
            DOM.microSectorStrip.appendChild(cell);

            microSecs.push({
                sector: s + 1,
                startD,
                endD,
                advantage: avgDelta > 0 ? 'A' : 'B',
                gainMs: Math.abs(avgDelta)
            });
        }
        GhostState.microSectors = microSecs;
    }

    // --- Build Stats & Apex Table ---
    function buildStatsTable(aligned) {
        if (!DOM.statsTableBody || aligned.length === 0) return;

        DOM.statsTableBody.innerHTML = '';

        // 1. Sector 1, 2, 3 Split Comparison
        const s1A = GhostState.driverA.s1 || 0;
        const s1B = GhostState.driverB.s1 || 0;
        const s2A = GhostState.driverA.s2 || 0;
        const s2B = GhostState.driverB.s2 || 0;
        const s3A = GhostState.driverA.s3 || 0;
        const s3B = GhostState.driverB.s3 || 0;

        addTableRow('Sector 1 Time', `${formatSector(s1A)}s`, `${formatSector(s1B)}s`, s1B - s1A);
        addTableRow('Sector 2 Time', `${formatSector(s2A)}s`, `${formatSector(s2B)}s`, s2B - s2A);
        addTableRow('Sector 3 Time', `${formatSector(s3A)}s`, `${formatSector(s3B)}s`, s3B - s3A);

        // 2. Top Speed Analysis
        const topSpeedA = Math.round(Math.max(...aligned.map(p => p.speedA || 0)));
        const topSpeedB = Math.round(Math.max(...aligned.map(p => p.speedB || 0)));
        addTableRow('Top Speed (Straight Trap)', `${topSpeedA} km/h`, `${topSpeedB} km/h`, topSpeedA - topSpeedB, 'km/h');

        // 3. Full Throttle %
        const fullThrCountA = aligned.filter(p => p.thrA >= 98).length;
        const fullThrCountB = aligned.filter(p => p.thrB >= 98).length;
        const pctThrA = ((fullThrCountA / aligned.length) * 100).toFixed(1);
        const pctThrB = ((fullThrCountB / aligned.length) * 100).toFixed(1);
        addTableRow('Full Throttle (% of Lap)', `${pctThrA}%`, `${pctThrB}%`, (pctThrA - pctThrB).toFixed(1), '%');

        // 4. Heavy Braking Distance (Brake > 75%)
        const brkCountA = aligned.filter(p => p.brkA >= 75).length * 5; // meters
        const brkCountB = aligned.filter(p => p.brkB >= 75).length * 5;
        addTableRow('Heavy Braking Zones', `${brkCountA}m`, `${brkCountB}m`, brkCountB - brkCountA, 'm');

        // 5. Minimum Apex Corner Speed
        const minSpeedA = Math.round(Math.min(...aligned.filter(p => p.speedA > 40).map(p => p.speedA || 999)));
        const minSpeedB = Math.round(Math.min(...aligned.filter(p => p.speedB > 40).map(p => p.speedB || 999)));
        addTableRow('Slowest Corner Apex Speed', `${minSpeedA} km/h`, `${minSpeedB} km/h`, minSpeedA - minSpeedB, 'km/h');
    }

    function addTableRow(metric, valA, valB, delta, unit = 's') {
        const tr = document.createElement('tr');
        const numDelta = typeof delta === 'number' ? delta : parseFloat(delta);
        let badgeClass = 'delta-badge-neg';
        let deltaText = '';

        if (unit === 's') {
            deltaText = formatDeltaSec(numDelta);
            badgeClass = numDelta > 0 ? 'delta-badge-neg' : 'delta-badge-pos';
        } else if (unit === 'km/h' || unit === '%') {
            deltaText = (numDelta > 0 ? `+${numDelta}` : `${numDelta}`) + ` ${unit}`;
            badgeClass = numDelta > 0 ? 'delta-badge-neg' : 'delta-badge-pos';
        } else {
            deltaText = (numDelta > 0 ? `+${numDelta}` : `${numDelta}`) + ` ${unit}`;
            badgeClass = numDelta <= 0 ? 'delta-badge-neg' : 'delta-badge-pos';
        }

        tr.innerHTML = `
            <td style="font-weight:700; color:#fff;">${metric}</td>
            <td class="table-driver-a-val">${valA}</td>
            <td class="table-driver-b-val">${valB}</td>
            <td class="${badgeClass}">${deltaText}</td>
        `;
        DOM.statsTableBody.appendChild(tr);
    }

    // --- Render All Telemetry Comparison Graphs ---
    function renderAllTelemetryGraphs() {
        renderDeltaGraph();
        renderSpeedGraph();
        renderPedalsGraph();
    }

    // 1. Delta Time Graph ($\Delta t$)
    function renderDeltaGraph() {
        const canvas = DOM.deltaGraphCanvas;
        if (!canvas || GhostState.alignedData.length === 0) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const width = rect.width;
        const height = rect.height;
        const data = GhostState.alignedData;

        ctx.clearRect(0, 0, width, height);

        // Find min/max delta
        let maxDelta = 1000; // at least 1s scale
        let minDelta = -1000;
        data.forEach(p => {
            if (p.deltaMs > maxDelta) maxDelta = p.deltaMs;
            if (p.deltaMs < minDelta) minDelta = p.deltaMs;
        });

        const absMax = Math.max(Math.abs(maxDelta), Math.abs(minDelta), 500);
        const zeroY = height / 2;

        // Zero reference line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, zeroY);
        ctx.lineTo(width, zeroY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Fill areas above and below zero
        // Above zero = Driver A faster (Green / Cyan)
        // Below zero = Driver B faster (Orange / Red)
        ctx.beginPath();
        ctx.moveTo(0, zeroY);
        data.forEach((p, idx) => {
            const x = (p.d / GhostState.maxDistance) * width;
            const y = zeroY - (p.deltaMs / absMax) * (height / 2 - 10);
            ctx.lineTo(x, y);
        });
        ctx.lineTo(width, zeroY);
        ctx.closePath();

        const grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, 'rgba(0, 210, 190, 0.35)');
        grad.addColorStop(0.5, 'rgba(0, 210, 190, 0.05)');
        grad.addColorStop(0.51, 'rgba(255, 128, 0, 0.05)');
        grad.addColorStop(1, 'rgba(255, 128, 0, 0.35)');
        ctx.fillStyle = grad;
        ctx.fill();

        // Stroke Delta Line
        ctx.beginPath();
        data.forEach((p, idx) => {
            const x = (p.d / GhostState.maxDistance) * width;
            const y = zeroY - (p.deltaMs / absMax) * (height / 2 - 10);
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = 'rgba(0, 240, 255, 0.6)';
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Draw cursor needle
        drawGraphCursor(ctx, width, height, GhostState.currentDistance);
    }

    // 2. Speed Comparison Graph (km/h)
    function renderSpeedGraph() {
        const canvas = DOM.speedGraphCanvas;
        if (!canvas || GhostState.alignedData.length === 0) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const width = rect.width;
        const height = rect.height;
        const data = GhostState.alignedData;

        ctx.clearRect(0, 0, width, height);

        const maxSpeed = 360;

        // Grid lines (100, 200, 300 km/h)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        [100, 200, 300].forEach(spd => {
            const y = height - (spd / maxSpeed) * height;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        });

        // Driver A Speed Line
        ctx.beginPath();
        data.forEach((p, idx) => {
            const x = (p.d / GhostState.maxDistance) * width;
            const y = height - (p.speedA / maxSpeed) * (height - 10);
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--driver-a-color').trim() || '#00d2be';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Driver B Speed Line
        ctx.beginPath();
        data.forEach((p, idx) => {
            const x = (p.d / GhostState.maxDistance) * width;
            const y = height - (p.speedB / maxSpeed) * (height - 10);
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--driver-b-color').trim() || '#ff8000';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw cursor needle
        drawGraphCursor(ctx, width, height, GhostState.currentDistance);
    }

    // 3. Pedals Comparison Graph (Throttle & Brake %)
    function renderPedalsGraph() {
        const canvas = DOM.pedalsGraphCanvas;
        if (!canvas || GhostState.alignedData.length === 0) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const width = rect.width;
        const height = rect.height;
        const data = GhostState.alignedData;

        ctx.clearRect(0, 0, width, height);

        // Throttle (Top half, 0-100%)
        // Driver A Throttle
        ctx.beginPath();
        data.forEach((p, idx) => {
            const x = (p.d / GhostState.maxDistance) * width;
            const y = (height / 2) - ((p.thrA / 100) * (height / 2 - 4));
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Driver B Throttle
        ctx.beginPath();
        data.forEach((p, idx) => {
            const x = (p.d / GhostState.maxDistance) * width;
            const y = (height / 2) - ((p.thrB / 100) * (height / 2 - 4));
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = '#eab308';
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Brake (Bottom half, 0-100%)
        // Driver A Brake
        ctx.beginPath();
        data.forEach((p, idx) => {
            const x = (p.d / GhostState.maxDistance) * width;
            const y = (height / 2) + ((p.brkA / 100) * (height / 2 - 4));
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Driver B Brake
        ctx.beginPath();
        data.forEach((p, idx) => {
            const x = (p.d / GhostState.maxDistance) * width;
            const y = (height / 2) + ((p.brkB / 100) * (height / 2 - 4));
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Center split line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        // Draw cursor needle
        drawGraphCursor(ctx, width, height, GhostState.currentDistance);
    }

    function drawGraphCursor(ctx, width, height, dist) {
        if (!dist && dist !== 0) return;
        const x = (dist / GhostState.maxDistance) * width;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();

        ctx.fillStyle = '#00f0ff';
        ctx.beginPath();
        ctx.arc(x, 4, 3.5, 0, Math.PI * 2);
        ctx.fill();
    }

    // --- Interactive 2D Circuit Map & Ghost Car Canvas Engine ---
    function renderCircuitMap() {
        const canvas = DOM.circuitMapCanvas;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();

        if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
        }
        ctx.resetTransform();
        ctx.scale(dpr, dpr);

        const width = rect.width;
        const height = rect.height;
        ctx.clearRect(0, 0, width, height);

        const pts = GhostState.trackPoints || [];

        // If no track points yet, draw a placeholder grid or circuit outline
        if (pts.length < 5) {
            drawEmptyTrackPrompt(ctx, width, height);
            return;
        }

        // 1. Calculate Bounds and Scaling
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        pts.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.z < minZ) minZ = p.z;
            if (p.z > maxZ) maxZ = p.z;
        });

        const trackW = maxX - minX || 100;
        const trackH = maxZ - minZ || 100;
        const padding = 60;
        const scale = Math.min((width - padding * 2) / trackW, (height - padding * 2) / trackH);
        const offsetX = (width - trackW * scale) / 2 - minX * scale;
        const offsetZ = (height - trackH * scale) / 2 - minZ * scale;

        function toScreen(x, z) {
            return {
                x: x * scale + offsetX,
                y: z * scale + offsetZ
            };
        }

        // 2. Draw Circuit Glow / Shadow Track Line
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        ctx.beginPath();
        pts.forEach((p, idx) => {
            const pt = toScreen(p.x, p.z);
            if (idx === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
        });
        ctx.closePath();
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.12)';
        ctx.lineWidth = 14;
        ctx.stroke();

        // 3. Draw Asphalt Track Body
        ctx.beginPath();
        pts.forEach((p, idx) => {
            const pt = toScreen(p.x, p.z);
            if (idx === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
        });
        ctx.closePath();
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 8;
        ctx.stroke();

        // 4. Draw Inner Racing Line Trace
        ctx.beginPath();
        pts.forEach((p, idx) => {
            const pt = toScreen(p.x, p.z);
            if (idx === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
        });
        ctx.closePath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 5. Draw Start/Finish Line & Sector Beacons
        if (GhostState.startLine) {
            const startPt = toScreen(GhostState.startLine.x, GhostState.startLine.z);
            drawBeaconMarker(ctx, startPt.x, startPt.y, '#ffffff', 'START / FINISH');
        } else if (pts.length > 0) {
            const startPt = toScreen(pts[0].x, pts[0].z);
            drawBeaconMarker(ctx, startPt.x, startPt.y, '#ffffff', 'S/F');
        }

        if (GhostState.sector1) {
            const s1Pt = toScreen(GhostState.sector1.x, GhostState.sector1.z);
            drawBeaconMarker(ctx, s1Pt.x, s1Pt.y, '#eab308', 'SECTOR 1');
        }
        if (GhostState.sector2) {
            const s2Pt = toScreen(GhostState.sector2.x, GhostState.sector2.z);
            drawBeaconMarker(ctx, s2Pt.x, s2Pt.y, '#c084fc', 'SECTOR 2');
        }

        // 6. Draw Both Ghost Cars at Current Playback Distance
        if (GhostState.alignedData.length > 0) {
            const currentPt = getTelemetrySampleAtDistance(GhostState.currentDistance);
            if (currentPt) {
                const posA = toScreen(currentPt.posA.x, currentPt.posA.z);
                const posB = toScreen(currentPt.posB.x, currentPt.posB.z);

                const colA = getComputedStyle(document.documentElement).getPropertyValue('--driver-a-color').trim() || '#00d2be';
                const colB = getComputedStyle(document.documentElement).getPropertyValue('--driver-b-color').trim() || '#ff8000';

                // Connecting Distance Proximity Line between Ghost A and Ghost B
                ctx.beginPath();
                ctx.moveTo(posA.x, posA.y);
                ctx.lineTo(posB.x, posB.y);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.setLineDash([3, 3]);
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.setLineDash([]);

                // Draw Ghost Car A
                drawGhostCar(ctx, posA.x, posA.y, currentPt.posA.yaw, colA, GhostState.driverA?.driverName || 'CAR A', currentPt.speedA, true);

                // Draw Ghost Car B
                drawGhostCar(ctx, posB.x, posB.y, currentPt.posB.yaw, colB, GhostState.driverB?.driverName || 'CAR B', currentPt.speedB, false);
            }
        }
    }

    function drawBeaconMarker(ctx, x, y, color, label) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '700 9px Titillium Web, sans-serif';
        ctx.fillText(label, x + 7, y + 3);
    }

    function drawGhostCar(ctx, x, y, yaw, color, name, speed, isA) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((yaw || 0) + Math.PI / 2); // Rotate to heading

        // Glowing Halo
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;

        // Car Body (F1 Arrow / Formula Silhouette)
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, -12);
        ctx.lineTo(6, 8);
        ctx.lineTo(0, 5);
        ctx.lineTo(-6, 8);
        ctx.closePath();
        ctx.fill();

        // Front Wing
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-8, -13, 16, 2.5);

        // Rear Wing
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-7, 7, 14, 2.5);

        ctx.restore();

        // Tag label
        ctx.fillStyle = color;
        ctx.font = '800 10px Roboto Mono, monospace';
        const tag = name.split(' ')[0].toUpperCase();
        ctx.fillText(`${tag} (${Math.round(speed || 0)}k)`, x + 10, isA ? y - 10 : y + 14);
    }

    function drawEmptyTrackPrompt(ctx, width, height) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '700 14px Titillium Web, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Loading Circuit Geometry & Fastest Lap Traces...', width / 2, height / 2);
    }

    // --- Playback Controller & Scrubber Engine ---
    function updatePlaybackPosition(dist, updateSlider = true) {
        dist = Math.max(0, Math.min(dist, GhostState.maxDistance || 5000));
        GhostState.currentDistance = dist;

        if (updateSlider && DOM.timelineSlider) {
            DOM.timelineSlider.value = Math.round(dist);
        }

        const sample = getTelemetrySampleAtDistance(dist);
        if (sample) {
            GhostState.currentTimeMs = sample.timeA;

            if (DOM.timelineTime) {
                DOM.timelineTime.innerText = formatMs(sample.timeA);
            }
            if (DOM.hudTrackDist) {
                DOM.hudTrackDist.innerText = `${Math.round(dist)}m / ${Math.round(GhostState.maxDistance)}m`;
            }
            if (DOM.hudLiveDelta) {
                DOM.hudLiveDelta.innerText = formatDeltaSec(sample.deltaMs);
                DOM.hudLiveDelta.style.color = sample.deltaMs > 0 ? 'var(--driver-a-color)' : 'var(--driver-b-color)';
            }

            // Update Live Dashboard Gauges
            if (DOM.gaugeSpeedA) DOM.gaugeSpeedA.innerText = Math.round(sample.speedA || 0);
            if (DOM.gaugeSpeedB) DOM.gaugeSpeedB.innerText = Math.round(sample.speedB || 0);
            if (DOM.gaugeGearA) DOM.gaugeGearA.innerText = sample.gearA || 'N';
            if (DOM.gaugeGearB) DOM.gaugeGearB.innerText = sample.gearB || 'N';

            if (DOM.gaugeThrValA) DOM.gaugeThrValA.innerText = `${Math.round(sample.thrA || 0)}%`;
            if (DOM.gaugeThrValB) DOM.gaugeThrValB.innerText = `${Math.round(sample.thrB || 0)}%`;
            if (DOM.gaugeBrkValA) DOM.gaugeBrkValA.innerText = `${Math.round(sample.brkA || 0)}%`;
            if (DOM.gaugeBrkValB) DOM.gaugeBrkValB.innerText = `${Math.round(sample.brkB || 0)}%`;

            if (DOM.gaugeThrBarA) DOM.gaugeThrBarA.style.width = `${Math.round(sample.thrA || 0)}%`;
            if (DOM.gaugeThrBarB) DOM.gaugeThrBarB.style.width = `${Math.round(sample.thrB || 0)}%`;
            if (DOM.gaugeBrkBarA) DOM.gaugeBrkBarA.style.width = `${Math.round(sample.brkA || 0)}%`;
            if (DOM.gaugeBrkBarB) DOM.gaugeBrkBarB.style.width = `${Math.round(sample.brkB || 0)}%`;

            // Instant Gap Readouts
            if (DOM.instantGapVal) {
                DOM.instantGapVal.innerText = formatDeltaSec(sample.deltaMs);
                DOM.instantGapVal.style.color = sample.deltaMs > 0 ? 'var(--driver-a-color)' : 'var(--driver-b-color)';
            }
            if (DOM.instantDistVal) {
                // Gap in meters $\approx \Delta t \times \text{speed}$
                const avgSpeedMs = Math.max(10, ((sample.speedA + sample.speedB) / 2) / 3.6);
                const distDiff = (sample.deltaMs / 1000) * avgSpeedMs;
                DOM.instantDistVal.innerText = `${distDiff > 0 ? '+' : ''}${distDiff.toFixed(1)} meters gap`;
            }
        }

        // Render Canvas updates
        renderCircuitMap();
        renderAllTelemetryGraphs();
    }

    function getTelemetrySampleAtDistance(dist) {
        const data = GhostState.alignedData;
        if (!data || data.length === 0) return null;
        let idx = data.findIndex(p => p.d >= dist);
        if (idx < 0) idx = data.length - 1;
        return data[idx];
    }

    // --- Animation Loop ---
    function animationLoop(timestamp) {
        if (!GhostState.lastAnimTime) GhostState.lastAnimTime = timestamp;
        const dt = (timestamp - GhostState.lastAnimTime) / 1000;
        GhostState.lastAnimTime = timestamp;

        if (GhostState.isPlaying && !GhostState.isDraggingScrubber && !GhostState.isLiveSync) {
            const currentSample = getTelemetrySampleAtDistance(GhostState.currentDistance);
            const currentSpeedKmh = currentSample ? (currentSample.speedA || 200) : 200;
            const speedMps = (currentSpeedKmh / 3.6) * GhostState.playbackSpeed;

            let nextDist = GhostState.currentDistance + (speedMps * dt);

            if (nextDist >= GhostState.maxDistance) {
                if (GhostState.isLooping) {
                    nextDist = 0;
                } else {
                    nextDist = GhostState.maxDistance;
                    togglePlayPause(false);
                }
            }

            updatePlaybackPosition(nextDist, true);
        }

        requestAnimationFrame(animationLoop);
    }

    function togglePlayPause(play) {
        GhostState.isPlaying = play !== undefined ? play : !GhostState.isPlaying;
        if (DOM.btnPlayPause) {
            DOM.btnPlayPause.innerHTML = GhostState.isPlaying
                ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> PAUSE`
                : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> PLAY`;
        }
    }

    // --- Demo & Benchmark Lap Generator ---
    function setupDemoDrivers() {
        showToast('Loading benchmark telemetry comparison dataset...');

        // Fetch sample recorded track telemetry from server disk
        const targetTrack = GhostState.currentTrackId !== -1 ? GhostState.currentTrackId : 4; // Default to Track 4 (Bahrain / Spain)

        fetch(`/api/telemetry-tracks`)
            .then(r => r.json())
            .then(trackRes => {
                const tracks = trackRes.tracks || [];
                const validTrack = tracks.find(t => t.hasTelemetry) || { id: targetTrack };
                loadSampleTelemetryForTrack(validTrack.id);
            })
            .catch(() => {
                loadSampleTelemetryForTrack(4);
            });
    }

    function loadSampleTelemetryForTrack(trackId) {
        fetchTrackData(trackId);

        // Fetch base telemetry
        fetch(`/telemetry/telemetry_${trackId}.json`)
            .then(r => r.json())
            .then(rawTelemetry => {
                if (!Array.isArray(rawTelemetry) || rawTelemetry.length < 50) return;

                // Create Benchmark Driver A (e.g. Max Verstappen - Red Bull Racing)
                const telA = rawTelemetry.map(p => ({
                    d: p.d,
                    t: p.t,
                    speed: p.speed,
                    throttle: p.throttle,
                    brake: p.brake,
                    gear: p.gear,
                    drs: p.drs,
                    x: p.x,
                    z: p.z,
                    yaw: p.yaw
                }));

                const totalTimeA = telA[telA.length - 1].t;

                // Create Benchmark Driver B (e.g. Lewis Hamilton - Mercedes with realistic cornering variance)
                const telB = rawTelemetry.map((p, idx) => {
                    // Introduce realistic telemetry variance (Hamilton carries +3km/h in fast corners, brakes 5m earlier)
                    const isCorner = p.speed < 240;
                    const speedVariance = isCorner ? (Math.sin(idx / 10) * 4 + 1.5) : (Math.cos(idx / 15) * 3 - 2);
                    const speedB = Math.max(50, Math.min(350, Math.round(p.speed + speedVariance)));
                    const timeLag = Math.round(p.t * (1 + (Math.sin(idx / 30) * 0.006 + 0.003))); // ~0.2-0.3s lap delta

                    return {
                        d: p.d,
                        t: timeLag,
                        speed: speedB,
                        throttle: p.throttle > 80 ? Math.min(100, p.throttle + 2) : p.throttle,
                        brake: p.brake,
                        gear: p.gear,
                        drs: p.drs,
                        x: p.x + (Math.cos(p.yaw || 0) * 0.8), // slight racing line difference
                        z: p.z + (Math.sin(p.yaw || 0) * 0.8),
                        yaw: p.yaw
                    };
                });

                const totalTimeB = telB[telB.length - 1].t;

                const demoDriverA = {
                    carIndex: 0,
                    driverName: 'Max VERSTAPPEN',
                    teamName: 'Red Bull Racing',
                    teamColor: '#3671C6',
                    lapTimeMs: totalTimeA,
                    s1: Math.round(totalTimeA * 0.32),
                    s2: Math.round(totalTimeA * 0.38),
                    s3: Math.round(totalTimeA * 0.30),
                    telemetry: telA
                };

                const demoDriverB = {
                    carIndex: 1,
                    driverName: 'Lewis HAMILTON',
                    teamName: 'Mercedes-AMG',
                    teamColor: '#27F4D2',
                    lapTimeMs: totalTimeB,
                    s1: Math.round(totalTimeB * 0.322),
                    s2: Math.round(totalTimeB * 0.378),
                    s3: Math.round(totalTimeB * 0.30),
                    telemetry: telB
                };

                GhostState.availableDrivers = [demoDriverA, demoDriverB];
                populateDriverDropdowns();

                setDriverData('A', demoDriverA);
                setDriverData('B', demoDriverB);
                recalculateAlignedComparison();

                showToast('Ghost telemetry comparison loaded successfully!');
            })
            .catch(err => {
                console.error('Error loading sample telemetry:', err);
            });
    }

    // --- Fetch Track Data & Populate Circuit Select ---
    function fetchAvailableTracksList() {
        fetch('/api/telemetry-tracks')
            .then(r => r.json())
            .then(res => {
                if (res.tracks && Array.isArray(res.tracks)) {
                    if (DOM.circuitSelect) {
                        const currentVal = DOM.circuitSelect.value;
                        DOM.circuitSelect.innerHTML = '';
                        res.tracks.forEach(t => {
                            const opt = document.createElement('option');
                            opt.value = t.id;
                            const tag = t.hasSessionDriverLaps ? ' [SAVED LAPS]' : (t.hasTelemetry ? ' [JSON TRACE]' : '');
                            opt.text = `${t.name} (Track ${t.id})${tag}`;
                            DOM.circuitSelect.appendChild(opt);
                        });
                        if (currentVal !== '' && res.tracks.some(t => String(t.id) === String(currentVal))) {
                            DOM.circuitSelect.value = currentVal;
                        } else if (res.tracks.length > 0) {
                            const first = res.tracks[0].id;
                            DOM.circuitSelect.value = first;
                            switchManualTrack(first);
                        }
                    }
                }
            })
            .catch(err => console.warn('Could not fetch tracks list:', err));
    }

    function switchManualTrack(trackId) {
        const tId = parseInt(trackId, 10);
        if (isNaN(tId) || tId === -1) return;
        GhostState.currentTrackId = tId;
        if (DOM.circuitSelect) DOM.circuitSelect.value = tId;
        fetchTrackData(tId);

        // Fetch stored JSON driver laps for this manually selected track
        fetch(`/api/session/driver-fastest-laps?trackId=${tId}`)
            .then(r => r.json())
            .then(res => {
                if (res.laps && Array.isArray(res.laps) && res.laps.length > 0) {
                    updateAvailableDriversList(res.laps);
                } else {
                    updateAvailableDriversList([]);
                }
            })
            .catch(() => {
                updateAvailableDriversList([]);
            });
    }

    function fetchTrackData(trackId) {
        fetch(`/track_maps/track_${trackId}.json`)
            .then(r => r.json())
            .then(tData => {
                const pts = Array.isArray(tData) ? tData : (tData.trackPoints || []);
                GhostState.trackPoints = pts;
                GhostState.startLine = tData.startLine || null;
                GhostState.sector1 = tData.sector1 || null;
                GhostState.sector2 = tData.sector2 || null;
                GhostState.drsZones = tData.drsZones || [];
                renderCircuitMap();
            })
            .catch(err => console.warn('Could not load track map file:', err));
    }

    function fallbackFetchTracksAndLaps() {
        fetchAvailableTracksList();
    }

    // --- Setup Event Listeners ---
    function setupEventListeners() {
        if (DOM.circuitSelect) {
            DOM.circuitSelect.addEventListener('change', (e) => {
                switchManualTrack(e.target.value);
            });
        }

        if (DOM.driverASelect) {
            DOM.driverASelect.addEventListener('change', (e) => {
                onDriverASelected(e.target.value);
            });
        }

        if (DOM.driverBSelect) {
            DOM.driverBSelect.addEventListener('change', (e) => {
                onDriverBSelected(e.target.value);
            });
        }

        if (DOM.btnPlayPause) {
            DOM.btnPlayPause.addEventListener('click', () => togglePlayPause());
        }

        if (DOM.btnRestart) {
            DOM.btnRestart.addEventListener('click', () => {
                updatePlaybackPosition(0, true);
            });
        }

        if (DOM.btnLoop) {
            DOM.btnLoop.addEventListener('click', () => {
                GhostState.isLooping = !GhostState.isLooping;
                DOM.btnLoop.classList.toggle('active', GhostState.isLooping);
                showToast(GhostState.isLooping ? 'Playback Loop Enabled' : 'Playback Loop Disabled');
            });
        }

        if (DOM.btnLiveSync) {
            DOM.btnLiveSync.addEventListener('click', () => {
                GhostState.isLiveSync = !GhostState.isLiveSync;
                DOM.btnLiveSync.classList.toggle('active', GhostState.isLiveSync);
                showToast(GhostState.isLiveSync ? 'Live Car Track Lock Engaged' : 'Live Car Track Lock Disengaged');
            });
        }

        if (DOM.btnDetectLive) {
            DOM.btnDetectLive.addEventListener('click', () => {
                fetch('/api/session-data')
                    .then(r => r.json())
                    .then(data => {
                        if (data.metadata && data.metadata.trackId !== undefined && data.metadata.trackId !== -1) {
                            showToast(`Switched to Live Game Track: ${data.metadata.trackName}`);
                            switchManualTrack(data.metadata.trackId);
                        } else {
                            showToast('No active game session detected on track');
                        }
                    })
                    .catch(() => {
                        showToast('Could not detect live game track');
                    });
            });
        }

        if (DOM.btnDemo) {
            DOM.btnDemo.addEventListener('click', () => {
                setupDemoDrivers();
            });
        }

        if (DOM.btnRefresh) {
            DOM.btnRefresh.addEventListener('click', () => {
                if (GhostState.ws && GhostState.ws.readyState === WebSocket.OPEN) {
                    GhostState.ws.send(JSON.stringify({ action: 'getSessionDriverFastestLaps', trackId: GhostState.currentTrackId }));
                }
                switchManualTrack(GhostState.currentTrackId);
                showToast('Refreshing session laps for current circuit...');
            });
        }

        // Speed Multipliers
        DOM.speedButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                DOM.speedButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                GhostState.playbackSpeed = parseFloat(btn.dataset.speed || 1.0);
            });
        });

        // Timeline Scrubber Slider Dragging
        if (DOM.timelineSlider) {
            DOM.timelineSlider.addEventListener('input', (e) => {
                GhostState.isDraggingScrubber = true;
                updatePlaybackPosition(parseFloat(e.target.value), false);
            });
            DOM.timelineSlider.addEventListener('change', (e) => {
                GhostState.isDraggingScrubber = false;
                updatePlaybackPosition(parseFloat(e.target.value), true);
            });
        }

        // Click-to-Scrub on Circuit Map Canvas
        if (DOM.circuitMapCanvas) {
            DOM.circuitMapCanvas.addEventListener('click', (e) => {
                handleCircuitCanvasClick(e);
            });
        }

        // Telemetry Chart Hover & Scrub
        setupChartHover(DOM.deltaGraphCanvas);
        setupChartHover(DOM.speedGraphCanvas);
        setupChartHover(DOM.pedalsGraphCanvas);

        // Keyboard Shortcuts
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                togglePlayPause();
            } else if (e.code === 'ArrowRight') {
                updatePlaybackPosition(GhostState.currentDistance + 100, true);
            } else if (e.code === 'ArrowLeft') {
                updatePlaybackPosition(GhostState.currentDistance - 100, true);
            }
        });

        // Window resize observer
        window.addEventListener('resize', () => {
            renderCircuitMap();
            renderAllTelemetryGraphs();
        });
    }

    function setupChartHover(canvas) {
        if (!canvas) return;
        canvas.addEventListener('click', (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const ratio = Math.max(0, Math.min(1, x / rect.width));
            const targetDist = ratio * GhostState.maxDistance;
            updatePlaybackPosition(targetDist, true);
        });
    }

    function handleCircuitCanvasClick(e) {
        const canvas = DOM.circuitMapCanvas;
        const rect = canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        const pts = GhostState.trackPoints || [];
        if (pts.length < 5) return;

        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        pts.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.z < minZ) minZ = p.z;
            if (p.z > maxZ) maxZ = p.z;
        });

        const trackW = maxX - minX || 100;
        const trackH = maxZ - minZ || 100;
        const padding = 60;
        const scale = Math.min((rect.width - padding * 2) / trackW, (rect.height - padding * 2) / trackH);
        const offsetX = (rect.width - trackW * scale) / 2 - minX * scale;
        const offsetZ = (rect.height - trackH * scale) / 2 - minZ * scale;

        // Find closest point to click
        let closestIdx = 0;
        let closestDist = Infinity;

        pts.forEach((p, idx) => {
            const sx = p.x * scale + offsetX;
            const sy = p.z * scale + offsetZ;
            const d = Math.hypot(sx - clickX, sy - clickY);
            if (d < closestDist) {
                closestDist = d;
                closestIdx = idx;
            }
        });

        if (closestDist < 45) {
            const ratio = closestIdx / pts.length;
            const targetDist = ratio * GhostState.maxDistance;
            updatePlaybackPosition(targetDist, true);
        }
    }

    // --- Initialization Entry Point ---
    document.addEventListener('DOMContentLoaded', () => {
        initDOMElements();
        setupEventListeners();
        initWebSocket();
        fetchAvailableTracksList();
        requestAnimationFrame(animationLoop);
    });

})();
