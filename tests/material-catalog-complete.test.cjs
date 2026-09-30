const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const catalog = fs.readFileSync(path.join(__dirname, '..', 'public/cultivation/material-catalog.js'), 'utf8');

const forgeIds = [
  'qi-spirit-iron','foundation-refined-iron','golden-purple-iron',
  'qi-spirit-wood','foundation-century-wood','golden-lightning-wood'
];

test('material catalog contains six wood/iron drops plus two bound refinement seals', () => {
  const block = catalog.match(/const DEFAULT_MATERIAL_CATALOG = \[([\s\S]*?)\n\]/);
  assert.ok(block, 'default material catalog block exists');
  assert.equal((block[1].match(/\{ id:/g) || []).length, 8);
  for (const id of [...forgeIds,'raid-refine-key-ii','raid-refine-key-iii']) {
    assert.match(block[1], new RegExp(`id: '${id}'`));
  }
});

test('current raid forge materials are only qi foundation and golden iron/wood', () => {
  for (const [name,realm] of [
    ['玄鐵','煉氣'],['精煉玄鐵','築基'],['紫金玄鐵','金丹'],
    ['靈木','煉氣'],['百年靈木','築基'],['雷擊木','金丹']
  ]) {
    assert.match(catalog,new RegExp(`name: '${name}'[\\s\\S]{0,100}realm: '${realm}'`));
  }
  assert.match(catalog,/export const RAID_CRAFT_MATERIAL_IDS/);
  for (const id of forgeIds) assert.match(catalog,new RegExp(`'${id}'`));
  assert.match(catalog,/現行材料系統固定為 8 種團本道具/);
});

test('retired essence sword-soul and ordinary material families are not active', () => {
  for (const id of [
    'raid-secret-realm-essence','raid-shen-sword-soul',
    'spirit-iron','spirit-wood','spirit-crystal','beast-core-shard','talisman-paper','sword-forging-iron'
  ]) assert.doesNotMatch(catalog,new RegExp(`id: '${id}'`));
});

test('ordinary quiz and dongtian material drop rates are disabled', () => {
  const start = catalog.indexOf('export function materialDropRateFor');
  const end = catalog.indexOf('export function normalizeMaterialDefinition', start);
  const block = catalog.slice(start,end);
  assert.match(block,/return 0/);
  assert.match(block,/問道、洞天、商店與一般活動都不再自然產出煉器素材/);
});

test('built-in recipes use current raid forge materials but never refinement seals', () => {
  const start = catalog.indexOf('const DEFAULT_ARTIFACT_RECIPES');
  const end = catalog.indexOf('function clone', start);
  const recipes = catalog.slice(start,end);
  assert.doesNotMatch(recipes,/raid-refine-key-ii|raid-refine-key-iii|raid-secret-realm-essence|raid-shen-sword-soul/);
  assert.match(recipes,/qi-spirit-iron/);
  assert.match(recipes,/foundation-century-wood/);
  assert.match(recipes,/golden-purple-iron/);
});
