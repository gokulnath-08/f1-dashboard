/**
 * ════════════════════════════════════════════════════════════════════════════
 * F1 COCKPIT DRIVER DISPLAY UNIT (DDU) ENGINE (ddu-wheel.js)
 * Formula 1 Digital Steering Wheel Dashboard & LED Rev Lights
 * ════════════════════════════════════════════════════════════════════════════
 */

class F1DduEngine {
    constructor() {
        this.ledElements = [];
        this.maxRpm = 13500;
        this.idleRpm = 4000;
        this.initDdu();
    }

    initDdu() {
        // Cache LED DOM elements
        this.ledElements = Array.from(document.querySelectorAll('.shift-led'));
    }

    /**
     * Updates the 15-LED RPM Shift Light Bar across Header and DDU
     * Stages:
     * 1-5: Green (Entry Power band ~60-75%)
     * 6-10: Red (Peak Power ~75-92%)
     * 11-15: Blue/Purple (Optimum Upshift Point ~92-100%)
     */
    updateRpmShiftLights(rpm) {
        if (!this.ledElements.length) {
            this.ledElements = Array.from(document.querySelectorAll('.shift-led'));
        }
        if (!this.ledElements.length) return;

        const clampedRpm = Math.max(0, Math.min(this.maxRpm, rpm || 0));
        const effectiveRange = this.maxRpm - this.idleRpm;
        const currentEffective = Math.max(0, clampedRpm - this.idleRpm);
        const fraction = currentEffective / effectiveRange;

        const totalLeds = 15;
        const activeCount = Math.floor(fraction * (totalLeds + 1));
        const isShiftPoint = fraction >= 0.94;

        this.ledElements.forEach((led) => {
            const idx = parseInt(led.dataset.index || '0', 10);
            const shouldBeOn = idx < activeCount;

            led.classList.toggle('on', shouldBeOn);
            if (isShiftPoint) {
                led.classList.add('purple');
            } else {
                led.classList.remove('purple');
            }
        });

        const gearBox = document.getElementById('ddu-gear');
        if (gearBox) {
            gearBox.classList.toggle('gear-shift-flash', isShiftPoint);
        }
    }

    /**
     * Maps tyre temperature to realistic thermal HEX color:
     * < 85°C: Cold Cyan/Blue (#38BDF8)
     * 85 - 105°C: Optimum Green (#00E676)
     * 105 - 118°C: Hot Amber (#F59E0B)
     * > 118°C: Overheated Crimson (#EF4444)
     */
    getTyreThermalColor(tempC) {
        if (!tempC || tempC < 85) return '#38BDF8';
        if (tempC <= 106) return '#00E676';
        if (tempC <= 118) return '#F59E0B';
        return '#EF4444';
    }

    /**
     * Main 60Hz DDU Update Cycle
     */
    updateDDU(data) {
        if (!data) return;

        // 1. Shift Lights & RPM
        const rpm = data.inputs?.rpm || 0;
        this.updateRpmShiftLights(rpm);

        // 2. Speed & Gear
        const speed = Math.round(data.inputs?.speed || 0);
        const gear = data.inputs?.gear ?? 'N';
        const dduSpeed = document.getElementById('ddu-speed');
        const dduGear = document.getElementById('ddu-gear');
        if (dduSpeed) dduSpeed.textContent = speed;
        if (dduGear) dduGear.textContent = gear;

        // 3. DRS Indicator
        const drsStatus = (data.inputs?.drs || 'CLOSED').toUpperCase();
        const drsAllowed = Boolean(data.inputs?.drsAvailable);
        const drsPill = document.getElementById('ddu-drs-status');
        if (drsPill) {
            drsPill.classList.toggle('drs-open', drsStatus === 'OPEN');
            drsPill.classList.toggle('drs-available', drsAllowed && drsStatus !== 'OPEN');
            drsPill.textContent = drsStatus === 'OPEN' ? 'DRS ACTIVE' : (drsAllowed ? 'DRS READY' : 'DRS OFF');
        }

        // Also update header shift bar DRS pill
        const hdrDrsPill = document.getElementById('hdr-drs-pill');
        if (hdrDrsPill) {
            hdrDrsPill.classList.toggle('drs-open', drsStatus === 'OPEN');
            hdrDrsPill.classList.toggle('drs-available', drsAllowed && drsStatus !== 'OPEN');
            hdrDrsPill.textContent = drsStatus === 'OPEN' ? 'DRS ACTIVE' : (drsAllowed ? 'DRS AVAIL' : 'DRS');
        }

        // 4. Live Delta (Ghost or Fastest Lap)
        const deltaSec = (data.lap?.liveDeltaToRecord !== undefined && data.lap.liveDeltaToRecord !== 0) 
            ? (data.lap.liveDeltaToRecord / 1000) 
            : (data.lap?.deltaToSessionFastest ? (data.lap.deltaToSessionFastest / 1000) : 0);

        const deltaValEl = document.getElementById('ddu-delta-val');
        const deltaLabelEl = document.getElementById('ddu-delta-lbl');
        if (deltaValEl) {
            if (Number.isFinite(deltaSec) && deltaSec !== 0) {
                const prefix = deltaSec > 0 ? '+' : '';
                deltaValEl.textContent = `${prefix}${deltaSec.toFixed(3)}`;
                deltaValEl.style.color = deltaSec <= 0 ? 'var(--fia-green)' : 'var(--fia-red)';
            } else {
                deltaValEl.textContent = '±0.000';
                deltaValEl.style.color = 'var(--text-muted)';
            }
        }
        if (deltaLabelEl) {
            deltaLabelEl.textContent = data.lap?.ghostLapTimeMs ? 'DELTA (RECORD GHOST)' : 'DELTA (POLE)';
        }

        // 5. Four Tyres Mini Thermal Box
        const surfTemp = data.car?.surfTemp || {};
        const inTemp = data.car?.inTemp || {};
        const wear = data.car?.wear || {};
        const press = data.car?.press || {};

        const corners = ['fl', 'fr', 'rl', 'rr'];
        corners.forEach(c => {
            const tempVal = surfTemp[c] || inTemp[c] || 0;
            const pressVal = press[c] ? press[c].toFixed(1) : '--';
            const wearVal = wear[c] ? `${Math.round(wear[c])}%` : '0%';
            const color = this.getTyreThermalColor(tempVal);

            const tempEl = document.getElementById(`ddu-tyre-temp-${c}`);
            const pressEl = document.getElementById(`ddu-tyre-press-${c}`);
            const wearEl = document.getElementById(`ddu-tyre-wear-${c}`);
            const boxEl = document.getElementById(`ddu-tyre-box-${c}`);

            if (tempEl) {
                tempEl.textContent = `${tempVal}°C`;
                tempEl.style.color = color;
            }
            if (pressEl) pressEl.textContent = `${pressVal} PSI`;
            if (wearEl) wearEl.textContent = `WEAR: ${wearVal}`;
            if (boxEl) boxEl.style.setProperty('--tyre-heat-color', color);
        });

        // 6. ERS Battery SoC & Mode
        const ersBattery = Math.round(data.ers?.battery ?? (data.setup?.ers ?? 100));
        const ersMode = (data.ers?.mode || 'Medium').toUpperCase();
        const dduErsVal = document.getElementById('ddu-ers-soc');
        const dduErsBar = document.getElementById('ddu-ers-bar');
        const dduErsMode = document.getElementById('ddu-ers-mode');
        if (dduErsVal) dduErsVal.textContent = `${ersBattery}%`;
        if (dduErsBar) dduErsBar.style.width = `${ersBattery}%`;
        if (dduErsMode) dduErsMode.textContent = ersMode;

        // 7. Fuel Delta & Remaining Laps
        const fuelDelta = (data.fuel?.remainingLapsDelta !== undefined) 
            ? data.fuel.remainingLapsDelta 
            : (data.setup?.fuelLaps || 0);
        const dduFuelDelta = document.getElementById('ddu-fuel-delta');
        if (dduFuelDelta) {
            const prefix = fuelDelta > 0 ? '+' : '';
            dduFuelDelta.textContent = `${prefix}${Number(fuelDelta).toFixed(2)} LAPS`;
            dduFuelDelta.style.color = fuelDelta >= 0 ? 'var(--fia-green)' : 'var(--fia-red)';
        }

        // 8. Brake Bias %
        const bBias = data.setup?.bBias || 50;
        const dduBbias = document.getElementById('ddu-bbias');
        if (dduBbias) dduBbias.textContent = `${bBias}%`;

        // 9. Gap Ahead & Gap Behind
        const driverAhead = data.lap?.driverAhead || 'LEADER';
        const gapFront = data.lap?.gapFront || '+0.000';
        const driverBehind = data.lap?.driverBehind || 'NONE';
        const gapBehind = data.lap?.gapBehind || '--';
        const isDrsThreat = Boolean(data.lap?.drsThreat);

        const dduAheadEl = document.getElementById('ddu-car-ahead');
        const dduBehindEl = document.getElementById('ddu-car-behind');
        if (dduAheadEl) dduAheadEl.textContent = `${driverAhead} (${gapFront})`;
        if (dduBehindEl) {
            dduBehindEl.textContent = `${driverBehind} (${gapBehind})`;
            dduBehindEl.style.color = isDrsThreat ? '#EF4444' : 'var(--text-primary)';
        }

        // 10. Flag Status Halo Glow
        const flag = data.car?.flag || 'GREEN';
        const dduContainer = document.getElementById('ddu-container');
        if (dduContainer) {
            if (flag === 'YELLOW') {
                dduContainer.style.borderColor = 'var(--fia-yellow)';
                dduContainer.style.boxShadow = '0 0 35px var(--fia-yellow-glow)';
            } else if (flag === 'RED') {
                dduContainer.style.borderColor = 'var(--fia-red)';
                dduContainer.style.boxShadow = '0 0 35px var(--fia-red-glow)';
            } else {
                dduContainer.style.borderColor = 'var(--theme-accent)';
                dduContainer.style.boxShadow = '0 0 35px var(--theme-glow)';
            }
        }
    }
}

// Global DDU Controller Instance
window.f1Ddu = new F1DduEngine();

/**
 * Toggles Fullscreen for Sim Rig DDU Mode
 */
function toggleDDUFullscreen() {
    const el = document.getElementById('tab-ddu') || document.documentElement;
    if (!document.fullscreenElement) {
        if (el.requestFullscreen) {
            el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
            el.webkitRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

/**
 * Team Theme Switcher
 */
function switchF1Theme(themeName) {
    document.documentElement.setAttribute('data-f1-theme', themeName);
    localStorage.setItem('f1_preferred_theme', themeName);
    
    // Update theme team tag in header
    const brandName = document.querySelector('.rbr-team-name');
    if (brandName) {
        const themeLabels = {
            redbull: 'ORACLE <span class="rbr-highlight-yellow">RED BULL</span> RACING',
            ferrari: 'SCUDERIA <span style="color:#FF1E00;">FERRARI</span> HP',
            mercedes: 'MERCEDES-AMG <span style="color:#00D2BE;">PETRONAS</span>',
            mclaren: 'MCLAREN <span style="color:#FF8000;">FORMULA 1</span> TEAM',
            astonmartin: 'ASTON MARTIN <span style="color:#229971;">ARAMCO</span>',
            stealth: 'STEALTH <span style="color:#00F0FF;">CYBER CARBON</span> HUD'
        };
        brandName.innerHTML = themeLabels[themeName] || themeLabels.redbull;
    }
}

// Restore saved theme on load
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('f1_preferred_theme') || 'redbull';
    switchF1Theme(savedTheme);
    const themeSelect = document.getElementById('theme-picker-select');
    if (themeSelect) themeSelect.value = savedTheme;
});
