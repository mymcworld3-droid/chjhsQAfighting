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

test('every supported AI effect has explicit safe bounds for each eligible realm and refinement stage', () => {
  const types = [...api.ALLOWED_EFFECTS];
  assert.equal(api.REALMS.length, 11);
  assert.equal(types.length, 24);
  for (const [order, realm] of api.REALMS.entries()) {
    for (const stage of [1, 2, 3]) {
      const ranges = api.effectRangesForRealm(realm, stage);
      assert.equal(new Set(ranges.map(item => item.type)).size, ranges.length);
      for (const range of ranges) {
        assert.ok(api.ALLOWED_EFFECTS.has(range.type));
        assert.equal(range.type, api.effectRange(range.type, order, stage).type);
        assert.ok(range.label);
        if (range.field === 'value' || range.field === 'multiplier') {
          assert.ok(range.min > 0 && range.max >= range.min, `${realm}/${stage}/${range.type} bounds`);
          const low = api.sanitizeEffect({
            type: range.type, value: -99, multiplier: -99, durationMinutes: -99
          }, order, stage);
          const high = api.sanitizeEffect({
            type: range.type, value: 999999, multiplier: 999999, durationMinutes: 999999
          }, order, stage);
          assert.equal(low[range.field], range.min, `${realm}/${stage}/${range.type} lower clamp`);
          assert.equal(high[range.field], range.max, `${realm}/${stage}/${range.type} upper clamp`);
          if (range.field === 'multiplier') {
            assert.equal(low.durationMs, Math.round(range.durationMinutesMin * 60000));
            assert.equal(high.durationMs, Math.round(range.durationMinutesMax * 60000));
          }
        } else if (range.type === 'remove_wrong_option') {
          assert.equal(range.min, 1);
          assert.equal(range.max, 1);
          assert.equal(api.sanitizeEffect({ type: range.type, value: 999 }, order, stage).perQuestion, 1);
        } else {
          assert.equal(range.field, 'none');
          assert.equal(range.min, null);
          assert.equal(range.max, null);
          assert.deepEqual(Object.keys(api.sanitizeEffect({ type: range.type }, order, stage)), ['type']);
        }
      }
    }
  }
  assert.equal(api.effectRangesForRealm('真仙', 3).length, types.length);
  assert.equal(api.effectRange('equip_cheat_death', 0, 3), null);
  assert.equal(api.effectRange('equip_copy_enemy_artifact', 10, 2), null);
});

test('artifact progression scales effect ranges without allowing empty or inflated values', () => {
  const basic = api.effectRange('equip_attack_flat', 0, 3);
  const immortal = api.effectRange('equip_attack_flat', 10, 3);
  assert.deepEqual([basic.min, basic.max], [13, 35]);
  assert.deepEqual([immortal.min, immortal.max], [295, 385]);
  const lowStage = api.effectRange('equip_attack_flat', 3, 1);
  const topStage = api.effectRange('equip_attack_flat', 3, 3);
  assert.ok(lowStage.min > 0 && lowStage.max < topStage.max);
  assert.ok(api.effectRange('equip_combo_chance', 10, 3).max <= 0.10);
  const cap = api.effectRange('equip_damage_cap_percent', 10, 3);
  assert.ok(cap.min < cap.max && cap.max <= 0.8);
  assert.match(cap.note, /越小越強/);
  assert.ok(api.effectRange('equip_damage_cap_percent', 10, 2).min > cap.min);
  const generated = api.sanitizeGeneratedArtifact({
    name:'極值測試', equipSlot:'本命法寶',
    effects:[{type:'equip_attack_flat',value:0},{type:'equip_hp_percent',value:999999}]
  }, '真仙', 3);
  assert.ok(generated.effects[0].value >= api.effectRange('equip_attack_flat', 10, 3).min);
  assert.ok(generated.effects[1].value <= api.effectRange('equip_hp_percent', 10, 3).max);
});

test('AI receives only currently eligible effect ranges with actual min and max', () => {
  const input = {
    targetRealm:'真仙',
    selectedIngredients:[{type:'material',id:'a',quantity:2}],
    allMaterials:[{id:'a',name:'仙晶',realm:'真仙'}], existingArtifacts:[]
  };
  const prompt = api.buildPrompt(input);
  assert.match(prompt, /各特性實際數值上下限/);
  assert.match(prompt, /"type": "equip_attack_flat"/);
  assert.match(prompt, /"min": 113/);
  assert.match(prompt, /"max": 146/);
  assert.match(prompt, /單次生命傷害上限/);
  assert.match(prompt, /數值越小代表越強/);
  assert.match(prompt, /每場固定一次/);
  assert.match(prompt, /法寶無修士境界裝備限制/);
  const rangeBlock = prompt.slice(prompt.indexOf('各特性實際數值上下限'));
  assert.doesNotMatch(rangeBlock.split('允許效果 type：')[0], /"type": "equip_cheat_death"/);
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
  assert.match(prompt, /創意方向僅在相容時作次要參考/);
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

test('ordinary forging favors attack artifacts and allows effective offensive first-refinement cores', () => {
  const payload = {
    selectedIngredients:[{type:'material',id:'iron',quantity:2}],
    allMaterials:[{id:'iron',name:'玄鐵',realm:'煉氣',description:'可鍛造鋒利兵刃',story:'曾用於前線兵器'}],
    existingArtifacts:[]
  };
  const prompt = api.buildPrompt(payload);
  assert.match(prompt, /攻擊型法寶占多數（目標約七成至八成）/);
  assert.match(prompt, /第一煉就能提供合理的固定攻擊、百分比攻擊、增傷、真傷或暴擊/);
  assert.match(prompt, /第一煉允許直接生成攻擊型器胚與其實際攻擊效果/);
  assert.match(prompt, /劍胚、刃胚、槍尖、箭簇、破甲符骨、雷擊核心、炎脈器芯/);
  assert.match(prompt, /至少要有一項實際的攻擊／增傷／真傷／暴擊／連擊／低血增傷/);
  assert.match(prompt, /"type": "equip_attack_flat"/);
  assert.doesNotMatch(prompt, /"type": "equip_cheat_death"/);
  // Direction sampling is intentionally biased, not a compulsory reclassification.
  const source = read('artifact-generation-api.js');
  const directions = source.slice(source.indexOf('  const creativeDirections = ['), source.indexOf('  const creativeDirection ='));
  assert.equal((directions.match(/^    '/gm) || []).length, 8);
  assert.equal((directions.match(/^    '(?:鋒銳兵胚|雷火攻器|破陣戰器|星辰殺器|兇烈戰器|精巧飛刃)/gm) || []).length, 6);
  const defensive = api.buildPrompt({...payload,adminGenerationPrompt:'只煉護盾類防具，不要任何攻擊能力'});
  assert.match(defensive, /只煉護盾類防具，不要任何攻擊能力/);
  assert.match(defensive, /不要用隨機風格取代管理員要求/);
  const stageTwo = api.buildPrompt({
    selectedIngredients:[{type:'artifact',id:'blade',quantity:1},{type:'material',id:'iron',quantity:1}],
    allMaterials:payload.allMaterials,
    existingArtifacts:[{id:'blade',name:'雷刃胚',realm:'煉氣',description:'具備攻擊力的刃胚',refinementDepth:0,
      effects:[{type:'equip_attack_flat',value:12}]}]
  });
  assert.match(stageTwo, /承接攻擊型器胚時，優先形成可用的劍、槍、刃、弓/);
  const stageThree = api.buildPrompt({
    selectedIngredients:[{type:'artifact',id:'blade',quantity:1},{type:'material',id:'iron',quantity:1}],
    allMaterials:payload.allMaterials,
    existingArtifacts:[{id:'blade',name:'雷刃',realm:'煉氣',description:'已完成的雷刃',refinementDepth:1,
      effects:[{type:'equip_attack_flat',value:24}]}]
  });
  assert.match(stageThree, /攻擊型前階成品應延續其核心攻擊能力/);
  const weaponPayload = {
    selectedIngredients:[{type:'material',id:'sword-forging-iron',quantity:2}],
    allMaterials:[{id:'sword-forging-iron',name:'鑄劍玄鐵',realm:'煉氣',
      category:'兵器材料',description:'可直接鍛成完整長劍',
      story:'山門用於鑄造入門佩劍',
      weaponForm:'劍',weaponName:'玄鐵劍'}],
    existingArtifacts:[]
  };
  const weaponPrompt = api.buildPrompt(weaponPayload);
  assert.match(weaponPrompt, /正式兵器材料例外/);
  assert.match(weaponPrompt, /weaponForm=劍、weaponName=玄鐵劍/);
  assert.match(weaponPrompt, /即使是第一煉，也應直接完成可用的劍類武器/);
  assert.match(weaponPrompt, /第一煉直接完成對應兵器/);
  assert.match(aiJobs, /weaponForm: item\.weaponForm \|\| ''/);
  assert.match(aiJobs, /weaponName: item\.weaponName \|\| ''/);
});

test('material lore is preserved by both admin editors and delivered as official ingredient context', () => {
  const materialCatalog = read('public/cultivation/material-catalog.js');
  const editor = read('public/cultivation/admin-material-manager.js');
  const realmEditor = read('public/cultivation/admin-material-realm-editor.js');
  assert.match(materialCatalog, /story: String\(raw\.story \|\| ''\)\.trim\(\)\.slice\(0, 2000\)/);
  for (const [src, prefix] of [[editor, 'amm'], [realmEditor, 'amre']]) {
    assert.match(src, new RegExp('id="' + prefix + '-story"'));
    assert.match(src, new RegExp("story: modal\\.querySelector\\('#" + prefix + "-story'\\)\\.value"));
  }
  assert.match(aiJobs, /story: item\.story \|\| ''/);
  assert.match(aiJobs, /description: item\.description, story: item\.story \|\| ''/);
  const payload = {
    targetRealm:'金丹',
    selectedIngredients:[{type:'material',id:'star',name:'惡意偽名',story:'偽造故事',quantity:2}],
    allMaterials:[{id:'star',name:'星辰砂',realm:'金丹',description:'可引星辰入器',
      story:'古代天象司保存的星砂，夜半會映出昔日星圖',category:'特殊材料'}],
    existingArtifacts:[]
  };
  const hierarchy = api.ingredientHierarchy(payload);
  assert.equal(hierarchy.primary[0].story, payload.allMaterials[0].story);
  assert.equal(hierarchy.primary[0].name, '星辰砂');
  assert.doesNotMatch(JSON.stringify(hierarchy), /偽造故事|惡意偽名/);
  const prompt = api.buildPrompt(payload);
  assert.match(prompt, /投入素材完整設定/);
  assert.match(prompt, /古代天象司保存的星砂/);
  assert.match(prompt, /可引星辰入器/);
  assert.match(prompt, /若 story 為空/);
});

test('admin directions override random style when compatible, and get separate guidance compliance review', async () => {
  const payload = {
    targetRealm:'金丹',
    selectedIngredients:[{type:'material',id:'star',quantity:2}],
    allMaterials:[{id:'star',name:'星砂',realm:'金丹',description:'引星入器',story:'舊天文臺的遺砂'}],
    existingArtifacts:[],
    adminGenerationDirection:'護盾與防禦',
    adminGenerationPrompt:'禁止劍型，法寶應是觀星圓盤，故事要承接天文臺；不要暴擊。'
  };
  const prompt = api.buildPrompt(payload);
  assert.match(prompt, /不要用隨機風格取代管理員要求/);
  assert.match(prompt, /管理員的額外提示詞與大概動向不是可忽略的隨機風格/);
  assert.match(prompt, /逐條遵守可行的創作要求/);
  const reviewPrompt = api.buildGuidanceReviewPrompt(payload, {
    name:'星砂劍',description:'劍',effects:[{type:'equip_attack_flat',value:30}]
  }, '金丹',1);
  assert.match(reviewPrompt, /觀星圓盤/);
  assert.match(reviewPrompt, /舊天文臺的遺砂/);
  assert.match(reviewPrompt, /"min"/);
  const router = require('../ai-router.js');
  const saved = router.generateJSON;
  let calls = 0;
  router.generateJSON = async () => {
    calls++;
    return { data: { aligned:false, issues:['器型錯誤'], revisedArtifact: {
      name:'天文觀星盤',icon:'盤',description:'舊天文臺的星砂鑄成的護身觀星盤',
      equipSlot:'護身法寶',effects:[{type:'equip_shield_flat',value:999999}]
    }}};
  };
  try {
    const original = api.sanitizeGeneratedArtifact({
      name:'星砂劍',icon:'劍',description:'劍',equipSlot:'本命法寶',
      effects:[{type:'equip_attack_flat',value:30}]
    }, '金丹',1);
    const reviewed = await api.reviewGuidedArtifact(payload, original, '金丹',1);
    assert.equal(calls,1);
    assert.equal(reviewed.guidanceReview,'revised');
    assert.equal(reviewed.artifact.name,'天文觀星盤');
    assert.equal(reviewed.artifact.effects[0].type,'equip_shield_flat');
    assert.equal(reviewed.artifact.effects[0].value,api.effectRange('equip_shield_flat',3,1,{},false,{},2).max);
    assert.equal(original.name,'星砂劍');
    const none = await api.reviewGuidedArtifact({...payload,adminGenerationDirection:'',adminGenerationPrompt:''},original,'金丹',1);
    assert.equal(none.guidanceReview,'not-requested');
    assert.equal(calls,1,'ordinary forging must not incur extra review');
  } finally { router.generateJSON = saved; }
});

test('optional guidance review cannot replace a valid artifact with an invalid response', async () => {
  const router = require('../ai-router.js'), saved = router.generateJSON;
  const payload = {
    selectedIngredients:[{id:'a',quantity:2}],
    allMaterials:[{id:'a',name:'玄鐵',realm:'煉氣'}],
    existingArtifacts:[],adminGenerationPrompt:'做成護甲'
  };
  const original = api.sanitizeGeneratedArtifact({
    name:'玄鐵劍',description:'既有成品',effects:[{type:'equip_attack_flat',value:20}]
  },'煉氣',1);
  router.generateJSON = async () => ({data: {aligned:false,issues:['不是護甲'],revisedArtifact:{name:'空殼',description:'修訂',effects:[]}}});
  try {
    const checked = await api.reviewGuidedArtifact(payload,original,'煉氣',1);
    assert.equal(checked.guidanceReview,'unresolved');
    assert.equal(checked.artifact,original);
  } finally {router.generateJSON=saved;}
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
  assert.match(admin, /const \[userSnap, configSnap, transferSnap\] = await Promise\.all/);
  assert.match(admin, /const owners = new Map\(persistedItems/);
  assert.match(admin, /recipeOwnerUid: owner\.recipeOwnerUid/);
  assert.match(admin, /items: committedCatalog/);
  assert.match(admin, /replaceArtifactCatalog\(committedCatalog, 'admin-save'\)/);
});

test('recipe compendium uses artifact cards and visual material tiles rather than joined text', () => {
  assert.match(refinery, /function recipeIngredientMarkup\(row\)/);
  assert.match(refinery, /ingredientMeta\(token\)/);
  assert.match(refinery, /ingredientAvailable\(token\)/);
  assert.match(refinery, /refinery-recipe-artifact-icon/);
  assert.match(refinery, /refinery-recipe-artifact-title/);
  assert.match(refinery, /refinery-recipe-access/);
  assert.match(refinery, /refinery-recipe-ingredients-head/);
  assert.match(refinery, /<ul class="refinery-recipe-ingredients">/);
  assert.match(refinery, /<li class="refinery-recipe-ingredient/);
  assert.match(refinery, /refinery-recipe-material-icon/);
  assert.match(refinery, /refinery-recipe-material-meta/);
  assert.match(refinery, /refinery-recipe-stock/);
  assert.match(refinery, /refinery-recipe-required/);
  assert.match(refinery, /refinery-recipe-grid/);
  assert.match(refinery, /max-height:min\(75dvh,760px\)/);
  assert.match(refinery, /@media\(max-width:520px\)[^\n]*refinery-recipe-ingredients/);
  assert.doesNotMatch(refinery, /\.join\(' · '\) : '製作材料未公開/);
});

test('recipe compendium protects unknown formulas and still shows public, first-owned or licensed recipes', () => {
  assert.match(refinery, /const learned = userData\(\)\?\.recipeLicenses\?\.\[item\.id\] === true/);
  assert.match(refinery, /const canReadRecipe = recipeAvailableToPlayer\(item, myUid\)/);
  assert.match(refinery, /const recipe = canReadRecipe \? getArtifactRecipe\(item\.id\) : \[\]/);
  assert.match(refinery, /const ingredients = canReadRecipe/);
  assert.match(refinery, /canReadRecipe && item\.description/);
  assert.match(refinery, /refinery-recipe-sealed/);
  assert.match(refinery, /此配方的素材與數量尚未公開/);
  assert.match(refinery, /配方是製作指南，不是煉器許可證/);
  assert.match(refinery, /前往交易市集/);
});

test('real refinery runtime style replaces the legacy preload so recipe cards render on iPad', () => {
  const index = read('public/index.html');
  const match = index.match(/<style id="cultivation-refinery-v2-preload-style"[^>]*>/g) || [];
  assert.equal(match.length, 1, 'static markup has exactly one temporary preload');
  assert.doesNotMatch(index, /<style id="cultivation-refinery-v2-style">/);
  const start = refinery.indexOf('  function ensureStyle() {');
  const end = refinery.indexOf('  function tabActive(', start);
  assert.ok(start >= 0 && end > start);
  const styleSource = refinery.slice(start, end);
  assert.match(styleSource, /cultivation-refinery-v2-runtime-style/);
  assert.match(styleSource, /cultivation-refinery-v2-preload-style/);
  assert.match(styleSource, /refinery-recipe-card:not\(\[open\]\) > \.refinery-recipe-detail/);
  assert.match(styleSource, /refinery-recipe-book:not\(\[open\]\) > \.refinery-recipe-book-content/);
  assert.match(styleSource, /display:none!important/);
  assert.match(styleSource, /refinery-recipe-artifact-icon/);
  assert.match(styleSource, /refinery-recipe-intro/);
  assert.match(styleSource, /refinery-recipe-craft/);
  let removed = 0;
  let runtimeStyle = null;
  const preload = {remove: () => { removed++; }};
  const context = {
    document: {
      getElementById: id => id === 'cultivation-refinery-v2-preload-style' ? (removed ? null : preload) :
        (id === 'cultivation-refinery-v2-runtime-style' ? runtimeStyle : null),
      createElement: tag => {
        assert.equal(tag, 'style');
        return {id:'',textContent:''};
      },
      head: {
        appendChild: node => { assert.equal(runtimeStyle, null); runtimeStyle = node; }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(styleSource + '\nthis.installRefineryStyle = ensureStyle;',context);
  context.installRefineryStyle();
  assert.equal(runtimeStyle.id,'cultivation-refinery-v2-runtime-style');
  assert.ok(runtimeStyle.textContent.length > 1000);
  assert.ok(runtimeStyle.textContent.includes('.refinery-recipe-card[open]'));
  assert.equal(removed,1,'legacy preload removed after full stylesheet was installed');
  context.installRefineryStyle();
  assert.equal(removed,1,'no duplicate stylesheet or unnecessary reinstall');
});

test('real player refinery recipe compendium opens compact summaries into details and paid crafting actions', () => {
  const markupStart = refinery.indexOf('  function recipeBookMarkup() {');
  const markupEnd = refinery.indexOf('  function ensureStyle() {', markupStart);
  const markup = refinery.slice(markupStart, markupEnd);
  assert.ok(markupStart >= 0 && markupEnd > markupStart);
  assert.match(markup, /return .<details class="refinery-recipe-card/);
  assert.match(markup, /<summary class="refinery-recipe-card-head">/);
  assert.match(markup, /refinery-recipe-intro/);
  assert.match(markup, /data-refinery-recipe-card/);
  assert.match(markup, /expandedRecipeId === item.id/);
  assert.match(markup, /<div class="refinery-recipe-detail">/);
  assert.match(markup, /製作方法/);
  assert.match(markup, /data-refinery-craft-recipe/);
  assert.match(markup, /以此煉製/);
  assert.match(markup, /recipe.map\(recipeIngredientMarkup\)/);
  assert.match(refinery, /function bindContent\(content\)/);
  assert.match(refinery, /button\.addEventListener\('click', \(\) => \{ void craftFromRecipe\(button\.dataset\.refineryCraftRecipe\); \}\)/);
  assert.match(refinery, /content\.querySelectorAll\('\[data-refinery-recipe-card\]'\)/);
  assert.match(refinery, /previousBookScroll/);
  assert.match(refinery, /const nextBook = content\.querySelector\('\.refinery-recipe-book-content'\)/);
  assert.match(refinery, /function markup\(\)[\s\S]*\$\{recipeBookMarkup\(\)\}/);
  assert.match(refinery, /data-training-tab="\$\{TAB\}"/);
  assert.match(refinery, /#training-tab-content/);
});

test('recipe craft action rechecks license, inventory, payment and calls the real furnace without spending on invalid recipes', async () => {
  const start = refinery.indexOf('  async function craftFromRecipe(artifactId) {');
  const end = refinery.indexOf('  function add(token) {', start);
  assert.ok(start > 0 && end > start);
  let authorized = false;
  let stock = 2;
  let gold = 100;
  let calledCraft = 0;
  let renders = 0;
  const messages = [];
  const context = {
    busy: false, SLOT_COUNT: 8, selected: Array(8).fill('old'),
    window: { getCultivationRefineryJob: () => null,
      getCultivationRefineryPlan: (tokens, id) => ({ valid: true, knownArtifactId: id, gold: 80 }) },
    toast: (msg) => messages.push(msg),
    authUser: () => ({ uid: 'player' }),
    getArtifactById: (id) => id === 'blade' ? { id: 'blade' } : null,
    recipeAvailableToPlayer: () => authorized,
    getArtifactRecipe: () => [{ materialId: 'iron', quantity: 2 }],
    recipeTokens: () => ['material:iron', 'material:iron'],
    matchingRecipeForTokens: () => true,
    recipeCounts: () => ({ 'material:iron': 2 }),
    ingredientAvailable: () => stock,
    userData: () => ({ stats: { gold } }),
    render: () => { renders++; },
    craft: async () => {
      calledCraft++;
      assert.deepEqual(context.selected.slice(0, 2), ['material:iron', 'material:iron']);
      assert.ok(context.selected.slice(2).every(value => value === null));
    }
  };
  vm.createContext(context);
  vm.runInContext(refinery.slice(start, end) + '\nthis.runCraftFromRecipe = craftFromRecipe;', context);
  await context.runCraftFromRecipe('blade');
  assert.equal(calledCraft, 0, 'unlicensed recipe cannot be used via a stale button');
  assert.equal(context.selected[0], 'old');
  authorized = true;
  stock = 1;
  await context.runCraftFromRecipe('blade');
  assert.equal(calledCraft, 0, 'insufficient material cannot replace occupied forge slots');
  stock = 2;
  gold = 70;
  await context.runCraftFromRecipe('blade');
  assert.equal(calledCraft, 0, 'insufficient currency cannot start a job');
  gold = 100;
  await context.runCraftFromRecipe('blade');
  assert.equal(calledCraft, 1, 'valid recipe starts exactly one existing forge job');
  assert.equal(renders, 1);
  assert.ok(messages.some(message => message.includes('配方')));
  assert.ok(messages.some(message => message.includes('製作材料不足')));
  assert.ok(messages.some(message => message.includes('靈石不足')));
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
