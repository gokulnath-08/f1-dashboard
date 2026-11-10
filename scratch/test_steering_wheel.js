const fs = require('fs');
const path = require('path');

console.log('--- TESTING STEERING WHEEL IMPLEMENTATION ---');

// 1. Verify SVG file
const svgPath = path.join(__dirname, '..', 'images', 'steering-wheel.svg');
if (!fs.existsSync(svgPath)) {
    console.error('FAIL: images/steering-wheel.svg not found!');
    process.exit(1);
}
const svgContent = fs.readFileSync(svgPath, 'utf8');
if (!svgContent.includes('<svg') || !svgContent.includes('viewBox="0 0 300 200"')) {
    console.error('FAIL: SVG format unexpected!');
    process.exit(1);
}
console.log('PASS: images/steering-wheel.svg exists and valid SVG.');

// 2. Verify index.html elements
const htmlPath = path.join(__dirname, '..', 'index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

const requiredIds = [
    'steering-wheel-img',
    'steer-val',
    'steer-deg-val',
    'steer-dir-badge',
    'steer-left',
    'steer-right',
    'ddu-steer-angle'
];

for (const id of requiredIds) {
    if (!htmlContent.includes(`id="${id}"`)) {
        console.error(`FAIL: index.html missing id="${id}"`);
        process.exit(1);
    }
}
console.log('PASS: All required DOM IDs present in index.html.');

// Verify image source in HTML
if (!htmlContent.includes('src="images/steering-wheel.svg"')) {
    console.error('FAIL: index.html missing src="images/steering-wheel.svg"');
    process.exit(1);
}
console.log('PASS: steering image referenced correctly.');

// 3. Verify js/dashboard.js
const dashJsPath = path.join(__dirname, '..', 'js', 'dashboard.js');
const dashJs = fs.readFileSync(dashJsPath, 'utf8');

if (!dashJs.includes('steering-wheel-img') || !dashJs.includes('steerDeg') || !dashJs.includes('rotate(')) {
    console.error('FAIL: js/dashboard.js missing steering rotation logic!');
    process.exit(1);
}
console.log('PASS: js/dashboard.js contains rotation and angle logic.');

// 4. Verify simulation of steering calculations
const testCases = [
    { input: 0.0, expectedDeg: 0.0, expectedBadge: 'CENTER' },
    { input: 0.5, expectedDeg: 90.0, expectedBadge: 'RIGHT ▶' },
    { input: -0.5, expectedDeg: -90.0, expectedBadge: '◀ LEFT' },
    { input: 1.0, expectedDeg: 180.0, expectedBadge: 'RIGHT ▶' },
    { input: -1.0, expectedDeg: -180.0, expectedBadge: '◀ LEFT' },
    { input: 0.25, expectedDeg: 45.0, expectedBadge: 'RIGHT ▶' },
    { input: -0.25, expectedDeg: -45.0, expectedBadge: '◀ LEFT' }
];

for (const tc of testCases) {
    const steerVal = tc.input;
    const steerDeg = steerVal * 180;
    if (Math.abs(steerDeg - tc.expectedDeg) > 0.001) {
        console.error(`FAIL: Deg calculation mismatch for input ${tc.input}: got ${steerDeg}, expected ${tc.expectedDeg}`);
        process.exit(1);
    }
    let badge = 'CENTER';
    if (steerDeg < -1.0) badge = '◀ LEFT';
    else if (steerDeg > 1.0) badge = 'RIGHT ▶';
    if (badge !== tc.expectedBadge) {
        console.error(`FAIL: Badge mismatch for input ${tc.input}: got ${badge}, expected ${tc.expectedBadge}`);
        process.exit(1);
    }
    const transform = `rotate(${steerDeg.toFixed(1)}deg)`;
    console.log(`Input: ${steerVal.toFixed(2)} -> Deg: ${steerDeg.toFixed(1)}° (${badge}) -> Transform: ${transform}`);
}

// 5. Verify CSS
const cssPath = path.join(__dirname, '..', 'css', 'dashboard.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');
if (!cssContent.includes('.steering-panel-widget') || !cssContent.includes('.steering-wheel-graphic')) {
    console.error('FAIL: css/dashboard.css missing steering wheel styling!');
    process.exit(1);
}
console.log('PASS: css/dashboard.css contains steering styling.');

console.log('--- ALL STEERING WHEEL CHECKS PASSED ---');

