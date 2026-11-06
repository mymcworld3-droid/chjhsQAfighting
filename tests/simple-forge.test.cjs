'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fakeDb}=require('./helpers/inventory-db.cjs');
const {transaction,view,requirement}=require('../simple-forge-api.cjs').__test;
const pool=require('../public/cultivation/soulbound-pool.js');
const base=pool.ITEMS[0];
const sample=()=>({uid:'u1',stats:{gold:100},forgeFragments:1000,artifactSystem:{inventory:{[base.id]:4},equipped:{'本命法寶':base.id},buffs:{retained:true}},materialSystem:{inventory:{'raid-refine-key-ii':30,'raid-refine-key-iii':30,'qi-spirit-iron':5}}});
const op=(action,fields={},n='1')=>({action,...fields,requestId:'forge-test-request-000'+n});
test('second and third refinements consume identical weapons, fragments and matching stones atomically',async()=>{
 const db=fakeDb(sample()),req=requirement(base,2);const a=await transaction(db,'u1','upgrade',op('upgrade',{itemId:base.id,expected:requirement(base,2)}));
 const u=db.docs.get('users/u1');assert.equal(u.artifactSystem.inventory[base.id],2);assert.equal(u.artifactSystem.inventory[a.item.id],1);assert.equal(u.artifactSystem.equipped['本命法寶'],a.item.id);assert.equal(u.materialSystem.inventory[req.stone],30-req.quantity);assert.equal(u.forgeFragments,1000-req.fragments);assert.equal(u.artifactSystem.buffs.retained,true);
 const b=await transaction(db,'u1','upgrade',op('upgrade',{itemId:base.id,expected:requirement(base,2)},'2'));assert.equal(a.item.id,b.item.id);assert.equal(u.stats.gold,100);
 const c=await transaction(db,'u1','upgrade',op('upgrade',{itemId:a.item.id,expected:requirement(a.item,3)},'3'));const end=db.docs.get('users/u1');assert.equal(c.item.simpleRefinementStage,3);assert.equal(end.artifactSystem.inventory[c.item.id],1);assert.equal(end.artifactSystem.equipped['本命法寶'],c.item.id);assert.equal(end.materialSystem.inventory['raid-refine-key-iii'],30-requirement(a.item,3).quantity);assert.ok(c.item.effects.every((effect,i)=>effect.value>=a.item.effects[i].value));
 await assert.rejects(transaction(db,'u1','upgrade',op('upgrade',{itemId:c.item.id,expected:{}},'4')),/三次/);
});
test('retries, simultaneous requests, and failed transaction cannot double spend',async()=>{
 const user=sample();user.artifactSystem.inventory[base.id]=2;const db=fakeDb(user),request=op('upgrade',{itemId:base.id,expected:requirement(base,2)});
 db.failNextCreate();await assert.rejects(transaction(db,'u1','upgrade',request),/unavailable/);assert.deepEqual(db.docs.get('users/u1'),user);assert.equal(db.docs.has('gameConfig/artifactCatalogV1'),false);
 const results=await Promise.all([transaction(db,'u1','upgrade',request),transaction(db,'u1','upgrade',request)]);assert.equal(results[0].item.id,results[1].item.id);assert.equal(results[1].replayed,true);assert.equal(db.docs.get('users/u1').artifactSystem.inventory[results[0].item.id],1);
 await assert.rejects(transaction(db,'u1','upgrade',op('upgrade',{itemId:base.id,expected:requirement(base,2)},'2')),/兩件/);
});
test('insufficient resources leave every field intact and prevent consuming an equipped copy alone',async()=>{
 for(const mutate of [u=>u.artifactSystem.inventory[base.id]=1,u=>u.forgeFragments=0,u=>u.materialSystem.inventory['raid-refine-key-ii']=0]){
 const user=sample();mutate(user);const db=fakeDb(user);await assert.rejects(transaction(db,'u1','upgrade',op('upgrade',{itemId:base.id,expected:requirement(base,2)})));assert.deepEqual(db.docs.get('users/u1'),user);}
});
test('paid old jobs return exact paid inventory, key and fragments once',async()=>{
 const u=sample();u.refineryJobV1={id:'old-job',currency:'forgeFragments',fragmentCost:42,recipe:[{artifactId:base.id,quantity:1},{materialId:'qi-spirit-iron',quantity:2}],keyRequirement:{materialId:'raid-refine-key-ii',quantity:2}};
 const db=fakeDb(u),request=op('refund',{jobId:'old-job'});const x=await transaction(db,'u1','refund',request);assert.equal(x.kind,'refund');await transaction(db,'u1','refund',request);const r=db.docs.get('users/u1');assert.equal(r.forgeFragments,1042);assert.equal(r.materialSystem.inventory['qi-spirit-iron'],7);assert.equal(r.materialSystem.inventory['raid-refine-key-ii'],32);assert.equal(r.artifactSystem.inventory[base.id],5);assert.equal(r.refineryJobV1,null);
});
test('legacy stage derives from server recipe; refined item remains recognizable in catalog',async()=>{
 const old={...base,id:'old-generated-weapon',name:'舊法器',generatedByAI:true};const u=sample();u.artifactSystem.inventory={[old.id]:2};u.artifactSystem.equipped={};const db=fakeDb(u);
 db.docs.set('gameConfig/artifactCatalogV1',{artifactCatalogSchemaVersion:2,items:[old]});db.docs.set('gameConfig/materialCatalogV1',{recipes:{[old.id]:[{artifactId:base.id,quantity:1},{materialId:'qi-spirit-iron',quantity:1}]}});
 const before=await view(db,'u1');assert.equal(before.weapons[0].stage,2);const result=await transaction(db,'u1','upgrade',op('upgrade',{itemId:old.id,expected:requirement(old,3)}));assert.equal(result.item.simpleRefinementStage,3);assert.equal(result.item.generatedByAI,false);assert.equal(db.docs.get('gameConfig/artifactCatalogV1').items.length,2);assert.equal((await view(db,'u1')).weapons[0].stage,3);
});
test('D1 persists the catalog, transaction receipt and upgrade together',async()=>{
 const {setup}=require('./helpers/d1-db.cjs');const {db}=setup();const user=sample();user.artifactSystem.inventory[base.id]=2;await db.doc('users/u1').set(user);
 const request=op('upgrade',{itemId:base.id,expected:requirement(base,2)});const result=await transaction(db,'u1','upgrade',request);
 const saved=(await db.doc('users/u1').get()).data();assert.equal(saved.artifactSystem.inventory[result.item.id],1);assert.equal((await db.doc('gameConfig/artifactCatalogV1').get()).data().items[0].id,result.item.id);
 assert.equal((await transaction(db,'u1','upgrade',request)).replayed,true);
});
test('stale quotes and incompatible existing results never spend resources',async()=>{
 const user=sample(),db=fakeDb(user);await assert.rejects(transaction(db,'u1','upgrade',op('upgrade',{itemId:base.id,expected:{...requirement(base,2),fragments:1}})),/已更新/);assert.deepEqual(db.docs.get('users/u1'),user);
 const a=await transaction(db,'u1','upgrade',op('upgrade',{itemId:base.id,expected:requirement(base,2)},'2'));db.docs.get('gameConfig/artifactCatalogV1').items[0].effects[0].value=999;
 const before=structuredClone(db.docs.get('users/u1'));await assert.rejects(transaction(db,'u1','upgrade',op('upgrade',{itemId:base.id,expected:requirement(base,2)},'3')),/法器效果已更新/);assert.deepEqual(db.docs.get('users/u1'),before);assert.ok(a.item.id);
});
test('missing or cyclic legacy recipes cannot silently reset an old weapon stage',async()=>{
 const old={...base,id:'old-lost-weapon',generatedByAI:true};const user=sample();user.artifactSystem.inventory={[old.id]:2};user.artifactSystem.equipped={};const db=fakeDb(user);db.docs.set('gameConfig/artifactCatalogV1',{items:[old]});
 let shown=await view(db,'u1');assert.match(shown.weapons[0].error,/缺少煉製紀錄/);await assert.rejects(transaction(db,'u1','upgrade',op('upgrade',{itemId:old.id,expected:requirement(old,2)})),/缺少煉製紀錄/);
 db.docs.set('gameConfig/materialCatalogV1',{recipes:{[old.id]:[{artifactId:'missing-ancestor',quantity:1}]}});shown=await view(db,'u1');assert.match(shown.weapons[0].error,/資料不完整/);
 db.docs.set('gameConfig/materialCatalogV1',{recipes:{[old.id]:[{artifactId:old.id,quantity:1}]}});shown=await view(db,'u1');assert.match(shown.weapons[0].error,/異常/);
 assert.deepEqual(db.docs.get('users/u1'),user);
});
