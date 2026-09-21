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
  assert.match(prompt, /"min": 95/);
  assert.match(prompt, /"max": 123/);
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


test('recipe ingredient quantity scales both limits by five percent per extra material', () => {
  const config = api.normalizeDepthEffectBounds({'1':{
    equip_attack_flat:{min:100,max:220},
    equip_attack_percent:{min:0.1,max:0.5}
  }});
  const expected = [
    [2,0.95,95,123], [3,1,100,130], [4,1.05,105,136],
    [5,1.1,110,143], [8,1.25,125,162]
  ];
  for (const [count,factor,min,max] of expected) {
    assert.equal(api.ingredientCountMultiplier(count),factor);
    const range = api.effectRange('equip_attack_flat',1,1,{},false,config,count);
    assert.deepEqual([range.min,range.max],[min,max]);
    const generated = api.sanitizeGeneratedArtifact({
      effects:[{type:'equip_attack_flat',value:999999}]
    },'煉氣',1,{},config,count);
    assert.equal(generated.effects[0].value,max,'AI output obeys adjusted upper bound');
  }
  assert.equal(api.ingredientTotal([{quantity:2},{quantity:1},{quantity:1}]),4);
  assert.equal(api.ingredientCountMultiplier(),1);
  const percent = api.effectRange('equip_attack_percent',1,1,{},false,config,4);
  assert.deepEqual([percent.min,percent.max],[0.105,0.21]);
});

test('AI receives the quantity-adjusted bounds and preserves hard caps and durations', () => {
  const config = api.normalizeDepthEffectBounds({'1':{
    equip_attack_flat:{min:100,max:220}
  }});
  for (const [count,limit] of [[2,123],[3,130],[4,136]]) {
    const payload = {
      selectedIngredients:[{type:'material',id:'iron',quantity:count}],
      allMaterials:[{id:'iron',name:'玄鐵',realm:'煉氣'}],
      existingArtifacts:[],targetRealm:'煉氣',effectBoundsV2:config
    };
    const prompt = api.buildPrompt(payload);
    assert.match(prompt,new RegExp('"max": '+limit+'(?:,|\\n)'));
    assert.ok(prompt.includes('數值範圍倍率 ×'+api.ingredientCountMultiplier(count)));
  }
  const timed = api.effectRange('timed_attack_multiplier',10,3,{},false,{},4);
  const original = api.effectRange('timed_attack_multiplier',10,3);
  assert.equal(timed.durationMinutesMin,original.durationMinutesMin);
  assert.equal(timed.durationMinutesMax,original.durationMinutesMax);
  assert.ok(api.effectRange('equip_combo_chance',10,3,{},false,{},8).max <= .1);
  assert.ok(api.effectRange('equip_damage_cap_percent',10,3,{},false,{},8).max <= 1);
  assert.ok(api.effectRange('timed_attack_multiplier',10,3,{},false,{},2).min >= 1.01);
});

test('manual editor hint updates for recipe quantity and remains advisory', () => {
  assert.match(admin, /function currentEditorIngredientCount\(modal\)/);
  assert.match(admin, /function ingredientHintMultiplier\(count\)/);
  assert.match(admin, /function scaleIngredientHint\(min, max, effect, factor\)/);
  assert.match(admin, /素材 ' \+ quantity \+ ' 個 ×' \+ factor/);
  assert.match(admin, /refreshEffectHints\(modal\)/);
  assert.match(admin, /僅供參考，不限制手動填寫/);
});


test('second and third refinement display earlier stages, including pending edits, without enforcing progression', () => {
  assert.match(ui,/function priorDepthHint\(range, priorDepth\)/);
  assert.match(ui,/function previousDepthHints\(range\)/);
  assert.match(ui,/Array\.from\(\{ length:stage - 1 \}, \(_, index\) => index \+ 1\)/);
  assert.match(ui,/priorDepthDefaults\.set\(priorStage, result\.ranges\)/);
  assert.match(ui,/fetch\('\/api\/artifact-depth-effect-ranges\?stage=' \+ priorStage\)/);
  assert.match(ui,/const edits = pending\.has\(key\) \? pending\.get\(key\) \|\| \{\} : stored\(\)\[key\] \|\| \{\}/);
  assert.match(ui,/const actual = edits\[range\.type\] \|\| prior/);
  assert.match(ui,/actual\.durationMinutesMin/);
  assert.match(ui,/previousDepthHints\(range\) \+ '<\/div>'/);
  assert.match(ui,/第三煉設定：每項功能下方同時顯示第一煉及第二煉的上下限/);
  assert.match(ui,/僅提醒，不限制本煉填寫/);
  assert.match(ui,/id="aeb-previous-note"/);
  assert.doesNotMatch(ui.slice(ui.indexOf('function validate('),ui.indexOf('function numberField(')), /priorDepthDefaults|priorDepthHint/);

  const from=ui.indexOf('  function priorDepthHint(');
  const to=ui.indexOf('  function draw() {',from);
  assert.ok(from>0 && to>from);
  const hintSource=ui.slice(from,to);
  const getter=new Function('context', 'const {stage,priorDepthDefaults,pending,stored,esc}=context;\n'+
    hintSource+'\nreturn previousDepthHints;');
  const flat={type:'equip_attack_flat',field:'value',unit:'點',min:80,max:120};
  const timed={type:'timed_attack_multiplier',field:'multiplier',unit:'倍',min:1.1,max:1.3,
    durationMinutesMin:2,durationMinutesMax:4};
  const context={
    stage:3,
    priorDepthDefaults:new Map([
      [1,[flat,timed]],
      [2,[{...flat,min:100,max:180},{...timed,min:1.4,max:1.8,durationMinutesMin:5,durationMinutesMax:9}]]
    ]),
    pending:new Map([['2',{equip_attack_flat:{min:130,max:210},
      timed_attack_multiplier:{min:1.5,max:2,durationMinutesMin:6,durationMinutesMax:12}}]]),
    stored:()=>({'1':{equip_attack_flat:{min:90,max:150}},'2':{}}),
    esc:value=>String(value)
  };
  const third=getter(context)(flat);
  assert.match(third,/第一煉參考：下限 90 ／ 上限 150 點/);
  assert.match(third,/第二煉參考：下限 130 ／ 上限 210 點/);
  assert.ok(third.indexOf('第一煉參考') < third.indexOf('第二煉參考'));
  const timedThird=getter(context)(timed);
  assert.match(timedThird,/第一煉參考：下限 1.1 ／ 上限 1.3 倍；持續 2～4 分鐘/);
  assert.match(timedThird,/第二煉參考：下限 1.5 ／ 上限 2 倍；持續 6～12 分鐘/);
  assert.match(getter({...context,stage:2})(flat),/第一煉參考：下限 90/);
  assert.doesNotMatch(getter({...context,stage:2})(flat),/第二煉參考/);
  assert.equal(getter({...context,stage:1})(flat),'');
  assert.match(getter({...context,priorDepthDefaults:new Map([[1,[flat]]])})(flat),
    /第二煉參考值暫時無法載入/);
  assert.match(getter(context)({type:'equip_copy_enemy_artifact',field:'none'}),
    /第一煉：此功能未開放/);
});
