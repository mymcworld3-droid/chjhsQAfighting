'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {fakeDb}=require('./helpers/inventory-db.cjs');
const F=require('../public/cultivation/forge-fragments.js'),Pool=require('../public/cultivation/soulbound-pool.js');
const read=name=>fs.readFileSync('public/cultivation/'+name,'utf8');
function economy(){const ctx={};vm.runInNewContext(read('refinery-economy.js').replace(/\bexport\s+/g,'')+'\nthis.api={calculateRefineryEconomy,baseRealmForgeGold};',ctx);return ctx.api;}
function runtime({fragments=50,gold=0,discovery=false,switchOnCommit=false}={}){
 const player={uid:'u1',forgeFragments:fragments,stats:{gold},materialSystem:{inventory:{'qi-spirit-iron':4}},artifactSystem:{inventory:{},equipped:{},buffs:{}}};
 let local=structuredClone(player),uid='u1';const db=fakeDb(player),events=[];
 const e=economy(),plan={valid:true,recipe:[{materialId:'qi-spirit-iron',quantity:2}],ingredients:[],discovery,knownArtifactId:discovery?'':'known',targetRealm:'煉氣',playerRealm:'煉氣',depth:0,refinementStage:1,keyRequirement:{},signature:'iron:2',forgeMethod:'自由發揮',...e.calculateRefineryEconomy({targetRealm:'煉氣',playerRealm:'煉氣'})};
 const ctx={QAForgeFragments:F,REFINERY_JOB_FIELD:'refineryJobV1',currentJob:()=>local.refineryJobV1,
 buildPlan:()=>plan,authUser:()=>({uid}),data:()=>local,db:()=>db,clone:structuredClone,
 doc:(_,collection,id)=>db.collection(collection).doc(id),getMaterialById:id=>({id,name:id}),getArtifactById:()=>null,
 cleanAdminGuidance:()=>'',window:{dispatchEvent:event=>events.push(event)},CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts?.detail;}},
 runTransaction:async(_,callback)=>{const result=await db.runTransaction(tx=>callback({...tx,get:async ref=>{const snap=await tx.get(ref);return{exists:()=>snap.exists,data:snap.data};}}));if(switchOnCommit){uid='other';local={uid:'other',forgeFragments:999,stats:{gold:88}};}return result;}
 };
 const source=read('refinery-ai-jobs.js');const start=source.indexOf('  function normalizeInventory('),end=source.indexOf('  function apiMaterials()',start);
 vm.runInNewContext(source.slice(start,end)+'\nthis.start=startJob;',ctx);
 return{db,plan,events,start:()=>ctx.start(['material:qi-spirit-iron','material:qi-spirit-iron'],discovery?'':'known'),local:()=>local};
}
test('known and discovery furnace jobs consume fragments and materials even with zero gold',async()=>{
 for(const discovery of[false,true]){const r=runtime({discovery}),job=await r.start(),user=r.db.docs.get('users/u1');
 assert.equal(job.currency,'forgeFragments');assert.equal(job.fragmentCost,12);assert.equal(job.goldCost,0);
 assert.equal(user.forgeFragments,38);assert.equal(user.stats.gold,0);assert.equal(user.materialSystem.inventory['qi-spirit-iron'],2);assert.equal(r.local().forgeFragments,38);}
});
test('gold cannot substitute for insufficient fragments and a rejected start consumes no materials',async()=>{
 const r=runtime({fragments:11,gold:999999}),before=structuredClone(r.db.docs.get('users/u1'));await assert.rejects(r.start(),/煉器碎片不足/);assert.deepEqual(r.db.docs.get('users/u1'),before);
});
test('concurrent furnace starts and transaction reruns cannot charge twice',async()=>{
 const r=runtime();r.db.retryNextTransaction();const results=await Promise.allSettled([r.start(),r.start()]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.db.docs.get('users/u1').forgeFragments,38);
});
test('a completed transaction after account switching cannot overwrite the next account or emit stale inventory',async()=>{
 const r=runtime({switchOnCommit:true});await r.start();assert.equal(r.db.docs.get('users/u1').forgeFragments,38);assert.equal(r.local().forgeFragments,999);assert.equal(r.events.length,0);
});
test('fragment pricing covers half-immortals, legacy realm names and material/weapon recovery ratios',()=>{
 const e=economy();assert.equal(e.calculateRefineryEconomy({targetRealm:'半仙',playerRealm:'半仙'}).fragments,440);
 assert.equal(e.calculateRefineryEconomy({targetRealm:'大乘',playerRealm:'渡劫'}).fragments,325);
 for(const realm of F.REALMS)assert.ok(F.unitValue('artifact',{id:'normal',realm})<=F.baseCost(realm));
 assert.equal(F.unitValue('material',{id:'nascent-soul-essence',realm:'元嬰'}),0);
});
test('server dismantle fallbacks match the built-in browser catalogs exactly',()=>{
 const ctx={QASoulboundPool:Pool};vm.createContext(ctx);
 const clean=source=>source.replace(/^import[^;]+;\s*/gm,'').replace(/\bexport\s+/g,'');
 vm.runInContext(clean(read('artifact-catalog.js'))+'\nthis.defaults=getDefaultArtifactCatalog();',ctx);
 for(const item of F.DEFAULT_ARTIFACTS){const canonical=ctx.defaults.find(x=>x.id===item.id);assert.ok(canonical);assert.equal(item.realm,canonical.realm);assert.equal(item.name,canonical.name);assert.equal(item.equipSlot,canonical.equipSlot||'');}
 vm.runInContext(clean(read('material-catalog.js'))+'\nthis.materials=getDefaultMaterialCatalog();',ctx);
 for(const item of F.MATERIALS){const canonical=ctx.materials.find(x=>x.id===item.id);assert.ok(canonical);assert.equal(item.realm,canonical.realm);assert.equal(item.name,canonical.name);}
});
