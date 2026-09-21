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
  assert.match(index, /main\.js\?v=20260921-battle-viewport-fit1/);
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
  assert.match(market, /official\.recipeOwnerUid === listing\.sellerUid/);
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
  assert.match(market,/成品故事與製作資料購買後解鎖/);
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

test('listed recipe previews show result and effects but never reveal description or formula before purchase', () => {
  const vm = require('node:vm');
  const from = market.indexOf('  function detailMarkup(listing) {');
  const to = market.indexOf('  function card(listing, own = false) {', from);
  assert.ok(from >= 0 && to > from);
  const source = market.slice(from, to);
  let licenses = {};
  let admin = false;
  let formulaReads = 0;
  const artifact = {
    id:'secret', name:'雷印', realm:'金丹', category:'裝備法寶',
    description:'祕密故事：必須使用紫雷石三顆',
    recipeSaleLocked:true, effects:[{type:'equip_attack_flat',value:42}]
  };
  const context = {
    itemFor:()=>artifact, currentUid:'buyer',
    data:()=>({isAdmin:admin,recipeLicenses:licenses}),
    esc:(value)=>String(value ?? ''),
    qty:(value)=>Number(value),
    EFFECT_LABELS:{equip_attack_flat:'固定攻擊'},
    getArtifactRecipe:()=>{formulaReads++;return [{materialId:'secret-stone',quantity:3}];},
    getMaterialById:()=>({name:'紫雷石'}),
    getArtifactById:()=>null
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.viewRecipe=detailMarkup;',context);
  const listing = {type:'recipe',itemId:'secret',sellerName:'owner'};
  const preview = context.viewRecipe(listing);
  assert.match(preview,/固定攻擊：42/);
  assert.match(preview,/金丹/);
  assert.doesNotMatch(preview,/祕密故事|紫雷石|三顆/);
  assert.match(preview,/購買後解鎖/);
  assert.equal(formulaReads,0);
  licenses = {secret:true};
  const purchased = context.viewRecipe(listing);
  assert.match(purchased,/祕密故事：必須使用紫雷石三顆/);
  assert.match(purchased,/紫雷石 ×3/);
  assert.equal(formulaReads,1);
  licenses = {};
  admin = true;
  assert.match(context.viewRecipe(listing),/祕密故事/);
});

test('admin-managed recipe listing checks seller admin status when buyer claims the guide', () => {
  assert.match(market,/const validOwner = !!official\?\.recipeOwnerUid && official\.recipeOwnerUid === listing\.sellerUid/);
  assert.match(market,/const validAdmin = listing\.adminManaged === true && rawSeller\.isAdmin === true/);
  assert.match(market,/!validOwner && !validAdmin/);
  assert.match(market,/recipeLicenses: \{ \.\.\.\(rawBuyer\.recipeLicenses \|\| \{\}\), \[listing\.itemId\]: true \}/);
  assert.match(refinery,/item\.recipeSaleLocked !== true/);
  assert.match(market,/item\.recipeSaleLocked !== true/);
});


test('material market reference is unified by realm and strictly increases', () => {
  const source = read('public/cultivation/material-catalog.js');
  const from = source.indexOf('export function materialMarketReferencePrice(');
  const to = source.indexOf('export function materialRealmColor(', from);
  assert.ok(from >= 0 && to > from);
  const js = source.slice(from,to).replaceAll('export function','function');
  const names = ['凡人','煉氣','築基','金丹','元嬰','化神','煉虛','合體','大乘','渡劫','真仙'];
  const fn = new Function('materialRealmOrderByName',js+
    '\nreturn {reference:materialMarketReferencePrice, minimum:materialMarketMinimumTotal};');
  const calc = fn((name)=>Math.max(0,names.indexOf(name)));
  const prices = names.map(name=>calc.reference({realm:name}));
  assert.deepEqual(prices,[10,20,40,80,160,320,640,1280,2560,5120,10240]);
  assert.equal(calc.reference({realm:'金丹',buyGold:0}),calc.reference({realm:'金丹',buyGold:9999}));
  assert.equal(calc.minimum('煉氣',1),21);
  assert.equal(calc.minimum('煉氣',3),61);
  assert.equal(calc.minimum('真仙',999),10229761);
  assert.equal(calc.minimum('煉氣',0),0);
});

test('material listing validates total price above unit reference both before and inside Firestore transaction', () => {
  const catalog = read('public/cultivation/material-catalog.js');
  const bag = read('public/cultivation/unified-inventory-grid.js');
  const npc = read('public/cultivation/material-system.js');
  const admin = read('public/cultivation/admin-material-manager.js');
  assert.match(market,/materialMarketReferencePrice, materialMarketMinimumTotal/);
  assert.match(market,/function checkMaterialListingPrice\(type, item, count, price\)/);
  assert.match(market,/if \(price < minimum\)/);
  assert.match(market,/price = amount\(sellPrice, MAX_PRICE, '總價'\);\s*checkMaterialListingPrice\(type, item, count, price\)/);
  assert.match(market,/checkMaterialListingPrice\(type, itemFor\(type, id\), count, price\)/);
  assert.match(market,/function updatePriceHint\(\)/);
  assert.match(market,/id="pm-material-price-hint"/);
  assert.match(market,/publish\.disabled = busy \|\| !listable\(\)\.length \|\| !canList/);
  assert.match(market,/event\.target\.id === 'pm-sell-qty' \|\| event\.target\.id === 'pm-sell-price'/);
  assert.match(market,/境界統一參考單價/);
  assert.match(catalog,/export function materialMarketReferencePrice\(/);
  assert.match(bag,/坊市參考單價：/);
  assert.match(npc,/參考 \$\{materialMarketReferencePrice\(item\.realm\)/);
  assert.match(admin,/坊市參考 \$\{materialMarketReferencePrice\(item\.realm\)/);
  assert.match(admin,/採購價分開/);
  const before = market.slice(market.indexOf('async function createListing()'),market.indexOf('async function buyListing('));
  assert.ok(before.indexOf('checkMaterialListingPrice(type, itemFor(type, id), count, price)') <
    before.indexOf("tx.update(sellerRef, { [systemField]: system })"));
  assert.match(before,/if \(type === 'recipe'\)/);
});
