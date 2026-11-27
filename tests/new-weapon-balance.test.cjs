'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../public/cultivation/manual-rules.js'),D=require('../public/cultivation/new-weapon-drafts.js'),R=require('../public/cultivation/tactical-rules.js'),P=require('../public/cultivation/tactical-power-rules.js');
const books=[...new Map([...M.BOOKS,...D.BOOKS].map(b=>[b.id,b])).values()];
const tiers=['煉氣','築基','金丹'],attack=200;
test('twelve weapons keep tier base damage and stamina efficiency at equal development',()=>{
 assert.equal(books.length,12);
 for(const [level,stars] of [[1,0],[5,5]]){
  for(const school of ['sword','body']){
   let prior=0;
   for(const [i,tier] of tiers.entries()){
    const group=books.filter(b=>b.school===school&&b.tierRealm===tier);
    assert.equal(group.length,2);
    const expected=(school==='sword'?[1.2,1.5,1.9]:[1.3,1.6,2])[i];
    const scaled=expected*(1+(level-1)*.1)*(1+stars*.05);
    for(const book of group){
     const skill=M.skillAtLevel(book.skills[0],level,stars);
     assert.equal(skill.cost,2);assert.ok(Math.abs(skill.power-scaled)<1e-9);
     assert.ok(skill.power/skill.cost>prior);
     assert.ok(P.estimateMove(attack,skill)>0);
    }
    prior=scaled/2;
   }
  }
 }
});
test('compare complete setup cycles, movement and question budgets without altering confirmed powers',()=>{
 const s=D.BY_SKILL,hit=(id,n=1)=>Math.round(attack*s[id].power)*n;
 const cycle=(ids,damage,moves=0)=>{const stamina=ids.reduce((n,id)=>n+s[id].cost,0)+moves;return {damage,stamina,efficiency:damage/stamina,correctAnswers:Math.ceil(Math.max(0,stamina-2)/R.LIMITS.correct)};};
 const weave=cycle(['weave-mark','weave-mark','weave-domain'],hit('weave-mark',2)+attack*s['weave-domain'].powers.two);
 const time=cycle(['time-slash','time-slash','time-union'],hit('time-slash',2)+hit('time-union',3),1);
 const gravity=cycle(['gravity-core','gravity-crash'],hit('gravity-core',5)+attack*s['gravity-crash'].powers.near);
 assert.deepEqual(weave,{damage:1080,stamina:8,efficiency:135,correctAnswers:2});
 assert.equal(time.damage,1960);assert.equal(time.stamina,11);assert.equal(time.correctAnswers,3);
 assert.equal(gravity.damage,1900);assert.equal(gravity.stamina,9);assert.equal(gravity.correctAnswers,2);
 assert.ok(time.efficiency>weave.efficiency);assert.ok(gravity.efficiency>time.efficiency);
 assert.equal(s['prism-scatter'].maxTargetPower,2.4);assert.equal(s['gravity-core'].maxTriggers,5);
 for(const book of books)for(const raw of book.skills)for(const [level,stars] of [[1,0],[5,5]])assert.ok(Number.isFinite(P.estimateMove(attack,M.skillAtLevel(raw,level,stars))),raw.id);
});
