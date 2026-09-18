const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const foundation = read('public/cultivation/foundation-training-page.js');
const training = read('public/cultivation/cultivation-training-v4.js');
const guard = read('public/cultivation/golden-core-access-guard.js');
const scrollFix = read('public/cultivation/training-scroll-fix.js');

test('training stage modules are event-driven instead of repaint polling', () => {
  assert.doesNotMatch(foundation, /setInterval\(sync,\s*450\)/);
  assert.doesNotMatch(training, /setInterval\(syncUnlock,\s*900\)/);
  assert.doesNotMatch(guard, /setInterval\(enforce,\s*250\)/);

  assert.match(foundation, /xiuxian:stats-updated/);
  assert.match(foundation, /xiuxian:user-ready/);
  assert.match(training, /golden-core-access-changed/);
  assert.match(guard, /golden-core-runtime-ready/);
});

test('Foundation cleanup cannot repeatedly clear Golden Core unlocked layout', () => {
  assert.match(foundation, /if \(!page && !nav\) \{[\s\S]*foundation-training-only[\s\S]*return;/);
  assert.match(foundation, /if \(!window\.isGoldenCoreUnlocked\?\.\(\)\) \{[\s\S]*cultivation-training-unlocked/);
  assert.match(foundation, /if \(lastStage === active\) return;/);
  assert.match(foundation, /else if \(lastStage === true\) removeFoundationUI\(\)/);
});

test('Golden Core unlock UI runs only on an actual unlock transition', () => {
  assert.match(training, /if \(lastUnlocked === unlocked\) return;/);
  assert.match(training, /if \(unlocked\) ensureUnlockedUI\(\)/);
  assert.match(training, /else if \(lastUnlocked === true\) removeLockedUI\(\)/);
});

test('scroll reset only fires on hidden-to-visible transition', () => {
  assert.match(scrollFix, /let wasVisible = !!page && !page\.classList\.contains\('hidden'\)/);
  assert.match(scrollFix, /const visible = !target\.classList\.contains\('hidden'\)/);
  assert.match(scrollFix, /if \(visible && !wasVisible\) resetTrainingScrollSoon\(\)/);
  assert.match(scrollFix, /wasVisible = visible/);
  assert.doesNotMatch(scrollFix, /if \(!target\.classList\.contains\('hidden'\)\) resetTrainingScrollSoon\(\)/);
});

test('access guard no longer watches every body mutation', () => {
  assert.doesNotMatch(guard, /new MutationObserver/);
  assert.match(guard, /xiuxian:features-ready/);
});
