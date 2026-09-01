/**
 * Official F1 Track Sector Distance Catalog (in metres).
 * Represents the official FIA timing line locations along the circuit.
 */
const OFFICIAL_TRACK_SECTOR_DISTANCES = {
    0: { s1: 1720, s2: 3680, len: 5278 }, // Melbourne (Albert Park)
    2: { s1: 1418, s2: 2985, len: 5451 }, // Shanghai
    3: { s1: 1800, s2: 4001, len: 5412 }, // Sakhir (Bahrain)
    4: { s1: 1512, s2: 3194, len: 4657 }, // Catalunya (Barcelona)
    5: { s1: 1059, s2: 2470, len: 3337 }, // Monaco
    6: { s1: 1450, s2: 3100, len: 4361 }, // Montreal (Circuit Gilles Villeneuve)
    7: { s1: 1750, s2: 3980, len: 5891 }, // Silverstone
    9: { s1: 1268, s2: 2953, len: 4381 }, // Hungaroring
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
    31: { s1: 1704, s2: 3376, len: 6201 }, // Las Vegas
    32: { s1: 1680, s2: 3720, len: 5419 }, // Losail (Qatar)
    42: { s1: 1215, s2: 3162, len: 5474 }  // Madrid
};

/**
 * Official F1 DRS Zones Catalog.
 * Contains FIA activation zones and detection points by circuit fraction and approximate distance.
 */
const OFFICIAL_TRACK_DRS_ZONES = {
    0: [{ start: 0.96, end: 0.12, det: 0.91 }, { start: 0.22, end: 0.34, det: 0.18 }, { start: 0.53, end: 0.65, det: 0.49 }],
    2: [{ start: 0.95, end: 0.12, det: 0.90 }, { start: 0.58, end: 0.78, det: 0.54 }],
    3: [{ start: 0.96, end: 0.13, det: 0.91 }, { start: 0.22, end: 0.34, det: 0.18 }, { start: 0.60, end: 0.72, det: 0.56 }],
    4: [{ start: 0.97, end: 0.13, det: 0.92 }, { start: 0.48, end: 0.64, det: 0.45 }],
    5: [{ start: 0.95, end: 0.08, det: 0.91 }],
    6: [{ start: 0.93, end: 0.09, det: 0.88 }, { start: 0.75, end: 0.90, det: 0.72 }],
    7: [{ start: 0.28, end: 0.42, det: 0.24 }, { start: 0.68, end: 0.83, det: 0.64 }],
    9: [{ start: 0.96, end: 0.12, det: 0.91 }, { start: 0.16, end: 0.26, det: 0.13 }],
    10: [{ start: 0.18, end: 0.35, det: 0.14 }, { start: 0.94, end: 0.06, det: 0.90 }],
    11: [{ start: 0.95, end: 0.13, det: 0.91 }, { start: 0.36, end: 0.49, det: 0.32 }],
    12: [{ start: 0.96, end: 0.10, det: 0.92 }, { start: 0.25, end: 0.36, det: 0.21 }, { start: 0.60, end: 0.72, det: 0.56 }],
    13: [{ start: 0.93, end: 0.07, det: 0.88 }],
    14: [{ start: 0.32, end: 0.46, det: 0.28 }, { start: 0.50, end: 0.63, det: 0.47 }],
    15: [{ start: 0.96, end: 0.11, det: 0.92 }, { start: 0.38, end: 0.54, det: 0.34 }],
    16: [{ start: 0.88, end: 0.10, det: 0.84 }, { start: 0.18, end: 0.31, det: 0.14 }],
    17: [{ start: 0.96, end: 0.11, det: 0.92 }, { start: 0.17, end: 0.31, det: 0.13 }, { start: 0.39, end: 0.49, det: 0.35 }],
    19: [{ start: 0.92, end: 0.12, det: 0.88 }, { start: 0.18, end: 0.29, det: 0.15 }, { start: 0.62, end: 0.72, det: 0.58 }],
    20: [{ start: 0.85, end: 0.14, det: 0.81 }, { start: 0.20, end: 0.30, det: 0.17 }],
    26: [{ start: 0.90, end: 0.09, det: 0.86 }, { start: 0.28, end: 0.38, det: 0.25 }],
    27: [{ start: 0.96, end: 0.10, det: 0.92 }],
    29: [{ start: 0.93, end: 0.10, det: 0.88 }, { start: 0.18, end: 0.31, det: 0.14 }, { start: 0.59, end: 0.71, det: 0.55 }],
    30: [{ start: 0.90, end: 0.06, det: 0.85 }, { start: 0.22, end: 0.36, det: 0.18 }, { start: 0.58, end: 0.80, det: 0.54 }],
    31: [{ start: 0.14, end: 0.243, det: 0.119 }, { start: 0.593, end: 0.822, det: 0.543 }],
    32: [{ start: 0.93, end: 0.07, det: 0.88 }],
    39: [{ start: 0.58, end: 0.72, det: 0.54 }, { start: 0.18, end: 0.32, det: 0.14 }],
    40: [{ start: 0.42, end: 0.55, det: 0.38 }, { start: 0.64, end: 0.80, det: 0.60 }],
    41: [{ start: 0.62, end: 0.72, det: 0.58 }, { start: 0.91, end: 0.10, det: 0.87 }],
    42: [{ start: 0.96, end: 0.12, det: 0.92 }, { start: 0.45, end: 0.60, det: 0.41 }]
};

module.exports = {
    OFFICIAL_TRACK_SECTOR_DISTANCES,
    OFFICIAL_TRACK_DRS_ZONES
};
