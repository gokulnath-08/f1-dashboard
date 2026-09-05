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

        // 3D Three.js Visualization Engine State
        three: {
            renderer: null,
            scene: null,
            camera: null,
            container: null,
            trackMeshGroup: null,
            carMeshGroupA: null,
            carMeshGroupB: null,
            deltaLaserBeam: null,
            deltaBadgeSprite: null,
            trailMeshA: null,
            trailMeshB: null,
            gridHelper: null,
            lights: {}
        },
        cameraMode: 'chaseA', // 'chaseA' | 'chaseB' | 'battle' | 'cockpitA' | 'orbit' | 'topDown'
        orbitControls: {
            isDragging: false,
            isPanning: false,
            lastMouseX: 0,
            lastMouseY: 0,
            spherical: { radius: 180, theta: 0.8, phi: 0.85 },
            target: { x: 0, y: 0, z: 0 }
        },
        viewOptions: {
            isGhostTranslucent: true,
            showDeltaBeam: true,
            showApexTrail: true,
            isFullscreen: false
        },

        // Session Telemetry Recording Control
        isRecordingSession: false,
        recordingStartTime: 0,
        recordingTimerInterval: null,

        // Hover & Scrubbing State
        isDraggingScrubber: false,
        hoverDistance: null,

        // Telemetry Graphs Canvases
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
        DOM.btnRecordingToggle = document.getElementById('btnRecordingToggle');
        DOM.recBtnLabel = document.getElementById('recBtnLabel');
        DOM.recTimer = document.getElementById('recTimer');

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

        // 3D Viewport Elements
        DOM.circuitViewportCard = document.getElementById('circuitViewportCard');
        DOM.circuit3dContainer = document.getElementById('circuit3dContainer');
        DOM.hudTrackDist = document.getElementById('hudTrackDist');
        DOM.hudCamLabel = document.getElementById('hudCamLabel');
        DOM.hudSpeedDelta = document.getElementById('hudSpeedDelta');
        DOM.btnFullscreen3D = document.getElementById('btnFullscreen3D');

        // 3D Live Delta HUD Banner
        DOM.viewportLiveDeltaHud = document.getElementById('viewportLiveDeltaHud');
        DOM.vDeltaBadge = document.getElementById('vDeltaBadge');
        DOM.vDeltaDist = document.getElementById('vDeltaDist');
        DOM.vMeterFillA = document.getElementById('vMeterFillA');
        DOM.vMeterFillB = document.getElementById('vMeterFillB');
        DOM.vDeltaNameA = document.getElementById('vDeltaNameA');
        DOM.vDeltaNameB = document.getElementById('vDeltaNameB');

        // 3D Camera & Viewport Controls
        DOM.camModeBtns = document.querySelectorAll('.cam-mode-btn');
        DOM.btnToggleGhostStyle = document.getElementById('btnToggleGhostStyle');
        DOM.btnToggleDeltaBeam = document.getElementById('btnToggleDeltaBeam');
        DOM.btnToggleApexTrail = document.getElementById('btnToggleApexTrail');
        DOM.btnResetCam = document.getElementById('btnResetCam');

        DOM.legendCarAName = document.getElementById('legendCarAName');
        DOM.legendCarBName = document.getElementById('legendCarBName');

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
                
                // Request available tracks, session recording status and session driver fastest laps
                GhostState.ws.send(JSON.stringify({ action: 'getAvailableTracks' }));
                GhostState.ws.send(JSON.stringify({ action: 'getSessionRecordingStatus' }));
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

    // --- Session Recording State Controller ---
    function applyRecordingState(isRecording, startTime) {
        GhostState.isRecordingSession = !!isRecording;
        GhostState.recordingStartTime = startTime || (isRecording ? Date.now() : 0);

        if (GhostState.recordingTimerInterval) {
            clearInterval(GhostState.recordingTimerInterval);
            GhostState.recordingTimerInterval = null;
        }

        if (DOM.btnRecordingToggle) {
            DOM.btnRecordingToggle.classList.toggle('recording', GhostState.isRecordingSession);
            if (DOM.recBtnLabel) {
                DOM.recBtnLabel.innerText = GhostState.isRecordingSession ? 'STOP REC' : 'START REC';
            }
            if (DOM.recTimer) {
                DOM.recTimer.style.display = GhostState.isRecordingSession ? 'inline-block' : 'none';
                if (GhostState.isRecordingSession) {
                    updateRecTimerDisplay();
                    GhostState.recordingTimerInterval = setInterval(updateRecTimerDisplay, 1000);
                }
            }
        }
    }

    function updateRecTimerDisplay() {
        if (!DOM.recTimer || !GhostState.recordingStartTime) return;
        const elapsedSec = Math.floor((Date.now() - GhostState.recordingStartTime) / 1000);
        const mins = Math.floor(elapsedSec / 60);
        const secs = elapsedSec % 60;
        DOM.recTimer.innerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
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

        // 7. Session Recording State Event
        if (msg.type === 'sessionRecordingState') {
            applyRecordingState(msg.isRecording, msg.startTime);
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
            if (DOM.vDeltaNameA) DOM.vDeltaNameA.innerText = (data.driverName || 'A').split(' ')[0].toUpperCase();
            if (DOM.legendCarAName) DOM.legendCarAName.innerText = data.driverName || 'Ghost Car A';
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
            if (DOM.vDeltaNameB) DOM.vDeltaNameB.innerText = (data.driverName || 'B').split(' ')[0].toUpperCase();
            if (DOM.legendCarBName) DOM.legendCarBName.innerText = data.driverName || 'Ghost Car B';
        }

        // Rebuild 3D cars with updated liveries & names
        setupOrUpdate3DCars();

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

    // ═════════════════════════════════════════════════════════════════════════
    // THREE.JS 3D VISUALIZATION ENGINE & REAL-TIME GHOST REPLAY
    // ═════════════════════════════════════════════════════════════════════════

    function initThreeEngine() {
        if (typeof THREE === 'undefined') {
            console.error('Three.js library is not loaded');
            return;
        }

        const container = DOM.circuit3dContainer;
        if (!container) return;

        const width = container.clientWidth || 800;
        const height = container.clientHeight || 500;

        // 1. WebGL Renderer
        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance'
        });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;

        container.innerHTML = '';
        container.appendChild(renderer.domElement);
        GhostState.three.renderer = renderer;
        GhostState.three.container = container;

        // 2. Scene & Fog
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x060911);
        scene.fog = new THREE.FogExp2(0x060911, 0.00055);
        GhostState.three.scene = scene;

        // 3. Camera
        const camera = new THREE.PerspectiveCamera(52, width / height, 0.5, 35000);
        camera.position.set(0, 140, 220);
        GhostState.three.camera = camera;

        // 4. Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
        scene.add(ambientLight);

        const sunLight = new THREE.DirectionalLight(0xffffff, 1.35);
        sunLight.position.set(200, 500, 250);
        sunLight.castShadow = true;
        scene.add(sunLight);

        const rimLight = new THREE.DirectionalLight(0x00e5ff, 0.55);
        rimLight.position.set(-250, 180, -250);
        scene.add(rimLight);

        const fillLight = new THREE.DirectionalLight(0x8899bb, 0.4);
        fillLight.position.set(0, -100, 0);
        scene.add(fillLight);

        GhostState.three.lights = { ambientLight, sunLight, rimLight };

        // 5. Futuristic Sci-Fi Ground Telemetry Grid
        const gridHelper = new THREE.GridHelper(30000, 300, 0x00f0ff, 0x111e30);
        gridHelper.position.y = -0.6;
        gridHelper.material.opacity = 0.35;
        gridHelper.material.transparent = true;
        scene.add(gridHelper);
        GhostState.three.gridHelper = gridHelper;

        // 6. Track Mesh Group
        const trackMeshGroup = new THREE.Group();
        scene.add(trackMeshGroup);
        GhostState.three.trackMeshGroup = trackMeshGroup;

        // 7. Dynamic 3D Live Delta Laser Beam between Car A and Car B
        initDeltaLaserBeam();

        // 8. Apex Racing Line Trails
        initApexTrails();

        // 9. Interactive Orbit Controls & Raycaster
        init3DInteractionControls();

        // 10. Initial Track Build
        if (GhostState.trackPoints && GhostState.trackPoints.length > 5) {
            build3DTrackMesh();
        }

        // 11. Initial Cars Build
        setupOrUpdate3DCars();
    }

    // --- Interactive Orbit & Track Click Controls ---
    function init3DInteractionControls() {
        const container = GhostState.three.container;
        if (!container) return;

        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        let clickStartTime = 0;
        let startClientX = 0;
        let startClientY = 0;

        container.addEventListener('mousedown', (e) => {
            clickStartTime = Date.now();
            startClientX = e.clientX;
            startClientY = e.clientY;

            GhostState.orbitControls.isDragging = true;
            GhostState.orbitControls.isPanning = (e.button === 2 || e.shiftKey);
            GhostState.orbitControls.lastMouseX = e.clientX;
            GhostState.orbitControls.lastMouseY = e.clientY;
        });

        window.addEventListener('mousemove', (e) => {
            if (!GhostState.orbitControls.isDragging) return;

            const dx = e.clientX - GhostState.orbitControls.lastMouseX;
            const dy = e.clientY - GhostState.orbitControls.lastMouseY;
            GhostState.orbitControls.lastMouseX = e.clientX;
            GhostState.orbitControls.lastMouseY = e.clientY;

            if (GhostState.orbitControls.isPanning) {
                // Pan target
                const panSpeed = 0.4 * (GhostState.orbitControls.spherical.radius / 200);
                const cam = GhostState.three.camera;
                const right = new THREE.Vector3().crossVectors(cam.getWorldDirection(new THREE.Vector3()), new THREE.Vector3(0, 1, 0)).normalize();
                GhostState.orbitControls.target.x -= (right.x * dx - cam.up.x * dy) * panSpeed;
                GhostState.orbitControls.target.z -= (right.z * dx - cam.up.z * dy) * panSpeed;
            } else {
                // Rotate orbit
                GhostState.orbitControls.spherical.theta -= dx * 0.006;
                GhostState.orbitControls.spherical.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, GhostState.orbitControls.spherical.phi - dy * 0.006));
                
                // If in automated chase cam, switch to orbit mode on manual drag
                if (GhostState.cameraMode !== 'orbit' && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
                    setCameraMode('orbit');
                }
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (!GhostState.orbitControls.isDragging) return;
            GhostState.orbitControls.isDragging = false;
            GhostState.orbitControls.isPanning = false;

            // Check if this was a quick click to jump scrubber on 3D track
            const clickDuration = Date.now() - clickStartTime;
            const movedDist = Math.hypot(e.clientX - startClientX, e.clientY - startClientY);

            if (clickDuration < 300 && movedDist < 6 && e.button === 0) {
                handle3DTrackClick(e);
            }
        });

        // Wheel Zoom
        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomDelta = e.deltaY * 0.25;
            GhostState.orbitControls.spherical.radius = Math.max(15, Math.min(2500, GhostState.orbitControls.spherical.radius + zoomDelta));
            if (GhostState.cameraMode !== 'orbit' && GhostState.cameraMode !== 'topDown') {
                setCameraMode('orbit');
            }
        }, { passive: false });

        // Context Menu prevent on right-drag
        container.addEventListener('contextmenu', (e) => e.preventDefault());

        // Touch support for mobile / tablets
        let lastTouchDist = 0;
        container.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                GhostState.orbitControls.isDragging = true;
                GhostState.orbitControls.lastMouseX = e.touches[0].clientX;
                GhostState.orbitControls.lastMouseY = e.touches[0].clientY;
            } else if (e.touches.length === 2) {
                lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            }
        }, { passive: true });

        container.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1 && GhostState.orbitControls.isDragging) {
                const dx = e.touches[0].clientX - GhostState.orbitControls.lastMouseX;
                const dy = e.touches[0].clientY - GhostState.orbitControls.lastMouseY;
                GhostState.orbitControls.lastMouseX = e.touches[0].clientX;
                GhostState.orbitControls.lastMouseY = e.touches[0].clientY;

                GhostState.orbitControls.spherical.theta -= dx * 0.007;
                GhostState.orbitControls.spherical.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, GhostState.orbitControls.spherical.phi - dy * 0.007));
                if (GhostState.cameraMode !== 'orbit') setCameraMode('orbit');
            } else if (e.touches.length === 2) {
                const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                const diff = lastTouchDist - dist;
                lastTouchDist = dist;
                GhostState.orbitControls.spherical.radius = Math.max(15, Math.min(2500, GhostState.orbitControls.spherical.radius + diff * 0.8));
            }
        }, { passive: true });

        container.addEventListener('touchend', () => {
            GhostState.orbitControls.isDragging = false;
        });

        function handle3DTrackClick(e) {
            const rect = container.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, GhostState.three.camera);
            const intersects = raycaster.intersectObjects(GhostState.three.trackMeshGroup.children, true);

            if (intersects.length > 0) {
                const hitPoint = intersects[0].point;
                // Find closest track distance
                const pts = GhostState.trackPoints || [];
                if (pts.length < 5) return;

                let closestIdx = 0;
                let minD = Infinity;
                pts.forEach((p, idx) => {
                    const d = Math.hypot(p.x - hitPoint.x, p.z - hitPoint.z);
                    if (d < minD) {
                        minD = d;
                        closestIdx = idx;
                    }
                });

                if (minD < 60) {
                    const ratio = closestIdx / pts.length;
                    const targetDist = ratio * GhostState.maxDistance;
                    updatePlaybackPosition(targetDist, true);
                    showToast(`Jumped to ${Math.round(targetDist)}m (${Math.round(ratio * 100)}% lap)`);
                }
            }
        }
    }

    // --- Procedural 3D Formula 1 Car Model Builder ---
    function setupOrUpdate3DCars() {
        const scene = GhostState.three.scene;
        if (!scene) return;

        // Clean up old car meshes
        if (GhostState.three.carMeshGroupA) scene.remove(GhostState.three.carMeshGroupA);
        if (GhostState.three.carMeshGroupB) scene.remove(GhostState.three.carMeshGroupB);

        const colA = getComputedStyle(document.documentElement).getPropertyValue('--driver-a-color').trim() || '#00d2be';
        const colB = getComputedStyle(document.documentElement).getPropertyValue('--driver-b-color').trim() || '#ff8000';

        const nameA = GhostState.driverA?.driverName || 'DRIVER A';
        const nameB = GhostState.driverB?.driverName || 'DRIVER B';

        // Build Car A
        const carA = createF1CarMesh(colA, nameA, true);
        scene.add(carA);
        GhostState.three.carMeshGroupA = carA;

        // Build Car B
        const carB = createF1CarMesh(colB, nameB, false);
        scene.add(carB);
        GhostState.three.carMeshGroupB = carB;
    }

    function createF1CarMesh(teamColorHex, driverName, isA) {
        const carRoot = new THREE.Group();
        carRoot.userData.isDriverA = isA;
        carRoot.userData.driverName = driverName;
        carRoot.userData.wheels = [];
        carRoot.userData.steerPivots = [];

        const teamCol = new THREE.Color(teamColorHex);
        const isGhost = GhostState.viewOptions.isGhostTranslucent;

        // Materials
        const carbonMat = new THREE.MeshStandardMaterial({
            color: 0x121418,
            metalness: 0.85,
            roughness: 0.25
        });

        const liveryMat = new THREE.MeshStandardMaterial({
            color: teamCol,
            metalness: 0.5,
            roughness: 0.2,
            emissive: teamCol,
            emissiveIntensity: isGhost ? 0.45 : 0.08,
            transparent: isGhost,
            opacity: isGhost ? 0.88 : 1.0
        });

        const accentGlowMat = new THREE.MeshBasicMaterial({
            color: teamCol,
            transparent: true,
            opacity: 0.95
        });

        const helmetMat = new THREE.MeshStandardMaterial({
            color: isA ? 0xef4444 : 0xeab308,
            metalness: 0.6,
            roughness: 0.2
        });

        const visorMat = new THREE.MeshStandardMaterial({
            color: 0x050505,
            metalness: 0.95,
            roughness: 0.05
        });

        const tireMat = new THREE.MeshStandardMaterial({
            color: 0x16171b,
            roughness: 0.8,
            metalness: 0.1
        });

        const rimMat = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            metalness: 0.9,
            roughness: 0.15
        });

        // 1. Monocoque / Main Chassis
        const chassisGeo = new THREE.BoxGeometry(0.9, 0.4, 2.2);
        const chassisMesh = new THREE.Mesh(chassisGeo, liveryMat);
        chassisMesh.position.set(0, 0.42, 0.2);
        chassisMesh.castShadow = true;
        carRoot.add(chassisMesh);

        // 2. Aerodynamic Nose Cone
        const noseGeo = new THREE.ConeGeometry(0.35, 1.8, 4);
        noseGeo.rotateX(-Math.PI / 2);
        const noseMesh = new THREE.Mesh(noseGeo, liveryMat);
        noseMesh.position.set(0, 0.32, 1.8);
        noseMesh.scale.set(1.1, 0.7, 1);
        noseMesh.castShadow = true;
        carRoot.add(noseMesh);

        // 3. Driver Cockpit & Helmet
        const cockpitGeo = new THREE.BoxGeometry(0.55, 0.1, 0.9);
        const cockpitMesh = new THREE.Mesh(cockpitGeo, carbonMat);
        cockpitMesh.position.set(0, 0.58, 0.2);
        carRoot.add(cockpitMesh);

        const helmetGeo = new THREE.SphereGeometry(0.2, 16, 16);
        const helmetMesh = new THREE.Mesh(helmetGeo, helmetMat);
        helmetMesh.position.set(0, 0.68, 0.15);
        helmetMesh.scale.set(0.9, 1.0, 1.0);
        carRoot.add(helmetMesh);

        const visorGeo = new THREE.BoxGeometry(0.28, 0.08, 0.12);
        const visorMesh = new THREE.Mesh(visorGeo, visorMat);
        visorMesh.position.set(0, 0.7, 0.28);
        carRoot.add(visorMesh);

        // 4. Halo Titanium Safety Arch
        const haloCurve = new THREE.TorusGeometry(0.38, 0.045, 8, 20, Math.PI);
        haloCurve.rotateX(Math.PI / 2 + 0.15);
        const haloMesh = new THREE.Mesh(haloCurve, carbonMat);
        haloMesh.position.set(0, 0.75, 0.3);
        carRoot.add(haloMesh);

        const haloStrutGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.35, 8);
        const haloStrut = new THREE.Mesh(haloStrutGeo, carbonMat);
        haloStrut.position.set(0, 0.62, 0.68);
        haloStrut.rotateX(0.4);
        carRoot.add(haloStrut);

        // 5. Sidepods (Left & Right)
        const podGeo = new THREE.BoxGeometry(0.45, 0.36, 1.6);
        const podL = new THREE.Mesh(podGeo, liveryMat);
        podL.position.set(-0.62, 0.36, 0.1);
        podL.castShadow = true;
        carRoot.add(podL);

        const podR = new THREE.Mesh(podGeo, liveryMat);
        podR.position.set(0.62, 0.36, 0.1);
        podR.castShadow = true;
        carRoot.add(podR);

        // 6. Engine Airbox & Shark Fin
        const airboxGeo = new THREE.BoxGeometry(0.32, 0.45, 0.8);
        const airboxMesh = new THREE.Mesh(airboxGeo, carbonMat);
        airboxMesh.position.set(0, 0.75, -0.4);
        carRoot.add(airboxMesh);

        const finGeo = new THREE.BoxGeometry(0.03, 0.42, 1.1);
        const finMesh = new THREE.Mesh(finGeo, liveryMat);
        finMesh.position.set(0, 0.8, -0.9);
        carRoot.add(finMesh);

        // 7. Front Wing Assembly
        const frontWingMainGeo = new THREE.BoxGeometry(1.85, 0.05, 0.55);
        const frontWingMesh = new THREE.Mesh(frontWingMainGeo, carbonMat);
        frontWingMesh.position.set(0, 0.18, 2.5);
        frontWingMesh.castShadow = true;
        carRoot.add(frontWingMesh);

        const frontFlapGeo = new THREE.BoxGeometry(1.8, 0.03, 0.35);
        const frontFlapMesh = new THREE.Mesh(frontFlapGeo, liveryMat);
        frontFlapMesh.position.set(0, 0.24, 2.45);
        frontFlapMesh.rotateX(-0.15);
        carRoot.add(frontFlapMesh);

        // Front Endplates
        const fEndplateGeo = new THREE.BoxGeometry(0.04, 0.26, 0.65);
        const fEndplateL = new THREE.Mesh(fEndplateGeo, accentGlowMat);
        fEndplateL.position.set(-0.92, 0.24, 2.5);
        carRoot.add(fEndplateL);

        const fEndplateR = new THREE.Mesh(fEndplateGeo, accentGlowMat);
        fEndplateR.position.set(0.92, 0.24, 2.5);
        carRoot.add(fEndplateR);

        // 8. Rear Wing Assembly with Movable DRS Flap
        const rEndplateGeo = new THREE.BoxGeometry(0.04, 0.65, 0.6);
        const rEndplateL = new THREE.Mesh(rEndplateGeo, accentGlowMat);
        rEndplateL.position.set(-0.68, 0.8, -2.0);
        rEndplateL.castShadow = true;
        carRoot.add(rEndplateL);

        const rEndplateR = new THREE.Mesh(rEndplateGeo, accentGlowMat);
        rEndplateR.position.set(0.68, 0.8, -2.0);
        rEndplateR.castShadow = true;
        carRoot.add(rEndplateR);

        const rMainPlaneGeo = new THREE.BoxGeometry(1.32, 0.05, 0.35);
        const rMainPlane = new THREE.Mesh(rMainPlaneGeo, carbonMat);
        rMainPlane.position.set(0, 0.82, -1.95);
        carRoot.add(rMainPlane);

        // DRS Flap (Hinged top element)
        const drsFlapGeo = new THREE.BoxGeometry(1.3, 0.04, 0.25);
        const drsFlapMesh = new THREE.Mesh(drsFlapGeo, liveryMat);
        drsFlapMesh.position.set(0, 1.02, -1.9);
        drsFlapMesh.rotateX(-0.25);
        carRoot.add(drsFlapMesh);
        carRoot.userData.drsFlap = drsFlapMesh;

        // Rear Diffuser & Blinking Rain Light
        const diffuserGeo = new THREE.BoxGeometry(1.1, 0.15, 0.5);
        const diffuserMesh = new THREE.Mesh(diffuserGeo, carbonMat);
        diffuserMesh.position.set(0, 0.16, -1.75);
        carRoot.add(diffuserMesh);

        const rainLightGeo = new THREE.BoxGeometry(0.12, 0.08, 0.05);
        const rainLightMat = new THREE.MeshBasicMaterial({ color: 0xff0033 });
        const rainLightMesh = new THREE.Mesh(rainLightGeo, rainLightMat);
        rainLightMesh.position.set(0, 0.26, -2.1);
        carRoot.add(rainLightMesh);

        // 9. 4 Formula 1 Wheels (Rotating Tires + Metallic Rim Hubs + Front Steering Pivots)
        function createWheel(isFront, isLeft) {
            const wheelGroup = new THREE.Group();
            const radius = isFront ? 0.34 : 0.36;
            const width = isFront ? 0.32 : 0.40;

            const tireGeo = new THREE.CylinderGeometry(radius, radius, width, 24);
            tireGeo.rotateZ(Math.PI / 2);
            const tire = new THREE.Mesh(tireGeo, tireMat);
            tire.castShadow = true;
            wheelGroup.add(tire);

            const rimGeo = new THREE.CylinderGeometry(radius * 0.58, radius * 0.58, width + 0.01, 16);
            rimGeo.rotateZ(Math.PI / 2);
            const rim = new THREE.Mesh(rimGeo, rimMat);
            wheelGroup.add(rim);

            // Suspension Wishbone
            const boneGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6);
            boneGeo.rotateZ(isLeft ? 0.4 : -0.4);
            const bone = new THREE.Mesh(boneGeo, carbonMat);
            bone.position.set(isLeft ? 0.28 : -0.28, 0.08, 0);
            carRoot.add(bone);

            carRoot.userData.wheels.push(tire);
            return wheelGroup;
        }

        // Front Left & Right (with steer pivots)
        const steerPivotFL = new THREE.Group();
        steerPivotFL.position.set(-0.82, 0.34, 1.6);
        const wheelFL = createWheel(true, true);
        steerPivotFL.add(wheelFL);
        carRoot.add(steerPivotFL);
        carRoot.userData.steerPivots.push(steerPivotFL);

        const steerPivotFR = new THREE.Group();
        steerPivotFR.position.set(0.82, 0.34, 1.6);
        const wheelFR = createWheel(true, false);
        steerPivotFR.add(wheelFR);
        carRoot.add(steerPivotFR);
        carRoot.userData.steerPivots.push(steerPivotFR);

        // Rear Left & Right
        const wheelRL = createWheel(false, true);
        wheelRL.position.set(-0.85, 0.36, -1.45);
        carRoot.add(wheelRL);

        const wheelRR = createWheel(false, false);
        wheelRR.position.set(0.85, 0.36, -1.45);
        carRoot.add(wheelRR);

        // 10. Underfloor Neon Glow Light & Disc
        const underglowLight = new THREE.PointLight(teamCol, 1.4, 7);
        underglowLight.position.set(0, 0.15, 0);
        carRoot.add(underglowLight);

        const glowDiscGeo = new THREE.CircleGeometry(1.6, 16);
        glowDiscGeo.rotateX(-Math.PI / 2);
        const glowDiscMat = new THREE.MeshBasicMaterial({
            color: teamCol,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending
        });
        const glowDisc = new THREE.Mesh(glowDiscGeo, glowDiscMat);
        glowDisc.position.set(0, 0.04, 0);
        carRoot.add(glowDisc);

        // 11. 3D Floating On-Car Holographic HUD Billboard Sprite
        const spriteCanvas = document.createElement('canvas');
        spriteCanvas.width = 256;
        spriteCanvas.height = 128;
        const spriteTex = new THREE.CanvasTexture(spriteCanvas);
        const spriteMat = new THREE.SpriteMaterial({ map: spriteTex, transparent: true });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.position.set(0, 3.2, 0);
        sprite.scale.set(8, 4, 1);
        carRoot.add(sprite);

        carRoot.userData.hudCanvas = spriteCanvas;
        carRoot.userData.hudTex = spriteTex;
        carRoot.userData.hudSprite = sprite;

        return carRoot;
    }

    // --- Dynamic 3D Laser Beam & Floating Gap Marker ---
    function initDeltaLaserBeam() {
        const scene = GhostState.three.scene;
        if (!scene) return;

        // Laser Beam Ribbon
        const beamGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(6); // 2 points x 3 coords
        beamGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const beamMat = new THREE.LineBasicMaterial({
            color: 0x00f0ff,
            linewidth: 3,
            transparent: true,
            opacity: 0.9
        });

        const laserBeam = new THREE.Line(beamGeo, beamMat);
        laserBeam.renderOrder = 10;
        scene.add(laserBeam);
        GhostState.three.deltaLaserBeam = laserBeam;

        // Floating Midpoint 3D Delta Badge Sprite
        const badgeCanvas = document.createElement('canvas');
        badgeCanvas.width = 256;
        badgeCanvas.height = 96;
        const badgeTex = new THREE.CanvasTexture(badgeCanvas);
        const badgeMat = new THREE.SpriteMaterial({ map: badgeTex, transparent: true });
        const badgeSprite = new THREE.Sprite(badgeMat);
        badgeSprite.scale.set(7, 2.6, 1);
        badgeSprite.renderOrder = 11;
        scene.add(badgeSprite);

        GhostState.three.deltaBadgeSprite = badgeSprite;
        GhostState.three.deltaBadgeCanvas = badgeCanvas;
        GhostState.three.deltaBadgeTex = badgeTex;
    }

    // --- Apex Racing Line Trails ---
    function initApexTrails() {
        const scene = GhostState.three.scene;
        if (!scene) return;

        const maxTrailPts = 60;
        const ptsA = new Float32Array(maxTrailPts * 3);
        const ptsB = new Float32Array(maxTrailPts * 3);

        const geoA = new THREE.BufferGeometry();
        geoA.setAttribute('position', new THREE.BufferAttribute(ptsA, 3));
        const matA = new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.75 });
        const lineA = new THREE.Line(geoA, matA);
        scene.add(lineA);

        const geoB = new THREE.BufferGeometry();
        geoB.setAttribute('position', new THREE.BufferAttribute(ptsB, 3));
        const matB = new THREE.LineBasicMaterial({ color: 0xff8000, transparent: true, opacity: 0.75 });
        const lineB = new THREE.Line(geoB, matB);
        scene.add(lineB);

        GhostState.three.trailMeshA = lineA;
        GhostState.three.trailMeshB = lineB;
        GhostState.three.trailHistoryA = [];
        GhostState.three.trailHistoryB = [];
    }

    // --- Extrude 3D Circuit Geometry & Sector Beacons ---
    function build3DTrackMesh() {
        const group = GhostState.three.trackMeshGroup;
        if (!group) return;

        // Clear existing
        while (group.children.length > 0) {
            const obj = group.children[0];
            group.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        }

        const pts = GhostState.trackPoints || [];
        if (pts.length < 5) return;

        // 1. Create CatmullRom Curve
        const threeVecs = pts.map(p => new THREE.Vector3(p.x, 0, p.z));
        const curve = new THREE.CatmullRomCurve3(threeVecs, true, 'catmullrom', 0.5);
        GhostState.three.trackCurve = curve;

        // Center Orbit target to track centroid
        let cx = 0, cz = 0;
        pts.forEach(p => { cx += p.x; cz += p.z; });
        cx /= pts.length;
        cz /= pts.length;
        GhostState.orbitControls.target.set(cx, 0, cz);

        // 2. Extrude Asphalt Track Ribbon Geometry
        const numSegments = Math.min(pts.length * 3, 1200);
        const curvePoints = curve.getSpacedPoints(numSegments);
        const trackWidth = 14.0;
        const halfW = trackWidth / 2;

        const vertices = [];
        const uvs = [];
        const indices = [];

        const leftEdgePts = [];
        const rightEdgePts = [];

        for (let i = 0; i <= numSegments; i++) {
            const curr = curvePoints[i % numSegments];
            const next = curvePoints[(i + 1) % numSegments];
            const tangent = new THREE.Vector3().subVectors(next, curr).normalize();
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

            const leftPt = new THREE.Vector3().copy(curr).addScaledVector(normal, halfW);
            const rightPt = new THREE.Vector3().copy(curr).addScaledVector(normal, -halfW);

            leftPt.y = 0.05;
            rightPt.y = 0.05;

            vertices.push(leftPt.x, leftPt.y, leftPt.z);
            vertices.push(rightPt.x, rightPt.y, rightPt.z);

            leftEdgePts.push(leftPt);
            rightEdgePts.push(rightPt);

            const u = i / numSegments;
            uvs.push(0, u * 30);
            uvs.push(1, u * 30);

            if (i < numSegments) {
                const idx = i * 2;
                indices.push(idx, idx + 1, idx + 2);
                indices.push(idx + 1, idx + 3, idx + 2);
            }
        }

        const trackGeo = new THREE.BufferGeometry();
        trackGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        trackGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        trackGeo.setIndex(indices);
        trackGeo.computeVertexNormals();

        // Asphalt Material
        const asphaltMat = new THREE.MeshStandardMaterial({
            color: 0x161c26,
            roughness: 0.85,
            metalness: 0.15,
            side: THREE.DoubleSide
        });

        const trackMesh = new THREE.Mesh(trackGeo, asphaltMat);
        trackMesh.receiveShadow = true;
        group.add(trackMesh);

        // 3. Track Boundary Lines (Outer & Inner White/Cyan Glow)
        const leftLineGeo = new THREE.BufferGeometry().setFromPoints(leftEdgePts);
        const rightLineGeo = new THREE.BufferGeometry().setFromPoints(rightEdgePts);
        const edgeLineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });

        const leftLine = new THREE.Line(leftLineGeo, edgeLineMat);
        const rightLine = new THREE.Line(rightLineGeo, edgeLineMat);
        group.add(leftLine);
        group.add(rightLine);

        // 4. Apex Red & White Kerbs on High Curvature Sections
        buildApexKerbs(group, curvePoints, numSegments, halfW);

        // 5. Start / Finish Gantry Arch & Grid Lines
        if (GhostState.startLine) {
            buildStartFinishGantry(group, GhostState.startLine);
        } else if (pts.length > 0) {
            buildStartFinishGantry(group, { x: pts[0].x, z: pts[0].z, yaw: 0 });
        }

        // 6. Sector 1 & 2 Neon Portal Arches
        if (GhostState.sector1) buildSectorGate(group, GhostState.sector1, 0xeab308, 'SECTOR 1');
        if (GhostState.sector2) buildSectorGate(group, GhostState.sector2, 0xc084fc, 'SECTOR 2');

        // 7. DRS Zones Glowing Green Ribbons
        if (GhostState.drsZones && GhostState.drsZones.length > 0) {
            buildDRSZoneRibbons(group, GhostState.drsZones, curve);
        }
    }

    function buildApexKerbs(group, curvePoints, numSegments, halfW) {
        const kerbWidth = 1.6;
        const kerbVertices = [];
        const kerbColors = [];
        const kerbIndices = [];

        for (let i = 0; i < numSegments; i += 2) {
            const prev = curvePoints[(i - 1 + numSegments) % numSegments];
            const curr = curvePoints[i];
            const next = curvePoints[(i + 1) % numSegments];

            // Curvature calculation
            const d1 = new THREE.Vector3().subVectors(curr, prev);
            const d2 = new THREE.Vector3().subVectors(next, curr);
            const angle = d1.angleTo(d2);

            // If corner apex curvature > threshold, place kerbs
            if (angle > 0.012) {
                const tangent = d2.normalize();
                const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
                const isLeftTurn = (d1.x * d2.z - d1.z * d2.x) > 0;
                const sideDir = isLeftTurn ? 1 : -1;

                const basePt = new THREE.Vector3().copy(curr).addScaledVector(normal, halfW * sideDir);
                const outPt = new THREE.Vector3().copy(basePt).addScaledVector(normal, kerbWidth * sideDir);

                basePt.y = 0.08;
                outPt.y = 0.12;

                const isRed = Math.floor(i / 3) % 2 === 0;
                const col = isRed ? [0.95, 0.15, 0.15] : [0.95, 0.95, 0.95];

                const baseIdx = kerbVertices.length / 3;
                kerbVertices.push(basePt.x, basePt.y, basePt.z);
                kerbVertices.push(outPt.x, outPt.y, outPt.z);
                kerbColors.push(...col, ...col);

                if (kerbVertices.length > 6) {
                    kerbIndices.push(baseIdx - 2, baseIdx - 1, baseIdx);
                    kerbIndices.push(baseIdx - 1, baseIdx + 1, baseIdx);
                }
            }
        }

        if (kerbVertices.length > 6) {
            const kerbGeo = new THREE.BufferGeometry();
            kerbGeo.setAttribute('position', new THREE.Float32BufferAttribute(kerbVertices, 3));
            kerbGeo.setAttribute('color', new THREE.Float32BufferAttribute(kerbColors, 3));
            kerbGeo.setIndex(kerbIndices);
            kerbGeo.computeVertexNormals();

            const kerbMat = new THREE.MeshStandardMaterial({
                vertexColors: true,
                roughness: 0.6,
                metalness: 0.1,
                side: THREE.DoubleSide
            });

            const kerbMesh = new THREE.Mesh(kerbGeo, kerbMat);
            group.add(kerbMesh);
        }
    }

    function buildStartFinishGantry(group, startPt) {
        const gantry = new THREE.Group();
        gantry.position.set(startPt.x, 0, startPt.z);
        if (startPt.yaw !== undefined) {
            gantry.rotation.y = -(startPt.yaw || 0);
        }

        // Twin pillars
        const pillarGeo = new THREE.BoxGeometry(0.8, 8, 0.8);
        const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1f293d, metalness: 0.8, roughness: 0.3 });

        const pL = new THREE.Mesh(pillarGeo, pillarMat);
        pL.position.set(-8.5, 4, 0);
        gantry.add(pL);

        const pR = new THREE.Mesh(pillarGeo, pillarMat);
        pR.position.set(8.5, 4, 0);
        gantry.add(pR);

        // Top Span Beam
        const beamGeo = new THREE.BoxGeometry(18, 1.2, 1.4);
        const beamMesh = new THREE.Mesh(beamGeo, pillarMat);
        beamMesh.position.set(0, 8.2, 0);
        gantry.add(beamMesh);

        // Start Lights & Banner
        const lightBoxGeo = new THREE.BoxGeometry(10, 0.6, 0.4);
        const lightBoxMat = new THREE.MeshBasicMaterial({ color: 0xff0044 });
        const lightBox = new THREE.Mesh(lightBoxGeo, lightBoxMat);
        lightBox.position.set(0, 7.4, 0.7);
        gantry.add(lightBox);

        // Checkered Start Line on asphalt
        const lineGeo = new THREE.PlaneGeometry(14, 2);
        lineGeo.rotateX(-Math.PI / 2);
        const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const lineMesh = new THREE.Mesh(lineGeo, lineMat);
        lineMesh.position.set(0, 0.08, 0);
        gantry.add(lineMesh);

        group.add(gantry);
    }

    function buildSectorGate(group, sectorPt, colorHex, label) {
        const gate = new THREE.Group();
        gate.position.set(sectorPt.x, 0, sectorPt.z);
        if (sectorPt.yaw !== undefined) gate.rotation.y = -(sectorPt.yaw || 0);

        // Neon Archway
        const archMat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.85 });
        const pGeo = new THREE.CylinderGeometry(0.2, 0.2, 7, 8);
        
        const pL = new THREE.Mesh(pGeo, archMat);
        pL.position.set(-8, 3.5, 0);
        gate.add(pL);

        const pR = new THREE.Mesh(pGeo, archMat);
        pR.position.set(8, 3.5, 0);
        gate.add(pR);

        const bGeo = new THREE.CylinderGeometry(0.15, 0.15, 16.5, 8);
        bGeo.rotateZ(Math.PI / 2);
        const topB = new THREE.Mesh(bGeo, archMat);
        topB.position.set(0, 7, 0);
        gate.add(topB);

        group.add(gate);
    }

    function buildDRSZoneRibbons(group, drsZones, curve) {
        drsZones.forEach(z => {
            if (z.start && z.end) {
                const sPt = z.start;
                const ePt = z.end;
                const pts = [new THREE.Vector3(sPt.x, 0.08, sPt.z), new THREE.Vector3(ePt.x, 0.08, ePt.z)];
                const drsLineGeo = new THREE.BufferGeometry().setFromPoints(pts);
                const drsLineMat = new THREE.LineBasicMaterial({ color: 0x22c55e, linewidth: 4, transparent: true, opacity: 0.9 });
                const drsLine = new THREE.Line(drsLineGeo, drsLineMat);
                group.add(drsLine);
            }
        });
    }

    // --- Update 3D Floating HUD Canvas Textures ---
    function updateCarHUDCanvas(carMesh, speed, gear, drsActive, isA) {
        const canvas = carMesh.userData.hudCanvas;
        const tex = carMesh.userData.hudTex;
        if (!canvas || !tex) return;

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const col = isA
            ? (getComputedStyle(document.documentElement).getPropertyValue('--driver-a-color').trim() || '#00d2be')
            : (getComputedStyle(document.documentElement).getPropertyValue('--driver-b-color').trim() || '#ff8000');

        // Background pill
        ctx.fillStyle = 'rgba(8, 12, 20, 0.85)';
        ctx.strokeStyle = col;
        ctx.lineWidth = 4;
        roundRect(ctx, 4, 4, canvas.width - 8, canvas.height - 8, 16, true, true);

        // Driver Name Tag
        ctx.fillStyle = col;
        ctx.font = '900 24px Orbitron, sans-serif';
        const name = (carMesh.userData.driverName || 'CAR').split(' ')[0].toUpperCase();
        ctx.fillText(name, 16, 42);

        // Speed & Gear
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 36px Roboto Mono, monospace';
        ctx.fillText(`${Math.round(speed || 0)}`, 16, 94);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '700 16px Titillium Web, sans-serif';
        ctx.fillText('KM/H', 98, 94);

        // Gear Badge
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        roundRect(ctx, 165, 56, 40, 42, 8, true, false);
        ctx.fillStyle = '#00f0ff';
        ctx.font = '900 28px Roboto Mono, monospace';
        ctx.fillText(`${gear || 'N'}`, 175, 88);

        // DRS Active Badge
        if (drsActive) {
            ctx.fillStyle = '#22c55e';
            roundRect(ctx, 165, 16, 75, 26, 6, true, false);
            ctx.fillStyle = '#000000';
            ctx.font = '900 14px Orbitron, sans-serif';
            ctx.fillText('DRS', 184, 34);
        }

        tex.needsUpdate = true;
    }

    function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        if (fill) ctx.fill();
        if (stroke) ctx.stroke();
    }

    // --- Update 3D Live Delta Beam & Floating Midpoint Badge ---
    function update3DLiveDelta(sample, posA, posB) {
        const beam = GhostState.three.deltaLaserBeam;
        const badge = GhostState.three.deltaBadgeSprite;
        const badgeCanvas = GhostState.three.deltaBadgeCanvas;
        const badgeTex = GhostState.three.deltaBadgeTex;

        if (!sample || !posA || !posB) {
            if (beam) beam.visible = false;
            if (badge) badge.visible = false;
            return;
        }

        const deltaMs = sample.deltaMs;
        const isAFaster = deltaMs > 0;
        const colA = getComputedStyle(document.documentElement).getPropertyValue('--driver-a-color').trim() || '#00d2be';
        const colB = getComputedStyle(document.documentElement).getPropertyValue('--driver-b-color').trim() || '#ff8000';

        // 1. Update 3D Laser Beam
        if (beam && GhostState.viewOptions.showDeltaBeam) {
            beam.visible = true;
            const posAttr = beam.geometry.attributes.position;
            posAttr.setXYZ(0, posA.x, 0.45, posA.z);
            posAttr.setXYZ(1, posB.x, 0.45, posB.z);
            posAttr.needsUpdate = true;
            beam.material.color.set(isAFaster ? colA : colB);
        } else if (beam) {
            beam.visible = false;
        }

        // 2. Update Floating Midpoint Delta Badge
        const midX = (posA.x + posB.x) / 2;
        const midZ = (posA.z + posB.z) / 2;
        const distMeters = Math.hypot(posA.x - posB.x, posA.z - posB.z);

        if (badge && badgeCanvas && badgeTex && GhostState.viewOptions.showDeltaBeam) {
            badge.visible = true;
            badge.position.set(midX, 3.6, midZ);

            const ctx = badgeCanvas.getContext('2d');
            ctx.clearRect(0, 0, badgeCanvas.width, badgeCanvas.height);

            ctx.fillStyle = 'rgba(8, 12, 20, 0.9)';
            ctx.strokeStyle = isAFaster ? colA : colB;
            ctx.lineWidth = 3;
            roundRect(ctx, 4, 4, badgeCanvas.width - 8, badgeCanvas.height - 8, 12, true, true);

            ctx.fillStyle = isAFaster ? colA : colB;
            ctx.font = '900 28px Orbitron, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(formatDeltaSec(deltaMs), badgeCanvas.width / 2, 42);

            ctx.fillStyle = '#e2e8f0';
            ctx.font = '800 18px Roboto Mono, monospace';
            ctx.fillText(`${distMeters.toFixed(1)}m GAP`, badgeCanvas.width / 2, 74);
            ctx.textAlign = 'left';

            badgeTex.needsUpdate = true;
        } else if (badge) {
            badge.visible = false;
        }

        // 3. Update 3D Viewport Live Delta HUD Banner
        if (DOM.vDeltaBadge) {
            DOM.vDeltaBadge.innerText = formatDeltaSec(deltaMs);
            DOM.vDeltaBadge.className = 'v-delta-badge ' + (isAFaster ? 'a-faster' : 'b-faster');
        }

        if (DOM.vDeltaDist) {
            const leaderName = isAFaster
                ? (GhostState.driverA?.driverName || 'CAR A').split(' ')[0].toUpperCase()
                : (GhostState.driverB?.driverName || 'CAR B').split(' ')[0].toUpperCase();
            DOM.vDeltaDist.innerText = `${distMeters.toFixed(1)}m GAP (${leaderName} LEADS)`;
        }

        // Dynamic Delta Meter Bar Fill
        const maxDeltaScale = 1500; // ±1.5s scale
        const ratio = Math.min(1, Math.abs(deltaMs) / maxDeltaScale);
        const fillPercent = ratio * 50; // up to 50% fill on left or right

        if (DOM.vMeterFillA && DOM.vMeterFillB) {
            if (isAFaster) {
                DOM.vMeterFillA.style.width = `${fillPercent}%`;
                DOM.vMeterFillB.style.width = '0%';
            } else {
                DOM.vMeterFillA.style.width = '0%';
                DOM.vMeterFillB.style.width = `${fillPercent}%`;
            }
        }

        // Speed Delta Chip
        if (DOM.hudSpeedDelta) {
            const spdA = Math.round(sample.speedA || 0);
            const spdB = Math.round(sample.speedB || 0);
            const diff = spdA - spdB;
            const sign = diff > 0 ? '+' : '';
            DOM.hudSpeedDelta.innerText = `${sign}${diff} KM/H (${spdA} vs ${spdB})`;
            DOM.hudSpeedDelta.style.color = diff >= 0 ? colA : colB;
        }
    }

    // --- Dynamic Multi-Camera System ---
    function update3DCamera(posA, posB, yawA, yawB) {
        const camera = GhostState.three.camera;
        if (!camera) return;

        const mode = GhostState.cameraMode;

        if (mode === 'chaseA' && posA) {
            // Chase Cam behind Car A
            const forwardX = -Math.sin(yawA || 0);
            const forwardZ = -Math.cos(yawA || 0);
            const targetCamX = posA.x - forwardX * 26;
            const targetCamY = 8.5;
            const targetCamZ = posA.z - forwardZ * 26;

            camera.position.lerp(new THREE.Vector3(targetCamX, targetCamY, targetCamZ), 0.09);
            camera.lookAt(posA.x + forwardX * 12, 1.2, posA.z + forwardZ * 12);
        } else if (mode === 'chaseB' && posB) {
            // Chase Cam behind Car B
            const forwardX = -Math.sin(yawB || 0);
            const forwardZ = -Math.cos(yawB || 0);
            const targetCamX = posB.x - forwardX * 26;
            const targetCamY = 8.5;
            const targetCamZ = posB.z - forwardZ * 26;

            camera.position.lerp(new THREE.Vector3(targetCamX, targetCamY, targetCamZ), 0.09);
            camera.lookAt(posB.x + forwardX * 12, 1.2, posB.z + forwardZ * 12);
        } else if (mode === 'battle' && posA && posB) {
            // Battle Cam - Midpoint dual focus with gap-adaptive distance
            const midX = (posA.x + posB.x) / 2;
            const midZ = (posA.z + posB.z) / 2;
            const gap = Math.hypot(posA.x - posB.x, posA.z - posB.z);
            const avgYaw = (yawA + yawB) / 2;

            const forwardX = -Math.sin(avgYaw || 0);
            const forwardZ = -Math.cos(avgYaw || 0);
            const camDist = Math.max(30, Math.min(100, gap * 1.6 + 35));
            const camHeight = Math.max(9, Math.min(30, gap * 0.6 + 12));

            const targetCamX = midX - forwardX * camDist;
            const targetCamY = camHeight;
            const targetCamZ = midZ - forwardZ * camDist;

            camera.position.lerp(new THREE.Vector3(targetCamX, targetCamY, targetCamZ), 0.08);
            camera.lookAt(midX + forwardX * 8, 1.0, midZ + forwardZ * 8);
        } else if (mode === 'cockpitA' && posA) {
            // Onboard Nose/Cockpit Cam from Driver A
            const forwardX = -Math.sin(yawA || 0);
            const forwardZ = -Math.cos(yawA || 0);
            camera.position.set(posA.x + forwardX * 0.4, 0.95, posA.z + forwardZ * 0.4);
            camera.lookAt(posA.x + forwardX * 40, 0.6, posA.z + forwardZ * 40);
        } else if (mode === 'topDown') {
            // Bird's eye overview tracking leading car
            const leadX = posA ? posA.x : 0;
            const leadZ = posA ? posA.z : 0;
            camera.position.lerp(new THREE.Vector3(leadX, 380, leadZ + 1), 0.08);
            camera.lookAt(leadX, 0, leadZ);
        } else {
            // Free 3D Orbit mode
            const sph = GhostState.orbitControls.spherical;
            const tgt = GhostState.orbitControls.target;

            const x = tgt.x + sph.radius * Math.sin(sph.phi) * Math.sin(sph.theta);
            const y = Math.max(5, tgt.y + sph.radius * Math.cos(sph.phi));
            const z = tgt.z + sph.radius * Math.sin(sph.phi) * Math.cos(sph.theta);

            camera.position.set(x, y, z);
            camera.lookAt(tgt.x, tgt.y, tgt.z);
        }
    }

    function setCameraMode(mode) {
        GhostState.cameraMode = mode;
        if (DOM.hudCamLabel) {
            const labels = {
                chaseA: 'CHASE CAM (A)',
                chaseB: 'CHASE CAM (B)',
                battle: 'BATTLE CAM (DUAL)',
                cockpitA: 'COCKPIT POV (A)',
                orbit: 'ORBIT 3D (FREE)',
                topDown: 'TOP-DOWN 3D'
            };
            DOM.hudCamLabel.innerText = labels[mode] || mode.toUpperCase();
        }

        if (DOM.camModeBtns) {
            DOM.camModeBtns.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.cam === mode);
            });
        }
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

            if (DOM.timelineTime) DOM.timelineTime.innerText = formatMs(sample.timeA);
            if (DOM.hudTrackDist) DOM.hudTrackDist.innerText = `${Math.round(dist)}m / ${Math.round(GhostState.maxDistance)}m`;
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
                const avgSpeedMs = Math.max(10, ((sample.speedA + sample.speedB) / 2) / 3.6);
                const distDiff = (sample.deltaMs / 1000) * avgSpeedMs;
                DOM.instantDistVal.innerText = `${distDiff > 0 ? '+' : ''}${distDiff.toFixed(1)} meters gap`;
            }

            // Update 3D Cars & Live Delta Visualizer
            const carA = GhostState.three.carMeshGroupA;
            const carB = GhostState.three.carMeshGroupB;

            if (carA && sample.posA) {
                carA.position.set(sample.posA.x, 0.05, sample.posA.z);
                carA.rotation.y = -(sample.posA.yaw || 0);

                // DRS flap animation
                if (carA.userData.drsFlap) {
                    carA.userData.drsFlap.rotation.x = sample.drsA ? 0.35 : -0.25;
                }

                // Wheel spin
                const wheelSpinDelta = (sample.speedA / 3.6) * 0.15;
                if (carA.userData.wheels) {
                    carA.userData.wheels.forEach(w => w.rotation.x += wheelSpinDelta);
                }

                // Front steering angle
                if (carA.userData.steerPivots) {
                    carA.userData.steerPivots.forEach(p => p.rotation.y = Math.sin(GhostState.currentDistance / 80) * 0.22);
                }

                // On-car HUD billboard
                updateCarHUDCanvas(carA, sample.speedA, sample.gearA, sample.drsA, true);
            }

            if (carB && sample.posB) {
                carB.position.set(sample.posB.x, 0.05, sample.posB.z);
                carB.rotation.y = -(sample.posB.yaw || 0);

                // DRS flap animation
                if (carB.userData.drsFlap) {
                    carB.userData.drsFlap.rotation.x = sample.drsB ? 0.35 : -0.25;
                }

                // Wheel spin
                const wheelSpinDelta = (sample.speedB / 3.6) * 0.15;
                if (carB.userData.wheels) {
                    carB.userData.wheels.forEach(w => w.rotation.x += wheelSpinDelta);
                }

                // Front steering angle
                if (carB.userData.steerPivots) {
                    carB.userData.steerPivots.forEach(p => p.rotation.y = Math.sin(GhostState.currentDistance / 80) * 0.22);
                }

                // On-car HUD billboard
                updateCarHUDCanvas(carB, sample.speedB, sample.gearB, sample.drsB, false);
            }

            // Update 3D Laser Delta Beam & Top Live Delta HUD
            update3DLiveDelta(sample, sample.posA, sample.posB);

            // Update 3D Camera Follow
            update3DCamera(sample.posA, sample.posB, sample.posA.yaw, sample.posB.yaw);
        }

        // Render Telemetry Graphs
        renderAllTelemetryGraphs();
    }

    function getTelemetrySampleAtDistance(dist) {
        const data = GhostState.alignedData;
        if (!data || data.length === 0) return null;
        let idx = data.findIndex(p => p.d >= dist);
        if (idx < 0) idx = data.length - 1;
        return data[idx];
    }

    // --- Animation & Render Loop ---
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

        // Render 3D Scene
        if (GhostState.three.renderer && GhostState.three.scene && GhostState.three.camera) {
            GhostState.three.renderer.render(GhostState.three.scene, GhostState.three.camera);
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

        const targetTrack = GhostState.currentTrackId !== -1 ? GhostState.currentTrackId : 4;

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

        fetch(`/telemetry/telemetry_${trackId}.json`)
            .then(r => r.json())
            .then(rawTelemetry => {
                if (!Array.isArray(rawTelemetry) || rawTelemetry.length < 50) return;

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

                const telB = rawTelemetry.map((p, idx) => {
                    const isCorner = p.speed < 240;
                    const speedVariance = isCorner ? (Math.sin(idx / 10) * 4 + 1.5) : (Math.cos(idx / 15) * 3 - 2);
                    const speedB = Math.max(50, Math.min(350, Math.round(p.speed + speedVariance)));
                    const timeLag = Math.round(p.t * (1 + (Math.sin(idx / 30) * 0.006 + 0.003)));

                    return {
                        d: p.d,
                        t: timeLag,
                        speed: speedB,
                        throttle: p.throttle > 80 ? Math.min(100, p.throttle + 2) : p.throttle,
                        brake: p.brake,
                        gear: p.gear,
                        drs: p.drs,
                        x: p.x + (Math.cos(p.yaw || 0) * 0.8),
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

                showToast('Ghost telemetry comparison loaded in 3D!');
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

        fetch('/api/recording/status')
            .then(r => r.json())
            .then(st => {
                if (st && st.isRecording) {
                    applyRecordingState(true, st.startTime);
                }
            })
            .catch(() => {});
    }

    function switchManualTrack(trackId) {
        const tId = parseInt(trackId, 10);
        if (isNaN(tId) || tId === -1) return;
        GhostState.currentTrackId = tId;
        if (DOM.circuitSelect) DOM.circuitSelect.value = tId;
        fetchTrackData(tId);

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
                
                // Rebuild 3D Circuit Geometry
                build3DTrackMesh();
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

        // Camera Mode Buttons
        if (DOM.camModeBtns) {
            DOM.camModeBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const camMode = btn.dataset.cam;
                    setCameraMode(camMode);
                });
            });
        }

        // Viewport Feature Toggles
        if (DOM.btnToggleGhostStyle) {
            DOM.btnToggleGhostStyle.addEventListener('click', () => {
                GhostState.viewOptions.isGhostTranslucent = !GhostState.viewOptions.isGhostTranslucent;
                DOM.btnToggleGhostStyle.classList.toggle('active', GhostState.viewOptions.isGhostTranslucent);
                setupOrUpdate3DCars();
                showToast(GhostState.viewOptions.isGhostTranslucent ? 'Ghost Glow Mode Active' : 'Solid Livery Mode Active');
            });
        }

        if (DOM.btnToggleDeltaBeam) {
            DOM.btnToggleDeltaBeam.addEventListener('click', () => {
                GhostState.viewOptions.showDeltaBeam = !GhostState.viewOptions.showDeltaBeam;
                DOM.btnToggleDeltaBeam.classList.toggle('active', GhostState.viewOptions.showDeltaBeam);
                if (GhostState.three.deltaLaserBeam) GhostState.three.deltaLaserBeam.visible = GhostState.viewOptions.showDeltaBeam;
                if (GhostState.three.deltaBadgeSprite) GhostState.three.deltaBadgeSprite.visible = GhostState.viewOptions.showDeltaBeam;
            });
        }

        if (DOM.btnToggleApexTrail) {
            DOM.btnToggleApexTrail.addEventListener('click', () => {
                GhostState.viewOptions.showApexTrail = !GhostState.viewOptions.showApexTrail;
                DOM.btnToggleApexTrail.classList.toggle('active', GhostState.viewOptions.showApexTrail);
                if (GhostState.three.trailMeshA) GhostState.three.trailMeshA.visible = GhostState.viewOptions.showApexTrail;
                if (GhostState.three.trailMeshB) GhostState.three.trailMeshB.visible = GhostState.viewOptions.showApexTrail;
            });
        }

        if (DOM.btnResetCam) {
            DOM.btnResetCam.addEventListener('click', () => {
                setCameraMode('chaseA');
                showToast('Camera reset to Chase Cam');
            });
        }

        if (DOM.btnFullscreen3D) {
            DOM.btnFullscreen3D.addEventListener('click', () => {
                GhostState.viewOptions.isFullscreen = !GhostState.viewOptions.isFullscreen;
                if (DOM.circuitViewportCard) {
                    DOM.circuitViewportCard.classList.toggle('is-fullscreen', GhostState.viewOptions.isFullscreen);
                }
                setTimeout(handle3DResize, 50);
            });
        }

        if (DOM.btnRecordingToggle) {
            DOM.btnRecordingToggle.addEventListener('click', () => {
                const newRec = !GhostState.isRecordingSession;
                if (newRec) {
                    const tId = GhostState.currentTrackId !== -1 ? GhostState.currentTrackId : 31;
                    if (GhostState.ws && GhostState.ws.readyState === WebSocket.OPEN) {
                        GhostState.ws.send(JSON.stringify({
                            action: 'startSessionRecording',
                            trackId: tId,
                            reset: true
                        }));
                    }
                    fetch(`/api/recording/start?trackId=${tId}&reset=true`, { method: 'POST' })
                        .then(r => r.json())
                        .then(res => {
                            applyRecordingState(true, res.startTime);
                            showToast('🔴 Session Recording Active - Driver laps stored at all costs!');
                        })
                        .catch(() => {
                            applyRecordingState(true, Date.now());
                            showToast('🔴 Session Recording Active!');
                        });
                } else {
                    if (GhostState.ws && GhostState.ws.readyState === WebSocket.OPEN) {
                        GhostState.ws.send(JSON.stringify({ action: 'stopSessionRecording' }));
                    }
                    fetch('/api/recording/stop', { method: 'POST' })
                        .then(r => r.json())
                        .then(() => {
                            applyRecordingState(false, 0);
                            showToast('⏹️ Session Recording Stopped');
                        })
                        .catch(() => {
                            applyRecordingState(false, 0);
                            showToast('⏹️ Session Recording Stopped');
                        });
                }
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
            } else if (e.code === 'Digit1') {
                setCameraMode('chaseA');
            } else if (e.code === 'Digit2') {
                setCameraMode('chaseB');
            } else if (e.code === 'Digit3') {
                setCameraMode('battle');
            } else if (e.code === 'Digit4') {
                setCameraMode('cockpitA');
            } else if (e.code === 'Digit5') {
                setCameraMode('orbit');
            } else if (e.code === 'Digit6') {
                setCameraMode('topDown');
            }
        });

        // Window resize observer
        window.addEventListener('resize', handle3DResize);
    }

    function handle3DResize() {
        const container = GhostState.three.container;
        const renderer = GhostState.three.renderer;
        const camera = GhostState.three.camera;

        if (container && renderer && camera) {
            const w = container.clientWidth;
            const h = container.clientHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        }

        renderAllTelemetryGraphs();
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

    // --- Initialization Entry Point ---
    document.addEventListener('DOMContentLoaded', () => {
        initDOMElements();
        initThreeEngine();
        setupEventListeners();
        initWebSocket();
        fetchAvailableTracksList();
        requestAnimationFrame(animationLoop);
    });

})();
