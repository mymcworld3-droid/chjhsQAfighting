const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const source = readFileSync(join(__dirname, '../public/cultivation/material-drop-system.js'), 'utf8');

test('retired automatic material-drop path has no Firebase transaction or retry machinery', () => {
  assert.match(source,/raid-only/);
  assert.doesNotMatch(source,/runDropTransactionWithRetry|runTransaction|getFirestore|failed-precondition|aborted/);
});

test('quiz and dongtian cannot mint crafting materials', () => {
  assert.match(source,/quizDrops:false/);
  assert.match(source,/dongtianDrops:false/);
  assert.doesNotMatch(source,/enqueueRoll|grantDrops|expandDongtianDrops/);
});
