const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const api = require('../artifact-generation-api.js');
const aiJobs = read('public/cultivation/refinery-ai-jobs.js');
const refinery = read('public/cultivation/cultivation-refinery-v2.js');
const economySource = read('public/cultivation/refinery-economy.js');
const artifactCatalog = read('public/cultivation/artifact-catalog.js');
const admin = read('public/cultivation/admin-artifact-manager.js');
const adminSort = read('public/cultivation/admin-realm-sorting.js');
const main = read('public/main.js');
const server = read('server.js');

function loadEconomy() {
  const context = {};
  vm.createContext(context);
  const source = economySource
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ')
    + '\n;globalThis.__economy={calculateRefineryEconomy,baseRealmForgeGold,formatRefineryDuration,refineryRealmOrder};';
  vm.runInContext(source, context);
  return context.__economy;
}

test('AI artifact realm is derived from official ingredient records, not selected-row or client targetRealm claims', () => {
  const payload = {
    targetRealm: '真仙',
    selectedIngredients: [
      { type: 'material', id: 'iron', realm: '真仙', quantity: 1 },
      { type: 'artifact', id: 'old-core', realm: '真仙', quantity: 1 }
    ],
    allMaterials: [
      { id: 'iron', name: '玄鐵', realm: '煉氣' }
    ],
    existingArtifacts: [
      { id: 'old-core', name: '舊器心', realm: '元嬰' }
    ]
  };
  assert.equal(api.deriveTargetRealm(payload), '元嬰');
});

test('AI artifact sanitizer cannot change locked realm and keeps combo at ten percent or lower', () => {
  const artifact = api.sanitizeGeneratedArtifact({
    name: '亂界神兵',
    realm: '真仙',
    equipSlot: '本命法寶',
    effects: [
      { type: 'equip_combo_chance', value: 0.99 },
      { type: 'equip_damage_percent', value: 9 }
    ]
  }, '築基');
  assert.equal(artifact.realm, '築基');
  const combo = artifact.effects.find((e) => e.type === 'equip_combo_chance');
  if (combo) assert.ok(combo.value <= 0.10);
});

test('generation prompt receives selected ingredients, full material catalog, existing artifacts and creative direction', () => {
  const prompt = api.buildPrompt({
    targetRealm: '金丹',
    selectedIngredients: [{ type:'material', id:'a', name:'星砂', realm:'金丹', quantity:2 }],
    allMaterials: [
      { id:'a', name:'星砂', realm:'金丹', category:'特殊材料', description:'星輝細砂' },
      { id:'b', name:'寒玉', realm:'築基', category:'晶石', description:'寒氣內斂' }
    ],
    existingArtifacts: [{ id:'old', name:'舊燈', realm:'金丹', description:'既有法寶' }]
  });
  assert.match(prompt, /本次創意方向/);
  assert.match(prompt, /全材料圖鑑/);
  assert.match(prompt, /星砂/);
  assert.match(prompt, /寒玉/);
  assert.match(prompt, /既有法寶摘要/);
  assert.match(prompt, /舊燈/);
  assert.match(prompt, /不要只把材料名稱機械拼接/);
});

test('refinery economy uses qi baseline 10 minutes / 80 gold and varies with player realm gap', () => {
  const economy = loadEconomy();
  const qi = economy.calculateRefineryEconomy({ targetRealm:'煉氣', playerRealm:'煉氣', discovery:false });
  const qiDiscovery = economy.calculateRefineryEconomy({ targetRealm:'煉氣', playerRealm:'煉氣', discovery:true });
  assert.equal(qi.gold, 80);
  assert.equal(qi.durationMs, 10 * 60 * 1000);
  assert.equal(qiDiscovery.gold, 80);
  assert.equal(qiDiscovery.durationMs, 10 * 60 * 1000);

  const same = economy.calculateRefineryEconomy({ targetRealm:'元嬰', playerRealm:'元嬰', discovery:false });
  const underRealm = economy.calculateRefineryEconomy({ targetRealm:'元嬰', playerRealm:'築基', discovery:false });
  const overRealm = economy.calculateRefineryEconomy({ targetRealm:'元嬰', playerRealm:'大乘', discovery:false });
  assert.ok(underRealm.gold > same.gold);
  assert.ok(underRealm.durationMs > same.durationMs);
  assert.ok(overRealm.gold < same.gold);
  assert.ok(overRealm.durationMs < same.durationMs);
});

test('unknown recipes start a timed paid job and AI runs only when claiming the completed artifact', () => {
  assert.match(aiJobs, /status: 'refining'/);
  assert.match(aiJobs, /goldCost: plan\.gold/);
  assert.match(aiJobs, /readyAtMs: now \+ plan\.durationMs/);
  assert.match(aiJobs, /'stats\.gold': committed\.gold/);
  assert.match(aiJobs, /consumeRecipe\(raw, plan\.recipe\)/);

  const generatePos = aiJobs.indexOf('async function generateCandidate');
  const claimDiscoveryPos = aiJobs.indexOf('async function claimDiscovery');
  const generatedCallPos = aiJobs.indexOf('const generated = await generateCandidate(job)', claimDiscoveryPos);
  assert.ok(generatePos >= 0 && claimDiscoveryPos > generatePos && generatedCallPos > claimDiscoveryPos);
  assert.match(aiJobs, /Date\.now\(\) < Number\(fresh\.readyAtMs/);
  assert.doesNotMatch(aiJobs.slice(aiJobs.indexOf('async function startJob'), generatePos), /generateCandidate\(/);
});

test('unknown recipe generation sends all material information and existing artifact context to AI endpoint', () => {
  assert.match(aiJobs, /allMaterials: apiMaterials\(\)/);
  assert.match(aiJobs, /existingArtifacts: apiArtifacts\(\)/);
  assert.match(aiJobs, /selectedIngredients: job\.ingredients/);
  assert.match(aiJobs, /fetch\('\/api\/generate-artifact'/);
  assert.match(server, /registerArtifactGenerationApi\(app\)/);
});

test('new AI artifact becomes usable immediately and is persisted as a permanent recipe marked pending review', () => {
  assert.match(aiJobs, /reviewStatus: 'pending'/);
  assert.match(aiJobs, /generatedByAI: true/);
  assert.match(aiJobs, /generationMaterials: fresh\.ingredients/);
  assert.match(aiJobs, /items: committedCatalog/);
  assert.match(aiJobs, /recipes: committedRecipes/);
  assert.match(aiJobs, /artifactSystem\.inventory\[awardedId\]/);
  assert.match(aiJobs, /replaceArtifactCatalog\(committedCatalog, 'ai-generated'\)/);
  assert.match(aiJobs, /replaceArtifactRecipes\(committedRecipes, 'ai-generated'\)/);
  assert.doesNotMatch(artifactCatalog, /reviewStatus === 'approved'.*getArtifactById/s);
});

test('same discovered recipe is reused instead of generating duplicate permanent artifacts', () => {
  assert.match(aiJobs, /function findRecipeBySignature/);
  assert.match(aiJobs, /awardedId = findRecipeBySignature\(latestRecipes, fresh\.signature\)/);
  assert.match(aiJobs, /if \(!awardedId\) \{/);
});

test('refinery button flow is 煉製 -> 煉製中 -> 開爐 and claim only after ready time', () => {
  assert.match(refinery, /data-refinery-job-clock/);
  assert.match(refinery, /已付金幣/);
  assert.match(refinery, /法寶境界/);
  assert.match(refinery, /Date\.now\(\) >= Number\(job\.readyAtMs/);
  assert.match(refinery, /const craftLabel = job \? \(jobReady \? '開爐' : '煉製中'\) : '煉製'/);
  assert.match(refinery, /ready \? '開爐' : '煉製中'/);
  assert.match(refinery, /可開爐/);
  assert.match(refinery, /setInterval\(updateJobClock, 1000\)/);
  assert.match(refinery, /煉製完成後按「開爐」取出法寶/);
});

test('admin keeps newest pending AI artifacts above approved realm-sorted artifacts and supports approval', () => {
  assert.match(admin, /AI・待處理/);
  assert.match(admin, /reviewStatus === 'pending'/);
  assert.match(admin, /generatedAtMs/);
  assert.match(admin, /approveGeneratedArtifact/);
  assert.match(admin, /reviewStatus: 'approved'/);
  assert.match(admin, /確認已檢查/);

  assert.match(adminSort, /aPending !== bPending/);
  assert.match(adminSort, /aPending \? -1 : 1/);
  assert.match(adminSort, /generatedAtMs/);
});

test('AI refinery job module loads before refinery UI', () => {
  const jobs = main.indexOf("'./cultivation/refinery-ai-jobs.js'");
  const ui = main.indexOf("'./cultivation/cultivation-refinery-v2.js'");
  assert.ok(jobs >= 0 && ui > jobs);
});
