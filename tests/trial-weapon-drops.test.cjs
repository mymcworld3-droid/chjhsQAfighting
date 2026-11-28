'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Manuals=require('../public/cultivation/manual-rules.js');
const {roll}=require('../manual-reward-rules.cjs');
const room=stage=>({mode:'pve',trial:{stage,layoutVersion:4}});
const eligible=Manuals.BOOKS.filter(b=>b.tierRealm==='煉氣');
const filled=()=>Object.fromEntries(eligible.map(b=>[b.id,{exp:70}]));
test('ordinary trial at every stage awards missing eligible native 煉氣 weapons before any copies',()=>{
 for(const stage of [1,5,20,150,1000000]){
  for(const school of ['sword','body']){
   const starter=Manuals.starterFor(school);
   const state=Manuals.normalize({school,books:{[starter]:{exp:70}},dropMisses:3});
   while(eligible.some(b=>!state.books[b.id])){
    state.dropMisses=3;
    const s=room(stage),result=roll(s,'u',state,()=>0);
    assert.ok(result.drop);assert.ok(eligible.some(b=>b.id===result.drop));
    assert.notEqual(result.drop,starter);
    assert.equal(s.manualDrops.u.duplicate,false);
    assert.equal(state.dropMisses,0);
   }
   assert.equal(Object.keys(state.books).length,eligible.length);
   assert.equal(state.books[starter].exp,70);
   const s=room(stage);state.dropMisses=3;
   const next=roll(s,'u',state,()=>0);
   assert.ok(eligible.some(b=>b.id===next.drop));
   assert.equal(s.manualDrops.u.duplicate,true);
   assert.equal(Manuals.refinementFor(state.books[next.drop]),1);
   assert.equal(Boolean(state.books['body-bell']),Manuals.RELEASE_NEW_WEAPONS);
  }
 }
});
test('first tutorial victory guarantees starter and 30 percent roll / fourth victory pity stay unchanged',()=>{
 const state=Manuals.normalize({school:'sword'});
 assert.equal(roll(room(1),'u',state,()=>99).drop,'sword-wind');
 for(let i=1;i<=3;i++){
  const miss=roll(room(2),'u',state,()=>99);
  assert.equal(miss.drop,null);assert.equal(state.dropMisses,i);
 }
 const awarded=roll(room(2),'u',state,()=>0).drop;
 assert.ok(awarded!=='sword-wind'&&eligible.some(b=>b.id===awarded));
 if(!Manuals.RELEASE_NEW_WEAPONS)assert.equal(awarded,'body-rock');
 const all=Manuals.normalize({school:'sword',books:filled()});
 for(let i=1;i<=3;i++){
  assert.equal(roll(room(5),'u',all,()=>99).drop,null);
  assert.equal(all.dropMisses,i);
 }
 assert.ok(roll(room(5),'u',all,()=>0).drop);
 assert.equal(all.dropMisses,0);
 assert.ok(roll(room(5),'u',all,()=>0).drop);
});
test('copies preserve EXP and ownership, refine to five stars, and continue accumulating',()=>{
 const state=Manuals.normalize({school:'sword',books:{...filled(),'sword-sky':{exp:180},...(Manuals.RELEASE_NEW_WEAPONS?{'body-bell':{exp:150}}:{})},dropMisses:3});
 const id=eligible[0].id;
 for(let i=1;i<=7;i++){
  state.dropMisses=3;
  const s=room(200),r=roll(s,'u',state,()=>0);
  assert.equal(r.drop,id);
  assert.equal(s.manualDrops.u.previousRefinement,Math.min(i-1,5));
  assert.equal(s.manualDrops.u.refinement,Math.min(i,5));
  assert.equal(s.manualDrops.u.duplicate,true);
  assert.equal(s.manualDrops.u.quantity,1);
  assert.equal(Manuals.copyCount(state.books[id]),i+1);
  assert.equal(state.books[id].exp,70);
 }
 assert.equal(state.books['sword-sky'].exp,180);
 if(Manuals.RELEASE_NEW_WEAPONS)assert.equal(state.books['body-bell'].exp,150);
});
test('every eligible weapon can be selected for copies without a school bias',()=>{
 for(let i=0;i<eligible.length;i++){
  const state=Manuals.normalize({school:'sword',books:filled(),dropMisses:3});
  const r=roll(room(10),'u',state,max=>{assert.equal(max,eligible.length);return i;});
  assert.equal(r.drop,eligible[i].id);
 }
});
test('non-trial legacy reward pool still excludes owned weapons and may award bell',()=>{
 const books=Object.fromEntries(Manuals.BOOKS.filter(b=>b.id!=='body-bell').map(b=>[b.id,{exp:0}]));
 const state=Manuals.normalize({school:'body',books,dropMisses:3});
 const r=roll({mode:'coop'},'u',state,()=>0);
 assert.equal(r.drop,Manuals.RELEASE_NEW_WEAPONS?'body-bell':null);
 assert.equal(roll({mode:'coop'},'u',state,()=>{throw Error('exhausted pool must not roll');}).drop,null);
});

test('released bell is awarded as the last missing native 煉氣 weapon, then can refine on repeated drops',()=>{
 if(!Manuals.RELEASE_NEW_WEAPONS)return;
 assert.deepEqual(eligible.map(b=>b.id).sort(),['body-bell','body-rock','sword-prism','sword-wind']);
 const books=filled();delete books['body-bell'];
 const state=Manuals.normalize({school:'body',books,dropMisses:3});
 const first=room(10);assert.equal(roll(first,'u',state,()=>0).drop,'body-bell');
 assert.equal(first.manualDrops.u.duplicate,false);assert.equal(state.dropMisses,0);
 state.dropMisses=3;
 const second=room(11);assert.equal(roll(second,'u',state,()=>eligible.findIndex(b=>b.id==='body-bell')).drop,'body-bell');
 assert.equal(second.manualDrops.u.duplicate,true);assert.equal(Manuals.refinementFor(state.books['body-bell']),1);
});
