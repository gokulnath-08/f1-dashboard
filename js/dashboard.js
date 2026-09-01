// ── Leaderboard Global State & View Mode ──
        let selectedRefCarIndex = -1;
        let lbViewMode = window.innerWidth < 768 ? 'timing' : 'all';

        function setLeaderboardViewMode(mode) {
            lbViewMode = mode;
            ['timing', 'sectors', 'all'].forEach(m => {
                const btn = document.getElementById(`lb-btn-${m}`);
                if (btn) btn.classList.toggle('active', m === mode);
            });
            const container = document.getElementById('lb-main-container');
            if (container) {
                container.classList.remove('view-timing', 'view-sectors', 'view-all');
                container.classList.add(`view-${mode}`);
            }
            if (window.lastTelemetryData) {
                updateLeaderboardDisplay(window.lastTelemetryData);
            }
        }

        function selectDriverAsReference(carIndex, evt) {
            if (evt) evt.stopPropagation();
            if (selectedRefCarIndex === carIndex) {
                selectedRefCarIndex = -1; // Deselect -> return to leader
            } else {
                selectedRefCarIndex = carIndex;
            }
            window.selectedCarIndex = carIndex;
            if (window.lastTelemetryData) {
                updateLeaderboardDisplay(window.lastTelemetryData);
            }
        }

        function selectCarOnMap(carIndex, evt) {
            selectDriverAsReference(carIndex, evt);
        }

        function clearSelectedRefDriver() {
            selectedRefCarIndex = -1;
            if (window.lastTelemetryData) {
                updateLeaderboardDisplay(window.lastTelemetryData);
            }
        }

        const domCache = new Map();

        function setText(id, value) {
            const next = String(value);
            const cacheKey = `text_${id}`;
            if (domCache.get(cacheKey) === next) return;
            const el = document.getElementById(id);
            if (!el) return;
            el.textContent = next;
            domCache.set(cacheKey, next);
        }

        function setHtml(id, value) {
            const cacheKey = `html_${id}`;
            if (domCache.get(cacheKey) === value) return;
            const el = document.getElementById(id);
            if (!el) return;
            el.innerHTML = value;
            domCache.set(cacheKey, value);
        }

        function setElementText(el, value) {
            if (!el) return;
            const next = String(value);
            if (el.id) {
                const cacheKey = `text_${el.id}`;
                if (domCache.get(cacheKey) === next) return;
                el.textContent = next;
                domCache.set(cacheKey, next);
            } else if (el.textContent !== next) {
                el.textContent = next;
            }
        }

        function setElementHtml(el, value) {
            if (!el) return;
            if (el.id) {
                const cacheKey = `html_${el.id}`;
                if (domCache.get(cacheKey) === value) return;
                el.innerHTML = value;
                domCache.set(cacheKey, value);
            } else if (el.innerHTML !== value) {
                el.innerHTML = value;
            }
        }

        function setStyle(el, prop, value) {
            if (!el) return;
            if (el.id) {
                const cacheKey = `style_${el.id}_${prop}`;
                if (domCache.get(cacheKey) === value) return;
                el.style[prop] = value;
                domCache.set(cacheKey, value);
            } else if (el.style[prop] !== value) {
                el.style[prop] = value;
            }
        }

        function setStyleById(id, prop, value) {
            const cacheKey = `style_${id}_${prop}`;
            if (domCache.get(cacheKey) === value) return;
            const el = document.getElementById(id);
            if (!el) return;
            el.style[prop] = value;
            domCache.set(cacheKey, value);
        }

        function setClass(el, activeClass, possibleClasses = []) {
            if (!el) return;
            let cacheKey = null;
            if (el.id) {
                cacheKey = `class_${el.id}`;
                if (domCache.get(cacheKey) === activeClass) return;
            }

            for (let i = 0; i < possibleClasses.length; i++) {
                const c = possibleClasses[i];
                if (c !== activeClass && el.classList.contains(c)) {
                    el.classList.remove(c);
                }
            }
            if (activeClass && !el.classList.contains(activeClass)) {
                el.classList.add(activeClass);
            }

            if (cacheKey) domCache.set(cacheKey, activeClass);
        }

        function formatMs(ms) {
            if (!ms || ms === 0 || ms === Infinity) return "--:--.---";
            const m = Math.floor(ms / 60000);
            const s = Math.floor((ms % 60000) / 1000);
            const milli = Math.floor(ms % 1000);
            return `${m}:${s.toString().padStart(2, "0")}.${milli.toString().padStart(3, "0")}`;
        }

        function formatSectorMs(ms) {
            if (!ms || ms <= 0 || ms === Infinity) return "--.---";
            return (ms / 1000).toFixed(3);
        }

        function formatDeltaMs(diffMs) {
            if (!Number.isFinite(diffMs)) return "--";
            const prefix = diffMs > 0 ? "+" : "";
            return `${prefix}${(diffMs / 1000).toFixed(3)}s`;
        }

        /**
         * Sets text and color for delta displays, automatically handling green (negative) 
         * and red (positive) state formatting unless a colorOverride is provided.
         */
        function setDeltaText(id, diffMs, colorOverride) {
            const el = document.getElementById(id);
            if (!el) return;
            if (!Number.isFinite(diffMs)) {
                setElementText(el, "--");
                setStyle(el, "color", "var(--text-muted)");
                return;
            }
            setElementText(el, formatDeltaMs(diffMs));
            setStyle(
                el,
                "color",
                colorOverride || (diffMs <= 0 ? "var(--fia-green)" : "var(--f1-red)"),
            );
        }

        /**
         * Updates a sector timing box UI. Analyzes the time against the session best 
         * and personal best to assign Purple, Green, or Yellow visual states.
         */
        function updateSectorDisplay(
            sectorId,
            ms,
            state,
            msRefSessionBest,
            msRefPersonalBest,
            explicitStatus = null
        ) {
            const row = document.getElementById(`sector-row-${sectorId}`);
            const chip = document.getElementById(`lap-${sectorId}-state`);
            const valEl = document.getElementById(`lap-${sectorId}`);

            const normalizedState = state || "pending";
            let chipText = "WAIT";
            let colorClass = null;
            let rowClass = null;

            if (normalizedState === "live") {
                chipText = "LIVE";
                rowClass = "live";
            } else if (normalizedState === "complete" || (ms > 0 && ms !== Infinity)) {
                if (explicitStatus === "sb" || (msRefSessionBest > 0 && ms <= msRefSessionBest)) {
                    chipText = "DONE (SB)";
                    colorClass = "purple";
                    rowClass = "purple";
                } else if (explicitStatus === "pb" || (msRefPersonalBest > 0 && ms <= msRefPersonalBest && explicitStatus !== "yellow")) {
                    chipText = "DONE (PB)";
                    colorClass = "green";
                    rowClass = "complete";
                } else {
                    chipText = "DONE";
                    colorClass = "yellow";
                    rowClass = "yellow";
                }
            }

            if (valEl) {
                setElementText(valEl, formatSectorMs(ms));
                setClass(valEl, colorClass, ["purple", "green", "yellow"]);
            }

            setElementText(chip, chipText);
            if (row) {
                setClass(row, rowClass, ["live", "complete", "purple", "yellow"]);
            }
        }

        /**
         * Safely retrieves a millisecond timing value from a lap history object.
         */
        function lapHistoryMs(lapData, key) {
            if (!lapData) return 0;
            if (typeof lapData === "number") return key === "lapTime" ? lapData : 0;
            return Number(lapData[key] || 0);
        }

        /**
         * Computes live micro-sector deltas (Prev Lap & Best Lap) based on the latest telemetry.
         * Applies appropriate color-coding to UI elements based on improvement.
         */
        function updateSectorDeltas(data, playerLbData) {
            const history = Array.isArray(playerLbData?.lapHistory)
                ? playerLbData.lapHistory
                : [];
            const isHolding = data.lap.currentMs < 5000 && history.length >= 2;
            const previousLap = isHolding
                ? (history.length >= 3 ? history[history.length - 3] : null)
                : (history.length >= 2 ? history[history.length - 2] : null);

            const sectorKeys = ["s1", "s2", "s3"];

            sectorKeys.forEach((key) => {
                const state = data.lap[`${key}State`];
                if (state !== "complete") {
                    setDeltaText(`lap-${key}-prev`, NaN);
                    setDeltaText(`lap-${key}-best`, NaN);
                    return;
                }

                const currentMs = Number(
                    data.lap[`live${key.toUpperCase()}`] ?? data.lap[key] ?? 0,
                );
                const previousMs = lapHistoryMs(previousLap, key);
                const sessionBest = (data.session && data.session[`sessionBest${key.toUpperCase()}`]) || data.session?.[`reference${key.toUpperCase()}`] || data.session?.[`allTimeBest${key.toUpperCase()}`] || 0;
                const personalBest = Number(
                    playerLbData?.[`best${key.toUpperCase()}`] || data.lap?.[`best${key.toUpperCase()}`] || sessionBest || 0,
                );

                const comparisonMs = personalBest > 0 ? personalBest : sessionBest;

                const prevDiff = currentMs > 0 && previousMs > 0 ? currentMs - previousMs : NaN;
                setDeltaText(`lap-${key}-prev`, prevDiff, prevDiff <= 0 ? "var(--fia-green)" : "var(--fia-yellow)");

                const bestDiff = currentMs > 0 && comparisonMs > 0 ? currentMs - comparisonMs : NaN;
                let bestColor = "var(--text-muted)";
                if (Number.isFinite(bestDiff)) {
                    if (sessionBest > 0 && currentMs <= sessionBest) {
                        bestColor = "var(--fia-purple)";
                    } else if (personalBest > 0 && currentMs <= personalBest) {
                        bestColor = "var(--fia-green)";
                    } else {
                        bestColor = "var(--fia-yellow)";
                    }
                }
                setDeltaText(`lap-${key}-best`, bestDiff, bestColor);
            });
        }

        /**
         * Calculates the standard/official full race distance in km.
         */
        function getRaceDistance(trackLength) {
            if (trackLength <= 0) {
                setText("race-dist", "-- km");
                return;
            }

            const MIN_DISTANCE_KM = 305;
            const MONACO_DISTANCE_KM = 260;

            const isMonaco = trackLength >= 3300 && trackLength <= 3400;
            const targetDistanceKm = isMonaco
                ? MONACO_DISTANCE_KM
                : MIN_DISTANCE_KM;

            const targetDistanceM = targetDistanceKm * 1000;
            const totalLaps = Math.ceil(targetDistanceM / trackLength);
            const actualDistanceKm = (totalLaps * trackLength) / 1000;

            setText("race-dist", `${actualDistanceKm.toFixed(1)} km`);
        }

        /**
         * Checks if the current session is a Race or Sprint session.
         */
        function isRaceSession(data) {
            const sessionType = data?.session?.type || "";
            return sessionType.includes("Race") || sessionType.includes("Sprint");
        }

        /**
         * Analyzes tyre wear, weather conditions, and remaining laps to calculate 
         * dynamic pit stop recommendations for the driver.
         */
        function calculatePitStrategy(data) {
            const maxWear = Math.max(
                data.car.wear.fl,
                data.car.wear.fr,
                data.car.wear.rl,
                data.car.wear.rr,
            );
            const weather = data.session.weather;
            const currentCompound = (data.car.compound || "").toUpperCase();
            const lapsRemaining =
                data.session.lapsLeft || (data.session.lapsTotal - data.lap.lapNum);
            const pitStatus = data.lap.pitStatus;

            if (pitStatus === "PITTING" || pitStatus === "IN PIT LANE" || pitStatus === "IN PITS")
                return {
                    text: "IN PITS",
                    color: "#000",
                    bgColor: "var(--fia-yellow)",
                    border: "none",
                };
            const isRaining =
                weather === "Light Rain" ||
                weather === "Heavy Rain" ||
                weather === "Storm";
            const onDryTyres =
                !currentCompound.includes("INTER") &&
                !currentCompound.includes("WET");

            if (isRaining && onDryTyres)
                return {
                    text: "BOX FOR WETS",
                    color: "#FFF",
                    bgColor: "var(--f1-red)",
                    border: "none",
                };
            if (
                !isRaining &&
                (currentCompound.includes("INTER") || currentCompound.includes("WET"))
            )
                return {
                    text: "BOX FOR SLICKS",
                    color: "#FFF",
                    bgColor: "var(--f1-red)",
                    border: "none",
                };
            if (maxWear > 70)
                return {
                    text: "PUNCTURE RISK: BOX",
                    color: "#FFF",
                    bgColor: "var(--f1-red)",
                    border: "none",
                };
            else if (maxWear > 55)
                return {
                    text: "PIT WINDOW OPEN",
                    color: "#000",
                    bgColor: "var(--fia-yellow)",
                    border: "none",
                };
            else if (maxWear > 45)
                return {
                    text: "PREPARE TO BOX",
                    color: "var(--fia-yellow)",
                    bgColor: "var(--f1-dark)",
                    border: "1px solid var(--fia-yellow)",
                };
            if (lapsRemaining <= 2 && maxWear < 70 && lapsRemaining > 0)
                return {
                    text: "PUSH TO END",
                    color: "#000",
                    bgColor: "var(--fia-purple)",
                    border: "none",
                };
            return {
                text: "STAY OUT",
                color: "var(--fia-green)",
                bgColor: "var(--f1-dark)",
                border: "1px solid var(--fia-green)",
            };
        }

        function clampPercent(value) {
            const number = Number(value);
            if (!Number.isFinite(number)) return 0;
            return Math.max(0, Math.min(100, number));
        }

        function getWearColor(wearPercent) {
            const w = Math.max(0, Math.min(100, wearPercent));
            let hue = w <= 30 ? 130 - (w / 30) * 40 : w <= 55 ? 90 - ((w - 30) / 25) * 50 : 40 - ((w - 55) / 45) * 40;
            hue = Math.max(0, hue);
            return `hsl(${hue}, 90%, ${w > 70 ? 48 : 50}%)`;
        }

        function getTempColor(tempC, optLow, optHigh) {
            if (tempC < optLow) return '#60a5fa';
            if (tempC > optHigh + 40) return 'var(--f1-red)';
            if (tempC > optHigh) return '#fb923c';
            return 'var(--fia-green)';
        }

        function getWeatherIconSVG(code, size = 36) {
            const s = size;
            switch (code) {
                case 0:
                    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="#FFC107" stroke-width="2"><circle cx="12" cy="12" r="5" fill="#FFD54F" fill-opacity="0.35"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
                case 1:
                    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="#FFC107" stroke-width="2"><circle cx="12" cy="9" r="4" fill="#FFD54F" fill-opacity="0.35"/><path d="M17 18a4 4 0 0 0-4-4 4.5 4.5 0 0 0-4.3 3A3.5 3.5 0 0 0 6 20h11a3 3 0 0 0 0-6z" fill="#90A4AE" fill-opacity="0.45" stroke="#ECEFF1"/></svg>`;
                case 2:
                    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="#B0BEC5" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="#78909C" fill-opacity="0.5"/></svg>`;
                case 3:
                    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2"><path d="M16 13v-2a4 4 0 0 0-7.8-1A3.5 3.5 0 0 0 4 13.5 3.5 3.5 0 0 0 7.5 17H16a3 3 0 0 0 0-6z" fill="#607D8B" fill-opacity="0.5"/><line x1="8" y1="19" x2="7" y2="22"/><line x1="12" y1="19" x2="11" y2="22"/><line x1="16" y1="19" x2="15" y2="22"/></svg>`;
                case 4:
                    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2"><path d="M16 12a4 4 0 0 0-7.8-1A3.5 3.5 0 0 0 4 12.5 3.5 3.5 0 0 0 7.5 16H16a3 3 0 0 0 0-6z" fill="#455A64" fill-opacity="0.7"/><line x1="7" y1="18" x2="5" y2="23" stroke-width="3"/><line x1="11" y1="18" x2="9" y2="23" stroke-width="3"/><line x1="15" y1="18" x2="13" y2="23" stroke-width="3"/></svg>`;
                case 5:
                    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M16 11a4 4 0 0 0-7.8-1A3.5 3.5 0 0 0 4 11.5 3.5 3.5 0 0 0 7.5 15H16a3 3 0 0 0 0-6z" fill="#37474F" fill-opacity="0.8"/><polygon points="13 13 9 19 12 19 10 23 16 16 13 16 13 13" fill="#F59E0B"/></svg>`;
                default:
                    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
            }
        }

        function showToast(msg) {
            const container = document.getElementById('toast-container');
            if (!container) return;
            const toast = document.createElement('div');
            toast.className = 'toast-msg';
            toast.innerHTML = `<span>ℹ️</span><span>${msg}</span>`;
            container.appendChild(toast);
            setTimeout(() => { toast.remove(); }, 3500);
        }

        function getTeamColorHex(teamColor) {
            if (typeof teamColor === "number") return teamColor;
            if (typeof teamColor !== "string") return 0xffffff;
            const parsed = parseInt(teamColor.replace("#", "0x"), 16);
            return Number.isFinite(parsed) ? parsed : 0xffffff;
        }

        function getTeamColorCss(driver, data) {
            const teamColor = driver?.teamColor ?? data?.allCars?.[driver?.carIndex]?.teamColor;
            const hex = getTeamColorHex(teamColor).toString(16).padStart(6, "0").slice(-6);
            return `#${hex}`;
        }

        function getDriverName(data, carIndex) {
            return data?.participants?.[carIndex]
                ? data.participants[carIndex]
                : `CAR ${carIndex}`;
        }

        function escapeHtml(value) {
            return String(value ?? "").replace(
                /[&<>"']/g,
                (char) =>
                    ({
                        "&": "&amp;",
                        "<": "&lt;",
                        ">": "&gt;",
                        '"': "&quot;",
                        "'": "&#39;",
                    })[char],
            );
        }

        function getDriverAbbr(name, carIndex, isSafetyCar = false) {
            const strName = String(name || "").trim();
            const lower = strName.toLowerCase();
            if (isSafetyCar || lower.includes("safety") || lower.includes("medical") || lower === "sc" || lower.includes("safety car")) {
                return lower.includes("medical") ? "MC" : "SC";
            }
            const clean = strName.replace(/[^a-z0-9 ]/gi, "").trim();
            if (!clean) return `C${carIndex}`;
            const parts = clean.split(/\s+/);
            const source = parts.length > 1 ? parts[parts.length - 1] : clean;
            return source.slice(0, 3).toUpperCase();
        }

        function getLeaderboardDriver(data, carIndex) {
            return Array.isArray(data?.leaderboard)
                ? data.leaderboard.find((driver) => driver.carIndex === carIndex)
                : null;
        }

        function getSectorBadgeHtml(secMs, secBest, secSessionBest, isLive, secStatus = null) {
            if (isLive) {
                return `<span class="sector-badge live">LIVE</span>`;
            }
            if (!secMs || secMs <= 0) {
                return `<span class="sector-badge">—</span>`;
            }
            let cls = "yellow";
            if (secStatus === "sb" || (secSessionBest > 0 && secMs <= secSessionBest)) {
                cls = "purple";
            } else if (secStatus === "pb" || (secBest > 0 && secMs <= secBest && secStatus !== "yellow")) {
                cls = "green";
            }
            const formatted = (secMs / 1000).toFixed(3);
            return `<span class="sector-badge ${cls}">${formatted}</span>`;
        }

        function updateLeaderboardDisplay(data) {
            if (!data || !data.leaderboard || data.leaderboard.length === 0) return;

            const pIdx = data.playerIndex ?? -1;
            const isTimeBased = data.session.sessionCategory === "TimeAttack";
            const sb1 = data.session.sessionBestS1 || 0;
            const sb2 = data.session.sessionBestS2 || 0;
            const sb3 = data.session.sessionBestS3 || 0;
            const poleTime = data.leaderboard.find(d => d.bestLapMs > 0)?.bestLapMs || 0;

            // Reference driver handling
            const refIndicator = document.getElementById("lb-ref-indicator");
            const refNameEl = document.getElementById("lb-ref-name");
            const refDriver = (selectedRefCarIndex >= 0) ? data.leaderboard.find(d => d.carIndex === selectedRefCarIndex) : null;
            const refIdx = refDriver ? data.leaderboard.indexOf(refDriver) : -1;

            if (refDriver && refIndicator && refNameEl) {
                refIndicator.style.display = "inline-flex";
                const rName = data.participants?.[refDriver.carIndex] || `CAR ${refDriver.carIndex}`;
                refNameEl.textContent = rName.toUpperCase();
            } else if (refIndicator) {
                refIndicator.style.display = "none";
            }

            // Sync main container class
            const mainContainer = document.getElementById("lb-main-container");
            if (mainContainer) {
                mainContainer.classList.remove('view-timing', 'view-sectors', 'view-all');
                mainContainer.classList.add(`view-${lbViewMode}`);
            }

            // Sync toggle button active states
            ['timing', 'sectors', 'all'].forEach(m => {
                const btn = document.getElementById(`lb-btn-${m}`);
                if (btn) btn.classList.toggle('active', m === lbViewMode);
            });

            // Generate Table Headers based on lbViewMode
            let headersHtml = `<span class="col-pos">POS</span><span class="col-driver">DRIVER</span>`;
            if (lbViewMode === 'timing') {
                if (isTimeBased) {
                    headersHtml += `
                        <span class="col-best">BEST</span>
                        <span class="col-gap">${refDriver ? 'GAP' : 'GAP'}</span>
                        <span class="col-int">INT</span>
                        <span class="col-laps">LAPS</span>
                        <span class="col-stat">STAT</span>
                    `;
                } else {
                    headersHtml += `
                        <span class="col-tyre">TYRE</span>
                        <span class="col-gap">${refDriver ? 'GAP' : 'LEAD'}</span>
                        <span class="col-int">INT</span>
                        <span class="col-best">BEST</span>
                        <span class="col-laps">LAPS</span>
                    `;
                }
            } else if (lbViewMode === 'sectors') {
                headersHtml += `
                    <span class="col-s1">S1</span>
                    <span class="col-s2">S2</span>
                    <span class="col-s3">S3</span>
                    <span class="col-best">BEST</span>
                    <span class="col-gap">${refDriver ? 'GAP' : (isTimeBased ? 'GAP' : 'LEAD')}</span>
                `;
            } else {
                // 'all' mode
                if (isTimeBased) {
                    headersHtml += `
                        <span class="col-s1">S1</span>
                        <span class="col-s2">S2</span>
                        <span class="col-s3">S3</span>
                        <span class="col-best">BEST</span>
                        <span class="col-gap">${refDriver ? 'GAP' : 'GAP'}</span>
                        <span class="col-laps">LAPS</span>
                        <span class="col-stat">STAT</span>
                    `;
                } else {
                    headersHtml += `
                        <span class="col-tyre">TYRE</span>
                        <span class="col-s1">S1</span>
                        <span class="col-s2">S2</span>
                        <span class="col-s3">S3</span>
                        <span class="col-gap">${refDriver ? 'GAP' : 'LEAD'}</span>
                        <span class="col-int">INT</span>
                        <span class="col-best">BEST</span>
                        <span class="col-laps">LAPS</span>
                    `;
                }
            }
            setHtml("leaderboard-headers", headersHtml);

            let lbHtml = "";
            data.leaderboard.forEach((driver, idx) => {
                const isPlayer = driver.carIndex === pIdx;
                const isRefDriver = refDriver && driver.carIndex === refDriver.carIndex;
                const isFastest = driver.carIndex === data.session.fastestLapCarIndex && driver.bestLapMs > 0;
                const teamColor = getTeamColorCss(driver, data);
                const name = data.participants?.[driver.carIndex] || `Car ${driver.carIndex}`;
                const bestStr = driver.bestLapMs > 0 ? formatMs(driver.bestLapMs) : "--:--.---";
                let bestClass = isFastest ? "purple" : (driver.bestLapMs > 0 ? "green" : "");

                let penHtml = "";
                if (driver.penalties > 0) penHtml += `<span class="badge-pen time-pen">+${driver.penalties}s</span>`;
                if (driver.unservedDT > 0) penHtml += `<span class="badge-pen dt-pen">DT</span>`;

                const dS1 = driver.s1 || 0;
                const dS2 = driver.s2 || 0;
                const dS3 = driver.s3 || 0;
                const dBestS1 = driver.bestS1 || 0;
                const dBestS2 = driver.bestS2 || 0;
                const dBestS3 = driver.bestS3 || 0;

                const curSec = driver.currentSector;
                const s1Badge = getSectorBadgeHtml(dS1, dBestS1, sb1, curSec === 0 && driver.pitStatus === 0, driver.s1Status);
                const s2Badge = getSectorBadgeHtml(dS2, dBestS2, sb2, curSec === 1 && driver.pitStatus === 0, driver.s2Status);
                const s3Badge = getSectorBadgeHtml(dS3, dBestS3, sb3, curSec === 2 && driver.pitStatus === 0, driver.s3Status);

                // Gap & Interval relative to Selected Reference Driver (or Leader by default)
                let gapDisplay = '--';
                let intDisplay = '--';

                if (refDriver) {
                    if (isRefDriver) {
                        gapDisplay = `<span class="val-ref">0.000</span>`;
                        intDisplay = `<span class="val-ref">REF</span>`;
                    } else if (driver.pitStatus > 0) {
                        gapDisplay = '<span class="badge-pen">PIT</span>';
                        intDisplay = '<span class="badge-pen">PIT</span>';
                    } else if (isTimeBased) {
                        const currBest = driver.bestLapMs || 0;
                        const refBest = refDriver.bestLapMs || 0;
                        if (currBest > 0 && refBest > 0) {
                            const diff = (currBest - refBest) / 1000;
                            if (diff < 0) {
                                gapDisplay = `<span style="color:var(--fia-green); font-weight:700;">-${Math.abs(diff).toFixed(3)}</span>`;
                            } else if (diff > 0) {
                                gapDisplay = `<span style="color:var(--fia-yellow); font-weight:700;">+${diff.toFixed(3)}</span>`;
                            } else {
                                gapDisplay = '0.000';
                            }
                        } else {
                            gapDisplay = '--';
                        }
                        intDisplay = (idx > 0) ? (driver.gapInt || '--') : '--';
                    } else {
                        // RACE MODE relative to Reference Driver
                        const currLead = Number.isFinite(driver.leadSec) ? driver.leadSec : (parseFloat(String(driver.gapLead).replace(/[^\d.-]/g, '')) || 0);
                        const refLead = Number.isFinite(refDriver.leadSec) ? refDriver.leadSec : (parseFloat(String(refDriver.gapLead).replace(/[^\d.-]/g, '')) || 0);

                        const lapDiff = (refDriver.lapNum || 0) - (driver.lapNum || 0);
                        if (Math.abs(lapDiff) >= 1 && (driver.lapsDown > 0 || Math.abs(currLead - refLead) > 60)) {
                            gapDisplay = (lapDiff > 0) ? `+${lapDiff} LAP${lapDiff > 1 ? 'S' : ''}` : `-${Math.abs(lapDiff)} LAP${Math.abs(lapDiff) > 1 ? 'S' : ''}`;
                        } else {
                            const deltaToRef = currLead - refLead;
                            if (deltaToRef < 0) {
                                gapDisplay = `<span style="color:var(--fia-green); font-weight:700;">-${Math.abs(deltaToRef).toFixed(3)}</span>`;
                            } else if (deltaToRef > 0) {
                                gapDisplay = `<span style="color:var(--fia-yellow); font-weight:700;">+${deltaToRef.toFixed(3)}</span>`;
                            } else {
                                gapDisplay = '0.000';
                            }
                        }

                        if (idx < refIdx) {
                            intDisplay = (idx === 0) ? 'LEAD' : (driver.gapInt || '--');
                        } else if (idx === refIdx + 1) {
                            const deltaBehind = currLead - refLead;
                            intDisplay = (deltaBehind > 0) ? `+${deltaBehind.toFixed(3)}` : (driver.gapInt || '--');
                        } else {
                            intDisplay = driver.gapInt || '--';
                        }
                    }
                } else {
                    // DEFAULT (Leader reference)
                    if (isTimeBased && driver.bestLapMs > 0 && poleTime > 0) {
                        if (driver.bestLapMs === poleTime) {
                            gapDisplay = '<span style="color:var(--rbr-yellow); font-weight:700;">POLE</span>';
                        } else {
                            const diff = (driver.bestLapMs - poleTime) / 1000;
                            gapDisplay = `+${diff.toFixed(3)}`;
                        }
                        intDisplay = (idx > 0) ? (driver.gapInt || `+${((driver.bestLapMs - (data.leaderboard[idx - 1].bestLapMs || poleTime)) / 1000).toFixed(3)}`) : '--';
                    } else {
                        gapDisplay = (idx === 0) ? 'LEAD' : (driver.gapLead || driver.gapText || '--');
                        intDisplay = (idx === 0) ? 'LEAD' : (driver.gapInt || driver.gapText || '--');
                    }
                }

                let rowHtml = `<div class="lb-row ${isPlayer ? 'is-player' : ''} ${isRefDriver ? 'is-ref-driver' : ''}" onclick="selectDriverAsReference(${driver.carIndex}, event)" style="cursor: pointer;">
                    <span class="col-pos">${driver.pos || idx + 1}</span>
                    <span class="col-driver">
                        <span class="team-stripe" style="background: ${teamColor};"></span>
                        <span class="driver-name-text">${name.toUpperCase()}${penHtml}${isRefDriver ? ' <span class="ref-badge">REF</span>' : ''}</span>
                    </span>`;

                if (lbViewMode === 'timing') {
                    if (isTimeBased) {
                        rowHtml += `
                            <span class="col-best val ${bestClass}">${bestStr}</span>
                            <span class="col-gap val">${gapDisplay}</span>
                            <span class="col-int val">${intDisplay}</span>
                            <span class="col-laps val">${driver.lapNum || 0}</span>
                            <span class="col-stat val" style="color:var(--text-muted);">${driver.pitStatus > 0 ? 'PIT' : 'TRACK'}</span>
                        `;
                    } else {
                        rowHtml += `
                            <span class="col-tyre" style="color:${driver.tyreClass || '#FFF'};">${driver.tyre || '-'}</span>
                            <span class="col-gap val">${gapDisplay}</span>
                            <span class="col-int val">${intDisplay}</span>
                            <span class="col-best val ${bestClass}">${bestStr}</span>
                            <span class="col-laps val">${driver.lapNum || 0}</span>
                        `;
                    }
                } else if (lbViewMode === 'sectors') {
                    rowHtml += `
                        <span class="col-s1">${s1Badge}</span>
                        <span class="col-s2">${s2Badge}</span>
                        <span class="col-s3">${s3Badge}</span>
                        <span class="col-best val ${bestClass}">${bestStr}</span>
                        <span class="col-gap val">${gapDisplay}</span>
                    `;
                } else {
                    // 'all' mode
                    if (isTimeBased) {
                        rowHtml += `
                            <span class="col-s1">${s1Badge}</span>
                            <span class="col-s2">${s2Badge}</span>
                            <span class="col-s3">${s3Badge}</span>
                            <span class="col-best val ${bestClass}">${bestStr}</span>
                            <span class="col-gap val">${gapDisplay}</span>
                            <span class="col-laps val">${driver.lapNum || 0}</span>
                            <span class="col-stat val" style="color:var(--text-muted);">${driver.pitStatus > 0 ? 'PIT' : 'TRACK'}</span>
                        `;
                    } else {
                        rowHtml += `
                            <span class="col-tyre" style="color:${driver.tyreClass || '#FFF'};">${driver.tyre || '-'}</span>
                            <span class="col-s1">${s1Badge}</span>
                            <span class="col-s2">${s2Badge}</span>
                            <span class="col-s3">${s3Badge}</span>
                            <span class="col-gap val">${gapDisplay}</span>
                            <span class="col-int val">${intDisplay}</span>
                            <span class="col-best val ${bestClass}">${bestStr}</span>
                            <span class="col-laps val">${driver.lapNum || 0}</span>
                        `;
                    }
                }
                rowHtml += `</div>`;
                lbHtml += rowHtml;
            });
            setHtml("leaderboard-container", lbHtml);
        }

        let currentRadarMobileView = 'timing';
        function setRadarMobileView(mode) {
            currentRadarMobileView = mode;
            const btnMap = document.getElementById('radar-btn-map');
            const btnTiming = document.getElementById('radar-btn-timing');
            const btnDual = document.getElementById('radar-btn-dual');
            if (btnMap) btnMap.classList.toggle('active', mode === 'map');
            if (btnTiming) btnTiming.classList.toggle('active', mode === 'timing');
            if (btnDual) btnDual.classList.toggle('active', mode === 'dual');

            const tabRadar = document.getElementById('tab-radar');
            if (tabRadar) {
                tabRadar.setAttribute('data-mobile-view', mode);
            }

            setTimeout(() => {
                resizeThreeJS();
                updateMapOverlays();
            }, 20);
        }

        function refreshTelemetryConnection() {
            const spinner = document.getElementById('refresh-spinner-icon');
            if (spinner) {
                spinner.style.transition = 'transform 0.6s ease';
                spinner.style.transform = (spinner.style.transform === 'rotate(360deg)') ? 'rotate(0deg)' : 'rotate(360deg)';
            }
            if (ws) {
                try { ws.close(); } catch (e) { }
            }
            connectWebSocket();
            showToast("🔄 Reconnecting Telemetry Uplink & Refreshing UI...");
        }

        function switchTab(tabId, btnElement) {
            document.querySelectorAll(".tab-content").forEach((tab) => setClass(tab, tab.id === tabId ? "active" : null, ["active"]));
            document.querySelectorAll(".nav-btn").forEach((btn) => setClass(btn, btn === btnElement ? "active" : null, ["active"]));
            if (tabId === "tab-radar") {
                setTimeout(() => { resizeThreeJS(); updateMapOverlays(); }, 15);
            } else if (tabId === "tab-telemetry") {
                setTimeout(() => drawGGraph(), 15);
            } else if (tabId === "tab-laptimes") {
                setTimeout(() => {
                    if (window.lastTelemetryData) {
                        renderLapHistoryTable(window.lastTelemetryData);
                    }
                }, 15);
            } else if (tabId === "tab-ers-fuel") {
                setTimeout(() => {
                    if (window.lastTelemetryData) {
                        updateErsFuelDisplay(window.lastTelemetryData);
                    }
                }, 15);
            } else if (tabId === "tab-session-history") {
                setTimeout(() => {
                    if (window.lastTelemetryData) {
                        drawPaceChart(window.lastTelemetryData);
                        updateRivalComparison(window.lastTelemetryData);
                    }
                }, 15);
            }
        }

        function downloadSessionJson() {
            showToast("Generating Complete Session Telemetry JSON snapshot...");
            window.location.href = "/api/session/export";
        }

        /* ── Restored Sector Popup Function ── */
        function showSectorPopup(event, s1, s2, s3, sb1, sb2, sb3, pb1, pb2, pb3) {
            let popup = document.getElementById("sector-time-popup");
            if (!popup) {
                popup = document.createElement("div");
                popup.id = "sector-time-popup";
                popup.className = "track-popup";
                document.body.appendChild(popup);
                document.addEventListener("click", (e) => {
                    if (e.target !== popup && !e.target.closest("td.lap-cell")) {
                        popup.style.display = "none";
                    }
                });
            }

            function getColorClass(ms, sb, pb) {
                if (!ms || ms <= 0) return "";
                if (sb > 0 && ms <= sb) return "val purple";
                if (pb > 0 && ms <= pb) return "val green";
                return "val yellow";
            }

            const c1 = getColorClass(s1, sb1, pb1);
            const c2 = getColorClass(s2, sb2, pb2);
            const c3 = getColorClass(s3, sb3, pb3);

            popup.innerHTML = `
                <div class="name" style="font-weight:700; margin-bottom:4px; font-size:0.8rem; color:var(--rbr-yellow);">SECTOR TIMES</div>
                <div style="display:flex; justify-content:space-between; gap:12px; font-size:0.75rem; font-family:'Roboto Mono',monospace;"><span>S1</span><span class="${c1}">${s1 > 0 ? (s1 / 1000).toFixed(3) : "--.---"}</span></div>
                <div style="display:flex; justify-content:space-between; gap:12px; font-size:0.75rem; font-family:'Roboto Mono',monospace;"><span>S2</span><span class="${c2}">${s2 > 0 ? (s2 / 1000).toFixed(3) : "--.---"}</span></div>
                <div style="display:flex; justify-content:space-between; gap:12px; font-size:0.75rem; font-family:'Roboto Mono',monospace;"><span>S3</span><span class="${c3}">${s3 > 0 ? (s3 / 1000).toFixed(3) : "--.---"}</span></div>
            `;
            popup.style.display = "block";
            popup.style.left = event.pageX + 10 + "px";
            popup.style.top = event.pageY - 20 + "px";
            event.stopPropagation();
        }

        /* ══════════ RESTORED FULL GAMEPAD ENGINE ══════════ */
        let gamepadAnimFrame = null;
        let selectedGamepadIndex = null;
        let lastGamepadSignature = "";

        const gpDom = {
            btns: [],
            leftDot: null,
            leftVal: null,
            rightDot: null,
            rightVal: null,
            ltBar: null,
            rtBar: null,
            ltVal: null,
            rtVal: null,
            isInit: false,
            init() {
                if (this.isInit) return;
                for (let i = 0; i < 16; i++) {
                    this.btns[i] = document.getElementById(`gp-btn-${i}`);
                }
                this.leftDot = document.getElementById("stick-left-dot");
                this.leftVal = document.getElementById("stick-left-val");
                this.rightDot = document.getElementById("stick-right-dot");
                this.rightVal = document.getElementById("stick-right-val");
                this.ltBar = document.getElementById("lt-bar");
                this.rtBar = document.getElementById("rt-bar");
                this.ltVal = document.getElementById("lt-val");
                this.rtVal = document.getElementById("rt-val");
                this.isInit = true;
            }
        };

        function openGamepadModal() {
            const modal = document.getElementById("gamepad-modal");
            if (modal) {
                modal.style.display = "flex";
                refreshGamepadList(true);
                startGamepadLoop();
            }
        }

        function closeGamepadModal() {
            const modal = document.getElementById("gamepad-modal");
            if (modal) {
                modal.style.display = "none";
            }
            if (gamepadAnimFrame) {
                cancelAnimationFrame(gamepadAnimFrame);
                gamepadAnimFrame = null;
            }
        }

        window.addEventListener("keydown", (e) => {
            if (e.key === "Escape") closeGamepadModal();
        });

        function refreshGamepadList(force = false) {
            const select = document.getElementById("gamepad-select");
            const badge = document.getElementById("gamepad-status-badge");
            if (!select) return;

            const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
            let connectedCount = 0;
            let firstIndex = null;
            let sig = "";

            for (let i = 0; i < gamepads.length; i++) {
                const gp = gamepads[i];
                if (gp) {
                    connectedCount++;
                    if (firstIndex === null) firstIndex = i;
                    sig += `${i}:${gp.id};`;
                }
            }

            if (!force && sig === lastGamepadSignature) return;
            lastGamepadSignature = sig;

            select.innerHTML = "";

            for (let i = 0; i < gamepads.length; i++) {
                const gp = gamepads[i];
                if (gp) {
                    const opt = document.createElement("option");
                    opt.value = i;
                    opt.textContent = `[#${i}] ${gp.id.substring(0, 32)}`;
                    select.appendChild(opt);
                }
            }

            if (connectedCount === 0) {
                const opt = document.createElement("option");
                opt.value = "";
                opt.textContent = "No gamepad connected (press any button)";
                select.appendChild(opt);
                if (badge) {
                    badge.className = "gp-badge disconnected";
                    badge.innerText = "No Gamepad";
                }
                selectedGamepadIndex = null;
            } else {
                if (badge) {
                    badge.className = "gp-badge connected";
                    badge.innerText = `${connectedCount} Connected`;
                }
                if (selectedGamepadIndex === null || !gamepads[selectedGamepadIndex]) {
                    selectedGamepadIndex = firstIndex;
                }
                select.value = selectedGamepadIndex;
            }
        }

        function onGamepadSelectChange() {
            const select = document.getElementById("gamepad-select");
            if (select && select.value !== "") {
                selectedGamepadIndex = parseInt(select.value, 10);
            } else {
                selectedGamepadIndex = null;
            }
        }

        window.addEventListener("gamepadconnected", (e) => {
            console.log("Gamepad connected at index %d: %s", e.gamepad.index, e.gamepad.id);
            refreshGamepadList(true);
        });

        window.addEventListener("gamepaddisconnected", (e) => {
            console.log("Gamepad disconnected from index %d: %s", e.gamepad.index, e.gamepad.id);
            refreshGamepadList(true);
        });

        function startGamepadLoop() {
            if (gamepadAnimFrame) cancelAnimationFrame(gamepadAnimFrame);

            function loop() {
                updateGamepadState();
                gamepadAnimFrame = requestAnimationFrame(loop);
            }
            loop();
        }

        function updateGamepadState() {
            gpDom.init();
            refreshGamepadList(false);

            const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
            let gp = null;
            if (selectedGamepadIndex !== null && gamepads[selectedGamepadIndex]) {
                gp = gamepads[selectedGamepadIndex];
            } else {
                for (let i = 0; i < gamepads.length; i++) {
                    if (gamepads[i]) {
                        gp = gamepads[i];
                        selectedGamepadIndex = i;
                        break;
                    }
                }
            }

            if (!gp) {
                for (let i = 0; i < 16; i++) {
                    if (gpDom.btns[i]) gpDom.btns[i].classList.remove("active");
                }
                if (gpDom.leftDot) gpDom.leftDot.style.transform = "translate(0px, 0px)";
                if (gpDom.rightDot) gpDom.rightDot.style.transform = "translate(0px, 0px)";
                if (gpDom.ltBar) gpDom.ltBar.style.width = "0%";
                if (gpDom.rtBar) gpDom.rtBar.style.width = "0%";
                if (gpDom.ltVal) gpDom.ltVal.innerText = "0.0% (0.00)";
                if (gpDom.rtVal) gpDom.rtVal.innerText = "0.0% (0.00)";
                return;
            }

            // Update buttons
            for (let i = 0; i < 16; i++) {
                const btn = gp.buttons[i];
                const isPressed = btn ? (btn.pressed || (typeof btn.value === "number" && btn.value > 0.5)) : false;
                if (gpDom.btns[i]) {
                    if (isPressed) {
                        gpDom.btns[i].classList.add("active");
                    } else {
                        gpDom.btns[i].classList.remove("active");
                    }
                }
            }

            // Analog Sticks
            const lx = gp.axes[0] || 0;
            const ly = gp.axes[1] || 0;
            if (gpDom.leftDot) {
                gpDom.leftDot.style.transform = `translate(${lx * 32}px, ${ly * 32}px)`;
            }
            if (gpDom.leftVal) {
                gpDom.leftVal.innerText = `X: ${lx.toFixed(2)} | Y: ${ly.toFixed(2)}`;
            }

            const rx = gp.axes[2] || 0;
            const ry = gp.axes[3] || 0;
            if (gpDom.rightDot) {
                gpDom.rightDot.style.transform = `translate(${rx * 32}px, ${ry * 32}px)`;
            }
            if (gpDom.rightVal) {
                gpDom.rightVal.innerText = `X: ${rx.toFixed(2)} | Y: ${ry.toFixed(2)}`;
            }

            // Analog Triggers (Button 6 LT, Button 7 RT)
            let ltRaw = 0;
            if (gp.buttons[6]) {
                ltRaw = typeof gp.buttons[6].value === "number" ? gp.buttons[6].value : (gp.buttons[6].pressed ? 1 : 0);
            }
            let rtRaw = 0;
            if (gp.buttons[7]) {
                rtRaw = typeof gp.buttons[7].value === "number" ? gp.buttons[7].value : (gp.buttons[7].pressed ? 1 : 0);
            }

            const ltVal = Math.max(0, Math.min(1, ltRaw));
            const rtVal = Math.max(0, Math.min(1, rtRaw));

            const ltPercent = (ltVal * 100).toFixed(1);
            const rtPercent = (rtVal * 100).toFixed(1);

            if (gpDom.ltBar) gpDom.ltBar.style.width = `${ltPercent}%`;
            if (gpDom.rtBar) gpDom.rtBar.style.width = `${rtPercent}%`;
            if (gpDom.ltVal) gpDom.ltVal.innerText = `${ltPercent}% (${ltVal.toFixed(2)})`;
            if (gpDom.rtVal) gpDom.rtVal.innerText = `${rtPercent}% (${rtVal.toFixed(2)})`;
        }

        function testGamepadVibration(durationMs = 1000) {
            const statusEl = document.getElementById("gamepad-vibe-status");
            const weakMag = parseFloat(document.getElementById("weak-mag")?.value || 1);
            const strongMag = parseFloat(document.getElementById("strong-mag")?.value || 1);

            const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
            let gp = null;

            if (selectedGamepadIndex !== null && gamepads[selectedGamepadIndex]) {
                gp = gamepads[selectedGamepadIndex];
            } else {
                for (let i = 0; i < gamepads.length; i++) {
                    if (gamepads[i]) {
                        gp = gamepads[i];
                        break;
                    }
                }
            }

            if (!gp) {
                if (statusEl) {
                    statusEl.className = "vibe-status-msg";
                    statusEl.innerHTML = "<span style='color: var(--f1-red);'>⚠️ No gamepad connected to test vibration!</span>";
                }
                return;
            }

            if (statusEl) {
                statusEl.className = "vibe-status-msg vibrating";
                statusEl.innerHTML = `⚡ Vibrating controller (${(durationMs / 1000).toFixed(1)}s)...`;
            }

            // Standard Web Gamepad Vibration Actuator API (Dual-Rumble)
            if (gp.vibrationActuator && typeof gp.vibrationActuator.playEffect === "function") {
                gp.vibrationActuator.playEffect("dual-rumble", {
                    startDelay: 0,
                    duration: durationMs,
                    weakMagnitude: weakMag,
                    strongMagnitude: strongMag
                }).then(() => {
                    if (statusEl) {
                        statusEl.className = "vibe-status-msg";
                        statusEl.innerHTML = `✅ Vibration test completed successfully (${(durationMs / 1000).toFixed(1)}s).`;
                    }
                }).catch((err) => {
                    if (statusEl) {
                        statusEl.className = "vibe-status-msg";
                        statusEl.innerHTML = `<span style='color: var(--f1-red);'>⚠️ Vibration failed: ${err.message}</span>`;
                    }
                });
            } else {
                if (statusEl) {
                    statusEl.className = "vibe-status-msg";
                    statusEl.innerHTML = "<span style='color: var(--f1-red);'>⚠️ Vibration actuator not supported by this browser or gamepad.</span>";
                }
            }
        }
        /* ── Three.js Map Setup ── */
        const mapContainer = document.getElementById("track-map-container");
        const mapWrapper = mapContainer.closest(".map-wrapper");
        const mapLabelLayer = document.getElementById("map-label-layer");
        const mapZoomIn = document.getElementById("map-zoom-in");
        const mapZoomOut = document.getElementById("map-zoom-out");
        const scene = new THREE.Scene();
        let aspect = mapContainer.clientWidth / mapContainer.clientHeight || 1;
        let trackViewSize = 1200;
        let trackBaseViewSize = 1200;
        let trackZoom = 1;
        const trackViewCenter = new THREE.Vector3(0, 0, 0);
        const camera = new THREE.OrthographicCamera(
            -trackViewSize * aspect,
            trackViewSize * aspect,
            trackViewSize,
            -trackViewSize,
            1,
            2000,
        );
        camera.position.set(0, 500, 0);
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
        });
        renderer.setSize(
            mapContainer.clientWidth || 400,
            mapContainer.clientHeight || 400,
        );
        mapContainer.appendChild(renderer.domElement);

        const gridHelper = new THREE.GridHelper(20000, 400, 0x0e0e18, 0x0e0e18);
        gridHelper.position.y = -20;
        scene.add(gridHelper);

        const trackMaterials = [
            new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.9 }), // Sector 1: Red
            new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.9 }), // Sector 2: Blue
            new THREE.MeshBasicMaterial({ color: 0xeab308, transparent: true, opacity: 0.9 })  // Sector 3: Yellow
        ];
        const trackLines = [
            new THREE.Mesh(new THREE.BufferGeometry(), trackMaterials[0]),
            new THREE.Mesh(new THREE.BufferGeometry(), trackMaterials[1]),
            new THREE.Mesh(new THREE.BufferGeometry(), trackMaterials[2])
        ];
        trackLines.forEach(line => {
            line.position.y = -10;
            line.renderOrder = -10;
            line.frustumCulled = false;
            scene.add(line);
        });

        const carMeshes = [];
        const carScreenData = [];
        let latestMapData = null;
        let selectedCarIndex = null;
        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        const mapPointers = new Map();
        let isMapPanning = false;
        let lastPanPoint = null;
        let lastPinchDistance = 0;
        let suppressNextMapClick = false;
        const carGeometry = new THREE.CircleGeometry(16, 32);
        for (let i = 0; i < 24; i++) {
            const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
            const mesh = new THREE.Mesh(carGeometry, mat);
            mesh.rotation.x = -Math.PI / 2;
            mesh.visible = false;
            mesh.userData.carIndex = i;
            scene.add(mesh);
            carMeshes.push(mesh);
        }

        /**
         * Creates a visual sector line overlay for the track map.
         * Rendered as a square-shaped marker across the track.
         */
        function createSectorLine(color) {
            const geometry = new THREE.PlaneGeometry(24, 24);
            const material = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.95,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.rotation.order = "YXZ";
            mesh.rotation.x = -Math.PI / 2;
            mesh.visible = false;
            mesh.renderOrder = -1;
            scene.add(mesh);
            return mesh;
        }
        const startLineMesh = createSectorLine(0xffd700); // Yellow
        const sector1LineMesh = createSectorLine(0xff00ff); // Purple
        const sector2LineMesh = createSectorLine(0x00ffff); // Cyan
        let pitLaneMesh = null;
        const customSectorMeshes = [];
        const drsZoneMeshes = [];

        const OFFICIAL_DRS_ZONES = {
            // Melbourne (Albert Park) - 3 zones
            0: [{ start: 0.96, end: 0.12, det: 0.91 }, { start: 0.22, end: 0.34, det: 0.18 }, { start: 0.53, end: 0.65, det: 0.49 }],
            // Shanghai - 2 zones
            2: [{ start: 0.95, end: 0.12, det: 0.90 }, { start: 0.58, end: 0.78, det: 0.54 }],
            // Bahrain (Sakhir) - 3 zones
            3: [{ start: 0.96, end: 0.13, det: 0.91 }, { start: 0.22, end: 0.34, det: 0.18 }, { start: 0.60, end: 0.72, det: 0.56 }],
            // Catalunya (Barcelona) - 2 zones
            4: [{ start: 0.97, end: 0.13, det: 0.92 }, { start: 0.48, end: 0.64, det: 0.45 }],
            // Monaco - 1 zone (pit straight)
            5: [{ start: 0.95, end: 0.08, det: 0.91 }],
            // Montreal (Canada) - 2 zones: hairpin to T1 + back straight
            6: [{ start: 0.93, end: 0.09, det: 0.88 }, { start: 0.22, end: 0.40, det: 0.18 }],
            // Silverstone - 2 zones
            7: [{ start: 0.28, end: 0.42, det: 0.24 }, { start: 0.68, end: 0.83, det: 0.64 }],
            // Hungaroring - 2 zones
            9: [{ start: 0.96, end: 0.12, det: 0.91 }, { start: 0.16, end: 0.26, det: 0.13 }],
            // Spa-Francorchamps - 2 zones: Raidillon + Kemmel
            10: [{ start: 0.18, end: 0.35, det: 0.14 }, { start: 0.94, end: 0.06, det: 0.90 }],
            // Monza - 2 zones
            11: [{ start: 0.95, end: 0.13, det: 0.91 }, { start: 0.36, end: 0.49, det: 0.32 }],
            // Singapore (Marina Bay) - 3 zones
            12: [{ start: 0.96, end: 0.10, det: 0.92 }, { start: 0.30, end: 0.44, det: 0.26 }, { start: 0.65, end: 0.77, det: 0.61 }],
            // Suzuka - 2 zones: main straight + esses back straight
            13: [{ start: 0.93, end: 0.07, det: 0.88 }, { start: 0.35, end: 0.47, det: 0.31 }],
            // Abu Dhabi (Yas Marina) - 2 zones
            14: [{ start: 0.32, end: 0.46, det: 0.28 }, { start: 0.50, end: 0.63, det: 0.47 }],
            // Texas (COTA) - 2 zones
            15: [{ start: 0.96, end: 0.11, det: 0.92 }, { start: 0.38, end: 0.54, det: 0.34 }],
            // Interlagos (Brazil) - 2 zones
            16: [{ start: 0.88, end: 0.10, det: 0.84 }, { start: 0.22, end: 0.36, det: 0.18 }],
            // Austria (Red Bull Ring) - 3 zones
            17: [{ start: 0.96, end: 0.11, det: 0.92 }, { start: 0.20, end: 0.36, det: 0.16 }, { start: 0.45, end: 0.58, det: 0.42 }],
            // Mexico City - 3 zones
            19: [{ start: 0.92, end: 0.12, det: 0.88 }, { start: 0.18, end: 0.29, det: 0.15 }, { start: 0.62, end: 0.72, det: 0.58 }],
            // Baku (Azerbaijan) - 2 zones
            20: [{ start: 0.85, end: 0.14, det: 0.81 }, { start: 0.20, end: 0.30, det: 0.17 }],
            // Zandvoort (Netherlands) - 2 zones
            26: [{ start: 0.90, end: 0.09, det: 0.86 }, { start: 0.28, end: 0.38, det: 0.25 }],
            // Imola (Emilia Romagna) - 2 zones: pit straight + back straight (Variante Tamburello area)
            27: [{ start: 0.96, end: 0.10, det: 0.92 }, { start: 0.26, end: 0.31, det: 0.22 }],
            // Jeddah (Saudi Arabia) - 3 zones along the Corniche circuit
            29: [{ start: 0.93, end: 0.10, det: 0.88 }, { start: 0.18, end: 0.31, det: 0.14 }, { start: 0.59, end: 0.71, det: 0.55 }],
            // Miami - 2 zones: pit straight + sector 3 straight
            30: [{ start: 0.90, end: 0.06, det: 0.85 }, { start: 0.46, end: 0.62, det: 0.42 }],
            // Las Vegas - 2 zones: Koval Lane (T4->T5) + The Strip (T13->T14)
            31: [{ start: 0.15, end: 0.245, det: 0.12 }, { start: 0.60, end: 0.83, det: 0.55 }],
            // Qatar (Losail) - 2 zones
            32: [{ start: 0.93, end: 0.07, det: 0.88 }, { start: 0.46, end: 0.60, det: 0.42 }],
            // Silverstone (Reversed) - approximate
            39: [{ start: 0.58, end: 0.72, det: 0.54 }, { start: 0.18, end: 0.32, det: 0.14 }],
            // Austria (Reversed) - approximate
            40: [{ start: 0.42, end: 0.55, det: 0.38 }, { start: 0.64, end: 0.80, det: 0.60 }],
            // Zandvoort (Reversed) - approximate
            41: [{ start: 0.62, end: 0.72, det: 0.58 }, { start: 0.91, end: 0.10, det: 0.87 }],
            // Madrid (IFEMA) - 2 zones
            42: [{ start: 0.96, end: 0.12, det: 0.92 }, { start: 0.45, end: 0.60, det: 0.41 }]
        };

        const F1_TRACK_MAP = {
            0: "Melbourne", 2: "Shanghai", 3: "Sakhir (Bahrain)", 4: "Catalunya", 5: "Monaco", 6: "Montreal", 7: "Silverstone",
            9: "Hungaroring", 10: "Spa", 11: "Monza", 12: "Singapore", 13: "Suzuka", 14: "Abu Dhabi", 15: "Texas", 16: "Brazil",
            17: "Austria", 19: "Mexico", 20: "Baku", 26: "Zandvoort", 27: "Imola", 29: "Jeddah", 30: "Miami", 31: "Las Vegas",
            32: "Losail", 39: "Silverstone (Rev)", 40: "Austria (Rev)", 41: "Zandvoort (Rev)", 42: "Madrid"
        };

        const currentTrackMap = {
            trackId: null,
            pointsLength: 0,
            trackPoints: null,
            startLine: null,
            sector1: null,
            sector2: null,
            isOfflineOverride: false,
            requestedTrackId: null
        };

        let radarCameraMode = 'orbit';

        function setRadarCameraMode(mode) {
            radarCameraMode = mode;
            ['orbit', 'follow', 'top'].forEach(m => {
                const btn = document.getElementById(`cam-btn-${m}`);
                if (btn) btn.classList.toggle('active', m === mode);
            });
            if (mode === 'top') {
                camera.rotation.set(-Math.PI / 2, 0, 0);
            }
            if (mode === 'orbit' || mode === 'top') {
                fitTrackCamera();
            }
        }

        function fitTrackCamera() {
            trackZoom = 1;
            if (currentTrackMap.trackPoints && currentTrackMap.trackPoints.length > 0) {
                let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
                currentTrackMap.trackPoints.forEach(p => {
                    if (p.x < minX) minX = p.x;
                    if (p.x > maxX) maxX = p.x;
                    if (p.z < minZ) minZ = p.z;
                    if (p.z > maxZ) maxZ = p.z;
                });
                trackViewCenter.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
                trackBaseViewSize = Math.max((maxX - minX), (maxZ - minZ)) / 2 + 200;
            } else {
                trackViewCenter.set(0, 0, 0);
                trackBaseViewSize = 1200;
            }
            updateTrackCameraBounds();
        }

        /**
         * Main render loop for Three.js. Requests the next animation frame and 
         * redraws the scene and dynamic map overlays (driver labels).
         */
        function animate() {
            requestAnimationFrame(animate);
            if (radarCameraMode === 'follow' && latestMapData && latestMapData.playerIndex !== undefined) {
                const pIdx = latestMapData.playerIndex;
                const pMesh = carMeshes[pIdx];
                if (pMesh && pMesh.visible) {
                    trackViewCenter.lerp(new THREE.Vector3(pMesh.position.x, 0, pMesh.position.z), 0.08);
                    updateTrackCameraBounds();
                }
            }
            renderer.render(scene, camera);
            updateMapOverlays();
        }
        animate();

        /**
         * Recalculates the Orthographic camera bounds (view size and aspect ratio)
         * whenever the window is resized or the user zooms the map.
         */
        function updateTrackCameraBounds() {
            const width = mapContainer.clientWidth || 400;
            const height = mapContainer.clientHeight || 400;
            aspect = width / height;
            trackViewSize = trackBaseViewSize / trackZoom;
            camera.left = -trackViewSize * aspect;
            camera.right = trackViewSize * aspect;
            camera.top = trackViewSize;
            camera.bottom = -trackViewSize;
            camera.position.set(trackViewCenter.x, 500, trackViewCenter.z);
            camera.lookAt(trackViewCenter.x, 0, trackViewCenter.z);
            camera.updateProjectionMatrix();
        }

        /**
         * Clears all 3D track geometries and meshes, resetting canvas to empty state.
         */
        function clearTrackGeometry() {
            currentTrackMap.trackId = null;
            currentTrackMap.pointsLength = 0;
            currentTrackMap.trackPoints = [];
            currentTrackMap.startLine = null;
            currentTrackMap.sector1 = null;
            currentTrackMap.sector2 = null;

            for (let i = 0; i < 3; i++) {
                if (trackLines[i]) {
                    if (trackLines[i].geometry) trackLines[i].geometry.dispose();
                    trackLines[i].geometry = new THREE.BufferGeometry();
                    trackLines[i].visible = false;
                }
            }

            if (typeof pitLaneMesh !== 'undefined' && pitLaneMesh) {
                if (pitLaneMesh.geometry) pitLaneMesh.geometry.dispose();
                pitLaneMesh.geometry = new THREE.BufferGeometry();
                pitLaneMesh.visible = false;
            }

            if (startLineMesh) startLineMesh.visible = false;
            if (sector1LineMesh) sector1LineMesh.visible = false;
            if (sector2LineMesh) sector2LineMesh.visible = false;

            if (Array.isArray(drsZoneMeshes)) {
                drsZoneMeshes.forEach(mesh => {
                    scene.remove(mesh);
                    if (mesh.geometry) mesh.geometry.dispose();
                    if (mesh.material) {
                        if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
                        else mesh.material.dispose();
                    }
                });
                drsZoneMeshes.length = 0;
            }

            if (window.liveRecordingLineMesh) {
                scene.remove(window.liveRecordingLineMesh);
                if (window.liveRecordingLineMesh.geometry) window.liveRecordingLineMesh.geometry.dispose();
                window.liveRecordingLineMesh = null;
            }

            try { localStorage.removeItem('f1_cached_track_map'); } catch (e) { }
        }

        /**
         * Renders an in-progress circuit path live as the car drives around an unmapped circuit.
         */
        function renderLiveRecordingPath(pts, trackId) {
            if (!pts || pts.length < 2) return;

            if (currentTrackMap.trackId !== trackId) {
                clearTrackGeometry();
                currentTrackMap.trackId = trackId;
            }

            const name = F1_TRACK_MAP[trackId] || (trackId !== null ? `TRACK ${trackId}` : 'CIRCUIT');
            setText("track-name", `${name.toUpperCase()} (MAPPING: ${pts.length} PTS)`);

            // Hide completed solid track lines while drawing live path
            for (let i = 0; i < 3; i++) {
                if (trackLines[i]) trackLines[i].visible = false;
            }
            if (typeof pitLaneMesh !== 'undefined' && pitLaneMesh) pitLaneMesh.visible = false;
            if (startLineMesh) startLineMesh.visible = false;
            if (sector1LineMesh) sector1LineMesh.visible = false;
            if (sector2LineMesh) sector2LineMesh.visible = false;

            const threePts = pts.map(p => new THREE.Vector3(p.x, 1, p.z));
            const geometry = new THREE.BufferGeometry().setFromPoints(threePts);

            if (!window.liveRecordingLineMesh) {
                const material = new THREE.LineBasicMaterial({
                    color: 0x00e5ff,
                    linewidth: 4,
                    transparent: true,
                    opacity: 0.95
                });
                window.liveRecordingLineMesh = new THREE.Line(geometry, material);
                scene.add(window.liveRecordingLineMesh);
            } else {
                window.liveRecordingLineMesh.geometry.dispose();
                window.liveRecordingLineMesh.geometry = geometry;
                window.liveRecordingLineMesh.visible = true;
            }

            // Adjust camera to frame live path
            let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
            pts.forEach(p => {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.z < minZ) minZ = p.z;
                if (p.z > maxZ) maxZ = p.z;
            });
            if (Number.isFinite(minX) && Number.isFinite(maxX)) {
                trackViewCenter.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
                trackViewSize = Math.max((maxX - minX), (maxZ - minZ)) * 0.7 + 80;
                fitTrackCamera();
            }
        }

        /**
         * Rebuilds and renders the 3D track tube geometries, start line, and timing sector markers.
         */
        function renderTrackGeometry(mapData, force = false) {
            if (!mapData || !mapData.trackPoints || !Array.isArray(mapData.trackPoints) || mapData.trackPoints.length === 0) {
                clearTrackGeometry();
                return;
            }

            // Clear temporary live recording line when full geometry arrives
            if (window.liveRecordingLineMesh) {
                scene.remove(window.liveRecordingLineMesh);
                if (window.liveRecordingLineMesh.geometry) window.liveRecordingLineMesh.geometry.dispose();
                window.liveRecordingLineMesh = null;
            }

            const tId = mapData.trackId !== undefined && mapData.trackId !== null ? parseInt(mapData.trackId, 10) : currentTrackMap.trackId;
            const ptsLen = mapData.trackPoints.length;

            // Skip expensive CatmullRom and TubeGeometry regeneration if this exact track is already rendered
            if (!force && currentTrackMap.trackId === tId && currentTrackMap.pointsLength === ptsLen && trackLines[0].geometry && trackLines[0].geometry.attributes && trackLines[0].geometry.attributes.position) {
                return;
            }

            currentTrackMap.trackId = tId;
            currentTrackMap.pointsLength = ptsLen;
            currentTrackMap.trackPoints = mapData.trackPoints;
            currentTrackMap.startLine = mapData.startLine || null;
            currentTrackMap.sector1 = mapData.sector1 || null;
            currentTrackMap.sector2 = mapData.sector2 || null;
            currentTrackMap.drsZones = Array.isArray(mapData.drsZones) ? mapData.drsZones : null;

            // Update Start Line Mesh
            if (mapData.startLine && mapData.startLine.yaw !== undefined && (mapData.startLine.x !== 0 || mapData.startLine.z !== 0)) {
                startLineMesh.position.set(mapData.startLine.x, 0, mapData.startLine.z);
                startLineMesh.rotation.y = -mapData.startLine.yaw;
                startLineMesh.visible = true;
            } else {
                startLineMesh.visible = false;
            }

            // Update Sector 1 Line Mesh
            if (mapData.sector1 && mapData.sector1.yaw !== undefined && (mapData.sector1.x !== 0 || mapData.sector1.z !== 0)) {
                sector1LineMesh.position.set(mapData.sector1.x, 0, mapData.sector1.z);
                sector1LineMesh.rotation.y = -mapData.sector1.yaw;
                sector1LineMesh.visible = true;
            } else {
                sector1LineMesh.visible = false;
            }

            // Update Sector 2 Line Mesh
            if (mapData.sector2 && mapData.sector2.yaw !== undefined && (mapData.sector2.x !== 0 || mapData.sector2.z !== 0)) {
                sector2LineMesh.position.set(mapData.sector2.x, 0, mapData.sector2.z);
                sector2LineMesh.rotation.y = -mapData.sector2.yaw;
                sector2LineMesh.visible = true;
            } else {
                sector2LineMesh.visible = false;
            }

            let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
            const threePts = [];
            mapData.trackPoints.forEach((pt) => {
                if (pt.x < minX) minX = pt.x;
                if (pt.x > maxX) maxX = pt.x;
                if (pt.z < minZ) minZ = pt.z;
                if (pt.z > maxZ) maxZ = pt.z;
                threePts.push(new THREE.Vector3(pt.x, 0, pt.z));
            });

            if (threePts.length > 2) {
                threePts.push(threePts[0].clone());
            }

            function getClosestIndex(pts, target, minIdx = 0, maxIdx = pts.length - 1) {
                if (!target) return Math.floor((minIdx + maxIdx) / 2);
                let minD = Infinity;
                let idx = minIdx;
                for (let i = minIdx; i <= maxIdx; i++) {
                    const d = Math.hypot(pts[i].x - target.x, pts[i].z - target.z);
                    if (d < minD) {
                        minD = d;
                        idx = i;
                    }
                }
                return idx;
            }

            // Remove duplicate end point to reorder cleanly
            threePts.pop();

            let startIdx = 0;
            if (mapData.startLine) {
                startIdx = getClosestIndex(threePts, mapData.startLine);
            }

            const orderedPts = threePts.slice(startIdx).concat(threePts.slice(0, startIdx));
            orderedPts.push(orderedPts[0].clone()); // Re-close loop

            const len = orderedPts.length - 1;
            const idx1 = mapData.sector1 ? getClosestIndex(orderedPts, mapData.sector1, 1, Math.max(2, len - 3)) : Math.floor(len / 3);
            const idx2 = mapData.sector2 ? getClosestIndex(orderedPts, mapData.sector2, Math.min(len - 2, idx1 + 1), len - 1) : Math.floor((len / 3) * 2);

            const ptsS1 = orderedPts.slice(0, idx1 + 1);
            const ptsS2 = orderedPts.slice(idx1, idx2 + 1);
            const ptsS3 = orderedPts.slice(idx2);

            const paths = [ptsS1, ptsS2, ptsS3];

            const hasSectors = mapData.sector1 && mapData.sector2;
            trackLines[0].material.color.setHex(hasSectors ? 0xef4444 : 0xdddddd);
            trackLines[1].material.color.setHex(hasSectors ? 0x3b82f6 : 0xdddddd);
            trackLines[2].material.color.setHex(hasSectors ? 0xeab308 : 0xdddddd);

            for (let i = 0; i < 3; i++) {
                if (trackLines[i].geometry) {
                    trackLines[i].geometry.dispose();
                }
                if (paths[i].length > 1) {
                    const curve = new THREE.CatmullRomCurve3(paths[i], false, 'catmullrom', 0.5);
                    trackLines[i].geometry = new THREE.TubeGeometry(curve, paths[i].length * 2, 8, 8, false);
                    trackLines[i].visible = true;
                } else {
                    trackLines[i].visible = false;
                }
            }

            // ── RENDER DRS ACTIVATION ZONES & DETECTION CIRCLES ──
            if (Array.isArray(drsZoneMeshes)) {
                drsZoneMeshes.forEach(mesh => {
                    scene.remove(mesh);
                    if (mesh.geometry) mesh.geometry.dispose();
                    if (mesh.material) {
                        if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
                        else mesh.material.dispose();
                    }
                });
                drsZoneMeshes.length = 0;
            }

            // Only render DRS zones for tracks with known official data — no fallback to prevent wrong zones
            const currentDrsZones = Array.isArray(mapData.drsZones) && mapData.drsZones.length > 0 ? mapData.drsZones : null;

            if (orderedPts.length >= 10 && currentDrsZones && currentDrsZones.length > 0) {
                // Calculate cumulative distances along circuit loop
                const cumDist = [0];
                for (let i = 1; i < orderedPts.length; i++) {
                    cumDist.push(cumDist[i - 1] + Math.hypot(orderedPts[i].x - orderedPts[i - 1].x, orderedPts[i].z - orderedPts[i - 1].z));
                }
                const totalCircDist = cumDist[cumDist.length - 1];

                // Determine outward normal orientation relative to track centroid
                const cTrackX = (minX + maxX) / 2;
                const cTrackZ = (minZ + maxZ) / 2;
                let outwardVotes = 0;
                for (let i = 1; i < orderedPts.length - 1; i++) {
                    const dx = orderedPts[i + 1].x - orderedPts[i - 1].x;
                    const dz = orderedPts[i + 1].z - orderedPts[i - 1].z;
                    const len = Math.hypot(dx, dz) || 1;
                    const d1 = Math.hypot(orderedPts[i].x - (dz / len) * 20 - cTrackX, orderedPts[i].z + (dx / len) * 20 - cTrackZ);
                    const d2 = Math.hypot(orderedPts[i].x + (dz / len) * 20 - cTrackX, orderedPts[i].z - (dx / len) * 20 - cTrackZ);
                    if (d1 > d2) outwardVotes++; else outwardVotes--;
                }
                const normalSign = outwardVotes >= 0 ? 1 : -1;

                const normalizeTrackDistance = (distance) => ((distance % totalCircDist) + totalCircDist) % totalCircDist;
                const distanceFromZoneValue = (zone, distanceKey, fractionKey) => {
                    const explicitDistance = Number(zone[distanceKey]);
                    if (Number.isFinite(explicitDistance)) return normalizeTrackDistance(explicitDistance);

                    const val = zone[fractionKey];
                    if (typeof val === 'object' && val !== null && Number.isFinite(val.d)) {
                        return normalizeTrackDistance(val.d);
                    }
                    const fraction = Number(val);
                    if (Number.isFinite(fraction)) {
                        return normalizeTrackDistance(((fraction % 1 + 1) % 1) * totalCircDist);
                    }
                    return 0;
                };

                const getPointAtDistance = (distance) => {
                    const target = normalizeTrackDistance(distance);
                    let idx = cumDist.findIndex(d => d >= target);
                    if (idx < 0) idx = orderedPts.length - 1;
                    if (idx === 0) return new THREE.Vector3(orderedPts[0].x, 0.4, orderedPts[0].z);
                    const p0 = orderedPts[idx - 1], p1 = orderedPts[idx];
                    const segLen = cumDist[idx] - cumDist[idx - 1] || 1;
                    const t = (target - cumDist[idx - 1]) / segLen;
                    return new THREE.Vector3(
                        p0.x + (p1.x - p0.x) * t,
                        0.4,
                        p0.z + (p1.z - p0.z) * t
                    );
                };

                const drsLineMat = new THREE.MeshBasicMaterial({
                    color: 0x00ff66,
                    transparent: true,
                    opacity: 0.95
                });
                const drsDetRingMat = new THREE.MeshBasicMaterial({
                    color: 0x00ff66,
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity: 0.95,
                    blending: THREE.AdditiveBlending
                });

                currentDrsZones.forEach((z) => {
                    const startDistance = distanceFromZoneValue(z, 'startDistance', 'start');
                    const endDistance = distanceFromZoneValue(z, 'endDistance', 'end');
                    let zoneSpan = endDistance - startDistance;
                    if (zoneSpan <= 0) zoneSpan += totalCircDist;

                    const rawZonePts = [];
                    const sampleCount = Math.max(2, Math.ceil(zoneSpan / 18));
                    for (let i = 0; i <= sampleCount; i++) {
                        rawZonePts.push(getPointAtDistance(startDistance + (zoneSpan * i / sampleCount)));
                    }

                    if (rawZonePts.length >= 2) {
                        const offsetZonePts = [];
                        const offsetDist = 20;
                        for (let i = 0; i < rawZonePts.length; i++) {
                            const prev = rawZonePts[Math.max(0, i - 1)];
                            const next = rawZonePts[Math.min(rawZonePts.length - 1, i + 1)];
                            const dx = next.x - prev.x;
                            const dz = next.z - prev.z;
                            const len = Math.hypot(dx, dz) || 1;
                            const nx = -(dz / len) * normalSign;
                            const nz = (dx / len) * normalSign;
                            offsetZonePts.push(new THREE.Vector3(
                                rawZonePts[i].x + nx * offsetDist,
                                0.35,
                                rawZonePts[i].z + nz * offsetDist
                            ));
                        }

                        const zoneCurve = new THREE.CatmullRomCurve3(offsetZonePts, false, 'catmullrom', 0.5);
                        const zoneGeo = new THREE.TubeGeometry(zoneCurve, offsetZonePts.length * 2, 4.5, 8, false);
                        const zoneMesh = new THREE.Mesh(zoneGeo, drsLineMat);
                        zoneMesh.renderOrder = 0;
                        scene.add(zoneMesh);
                        drsZoneMeshes.push(zoneMesh);
                    }

                    // DRS Detection Point Circle
                    const hasDet = (z.det !== undefined || z.detDistance !== undefined || z.detection !== undefined);
                    if (hasDet) {
                        let detPos = null;
                        if (typeof z.detection === 'object' && z.detection !== null && Number.isFinite(z.detection.x) && Number.isFinite(z.detection.z)) {
                            detPos = new THREE.Vector3(z.detection.x, 0.45, z.detection.z);
                        } else if (typeof z.det === 'object' && z.det !== null && Number.isFinite(z.det.x) && Number.isFinite(z.det.z)) {
                            detPos = new THREE.Vector3(z.det.x, 0.45, z.det.z);
                        } else {
                            detPos = getPointAtDistance(distanceFromZoneValue(z, 'detDistance', 'det'));
                        }

                        if (detPos) {
                            const ringGeo = new THREE.RingGeometry(6, 12, 24);
                            const ringMesh = new THREE.Mesh(ringGeo, drsDetRingMat);
                            ringMesh.rotation.order = "YXZ";
                            ringMesh.rotation.x = -Math.PI / 2;
                            ringMesh.position.set(detPos.x, 0.45, detPos.z);
                            ringMesh.renderOrder = 1;
                            scene.add(ringMesh);
                            drsZoneMeshes.push(ringMesh);

                            // Inner solid dot for crisp FIA radar look
                            const innerDotGeo = new THREE.CircleGeometry(4, 16);
                            const innerDotMesh = new THREE.Mesh(innerDotGeo, drsDetRingMat);
                            innerDotMesh.rotation.order = "YXZ";
                            innerDotMesh.rotation.x = -Math.PI / 2;
                            innerDotMesh.position.set(detPos.x, 0.46, detPos.z);
                            innerDotMesh.renderOrder = 2;
                            scene.add(innerDotMesh);
                            drsZoneMeshes.push(innerDotMesh);
                        }
                    }
                });
            }

            const centerX = (minX + maxX) / 2;
            const centerZ = (minZ + maxZ) / 2;
            const maxDim = Math.max(maxX - minX, maxZ - minZ);
            const newViewSize = maxDim / 2 + 200;

            trackViewCenter.set(centerX, 0, centerZ);
            trackBaseViewSize = Math.max(300, newViewSize);
            trackZoom = 1;
            gridHelper.position.set(centerX, -20, centerZ);
            updateTrackCameraBounds();

            // Cache valid track geometry in localStorage so it never disappears on refresh
            try {
                if (mapData && Array.isArray(mapData.trackPoints) && mapData.trackPoints.length >= 20) {
                    localStorage.setItem('f1_cached_track_map', JSON.stringify({
                        trackId: tId,
                        trackPoints: mapData.trackPoints,
                        startLine: mapData.startLine,
                        sector1: mapData.sector1,
                        sector2: mapData.sector2
                    }));
                }
            } catch (e) { }
        }

        /**
         * Resizes the WebGL renderer and camera frustum to match the container DOM element size.
         */
        function resizeThreeJS() {
            if (!mapContainer || mapContainer.clientWidth === 0 || mapContainer.clientHeight === 0) return;
            const width = mapContainer.clientWidth;
            const height = mapContainer.clientHeight;
            renderer.setSize(width, height);
            updateTrackCameraBounds();
        }
        window.addEventListener("resize", () => {
            resizeThreeJS();
            drawGGraph();
        });
        window.addEventListener("orientationchange", () => {
            setTimeout(() => {
                resizeThreeJS();
                drawGGraph();
            }, 120);
        });

        if (window.ResizeObserver && mapContainer) {
            const mapResizeObs = new ResizeObserver(() => {
                resizeThreeJS();
            });
            mapResizeObs.observe(mapContainer);
            if (mapWrapper) mapResizeObs.observe(mapWrapper);
        }

        /**
         * Updates the map zoom level within defined min/max bounds.
         */
        function setMapZoom(nextZoom) {
            trackZoom = Math.max(0.65, Math.min(5, nextZoom));
            updateTrackCameraBounds();
            updateMapOverlays();
        }

        /**
         * Translates the center coordinate of the track map camera based on drag events.
         */
        function panTrackMap(deltaX, deltaY) {
            const height = mapContainer.clientHeight || 1;
            const worldPerPixel = (trackViewSize * 2) / height;
            trackViewCenter.x -= deltaX * worldPerPixel;
            trackViewCenter.z -= deltaY * worldPerPixel;
            updateTrackCameraBounds();
            updateMapOverlays();
        }

        /**
         * Calculates the straight-line distance between two pointer events (for pinch-to-zoom).
         */
        function getPointerDistance(points) {
            const dx = points[0].clientX - points[1].clientX;
            const dy = points[0].clientY - points[1].clientY;
            return Math.hypot(dx, dy);
        }

        /**
         * Calculates the midpoint between two pointer events (for two-finger panning).
         */
        function getPointerMidpoint(points) {
            return {
                x: (points[0].clientX + points[1].clientX) / 2,
                y: (points[0].clientY + points[1].clientY) / 2,
            };
        }

        mapZoomIn.addEventListener("click", (event) => {
            event.stopPropagation();
            setMapZoom(trackZoom * 1.2);
        });
        mapZoomOut.addEventListener("click", (event) => {
            event.stopPropagation();
            setMapZoom(trackZoom / 1.2);
        });
        mapWrapper.addEventListener(
            "wheel",
            (event) => {
                event.preventDefault();
                setMapZoom(trackZoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
            },
            { passive: false },
        );

        mapWrapper.addEventListener("pointerdown", (event) => {
            if (!event.target.closest("#track-map-container, #map-label-layer"))
                return;
            event.currentTarget.setPointerCapture(event.pointerId);
            mapPointers.set(event.pointerId, event);
            suppressNextMapClick = false;

            const points = Array.from(mapPointers.values());
            if (points.length === 1) {
                isMapPanning = true;
                lastPanPoint = { x: event.clientX, y: event.clientY };
            } else if (points.length === 2) {
                isMapPanning = false;
                lastPinchDistance = getPointerDistance(points);
                lastPanPoint = getPointerMidpoint(points);
            }
        });

        mapWrapper.addEventListener(
            "pointermove",
            (event) => {
                if (!mapPointers.has(event.pointerId)) return;
                event.preventDefault();
                mapPointers.set(event.pointerId, event);
                const points = Array.from(mapPointers.values());

                if (points.length === 1 && isMapPanning && lastPanPoint) {
                    const point = points[0];
                    const deltaX = point.clientX - lastPanPoint.x;
                    const deltaY = point.clientY - lastPanPoint.y;
                    if (Math.abs(deltaX) + Math.abs(deltaY) > 2)
                        suppressNextMapClick = true;
                    panTrackMap(deltaX, deltaY);
                    lastPanPoint = { x: point.clientX, y: point.clientY };
                } else if (points.length === 2) {
                    const distance = getPointerDistance(points);
                    const midpoint = getPointerMidpoint(points);
                    if (lastPinchDistance > 0) {
                        setMapZoom(trackZoom * (distance / lastPinchDistance));
                        suppressNextMapClick = true;
                    }
                    if (lastPanPoint)
                        panTrackMap(
                            midpoint.x - lastPanPoint.x,
                            midpoint.y - lastPanPoint.y,
                        );
                    lastPinchDistance = distance;
                    lastPanPoint = midpoint;
                }
            },
            { passive: false },
        );

        /**
         * Resolves the end of a map drag/pinch interaction and resets variables.
         */
        function endMapPointer(event) {
            mapPointers.delete(event.pointerId);
            const points = Array.from(mapPointers.values());
            if (points.length === 1) {
                isMapPanning = true;
                lastPanPoint = { x: points[0].clientX, y: points[0].clientY };
                lastPinchDistance = 0;
            } else {
                isMapPanning = false;
                lastPanPoint = null;
                lastPinchDistance = 0;
            }
        }

        mapWrapper.addEventListener("pointerup", endMapPointer);
        mapWrapper.addEventListener("pointercancel", endMapPointer);

        mapWrapper.addEventListener("click", (event) => {
            if (suppressNextMapClick) {
                suppressNextMapClick = false;
                return;
            }
            const rect = renderer.domElement.getBoundingClientRect();
            pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(pointer, camera);
            const hits = raycaster.intersectObjects(
                carMeshes.filter((mesh) => mesh.visible),
                false,
            );
            selectedCarIndex =
                hits.length > 0 ? hits[0].object.userData.carIndex : null;
            updateMapOverlays();
        });

        function getTrackGapToFront(data, driver) {
            const rows = Array.isArray(data?.leaderboard) ? data.leaderboard : [];
            const trackLength = data?.session?.trackLength || 0;
            const currDistance = Number(
                driver.lapDistance ??
                data?.allCars?.[driver.carIndex]?.lapDistance ??
                0,
            );

            if (!trackLength || !Number.isFinite(currDistance))
                return driver?.gapText || "--";

            let nearestGap = Infinity;
            rows.forEach((row) => {
                if (row.carIndex === driver.carIndex || row.pitStatus > 0) return;
                const rowDistance = Number(
                    row.lapDistance ?? data?.allCars?.[row.carIndex]?.lapDistance ?? 0,
                );
                if (!Number.isFinite(rowDistance)) return;

                let gap = rowDistance - currDistance;
                if (gap <= 0) gap += trackLength;
                if (gap > 0 && gap < nearestGap) nearestGap = gap;
            });

            return Number.isFinite(nearestGap)
                ? `${Math.round(nearestGap)} m`
                : "CLEAR";
        }

        function getPopupGapText(data, driver) {
            const sessionType = data?.session?.type || "";
            const isRace =
                sessionType.includes("Race") || sessionType.includes("Sprint");
            if (isRace) return driver?.gapText || "--";
            return getTrackGapToFront(data, driver);
        }

        function worldToMapScreen(position) {
            if (!mapContainer) return { x: 0, y: 0 };
            const projected = position.clone().project(camera);
            return {
                x: (projected.x * 0.5 + 0.5) * (mapContainer.clientWidth || 1),
                y: (-projected.y * 0.5 + 0.5) * (mapContainer.clientHeight || 1),
            };
        }

        function updateMapOverlays() {
            if (!latestMapData || !mapLabelLayer || !mapContainer || mapContainer.clientWidth === 0)
                return;

            let labelsHtml = "";
            carScreenData.length = 0;
            carMeshes.forEach((mesh) => {
                if (!mesh.visible) return;
                const carIndex = mesh.userData.carIndex;
                const carData = latestMapData?.allCars?.[carIndex];
                const driver = getLeaderboardDriver(latestMapData, carIndex) || {
                    carIndex,
                };
                const name = getDriverName(latestMapData, carIndex);
                const isSC = Boolean(carData?.isSafetyCar || driver?.isSafetyCar || mesh.userData.isSafetyCar || name.toLowerCase().includes("safety") || name.toLowerCase().includes("medical") || name.toLowerCase() === "sc");

                const abbr = getDriverAbbr(name, carIndex, isSC);
                const teamColor = isSC ? "#FFB000" : getTeamColorCss(driver, latestMapData);
                const point = worldToMapScreen(mesh.position);

                carScreenData.push({ carIndex, x: point.x, y: point.y });
                const scClass = isSC ? " sc-callout" : "";
                const displayColor = isSC ? "#000" : teamColor;
                labelsHtml += `<div class="driver-callout${scClass}" style="left:${point.x}px; top:${point.y}px; 
color:${displayColor};">${escapeHtml(abbr)}</div>`;
            });

            if (selectedCarIndex !== null) {
                const selected = carScreenData.find(
                    (car) => car.carIndex === selectedCarIndex,
                );
                const driver = getLeaderboardDriver(
                    latestMapData,
                    selectedCarIndex,
                ) || {
                    carIndex: selectedCarIndex,
                };
                if (selected) {
                    const name = getDriverName(latestMapData, selectedCarIndex);
                    const team =
                        driver.teamName ||
                        latestMapData?.allCars?.[selectedCarIndex]?.teamName ||
                        "Unknown";
                    const teamColor = getTeamColorCss(driver, latestMapData);
                    labelsHtml += `<div class="track-popup" style="left:${selected.x}px; top:${selected.y}px; 
color:${teamColor};">
                          <div class="name">${escapeHtml(name.toUpperCase())}</div>
                          <div class="meta"><span>Team</span><span>${escapeHtml(team)}</span></div>
                          <div class="meta"><span>Gap Front</span><span>${escapeHtml(
                        getPopupGapText(latestMapData, driver),
                    )}</span></div>
                      </div>`;
                } else {
                    selectedCarIndex = null;
                }
            }

            // Draw custom sector labels
            if (typeof customSectorMeshes !== "undefined") {
                customSectorMeshes.forEach((mesh, idx) => {
                    if (mesh.visible) {
                        const point = worldToMapScreen(mesh.position);
                        let labelText = "";
                        let color = "#ffaa00";
                        if (idx === 0) {
                            labelText = "FINISH";
                            color = "#ffd700";
                        } else {
                            labelText = `S${idx}`;
                        }
                        labelsHtml += `<div style="position: absolute; left:${point.x}px; top:${point.y}px; 
transform: translate(-50%, -150%); color:${color}; font-size: 0.7rem; font-family: 'Roboto Mono', monospace; 
font-weight: bold; pointer-events: none; text-shadow: 0 0 4px #000;">${labelText}</div>`;
                    }
                });
            }

            if (mapLabelLayer.innerHTML !== labelsHtml)
                mapLabelLayer.innerHTML = labelsHtml;
        }

        /* ══════════ RESTORED G-FORCE GRAPH WITH WEIRD OVAL (BOUNDING SHIELD ENVELOPE) ══════════ */
        const gGraph = document.getElementById("g-graph");
        const gGraphCtx = gGraph ? gGraph.getContext("2d") : null;
        const gHistory = [];
        const gEnvelopeSet = new Set();
        const gEnvelopeArray = [];
        let maxGSeen = 0;

        /**
         * Renders the G-Force history graph onto the HTML5 Canvas.
         * Restores the exact Bounding Shield / Friction Oval Envelope Outline,
         * Crosshairs with directional arrows, heatmap scatter points, and peak dot with halo!
         */
        function drawGGraph() {
            if (!gGraph || !gGraphCtx) return;
            const dpr = window.devicePixelRatio || 1;
            const width = gGraph.clientWidth || 300;
            const height = gGraph.clientHeight || 300;
            if (
                gGraph.width !== Math.floor(width * dpr) ||
                gGraph.height !== Math.floor(height * dpr)
            ) {
                gGraph.width = Math.floor(width * dpr);
                gGraph.height = Math.floor(height * dpr);
            }

            gGraphCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            gGraphCtx.clearRect(0, 0, width, height);

            // Draw dark background
            gGraphCtx.fillStyle = "#06060e";
            gGraphCtx.fillRect(0, 0, width, height);

            const cx = width / 2;
            const cy = height / 2;
            const MAX_G = 5.5;
            // Radius scaled to fit comfortably, leaving space for text
            const radius = Math.min(width, height) / 2 - 35;

            // 1. Draw Bounding Shield / Friction Oval (Outline)
            gGraphCtx.strokeStyle = "rgba(255, 255, 255, 0.7)";
            gGraphCtx.lineWidth = 2;
            gGraphCtx.beginPath();
            gGraphCtx.moveTo(cx - radius * 0.4, cy - radius * 0.9);
            gGraphCtx.quadraticCurveTo(cx, cy - radius * 1.0, cx + radius * 0.4, cy - radius * 0.9);
            gGraphCtx.bezierCurveTo(cx + radius * 1.1, cy - radius * 0.6, cx + radius * 1.1, cy + radius * 0.4, cx, cy + radius * 0.9);
            gGraphCtx.bezierCurveTo(cx - radius * 1.1, cy + radius * 0.4, cx - radius * 1.1, cy - radius * 0.6, cx - radius * 0.4, cy - radius * 0.9);
            gGraphCtx.stroke();

            // 2. Draw Crosshairs
            gGraphCtx.strokeStyle = "rgba(255, 255, 255, 0.4)";
            gGraphCtx.lineWidth = 1;
            gGraphCtx.beginPath();
            // Vertical line
            gGraphCtx.moveTo(cx, cy - radius - 15);
            gGraphCtx.lineTo(cx, cy + radius + 15);
            // Horizontal line
            gGraphCtx.moveTo(cx - radius - 15, cy);
            gGraphCtx.lineTo(cx + radius + 15, cy);
            gGraphCtx.stroke();

            // Draw arrows on crosshairs
            gGraphCtx.fillStyle = "rgba(255, 255, 255, 0.8)";
            gGraphCtx.beginPath();
            // Top arrow
            gGraphCtx.moveTo(cx, cy - radius - 15);
            gGraphCtx.lineTo(cx - 4, cy - radius - 5);
            gGraphCtx.lineTo(cx + 4, cy - radius - 5);
            gGraphCtx.fill();
            // Right arrow
            gGraphCtx.beginPath();
            gGraphCtx.moveTo(cx + radius + 15, cy);
            gGraphCtx.lineTo(cx + radius + 5, cy - 4);
            gGraphCtx.lineTo(cx + radius + 5, cy + 4);
            gGraphCtx.fill();

            // 3. Draw Scatter Points
            // First pass: Envelope using persistent quantized points, colored by intensity
            gEnvelopeArray.forEach(pt => {
                const mag = Math.hypot(pt.lat, pt.long);
                const max = maxGSeen > 0 ? maxGSeen : MAX_G;
                const intensity = Math.min(mag / max, 1.0);
                const hue = (1 - intensity) * 120;
                gGraphCtx.fillStyle = `hsla(${hue}, 100%, 50%, 0.6)`;

                const x = cx + (pt.lat / MAX_G) * radius;
                const y = cy + (pt.long / MAX_G) * radius;

                gGraphCtx.beginPath();
                gGraphCtx.arc(x, y, 5, 0, Math.PI * 2);
                gGraphCtx.fill();
            });

            // Second pass: Yellow trail for recent history
            gGraphCtx.fillStyle = "rgba(255, 214, 10, 0.5)";
            gGraphCtx.beginPath();
            for (let i = 0; i < gHistory.length - 1; i++) {
                const pt = gHistory[i];
                const x = cx + (pt.lat / MAX_G) * radius;
                const y = cy + (pt.long / MAX_G) * radius;
                gGraphCtx.moveTo(x + 1.5, y);
                gGraphCtx.arc(x, y, 1.5, 0, Math.PI * 2);
            }
            gGraphCtx.fill();

            // Third pass: Current point with bright center and glowing halo
            if (gHistory.length > 0) {
                const pt = gHistory[gHistory.length - 1];
                const x = cx + (pt.lat / MAX_G) * radius;
                const y = cy + (pt.long / MAX_G) * radius;

                gGraphCtx.fillStyle = "#ffd60a";
                gGraphCtx.beginPath();
                gGraphCtx.arc(x, y, 4, 0, Math.PI * 2);
                gGraphCtx.fill();

                gGraphCtx.fillStyle = "rgba(255, 214, 10, 0.4)";
                gGraphCtx.beginPath();
                gGraphCtx.arc(x, y, 8, 0, Math.PI * 2);
                gGraphCtx.fill();
            }
        }

        function updateGForceDisplay(latG, longG, vertG, currentMs, serverMotion) {
            if (serverMotion && serverMotion.gEnvelopeArray && Array.isArray(serverMotion.gEnvelopeArray)) {
                serverMotion.gEnvelopeArray.forEach(pt => {
                    const key = `${pt.lat},${pt.long}`;
                    if (!gEnvelopeSet.has(key)) { gEnvelopeSet.add(key); gEnvelopeArray.push(pt); }
                });
                if (serverMotion.maxGSeen && serverMotion.maxGSeen > maxGSeen) maxGSeen = serverMotion.maxGSeen;
            }
            const sensorG = Math.hypot(latG, longG, vertG);
            if (sensorG > maxGSeen) maxGSeen = sensorG;
            gHistory.push({ lat: latG, long: longG, total: sensorG });
            if (gHistory.length > 60) gHistory.shift();

            setText("g-total", `${sensorG.toFixed(2)} G`);
            setText("g-max", `${maxGSeen.toFixed(2)} G`);
            drawGGraph();
        }

        /* ── Input Trace 10s Canvas ── */
        const inputTraceHistory = [];
        function drawInputTrace(throttle, brake, isPaused = false, isGameActive = true) {
            const canvas = document.getElementById('input-trace-canvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const dpr = window.devicePixelRatio || 1;
            const w = canvas.clientWidth || 280;
            const h = canvas.clientHeight || 75;
            if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
                canvas.width = Math.floor(w * dpr);
                canvas.height = Math.floor(h * dpr);
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);

            // Subtle background grid
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, h * 0.5); ctx.lineTo(w, h * 0.5);
            ctx.moveTo(0, h * 0.25); ctx.lineTo(w, h * 0.25);
            ctx.moveTo(0, h * 0.75); ctx.lineTo(w, h * 0.75);
            ctx.stroke();

            if (!isGameActive) {
                // Game is not transmitting UDP / idle: show clean standby indicator
                ctx.fillStyle = 'rgba(255, 209, 0, 0.75)';
                ctx.font = 'bold 10px "Roboto Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText('⚡ STANDBY - WAITING FOR TELEMETRY INPUTS', w / 2, h / 2 + 3);
                return;
            }

            if (!isPaused) {
                inputTraceHistory.push({ thr: Math.max(0, Math.min(100, throttle || 0)), brk: Math.max(0, Math.min(100, brake || 0)) });
                if (inputTraceHistory.length > 180) inputTraceHistory.shift();
            }
            if (inputTraceHistory.length < 2) return;

            const step = w / 180;
            const offset = (180 - inputTraceHistory.length) * step;

            // Throttle (Green)
            ctx.beginPath();
            ctx.strokeStyle = '#00E676';
            ctx.lineWidth = 2;
            ctx.shadowColor = 'rgba(0, 230, 118, 0.5)';
            ctx.shadowBlur = 4;
            inputTraceHistory.forEach((pt, i) => {
                const x = offset + i * step;
                const y = h - (pt.thr / 100) * (h - 6) - 3;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Brake (Red)
            ctx.beginPath();
            ctx.strokeStyle = '#FF1E00';
            ctx.lineWidth = 2;
            ctx.shadowColor = 'rgba(255, 30, 0, 0.5)';
            ctx.shadowBlur = 4;
            inputTraceHistory.forEach((pt, i) => {
                const x = offset + i * step;
                const y = h - (pt.brk / 100) * (h - 6) - 3;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
            ctx.shadowBlur = 0;

            if (isPaused) {
                ctx.fillStyle = 'rgba(255, 209, 0, 0.9)';
                ctx.font = 'bold 9px "Roboto Mono", monospace';
                ctx.textAlign = 'right';
                ctx.fillText('PAUSED', w - 6, 12);
            }
        }

        /* ── Pace Chart (Lap Evolution Line Chart) & Rival Comparison ── */
        let selectedRivalCarIndex = -1;

        function onRivalSelected(val) {
            selectedRivalCarIndex = parseInt(val, 10);
            if (window.lastTelemetryData) {
                updateRivalComparison(window.lastTelemetryData);
                drawPaceChart(window.lastTelemetryData);
            }
        }

        /* ── Unified Robust Lap Merging ── */
        function getDriverMergedLaps(driverOrIndex, data) {
            if (!data || driverOrIndex === undefined || driverOrIndex === null) return [];
            const carIdx = (typeof driverOrIndex === "object" && driverOrIndex.carIndex !== undefined) ? driverOrIndex.carIndex : driverOrIndex;
            const lbDriver = (typeof driverOrIndex === "object" && driverOrIndex.lapHistory) ? driverOrIndex : (data.leaderboard || []).find(d => d.carIndex === carIdx);
            const fromLb = (lbDriver && Array.isArray(lbDriver.lapHistory)) ? lbDriver.lapHistory : [];
            if (data.allLapHistories && Object.keys(data.allLapHistories).length > 0) {
                window.lastLapHistories = data.allLapHistories;
            }
            const activeLapHistories = (data.allLapHistories && Object.keys(data.allLapHistories).length > 0) ? data.allLapHistories : (window.lastLapHistories || {});
            const fromAll = (activeLapHistories && (
                Array.isArray(activeLapHistories[carIdx])
                    ? activeLapHistories[carIdx]
                    : (Array.isArray(activeLapHistories[String(carIdx)]) ? activeLapHistories[String(carIdx)] : [])
            )) || [];

            const len = Math.max(fromLb.length, fromAll.length);
            const merged = [];

            for (let k = 0; k < len; k++) {
                const lapA = fromLb[k] || {};
                const lapB = fromAll[k] || {};
                const timeA = typeof lapA === "object" ? lapA.lapTime || 0 : (typeof lapA === "number" ? lapA : 0);
                const timeB = typeof lapB === "object" ? lapB.lapTime || 0 : (typeof lapB === "number" ? lapB : 0);
                const s1A = typeof lapA === "object" ? lapA.s1 || 0 : 0;
                const s1B = typeof lapB === "object" ? lapB.s1 || 0 : 0;
                const s2A = typeof lapA === "object" ? lapA.s2 || 0 : 0;
                const s2B = typeof lapB === "object" ? lapB.s2 || 0 : 0;
                const s3A = typeof lapA === "object" ? lapA.s3 || 0 : 0;
                const s3B = typeof lapB === "object" ? lapB.s3 || 0 : 0;

                let lapTime = timeA > 0 ? timeA : timeB;
                let s1 = s1A > 0 ? s1A : s1B;
                let s2 = s2A > 0 ? s2A : s2B;
                let s3 = s3A > 0 ? s3A : s3B;

                // Sector time math restoration
                if (lapTime === 0 && s1 > 0 && s2 > 0 && s3 > 0) {
                    lapTime = s1 + s2 + s3;
                }
                if (s3 === 0 && lapTime > 0 && s1 > 0 && s2 > 0 && lapTime > (s1 + s2)) {
                    s3 = lapTime - (s1 + s2);
                }

                const validFlags = (typeof lapA === "object" && lapA.validFlags !== undefined)
                    ? lapA.validFlags
                    : ((typeof lapB === "object" && lapB.validFlags !== undefined) ? lapB.validFlags : 0x01);

                merged.push({ lapTime, s1, s2, s3, validFlags });
            }

            // Fallback for personal best lap if history arrays haven't captured it yet
            if (merged.length === 0 || !merged.some(l => l.lapTime > 25000)) {
                const bestTime = (carIdx === data.playerIndex && data.lap?.bestMs > 25000)
                    ? data.lap.bestMs
                    : (lbDriver?.bestLapMs || 0);
                if (bestTime > 25000 && bestTime < 360000) {
                    if (merged.length === 0) {
                        merged.push({ lapTime: bestTime, s1: 0, s2: 0, s3: 0, validFlags: 0x01 });
                    } else if (merged[0].lapTime === 0) {
                        merged[0].lapTime = bestTime;
                    }
                }
            }

            return merged;
        }

        function getDriverLapTimes(carIndex, data) {
            const laps = getDriverMergedLaps(carIndex, data);
            return laps
                .map(l => l.lapTime || 0)
                .filter(t => typeof t === "number" && t > 25000 && t < 360000);
        }

        /* ── Complete Laptime History Table Renderer ── */
        function renderLapHistoryTable(data) {
            if (!data || !data.leaderboard || data.leaderboard.length === 0) return;
            const hHead = document.getElementById("history-head");
            const hBody = document.getElementById("history-body");
            if (!hHead || !hBody) return;

            let maxLaps = 0;
            const driverLapsMap = new Map();

            data.leaderboard.forEach((driver) => {
                const laps = getDriverMergedLaps(driver, data);
                driverLapsMap.set(driver.carIndex, laps);
                for (let k = laps.length - 1; k >= 0; k--) {
                    if (laps[k] && (laps[k].lapTime > 0 || laps[k].s1 > 0)) {
                        if (k + 1 > maxLaps) maxLaps = k + 1;
                        break;
                    }
                }
            });

            if (maxLaps > 0) {
                let headHtml = `<tr><th class="sticky-pos">POS</th><th class="sticky-name">DRIVER</th>`;
                for (let i = 1; i <= maxLaps; i++) headHtml += `<th>LAP ${i}</th>`;
                const fullHeadHtml = headHtml + `</tr>`;
                if (window.lastHistoryHeadHtml !== fullHeadHtml) {
                    window.lastHistoryHeadHtml = fullHeadHtml;
                    setElementHtml(hHead, fullHeadHtml);
                }

                let bodyHtml = "";
                data.leaderboard.forEach((driver) => {
                    const driverLaps = driverLapsMap.get(driver.carIndex) || [];
                    let driverName =
                        data.participants && data.participants[driver.carIndex]
                            ? data.participants[driver.carIndex].toUpperCase()
                            : `CAR ${driver.carIndex}`;
                    let displayPos = driver.pos || "--";
                    const teamColor = getTeamColorCss(driver, data);

                    let tyreLetter = "U";
                    if (driver.tyre) {
                        const uTyre = driver.tyre.toUpperCase();
                        if (uTyre.includes("SOFT")) tyreLetter = "S";
                        else if (uTyre.includes("MEDIUM")) tyreLetter = "M";
                        else if (uTyre.includes("HARD")) tyreLetter = "H";
                        else if (uTyre.includes("INTER")) tyreLetter = "I";
                        else if (uTyre.includes("WET")) tyreLetter = "W";
                    }
                    let tyreDot = `<span style="display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; border-radius:50%; border: 2px solid ${driver.tyreClass || "#FFF"}; color: ${driver.tyreClass || "#FFF"}; font-size: 10px; font-weight: 700; margin-right: 8px; vertical-align: middle;">${tyreLetter}</span>`;

                    let rHtml = `<tr>
                        <td class="sticky-pos" style="font-weight: bold;">P${displayPos}</td>
                        <td class="sticky-name" style="font-weight: 600;">
                            <span class="history-driver">
                                ${tyreDot}
                                <span class="team-stripe" style="background: ${teamColor}; color: ${teamColor};"></span>
                                <span>${driverName}</span>
                            </span>
                        </td>`;

                    for (let i = 0; i < maxLaps; i++) {
                        const lapData = driverLaps[i] || {};
                        let lapTimeMs =
                            typeof lapData === "object"
                                ? lapData.lapTime || 0
                                : lapData || 0;
                        let s1 = typeof lapData === "object" ? lapData.s1 || 0 : 0;
                        let s2 = typeof lapData === "object" ? lapData.s2 || 0 : 0;
                        let s3 = typeof lapData === "object" ? lapData.s3 || 0 : 0;

                        if (lapTimeMs === 0 && s1 > 0 && s2 > 0 && s3 > 0) {
                            lapTimeMs = s1 + s2 + s3;
                        }
                        if (s3 === 0 && lapTimeMs > 0 && s1 > 0 && s2 > 0 && lapTimeMs > (s1 + s2)) {
                            s3 = lapTimeMs - (s1 + s2);
                        }

                        const lapValid =
                            typeof lapData === "object" &&
                                lapData.validFlags !== undefined
                                ? lapData.validFlags & 0x01
                                : 1;

                        let styleClass = "lap-cell";
                        if (lapTimeMs > 0) {
                            if (!lapValid) styleClass += " time-invalid";
                            else if (
                                data.session && data.session.sessionFastestLapMs > 0 &&
                                lapTimeMs <= data.session.sessionFastestLapMs
                            )
                                styleClass += " time-sb";
                            else if (
                                driver.bestLapMs > 0 &&
                                lapTimeMs <= driver.bestLapMs
                            )
                                styleClass += " time-pb";
                            else styleClass += " time-yellow";
                        }
                        const sb1 = data.session?.sessionBestS1 || 0;
                        const sb2 = data.session?.sessionBestS2 || 0;
                        const sb3 = data.session?.sessionBestS3 || 0;
                        const pb1 = driver.bestS1 || 0;
                        const pb2 = driver.bestS2 || 0;
                        const pb3 = driver.bestS3 || 0;
                        const onClickAttr =
                            lapTimeMs > 0
                                ? `onclick="showSectorPopup(event, ${s1}, ${s2}, ${s3}, ${sb1}, ${sb2}, ${sb3}, ${pb1}, ${pb2}, ${pb3})"`
                                : "";
                        rHtml += `<td class="${styleClass}" ${onClickAttr} style="${lapTimeMs > 0 ? "cursor:pointer;" : ""}">${formatMs(lapTimeMs)}</td>`;
                    }
                    bodyHtml += rHtml + `</tr>`;
                });
                if (window.lastHistoryBodyHtml !== bodyHtml) {
                    window.lastHistoryBodyHtml = bodyHtml;
                    setElementHtml(hBody, bodyHtml);
                }
            } else {
                const emptyHead = `<tr><th class="sticky-pos">POS</th><th class="sticky-name">DRIVER</th><th>LAP 1</th></tr>`;
                if (window.lastHistoryHeadHtml !== emptyHead) {
                    window.lastHistoryHeadHtml = emptyHead;
                    setElementHtml(hHead, emptyHead);
                }
                let bodyHtml = "";
                data.leaderboard.forEach((driver) => {
                    let driverName =
                        data.participants && data.participants[driver.carIndex]
                            ? data.participants[driver.carIndex].toUpperCase()
                            : `CAR ${driver.carIndex}`;
                    let displayPos = driver.pos || "--";
                    const teamColor = getTeamColorCss(driver, data);
                    bodyHtml += `<tr>
                        <td class="sticky-pos" style="font-weight: bold;">P${displayPos}</td>
                        <td class="sticky-name" style="font-weight: 600;">
                            <span class="history-driver">
                                <span class="team-stripe" style="background: ${teamColor}; color: ${teamColor};"></span>
                                <span>${driverName}</span>
                            </span>
                        </td>
                        <td class="lap-cell">--:--.---</td>
                    </tr>`;
                });
                if (window.lastHistoryBodyHtml !== bodyHtml) {
                    window.lastHistoryBodyHtml = bodyHtml;
                    setElementHtml(hBody, bodyHtml);
                }
            }
        }

        function updateRivalDropdown(data) {
            const sel = document.getElementById('rival-selector');
            if (!sel || !data || !data.leaderboard || data.leaderboard.length === 0) return;
            const pIdx = (data.playerIndex !== undefined) ? data.playerIndex : 0;
            const rivals = data.leaderboard.filter(d => d.carIndex !== pIdx);
            if (rivals.length === 0) return;

            const currentVal = parseInt(sel.value, 10);
            const existingCount = sel.options.length - 1;
            const namesReady = data.participants && Object.keys(data.participants).length > 0;

            if (existingCount !== rivals.length || (namesReady && sel.getAttribute('data-names-loaded') !== 'true')) {
                sel.innerHTML = '<option value="-1">Select Rival Driver...</option>';
                rivals.forEach(driver => {
                    const name = (data.participants && data.participants[driver.carIndex])
                        ? data.participants[driver.carIndex]
                        : (driver.teamName ? `Car ${driver.carIndex} (${driver.teamName})` : `Car ${driver.carIndex}`);
                    const opt = document.createElement('option');
                    opt.value = driver.carIndex;
                    opt.textContent = `P${driver.pos || '--'} • ${name}`;
                    sel.appendChild(opt);
                });
                if (namesReady) sel.setAttribute('data-names-loaded', 'true');
                if (selectedRivalCarIndex >= 0 && rivals.some(r => r.carIndex === selectedRivalCarIndex)) {
                    sel.value = selectedRivalCarIndex;
                } else if (currentVal >= 0 && rivals.some(r => r.carIndex === currentVal)) {
                    sel.value = currentVal;
                    selectedRivalCarIndex = currentVal;
                }
            }
        }

        function updateRivalComparison(data) {
            updateRivalDropdown(data);
            if (!data || !data.leaderboard) return;

            const pIdx = (data.playerIndex !== undefined) ? data.playerIndex : 0;
            const pDriver = data.leaderboard.find(d => d.carIndex === pIdx);
            const pName = (data.participants && data.participants[pIdx])
                ? data.participants[pIdx].toUpperCase()
                : 'YOU';
            const pBest = pDriver?.bestLapMs || data.lap?.bestMs || 0;

            setText('rival-p-name', pName);
            setText('rival-p-best', pBest > 0 ? formatMs(pBest) : '--:--.---');

            if (selectedRivalCarIndex < 0 && data.leaderboard.length > 1) {
                const topRival = data.leaderboard.find(d => d.carIndex !== pIdx && d.bestLapMs > 0) ||
                    data.leaderboard.find(d => d.carIndex !== pIdx);
                if (topRival) {
                    selectedRivalCarIndex = topRival.carIndex;
                    const sel = document.getElementById('rival-selector');
                    if (sel) sel.value = selectedRivalCarIndex;
                }
            }

            if (selectedRivalCarIndex >= 0) {
                const rDriver = data.leaderboard.find(d => d.carIndex === selectedRivalCarIndex);
                const rName = (data.participants && data.participants[selectedRivalCarIndex])
                    ? data.participants[selectedRivalCarIndex].toUpperCase()
                    : (rDriver ? `CAR ${selectedRivalCarIndex}` : 'RIVAL');
                const rBest = rDriver?.bestLapMs || 0;

                setText('rival-t-name', rName);
                setText('rival-t-best', rBest > 0 ? formatMs(rBest) : '--:--.---');

                let tyreStr = rDriver?.tyre ? rDriver.tyre.toUpperCase() : '--';
                if (rDriver && rDriver.tyreAge !== undefined && rDriver.tyreAge !== null && tyreStr !== '--') {
                    tyreStr += ` (${rDriver.tyreAge}L)`;
                }
                setText('rival-tyre-val', tyreStr);

                let gapText = '--';
                if (pDriver && rDriver) {
                    if (pDriver.leadSec !== undefined && rDriver.leadSec !== undefined && isFinite(pDriver.leadSec) && isFinite(rDriver.leadSec) && pDriver.leadSec < 9000 && rDriver.leadSec < 9000) {
                        const diff = pDriver.leadSec - rDriver.leadSec;
                        if (Math.abs(diff) < 0.005) {
                            gapText = 'TIED / LEVEL';
                        } else if (diff > 0) {
                            gapText = `+${diff.toFixed(3)}s (Behind)`;
                        } else {
                            gapText = `-${Math.abs(diff).toFixed(3)}s (Ahead)`;
                        }
                    } else if (rDriver.gapLead) {
                        gapText = rDriver.gapLead;
                    } else if (rDriver.gapText) {
                        gapText = rDriver.gapText;
                    }
                }
                setText('rival-gap-val', gapText);

                const deltaEl = document.getElementById('rival-pace-delta');
                if (pBest > 0 && rBest > 0) {
                    const deltaMs = pBest - rBest;
                    const deltaSec = (Math.abs(deltaMs) / 1000).toFixed(3);
                    if (deltaEl) {
                        if (Math.abs(deltaMs) < 2) {
                            deltaEl.textContent = 'EVEN';
                            deltaEl.style.color = 'var(--text-main)';
                        } else if (deltaMs < 0) {
                            deltaEl.textContent = `-${deltaSec}s (Faster)`;
                            deltaEl.style.color = 'var(--fia-green)';
                        } else {
                            deltaEl.textContent = `+${deltaSec}s (Slower)`;
                            deltaEl.style.color = 'var(--f1-red)';
                        }
                    }
                } else {
                    if (deltaEl) {
                        deltaEl.textContent = '--';
                        deltaEl.style.color = 'var(--text-muted)';
                    }
                }
            } else {
                setText('rival-t-name', 'RIVAL (SELECT ABOVE)');
                setText('rival-t-best', '--:--.---');
                setText('rival-gap-val', '--');
                setText('rival-pace-delta', '--');
                setText('rival-tyre-val', '--');
            }
        }

        function drawPaceChart(data) {
            const canvas = document.getElementById('pace-chart-canvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            const w = rect.width > 0 ? rect.width : (canvas.clientWidth || canvas.parentElement?.clientWidth || 400);
            const h = rect.height > 0 ? rect.height : (canvas.clientHeight || canvas.parentElement?.clientHeight || 150);

            const neededW = Math.floor(w * dpr);
            const neededH = Math.floor(h * dpr);
            if (canvas.width !== neededW || canvas.height !== neededH) {
                canvas.width = neededW;
                canvas.height = neededH;
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);

            if (!data) {
                ctx.fillStyle = 'rgba(255,255,255,0.3)';
                ctx.font = '12px "Roboto Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText('Awaiting telemetry...', w / 2, h / 2);
                return;
            }

            const pIdx = (data.playerIndex !== undefined) ? data.playerIndex : 0;
            const playerTimes = getDriverLapTimes(pIdx, data);
            const rivalTimes = (selectedRivalCarIndex >= 0) ? getDriverLapTimes(selectedRivalCarIndex, data) : [];

            if (playerTimes.length === 0 && rivalTimes.length === 0) {
                ctx.fillStyle = 'rgba(255,255,255,0.35)';
                ctx.font = '12px "Roboto Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText('Awaiting lap completion — drive 1+ laps to visualize pace evolution', w / 2, h / 2);
                return;
            }

            const allTimes = [...playerTimes, ...rivalTimes];
            const minTime = Math.min(...allTimes);
            const maxTime = Math.max(...allTimes);
            const timeSpread = Math.max(1500, maxTime - minTime);

            const plotMin = Math.max(0, minTime - timeSpread * 0.1);
            const plotMax = maxTime + timeSpread * 0.1;
            const timeRange = (plotMax - plotMin) || 1;

            const padLeft = 60;
            const padRight = 20;
            const padTop = 15;
            const padBottom = 22;
            const plotW = Math.max(10, w - padLeft - padRight);
            const plotH = Math.max(10, h - padTop - padBottom);

            // Horizontal Grid Lines & Y-Axis Time Labels
            ctx.lineWidth = 1;
            [0, 0.5, 1].forEach((pct) => {
                const y = padTop + (pct * plotH);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
                ctx.beginPath();
                ctx.moveTo(padLeft, y);
                ctx.lineTo(w - padRight, y);
                ctx.stroke();

                ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
                ctx.font = '9px "Roboto Mono", monospace';
                ctx.textAlign = 'right';
                const tVal = plotMax - (pct * timeRange);
                ctx.fillText(formatMs(Math.round(tVal)).substring(0, 7), padLeft - 6, y + 3);
            });

            const maxLapCount = Math.max(playerTimes.length, rivalTimes.length);
            const stepX = maxLapCount > 1 ? (plotW / (maxLapCount - 1)) : 0;

            // X-Axis Lap Number Labels
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.font = '9px "Roboto Mono", monospace';
            ctx.textAlign = 'center';
            for (let i = 0; i < maxLapCount; i++) {
                const x = maxLapCount > 1 ? (padLeft + i * stepX) : (padLeft + plotW / 2);
                ctx.fillText(`L${i + 1}`, x, h - 6);
            }

            // Session Best Reference Line (Purple dashed)
            const sbTime = (data.session && data.session.sessionFastestLapMs && data.session.sessionFastestLapMs > 25000 && data.session.sessionFastestLapMs !== Infinity)
                ? data.session.sessionFastestLapMs
                : (minTime > 0 ? minTime : 0);

            if (sbTime >= plotMin && sbTime <= plotMax) {
                const sbY = padTop + ((plotMax - sbTime) / timeRange) * plotH;
                ctx.strokeStyle = 'rgba(187, 0, 255, 0.85)';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(padLeft, sbY);
                ctx.lineTo(w - padRight, sbY);
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.fillStyle = 'rgba(187, 0, 255, 0.9)';
                ctx.font = 'bold 8px "Roboto Mono", monospace';
                ctx.textAlign = 'left';
                ctx.fillText('SB', w - padRight + 3, sbY + 3);
            }

            // Rival Pace Line (Yellow)
            if (rivalTimes.length > 0) {
                ctx.beginPath();
                ctx.strokeStyle = '#FFD100';
                ctx.lineWidth = 2;
                rivalTimes.forEach((t, i) => {
                    const x = maxLapCount > 1 ? (padLeft + i * stepX) : (padLeft + plotW / 2);
                    const y = padTop + ((plotMax - t) / timeRange) * plotH;
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                });
                if (rivalTimes.length > 1) ctx.stroke();

                rivalTimes.forEach((t, i) => {
                    const x = maxLapCount > 1 ? (padLeft + i * stepX) : (padLeft + plotW / 2);
                    const y = padTop + ((plotMax - t) / timeRange) * plotH;
                    ctx.fillStyle = '#FFD100';
                    ctx.beginPath();
                    ctx.arc(x, y, 3, 0, Math.PI * 2);
                    ctx.fill();
                });
            }

            // Player Pace Line (White)
            if (playerTimes.length > 0) {
                ctx.beginPath();
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 2.5;
                playerTimes.forEach((t, i) => {
                    const x = maxLapCount > 1 ? (padLeft + i * stepX) : (padLeft + plotW / 2);
                    const y = padTop + ((plotMax - t) / timeRange) * plotH;
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                });
                if (playerTimes.length > 1) ctx.stroke();

                const playerPB = Math.min(...playerTimes);
                playerTimes.forEach((t, i) => {
                    const x = maxLapCount > 1 ? (padLeft + i * stepX) : (padLeft + plotW / 2);
                    const y = padTop + ((plotMax - t) / timeRange) * plotH;
                    const isPB = (t === playerPB && playerTimes.length > 1);

                    ctx.fillStyle = isPB ? 'var(--fia-purple)' : '#FFFFFF';
                    ctx.beginPath();
                    ctx.arc(x, y, isPB ? 5 : 3.5, 0, Math.PI * 2);
                    ctx.fill();
                    if (isPB) {
                        ctx.strokeStyle = '#FFFFFF';
                        ctx.lineWidth = 1.5;
                        ctx.stroke();
                    }
                });
            }
        }

        /* ── ERS & Fuel Strategy Engine ── */
        let simScLaps = 0;
        function onScLapsSimChanged(val) {
            simScLaps = parseInt(val, 10) || 0;
            setText('sc-laps-sim-val', simScLaps);
            const savedKg = (simScLaps * 0.95).toFixed(1);
            setText('sc-saving-badge', `+${savedKg} kg (+${(savedKg / 1.7).toFixed(1)}L)`);
            if (window.lastTelemetryData) updateErsFuelDisplay(window.lastTelemetryData);
        }

        function updateErsFuelDisplay(data) {
            if (!data) return;
            const ers = data.ers || {};
            const fuel = data.fuel || {};
            const setup = data.setup || {};

            // 1. ERS Battery SOC & Circle
            const batteryPct = Math.round(ers.battery !== undefined ? ers.battery : (setup.ersBattery || 0));
            setText('ers-soc-pct', `${batteryPct}%`);
            setText('hdr-ers-soc', batteryPct);

            const circle = document.getElementById('ers-battery-circle');
            if (circle) {
                const circ = 2 * Math.PI * 42; // ~263.89
                const offset = circ - (batteryPct / 100) * circ;
                circle.style.strokeDashoffset = offset;
                if (batteryPct < 20) {
                    circle.style.stroke = '#FF1801';
                } else if (batteryPct < 50) {
                    circle.style.stroke = '#FFD100';
                } else {
                    circle.style.stroke = '#00F0FF';
                }
            }

            // Energy Store Joules to MJ
            const storeMj = ((ers.storeJoules || 0) / 1000000).toFixed(2);
            setText('ers-store-mj', `${storeMj} / 4.00 MJ`);

            // ERS Mode
            const ersMode = ers.mode || 'Medium';
            setText('ers-mode-text', ersMode.toUpperCase());
            setText('hdr-ers-mode', ersMode.substring(0, 3).toUpperCase());

            // Highlight Active Mode Button
            const modeInt = ers.deployModeInt !== undefined ? ers.deployModeInt : 1;
            [0, 1, 2, 3].forEach(m => {
                const el = document.getElementById(`ers-mode-${m}`);
                if (el) {
                    if (m === modeInt) {
                        el.className = 'ers-mode-card active';
                        el.style.background = 'rgba(0,240,255,0.15)';
                        el.style.borderColor = '#00F0FF';
                        el.style.color = '#00F0FF';
                    } else {
                        el.className = 'ers-mode-card';
                        el.style.background = 'rgba(255,255,255,0.03)';
                        el.style.borderColor = 'rgba(255,255,255,0.08)';
                        el.style.color = 'var(--text-main)';
                    }
                }
            });

            // Recommendation & Advisory
            const ersRec = ers.ersRecommendation || (batteryPct < 25 ? 'HARVEST (LOW STORE)' : (batteryPct > 75 ? 'OVERTAKE AVAILABLE' : 'BALANCED'));
            setText('ers-rec-badge', ersRec);
            const advisoryEl = document.getElementById('ers-advisory-text');
            if (advisoryEl) {
                if (batteryPct < 25) {
                    advisoryEl.textContent = 'DEFICIT: LIFT INTO HARVEST ZONES';
                    advisoryEl.style.color = '#FF1801';
                } else if (batteryPct > 75) {
                    advisoryEl.textContent = 'SURPLUS: DEPLOY ON STRAIGHTS / OT';
                    advisoryEl.style.color = '#00F0FF';
                } else {
                    advisoryEl.textContent = 'OPTIMAL: MAINTAIN BALANCED PACE';
                    advisoryEl.style.color = '#00E676';
                }
            }

            // FIA Lap Deployment Limit (4.0MJ max)
            const deployedMj = ((ers.deployedLapJoules || 0) / 1000000).toFixed(2);
            const deployPct = Math.min(100, Math.round(((ers.deployedLapJoules || 0) / 4000000) * 100));
            setText('ers-lap-deploy-val', `${deployedMj} MJ (${deployPct}%)`);
            setStyleById('ers-lap-deploy-bar', 'width', `${deployPct}%`);

            // MGU-K and MGU-H Harvest
            const mgukMj = ((ers.harvestedMGUKJoules || 0) / 1000000).toFixed(2);
            const mguhMj = ((ers.harvestedMGUHJoules || 0) / 1000000).toFixed(2);
            setText('ers-mguk-harvest', `${mgukMj} MJ`);
            setText('ers-mguh-harvest', `${mguhMj} MJ`);

            // Power Split (Watts to kW and HP)
            const iceKw = Math.round((ers.icePower || 0) / 1000);
            const iceHp = Math.round(iceKw * 1.341);
            const mgukKw = Math.round((ers.mgukPower || 0) / 1000);
            const mgukHp = Math.round(mgukKw * 1.341);
            const totalKw = iceKw + mgukKw;
            const totalHp = iceHp + mgukHp;

            setText('ers-mguk-power', `Boost: ${mgukKw} kW (${mgukHp} HP)`);
            setText('ers-ice-power', `ICE: ${iceKw} kW (${iceHp} HP)`);
            setText('ers-total-power', totalKw > 0 ? `${totalKw} kW (${totalHp} HP)` : 'STANDBY / IDLE');

            // 2. FUEL MANAGEMENT & STRATEGY
            const fuelKg = (fuel.tankKg !== undefined ? fuel.tankKg : (setup.fuel || 0)).toFixed(2);
            const fuelCap = fuel.capacityKg || 110;
            const fuelPct = Math.min(100, Math.max(0, ((fuelKg / fuelCap) * 100))).toFixed(1);
            setText('fuel-mass-kg', `${fuelKg} kg`);
            setText('fuel-level-pct', `${fuelPct}% (${fuelCap} kg)`);
            setText('fuel-bar-label', `${fuelKg} / ${fuelCap} KG`);
            setStyleById('fuel-tank-bar', 'width', `${fuelPct}%`);

            // Fuel Delta (Remaining Laps)
            const fuelDelta = fuel.remainingLapsDelta !== undefined ? fuel.remainingLapsDelta : (setup.fuelLaps || 0);
            const deltaSign = fuelDelta > 0 ? `+${fuelDelta.toFixed(2)}` : fuelDelta.toFixed(2);
            setText('fuel-delta-laps', deltaSign);
            setText('hdr-fuel-delta', `${deltaSign}L`);

            const deltaEl = document.getElementById('fuel-delta-laps');
            const statusBadge = document.getElementById('fuel-status-badge');
            const liftCoastEl = document.getElementById('fuel-lift-coast');

            if (fuelDelta >= 0.3) {
                if (deltaEl) deltaEl.style.color = '#00E676';
                setText('fuel-status-badge', 'SURPLUS');
                if (statusBadge) { statusBadge.style.color = '#00E676'; statusBadge.style.borderColor = 'rgba(0,230,118,0.4)'; }
                setText('fuel-lift-coast', 'NONE (PUSH)');
                if (liftCoastEl) liftCoastEl.style.color = '#00E676';
            } else if (fuelDelta >= -0.15) {
                if (deltaEl) deltaEl.style.color = '#FFD100';
                setText('fuel-status-badge', 'ON TARGET');
                if (statusBadge) { statusBadge.style.color = '#FFD100'; statusBadge.style.borderColor = 'rgba(255,209,0,0.4)'; }
                setText('fuel-lift-coast', 'NORMAL');
                if (liftCoastEl) liftCoastEl.style.color = '#FFD100';
            } else {
                if (deltaEl) deltaEl.style.color = '#FF1801';
                setText('fuel-status-badge', 'DEFICIT');
                if (statusBadge) { statusBadge.style.color = '#FF1801'; statusBadge.style.borderColor = 'rgba(255,24,1,0.4)'; }
                setText('fuel-lift-coast', 'LIFT & COAST');
                if (liftCoastEl) liftCoastEl.style.color = '#FF1801';
            }

            // Fuel Mix
            setText('fuel-mix-name', (fuel.mix || setup.fuelMix || 'STANDARD').toUpperCase());

            // Laps Left & Target Burn
            const lapsRemaining = fuel.lapsLeft !== undefined ? fuel.lapsLeft : (data.session?.lapsLeft || Math.max(0, (data.session?.lapsTotal || 0) - (data.lap?.lapNum || 0)));
            setText('fuel-laps-left', lapsRemaining);

            const targetBurn = lapsRemaining > 0 ? (fuelKg / lapsRemaining).toFixed(2) : '--';
            setText('fuel-target-burn', targetBurn !== '--' ? `${targetBurn} kg/L` : '--');
        }

        /* ── Tyre Predictor & Wear Visuals ── */
        function updateCarTyreVisual(wearData, compound) {
            const CIRC = 2 * Math.PI * 28;
            let maxWear = 0;
            const compoundStr = (compound || '').toUpperCase();
            let cLetter = '-', cColor = '#888';
            if (compoundStr.includes('SOFT')) { cLetter = 'S'; cColor = 'var(--f1-red)'; }
            else if (compoundStr.includes('MEDIUM')) { cLetter = 'M'; cColor = 'var(--fia-yellow)'; }
            else if (compoundStr.includes('HARD')) { cLetter = 'H'; cColor = '#FFFFFF'; }
            else if (compoundStr.includes('INTER')) { cLetter = 'I'; cColor = 'var(--fia-green)'; }
            else if (compoundStr.includes('WET')) { cLetter = 'W'; cColor = 'var(--fia-blue)'; }

            ['fl', 'fr', 'rl', 'rr'].forEach((c) => {
                const w = Math.round(wearData[c] || 0);
                if (w > maxWear) maxWear = w;
                const col = getWearColor(w);
                const ring = document.getElementById(`tyre-ring-${c}`);
                if (ring) {
                    const filled = (w / 100) * CIRC;
                    ring.setAttribute('stroke-dasharray', `${filled.toFixed(1)} ${(CIRC - filled).toFixed(1)}`);
                    ring.setAttribute('stroke', col);
                }
                setText(`tyre-pct-${c}`, `${w}%`);
                const badge = document.getElementById(`tyre-compound-circle-${c}`);
                if (badge) { badge.textContent = cLetter; badge.style.color = cColor; }
            });

            const heroBadge = document.getElementById('compound-badge-hero');
            if (heroBadge) { heroBadge.textContent = cLetter; heroBadge.style.color = cColor; }
            setText('tyre-compound-display', compound || '--');
            setText('tyre-max-wear', `${maxWear}%`);
        }

        function updateTyrePredictor(wearData, stintAge) {
            if (!wearData) return;
            const age = Number(stintAge) || 0;
            let worstCorner = 'FL', maxWear = 0;
            ['fl', 'fr', 'rl', 'rr'].forEach(c => {
                const w = Number(wearData[c]) || 0;
                if (w > maxWear) { maxWear = w; worstCorner = c.toUpperCase(); }
            });
            const wearRate = age > 0 ? (maxWear / age) : 0;
            const lapsRemain = wearRate > 0 ? Math.max(0, Math.floor((70 - maxWear) / wearRate)) : '--';
            setText('tyre-wear-rate', wearRate > 0 ? `${wearRate.toFixed(1)}% / lap` : '--');
            setText('tyre-laps-remain', typeof lapsRemain === 'number' ? `${lapsRemain} laps` : '--');
            setText('tyre-worst-corner', worstCorner);
        }

        function updateTyreTemps(surfTemp, inTemp) {
            ['fl', 'fr', 'rl', 'rr'].forEach((c) => {
                const surf = Math.round(surfTemp[c] || 0);
                const inn = Math.round(inTemp[c] || 0);
                const surfBar = document.getElementById(`tsurf-bar-${c}`);
                const innBar = document.getElementById(`tin-bar-${c}`);
                if (surfBar) { surfBar.style.width = `${Math.min(100, (surf / 130) * 100)}%`; surfBar.style.background = getTempColor(surf, 80, 110); }
                if (innBar) { innBar.style.width = `${Math.min(100, (inn / 130) * 100)}%`; innBar.style.background = getTempColor(inn, 85, 115); }
                setText(`temp-surf-${c}`, `${surf}°C`);
                setText(`temp-in-${c}`, `${inn}°C`);
            });
        }

        /* ── Damage Diagnostics ── */
        function updateDamageUX(dmg, car) {
            if (!dmg) return;
            const flWing = dmg.m_frontLeftWingDamage ?? dmg.m_frontWingDamage ?? 0;
            const frWing = dmg.m_frontRightWingDamage ?? dmg.m_frontWingDamage ?? 0;
            const rWing = dmg.m_rearWingDamage ?? 0;
            const floor = dmg.m_floorDamage ?? 0;
            const diff = dmg.m_diffuserDamage ?? 0;
            const sidepod = dmg.m_sidepodDamage ?? 0;
            const iceWear = dmg.m_engineICEWear ?? 0;

            setText('dmg-fl-wing-val', `${flWing}%`);
            setStyleById('dmg-fl-wing-bar', 'width', `${flWing}%`);
            setStyleById('dmg-fl-wing-bar', 'background', getWearColor(flWing));

            setText('dmg-fr-wing-val', `${frWing}%`);
            setStyleById('dmg-fr-wing-bar', 'width', `${frWing}%`);
            setStyleById('dmg-fr-wing-bar', 'background', getWearColor(frWing));

            setText('dmg-r-wing-val', `${rWing}%`);
            setStyleById('dmg-r-wing-bar', 'width', `${rWing}%`);

            setText('dmg-floor-val', `${floor}%`);
            setStyleById('dmg-floor-bar', 'width', `${floor}%`);

            setText('dmg-diffuser-val', `${diff}%`);
            setStyleById('dmg-diffuser-bar', 'width', `${diff}%`);

            setText('dmg-sidepod-val', `${sidepod}%`);
            setStyleById('dmg-sidepod-bar', 'width', `${sidepod}%`);

            setText('dmg-engine-ice-val', `${iceWear}%`);
            setStyleById('dmg-engine-ice-bar', 'width', `${iceWear}%`);

            const health = Math.max(0, 100 - Math.round((flWing + frWing + rWing + floor + diff + sidepod) / 6));
            setText('dmg-health-index', `${health}%`);
            setStyleById('dmg-health-index', 'color', health > 80 ? 'var(--fia-green)' : health > 50 ? 'var(--fia-yellow)' : 'var(--f1-red)');
        }

        /* ── Offline & Live Setups Management ── */
        let offlineSetups = [];
        let selectedOfflineSetup = null;

        document.addEventListener('DOMContentLoaded', () => {
            const selector = document.getElementById('setup-lap-selector');
            if (selector) {
                selector.addEventListener('change', function (e) {
                    if (e.target.value === 'live') {
                        selectedOfflineSetup = null;
                    } else {
                        const lapNum = parseInt(e.target.value, 10);
                        selectedOfflineSetup = offlineSetups.find(s => s.lapNum === lapNum) || null;
                        if (selectedOfflineSetup && selectedOfflineSetup.setup) {
                            renderCarSetup(selectedOfflineSetup.setup);
                        }
                    }
                });
            }
        });

        function renderCarSetup(setup) {
            if (!setup) return;
            const wF = setup.wingF ?? 0;
            const wR = setup.wingR ?? 0;
            setText('setup-wing-f', wF);
            setText('setup-wing-r', wR);
            const totalAero = (wF + wR) || 1;
            const aeroBias = ((wF / totalAero) * 100).toFixed(1);
            setText('setup-aero-bias-val', `${aeroBias}% Front`);
            setStyleById('setup-aero-bias-bar', 'width', `${aeroBias}%`);

            setText('setup-diff-on', `${setup.diffOn ?? 50}%`);
            setText('setup-diff-off', `${setup.diffOff ?? 50}%`);
            setText('setup-engine-braking', `${setup.engineBraking ?? 100}%`);

            setText('setup-camber-f', `${Number(setup.camberF ?? 0).toFixed(2)}°`);
            setText('setup-camber-r', `${Number(setup.camberR ?? 0).toFixed(2)}°`);
            setText('setup-toe-f', `${Number(setup.toeF ?? 0).toFixed(2)}°`);
            setText('setup-toe-r', `${Number(setup.toeR ?? 0).toFixed(2)}°`);

            setText('setup-susp-f', setup.suspF ?? 0);
            setText('setup-susp-r', setup.suspR ?? 0);
            setText('setup-arb-f', setup.arbF ?? 0);
            setText('setup-arb-r', setup.arbR ?? 0);
            setText('setup-height-f', setup.heightF ?? 0);
            setText('setup-height-r', setup.heightR ?? 0);

            const bBias = setup.bBias ?? 50;
            setText('setup-bbias', `${bBias}%`);
            setStyleById('setup-bbias-bar', 'width', `${bBias}%`);
            setText('setup-bpressure', `${setup.bPressure ?? 100}%`);

            setText('setup-press-fl', `${Number(setup.pressFLeft ?? 0).toFixed(1)} psi`);
            setText('setup-press-fr', `${Number(setup.pressFRight ?? 0).toFixed(1)} psi`);
            setText('setup-press-rl', `${Number(setup.pressRLeft ?? 0).toFixed(1)} psi`);
            setText('setup-press-rr', `${Number(setup.pressRRight ?? 0).toFixed(1)} psi`);

            setText('setup-fuel-val', `${Number(setup.fuel ?? 0).toFixed(2)} kg`);
            if (setup.fuelLaps !== undefined) {
                const sym = setup.fuelLaps < 0 ? "" : "+";
                setText('setup-fuel-laps-val', `${sym}${Number(setup.fuelLaps).toFixed(2)} Laps`);
            }
            setText('setup-ballast-val', `${setup.ballast ?? 0} kg`);
        }

        /* ── WebSocket Connection & Telemetry Handling ── */
        let ws;
        function getWebSocketUrls() {
            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            const urls = [`${protocol}//${window.location.host}`];
            const nodeUrl = `${protocol}//${window.location.hostname}:3000`;
            const legacyUrl = `${protocol}//${window.location.hostname}:8085`;
            if (!urls.includes(nodeUrl)) urls.push(nodeUrl);
            if (!urls.includes(legacyUrl)) urls.push(legacyUrl);
            return urls;
        }

        function connectWebSocket(urlIndex = 0) {
            const urls = getWebSocketUrls();
            ws = new WebSocket(urls[urlIndex]);
            ws.onopen = () => {
                setText("ws-status", "CONNECTED");
                setStyleById("ws-status", "color", "var(--fia-green)");
                ws.send(JSON.stringify({ action: "getAvailableTracks" }));
                ws.send(JSON.stringify({ action: "getTrackData" }));
            };
            ws.onclose = () => {
                setText("ws-status", "STANDBY (OFFLINE)");
                setStyleById("ws-status", "color", "var(--fia-yellow)");
                if (window.f1Analyzer) window.f1Analyzer.setStandby(true);
            };
            ws.onerror = () => {
                if (urlIndex + 1 < urls.length) {
                    connectWebSocket(urlIndex + 1);
                    return;
                }
                setText("ws-status", "OFFLINE");
                setStyleById("ws-status", "color", "var(--f1-red)");
                if (window.f1Analyzer) window.f1Analyzer.setStandby(true);
            };
            ws.onmessage = handleTelemetryMessage;
        }

        function syncTrackLines() {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                showToast("⚠️ WebSocket not connected. Check server connection.");
                return;
            }

            // Visual feedback: spin sync icon during sync
            const syncBtn = document.getElementById("syncbttn");
            if (syncBtn) {
                syncBtn.classList.add("spin-sync");
                setTimeout(() => syncBtn.classList.remove("spin-sync"), 1000);
            }

            // Intelligent Track ID Resolution Hierarchy:
            // 1. Live session track from UDP telemetry
            let resolvedTrackId = null;
            const liveTrackId = window.lastTelemetryData?.session?.trackId;
            if (liveTrackId !== undefined && liveTrackId !== null && liveTrackId !== -1 && liveTrackId !== "-1" && !isNaN(parseInt(liveTrackId, 10))) {
                resolvedTrackId = parseInt(liveTrackId, 10);
            }

            // 2. Currently active track ID in Three.js radar
            if (resolvedTrackId === null && currentTrackMap.trackId !== null && currentTrackMap.trackId !== -1 && !isNaN(parseInt(currentTrackMap.trackId, 10))) {
                resolvedTrackId = parseInt(currentTrackMap.trackId, 10);
            }

            // 3. Track selector dropdown (if user explicitly selected a valid track)
            const selVal = document.getElementById("track-selector")?.value;
            if (resolvedTrackId === null && selVal !== undefined && selVal !== null && selVal !== "" && selVal !== "-1" && !isNaN(parseInt(selVal, 10))) {
                resolvedTrackId = parseInt(selVal, 10);
            }

            // CRITICAL: Reset offline preview override so live game tracking resumes
            currentTrackMap.isOfflineOverride = false;

            if (resolvedTrackId !== null && resolvedTrackId !== -1) {
                const trackName = F1_TRACK_MAP[resolvedTrackId] || window.lastTelemetryData?.session?.trackName || `TRACK ${resolvedTrackId}`;
                showToast(`🏎️ Auto-detecting & syncing ${trackName.toUpperCase()} with game...`);
                ws.send(JSON.stringify({ action: "syncTrackLines", trackId: resolvedTrackId }));
                ws.send(JSON.stringify({ action: "getTrackData", trackId: resolvedTrackId }));
                const trackSel = document.getElementById("track-selector");
                if (trackSel && trackSel.value != resolvedTrackId) {
                    trackSel.value = resolvedTrackId;
                }
            } else {
                // Let server auto-detect the track from UDP session
                showToast("🔍 Auto-detecting active track from game UDP stream...");
                ws.send(JSON.stringify({ action: "syncTrackLines" }));
                ws.send(JSON.stringify({ action: "getTrackData" }));
            }
        }

        function updateFinalizeButtonState(isFinalized) {
            const btn = document.getElementById("finalizebttn");
            const path = document.getElementById("finalize-path");
            if (!btn) return;
            if (isFinalized) {
                btn.classList.add("finalized");
                btn.style.background = "rgba(0, 255, 102, 0.25)";
                btn.style.borderColor = "rgba(0, 255, 102, 0.6)";
                btn.style.color = "#00ff66";
                btn.title = "Track Map Finalized (Timing lines locked & auto-sync stopped). Click to unlock.";
                if (path) {
                    // Closed lock icon
                    path.setAttribute("d", "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z");
                }
            } else {
                btn.classList.remove("finalized");
                btn.style.background = "rgba(255, 255, 255, 0.1)";
                btn.style.borderColor = "rgba(255, 255, 255, 0.15)";
                btn.style.color = "white";
                btn.title = "Finalize Track Map (Lock lines & stop auto-sync)";
                if (path) {
                    // Open unlock icon
                    path.setAttribute("d", "M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5-2.28 0-4.27 1.54-4.84 3.75-.14.54.18 1.08.72 1.22.53.14 1.08-.18 1.22-.72C10.51 3.66 11.98 2.9 12 2.9c1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z");
                }
            }
        }

        function toggleFinalizeTrack() {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                showToast("⚠️ WebSocket not connected.");
                return;
            }

            let resolvedTrackId = null;
            const liveTrackId = window.lastTelemetryData?.session?.trackId;
            if (liveTrackId !== undefined && liveTrackId !== null && liveTrackId !== -1 && liveTrackId !== "-1" && !isNaN(parseInt(liveTrackId, 10))) {
                resolvedTrackId = parseInt(liveTrackId, 10);
            }
            if (resolvedTrackId === null && currentTrackMap.trackId !== null && currentTrackMap.trackId !== -1 && !isNaN(parseInt(currentTrackMap.trackId, 10))) {
                resolvedTrackId = parseInt(currentTrackMap.trackId, 10);
            }
            const selVal = document.getElementById("track-selector")?.value;
            if (resolvedTrackId === null && selVal !== undefined && selVal !== null && selVal !== "" && selVal !== "-1" && !isNaN(parseInt(selVal, 10))) {
                resolvedTrackId = parseInt(selVal, 10);
            }

            if (resolvedTrackId === null || resolvedTrackId === -1) {
                showToast("⚠️ No active track to finalize.");
                return;
            }

            const btn = document.getElementById("finalizebttn");
            const currentlyFinalized = btn ? btn.classList.contains("finalized") : false;
            updateFinalizeButtonState(!currentlyFinalized);

            ws.send(JSON.stringify({
                action: "toggleFinalizeTrack",
                trackId: resolvedTrackId
            }));
        }

        document.getElementById("track-selector")?.addEventListener('change', function () {
            if (document.getElementById("track-selector").value !== -1 && document.getElementById("track-selector").value !== "-1") {
                const syncBtn = document.getElementById("syncbttn");
                if (syncBtn) syncBtn.style.display = "flex";
                const finBtn = document.getElementById("finalizebttn");
                if (finBtn) finBtn.style.display = "flex";
            }
        });

        function loadOfflineTrack(trackId) {
            if (!trackId || trackId === -1 || trackId === "-1" || trackId === "") {
                return;
            }
            const tId = parseInt(trackId, 10);
            currentTrackMap.isOfflineOverride = true;
            currentTrackMap.requestedTrackId = tId;

            // Immediately display track name in UI header
            const trackName = F1_TRACK_MAP[tId] ? F1_TRACK_MAP[tId].toUpperCase() : `TRACK ${tId}`;
            setText("track-name", trackName);

            const syncBtn = document.getElementById("syncbttn");
            if (syncBtn) syncBtn.style.display = "flex";

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: "getTrackData", trackId: tId }));
                ws.send(JSON.stringify({ action: "getTrackSetups", trackId: tId }));
            }
        }

        function handleTelemetryMessage(event) {
            const data = JSON.parse(event.data);
            window.lastTelemetryData = data;

            if (data.type === "toast" && data.message) {
                showToast(data.message);
                return;
            }

            if (data.type === "availableTracks") {
                const select = document.getElementById("track-selector");
                if (select && data.tracks && data.tracks.length > 0) {
                    const currentVal = select.value;
                    select.innerHTML = '<option value="-1">Load Track...</option>';
                    data.tracks.sort((a, b) => a - b).forEach((id) => {
                        const opt = document.createElement("option");
                        opt.value = id;
                        opt.textContent = F1_TRACK_MAP[id] ? F1_TRACK_MAP[id].toUpperCase() : `TRACK ${id}`;
                        select.appendChild(opt);
                    });
                    if (currentVal && currentVal !== "-1") {
                        select.value = currentVal;
                    }
                }
                return;
            }

            if (data.type === "trackDataResponse") {
                const trackData = data.data;
                const trackId = data.trackId !== undefined && data.trackId !== null ? parseInt(data.trackId, 10) : null;
                if (!trackData || !Array.isArray(trackData.trackPoints) || trackData.trackPoints.length < 20) {
                    clearTrackGeometry();
                    if (trackId !== null && trackId !== -1) {
                        currentTrackMap.trackId = trackId;
                        const name = F1_TRACK_MAP[trackId] || `TRACK ${trackId}`;
                        setText("track-name", name.toUpperCase() + " (DRIVE 1 LAP TO MAP)");
                    } else {
                        setText("track-name", "NO ACTIVE TRACK");
                    }
                    return;
                }

                renderTrackGeometry({
                    trackId: trackId,
                    trackPoints: trackData.trackPoints,
                    startLine: trackData.startLine,
                    sector1: trackData.sector1,
                    sector2: trackData.sector2,
                    drsZones: trackData.drsZones
                }, true);

                if (trackData.finalized !== undefined) {
                    updateFinalizeButtonState(!!trackData.finalized);
                }

                const select = document.getElementById("track-selector");
                if (trackId !== null && select && select.value != trackId) {
                    select.value = trackId;
                }
                if (trackId !== null && trackId !== -1) {
                    const name = F1_TRACK_MAP[trackId] || `TRACK ${trackId}`;
                    setText("track-name", name.toUpperCase());
                }
                return;
            }

            if (data.type === "trackFinalizedState") {
                const trackId = data.trackId !== undefined && data.trackId !== null ? parseInt(data.trackId, 10) : null;
                if (trackId === null || currentTrackMap.trackId === trackId) {
                    updateFinalizeButtonState(!!data.finalized);
                }
                return;
            }

            if (data.type === "trackRecordingProgress") {
                const trackId = data.trackId !== undefined && data.trackId !== null ? parseInt(data.trackId, 10) : null;
                if (data.trackPoints && data.trackPoints.length >= 2) {
                    renderLiveRecordingPath(data.trackPoints, trackId);
                }
                return;
            }

            if (data.type === "trackLinesUpdated") {
                const trackId = data.trackId !== undefined && data.trackId !== null ? parseInt(data.trackId, 10) : null;
                if (data.finalized !== undefined) {
                    updateFinalizeButtonState(!!data.finalized);
                }
                if (currentTrackMap.trackPoints && (trackId === null || currentTrackMap.trackId === trackId)) {
                    renderTrackGeometry({
                        trackId: currentTrackMap.trackId,
                        trackPoints: currentTrackMap.trackPoints,
                        startLine: data.startLine || currentTrackMap.startLine,
                        sector1: data.sector1 || currentTrackMap.sector1,
                        sector2: data.sector2 || currentTrackMap.sector2,
                        drsZones: Array.isArray(data.drsZones) ? data.drsZones : currentTrackMap.drsZones
                    }, true);
                }
                return;
            }

            if (data.type === "trackSetupsResponse") {
                offlineSetups = data.data || [];
                const selector = document.getElementById('setup-lap-selector');
                if (selector && offlineSetups.length > 0) {
                    selector.innerHTML = '<option value="live">Live Setup (UDP)</option>';
                    offlineSetups.sort((a, b) => b.lapNum - a.lapNum).forEach(setup => {
                        const opt = document.createElement('option');
                        opt.value = setup.lapNum;
                        opt.textContent = `Lap ${setup.lapNum} (${formatMs(setup.time)})`;
                        selector.appendChild(opt);
                    });
                }
                return;
            }

            const pIdx = data.playerIndex || 0;
            const playerLbData = data.leaderboard ? data.leaderboard.find(d => d.carIndex === pIdx) : null;

            setText("track-name", (data.session.trackName || "UNKNOWN").toUpperCase());
            setText("session-type", (data.session.type || "--").toUpperCase());
            setText("weather", `${data.session.weather || '--'} • ${data.session.airTemp || 0}°C`);
            setText("track-temp-sub", `Track: ${data.session.trackTemp || 0}°C`);

            const weatherIconMini = document.getElementById('weather-icon-mini');
            if (weatherIconMini && data.session.weather) {
                const weatherMap = { "CLEAR": 0, "LIGHT CLOUD": 1, "OVERCAST": 2, "LIGHT RAIN": 3, "HEAVY RAIN": 4, "STORM": 5 };
                const code = weatherMap[String(data.session.weather).toUpperCase()] ?? 6;
                weatherIconMini.innerHTML = getWeatherIconSVG(code, 16);
            }

            setText("pos", data.lap.pos > 0 ? data.lap.pos : (playerLbData?.pos || "--"));
            setText("lap-num", data.lap.lapNum || 0);
            setText("laps-total", data.session.lapsTotal || 0);

            // Flag Box
            const flagBox = document.getElementById("fia-flag");
            if (flagBox) {
                setElementText(flagBox, `${data.car.flag || 'GREEN'} FLAG`);
                if (data.car.flag === "YELLOW") {
                    setStyle(flagBox, "backgroundColor", "var(--fia-yellow)");
                    setStyle(flagBox, "color", "#000");
                } else if (data.car.flag === "RED") {
                    setStyle(flagBox, "backgroundColor", "var(--f1-red)");
                    setStyle(flagBox, "color", "#FFF");
                } else if (data.car.flag === "BLUE") {
                    setStyle(flagBox, "backgroundColor", "var(--fia-blue)");
                    setStyle(flagBox, "color", "#000");
                } else {
                    setStyle(flagBox, "backgroundColor", "var(--fia-green)");
                    setStyle(flagBox, "color", "#000");
                }
            }

            // Restored Race Control & Radar Fields
            setText("sc-status", data.session.safetyCarStatus || data.session.sc || "Clear");
            setText("pit-status", data.lap.pitStatus || "ON TRACK");
            setText("track-length", data.session.trackLength ? `${(data.session.trackLength / 1000).toFixed(3)} km` : "-- km");
            setText("race-dist", data.session.raceDistance ? `${(data.session.raceDistance / 1000).toFixed(3)} km` : "-- km");
            if (data.session.trackLength) {
                getRaceDistance(data.session.trackLength);
            }

            // --- Driver Offenses & Penalties Updates ---
            const penTime = (data.penalties && typeof data.penalties.timePenalties === 'number')
                ? data.penalties.timePenalties
                : (data.lap?.penalties || 0);
            const penWarn = (data.penalties && typeof data.penalties.warnings === 'number')
                ? data.penalties.warnings
                : (data.lap?.warnings || 0);
            const penCC = (data.penalties && typeof data.penalties.cornerCuts === 'number')
                ? data.penalties.cornerCuts
                : (data.lap?.cornerCutting || 0);
            const penDT = (data.penalties && typeof data.penalties.driveThrough === 'number')
                ? data.penalties.driveThrough
                : (data.lap?.unservedDT || 0);
            const penSG = (data.penalties && typeof data.penalties.stopGo === 'number')
                ? data.penalties.stopGo
                : (data.lap?.unservedSG || 0);
            const isInvalidLap = Boolean((data.penalties && data.penalties.invalidLap === 1) || data.lap?.invalid);

            const penEl = document.getElementById("penalties");
            if (penEl) {
                penEl.textContent = penTime > 0 ? `${penTime}s` : "0s";
                penEl.style.color = penTime > 0 ? "var(--f1-red)" : "var(--text-main)";
                penEl.style.fontWeight = penTime > 0 ? "bold" : "normal";
            }
            setText("warnings", penWarn);
            setText("corner-cuts", penCC);
            setText("unserved-dt", penDT);
            setText("unserved-sg", penSG);

            const invalidRow = document.getElementById("lap-invalid-row");
            if (invalidRow) {
                invalidRow.style.display = isInvalidLap ? "flex" : "none";
            }

            // Strategy Box
            const stratBox = document.getElementById("strategy-box");
            if (stratBox) {
                const strategyInfo = calculatePitStrategy(data);
                setElementText(stratBox, strategyInfo.text);
                setStyle(stratBox, "color", strategyInfo.color);
                setStyle(stratBox, "backgroundColor", strategyInfo.bgColor);
                setStyle(stratBox, "border", strategyInfo.border);
            }

            // Lap & Sector Timing
            const history = Array.isArray(playerLbData?.lapHistory)
                ? playerLbData.lapHistory
                : [];

            const isHoldingLap = data.lap.currentMs < 5000 && history.length >= 2;

            const lapN = history.length >= 2 ? history[history.length - 2] : null;
            const lapNMinus1 = history.length >= 3 ? history[history.length - 3] : null;
            const displayLastMs = lapHistoryMs(lapN, "lapTime") || data.lap.lastMs;
            const displayLastPrevMs = lapHistoryMs(lapNMinus1, "lapTime");

            const lastMsEl = document.getElementById("lap-last");
            if (lastMsEl) {
                setElementText(lastMsEl, formatMs(displayLastMs));

                const pbLap = playerLbData?.bestLapMs;
                const sbLap = data.session.sessionFastestLapMs;
                const isQualiOrTT = data.session.sessionCategory === "TimeAttack";
                const bestLapRef = isQualiOrTT
                    ? (sbLap > 0 ? sbLap : (pbLap > 0 ? pbLap : 0))
                    : (pbLap > 0 ? pbLap : (sbLap > 0 ? sbLap : 0));

                let lastMsColor = null;
                if (displayLastMs > 0) {
                    if (sbLap > 0 && displayLastMs <= sbLap) lastMsColor = "purple";
                    else if (pbLap > 0 && displayLastMs <= pbLap) lastMsColor = "green";
                    else lastMsColor = "yellow";
                }
                setClass(lastMsEl, lastMsColor, ["purple", "green", "yellow"]);

                const prevDiff = displayLastMs > 0 && displayLastPrevMs > 0 ? displayLastMs - displayLastPrevMs : NaN;
                let lapComparisonMs = bestLapRef;
                if (displayLastMs > 0 && displayLastMs === bestLapRef) {
                    const allLaps = history.map(h => lapHistoryMs(h, "lapTime")).filter(ms => ms > 0).sort((a, b) => a - b);
                    const uniqueLaps = [...new Set(allLaps)];
                    if (uniqueLaps.length > 1) {
                        lapComparisonMs = uniqueLaps[1];
                    }
                }
                const bestDiff = displayLastMs > 0 && lapComparisonMs > 0 ? displayLastMs - lapComparisonMs : NaN;

                setDeltaText("lap-last-prev", prevDiff, prevDiff <= 0 ? "var(--fia-green)" : "var(--fia-yellow)");

                let bestColor = "var(--text-muted)";
                if (Number.isFinite(bestDiff)) {
                    if (sbLap > 0 && displayLastMs <= sbLap) bestColor = "var(--fia-purple)";
                    else if (pbLap > 0 && displayLastMs <= pbLap) bestColor = "var(--fia-green)";
                    else bestColor = "var(--fia-yellow)";
                }
                setDeltaText("lap-last-best", bestDiff, bestColor);
            }

            const bestMsEl = document.getElementById("lap-best");
            if (bestMsEl) {
                setElementText(bestMsEl, formatMs(data.lap.bestMs));
                let bestMsColor = null;
                if (data.lap.bestMs > 0) {
                    if (data.session.sessionFastestLapMs > 0 && data.lap.bestMs <= data.session.sessionFastestLapMs) {
                        bestMsColor = "purple";
                    } else {
                        bestMsColor = "green";
                    }
                }
                setClass(bestMsEl, bestMsColor, ["purple", "green", "yellow"]);
            }

            const refS1 = data.session?.referenceS1 || data.session?.allTimeBestS1 || 0;
            const refS2 = data.session?.referenceS2 || data.session?.allTimeBestS2 || 0;
            const refS3 = data.session?.referenceS3 || data.session?.allTimeBestS3 || 0;

            const pb1 = (playerLbData && playerLbData.bestS1 > 0) ? playerLbData.bestS1 : (data.lap?.bestS1 || refS1 || 0);
            const pb2 = (playerLbData && playerLbData.bestS2 > 0) ? playerLbData.bestS2 : (data.lap?.bestS2 || refS2 || 0);
            const pb3 = (playerLbData && playerLbData.bestS3 > 0) ? playerLbData.bestS3 : (data.lap?.bestS3 || refS3 || 0);

            const sb1 = (data.session.sessionBestS1 && data.session.sessionBestS1 !== Infinity && data.session.sessionBestS1 > 0) ? data.session.sessionBestS1 : (refS1 || pb1 || 0);
            const sb2 = (data.session.sessionBestS2 && data.session.sessionBestS2 !== Infinity && data.session.sessionBestS2 > 0) ? data.session.sessionBestS2 : (refS2 || pb2 || 0);
            const sb3 = (data.session.sessionBestS3 && data.session.sessionBestS3 !== Infinity && data.session.sessionBestS3 > 0) ? data.session.sessionBestS3 : (refS3 || pb3 || 0);

            const sbS1El = document.getElementById("sb-s1");
            if (sbS1El) setElementText(sbS1El, sb1 > 0 ? formatMs(sb1) : "--:--.---");
            const sbS2El = document.getElementById("sb-s2");
            if (sbS2El) setElementText(sbS2El, sb2 > 0 ? formatMs(sb2) : "--:--.---");
            const sbS3El = document.getElementById("sb-s3");
            if (sbS3El) setElementText(sbS3El, sb3 > 0 ? formatMs(sb3) : "--:--.---");

            const pbS1El = document.getElementById("pb-s1");
            if (pbS1El) {
                setElementText(pbS1El, pb1 > 0 ? formatMs(pb1) : "--:--.---");
                if (pb1 > 0) setClass(pbS1El, (sb1 > 0 && pb1 <= sb1) ? "purple" : "green", ["purple", "green"]);
                else setClass(pbS1El, "", ["purple", "green"]);
            }

            const pbS2El = document.getElementById("pb-s2");
            if (pbS2El) {
                setElementText(pbS2El, pb2 > 0 ? formatMs(pb2) : "--:--.---");
                if (pb2 > 0) setClass(pbS2El, (sb2 > 0 && pb2 <= sb2) ? "purple" : "green", ["purple", "green"]);
                else setClass(pbS2El, "", ["purple", "green"]);
            }

            const pbS3El = document.getElementById("pb-s3");
            if (pbS3El) {
                setElementText(pbS3El, pb3 > 0 ? formatMs(pb3) : "--:--.---");
                if (pb3 > 0) setClass(pbS3El, (sb3 > 0 && pb3 <= sb3) ? "purple" : "green", ["purple", "green"]);
                else setClass(pbS3El, "", ["purple", "green"]);
            }

            const theoreticalBestEl = document.getElementById("lap-theoretical-best");
            if (theoreticalBestEl) {
                if (pb1 > 0 && pb2 > 0 && pb3 > 0) {
                    setElementText(theoreticalBestEl, formatMs(pb1 + pb2 + pb3));
                } else if (sb1 > 0 && sb2 > 0 && sb3 > 0) {
                    setElementText(theoreticalBestEl, formatMs(sb1 + sb2 + sb3));
                } else if (data.session.theoreticalBestLapMs > 0) {
                    setElementText(theoreticalBestEl, formatMs(data.session.theoreticalBestLapMs));
                } else {
                    setElementText(theoreticalBestEl, "--:--.---");
                }
            }

            if (isHoldingLap) {
                const heldLapData = history[history.length - 2];
                const dS1 = lapHistoryMs(heldLapData, "s1");
                const dS2 = lapHistoryMs(heldLapData, "s2");
                const dS3 = lapHistoryMs(heldLapData, "s3");

                data.lap = {
                    ...data.lap,
                    s1: dS1, liveS1: dS1, s1State: "complete",
                    s2: dS2, liveS2: dS2, s2State: "complete",
                    s3: dS3, liveS3: dS3, s3State: "complete"
                };
            }

            setText("lap-current", formatMs(data.lap.currentMs));

            updateSectorDisplay(
                "s1",
                data.lap.liveS1 ?? data.lap.s1,
                data.lap.s1State,
                sb1,
                pb1,
                data.lap.s1Status
            );
            updateSectorDisplay(
                "s2",
                data.lap.liveS2 ?? data.lap.s2,
                data.lap.s2State,
                sb2,
                pb2,
                data.lap.s2Status
            );
            updateSectorDisplay(
                "s3",
                data.lap.liveS3 ?? data.lap.s3,
                data.lap.s3State,
                sb3,
                pb3,
                data.lap.s3Status
            );

            updateSectorDeltas(data, playerLbData);

            // Session Fastest Lap & Track Record
            const sessFastest = (data.session.sessionFastestLapMs && data.session.sessionFastestLapMs !== Infinity) ? data.session.sessionFastestLapMs : 0;
            const sessFastestDriver = data.session.sessionFastestDriver && data.session.sessionFastestDriver !== "None" && data.session.sessionFastestDriver !== "Unknown"
                ? data.session.sessionFastestDriver
                : (data.session.fastestLapCarIndex >= 0 && data.participants && data.participants[data.session.fastestLapCarIndex]
                    ? data.participants[data.session.fastestLapCarIndex]
                    : "");
            setText("session-fastest-lap", sessFastest > 0 ? formatMs(sessFastest) : "--:--.---");
            setText("session-fastest-driver", sessFastestDriver ? `(${sessFastestDriver})` : "");
            setText("hdr-fastest-lap", sessFastest > 0 ? formatMs(sessFastest) : "--:--.---");
            setText("hdr-fastest-driver", sessFastestDriver || "--");

            const recordMs = data.session.allTimeFastestLapMs === Infinity ? 0 : data.session.allTimeFastestLapMs;
            setText("lap-record", formatMs(recordMs));
            setText("record-driver", data.session.allTimeFastestDriver && data.session.allTimeFastestDriver !== "Unknown" && data.session.allTimeFastestDriver !== "None" ? `(${data.session.allTimeFastestDriver})` : "");

            // Strategy & Battle Radar (Ahead, Behind, DRS, Compound, Stint, Delta vs Session Best)
            setText("ahead-name", data.lap.driverAhead || "LEADER");
            setText("ahead-gap", data.lap.gapFront || "+0.000s");
            setText("behind-name", data.lap.driverBehind || "NONE");
            setText("behind-gap", data.lap.gapBehind || "--");

            const drsThreatRow = document.getElementById("drs-threat-row");
            if (drsThreatRow) drsThreatRow.style.display = data.lap.drsThreat ? "flex" : "none";

            setText("tyre-compound", data.car.compound || "Unknown");
            setText("tyre-age", `${data.car.tyreAge || 0} Laps`);

            const deltaSessionEl = document.getElementById('delta-session-best');
            if (deltaSessionEl) {
                const pbLap = playerLbData?.bestLapMs || data.lap.bestMs || 0;
                const sbLap = (data.session.sessionFastestLapMs && data.session.sessionFastestLapMs !== Infinity)
                    ? data.session.sessionFastestLapMs : 0;
                if (pbLap > 0 && sbLap > 0) {
                    const diffMs = pbLap - sbLap;
                    if (diffMs <= 0) {
                        deltaSessionEl.innerHTML = `<span style="color:var(--fia-purple);font-size:0.9rem;">⏱ SESSION BEST</span>`;
                    } else {
                        const diffSec = (diffMs / 1000).toFixed(3);
                        const col = diffMs < 500 ? 'var(--fia-green)' : diffMs < 1500 ? 'var(--fia-yellow)' : 'var(--f1-red)';
                        deltaSessionEl.innerHTML = `<span style="color:${col}">+${diffSec}s</span>`;
                    }
                } else if (sbLap > 0 && pbLap === 0) {
                    deltaSessionEl.innerHTML = `<span style="color:var(--text-muted);font-size:0.8rem;">No best lap yet</span>`;
                } else {
                    deltaSessionEl.textContent = '--';
                    deltaSessionEl.style.color = 'var(--text-muted)';
                }
            }

            const isGameActive = (data.isGameActive !== undefined) ? Boolean(data.isGameActive) : (data.inputs?.speed > 0 || data.inputs?.rpm > 0 || (data.lap?.currentMs && data.lap.currentMs > 0));
            const liveBadge = document.getElementById("rbr-live-badge");
            const liveDot = document.getElementById("rbr-pulse-dot");
            const liveText = document.getElementById("rbr-live-text");
            if (isGameActive) {
                if (liveBadge) liveBadge.style.borderColor = "rgba(0, 230, 118, 0.4)";
                if (liveDot) {
                    liveDot.style.background = "var(--fia-green)";
                    liveDot.style.boxShadow = "0 0 8px var(--fia-green)";
                }
                if (liveText) {
                    liveText.textContent = "LIVE 20Hz";
                    liveText.style.color = "#00E676";
                }
                setText("ws-status", "LIVE TELEMETRY");
                setStyleById("ws-status", "color", "var(--fia-green)");
            } else {
                if (liveBadge) liveBadge.style.borderColor = "rgba(255, 209, 0, 0.4)";
                if (liveDot) {
                    liveDot.style.background = "var(--fia-yellow)";
                    liveDot.style.boxShadow = "0 0 8px var(--fia-yellow)";
                }
                if (liveText) {
                    liveText.textContent = "STANDBY";
                    liveText.style.color = "var(--fia-yellow)";
                }
                setText("ws-status", "STANDBY (NO GAME DATA)");
                setStyleById("ws-status", "color", "var(--fia-yellow)");
            }

            // Update Circuit Map floating mini HUD
            setText("hud-pos", data.lap.pos > 0 ? `P${data.lap.pos}` : (playerLbData?.pos ? `P${playerLbData.pos}` : "P--"));
            setText("hud-lap", formatMs(data.lap.currentMs || 0));
            setText("hud-gap", data.lap.gapFront || "+0.000");

            // Hero Bar Target Cards
            const isQualiOrPractice = data.session.sessionCategory === "TimeAttack";
            setText('hero-pos-lbl', isQualiOrPractice ? "QUALI RANK" : "POSITION");

            if (isQualiOrPractice) {
                const playerIndexInLb = data.leaderboard ? data.leaderboard.findIndex(d => d.carIndex === pIdx) : -1;
                const playerBest = (playerLbData?.bestLapMs > 0) ? playerLbData.bestLapMs : (data.lap.bestMs > 0 ? data.lap.bestMs : 0);
                const poleLap = (data.leaderboard && data.leaderboard.length > 0 && data.leaderboard[0].bestLapMs > 0) ? data.leaderboard[0].bestLapMs : sessFastest;
                const poleDriver = data.session.sessionFastestDriver || (data.leaderboard?.[0] ? (data.participants?.[data.leaderboard[0].carIndex] || "Pole") : "Pole");

                if (playerIndexInLb > 0) {
                    const carAhead = data.leaderboard[playerIndexInLb - 1];
                    const carAheadName = data.participants?.[carAhead.carIndex] || `Car ${carAhead.carIndex}`;
                    const aheadBest = carAhead.bestLapMs || 0;
                    setText('hero-target-title', `Δ TO P${playerIndexInLb}`);
                    setText('hero-target-tag', "GAP AHEAD");
                    setText('hero-target-val', (playerBest > 0 && aheadBest > 0) ? formatDeltaMs(playerBest - aheadBest) : (playerBest > 0 && poleLap > 0 ? formatDeltaMs(playerBest - poleLap) : "--"));
                    setText('hero-target-sub', carAheadName);
                } else if (playerIndexInLb === 0 && playerBest > 0) {
                    setText('hero-target-title', "POLE POSITION");
                    setText('hero-target-tag', "P1 LEADER");
                    setText('hero-target-val', formatMs(playerBest));
                    const p2Car = data.leaderboard?.[1];
                    const p2Diff = (p2Car && p2Car.bestLapMs > 0) ? `+${((p2Car.bestLapMs - playerBest) / 1000).toFixed(3)}s gap to P2` : "Fastest Lap";
                    setText('hero-target-sub', p2Diff);
                } else {
                    setText('hero-target-title', "Δ TO POLE");
                    setText('hero-target-tag', "SESSION");
                    setText('hero-target-val', (playerBest > 0 && poleLap > 0) ? formatDeltaMs(playerBest - poleLap) : "--");
                    setText('hero-target-sub', poleDriver);
                }

                if (playerIndexInLb >= 0 && playerIndexInLb < data.leaderboard.length - 1) {
                    const carBehind = data.leaderboard[playerIndexInLb + 1];
                    const carBehindName = data.participants?.[carBehind.carIndex] || `Car ${carBehind.carIndex}`;
                    const behindBest = carBehind.bestLapMs || 0;
                    setText('hero-behind-title', `Δ FROM P${playerIndexInLb + 2}`);
                    setText('hero-behind-tag', "GAP BEHIND");
                    setText('hero-behind-val', (playerBest > 0 && behindBest > 0) ? `+${((behindBest - playerBest) / 1000).toFixed(3)}s` : "--");
                    setText('hero-behind-sub', carBehindName);
                } else {
                    setText('hero-behind-title', "CAR BEHIND");
                    setText('hero-behind-tag', "GAP");
                    setText('hero-behind-val', "--");
                    setText('hero-behind-sub', "None");
                }
            } else {
                setText('hero-target-title', "CAR AHEAD");
                setText('hero-target-tag', "INTERVAL");
                setText('hero-target-val', data.lap.gapFront || "+0.000s");
                setText('hero-target-sub', data.lap.driverAhead || "Leader");

                setText('hero-behind-title', "CAR BEHIND");
                setText('hero-behind-tag', data.lap.drsThreat ? "DRS THREAT" : "GAP");
                setText('hero-behind-val', data.lap.gapBehind || "--");
                setText('hero-behind-sub', data.lap.driverBehind || "None");
            }

            // Telemetry Inputs & Powertrain
            const currentLiveSpeed = Math.round(data.inputs.speed || 0);
            setText("speed", currentLiveSpeed);

            // Read session top speed directly from server.js session tracking (playerLbData.maxSpeed or data.session)
            const serverSessionTopSpeed = (playerLbData && playerLbData.maxSpeed > 0)
                ? playerLbData.maxSpeed
                : (data.session && data.session.topSpeed > 0 ? data.session.topSpeed : (data.inputs.topSpeed || 0));

            const effectiveTopSpeed = Math.max(serverSessionTopSpeed, currentLiveSpeed);

            if (effectiveTopSpeed > 0) {
                window.playerTopSpeed = effectiveTopSpeed;
                setText("top-speed", effectiveTopSpeed);
                setText("panel-top-speed", `${effectiveTopSpeed} km/h`);
                setText("hud-top-speed", `${effectiveTopSpeed} KM/H`);
            } else {
                setText("hud-top-speed", "--");
            }
            setText("gear", data.inputs.gear || 'N');
            setText("rpm", data.inputs.rpm || 0);
            setText("thr-val", `${Math.round(data.inputs.throttle || 0)}%`);
            setStyleById("throttle", "width", `${clampPercent(data.inputs.throttle)}%`);
            setText("brk-val", `${Math.round(data.inputs.brake || 0)}%`);
            setStyleById("brake", "width", `${clampPercent(data.inputs.brake)}%`);
            setText("clu-val", `${data.inputs.clutch || 0}%`);
            setStyleById("clutch", "width", `${clampPercent(data.inputs.clutch)}%`);
            setText("drs", data.inputs.drs || "CLOSED");
            setStyleById("drs", "color", data.inputs.drs === "OPEN" ? "var(--fia-green)" : "var(--text-main)");

            const steerVal = data.inputs.steer || 0;
            setText("steer-val", steerVal.toFixed(2));
            if (steerVal >= 0) {
                setStyleById("steer-right", "width", `${Math.min(steerVal * 50, 50)}%`);
                setStyleById("steer-left", "width", "0%");
            } else {
                setStyleById("steer-left", "width", `${Math.min(Math.abs(steerVal) * 50, 50)}%`);
                setStyleById("steer-right", "width", "0%");
            }

            const isPaused = Boolean(
                data.session?.gamePaused ||
                (isGameActive && data.inputs?.speed === 0 && data.inputs?.rpm === 0 && data.lap?.currentMs > 0 && data.lap?.currentMs === window.lastCurrentMsInputTrace)
            );
            window.lastCurrentMsInputTrace = data.lap?.currentMs;
            drawInputTrace(data.inputs.throttle, data.inputs.brake, isPaused, isGameActive);
            setText("g-lat", (data.motion.gLat || 0).toFixed(2));
            setText("g-long", (data.motion.gLong || 0).toFixed(2));
            setText("g-vert", (data.motion.gVert || 0).toFixed(2));
            updateGForceDisplay(data.motion.gLat || 0, data.motion.gLong || 0, data.motion.gVert || 0, data.lap.currentMs, data.motion);

            setStyleById("susp-fl", "width", `${clampPercent(Math.abs((data.motion.susp?.fl || 0) * 15))}%`);
            setStyleById("susp-fr", "width", `${clampPercent(Math.abs((data.motion.susp?.fr || 0) * 15))}%`);
            setStyleById("susp-rl", "width", `${clampPercent(Math.abs((data.motion.susp?.rl || 0) * 15))}%`);
            setStyleById("susp-rr", "width", `${clampPercent(Math.abs((data.motion.susp?.rr || 0) * 15))}%`);

            // Tyres
            setText("engine-temp", `${data.car.engineTemp || 0}°C`);
            updateCarTyreVisual(data.car.wear, data.car.compound);
            updateTyreTemps(data.car.surfTemp, data.car.inTemp);
            updateTyrePredictor(data.car.wear, data.car.tyreAge);

            // Car Setup
            if (!selectedOfflineSetup && data.setup) {
                renderCarSetup(data.setup);
            }

            // Damage
            if (data.damage) updateDamageUX(data.damage, data.car);

            // Weather Forecast Cards (First 60 Min Horizon)
            const weatherContainer = document.getElementById("weather-cards-container");
            if (weatherContainer) {
                const weatherNames = { 0: "Clear", 1: "Light Cloud", 2: "Overcast", 3: "Light Rain", 4: "Heavy Rain", 5: "Storm", 6: "Unknown" };
                const tempChangeSymbols = { 0: '<span style="color:#F59E0B;">▲</span>', 1: '<span style="color:#60A5FA;">▼</span>', 2: '<span style="color:var(--text-dim);">—</span>' };

                let hourlyForecast = [];
                if (data.weatherForecast && Array.isArray(data.weatherForecast) && data.weatherForecast.length > 0) {
                    const normalized = data.weatherForecast.map(s => {
                        const offset = (s.m_timeOffset !== undefined) ? Number(s.m_timeOffset) : (s.timeOffset !== undefined ? Number(s.timeOffset) : 0);
                        const weather = (s.m_weather !== undefined) ? Number(s.m_weather) : (s.weather !== undefined ? Number(s.weather) : 0);
                        const rainPct = (s.m_rainPercentage !== undefined) ? Number(s.m_rainPercentage) : (s.rainPercentage !== undefined ? Number(s.rainPercentage) : 0);
                        const trackTemp = (s.m_trackTemperature !== undefined) ? Number(s.m_trackTemperature) : (s.trackTemperature !== undefined ? Number(s.trackTemperature) : data.session?.trackTemp);
                        const airTemp = (s.m_airTemperature !== undefined) ? Number(s.m_airTemperature) : (s.airTemperature !== undefined ? Number(s.airTemperature) : data.session?.airTemp);
                        const trackChange = (s.m_trackTemperatureChange !== undefined) ? Number(s.m_trackTemperatureChange) : (s.trackTemperatureChange !== undefined ? Number(s.trackTemperatureChange) : 2);
                        const airChange = (s.m_airTemperatureChange !== undefined) ? Number(s.m_airTemperatureChange) : (s.airTemperatureChange !== undefined ? Number(s.airTemperatureChange) : 2);
                        return { offset, weather, rainPct, trackTemp, airTemp, trackChange, airChange };
                    });

                    // Strictly filter to the first 60 minutes horizon (0 to 60 min)
                    const filtered = normalized.filter(s => Number.isFinite(s.offset) && s.offset >= 0 && s.offset <= 60);
                    filtered.sort((a, b) => a.offset - b.offset);

                    // Deduplicate by offset
                    const seenOffsets = new Set();
                    for (const sample of filtered) {
                        if (!seenOffsets.has(sample.offset)) {
                            seenOffsets.add(sample.offset);
                            hourlyForecast.push(sample);
                        }
                    }
                }

                // If no samples returned yet from UDP, fallback to live session state as NOW (0 min)
                if (hourlyForecast.length === 0 && data.session) {
                    const wMap = { "CLEAR": 0, "LIGHT CLOUD": 1, "OVERCAST": 2, "LIGHT RAIN": 3, "HEAVY RAIN": 4, "STORM": 5 };
                    const currentCode = wMap[String(data.session.weather || "").toUpperCase()] ?? 0;
                    hourlyForecast.push({
                        offset: 0,
                        weather: currentCode,
                        rainPct: currentCode >= 3 ? 80 : 0,
                        trackTemp: data.session.trackTemp || 0,
                        airTemp: data.session.airTemp || 0,
                        trackChange: 2,
                        airChange: 2
                    });
                }

                // Update Weather Tab Live Summary KPIs
                const currCond = (data.session?.weather || weatherNames[hourlyForecast[0]?.weather] || "CLEAR").toUpperCase();
                setText("weather-tab-curr-cond", currCond);
                setText("weather-tab-curr-temp", `${data.session?.airTemp || hourlyForecast[0]?.airTemp || '--'}°C / ${data.session?.trackTemp || hourlyForecast[0]?.trackTemp || '--'}°C`);

                let maxRainRisk = 0;
                hourlyForecast.forEach(s => { if (s.rainPct > maxRainRisk) maxRainRisk = s.rainPct; });
                setText("weather-tab-max-rain", `${maxRainRisk}%`);
                setStyleById("weather-tab-max-rain", "color", maxRainRisk > 50 ? "#EF4444" : (maxRainRisk > 20 ? "#F59E0B" : "var(--fia-green)"));
                setText("weather-tab-horizon-count", `${hourlyForecast.length} Samples (0 - 60 Min)`);

                const summaryTag = document.getElementById("weather-summary-tag");
                if (summaryTag) {
                    if (maxRainRisk >= 60) {
                        summaryTag.textContent = `⚠️ HEAVY RAIN EXPECTED (${maxRainRisk}%)`;
                        summaryTag.style.color = "#EF4444";
                        summaryTag.style.borderColor = "#EF4444";
                        summaryTag.style.background = "rgba(239, 68, 68, 0.15)";
                    } else if (maxRainRisk >= 25) {
                        summaryTag.textContent = `🌦️ RAIN RISK IN 60 MIN (${maxRainRisk}%)`;
                        summaryTag.style.color = "#F59E0B";
                        summaryTag.style.borderColor = "#F59E0B";
                        summaryTag.style.background = "rgba(245, 158, 11, 0.15)";
                    } else {
                        summaryTag.textContent = `☀️ DRY CONDITIONS (0-${maxRainRisk}%)`;
                        summaryTag.style.color = "var(--fia-green)";
                        summaryTag.style.borderColor = "var(--fia-green)";
                        summaryTag.style.background = "rgba(0, 230, 118, 0.12)";
                    }
                }

                // Render 60-Minute Weather Horizon Cards
                let wHtml = "";
                hourlyForecast.forEach(sample => {
                    const offsetStr = sample.offset === 0 ? "NOW" : `+${sample.offset} MIN`;
                    const condName = weatherNames[sample.weather] || "Unknown";
                    const iconSvg = getWeatherIconSVG(sample.weather, 38);
                    const rainPct = sample.rainPct ?? 0;
                    const rainBarColor = rainPct > 50 ? "#EF4444" : rainPct > 20 ? "#F59E0B" : (rainPct > 5 ? "#3B82F6" : "#00E676");
                    const trackSym = tempChangeSymbols[sample.trackChange] || tempChangeSymbols[2];
                    const airSym = tempChangeSymbols[sample.airChange] || tempChangeSymbols[2];

                    wHtml += `
                        <div style="min-width: 145px; flex: 0 0 145px; background: rgba(14,28,54,0.92); border: 1px solid ${sample.offset === 0 ? 'var(--rbr-yellow)' : 'var(--f1-border)'}; border-radius: 10px; padding: 12px 10px; display: flex; flex-direction: column; align-items: center; text-align: center; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">
                            <span style="font-size: 0.72rem; font-weight: 700; color: ${sample.offset === 0 ? 'var(--rbr-yellow)' : '#93C5FD'}; font-family: 'Roboto Mono', monospace; background: rgba(255,255,255,0.06); padding: 2px 8px; border-radius: 4px; margin-bottom: 6px;">${offsetStr}</span>
                            <div style="margin: 4px 0;">${iconSvg}</div>
                            <span style="font-weight: 700; font-size: 0.86rem; color: #FFF; letter-spacing: 0.5px;">${condName.toUpperCase()}</span>
                            <div style="display: flex; flex-direction: column; gap: 2px; width: 100%; margin-top: 6px; font-size: 0.72rem; color: var(--text-muted); font-family: 'Roboto Mono', monospace;">
                                <div style="display: flex; justify-content: space-between;"><span>Track:</span><span style="color:#FFF;">${sample.trackTemp ?? '--'}°C ${trackSym}</span></div>
                                <div style="display: flex; justify-content: space-between;"><span>Air:</span><span style="color:#FFF;">${sample.airTemp ?? '--'}°C ${airSym}</span></div>
                            </div>
                            <div style="width: 100%; margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.06);">
                                <div style="display: flex; justify-content: space-between; font-size: 0.65rem; color: var(--text-muted); margin-bottom: 3px; font-weight: 700;">
                                    <span>RAIN</span><span style="color: ${rainBarColor};">${rainPct}%</span>
                                </div>
                                <div style="width: 100%; height: 5px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden;">
                                    <div style="width: ${rainPct}%; height: 100%; background: ${rainBarColor}; border-radius: 3px; transition: width 0.3s ease;"></div>
                                </div>
                            </div>
                        </div>
                    `;
                });
                weatherContainer.innerHTML = wHtml;
            }

            // Classification Table
            updateLeaderboardDisplay(data);

            // History Table
            renderLapHistoryTable(data);

            // ── ERS & Fuel Strategy Module ──
            updateErsFuelDisplay(data);

            // ── Pace Analysis & Rival Head-to-Head ──
            const paceTab = document.getElementById("tab-session-history");
            if (paceTab && paceTab.classList.contains("active")) {
                drawPaceChart(data);
                updateRivalComparison(data);
            } else {
                updateRivalDropdown(data);
            }

            // ── Track Map & Position Synchronization ──
            const liveTrackId = (data.session && data.session.trackId !== undefined && data.session.trackId !== null && data.session.trackId !== -1)
                ? parseInt(data.session.trackId, 10)
                : null;

            const isLiveSession = (liveTrackId !== null && (isGameActive || (data.session.trackName && data.session.trackName !== "Unknown" && data.session.trackName !== "TRACK NOT FOUND")));
            const trackSelector = document.getElementById("track-selector");
            if (trackSelector) {
                trackSelector.style.display = isLiveSession ? "none" : "block";
            }

            // CRITICAL: When the game enters a live session or changes track in-game,
            // IMMEDIATELY override offline preview and switch to the live game track!
            if (isLiveSession && liveTrackId !== null) {
                if (currentTrackMap.isOfflineOverride || currentTrackMap.trackId !== liveTrackId) {
                    currentTrackMap.isOfflineOverride = false;
                    const prevTrackId = currentTrackMap.trackId;
                    currentTrackMap.trackId = liveTrackId;
                    currentTrackMap.requestedTrackId = liveTrackId;

                    // If moving from one track to another (e.g. Brazil to Las Vegas),
                    // clear the old track geometry immediately so it doesn't stay on screen!
                    if (prevTrackId !== null && prevTrackId !== liveTrackId) {
                        clearTrackGeometry();
                        currentTrackMap.trackId = liveTrackId;
                    }

                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ action: "getTrackData", trackId: liveTrackId }));
                    }
                    if (trackSelector && trackSelector.value != liveTrackId) {
                        trackSelector.value = liveTrackId;
                    }
                    const liveName = F1_TRACK_MAP[liveTrackId] || data.session.trackName || `TRACK ${liveTrackId}`;
                    setText("track-name", liveName.toUpperCase());
                }
            }

            // If telemetry packet contains track points (dirty broadcast from server)
            if (data.trackPoints && data.trackPoints.length > 0) {
                renderTrackGeometry({
                    trackId: liveTrackId !== null ? liveTrackId : currentTrackMap.trackId,
                    trackPoints: data.trackPoints,
                    startLine: data.startLine,
                    sector1: data.sector1,
                    sector2: data.sector2,
                    drsZones: data.drsZones
                });
            }

            latestMapData = data;

            // Custom Timing Sector Lines (if user added micro sectors)
            if (data.customSectorLines) {
                data.customSectorLines.forEach((sectorObj, i) => {
                    let mesh = customSectorMeshes[i];
                    if (!mesh) {
                        mesh = createSectorLine(i === 0 ? 0xffd700 : 0xffaa00);
                        customSectorMeshes.push(mesh);
                    }

                    if (
                        sectorObj &&
                        sectorObj.x !== undefined &&
                        sectorObj.z !== undefined
                    ) {
                        mesh.position.set(sectorObj.x, 0, sectorObj.z);
                        if (sectorObj.yaw !== undefined)
                            mesh.rotation.y = -sectorObj.yaw;
                        mesh.visible = true;
                    } else {
                        mesh.visible = false;
                    }
                });

                for (
                    let i = data.customSectorLines.length;
                    i < customSectorMeshes.length;
                    i++
                ) {
                    customSectorMeshes[i].visible = false;
                }
            }

            // Update Car Markers on Track Map
            const showCars = (isLiveSession || isGameActive) && !currentTrackMap.isOfflineOverride && Array.isArray(data.allCars);
            for (let i = 0; i < carMeshes.length; i++) {
                const carData = showCars ? data.allCars[i] : null;
                const mesh = carMeshes[i];

                if (
                    !carData ||
                    !Number.isFinite(carData.x) ||
                    !Number.isFinite(carData.z) ||
                    (carData.x === 0 && carData.z === 0)
                ) {
                    mesh.visible = false;
                } else {
                    mesh.visible = true;
                    mesh.position.set(carData.x, 0, carData.z);
                    const isSC = Boolean(carData.isSafetyCar || (carData.teamName && carData.teamName.toLowerCase().includes("safety")));
                    mesh.userData.isSafetyCar = isSC;

                    if (isSC) {
                        mesh.material.color.setHex(0xFFB000);
                        mesh.scale.set(2.2, 2.2, 2.2);
                        mesh.renderOrder = 1000;
                    } else if (i === data.playerIndex) {
                        mesh.material.color.setHex(getTeamColorHex(carData.teamColor));
                        mesh.scale.set(1.5, 1.5, 1.5);
                        mesh.renderOrder = 999;
                    } else {
                        mesh.material.color.setHex(getTeamColorHex(carData.teamColor));
                        mesh.scale.set(1, 1, 1);
                        mesh.renderOrder = 1;
                    }
                }
            }

            // ── Feed Next-Gen F1 Cockpit DDU & Telemetry Analyzer Modules ──
            if (window.f1Ddu) window.f1Ddu.updateDDU(data);
            if (window.f1Analyzer) window.f1Analyzer.pushTelemetrySample(data);
        }

        /* ── Navigation Tab Switcher ── */
        function switchTab(tabId, btn) {
            document.querySelectorAll(".tab-content").forEach(tab => {
                tab.classList.remove("active");
            });
            document.querySelectorAll(".nav-bar .nav-btn").forEach(b => {
                b.classList.remove("active");
            });

            const targetTab = document.getElementById(tabId);
            if (targetTab) {
                targetTab.classList.add("active");
            }
            if (btn) {
                btn.classList.add("active");
            }

            if (tabId === "tab-radar") {
                resizeThreeJS();
            } else if (tabId === "tab-telemetry") {
                if (window.f1Analyzer) window.f1Analyzer.resizeCanvases();
                drawGGraph();
            } else if (tabId === "tab-ddu") {
                if (window.f1Ddu && window.lastTelemetryData) {
                    window.f1Ddu.updateDDU(window.lastTelemetryData);
                }
            } else if (tabId === "tab-session-history" && window.lastTelemetryData) {
                drawPaceChart(window.lastTelemetryData);
                updateRivalComparison(window.lastTelemetryData);
            }
        }

        // Initialize mobile radar view and standby input trace
        setRadarMobileView('map');
        drawInputTrace(0, 0, false, false);

        // Open empty on cold startup - do not auto-load stale tracks until live session or user selection
        setText("track-name", "NO ACTIVE TRACK");

        connectWebSocket();
        window.addEventListener('DOMContentLoaded', () => {
            resizeThreeJS();
            drawGGraph();
        });
        window.addEventListener('resize', () => {
            const paceTab = document.getElementById("tab-session-history");
            if (paceTab && paceTab.classList.contains("active") && window.lastTelemetryData) {
                drawPaceChart(window.lastTelemetryData);
            }
        });