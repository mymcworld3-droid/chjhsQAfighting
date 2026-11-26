'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const G=require('../realm-dungeon-gate.cjs'),R=require('../public/cultivation/quest-rules.js');
const pointer=clears=>({weaponDungeonV1:{clears:[clears]}});
test('all seven breakthroughs use cumulative authoritative clears and precede realm tasks',()=>{
 assert.deepEqual(R.DUNGEON_GATES.map(g=>[g.score,g.clears]),[[28,1],[68,3],[188,6],[428,10],[788,15],[1268,21],[1868,28]]);
 for(const g of R.DUNGEON_GATES){
   const q=R.PATH.find(q=>q.id===g.id);
   assert.equal(q.target,g.clears);assert.equal(q.metric,'weaponDungeonClear');
   assert(R.PATH.indexOf(q)<R.PATH.findIndex(q=>q.id===g.before));
   const a=G.apply({totalScore:g.score-1},g.score+5,pointer(g.clears-1));
   assert.equal(a.score,g.score-1);assert.equal(a.state.reserve,6);
   const b=G.apply({totalScore:a.score,realmDungeonGateV1:a.state},a.score,pointer(g.clears));
   assert.equal(b.score,g.score+5);assert.equal(b.state.reserve,0);
 }
});
test('banked cultivation is preserved across multiple locked gains and chained gates',()=>{
 const a=G.apply({totalScore:27},100,pointer(0));
 assert.equal(a.score,27);assert.equal(a.state.reserve,73);
 const b=G.apply({totalScore:a.score,realmDungeonGateV1:a.state},29,pointer(1));
 assert.equal(b.score,67);assert.equal(b.state.reserve,35);
 const c=G.apply({totalScore:b.score,realmDungeonGateV1:b.state},67,pointer(3));
 assert.equal(c.score,102);assert.equal(c.state.reserve,0);
});
test('pre-existing attained realms survive a later loss and are not retroactively locked',()=>{
 const a=G.apply({totalScore:68},67,pointer(0));
 assert.equal(a.score,67);assert.equal(a.state.highestScore,68);
 assert.equal(G.apply({totalScore:67,realmDungeonGateV1:a.state},68,pointer(0)).score,68);
 assert.equal(G.status({totalScore:68},pointer(0)).next.realm,'化神');
});
test('only recorded successful clear counts matter, including future dungeon catalog entries',()=>{
 assert.equal(R.dungeonClearCount({weaponDungeonV1:{tickets:100,unlocked:5,clears:[1,2],byDungeon:{other:{clears:[3]}}}}),6);
 const a=G.apply({totalScore:27,weaponDungeonV1:{clears:[999]}},28,{});
 assert.equal(a.score,27);
});
