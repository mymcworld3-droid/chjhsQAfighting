'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../public/cultivation/quest-rules.js'),J=require('../public/cultivation/quest-path-journey.js');
test('journey groups every available quest exactly once and only active quest is claimable',()=>{
 const s=R.view({stats:{totalScore:3000,totalCorrect:100}}, {}, '2026-11-26');
 const j=J.journey(s,R.PATH);
 assert.equal(j.groups.length,10);
 assert.deepEqual(j.groups.flatMap(g=>g.rows.map(q=>q.id)),s.pathRows.map(q=>q.id));
 assert.equal(j.activeId,'path-qi-five');
 assert.ok(s.pathRows.filter(q=>q.id!==s.path.id).every(q=>q.sequenceLocked&&!q.claimable));
 assert.equal(s.pathTotal,s.pathRows.length);
});
test('completed stage remains inspectable and legacy claims preserve next quest',()=>{
 const first=R.PATH.slice(0,4).map(q=>q.id);
 const s=R.view({stats:{totalScore:30}},{pathClaimed:first},'2026-11-26');
 const j=J.journey(s,R.PATH);
 assert.equal(j.groups[0].done,true);
 assert.equal(j.activeId,'path-foundation');
 assert.equal(j.groups[0].rows.every(q=>q.claimed&&!q.sequenceLocked),true);
});
