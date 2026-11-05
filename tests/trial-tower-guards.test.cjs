'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Guards=require('../public/cultivation/trial-tower-guards.js');
const Rules=require('../martial-trial-api.cjs').__test;

test('browser previews and authoritative encounters share every guardian and floor stat',()=>{
 const context={};vm.runInNewContext(fs.readFileSync('public/cultivation/trial-tower-guards.js','utf8'),context);
 for(let floor=1;floor<=100;floor++){
  const preview=JSON.parse(JSON.stringify(context.QATrialTowerGuards.enemy(floor))),enemy=Rules.enemy(floor);
  assert.deepEqual(preview,enemy);
  assert.ok(fs.existsSync('public/'+enemy.portrait));
  assert.equal(enemy.uid,'trial-guard-'+floor);
  assert.equal(enemy.hp,enemy.maxHp);
  // Extracting the rules for the lobby must preserve the existing difficulty.
  assert.equal(enemy.atk,Math.round(90+floor*4+.25*floor**1.1));
  assert.equal(enemy.maxHp,Math.round(700+floor*50+2*floor**1.2));
 }
 assert.equal(Guards.ROSTER.length,25);
 assert.equal(new Set(Array.from({length:100},(_,i)=>Guards.enemy(i+1).portrait)).size,25);
 for(let first=1;first<=100;first+=10)
  assert.equal(new Set(Array.from({length:10},(_,i)=>Guards.enemy(first+i).guardId)).size,10,'Decade repeats a character at '+first);
 for(let floor=1;floor<=100;floor++){
  const visible=Guards.nearby(floor).map(f=>Guards.enemy(f).portrait);
  assert.equal(new Set(visible).size,visible.length,'Visible floors repeat a portrait at '+floor);
  if(floor>1)assert.notEqual(Guards.enemy(floor).guardId,Guards.enemy(floor-1).guardId);
 }
 assert.ok(Array.from({length:100},(_,i)=>Guards.enemy(i+1)).every(e=>e.realm!=='煉虛期'));
 for(let floor=91;floor<=100;floor++)assert.equal(Guards.enemy(floor).realm,'超脫');
 assert.equal(Guards.enemy(100).name,'幕後黑手');
 for(const bad of [0,101,-1,NaN,1.5,'2'])assert.throws(()=>Guards.enemy(bad),RangeError);
});

test('default selection is the first uncleared floor, and visible tower tiers stay bounded',()=>{
 for(let best=0;best<=100;best++)assert.equal(Guards.nextFloor(best),Math.min(100,best+1));
 for(let floor=1;floor<=100;floor++){
  const visible=Guards.nearby(floor);
  assert.equal(visible.length,5);assert.ok(visible.includes(floor));
  assert.equal(new Set(visible).size,5);
  assert.ok(visible.every(f=>f>=1&&f<=100));
  assert.ok(visible.every((f,i)=>!i||f===visible[i-1]-1));
 }
 assert.equal(Guards.nextFloor(-1),1);assert.equal(Guards.nextFloor(500),100);
});

test('resumed fights display the new roster without altering saved combat or reward progress',()=>{
 const fighter={name:'舊守衛',realm:'煉虛期',atk:321,hp:123,maxHp:3456,artifactShield:19};
 const record={bestFloor:50,rewardClaims:[50],run:{version:2,runId:'legacy-run',status:'active',floor:51,round:7,
  expiresAtMs:2000,challenger:{...fighter,name:'玩家'},defender:fighter,lastTurn:{notes:['保留回合']}}};
 const before=structuredClone(record),state=Rules.view(record,1000);
 assert.equal(state.defender.name,Guards.enemy(51).name);assert.equal(state.defender.realm,'合體期');
 assert.equal(state.defender.portrait,Guards.enemy(51).portrait);
 assert.equal(state.defender.hp,123);assert.equal(state.defender.maxHp,3456);assert.equal(state.defender.atk,321);assert.equal(state.defender.shield,19);
 assert.equal(state.round,7);assert.equal(state.checkpoint,51);assert.deepEqual(state.claimedFloors,[50]);
 assert.deepEqual(record,before);
});
