const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const api = require('../artifact-generation-api.js');
const refinery = read('public/cultivation/cultivation-refinery-v2.js');
const jobs = read('public/cultivation/refinery-ai-jobs.js');
const catalog = read('public/cultivation/artifact-catalog.js');
const bag = read('public/cultivation/unified-inventory-grid.js');
const market = read('public/cultivation/player-marketplace.js');

test('forge methods create distinct discovery signatures and are sent to artifact generation', () => {
  assert.ok(api.FORGE_METHODS.has ? api.FORGE_METHODS.has('劍道鍛造') : api.FORGE_METHODS.includes('劍道鍛造'));
  assert.match(jobs, /function recipeSignature\(recipe = \[\], forgeMethod = '自由發揮'\)/);
  assert.match(jobs, /\|method:' \+ forgeMethod/);
  assert.match(jobs, /forgeMethod: job\.forgeMethod \|\| '自由發揮'/);
  assert.match(refinery, /data-refinery-forge-method/);
  assert.match(refinery, /同樣的材料可以用不同手法探索新配方/);
});

test('deep artifact form wins over a newly selected forge method', () => {
  const payload = {
    forgeMethod: '護體鑄造',
    selectedIngredients: [
      { type: 'artifact', id: 'blade', quantity: 1 },
      { type: 'material', id: 'ore', quantity: 1 }
    ],
    existingArtifacts: [
      { id: 'blade', name: '舊劍', realm: '築基', refinementDepth: 0, weaponForm: '劍',
        effects: [{ type: 'equip_attack_flat', value: 20 }] }
    ],
    allMaterials: [{ id: 'ore', name: '玄鐵', realm: '築基' }]
  };
  assert.equal(api.lockedWeaponForm(payload), '劍');
});

test('refining an existing artifact preserves its defining effect and permanent form', () => {
  const primary = {
    id: 'blade', weaponForm: '劍',
    effects: [{ type: 'equip_attack_flat', value: 20 }]
  };
  const result = api.sanitizeGeneratedArtifact({
    name: '改造劍',
    weaponForm: '法盾',
    equipSlot: '本命法寶',
    effects: [{ type: 'equip_crit_chance', value: 0.03 }]
  }, '築基', 2, {}, {}, 3, {
    weaponForm: '劍',
    forgeMethod: '護體鑄造',
    primaryArtifacts: [primary]
  });
  assert.equal(result.weaponForm, '劍');
  assert.equal(result.coreEffect, 'equip_attack_flat');
  assert.ok(result.effects.some((effect) => effect.type === 'equip_attack_flat'));
});

test('extra ingredients strengthen inverse damage-cap effects instead of weakening them', () => {
  const three = api.effectRange('equip_damage_cap_percent', 5, 3, {}, false, {}, 3);
  const four = api.effectRange('equip_damage_cap_percent', 5, 3, {}, false, {}, 4);
  assert.ok(four.min <= three.min);
  assert.ok(four.max <= three.max);
});

test('artifact catalog permanently stores form, forge method and core effect', () => {
  assert.match(catalog, /ARTIFACT_WEAPON_FORMS/);
  assert.match(catalog, /ARTIFACT_FORGE_METHODS/);
  assert.match(catalog, /weaponForm:/);
  assert.match(catalog, /forgeMethod:/);
  assert.match(catalog, /coreEffect:/);
});

test('materials use round icons while artifacts keep a distinct framed shape across major UIs', () => {
  assert.match(refinery, /refinery-mat-icon is-material/);
  assert.match(refinery, /refinery-mat-icon is-artifact/);
  assert.match(refinery, /\.refinery-mat-icon\.is-material[^\n]*border-radius:50%/);
  assert.match(refinery, /\.refinery-slot\.is-material \.icon[^\n]*border-radius:50%/);

  assert.match(bag, /data-uib-item\^="material:"/);
  assert.match(bag, /\.uib-modal-material \.uib-modal-icon\{border-radius:50%!important/);
  assert.match(bag, /data-uib-item\^="artifact:"/);

  assert.match(market, /#player-market \.pm-material \.pm-icon\{border-radius:50%/);
  assert.match(market, /#player-market \.pm-artifact \.pm-icon/);
});
