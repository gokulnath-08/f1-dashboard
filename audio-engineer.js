/**
 * ════════════════════════════════════════════════════════════════════════════
 * F1 WEB AUDIO RACE ENGINEER & SOUND ENGINE (audio-engineer.js)
 * Formula 1 Authentic Telemetry Beeps, Shift Tones, & Radio Cues
 * ════════════════════════════════════════════════════════════════════════════
 */

class F1AudioEngine {
    constructor() {
        this.ctx = null;
        this.isMuted = localStorage.getItem('f1_audio_muted') === 'true';
        this.drsToneEnabled = localStorage.getItem('f1_drs_tone') !== 'false';
        this.shiftToneEnabled = localStorage.getItem('f1_shift_tone') === 'true';
        this.voiceCallsEnabled = localStorage.getItem('f1_voice_calls') !== 'false';
        this.volume = parseFloat(localStorage.getItem('f1_audio_volume') || '0.7');

        this.lastDrsState = false;
        this.lastRpmThreshold = false;
        this.lastFlag = 'GREEN';
        this.lastScStatus = 'Clear';
        this.lastPitStatus = 'ON TRACK';
        this.lastSpokenTime = 0;
        this.lastSpokenKey = '';
        this.cooldowns = new Map();

        // Bind init on first user interaction
        window.addEventListener('click', () => this.initContext(), { once: true });
        window.addEventListener('keydown', () => this.initContext(), { once: true });
    }

    initContext() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                this.ctx = new AudioCtx();
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    setMuted(muted) {
        this.isMuted = muted;
        localStorage.setItem('f1_audio_muted', String(muted));
        const btn = document.getElementById('btn-audio-mute');
        if (btn) {
            btn.classList.toggle('muted', muted);
            btn.innerHTML = muted 
                ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg><span>MUTED</span>`
                : `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg><span>RADIO ON</span>`;
        }
    }

    toggleMute() {
        this.initContext();
        this.setMuted(!this.isMuted);
    }

    playDrsBeep() {
        if (this.isMuted || !this.drsToneEnabled) return;
        this.initContext();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(1850, now);
        osc.frequency.setValueAtTime(2350, now + 0.04);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.3 * this.volume, now + 0.01);
        gain.gain.linearRampToValueAtTime(0, now + 0.12);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.13);
    }

    playShiftBeep() {
        if (this.isMuted || !this.shiftToneEnabled) return;
        this.initContext();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(2700, now);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.18 * this.volume, now + 0.005);
        gain.gain.linearRampToValueAtTime(0, now + 0.035);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.04);
    }

    playRadioStatic() {
        if (this.isMuted || !this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            const bufferSize = this.ctx.sampleRate * 0.04;
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = (Math.random() * 2 - 1) * 0.15;
            }

            const noise = this.ctx.createBufferSource();
            noise.buffer = buffer;
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.2 * this.volume, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.04);

            noise.connect(gain);
            gain.connect(this.ctx.destination);
            noise.start(now);
        } catch (e) {}
    }

    speakEngineer(text, key, cooldownMs = 8000) {
        if (this.isMuted || !this.voiceCallsEnabled || !('speechSynthesis' in window)) return;
        
        const now = Date.now();
        if (key && this.cooldowns.has(key)) {
            const lastTime = this.cooldowns.get(key);
            if (now - lastTime < cooldownMs) return;
        }
        if (key) this.cooldowns.set(key, now);

        this.playRadioStatic();

        // Cancel previous pending speech to avoid long queue lags
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.15;
        utterance.pitch = 0.95;
        utterance.volume = Math.min(1.0, this.volume * 1.2);

        // Try to pick a clear English voice
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(v => (v.lang.startsWith('en') && (v.name.includes('David') || v.name.includes('Daniel') || v.name.includes('George') || v.name.includes('Male')))) 
            || voices.find(v => v.lang.startsWith('en'));
        if (preferredVoice) utterance.voice = preferredVoice;

        window.speechSynthesis.speak(utterance);
    }

    /**
     * Consumes live telemetry packet and triggers timely auditory and voice cues
     */
    processTelemetry(data) {
        if (!data || !data.inputs) return;

        // 1. DRS Available Tone
        const isDrsAvail = Boolean(data.inputs.drsAvailable);
        if (isDrsAvail && !this.lastDrsState) {
            this.playDrsBeep();
        }
        this.lastDrsState = isDrsAvail;

        // 2. High-RPM Shift Point Tone (approx >= 12,000 RPM or gear >= 1)
        const rpm = data.inputs.rpm || 0;
        const isShiftThreshold = rpm >= 12200;
        if (isShiftThreshold && !this.lastRpmThreshold && data.inputs.gear !== 'N' && data.inputs.gear !== 'R') {
            this.playShiftBeep();
        }
        this.lastRpmThreshold = isShiftThreshold;

        // 3. Safety Car / VSC Calls
        const sc = data.session?.sc || 'Clear';
        if (sc !== this.lastScStatus) {
            if (sc === 'Full SC' || sc === 'Safety Car') {
                this.speakEngineer('Safety Car deployed. Reduce pace and maintain positive delta.', 'sc_full', 15000);
            } else if (sc === 'VSC' || sc === 'Virtual SC') {
                this.speakEngineer('Virtual Safety Car. Mind your delta time.', 'sc_vsc', 15000);
            } else if (sc === 'Clear' && (this.lastScStatus === 'Full SC' || this.lastScStatus === 'VSC')) {
                this.speakEngineer('Safety car ending. Track is green, race is on.', 'sc_clear', 15000);
            }
            this.lastScStatus = sc;
        }

        // 4. Flag Status Calls
        const flag = data.car?.flag || 'GREEN';
        if (flag !== this.lastFlag) {
            if (flag === 'YELLOW') {
                this.speakEngineer('Yellow flag on track. No overtaking.', 'flag_yellow', 12000);
            } else if (flag === 'RED') {
                this.speakEngineer('Red flag, red flag! Return to pit lane immediately.', 'flag_red', 20000);
            } else if (flag === 'BLUE') {
                this.speakEngineer('Blue flags. Faster car approaching, allow them past.', 'flag_blue', 10000);
            }
            this.lastFlag = flag;
        }

        // 5. Pit Stop Warnings & Urgent Calls
        const wear = data.car?.wear;
        if (wear) {
            const maxWear = Math.max(wear.fl || 0, wear.fr || 0, wear.rl || 0, wear.rr || 0);
            if (maxWear >= 70) {
                this.speakEngineer('Tyre wear critical! High puncture risk, box this lap!', 'wear_critical', 25000);
            }
        }
    }
}

// Global Audio Engine Singleton
window.f1Audio = new F1AudioEngine();
