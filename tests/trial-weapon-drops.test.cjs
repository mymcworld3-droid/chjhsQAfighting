'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Manuals=require('../public/cultivation/manual-rules.js');
const {roll}=require('../manual-reward-rules.cjs');
const room=stage=>({mode:'pve',trial:{stage,layoutVersion:4}});
test('ordinary trial at any stage can only award a missing native 煉氣 weapon',()=>{
 for(const stage of [1,5,20,150,1000000]){
  for(const school of ['sword','body']){
   const starter=Manuals.starterFor(school);
   const state=Manuals.normalize({school,books:{[starter]:{exp:70}},dropMisses:3});
   const result=roll(room(stage),'u',state,()=>0);
   assert.ok(result.drop);assert.equal(Manuals.BY_BOOK[result.drop].tierRealm,'煉氣');
   assert.notEqual(result.drop,starter);
   assert.equal(state.books[starter].exp,70);
   assert.equal(state.dropMisses,0);
   const qi=Manuals.BOOKS.filter(b=>b.tierRealm==='煉氣');
   while(Object.keys(state.books).length<qi.length){state.dropMisses=3;const next=roll(room(stage),'u',state,()=>0);assert.ok(next.drop);assert.equal(Manuals.BY_BOOK[next.drop].tierRealm,'煉氣');}
   const done=roll(room(stage),'u',state,()=>{throw Error('exhausted trial pool must not roll');});
   assert.equal(done.drop,null);assert.equal(done.changed,false);
   assert.equal(Object.keys(state.books).length,qi.length);
  }
 }
});
test('first tutorial victory guarantees a 煉氣 starter and ordinary trial pity remains unchanged',()=>{
 const state=Manuals.normalize({school:'sword'});
 assert.equal(roll(room(1),'u',state,()=>99).drop,'sword-wind');
 for(let i=1;i<=3;i++){
  const miss=roll(room(2),'u',state,()=>99);
  assert.equal(miss.drop,null);assert.equal(state.dropMisses,i);
 }
 const awarded=roll(room(2),'u',state,()=>0).drop;
 assert.ok(awarded!=='sword-wind'&&Manuals.BY_BOOK[awarded].tierRealm==='煉氣');
 if(!Manuals.RELEASE_NEW_WEAPONS)assert.equal(awarded,'body-rock');
});
test('existing higher-tier weapons and their EXP are not removed by trial loot',()=>{
 const state=Manuals.normalize({school:'sword',books:{'sword-wind':{exp:10},'body-rock':{exp:20},'sword-sky':{exp:70}},dropMisses:3});
 for(const b of Manuals.BOOKS.filter(b=>b.tierRealm==='煉氣'))state.books[b.id]||={exp:0};
 assert.equal(roll(room(200),'u',state,()=>0).drop,null);
 assert.equal(state.books['sword-sky'].exp,70);
});
