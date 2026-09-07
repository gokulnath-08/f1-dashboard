const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

const requiredIds = [
  'target-modal',
  'target-modal-track',
  'target-enable-switch',
  'tgt-lap-min',
  'tgt-lap-sec',
  'tgt-lap-ms',
  'tgt-sec-1',
  'tgt-sec-2',
  'tgt-sec-3',
  'target-lap-ms-preview',
  'target-sectors-sum-val',
  'target-alignment-badge',
  'tgt-opt-ddu',
  'tgt-opt-celebrate',
  'btn-target-pace',
  'target-card-badge',
  'tgt-card-lap-time',
  'tgt-card-lap-delta',
  'tgt-card-s1-time',
  'tgt-card-s2-time',
  'tgt-card-s3-time'
];

const missing = [];
for (const id of requiredIds) {
  if (!html.includes(`id="${id}"`)) {
    missing.push(id);
  }
}

console.log('Total checked IDs:', requiredIds.length);
console.log('Missing IDs:', missing);

const gpIndex = html.indexOf('id="gamepad-modal"');
const gpClose = html.indexOf('</div>\r\n\r\n    <!-- ══════════ TARGET LAP') !== -1 
  ? html.indexOf('</div>\r\n\r\n    <!-- ══════════ TARGET LAP')
  : html.indexOf('</div>\n\n    <!-- ══════════ TARGET LAP');
const targetIndex = html.indexOf('id="target-modal"');

console.log('gamepad-modal index:', gpIndex);
console.log('gamepad-modal closing index:', gpClose);
console.log('target-modal index:', targetIndex);

if (gpIndex < gpClose && gpClose < targetIndex) {
  console.log('SUCCESS: #target-modal is properly positioned OUTSIDE and AFTER #gamepad-modal.');
} else {
  console.error('FAIL: Position verification failed.');
  process.exit(1);
}

// Verify SET buttons exist
const setMatches = html.match(/openTargetModal\(\)/g) || [];
console.log('Found openTargetModal() triggers in index.html:', setMatches.length);
if (setMatches.length < 2) {
  console.error('Expected at least 2 triggers (header + SET button)');
  process.exit(1);
}

console.log('ALL VERIFICATIONS PASSED.');
