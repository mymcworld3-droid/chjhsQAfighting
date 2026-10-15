'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fakeDb}=require('./helpers/inventory-db.cjs');
const {transaction,createHandler}=require('../inventory-dismantle-api.cjs').__test;
const F=require('../public/cultivation/forge-fragments.js');
const Pool=require('../public/cultivation/soulbound-pool.js');
const {PROJECT_IDS}=require('../firebase-admin-projects.cjs');
const id=Pool.ITEMS[0].id;
const sample=()=>({uid:'u1',stats:{gold:1000},forgeFragments:10,materialSystem:{inventory:{'qi-spirit-iron':4,'nascent-soul-essence':7}},artifactSystem:{inventory:{[id]:2,'mountain-armor':1},equipped:{本命法寶:id},buffs:{kept:{id:'buff'}}},refineryJobV1:{id:'in-progress',status:'refining'}});
const body=(items,expectedFragments,requestId='dismantle-request-00001')=>({confirmed:true,requestId,items,expectedFragments});
test('batch confirms exact quantities, protects the equipped copy, and credits fragments atomically',async()=>{
 const db=fakeDb(sample());const view=await transaction(db,'u1');
 assert.equal(view.items.find(x=>x.id===id).available,1);assert.ok(!view.items.some(x=>x.id==='nascent-soul-essence'));
 const rows=[{type:'artifact',id,quantity:1},{type:'material',id:'qi-spirit-iron',quantity:3}];
 const total=F.unitValue('artifact',Pool.ITEMS[0])+3*F.unitValue('material',F.MATERIALS[0]);
 const result=await transaction(db,'u1','dismantle',body(rows,total));
 assert.equal(result.fragments,10+total);assert.equal(result.artifactInventory[id],1);assert.equal(result.materialInventory['qi-spirit-iron'],1);
 const user=db.docs.get('users/u1');assert.equal(user.stats.gold,1000);assert.equal(user.materialSystem.inventory['nascent-soul-essence'],7);
 assert.equal(user.artifactSystem.equipped.本命法寶,id);assert.ok(user.artifactSystem.buffs.kept);assert.equal(user.refineryJobV1.id,'in-progress');
});
test('same receipt across double clicks and retries pays once; changed selection is rejected',async()=>{
 const db=fakeDb(sample()),row=[{type:'material',id:'qi-spirit-iron',quantity:4}],op=body(row,16);
 const results=await Promise.all([transaction(db,'u1','dismantle',op),transaction(db,'u1','dismantle',op)]);
 assert.deepEqual(results[0].result,results[1].result);assert.equal(results[1].fragments,26);assert.equal(results[1].materialInventory['qi-spirit-iron'],undefined);
 await assert.rejects(transaction(db,'u1','dismantle',{...op,items:[{...row[0],quantity:1}]}),/其他分解內容/);
 db.docs.get('users/u1').forgeFragments=2;
 assert.equal((await transaction(db,'u1','dismantle',op)).fragments,2,'receipt replay returns current balance without re-crediting');
});
test('two tabs cannot dismantle the same last copies with different IDs',async()=>{
 const db=fakeDb(sample()),rows=[{type:'material',id:'qi-spirit-iron',quantity:4}];
 const results=await Promise.allSettled([transaction(db,'u1','dismantle',body(rows,16)),transaction(db,'u1','dismantle',body(rows,16,'dismantle-request-00002'))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(db.docs.get('users/u1').forgeFragments,26);
});
test('receipt failure and transaction reruns never partially remove items or duplicate shards',async()=>{
 const user=sample(),db=fakeDb(user),op=body([{type:'material',id:'qi-spirit-iron',quantity:2}],8);
 db.failNextCreate();await assert.rejects(transaction(db,'u1','dismantle',op),/unavailable/);assert.deepEqual(db.docs.get('users/u1'),user);
 db.retryNextTransaction();const done=await transaction(db,'u1','dismantle',op);assert.equal(done.fragments,18);assert.equal(done.materialInventory['qi-spirit-iron'],2);
});
test('stale quotes, equipped-only copies and forbidden item types are rejected without mutation',async()=>{
 const invalid=[
 body([{type:'material',id:'qi-spirit-iron',quantity:1}],999),
 body([{type:'artifact',id,quantity:2}],84),
 body([{type:'material',id:'nascent-soul-essence',quantity:1}],1),
 body([{type:'training',id:'pill',quantity:1}],1),
 {...body([{type:'material',id:'qi-spirit-iron',quantity:1}],4),confirmed:false},
 body([{type:'material',id:'qi-spirit-iron',quantity:-1}],4),
 body([{type:'material',id:'qi-spirit-iron',quantity:1.5}],4),
 body([{type:'material',id:'qi-spirit-iron',quantity:1},{type:'material',id:'qi-spirit-iron',quantity:1}],8)
 ];
 for(const op of invalid){const user=sample(),db=fakeDb(user);await assert.rejects(transaction(db,'u1','dismantle',op));assert.deepEqual(db.docs.get('users/u1'),user);assert.equal(db.docs.size,1);}
});
test('generated and refined items use the server catalog, not client supplied prices or realms',async()=>{
 const user=sample();user.artifactSystem.inventory.custom=2;
 const db=fakeDb(user);db.docs.set('gameConfig/artifactCatalogV1',{artifactCatalogSchemaVersion:2,items:[{id:'custom',name:'精煉器',realm:'元嬰',equipSlot:'本命法寶'}]});
 const row=(await transaction(db,'u1')).items.find(x=>x.id==='custom');assert.equal(row.unitFragments,70);
 const result=await transaction(db,'u1','dismantle',body([{type:'artifact',id:'custom',quantity:2,unitFragments:999999,realm:'真仙'}],140));
 assert.equal(result.fragments,150);assert.equal(result.artifactInventory.custom,undefined);
});
test('all eight common pool originals remain authoritative despite remote overrides',async()=>{
 const db=fakeDb(sample());db.docs.set('gameConfig/artifactCatalogV1',{artifactCatalogSchemaVersion:2,items:[{...Pool.ITEMS[0],realm:'真仙',name:'偽價'}]});
 const row=(await transaction(db,'u1')).items.find(x=>x.id===id);assert.equal(row.realm,'金丹');assert.equal(row.unitFragments,42);
});

test('replacing an unrelated stats snapshot cannot revert the independent fragment wallet',async()=>{
 const db=fakeDb(sample());await transaction(db,'u1','dismantle',body([{type:'material',id:'qi-spirit-iron',quantity:1}],4));
 db.docs.get('users/u1').stats={gold:1020,totalScore:29};
 assert.equal((await transaction(db,'u1')).fragments,14);
});
test('dismantle API rejects missing, revoked and wrong-project tokens before reading inventory',async()=>{
 const response=()=>({set(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
 const res=response();await createHandler({resolveA(){throw Error('must not resolve');}})({get:()=>''},res);assert.equal(res.code,401);
 for(const identity of[null,{uid:'u1',aud:PROJECT_IDS.C,iss:'https://securetoken.google.com/'+PROJECT_IDS.C}]){
  const out=response();let revoked;
  await createHandler({resolveA:()=>({auth:{async verifyIdToken(t,r){revoked=r;if(!identity)throw Error('revoked');return identity;}}})})({get:()=>'Bearer token'},out);
  assert.equal(out.code,401);assert.equal(revoked,true);
 }
});
