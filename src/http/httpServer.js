const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { telemetryDir, lapTimeDir, fastestJsonPath } = require('../config');
const gameState = require('../state/gameState');
const { generateSessionExportJson, getAvailableTelemetryTracks } = require('../services/storageService');
const { getAllHtmlFiles, renderHtmlDirectoryPage, resolveRequestedFile, MIME_TYPES } = require('../services/staticHandler');
const { syncTrackLinesForTrack } = require('../services/trackService');
const { broadcast } = require('../websocket/wsServer');

function createHttpServer() {
    const server = http.createServer((req, res) => {
        const rawUrl = req.url || "/";
        const reqUrl = rawUrl.split('?')[0];
        const { state, allTimeFastest, lastLapTelemetry, currentLapTelemetry, carDataTracker } = gameState;

        // Export complete session data in JSON format
        if (reqUrl === "/api/session/export" || reqUrl === "/api/session-data" || reqUrl === "/download-session-json") {
            const exportData = generateSessionExportJson();
            const cleanTrack = (state.session.trackName || "track").replace(/[^a-zA-Z0-9_-]/g, "_");
            const cleanSession = (state.session.type || "session").replace(/[^a-zA-Z0-9_-]/g, "_");
            const filename = `f1_session_${cleanTrack}_${cleanSession}_${Date.now()}.json`;

            res.writeHead(200, {
                "Content-Type": "application/json",
                "Content-Disposition": `attachment; filename="${filename}"`,
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify(exportData, null, 2));
            return;
        }

        // API endpoint returning all available telemetry track recordings
        if (reqUrl === "/api/tracks" || reqUrl === "/api/telemetry/tracks" || reqUrl === "/api/telemetry-tracks") {
            const trackList = getAvailableTelemetryTracks();
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify({ count: trackList.length, tracks: trackList }, null, 2));
            return;
        }

        // API endpoint returning all discovered HTML dashboards and pages
        if (reqUrl === "/api/pages" || reqUrl === "/api/html-files" || reqUrl === "/api/dashboards") {
            const pages = getAllHtmlFiles();
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify({ count: pages.length, pages: pages }, null, 2));
            return;
        }

        // Dashboard Hub Page listing all available HTML files
        if (reqUrl === "/pages" || reqUrl === "/hub" || reqUrl === "/dashboards" || reqUrl === "/list") {
            const hubHtml = renderHtmlDirectoryPage("F1 Telemetry Dashboard Hub", 200);
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(hubHtml);
            return;
        }

        // API endpoint returning all lap time records and fastest files
        if (reqUrl === "/api/laptimes" || reqUrl === "/api/laptime/fastest" || reqUrl === "/api/records") {
            let fastestRecords = { ...allTimeFastest };
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify({ count: Object.keys(fastestRecords).length, records: fastestRecords }, null, 2));
            return;
        }

        // API endpoint to trigger sector line sync from telemetry for a track
        if (reqUrl.startsWith("/api/sync-track-lines") || reqUrl.startsWith("/api/sync-sectors")) {
            const urlParams = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`).searchParams;
            const trackIdParam = urlParams.get('trackId') || urlParams.get('id');
            const tId = trackIdParam ? parseInt(trackIdParam, 10) : gameState.currentTrackId;

            const result = syncTrackLinesForTrack(tId, false, broadcast);
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify({
                success: !!result,
                trackId: tId,
                data: result || null,
                message: result ? `Track lines synced successfully for Track ${tId}` : `No telemetry found for Track ${tId}`
            }, null, 2));
            return;
        }

        // API endpoint to safely and properly store telemetry for the current/selected track
        if (reqUrl.startsWith("/api/save-telemetry")) {
            const urlParams = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`).searchParams;
            const trackIdParam = urlParams.get('trackId') || urlParams.get('id');
            const tId = trackIdParam ? parseInt(trackIdParam, 10) : gameState.currentTrackId;

            if (tId === -1) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: false, message: "No active track selected" }));
                return;
            }

            const pIdx = state.playerIndex || 0;
            let sourceTelemetry = (lastLapTelemetry[pIdx] && lastLapTelemetry[pIdx].length >= 50)
                ? lastLapTelemetry[pIdx]
                : (currentLapTelemetry[pIdx] || []);

            let cleanTelemetry = sourceTelemetry
                .filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.z) && (pt.x !== 0 || pt.z !== 0));

            if (cleanTelemetry.length < 50) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: false, message: `Insufficient telemetry points to save (${cleanTelemetry.length} pts found, min 50 required)` }));
                return;
            }

            cleanTelemetry.sort((a, b) => (a.d !== undefined && b.d !== undefined) ? a.d - b.d : a.t - b.t);

            // Ensure clean starting point
            if (cleanTelemetry[0].d > 0) {
                cleanTelemetry.unshift({
                    ...cleanTelemetry[0],
                    d: 0,
                    t: 0
                });
            }

            const trackLen = state.session.trackLength > 0 ? state.session.trackLength : (cleanTelemetry[cleanTelemetry.length - 1].d || 5000);
            const lastMs = state.lap.lastMs > 0 ? state.lap.lastMs : (cleanTelemetry[cleanTelemetry.length - 1].t || 75000);
            const driverName = (state.participants && state.participants[pIdx]) || "Player";

            const s1Time = carDataTracker[pIdx].bestS1 || carDataTracker[pIdx].s1 || state.session.referenceS1 || 0;
            const s2Time = carDataTracker[pIdx].bestS2 || carDataTracker[pIdx].s2 || state.session.referenceS2 || 0;
            const s3Time = (lastMs > 0 && s1Time > 0 && s2Time > 0) ? Math.max(0, lastMs - (s1Time + s2Time)) : 0;

            // Save telemetry files
            const telPath = path.join(telemetryDir, `telemetry_${tId}.json`);
            const ghostPath = path.join(lapTimeDir, `fastest_${tId}.json`);

            fs.writeFileSync(telPath, JSON.stringify(cleanTelemetry, null, 2), 'utf8');
            fs.writeFileSync(ghostPath, JSON.stringify(cleanTelemetry.map(p => ({ d: p.d, t: p.t }))), 'utf8');

            allTimeFastest[tId] = {
                time: lastMs,
                driver: driverName,
                s1: s1Time,
                s2: s2Time,
                s3: s3Time,
                hasTelemetry: true
            };
            fs.writeFileSync(fastestJsonPath, JSON.stringify(allTimeFastest, null, 2), 'utf8');

            // Sync track sector lines using the official sector times
            const syncedLines = syncTrackLinesForTrack(tId, false, broadcast);

            console.log(`💾 Properly stored telemetry for Track ${tId} (${cleanTelemetry.length} pts, Driver: ${driverName}, Lap: ${lastMs}ms)`);

            res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
            res.end(JSON.stringify({
                success: true,
                trackId: tId,
                points: cleanTelemetry.length,
                lapTimeMs: lastMs,
                driver: driverName,
                syncedLines: syncedLines || null,
                message: `Telemetry and sector lines saved successfully for Track ${tId}`
            }, null, 2));
            return;
        }

        // Resolve any requested path to a matching file in root or subdirectories
        const targetFilePath = resolveRequestedFile(rawUrl);

        if (!targetFilePath) {
            // If an HTML client navigated to a non-existent page, show the hub directory
            const accept = req.headers['accept'] || '';
            if (accept.includes('text/html') || !path.extname(reqUrl)) {
                const notFoundHtml = renderHtmlDirectoryPage("404 - Page Not Found", 404);
                res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
                res.end(notFoundHtml);
                return;
            }

            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("File not found");
            return;
        }

        const ext = path.extname(targetFilePath).toLowerCase();

        fs.readFile(targetFilePath, (err, data) => {
            if (err) {
                res.writeHead(404, { "Content-Type": "text/plain" });
                res.end("File not found");
                return;
            }

            let responseData = data;
            // User customization check for index.html
            if (targetFilePath.endsWith("index.html")) {
                try {
                    if (os.userInfo().username === "gokul") {
                        let htmlContent = data.toString("utf8");
                        htmlContent = htmlContent.replace('<footer', '<footer hidden ');
                        responseData = Buffer.from(htmlContent, "utf8");
                    }
                } catch (e) { }
            }

            res.writeHead(200, {
                "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
                "Access-Control-Allow-Origin": "*"
            });

            res.end(responseData);
        });
    });

    server.on('error', (err) => {
        console.error('🛡️ [HTTP Server Error]:', err?.message || err);
    });

    return server;
}

module.exports = {
    createHttpServer
};
