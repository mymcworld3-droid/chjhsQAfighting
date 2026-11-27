'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../public/cultivation/answer-cultivation-bonus.js');
const M=require('../public/cultivation/manual-rules.js');
test('per-owned max weapon, not copies or equipped slots',()=>{
 const raw={books:{'sword-wind':{exp:M.MAX_EXP},'body-rock':{exp:M.MAX_EXP},'unknown':{exp:M.MAX_EXP}},weaponIds:[null,null]};
 assert.equal(B.maxedWeapons(raw,M),2);
});
test('integer carry, no rounding loss and no activation on tenth answer',()=>{
 let state,total=0;
 for(let i=0;i<10;i++){const r=B.award(state,1,true,1);state=r.state;total+=r.gain;assert.equal(r.active,false);assert.equal(r.triggered,i===9);}
 assert.equal(total,13);assert.equal(state.remaining,3);assert.equal(state.carry,0);
 const wrong=B.award(state,0,false,1);assert.deepEqual(wrong.state,state);
 for(let i=0;i<3;i++){const r=B.award(state,1,true,1);state=r.state;assert.equal(r.gain,2);assert.equal(r.active,true);}
 assert.equal(state.remaining,0);assert.equal(state.carry,90);
 const next=B.award(state,1,true,1);assert.equal(next.gain,2);assert.equal(next.state.progress,1);assert.equal(next.state.carry,20);
});
test('bonuses add rather than multiply and saved remainder is preserved',()=>{
 const a=B.award({carry:90,remaining:1},2,true,2);
 assert.equal(a.gain,6);assert.equal(a.state.carry,10);assert.equal(a.weaponPercent,60);assert.equal(a.state.remaining,0);
 assert.equal(B.normalize({carry:999,remaining:9,progress:9}).carry,99);
});

test('six mastered weapons grant 180% and enlightenment adds another 100%',()=>{
 const raw={books:Object.fromEntries(M.BOOKS.filter(book=>!book.release).map(book=>[book.id,{exp:M.MAX_EXP}])),weaponIds:[null,null]};
 const count=B.maxedWeapons(raw,M);
 assert.equal(count,6);assert.equal(B.PER_WEAPON,30);
 assert.equal(M.publicState(raw).cultivationBonusPercent,180);
 assert.equal(B.award(null,10,true,count).gain,28);
 assert.equal(B.award({remaining:3},10,true,count).gain,38);
});

test('all released mastered weapons retain 30 percent per distinct weapon',()=>{
 const raw={books:Object.fromEntries(M.BOOKS.map(book=>[book.id,{exp:M.MAX_EXP}]))};
 const count=M.RELEASE_NEW_WEAPONS?12:6;
 assert.equal(B.maxedWeapons(raw,M),count);assert.equal(M.publicState(raw).cultivationBonusPercent,30*count);
 assert.equal(B.award(null,10,true,count).gain,10+3*count);
});
