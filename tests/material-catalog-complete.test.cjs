const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const catalog = fs.readFileSync(path.join(__dirname, '..', 'public/cultivation/material-catalog.js'), 'utf8');

const lineages = {
  ore: ['玄鐵','赤銅精','紫金砂','太虛玄鐵','九天玄晶','虛空石','混元金','混沌晶','九霄神鐵','仙金'],
  wood: ['靈草','靈木','百年靈木','雷擊木','千年靈木','神魂木','界木','太古神木','世界樹枝'],
  crystal: ['青靈石','寒玉','靈晶','嬰靈晶','天雷晶','空冥晶','仙靈玉','劫雷晶核','仙晶'],
  beast: ['獸皮','妖獸骨','妖丹碎片','完整妖丹','蛟龍鱗','鳳凰羽','真龍精血','鳳凰精血'],
  special: ['靈符紙','地火石','星辰砂','天雷精魄','赤鳳石','五行精魄','天道碎片','法則碎片','大道碎片','鴻蒙紫氣']
};

test('all requested material lineages are present', () => {
  for (const names of Object.values(lineages)) {
    for (const name of names) assert.match(catalog, new RegExp(`name: '${name}'`));
  }
});

test('default catalog contains exactly 46 lineage materials', () => {
  const block = catalog.match(/const DEFAULT_MATERIAL_CATALOG = \[([\s\S]*?)\n\];\n\nconst DEFAULT_MATERIAL_REALM_BY_ID/);
  assert.ok(block, 'default material catalog block exists');
  assert.equal((block[1].match(/\{ id:/g) || []).length, 46);
});

test('existing material ids remain stable for player inventories and recipes', () => {
  for (const id of ['spirit-iron','spirit-wood','spirit-crystal','beast-core-shard','talisman-paper']) {
    assert.match(catalog, new RegExp(`id: '${id}'`));
  }
});

test('expanded materials cover realm progression and special material category', () => {
  for (const realm of ['凡人','煉氣','築基','金丹','元嬰','化神','煉虛','合體','大乘','渡劫','真仙']) {
    assert.match(catalog, new RegExp(`realm: '${realm}'`));
  }
  assert.match(catalog, /'特殊材料'/);
  assert.match(catalog, /mergeMaterialCatalogWithDefaults/);
  assert.match(catalog, /MATERIAL_CATALOG_SCHEMA_VERSION = 2/);
});
