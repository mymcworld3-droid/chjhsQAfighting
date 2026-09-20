const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const artifactCatalog = read('public/cultivation/artifact-catalog.js');
const materialCatalog = read('public/cultivation/material-catalog.js');
const refinery = read('public/cultivation/cultivation-refinery-v2.js');
const materialSystem = read('public/cultivation/material-system.js');
const artifactSystem = read('public/cultivation/artifact-system.js');
const artifactAdmin = read('public/cultivation/admin-artifact-manager.js');
const materialAdmin = read('public/cultivation/admin-material-manager.js');
const bag = read('public/cultivation/unified-inventory-grid.js');
const index = read('public/index.html');

function loadRecipeApi() {
  const ids = [
    'seven-treasure-ruler',
    'war-drum',
    'enlightenment-lamp',
    'mountain-armor',
    'void-sword',
    'longevity-jade'
  ];
  const realms = [
    ['凡人',0,0],['煉氣',1,1],['築基',2,10],['金丹',3,28],['元嬰',4,68],
    ['化神',5,128],['煉虛',6,208],['合體',7,308],['大乘',8,448],['渡劫',9,628],['真仙',10,868]
  ].map(([name,order,need]) => ({ name, order, need }));

  const context = vm.createContext({
    ARTIFACT_CATALOG: ids.map((id) => ({ id, name: id })),
    ARTIFACT_REALMS: realms,
    getArtifactById(id) {
      return this.ARTIFACT_CATALOG.find((item) => item.id === id) || null;
    }
  });
  // getArtifactById above must not depend on call-site this.
  context.getArtifactById = (id) => context.ARTIFACT_CATALOG.find((item) => item.id === id) || null;

  let source = materialCatalog
    .replace(/^import[^;]+;\s*/m, '')
    .replace(/\bexport\s+/g, '');
  source += '\n;globalThis.__recipeApi={validateArtifactRecipes,repairArtifactRecipes,artifactRecipeDepth,MAX_ARTIFACT_RECIPE_NESTING,MIN_ARTIFACT_RECIPE_MATERIALS};';
  vm.runInContext(source, context);
  return context.__recipeApi;
}

test('artifact realms have the same distinct color system across artifact UIs', () => {
  assert.match(artifactCatalog, /ARTIFACT_REALM_COLORS/);
  for (const realm of ['凡人','煉氣','築基','金丹','元嬰','化神','煉虛','合體','大乘','渡劫','真仙']) {
    assert.match(artifactCatalog, new RegExp(realm + ':'));
  }
  assert.match(artifactSystem, /artifactRealmColor\(item\.realm\)/);
  assert.match(artifactSystem, /--artifact-realm-color/);
  assert.match(artifactAdmin, /artifactRealmColor\(item\.realm\)/);
  assert.match(materialAdmin, /artifactRealmColor\(artifact\.realm\)|artifactRealmColor\(item\.realm\)/);
  assert.match(bag, /qualityColor\(item\.realm\)/);
});

test('recipe schema accepts material and artifact ingredients while keeping old material rows compatible', () => {
  assert.match(materialCatalog, /row\?\.artifactId/);
  assert.match(materialCatalog, /row\?\.materialId/);
  assert.match(materialCatalog, /return \{ artifactId: key\.slice\(9\), quantity \}/);
  assert.match(materialCatalog, /return \{ materialId: key\.slice\(9\), quantity \}/);
  assert.match(artifactAdmin, /data-recipe-artifact/);
  assert.match(artifactAdmin, /data-recipe-material/);
});

test('every defined artifact recipe requires at least two total ingredients', () => {
  const api = loadRecipeApi();
  assert.equal(api.MIN_ARTIFACT_RECIPE_MATERIALS, 2);
  assert.throws(() => api.validateArtifactRecipes({
    'seven-treasure-ruler': [{ materialId: 'spirit-wood', quantity: 1 }]
  }), /至少需要 2 個煉器素材/);
  assert.doesNotThrow(() => api.validateArtifactRecipes({
    'seven-treasure-ruler': [{ materialId: 'spirit-wood', quantity: 2 }]
  }));
});

test('artifact recipe nesting allows depth two but rejects depth three', () => {
  const api = loadRecipeApi();
  const recipes = {
    'seven-treasure-ruler': [{ materialId: 'spirit-wood', quantity: 2 }],
    'war-drum': [{ artifactId: 'seven-treasure-ruler', quantity: 2 }],
    'enlightenment-lamp': [{ artifactId: 'war-drum', quantity: 2 }]
  };
  const valid = api.validateArtifactRecipes(recipes);
  assert.equal(api.artifactRecipeDepth('seven-treasure-ruler', valid), 0);
  assert.equal(api.artifactRecipeDepth('war-drum', valid), 1);
  assert.equal(api.artifactRecipeDepth('enlightenment-lamp', valid), 2);
  assert.equal(api.MAX_ARTIFACT_RECIPE_NESTING, 2);

  assert.throws(() => api.validateArtifactRecipes({
    ...recipes,
    'mountain-armor': [{ artifactId: 'enlightenment-lamp', quantity: 2 }]
  }), /最多只允許 2 層/);
});

test('artifact recipe nesting rejects self-recursion and cycles', () => {
  const api = loadRecipeApi();
  assert.throws(() => api.validateArtifactRecipes({
    'war-drum': [{ artifactId: 'war-drum', quantity: 2 }]
  }), /不可把自己當成煉器材料|循環套娃/);

  assert.throws(() => api.validateArtifactRecipes({
    'war-drum': [{ artifactId: 'enlightenment-lamp', quantity: 2 }],
    'enlightenment-lamp': [{ artifactId: 'war-drum', quantity: 2 }]
  }), /循環套娃/);
});

test('orphan artifact recipes are repaired as a cascade without weakening strict validation', () => {
  const api = loadRecipeApi();
  const broken = {
    'seven-treasure-ruler': [{ materialId: 'spirit-wood', quantity: 2 }],
    'war-drum': [{ artifactId: 'deleted-ai-artifact', quantity: 2 }],
    'enlightenment-lamp': [{ artifactId: 'war-drum', quantity: 2 }]
  };

  assert.throws(() => api.validateArtifactRecipes(broken), /使用不存在的法寶/);
  const repaired = api.repairArtifactRecipes(broken);
  assert.equal(repaired.changed, true);
  assert.deepEqual([...repaired.removedRecipeIds].sort(), ['enlightenment-lamp', 'war-drum']);
  assert.ok(repaired.recipes['seven-treasure-ruler']);
  assert.equal(repaired.recipes['war-drum'], undefined);
  assert.equal(repaired.recipes['enlightenment-lamp'], undefined);
});

test('player refinery accepts artifact tokens and never consumes equipped copies', () => {
  assert.match(refinery, /artifact:\$\{a\.id\}/);
  assert.match(refinery, /data-refinery-ingredient/);
  assert.match(refinery, /持有煉器素材 · 一般素材/);
  assert.match(refinery, /> 二次煉製<\/span>/);
  assert.match(refinery, /equippedArtifactCounts/);
  const aiJobs = read('public/cultivation/refinery-ai-jobs.js');
  assert.match(aiJobs, /have - reserved < need/);
  assert.match(aiJobs, /已裝備法寶不會被消耗/);
  assert.match(aiJobs, /delete artifactSystem\.inventory\[row\.artifactId\]/);
  assert.match(aiJobs, /artifact-system-updated/);
});

test('legacy forge path also reserves equipped artifacts and consumes mixed recipes atomically', () => {
  assert.match(materialSystem, /row\.artifactId/);
  assert.match(materialSystem, /equippedCounts/);
  assert.match(materialSystem, /owned - reserved/);
  assert.match(materialSystem, /delete artifactSystem\.inventory\[row\.artifactId\]/);
  assert.match(materialSystem, /tx\.update\(ref, \{ \[FIELD\]: materials, artifactSystem, 'stats\.gold': newGold \}\)/);
});

test('backpack exposes refinement depth and index preloads the new refinery styling', () => {
  assert.match(bag, /refinementDepth: item \? artifactRecipeDepth\(id\) : 0/);
  assert.match(bag, /二次煉製深度/);
  const start = index.indexOf('<style id="cultivation-refinery-v2-style">');
  const end = index.indexOf('</style>', start);
  const css = index.slice(start, end);
  assert.match(css, /refinery-artifact-ingredient/);
  assert.match(css, /refinery-group-title/);
  assert.match(index, /main\.js\?v=20260920-market-details2/);
});

test('owned refinery ingredients use deterministic realm then name ordering', () => {
  assert.match(refinery, /materialRealmOrderByName/);
  assert.match(refinery, /realmOrderByName/);
  assert.match(refinery, /function compareOwnedMaterials\(a, b\)/);
  assert.match(refinery, /function compareOwnedArtifacts\(a, b\)/);
  assert.match(refinery, /\.sort\(compareOwnedMaterials\)/);
  assert.match(refinery, /\.sort\(compareOwnedArtifacts\)/);
  assert.match(refinery, /localeCompare\([^\n]+['"]zh-Hant['"]\)/);
});

test('refinery separates general materials and second-refinement artifacts into independent scroll panes', () => {
  assert.match(refinery, /data-refinery-material-roll="materials"/);
  assert.match(refinery, /data-refinery-material-roll="artifacts"/);
  assert.match(refinery, /data-refinery-material-roll-body="materials"/);
  assert.match(refinery, /data-refinery-material-roll-body="artifacts"/);
  assert.match(refinery, /\.refinery-material-roll-body\{[^}]*overflow:auto/);
  assert.match(refinery, /持有煉器素材 · 一般素材/);
  assert.match(refinery, /> 二次煉製<\/span>/);
});

test('material divider is shifted 96px downward inside the whole held-material card', () => {
  assert.match(refinery, /refinery-panel refinery-material-panel/);
  assert.match(refinery, /\.refinery-material-panel\{[^}]*padding:0[^}]*grid-template-rows:minmax\(0,1fr\)[^}]*overflow:hidden/);
  assert.match(refinery, /\.refinery-material-list\{[^}]*grid-template-rows:minmax\(0,calc\(50% \+ 96px - 32px\)\) minmax\(0,calc\(50% - 96px \+ 32px\)\)[^}]*gap:0[^}]*height:100%/);
  assert.doesNotMatch(refinery, /refinery-panel"><div class="refinery-head"><div><h3><i class="fa-solid fa-gem"><\/i> 持有煉器素材/);
});

test('empty second-refinement notice sits at the bottom of its half', () => {
  assert.match(refinery, /data-refinery-material-roll-body="artifacts"/);
  assert.match(refinery, /artifactHtml \? '' : 'is-empty'/);
  assert.match(refinery, /\.refinery-material-roll-body\.is-empty\{display:flex;flex-direction:column;justify-content:flex-end\}/);
});

test('second-refinement heading follows the divider after the divider moves down 96px', () => {
  assert.match(refinery, /\.refinery-material-roll\+\.refinery-material-roll \.refinery-group-title\{margin-top:0\}/);
});


test('second-refinement bottom edge extends another 64px while the divider stays fixed', () => {
  assert.match(refinery, /--refinery-bottom-extension:64px/);
  assert.match(refinery, /\.refinery-material-roll\+\.refinery-material-roll\{[^}]*padding-bottom:0/);
  assert.match(refinery, /\.refinery-material-roll\+\.refinery-material-roll \.refinery-material-roll-body\{padding-bottom:0\}/);
  assert.match(refinery, /grid-template-rows:minmax\(0,calc\(50% \+ 96px - 32px\)\) minmax\(0,calc\(50% - 96px \+ 32px\)\)/);
});


test('second-refinement artifacts sit at the bottom when the pane has spare height', () => {
  assert.match(refinery, /refinery-material-roll\[data-refinery-material-roll="artifacts"\] \.refinery-material-roll-body:not\(\.is-empty\)\{align-content:end;align-content:safe end\}/);
  assert.match(refinery, /\.refinery-material-roll-body\{[^}]*align-content:start/);
});
