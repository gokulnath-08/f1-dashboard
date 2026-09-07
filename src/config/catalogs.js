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

/**
 * Official F1 2026 Straight Mode (Active Aerodynamics / X-Mode) Zones Catalog.
 * In the 2026 technical regulations, DRS is replaced by Straight Mode on circuit straights.
 * All cars can deploy Straight Mode on designated straightaways (no detection zone needed).
 */
const OFFICIAL_TRACK_STRAIGHT_MODE_ZONES = {
    0: [{ start: 0.96, end: 0.12, label: 'Main Straight' }, { start: 0.22, end: 0.35, label: 'Lakeside Straight' }, { start: 0.53, end: 0.66, label: 'Back Straight' }],
    2: [{ start: 0.95, end: 0.12, label: 'Pit Straight' }, { start: 0.58, end: 0.79, label: 'Super Straight' }],
    3: [{ start: 0.96, end: 0.13, label: 'Main Straight' }, { start: 0.22, end: 0.35, label: 'Back Straight' }, { start: 0.60, end: 0.72, label: 'Outer Straight' }],
    4: [{ start: 0.97, end: 0.14, label: 'Main Straight' }, { start: 0.48, end: 0.65, label: 'Back Straight' }],
    5: [{ start: 0.45, end: 0.58, label: 'Tunnel Straight' }, { start: 0.95, end: 0.08, label: 'Pit Straight' }],
    6: [{ start: 0.74, end: 0.91, label: 'Casino Straight' }, { start: 0.93, end: 0.09, label: 'Pit Straight' }],
    7: [{ start: 0.27, end: 0.43, label: 'Wellington Straight' }, { start: 0.67, end: 0.84, label: 'Hangar Straight' }],
    9: [{ start: 0.96, end: 0.12, label: 'Main Straight' }, { start: 0.16, end: 0.26, label: 'Turn 1-2 Straight' }],
    10: [{ start: 0.17, end: 0.36, label: 'Kemmel Straight' }, { start: 0.93, end: 0.07, label: 'Blanchimont Straight' }],
    11: [{ start: 0.94, end: 0.14, label: 'Rettifilo Main Straight' }, { start: 0.20, end: 0.32, label: 'Curva Grande Straight' }, { start: 0.48, end: 0.60, label: 'Serraglio Straight' }],
    12: [{ start: 0.96, end: 0.10, label: 'Main Straight' }, { start: 0.24, end: 0.37, label: 'Raffles Boulevard' }, { start: 0.59, end: 0.73, label: 'Bay Straight' }],
    13: [{ start: 0.93, end: 0.08, label: 'Pit Straight' }, { start: 0.72, end: 0.85, label: '130R Back Straight' }],
    14: [{ start: 0.31, end: 0.47, label: 'Super Back Straight' }, { start: 0.49, end: 0.64, label: 'Secondary Straight' }],
    15: [{ start: 0.37, end: 0.55, label: 'Long Back Straight' }, { start: 0.96, end: 0.12, label: 'Pit Straight' }],
    16: [{ start: 0.17, end: 0.32, label: 'Reta Oposta' }, { start: 0.87, end: 0.11, label: 'Arquibancadas Straight' }],
    17: [{ start: 0.96, end: 0.12, label: 'Start-Finish Straight' }, { start: 0.16, end: 0.32, label: 'Remus Straight' }, { start: 0.38, end: 0.50, label: 'Rauch Straight' }],
    19: [{ start: 0.91, end: 0.13, label: 'Main Straight' }, { start: 0.17, end: 0.30, label: 'Middle Straight' }, { start: 0.61, end: 0.73, label: 'Stadium Approach' }],
    20: [{ start: 0.84, end: 0.15, label: 'Neftchilar Avenue 2.2km Straight' }, { start: 0.19, end: 0.31, label: 'Turn 2-3 Straight' }],
    26: [{ start: 0.89, end: 0.10, label: 'Main Pit Straight' }, { start: 0.27, end: 0.39, label: 'Hunserug Straight' }],
    27: [{ start: 0.95, end: 0.11, label: 'Main Pit Straight' }, { start: 0.24, end: 0.36, label: 'Tosa Approach Straight' }],
    29: [{ start: 0.92, end: 0.11, label: 'Main Pit Straight' }, { start: 0.17, end: 0.32, label: 'Lagoon Straight' }, { start: 0.58, end: 0.72, label: 'Red Sea Straight' }],
    30: [{ start: 0.57, end: 0.81, label: 'Hard Rock Stadium Back Straight' }, { start: 0.90, end: 0.07, label: 'Pit Straight' }, { start: 0.21, end: 0.37, label: 'Turn 8-11 Straight' }],
    31: [{ start: 0.58, end: 0.83, label: 'The Strip 1.9km Straight' }, { start: 0.13, end: 0.25, label: 'Koval Lane Straight' }, { start: 0.88, end: 0.05, label: 'Harmon Avenue Straight' }],
    32: [{ start: 0.92, end: 0.08, label: '1km Main Straight' }, { start: 0.45, end: 0.58, label: 'Turn 10-12 Straight' }],
    39: [{ start: 0.18, end: 0.33, label: 'Straight 1' }, { start: 0.57, end: 0.73, label: 'Straight 2' }],
    40: [{ start: 0.41, end: 0.56, label: 'Straight 1' }, { start: 0.63, end: 0.81, label: 'Straight 2' }],
    41: [{ start: 0.61, end: 0.73, label: 'Straight 1' }, { start: 0.90, end: 0.11, label: 'Straight 2' }],
    42: [{ start: 0.95, end: 0.13, label: 'IFEMA Main Straight' }, { start: 0.44, end: 0.61, label: 'Valdebebas Super Straight' }]
};

module.exports = {
    OFFICIAL_TRACK_SECTOR_DISTANCES,
    OFFICIAL_TRACK_DRS_ZONES,
    OFFICIAL_TRACK_STRAIGHT_MODE_ZONES
};
