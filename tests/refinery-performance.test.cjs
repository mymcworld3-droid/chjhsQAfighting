const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const refinery = fs.readFileSync(path.join(__dirname, '..', 'public/cultivation/cultivation-refinery-v2.js'), 'utf8');

test('refinery selection no longer rebuilds the whole material list', () => {
  assert.match(refinery, /function syncSelectionView\(\)/);
  assert.match(refinery, /selected\[empty\] = token;\s*syncSelectionView\(\);/);
  assert.match(refinery, /selected\[index\] = null;\s*syncSelectionView\(\);/);
  assert.match(refinery, /selected\.fill\(null\);\s*syncSelectionView\(\);/);
  assert.doesNotMatch(refinery, /selected\[empty\] = token;\s*render\(true\);/);
});

test('refinery uses stable slot DOM and inline realm decoration', () => {
  assert.match(refinery, /data-refinery-slot=/);
  assert.match(refinery, /data-refinery-token=/);
  assert.match(refinery, /--material-realm-color/);
  assert.match(refinery, /material-realm-badge/);
  assert.match(refinery, /data-refinery-used-badge/);
  assert.match(refinery, /data-refinery-summary-text/);
  assert.match(refinery, /data-refinery-match-text/);
});

test('refinery does not observe the entire body after training page exists', () => {
  assert.match(refinery, /function observeTrainingPage\(\)/);
  assert.match(refinery, /new MutationObserver\(schedule\)\.observe\(tabs, \{ childList: true \}\)/);
  assert.doesNotMatch(refinery, /new MutationObserver\(schedule\)\.observe\(document\.body/);
  assert.match(refinery, /rootObserver\.disconnect\(\)/);
});
