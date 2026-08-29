// --- Process Crash Guards ---
process.on('uncaughtException', (err, origin) => {
    console.error('🛡️ [Process Guard] Uncaught Exception:', err?.message || err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🛡️ [Process Guard] Unhandled Rejection:', reason);
});

// --- Imports and Configuration ---
const { F1TelemetryClient } = require('@deltazeroproduction/f1-udp-parser');
const WebSocket = require('ws');
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = 3000;

// Parse the tick rate from command line arguments (default: 20Hz)
const args = process.argv.slice(2);
let hz = parseInt(args[0], 10);
const validHz = [10, 20, 30, 60];
if (!validHz.includes(hz)) {
    hz = 20;
}
const intervalMs = Math.round(1000 / hz);

// --- File System Initialization ---
// Ensure required directories exist for storing track data and ghost laps
const trackMapsDir = path.join(__dirname, 'track_maps');
if (!fs.existsSync(trackMapsDir)) {
    fs.mkdirSync(trackMapsDir);
    console.log('📁 Created track_maps directory for saving circuits.');
}

const lapTimeDir = path.join(__dirname, 'laptime');
if (!fs.existsSync(lapTimeDir)) {
    fs.mkdirSync(lapTimeDir);
    console.log('📁 Created laptime directory for saving track records.');
}

const telemetryDir = path.join(__dirname, 'telemetry');
if (!fs.existsSync(telemetryDir)) {
    fs.mkdirSync(telemetryDir);
    console.log('📁 Created telemetry directory for full lap data.');
}

const setupsDir = path.join(__dirname, 'setups');
if (!fs.existsSync(setupsDir)) {
    fs.mkdirSync(setupsDir);
    console.log('📁 Created setups directory for car setups.');
}

/**
 * Safe JSON file writer that catches Windows file locking (EBUSY / EPERM / UNKNOWN) errors.
 */
function safeWriteJson(filePath, data, pretty = false) {
    try {
        const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
        fs.writeFileSync(filePath, content, 'utf8');
    } catch (err) {
        console.warn(`⚠️ [SafeWrite] Skipped ${path.basename(filePath)} (${err.message})`);
    }
}

/**
 * Saves a track map JSON safely, ensuring existing trackPoints are never overwritten with empty arrays.
 */
function safeSaveTrackMap(filePath, data) {
    if (!filePath || !data) return;
    let pts = data.trackPoints;
    // An authentic F1 track contains at least 50 points. Never overwrite a mapped circuit with partial data!
    if (!Array.isArray(pts) || pts.length < 50) {
        if (fs.existsSync(filePath)) {
            try {
                const raw = fs.readFileSync(filePath, 'utf8').trim();
                if (raw && raw.length > 2) {
                    const existing = JSON.parse(raw);
                    const existingPts = Array.isArray(existing) ? existing : (existing.trackPoints || []);
                    if (existingPts.length >= 50) {
                        data.trackPoints = existingPts;
                    }
                }
            } catch (e) { }
        }
    }
    if (data.trackPoints && data.trackPoints.length >= 20) {
        safeWriteJson(filePath, data);
    }
}

let allTimeFastest = {};
const fastestJsonPath = path.join(lapTimeDir, 'fastest.json');

if (fs.existsSync(fastestJsonPath)) {
    try {
        allTimeFastest = JSON.parse(fs.readFileSync(fastestJsonPath, 'utf8'));
    } catch (e) {
        console.error('⚠️ Error reading fastest.json:', e);
    }
}

// --- G-Force Processing (In-Memory Only) ---
let gForceData = {
    maxGSeen: 0,
    envelopeArray: [],
    history: []
};
const gEnvelopeSetServer = new Set();
const MAX_REASONABLE_SENSOR_G_SERVER = 8;
const MAX_ENVELOPE_POINTS_SERVER = 30;

function processServerGForce(gLat, gLong, gVert) {
    if (gLat === 0 && gLong === 0 && gVert === 0) return;
    const sensorG = Math.hypot(gLat, gLong, gVert);
    if (sensorG > MAX_REASONABLE_SENSOR_G_SERVER) return;

    if (sensorG > gForceData.maxGSeen) {
        gForceData.maxGSeen = sensorG;
    }

    const qLat = Math.round(gLat * 10) / 10;
    const qLong = Math.round(gLong * 10) / 10;
    const key = `${qLat},${qLong}`;

    if (!gEnvelopeSetServer.has(key)) {
        gEnvelopeSetServer.add(key);
        gForceData.envelopeArray.push({ lat: qLat, long: qLong });
        if (gForceData.envelopeArray.length > MAX_ENVELOPE_POINTS_SERVER) {
            const removed = gForceData.envelopeArray.shift();
            if (removed) gEnvelopeSetServer.delete(`${removed.lat},${removed.long}`);
        }
    }

    gForceData.history.push({ lat: gLat, long: gLong, total: sensorG });
    if (gForceData.history.length > 30) {
        gForceData.history.shift();
    }
}

// --- HTML File Discovery & Static Assets Handler ---
const IGNORED_SCAN_DIRS = new Set(['node_modules', '.git', '.agents', 'telemetry', 'track_maps', 'laptime', 'setups']);

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".txt": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".pdf": "application/pdf",
    ".wasm": "application/wasm"
};

/**
 * Extracts document <title> if present, or formats a clean human-readable name.
 */
function extractHtmlTitle(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const match = content.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (match && match[1] && match[1].trim()) {
            return match[1].trim();
        }
    } catch (e) { }
    const base = path.basename(filePath, '.html');
    return base.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Recursively scans project directories for all .html files.
 */
function getAllHtmlFiles(dir = __dirname, relPrefix = '') {
    let results = [];
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (IGNORED_SCAN_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
                const subDir = path.join(dir, entry.name);
                const subPrefix = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
                results = results.concat(getAllHtmlFiles(subDir, subPrefix));
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
                const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
                const fullPath = path.join(dir, entry.name);
                const urlPath = '/' + relPath.replace(/\\/g, '/');
                results.push({
                    name: entry.name,
                    title: extractHtmlTitle(fullPath),
                    relPath: relPath.replace(/\\/g, '/'),
                    urlPath: urlPath,
                    fullPath: fullPath,
                    isRoot: !relPrefix
                });
            }
        }
    } catch (e) {
        console.error('⚠️ [HTML Scanner Error]:', e.message);
    }
    return results;
}

/**
 * Resolves any incoming request URL to a concrete file on disk:
 * 1. Direct path / subfolder path (/ghost_car/f1_ghost_sim.html)
 * 2. Extensionless path (/training -> training.html)
 * 3. Folder request (/ghost_car/ -> ghost_car/f1_ghost_sim.html)
 * 4. Basename search anywhere in project (/f1_ghost_sim.html -> ghost_car/f1_ghost_sim.html)
 */
function resolveRequestedFile(reqUrl) {
    let cleanUrl = reqUrl.split('?')[0];
    try {
        cleanUrl = decodeURIComponent(cleanUrl);
    } catch (e) { }

    if (cleanUrl === '/' || cleanUrl === '') {
        const indexPath = path.join(__dirname, 'index.html');
        return fs.existsSync(indexPath) ? indexPath : null;
    }

    const relPath = cleanUrl.startsWith('/') ? cleanUrl.slice(1) : cleanUrl;
    const directPath = path.resolve(__dirname, relPath);

    // Security: Do not allow directory traversal outside project root
    if (!directPath.startsWith(__dirname)) return null;

    // 1. Direct file match
    if (fs.existsSync(directPath)) {
        try {
            const stat = fs.statSync(directPath);
            if (stat.isFile()) return directPath;
            if (stat.isDirectory()) {
                const indexCandidate = path.join(directPath, 'index.html');
                if (fs.existsSync(indexCandidate)) return indexCandidate;
                const dirFiles = fs.readdirSync(directPath);
                const htmlInDir = dirFiles.find(f => f.toLowerCase().endsWith('.html'));
                if (htmlInDir) return path.join(directPath, htmlInDir);
            }
        } catch (e) { }
    }

    // 2. Extensionless .html match (e.g., /training -> training.html)
    const withHtmlExt = directPath + '.html';
    if (fs.existsSync(withHtmlExt)) {
        try {
            if (fs.statSync(withHtmlExt).isFile()) return withHtmlExt;
        } catch (e) { }
    }

    // 3. Global Project HTML Search (by basename or slug anywhere in subfolders)
    const reqBase = path.basename(cleanUrl).toLowerCase();
    const reqBaseNoExt = reqBase.replace(/\.html$/i, '');
    const allHtml = getAllHtmlFiles();
    const match = allHtml.find(f => {
        const fBase = f.name.toLowerCase();
        const fBaseNoExt = fBase.replace(/\.html$/i, '');
        return fBase === reqBase || fBaseNoExt === reqBaseNoExt;
    });

    if (match) return match.fullPath;

    return null;
}

/**
 * Generates an interactive, dark-themed F1 Telemetry Hub page listing all available HTML dashboards.
 */
function renderHtmlDirectoryPage(statusTitle = "F1 Telemetry Dashboard Hub", statusCode = 200) {
    const allPages = getAllHtmlFiles();
    const itemsHtml = allPages.map(page => `
        <div class="card">
            <div class="card-header">
                <div class="badge ${page.isRoot ? 'badge-root' : 'badge-sub'}">${page.isRoot ? 'ROOT' : page.relPath.split('/')[0].toUpperCase()}</div>
                <span class="file-name">${page.name}</span>
            </div>
            <h2 class="page-title">${page.title}</h2>
            <div class="path-info"><code>${page.urlPath}</code></div>
            <a href="${page.urlPath}" class="launch-btn">
                <span>Launch Dashboard</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </a>
        </div>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${statusTitle}</title>
    <style>
        :root {
            --bg-main: #0a0c10;
            --bg-card: #121620;
            --bg-card-hover: #181e2b;
            --border-color: #242c3d;
            --accent-red: #e10600;
            --accent-glow: rgba(225, 6, 0, 0.35);
            --text-main: #f0f4f8;
            --text-muted: #8c9ba5;
            --accent-cyan: #00d2be;
            --font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background-color: var(--bg-main);
            color: var(--text-main);
            font-family: var(--font-family);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 40px 20px;
        }
        .container {
            width: 100%;
            max-width: 960px;
        }
        .header {
            text-align: center;
            margin-bottom: 36px;
        }
        .logo-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: rgba(225, 6, 0, 0.15);
            border: 1px solid var(--accent-red);
            color: #ff4d4d;
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 0.82rem;
            font-weight: 700;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            margin-bottom: 12px;
        }
        h1 {
            font-size: 2.2rem;
            font-weight: 800;
            letter-spacing: -0.5px;
            margin-bottom: 10px;
            background: linear-gradient(135deg, #ffffff 40%, #8c9ba5 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        p.subtitle {
            color: var(--text-muted);
            font-size: 1rem;
        }
        .search-bar {
            margin-bottom: 28px;
            position: relative;
        }
        .search-input {
            width: 100%;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 14px 18px;
            font-size: 1rem;
            color: #fff;
            outline: none;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .search-input:focus {
            border-color: var(--accent-cyan);
            box-shadow: 0 0 15px rgba(0, 210, 190, 0.2);
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 20px;
        }
        .card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 14px;
            padding: 22px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            transition: transform 0.2s, border-color 0.2s, background-color 0.2s;
        }
        .card:hover {
            transform: translateY(-3px);
            border-color: var(--accent-red);
            background: var(--bg-card-hover);
            box-shadow: 0 8px 24px var(--accent-glow);
        }
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        .badge {
            font-size: 0.7rem;
            font-weight: 700;
            padding: 3px 8px;
            border-radius: 6px;
            letter-spacing: 0.5px;
        }
        .badge-root {
            background: rgba(0, 210, 190, 0.15);
            color: var(--accent-cyan);
            border: 1px solid rgba(0, 210, 190, 0.4);
        }
        .badge-sub {
            background: rgba(255, 193, 7, 0.15);
            color: #ffc107;
            border: 1px solid rgba(255, 193, 7, 0.4);
        }
        .file-name {
            font-size: 0.8rem;
            color: var(--text-muted);
            font-family: monospace;
        }
        .page-title {
            font-size: 1.15rem;
            font-weight: 700;
            color: #fff;
            margin-bottom: 12px;
            line-height: 1.35;
        }
        .path-info {
            margin-bottom: 20px;
        }
        .path-info code {
            font-size: 0.82rem;
            background: rgba(0,0,0,0.35);
            padding: 4px 8px;
            border-radius: 6px;
            color: #79c0ff;
            word-break: break-all;
        }
        .launch-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            background: linear-gradient(135deg, var(--accent-red), #b30000);
            color: #fff;
            text-decoration: none;
            font-weight: 700;
            font-size: 0.9rem;
            padding: 10px 16px;
            border-radius: 8px;
            transition: opacity 0.2s, transform 0.1s;
        }
        .launch-btn:hover {
            opacity: 0.92;
            transform: scale(1.02);
        }
        .footer {
            margin-top: 40px;
            text-align: center;
            color: var(--text-muted);
            font-size: 0.85rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo-badge">🏎️ F1 UDP Telemetry Hub</div>
            <h1>${statusTitle}</h1>
            <p class="subtitle">Select and run any HTML dashboard or simulation page in this workspace.</p>
        </div>
        <div class="search-bar">
            <input type="text" class="search-input" id="filterInput" placeholder="Filter dashboards (e.g., training, ghost, index)..." oninput="filterCards()">
        </div>
        <div class="grid" id="cardsGrid">
            ${itemsHtml}
        </div>
        <div class="footer">
            F1 Unified Command Center &bull; Port ${PORT} (${hz}Hz Live Feed)
        </div>
    </div>
    <script>
        function filterCards() {
            const query = document.getElementById('filterInput').value.toLowerCase();
            const cards = document.querySelectorAll('.card');
            cards.forEach(card => {
                const text = card.innerText.toLowerCase();
                card.style.display = text.includes(query) ? 'flex' : 'none';
            });
        }
    </script>
</body>
</html>`;
}

/**
 * Scans telemetry, laptime records, and track maps to return a complete list of all available circuits.
 */
function getAvailableTelemetryTracks() {
    let trackMapList = new Map();

    // Helper to get or init circuit entry
    function getOrCreate(trackId) {
        const id = parseInt(trackId, 10);
        if (!trackMapList.has(id)) {
            const name = (typeof trackMap !== 'undefined' && trackMap[id]) ? trackMap[id] : `Track ${id}`;
            const record = allTimeFastest[id] || null;
            trackMapList.set(id, {
                id: id,
                name: name,
                file: `telemetry_${id}.json`,
                url: `/telemetry/telemetry_${id}.json`,
                sizeBytes: 0,
                points: 0,
                lapTimeMs: record ? record.time : null,
                driver: record ? record.driver : 'Unknown',
                hasTelemetry: false,
                hasLaptime: false,
                hasTrackMap: false
            });
        }
        return trackMapList.get(id);
    }

    // 1. Scan telemetry directory
    try {
        if (fs.existsSync(telemetryDir)) {
            const files = fs.readdirSync(telemetryDir);
            for (const file of files) {
                const match = file.match(/^telemetry_(\d+)\.json$/i);
                if (match) {
                    const trackId = parseInt(match[1], 10);
                    const item = getOrCreate(trackId);
                    const filePath = path.join(telemetryDir, file);
                    try {
                        const stat = fs.statSync(filePath);
                        item.sizeBytes = stat.size;
                        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        if (Array.isArray(content) && content.length > 0) {
                            item.points = content.length;
                            item.hasTelemetry = true;
                            if (!item.lapTimeMs && content[content.length - 1].t > 0) {
                                item.lapTimeMs = content[content.length - 1].t;
                            }
                        }
                    } catch (e) {}
                }
            }
        }
    } catch (e) {
        console.error('⚠️ [Telemetry Tracks Error]:', e.message);
    }

    // 2. Scan laptime directory
    try {
        if (fs.existsSync(lapTimeDir)) {
            const files = fs.readdirSync(lapTimeDir);
            for (const file of files) {
                const match = file.match(/^fastest_(\d+)\.json$/i);
                if (match) {
                    const trackId = parseInt(match[1], 10);
                    const item = getOrCreate(trackId);
                    item.hasLaptime = true;
                    item.laptimeUrl = `/laptime/${file}`;
                    if (!item.lapTimeMs) {
                        try {
                            const raw = JSON.parse(fs.readFileSync(path.join(lapTimeDir, file), 'utf8'));
                            const pts = Array.isArray(raw) ? raw : (raw.telemetry || []);
                            if (pts.length > 0 && pts[pts.length - 1].t > 0) {
                                item.lapTimeMs = pts[pts.length - 1].t;
                            }
                        } catch (e) {}
                    }
                }
            }
        }
    } catch (e) {}

    // 3. Scan track_maps directory
    try {
        if (fs.existsSync(trackMapsDir)) {
            const files = fs.readdirSync(trackMapsDir);
            for (const file of files) {
                const match = file.match(/^track_(\d+)\.json$/i);
                if (match) {
                    const trackId = parseInt(match[1], 10);
                    const item = getOrCreate(trackId);
                    item.hasTrackMap = true;
                    item.trackMapUrl = `/track_maps/${file}`;
                }
            }
        }
    } catch (e) {}

    // 4. Incorporate all records from allTimeFastest
    for (const [tIdStr, rec] of Object.entries(allTimeFastest)) {
        const item = getOrCreate(tIdStr);
        if (rec) {
            item.lapTimeMs = rec.time || item.lapTimeMs;
            item.driver = rec.driver || item.driver;
            if (rec.hasTelemetry) item.hasTelemetry = true;
        }
    }

    const tracks = Array.from(trackMapList.values());
    tracks.sort((a, b) => a.name.localeCompare(b.name));
    return tracks;
}

// --- HTTP Server ---
// Serves any HTML file, static assets, dynamic hub page, and JSON session export endpoints
const server = http.createServer((req, res) => {
    const rawUrl = req.url || "/";
    const reqUrl = rawUrl.split('?')[0];

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
        const tId = trackIdParam ? parseInt(trackIdParam, 10) : currentTrackId;

        const result = syncTrackLinesForTrack(tId);
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
        const tId = trackIdParam ? parseInt(trackIdParam, 10) : currentTrackId;

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
        const syncedLines = syncTrackLinesForTrack(tId);

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

function formatMsExport(ms) {
    if (!ms || ms <= 0 || ms === Infinity) return '--:--.---';
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    const millis = ms % 1000;
    return `${mins}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

function formatSectorMs(ms) {
    if (!ms || ms <= 0 || ms === Infinity) return '--.---';
    return (ms / 1000).toFixed(3);
}

/**
 * Builds a structured, complete, exhaustive JSON snapshot of all session data:
 * - Every lap with sector 1, sector 2, sector 3 times and validation flags for all 22 cars
 * - Flat lap-by-lap table for easy data science / CSV export
 * - Tyre stint strategies
 * - Full 20Hz telemetry traces (speed, throttle, brake, gears, RPM, DRS, distance, G-forces)
 * - Complete setup, damage, steward offenses, track geometry, and weather forecasts.
 */
function generateSessionExportJson() {
    const pIdx = state.playerIndex || 0;
    const cleanSessionName = state.session.type || 'Unknown';
    const cleanTrackName = state.session.trackName || 'Unknown';

    // Detailed Lap History with Sector Breakdown per Driver
    const detailedLapsByDriver = {};
    const allLapsFlatTable = [];

    for (let carIdx = 0; carIdx < 22; carIdx++) {
        const driverName = (state.participants && state.participants[carIdx]) ? state.participants[carIdx] : `Car ${carIdx}`;
        const tracker = carDataTracker[carIdx] || {};
        const rawLaps = allLapHistories[carIdx] || [];
        const stints = allTyreStints[carIdx] || [];

        const processedLaps = rawLaps.map((lap, index) => {
            const lapNum = index + 1;
            const validFlags = lap.validFlags !== undefined ? lap.validFlags : 0x0F;
            const isValid = (validFlags & 0x01) !== 0;
            const isValidS1 = (validFlags & 0x02) !== 0;
            const isValidS2 = (validFlags & 0x04) !== 0;
            const isValidS3 = (validFlags & 0x08) !== 0;

            const lapObj = {
                lapNumber: lapNum,
                lapTimeMs: lap.lapTime || 0,
                lapTimeFormatted: formatMsExport(lap.lapTime),
                sector1Ms: lap.s1 || 0,
                sector1Formatted: formatSectorMs(lap.s1),
                sector2Ms: lap.s2 || 0,
                sector2Formatted: formatSectorMs(lap.s2),
                sector3Ms: lap.s3 || 0,
                sector3Formatted: formatSectorMs(lap.s3),
                isValidLap: isValid,
                isValidSector1: isValidS1,
                isValidSector2: isValidS2,
                isValidSector3: isValidS3,
                isPersonalBest: tracker.bestLapMs > 0 && lap.lapTime === tracker.bestLapMs,
                isSessionBest: state.session.sessionFastestLapMs > 0 && lap.lapTime === state.session.sessionFastestLapMs
            };

            // Add to flat table for analytics
            if (lap.lapTime > 0 || lap.s1 > 0 || lap.s2 > 0 || lap.s3 > 0) {
                allLapsFlatTable.push({
                    carIndex: carIdx,
                    driverName: driverName,
                    teamName: tracker.teamName || 'Unknown',
                    ...lapObj
                });
            }

            return lapObj;
        });

        detailedLapsByDriver[carIdx] = {
            carIndex: carIdx,
            driverName: driverName,
            teamName: tracker.teamName || 'Unknown',
            teamColor: tracker.teamColor || '#FFF',
            currentPosition: tracker.pos || 0,
            totalLapsCompleted: rawLaps.length,
            bestLapMs: tracker.bestLapMs || 0,
            bestLapFormatted: formatMsExport(tracker.bestLapMs),
            bestS1Ms: tracker.bestS1 || 0,
            bestS1Formatted: formatSectorMs(tracker.bestS1),
            bestS2Ms: tracker.bestS2 || 0,
            bestS2Formatted: formatSectorMs(tracker.bestS2),
            bestS3Ms: tracker.bestS3 || 0,
            bestS3Formatted: formatSectorMs(tracker.bestS3),
            // Current car state snapshot for this driver
            currentCarState: {
                tyreCompound: tracker.tyre || 'UNK',
                tyreCompoundColor: tracker.tyreClass || '#808080',
                tyreAge: carIdx === state.playerIndex ? state.car.tyreAge : null,
                penalties: tracker.penalties || 0,
                warnings: tracker.warnings || 0,
                pitStatus: tracker.pitStatus || 0,
                driverStatus: tracker.driverStatus || 0,
                maxSpeedKmh: tracker.maxSpeed || 0,
                // Full tyre wear, temps, pressures only available for player car from UDP
                ...(carIdx === state.playerIndex ? {
                    tyreWear: { fl: state.car.wear.fl, fr: state.car.wear.fr, rl: state.car.wear.rl, rr: state.car.wear.rr },
                    tyreSurfaceTempC: { fl: state.car.surfTemp.fl, fr: state.car.surfTemp.fr, rl: state.car.surfTemp.rl, rr: state.car.surfTemp.rr },
                    tyreInnerTempC: { fl: state.car.inTemp.fl, fr: state.car.inTemp.fr, rl: state.car.inTemp.rl, rr: state.car.inTemp.rr },
                    tyrePressurePsi: { fl: state.car.press.fl, fr: state.car.press.fr, rl: state.car.press.rl, rr: state.car.press.rr },
                    brakeTempC: { fl: state.car.brakeTemp.fl, fr: state.car.brakeTemp.fr, rl: state.car.brakeTemp.rl, rr: state.car.brakeTemp.rr },
                    engineTempC: state.car.engineTemp,
                    ersMode: state.ers.mode,
                    ersBatteryPct: state.ers.battery,
                    fuelMassKg: state.setup.fuel,
                    fuelRemainingLaps: state.setup.fuelLaps,
                    damage: state.damage ? {
                        frontWingDamage: state.damage.m_frontLeftWingDamage ?? state.damage.m_frontWingDamage ?? null,
                        rearWingDamage: state.damage.m_rearWingDamage ?? null,
                        floorDamage: state.damage.m_floorDamage ?? null,
                        diffuserDamage: state.damage.m_diffuserDamage ?? null,
                        sidepodDamage: state.damage.m_sidepodDamage ?? null,
                        drsFault: state.damage.m_drsFault ?? null,
                        ersFault: state.damage.m_ersFault ?? null,
                        gearboxDamage: state.damage.m_gearBoxDamage ?? null,
                        engineDamage: state.damage.m_engineDamage ?? null,
                        engineMGUHWear: state.damage.m_engineMGUHWear ?? null,
                        engineESWear: state.damage.m_engineESWear ?? null,
                        engineCEWear: state.damage.m_engineCEWear ?? null,
                        engineICEWear: state.damage.m_engineICEWear ?? null,
                        engineMGUKWear: state.damage.m_engineMGUKWear ?? null,
                        engineTCWear: state.damage.m_engineTCWear ?? null,
                        tyresWear: state.damage.m_tyresWear ?? null,
                        tyresDamage: state.damage.m_tyresDamage ?? null
                    } : null
                } : {})
            },
            tyreStints: stints,
            laps: processedLaps
        };

    }

    return {
        metadata: {
            title: 'F1 Telemetry Dashboard - Complete Session Data Export',
            exportedAt: new Date().toISOString(),
            exportedTimestamp: Date.now(),
            gameYear: currentGameYear,
            sessionUID: currentSessionUID,
            sessionType: cleanSessionName,
            sessionCategory: state.session.sessionCategory,
            trackId: currentTrackId,
            trackName: cleanTrackName,
            trackLengthMeters: state.session.trackLength,
            raceDistanceMeters: state.session.raceDistance,
            totalLaps: state.session.lapsTotal,
            weather: state.session.weather,
            trackTempCelsius: state.session.trackTemp,
            airTempCelsius: state.session.airTemp,
            pitSpeedLimitKmh: state.session.pitLimit,
            safetyCarStatus: state.session.sc,
            fastestLap: {
                carIndex: state.session.fastestLapCarIndex,
                driver: state.session.sessionFastestDriver || 'None',
                timeMs: state.session.sessionFastestLapMs === Infinity ? 0 : state.session.sessionFastestLapMs,
                timeFormatted: formatMsExport(state.session.sessionFastestLapMs)
            },
            bestSectors: {
                s1Ms: state.session.sessionBestS1 === Infinity ? 0 : state.session.sessionBestS1,
                s1Formatted: formatSectorMs(state.session.sessionBestS1),
                s2Ms: state.session.sessionBestS2 === Infinity ? 0 : state.session.sessionBestS2,
                s2Formatted: formatSectorMs(state.session.sessionBestS2),
                s3Ms: state.session.sessionBestS3 === Infinity ? 0 : state.session.sessionBestS3,
                s3Formatted: formatSectorMs(state.session.sessionBestS3)
            },
            allTimeTrackRecord: {
                driver: state.session.allTimeFastestDriver,
                timeMs: state.session.allTimeFastestLapMs === Infinity ? 0 : state.session.allTimeFastestLapMs,
                timeFormatted: formatMsExport(state.session.allTimeFastestLapMs)
            }
        },
        participants: state.participants || [],
        leaderboard: state.leaderboard || [],
        detailedLapsByDriver: detailedLapsByDriver,
        allLapsFlatTable: allLapsFlatTable,
        tyreStintsByDriver: allTyreStints,
        rawLapHistories: allLapHistories || {},
        player: {
            playerIndex: pIdx,
            driverName: (state.participants && state.participants[pIdx]) ? state.participants[pIdx] : `Player (Car ${pIdx})`,
            lap: state.lap,
            penalties: state.penalties,
            inputs: state.inputs,
            car: state.car,
            setup: state.setup,
            ers: state.ers,
            damage: state.damage,
            motion: {
                pitch: state.motion.pitch,
                roll: state.motion.roll,
                gLat: state.motion.gLat,
                gLong: state.motion.gLong,
                gVert: state.motion.gVert,
                maxGSeen: state.motion.maxGSeen,
                susp: state.motion.susp,
                gEnvelopeArray: state.motion.gEnvelopeArray,
                gHistory: state.motion.gHistory
            }
        },
        allCarsTracking: carDataTracker,
        physics: carPhysics,
        trackData: {
            trackPoints: state.trackPoints,
            pitLanePoints: state.pitLanePoints,
            startLine: state.startLine,
            sector1: state.sector1,
            sector2: state.sector2,
            customSectorLines: state.customSectorLines
        },
        weatherForecast: state.weatherForecast || [],
        ghostLapTelemetry: fastestLapGhostData || [],
        playerLastLapTelemetry: lastLapTelemetry[pIdx] || [],
        playerCurrentLapTelemetry: currentLapTelemetry[pIdx] || [],
        allCarsCurrentLapTelemetry: currentLapTelemetry,
        allCarsLastLapTelemetry: lastLapTelemetry
    };
}



function abs_diff(a, b) { return Math.abs((a || 0) - (b || 0)); }

let clients = [];
let trackPointsDirty = true;
let lapHistoryDirty = true;
let broadcastTick = 0;

/**
 * Official F1 Track Sector Distance Catalog (in metres).
 * Represents the official FIA timing line locations along the circuit.
 */
const OFFICIAL_TRACK_SECTOR_DISTANCES = {
    0:  { s1: 1720, s2: 3680, len: 5278 }, // Melbourne (Albert Park)
    2:  { s1: 1418, s2: 2985, len: 5451 }, // Shanghai
    3:  { s1: 1800, s2: 4001, len: 5412 }, // Sakhir (Bahrain)
    4:  { s1: 1512, s2: 3194, len: 4657 }, // Catalunya (Barcelona)
    5:  { s1: 1098, s2: 2190, len: 3337 }, // Monaco
    6:  { s1: 1450, s2: 3100, len: 4361 }, // Montreal (Circuit Gilles Villeneuve)
    7:  { s1: 1750, s2: 3980, len: 5891 }, // Silverstone
    9:  { s1: 1268, s2: 2953, len: 4381 }, // Hungaroring
    10: { s1: 2323, s2: 5150, len: 7004 }, // Spa-Francorchamps
    11: { s1: 1898, s2: 3726, len: 5793 }, // Monza
    12: { s1: 1464, s2: 3133, len: 4940 }, // Singapore (Marina Bay)
    13: { s1: 1820, s2: 4120, len: 5807 }, // Suzuka
    14: { s1: 1420, s2: 3450, len: 5281 }, // Abu Dhabi (Yas Marina)
    15: { s1: 1661, s2: 3923, len: 5513 }, // Circuit of the Americas (Austin)
    16: { s1: 1215.4, s2: 3160.7, len: 4294 }, // Interlagos (Brazil)
    17: { s1: 1209, s2: 2913, len: 4318 }, // Red Bull Ring (Austria)
    19: { s1: 2038, s2: 3592, len: 4304 }, // Mexico (Autodromo Hermanos Rodriguez)
    20: { s1: 1880, s2: 4150, len: 6003 }, // Baku
    26: { s1: 1290, s2: 2850, len: 4259 }, // Zandvoort
    27: { s1: 1660, s2: 3520, len: 4909 }, // Imola
    29: { s1: 1890, s2: 4210, len: 6174 }, // Jeddah
    30: { s1: 1750, s2: 3850, len: 5412 }, // Miami
    31: { s1: 1950, s2: 4650, len: 6201 }, // Las Vegas
    32: { s1: 1680, s2: 3720, len: 5419 }, // Losail (Qatar)
    42: { s1: 1215, s2: 3162, len: 5474 }  // Madrid
};

/**
 * Extracts a coordinate from recorded telemetry by EXACT DISTANCE along the track.
 * Linearly interpolates coordinates and yaw between adjacent points.
 */
function extractCoordinateFromTelemetryByDistance(telemetry, targetDistance) {
    if (!telemetry || telemetry.length === 0 || targetDistance === undefined || targetDistance === null || targetDistance < 0) return null;
    if (targetDistance === 0) {
        const d0Candidate = telemetry.find(pt => Math.abs(pt.d || 0) < 60 && (pt.x !== 0 || pt.z !== 0));
        return d0Candidate || telemetry[0];
    }
    let idx = telemetry.findIndex(pt => (pt.d !== undefined ? pt.d : 0) >= targetDistance);
    if (idx === 0) return telemetry[0];
    if (idx > 0) {
        const pt1 = telemetry[idx - 1];
        const pt2 = telemetry[idx];
        const d1 = pt1.d !== undefined ? pt1.d : 0;
        const d2 = pt2.d !== undefined ? pt2.d : 0;
        const rangeD = d2 - d1;
        if (rangeD > 0) {
            const ratio = Math.max(0, Math.min(1, (targetDistance - d1) / rangeD));
            return {
                x: pt1.x + (pt2.x - pt1.x) * ratio,
                z: pt1.z + (pt2.z - pt1.z) * ratio,
                yaw: pt1.yaw !== undefined ? pt1.yaw + (pt2.yaw - pt1.yaw) * ratio : (pt2.yaw || 0),
                d: targetDistance
            };
        }
        return pt2;
    }
    return null;
}

/**
 * Re-synchronizes start line, sector 1, and sector 2 lines for a circuit using EXACT TRACK DISTANCES.
 * Uses official session sector markers from the game engine or the official FIA catalog.
 */
function syncTrackLinesForTrack(tId) {
    if (tId === undefined || tId === null || tId === -1) return null;
    const telPath = path.join(telemetryDir, `telemetry_${tId}.json`);
    const mapPath = path.join(trackMapsDir, `track_${tId}.json`);

    try {
        let telData = [];
        let trackPoints = [];

        // Load recorded lap telemetry if present
        if (fs.existsSync(telPath)) {
            try {
                const rawTel = JSON.parse(fs.readFileSync(telPath, 'utf8'));
                if (Array.isArray(rawTel) && rawTel.length > 10) {
                    telData = rawTel.filter(p => Number.isFinite(p.x) && Number.isFinite(p.z) && (p.x !== 0 || p.z !== 0));
                    telData.sort((a, b) => (a.d !== undefined && b.d !== undefined) ? a.d - b.d : a.t - b.t);
                }
            } catch (e) { }
        }

        // Load track map geometry if present
        if (fs.existsSync(mapPath)) {
            try {
                const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
                trackPoints = Array.isArray(mapData) ? mapData : (mapData.trackPoints || []);
            } catch (e) { }
        }

        // If no telemetry file exists, compute cumulative distances from trackPoints
        if (telData.length < 10) {
            if (trackPoints.length >= 20) {
                let cumulative = 0;
                telData = [{ x: trackPoints[0].x, z: trackPoints[0].z, yaw: 0, d: 0 }];
                for (let i = 1; i < trackPoints.length; i++) {
                    const seg = Math.hypot(trackPoints[i].x - trackPoints[i-1].x, trackPoints[i].z - trackPoints[i-1].z);
                    cumulative += seg;
                    const dx = trackPoints[i].x - trackPoints[i-1].x;
                    const dz = trackPoints[i].z - trackPoints[i-1].z;
                    const yaw = Math.atan2(dx, dz);
                    telData.push({ x: trackPoints[i].x, z: trackPoints[i].z, yaw, d: cumulative });
                }
            } else {
                return null;
            }
        }

        // Total circuit distance
        const totalDist = (telData[telData.length - 1].d > 0)
            ? telData[telData.length - 1].d
            : (state.session.trackLength || 5000);

        // 1. Start line: point closest to d = 0
        const startCandidates = telData.filter(p => Math.abs(p.d || 0) < 150);
        const startLinePt = (startCandidates.length > 0)
            ? startCandidates.reduce((prev, curr) => Math.abs(curr.d || 0) < Math.abs(prev.d || 0) ? curr : prev)
            : telData[0];

        const newStart = {
            x: startLinePt.x,
            z: startLinePt.z,
            yaw: startLinePt.yaw || 0,
            d: startLinePt.d || 0
        };

        // Determine exact sector distances in metres
        let targetS1Distance = null;
        let targetS2Distance = null;

        // Priority 1: Live official sector distance from game engine (PacketSessionData) if track matches
        if (tId === currentTrackId && state.session.sector2Distance > 100 && state.session.sector3Distance > state.session.sector2Distance) {
            targetS1Distance = state.session.sector2Distance;
            targetS2Distance = state.session.sector3Distance;
        }

        // Priority 2: Official FIA sector distance catalog
        if ((!targetS1Distance || !targetS2Distance) && OFFICIAL_TRACK_SECTOR_DISTANCES[tId]) {
            targetS1Distance = OFFICIAL_TRACK_SECTOR_DISTANCES[tId].s1;
            targetS2Distance = OFFICIAL_TRACK_SECTOR_DISTANCES[tId].s2;
        }

        // Priority 3: Existing valid map file distance
        if (!targetS1Distance || !targetS2Distance) {
            if (fs.existsSync(mapPath)) {
                try {
                    const existingMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
                    if (existingMap.sector1 && existingMap.sector2 && existingMap.sector1.d > 200 && existingMap.sector2.d > existingMap.sector1.d + 500) {
                        targetS1Distance = existingMap.sector1.d;
                        targetS2Distance = existingMap.sector2.d;
                    }
                } catch (e) { }
            }
        }

        // Priority 4: Proportional split from lap times (fastest.json)
        if (!targetS1Distance || !targetS2Distance) {
            const rec = allTimeFastest[tId] || {};
            if (rec.s1 > 0 && rec.s2 > 0 && rec.time > (rec.s1 + rec.s2)) {
                targetS1Distance = Math.round(totalDist * (rec.s1 / rec.time));
                targetS2Distance = Math.round(totalDist * ((rec.s1 + rec.s2) / rec.time));
            }
        }

        // Fallback: 30% and 70% of total distance
        if (!targetS1Distance || targetS1Distance <= 0) targetS1Distance = Math.round(totalDist * 0.30);
        if (!targetS2Distance || targetS2Distance <= targetS1Distance) targetS2Distance = Math.round(totalDist * 0.70);

        // Extract precise 3D coordinates using EXACT TRACK DISTANCES
        const coordS1 = extractCoordinateFromTelemetryByDistance(telData, targetS1Distance);
        const coordS2 = extractCoordinateFromTelemetryByDistance(telData, targetS2Distance);

        const newS1 = coordS1 ? { x: coordS1.x, z: coordS1.z, yaw: coordS1.yaw || 0, d: coordS1.d || targetS1Distance } : null;
        const newS2 = coordS2 ? { x: coordS2.x, z: coordS2.z, yaw: coordS2.yaw || 0, d: coordS2.d || targetS2Distance } : null;

        if (tId === currentTrackId) {
            if (newStart) state.startLine = newStart;
            if (newS1) state.sector1 = newS1;
            if (newS2) state.sector2 = newS2;
            trackPointsDirty = true;
        }

        if (trackPoints.length === 0) {
            let lastD = -999;
            for (const p of telData) {
                if (Math.abs(p.d - lastD) >= 18) {
                    trackPoints.push({ x: p.x, z: p.z });
                    lastD = p.d;
                }
            }
        }

        const updatedData = {
            trackPoints: trackPoints,
            startLine: newStart,
            sector1: newS1,
            sector2: newS2
        };
        safeSaveTrackMap(mapPath, updatedData);
        console.log(`✅ Synced track lines for Map ${tId} using exact distance (S1: d=${Math.round(newS1?.d || 0)}m, S2: d=${Math.round(newS2?.d || 0)}m of ${Math.round(totalDist)}m)`);

        // Broadcast to clients
        const msg = JSON.stringify({
            type: 'trackLinesUpdated',
            trackId: tId,
            startLine: newStart,
            sector1: newS1,
            sector2: newS2
        });
        const tMsg = JSON.stringify({
            type: 'trackDataResponse',
            trackId: tId,
            data: updatedData
        });
        clients.forEach(c => {
            if (c.readyState === WebSocket.OPEN) {
                try {
                    c.send(msg);
                    c.send(tMsg);
                } catch (e) { }
            }
        });

        return updatedData;
    } catch (e) {
        console.error(`Error syncing track lines for Track ${tId}:`, e);
        return null;
    }
}

/**
 * Handles incoming WebSocket connections from the front-end dashboard.
 * Parses messages to retrieve saved track data or add custom timing sectors.
 */
function handleWsConnection(ws) {
    console.log('✅ Advanced Strategy Command Center Connected!');
    clients.push(ws);

    // Send full 3D track map immediately on connection so the dashboard renders right away
    if (state.trackPoints && state.trackPoints.length >= 20) {
        try {
            ws.send(JSON.stringify({
                type: 'trackDataResponse',
                trackId: currentTrackId,
                data: {
                    trackPoints: state.trackPoints,
                    pitLanePoints: state.pitLanePoints || [],
                    startLine: state.startLine,
                    sector1: state.sector1,
                    sector2: state.sector2
                }
            }));
        } catch (e) { }
    } else {
        let connectTrackId = currentTrackId !== -1 ? currentTrackId : ((state.session && state.session.trackId !== -1) ? state.session.trackId : 16);
        const tPath = path.join(trackMapsDir, `track_${connectTrackId}.json`);
        if (fs.existsSync(tPath)) {
            try {
                const raw = fs.readFileSync(tPath, 'utf8').trim();
                if (raw && raw.length > 2) {
                    const tData = JSON.parse(raw);
                    const pts = Array.isArray(tData) ? tData : (tData.trackPoints || []);
                    if (pts.length >= 20) {
                        ws.send(JSON.stringify({
                            type: 'trackDataResponse',
                            trackId: connectTrackId,
                            data: tData
                        }));
                    }
                }
            } catch (e) { }
        }
    }
    trackPointsDirty = true;
    lapHistoryDirty = true;

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);

            if (data.action === 'getAvailableTracks') {
                fs.readdir(trackMapsDir, (err, files) => {
                    if (!err) {
                        const tracks = files.filter(f => f.startsWith('track_') && f.endsWith('.json'))
                            .map(f => parseInt(f.match(/\d+/)[0]))
                            .filter(id => !isNaN(id));
                        ws.send(JSON.stringify({ type: 'availableTracks', tracks }));
                    }
                });
                return;
            }

            if (data.action === 'getTrackData') {
                let trackId = data.trackId !== undefined ? parseInt(data.trackId, 10) : currentTrackId;
                if (isNaN(trackId) || trackId === -1) {
                    trackId = currentTrackId !== -1 ? currentTrackId : ((state.session && state.session.trackId !== -1) ? state.session.trackId : 16);
                }
                if (!isNaN(trackId) && trackId !== -1) {
                    const tPath = path.join(trackMapsDir, `track_${trackId}.json`);
                    if (fs.existsSync(tPath)) {
                        try {
                            const raw = fs.readFileSync(tPath, 'utf8').trim();
                            if (raw && raw.length > 2) {
                                const tData = JSON.parse(raw);
                                const pts = Array.isArray(tData) ? tData : (tData.trackPoints || []);
                                if (pts.length >= 20) {
                                    ws.send(JSON.stringify({ type: 'trackDataResponse', trackId, data: tData }));
                                    return;
                                }
                            }
                        } catch (e) { }
                    }
                }
                if (state.trackPoints && state.trackPoints.length >= 20) {
                    ws.send(JSON.stringify({
                        type: 'trackDataResponse',
                        trackId: currentTrackId !== -1 ? currentTrackId : trackId,
                        data: {
                            trackPoints: state.trackPoints,
                            pitLanePoints: state.pitLanePoints || [],
                            startLine: state.startLine,
                            sector1: state.sector1,
                            sector2: state.sector2
                        }
                    }));
                    return;
                }
                return;
            }

            if (data.action === 'exportSession' || data.action === 'getSessionExport' || data.action === 'downloadSession') {
                ws.send(JSON.stringify({ type: 'sessionExportResponse', data: generateSessionExportJson() }));
                return;
            }

            if (data.action === 'getTrackSetups') {
                const trackId = data.trackId !== undefined ? parseInt(data.trackId) : currentTrackId;
                if (!isNaN(trackId) && trackId !== -1) {
                    const sPath = path.join(setupsDir, `setups_y${currentGameYear}_t${trackId}.json`);
                    if (fs.existsSync(sPath)) {
                        try {
                            const sData = JSON.parse(fs.readFileSync(sPath, 'utf8'));
                            ws.send(JSON.stringify({ type: 'trackSetupsResponse', trackId, data: sData }));
                        } catch (e) { }
                    } else {
                        ws.send(JSON.stringify({ type: 'trackSetupsResponse', trackId, data: [] }));
                    }
                }
                return;
            }

            if (data.action === 'resetSectors') {
                state.customSectorLines = [0];
                return;
            }

            if (data.action === 'clearSession' || data.action === 'resetSession') {
                resetSessionData();
                return;
            }

            if (data.action === 'syncTrackLines') {
                const tId = data.trackId !== undefined ? data.trackId : currentTrackId;
                syncTrackLinesForTrack(tId);
                return;
            }

            if (data.action === 'addSector' && data.timeMs >= 0) {
                if (data.timeMs === 0) {
                    if (!state.customSectorLines.find(s => s.d === 0)) state.customSectorLines.push({ x: state.startLine?.x || 0, z: state.startLine?.z || 0, yaw: state.startLine?.yaw || 0, d: 0 });
                    return;
                }
                if (fastestLapGhostData && fastestLapGhostData.length > 0) {
                    let bestPt = null;
                    let idx = fastestLapGhostData.findIndex(pt => pt.t >= data.timeMs);
                    if (idx === 0) {
                        bestPt = fastestLapGhostData[0];
                    } else if (idx > 0) {
                        const pt1 = fastestLapGhostData[idx - 1];
                        const pt2 = fastestLapGhostData[idx];
                        const rangeTime = pt2.t - pt1.t;
                        if (rangeTime > 0) {
                            const ratio = (data.timeMs - pt1.t) / rangeTime;
                            bestPt = {
                                x: pt1.x + (pt2.x - pt1.x) * ratio,
                                z: pt1.z + (pt2.z - pt1.z) * ratio,
                                yaw: pt1.yaw, // Approximated
                                d: pt1.d + (pt2.d - pt1.d) * ratio
                            };
                        } else {
                            bestPt = pt2;
                        }
                    } else {
                        bestPt = fastestLapGhostData[fastestLapGhostData.length - 1];
                    }
                    if (bestPt) {
                        state.customSectorLines.push({ x: bestPt.x, z: bestPt.z, yaw: bestPt.yaw || 0, d: bestPt.d });
                        console.log(`📍 Custom Sector Line coordinates calculated and added (for time: ${data.timeMs}ms)`);
                    }
                }
            }
        } catch (e) {
            console.error('Error parsing WS message:', e);
        }
    });
    ws.on('error', (err) => {
        clients = clients.filter(client => client !== ws);
    });
    ws.on('close', () => { clients = clients.filter(client => client !== ws); });
}

const wss = new WebSocket.Server({ server });
wss.on('error', (err) => { console.error('🛡️ [WSS Error]:', err.message); });
wss.on('connection', handleWsConnection);

const legacyWss = new WebSocket.Server({ port: 8085, host: '0.0.0.0' });
legacyWss.on('error', (err) => { console.error('🛡️ [Legacy WSS Error]:', err.message); });
legacyWss.on('connection', handleWsConnection);


const weatherMap = { 0: 'Clear', 1: 'Light Cloud', 2: 'Overcast', 3: 'Light Rain', 4: 'Heavy Rain', 5: 'Storm', 6: 'Unknown' };
const scMap = { 0: 'Clear', 1: 'Full SC', 2: 'VSC', 3: 'Formation', 4: 'SC Ending' };
const ersMap = { 0: 'None', 1: 'Medium', 2: 'Hotlap', 3: 'Overtake' };
const visualTyreNames = { 16: 'SOFT', 17: 'MEDIUM', 18: 'HARD', 7: 'INTER', 8: 'WET' };
const visualTyreColors = { 16: '#E10600', 17: '#FFC72C', 18: '#FFFFFF', 7: '#00E676', 8: '#00D2FF' };
const fallbackTyreNames = { 7: 'INTER', 8: 'WET', 9: 'DRY', 10: 'WET', 11: 'SUPER SOFT', 12: 'SOFT', 13: 'MEDIUM', 14: 'HARD', 15: 'WET' };

const gameModeMap = {
    4: 'Grand Prix ‘23',
    5: 'Time Trial',
    6: 'Splitscreen',
    7: 'Online Custom',
    15: 'Online Weekly Event',
    17: 'Story Mode (Braking Point)',
    27: 'My Team Career ‘25',
    28: 'Driver Career ‘25',
    29: 'Career ’25 Online',
    30: 'Challenge Career ‘25',
    75: 'Story Mode (APXGP)',
    127: 'Benchmark'
};

const sessionMap = {
    0: 'Unknown',
    1: 'Practice 1',
    2: 'Practice 2',
    3: 'Practice 3',
    4: 'Short Practice',
    5: 'Qualifying 1',
    6: 'Qualifying 2',
    7: 'Qualifying 3',
    8: 'Short Qualifying',
    9: 'One-Shot Qualifying',
    10: 'Sprint Shootout 1',
    11: 'Sprint Shootout 2',
    12: 'Sprint Shootout 3',
    13: 'Short Sprint Shootout',
    14: 'One-Shot Sprint Shootout',
    15: 'Race',
    16: 'Race 2',
    17: 'Race 3',
    18: 'Time Trial'
};

const rulesetMap = {
    0: 'Practice & Qualifying',
    1: 'Race',
    2: 'Time Trial',
    12: 'Elimination'
};

const surfaceMap = {
    0: 'Tarmac', 1: 'Rumble strip', 2: 'Concrete', 3: 'Rock', 4: 'Gravel', 5: 'Mud',
    6: 'Sand', 7: 'Grass', 8: 'Water', 9: 'Cobblestone', 10: 'Metal', 11: 'Ridged'
};

const penaltyMap = {
    0: 'Drive through', 1: 'Stop Go', 2: 'Grid penalty', 3: 'Penalty reminder', 4: 'Time penalty',
    5: 'Warning', 6: 'Disqualified', 7: 'Removed from formation lap', 8: 'Parked too long timer',
    9: 'Tyre regulations', 10: 'This lap invalidated', 11: 'This and next lap invalidated',
    12: 'This lap invalidated without reason', 13: 'This and next lap invalidated without reason',
    14: 'This and previous lap invalidated', 15: 'This and previous lap invalidated without reason',
    16: 'Retired', 17: 'Black flag timer'
};

const infringementMap = {
    0: 'Blocking by slow driving', 1: 'Blocking by wrong way driving', 2: 'Reversing off the start line',
    3: 'Big Collision', 4: 'Small Collision', 5: 'Collision failed to hand back position single',
    6: 'Collision failed to hand back position multiple', 7: 'Corner cutting gained time',
    8: 'Corner cutting overtake single', 9: 'Corner cutting overtake multiple', 10: 'Crossed pit exit lane',
    11: 'Ignoring blue flags', 12: 'Ignoring yellow flags', 13: 'Ignoring drive through',
    14: 'Too many drive throughs', 15: 'Drive through reminder serve within n laps',
    16: 'Drive through reminder serve this lap', 17: 'Pit lane speeding', 18: 'Parked for too long',
    19: 'Ignoring tyre regulations', 20: 'Too many penalties', 21: 'Multiple warnings',
    22: 'Approaching disqualification', 23: 'Tyre regulations select single',
    24: 'Tyre regulations select multiple', 25: 'Lap invalidated corner cutting',
    26: 'Lap invalidated running wide', 27: 'Corner cutting ran wide gained time minor',
    28: 'Corner cutting ran wide gained time significant', 29: 'Corner cutting ran wide gained time extreme',
    30: 'Lap invalidated wall riding', 31: 'Lap invalidated flashback used',
    32: 'Lap invalidated reset to track', 33: 'Blocking the pitlane', 34: 'Jump start',
    35: 'Safety car to car collision', 36: 'Safety car illegal overtake',
    37: 'Safety car exceeding allowed pace', 38: 'Virtual safety car exceeding allowed pace',
    39: 'Formation lap below allowed speed', 40: 'Formation lap parking',
    41: 'Retired mechanical failure', 42: 'Retired terminally damaged',
    43: 'Safety car falling too far back', 44: 'Black flag timer', 45: 'Unserved stop go penalty',
    46: 'Unserved drive through penalty', 47: 'Engine component change', 48: 'Gearbox change',
    49: 'Parc Fermé change', 50: 'League grid penalty', 51: 'Retry penalty',
    52: 'Illegal time gain', 53: 'Mandatory pitstop', 54: 'Attribute assigned'
};

const formulaMap = {
    0: 'F1', 1: 'F1 Classic', 2: 'F2', 3: 'F1 Generic',
    4: 'Beta', 5: 'Supercars', 6: 'Esports', 7: 'F1 World'
};

const trackMap = {
    0: 'Melbourne', 2: 'Shanghai', 3: 'Sakhir (Bahrain)', 4: 'Catalunya',
    5: 'Monaco', 6: 'Montreal', 7: 'Silverstone', 9: 'Hungaroring',
    10: 'Spa', 11: 'Monza', 12: 'Singapore', 13: 'Suzuka', 14: 'Abu Dhabi',
    15: 'Texas', 16: 'Brazil', 17: 'Austria', 19: 'Mexico',
    20: 'Baku (Azerbaijan)', 26: 'Zandvoort', 27: 'Imola', 29: 'Jeddah',
    30: 'Miami', 31: 'Las Vegas', 32: 'Losail', 39: 'Silverstone (Reverse)',
    40: 'Austria (Reverse)', 41: 'Zandvoort (Reverse)', 42: 'Madrid'
};

const flagMap = { '-1': 'GREEN', 0: 'GREEN', 1: 'GREEN', 2: 'BLUE', 3: 'YELLOW', 4: 'RED' };
const pitMap = { 0: 'ON TRACK', 1: 'PITTING', 2: 'IN PIT LANE' };

const teamMap = {
    // Modern F1 Base
    0: '#27F4D2',   // Mercedes
    1: '#E8002D',   // Ferrari
    2: '#3671C6',   // Red Bull Racing
    3: '#64C4FF',   // Williams
    4: '#229971',   // Aston Martin
    5: '#0093CC',   // Alpine
    6: '#6692FF',   // RB
    7: '#B6BABD',   // Haas
    8: '#FF8000',   // McLaren
    9: '#52E252',   // Sauber
    41: '#FFFFFF',  // F1 Generic
    85: '#00D2BE',  // Mercedes 2020
    104: '#FFFFFF', // F1 Custom Team
    129: '#FFE600', // Konnersport
    142: '#C5A059', // APXGP ‘24
    154: '#C5A059', // APXGP ‘25
    155: '#FFE600', // Konnersport ‘24

    // F2 2024
    158: '#B81B18', // Art GP ‘24
    159: '#FA5400', // Campos ‘24
    160: '#C8A84E', // Rodin Motorsport ‘24
    161: '#00B894', // AIX Racing ‘24
    162: '#0080FF', // DAMS ‘24
    163: '#CCCCCC', // Hitech ‘24
    164: '#FF5722', // MP Motorsport ‘24
    165: '#EE1212', // Prema ‘24
    166: '#004C97', // Trident ‘24
    167: '#F58220', // Van Amersfoort Racing ‘24
    168: '#FFE600', // Invicta ‘24

    // F1 2024 (Season Pack)
    185: '#27F4D2', // Mercedes ‘24
    186: '#E8002D', // Ferrari ‘24
    187: '#3671C6', // Red Bull Racing ‘24
    188: '#64C4FF', // Williams ‘24
    189: '#229971', // Aston Martin ‘24
    190: '#0093CC', // Alpine ‘24
    191: '#6692FF', // RB ‘24
    192: '#B6BABD', // Haas ‘24
    193: '#FF8000', // McLaren ‘24
    194: '#52E252', // Sauber ‘24

    // F2 2025
    465: '#B81B18', // Art GP ‘25
    466: '#FA5400', // Campos ‘25
    467: '#C8A84E', // Rodin Motorsport ‘25
    468: '#00B894', // AIX Racing ‘25
    469: '#0080FF', // DAMS ‘25
    470: '#CCCCCC', // Hitech ‘25
    471: '#FF5722', // MP Motorsport ‘25
    472: '#EE1212', // Prema ‘25
    473: '#004C97', // Trident ‘25
    474: '#F58220', // Van Amersfoort Racing ‘25
    475: '#FFE600', // Invicta ‘25

    // F1 2026 (Season Pack)
    476: '#27F4D2', // Mercedes ‘26
    477: '#E8002D', // Ferrari ‘26
    478: '#3671C6', // Red Bull Racing ‘26
    479: '#64C4FF', // Williams ‘26
    480: '#229971', // Aston Martin ‘26
    481: '#0093CC', // Alpine ‘26
    482: '#6692FF', // RB ‘26
    483: '#B6BABD', // Haas ‘26
    484: '#FF8000', // McLaren ‘26
    485: '#F50537', // Audi ‘26
    486: '#FFC72C', // Cadillac ‘26

    // Legacy F2 2019-2023 & Fallbacks
    70: '#004595', 71: '#FA5400', 72: '#002C66', 73: '#002B49', 74: '#0080FF', 75: '#FFE600',
    76: '#FF5722', 77: '#EE1212', 78: '#004C97', 79: '#FF69B4',
    106: '#EE1212', 107: '#FFE600', 108: '#002C66', 109: '#CCCCCC', 110: '#004595', 111: '#FF5722',
    112: '#002B49', 113: '#0080FF', 114: '#FA5400', 115: '#FF69B4', 116: '#004C97',
    118: '#EE1212', 119: '#FFE600', 120: '#002C66', 121: '#CCCCCC', 122: '#004595', 123: '#FF5722',
    124: '#002B49', 125: '#0080FF', 126: '#FA5400', 127: '#004C97',
    128: '#EE1212', 129: '#FFE600', 130: '#002C66', 131: '#CCCCCC', 132: '#004595', 133: '#FF5722',
    134: '#FA5400', 135: '#0080FF', 136: '#004C97', 137: '#002B49', 138: '#F58220',
    143: '#004595', 144: '#FA5400', 145: '#002C66', 146: '#00B894', 147: '#0080FF', 148: '#CCCCCC',
    149: '#FF5722', 150: '#EE1212', 151: '#004C97', 152: '#F58220', 153: '#FFE600',
    220: '#27F4D2', 221: '#E8002D', 222: '#3671C6', 223: '#64C4FF', 224: '#229971', 225: '#0093CC',
    226: '#6692FF', 227: '#B6BABD', 228: '#FF8000', 229: '#52E252', 230: '#FFFFFF', 255: '#FFFFFF'
};

const teamNameMap = {
    // Modern F1 Base
    0: 'Mercedes',
    1: 'Ferrari',
    2: 'Red Bull Racing',
    3: 'Williams',
    4: 'Aston Martin',
    5: 'Alpine',
    6: 'RB',
    7: 'Haas',
    8: 'McLaren',
    9: 'Sauber',
    41: 'F1 Generic',
    85: 'Mercedes 2020',
    104: 'F1 Custom Team',
    129: 'Konnersport',
    142: 'APXGP ‘24',
    154: 'APXGP ‘25',
    155: 'Konnersport ‘24',

    // F2 2024
    158: 'Art GP ‘24',
    159: 'Campos ‘24',
    160: 'Rodin Motorsport ‘24',
    161: 'AIX Racing ‘24',
    162: 'DAMS ‘24',
    163: 'Hitech ‘24',
    164: 'MP Motorsport ‘24',
    165: 'Prema ‘24',
    166: 'Trident ‘24',
    167: 'Van Amersfoort Racing ‘24',
    168: 'Invicta ‘24',

    // F1 2024 (Season Pack)
    185: 'Mercedes ‘24',
    186: 'Ferrari ‘24',
    187: 'Red Bull Racing ‘24',
    188: 'Williams ‘24',
    189: 'Aston Martin ‘24',
    190: 'Alpine ‘24',
    191: 'RB ‘24',
    192: 'Haas ‘24',
    193: 'McLaren ‘24',
    194: 'Sauber ‘24',

    // F2 2025
    465: 'Art GP ‘25',
    466: 'Campos ‘25',
    467: 'Rodin Motorsport ‘25',
    468: 'AIX Racing ‘25',
    469: 'DAMS ‘25',
    470: 'Hitech ‘25',
    471: 'MP Motorsport ‘25',
    472: 'Prema ‘25',
    473: 'Trident ‘25',
    474: 'Van Amersfoort Racing ‘25',
    475: 'Invicta ‘25',

    // F1 2026 (Season Pack)
    476: 'Mercedes ‘26',
    477: 'Ferrari ‘26',
    478: 'Red Bull Racing ‘26',
    479: 'Williams ‘26',
    480: 'Aston Martin ‘26',
    481: 'Alpine ‘26',
    482: 'RB ‘26',
    483: 'Haas ‘26',
    484: 'McLaren ‘26',
    485: 'Audi ‘26',
    486: 'Cadillac ‘26',

    // Legacy F2 2019-2023 & Fallbacks
    70: 'ART Grand Prix', 71: 'Campos Racing', 72: 'Carlin', 73: 'Sauber Junior Team by Charouz', 74: 'DAMS', 75: 'UNI-Virtuosi Racing',
    76: 'MP Motorsport', 77: 'PREMA Racing', 78: 'Trident', 79: 'BWT Arden',
    106: 'PREMA Racing', 107: 'UNI-Virtuosi Racing', 108: 'Carlin', 109: 'Hitech Grand Prix', 110: 'ART Grand Prix', 111: 'MP Motorsport',
    112: 'Charouz Racing System', 113: 'DAMS', 114: 'Campos Racing', 115: 'BWT HWA RACELAB', 116: 'Trident',
    118: 'PREMA Racing', 119: 'UNI-Virtuosi Racing', 120: 'Carlin', 121: 'Hitech Grand Prix', 122: 'ART Grand Prix', 123: 'MP Motorsport',
    124: 'Charouz Racing System', 125: 'DAMS', 126: 'Campos Racing', 127: 'Trident',
    128: 'PREMA Racing', 129: 'Virtuosi Racing', 130: 'Carlin', 131: 'Hitech Grand Prix', 132: 'ART Grand Prix', 133: 'MP Motorsport',
    134: 'Campos Racing', 135: 'DAMS', 136: 'Trident', 137: 'Charouz Racing System', 138: 'Van Amersfoort Racing',
    143: 'ART Grand Prix', 144: 'Campos Racing', 145: 'Carlin', 146: 'PHM Racing by Charouz', 147: 'DAMS', 148: 'Hitech Pulse-Eight',
    149: 'MP Motorsport', 150: 'PREMA Racing', 151: 'Trident', 152: 'Van Amersfoort Racing', 153: 'Virtuosi Racing',
    220: 'Mercedes', 221: 'Ferrari', 222: 'Red Bull Racing', 223: 'Williams', 224: 'Aston Martin', 225: 'Alpine',
    226: 'RB', 227: 'Haas', 228: 'McLaren', 229: 'Kick Sauber', 230: 'F1 Generic', 255: 'Network/Spectator'
};

let lastPrintedSessionTeamUID = null;

function getParticipantTeamId(participant) {
    if (!participant) return undefined;
    const tid = participant.m_teamId !== undefined ? participant.m_teamId : participant.teamId;
    if (tid !== undefined && !teamMap[tid]) {
        console.log(`UNKNOWN TEAM ID DETECTED: ${tid} for driver ${participant.m_name || 'unknown'}`);
    }
    return tid;
}

let currentSessionUID = null;
let currentSessionType = null;
let lastSessionTime = 0;
let currentTrackId = -1;
let isTrackMapped = false;

let carDataTracker = Array.from({ length: 22 }, () => ({
    pos: 0, lapNum: 0, pitStatus: 0, driverStatus: 0, bestLapMs: 0, gapText: '', maxSpeed: 0, tyre: 'UNK', tyreClass: '#FFFFFF', teamColor: '#FFFFFF', teamName: 'Unknown',
    s1: 0, s2: 0, s3: 0, bestS1: 0, bestS2: 0, bestS3: 0,
    penalties: 0, warnings: 0, cornerCutting: 0, unservedDT: 0, unservedSG: 0, invalidLap: false
}));

let carPhysics = Array.from({ length: 22 }, () => ({
    speed: 0, lapDistance: 0, lapNum: 0, officialDelta: 0, officialLeaderDelta: 0, lastValidDelta: 0, lastValidLeaderDelta: 0, sector: 0
}));

let allLapHistories = {};
let allTyreStints = {};
let currentLapTelemetry = Array.from({ length: 22 }, () => []);
let lastLapTelemetry = Array.from({ length: 22 }, () => []);
let fastestLapGhostData = [];

let state = {
    type: 'telemetry', playerIndex: 0, allCars: Array.from({ length: 22 }, () => ({ x: 0, z: 0, yaw: 0, teamColor: '#FFFFFF', teamName: 'Unknown', lapDistance: 0, speed: 0 })),
    trackPoints: [], pitLanePoints: [], participants: [], leaderboard: [], startLine: null, sector1Line: null, sector2Line: null, sector1: null, sector2: null, customSectorLines: [0],
    session: {
        trackName: 'Unknown', trackLength: 0, raceDistance: 0, lapsLeft: 0, type: 'Unknown', weather: '--',
        trackTemp: 0, airTemp: 0, sc: 'Clear', lapsTotal: 0, pitLimit: 80, fastestLapCarIndex: -1,
        sessionFastestLapMs: Infinity, sessionFastestDriver: 'None', sessionBestS1: 0, sessionBestS2: 0, sessionBestS3: 0,
        referenceS1: 0, referenceS2: 0, referenceS3: 0, allTimeBestS1: 0, allTimeBestS2: 0, allTimeBestS3: 0,
        trackId: 0, timeRemaining: 0, timeTotal: 0, safetyCarStatus: 'NONE', sessionType: 'NONE', sessionCategory: 'Race', allTimeFastestLapMs: Infinity, allTimeFastestDriver: 'Unknown', sector2Distance: 0, sector3Distance: 0,
        gamePaused: false
    },
    weatherForecast: [],
    damage: null,
    penalties: { timePenalties: 0, warnings: 0, cornerCuts: 0, driveThrough: 0, stopGo: 0, invalidLap: 0 },
    lap: {
        currentMs: 0, lastMs: 0, bestMs: 0, s1: 0, s2: 0, s3: 0, liveS1: 0, liveS2: 0, liveS3: 0,
        bestS1: 0, bestS2: 0, bestS3: 0, s1Status: 'pending', s2Status: 'pending', s3Status: 'pending',
        s1State: 'pending', s2State: 'pending', s3State: 'pending', pos: 0, lapNum: 0, gapFront: '+0.000',
        driverAhead: 'LEADER', driverAheadCarIndex: -1, driverAheadTyre: '', driverAheadTeamColor: '#FFD700',
        driverBehind: 'NONE', driverBehindCarIndex: -1, gapBehind: '--', driverBehindTyre: '', driverBehindTeamColor: '#888888',
        drsThreat: false, gapBehindSec: null, deltaToSessionFastest: null, lastLapDeltaToSessionFastest: null, isSessionFastest: false,
        pitStatus: 'ON TRACK', currentSector: 0, pendingS1: false, pendingS2: false, liveDeltaToRecord: 0, deltaToLeader: 0, ghostLapTimeMs: 0,
        penalties: 0, warnings: 0, cornerCutting: 0, unservedDT: 0, unservedSG: 0, scDelta: 0, invalid: false
    },
    motion: { pitch: 0, roll: 0, gLat: 0, gLong: 0, gVert: 0, susp: { fl: 0, fr: 0, rl: 0, rr: 0 }, gEnvelopeArray: gForceData.envelopeArray, gHistory: gForceData.history, maxGSeen: gForceData.maxGSeen },
    inputs: { speed: 0, gear: 'N', rpm: 0, throttle: 0, brake: 0, clutch: 0, steer: 0, drs: 'CLOSED' },
    ers: {
        mode: 'Medium',
        battery: 100,
        storeJoules: 4000000,
        deployModeInt: 1,
        deployedLapJoules: 0,
        deployedLapPct: 0,
        harvestedMGUKJoules: 0,
        harvestedMGUHJoules: 0,
        harvestedTotalJoules: 0,
        icePower: 0,
        mgukPower: 0,
        ersRecommendation: 'BALANCED'
    },
    fuel: {
        tankKg: 0,
        capacityKg: 110,
        pct: 0,
        remainingLapsDelta: 0,
        mix: 'Standard',
        mixInt: 1,
        targetBurnPerLap: 0,
        lapsLeft: 0,
        status: 'OPTIMAL'
    },
    setup: {
        // Aerodynamics
        wingF: 0, wingR: 0,
        // Transmission
        diffOn: 50, diffOff: 50, engineBraking: 100,
        // Suspension Geometry
        camberF: 0, camberR: 0, toeF: 0, toeR: 0,
        // Suspension
        suspF: 0, suspR: 0, arbF: 0, arbR: 0, heightF: 0, heightR: 0,
        // Brakes
        bPressure: 100, bBias: 50,
        // Tyre Setup Pressures (PSI)
        pressFLeft: 0, pressFRight: 0, pressRLeft: 0, pressRRight: 0,
        // Ballast & Fuel
        ballast: 0, fuel: 0, fuelLaps: 0
    },
    car: { tyreAge: 0, flag: 'GREEN', compound: 'Unknown', engineTemp: 0, wear: { fl: 0, fr: 0, rl: 0, rr: 0 }, surfTemp: { fl: 0, fr: 0, rl: 0, rr: 0 }, inTemp: { fl: 0, fr: 0, rl: 0, rr: 0 }, press: { fl: 0, fr: 0, rl: 0, rr: 0 }, brakeTemp: { fl: 0, fr: 0, rl: 0, rr: 0 } }
};

/**
 * Wipes all old session telemetry data, lap histories, leaderboards, and car tracking
 * when a new session is detected, session type changes, session is restarted, or track changes.
 */
function resetSessionData() {
    // Keep reference sectors if previously loaded
    const refS1 = state.session.referenceS1 || 0;
    const refS2 = state.session.referenceS2 || 0;
    const refS3 = state.session.referenceS3 || 0;

    carDataTracker = Array.from({ length: 22 }, () => ({
        pos: 0, lapNum: 0, pitStatus: 0, driverStatus: 0, bestLapMs: 0, gapText: '', maxSpeed: 0, tyre: 'UNK', tyreClass: '#FFFFFF', teamColor: '#FFFFFF', teamName: 'Unknown',
        s1: 0, s2: 0, s3: 0, bestS1: refS1, bestS2: refS2, bestS3: refS3,
        s1Status: 'pending', s2Status: 'pending', s3Status: 'pending',
        penalties: 0, warnings: 0, cornerCutting: 0, unservedDT: 0, unservedSG: 0, invalidLap: false
    }));
    carPhysics = Array.from({ length: 22 }, () => ({ speed: 0, lapDistance: 0, lapNum: 0, officialDelta: 0, officialLeaderDelta: 0, lastValidDelta: 0, lastValidLeaderDelta: 0, sector: 0 }));
    allLapHistories = {};
    allTyreStints = {};
    for (let i = 0; i < 22; i++) {
        currentLapTelemetry[i] = [];
        lastLapTelemetry[i] = [];
    }
    gForceData.maxGSeen = 0;
    gForceData.envelopeArray.length = 0;
    gForceData.history.length = 0;
    gEnvelopeSetServer.clear();
    state.motion.maxGSeen = 0;
    state.leaderboard = [];
    state.participants = [];
    state.allCars = Array.from({ length: 22 }, () => ({ x: 0, z: 0, yaw: 0, teamColor: '#FFFFFF', teamName: 'Unknown', lapDistance: 0, speed: 0 }));
    state.pitLanePoints = [];
    state.customSectorLines = [0];
    state.weatherForecast = [];
    state.damage = null;
    state.penalties = { timePenalties: 0, warnings: 0, cornerCuts: 0, driveThrough: 0, stopGo: 0, invalidLap: 0 };
    state.lap = {
        currentMs: 0, lastMs: 0, bestMs: 0, s1: 0, s2: 0, s3: 0, liveS1: 0, liveS2: 0, liveS3: 0,
        bestS1: refS1, bestS2: refS2, bestS3: refS3, s1Status: 'pending', s2Status: 'pending', s3Status: 'pending',
        s1State: 'pending', s2State: 'pending', s3State: 'pending', pos: 0, lapNum: 0, gapFront: '+0.000',
        driverAhead: 'LEADER', driverAheadCarIndex: -1, driverAheadTyre: '', driverAheadTeamColor: '#FFD700',
        driverBehind: 'NONE', driverBehindCarIndex: -1, gapBehind: '--', driverBehindTyre: '', driverBehindTeamColor: '#888888',
        drsThreat: false, gapBehindSec: null, deltaToSessionFastest: null, lastLapDeltaToSessionFastest: null, isSessionFastest: false,
        pitStatus: 'ON TRACK', currentSector: 0, pendingS1: false, pendingS2: false, liveDeltaToRecord: 0, deltaToLeader: 0, ghostLapTimeMs: 0,
        penalties: 0, warnings: 0, cornerCutting: 0, unservedDT: 0, unservedSG: 0, scDelta: 0, invalid: false
    };

    state.session.fastestLapCarIndex = -1;
    state.session.sessionFastestLapMs = Infinity;
    state.session.sessionFastestDriver = 'None';
    state.session.sessionBestS1 = refS1;
    state.session.sessionBestS2 = refS2;
    state.session.sessionBestS3 = refS3;

    lapHistoryDirty = true;

    // Immediately push reset state to all WebSocket clients
    clients = clients.filter(ws => ws.readyState === WebSocket.OPEN);
    const payload = JSON.stringify(state);
    clients.forEach((ws) => {
        try { ws.send(payload); } catch (e) { }
    });
}

/**
 * Mathematically approximates the shape of the pit lane based on the main track coordinates.
 * Finds the starting stretch of the track and applies an offset calculation.
 * 
 * @param {Array} trackPoints - The array of recorded track coordinates {x, z}
 * @returns {Array} Approximate pit lane coordinates
 */
function buildApproxPitLane(trackPoints) {
    if (!Array.isArray(trackPoints) || trackPoints.length < 18) return [];

    const laneLength = Math.min(Math.max(Math.floor(trackPoints.length * 0.18), 12), 34);
    const laneStart = Math.max(0, Math.floor(trackPoints.length * 0.01));
    const laneEnd = Math.min(trackPoints.length - 1, laneStart + laneLength);
    const lanePoints = [];

    for (let i = laneStart; i <= laneEnd; i++) {
        const prev = trackPoints[Math.max(0, i - 1)];
        const curr = trackPoints[i];
        const next = trackPoints[Math.min(trackPoints.length - 1, i + 1)];
        const dx = next.x - prev.x;
        const dz = next.z - prev.z;
        const len = Math.hypot(dx, dz) || 1;
        const offset = 42 + Math.sin(((i - laneStart) / Math.max(1, laneEnd - laneStart)) * Math.PI) * 34;

        lanePoints.push({
            x: curr.x + (-dz / len) * offset,
            z: curr.z + (dx / len) * offset
        });
    }

    return lanePoints;
}


// Initialize the F1 Telemetry UDP Listener on standard port 20777
const f1Client = new F1TelemetryClient({ port: 20777, format: 2025 });
let lastUdpPacketTime = 0;
function touchUdpPacket() {
    lastUdpPacketTime = Date.now();
}
if (f1Client && typeof f1Client.on === 'function') {
    f1Client.on('error', (err) => {
        console.error('🛡️ [F1 UDP Client Error]:', err?.message || err);
    });
}

/**
 * Robust helper function to extract sector times from the F1 UDP packet.
 * Due to version differences and inconsistencies in the parser library, 
 * this checks multiple possible key names.
 * 
 * @param {Object} obj - The lap data object from the packet
 * @param {number} sectorNum - The sector number (1, 2, or 3)
 * @returns {number} The sector time in milliseconds
 */
function getSectorTime(obj, sectorNum) {
    if (!obj) return 0;

    const msKey1 = `m_sector${sectorNum}TimeMSPart`;
    const msKey2 = `sector${sectorNum}TimeMSPart`;
    const msKey3 = `m_sector${sectorNum}TimeMsPart`;
    const msKey4 = `sector${sectorNum}TimeMsPart`;
    const msKey5 = `m_sector${sectorNum}TimeInMS`;
    const msKey6 = `sector${sectorNum}TimeInMS`;

    const minKey1 = `m_sector${sectorNum}TimeMinutesPart`;
    const minKey2 = `sector${sectorNum}TimeMinutesPart`;
    const minKey3 = `m_sector${sectorNum}TimeMinutes`;
    const minKey4 = `sector${sectorNum}TimeMinutes`;

    const fallbackKey1 = `m_sector${sectorNum}Time`;

    let ms = 0;
    if (obj[msKey1] !== undefined) ms = obj[msKey1];
    else if (obj[msKey2] !== undefined) ms = obj[msKey2];
    else if (obj[msKey3] !== undefined) ms = obj[msKey3];
    else if (obj[msKey4] !== undefined) ms = obj[msKey4];
    else if (obj[msKey5] !== undefined) ms = obj[msKey5];
    else if (obj[msKey6] !== undefined) ms = obj[msKey6];

    let mins = 0;
    if (obj[minKey1] !== undefined) mins = obj[minKey1];
    else if (obj[minKey2] !== undefined) mins = obj[minKey2];
    else if (obj[minKey3] !== undefined) mins = obj[minKey3];
    else if (obj[minKey4] !== undefined) mins = obj[minKey4];

    let totalMs = (mins * 60000) + ms;

    if (totalMs === 0) {
        const fallback = obj[fallbackKey1] || obj[`sector${sectorNum}Time`] || 0;
        if (fallback > 0) {
            return fallback < 1000 && fallback % 1 !== 0 ? Math.floor(fallback * 1000) : fallback;
        }
    }
    return totalMs;
}

/**
 * Calculates the current live timing for the active sector based on the total lap time
 * and the completed sector times. Returns an object with the timing state.
 */
function getLiveSectorTiming(currentMs, sector, s1, s2, s3) {
    const live = {
        s1: s1 || 0,
        s2: s2 || 0,
        s3: s3 || 0,
        liveS1: s1 || 0,
        liveS2: s2 || 0,
        liveS3: s3 || 0,
        s1State: 'pending',
        s2State: 'pending',
        s3State: 'pending'
    };

    if (sector === 0) {
        live.s1State = 'live';
        live.liveS1 = Math.max(0, currentMs);
    } else if (sector === 1) {
        live.s1State = 'complete';
        live.s2State = 'live';
        live.liveS2 = Math.max(0, currentMs - live.s1);
    } else if (sector === 2) {
        live.s1State = 'complete';
        live.s2State = 'complete';
        live.s3State = 'live';
        live.liveS3 = Math.max(0, currentMs - live.s1 - live.s2);
    }

    return live;
}

let currentGameYear = 26; // Default to 26 if not set

function setPlayerIndex(header) {
    if (header) {
        if (header.m_playerCarIndex !== undefined) {
            state.playerIndex = header.m_playerCarIndex;
        }
        if (header.m_gameYear !== undefined) {
            currentGameYear = header.m_gameYear;
        }
    }
}

function getAccurateSessionName(sessionType, formula) {
    const baseSession = sessionMap[sessionType] || `ID: ${sessionType}`;
    if (formula === 2) {
        if (sessionType === 10) return 'F2 Feature Race';
        if (sessionType === 11) return 'F2 Sprint Race';
        return `F2 ${baseSession}`;
    }
    if (formula !== 0 && formulaMap[formula]) {
        return `${formulaMap[formula]} ${baseSession}`;
    }
    return baseSession;
}


// --- UDP Event Handlers ---

/**
 * Motion Packet Handler
 * Updates 3D world coordinates (x, z, yaw) for all cars and records track map data if the circuit is unknown.
 */
f1Client.on('motion', (data) => {
    touchUdpPacket();
    setPlayerIndex(data.m_header);
    const pIdx = state.playerIndex;
    let newCars = [];

    for (let i = 0; i < 22; i++) {
        if (data.m_carMotionData[i]) {
            const pName = state.participants[i] || '';
            const lowerName = String(pName).toLowerCase();
            const isSCByName = lowerName.includes('safety') || lowerName.includes('medical') || lowerName === 'sc' || lowerName.startsWith('sc ');
            const isSCByTracker = carDataTracker[i] ? Boolean(carDataTracker[i].isSafetyCar) : false;
            const isSC = isSCByName || isSCByTracker;

            newCars.push({
                x: data.m_carMotionData[i].m_worldPositionX,
                y: data.m_carMotionData[i].m_worldPositionY || 0,
                z: data.m_carMotionData[i].m_worldPositionZ,
                yaw: data.m_carMotionData[i].m_yaw,
                pitch: data.m_carMotionData[i].m_pitch || 0,
                roll: data.m_carMotionData[i].m_roll || 0,
                teamColor: isSC ? '#FFB000' : carDataTracker[i].teamColor,
                teamName: isSC ? 'Safety Car' : carDataTracker[i].teamName,
                isSafetyCar: isSC,
                lapDistance: carPhysics[i].lapDistance,
                speed: carPhysics[i].speed
            });
        }
    }
    state.allCars = newCars;

    const pMotion = data.m_carMotionData[pIdx];
    if (pMotion) {
        const rawLat = pMotion.m_gForceLateral !== undefined ? pMotion.m_gForceLateral : 0;
        const rawLong = pMotion.m_gForceLongitudinal !== undefined ? pMotion.m_gForceLongitudinal : 0;
        const rawVert = pMotion.m_gForceVertical !== undefined ? pMotion.m_gForceVertical : 0;

        state.motion.gLat = Math.abs(rawLat) > 20 ? rawLat / 1000 : rawLat;
        state.motion.gLong = Math.abs(rawLong) > 20 ? rawLong / 1000 : rawLong;
        state.motion.gVert = Math.abs(rawVert) > 20 ? rawVert / 1000 : rawVert;
        state.motion.pitch = pMotion.m_pitch || 0;
        state.motion.roll = pMotion.m_roll || 0;

        processServerGForce(state.motion.gLat, state.motion.gLong, state.motion.gVert);
        state.motion.maxGSeen = gForceData.maxGSeen;

        const lapDist = carPhysics[pIdx].lapDistance;
        const speed = carPhysics[pIdx].speed;

        if (speed > 10 && lapDist >= 0 && lapDist < 50) {
            if (!state.startLine || lapDist < state.startLine.lapDistance) {
                state.startLine = {
                    x: pMotion.m_worldPositionX,
                    z: pMotion.m_worldPositionZ,
                    yaw: pMotion.m_yaw || 0,
                    lapDistance: lapDist
                };
                if (isTrackMapped && currentTrackId !== -1) {
                    const filePath = path.join(trackMapsDir, `track_${currentTrackId}.json`);
                    safeSaveTrackMap(filePath, { trackPoints: state.trackPoints, startLine: state.startLine, sector1: state.sector1, sector2: state.sector2 });
                }
            }
        }

        if (!isTrackMapped && currentTrackId !== -1) {
            const x = pMotion.m_worldPositionX;
            const z = pMotion.m_worldPositionZ;
            const pts = state.trackPoints;
            const lastPt = pts.length > 0 ? pts[pts.length - 1] : null;

            if (!lastPt || Math.hypot(lastPt.x - x, lastPt.z - z) > 10) {
                if (lastPt && Math.hypot(lastPt.x - x, lastPt.z - z) > 500) {
                    pts.length = 0;
                } else {
                    pts.push({ x, z });
                    if (pts.length > 3000) {
                        pts.shift();
                    }
                    if (pts.length > 150) {
                        const firstPt = pts[0];
                        if (Math.hypot(firstPt.x - x, firstPt.z - z) < 30) {
                            isTrackMapped = true;
                            safeSaveTrackMap(path.join(trackMapsDir, `track_${currentTrackId}.json`), { trackPoints: pts, startLine: state.startLine, sector1: state.sector1, sector2: state.sector2 });
                            state.pitLanePoints = buildApproxPitLane(state.trackPoints);
                            console.log(`✅ Track ID ${currentTrackId} fully mapped and saved!`);
                        }
                    }
                }
            }
        }
    }
});

/**
 * Extended Motion Packet Handler
 * Updates suspension positioning for telemetry graphs.
 */
f1Client.on('motionEx', (data) => {
    touchUdpPacket();
    if (data.m_suspensionPosition) {
        state.motion.susp.rl = data.m_suspensionPosition[0] || 0;
        state.motion.susp.rr = data.m_suspensionPosition[1] || 0;
        state.motion.susp.fl = data.m_suspensionPosition[2] || 0;
        state.motion.susp.fr = data.m_suspensionPosition[3] || 0;
    }
});

/**
 * Loads the ghost lap telemetry reference for delta calculations for a specific track.
 * 
 * @param {number} trackId - The ID of the current track
 */
function loadTrackDeltaReference(trackId) {
    const record = allTimeFastest[trackId];
    fastestLapGhostData = [];

    const telPath = path.join(telemetryDir, `telemetry_${trackId}.json`);
    const trackFastestPath = path.join(lapTimeDir, `fastest_${trackId}.json`);
    
    let loadedTelemetry = [];
    if (fs.existsSync(telPath)) {
        try {
            const raw = JSON.parse(fs.readFileSync(telPath, 'utf8'));
            if (Array.isArray(raw) && raw.length > 0) {
                loadedTelemetry = raw;
            }
        } catch (e) {
            console.error(`⚠️ Error reading telemetry_${trackId}.json:`, e.message);
        }
    }

    if (loadedTelemetry.length === 0 && fs.existsSync(trackFastestPath)) {
        try {
            const raw = JSON.parse(fs.readFileSync(trackFastestPath, 'utf8'));
            const pts = Array.isArray(raw) ? raw : (raw.telemetry || []);
            if (pts.length > 0) loadedTelemetry = pts;
        } catch (e) {
            console.error(`⚠️ Error reading fastest_${trackId}.json:`, e.message);
        }
    }

    if (record) {
        state.session.allTimeFastestLapMs = record.time;
        state.session.allTimeFastestDriver = record.driver;
    } else if (loadedTelemetry.length > 0) {
        const lastPt = loadedTelemetry[loadedTelemetry.length - 1];
        if (lastPt && lastPt.t > 0) {
            state.session.allTimeFastestLapMs = lastPt.t;
            state.session.allTimeFastestDriver = 'Track Reference';
        }
    } else {
        state.session.allTimeFastestLapMs = Infinity;
        state.session.allTimeFastestDriver = 'Unknown';
    }

    if (loadedTelemetry.length > 0) {
        fastestLapGhostData = loadedTelemetry
            .filter(pt => Number.isFinite(pt.d) && Number.isFinite(pt.t))
            .sort((a, b) => a.d - b.d);

        if (fastestLapGhostData.length > 0 && fastestLapGhostData[0].d > 0) {
            fastestLapGhostData.unshift({
                d: 0,
                t: 0,
                x: fastestLapGhostData[0].x || 0,
                z: fastestLapGhostData[0].z || 0,
                yaw: fastestLapGhostData[0].yaw || 0,
                throttle: 0, brake: 0, speed: 0, steer: 0, gear: 0
            });
        }

        // Calculate reference sectors from official record if available; otherwise telemetry distance markers
        const finalTime = fastestLapGhostData[fastestLapGhostData.length - 1].t;
        let refS1 = (record && record.s1 > 0) ? record.s1 : 0;
        let refS2 = (record && record.s2 > 0) ? record.s2 : 0;
        let refS3 = (record && record.s3 > 0) ? record.s3 : 0;

        if (!refS1 || !refS2 || !refS3) {
            const totalDist = (state.session.trackLength > 0) ? state.session.trackLength : (fastestLapGhostData[fastestLapGhostData.length - 1].d || 5000);
            const s2Dist = (state.session.sector2Distance > 0) ? state.session.sector2Distance : Math.round(totalDist / 3);
            const s3Dist = (state.session.sector3Distance > 0) ? state.session.sector3Distance : Math.round((totalDist / 3) * 2);

            const ptS1 = fastestLapGhostData.reduce((prev, curr) => Math.abs(curr.d - s2Dist) < Math.abs(prev.d - s2Dist) ? curr : prev, fastestLapGhostData[0]);
            const ptS2 = fastestLapGhostData.reduce((prev, curr) => Math.abs(curr.d - s3Dist) < Math.abs(prev.d - s3Dist) ? curr : prev, fastestLapGhostData[0]);

            refS1 = refS1 || (ptS1 ? ptS1.t : Math.round(finalTime * 0.28));
            refS2 = refS2 || ((ptS2 && ptS1) ? Math.max(0, ptS2.t - ptS1.t) : Math.round(finalTime * 0.40));
            refS3 = refS3 || Math.max(0, finalTime - (refS1 + refS2));
        }

        if (refS1 > 0 && refS2 > 0 && refS3 > 0) {
            state.session.referenceS1 = refS1;
            state.session.referenceS2 = refS2;
            state.session.referenceS3 = refS3;
            state.session.allTimeBestS1 = refS1;
            state.session.allTimeBestS2 = refS2;
            state.session.allTimeBestS3 = refS3;

            if (state.session.sessionBestS1 === Infinity || state.session.sessionBestS1 === 0) state.session.sessionBestS1 = refS1;
            if (state.session.sessionBestS2 === Infinity || state.session.sessionBestS2 === 0) state.session.sessionBestS2 = refS2;
            if (state.session.sessionBestS3 === Infinity || state.session.sessionBestS3 === 0) state.session.sessionBestS3 = refS3;

            const pIdx = state.playerIndex || 0;
            if (!carDataTracker[pIdx].bestS1 || carDataTracker[pIdx].bestS1 === 0) carDataTracker[pIdx].bestS1 = refS1;
            if (!carDataTracker[pIdx].bestS2 || carDataTracker[pIdx].bestS2 === 0) carDataTracker[pIdx].bestS2 = refS2;
            if (!carDataTracker[pIdx].bestS3 || carDataTracker[pIdx].bestS3 === 0) carDataTracker[pIdx].bestS3 = refS3;
            if (!state.lap.bestS1) state.lap.bestS1 = refS1;
            if (!state.lap.bestS2) state.lap.bestS2 = refS2;
            if (!state.lap.bestS3) state.lap.bestS3 = refS3;
        }

        console.log(`Loaded delta reference for Track ${trackId} (${fastestLapGhostData.length} points, S1: ${refS1}ms, S2: ${refS2}ms, S3: ${refS3}ms).`);
    }
}


/**
 * Session Packet Handler
 * Detects session/track changes, wipes stale telemetry data, loads existing track maps,
 * and updates session environment details (weather, temp, safety car status).
 */
f1Client.on('session', (data) => {
    touchUdpPacket();
    const uid = data.m_header ? data.m_header.m_sessionUID : data.m_sessionUID;
    const newSessionUID = typeof uid === 'bigint' ? uid.toString() : String(uid || '');
    const sessionTime = (data.m_header && data.m_header.m_sessionTime !== undefined) ? data.m_header.m_sessionTime : (data.m_sessionTime || 0);
    const sessionTypeRaw = data.m_sessionType;
    const tId = data.m_trackId;

    state.weatherForecast = data.m_weatherForecastSamples ? data.m_weatherForecastSamples.slice(0, data.m_numWeatherForecastSamples) : [];
    if (data.m_sector2LapDistanceStart) {
        state.session.sector2Distance = data.m_sector2LapDistanceStart;
        state.session.sector3Distance = data.m_sector3LapDistanceStart;
    }

    const isNewSession = currentSessionUID !== null && currentSessionUID !== newSessionUID;
    const isSessionRestarted = currentSessionUID === newSessionUID && lastSessionTime > 10 && sessionTime < lastSessionTime - 5;
    const isSessionTypeChanged = currentSessionType !== null && currentSessionType !== sessionTypeRaw;
    const isTrackChanged = currentTrackId !== -1 && tId !== undefined && tId !== -1 && currentTrackId !== tId;

    currentSessionUID = newSessionUID;
    currentSessionType = sessionTypeRaw;
    lastSessionTime = sessionTime;

    if (isNewSession || isSessionRestarted || isSessionTypeChanged || isTrackChanged) {
        //console.log(`🔄 Session Change Detected! (New UID: ${isNewSession}, Restarted: ${isSessionRestarted}, TypeChanged: ${isSessionTypeChanged}, TrackChanged: ${isTrackChanged}) - Wiping old telemetry data...`);
        resetSessionData();
    }

    if (tId !== undefined && tId !== -1) {
        if (tId !== currentTrackId || !state.trackPoints || state.trackPoints.length < 20) {
            currentTrackId = tId;
            state.customSectorLines = [0];
            isTrackMapped = false;
            const filePath = path.join(trackMapsDir, `track_${tId}.json`);

        if (fs.existsSync(filePath)) {
            try {
                const raw = fs.readFileSync(filePath, 'utf8').trim();
                if (raw && raw.length > 2) {
                    const parsedData = JSON.parse(raw);
                    if (Array.isArray(parsedData)) {
                        state.trackPoints = parsedData;
                        state.startLine = null;
                        state.sector1 = null;
                        state.sector2 = null;
                        isTrackMapped = true;
                    } else {
                        state.trackPoints = parsedData.trackPoints || [];
                        state.startLine = parsedData.startLine || null;
                        state.sector1 = (parsedData.sector1 && typeof parsedData.sector1 === 'object') ? parsedData.sector1 : ((parsedData.sector1Line && typeof parsedData.sector1Line === 'object') ? parsedData.sector1Line : null);
                        state.sector2 = (parsedData.sector2 && typeof parsedData.sector2 === 'object') ? parsedData.sector2 : ((parsedData.sector2Line && typeof parsedData.sector2Line === 'object') ? parsedData.sector2Line : null);
                        if (state.trackPoints.length > 0) isTrackMapped = true;
                    }
                    state.pitLanePoints = buildApproxPitLane(state.trackPoints);
                    trackPointsDirty = true;
                    // Broadcast trackDataResponse to all clients so they immediately have the track map
                    const tMsg = JSON.stringify({
                        type: 'trackDataResponse',
                        trackId: currentTrackId,
                        data: {
                            trackPoints: state.trackPoints,
                            pitLanePoints: state.pitLanePoints || [],
                            startLine: state.startLine,
                            sector1: state.sector1,
                            sector2: state.sector2
                        }
                    });
                    clients.forEach(c => {
                        if (c.readyState === WebSocket.OPEN) {
                            try { c.send(tMsg); } catch (e) { }
                        }
                    });
                }
            } catch (e) {
                console.error('Error parsing track map JSON:', e);
            }
        } else {
            state.trackPoints = [];
            state.pitLanePoints = [];
            state.customSectorLines = [0];
            state.startLine = null;
            state.sector1 = null;
            state.sector2 = null;
            isTrackMapped = false;
        }

        if (currentTrackId !== -1) loadTrackDeltaReference(currentTrackId);
        }
    }

    setPlayerIndex(data.m_header);

    const trackTemp = data.m_trackTemperature !== undefined ? data.m_trackTemperature : (data.trackTemperature || 0);
    const airTemp = data.m_airTemperature !== undefined ? data.m_airTemperature : (data.airTemperature || 0);
    const lapsTotal = data.m_totalLaps;
    const formulaRaw = data.m_formula || 0;

    state.session.weather = weatherMap[data.m_weather] || 'Unknown';
    state.session.trackTemp = trackTemp;
    state.session.airTemp = airTemp;
    state.session.trackLength = data.m_trackLength !== undefined ? data.m_trackLength : (data.trackLength || 5000);
    state.session.lapsTotal = lapsTotal;

    state.session.type = getAccurateSessionName(sessionTypeRaw, formulaRaw);

    const timeAttackIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 17, 18, 19];
    state.session.sessionCategory = timeAttackIds.includes(sessionTypeRaw) ? 'TimeAttack' : 'Race';

    state.session.trackId = data.m_trackId !== undefined ? data.m_trackId : currentTrackId;
    state.session.trackName = trackMap[data.m_trackId] || `TRACK NOT FOUND`;
    state.session.pitLimit = data.m_pitSpeedLimit;
    state.session.sc = scMap[data.m_safetyCarStatus] || 'Clear';
    state.session.gamePaused = Boolean(data.m_gamePaused !== undefined ? data.m_gamePaused : data.gamePaused);
});

/**
 * Event Packet Handler
 * Listens for game events like 'SSTA' (Session Started) to wipe old telemetry.
 */
f1Client.on('event', (data) => {
    touchUdpPacket();
    let eventCode = '';
    if (data.m_eventStringCode) {
        if (typeof data.m_eventStringCode === 'string') {
            eventCode = data.m_eventStringCode;
        } else if (Array.isArray(data.m_eventStringCode) || Buffer.isBuffer(data.m_eventStringCode)) {
            eventCode = Buffer.from(data.m_eventStringCode).toString('utf8').replace(/\0/g, '');
        }
    } else if (data.eventStringCode) {
        eventCode = String(data.eventStringCode);
    }

    if (eventCode === 'SSTA') {
        //console.log('🚩 Event SSTA (Session Started) received! Wiping old telemetry data...');
        resetSessionData();
    } else if (eventCode === 'FTLP' && data.m_eventDetails) {
        const vIdx = data.m_eventDetails.vehicleIdx;
        const lTime = data.m_eventDetails.lapTime;
        const lapTimeMs = typeof lTime === 'number' ? Math.round(lTime * 1000) : 0;
        if (lapTimeMs > 0 && (state.session.sessionFastestLapMs === Infinity || lapTimeMs < state.session.sessionFastestLapMs)) {
            state.session.sessionFastestLapMs = lapTimeMs;
            state.session.fastestLapCarIndex = vIdx;
            state.session.sessionFastestDriver = (state.participants && state.participants[vIdx]) ? state.participants[vIdx] : `Car ${vIdx}`;
        }
    } else if (eventCode === 'PENA' && data.m_eventDetails) {
        // Penalty recorded into state quietly (console log removed)
    }
});


/**
 * Session History Packet Handler
 * Parses past lap times and sector times for the given car to populate classification tables and track records.
 */
f1Client.on('sessionHistory', (data) => {
    touchUdpPacket();
    const carIndex = data.m_carIdx !== undefined ? data.m_carIdx : data.carIdx;
    const numLaps = data.m_numLaps !== undefined ? data.m_numLaps : data.numLaps;
    const historyArray = data.m_lapHistoryData || data.lapHistoryData || [];

    if (!allLapHistories[carIndex]) allLapHistories[carIndex] = [];
    const currentHist = allLapHistories[carIndex];
    const maxLen = Math.max(numLaps, currentHist.length);
    const updated = [];

    for (let k = 0; k < maxLen; k++) {
        const lapRaw = (k < numLaps && k < historyArray.length) ? historyArray[k] : null;
        const existing = currentHist[k] || null;

        let lapTime = 0;
        let s1 = 0, s2 = 0, s3 = 0;
        let validFlags = 0x0f;

        if (lapRaw) {
            lapTime = lapRaw.m_lapTimeInMS || lapRaw.lapTimeInMS || (lapRaw.m_lapTime ? Math.round(lapRaw.m_lapTime * 1000) : 0) || (lapRaw.lapTime ? Math.round(lapRaw.lapTime * 1000) : 0) || 0;
            s1 = getSectorTime(lapRaw, 1);
            s2 = getSectorTime(lapRaw, 2);
            s3 = getSectorTime(lapRaw, 3);
            validFlags = lapRaw.m_lapValidBitFlags !== undefined ? lapRaw.m_lapValidBitFlags : 0x0f;
        }

        // Non-destructive merge: never overwrite valid existing lap/sector data with zeroes
        if (existing) {
            if (lapTime === 0 && existing.lapTime > 0) lapTime = existing.lapTime;
            if (s1 === 0 && existing.s1 > 0) s1 = existing.s1;
            if (s2 === 0 && existing.s2 > 0) s2 = existing.s2;
            if (s3 === 0 && existing.s3 > 0) s3 = existing.s3;
            if (!lapRaw && existing.validFlags !== undefined) validFlags = existing.validFlags;
        }

        // Auto-calculate S3 if S1, S2 and lapTime are available
        if (s3 === 0 && lapTime > 0 && s1 > 0 && s2 > 0 && lapTime > (s1 + s2)) {
            s3 = lapTime - (s1 + s2);
        }
        // Auto-calculate lapTime if all 3 sectors are available
        if (lapTime === 0 && s1 > 0 && s2 > 0 && s3 > 0) {
            lapTime = s1 + s2 + s3;
        }

        updated.push({
            lapTime,
            s1,
            s2,
            s3,
            validFlags
        });
    }
    allLapHistories[carIndex] = updated;
    lapHistoryDirty = true;

    const tyreStints = data.m_tyreStintsHistoryData || data.tyreStintsHistoryData || [];
    const numTyreStints = data.m_numTyreStints !== undefined ? data.m_numTyreStints : (data.numTyreStints || tyreStints.length);
    allTyreStints[carIndex] = tyreStints.slice(0, numTyreStints).map(stint => ({
        endLap: stint.m_endLap !== undefined ? stint.m_endLap : stint.endLap,
        actualTyreCompound: stint.m_tyreActualCompound !== undefined ? stint.m_tyreActualCompound : stint.tyreActualCompound,
        visualTyreCompound: stint.m_tyreVisualCompound !== undefined ? stint.m_tyreVisualCompound : stint.tyreVisualCompound,
        tyreName: visualTyreNames[stint.m_tyreVisualCompound] || fallbackTyreNames[stint.m_tyreActualCompound] || 'UNK'
    }));

    if (numLaps > 0) {
        const bS1Lap = data.m_bestSector1LapNum !== undefined ? data.m_bestSector1LapNum : data.bestSector1LapNum;
        const bS2Lap = data.m_bestSector2LapNum !== undefined ? data.m_bestSector2LapNum : data.bestSector2LapNum;
        const bS3Lap = data.m_bestSector3LapNum !== undefined ? data.m_bestSector3LapNum : data.bestSector3LapNum;

        const bestS1 = bS1Lap ? getSectorTime(historyArray[bS1Lap - 1], 1) : 0;
        const bestS2 = bS2Lap ? getSectorTime(historyArray[bS2Lap - 1], 2) : 0;
        const bestS3 = bS3Lap ? getSectorTime(historyArray[bS3Lap - 1], 3) : 0;

        carDataTracker[carIndex].bestS1 = bestS1;
        carDataTracker[carIndex].bestS2 = bestS2;
        carDataTracker[carIndex].bestS3 = bestS3;

        if (bestS1 > 0 && bestS1 < state.session.sessionBestS1) state.session.sessionBestS1 = bestS1;
        if (bestS2 > 0 && bestS2 < state.session.sessionBestS2) state.session.sessionBestS2 = bestS2;
        if (bestS3 > 0 && bestS3 < state.session.sessionBestS3) state.session.sessionBestS3 = bestS3;

        const lastCompletedLapIdx = numLaps - 2;
        if (lastCompletedLapIdx >= 0) {
            const finalS3 = getSectorTime(historyArray[lastCompletedLapIdx], 3);
            carDataTracker[carIndex].s3 = finalS3;
            if (carIndex === state.playerIndex) state.lap.s3 = finalS3;
        }
    }
});

/**
 * Helper function to interpolate and extract a precise coordinate (x, z, yaw, distance)
 * from an array of telemetry points for a given timestamp.
 * 
 * @param {Array} telemetry - The array of recorded telemetry points {t, x, z, yaw, d}
 * @param {number} targetTimeMs - The target time in milliseconds to extract
 * @returns {Object|null} The interpolated coordinate
 */
function extractCoordinateFromTelemetry(telemetry, targetTimeMs) {
    if (!telemetry || telemetry.length === 0 || targetTimeMs === undefined || targetTimeMs === null || targetTimeMs < 0) return null;
    if (targetTimeMs === 0) return telemetry[0];
    let idx = telemetry.findIndex(pt => pt.t >= targetTimeMs);
    if (idx === 0) return telemetry[0];
    if (idx > 0) {
        const pt1 = telemetry[idx - 1];
        const pt2 = telemetry[idx];
        const rangeTime = pt2.t - pt1.t;
        if (rangeTime > 0) {
            const ratio = (targetTimeMs - pt1.t) / rangeTime;
            return {
                x: pt1.x + (pt2.x - pt1.x) * ratio,
                z: pt1.z + (pt2.z - pt1.z) * ratio,
                yaw: pt1.yaw || 0,
                d: pt1.d + (pt2.d - pt1.d) * ratio
            };
        }
    }
    return null;
}

function hasTelemetryCoordinate(point) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.z);
}

function shouldSetSectorLine(existing, coord) {
    if (!hasTelemetryCoordinate(coord)) return false;
    return !existing || !Number.isFinite(existing.x) || !Number.isFinite(existing.z) || (existing.x === 0 && existing.z === 0);
}

/**
 * Replays telemetry to determine exactly where a car was on track when it crossed 
 * sector 1 and sector 2 lines. This locks the visual sector lines to the track map.
 * 
 * @param {number} carIndex - The car index to use for mapping
 * @param {number} sector1Ms - The elapsed time when the car crossed sector 1
 * @param {number} sector2Ms - The elapsed time when the car crossed sector 2
 * @param {Array} telemetry - The car's telemetry data array
 * @returns {boolean} True if the track map was updated
 */
function lockOfficialSectorLinesFromTelemetry(carIndex, sector1Ms, sector2Ms, telemetry) {
    if (currentTrackId === -1 || !Array.isArray(telemetry) || telemetry.length < 50) return false;
    const lastPt = telemetry[telemetry.length - 1];
    if (!lastPt || (lastPt.d || 0) < 2000) return false;

    let trackUpdated = false;
    if (sector1Ms > 0) {
        const coord = extractCoordinateFromTelemetry(telemetry, sector1Ms);
        if (coord && hasTelemetryCoordinate(coord) && (coord.x !== 0 || coord.z !== 0)) {
            state.sector1 = { x: coord.x, z: coord.z, yaw: coord.yaw || 0, d: coord.d };
            trackUpdated = true;
        }
    }

    if (sector1Ms > 0 && sector2Ms > 0) {
        const coord = extractCoordinateFromTelemetry(telemetry, sector1Ms + sector2Ms);
        if (coord && hasTelemetryCoordinate(coord) && (coord.x !== 0 || coord.z !== 0)) {
            state.sector2 = { x: coord.x, z: coord.z, yaw: coord.yaw || 0, d: coord.d };
            trackUpdated = true;
        }
    }

    // Also lock startLine if near d = 0
    const startCandidate = telemetry.find(pt => Math.abs(pt.d || 0) < 60 && (pt.x !== 0 || pt.z !== 0));
    if (startCandidate && (!state.startLine || state.startLine.x === 0 || Math.abs(startCandidate.d) < Math.abs(state.startLine.d || 999))) {
        state.startLine = { x: startCandidate.x, z: startCandidate.z, yaw: startCandidate.yaw || 0, d: startCandidate.d || 0 };
        trackUpdated = true;
    }

    if (trackUpdated) {
        trackPointsDirty = true;
        if (currentTrackId !== -1) {
            const filePath = path.join(trackMapsDir, `track_${currentTrackId}.json`);
            let trackPoints = state.trackPoints || [];
            if (fs.existsSync(filePath)) {
                try {
                    const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    trackPoints = Array.isArray(existing) ? existing : (existing.trackPoints || trackPoints);
                } catch (e) { }
            }
            safeSaveTrackMap(filePath, {
                trackPoints: trackPoints,
                startLine: state.startLine,
                sector1: state.sector1,
                sector2: state.sector2
            });
        }

        const msg = JSON.stringify({
            type: 'trackLinesUpdated',
            trackId: currentTrackId,
            startLine: state.startLine,
            sector1: state.sector1,
            sector2: state.sector2
        });
        clients.forEach(c => {
            if (c.readyState === WebSocket.OPEN) {
                try { c.send(msg); } catch (e) { }
            }
        });
    }

    return trackUpdated;
}

/**
 * Lap Data Packet Handler
 * Handles lap transitions, records track records (ghost laps), live telemetry history,
 * and extracts critical timing data (current lap time, sectors, delta to leader).
 */
f1Client.on('lapData', (data) => {
    touchUdpPacket();
    setPlayerIndex(data.m_header);
    const pIdx = state.playerIndex;
    let sessionFastestLapMs = Infinity;
    let fastestLapIndex = -1;

    for (let i = 0; i < 22; i++) {
        const lap = data.m_lapData ? data.m_lapData[i] : data.lapData[i];

        // Lap Transition Logic
        if (lap.m_currentLapNum > carPhysics[i].lapNum) {
            // Crossed the line - copy full rich telemetry trace including throttle, brake, steer, speed, gear, y elevation, pitch, roll
            lastLapTelemetry[i] = (currentLapTelemetry[i] || []).map(pt => ({
                d: pt.d,
                t: pt.t,
                x: pt.x,
                y: pt.y !== undefined ? pt.y : 0,
                z: pt.z,
                yaw: pt.yaw,
                pitch: pt.pitch || 0,
                roll: pt.roll || 0,
                throttle: pt.throttle !== undefined ? pt.throttle : 0,
                brake: pt.brake !== undefined ? pt.brake : 0,
                speed: pt.speed !== undefined ? pt.speed : 0,
                steer: pt.steer !== undefined ? pt.steer : 0,
                gear: pt.gear !== undefined ? pt.gear : 0
            }));
            currentLapTelemetry[i] = [];

            // Capture ghost telemetry upon lap completion with full lap validation
            const lastTime = lap.m_lastLapTimeInMS || (lap.m_lastLapTime * 1000) || 0;
            const tLen = state.session.trackLength > 0 ? state.session.trackLength : 4000;

            // Preserve sector times of the completed lap before reset
            const finishedS1 = carDataTracker[i].s1 || 0;
            const finishedS2 = carDataTracker[i].s2 || 0;
            const finishedS3 = (lastTime > 0 && finishedS1 > 0 && finishedS2 > 0) ? Math.max(0, lastTime - (finishedS1 + finishedS2)) : (carDataTracker[i].s3 || 0);

            // Record completed lap in allLapHistories for immediate pace analysis and classification
            if (lastTime > 0) {
                if (!allLapHistories[i]) allLapHistories[i] = [];
                const completedLapNum = (lap.m_currentLapNum > 1) ? (lap.m_currentLapNum - 1) : (carPhysics[i].lapNum || 1);
                const lapIdx = Math.max(0, completedLapNum - 1);
                const existing = allLapHistories[i][lapIdx] || {};

                allLapHistories[i][lapIdx] = {
                    lapTime: lastTime || existing.lapTime || 0,
                    s1: finishedS1 || existing.s1 || 0,
                    s2: finishedS2 || existing.s2 || 0,
                    s3: finishedS3 || existing.s3 || (lastTime > 0 && finishedS1 > 0 && finishedS2 > 0 ? Math.max(0, lastTime - (finishedS1 + finishedS2)) : 0),
                    validFlags: (carDataTracker[i].penalties === 0 && !carDataTracker[i].invalidLap) ? 0x01 : (existing.validFlags !== undefined ? existing.validFlags : 0x00)
                };
                lapHistoryDirty = true;
            }

            // Clean up telemetry: remove points with invalid coordinates
            let validTelemetry = (lastLapTelemetry[i] || [])
                .filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.z) && (pt.x !== 0 || pt.z !== 0));
            const hasMinPoints = validTelemetry.length >= 80;
            const startsNearLine = validTelemetry.some(pt => (pt.d || 0) < 60);
            const lastTelemetryPt = validTelemetry.length > 0 ? validTelemetry[validTelemetry.length - 1] : null;
            const completesLap = lastTelemetryPt && (lastTelemetryPt.d || 0) >= (tLen * 0.85);
            const isCleanLap = hasMinPoints && startsNearLine && completesLap;

            if (lastTime > 50000 && currentTrackId !== -1 && isCleanLap) {
                validTelemetry.sort((a, b) => (a.d !== undefined && b.d !== undefined) ? a.d - b.d : a.t - b.t);

                // Ensure the starting point is at d = 0, t = 0
                if (validTelemetry[0].d > 0) {
                    validTelemetry.unshift({
                        ...validTelemetry[0],
                        d: 0,
                        t: 0
                    });
                }

                // FORCE the final point of the telemetry array to perfectly match the official lap time and track distance
                const lastPoint = validTelemetry[validTelemetry.length - 1];
                if (lastPoint && lastPoint.t !== lastTime) {
                    const trackLen = state.session.trackLength > 0 ? state.session.trackLength : (lastPoint.d + 20);
                    validTelemetry.push({ ...lastPoint, d: trackLen, t: lastTime });
                }

                const isPlayer = (i === pIdx);
                let record = allTimeFastest[currentTrackId];
                const isFaster = !record || lastTime < record.time;
                const trackTelemetryPath = path.join(telemetryDir, `telemetry_${currentTrackId}.json`);
                const trackFastestPath = path.join(lapTimeDir, `fastest_${currentTrackId}.json`);
                const telMissing = !fs.existsSync(trackTelemetryPath);

                // Priority: Player's completed lap ALWAYS saves full inputs; AI lap only saves if telemetry missing or new overall record
                const shouldSaveTelemetry = isPlayer || telMissing || (!record || lastTime < record.time);

                if (shouldSaveTelemetry) {
                    const driverName = (state.participants && state.participants[i]) || carDataTracker[i].teamName || (isPlayer ? 'Player' : 'Unknown');

                    allTimeFastest[currentTrackId] = {
                        time: (!record || lastTime < record.time) ? lastTime : record.time,
                        driver: (!record || lastTime < record.time) ? driverName : (record.driver || driverName),
                        s1: finishedS1 || (record && record.s1) || 0,
                        s2: finishedS2 || (record && record.s2) || 0,
                        s3: finishedS3 || (record && record.s3) || 0,
                        hasTelemetry: true
                    };
                    fastestLapGhostData = validTelemetry;
                    fs.writeFileSync(fastestJsonPath, JSON.stringify(allTimeFastest, null, 2), 'utf8');

                    // Save compact ghost lap [ { d, t } ]
                    fs.writeFileSync(trackFastestPath, JSON.stringify(validTelemetry.map(pt => ({ d: pt.d, t: pt.t }))), 'utf8');

                    // Save full rich telemetry [ { d, t, x, y, z, yaw, pitch, roll, throttle, brake, speed, steer, gear } ]
                    fs.writeFileSync(trackTelemetryPath, JSON.stringify(validTelemetry, null, 2), 'utf8');

                    if (!record || lastTime < record.time) {
                        state.session.allTimeFastestLapMs = lastTime;
                        state.session.allTimeFastestDriver = driverName;
                        console.log(`🏆 NEW TRACK RECORD & FULL TELEMETRY SAVED! Track ${currentTrackId}: ${driverName} - ${lastTime}ms (${validTelemetry.length} pts)`);
                    } else {
                        console.log(`💾 PLAYER TELEMETRY SAVED! Track ${currentTrackId}: ${driverName} - ${lastTime}ms (${validTelemetry.length} pts)`);
                    }

                    // Update sector lines in track map using the official sector times
                    syncTrackLinesForTrack(currentTrackId);
                } else {
                    lockOfficialSectorLinesFromTelemetry(i, finishedS1, finishedS2, validTelemetry);
                }
            }

            // RESET sector tracking for the new lap so sector chips and cards start fresh LIVE
            carDataTracker[i].s1 = 0;
            carDataTracker[i].s2 = 0;
            carDataTracker[i].s3 = 0;
            carDataTracker[i].s1Status = 'pending';
            carDataTracker[i].s2Status = 'pending';
            carDataTracker[i].s3Status = 'pending';

            if (i === pIdx) {
                state.lap.s1 = 0;
                state.lap.s2 = 0;
                state.lap.s3 = 0;
                state.lap.liveS1 = 0;
                state.lap.liveS2 = 0;
                state.lap.liveS3 = 0;
                state.lap.s1State = 'live';
                state.lap.s2State = 'pending';
                state.lap.s3State = 'pending';
                state.lap.s1Status = 'pending';
                state.lap.s2Status = 'pending';
                state.lap.s3Status = 'pending';
            }

                // Save setup at the end of the lap for the player
                if (i === pIdx && currentTrackId !== -1) {
                    try {
                        const sPath = path.join(setupsDir, `setups_y${currentGameYear}_t${currentTrackId}.json`);
                        let setupsData = [];
                        if (fs.existsSync(sPath)) {
                            setupsData = JSON.parse(fs.readFileSync(sPath, 'utf8'));
                        }

                        // Check if lap already exists to avoid duplicates
                        const existingLapIndex = setupsData.findIndex(s => s.lapNum === carPhysics[i].lapNum);
                        const setupEntry = {
                            lapNum: carPhysics[i].lapNum,
                            time: lastTime,
                            setup: { ...state.setup },
                            timestamp: Date.now()
                        };

                        if (existingLapIndex >= 0) {
                            setupsData[existingLapIndex] = setupEntry;
                        } else {
                            setupsData.push(setupEntry);
                        }

                        fs.writeFileSync(sPath, JSON.stringify(setupsData, null, 2), 'utf8');

                        // Broadcast updated setups to all clients
                        const setupMsg = JSON.stringify({ type: 'trackSetupsResponse', trackId: currentTrackId, data: setupsData });
                        clients.forEach(c => {
                            if (c.readyState === WebSocket.OPEN) {
                                c.send(setupMsg);
                            }
                        });
                    } catch (e) {
                        console.error('⚠️ Error saving setup for lap:', e);
                    }
                }
            }

        carPhysics[i].lapDistance = lap.m_lapDistance;
        carPhysics[i].lapNum = lap.m_currentLapNum;

        const dtcMsPart = lap.m_deltaToCarInFrontMSPart !== undefined ? lap.m_deltaToCarInFrontMSPart : 0;
        const dtcMinPart = lap.m_deltaToCarInFrontMinutesPart !== undefined ? lap.m_deltaToCarInFrontMinutesPart : 0;
        const dtcMs = (dtcMinPart * 60000) + dtcMsPart;
        const officialDtc = (dtcMs || lap.m_deltaToCarInFrontInMS || 0) / 1000;
        carPhysics[i].officialDelta = officialDtc;
        if (officialDtc > 0 && officialDtc < 180) {
            carPhysics[i].lastValidDelta = officialDtc;
        }

        const dtlMsPart = lap.m_deltaToRaceLeaderMSPart !== undefined ? lap.m_deltaToRaceLeaderMSPart : 0;
        const dtlMinPart = lap.m_deltaToRaceLeaderMinutesPart !== undefined ? lap.m_deltaToRaceLeaderMinutesPart : 0;
        const dtlMs = (dtlMinPart * 60000) + dtlMsPart;
        const officialDtl = (dtlMs || lap.m_deltaToRaceLeaderInMS || 0) / 1000;
        carPhysics[i].officialLeaderDelta = officialDtl;
        if (officialDtl > 0 && officialDtl < 360) {
            carPhysics[i].lastValidLeaderDelta = officialDtl;
        }

        carPhysics[i].sector = lap.m_sector !== undefined ? lap.m_sector : (lap.sector || 0);

        // Record Live Telemetry for Delta and Track Mapping with Subsampling and Capping
        const curMs = lap.m_currentLapTimeInMS || (lap.m_lastLapTime * 1000) || (lap.m_currentLapTime * 1000) || 0;
        if (curMs >= 0 && lap.m_lapDistance >= 0 && lap.m_resultStatus !== 0) {
            const carObj = state.allCars && state.allCars[i] ? state.allCars[i] : {};
            // Only record if valid world coordinates have arrived from motion packet
            if (carObj.x !== undefined && Number.isFinite(carObj.x) && (carObj.x !== 0 || carObj.z !== 0)) {
                const arr = currentLapTelemetry[i] || (currentLapTelemetry[i] = []);
                const lastPt = arr.length > 0 ? arr[arr.length - 1] : null;

                const distDiff = lastPt ? Math.abs(lap.m_lapDistance - lastPt.d) : 999;
                const timeDiff = lastPt ? Math.abs(curMs - lastPt.t) : 999;

                // Subsample: only push if distance difference >= 1.5m or time delta >= 100ms
                if (!lastPt || distDiff >= 1.5 || timeDiff >= 100) {
                    let pt = {
                        d: Math.round(lap.m_lapDistance * 10) / 10,
                        t: curMs,
                        x: Math.round(carObj.x * 100) / 100,
                        y: Math.round((carObj.y || 0) * 100) / 100,
                        z: Math.round(carObj.z * 100) / 100,
                        yaw: Math.round((carObj.yaw || 0) * 1000) / 1000,
                        pitch: Math.round((carObj.pitch || 0) * 1000) / 1000,
                        roll: Math.round((carObj.roll || 0) * 1000) / 1000,
                        throttle: 0, brake: 0, speed: Math.round(carObj.speed || 0), steer: 0, gear: 0
                    };
                    if (i === state.playerIndex) {
                        pt.throttle = Math.round(state.inputs.throttle);
                        pt.brake = Math.round(state.inputs.brake);
                        pt.speed = Math.round(state.inputs.speed);
                        pt.steer = Math.round(state.inputs.steer * 100) / 100;
                        pt.gear = state.inputs.gear;
                    }
                    arr.push(pt);
                    if (arr.length > 3000) {
                        arr.shift();
                    }
                }
            }
        }

        const liveS1 = getSectorTime(lap, 1);
        const liveS2 = getSectorTime(lap, 2);
        const liveS3 = getSectorTime(lap, 3);
        const curSector = lap.m_sector !== undefined ? lap.m_sector : (lap.sector || 0);
        carDataTracker[i].currentSector = curSector;

        if (liveS1 > 0) {
            const priorBestS1 = carDataTracker[i].bestS1 || 0;
            const sb1 = (state.session.sessionBestS1 && state.session.sessionBestS1 !== Infinity) ? state.session.sessionBestS1 : 0;
            carDataTracker[i].s1 = liveS1;

            // Evaluate if this sector is SB (purple), PB (green), or Slower (yellow)
            if (sb1 > 0 && liveS1 <= sb1) {
                carDataTracker[i].s1Status = 'sb';
            } else if (priorBestS1 > 0 && liveS1 < priorBestS1) {
                carDataTracker[i].s1Status = 'pb';
            } else if (priorBestS1 === 0) {
                carDataTracker[i].s1Status = (sb1 > 0 && liveS1 <= sb1) ? 'sb' : 'pb';
            } else {
                carDataTracker[i].s1Status = 'yellow';
            }

            if (!carDataTracker[i].bestS1 || liveS1 < carDataTracker[i].bestS1) {
                carDataTracker[i].bestS1 = liveS1;
            }
            if (state.session.sessionBestS1 === Infinity || state.session.sessionBestS1 === 0 || liveS1 < state.session.sessionBestS1) {
                state.session.sessionBestS1 = liveS1;
                state.session.sessionBestS1Driver = (state.participants && state.participants[i]) ? state.participants[i] : `Car ${i}`;
            }
        }
        if (liveS2 > 0) {
            const priorBestS2 = carDataTracker[i].bestS2 || 0;
            const sb2 = (state.session.sessionBestS2 && state.session.sessionBestS2 !== Infinity) ? state.session.sessionBestS2 : 0;
            carDataTracker[i].s2 = liveS2;

            if (sb2 > 0 && liveS2 <= sb2) {
                carDataTracker[i].s2Status = 'sb';
            } else if (priorBestS2 > 0 && liveS2 < priorBestS2) {
                carDataTracker[i].s2Status = 'pb';
            } else if (priorBestS2 === 0) {
                carDataTracker[i].s2Status = (sb2 > 0 && liveS2 <= sb2) ? 'sb' : 'pb';
            } else {
                carDataTracker[i].s2Status = 'yellow';
            }

            if (!carDataTracker[i].bestS2 || liveS2 < carDataTracker[i].bestS2) {
                carDataTracker[i].bestS2 = liveS2;
            }
            if (state.session.sessionBestS2 === Infinity || state.session.sessionBestS2 === 0 || liveS2 < state.session.sessionBestS2) {
                state.session.sessionBestS2 = liveS2;
                state.session.sessionBestS2Driver = (state.participants && state.participants[i]) ? state.participants[i] : `Car ${i}`;
            }
        }
        if (liveS3 > 0) {
            const priorBestS3 = carDataTracker[i].bestS3 || 0;
            const sb3 = (state.session.sessionBestS3 && state.session.sessionBestS3 !== Infinity) ? state.session.sessionBestS3 : 0;
            carDataTracker[i].s3 = liveS3;

            if (sb3 > 0 && liveS3 <= sb3) {
                carDataTracker[i].s3Status = 'sb';
            } else if (priorBestS3 > 0 && liveS3 < priorBestS3) {
                carDataTracker[i].s3Status = 'pb';
            } else if (priorBestS3 === 0) {
                carDataTracker[i].s3Status = (sb3 > 0 && liveS3 <= sb3) ? 'sb' : 'pb';
            } else {
                carDataTracker[i].s3Status = 'yellow';
            }

            if (!carDataTracker[i].bestS3 || liveS3 < carDataTracker[i].bestS3) {
                carDataTracker[i].bestS3 = liveS3;
            }
            if (state.session.sessionBestS3 === Infinity || state.session.sessionBestS3 === 0 || liveS3 < state.session.sessionBestS3) {
                state.session.sessionBestS3 = liveS3;
                state.session.sessionBestS3Driver = (state.participants && state.participants[i]) ? state.participants[i] : `Car ${i}`;
            }
        }

        let calculatedBestMs = Infinity;
        if (allLapHistories[i] && allLapHistories[i].length > 0) {
            allLapHistories[i].forEach(lapData => {
                const time = typeof lapData === 'object' ? lapData.lapTime : lapData;
                if (time > 0 && time < calculatedBestMs) calculatedBestMs = time;
            });
        }

        const currentBestMs = lap.m_bestLapTimeInMS || (lap.m_bestLapTime * 1000) || 0;
        const finalBestMs = calculatedBestMs !== Infinity ? calculatedBestMs : currentBestMs;

        if (finalBestMs > 0) carDataTracker[i].bestLapMs = finalBestMs;

        if (carDataTracker[i].bestLapMs > 0 && carDataTracker[i].bestLapMs < sessionFastestLapMs) {
            sessionFastestLapMs = carDataTracker[i].bestLapMs;
            fastestLapIndex = i;
        }

        // Let the UDP track sector times naturally without forcing 0 on lap change.
        carDataTracker[i].pos = lap.m_carPosition;
        carDataTracker[i].lapNum = lap.m_currentLapNum;
        carDataTracker[i].pitStatus = lap.m_pitStatus;
        carDataTracker[i].driverStatus = lap.m_resultStatus;
        carDataTracker[i].penalties = lap.m_penalties || 0;
        carDataTracker[i].warnings = lap.m_totalWarnings || 0;
        carDataTracker[i].cornerCutting = lap.m_cornerCuttingWarnings || 0;
        carDataTracker[i].unservedDT = lap.m_numUnservedDriveThroughPens || 0;
        carDataTracker[i].unservedSG = lap.m_numUnservedStopGoPens || 0;
        carDataTracker[i].invalidLap = lap.m_currentLapInvalid === 1;

        if (i === pIdx) {
            const sector = lap.m_sector !== undefined ? lap.m_sector : (lap.sector || 0);
            if (sector === 1 && state.lap.currentSector === 0) state.lap.pendingS1 = true;
            if (sector === 2 && state.lap.currentSector === 1) state.lap.pendingS2 = true;
            state.lap.currentSector = sector;

            // State is updated strictly by the packet

            state.lap.lastMs = lap.m_lastLapTimeInMS || (lap.m_lastLapTime * 1000) || 0;
            state.lap.currentMs = curMs;
            state.lap.pos = lap.m_carPosition;
            state.lap.lapNum = lap.m_currentLapNum;
            state.lap.pitStatus = pitMap[lap.m_pitStatus] || 'ON TRACK';
            state.lap.bestMs = finalBestMs;

            if (liveS1 > 0) state.lap.s1 = liveS1;
            if (liveS2 > 0) state.lap.s2 = liveS2;
            if (liveS3 > 0) state.lap.s3 = liveS3;

            state.lap.bestS1 = carDataTracker[pIdx].bestS1 || state.session.referenceS1 || 0;
            state.lap.bestS2 = carDataTracker[pIdx].bestS2 || state.session.referenceS2 || 0;
            state.lap.bestS3 = carDataTracker[pIdx].bestS3 || state.session.referenceS3 || 0;

            state.lap.s1Status = carDataTracker[pIdx].s1Status || 'pending';
            state.lap.s2Status = carDataTracker[pIdx].s2Status || 'pending';
            state.lap.s3Status = carDataTracker[pIdx].s3Status || 'pending';

            const liveSectorTiming = getLiveSectorTiming(
                state.lap.currentMs,
                state.lap.currentSector,
                state.lap.s1,
                state.lap.s2,
                state.lap.s3
            );
            state.lap.liveS1 = liveSectorTiming.liveS1;
            state.lap.liveS2 = liveSectorTiming.liveS2;
            state.lap.liveS3 = liveSectorTiming.liveS3;
            state.lap.s1State = liveSectorTiming.s1State;
            state.lap.s2State = liveSectorTiming.s2State;
            state.lap.s3State = liveSectorTiming.s3State;

            const dtlMsPart = lap.m_deltaToRaceLeaderMSPart !== undefined ? lap.m_deltaToRaceLeaderMSPart : 0;
            const dtlMinPart = lap.m_deltaToRaceLeaderMinutesPart !== undefined ? lap.m_deltaToRaceLeaderMinutesPart : 0;
            const dtlMs = (dtlMinPart * 60000) + dtlMsPart;
            state.lap.deltaToLeader = dtlMs || lap.m_deltaToRaceLeaderInMS || 0;

            state.lap.penalties = lap.m_penalties || 0;
            state.lap.warnings = lap.m_totalWarnings || 0;
            state.lap.cornerCutting = lap.m_cornerCuttingWarnings || 0;
            state.lap.unservedDT = lap.m_numUnservedDriveThroughPens || 0;
            state.lap.unservedSG = lap.m_numUnservedStopGoPens || 0;
            state.lap.scDelta = lap.m_safetyCarDelta || 0;
            state.lap.invalid = lap.m_currentLapInvalid === 1;

            state.penalties = {
                timePenalties: state.lap.penalties,
                warnings: state.lap.warnings,
                cornerCuts: state.lap.cornerCutting,
                driveThrough: state.lap.unservedDT,
                stopGo: state.lap.unservedSG,
                invalidLap: state.lap.invalid ? 1 : 0
            };
        }
    }

    state.session.fastestLapCarIndex = fastestLapIndex;
    state.session.sessionFastestLapMs = sessionFastestLapMs;
    state.session.sessionFastestDriver = fastestLapIndex >= 0 ? (state.participants[fastestLapIndex] || `Car ${fastestLapIndex}`) : 'None';
    state.pitLanePoints = buildApproxPitLane(state.trackPoints);

    state.session.raceDistance = state.session.trackLength * state.session.lapsTotal;
    state.session.lapsLeft = Math.max(0, state.session.lapsTotal - state.lap.lapNum);
});


/**
 * Participants Packet Handler
 * Updates driver names and resolves team colors from the team IDs.
 */
f1Client.on('participants', (data) => {
    touchUdpPacket();
    setPlayerIndex(data.m_header);
    let newNames = [];
    for (let i = 0; i < 22; i++) {
        if (data.m_participants[i]) {
            const p = data.m_participants[i];
            const name = p.m_name ? p.m_name.replace(/\0/g, '').trim() : `CAR ${i}`;
            const teamId = getParticipantTeamId(p);
            const lowerName = name.toLowerCase();

            const isSC = lowerName.includes('safety') || lowerName.includes('medical') || lowerName === 'sc' || lowerName.startsWith('sc ') || (p.m_driverId === 255 && teamId === 255);

            newNames.push(name);
            if (isSC) {
                carDataTracker[i].teamColor = '#FFB000';
                carDataTracker[i].teamName = 'Safety Car';
                carDataTracker[i].isSafetyCar = true;
            } else {
                carDataTracker[i].teamColor = teamMap[teamId] || '#FFFFFF';
                carDataTracker[i].teamName = teamNameMap[teamId] || 'Unknown';
                carDataTracker[i].isSafetyCar = false;
            }
        }
    }
    state.participants = newNames;
});


/**
 * Car Setups Packet Handler
 * Reads the player's current car setup including aero, differential, geometry, and fuel load.
 */
f1Client.on('carSetups', (data) => {
    touchUdpPacket();
    setPlayerIndex(data.m_header);
    const setup = data.m_carSetups[state.playerIndex];
    if (setup) {
        state.setup.wingF = setup.m_frontWing !== undefined ? setup.m_frontWing : state.setup.wingF;
        state.setup.wingR = setup.m_rearWing !== undefined ? setup.m_rearWing : state.setup.wingR;
        state.setup.diffOn = setup.m_onThrottle !== undefined ? setup.m_onThrottle : state.setup.diffOn;
        state.setup.diffOff = setup.m_offThrottle !== undefined ? setup.m_offThrottle : state.setup.diffOff;
        state.setup.engineBraking = setup.m_engineBraking !== undefined ? setup.m_engineBraking : state.setup.engineBraking;
        state.setup.camberF = setup.m_frontCamber !== undefined ? setup.m_frontCamber : state.setup.camberF;
        state.setup.camberR = setup.m_rearCamber !== undefined ? setup.m_rearCamber : state.setup.camberR;
        state.setup.toeF = setup.m_frontToe !== undefined ? setup.m_frontToe : state.setup.toeF;
        state.setup.toeR = setup.m_rearToe !== undefined ? setup.m_rearToe : state.setup.toeR;
        state.setup.suspF = setup.m_frontSuspension !== undefined ? setup.m_frontSuspension : state.setup.suspF;
        state.setup.suspR = setup.m_rearSuspension !== undefined ? setup.m_rearSuspension : state.setup.suspR;
        state.setup.arbF = setup.m_frontAntiRollBar !== undefined ? setup.m_frontAntiRollBar : state.setup.arbF;
        state.setup.arbR = setup.m_rearAntiRollBar !== undefined ? setup.m_rearAntiRollBar : state.setup.arbR;
        state.setup.heightF = setup.m_frontSuspensionHeight !== undefined ? setup.m_frontSuspensionHeight : state.setup.heightF;
        state.setup.heightR = setup.m_rearSuspensionHeight !== undefined ? setup.m_rearSuspensionHeight : state.setup.heightR;
        state.setup.bPressure = setup.m_brakePressure !== undefined ? setup.m_brakePressure : state.setup.bPressure;
        state.setup.bBias = setup.m_brakeBias !== undefined ? setup.m_brakeBias : state.setup.bBias;
        state.setup.pressFLeft = setup.m_frontLeftTyrePressure !== undefined ? setup.m_frontLeftTyrePressure : state.setup.pressFLeft;
        state.setup.pressFRight = setup.m_frontRightTyrePressure !== undefined ? setup.m_frontRightTyrePressure : state.setup.pressFRight;
        state.setup.pressRLeft = setup.m_rearLeftTyrePressure !== undefined ? setup.m_rearLeftTyrePressure : state.setup.pressRLeft;
        state.setup.pressRRight = setup.m_rearRightTyrePressure !== undefined ? setup.m_rearRightTyrePressure : state.setup.pressRRight;
        state.setup.ballast = setup.m_ballast !== undefined ? setup.m_ballast : state.setup.ballast;
        state.setup.fuel = setup.m_fuelLoad !== undefined ? setup.m_fuelLoad : state.setup.fuel;
    }
});


/**
 * Car Telemetry Packet Handler
 * Updates real-time car metrics (speed, throttle, brake, gears, DRS, temps, and pressures) for all cars.
 */
f1Client.on('carTelemetry', (data) => {
    touchUdpPacket();
    setPlayerIndex(data.m_header);
    const pIdx = state.playerIndex;

    for (let i = 0; i < 22; i++) {
        const speed = data.m_carTelemetryData[i].m_speed;
        carPhysics[i].speed = speed;
        if (speed > carDataTracker[i].maxSpeed) carDataTracker[i].maxSpeed = speed;
    }

    const t = data.m_carTelemetryData[pIdx];
    state.inputs.speed = t.m_speed; state.inputs.throttle = t.m_throttle * 100;
    state.inputs.steer = t.m_steer; state.inputs.brake = t.m_brake * 100;
    state.inputs.clutch = t.m_clutch; state.inputs.rpm = t.m_engineRPM;

    const gear = t.m_gear;
    state.inputs.gear = gear === 0 ? 'N' : (gear === -1 ? 'R' : gear);
    state.inputs.drs = t.m_drs === 1 ? 'OPEN' : 'CLOSED';

    state.car.brakeTemp.rl = t.m_brakesTemperature[0]; state.car.brakeTemp.rr = t.m_brakesTemperature[1];
    state.car.brakeTemp.fl = t.m_brakesTemperature[2]; state.car.brakeTemp.fr = t.m_brakesTemperature[3];
    state.car.surfTemp.rl = t.m_tyresSurfaceTemperature[0]; state.car.surfTemp.rr = t.m_tyresSurfaceTemperature[1];
    state.car.surfTemp.fl = t.m_tyresSurfaceTemperature[2]; state.car.surfTemp.fr = t.m_tyresSurfaceTemperature[3];
    state.car.inTemp.rl = t.m_tyresInnerTemperature[0]; state.car.inTemp.rr = t.m_tyresInnerTemperature[1];
    state.car.inTemp.fl = t.m_tyresInnerTemperature[2]; state.car.inTemp.fr = t.m_tyresInnerTemperature[3];
    state.car.press.rl = t.m_tyresPressure[0]; state.car.press.rr = t.m_tyresPressure[1];
    state.car.press.fl = t.m_tyresPressure[2]; state.car.press.fr = t.m_tyresPressure[3];
    state.car.engineTemp = t.m_engineTemperature;
});


/**
 * Car Status Packet Handler
 * Parses tyre compounds, FIA flags, ERS battery levels, and fuel remaining.
 */
f1Client.on('carStatus', (data) => {
    touchUdpPacket();
    setPlayerIndex(data.m_header);
    const pIdx = state.playerIndex;

    for (let i = 0; i < 22; i++) {
        const s = data.m_carStatusData[i];
        const visual = s.m_visualTyreCompound;
        const actual = s.m_actualTyreCompound;

        carDataTracker[i].tyre = visualTyreNames[visual] || fallbackTyreNames[actual] || 'UNK';
        carDataTracker[i].tyreClass = visualTyreColors[visual] || '#808080';
    }

    const pStat = data.m_carStatusData[pIdx];
    if (pStat) {
        state.car.compound = carDataTracker[pIdx].tyre;
        state.car.flag = flagMap[pStat.m_vehicleFiaFlags] || 'GREEN';

        // ERS Deep Telemetry & Strategy
        const ersStore = pStat.m_ersStoreEnergy !== undefined ? pStat.m_ersStoreEnergy : 0;
        const ersDeployMode = pStat.m_ersDeployMode !== undefined ? pStat.m_ersDeployMode : 1;
        const ersHarvestMGUK = pStat.m_ersHarvestedThisLapMGUK || 0;
        const ersHarvestMGUH = pStat.m_ersHarvestedThisLapMGUH || 0;
        const ersDeployed = pStat.m_ersDeployedThisLap || 0;
        const batteryPct = Math.min(100, Math.max(0, (ersStore / 4000000) * 100));

        state.ers = {
            storeJoules: ersStore,
            battery: batteryPct,
            mode: ersMap[ersDeployMode] || 'Medium',
            deployModeInt: ersDeployMode,
            harvestedMGUKJoules: ersHarvestMGUK,
            harvestedMGUHJoules: ersHarvestMGUH,
            harvestedTotalJoules: ersHarvestMGUK + ersHarvestMGUH,
            deployedLapJoules: ersDeployed,
            deployedLapPct: Math.min(100, Math.max(0, (ersDeployed / 4000000) * 100)),
            icePower: pStat.m_enginePowerICE || 0,
            mgukPower: pStat.m_enginePowerMGUK || 0,
            ersRecommendation: (batteryPct < 25) ? 'HARVEST (LOW STORE)' : ((batteryPct > 75) ? 'OVERTAKE AVAILABLE' : 'BALANCED')
        };

        // Fuel Deep Telemetry & Strategy
        const fuelInTank = pStat.m_fuelInTank !== undefined ? pStat.m_fuelInTank : (pStat.m_fuelMass || state.setup.fuel || 0);
        const fuelCapacity = pStat.m_fuelCapacity || 110;
        const fuelRemainingLaps = pStat.m_fuelRemainingLaps || 0;
        const fuelMix = pStat.m_fuelMix !== undefined ? pStat.m_fuelMix : 1;
        const fuelMixMap = { 0: 'Lean', 1: 'Standard', 2: 'Rich', 3: 'Max' };

        state.setup.fuel = fuelInTank;
        state.setup.fuelCapacity = fuelCapacity;
        state.setup.fuelLaps = fuelRemainingLaps;
        state.setup.fuelMix = fuelMixMap[fuelMix] || 'Standard';
        state.car.tyreAge = pStat.m_tyresAgeLaps || 0;

        const completedLaps = carPhysics[pIdx].lapNum > 1 ? (carPhysics[pIdx].lapNum - 1) : 0;
        const lapsLeft = state.session.lapsLeft || Math.max(0, (state.session.lapsTotal || 0) - completedLaps);
        const fuelPerLapNeeded = (lapsLeft > 0 && fuelInTank > 0) ? (fuelInTank / lapsLeft) : 0;

        state.fuel = {
            tankKg: fuelInTank,
            capacityKg: fuelCapacity,
            pct: fuelCapacity > 0 ? Math.min(100, Math.max(0, (fuelInTank / fuelCapacity) * 100)) : 0,
            remainingLapsDelta: fuelRemainingLaps,
            mix: fuelMixMap[fuelMix] || 'Standard',
            mixInt: fuelMix,
            lapsLeft: lapsLeft,
            targetBurnPerLap: fuelPerLapNeeded,
            status: fuelRemainingLaps >= 0.3 ? 'SURPLUS' : (fuelRemainingLaps >= -0.15 ? 'OPTIMAL' : 'DEFICIT (LIFT & COAST)')
        };
    }
});


/**
 * Car Damage Packet Handler
 * Tracks tyre wear percentages for the player's car to feed the pit stop strategy engine.
 */
f1Client.on('carDamage', (data) => {
    touchUdpPacket();
    setPlayerIndex(data.m_header);
    const dmg = data.m_carDamageData[state.playerIndex];
    state.car.wear.rl = dmg.m_tyresWear[0]; state.car.wear.rr = dmg.m_tyresWear[1];
    state.car.wear.fl = dmg.m_tyresWear[2]; state.car.wear.fr = dmg.m_tyresWear[3];
    state.damage = dmg;
});


/**
 * Main Broadcast Loop
 * Runs at the configured tick rate (intervalMs). Aggregates all telemetry, processes the leaderboard 
 * with accurate track gaps/intervals, calculates ghost lap deltas, and broadcasts the state to WebSockets.
 */
setInterval(() => {
    let newLeaderboard = [];


    for (let i = 0; i < 22; i++) {
        if (carDataTracker[i].driverStatus !== 0) {
            newLeaderboard.push({
                carIndex: i,
                ...carDataTracker[i],
                lapDistance: carPhysics[i].lapDistance,
                speed: carPhysics[i].speed,
                lapHistory: (i === state.playerIndex) ? (allLapHistories[i] || []) : []
            });
        }
    }

    if (state.session.sessionCategory === 'TimeAttack') {


        newLeaderboard.sort((a, b) => {
            if (a.bestLapMs === 0 && b.bestLapMs === 0) return a.carIndex - b.carIndex;
            if (a.bestLapMs === 0) return 1;
            if (b.bestLapMs === 0) return -1;
            return a.bestLapMs - b.bestLapMs;
        });

        const poleTimeMs = newLeaderboard.length > 0 ? newLeaderboard[0].bestLapMs : 0;

        newLeaderboard.forEach((driver, idx) => {
            driver.pos = idx + 1;
            if (driver.bestLapMs === 0) {
                driver.gapText = driver.pitStatus > 0 ? 'IN PIT' : 'OUT LAP';
                driver.leadSec = 9999;
                driver.intSec = 9999;
            } else if (idx === 0) {
                const mins = Math.floor(driver.bestLapMs / 60000);
                const secs = ((driver.bestLapMs % 60000) / 1000).toFixed(3);
                driver.gapText = `${mins}:${secs.padStart(6, '0')}`;
                driver.leadSec = 0;
                driver.intSec = 0;
            } else {
                const diff = (driver.bestLapMs - poleTimeMs) / 1000;
                driver.gapText = `+${diff.toFixed(3)}`;
                driver.leadSec = diff;
                const prev = newLeaderboard[idx - 1];
                const intDiff = (driver.bestLapMs - (prev.bestLapMs || poleTimeMs)) / 1000;
                driver.intSec = Math.max(0, intDiff);
            }
        });

    } else {
        newLeaderboard = newLeaderboard.filter(d => d.pos > 0 && d.pos <= 22);
        newLeaderboard.sort((a, b) => a.pos - b.pos);

        const leader = newLeaderboard.length > 0 ? newLeaderboard[0] : null;
        const pLeader = leader ? carPhysics[leader.carIndex] : null;
        const tLen = (state.session.trackLength > 0) ? state.session.trackLength : 5000;
        const avgSpeedMs = Math.max(45, (tLen / 80)); // Circuit average racing speed (~180-230 km/h)

        newLeaderboard.forEach((driver, idx) => {
            if (driver.pitStatus === 1 || driver.pitStatus === 2) {
                driver.gapText = 'PIT';
                driver.gapInt = 'PIT';
                driver.gapLead = 'PIT';
                driver.leadSec = 9999;
                driver.intSec = 9999;
            } else if (idx === 0) {
                driver.gapText = 'Interval';
                driver.gapInt = 'LEAD';
                driver.gapLead = 'LEAD';
                driver.leadSec = 0;
                driver.intSec = 0;
            } else {
                const driverAhead = newLeaderboard[idx - 1];
                const pCurr = carPhysics[driver.carIndex];
                const pAhead = carPhysics[driverAhead.carIndex];

                // Calculate distance to car ahead across lap boundary
                const lapDiffAhead = (pAhead && pAhead.lapNum !== undefined) ? (pAhead.lapNum - pCurr.lapNum) : 0;
                let distToAhead = 0;
                if (pAhead) {
                    if (lapDiffAhead === 0) {
                        distToAhead = Math.max(0, pAhead.lapDistance - pCurr.lapDistance);
                    } else if (lapDiffAhead === 1) {
                        distToAhead = Math.max(0, (tLen - pCurr.lapDistance) + pAhead.lapDistance);
                    } else if (lapDiffAhead > 1) {
                        distToAhead = Math.max(0, (tLen - pCurr.lapDistance) + pAhead.lapDistance + (tLen * (lapDiffAhead - 1)));
                    }
                }

                // Check if car ahead is in pit
                if (driverAhead.pitStatus > 0 && distToAhead > 100) {
                    driver.gapText = pCurr.lastValidDelta > 0 ? `+${pCurr.lastValidDelta.toFixed(3)}` : 'PIT AHEAD';
                    driver.gapInt = driver.gapText;
                    driver.intSec = pCurr.lastValidDelta || 0;
                } else if (lapDiffAhead >= 1 && distToAhead >= tLen * 0.75) {
                    // Truly a lap down on the car directly ahead
                    driver.gapText = `+${lapDiffAhead} LAP${lapDiffAhead > 1 ? 'S' : ''}`;
                    driver.gapInt = driver.gapText;
                    driver.intSec = lapDiffAhead * 80;
                } else {
                    // Same race lap or just crossed the finish line earlier
                    let intervalSec = 0;
                    if (pCurr.officialDelta > 0 && pCurr.officialDelta < 150) {
                        intervalSec = pCurr.officialDelta;
                        pCurr.lastValidDelta = intervalSec;
                    } else if (pCurr.lastValidDelta > 0 && Math.abs(lapDiffAhead) <= 1) {
                        // Smoothly hold last valid delta across finish line until next sector beacon
                        intervalSec = pCurr.lastValidDelta;
                    } else {
                        // Smooth fallback using circuit average speed (no jitter when braking)
                        intervalSec = Math.max(0.001, distToAhead / avgSpeedMs);
                    }
                    driver.gapText = `+${intervalSec.toFixed(3)}`;
                    driver.gapInt = `+${intervalSec.toFixed(3)}`;
                    driver.intSec = intervalSec;
                }

                // Calculate Gap to Race Leader (gapLead)
                if (pLeader) {
                    const lapsDownLeader = (pLeader.lapNum !== undefined) ? (pLeader.lapNum - pCurr.lapNum) : 0;
                    let distToLeader = 0;
                    if (lapsDownLeader === 0) {
                        distToLeader = Math.max(0, pLeader.lapDistance - pCurr.lapDistance);
                    } else if (lapsDownLeader === 1) {
                        distToLeader = Math.max(0, (tLen - pCurr.lapDistance) + pLeader.lapDistance);
                    } else if (lapsDownLeader > 1) {
                        distToLeader = Math.max(0, (tLen - pCurr.lapDistance) + pLeader.lapDistance + (tLen * (lapsDownLeader - 1)));
                    }

                    if (lapsDownLeader >= 1 && distToLeader >= tLen * 0.75) {
                        driver.gapLead = `+${lapsDownLeader} LAP${lapsDownLeader > 1 ? 'S' : ''}`;
                        driver.leadSec = lapsDownLeader * 80;
                    } else {
                        let leadSec = 0;
                        if (pCurr.officialLeaderDelta > 0 && pCurr.officialLeaderDelta < 300) {
                            leadSec = pCurr.officialLeaderDelta;
                            pCurr.lastValidLeaderDelta = leadSec;
                        } else if (pCurr.lastValidLeaderDelta > 0 && Math.abs(lapsDownLeader) <= 1) {
                            leadSec = pCurr.lastValidLeaderDelta;
                        } else {
                            leadSec = Math.max(0.001, distToLeader / avgSpeedMs);
                        }
                        driver.gapLead = `+${leadSec.toFixed(3)}`;
                        driver.leadSec = leadSec;
                    }
                } else {
                    driver.gapLead = driver.gapText;
                    driver.leadSec = driver.intSec || 0;
                }
            }
        });
    }


    state.leaderboard = newLeaderboard;
    state.allLapHistories = allLapHistories;
    const pIdx = state.playerIndex;
    const playerLbIndex = state.leaderboard.findIndex(d => d.carIndex === pIdx);
    const playerLbInfo = playerLbIndex >= 0 ? state.leaderboard[playerLbIndex] : null;

    if (playerLbInfo) {
        state.lap.gapFront = playerLbInfo.gapText || '+0.000';
        
        // Driver Ahead Info (Race Interval or Quali Target)
        if (playerLbIndex > 0) {
            const carAhead = state.leaderboard[playerLbIndex - 1];
            state.lap.driverAhead = (state.participants && state.participants[carAhead.carIndex]) ? state.participants[carAhead.carIndex] : (carAhead.teamName || `Car ${carAhead.carIndex}`);
            state.lap.driverAheadCarIndex = carAhead.carIndex;
            state.lap.driverAheadTyre = carAhead.tyre || 'UNK';
            state.lap.driverAheadTeamColor = carAhead.teamColor || '#FFF';
            state.lap.targetAheadDriver = state.lap.driverAhead;
            state.lap.targetAheadBestMs = carAhead.bestLapMs || 0;
            state.lap.targetAheadDeltaMs = (playerLbInfo.bestLapMs > 0 && carAhead.bestLapMs > 0) ? (playerLbInfo.bestLapMs - carAhead.bestLapMs) : null;
        } else {
            state.lap.driverAhead = 'LEADER';
            state.lap.driverAheadCarIndex = -1;
            state.lap.driverAheadTyre = '';
            state.lap.driverAheadTeamColor = '#FFD700';
            state.lap.targetAheadDriver = 'PROVISIONAL POLE';
            state.lap.targetAheadBestMs = playerLbInfo.bestLapMs || 0;
            state.lap.targetAheadDeltaMs = 0;
        }

        // Driver Behind Info & DRS Threat Calculation
        if (playerLbIndex < state.leaderboard.length - 1 && playerLbIndex >= 0) {
            const carBehind = state.leaderboard[playerLbIndex + 1];
            state.lap.driverBehind = (state.participants && state.participants[carBehind.carIndex]) ? state.participants[carBehind.carIndex] : (carBehind.teamName || `Car ${carBehind.carIndex}`);
            state.lap.driverBehindCarIndex = carBehind.carIndex;
            state.lap.gapBehind = carBehind.gapInt || carBehind.gapText || '+0.000';
            state.lap.driverBehindTyre = carBehind.tyre || 'UNK';
            state.lap.driverBehindTeamColor = carBehind.teamColor || '#FFF';

            // Check if car behind is within DRS range (< 1.000s)
            let gapBehindSec = 999;
            const parsedGap = parseFloat(String(state.lap.gapBehind || '').replace(/[^0-9.]/g, ''));
            if (!isNaN(parsedGap) && !String(state.lap.gapBehind).includes('LAP') && !String(state.lap.gapBehind).includes('PIT')) {
                gapBehindSec = parsedGap;
            }
            state.lap.drsThreat = gapBehindSec <= 1.0 && gapBehindSec > 0;
            state.lap.gapBehindSec = gapBehindSec < 999 ? gapBehindSec : null;
        } else {
            state.lap.driverBehind = 'NONE';
            state.lap.driverBehindCarIndex = -1;
            state.lap.gapBehind = '--';
            state.lap.driverBehindTyre = '';
            state.lap.driverBehindTeamColor = '#888888';
            state.lap.drsThreat = false;
            state.lap.gapBehindSec = null;
        }
    }

    // Physical On-Track Proximity (Traffic / Clean Air Radar in meters)
    let nearestAheadDist = Infinity;
    let nearestAheadDriver = 'CLEAR AIR';
    let nearestBehindDist = Infinity;
    let nearestBehindDriver = 'CLEAR';
    const playerDist = carPhysics[pIdx]?.lapDistance || 0;
    const tLen = state.session.trackLength || 5000;

    if (playerDist > 0 && tLen > 0) {
        for (let cIdx = 0; cIdx < 22; cIdx++) {
            if (cIdx === pIdx || carDataTracker[cIdx].driverStatus === 0) continue;
            const otherDist = carPhysics[cIdx]?.lapDistance || 0;
            if (otherDist <= 0) continue;
            const dName = (state.participants && state.participants[cIdx]) ? state.participants[cIdx] : `Car ${cIdx}`;

            // Distance ahead on circuit
            let distAhead = otherDist - playerDist;
            if (distAhead < 0) distAhead += tLen;
            if (distAhead > 0 && distAhead < nearestAheadDist) {
                nearestAheadDist = distAhead;
                nearestAheadDriver = dName;
            }

            // Distance behind on circuit
            let distBehind = playerDist - otherDist;
            if (distBehind < 0) distBehind += tLen;
            if (distBehind > 0 && distBehind < nearestBehindDist) {
                nearestBehindDist = distBehind;
                nearestBehindDriver = dName;
            }
        }
    }

    state.lap.trafficAheadDist = Number.isFinite(nearestAheadDist) && nearestAheadDist < tLen ? Math.round(nearestAheadDist) : null;
    state.lap.trafficAheadDriver = nearestAheadDriver;
    state.lap.trafficBehindDist = Number.isFinite(nearestBehindDist) && nearestBehindDist < tLen ? Math.round(nearestBehindDist) : null;
    state.lap.trafficBehindDriver = nearestBehindDriver;

    // Delta vs Session Fastest Lap Calculation (Quali Pole Delta)
    const sessFastest = (state.session.sessionFastestLapMs !== Infinity && state.session.sessionFastestLapMs > 0) ? state.session.sessionFastestLapMs : 0;
    state.session.sessionFastestLapMs = sessFastest;

    const sb1 = (state.session.sessionBestS1 !== Infinity && state.session.sessionBestS1 > 0) ? state.session.sessionBestS1 : (state.session.referenceS1 || 0);
    const sb2 = (state.session.sessionBestS2 !== Infinity && state.session.sessionBestS2 > 0) ? state.session.sessionBestS2 : (state.session.referenceS2 || 0);
    const sb3 = (state.session.sessionBestS3 !== Infinity && state.session.sessionBestS3 > 0) ? state.session.sessionBestS3 : (state.session.referenceS3 || 0);
    state.session.sessionBestS1 = sb1;
    state.session.sessionBestS2 = sb2;
    state.session.sessionBestS3 = sb3;
    state.session.theoreticalBestLapMs = (sb1 > 0 && sb2 > 0 && sb3 > 0) ? (sb1 + sb2 + sb3) : 0;

    if (sessFastest > 0) {
        state.lap.deltaToSessionFastest = state.lap.bestMs > 0 ? (state.lap.bestMs - sessFastest) : null;
        state.lap.lastLapDeltaToSessionFastest = state.lap.lastMs > 0 ? (state.lap.lastMs - sessFastest) : null;
        state.lap.isSessionFastest = (state.lap.bestMs > 0 && state.lap.bestMs <= sessFastest);
    } else {
        state.lap.deltaToSessionFastest = null;
        state.lap.lastLapDeltaToSessionFastest = null;
        state.lap.isSessionFastest = false;
    }

    // --- Live Ghost Delta Calculation ---
    state.lap.liveDeltaToRecord = 0;
    state.lap.ghostLapTimeMs = 0;
    if (fastestLapGhostData && fastestLapGhostData.length > 0) {
        state.lap.ghostLapTimeMs = fastestLapGhostData[fastestLapGhostData.length - 1].t;

        if (state.lap.currentMs > 0 && carPhysics[pIdx].lapDistance > 0) {
            const pDist = carPhysics[pIdx].lapDistance;

            let ghostTimeAtDist = 0;
            let idx = fastestLapGhostData.findIndex(pt => pt.d >= pDist);

            if (idx === 0) {
                ghostTimeAtDist = fastestLapGhostData[0].t;
            } else if (idx > 0) {
                const pt1 = fastestLapGhostData[idx - 1];
                const pt2 = fastestLapGhostData[idx];
                const rangeDist = pt2.d - pt1.d;
                if (rangeDist > 0) {
                    const ratio = (pDist - pt1.d) / rangeDist;
                    ghostTimeAtDist = pt1.t + (pt2.t - pt1.t) * ratio;
                } else {
                    ghostTimeAtDist = pt2.t;
                }
            } else {
                // If pDist is further than ghost ever reached
                ghostTimeAtDist = fastestLapGhostData[fastestLapGhostData.length - 1].t;
            }

            if (ghostTimeAtDist > 0) {
                state.lap.liveDeltaToRecord = state.lap.currentMs - ghostTimeAtDist;
            }
        }
    }

    // Check if telemetry packets are actively being received from F1 24/25 UDP
    const now = Date.now();
    const isGameActive = (lastUdpPacketTime > 0) && (now - lastUdpPacketTime < 2500);
    state.isGameActive = isGameActive;
    state.lastUdpAgeMs = lastUdpPacketTime > 0 ? (now - lastUdpPacketTime) : null;

    if (!isGameActive) {
        state.inputs.throttle = 0;
        state.inputs.brake = 0;
        state.inputs.clutch = 0;
        state.inputs.steer = 0;
        state.inputs.speed = 0;
        state.inputs.rpm = 0;
    }

    clients = clients.filter(ws => ws.readyState === WebSocket.OPEN);

    // Build ultra-lean broadcast payload for 20Hz continuous streaming
    // Drastically lowers bandwidth and CPU load for mobile browsers on WiFi (Android / iOS / Tablets)
    const playerIdx = state.playerIndex;
    broadcastTick++;

    // Send full trackPoints ONLY on track change or initial load (trackPointsDirty),
    // otherwise send [] during continuous 20Hz streaming (saves 19.2 KB on EVERY tick!)
    const sendTrack = trackPointsDirty && state.trackPoints && state.trackPoints.length > 0;
    if (trackPointsDirty) trackPointsDirty = false;

    // Send bulky allLapHistories dictionary at 1Hz or when a lap finishes/updates (lapHistoryDirty),
    // eliminating 70KB+ redundant payload on 19 out of 20 ticks!
    const sendLapHistory = lapHistoryDirty || (broadcastTick % 20 === 0);
    if (lapHistoryDirty) lapHistoryDirty = false;

    const streamState = {
        ...state,
        trackPoints: sendTrack ? state.trackPoints : [],
        pitLanePoints: sendTrack ? state.pitLanePoints : [],
        leaderboard: state.leaderboard,
        allLapHistories: sendLapHistory ? allLapHistories : {},
        motion: {
            ...state.motion,
            gEnvelopeArray: (gForceData.envelopeArray || []).slice(-25),
            gHistory: (gForceData.history || []).slice(-15)
        }
    };

    const payload = JSON.stringify(streamState);
    clients.forEach((ws) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        // Non-destructive real-time frame dropping: if client socket has pending data in flight,
        // drop intermediate frames so TCP queue never builds up and client never lags behind.
        // Never terminate the connection - client seamlessly receives the next fresh live frame when ready.
        if (ws.bufferedAmount > 64 * 1024) {
            return;
        }
        try {
            ws.send(payload);
        } catch (e) {
            // Socket errors are cleanly caught and handled by ws.on('error') / ws.on('close')
        }
    });
}, intervalMs);

f1Client.start();
console.log(`🏎️  UNIFIED COMMAND CENTER ONLINE (${hz}Hz)`);
console.log('Listening for UDP on port 20777...');

/**
 * Helper to display all available local network IP addresses for the dashboard server.
 */
function displayAllLocalIPv4() {
    const interfaces = os.networkInterfaces();
    console.log('\n📡 --- Available Network Dashboards ---');

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {

            if (iface.family === 'IPv4' && !iface.internal) {
                console.log(`➡️  ${name}: http://${iface.address}:${PORT}`);
            }
        }
    }
    console.log(`➡️  Localhost: http://localhost:${PORT}`);
    console.log('--------------------------------------');

    /*try {
        const htmlPages = getAllHtmlFiles();
        if (htmlPages.length > 0) {
            console.log('📄 Available HTML Pages & Dashboards:');
            for (const page of htmlPages) {
                const titleStr = `🏁 ${page.title}`;
                console.log(`   ${titleStr.padEnd(46)} -> http://localhost:${PORT}${page.urlPath}`);
            }
            console.log(`   📑 Dashboards Hub & Directory:                 -> http://localhost:${PORT}/pages`);
            console.log('--------------------------------------\n');
        }
    } catch (e) {
        console.log('--------------------------------------\n');
    }*/
}

server.on('error', (err) => {
    console.error('🛡️ [HTTP Server Error]:', err?.message || err);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on all IPs at port ${PORT}`);
    displayAllLocalIPv4();
});

