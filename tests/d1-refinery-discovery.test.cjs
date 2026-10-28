'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {setup} = require('./helpers/d1-db.cjs');
const {Codec} = require('../d1-store.cjs');
const {executeCommit} = require('../d1-browser-api.cjs');
const generation = require('../artifact-generation-api.js');
const pool = require('../public/cultivation/soulbound-pool.js');
const fragments = require('../public/cultivation/forge-fragments.js');
const context = {uid:'alice',admin:false,decoded:{email:'alice@example.com'}};
const artifactPath = 'gameConfig/artifactCatalogV1', materialPath = 'gameConfig/materialCatalogV1';
const clone = value => JSON.parse(JSON.stringify(value));
const source = fs.readFileSync(require.resolve('../public/cultivation/artifact-catalog.js'),'utf8')
  .replace(/^import .*;\n/gm,'').replace(/export (const|function) /g,'$1 ');
const normalize = vm.runInNewContext('(() => {' + source + ';return normalizeArtifactDefinition;})()', {QASoulboundPool:pool});
const normalizeItem = item => clone(normalize(item));
const signature = (recipe,method='自由發揮') => recipe.map(row => ({key:row.artifactId?'artifact:'+row.artifactId:'material:'+row.materialId,quantity:row.quantity}))
  .sort((a,b)=>a.key.localeCompare(b.key)).map(row=>row.key+':'+row.quantity).join('|')+(method==='自由發揮'?'':'|method:'+method);
const write = (path,data,type='set') => ({target:{role:'A',path,kind:'doc'},type,data:Codec.encode(data),options:type==='set'?{merge:true}:undefined});

async function fixture({empty=false,realm='煉氣',stage=2,recipe=[{artifactId:pool.ITEMS[0].id,quantity:1},{materialId:'qi-spirit-iron',quantity:1}],primaryArtifacts=[pool.ITEMS[0]],effects=[{type:'equip_attack_flat',value:2}],bounds={}}={}) {
  const {db} = setup(), now=Date.now();
  const job={id:'forge-preserved-job',kind:'discovery',status:'refining',readyAtMs:now-1000,targetRealm:realm,
    refinementStage:stage,recipe,forgeMethod:'自由發揮',signature:signature(recipe)};
  const user={uid:'alice',isAdmin:false,stats:{gold:100},forgeFragments:5,refineryJobV1:job,
    artifactSystem:{inventory:{existing:2,empty:0},equipped:{},buffs:[]}};
  const catalog={version:2,artifactCatalogSchemaVersion:2,generationPrompt:'admin only',effectBoundsV2:bounds,
    items:[{id:'existing',name:'其他玩家的器物',realm:'煉氣',recipeOwnerUid:'bob',customMetadata:'keep'},...primaryArtifacts]};
  const materials={version:5,items:[{id:'admin-material'}],recipes:{orphan:[{materialId:'removed',quantity:2}]},adminSettings:{keep:true}};
  await db.doc('users/alice').set(user);
  if(!empty){await db.doc(artifactPath).set(catalog);await db.doc(materialPath).set(materials);}
  const artifact=normalizeItem({id:'ai-artifact-test-result',...generation.sanitizeGeneratedArtifact({name:'新生靈器',effects},realm,stage,{},bounds,
    recipe.reduce((sum,row)=>sum+row.quantity,0),{forgeMethod:job.forgeMethod,primaryArtifacts}),
    realm,craft:{gold:fragments.baseCost(realm)*10,yield:1},reviewStatus:'pending',generatedByAI:true,generatedAtMs:now,
    recipeOwnerUid:'alice',recipeOwnerName:'修士',recipeDiscoveredAtMs:now,generationSignature:job.signature});
  const inventory={existing:2,[artifact.id]:1};
  const writes=[write(artifactPath,{version:1,items:[artifact,...(empty?[]:catalog.items)],aiGeneratedAtMs:now,aiGeneratedArtifactId:artifact.id}),
    write(materialPath,{recipes:{...(empty?{}:materials.recipes),[artifact.id]:recipe},aiGeneratedRecipeAtMs:now,aiGeneratedArtifactId:artifact.id}),
    write('users/alice',{artifactSystem:{...user.artifactSystem,inventory},refineryJobV1:null},'update')];
  return {db,user,job,catalog,materials,artifact,input:{writes}};
}

test('ordinary player registers one generated artifact and recipe and awards it atomically',async()=>{
  const f=await fixture();
  await executeCommit(f.db,f.input,context);
  const user=(await f.db.doc('users/alice').get()).data(),catalog=(await f.db.doc(artifactPath).get()).data(),materials=(await f.db.doc(materialPath).get()).data();
  assert.equal(user.refineryJobV1,null);assert.equal(user.artifactSystem.inventory[f.artifact.id],1);
  assert.equal(user.forgeFragments,5);assert.equal(user.stats.gold,100);
  assert.deepEqual(catalog.items,[f.artifact,...f.catalog.items]);assert.equal(catalog.generationPrompt,'admin only');
  assert.deepEqual(materials.recipes,{...f.materials.recipes,[f.artifact.id]:f.job.recipe});assert.deepEqual(materials.adminSettings,{keep:true});
  await assert.rejects(executeCommit(f.db,f.input,context),e=>e.status===403);
  assert.equal((await f.db.doc('users/alice').get()).data().artifactSystem.inventory[f.artifact.id],1);
});

test('first discovery can create absent config documents without publishing fallback catalog entries',async()=>{
  const f=await fixture({empty:true});await executeCommit(f.db,f.input,context);
  assert.deepEqual((await f.db.doc(artifactPath).get()).data().items,[f.artifact]);
});

const mutations={
  'missing player award':f=>f.input.writes.pop(),
  'missing recipe':f=>f.input.writes.splice(1,1),
  'edits existing artifact':f=>{f.input.writes[0].data.items[1].name='hijacked';},
  'deletes existing artifact':f=>{f.input.writes[0].data.items.pop();},
  'deletes orphan recipe':f=>{delete f.input.writes[1].data.recipes.orphan;f.input.writes[1].options={};},
  'changes admin prompt':f=>{f.input.writes[0].data.generationPrompt='hijacked';},
  'changes admin bounds':f=>{f.input.writes[0].data.effectBoundsV2={'1':{}};},
  'changes recipe owner':f=>{f.input.writes[0].data.items[0].recipeOwnerUid='bob';},
  'claims approved status':f=>{f.input.writes[0].data.items[0].reviewStatus='approved';},
  'wrong recipe':f=>{f.input.writes[1].data.recipes[f.artifact.id][0].quantity=8;},
  'oversized effect':f=>{f.input.writes[0].data.items[0].effects[0].value=1e20;},
  'mints ordinary output':f=>{f.input.writes[0].data.items[0].equipSlot='護身法寶';},
  'double award':f=>{f.input.writes[2].data.artifactSystem.inventory[f.artifact.id]=2;},
  'changes currency with award':f=>{f.input.writes[2].data.forgeFragments=999;},
  'keeps job after award':f=>{f.input.writes[2].data.refineryJobV1=f.job;},
  'duplicates config operation':f=>{f.input.writes.push(clone(f.input.writes[0]));},
  'not ready':async f=>{await f.db.doc('users/alice').update({'refineryJobV1.readyAtMs':Date.now()+60000});},
  'no job':async f=>{await f.db.doc('users/alice').update({refineryJobV1:null});}
};
for(const [name,mutate] of Object.entries(mutations))test('rejects '+name+' and preserves all data',async()=>{
  const f=await fixture();await mutate(f);
  const paths=['users/alice',artifactPath,materialPath],before=await Promise.all(paths.map(async path=>(await f.db.doc(path).get()).data()));
  await assert.rejects(executeCommit(f.db,f.input,context),e=>e.status===403);
  assert.deepEqual(await Promise.all(paths.map(async path=>(await f.db.doc(path).get()).data())),before);
});

test('stale concurrent discovery conflicts; retry awards existing recipe without changing ownership',async()=>{
  const f=await fixture();await f.db.doc('users/bob').set({...f.user,uid:'bob'});
  const snap=await f.db.doc(artifactPath).get();
  await executeCommit(f.db,f.input,context);
  const stale={...clone(f.input),reads:[{target:{role:'A',path:artifactPath,kind:'doc'},version:snap.version}]};
  await assert.rejects(executeCommit(f.db,stale,context),e=>e.code==='aborted');
  await executeCommit(f.db,{writes:[write('users/bob',{refineryJobV1:null,artifactSystem:{inventory:{existing:2,[f.artifact.id]:1},equipped:{},buffs:[]}},'update')]},{...context,uid:'bob'});
  assert.equal((await f.db.doc(artifactPath).get()).data().items[0].recipeOwnerUid,'alice');
  assert.equal((await f.db.doc('users/bob').get()).data().artifactSystem.inventory[f.artifact.id],1);
});

test('server configured bounds and all generated effect forms remain accepted',async()=>{
  for(const stage of [1,2,3])for(const type of generation.ALLOWED_EFFECTS){
    if(!type.startsWith('equip_') || !generation.effectRange(type,4,stage))continue;
    const f=await fixture({realm:'元嬰',stage,effects:[{type,value:1000,multiplier:2}]});
    await assert.doesNotReject(executeCommit(f.db,f.input,context),type+' stage '+stage);
  }
  const bounds={'1':{equip_attack_flat:{min:100,max:220}}};
  const f=await fixture({bounds,effects:[{type:'equip_attack_flat',value:120}]});
  await executeCommit(f.db,f.input,context);
});

test('soulbound refinement retains and improves the authoritative source effects',async()=>{
  const original=pool.ITEMS.find(item=>item.realm==='元嬰')||pool.ITEMS[0];
  const f=await fixture({realm:original.realm,stage:2,recipe:[{artifactId:original.id,quantity:1},{materialId:'qi-spirit-iron',quantity:1}],primaryArtifacts:[original]});
  await executeCommit(f.db,f.input,context);
  pool.assertRefinementImproves((await f.db.doc(artifactPath).get()).data().items[0],[original]);
});

test('ordinary material-only discovery cannot publish or award any new artifact', async()=>{
  const f=await fixture({primaryArtifacts:[],recipe:[{materialId:'qi-spirit-iron',quantity:1},{materialId:'qi-spirit-wood',quantity:1}]});
  const before=await Promise.all(['users/alice',artifactPath,materialPath].map(async path=>(await f.db.doc(path).get()).data()));
  await assert.rejects(executeCommit(f.db,f.input,context),error=>error.status===403);
  assert.deepEqual(await Promise.all(['users/alice',artifactPath,materialPath].map(async path=>(await f.db.doc(path).get()).data())),before);
});

test('stale administrator bounds cannot change valid system-governed discovery commits',async()=>{
  const f=await fixture({bounds:{'2':{equip_attack_flat:{min:9999999,max:9999999}}}});
  await executeCommit(f.db,f.input,context);
  const saved=(await f.db.doc(artifactPath).get()).data().items[0];
  assert.equal(saved.soulboundBalanceVersion,pool.BALANCE_VERSION);
  for(const effect of saved.effects){const bounds=pool.EFFECT_BOUNDS[effect.type];if(bounds)assert.ok(effect.value>=bounds.min&&effect.value<=bounds.max);}
});

for(const field of ['soulboundRefinementVersion','soulboundBalanceVersion'])test('discovery rejects stale '+field+' without awarding or publishing',async()=>{
  const f=await fixture();f.input.writes[0].data.items[0][field]=0;
  await assert.rejects(executeCommit(f.db,f.input,context),error=>error.status===403);
  assert.equal((await f.db.doc('users/alice').get()).data().artifactSystem.inventory[f.artifact.id],undefined);
});
