const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const api = require('../artifact-generation-api.js');

test('deepest ingredients remain primary regardless of quantity, realm or submitted depth', () => {
  const payload = {
    selectedIngredients:[
      {type:'material', id:'sand', quantity:6, refinementDepth:99},
      {type:'artifact', id:'part', quantity:1, refinementDepth:99},
      {type:'artifact', id:'sword', quantity:1, refinementDepth:0}
    ],
    allMaterials:[{id:'sand', name:'星砂', realm:'真仙'}],
    existingArtifacts:[{id:'part', refinementDepth:0}, {id:'sword', name:'青鋒劍', refinementDepth:1}]
  };
  const hierarchy = api.ingredientHierarchy(payload);
  assert.deepEqual(hierarchy.primary.map(x => x.id), ['sword']);
  assert.deepEqual(hierarchy.supporting.map(x => x.id), ['sand', 'part']);
  assert.match(api.buildPrompt(payload), /保留其器型、核心意象、主要用途/);
  assert.deepEqual(api.ingredientHierarchy({...payload, selectedIngredients:payload.selectedIngredients.slice().reverse()}).primary, hierarchy.primary);
});

test('equal deepest artifacts share primacy and raw ingredients remain peers', () => {
  const payload = {selectedIngredients:[{type:'artifact', id:'a'}, {type:'artifact', id:'b'}, {id:'m'}],
    existingArtifacts:[{id:'a', refinementDepth:0}, {id:'b', refinementDepth:0}], allMaterials:[{id:'m'}]};
  assert.deepEqual(api.ingredientHierarchy(payload).primary.map(x => x.id), ['a', 'b']);
  assert.equal(api.ingredientHierarchy({...payload, selectedIngredients:[{id:'m'}]}).supporting.length, 0);
  assert.throws(() => api.ingredientHierarchy({...payload, selectedIngredients:[{id:'unknown'}]}), /未知煉器素材/);
});
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
    existingArtifacts: [{ id:'old', name:'舊燈', realm:'金丹', description:'既有法寶' }],
    adminGenerationDirection: '偏防禦減傷',
    adminGenerationPrompt: '玄武意象，名稱古樸，不要暴擊，以護盾與反震為主。'
  });
  assert.match(prompt, /本次創意方向/);
  assert.match(prompt, /全材料圖鑑/);
  assert.match(prompt, /星砂/);
  assert.match(prompt, /寒玉/);
  assert.match(prompt, /既有法寶摘要/);
  assert.match(prompt, /舊燈/);
  assert.match(prompt, /不要只把材料名稱機械拼接/);
  assert.match(prompt, /管理員指定的大概動向/);
  assert.match(prompt, /偏防禦減傷/);
  assert.match(prompt, /管理員額外提示詞/);
  assert.match(prompt, /玄武意象/);
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

test('admin refinery guidance is admin-only, stored with the furnace job, and reused at claim time', () => {
  assert.match(refinery, /userData\(\)\?\.isAdmin !== true/);
  assert.match(refinery, /data-refinery-admin-direction/);
  assert.match(refinery, /data-refinery-admin-prompt/);
  assert.match(refinery, /管理員煉器導引/);
  assert.match(refinery, /大概動向/);
  assert.match(refinery, /額外提示詞/);
  assert.match(refinery, /startCultivationRefineryJob\?\.\([\s\S]*direction: adminForgeDirection[\s\S]*prompt: adminForgePrompt/);

  assert.match(aiJobs, /const canGuide = data\(\)\?\.isAdmin === true && plan\.discovery/);
  assert.match(aiJobs, /adminGenerationDirection/);
  assert.match(aiJobs, /adminGenerationPrompt/);
  assert.match(aiJobs, /job\.adminGenerationDirection \|\| ''/);
  assert.match(aiJobs, /job\.adminGenerationPrompt \|\| ''/);
  assert.doesNotMatch(aiJobs, /getArtifactGenerationPrompt/);
});

test('unknown recipes start a timed paid job and AI runs only when claiming the completed artifact', () => {
  assert.match(aiJobs, /status: 'refining'/);
  assert.match(aiJobs, /goldCost: plan\.gold/);
  assert.match(aiJobs, /readyAtMs: now \+ plan\.durationMs/);
  assert.match(aiJobs, /'stats\.gold': committed\.gold/);
  assert.match(aiJobs, /consumeRecipe\(raw, plan\.recipe\)/);

  const generatePos = aiJobs.indexOf('async function generateCandidate');
  const claimDiscoveryPos = aiJobs.indexOf('async function claimDiscovery');
  const generatedCallPos = aiJobs.indexOf('const generated = generatedCandidateCache.get(job.id) || await generateCandidate(job)', claimDiscoveryPos);
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
  assert.match(aiJobs, /const cleanLatestRecipes = recipeRepair\.recipes/);
  assert.match(aiJobs, /awardedId = findRecipeBySignature\(cleanLatestRecipes, fresh\.signature\)/);
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

test('player-facing refinery never reveals that unknown recipes are AI-generated', () => {
  assert.doesNotMatch(refinery, /AI/);
  assert.doesNotMatch(refinery, /人工智慧/);
  assert.doesNotMatch(aiJobs, /AI 法寶生成失敗/);
  assert.match(refinery, /未知配方煉製/);
  assert.match(refinery, /煉製完成後按「開爐」即可取得新法寶/);
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


test('admin can securely skip refinery wait without bypassing the normal claim flow', () => {
  assert.match(refinery, /const canAdminSkip = !!job && !jobReady && userData\(\)\?\.isAdmin === true/);
  assert.match(refinery, /data-refinery-admin-skip/);
  assert.match(refinery, /管理員：跳過等待/);
  assert.match(refinery, /skipCultivationRefineryWait\?\.\(\)/);
  assert.match(refinery, /addEventListener\('click', skipAdminWait\)/);

  assert.match(aiJobs, /async function skipJobWait\(\)/);
  assert.match(aiJobs, /raw\.isAdmin !== true/);
  assert.match(aiJobs, /readyAtMs: now/);
  assert.match(aiJobs, /adminSkippedAtMs: now/);
  assert.match(aiJobs, /adminSkippedBy: user\.uid/);
  assert.match(aiJobs, /window\.skipCultivationRefineryWait = skipJobWait/);

  // The actual artifact still goes through the original ready-time checked claim functions.
  assert.match(aiJobs, /async function claimKnown\(job\)/);
  assert.match(aiJobs, /async function claimDiscovery\(job\)/);
  assert.match(aiJobs, /Date\.now\(\) < Number\(fresh\.readyAtMs/);
});


test('pending approval remains clickable and persists only review metadata', () => {
  assert.match(admin, /data-admin-artifact-approve/);
  assert.match(admin, /approveGeneratedArtifact\(approve\.dataset\.adminArtifactApprove\)/);
  const start = admin.indexOf('async function approveGeneratedArtifact');
  const end = admin.indexOf('async function saveFromModal', start);
  const approval = admin.slice(start, end);
  assert.match(approval, /await persistCatalog\(next\)/);
  assert.doesNotMatch(approval, /normalizedRecipes/);
});


test('hidden three-stage refinery progression maps raw materials to parts, then complete gear, then stronger synthesis', () => {
  assert.equal(api.deriveRefinementStage({
    selectedIngredients: [{ type:'material', id:'wood', quantity:2 }],
    existingArtifacts: []
  }), 1);

  assert.equal(api.deriveRefinementStage({
    selectedIngredients: [{ type:'artifact', id:'part-a', quantity:1 }, { type:'material', id:'iron', quantity:1 }],
    existingArtifacts: [{ id:'part-a', refinementDepth:0 }]
  }), 2);

  assert.equal(api.deriveRefinementStage({
    selectedIngredients: [{ type:'artifact', id:'weapon-a', quantity:1 }, { type:'material', id:'crystal', quantity:1 }],
    existingArtifacts: [{ id:'weapon-a', refinementDepth:1 }]
  }), 3);

  const firstPrompt = api.buildPrompt({
    targetRealm:'金丹',
    selectedIngredients:[{ type:'material', id:'wood', name:'靈木', quantity:2 }],
    allMaterials:[{ id:'wood', name:'靈木', realm:'金丹' }],
    existingArtifacts:[]
  });
  assert.match(firstPrompt, /木材加工成木棍/);
  assert.match(firstPrompt, /器胚、零件、核心/);

  const secondPrompt = api.buildPrompt({
    targetRealm:'金丹',
    selectedIngredients:[{ type:'artifact', id:'part-a', name:'靈刃胚', quantity:1 }, { type:'material', id:'wood', quantity:1 }],
    allMaterials:[{ id:'wood', name:'靈木', realm:'金丹' }],
    existingArtifacts:[{ id:'part-a', name:'靈刃胚', realm:'金丹', refinementDepth:0 }]
  });
  assert.match(secondPrompt, /完整可用的武器、護具、法器或靈寶/);

  const thirdPrompt = api.buildPrompt({
    targetRealm:'金丹',
    selectedIngredients:[{ type:'artifact', id:'weapon-a', name:'青鋒劍', quantity:1 }, { type:'material', id:'wood', quantity:1 }],
    allMaterials:[{ id:'wood', name:'靈木', realm:'金丹' }],
    existingArtifacts:[{ id:'weapon-a', name:'青鋒劍', realm:'金丹', refinementDepth:1 }]
  });
  assert.match(thirdPrompt, /完成度最高/);
  assert.match(thirdPrompt, /集結更多彼此協調的特性/);
});

test('server enforces stronger effects across the three hidden refinement stages', () => {
  const raw = {
    name:'測試器',
    equipSlot:'本命法寶',
    effects:[
      { type:'equip_attack_flat', value:99999 },
      { type:'equip_hp_flat', value:99999 },
      { type:'equip_damage_percent', value:9 }
    ]
  };
  const first = api.sanitizeGeneratedArtifact(raw, '金丹', 1);
  const second = api.sanitizeGeneratedArtifact(raw, '金丹', 2);
  const third = api.sanitizeGeneratedArtifact(raw, '金丹', 3);

  assert.equal(first.effects.length, 1);
  assert.ok(second.effects.length >= first.effects.length);
  assert.ok(third.effects.length >= second.effects.length);
  assert.ok(first.effects[0].value < second.effects[0].value);
  assert.ok(second.effects[0].value < third.effects[0].value);
});

test('refinement-stage design rules are sent to AI context but not added to player-facing refinery UI', () => {
  assert.match(aiJobs, /refinementDepth: artifactRecipeDepth\(item\.id\)/);
  assert.doesNotMatch(refinery, /木材加工成木棍/);
  assert.doesNotMatch(refinery, /內部生成規則：第一煉/);
  assert.doesNotMatch(refinery, /內部生成規則：第三煉/);
  assert.doesNotMatch(refinery, /完成度最高的一次/);
});


test('first successfully registered recipe gains immutable ownership without changing existing recipes', () => {
  const claim = aiJobs.slice(aiJobs.indexOf('async function claimDiscovery(job)'), aiJobs.indexOf('async function claimJob()'));
  assert.match(claim, /const \[userSnap, artifactSnap, materialSnap\] = await Promise\.all/);
  assert.match(claim, /awardedId = findRecipeBySignature\(cleanLatestRecipes, fresh\.signature\)/);
  assert.match(claim, /firstDiscovery = !awardedId/);
  assert.match(claim, /if \(!awardedId\) \{/);
  assert.match(claim, /recipeOwnerUid: user\.uid/);
  assert.match(claim, /recipeOwnerName: String\(raw\.displayName \|\| user\.displayName/);
  assert.match(claim, /recipeDiscoveredAtMs: Date\.now\(\)/);
  assert.match(claim, /tx\.set\(artifactRef,[\s\S]*items: committedCatalog/);
  assert.match(claim, /tx\.set\(materialRef,[\s\S]*recipes: committedRecipes/);
  assert.match(claim, /recipeFirstDiscovery: firstDiscovery/);
  assert.doesNotMatch(claim.slice(claim.indexOf('} else if (recipeRepair.changed)')), /recipeOwnerUid:/);
});

test('recipe owner survives catalog normalization and concurrent admin saves', () => {
  const context = vm.createContext({console, Math, Number, String, Object, Array});
  const source = artifactCatalog
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ')
    + '\n;globalThis.__catalog={normalizeArtifactDefinition};';
  vm.runInContext(source, context);
  const result = context.__catalog.normalizeArtifactDefinition({
    id:'first-recipe', name:'首發法寶', realm:'築基', effects:[{type:'equip_attack_flat',value:20}],
    recipeOwnerUid:'first-user',recipeOwnerName:'發現者',recipeDiscoveredAtMs:123456
  });
  assert.equal(result.recipeOwnerUid, 'first-user');
  assert.equal(result.recipeOwnerName, '發現者');
  assert.equal(result.recipeDiscoveredAtMs, 123456);
  const legacy = context.__catalog.normalizeArtifactDefinition({id:'old',name:'舊配方'});
  assert.equal(Object.hasOwn(legacy,'recipeOwnerUid'),false);
  assert.match(admin, /recipeOwnerUid: original\?\.recipeOwnerUid \|\| ''/);
  assert.match(admin, /const \[userSnap, configSnap\] = await Promise\.all/);
  assert.match(admin, /const owners = new Map\(persistedItems/);
  assert.match(admin, /recipeOwnerUid: owner\.recipeOwnerUid/);
  assert.match(admin, /items: committedCatalog/);
  assert.match(admin, /replaceArtifactCatalog\(committedCatalog, 'admin-save'\)/);
});

test('refinery recipe book displays discovered formulas and first-owner details', () => {
  assert.match(refinery, /function recipeBookMarkup\(\)/);
  assert.match(refinery, /getArtifactRecipe\(item\.id\)/);
  assert.match(refinery, /myUid && item\.recipeOwnerUid === myUid/);
  assert.match(refinery, /你是首位發現者 · 配方擁有權已登錄/);
  assert.match(refinery, /首發擁有者：/);
  assert.match(refinery, /既有公共配方/);
  assert.match(refinery, /配方是製作指南，不是煉器許可證/);
  assert.match(refinery, /首發者永久保有發現紀錄/);
  assert.match(refinery, /data-refinery-recipe-book/);
  assert.match(refinery, /recipeBookOpen = event\.currentTarget\.open/);
  assert.match(refinery, /item\?\.recipeFirstDiscovery/);
  assert.match(refinery, /首發成功！/);
});
