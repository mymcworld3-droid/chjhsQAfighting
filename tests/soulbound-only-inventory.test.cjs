'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const pool = require('../public/cultivation/soulbound-pool.js');
const fragments = require('../public/cultivation/forge-fragments.js');
const api = require('../artifact-generation-api.js');
const router = require('../ai-router.js');
const {fakeDb} = require('./helpers/inventory-db.cjs');
const read = path => fs.readFileSync(path,'utf8');
const strip = source => source.replace(/^import[\s\S]*?;\s*$/gm,'').replace(/^export /gm,'');
const catalog = vm.runInNewContext(strip(read('public/cultivation/artifact-catalog.js')) +
  '\n({active:ACTIVE_ARTIFACT_EQUIP_SLOTS,all:ARTIFACT_EQUIP_SLOTS,getArtifactById,ARTIFACT_CATALOG});', {QASoulboundPool:pool});
const sword = pool.ITEMS[0];
const ore = {id:'ore',name:'靈鐵',realm:'金丹'};

function jobsRuntime(user, items = [sword]) {
  const local=structuredClone(user), db=fakeDb(user), events=[];
  const window={getCurrentUserData:()=>local,dispatchEvent:event=>events.push(event.type)};
  const ctx={window,console,QASoulboundPool:pool,QAForgeFragments:fragments,
    ARTIFACT_CATALOG:items,MATERIAL_CATALOG:[ore],ARTIFACT_RECIPES:{},REFINERY_JOB_FIELD:'refineryJobV1',
    MAX_ARTIFACT_RECIPE_NESTING:2,SUPPORTED_ARTIFACT_EFFECTS:[...api.ALLOWED_EFFECTS],
    getArtifactById:id=>items.find(item=>item.id===id),getMaterialById:id=>id===ore.id?ore:null,
    artifactRecipeDepth:()=>0,realmForScore:()=>({name:'金丹'}),realmOrderByName:name=>api.REALMS.indexOf(name),
    baseRealmForgeGold:()=>100,calculateRefineryEconomy:()=>({fragments:10,durationMs:1000}),
    raidRefinementKeyRequirement:()=>null,formatRefineryDuration:String,
    getApp:()=>({}),getAuth:()=>({currentUser:{uid:'u1'}}),getFirestore:()=>db,
    doc:(_, ...parts)=>({key:parts.join('/')}),
    runTransaction:(_,worker)=>db.runTransaction(async tx=>worker({
      get:async ref=>{const snap=await tx.get(ref);return {exists:()=>snap.exists,data:snap.data};},update:tx.update,set:tx.set
    })),CustomEvent:class {constructor(type){this.type=type;}}
  };
  vm.runInNewContext(strip(read('public/cultivation/refinery-ai-jobs.js')),ctx);
  return {window,local,db,events};
}

test('active equipment is soulbound only while legacy definitions remain readable',async()=>{
  assert.deepEqual(Array.from(catalog.active),['本命法寶']);
  assert.equal(catalog.all.length,4,'old catalogs must continue validating');
  const guard=catalog.getArtifactById('mountain-armor');
  assert.equal(guard.equipSlot,'護身法寶');
  const user={artifactSystem:{inventory:{[sword.id]:1,'mountain-armor':1},equipped:{本命法寶:sword.id,護身法寶:'mountain-armor'}}};
  const window={getCurrentUserData:()=>user,__artifactCatalogReadyForEquipment:true};
  vm.runInNewContext(strip(read('public/cultivation/artifact-system.js')),{
    window,document:{readyState:'loading',addEventListener(){}},ARTIFACT_CATALOG:catalog.ARTIFACT_CATALOG,
    ARTIFACT_EQUIP_SLOTS:catalog.active,getArtifactById:catalog.getArtifactById,structuredClone
  });
  assert.deepEqual(Array.from(window.getArtifactEquipmentSlots()),['本命法寶']);
  assert.equal(window.getArtifactEquipmentStatus(sword.id).canEquip,true);
  assert.equal(window.getArtifactEquipmentStatus('mountain-armor').canEquip,false);
  const state=window.getArtifactSystemState();
  assert.equal(Object.keys(state.equipped).length,1);
  assert.equal(state.inventory['mountain-armor'],1,'legacy items must not be deleted');
  await assert.rejects(window.craftArtifact('mountain-armor'),/僅開放本命法器精煉/);
});

test('ordinary materials and known ordinary recipes cannot start or charge a forge job',async()=>{
  const user={forgeFragments:50,materialSystem:{inventory:{ore:4}},artifactSystem:{inventory:{},equipped:{}}};
  const app=jobsRuntime(user,[...catalog.ARTIFACT_CATALOG]);
  for (const known of ['', 'mountain-armor']) {
    const plan=app.window.getCultivationRefineryPlan(['material:ore','material:ore'],known);
    assert.equal(plan.valid,false);assert.match(plan.reason,/至少投入一件本命法器/);
    await assert.rejects(app.window.startCultivationRefineryJob(['material:ore','material:ore'],known),/本命法器/);
  }
  assert.deepEqual(app.db.docs.get('users/u1'),user);
});

test('soulbound and material ingredients still start a valid paid refinement job',async()=>{
  const app=jobsRuntime({forgeFragments:50,materialSystem:{inventory:{ore:2}},artifactSystem:{inventory:{[sword.id]:1},equipped:{}}});
  const plan=app.window.getCultivationRefineryPlan(['artifact:'+sword.id,'material:ore']);
  assert.equal(plan.valid,true);
  await app.window.startCultivationRefineryJob(['artifact:'+sword.id,'material:ore']);
  const saved=app.db.docs.get('users/u1');
  assert.equal(saved.forgeFragments,40);assert.equal(saved.materialSystem.inventory.ore,1);
  assert.equal(saved.artifactSystem.inventory[sword.id],undefined);
  assert.equal(saved.refineryJobV1.kind,'discovery');
});

test('unready ordinary legacy jobs refund resources once, including the refinement seal',async()=>{
  const job={id:'legacy',kind:'discovery',readyAtMs:Date.now()+60000,currency:'forgeFragments',fragmentCost:20,
    recipe:[{materialId:'ore',quantity:2}],keyRequirement:{materialId:'seal',quantity:1}};
  const app=jobsRuntime({forgeFragments:5,materialSystem:{inventory:{ore:3}},artifactSystem:{inventory:{},equipped:{}},refineryJobV1:job});
  app.db.retryNextTransaction();
  const results=await Promise.allSettled([app.window.claimCultivationRefineryJob(),app.window.claimCultivationRefineryJob()]);
  assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
  const saved=app.db.docs.get('users/u1');
  assert.equal(saved.forgeFragments,25);assert.equal(saved.materialSystem.inventory.ore,5);
  assert.equal(saved.materialSystem.inventory.seal,1);assert.equal(saved.refineryJobV1,null);
  assert.deepEqual(saved.artifactSystem.inventory,{});
  await assert.rejects(app.window.claimCultivationRefineryJob(),/沒有煉器任務/);
});

test('legacy gold jobs restore paid gold and artifacts; virtual admin material stock is not minted',async()=>{
  const ordinary={id:'old',name:'舊法器',realm:'金丹',equipSlot:'護身法寶'};
  const app=jobsRuntime({isAdmin:true,stats:{gold:7},materialSystem:{inventory:{}},artifactSystem:{inventory:{old:1}},
    refineryJobV1:{id:'legacy-gold',goldCost:15,recipe:[{artifactId:'old',quantity:1},{materialId:'ore',quantity:2}],keyRequirement:{materialId:'seal',quantity:1}}},[ordinary]);
  const result=await app.window.claimCultivationRefineryJob();assert.equal(result.cancelled,true);
  const saved=app.db.docs.get('users/u1');assert.equal(saved.stats.gold,22);
  assert.equal(saved.artifactSystem.inventory.old,2);assert.deepEqual(saved.materialSystem.inventory,{});
});

test('catalogs still loading never misclassify a soulbound job as refundable ordinary forging',()=>{
  const app=jobsRuntime({});
  assert.equal(app.window.isLegacyCultivationRefineryJob({recipe:[{artifactId:'not-loaded',quantity:1},{materialId:'ore',quantity:1}]}),false);
  assert.equal(app.window.isLegacyCultivationRefineryJob({recipe:[{artifactId:sword.id,quantity:1},{materialId:'ore',quantity:1}]}),false);
});

test('generation API rejects no-base requests before AI and forces soulbound output for valid refinements',async()=>{
  let handler,calls=0;
  api({get(){},post(_path,fn){handler=fn;}});
  const original=router.generateJSON,log=console.error;console.error=()=>{};
  const call=async body=>{const res={statusCode:200,set(){},status(code){this.statusCode=code;return this;},json(value){this.body=value;}};await handler({body,get:()=>''},res);return res;};
  try {
    router.generateJSON=async()=>{calls++;return {data:{name:'刻意產出護甲',equipSlot:'護身法寶',effects:[{type:'equip_hp_flat',value:1}]}};};
    let res=await call({selectedIngredients:[{id:'ore',type:'material',quantity:2}],allMaterials:[ore]});
    assert.equal(res.statusCode,400);assert.equal(calls,0);
    res=await call({selectedIngredients:[{id:sword.id,type:'artifact',quantity:1},{id:'ore',type:'material',quantity:1}],existingArtifacts:[sword],allMaterials:[ore]});
    assert.equal(res.statusCode,200);assert.equal(calls,1);
    assert.equal(res.body.artifact.equipSlot,'本命法寶');pool.assertRefinementImproves(res.body.artifact,[sword]);
  } finally {router.generateJSON=original;console.error=log;}
});

test('actual merged inventory renders one soulbound slot and keeps materials visible until selecting that slot',()=>{
  const user={artifactSystem:{inventory:{[sword.id]:1,'mountain-armor':1},equipped:{護身法寶:'mountain-armor'}},materialSystem:{inventory:{ore:2}}};
  const window={getCurrentUserData:()=>user};
  const ctx={window,document:{readyState:'loading',addEventListener(){}},localStorage:{getItem:()=>null},
    ARTIFACT_EQUIP_SLOTS:catalog.active,getArtifactById:catalog.getArtifactById,
    realmOrderByName:name=>api.REALMS.indexOf(name),materialRealmOrderByName:name=>api.REALMS.indexOf(name),materialRealmColor:()=>'#fff',
    QANascentGrowth:{prepare:()=>({inventory:{ore:2}})},getMaterialById:()=>ore,
    MAX_ARTIFACT_RECIPE_NESTING:2,RAID_REFINEMENT_KEYS:{},RAID_CRAFT_MATERIAL_IDS:[],artifactRecipeDepth:()=>0,
    soulboundItemFrameMarkup:()=>'<span class="frame"></span>'};
  const code=strip(read('public/cultivation/unified-inventory-grid.js')).replace(/\}\)\(\);\s*$/,`window.renderTest=()=>rootMarkup(collectItems());
    window.pickTest=()=>{equipmentPickSlot='本命法寶';};})();`);
  vm.runInNewContext(code,ctx);
  let html=window.renderTest();
  assert.equal((html.match(/data-uib-empty-slot=/g)||[]).length,1);
  assert.match(html,/data-uib-empty-slot="本命法寶"/);
  assert.match(html,/data-uib-item="material:ore"/);
  assert.match(html,/data-uib-item="artifact:mountain-armor"/);
  assert.doesNotMatch(html,/class="uib-equipped"/,'obsolete slots must not show as equipped');
  window.pickTest();html=window.renderTest();
  assert.match(html,new RegExp('data-uib-item="artifact:'+sword.id+'"'));
  assert.doesNotMatch(html,/data-uib-item="material:ore"|data-uib-item="artifact:mountain-armor"/);
  assert.match(html,/data-uib-cancel-equip/);
});

test('paid soulbound jobs made impossible by the new caps refund their original resources once',async()=>{
  const capped={id:'old-over-cap',name:'舊精煉器',realm:'金丹',equipSlot:'本命法寶',soulboundBalanceVersion:1,soulboundRefinementVersion:3,
    effects:[{type:'equip_attack_flat',value:3000},{type:'equip_hp_flat',value:12000}]};
  const job={id:'paid-before-cap-change',kind:'discovery',readyAtMs:Date.now()+60000,currency:'forgeFragments',fragmentCost:20,
    recipe:[{artifactId:capped.id,quantity:1},{materialId:'ore',quantity:1}],keyRequirement:{materialId:'seal',quantity:1}};
  const app=jobsRuntime({forgeFragments:5,materialSystem:{inventory:{ore:2}},artifactSystem:{inventory:{},equipped:{}},refineryJobV1:job},[capped]);
  assert.equal(app.window.isLegacyCultivationRefineryJob(job),true);
  const result=await app.window.claimCultivationRefineryJob();assert.equal(result.cancelled,true);
  const saved=app.db.docs.get('users/u1');
  assert.equal(saved.forgeFragments,25);assert.equal(saved.materialSystem.inventory.ore,3);
  assert.equal(saved.materialSystem.inventory.seal,1);assert.equal(saved.artifactSystem.inventory[capped.id],1);
  assert.equal(saved.refineryJobV1,null);
  await assert.rejects(app.window.claimCultivationRefineryJob(),/沒有煉器任務/);
});
