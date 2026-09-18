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
  source += '\n;globalThis.__recipeApi={validateArtifactRecipes,artifactRecipeDepth,MAX_ARTIFACT_RECIPE_NESTING,MIN_ARTIFACT_RECIPE_MATERIALS};';
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
  assert.match(materialAdmin, /data-recipe-artifact/);
  assert.match(materialAdmin, /data-recipe-material/);
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

test('player refinery accepts artifact tokens and never consumes equipped copies', () => {
  assert.match(refinery, /artifact:\$\{a\.id\}/);
  assert.match(refinery, /data-refinery-ingredient/);
  assert.match(refinery, /法寶素材・二次煉製/);
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
  assert.match(index, /main\.js\?v=20260918-playerforgecopy1/);
});
