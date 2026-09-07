const fs = require('fs');
const path = require('path');
const { customTargetsPath } = require('../config');
const { safeWriteJson } = require('../utils/fileSystem');

let cachedTargetsState = {
    targets: {},
    permanentTarget: null,
    updatedAt: 0
};

function loadCustomTargetsFromDisk() {
    try {
        if (fs.existsSync(customTargetsPath)) {
            const raw = fs.readFileSync(customTargetsPath, 'utf8').trim();
            if (raw) {
                const parsed = JSON.parse(raw);
                cachedTargetsState.targets = parsed.targets || {};
                cachedTargetsState.permanentTarget = parsed.permanentTarget || null;
                cachedTargetsState.updatedAt = parsed.updatedAt || Date.now();
                return cachedTargetsState;
            }
        }
    } catch (err) {
        console.warn('⚠️ [TargetService] Could not read custom_targets.json:', err.message);
    }
    return cachedTargetsState;
}

function getCustomTargetsData() {
    // If not loaded yet, attempt initial load
    if (cachedTargetsState.updatedAt === 0) {
        loadCustomTargetsFromDisk();
    }
    return {
        targets: { ...cachedTargetsState.targets },
        permanentTarget: cachedTargetsState.permanentTarget ? { ...cachedTargetsState.permanentTarget } : null,
        updatedAt: cachedTargetsState.updatedAt
    };
}

function saveCustomTargetsData(targets, permanentTarget) {
    cachedTargetsState.targets = targets && typeof targets === 'object' ? targets : {};
    cachedTargetsState.permanentTarget = permanentTarget && typeof permanentTarget === 'object' ? permanentTarget : null;
    cachedTargetsState.updatedAt = Date.now();

    try {
        safeWriteJson(customTargetsPath, cachedTargetsState, true);
        console.log(`🎯 [TargetService] Custom targets permanently saved to disk at ${path.basename(customTargetsPath)}`);
    } catch (err) {
        console.error('❌ [TargetService] Failed to save custom_targets.json:', err.message);
    }

    return getCustomTargetsData();
}

// Initial warm-up
loadCustomTargetsFromDisk();

module.exports = {
    loadCustomTargetsFromDisk,
    getCustomTargetsData,
    saveCustomTargetsData
};
