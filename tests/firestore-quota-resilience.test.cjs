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

test('meditation reuses existing server sessions and keeps settlement atomic without client Firestore reads', () => {
  const api=readFileSync(join(__dirname,'../daily-meditation-api.cjs'),'utf8');
  assert.match(api,/if\(existing.session\)return/);
  assert.match(api,/db.runTransaction/);
  assert.match(api,/if\(c.result\)return \{completed:true/);
  assert.doesNotMatch(meditation,/getDoc\(|getDocs\(|runTransaction\(/);
});

const legacy = read('main-legacy.js');
const battle = read('cultivation/battle-mode-v2.js');

test('expensive full-user percentile scans require an explicit click and share an in-flight request', () => {
  const section = legacy.slice(legacy.indexOf('let globalUsersStatsCache = null'), legacy.indexOf('// 主渲染函式'));
  assert.match(section, /if \(percentileRequestedUid !== id\)/);
  assert.match(section, /id="percentile-load-on-demand"/);
  assert.match(section, /addEventListener\('click'/);
  assert.match(section, /globalUsersStatsLoad = pending/);
  assert.match(section, /if \(globalUsersStatsLoad\) return globalUsersStatsLoad/);
  assert.match(section, /getDocs\(collection\(db, "users"\)\)/);
  assert.match(section, /renderSerial !== percentileRenderSerial/);
});

test('waiting-room matchmaking scans every 1.1 seconds while preserving immediate initial search and room listener', () => {
  assert.match(battle, /MATCH_RECONCILE_MS = 1100/);
  assert.match(battle, /await findAndClaimRoom\(myData\)/);
  assert.match(battle, /onSnapshot\(roomRef\(roomId\), snap =>/);
  assert.match(battle, /if \(state\.roomId && state\.role === 'host' && state\.room\?\.status === 'waiting'\) scheduleReconcile\(\)/);
});

test('market only refreshes automatically every two minutes while leaving manual refresh available', () => {
  assert.match(market, /refreshTimer = setInterval/);
  assert.match(market, /\},120000\);/);
  assert.match(market, /button\.dataset\.pmRefresh !== undefined/);
});

test('friends, leaderboard and chat reuse recent reads without changing their original navigation', () => {
  assert.match(legacy, /friendListReadCache/);
  assert.match(legacy, /Date\.now\(\) - friendListReadCache\.time < 60000/);
  assert.match(legacy, /friendListPending/);
  assert.match(legacy, /leaderboardCachedSnapshot/);
  assert.match(legacy, /Date\.now\(\) - leaderboardCacheTime < 120000/);
  assert.match(legacy, /limit\(25\)/);
  assert.match(legacy, /if \(pageId !== 'page-social' && chatUnsub\)/);
});

const artifact = read('cultivation/artifact-system.js');

test('artifact eligibility retries are throttled after quota exhaustion instead of polling every second', () => {
  assert.match(artifact, /QUOTA_RETRY_MS = 30 \* 60 \* 1000/);
  assert.match(artifact, /eligibilityRetryAfter = Date\.now\(\) \+ \(isQuotaFailure\(error\) \? QUOTA_RETRY_MS : ORDINARY_RETRY_MS\)/);
  assert.match(artifact, /failureKey === eligibilityFailureKey && Date\.now\(\) < eligibilityRetryAfter/);
  const interval = artifact.slice(artifact.indexOf('    setInterval(() => {'), artifact.indexOf('    }, 1000);'));
  assert.doesNotMatch(interval, /enforceEquipmentEligibility\(\)/);
  assert.match(artifact, /window\.addEventListener\('artifact-catalog-updated', \(\) => \{ scheduleRender\(\); enforceEquipmentEligibility\(\); \}\)/);
  assert.match(artifact, /await updateArtifactSystem\(\(next\) => invalidSlots\.forEach\(\(slot\) => delete next\.equipped\[slot\]\)\)/);
});

test('expired artifact buffs only attempt one cleanup at a time and wait after failures', () => {
  assert.match(artifact, /if \(expiredBuffBusy \|\| Date\.now\(\) < expiredBuffRetryAfter\) return/);
  assert.match(artifact, /expiredBuffBusy = true/);
  assert.match(artifact, /finally \{ expiredBuffBusy = false; \}/);
  assert.match(artifact, /expiredBuffRetryAfter = Date\.now\(\) \+ \(isQuotaFailure\(error\) \? QUOTA_RETRY_MS : ORDINARY_RETRY_MS\)/);
});

test('cooperative meditation only polls open views or unfinished shared progress, with slower background-page refresh',()=>{
  const vm=require('node:vm');
  let reads=0,time=1000000,done=false,opened=false;
  const context={document:{hidden:false},navigator:{onLine:true},busy:false,lastStatusAt:time-60000,
    state:{date:'2026-10-16',stars:6},uid:()=> 'u1',today:()=> '2026-10-16',
    syncPanel(){},node:()=>opened?{}:null,panelState:()=>({done}),Date:{now:()=>time},refresh:()=>{reads++;return Promise.resolve();}};
  const section=meditation.slice(meditation.indexOf('  function poll() {'),meditation.indexOf('  setInterval(poll,60000);'));
  vm.runInNewContext(section+'\nthis.run=poll;',context);
  context.run();assert.equal(reads,0,'before personal completion the existing badge needs no friend polling');
  done=true;context.run();assert.equal(reads,0,'closed views wait five minutes');
  time+=300000;context.run();assert.equal(reads,1);
  context.state.stars=15;context.run();assert.equal(reads,1,'complete shared progress stops further friend reads');
  opened=true;context.run();assert.equal(reads,2,'open rankings can still refresh');
  context.document.hidden=true;context.run();assert.equal(reads,2);
  context.document.hidden=false;context.navigator.onLine=false;context.run();assert.equal(reads,2);
});
