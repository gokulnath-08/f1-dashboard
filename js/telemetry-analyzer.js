/**
 * ════════════════════════════════════════════════════════════════════════════
 * F1 MULTI-TRACE TELEMETRY & G-G FRICTION ANALYZER (telemetry-analyzer.js)
 * Real-time 60fps Canvas Telemetry Traces, Lap Comparator & Physics Engine
 * ════════════════════════════════════════════════════════════════════════════
 */

class F1TelemetryAnalyzer {
    constructor() {
        this.historyLength = 200;
        this.traceHistory = [];
        this.gForceHistory = [];
        this.maxG = 5.0;

        this.traceCanvas = null;
        this.traceCtx = null;
        this.gCanvas = null;
        this.gCtx = null;

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
    }

    resizeCanvases() {
        if (this.traceCanvas) {
            const rect = this.traceCanvas.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                const dpr = window.devicePixelRatio || 1;
                this.traceCanvas.width = rect.width * dpr;
                this.traceCanvas.height = rect.height * dpr;
                if (this.traceCtx) this.traceCtx.scale(dpr, dpr);
            }
        }

        if (this.gCanvas) {
            const rect = this.gCanvas.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                const dpr = window.devicePixelRatio || 1;
                this.gCanvas.width = rect.width * dpr;
                this.gCanvas.height = rect.height * dpr;
                if (this.gCtx) this.gCtx.scale(dpr, dpr);
            }
        }
    }

    pushTelemetrySample(data) {
        if (!data || !data.inputs) return;

        const sample = {
            speed: data.inputs.speed || 0,
            throttle: data.inputs.throttle || 0,
            brake: data.inputs.brake || 0,
            gear: typeof data.inputs.gear === 'number' ? data.inputs.gear : (data.inputs.gear === 'N' ? 0 : (data.inputs.gear === 'R' ? -1 : 0)),
            rpm: data.inputs.rpm || 0,
            steer: data.inputs.steer || 0,
            drs: data.inputs.drs === 'OPEN',
            time: Date.now()
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

        this.gForceHistory.push({ lat: gLat, long: gLong, vert: gVert, total: totalG, throttle: sample.throttle, brake: sample.brake });
        if (this.gForceHistory.length > 60) {
            this.gForceHistory.shift();
        }

        this.drawTraceChart();
        this.drawGGFrictionCircle();
    }

    drawTraceChart() {
        if (!this.traceCanvas || !this.traceCtx || this.traceHistory.length < 2) return;

        const ctx = this.traceCtx;
        const w = this.traceCanvas.offsetWidth;
        const h = this.traceCanvas.offsetHeight;
        if (!w || !h) return;

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

        const count = this.traceHistory.length;
        const xStep = w / (this.historyLength - 1);

        // 1. Throttle Trace (Green)
        ctx.beginPath();
        ctx.strokeStyle = '#00E676';
        ctx.lineWidth = 2;
        for (let i = 0; i < count; i++) {
            const x = i * xStep;
            const normThrottle = this.traceHistory[i].throttle / 100;
            const y = h - (normThrottle * (h * 0.85)) - (h * 0.05);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 2. Brake Trace (Red)
        ctx.beginPath();
        ctx.strokeStyle = '#FF1E00';
        ctx.lineWidth = 2;
        for (let i = 0; i < count; i++) {
            const x = i * xStep;
            const normBrake = this.traceHistory[i].brake / 100;
            const y = h - (normBrake * (h * 0.85)) - (h * 0.05);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 3. Speed Trace (Cyan)
        ctx.beginPath();
        ctx.strokeStyle = '#00F0FF';
        ctx.lineWidth = 2;
        for (let i = 0; i < count; i++) {
            const x = i * xStep;
            const normSpeed = Math.min(1, this.traceHistory[i].speed / 360);
            const y = h - (normSpeed * (h * 0.85)) - (h * 0.05);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Current needle marker
        const lastX = (count - 1) * xStep;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(lastX, 0);
        ctx.lineTo(lastX, h);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    drawGGFrictionCircle() {
        if (!this.gCanvas || !this.gCtx) return;

        const ctx = this.gCtx;
        const w = this.gCanvas.offsetWidth;
        const h = this.gCanvas.offsetHeight;
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
            ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
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
            ctx.arc(px, py, 6, 0, Math.PI * 2);
            ctx.fillStyle = dotColor;
            ctx.shadowColor = dotColor;
            ctx.shadowBlur = 12;
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    }
}

// Global Analyzer Instance
window.f1Analyzer = new F1TelemetryAnalyzer();
