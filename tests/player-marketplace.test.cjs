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
  assert.match(index, /main\.js\?v=20260921-recipe-style-fix3/);
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
  assert.match(refinery, /const learned = userData\(\)\?\.recipeLicenses\?\.\[item\.id\] === true/);
  assert.match(refinery, /const canReadRecipe = recipeAvailableToPlayer\(item, myUid\)/);
  assert.match(refinery, /const recipe = canReadRecipe \? getArtifactRecipe\(item\.id\) : \[\]/);
  assert.match(refinery, /const ingredients = canReadRecipe/);
  assert.match(refinery, /製作方法尚未習得/);
  assert.match(refinery, /canReadRecipe && item\.description/);
  assert.match(refinery, /return `<details class="refinery-recipe-card/);
  assert.match(market, /交易只傳授製作方法/);
});
test('market technical faults go to admin debugger while players see neutral feedback', () => {
  assert.match(market, /console\.error\('\[Player market\] ' \+ label, error\)/);
  assert.match(market, /本次操作未完成，請稍後重試/);
  assert.doesNotMatch(market, /alert\(error\.message\)/);
  assert.doesNotMatch(market, /onSnapshot\(/);
  assert.match(market, /getDocs\(query\(collection\(db,COLLECTION\),where\('status','==','active'\)/);
  assert.match(market, /getDocsFromCache/);
});

test('seller wallet and recipe knowledge refresh without opening Firestore Listen streams', () => {
  assert.match(market,/async function refreshWallet\(\)/);
  assert.match(market,/await getDoc\(doc\(db,'users',currentUid\)\)/);
  assert.match(market,/current\.stats\.gold = remoteGold/);
  assert.match(market,/current\.recipeLicenses = latest\.recipeLicenses \|\| \{\}/);
  assert.match(market,/refreshTimer = setInterval/);
  assert.doesNotMatch(market,/onSnapshot\(/);
  assert.doesNotMatch(market,/unsubWallet|unsubActive|unsubMine/);
});

test('market import failure does not block game readiness', () => {
  const source = main.slice(main.indexOf('async function loadXiuxianFeaturesSafely()'),main.indexOf('function cultivationUserDataReady()'));
  assert.match(source,/window\.__xiuxianFeaturesReady = true/);
  assert.match(source,/resolveXiuxianFeatureGate\(result\);\s*\/\/ 遊戲已可開始，再載入市集/);
  assert.match(source,/void loadPlayerMarketSafely\(\)/);
  assert.match(main,/console\.error\('\[Xiuxian\] Optional player marketplace failed:', error\)/);
  assert.match(main,/window\.openPlayerMarketplace = queueMarketOpen/);
  assert.match(main,/window\.switchToPage\?\.\('page-store'\)/);
  assert.match(main,/panel\?\.style\.setProperty\('display','block','important'\)/);
  assert.match(main,/正在載入交易市集/);
});

test('market entry and container live in static real shop, and opening does not require a late DOM event', () => {
  assert.match(index,/id="player-market-switch"/);
  assert.match(index,/id="pm-view-market" onclick="window\.openPlayerMarketplace\?\.\('all'\)"/);
  assert.match(index,/id="player-market" class="hidden"/);
  assert.match(market,/if \(switcher\.dataset\.marketBound === '1' && panel\.dataset\.marketBound === '1'\) return true/);
  assert.match(market,/marketButton\?\.hasAttribute\('onclick'\)/);
  assert.match(market,/window\.openPlayerMarketplace = \(view = 'all'\) => \{/);
  assert.match(market,/if \(!marketInitialized\) \{ requestedView = filter; return; \}/);
  assert.doesNotMatch(market,/if \(!document\.getElementById\('page-store'\)\?\.classList\.contains\('active-page'\)\) return/);
});

test('a market listing shows material descriptions, artifact effects and a guarded recipe guide', () => {
  assert.match(market,/function detailMarkup\(listing\)/);
  assert.match(market,/item\.description/);
  assert.match(market,/EFFECT_LABELS\[effect\.type\]/);
  assert.match(market,/getArtifactRecipe\(item\.id\)\.map/);
  assert.match(market,/recipeOwnerUid === currentUid/);
  assert.match(market,/data\(\)\?\.recipeLicenses\?\.\[item\.id\] === true/);
  assert.match(market,/購買後可在煉器配方圖鑑查看確切材料與數量/);
  assert.match(market,/<details class="pm-detail"><summary>查看商品資訊<\/summary>\$\{detailMarkup\(listing\)\}<\/details>/);
  assert.match(market,/esc\(item\.description \|\| '暫無詳細描述'\)/);
});

test('market refresh survives Firestore transport failures without depending on Listen streams', () => {
  assert.match(market,/getDocsFromCache/);
  assert.match(market,/async function refreshListings\(\)/);
  assert.match(market,/active = publicRows\.docs\.map/);
  assert.match(market,/mine = ownRows\.docs\.map/);
  assert.doesNotMatch(market,/onSnapshot\(/);
  assert.match(market,/data-pm-refresh/);
  assert.match(market,/市集連線暫時中斷/);
  assert.doesNotMatch(market,/failed \? '<p class="pm-empty">市集尚未開放/);
  assert.match(main,/交易市集目前無法載入，請重新整理遊戲後再試/);
});

test('market client script is syntactically valid after bundling changes', () => {
  const vm=require('node:vm');
  const stripped=market.replace(/^import[\s\S]*?;\s*$/gm,'');
  assert.doesNotThrow(() => new vm.Script(stripped));
});
