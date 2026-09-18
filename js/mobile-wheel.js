(() => {
    "use strict";

    const $ = (id) => document.getElementById(id);
    const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, Number(value) || 0));
    const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };
    const get = (obj, path, fallback = 0) => {
        const value = path.split(".").reduce((acc, key) => acc == null ? undefined : acc[key], obj);
        return value ?? fallback;
    };

    let socket = null;
    let reconnectTimer = null;
    let liveDataSeen = false;
    const pageParams = new URLSearchParams(location.search);
    let demoMode = pageParams.get("demo") === "1";
    const demoPitOverride = pageParams.get("pit");
    const rawDemoWear = pageParams.get("wear");
    const demoWearOverride = rawDemoWear === null ? Number.NaN : Number(rawDemoWear);
    let demoStart = performance.now();
    let lastPacketAt = 0;
    let latestData = null;
    let wakeLock = null;

    const lights = [];
    const lightsHost = $("shift-lights");
    for (let i = 0; i < 15; i += 1) {
        const light = document.createElement("i");
        light.className = `shift-light ${i < 5 ? "green" : i < 10 ? "red" : "blue"}`;
        lightsHost.appendChild(light);
        lights.push(light);
    }

    function formatLap(ms) {
        const value = Number(ms) || 0;
        if (value <= 0) return "--:--.---";
        const mins = Math.floor(value / 60000);
        const secs = ((value % 60000) / 1000).toFixed(3).padStart(6, "0");
        return `${mins}:${secs}`;
    }

    function formatSector(ms) {
        const value = Number(ms) || 0;
        return value > 0 ? (value / 1000).toFixed(3) : "--.---";
    }

    function formatRemaining(seconds) {
        const value = Math.max(0, Math.floor(Number(seconds) || 0));
        const mins = Math.floor(value / 60);
        const secs = value % 60;
        return `${mins}:${String(secs).padStart(2, "0")}`;
    }

    function signed(value, digits = 3) {
        const n = Number(value) || 0;
        if (Math.abs(n) < 0.0005) return `±${(0).toFixed(digits)}`;
        return `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}`;
    }

    function tyreCode(compound) {
        const name = String(compound || "UNKNOWN").trim().toUpperCase();
        if (name.includes("SUPER SOFT") || name.includes("SUPERSOFT")) return { code: "SS", color: "#d66cff", label: "SUPER SOFT" };
        if (name.includes("SOFT")) return { code: "S", color: "#ff3048", label: "SOFT" };
        if (name.includes("MED")) return { code: "M", color: "#ffe12f", label: "MEDIUM" };
        if (name.includes("HARD")) return { code: "H", color: "#f4f6f6", label: "HARD" };
        if (name.includes("INTER")) return { code: "I", color: "#39ef65", label: "INTERMEDIATE" };
        if (name.includes("WET")) return { code: "W", color: "#3e9dff", label: "WET" };
        if (name === "DRY") return { code: "D", color: "#f4f6f6", label: "DRY" };
        const cMatch = name.match(/^C([0-6])$/);
        if (cMatch) return { code: name, color: "#f4f6f6", label: name };
        return { code: "?", color: "#8e989c", label: name || "UNKNOWN" };
    }

    function valueColor(value, warn, danger) {
        const n = Number(value) || 0;
        return n >= danger ? "#ff2a3d" : n >= warn ? "#ffe142" : "#42f56c";
    }

    function tempColor(value) {
        const n = Number(value) || 0;
        if (!n) return "#8b9598";
        if (n < 75) return "#4ea4ff";
        if (n <= 105) return "#42f56c";
        if (n <= 115) return "#ffe142";
        return "#ff2a3d";
    }

    function brakeTempColor(value) {
        const n = Number(value) || 0;
        if (!n) return "#8b9598";
        if (n < 250) return "#4ea4ff";
        if (n <= 700) return "#42f56c";
        if (n <= 900) return "#ffe142";
        return "#ff2a3d";
    }

    function colorAssetName(color) {
        const value = String(color || "").toLowerCase();
        if (value.includes("4ea4ff")) return "blue";
        if (value.includes("ffe142")) return "yellow";
        if (value.includes("ff2a3d")) return "red";
        if (value.includes("42f56c")) return "green";
        return "neutral";
    }

    function setPartAsset(id, part, color) {
        const element = $(id);
        if (!element) return;
        const state = colorAssetName(color);
        if (element.dataset.assetState === state) return;
        element.src = `assets/car-parts/${part}-${state}.png?v=1`;
        element.dataset.assetState = state;
    }

    function paintTyre(prefix, values, colorFn) {
        ["fl", "fr", "rl", "rr"].forEach((corner) => {
            const value = Number(values?.[corner]) || 0;
            const el = $(`${prefix}-${corner}`);
            if (!el) return;
            el.textContent = prefix === "wear" ? `${Math.round(value)}%` : (value ? `${Math.round(value)}°` : "--°");
            el.style.color = colorFn(value);
            const icon = el.parentElement?.querySelector("i");
            if (icon) {
                icon.style.borderColor = colorFn(value);
                icon.style.setProperty("--tyre-color", colorFn(value));
                if (prefix === "wear") icon.style.setProperty("--tyre-fill", `${clamp(value)}%`);
                icon.style.boxShadow = `0 0 .5vmin ${colorFn(value)}88`;
            }
        });
    }

    function damageValue(damage, candidates, fallback = 0) {
        for (const key of candidates) {
            const value = damage?.[key];
            if (Number.isFinite(Number(value))) return Number(value);
        }
        return fallback;
    }

    function damageArrayValue(damage, candidates, index, fallback = 0) {
        for (const key of candidates) {
            const list = damage?.[key];
            if (list && Number.isFinite(Number(list[index]))) return Number(list[index]);
        }
        return fallback;
    }

    function paintSideTemperatures(car) {
        const tyreAssets = {
            fl: "front-left-wheel", fr: "front-right-wheel",
            rl: "rear-left-wheel", rr: "rear-right-wheel"
        };
        ["fl", "fr", "rl", "rr"].forEach((corner) => {
            setPartAsset("side-temp-" + corner, tyreAssets[corner], tempColor(car.inTemp?.[corner]));
        });
        const engineColor = tempColor(car.engineTemp);
        setPartAsset("side-temp-engine", "engine", engineColor);
        const engineLabel = $("side-engine-temp");
        if (engineLabel) engineLabel.style.color = engineColor;
    }

    function paintDamage(data) {
        const damage = data.damage || {};
        const values = {
            fl: damageArrayValue(damage, ["m_tyresDamage", "tyresDamage"], 2, damageValue(damage, ["m_frontLeftTyreDamage"], 0)),
            fr: damageArrayValue(damage, ["m_tyresDamage", "tyresDamage"], 3, damageValue(damage, ["m_frontRightTyreDamage"], 0)),
            rl: damageArrayValue(damage, ["m_tyresDamage", "tyresDamage"], 0, damageValue(damage, ["m_rearLeftTyreDamage"], 0)),
            rr: damageArrayValue(damage, ["m_tyresDamage", "tyresDamage"], 1, damageValue(damage, ["m_rearRightTyreDamage"], 0)),
            frontLeftWing: damageValue(damage, ["m_frontLeftWingDamage", "frontLeftWingDamage"]),
            frontRightWing: damageValue(damage, ["m_frontRightWingDamage", "frontRightWingDamage"]),
            rearWing: damageValue(damage, ["m_rearWingDamage", "rearWingDamage"]),
            floor: damageValue(damage, ["m_floorDamage", "floorDamage"]),
            diffuser: damageValue(damage, ["m_diffuserDamage", "diffuserDamage"]),
            sidepod: damageValue(damage, ["m_sidepodDamage", "sidepodDamage"])
        };
        const assetNames = {
            fl: "front-left-wheel", fr: "front-right-wheel",
            rl: "rear-left-wheel", rr: "rear-right-wheel",
            frontLeftWing: "front-left-wing", frontRightWing: "front-right-wing",
            rearWing: "rear-wing", floor: "floor", diffuser: "diffuser"
        };
        let maximum = 0;
        Object.entries(values).forEach(([part, value]) => {
            const numeric = Number(value) || 0;
            if (numeric > maximum) maximum = numeric;
            const mainId = part === "frontLeftWing" || part === "frontRightWing"
                ? "damage-front-wing"
                : part === "rearWing" ? "damage-rear-wing" : "damage-" + part;
            const sideId = "side-damage-" + part.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
            [mainId].forEach((targetId) => {
                const el = $(targetId);
                if (el) {
                    const color = valueColor(numeric, 20, 50);
                    el.style.fill = color;
                }
            });
            const partColor = valueColor(numeric, 20, 50);
            if (part === "sidepod") {
                setPartAsset("side-damage-sidepod-left", "left-sidepod", partColor);
                setPartAsset("side-damage-sidepod-right", "right-sidepod", partColor);
            } else if (assetNames[part]) {
                setPartAsset(sideId, assetNames[part], partColor);
            }
        });
        setText("damage-label", maximum >= 50 ? "DAMAGE" : maximum >= 20 ? "WARN" : "OK");
        const damageText = maximum >= 50 ? "DAMAGE" : maximum >= 20 ? "WARN" : "OK";
        setText("side-damage-label", damageText);
        [$("damage-label"), $("side-damage-label")].forEach((label) => {
            if (label) label.style.color = valueColor(maximum, 20, 50);
        });
    }

    function setSector(index, current, best, status) {
        setText(`sector-${index}`, formatSector(current));
        setText(`sector-best-${index}`, formatSector(best));
        const card = $(`sector-card-${index}`);
        if (!card) return;
        card.classList.remove("purple", "green", "yellow");
        const state = String(status || "").toLowerCase();
        if (state.includes("purple") || state.includes("session")) card.classList.add("purple");
        else if (state.includes("green") || state.includes("pb") || state.includes("personal")) card.classList.add("green");
        else if (Number(current) > 0) card.classList.add("yellow");
    }

    function updateShiftLights(rpm) {
        const ratio = clamp((Number(rpm) - 7500) / 5000, 0, 1);
        const count = Math.round(ratio * lights.length);
        const flash = Number(rpm) >= 11900;
        lights.forEach((light, index) => {
            light.classList.toggle("on", index < count);
            light.classList.toggle("flash", flash);
        });
    }

    const gearSegments = {
        "0": "abcdef", "1": "bc", "2": "abdeg", "3": "abcdg", "4": "bcfg",
        "5": "acdfg", "6": "acdefg", "7": "abc", "8": "abcdefg", "9": "abcdfg"
    };

    function renderGear(value) {
        const gear = $("gear");
        if (!gear) return;
        const text = String(value ?? "N").toUpperCase();
        const active = gearSegments[text];
        gear.classList.toggle("is-letter", !active);
        gear.setAttribute("aria-label", `挡位 ${text}`);
        gear.querySelectorAll(".seg").forEach((segment) => {
            const name = [...segment.classList].find((item) => item.startsWith("seg-") && item.length === 5)?.slice(-1);
            segment.classList.toggle("on", Boolean(active && name && active.includes(name)));
        });
        const letter = gear.querySelector("b");
        if (letter) letter.textContent = text;
    }

    function render(data) {
        if (!data || !data.inputs || !data.lap || !data.session || !data.car) return;
        latestData = data;
        const inputs = data.inputs;
        const lap = data.lap;
        const session = data.session;
        const car = data.car;
        const playerIndex = Number(data.playerIndex) || 0;
        const participant = data.participants?.[playerIndex] || "PLAYER";
        const position = Number(lap.pos) > 0 ? lap.pos : "--";
        const throttle = clamp(inputs.throttle);
        const brake = clamp(inputs.brake);
        const liveDeltaMs = Number(lap.liveDeltaToRecord) || Number(lap.deltaToSessionFastest) || 0;
        const deltaSeconds = liveDeltaMs / 1000;

        setText("driver-name", String(participant).toUpperCase());
        setText("track-name", String(session.trackName || "UNKNOWN").toUpperCase());
        setText("session-type", String(session.type || session.sessionType || "LIVE").toUpperCase());
        setText("lap-count", `L${lap.lapNum || 0} / ${session.lapsTotal || 0}`);
        setText("position", `P${position}`);
        setText("position-big", `P${position}`);
        setText("speed", Math.round(Number(inputs.speed) || 0));
        setText("rpm", Math.round(Number(inputs.rpm) || 0).toLocaleString("en-US"));
        renderGear(inputs.gear);
        setText("throttle-value", `${Math.round(throttle)}%`);
        setText("brake-value", `${Math.round(brake)}%`);
        $("throttle-bar").style.height = `${throttle}%`;
        $("brake-bar").style.height = `${brake}%`;
        updateShiftLights(inputs.rpm);

        const deltaEl = $("live-delta");
        deltaEl.textContent = signed(deltaSeconds);
        deltaEl.className = `delta ${deltaSeconds > .0005 ? "positive" : deltaSeconds < -.0005 ? "negative" : "neutral"}`;
        setText("gap-front", lap.gapFront || "+0.000");

        const fuelKg = Number(get(data, "fuel.tankKg", get(data, "setup.fuel", 0)));
        const fuelDelta = Number(get(data, "fuel.remainingLapsDelta", get(data, "setup.fuelLaps", 0)));
        setText("fuel-kg", fuelKg.toFixed(1));
        setText("fuel-delta", `${fuelDelta >= 0 ? "+" : ""}${fuelDelta.toFixed(2)} L`);
        $("fuel-delta").style.color = fuelDelta < 0 ? "#ff2a3d" : "#42f56c";

        setText("last-lap", formatLap(lap.lastMs));
        setText("best-lap", formatLap(lap.bestMs));
        setText("current-lap", formatLap(lap.currentMs));
        setText("invalid-lap", lap.invalid ? "INVALID" : "VALID");
        $("invalid-lap").style.color = lap.invalid ? "#ff2a3d" : "#42f56c";

        paintTyre("wear", car.wear, (v) => valueColor(v, 35, 60));
        paintTyre("temp", car.inTemp, tempColor);
        paintSideTemperatures(car);
        setText("tyre-age", `${car.tyreAge || 0} LAPS`);
        const compound = tyreCode(car.compound);
        ["compound-left", "compound-right"].forEach((id) => {
            const el = $(id);
            el.textContent = compound.code;
            el.style.color = compound.color;
            el.style.setProperty("--compound-color", compound.color);
            el.dataset.compound = compound.label;
            el.title = compound.label;
        });

        const drsOn = String(inputs.drs).toUpperCase() === "OPEN";
        const drsReady = Boolean(inputs.drsAvailable);
        setText("drs-state", drsOn ? "OPEN" : drsReady ? "READY" : "OFF");
        $("drs-box").classList.toggle("active", drsOn);
        $("drs-box").classList.toggle("ready", drsReady && !drsOn);
        const ers = clamp(get(data, "ers.battery", 0));
        setText("ers-value", Math.round(ers));
        $("ers-bar").style.width = `${ers}%`;
        $("ers-bar").style.background = ers < 20 ? "#ff2a3d" : "#38dfff";
        const pitStatus = String(lap.pitStatus || "ON TRACK").toUpperCase();
        const pitText = pitStatus.includes("TRACK") ? "TRACK" : pitStatus.replace("IN ", "");
        setText("pit-state", pitText);
        $("pit-state").classList.toggle("long", pitText.length > 5);
        $("pit-box").classList.toggle("active", !pitStatus.includes("TRACK"));
        setText("brake-bias", `${get(data, "setup.bBias", 50)}%`);
        setText("diff-on", `${get(data, "setup.diffOn", 50)}%`);
        setText("engine-temp", `${Math.round(Number(car.engineTemp) || 0)}°`);
        setText("side-engine-temp", `${Math.round(Number(car.engineTemp) || 0)}°C`);

        setText("driver-ahead", lap.driverAhead || "LEADER");
        setText("driver-behind", lap.driverBehind || "NONE");
        setText("penalties", `${lap.penalties || 0} SEC`);
        setText("track-temp", `${session.trackTemp || 0}°C`);
        setText("weather", String(session.weather || "--").toUpperCase());
        setText("session-remaining", formatRemaining(session.timeRemaining));

        const flag = String(car.flag || "GREEN").toUpperCase();
        const flagEl = $("flag-badge");
        flagEl.textContent = flag;
        flagEl.className = `flag ${flag.includes("YELLOW") ? "yellow" : flag.includes("RED") ? "red" : flag.includes("BLUE") ? "blue" : "green"}`;

        setSector(1, lap.liveS1 || lap.s1, lap.bestS1, lap.s1State || lap.s1Status);
        setSector(2, lap.liveS2 || lap.s2, lap.bestS2, lap.s2State || lap.s2Status);
        setSector(3, lap.liveS3 || lap.s3, lap.bestS3, lap.s3State || lap.s3Status);
        paintDamage(data);
    }

    function connectionState(kind, text) {
        const pill = $("connection-pill");
        pill.className = `connection-pill ${kind}`;
        setText("connection-text", text);
    }

    function websocketUrls() {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const hostname = location.hostname || "localhost";
        const primary = `${protocol}//${location.host || `${hostname}:3000`}`;
        return [...new Set([primary, `${protocol}//${hostname}:3000`, `${protocol}//${hostname}:8085`])];
    }

    function connect(index = 0) {
        if (demoMode) return;
        clearTimeout(reconnectTimer);
        const urls = websocketUrls();
        if (index >= urls.length) {
            connectionState("", "等待服务");
            reconnectTimer = setTimeout(() => connect(0), 1800);
            return;
        }
        try {
            socket = new WebSocket(urls[index]);
            socket.onopen = () => connectionState("", "等待 F1 25");
            socket.onmessage = (event) => {
                let data;
                try { data = JSON.parse(event.data); } catch { return; }
                if (data.type !== "telemetry") return;
                liveDataSeen = true;
                lastPacketAt = performance.now();
                render(data);
                connectionState(data.isGameActive ? "live" : "", data.isGameActive ? "F1 25 LIVE" : "游戏待机");
            };
            socket.onerror = () => { try { socket.close(); } catch { /* noop */ } };
            socket.onclose = () => {
                socket = null;
                if (!demoMode) {
                    if (index + 1 < urls.length && !liveDataSeen) connect(index + 1);
                    else {
                        connectionState("", "重新连接");
                        reconnectTimer = setTimeout(() => connect(0), 1800);
                    }
                }
            };
        } catch {
            connect(index + 1);
        }
    }

    function demoFrame(now) {
        if (!demoMode) return;
        const t = (now - demoStart) / 1000;
        const rpm = 9200 + Math.sin(t * 2.2) * 2500;
        const gear = Math.max(2, Math.min(8, Math.floor((t / 1.9) % 7) + 2));
        const throttle = clamp(72 + Math.sin(t * 1.4) * 25);
        const brake = clamp(Math.sin(t * .72) > .7 ? (Math.sin(t * .72) - .7) * 330 : 0);
        const lapMs = 42180 + ((t * 1000) % 43000);
        const demoWear = Number.isFinite(demoWearOverride) ? clamp(demoWearOverride) : clamp(10 + ((t * 4) % 66));
        const demo = {
            type: "telemetry", isGameActive: true, playerIndex: 0, participants: ["J. DRIVER"],
            inputs: { speed: 268 + Math.round(Math.sin(t * 1.2) * 42), gear, rpm, throttle, brake, drs: throttle > 88 ? "OPEN" : "CLOSED", drsAvailable: true },
            session: { trackName: "SUZUKA", type: "RACE", lapsTotal: 53, timeRemaining: 2396 - t, trackTemp: 42, weather: "CLEAR" },
            lap: { pos: 6, lapNum: 18, gapFront: "+0.584", currentMs: lapMs, lastMs: 91247, bestMs: 90103, liveDeltaToRecord: Math.sin(t * .8) * 620, pitStatus: demoPitOverride || "ON TRACK", driverAhead: "N. RIVALS", driverBehind: "A. HUNTER", penalties: 0, liveS1: 29230, liveS2: 30741, liveS3: 0, bestS1: 28928, bestS2: 30166, bestS3: 31009, s1State: "green", s2State: "yellow", s3State: "pending", invalid: false },
            car: {
                flag: "GREEN", compound: "MEDIUM", tyreAge: 8, engineTemp: 106,
                wear: { fl: demoWear, fr: clamp(demoWear + 5), rl: clamp(demoWear + 11), rr: clamp(demoWear + 16) },
                surfTemp: { fl: 82, fr: 82, rl: 83, rr: 83 },
                inTemp: { fl: 67, fr: 53, rl: 75, rr: 70 },
                brakeTemp: { fl: 422, fr: 400, rl: 402, rr: 376 }
            },
            fuel: { tankKg: 42.6, remainingLapsDelta: .63 }, ers: { battery: 67 }, setup: { bBias: 54, diffOn: 68 },
            damage: {
                m_tyresDamage: [32, 28, 43, 30],
                m_frontLeftWingDamage: 8, m_frontRightWingDamage: 34,
                m_rearWingDamage: 4, m_floorDamage: 18,
                m_diffuserDamage: 7, m_sidepodDamage: 12
            }
        };
        render(demo);
        connectionState("demo", "DEMO MODE");
        requestAnimationFrame(demoFrame);
    }

    async function requestWakeLock() {
        try {
            if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
        } catch { /* Wake Lock is optional. */ }
    }

    $("demo-btn").addEventListener("click", () => {
        demoMode = !demoMode;
        $("demo-btn").classList.toggle("active", demoMode);
        clearTimeout(reconnectTimer);
        if (socket) { socket.close(); socket = null; }
        if (demoMode) {
            demoStart = performance.now();
            requestAnimationFrame(demoFrame);
        } else {
            liveDataSeen = false;
            connectionState("", "连接中");
            connect();
        }
    });

    $("fullscreen-btn").addEventListener("click", async () => {
        try {
            if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
            else await document.exitFullscreen();
        } catch { /* Fullscreen may require browser permission. */ }
        requestWakeLock();
    });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") requestWakeLock();
    });

    function updateClockAndLinkAge() {
        const now = new Date();
        setText("clock", `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
        if (!demoMode) {
            const age = lastPacketAt ? Math.max(0, performance.now() - lastPacketAt) : 0;
            setText("udp-age", latestData?.isGameActive ? `UDP ${Math.round(age)}ms` : "UDP WAITING");
        } else {
            setText("udp-age", "PREVIEW DATA");
        }
    }

    updateClockAndLinkAge();
    setInterval(updateClockAndLinkAge, 500);

    $("demo-btn").classList.toggle("active", demoMode);
    requestWakeLock();
    if (demoMode) requestAnimationFrame(demoFrame);
    else connect();
})();
