'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const jobsSource = fs.readFileSync('public/cultivation/refinery-ai-jobs.js', 'utf8');
const viewSource = fs.readFileSync('public/cultivation/cultivation-refinery-v2.js', 'utf8');

function loadConsumption() {
  const begin = jobsSource.indexOf('  function normalizeInventory(raw = {}) {');
  const end = jobsSource.indexOf('  async function startJob(', begin);
  assert.ok(begin >= 0 && end > begin);
  const ctx = {
    clone: value => JSON.parse(JSON.stringify(value)),
    getMaterialById: id => ({id,name:id}),
    getArtifactById: id => ({id,name:id})
  };
  vm.createContext(ctx);
  vm.runInContext(jobsSource.slice(begin, end) +
    '\nthis.consumeRecipe=consumeRecipe;this.consumeRefinementKey=consumeRefinementKey;', ctx);
  return ctx;
}

function rawUser(isAdmin, iron = 0) {
  return { isAdmin, materialSystem:{inventory:{iron,seal:2}}, artifactSystem:{
    inventory:{sword:2},equipped:{'護身法寶':'sword'}
  }};
}

test('verified administrator can forge without material stock, and physical materials remain unchanged', () => {
  const {consumeRecipe,consumeRefinementKey}=loadConsumption();
  const before=rawUser(true,0);
  const result=consumeRecipe(before,[{materialId:'iron',quantity:5},{artifactId:'sword',quantity:1}]);
  consumeRefinementKey(result.materialSystem,{materialId:'seal',quantity:1},true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.materialSystem.inventory)),{seal:2});
  assert.equal(result.artifactSystem.inventory.sword,1);
  assert.equal(before.artifactSystem.inventory.sword,2,'caller data must not be mutated');
});

test('admin infinite stock does not make artifacts or equipped pieces infinite', () => {
  const {consumeRecipe}=loadConsumption();
  assert.throws(
    () => consumeRecipe(rawUser(true,0),[{materialId:'iron',quantity:7},{artifactId:'sword',quantity:2}]),
    /可用數量不足/
  );
});

test('regular players and clients faking an admin-looking value still need real stock', () => {
  const {consumeRecipe,consumeRefinementKey}=loadConsumption();
  for (const value of [false,undefined,'true',1]) {
    assert.throws(() => consumeRecipe(rawUser(value,0),[{materialId:'iron',quantity:2}]),/數量不足/);
    const result=consumeRecipe(rawUser(value,3),[{materialId:'iron',quantity:2}]);
    consumeRefinementKey(result.materialSystem,{materialId:'seal',quantity:1},false);
    assert.deepEqual(JSON.parse(JSON.stringify(result.materialSystem.inventory)),{iron:1,seal:1});
  }
});

test('normal refinement keys still require stock, admin keys require none and never deduct', () => {
  const {consumeRefinementKey}=loadConsumption();
  const empty={inventory:{}};
  assert.throws(()=>consumeRefinementKey(empty,{materialId:'seal',quantity:1}),/不足/);
  assert.doesNotThrow(()=>consumeRefinementKey(empty,{materialId:'seal',quantity:1},true));
  assert.deepEqual(JSON.parse(JSON.stringify(empty.inventory)),{});
});

test('refinery UI offers infinite legitimate material types and seals only for admins', () => {
  const begin=viewSource.indexOf('  function ingredientOwned(token) {');
  const end=viewSource.indexOf('  function refinementKeyView(', begin);
  assert.ok(begin>=0 && end>begin);
  const materials=new Set(['iron','seal']);
  let isAdmin=true;
  const ctx={
    adminUnlimitedMaterials:()=>isAdmin,
    materialInventory:()=>({iron:0,seal:0}),
    artifactInventory:()=>({sword:2}),
    equippedArtifactCounts:()=>({sword:1}),
    getMaterialById:id=>materials.has(id)?{id,name:id}:null,
    parseToken:token=>{let [type,id]=token.split(':');return {type,id};}
  };
  vm.createContext(ctx);
  vm.runInContext(viewSource.slice(begin,end) +
    '\nthis.api={ingredientOwned,ingredientAvailable,refinementKeyStatus};',ctx);
  assert.equal(ctx.api.ingredientAvailable('material:iron'),Infinity);
  assert.equal(ctx.api.ingredientAvailable('material:unknown'),0);
  assert.equal(ctx.api.ingredientAvailable('artifact:sword'),1);
  assert.equal(ctx.api.refinementKeyStatus({keyRequirement:{materialId:'seal',quantity:1}}).enough,true);
  isAdmin=false;
  assert.equal(ctx.api.ingredientAvailable('material:iron'),0);
  assert.equal(ctx.api.refinementKeyStatus({keyRequirement:{materialId:'seal',quantity:1}}).enough,false);
  assert.match(viewSource,/adminUnlimitedMaterials\(\) \|\| \(Number\(matInv\[m.id\]\) \|\| 0\) > 0/);
  assert.match(viewSource,/管理員無限/);
  assert.match(jobsSource,/if \(fragments < plan.fragments\)/,'refining fragments remain payable');
  assert.match(jobsSource,/raw.isAdmin === true/,'use the verified Firestore profile, not a client flag');
});
