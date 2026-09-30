const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const catalog = fs.readFileSync(path.join(__dirname, '..', 'public/cultivation/material-catalog.js'), 'utf8');

test('material catalog is collapsed to exactly four raid-only entries', () => {
  const block = catalog.match(/const DEFAULT_MATERIAL_CATALOG = \[([\s\S]*?)\n\]/);
  assert.ok(block, 'default material catalog block exists');
  assert.equal((block[1].match(/\{ id:/g) || []).length, 4);
  for (const id of [
    'raid-secret-realm-essence',
    'raid-shen-sword-soul',
    'raid-refine-key-ii',
    'raid-refine-key-iii'
  ]) assert.match(block[1], new RegExp(`id: '${id}'`));
});

test('old ordinary material families are removed from the active catalog', () => {
  for (const id of ['spirit-iron','spirit-wood','spirit-crystal','beast-core-shard','talisman-paper','sword-forging-iron']) {
    assert.doesNotMatch(catalog, new RegExp(`id: '${id}'`));
  }
});

test('only essence and sword soul are furnace materials while seals stay refinement keys', () => {
  assert.match(catalog,/export const RAID_CRAFT_MATERIAL_IDS/);
  assert.match(catalog,/'raid-secret-realm-essence'/);
  assert.match(catalog,/'raid-shen-sword-soul'/);
  assert.match(catalog,/2: 'raid-refine-key-ii'/);
  assert.match(catalog,/3: 'raid-refine-key-iii'/);
  assert.match(catalog,/現行材料系統固定為 4 種團本道具/);
});

test('ordinary quiz and dongtian material drop rates are disabled', () => {
  const start = catalog.indexOf('export function materialDropRateFor');
  const end = catalog.indexOf('export function normalizeMaterialDefinition', start);
  const block = catalog.slice(start,end);
  assert.match(block,/return 0/);
  assert.match(block,/問道、洞天、商店與一般活動都不再自然產出煉器素材/);
});

test('built-in artifact recipes use only the two raid crafting materials', () => {
  const start = catalog.indexOf('const DEFAULT_ARTIFACT_RECIPES');
  const end = catalog.indexOf('function clone', start);
  const recipes = catalog.slice(start,end);
  assert.doesNotMatch(recipes,/raid-refine-key-ii|raid-refine-key-iii/);
  assert.doesNotMatch(recipes,/spirit-iron|spirit-wood|spirit-crystal|beast-core-shard|talisman-paper/);
  assert.match(recipes,/raid-secret-realm-essence/);
  assert.match(recipes,/raid-shen-sword-soul/);
});
