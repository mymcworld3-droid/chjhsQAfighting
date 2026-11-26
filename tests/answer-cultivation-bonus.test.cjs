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
 assert.equal(total,11);assert.equal(state.remaining,3);assert.equal(state.carry,0);
 const wrong=B.award(state,0,false,1);assert.deepEqual(wrong.state,state);
 for(let i=0;i<3;i++){const r=B.award(state,1,true,1);state=r.state;assert.equal(r.gain,2);assert.equal(r.active,true);}
 assert.equal(state.remaining,0);assert.equal(state.carry,30);
 const next=B.award(state,1,true,1);assert.equal(next.gain,1);assert.equal(next.state.progress,1);
});
test('bonuses add rather than multiply and saved remainder is preserved',()=>{
 const a=B.award({carry:90,remaining:1},2,true,2);
 assert.equal(a.gain,5);assert.equal(a.state.carry,30);assert.equal(a.state.remaining,0);
 assert.equal(B.normalize({carry:999,remaining:9,progress:9}).carry,99);
});
