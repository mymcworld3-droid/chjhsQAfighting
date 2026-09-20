const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const read = (p) => readFileSync(join(__dirname,'..',p),'utf8');
const main = read('public/main.js');
const index = read('public/index.html');
const market = read('public/cultivation/player-marketplace.js');
const jobs = read('public/cultivation/refinery-ai-jobs.js');
const refinery = read('public/cultivation/cultivation-refinery-v2.js');

test('the existing market is loaded after artifacts and materials and reachable from shop and recipe book', () => {
  const m = main.indexOf("'./cultivation/material-system.js'");
  const p = main.indexOf('function loadPlayerMarketSafely()');
  assert.ok(m >= 0 && p > m);
  assert.match(main, /import\(\`\.\/cultivation\/player-marketplace\.js\?v=\$\{XIUXIAN_FEATURE_BUILD\}\`\)/);
  assert.doesNotMatch(main.slice(main.indexOf('const XIUXIAN_FEATURE_MODULES'),main.indexOf('let xiuxianFeatureLoadStarted')), /player-marketplace\.js/);
  assert.match(market, /getElementById\('page-store'\)/);
  assert.match(market, /switcher\.id = 'player-market-switch'/);
  assert.match(market, /id="pm-view-market"/);
  assert.match(market, /window\.openPlayerMarketplace = \(view = 'all'\)/);
  assert.match(refinery, /data-refinery-open-market/);
  assert.match(refinery, /window\.openPlayerMarketplace\?\.\('recipe'\)/);
  assert.match(index, /main\.js\?v=20260920-market-startupfix1/);
});

test('trade offers validate quantities, price, inventory, and restrict listed equipped artifacts', () => {
  assert.match(market, /MAX_PRICE = 1_000_000_000/);
  assert.match(market, /Number\.isSafeInteger\(num\)/);
  assert.match(market, /held - reserved < count/);
  assert.match(market, /Object\.values\(raw\.artifactSystem\?\.equipped \|\| \{\}\)/);
  assert.match(market, /tx\.update\(sellerRef, \{ \[systemField\]: system \}\)/);
  assert.match(market, /tx\.set\(listingRef/);
  assert.match(market, /tx\.update\(buyerRef, \{ \.\.\.update, 'stats\.gold': buyerGold - price \}\)/);
  assert.match(market, /tx\.update\(sellerRef, \{ 'stats\.gold': gold\(rawSeller\) \+ price \}\)/);
  assert.match(market, /tx\.update\(listingRef, \{ status:'sold'/);
  assert.match(market, /if \(listing\.sellerUid === buyer\.uid\)/);
  assert.match(market, /if \(listing\.status !== 'active'\)/);
  assert.match(market, /tx\.update\(listingRef, \{ status:'cancelled'/);
});

test('recipe marketplace sells crafting knowledge while preserving the first discoverer', () => {
  assert.match(market, /const recipeSnap = type === 'recipe' \? await tx\.get/);
  assert.match(market, /const recipeSnap = listing\.type === 'recipe' \? await tx\.get/);
  assert.match(market, /official\.recipeOwnerUid !== seller\.uid/);
  assert.match(market, /official\.recipeOwnerUid !== listing\.sellerUid/);
  assert.match(market, /recipeLicenses: \{ \.\.\.\(rawBuyer\.recipeLicenses \|\| \{\}\), \[listing\.itemId\]: true \}/);
  assert.match(market, /永久配方知識/);
  assert.match(market, /首發者身分不轉移/);
  assert.match(refinery, /已學會製作方法/);
  assert.match(refinery, /已學會 \$\{licensed\.length\}/);
  assert.match(refinery, /xiuxian:recipe-license-updated/);
});

test('even without a recipe, players can craft; owning the recipe only reveals exact ingredients', () => {
  const start = jobs.slice(jobs.indexOf('async function startJob('),jobs.indexOf('function apiMaterials()'));
  assert.match(start, /const plan = buildPlan\(tokens, knownArtifactId\)/);
  assert.match(start, /const consumed = consumeRecipe\(raw, plan\.recipe\)/);
  assert.match(start, /tx\.update\(ref,/);
  assert.doesNotMatch(start, /raw\.recipeLicenses|尚未取得此配方使用權|尚未取得這張配方的使用權/);
  assert.doesNotMatch(start, /const recipeSnap = await tx\.get/);
  assert.match(jobs, /recipeOwnerUid: user\.uid/);
  assert.doesNotMatch(refinery, /尚未取得這張配方的使用權，請前往交易市集/);
  assert.match(refinery, /配方是製作指南，不是煉器許可證/);
  assert.match(refinery, /沒有配方也能自由投入素材嘗試煉製/);
  assert.match(refinery, /const canReadRecipe = !item\.recipeOwnerUid \|\| mine \|\| userData\(\)\?\.recipeLicenses\?\.\[item\.id\] === true/);
  assert.match(refinery, /const ingredients = canReadRecipe \? getArtifactRecipe\(item\.id\)\.map/);
  assert.match(refinery, /製作材料未公開 · 取得配方後可查看素材與數量/);
  assert.match(refinery, /return `<article class="refinery-recipe-card/);
  assert.match(market, /交易只傳授製作方法/);
});
test('market technical faults go to admin debugger while players see neutral feedback', () => {
  assert.match(market, /console\.error\('\[Player market\] ' \+ label, error\)/);
  assert.match(market, /本次操作未完成，請稍後重試/);
  assert.doesNotMatch(market, /alert\(error\.message\)/);
  assert.match(market, /unsubActive\?\.\(\); unsubMine\?\.\(\)/);
  assert.match(market, /where\('status','==','active'\)/);
});

test('seller wallet and granted recipe licenses refresh from own Firestore user document', () => {
  assert.match(market,/unsubWallet = onSnapshot\(doc\(db, 'users', uid\)/);
  assert.match(market,/unsubActive\?\.\(\); unsubMine\?\.\(\); unsubWallet\?\.\(\)/);
  assert.match(market,/current\.stats\.gold = remoteGold/);
  assert.match(market,/current\.recipeLicenses = latest\.recipeLicenses \|\| \{\}/);
  assert.match(market,/xiuxian:recipe-license-updated/);
  assert.match(market,/scheduleRender\(\)/);
});

test('market import failure does not block game readiness', () => {
  const source = main.slice(main.indexOf('async function loadXiuxianFeaturesSafely()'),main.indexOf('function cultivationUserDataReady()'));
  assert.match(source,/window\.__xiuxianFeaturesReady = true/);
  assert.match(source,/resolveXiuxianFeatureGate\(result\);\s*\/\/ 遊戲已可開始，再載入市集/);
  assert.match(source,/void loadPlayerMarketSafely\(\)/);
  assert.match(main,/console\.error\('\[Xiuxian\] Optional player marketplace failed:', error\)/);
  assert.match(main,/window\.openPlayerMarketplace = queueMarketOpen/);
});
