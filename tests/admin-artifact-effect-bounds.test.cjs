const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const api = require('../artifact-generation-api.js');
const ui = read('public/cultivation/admin-artifact-effect-bounds.js');
const sync = read('public/cultivation/artifact-catalog-sync.js');
const jobs = read('public/cultivation/refinery-ai-jobs.js');
const main = read('public/main.js');
const admin = read('public/cultivation/admin-artifact-manager.js');

test('admin edits only depth-wide ranges with an optional realm preview', () => {
  assert.ok(main.indexOf("'./cultivation/admin-artifact-manager.js'") <
    main.indexOf("'./cultivation/admin-artifact-effect-bounds.js'"));
  assert.match(ui, /panel\.querySelector\('\.aam-head'\)/);
  assert.doesNotMatch(ui, /aeb-realm/);
  assert.match(ui, /aeb-stage/);
  assert.match(ui, /aeb-preview/);
  assert.match(ui, /effectBoundsV2: committed/);
  assert.match(ui, /userSnap\.data\(\)\?\.isAdmin !== true/);
  assert.match(ui, /runTransaction\(db/);
  assert.match(ui, /本深度恢復預設/);
  assert.match(sync, /window\.getArtifactEffectBounds/);
  assert.match(sync, /data\.effectBoundsV2/);
  assert.match(jobs, /effectBoundsV2: window\.getArtifactEffectBounds/);
  assert.match(admin, /realm\.name !== '凡人'/);
});

test('twelve overlapping equal interval bands: Qi 1-3, foundation 2-4, immortal 10-12', () => {
  const overrides = api.normalizeDepthEffectBounds({'1':{
    equip_attack_flat:{min:100,max:220}
  }});
  const qi = api.effectRange('equip_attack_flat',1,1,{},false,overrides);
  const foundation = api.effectRange('equip_attack_flat',2,1,{},false,overrides);
  const immortal = api.effectRange('equip_attack_flat',10,1,{},false,overrides);
  assert.deepEqual([qi.min,qi.max],[100,130]);
  assert.deepEqual([foundation.min,foundation.max],[110,140]);
  assert.deepEqual([immortal.min,immortal.max],[190,220]);
  assert.equal(api.effectRange('equip_attack_flat',3,2,{},false,overrides).max !== 150,true);
  assert.equal(api.effectRangesForRealm('凡人',1).length,0);
});

test('reverse-strength damage cap, integer discretization, timed duration and clamps', () => {
  const config=api.normalizeDepthEffectBounds({'3':{
    equip_damage_cap_percent:{min:0.2,max:0.8},
    equip_attack_flat:{min:1,max:13},
    timed_attack_multiplier:{min:1.2,max:2.4,durationMinutesMin:12,durationMinutesMax:24}
  }});
  const qi=api.effectRange('equip_damage_cap_percent',4,3,{},false,config);
  const immortal=api.effectRange('equip_damage_cap_percent',10,3,{},false,config);
  assert.ok(immortal.max < qi.min,'stronger realm receives smaller damage cap');
  assert.deepEqual([api.effectRange('equip_attack_flat',1,3,{},false,config).min,
    api.effectRange('equip_attack_flat',1,3,{},false,config).max],[1,4]);
  const timed=api.effectRange('timed_attack_multiplier',10,3,{},false,config);
  assert.deepEqual([timed.min,timed.max,timed.durationMinutesMin,timed.durationMinutesMax],[2.1,2.4,21,24]);
  const artifact=api.sanitizeGeneratedArtifact({name:'測試',effects:[{type:'equip_attack_flat',value:9999}]},
    '煉氣',3,{},config);
  assert.equal(artifact.effects[0].value,4);
});

test('AI prompt uses selected stage limits and a mortal-only recipe produces Qi artifact', () => {
  const payload={
    selectedIngredients:[{type:'material',id:'iron',quantity:2}],
    allMaterials:[{id:'iron',realm:'凡人',name:'凡鐵'}],
    existingArtifacts:[]
  };
  assert.equal(api.deriveTargetRealm(payload),'煉氣');
  assert.equal(api.sanitizeGeneratedArtifact({effects:[{type:'equip_attack_flat',value:1}]},'凡人').realm,'煉氣');
  const config=api.normalizeDepthEffectBounds({'1':{equip_attack_flat:{min:100,max:220}}});
  const prompt=api.buildPrompt({...payload,targetRealm:'煉氣',effectBoundsV2:config});
  assert.match(prompt, /"min": 100/);
  assert.match(prompt, /"max": 130/);
});

test('invalid global bounds and fixed effects stay protected', () => {
  for(const config of [
    {'3':{equip_combo_chance:{min:.01,max:.11}}},
    {'3':{equip_lifesteal_percent:{min:.01,max:.8}}},
    {'1':{equip_copy_enemy_artifact:{min:1,max:2}}},
    {'2':{equip_attack_flat:{min:90,max:40}}},
    {'1':{timed_attack_multiplier:{min:1.1,max:1.5,durationMinutesMin:0,durationMinutesMax:1500}}},
    {'4':{equip_attack_flat:{min:10,max:20}}}
  ]) assert.throws(()=>api.normalizeDepthEffectBounds(config));
});
