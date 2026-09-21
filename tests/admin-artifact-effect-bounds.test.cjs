const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const api = require('../artifact-generation-api.js');
const main = read('public/main.js');
const ui = read('public/cultivation/admin-artifact-effect-bounds.js');
const sync = read('public/cultivation/artifact-catalog-sync.js');
const jobs = read('public/cultivation/refinery-ai-jobs.js');

test('admin effect bounds editor is mounted in existing artifact manager and persists through admin-verified transaction', () => {
  assert.ok(main.includes("'./cultivation/admin-artifact-effect-bounds.js'"));
  assert.ok(main.indexOf("'./cultivation/admin-artifact-manager.js'") <
    main.indexOf("'./cultivation/admin-artifact-effect-bounds.js'"));
  assert.match(ui, /panel\.querySelector\('\.aam-head'\)/);
  assert.match(ui, /userSnap\.data\(\)\?\.isAdmin !== true/);
  assert.match(ui, /effectBoundsV1: committed/);
  assert.match(ui, /runTransaction\(db/);
  assert.match(ui, /data-aeb-field/);
  assert.match(ui, /本組恢復預設/);
  assert.match(sync, /window\.getArtifactEffectBounds/);
  assert.match(jobs, /effectBoundsV1: window\.getArtifactEffectBounds/);
});

test('admin bounds independently override each realm and refinement stage', () => {
  const config = api.normalizeEffectBounds({
    金丹: {
      2: {
        equip_attack_flat: {min:53, max:88},
        timed_attack_multiplier: {min:1.24,max:1.4,durationMinutesMin:3,durationMinutesMax:7}
      }
    }
  });
  const selected = api.effectRange('equip_attack_flat', 3, 2, config);
  assert.deepEqual([selected.min, selected.max], [53, 88]);
  assert.notEqual(api.effectRange('equip_attack_flat', 3, 1, config).max, 88);
  assert.notEqual(api.effectRange('equip_attack_flat', 4, 2, config).max, 88);
  const timed = api.effectRange('timed_attack_multiplier', 3, 2, config);
  assert.deepEqual([timed.min,timed.max,timed.durationMinutesMin,timed.durationMinutesMax], [1.24,1.4,3,7]);
  const output = api.sanitizeGeneratedArtifact({
    name:'上限測試', effects:[{type:'equip_attack_flat',value:1000000}]
  }, '金丹', 2, config);
  assert.equal(output.effects[0].value, 88);
});

test('AI prompt uses edited numeric ranges for the actual refinement stage', () => {
  const config = api.normalizeEffectBounds({ 金丹: {2: {equip_attack_flat: {min:53,max:88}}} });
  const prompt = api.buildPrompt({
    targetRealm:'金丹',
    selectedIngredients:[{type:'artifact',id:'embryo',quantity:1},{type:'material',id:'iron',quantity:1}],
    allMaterials:[{id:'iron',name:'玄鐵',realm:'金丹'}],
    existingArtifacts:[{id:'embryo',name:'劍胚',realm:'金丹',refinementDepth:0}],
    effectBoundsV1:config
  });
  assert.match(prompt, /"min": 53/);
  assert.match(prompt, /"max": 88/);
});

test('invalid, disallowed and uncapped values cannot override hard combat rules', () => {
  const invalidConfigs = [
    {金丹:{3:{equip_combo_chance:{min:0.01,max:0.5}}}},
    {金丹:{3:{equip_lifesteal_percent:{min:0.01,max:0.8}}}},
    {凡人:{1:{equip_copy_enemy_artifact:{min:1,max:2}}}},
    {金丹:{2:{equip_attack_flat:{min:90,max:40}}}},
    {金丹:{2:{timed_attack_multiplier:{min:1.1,max:1.5,durationMinutesMin:0,durationMinutesMax:1500}}}}
  ];
  for (const config of invalidConfigs) assert.throws(() => api.normalizeEffectBounds(config));
  assert.equal(api.effectRange('equip_combo_chance',10,3).max <= 0.1, true);
});
