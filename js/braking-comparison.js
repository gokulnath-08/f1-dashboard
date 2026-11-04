/**
 * ═════════════════════════════════════════════════════════════════════════════
 * F1 SESSION BRAKING ANALYSIS & MULTI-LAP COMPARISON (braking-comparison.js)
 * Broadcast-Grade Telemetry Lab, Interactive Radar & Synchronized Telemetry
 * ═════════════════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    // --- State Management ---
    const BrakeState = {
        ws: null,
        isConnected: false,
        isLiveGameActive: false,
        currentTrackId: 0,
        trackName: 'Melbourne',
        trackLength: 5278,
        trackPoints: [],
        trackMeta: {
            drsZones: [],
            startLine: null,
            sector1: null,
            sector2: null
        },
        showDrs: true,
        isDemoMode: false,
        
        // Session Laps
        allLaps: [],
        baselineLap: null,
        compareLap: null,
        h2hComparison: null,
        comparisonMatrix: null,
        
        baselineLapNum: null,
        compareLapNum: null,
        viewMode: 'matrix', // 'matrix' (all laps) | 'h2h' (head-to-head) | 'single' (deep dive)
        selectedCornerIndex: null,
        hoverZoneIndex: null,
        
        // Map Canvas Transform (Pan & Zoom)
        map: {
            canvas: null,
            ctx: null,
            scale: 1.0,
            baseScale: 1.0,
            offsetX: 0,
            offsetY: 0,
            isDragging: false,
            lastX: 0,
            lastY: 0,
            bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0, width: 0, height: 0, midX: 0, midZ: 0 }
        },
        
        // Telemetry Graph Canvas
        graph: {
            canvas: null,
            ctx: null,
            scrubDist: null,
            scrubPoint: null,
            isScrubbing: false
        }
    };

    // DOM Elements Cache
    let DOM = {};

    function initDOMElements() {
        DOM = {
            // Header
            circuitSelect: document.getElementById('circuitSelect'),
            circuitStatsBadge: document.getElementById('circuitStatsBadge'),
            trackNameDisplay: document.getElementById('trackNameDisplay'),
            trackLengthDisplay: document.getElementById('trackLengthDisplay'),
            trackZonesDisplay: document.getElementById('trackZonesDisplay'),
            
            btnModeMatrix: document.getElementById('btnModeMatrix'),
            btnModeH2H: document.getElementById('btnModeH2H'),
            btnModeSingle: document.getElementById('btnModeSingle'),
            
            btnDemo: document.getElementById('btnDemo'),
            btnDemoText: document.getElementById('btnDemoText'),
            sessionDatasetTag: document.getElementById('sessionDatasetTag'),
            btnSync: document.getElementById('btnSync'),
            btnExport: document.getElementById('btnExport'),
            liveStatusBadge: document.getElementById('liveStatusBadge'),
            liveStatusText: document.getElementById('liveStatusText'),
            
            // Interactive Lap Strip & Dropdowns
            lapPillList: document.getElementById('lapPillList'),
            baselineLapSelect: document.getElementById('baselineLapSelect'),
            compareLapSelect: document.getElementById('compareLapSelect'),
            compareLapSelectWrapper: document.getElementById('compareLapSelectWrapper'),
            
            // Active Lap HUD Displays
            baselineLapBadge: document.getElementById('baselineLapBadge'),
            baselineLapTime: document.getElementById('baselineLapTime'),
            baselineBrakingDist: document.getElementById('baselineBrakingDist'),
            baselineZonesCount: document.getElementById('baselineZonesCount'),
            baselineDecelG: document.getElementById('baselineDecelG'),
            
            hudVsDivider: document.getElementById('hudVsDivider'),
            compareLapCard: document.getElementById('compareLapCard'),
            compareLapBadge: document.getElementById('compareLapBadge'),
            compareLapTime: document.getElementById('compareLapTime'),
            compareBrakingDist: document.getElementById('compareBrakingDist'),
            compareTimeDelta: document.getElementById('compareTimeDelta'),
            compareDistDelta: document.getElementById('compareDistDelta'),
            
            // Hero KPIs
            kpiLapTime: document.getElementById('kpiLapTime'),
            kpiLapDelta: document.getElementById('kpiLapDelta'),
            kpiTotalBraking: document.getElementById('kpiTotalBraking'),
            kpiBrakingDelta: document.getElementById('kpiBrakingDelta'),
            kpiAvgDecel: document.getElementById('kpiAvgDecel'),
            kpiPeakDecel: document.getElementById('kpiPeakDecel'),
            kpiEfficiencyIndex: document.getElementById('kpiEfficiencyIndex'),
            kpiTotalZones: document.getElementById('kpiTotalZones'),
            kpiSessionLapsCount: document.getElementById('kpiSessionLapsCount'),
            
            // Map Canvas & Tools
            circuitMapCanvas: document.getElementById('circuitMapCanvas'),
            mapCanvasContainer: document.getElementById('mapCanvasContainer'),
            mapSpecsOverlay: document.getElementById('mapSpecsOverlay'),
            mapSpecTrackName: document.getElementById('mapSpecTrackName'),
            mapSpecDetails: document.getElementById('mapSpecDetails'),
            mapHoverHud: document.getElementById('mapHoverHud'),
            btnToggleDrs: document.getElementById('btnToggleDrs'),
            btnZoomIn: document.getElementById('btnZoomIn'),
            btnZoomOut: document.getElementById('btnZoomOut'),
            btnResetMap: document.getElementById('btnResetMap'),
            cornerQuickPills: document.getElementById('cornerQuickPills'),
            
            // Table
            brakingTableHead: document.getElementById('brakingTableHead'),
            brakingTableBody: document.getElementById('brakingTableBody'),
            tableTitle: document.getElementById('tableTitle'),
            
            // Telemetry Chart
            telemetryChartCanvas: document.getElementById('telemetryChartCanvas'),
            chartCanvasWrap: document.getElementById('chartCanvasWrap'),
            legendCompareSpeed: document.getElementById('legendCompareSpeed'),
            chartCursorBadge: document.getElementById('chartCursorBadge'),
            chartScrubInfo: document.getElementById('chartScrubInfo'),
            
            // Toast
            toast: document.getElementById('brakeToast')
        };
    }

    function showToast(message) {
        if (!DOM.toast) return;
        DOM.toast.textContent = message;
        DOM.toast.classList.add('show');
        clearTimeout(DOM.toast._timer);
        DOM.toast._timer = setTimeout(() => {
            DOM.toast.classList.remove('show');
        }, 3200);
    }

    // ══════════ WEBSOCKET & DATA FETCHING ══════════
    function initWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        try {
            BrakeState.ws = new WebSocket(wsUrl);
            
            BrakeState.ws.onopen = () => {
                BrakeState.isConnected = true;
                updateConnectionStatus('CONNECTED', 'live');
                BrakeState.ws.send(JSON.stringify({ action: 'getSessionAllLaps', trackId: BrakeState.currentTrackId }));
            };

            BrakeState.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    handleWebSocketMessage(msg);
                } catch (e) { }
            };

            BrakeState.ws.onclose = () => {
                BrakeState.isConnected = false;
                updateConnectionStatus('OFFLINE', 'offline');
                setTimeout(initWebSocket, 3500);
            };

            BrakeState.ws.onerror = () => {
                BrakeState.isConnected = false;
                updateConnectionStatus('OFFLINE', 'offline');
            };
        } catch (e) {
            updateConnectionStatus('OFFLINE', 'offline');
        }
    }

    function updateConnectionStatus(text, status) {
        if (!DOM.liveStatusText || !DOM.liveStatusBadge) return;
        DOM.liveStatusText.textContent = text;
        if (status === 'live') {
            DOM.liveStatusBadge.style.color = 'var(--neon-green)';
            DOM.liveStatusBadge.style.borderColor = 'rgba(0, 255, 102, 0.4)';
            DOM.liveStatusBadge.style.background = 'rgba(0, 255, 102, 0.1)';
        } else {
            DOM.liveStatusBadge.style.color = 'var(--neon-yellow)';
            DOM.liveStatusBadge.style.borderColor = 'rgba(255, 209, 0, 0.4)';
            DOM.liveStatusBadge.style.background = 'rgba(255, 209, 0, 0.08)';
        }
    }

    function handleWebSocketMessage(msg) {
        if (msg.type === 'sessionLapCompleted') {
            if (!BrakeState.isDemoMode) {
                showToast(`🏁 New Lap ${msg.data.lapNum} recorded! Braking: ${msg.data.totalBrakingDist}m`);
                loadTrackBrakingData(BrakeState.currentTrackId, BrakeState.baselineLapNum, BrakeState.compareLapNum);
            }
        } else if (msg.type === 'sessionAllLapsResponse') {
            if (!BrakeState.isDemoMode && Array.isArray(msg.data)) {
                BrakeState.allLaps = msg.data;
                loadTrackBrakingData(BrakeState.currentTrackId, BrakeState.baselineLapNum, BrakeState.compareLapNum);
            }
        }
    }

    function fetchAvailableTracks() {
        fetch('/api/tracks')
            .then(r => r.json())
            .then(data => {
                if (data.tracks && Array.isArray(data.tracks)) {
                    DOM.circuitSelect.innerHTML = '';
                    data.tracks.forEach(t => {
                        const opt = document.createElement('option');
                        opt.value = t.id;
                        opt.textContent = `${t.name} (Track ${t.id})`;
                        if (t.id === BrakeState.currentTrackId) opt.selected = true;
                        DOM.circuitSelect.appendChild(opt);
                    });
                }
            })
            .catch(() => {});
    }

    function detectLiveTrack() {
        fetch('/api/session-data')
            .then(r => r.json())
            .then(data => {
                if (data.metadata && data.metadata.trackId !== undefined && data.metadata.trackId !== -1) {
                    BrakeState.currentTrackId = parseInt(data.metadata.trackId, 10);
                    BrakeState.trackName = data.metadata.trackName || 'Circuit';
                    if (DOM.circuitSelect) DOM.circuitSelect.value = String(data.metadata.trackId);
                    updateConnectionStatus(`LIVE SESSION (${BrakeState.trackName.toUpperCase()})`, 'live');
                    loadTrackBrakingData(data.metadata.trackId);
                } else {
                    loadTrackBrakingData(BrakeState.currentTrackId);
                }
            })
            .catch(() => {
                loadTrackBrakingData(BrakeState.currentTrackId);
            });
    }

    // ══════════ LOAD BRAKING DATASET ══════════
    function loadTrackBrakingData(trackId, reqBaselineLap = null, reqCompareLap = null) {
        const tId = trackId !== undefined && trackId !== null ? trackId : BrakeState.currentTrackId;
        BrakeState.currentTrackId = parseInt(tId, 10);
        
        let url = `/api/session/lap-braking?trackId=${BrakeState.currentTrackId}`;
        if (reqBaselineLap !== null && reqBaselineLap !== undefined) url += `&baseline=${reqBaselineLap}`;
        if (reqCompareLap !== null && reqCompareLap !== undefined) url += `&compare=${reqCompareLap}`;

        fetch(url)
            .then(r => r.json())
            .then(data => {
                BrakeState.trackName = data.trackName || 'Melbourne';
                BrakeState.trackLength = data.trackLength || 5278;
                BrakeState.trackPoints = data.trackPoints || [];
                BrakeState.trackMeta = data.trackMeta || { drsZones: [], startLine: null, sector1: null, sector2: null };

                if (!data.success || !data.baselineLap || !data.allLapsSummary || data.allLapsSummary.length === 0) {
                    BrakeState.baselineLap = null;
                    BrakeState.compareLap = null;
                    BrakeState.h2hComparison = null;
                    BrakeState.comparisonMatrix = null;
                    BrakeState.allLaps = [];
                    BrakeState.baselineLapNum = null;
                    BrakeState.compareLapNum = null;

                    renderEmptySessionState();
                    calculateTrackBounds();
                    fitTrackToCanvas();
                    drawTrackMap();
                    drawTelemetryChart();
                    return;
                }

                // Session laps available
                BrakeState.baselineLap = data.baselineLap;
                BrakeState.compareLap = data.compareLap;
                BrakeState.h2hComparison = data.h2hComparison;
                BrakeState.comparisonMatrix = data.comparisonMatrix;
                BrakeState.allLaps = data.allLapsSummary || [];
                
                if (BrakeState.baselineLap) {
                    BrakeState.baselineLapNum = BrakeState.baselineLap.lapNum;
                }
                if (BrakeState.compareLap) {
                    BrakeState.compareLapNum = BrakeState.compareLap.lapNum;
                }

                updateDatasetBadge(BrakeState.isDemoMode);
                updateTrackMetadataDisplays();
                renderLapPills();
                updateDropdowns();
                updateHeroKPIs();
                calculateTrackBounds();
                fitTrackToCanvas();
                drawTrackMap();
                renderCornerQuickBar();
                renderTable();
                drawTelemetryChart();
            })
            .catch(err => {
                console.error('Error loading braking data:', err);
                renderEmptySessionState();
            });
    }

    function updateTrackMetadataDisplays() {
        if (DOM.trackNameDisplay) DOM.trackNameDisplay.textContent = BrakeState.trackName.toUpperCase();
        if (DOM.trackLengthDisplay) DOM.trackLengthDisplay.textContent = `${(BrakeState.trackLength || 5278).toLocaleString()} M`;
        
        const zoneCount = BrakeState.baselineLap?.brakingZones?.length || BrakeState.comparisonMatrix?.corners?.length || 6;
        if (DOM.trackZonesDisplay) DOM.trackZonesDisplay.textContent = `${zoneCount} BRAKE ZONES`;

        if (DOM.mapSpecTrackName) DOM.mapSpecTrackName.textContent = `${BrakeState.trackName.toUpperCase()} GRAND PRIX CIRCUIT`;
        if (DOM.mapSpecDetails) {
            const drsCount = BrakeState.trackMeta?.drsZones?.length || 4;
            DOM.mapSpecDetails.textContent = `${(BrakeState.trackLength || 5278).toLocaleString()}m • ${zoneCount} Corner Events • ${drsCount} DRS Zones`;
        }
    }

    function renderEmptySessionState() {
        updateDatasetBadge(false);

        if (DOM.lapPillList) {
            DOM.lapPillList.innerHTML = `<div class="loading-laps-pill" style="color:var(--neon-yellow);">STREAM ONLINE • WAITING FOR LAP 1 COMPLETION ON TRACK...</div>`;
        }
        if (DOM.baselineLapSelect) {
            DOM.baselineLapSelect.innerHTML = `<option value="">Waiting for session lap...</option>`;
        }
        if (DOM.compareLapSelect) {
            DOM.compareLapSelect.innerHTML = `<option value="">No challenger lap</option>`;
        }

        if (DOM.baselineLapBadge) DOM.baselineLapBadge.textContent = 'LAP --';
        if (DOM.baselineLapTime) DOM.baselineLapTime.textContent = '--:--.---';
        if (DOM.baselineBrakingDist) DOM.baselineBrakingDist.textContent = '-- m';
        if (DOM.baselineZonesCount) DOM.baselineZonesCount.textContent = '0 Zones';
        if (DOM.baselineDecelG) DOM.baselineDecelG.textContent = '-- G';

        if (DOM.kpiLapTime) DOM.kpiLapTime.textContent = '--:--.---';
        if (DOM.kpiLapDelta) DOM.kpiLapDelta.textContent = 'WAITING FOR LAP 1';
        if (DOM.kpiTotalBraking) DOM.kpiTotalBraking.textContent = '-- m';
        if (DOM.kpiBrakingDelta) DOM.kpiBrakingDelta.textContent = 'Session active';
        if (DOM.kpiAvgDecel) DOM.kpiAvgDecel.textContent = '-- G';
        if (DOM.kpiPeakDecel) DOM.kpiPeakDecel.textContent = 'Peak -- G';
        if (DOM.kpiEfficiencyIndex) DOM.kpiEfficiencyIndex.textContent = '--%';
        if (DOM.kpiTotalZones) DOM.kpiTotalZones.textContent = '0';
        if (DOM.kpiSessionLapsCount) DOM.kpiSessionLapsCount.textContent = '0 Session Laps Driven';

        if (DOM.brakingTableHead) {
            DOM.brakingTableHead.innerHTML = `
                <tr>
                    <th>Corner / Zone</th>
                    <th>Track Dist</th>
                    <th class="baseline-col">Baseline Lap</th>
                    <th class="lap-col">Status</th>
                </tr>
            `;
        }
        if (DOM.brakingTableBody) {
            DOM.brakingTableBody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align:center; padding: 48px 24px;">
                        <div style="font-family:var(--font-heading); font-size:1.15rem; color:var(--neon-cyan); letter-spacing:1.5px; margin-bottom:8px;">
                            🏁 LIVE SESSION CONNECTED &bull; ${BrakeState.trackName.toUpperCase()}
                        </div>
                        <div style="font-family:var(--font-mono); font-size:0.85rem; color:var(--text-secondary); max-width:540px; margin:0 auto 14px; line-height:1.6;">
                            Telemetry engine is actively tracking live session data. Complete Lap 1 on track to automatically generate the full circuit braking map, corner apex pins, and multi-lap delta matrix.
                        </div>
                        <div style="font-family:var(--font-mono); font-size:0.75rem; color:var(--neon-green); display:flex; align-items:center; justify-content:center; gap:8px;">
                            <span class="live-pulse-dot" style="display:inline-block;"></span>
                            <span>TELEMETRY STREAM ONLINE &bull; READY</span>
                        </div>
                    </td>
                </tr>
            `;
        }
    }

    function loadDemoData() {
        fetch(`/api/session/demo-braking-laps?trackId=${BrakeState.currentTrackId}`)
            .then(r => r.json())
            .then(data => {
                if (data.laps && data.laps.length > 0) {
                    BrakeState.isDemoMode = true;
                    BrakeState.allLaps = data.laps;
                    updateDatasetBadge(true);
                    showToast('Loaded Benchmark Demo Session Dataset');
                    loadTrackBrakingData(BrakeState.currentTrackId, 1, 2);
                }
            })
            .catch(() => {});
    }

    function toggleDemoOrLive() {
        if (BrakeState.isDemoMode) {
            BrakeState.isDemoMode = false;
            updateDatasetBadge(false);
            showToast('Switched to Live Session Data');
            loadTrackBrakingData(BrakeState.currentTrackId);
        } else {
            loadDemoData();
        }
    }

    function updateDatasetBadge(isDemo) {
        if (DOM.btnDemoText) {
            DOM.btnDemoText.textContent = isDemo ? 'LIVE SESSION' : 'DEMO BENCHMARK';
        }
        if (DOM.btnDemo) {
            DOM.btnDemo.classList.toggle('demo-active', isDemo);
        }
        if (DOM.sessionDatasetTag) {
            if (isDemo) {
                DOM.sessionDatasetTag.textContent = 'DEMO BENCHMARK DATA';
                DOM.sessionDatasetTag.style.background = 'rgba(255, 209, 0, 0.12)';
                DOM.sessionDatasetTag.style.color = 'var(--neon-yellow)';
                DOM.sessionDatasetTag.style.borderColor = 'rgba(255, 209, 0, 0.35)';
            } else {
                DOM.sessionDatasetTag.textContent = 'LIVE SESSION DATA';
                DOM.sessionDatasetTag.style.background = 'rgba(0, 255, 102, 0.1)';
                DOM.sessionDatasetTag.style.color = 'var(--neon-green)';
                DOM.sessionDatasetTag.style.borderColor = 'rgba(0, 255, 102, 0.3)';
            }
        }
    }

    // ══════════ INTERACTIVE LAP PILLS RIBBON ══════════
    function renderLapPills() {
        if (!DOM.lapPillList) return;
        DOM.lapPillList.innerHTML = '';

        if (!BrakeState.allLaps || BrakeState.allLaps.length === 0) {
            DOM.lapPillList.innerHTML = `<div class="loading-laps-pill">No session laps recorded yet</div>`;
            return;
        }

        BrakeState.allLaps.forEach(l => {
            const isBase = (l.lapNum === BrakeState.baselineLapNum);
            const isComp = (l.lapNum === BrakeState.compareLapNum);

            const pill = document.createElement('div');
            pill.className = `lap-pill-btn ${isBase ? 'baseline-active' : ''} ${isComp && BrakeState.viewMode === 'h2h' ? 'challenger-active' : ''}`;
            pill.title = `Lap ${l.lapNum} • Time: ${formatMs(l.lapTimeMs)} • Total Braking: ${l.totalBrakingDist}m`;

            let roleTag = '';
            if (isBase) {
                roleTag = `<span class="lap-role-tag cyan">BASELINE</span>`;
            } else if (isComp && BrakeState.viewMode === 'h2h') {
                roleTag = `<span class="lap-role-tag magenta">CHALLENGER</span>`;
            }

            const pbHtml = l.isPersonalBest ? `<span class="lap-pill-pb">★ PB</span>` : '';

            pill.innerHTML = `
                ${roleTag}
                <div class="lap-pill-header">
                    <span class="lap-pill-num">LAP ${String(l.lapNum).padStart(2, '0')}</span>
                    ${pbHtml}
                </div>
                <div class="lap-pill-time">${formatMs(l.lapTimeMs)}</div>
                <div class="lap-pill-sub">
                    <span>${l.brakingZonesCount || 0} Zones</span>
                    <span class="braking-m">${l.totalBrakingDist || 0}m</span>
                </div>
            `;

            pill.addEventListener('click', () => {
                if (BrakeState.viewMode === 'h2h') {
                    if (l.lapNum === BrakeState.baselineLapNum) {
                        // Already baseline
                        return;
                    }
                    if (BrakeState.compareLapNum === l.lapNum) {
                        // Toggle to make this the baseline
                        loadTrackBrakingData(BrakeState.currentTrackId, l.lapNum, BrakeState.baselineLapNum);
                    } else {
                        // Set as new comparison challenger lap
                        loadTrackBrakingData(BrakeState.currentTrackId, BrakeState.baselineLapNum, l.lapNum);
                    }
                } else {
                    // Set as baseline
                    loadTrackBrakingData(BrakeState.currentTrackId, l.lapNum, BrakeState.compareLapNum);
                }
            });

            DOM.lapPillList.appendChild(pill);
        });
    }

    // ══════════ DROPDOWNS & ACTIVE HUD CARDS ══════════
    function updateDropdowns() {
        // Baseline Selector
        if (DOM.baselineLapSelect) {
            DOM.baselineLapSelect.innerHTML = '';
            BrakeState.allLaps.forEach(l => {
                const opt = document.createElement('option');
                opt.value = l.lapNum;
                const timeStr = formatMs(l.lapTimeMs);
                const pbTag = l.isPersonalBest ? ' ★ PB' : '';
                opt.textContent = `Lap ${l.lapNum} (${timeStr})${pbTag} - ${l.totalBrakingDist}m`;
                if (l.lapNum === BrakeState.baselineLapNum) opt.selected = true;
                DOM.baselineLapSelect.appendChild(opt);
            });
        }

        // Compare Selector
        if (DOM.compareLapSelect) {
            DOM.compareLapSelect.innerHTML = '';
            BrakeState.allLaps.forEach(l => {
                const opt = document.createElement('option');
                opt.value = l.lapNum;
                const timeStr = formatMs(l.lapTimeMs);
                opt.textContent = `Lap ${l.lapNum} (${timeStr}) - ${l.totalBrakingDist}m`;
                if (l.lapNum === BrakeState.compareLapNum) opt.selected = true;
                DOM.compareLapSelect.appendChild(opt);
            });
        }

        // Baseline Card UI
        if (BrakeState.baselineLap) {
            const b = BrakeState.baselineLap;
            if (DOM.baselineLapBadge) DOM.baselineLapBadge.textContent = `LAP ${b.lapNum}`;
            if (DOM.baselineLapTime) DOM.baselineLapTime.textContent = formatMs(b.lapTimeMs);
            if (DOM.baselineBrakingDist) DOM.baselineBrakingDist.textContent = `${b.totalBrakingDist} m`;
            if (DOM.baselineZonesCount) DOM.baselineZonesCount.textContent = `${b.brakingZones?.length || 0} Zones`;
            if (DOM.baselineDecelG) DOM.baselineDecelG.textContent = `${b.avgDecelG} G`;
        }

        // Compare Card UI
        if (BrakeState.compareLap && BrakeState.baselineLap) {
            const c = BrakeState.compareLap;
            const b = BrakeState.baselineLap;
            const timeDelta = c.lapTimeMs - b.lapTimeMs;
            const distDelta = c.totalBrakingDist - b.totalBrakingDist;

            if (DOM.compareLapBadge) DOM.compareLapBadge.textContent = `LAP ${c.lapNum}`;
            if (DOM.compareLapTime) DOM.compareLapTime.textContent = formatMs(c.lapTimeMs);
            if (DOM.compareBrakingDist) DOM.compareBrakingDist.textContent = `${c.totalBrakingDist} m`;
            
            if (DOM.compareTimeDelta) {
                const sign = timeDelta >= 0 ? '+' : '';
                DOM.compareTimeDelta.textContent = `${sign}${(timeDelta/1000).toFixed(3)}s`;
                DOM.compareTimeDelta.style.color = timeDelta <= 0 ? 'var(--neon-green)' : 'var(--neon-red)';
            }

            if (DOM.compareDistDelta) {
                const sign = distDelta >= 0 ? '+' : '';
                DOM.compareDistDelta.textContent = `${sign}${distDelta}m`;
                DOM.compareDistDelta.style.color = distDelta <= 0 ? 'var(--neon-green)' : 'var(--neon-red)';
            }
        }
    }

    function updateHeroKPIs() {
        if (!BrakeState.baselineLap) return;
        const b = BrakeState.baselineLap;
        const c = BrakeState.compareLap;

        if (DOM.kpiLapTime) DOM.kpiLapTime.textContent = formatMs(b.lapTimeMs);
        if (DOM.kpiTotalBraking) DOM.kpiTotalBraking.textContent = `${b.totalBrakingDist} m`;
        if (DOM.kpiAvgDecel) DOM.kpiAvgDecel.textContent = `${b.avgDecelG} G`;
        
        const zoneCount = b.brakingZones?.length || BrakeState.comparisonMatrix?.corners?.length || 0;
        if (DOM.kpiTotalZones) DOM.kpiTotalZones.textContent = `${zoneCount}`;
        if (DOM.kpiSessionLapsCount) DOM.kpiSessionLapsCount.textContent = `${BrakeState.allLaps.length} Session Laps Driven`;

        const peakG = (b.brakingZones || []).reduce((max, z) => Math.max(max, z.avgDecelG || 0), 0);
        if (DOM.kpiPeakDecel) DOM.kpiPeakDecel.textContent = `Peak ${peakG.toFixed(1)}G in T1`;

        // If in H2H mode and comparison lap active, show deltas
        if (BrakeState.viewMode === 'h2h' && c) {
            const distDelta = c.totalBrakingDist - b.totalBrakingDist;
            const timeDelta = c.lapTimeMs - b.lapTimeMs;
            
            if (DOM.kpiBrakingDelta) {
                DOM.kpiBrakingDelta.textContent = distDelta >= 0 ? `+${distDelta}m longer than baseline` : `${Math.abs(distDelta)}m shorter than baseline`;
                DOM.kpiBrakingDelta.className = `hero-kpi-sub ${distDelta <= 0 ? 'delta-shorter' : 'delta-longer'}`;
            }

            if (DOM.kpiLapDelta) {
                DOM.kpiLapDelta.textContent = (timeDelta >= 0 ? `+${(timeDelta/1000).toFixed(3)}s vs baseline` : `${(timeDelta/1000).toFixed(3)}s vs baseline`);
                DOM.kpiLapDelta.className = `hero-kpi-sub ${timeDelta <= 0 ? 'delta-shorter' : 'delta-longer'}`;
            }
        } else {
            if (DOM.kpiBrakingDelta) {
                const pct = ((b.totalBrakingDist / (BrakeState.trackLength || 5278)) * 100).toFixed(1);
                DOM.kpiBrakingDelta.textContent = `${pct}% of lap under deceleration`;
                DOM.kpiBrakingDelta.className = 'hero-kpi-sub';
            }
            if (DOM.kpiLapDelta) {
                DOM.kpiLapDelta.textContent = b.isPersonalBest ? 'PERSONAL BEST' : (b.isValid ? 'VALID SESSION LAP' : 'INVALIDATED LAP');
                DOM.kpiLapDelta.className = `hero-kpi-sub ${b.isValid ? 'delta-shorter' : 'delta-longer'}`;
            }
        }

        // Efficiency score
        let efficiency = 95;
        if (b.totalBrakingDist > 0 && b.lapTimeMs > 0) {
            const ratio = (b.totalBrakingDist / (BrakeState.trackLength || 5278)) * 100;
            efficiency = Math.min(99, Math.max(72, Math.round(100 - (ratio * 0.45))));
        }
        if (DOM.kpiEfficiencyIndex) DOM.kpiEfficiencyIndex.textContent = `${efficiency}%`;
    }

    // ══════════ CIRCUIT TRACK MAP RENDERING (CANVAS) ══════════
    function calculateTrackBounds() {
        const pts = BrakeState.trackPoints;
        if (!pts || pts.length < 5) return;

        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        pts.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.z < minZ) minZ = p.z;
            if (p.z > maxZ) maxZ = p.z;
        });

        const width = Math.max(10, maxX - minX);
        const height = Math.max(10, maxZ - minZ);
        BrakeState.map.bounds = {
            minX, maxX, minZ, maxZ,
            width, height,
            midX: (minX + maxX) / 2,
            midZ: (minZ + maxZ) / 2
        };
    }

    function fitTrackToCanvas() {
        const canvas = DOM.circuitMapCanvas;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
        BrakeState.map.ctx = canvas.getContext('2d');
        BrakeState.map.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const b = BrakeState.map.bounds;
        if (!b || b.width <= 0 || b.height <= 0) return;

        // Balanced padding to center circuit nicely inside the radar view
        const padding = 50;
        const availW = rect.width - padding * 2;
        const availH = rect.height - padding * 2;

        const scaleX = availW / b.width;
        const scaleZ = availH / b.height;
        const fitScale = Math.min(scaleX, scaleZ);

        BrakeState.map.baseScale = fitScale;
        BrakeState.map.scale = fitScale;
        BrakeState.map.offsetX = rect.width / 2;
        BrakeState.map.offsetY = rect.height / 2;
    }

    function worldToScreen(wx, wz) {
        const b = BrakeState.map.bounds;
        const sx = BrakeState.map.offsetX + (wx - b.midX) * BrakeState.map.scale;
        // Invert Z for standard overhead 2D view
        const sy = BrakeState.map.offsetY - (wz - b.midZ) * BrakeState.map.scale;
        return { x: sx, y: sy };
    }

    function drawTrackMap() {
        const ctx = BrakeState.map.ctx;
        const canvas = DOM.circuitMapCanvas;
        if (!ctx || !canvas) return;

        const rect = canvas.getBoundingClientRect();
        ctx.clearRect(0, 0, rect.width, rect.height);

        const pts = BrakeState.trackPoints;
        if (!pts || pts.length < 5) {
            ctx.fillStyle = '#64748b';
            ctx.font = '13px "Roboto Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText('Loading circuit track coordinates...', rect.width / 2, rect.height / 2);
            return;
        }

        // 1. Draw circuit dark asphalt road background & outer boundary
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
            const sc = worldToScreen(pts[i].x, pts[i].z);
            if (i === 0) ctx.moveTo(sc.x, sc.y);
            else ctx.lineTo(sc.x, sc.y);
        }
        ctx.closePath();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Outer glow
        ctx.lineWidth = 14;
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
        ctx.stroke();

        // Asphalt track groove
        ctx.lineWidth = 8;
        ctx.strokeStyle = '#182030';
        ctx.stroke();

        // Main track centerline (Full Throttle Neon Cyan)
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = '#00f0ff';
        ctx.stroke();
        ctx.restore();

        // 2. Draw DRS Activation Zones (if available and enabled)
        if (BrakeState.showDrs && BrakeState.trackMeta?.drsZones && BrakeState.trackMeta.drsZones.length > 0) {
            ctx.save();
            BrakeState.trackMeta.drsZones.forEach(drs => {
                if (drs.start && drs.end && drs.start.x !== undefined) {
                    const sPt = worldToScreen(drs.start.x, drs.start.z);
                    const ePt = worldToScreen(drs.end.x, drs.end.z);
                    ctx.strokeStyle = '#00ff66';
                    ctx.lineWidth = 5;
                    ctx.shadowColor = 'rgba(0, 255, 102, 0.7)';
                    ctx.shadowBlur = 8;
                    ctx.beginPath();
                    ctx.moveTo(sPt.x, sPt.y);
                    ctx.lineTo(ePt.x, ePt.y);
                    ctx.stroke();
                }
            });
            ctx.restore();
        }

        // 3. Draw Sectors S1 & S2 split lines (if available)
        if (BrakeState.trackMeta?.sector1) {
            const s1 = worldToScreen(BrakeState.trackMeta.sector1.x, BrakeState.trackMeta.sector1.z);
            ctx.save();
            ctx.fillStyle = '#ffd100';
            ctx.beginPath();
            ctx.arc(s1.x, s1.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.font = 'bold 8px "Roboto Mono", monospace';
            ctx.fillText('S1', s1.x + 8, s1.y + 3);
            ctx.restore();
        }
        if (BrakeState.trackMeta?.sector2) {
            const s2 = worldToScreen(BrakeState.trackMeta.sector2.x, BrakeState.trackMeta.sector2.z);
            ctx.save();
            ctx.fillStyle = '#ffd100';
            ctx.beginPath();
            ctx.arc(s2.x, s2.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.font = 'bold 8px "Roboto Mono", monospace';
            ctx.fillText('S2', s2.x + 8, s2.y + 3);
            ctx.restore();
        }

        // 4. Highlight Braking Zones on the Track (Hot Thermal Gradient)
        const baselineZones = BrakeState.baselineLap?.brakingZones || [];
        baselineZones.forEach((zone, zIdx) => {
            if (zone.startX !== undefined && zone.endX !== undefined) {
                const sPt = worldToScreen(zone.startX, zone.startZ);
                const ePt = worldToScreen(zone.endX, zone.endZ);

                ctx.save();
                ctx.shadowColor = 'rgba(255, 30, 0, 0.9)';
                ctx.shadowBlur = 14;
                ctx.lineWidth = 7;
                ctx.strokeStyle = '#ff1e00';
                ctx.beginPath();
                ctx.moveTo(sPt.x, sPt.y);
                ctx.lineTo(ePt.x, ePt.y);
                ctx.stroke();
                ctx.restore();
            }
        });

        // 5. Draw Baseline Braking Markers (Pins: B1, B2, ...)
        baselineZones.forEach((zone, zIdx) => {
            if (zone.startX === undefined || zone.startZ === undefined) return;
            const pt = worldToScreen(zone.startX, zone.startZ);
            const isSelected = (BrakeState.selectedCornerIndex === zIdx);
            const isHovered = (BrakeState.hoverZoneIndex === zIdx);

            // Pulsing highlight ring if selected or hovered
            if (isSelected || isHovered) {
                ctx.save();
                ctx.strokeStyle = '#00f0ff';
                ctx.lineWidth = isSelected ? 3 : 2;
                ctx.shadowColor = 'rgba(0, 240, 255, 0.9)';
                ctx.shadowBlur = 12;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, isSelected ? 18 : 15, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }

            // Pin badge background
            ctx.save();
            ctx.shadowColor = isSelected ? 'rgba(0, 240, 255, 0.8)' : 'rgba(255, 30, 0, 0.7)';
            ctx.shadowBlur = 8;
            ctx.fillStyle = isSelected ? '#00f0ff' : '#ff1e00';
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 10, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = isSelected ? '#000' : '#fff';
            ctx.font = 'bold 9px "Roboto Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`B${zone.zoneIndex}`, pt.x, pt.y);
            ctx.restore();

            // Distance label
            ctx.fillStyle = isSelected ? '#00f0ff' : '#cbd5e1';
            ctx.font = 'bold 9px "Roboto Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`${zone.brakingDist}m`, pt.x, pt.y + 16);
        });

        // 6. In H2H mode: Draw Challenger Lap pins in Magenta
        if (BrakeState.viewMode === 'h2h' && BrakeState.compareLap) {
            const compareZones = BrakeState.compareLap.brakingZones || [];
            compareZones.forEach((cZone) => {
                if (cZone.startX === undefined) return;
                const cPt = worldToScreen(cZone.startX, cZone.startZ);

                ctx.save();
                ctx.fillStyle = '#ff2a85';
                ctx.shadowColor = 'rgba(255, 42, 133, 0.8)';
                ctx.shadowBlur = 8;
                ctx.beginPath();
                ctx.arc(cPt.x, cPt.y, 7, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#fff';
                ctx.font = 'bold 7px "Roboto Mono", monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`C`, cPt.x, cPt.y);
                ctx.restore();
            });
        }

        // 7. Draw Start/Finish Line Gate
        if (pts.length > 0) {
            const sf = worldToScreen(pts[0].x, pts[0].z);
            ctx.save();
            ctx.fillStyle = '#ffd100';
            ctx.shadowColor = 'rgba(255, 209, 0, 0.8)';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(sf.x, sf.y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // 8. Synchronized Car Position Dot (When scrubbing on graph)
        if (BrakeState.graph.scrubDist !== null && pts.length > 0) {
            const scrubPt = findPointAtDistance(BrakeState.graph.scrubDist);
            if (scrubPt) {
                const sScreen = worldToScreen(scrubPt.x, scrubPt.z);
                ctx.save();
                ctx.strokeStyle = '#ffd100';
                ctx.lineWidth = 3;
                ctx.shadowColor = '#ffd100';
                ctx.shadowBlur = 16;
                ctx.beginPath();
                ctx.arc(sScreen.x, sScreen.y, 9, 0, Math.PI * 2);
                ctx.stroke();

                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(sScreen.x, sScreen.y, 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }
    }

    function findPointAtDistance(targetDist) {
        const tel = BrakeState.baselineLap?.telemetry;
        if (!tel || tel.length === 0) return null;

        for (let i = 0; i < tel.length; i++) {
            if (tel[i].d >= targetDist) {
                return tel[i];
            }
        }
        return tel[tel.length - 1];
    }

    // ══════════ QUICK CORNER NAVIGATION BAR ══════════
    function renderCornerQuickBar() {
        if (!DOM.cornerQuickPills) return;
        DOM.cornerQuickPills.innerHTML = '';

        const zones = BrakeState.baselineLap?.brakingZones || BrakeState.comparisonMatrix?.corners || [];
        zones.forEach((z, idx) => {
            const pill = document.createElement('button');
            pill.type = 'button';
            pill.className = `quick-corner-pill ${BrakeState.selectedCornerIndex === idx ? 'active' : ''}`;
            const name = z.name || `T${idx + 1}`;
            const dist = z.brakingDist || z.baselineBrakingDist || 0;
            pill.textContent = `${name} • ${dist}m`;
            
            pill.addEventListener('click', () => {
                selectCorner(idx);
            });

            pill.addEventListener('mouseenter', () => {
                BrakeState.hoverZoneIndex = idx;
                drawTrackMap();
            });

            pill.addEventListener('mouseleave', () => {
                BrakeState.hoverZoneIndex = null;
                drawTrackMap();
            });

            DOM.cornerQuickPills.appendChild(pill);
        });
    }

    // ══════════ DYNAMIC TABLES RENDERING ══════════
    function renderTable() {
        if (!DOM.brakingTableHead || !DOM.brakingTableBody) return;

        if (BrakeState.viewMode === 'matrix') {
            renderMatrixTable();
        } else if (BrakeState.viewMode === 'h2h') {
            renderH2HTable();
        } else {
            renderSingleLapTable();
        }
    }

    // Mode 1: ALL LAPS COMPARISON MATRIX (User's primary request)
    function renderMatrixTable() {
        if (DOM.tableTitle) DOM.tableTitle.textContent = 'MULTI-LAP BRAKING DISTANCE MATRIX';

        const matrix = BrakeState.comparisonMatrix;
        if (!matrix || !matrix.corners || matrix.corners.length === 0) {
            DOM.brakingTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:#64748b;">No multi-lap braking matrix available for this session.</td></tr>`;
            return;
        }

        const bLap = BrakeState.baselineLap;
        const allLaps = BrakeState.allLaps || [];

        // Build Table Header
        let headHtml = `<tr>
            <th>Corner / Zone</th>
            <th>Track Dist</th>
            <th class="baseline-col">Baseline (Lap ${bLap?.lapNum || 1})</th>`;

        allLaps.forEach(l => {
            if (l.lapNum !== bLap?.lapNum) {
                const pbIcon = l.isPersonalBest ? '★ ' : '';
                headHtml += `<th class="lap-col">Lap ${l.lapNum} (${pbIcon}${formatMs(l.lapTimeMs)})</th>`;
            }
        });
        headHtml += `</tr>`;
        DOM.brakingTableHead.innerHTML = headHtml;

        // Build Table Body
        let bodyHtml = '';
        matrix.corners.forEach((c, idx) => {
            const isSelected = (BrakeState.selectedCornerIndex === idx);
            const isHovered = (BrakeState.hoverZoneIndex === idx);
            
            bodyHtml += `<tr class="${isSelected || isHovered ? 'active-corner-row' : ''}" 
                onclick="window.selectCorner(${idx})" 
                onmouseenter="window.setCornerHover(${idx})" 
                onmouseleave="window.clearCornerHover()">
                <td>
                    <div class="corner-label-cell">
                        <span class="corner-pin-badge">B${c.zoneIndex}</span>
                        <span>${c.name}</span>
                    </div>
                </td>
                <td style="color:#94a3b8;">${c.trackDist} m</td>
                <td style="color:var(--neon-cyan); font-weight:700;">
                    ${c.baselineBrakingDist} m
                    <span style="font-size:0.65rem; color:#64748b; margin-left:6px;">(${c.baselineEntrySpeed} &rarr; ${c.baselineMinSpeed} km/h)</span>
                </td>`;

            allLaps.forEach(l => {
                if (l.lapNum !== bLap?.lapNum) {
                    const lData = c.laps ? c.laps[l.lapNum] : null;
                    if (lData) {
                        const d = lData.distDelta;
                        let badgeClass = 'neutral';
                        let sign = '';
                        if (d < 0) { badgeClass = 'shorter'; sign = ''; }
                        else if (d > 0) { badgeClass = 'longer'; sign = '+'; }

                        const bpDelta = lData.brakePointDelta;
                        let bpText = '';
                        if (bpDelta > 0) bpText = `<span class="delta-pill-later">+${bpDelta}m later</span>`;
                        else if (bpDelta < 0) bpText = `<span class="delta-pill-earlier">${Math.abs(bpDelta)}m earlier</span>`;
                        else bpText = `<span style="color:#64748b;">same</span>`;

                        bodyHtml += `<td>
                            <span style="font-weight:700;">${lData.brakingDist} m</span>
                            <span class="delta-badge ${badgeClass}">${sign}${d}m</span>
                            <div style="font-size:0.62rem; margin-top:2px;">${bpText} &bull; ${lData.entrySpeed} &rarr; ${lData.minSpeed}</div>
                        </td>`;
                    } else {
                        bodyHtml += `<td style="color:#475569;">--</td>`;
                    }
                }
            });

            bodyHtml += `</tr>`;
        });

        // Total Row at bottom
        let totalHtml = `<tr class="total-summary-row">
            <td>TOTAL LAP BRAKING</td>
            <td>--</td>
            <td>${bLap?.totalBrakingDist || 0} m</td>`;

        allLaps.forEach(l => {
            if (l.lapNum !== bLap?.lapNum) {
                const diff = (l.totalBrakingDist || 0) - (bLap?.totalBrakingDist || 0);
                const sign = diff > 0 ? '+' : '';
                const badgeClass = diff <= 0 ? 'shorter' : 'longer';
                totalHtml += `<td>
                    <span>${l.totalBrakingDist || 0} m</span>
                    <span class="delta-badge ${badgeClass}">${sign}${diff}m</span>
                </td>`;
            }
        });
        totalHtml += `</tr>`;

        bodyHtml += totalHtml;
        DOM.brakingTableBody.innerHTML = bodyHtml;
    }

    // Mode 2: HEAD-TO-HEAD COMPARISON
    function renderH2HTable() {
        if (DOM.tableTitle) DOM.tableTitle.textContent = 'HEAD-TO-HEAD CORNER BRAKING COMPARISON';

        const h2h = BrakeState.h2hComparison;
        if (!h2h || !h2h.zones || h2h.zones.length === 0) {
            DOM.brakingTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#64748b;">Select two laps to compare head-to-head.</td></tr>`;
            return;
        }

        const lapA = h2h.lapA;
        const lapB = h2h.lapB;

        DOM.brakingTableHead.innerHTML = `<tr>
            <th>Zone</th>
            <th>Corner</th>
            <th>Brake Point (m)</th>
            <th class="baseline-col">Lap ${lapA?.lapNum} Distance</th>
            <th style="color:var(--neon-magenta);">Lap ${lapB?.lapNum} Distance</th>
            <th>Distance Delta</th>
            <th>Entry &amp; Apex Speed (km/h)</th>
            <th>Decel G</th>
        </tr>`;

        let bodyHtml = '';
        h2h.zones.forEach((z, idx) => {
            const isSelected = (BrakeState.selectedCornerIndex === idx);
            const isHovered = (BrakeState.hoverZoneIndex === idx);
            const dDelta = z.brakingDistanceDelta;
            const sign = dDelta > 0 ? '+' : '';
            const deltaClass = dDelta <= 0 ? 'shorter' : 'longer';

            let bpText = '';
            if (z.brakePointDelta > 0) bpText = `<span class="delta-pill-later">+${z.brakePointDelta}m later</span>`;
            else if (z.brakePointDelta < 0) bpText = `<span class="delta-pill-earlier">${Math.abs(z.brakePointDelta)}m earlier</span>`;
            else bpText = `<span style="color:#64748b;">Same</span>`;

            bodyHtml += `<tr class="${isSelected || isHovered ? 'active-corner-row' : ''}" 
                onclick="window.selectCorner(${idx})" 
                onmouseenter="window.setCornerHover(${idx})" 
                onmouseleave="window.clearCornerHover()">
                <td><span class="corner-pin-badge">B${z.zoneIndex}</span></td>
                <td style="font-weight:700;">${z.name}</td>
                <td>
                    ${z.baseline.startDist}m vs ${z.comparison?.startDist || '--'}m
                    <div style="font-size:0.62rem;">${bpText}</div>
                </td>
                <td style="color:var(--neon-cyan); font-weight:700;">${z.baseline.brakingDist} m</td>
                <td style="color:var(--neon-magenta); font-weight:700;">${z.comparison ? z.comparison.brakingDist + ' m' : '--'}</td>
                <td>
                    <span class="delta-badge ${deltaClass}">${sign}${dDelta}m</span>
                </td>
                <td style="font-size:0.72rem;">
                    ${z.baseline.entrySpeed} &rarr; ${z.baseline.minSpeed}
                    <span style="color:#94a3b8; font-size:0.65rem; margin-left:4px;">(Δ ${z.entrySpeedDelta >= 0 ? '+' : ''}${z.entrySpeedDelta})</span>
                </td>
                <td>${z.baseline.avgDecelG}G</td>
            </tr>`;
        });

        // Totals row
        const totalDelta = h2h.totalBrakingDistanceDelta;
        const totalSign = totalDelta > 0 ? '+' : '';
        const totalClass = totalDelta <= 0 ? 'shorter' : 'longer';

        bodyHtml += `<tr class="total-summary-row">
            <td colspan="3">TOTAL LAP BRAKING</td>
            <td>${lapA?.totalBrakingDist || 0} m</td>
            <td>${lapB ? lapB.totalBrakingDist + ' m' : '--'}</td>
            <td><span class="delta-badge ${totalClass}">${totalSign}${totalDelta}m</span></td>
            <td colspan="2">Lap Time Δ: ${(h2h.lapTimeDeltaMs/1000).toFixed(3)}s</td>
        </tr>`;

        DOM.brakingTableBody.innerHTML = bodyHtml;
    }

    // Mode 3: SINGLE LAP DEEP DIVE
    function renderSingleLapTable() {
        if (DOM.tableTitle) DOM.tableTitle.textContent = 'SINGLE LAP CORNER BRAKING TELEMETRY DEEP DIVE';

        const lap = BrakeState.baselineLap;
        if (!lap || !lap.brakingZones || lap.brakingZones.length === 0) {
            DOM.brakingTableBody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:30px; color:#64748b;">No braking data for this lap.</td></tr>`;
            return;
        }

        DOM.brakingTableHead.innerHTML = `<tr>
            <th>Zone</th>
            <th>Corner</th>
            <th>Brake Start (m)</th>
            <th>Brake End (m)</th>
            <th class="baseline-col">Braking Distance</th>
            <th>Entry Speed</th>
            <th>Apex Speed</th>
            <th>Speed Drop</th>
            <th>Peak Brake</th>
            <th>Duration</th>
            <th>Decel G</th>
        </tr>`;

        let bodyHtml = '';
        lap.brakingZones.forEach((z, idx) => {
            const isSelected = (BrakeState.selectedCornerIndex === idx);
            const isHovered = (BrakeState.hoverZoneIndex === idx);

            bodyHtml += `<tr class="${isSelected || isHovered ? 'active-corner-row' : ''}" 
                onclick="window.selectCorner(${idx})" 
                onmouseenter="window.setCornerHover(${idx})" 
                onmouseleave="window.clearCornerHover()">
                <td><span class="corner-pin-badge">B${z.zoneIndex}</span></td>
                <td style="font-weight:700;">${z.name}</td>
                <td>${z.startDist} m</td>
                <td>${z.endDist} m</td>
                <td style="color:var(--neon-cyan); font-weight:800;">${z.brakingDist} m</td>
                <td>${z.entrySpeed} km/h</td>
                <td style="color:var(--neon-green); font-weight:700;">${z.minSpeed} km/h</td>
                <td style="color:var(--neon-red); font-weight:700;">-${z.speedDrop} km/h</td>
                <td>${z.peakBrake}%</td>
                <td>${z.durationSec} s</td>
                <td>${z.avgDecelG} G</td>
            </tr>`;
        });

        bodyHtml += `<tr class="total-summary-row">
            <td colspan="4">TOTAL LAP BRAKING</td>
            <td>${lap.totalBrakingDist} m</td>
            <td colspan="4">--</td>
            <td>${((lap.brakingZones.reduce((s, z) => s + z.durationMs, 0)) / 1000).toFixed(2)} s</td>
            <td>${lap.avgDecelG} G</td>
        </tr>`;

        DOM.brakingTableBody.innerHTML = bodyHtml;
    }

    // ══════════ TELEMETRY TRACE CHART (CANVAS) ══════════
    function drawTelemetryChart() {
        const canvas = DOM.telemetryChartCanvas;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        ctx.clearRect(0, 0, rect.width, rect.height);

        const lapA = BrakeState.baselineLap;
        const telA = lapA?.telemetry || [];
        const maxDist = BrakeState.trackLength || 5278;

        if (telA.length < 5) {
            ctx.fillStyle = '#64748b';
            ctx.font = '12px "Roboto Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText('No distance telemetry stream recorded for this lap.', rect.width / 2, rect.height / 2);
            return;
        }

        const padL = 40;
        const padR = 15;
        const padT = 12;
        const padB = 22;
        const plotW = rect.width - padL - padR;
        const plotH = rect.height - padT - padB;

        // 1. Draw Braking Zones shaded vertical background columns with labels
        const zones = lapA.brakingZones || [];
        zones.forEach((z, zIdx) => {
            const x1 = padL + (z.startDist / maxDist) * plotW;
            const x2 = padL + (z.endDist / maxDist) * plotW;
            const isHighlight = (BrakeState.selectedCornerIndex === zIdx || BrakeState.hoverZoneIndex === zIdx);

            ctx.fillStyle = isHighlight ? 'rgba(255, 30, 0, 0.28)' : 'rgba(255, 30, 0, 0.12)';
            ctx.fillRect(x1, padT, Math.max(3, x2 - x1), plotH);
            
            ctx.strokeStyle = isHighlight ? '#ff1e00' : 'rgba(255, 30, 0, 0.35)';
            ctx.lineWidth = isHighlight ? 1.5 : 1;
            ctx.strokeRect(x1, padT, Math.max(3, x2 - x1), plotH);

            ctx.fillStyle = isHighlight ? '#ff1e00' : '#ff7700';
            ctx.font = 'bold 9px "Roboto Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`B${z.zoneIndex}`, (x1 + x2) / 2, padT + 10);
        });

        // 2. Grid lines & Speed Y-axis labels (Speed 0..350 km/h)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        [100, 200, 300].forEach(spd => {
            const y = padT + plotH - (spd / 350) * plotH;
            ctx.beginPath();
            ctx.moveTo(padL, y);
            ctx.lineTo(padL + plotW, y);
            ctx.stroke();

            ctx.fillStyle = '#64748b';
            ctx.font = '9px "Roboto Mono", monospace';
            ctx.textAlign = 'right';
            ctx.fillText(`${spd}`, padL - 5, y + 3);
        });

        // Distance X-axis markings
        const distSteps = Math.ceil(maxDist / 1000);
        for (let km = 1; km <= distSteps; km++) {
            const d = km * 1000;
            if (d < maxDist) {
                const x = padL + (d / maxDist) * plotW;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
                ctx.beginPath();
                ctx.moveTo(x, padT);
                ctx.lineTo(x, padT + plotH);
                ctx.stroke();

                ctx.fillStyle = '#475569';
                ctx.font = '9px "Roboto Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText(`${km}k`, x, padT + plotH + 15);
            }
        }

        // 3. Draw Brake Trace (Red Fill at bottom)
        ctx.save();
        ctx.fillStyle = 'rgba(255, 30, 0, 0.4)';
        ctx.beginPath();
        ctx.moveTo(padL, padT + plotH);
        for (let i = 0; i < telA.length; i++) {
            const pt = telA[i];
            const x = padL + (pt.d / maxDist) * plotW;
            const brk = pt.brake || 0;
            const y = padT + plotH - (brk / 100) * (plotH * 0.38);
            ctx.lineTo(x, y);
        }
        ctx.lineTo(padL + plotW, padT + plotH);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // 4. Draw Compare Speed Trace (Magenta) if H2H
        const telB = BrakeState.compareLap?.telemetry || [];
        if (BrakeState.viewMode === 'h2h' && telB.length > 5) {
            ctx.save();
            ctx.strokeStyle = '#ff2a85';
            ctx.lineWidth = 2;
            ctx.shadowColor = 'rgba(255, 42, 133, 0.6)';
            ctx.shadowBlur = 6;
            ctx.beginPath();
            for (let i = 0; i < telB.length; i++) {
                const pt = telB[i];
                const x = padL + (pt.d / maxDist) * plotW;
                const y = padT + plotH - ((pt.speed || 0) / 350) * plotH;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.restore();
        }

        // 5. Draw Baseline Speed Trace (Cyan)
        ctx.save();
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2.2;
        ctx.shadowColor = 'rgba(0, 240, 255, 0.6)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        for (let i = 0; i < telA.length; i++) {
            const pt = telA[i];
            const x = padL + (pt.d / maxDist) * plotW;
            const y = padT + plotH - ((pt.speed || 0) / 350) * plotH;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();

        // 6. Scrubber needle if active hover
        if (BrakeState.graph.scrubDist !== null) {
            const sx = padL + (BrakeState.graph.scrubDist / maxDist) * plotW;
            ctx.save();
            ctx.strokeStyle = '#ffd100';
            ctx.lineWidth = 1.5;
            ctx.shadowColor = '#ffd100';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.moveTo(sx, padT);
            ctx.lineTo(sx, padT + plotH);
            ctx.stroke();
            ctx.restore();
        }
    }

    // ══════════ INTERACTION CONTROLS ══════════
    window.selectCorner = function(idx) {
        BrakeState.selectedCornerIndex = idx;
        drawTrackMap();
        renderCornerQuickBar();
        renderTable();
        
        const zone = BrakeState.baselineLap?.brakingZones?.[idx];
        if (zone) {
            showToast(`Focused on ${zone.name}: Braking Distance ${zone.brakingDist}m (from ${zone.startDist}m)`);
            // Set scrubber to start of zone
            BrakeState.graph.scrubDist = zone.startDist;
            drawTelemetryChart();
        }
    };

    window.setCornerHover = function(idx) {
        BrakeState.hoverZoneIndex = idx;
        drawTrackMap();
        drawTelemetryChart();
    };

    window.clearCornerHover = function() {
        BrakeState.hoverZoneIndex = null;
        drawTrackMap();
        drawTelemetryChart();
    };

    function setupEventListeners() {
        // Circuit Select
        if (DOM.circuitSelect) {
            DOM.circuitSelect.addEventListener('change', (e) => {
                const newTId = parseInt(e.target.value, 10);
                if (!isNaN(newTId)) {
                    BrakeState.currentTrackId = newTId;
                    BrakeState.isDemoMode = false;
                    updateDatasetBadge(false);
                    loadTrackBrakingData(newTId);
                }
            });
        }

        // Baseline Lap Select Dropdown
        if (DOM.baselineLapSelect) {
            DOM.baselineLapSelect.addEventListener('change', (e) => {
                const bNum = parseInt(e.target.value, 10);
                loadTrackBrakingData(BrakeState.currentTrackId, bNum, BrakeState.compareLapNum);
            });
        }

        // Compare Lap Select Dropdown
        if (DOM.compareLapSelect) {
            DOM.compareLapSelect.addEventListener('change', (e) => {
                const cNum = parseInt(e.target.value, 10);
                loadTrackBrakingData(BrakeState.currentTrackId, BrakeState.baselineLapNum, cNum);
            });
        }

        // View Mode Switcher
        if (DOM.btnModeMatrix) {
            DOM.btnModeMatrix.addEventListener('click', () => {
                BrakeState.viewMode = 'matrix';
                updateModeButtons();
                renderLapPills();
                renderTable();
                updateHeroKPIs();
                drawTrackMap();
                drawTelemetryChart();
            });
        }

        if (DOM.btnModeH2H) {
            DOM.btnModeH2H.addEventListener('click', () => {
                BrakeState.viewMode = 'h2h';
                updateModeButtons();
                renderLapPills();
                renderTable();
                updateHeroKPIs();
                drawTrackMap();
                drawTelemetryChart();
            });
        }

        if (DOM.btnModeSingle) {
            DOM.btnModeSingle.addEventListener('click', () => {
                BrakeState.viewMode = 'single';
                updateModeButtons();
                renderLapPills();
                renderTable();
                updateHeroKPIs();
                drawTrackMap();
                drawTelemetryChart();
            });
        }

        // Map Tools
        if (DOM.btnToggleDrs) {
            DOM.btnToggleDrs.addEventListener('click', () => {
                BrakeState.showDrs = !BrakeState.showDrs;
                DOM.btnToggleDrs.classList.toggle('active', BrakeState.showDrs);
                drawTrackMap();
            });
        }

        if (DOM.btnZoomIn) DOM.btnZoomIn.addEventListener('click', () => { BrakeState.map.scale *= 1.25; drawTrackMap(); });
        if (DOM.btnZoomOut) DOM.btnZoomOut.addEventListener('click', () => { BrakeState.map.scale *= 0.8; drawTrackMap(); });
        if (DOM.btnResetMap) DOM.btnResetMap.addEventListener('click', () => { fitTrackToCanvas(); drawTrackMap(); });

        // Action Buttons
        if (DOM.btnDemo) {
            DOM.btnDemo.addEventListener('click', () => toggleDemoOrLive());
        }

        if (DOM.btnSync) {
            DOM.btnSync.addEventListener('click', () => {
                BrakeState.isDemoMode = false;
                updateDatasetBadge(false);
                loadTrackBrakingData(BrakeState.currentTrackId, BrakeState.baselineLapNum, BrakeState.compareLapNum);
                showToast('Synchronized live session laps');
            });
        }

        if (DOM.btnExport) {
            DOM.btnExport.addEventListener('click', () => exportBrakingReport());
        }

        // Map Canvas Pan & Zoom
        const canvas = DOM.circuitMapCanvas;
        if (canvas) {
            canvas.addEventListener('mousedown', (e) => {
                BrakeState.map.isDragging = true;
                BrakeState.map.lastX = e.clientX;
                BrakeState.map.lastY = e.clientY;
            });

            window.addEventListener('mouseup', () => {
                BrakeState.map.isDragging = false;
            });

            canvas.addEventListener('mousemove', (e) => {
                if (BrakeState.map.isDragging) {
                    const dx = e.clientX - BrakeState.map.lastX;
                    const dy = e.clientY - BrakeState.map.lastY;
                    BrakeState.map.offsetX += dx;
                    BrakeState.map.offsetY += dy;
                    BrakeState.map.lastX = e.clientX;
                    BrakeState.map.lastY = e.clientY;
                    drawTrackMap();
                } else {
                    handleMapHover(e);
                }
            });

            canvas.addEventListener('mouseleave', () => {
                if (DOM.mapHoverHud) DOM.mapHoverHud.style.display = 'none';
            });

            canvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
                BrakeState.map.scale *= zoomFactor;
                drawTrackMap();
            }, { passive: false });
        }

        // Telemetry Graph Hover Scrubber
        if (DOM.telemetryChartCanvas) {
            DOM.telemetryChartCanvas.addEventListener('mousemove', (e) => {
                const rect = DOM.telemetryChartCanvas.getBoundingClientRect();
                const padL = 40;
                const plotW = rect.width - 55;
                const x = e.clientX - rect.left - padL;

                if (x >= 0 && x <= plotW) {
                    const ratio = x / plotW;
                    const dist = Math.round(ratio * (BrakeState.trackLength || 5278));
                    BrakeState.graph.scrubDist = dist;

                    // Update cursor badge
                    if (DOM.chartCursorBadge) {
                        const telA = BrakeState.baselineLap?.telemetry;
                        let spd = '--';
                        let brk = '--';
                        if (telA) {
                            const pt = telA.find(p => p.d >= dist) || telA[telA.length - 1];
                            if (pt) {
                                spd = `${Math.round(pt.speed || 0)} km/h`;
                                brk = `${Math.round(pt.brake || 0)}%`;
                            }
                        }
                        DOM.chartCursorBadge.style.display = 'block';
                        DOM.chartCursorBadge.innerHTML = `Dist: <strong style="color:#fff;">${dist}m</strong> &bull; Speed: <strong style="color:var(--neon-cyan);">${spd}</strong> &bull; Brake: <strong style="color:var(--neon-red);">${brk}</strong>`;
                    }

                    drawTelemetryChart();
                    drawTrackMap(); // Redraws car dot on circuit map!
                }
            });

            DOM.telemetryChartCanvas.addEventListener('mouseleave', () => {
                BrakeState.graph.scrubDist = null;
                if (DOM.chartCursorBadge) DOM.chartCursorBadge.style.display = 'none';
                drawTelemetryChart();
                drawTrackMap();
            });
        }

        window.addEventListener('resize', () => {
            fitTrackToCanvas();
            drawTrackMap();
            drawTelemetryChart();
        });
    }

    function handleMapHover(e) {
        if (!DOM.circuitMapCanvas || !DOM.mapHoverHud) return;
        const rect = DOM.circuitMapCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const zones = BrakeState.baselineLap?.brakingZones || [];
        let hovered = null;
        zones.forEach((z, idx) => {
            if (z.startX !== undefined) {
                const pt = worldToScreen(z.startX, z.startZ);
                const dist = Math.hypot(pt.x - mx, pt.y - my);
                if (dist < 18) hovered = { zone: z, index: idx };
            }
        });

        if (hovered) {
            const z = hovered.zone;
            BrakeState.hoverZoneIndex = hovered.index;
            DOM.mapHoverHud.style.display = 'block';
            DOM.mapHoverHud.innerHTML = `
                <div style="font-family:var(--font-heading); font-weight:800; color:var(--neon-cyan); margin-bottom:3px;">${z.name} &bull; Zone ${z.zoneIndex}</div>
                <div>Braking Dist: <strong style="color:var(--neon-red);">${z.brakingDist} m</strong> (${z.durationSec}s)</div>
                <div>Speed: <strong style="color:#fff;">${z.entrySpeed} km/h</strong> &rarr; Apex: <strong style="color:var(--neon-green);">${z.minSpeed} km/h</strong></div>
                <div>Brake Point: <strong style="color:#fff;">${z.startDist} m</strong> &bull; Peak: ${z.peakBrake}%</div>
                <div>Avg Decel: <strong style="color:var(--neon-yellow);">${z.avgDecelG} G</strong></div>
            `;
            drawTelemetryChart();
        } else {
            if (BrakeState.hoverZoneIndex !== null) {
                BrakeState.hoverZoneIndex = null;
                DOM.mapHoverHud.style.display = 'none';
                drawTelemetryChart();
            }
        }
    }

    function updateModeButtons() {
        if (DOM.btnModeMatrix) DOM.btnModeMatrix.classList.toggle('active', BrakeState.viewMode === 'matrix');
        if (DOM.btnModeH2H) DOM.btnModeH2H.classList.toggle('active', BrakeState.viewMode === 'h2h');
        if (DOM.btnModeSingle) DOM.btnModeSingle.classList.toggle('active', BrakeState.viewMode === 'single');

        const isH2H = (BrakeState.viewMode === 'h2h');
        if (DOM.compareLapCard) DOM.compareLapCard.style.display = isH2H ? 'flex' : 'none';
        if (DOM.hudVsDivider) DOM.hudVsDivider.style.display = isH2H ? 'block' : 'none';
        if (DOM.compareLapSelectWrapper) DOM.compareLapSelectWrapper.style.display = isH2H ? 'flex' : 'none';
        if (DOM.legendCompareSpeed) DOM.legendCompareSpeed.style.display = isH2H ? 'flex' : 'none';
    }

    function exportBrakingReport() {
        if (!BrakeState.baselineLap) {
            showToast('No lap data to export');
            return;
        }

        const report = {
            title: 'F1 Session Braking Analysis Report',
            exportedAt: new Date().toISOString(),
            circuit: BrakeState.trackName,
            trackId: BrakeState.currentTrackId,
            baselineLap: BrakeState.baselineLap,
            compareLap: BrakeState.compareLap,
            allLaps: BrakeState.allLaps,
            comparisonMatrix: BrakeState.comparisonMatrix
        };

        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `f1_braking_report_track_${BrakeState.currentTrackId}_lap_${BrakeState.baselineLap.lapNum}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Exported Braking Comparison JSON');
    }

    function formatMs(ms) {
        if (!ms || ms <= 0 || ms === Infinity) return '--:--.---';
        const m = Math.floor(ms / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        const millis = Math.floor(ms % 1000);
        return `${m}:${String(s).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
    }

    // --- Initialization Entry Point ---
    document.addEventListener('DOMContentLoaded', () => {
        initDOMElements();
        setupEventListeners();
        initWebSocket();
        fetchAvailableTracks();
        detectLiveTrack();
    });

})();
