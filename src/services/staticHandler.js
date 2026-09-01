const fs = require('fs');
const path = require('path');
const { rootDir, PORT, hz, IGNORED_SCAN_DIRS } = require('../config');

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
function getAllHtmlFiles(dir = rootDir, relPrefix = '') {
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
        const indexPath = path.join(rootDir, 'index.html');
        return fs.existsSync(indexPath) ? indexPath : null;
    }

    const relPath = cleanUrl.startsWith('/') ? cleanUrl.slice(1) : cleanUrl;
    const directPath = path.resolve(rootDir, relPath);

    // Security: Do not allow directory traversal outside project root
    if (!directPath.startsWith(rootDir)) return null;

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

module.exports = {
    MIME_TYPES,
    extractHtmlTitle,
    getAllHtmlFiles,
    resolveRequestedFile,
    renderHtmlDirectoryPage
};
