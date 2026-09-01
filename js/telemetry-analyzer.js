/**
 * ════════════════════════════════════════════════════════════════════════════
 * F1 20Hz MULTI-TRACE TELEMETRY & G-G FRICTION ANALYZER (telemetry-analyzer.js)
 * Real-time 20Hz Canvas Telemetry Traces, Lap Comparator & Physics Engine
 * ════════════════════════════════════════════════════════════════════════════
 */

class F1TelemetryAnalyzer {
    constructor() {
        // 20Hz standard frequency: 200 samples = 10.0 seconds rolling telemetry trace
        this.targetHz = 20;
        this.sampleIntervalMs = 50; // 50ms per sample at 20Hz
        this.historyLength = 200;
        this.traceHistory = [];
        this.gForceHistory = [];
        this.maxG = 5.0;

        this.traceCanvas = null;
        this.traceCtx = null;
        this.gCanvas = null;
        this.gCtx = null;

        this.isStandby = true;
        this.lastSampleTime = 0;
        this.watchdogTimer = null;
        this.standbyAnimFrame = null;
        this.standbyPulse = 0;

        window.addEventListener('DOMContentLoaded', () => this.initCanvases());
        window.addEventListener('resize', () => this.resizeCanvases());
    }

    initCanvases() {
        this.traceCanvas = document.getElementById('telemetry-trace-canvas');
        if (this.traceCanvas) {
            this.traceCtx = this.traceCanvas.getContext('2d');
        }

        this.gCanvas = document.getElementById('gg-friction-canvas');
        if (this.gCanvas) {
            this.gCtx = this.gCanvas.getContext('2d');
        }

        this.resizeCanvases();

        // Start standby watchdog: if active telemetry pauses for > 1500ms, go into standby
        if (this.watchdogTimer) clearInterval(this.watchdogTimer);
        this.watchdogTimer = setInterval(() => {
            if (!this.isStandby && (Date.now() - this.lastSampleTime > 1600)) {
                this.setStandby(true);
            }
        }, 1000);

        // Initial render in standby mode
        this.setStandby(true);
    }

    resizeCanvases() {
        if (this.traceCanvas) {
            const rect = this.traceCanvas.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                const dpr = window.devicePixelRatio || 1;
                this.traceCanvas.width = Math.floor(rect.width * dpr);
                this.traceCanvas.height = Math.floor(rect.height * dpr);
                if (this.traceCtx) {
                    this.traceCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                }
            }
        }

        if (this.gCanvas) {
            const rect = this.gCanvas.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                const dpr = window.devicePixelRatio || 1;
                this.gCanvas.width = Math.floor(rect.width * dpr);
                this.gCanvas.height = Math.floor(rect.height * dpr);
                if (this.gCtx) {
                    this.gCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                }
            }
        }

        if (this.isStandby) {
            this.drawTraceChartStandby();
            this.drawGGFrictionCircle();
        } else {
            this.drawTraceChart();
            this.drawGGFrictionCircle();
        }
    }

    setStandby(isStandby) {
        this.isStandby = isStandby;

        const badge = document.getElementById('telemetry-comparator-badge');
        if (badge) {
            if (isStandby) {
                badge.textContent = 'STANDBY';
                badge.style.color = 'var(--fia-yellow)';
                badge.style.background = 'rgba(255, 209, 0, 0.12)';
                badge.style.borderColor = 'rgba(255, 209, 0, 0.3)';
            } else {
                badge.textContent = 'LIVE 20Hz';
                badge.style.color = '#00E676';
                badge.style.background = 'rgba(0, 230, 118, 0.12)';
                badge.style.borderColor = 'rgba(0, 230, 118, 0.4)';
            }
        }

        if (isStandby) {
            this.drawTraceChartStandby();
            this.drawGGFrictionCircle();
        }
    }

    pushTelemetrySample(data) {
        if (!data || !data.inputs) {
            this.setStandby(true);
            return;
        }

        // Detect if active game data is present
        const isGameActive = (data.isGameActive !== undefined) 
            ? Boolean(data.isGameActive) 
            : (Boolean(data.inputs.speed > 0 || data.inputs.rpm > 0 || (data.lap && data.lap.currentMs > 0)));

        if (!isGameActive) {
            this.setStandby(true);
            return;
        }

        // Active game data received
        const now = Date.now();
        this.lastSampleTime = now;

        if (this.isStandby) {
            this.setStandby(false);
        }

        const sample = {
            speed: data.inputs.speed || 0,
            throttle: data.inputs.throttle || 0,
            brake: data.inputs.brake || 0,
            gear: typeof data.inputs.gear === 'number' ? data.inputs.gear : (data.inputs.gear === 'N' ? 0 : (data.inputs.gear === 'R' ? -1 : 0)),
            rpm: data.inputs.rpm || 0,
            steer: data.inputs.steer || 0,
            drs: data.inputs.drs === 'OPEN' || data.inputs.drs === 1 || data.inputs.drs === true,
            time: now
        };

        this.traceHistory.push(sample);
        if (this.traceHistory.length > this.historyLength) {
            this.traceHistory.shift();
        }

        // Motion / G-Forces
        const gLat = data.motion?.gLat || 0;
        const gLong = data.motion?.gLong || 0;
        const gVert = data.motion?.gVert || 0;
        const totalG = Math.hypot(gLat, gLong);

        this.gForceHistory.push({ 
            lat: gLat, 
            long: gLong, 
            vert: gVert, 
            total: totalG, 
            throttle: sample.throttle, 
            brake: sample.brake 
        });
        
        // 20Hz G-force trail: 40 samples = 2.0 seconds trail
        if (this.gForceHistory.length > 40) {
            this.gForceHistory.shift();
        }

        this.drawTraceChart();
        this.drawGGFrictionCircle();
    }

    drawTraceChartStandby() {
        if (!this.traceCanvas || !this.traceCtx) return;

        const ctx = this.traceCtx;
        const w = this.traceCanvas.offsetWidth || (this.traceCanvas.width / (window.devicePixelRatio || 1));
        const h = this.traceCanvas.offsetHeight || (this.traceCanvas.height / (window.devicePixelRatio || 1));
        if (!w || !h) return;

        ctx.clearRect(0, 0, w, h);

        // 1. Subtle Background Grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        const gridSteps = 4;
        for (let i = 1; i < gridSteps; i++) {
            const y = (h / gridSteps) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // Vertical time grid lines (10s window: every 2s)
        const timeDivisions = 5;
        for (let i = 1; i < timeDivisions; i++) {
            const x = (w / timeDivisions) * i;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }

        // 2. Baseline Zero Trace
        const baselineY = h - (h * 0.05);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, baselineY);
        ctx.lineTo(w, baselineY);
        ctx.stroke();

        // 3. Standby HUD Overlay Badge & Text
        const cy = h / 2;
        const cx = w / 2;

        // Standby Banner
        ctx.fillStyle = 'rgba(255, 209, 0, 0.9)';
        ctx.font = 'bold 11px "Roboto Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚡ STANDBY • WAITING FOR 20Hz GAME TELEMETRY', cx, cy - 6);

        // Subtext
        ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
        ctx.font = '9px "Roboto Mono", monospace';
        ctx.fillText('10.0s COMPARATIVE BUFFER • 20Hz READY', cx, cy + 12);

        // Time axis markings
        ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.font = '8px "Roboto Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText('-10.0s', 6, h - 6);
        ctx.textAlign = 'center';
        ctx.fillText('-5.0s', w / 2, h - 6);
        ctx.textAlign = 'right';
        ctx.fillText('0.0s (LIVE)', w - 6, h - 6);
    }

    drawTraceChart() {
        if (this.isStandby) {
            this.drawTraceChartStandby();
            return;
        }

        if (!this.traceCanvas || !this.traceCtx) return;

        const ctx = this.traceCtx;
        const w = this.traceCanvas.offsetWidth || (this.traceCanvas.width / (window.devicePixelRatio || 1));
        const h = this.traceCanvas.offsetHeight || (this.traceCanvas.height / (window.devicePixelRatio || 1));
        if (!w || !h) return;

        if (this.traceHistory.length < 2) {
            this.drawTraceChartStandby();
            return;
        }

        ctx.clearRect(0, 0, w, h);

        // Background grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        const gridSteps = 4;
        for (let i = 1; i < gridSteps; i++) {
            const y = (h / gridSteps) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // Vertical time divisions (every 2.5s)
        const timeDivisions = 4;
        for (let i = 1; i < timeDivisions; i++) {
            const x = (w / timeDivisions) * i;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }

        const count = this.traceHistory.length;
        const xStep = w / (this.historyLength - 1);
        const startX = w - ((count - 1) * xStep);

        // 1. Throttle Trace (Green #00E676)
        ctx.beginPath();
        ctx.strokeStyle = '#00E676';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(0, 230, 118, 0.4)';
        ctx.shadowBlur = 4;
        for (let i = 0; i < count; i++) {
            const x = startX + (i * xStep);
            const normThrottle = Math.max(0, Math.min(100, this.traceHistory[i].throttle)) / 100;
            const y = h - (normThrottle * (h * 0.85)) - (h * 0.05);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 2. Brake Trace (Red #FF1E00)
        ctx.beginPath();
        ctx.strokeStyle = '#FF1E00';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(255, 30, 0, 0.4)';
        ctx.shadowBlur = 4;
        for (let i = 0; i < count; i++) {
            const x = startX + (i * xStep);
            const normBrake = Math.max(0, Math.min(100, this.traceHistory[i].brake)) / 100;
            const y = h - (normBrake * (h * 0.85)) - (h * 0.05);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 3. Speed Trace (Cyan #00F0FF)
        ctx.beginPath();
        ctx.strokeStyle = '#00F0FF';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(0, 240, 255, 0.4)';
        ctx.shadowBlur = 4;
        for (let i = 0; i < count; i++) {
            const x = startX + (i * xStep);
            const normSpeed = Math.min(1, Math.max(0, this.traceHistory[i].speed) / 360);
            const y = h - (normSpeed * (h * 0.85)) - (h * 0.05);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Current Live needle marker
        const lastX = w;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(lastX - 1, 0);
        ctx.lineTo(lastX - 1, h);
        ctx.stroke();
        ctx.setLineDash([]);

        // Live indicator dot on needle
        const latest = this.traceHistory[count - 1];
        if (latest) {
            const liveSpeedY = h - (Math.min(1, latest.speed / 360) * (h * 0.85)) - (h * 0.05);
            ctx.beginPath();
            ctx.arc(lastX - 2, liveSpeedY, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#00F0FF';
            ctx.fill();
        }

        // Time axis markings
        ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
        ctx.font = '8px "Roboto Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText('-10.0s', 6, h - 4);
        ctx.textAlign = 'right';
        ctx.fillText('LIVE', w - 6, h - 4);
    }

    drawGGFrictionCircle() {
        if (!this.gCanvas || !this.gCtx) return;

        const ctx = this.gCtx;
        const w = this.gCanvas.offsetWidth || (this.gCanvas.width / (window.devicePixelRatio || 1));
        const h = this.gCanvas.offsetHeight || (this.gCanvas.height / (window.devicePixelRatio || 1));
        if (!w || !h) return;

        ctx.clearRect(0, 0, w, h);

        const cx = w / 2;
        const cy = h / 2;
        const maxRadius = Math.min(cx, cy) - 10;

        // Concentric G-force Rings (1G, 2G, 3G, 4G, 5G)
        const rings = [1, 2, 3, 4, 5];
        rings.forEach(g => {
            const r = (g / this.maxG) * maxRadius;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.strokeStyle = g === 5 ? 'rgba(255, 30, 0, 0.3)' : 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Label
            ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
            ctx.font = '9px "Roboto Mono", monospace';
            ctx.fillText(`${g}G`, cx + r - 12, cy - 2);
        });

        // Crosshairs
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.moveTo(cx - maxRadius, cy);
        ctx.lineTo(cx + maxRadius, cy);
        ctx.moveTo(cx, cy - maxRadius);
        ctx.lineTo(cx, cy + maxRadius);
        ctx.stroke();

        if (this.isStandby || this.gForceHistory.length === 0) {
            // Standby center dot
            ctx.beginPath();
            ctx.arc(cx, cy, 4, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 209, 0, 0.7)';
            ctx.fill();
            return;
        }

        // G-Force Vector History Trail
        if (this.gForceHistory.length > 1) {
            ctx.beginPath();
            for (let i = 0; i < this.gForceHistory.length; i++) {
                const pt = this.gForceHistory[i];
                const px = cx + (pt.lat / this.maxG) * maxRadius;
                const py = cy - (pt.long / this.maxG) * maxRadius;

                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Live G-Force Dot
        if (this.gForceHistory.length > 0) {
            const current = this.gForceHistory[this.gForceHistory.length - 1];
            const px = cx + (current.lat / this.maxG) * maxRadius;
            const py = cy - (current.long / this.maxG) * maxRadius;

            let dotColor = '#00F0FF';
            if (current.brake > 10) dotColor = '#FF1E00';
            else if (current.throttle > 10) dotColor = '#00E676';

            ctx.beginPath();
            ctx.arc(px, py, 5, 0, Math.PI * 2);
            ctx.fillStyle = dotColor;
            ctx.shadowColor = dotColor;
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    }
}

// Global Analyzer Instance
window.f1Analyzer = new F1TelemetryAnalyzer();
