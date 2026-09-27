'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const battle=require('../battle-reward-api.cjs').__test,cave=require('../dongtian-settlement-api.cjs').__test;
test('battle reward validation derives outcome only from a finished C room',()=>{
 const room={modeVersion:2,status:'finished',host:{uid:'h'},guest:{uid:'g'},winner:'h'};
 assert.deepEqual(battle.battleReward(room,'h'),{role:'host',outcome:'win',gold:500,cultivation:5});
 assert.deepEqual(battle.battleReward(room,'g'),{role:'guest',outcome:'loss',gold:200,cultivation:0});
 assert.equal(battle.battleReward(room,'x'),null);assert.equal(battle.battleReward({...room,status:'playing'},'h'),null);
});
test('Dongtian answers are recomputed from trusted BD questions',()=>{
 const trusted={questions:[{id:'DT-001',correct:'4',wrong:['2','3','5']},{id:'DT-002',correct:'B',wrong:['A','C','D']}]};
 const result=cave.verifyAnswers(trusted,[{id:'DT-001',selected:'4'},{id:'DT-002',selected:'A'}]);
 assert.equal(result.correct,1);assert.equal(result.total,2);assert.equal(result.accuracy,.5);
 assert.throws(()=>cave.verifyAnswers(trusted,[{id:'DT-001',selected:'4'}]),/不完整/);
});
test('Dongtian reward formulas remain deterministic',()=>{
 assert.equal(cave.firstCompletionGold(1),1000);assert.equal(cave.firstCompletionGold(24),2400);
 const p={stats:{totalScore:80},cultivationTraining:{coreEnabled:true,equippedCore:{type:'sword'}},nascentSoulTree:{paths:{sword:{nodes:{rightFarBottom:7}}}}};
 assert.equal(cave.caveSoulBonus(p),7);assert.equal(cave.caveSoulBonus({...p,stats:{totalScore:67}}),0);
});
