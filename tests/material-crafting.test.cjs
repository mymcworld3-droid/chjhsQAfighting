'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=rel=>fs.readFileSync(path.join(__dirname,'..',rel),'utf8');
const catalog=read('public/cultivation/material-catalog.js'),sync=read('public/cultivation/material-catalog-sync.js'),system=read('public/cultivation/material-system.js');
const main=read('public/main.js'),page=read('public/index.html'),ui=read('public/cultivation/simple-forge.js'),server=read('simple-forge-api.cjs');

test('forge consumes two identical weapons, forge fragments, and matching stone',()=>{
 assert.match(server,/count\(artifact\.inventory\[id\]\)<2/);
 assert.match(server,/fragments\.balance\(user\)<req\.fragments/);
 assert.match(server,/count\(material\.inventory\[req\.stone\]\)<req\.quantity/);
 assert.match(server,/forgeFragments:fragments\.balance\(user\)-req\.fragments/);
 assert.match(server,/generatedByAI:false/);
 assert.match(ui,/\/api\/simple-forge/);
 assert.match(ui,/data-sf-upgrade/);
 assert.doesNotMatch(ui,/\/api\/generate-artifact/);
});
test('active registry and UI no longer expose craft materials or recipe manager',()=>{
 assert.match(catalog,/RAID_CRAFT_MATERIAL_IDS = Object\.freeze\(\[\]\)/);
 assert.match(catalog,/const DEFAULT_ARTIFACT_RECIPES = \{\}/);
 assert.match(catalog,/2: 'raid-refine-key-ii'/);
 assert.match(catalog,/3: 'raid-refine-key-iii'/);
 assert.doesNotMatch(main,/'.\/cultivation\/admin-material-manager\.js'/);
 assert.doesNotMatch(page,/id="admin-material-manager"/);
 assert.match(main,/'\.\/cultivation\/simple-forge\.js'/);
});
test('local material catalog cannot mint items or purchase via client',()=>{
 assert.match(sync,/local-fixed-catalog/);
 assert.doesNotMatch(sync,/getFirestore|onSnapshot|setDoc|materialCatalogV1/);
 assert.match(system,/source:'local-readonly'/);
 assert.doesNotMatch(system,/getFirestore|runTransaction|data-material-buy|buyMaterial/);
});
test('legacy AI discovery and generator endpoints are disabled',()=>{
 const d1=read('d1-browser-api.cjs'),http=read('server.js');
 assert.doesNotMatch(d1,/mayCommitDiscovery/);
 assert.match(d1,/舊版配方與 AI 法寶登錄已停用/);
 assert.match(http,/app\.post\('\/api\/generate-artifact'/);
 assert.match(http,/res\.status\(410\)/);
});
test('material registry and inventory load before the simple forge UI',()=>{
 const materialSync=main.indexOf("'./cultivation/material-catalog-sync.js'"),materialSystem=main.indexOf("'./cultivation/material-system.js'"),inventory=main.indexOf("'./cultivation/unified-inventory-grid.js'"),forge=main.indexOf("'./cultivation/simple-forge.js'");
 assert.ok(materialSync>=0&&materialSystem>materialSync&&inventory>materialSystem&&forge>inventory);
});
