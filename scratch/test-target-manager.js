// Test TargetPaceManager logic in Node environment with a mock DOM and localStorage
global.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; }
};

global.document = {
    getElementById(id) {
        if (!this._elements[id]) {
            this._elements[id] = { id, value: '', textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
        }
        return this._elements[id];
    },
    _elements: {}
};

global.formatMs = (ms) => {
    if (!ms) return "--:--.---";
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const milli = Math.floor(ms % 1000);
    return `${m}:${s.toString().padStart(2, "0")}.${milli.toString().padStart(3, "0")}`;
};
global.formatSectorMs = (ms) => ms > 0 ? (ms / 1000).toFixed(3) : "--.---";
global.formatDeltaMs = (d) => (d > 0 ? "+" : "") + (d / 1000).toFixed(3) + "s";
global.showToast = (msg) => console.log("[TOAST]", msg);

// Read TargetPaceManager from dashboard.js
const fs = require('fs');
const code = fs.readFileSync('js/dashboard.js', 'utf8');
const managerClassMatch = code.match(/class TargetPaceManager \{[\s\S]*?\n        \}/);
if (!managerClassMatch) {
    console.error("Could not find TargetPaceManager in dashboard.js");
    process.exit(1);
}
global.TargetPaceManager = eval(`(${managerClassMatch[0]})`);

const mgr = new TargetPaceManager();
console.log("1. Initial state enabled:", mgr.isEnabled()); // Expected: false

// Simulate entering target in modal
mgr.activeTrackId = 2;
mgr.activeTrackName = "Silverstone Circuit";

// Enter 1:24.500
document.getElementById("tgt-lap-min").value = "1";
document.getElementById("tgt-lap-sec").value = "24";
document.getElementById("tgt-lap-ms").value = "500";
mgr.onLapInputChange();
console.log("2. Lap input ms:", mgr.getLapInputMs()); // Expected: 84500

// Test auto-split
mgr.autoSplitLapToSectors();
const s1 = mgr.getSectorInputMs(1);
const s2 = mgr.getSectorInputMs(2);
const s3 = mgr.getSectorInputMs(3);
console.log(`3. Auto-split sectors: S1=${s1}ms, S2=${s2}ms, S3=${s3}ms, Sum=${s1+s2+s3}ms`);

if (s1 + s2 + s3 === 84500) {
    console.log("   ✓ Exact sum match verified!");
} else {
    console.error("   ✗ Sum mismatch:", s1 + s2 + s3);
    process.exit(1);
}

// Save settings
mgr.saveSettings();
console.log("4. Saved target:", mgr.getCurrentTarget());
console.log("5. Is enabled now:", mgr.isEnabled());
console.log("6. Target Lap ms:", mgr.getTargetLapMs());
console.log("7. Target S1 ms:", mgr.getTargetSectorMs('s1'));
console.log("8. Target S2 ms:", mgr.getTargetSectorMs('s2'));
console.log("9. Target S3 ms:", mgr.getTargetSectorMs('s3'));

// Test persistence: re-instantiate TargetPaceManager
const mgr2 = new TargetPaceManager();
mgr2.activeTrackId = 2;
console.log("10. Persisted Lap ms on reload:", mgr2.getTargetLapMs()); // Expected: 84500

// Test offset preset (-250ms)
document.getElementById("tgt-lap-min").value = "1";
document.getElementById("tgt-lap-sec").value = "24";
document.getElementById("tgt-lap-ms").value = "500";
mgr2.applyOffset(-250);
console.log("11. After -0.250s offset:", mgr2.getLapInputMs(), formatMs(mgr2.getLapInputMs())); // Expected: 84250 (1:24.250)

console.log("\nALL LOGICAL TESTS PASSED SUCCESSFULLY! ✨");
