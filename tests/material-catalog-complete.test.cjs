'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname,'..',rel),'utf8');
const catalog = read('public/cultivation/material-catalog.js');
const retired = ['qi-spirit-iron','foundation-refined-iron','golden-purple-iron','qi-spirit-wood','foundation-century-wood','golden-lightning-wood','nascent-star-iron','nascent-soul-wood'];

test('active material catalog consists solely of second and third rank stones',()=>{
 const block=catalog.match(/const DEFAULT_MATERIAL_CATALOG = \[([\s\S]*?)\n\];/);
 assert.ok(block);
 assert.equal((block[1].match(/\{ id:/g)||[]).length,2);
 for(const id of ['raid-refine-key-ii','raid-refine-key-iii'])assert.match(block[1],new RegExp(id));
 for(const id of retired)assert.doesNotMatch(block[1],new RegExp(id));
 assert.match(catalog,/RAID_CRAFT_MATERIAL_IDS = Object\.freeze\(\[\]\)/);
 assert.match(catalog,/MATERIAL_CATALOG_SCHEMA_VERSION = 6/);
});

test('material recipes are empty and are not reintroduced by legacy defaults',()=>{
 assert.match(catalog,/const DEFAULT_ARTIFACT_RECIPES = \{\}/);
 assert.match(catalog,/export function mergeArtifactRecipesWithDefaults\(\)/);
 assert.match(read('simple-forge-api.cjs'),/function stageOf\(item, recipes/);
});

test('legacy wood and iron materials cannot drop or be exchanged for and are still dismantlable',()=>{
 const raid=read('raid-reward-api.cjs'), tiers=read('public/cultivation/raid-difficulty.js');
 const drop=read('public/cultivation/material-drop-system.js'), farm=read('spirit-farm-api.cjs');
 assert.doesNotMatch(raid,/rollRaidMaterials|RAID_MATERIAL_POOL/);
 assert.doesNotMatch(tiers,/materials:Object\.freeze\(/);
 assert.match(drop,/enabled:false/);
 assert.match(drop,/dongtianDrops:false/);
 assert.match(farm,/煉器材料兌換已停用/);
 for(const id of retired)assert.match(read('public/cultivation/forge-fragments.js'),new RegExp(id));
 assert.match(read('inventory-dismantle-api.cjs'),/fragments\.MATERIALS/);
});
