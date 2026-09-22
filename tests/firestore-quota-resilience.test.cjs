const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const read = path => readFileSync(join(__dirname, '../public', path), 'utf8');
const combat = read('cultivation/cultivation-combat-stats.js');
const market = read('cultivation/player-marketplace.js');
const meditation = read('cultivation/daily-meditation.js');

test('combat stats initialize on player readiness, not a repeating timer', () => {
  assert.match(combat, /window\.addEventListener\('xiuxian:user-data-ready'/);
  assert.match(combat, /window\.ensureCombatStats = ensureDefaults/);
  assert.match(combat, /if \(initializing\) return/);
  assert.doesNotMatch(combat, /setInterval\(ensureDefaults/);
});

test('market reads user wallet only while the trading tab is visible', () => {
  assert.match(market, /function marketVisible\(\)/);
  assert.match(market, /store\.classList\.contains\('pm-market-active'\)/);
  const subscribe = market.slice(market.indexOf('  function subscribe(uid) {'), market.indexOf('  function boot() {'));
  assert.match(subscribe, /if \(marketVisible\(\)\) \{ void refreshWallet\(\); void refreshListings\(\); \}/);
  assert.match(subscribe, /if \(marketVisible\(\)\) \{/);
  assert.doesNotMatch(subscribe, /if \(!uid\) \{ scheduleRender\(\); return; \}\s*void refreshWallet\(\)/);
  assert.match(market, /if \(open\) \{ render\(\); void refreshWallet\(\); void refreshListings\(\); \}/);
});

test('wallet read is single-flight and throttles Firestore resource exhaustion', () => {
  assert.match(market, /walletLoading \|\| Date\.now\(\) < walletRetryAfter/);
  assert.match(market, /walletLoading = true/);
  assert.match(market, /walletLoading = false/);
  assert.match(market, /resource-exhausted/);
  assert.match(market, /walletRetryAfter = Date\.now\(\) \+ 60000/);
});

test('meditation reuses the just-fetched daily record and keeps atomic settlement', () => {
  const start = meditation.slice(meditation.indexOf('  async function start() {'), meditation.indexOf('  async function finish() {'));
  assert.match(start, /if \(remoteUid !== uid\(\) \|\| !remoteRecord\) await loadRemote\(\)/);
  assert.match(meditation, /await runTransaction\(db,/);
  assert.match(meditation, /if \(old\.lastDate === current\.date\)/);
});
