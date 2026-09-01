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

module.exports = {
    weatherMap,
    scMap,
    ersMap,
    visualTyreNames,
    visualTyreColors,
    fallbackTyreNames,
    gameModeMap,
    sessionMap,
    rulesetMap,
    surfaceMap,
    penaltyMap,
    infringementMap,
    formulaMap,
    trackMap,
    flagMap,
    pitMap,
    teamMap,
    teamNameMap
};
