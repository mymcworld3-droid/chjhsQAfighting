const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../artifact-generation-api.js');
const pool = require('../public/cultivation/soulbound-pool.js');
const vm = require('node:vm');
const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

const proposed = (slot = '本命法寶') => ({
  name: '試驗靈劍', weaponForm:'劍', equipSlot:slot,
  effects:[{ type:'equip_attack_flat', value:50 }]
});
const boundBase = {
  id:'already-owned', equipSlot:'本命法寶', weaponForm:'劍',
  effects:[{ type:'equip_attack_flat', value:60 }]
};

test('all permanent weapons strictly improve every original stat even with weaker AI rolls and low realm bounds', () => {
  for (const source of pool.ITEMS) {
    let previous = source;
    for (const stage of [2, 3]) {
      const result = api.sanitizeGeneratedArtifact({ ...proposed(), effects:source.effects.map(row => ({...row,value:0})) },
        '金丹', stage, {}, {}, 2, {primaryArtifacts:[previous]});
      for (const old of previous.effects) {
        assert.ok(result.effects.find(row => row.type === old.type).value > old.value, source.id + ':' + old.type);
      }
      assert.equal(result.equipSlot,'本命法寶');
      previous = result;
    }
  }
});

test('a fourth affix survives further refinement and a fifth cannot replace any existing affix', () => {
  const source = {...pool.ITEMS[0],effects:[...pool.ITEMS[0].effects,{type:'equip_true_damage_flat',value:9999}]};
  const result = api.sanitizeGeneratedArtifact({...proposed(),effects:[{type:'equip_shield_flat',value:99999}]},
    '金丹',3,{}, {},2,{primaryArtifacts:[source]});
  assert.deepEqual(result.effects.map(row => row.type),source.effects.map(row => row.type));
  assert.equal(result.effects.length,4);
  assert.equal(result.effects[3].value,10000);
  pool.assertRefinementImproves(result,[source]);
});

test('inverse damage caps improve downwards and fixed abilities survive without invented numeric values', () => {
  const source = {...boundBase,effects:[{type:'equip_damage_cap_percent',value:.2},{type:'equip_cheat_death'}]};
  const result = api.sanitizeGeneratedArtifact({...proposed(),effects:[{type:'equip_damage_cap_percent',value:1}]},
    '金丹',3,{}, {},2,{primaryArtifacts:[source]});
  assert.ok(result.effects.find(row => row.type === 'equip_damage_cap_percent').value < .2);
  assert.deepEqual(result.effects.find(row => row.type === 'equip_cheat_death'),{type:'equip_cheat_death'});
  pool.assertRefinementImproves(result,[source]);
});

test('capped stats and recipes requiring over four inherited affixes fail instead of silently weakening weapons', () => {
  assert.throws(() => pool.refineEffects([], [{...boundBase,effects:[{type:'equip_combo_chance',value:.12}]}]),/已達上限/);
  const tooMany = {...boundBase,effects:[...pool.ITEMS[0].effects,
    {type:'equip_true_damage_flat',value:1},{type:'equip_shield_flat',value:1}]};
  assert.throws(() => pool.refineEffects([], [tooMany]),/超過四個/);
});

test('known recipes must improve current source values even when their rule version is current', () => {
  const source = pool.ITEMS[0];
  const stale = {...source,soulboundRefinementVersion:pool.REFINEMENT_VERSION};
  assert.equal(pool.refinementCompatible(stale,true,[source]),false);
  const fresh = {...stale,effects:pool.refineEffects([], [source])};
  assert.equal(pool.refinementCompatible(fresh,true,[source]),true);
  assert.equal(pool.refinementCompatible({...fresh,soulboundRefinementVersion:1},true,[source]),false);
});

test('catalog round trips preserve strict upgrades without clamping original stats back down', () => {
  const context = {QASoulboundPool:pool};
  vm.runInNewContext(read('public/cultivation/artifact-catalog.js').replace(/^import .*;\n/gm,'').replace(/export (const|function) /g,'$1 ')
    +'\nthis.validate=validateArtifactCatalog;',context);
  for (const source of pool.ITEMS) {
    const refined = api.sanitizeGeneratedArtifact(proposed(),'金丹',2,{}, {},2,{primaryArtifacts:[source]});
    const saved = context.validate([{...refined,id:'roundtrip'}])[0];
    pool.assertRefinementImproves(saved,[source]);
  }
});

test('ordinary new forging cannot create a soulbound equipment slot', () => {
  for (const stage of [1, 2, 3]) {
    const artifact = api.sanitizeGeneratedArtifact(proposed(), '元嬰', stage);
    assert.notEqual(artifact.equipSlot, '本命法寶');
    assert.ok(['護身法寶','佩飾法寶','輔助法寶'].includes(artifact.equipSlot));
  }
});

test('any genuine soulbound input retains its slot even if a legacy job says stage one', () => {
  const artifact = api.sanitizeGeneratedArtifact(proposed(), '元嬰', 1, {}, {}, 3, {
    primaryArtifacts: [boundBase]
  });
  assert.equal(artifact.equipSlot, '本命法寶');
});

test('existing soulbound primary remains soulbound after second and third refinements', () => {
  for (const stage of [2, 3]) {
    const artifact = api.sanitizeGeneratedArtifact(proposed('佩飾法寶'), '元嬰', stage, {}, {}, 3, {
      primaryArtifacts:[boundBase]
    });
    assert.equal(artifact.equipSlot, '本命法寶');
  }
});

test('non-soulbound primary cannot assign itself a soulbound slot through AI', () => {
  const artifact = api.sanitizeGeneratedArtifact(proposed(), '元嬰', 2, {}, {}, 3, {
    primaryArtifacts:[{ ...boundBase, equipSlot:'護身法寶' }]
  });
  assert.notEqual(artifact.equipSlot, '本命法寶');
});

function payloadForBound(sources = [pool.ITEMS.find(item => item.id === 'soul-sword-golden-core')]) {
  return {
    selectedIngredients:[{type:'artifact',id:'ordinary',quantity:1}, ...sources.map(item => ({type:'artifact',id:item.id,quantity:1}))],
    allMaterials:[{id:'ore',name:'礦石',realm:'金丹'}],
    existingArtifacts:[{id:'ordinary',name:'普通法盾',realm:'元嬰',equipSlot:'護身法寶',refinementDepth:1,weaponForm:'法盾',effects:[{type:'equip_shield_flat',value:99}]}, ...sources],
    forgeMethod:'護體鑄造'
  };
}

test('a shallower soulbound ingredient wins over deeper ordinary artifacts in either order', () => {
  const payload = payloadForBound();
  for (const selectedIngredients of [payload.selectedIngredients, [...payload.selectedIngredients].reverse()]) {
    const input = {...payload,selectedIngredients};
    const hierarchy = api.ingredientHierarchy(input);
    assert.deepEqual(hierarchy.primary.map(item => item.id), ['soul-sword-golden-core']);
    assert.equal(api.lockedWeaponForm(input), '飛劍');
    const result = api.sanitizeGeneratedArtifact({ ...proposed('護身法寶'), effects:[{type:'equip_shield_flat',value:9999}] }, '元嬰', 3, {}, {}, 2, {
      primaryArtifacts:hierarchy.primary, weaponForm:api.lockedWeaponForm(input)
    });
    assert.equal(result.equipSlot, '本命法寶');
    assert.equal(result.weaponForm, '飛劍');
    assert.equal(result.coreEffect, 'equip_combo_chance');
    assert.deepEqual(result.effects.map(effect => effect.type), ['equip_combo_chance','equip_attack_flat','equip_hp_flat','equip_shield_flat']);
    assert.equal(result.soulboundRefinementVersion, pool.REFINEMENT_VERSION);
  }
});

test('multiple soulbound inputs select the same core and form regardless of input order', () => {
  const payload = payloadForBound([pool.ITEMS[0], pool.ITEMS[1]]);
  const first = api.ingredientHierarchy(payload).primary;
  const second = api.ingredientHierarchy({...payload,selectedIngredients:[...payload.selectedIngredients].reverse()}).primary;
  assert.deepEqual(first, second);
  assert.equal(api.lockedWeaponForm(payload), first[0].weaponForm);
});

test('soulbound ranges multiply special attributes by 1.2 but preserve all attack and HP bounds', () => {
  for (const stage of [2, 3]) for (const count of [2, 3, 8]) {
    const normal = api.effectRangesForRealm('元嬰',stage,{}, {},count);
    const bound = api.effectRangesForRealm('元嬰',stage,{}, {},count,true);
    for (const type of ['equip_damage_percent','equip_streak_damage_percent','equip_reflect_percent','equip_true_damage_flat','equip_shield_flat','equip_on_correct_shield_flat']) {
      const ordinary = normal.find(row => row.type === type);
      const soulbound = bound.find(row => row.type === type);
      assert.equal(soulbound.min, Number((ordinary.min * 1.2).toFixed(4)), type);
      assert.equal(soulbound.max, Number((ordinary.max * 1.2).toFixed(4)), type);
    }
    for (const type of ['equip_attack_flat','equip_attack_percent','equip_hp_flat','equip_hp_percent','timed_attack_multiplier']) {
      assert.deepEqual(bound.find(row => row.type === type),normal.find(row => row.type === type));
    }
    const inverse = bound.find(row => row.type === 'equip_damage_cap_percent');
    assert.equal(inverse.min,Number((normal.find(row => row.type === inverse.type).min / 1.2).toFixed(4)));
    for (const range of bound) {
      const effect = api.sanitizeEffect({type:range.type,value:1e9,multiplier:1e9}, 4,stage,{}, {},count,true);
      if (range.field === 'value' || range.field === 'multiplier') assert.equal(effect[range.field],range.type.endsWith('_flat') ? Math.floor(range.max) : range.max);
    }
  }
});

test('catalog saving and reading preserves soulbound special bounds and attack/HP exceptions', () => {
  const context = {QASoulboundPool:pool};
  const source = read('public/cultivation/artifact-catalog.js').replace(/^import .*;\n/gm,'').replace(/export (const|function) /g,'$1 ');
  vm.runInNewContext(source+'\nthis.validate=validateArtifactCatalog;',context);
  for (const soulbound of [false,true]) {
    const item = context.validate([{
      id:'refined-test',name:'精煉法寶',realm:'元嬰',equipSlot:soulbound ? '本命法寶' : '護身法寶',
      soulboundRefinementVersion:pool.REFINEMENT_VERSION,
      effects:[{type:'equip_combo_chance',value:.4},{type:'equip_streak_damage_percent',value:9},
        {type:'equip_attack_percent',value:20},{type:'equip_hp_percent',value:20}]
    }])[0];
    assert.equal(item.effects[0].value,soulbound ? .12 : .1);
    assert.equal(item.effects[1].value,soulbound ? 3.6 : 3);
    assert.equal(item.effects[2].value,5);
    assert.equal(item.effects[3].value,5);
    const inverse = context.validate([{...item,effects:[{type:'equip_damage_cap_percent',value:.0125}]}])[0];
    assert.equal(inverse.effects[0].value,soulbound ? .05 / 1.2 : .05);
    assert.equal(item.soulboundRefinementVersion,soulbound ? pool.REFINEMENT_VERSION : undefined);
  }
});

test('existing ordinary results from soulbound recipes must be rediscovered using the new rules', () => {
  assert.equal(pool.refinementCompatible({equipSlot:'護身法寶'},true),false);
  assert.equal(pool.refinementCompatible({equipSlot:'本命法寶'},true),false);
  assert.equal(pool.refinementCompatible({equipSlot:'本命法寶',soulboundRefinementVersion:pool.REFINEMENT_VERSION},true),true);
  assert.equal(pool.refinementCompatible({equipSlot:'護身法寶'},false),true);
  assert.equal(pool.refinementCompatible({equipSlot:'本命法寶',soulboundRefinementVersion:pool.REFINEMENT_VERSION},false),false);
});

test('soulbound combo and inverse damage cap work in actual PvP resolution', () => {
  const combo = require('../public/cultivation/combat-combo.js');
  const ctx = {window:{},QACombatCombo:combo};
  vm.runInNewContext(read('public/cultivation/artifact-battle-effects.js').replace(/^import .*;\n/gm,''),ctx);
  const attacker = {hp:1000,maxHp:1000,artifactBattle:{effects:[{type:'equip_combo_chance',value:.35,soulbound:true}]}};
  const defender = {hp:1000,maxHp:1000,artifactBattle:{effects:[{type:'equip_damage_cap_percent',value:.025,soulbound:true}]}};
  const attack = ctx.window.resolveArtifactBattleAttack({attacker,defender,baseDamage:500});
  assert.equal(attack.comboChance,.12);
  const defense = ctx.window.resolveArtifactBattleDefense({attacker,defender,normalDamage:500,trueDamage:0});
  assert.equal(defense.hpDamage,42);
  defender.artifactBattle.effects[0].soulbound=false;
  const ordinary = ctx.window.resolveArtifactBattleDefense({attacker,defender,normalDamage:500,trueDamage:0});
  assert.equal(ordinary.hpDamage,50);
  assert.equal(combo.stats({},[{type:'equip_combo_chance',value:999}]).chance,.1);
  assert.equal(combo.stats({},[{type:'equip_combo_chance',value:999,soulbound:true}]).chance,.12);
});

test('trusted raid snapshots and boss defense honor refined soulbound values', () => {
  const authority = require('../raid-authority.cjs');
  const catalog = {items:[{id:'refined-sword',name:'精煉劍',realm:'元嬰',equipSlot:'本命法寶',
    effects:[{type:'equip_combo_chance',value:.35},{type:'equip_damage_cap_percent',value:.025}]}]};
  const user = {stats:{attack:200,maxHp:1000,totalScore:10},artifactSystem:{inventory:{'refined-sword':1},equipped:{'本命法寶':'refined-sword'}}};
  const member = authority.trustedRaidPlayerSnapshot(user,'tester',catalog);
  assert.ok(member.artifactBattle.effects.every(effect=>effect.soulbound===true));
  assert.equal(require('../public/cultivation/combat-combo.js').stats(member,member.artifactBattle.effects).chance,.12);
  const result = authority.resolveBossDefense(member,{roomId:'room-test',bossAction:{id:1,damage:500}});
  assert.equal(result.damage,42);
});

test('generation and guidance review both use soulbound priority and expanded ranges', async () => {
  const router = require('../ai-router');
  const original = router.generateJSON;
  const payload = {...payloadForBound(), adminGenerationPrompt:'名稱用測試二字'};
  let calls = 0;
  router.generateJSON = async prompt => {
    calls++;
    assert.match(prompt,/本命/);
    const revised = {...proposed('護身法寶'),name:'測試劍',description:'承接劍心。',effects:[{type:'equip_combo_chance',value:999}]};
    return {data:calls === 1 ? revised : {aligned:false,issues:['改名'],revisedArtifact:revised}};
  };
  try {
    let handler;
    api({get(){},post(route,fn){handler=fn;}});
    let result;
    await handler({body:payload},{json(value){result=value;},status(){return this;}});
    assert.equal(calls,2);
    assert.equal(result.artifact.equipSlot,'本命法寶');
    assert.equal(result.artifact.weaponForm,'飛劍');
    assert.equal(result.artifact.coreEffect,'equip_combo_chance');
    const limit = api.effectRangesForRealm('元嬰',3,{}, {},2,true).find(row=>row.type==='equip_combo_chance').max;
    assert.equal(result.artifact.effects[0].value,limit);
    assert.equal(result.artifact.effects.length,3);
  } finally {router.generateJSON=original;}
});

test('an already-paid old known job upgrades on opening and a failed commit retries without another generation or award', async () => {
  const payload = payloadForBound();
  const catalog = [...payload.existingArtifacts,{id:'old-result',name:'舊普通成品',realm:'元嬰',equipSlot:'護身法寶',effects:[{type:'equip_shield_flat',value:50}]}];
  const recipe = payload.selectedIngredients.map(row=>({artifactId:row.id,quantity:row.quantity}));
  const recipes = {'old-result':recipe};
  const signature = recipe.map(row=>'artifact:'+row.artifactId+':1').sort().join('|');
  const clone = value=>JSON.parse(JSON.stringify(value));
  const job = {id:'old-paid-job',kind:'known',knownArtifactId:'old-result',targetRealm:'元嬰',refinementStage:3,
    readyAtMs:1,signature,recipe,ingredients:payload.selectedIngredients,forgeMethod:'自由發揮'};
  const field = 'refineryJob';
  const user = {[field]:job,forgeFragments:12,artifactSystem:{inventory:{},equipped:{}},stats:{totalScore:68}};
  const docs = new Map([['users/tester',clone(user)],['gameConfig/artifactCatalogV1',{items:clone(catalog)}],['gameConfig/materialCatalogV1',{recipes:clone(recipes)}]]);
  docs.set('gameConfig/artifactCatalogV1',{items:clone(catalog.filter(item=>item.id !== 'soul-sword-golden-core'))});
  let failCommit = true, generations = 0;
  const ctx = {console,QASoulboundPool:pool,AbortController,setTimeout,clearTimeout,
    window:{getCurrentUserData:()=>user,dispatchEvent(){}},CustomEvent:class {},
    ARTIFACT_CATALOG:catalog,MATERIAL_CATALOG:payload.allMaterials,ARTIFACT_RECIPES:recipes,REFINERY_JOB_FIELD:field,
    SUPPORTED_ARTIFACT_EFFECTS:[...api.ALLOWED_EFFECTS],MAX_ARTIFACT_RECIPE_NESTING:2,
    getArtifactById:id=>catalog.find(item=>item.id===id),getMaterialById:()=>null,
    artifactRecipeDepth:id=>id==='ordinary'?1:0,realmForScore:()=>({name:'元嬰'}),realmOrderByName:realm=>api.REALMS.indexOf(realm),
    baseRealmForgeGold:()=>100,calculateRefineryEconomy:()=>({fragments:10,durationMs:1}),raidRefinementKeyRequirement:()=>null,formatRefineryDuration:String,
    getApp:()=>({}),getAuth:()=>({currentUser:{uid:'tester',getIdToken:async()=>''}}),getFirestore:()=>({}),doc:(_, ...parts)=>parts.join('/'),
    repairArtifactRecipes:rows=>({recipes:rows,changed:false,removedRecipeIds:[]}),validateArtifactRecipes:rows=>rows,
    replaceArtifactCatalog:rows=>catalog.splice(0,catalog.length,...rows),replaceArtifactRecipes:rows=>Object.assign(recipes,rows),
    runTransaction:async(_,callback)=>{
      const writes=[];
      await callback({get:async ref=>({exists:()=>docs.has(ref),data:()=>clone(docs.get(ref))}),
        update:(ref,value)=>writes.push([ref,value]),set:(ref,value)=>writes.push([ref,value])});
      if(failCommit){failCommit=false;throw new Error('暫時無法提交');}
      for(const [ref,value] of writes) docs.set(ref,{...docs.get(ref),...clone(value)});
    },
    fetch:async(url,options)=>{
      if(url!=='/api/generate-artifact')return {ok:true,json:async()=>({ok:true})};
      generations++;
      const request=JSON.parse(options.body);
      const hierarchy=api.ingredientHierarchy(request);
      const artifact=api.sanitizeGeneratedArtifact(proposed('護身法寶'),'元嬰',3,{}, {},2,{primaryArtifacts:hierarchy.primary,weaponForm:api.lockedWeaponForm(request)});
      return {ok:true,json:async()=>({artifact})};
    }
  };
  vm.createContext(ctx);
  const catalogSource=read('public/cultivation/artifact-catalog.js').replace(/^import .*;\n/gm,'').replace(/export (const|function) /g,'$1 ');
  const catalogContext={QASoulboundPool:pool};
  vm.runInNewContext(catalogSource+'\nthis.api={normalizeArtifactDefinition,validateArtifactCatalog};',catalogContext);
  Object.assign(ctx,catalogContext.api);
  vm.runInContext(read('public/cultivation/refinery-ai-jobs.js').replace(/^import\s[\s\S]*?;\n/gm,''),ctx);
  const plan=ctx.window.getCultivationRefineryPlan(payload.selectedIngredients.map(row=>'artifact:'+row.id),'old-result');
  assert.equal(plan.discovery,true);
  assert.equal(plan.targetRealm,'元嬰');
  await assert.rejects(ctx.window.claimCultivationRefineryJob(),/暫時無法提交/);
  assert.equal(user[field].id,job.id);
  assert.equal(docs.get('users/tester').forgeFragments,12);
  const awarded=await ctx.window.claimCultivationRefineryJob();
  assert.equal(awarded.equipSlot,'本命法寶');
  assert.equal(awarded.coreEffect,'equip_combo_chance');
  assert.equal(awarded.effects.length,3);
  assert.equal(awarded.soulboundRefinementVersion,pool.REFINEMENT_VERSION);
  assert.equal(generations,1);
  assert.equal(docs.get('users/tester').forgeFragments,12);
  assert.equal(docs.get('users/tester').artifactSystem.inventory[awarded.id],1);
  assert.equal(docs.get('users/tester')[field],null);
  await assert.rejects(ctx.window.claimCultivationRefineryJob(),/目前沒有/);
  assert.equal(docs.get('users/tester').artifactSystem.inventory[awarded.id],1);
  pool.assertRefinementImproves(awarded,[pool.ITEMS[0]]);
  catalog.push({...pool.ITEMS[0],id:'capped-source',effects:[{type:'equip_combo_chance',value:.12}]});
  const before = clone(docs.get('users/tester'));
  const blocked = ctx.window.getCultivationRefineryPlan(['artifact:capped-source','material:ore']);
  assert.equal(blocked.valid,false);
  assert.match(blocked.reason,/已達上限/);
  await assert.rejects(ctx.window.startCultivationRefineryJob(['artifact:capped-source','material:ore']),/已達上限/);
  assert.deepEqual(docs.get('users/tester'),before);
});

test('legacy and known-recipe paths block minting while equipment slot stays operable', () => {
  const legacy = read('public/cultivation/artifact-system.js');
  const jobs = read('public/cultivation/refinery-ai-jobs.js');
  const equip = read('public/cultivation/unified-inventory-grid.js');
  const market = read('public/cultivation/player-marketplace.js');
  assert.match(legacy, /async function craftArtifact\(\) \{\s*throw new Error\('鍛造僅開放本命法器精煉/);
  assert.match(jobs, /hasSoulboundBase/);
  assert.match(jobs, /realSoulboundSource/);
  assert.match(equip, /點擊選擇本命法器/);
  assert.match(equip, /data-uib-empty-slot/);
  assert.match(equip, /window\.openSoulboundDraw/);
  assert.match(market, /function isSoulboundListing\(type, id\)/);
  assert.match(market, /if \(isSoulboundListing\(type, listing.itemId\)\) throw new Error/);
  assert.match(market, /不可上架或販售配方/);
  assert.match(read('docs/design/soulbound-artifact-rules.md'), /常駐契器台已實作/);
});
