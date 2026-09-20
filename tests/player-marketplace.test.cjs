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
  const p = main.indexOf("'./cultivation/player-marketplace.js'");
  assert.ok(m >= 0 && p > m);
  assert.match(market, /getElementById\('page-store'\)/);
  assert.match(market, /id="player-market-switch"/);
  assert.match(market, /id="pm-view-market"/);
  assert.match(market, /window\.openPlayerMarketplace = \(view = 'all'\)/);
  assert.match(refinery, /data-refinery-open-market/);
  assert.match(refinery, /window\.openPlayerMarketplace\?\.\('recipe'\)/);
  assert.match(index, /main\.js\?v=20260920-player-market1/);
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

test('recipe marketplace honors permanent first ownership and licenses without changing its owner', () => {
  assert.match(market, /const recipeSnap = type === 'recipe' \? await tx\.get/);
  assert.match(market, /const recipeSnap = listing\.type === 'recipe' \? await tx\.get/);
  assert.match(market, /official\.recipeOwnerUid !== seller\.uid/);
  assert.match(market, /official\.recipeOwnerUid !== listing\.sellerUid/);
  assert.match(market, /recipeLicenses: \{ \.\.\.\(rawBuyer\.recipeLicenses \|\| \{\}\), \[listing\.itemId\]: true \}/);
  assert.match(market, /永久非專屬使用權/);
  assert.match(market, /首發者身分不轉移/);
  assert.match(refinery, /已取得永久使用權/);
  assert.match(refinery, /已授權 \$\{licensed\.length\}/);
  assert.match(refinery, /xiuxian:recipe-license-updated/);
});

test('refinery validates recipe signature and license in the same Firestore transaction', () => {
  const start = jobs.slice(jobs.indexOf('async function startJob('),jobs.indexOf('function apiMaterials()'));
  assert.match(start, /const catalogSnap = await tx\.get\(doc\(db\(\), \.\.\.ARTIFACT_CONFIG\)\)/);
  assert.match(start, /const recipeSnap = await tx\.get\(doc\(db\(\), \.\.\.MATERIAL_CONFIG\)\)/);
  assert.match(start, /findRecipeBySignature\(officialRecipes, plan\.signature\)/);
  assert.match(start, /if \(officialId !== plan\.knownArtifactId\)/);
  assert.match(start, /official\.recipeOwnerUid !== user\.uid && raw\.recipeLicenses\?\.\[official\.id\] !== true/);
  assert.match(start, /tx\.update\(ref,/);
  assert.ok(start.indexOf('const recipeSnap = await tx.get') < start.indexOf('tx.update(ref,'));
  assert.match(jobs, /recipeOwnerUid: user\.uid/);
});

test('market technical faults go to admin debugger while players see neutral feedback', () => {
  assert.match(market, /console\.error\('\[Player market\] ' \+ label, error\)/);
  assert.match(market, /本次操作未完成，請稍後重試/);
  assert.doesNotMatch(market, /alert\(error\.message\)/);
  assert.match(market, /unsubActive\?\.\(\); unsubMine\?\.\(\)/);
  assert.match(market, /where\('status','==','active'\)/);
});
