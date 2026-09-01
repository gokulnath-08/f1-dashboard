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

function absDiff(a, b) {
    return Math.abs((a || 0) - (b || 0));
}

module.exports = {
    formatMsExport,
    formatSectorMs,
    absDiff
};
