const fs = require('fs');
const path = require('path');
const { trackMapsDir, lapTimeDir, telemetryDir, setupsDir } = require('../config');

// Ensure required directories exist for storing track data and ghost laps
function initDirectories() {
    if (!fs.existsSync(trackMapsDir)) {
        fs.mkdirSync(trackMapsDir, { recursive: true });
        console.log('📁 Created track_maps directory for saving circuits.');
    }

    if (!fs.existsSync(lapTimeDir)) {
        fs.mkdirSync(lapTimeDir, { recursive: true });
        console.log('📁 Created laptime directory for saving track records.');
    }

    if (!fs.existsSync(telemetryDir)) {
        fs.mkdirSync(telemetryDir, { recursive: true });
        console.log('📁 Created telemetry directory for full lap data.');
    }

    if (!fs.existsSync(setupsDir)) {
        fs.mkdirSync(setupsDir, { recursive: true });
        console.log('📁 Created setups directory for car setups.');
    }
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

module.exports = {
    initDirectories,
    safeWriteJson,
    safeSaveTrackMap
};
