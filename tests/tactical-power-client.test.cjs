'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/combat-power.js'),'utf8');
const Power=require('../public/cultivation/tactical-power-rules.js');
const Access=require('../public/cultivation/training-access-rules.js');
function harness(){
  let uid='u1',serverState=null;
  const events=[];
  const user={stats:{totalScore:28,attack:200,maxHp:1000}};
  const window={
    QA_MANUAL_TRAINING_ONLY:true,
    getCombatStats:()=>({attack:200,maxHp:1100}),
    getCurrentUserData:()=>user,
    addEventListener(){},
    dispatchEvent:event=>events.push(event.type)
  };
  const context={window,console,QATacticalPower:Power,QATrainingAccessRules:Access,
    ARTIFACT_EQUIP_SLOTS:[],getArtifactById:()=>null,realmOrderByName:()=>0,
    getMainUser:()=>({uid}),authenticatedMainFetch:async()=>({ok:true,json:async()=>({ok:true,state:serverState})}),
    queueMicrotask:()=>{},CustomEvent:class {constructor(type){this.type=type}}
  };
  const prepared=source.replace(/^import .*?;\s*$/gm,'').replace(/export function /g,'function ');
  vm.runInNewContext(prepared+'\nthis.testApi={getCurrentCombatPower,calculateCombatPower,setCurrentTacticalManualState,refreshCurrentTacticalManualState};',context);
  return {window,api:context.testApi,events,setUser:value=>{uid=value;},setServerState:value=>{serverState=value;}};
}
test('stamina branch ignores inactive golden core even if its legacy grade is highest',()=>{
  const h=harness(),p=h.api;
  const noManual=p.getCurrentCombatPower();
  assert.equal(noManual.total,620);
  assert.equal(noManual.complete,false);
  const legacy=p.calculateCombatPower({stats:{attack:200,maxHp:1100},core:{type:'sword',grade:1}});
  assert.equal(legacy.total,620);
  assert.equal(legacy.core,0);
});
test('successful manual loadout updates the same live combat rating and notifies UI',()=>{
  const h=harness();
  const state={books:{'sword-wind':{exp:1080}},equipped:['wind-slash'],skillLevels:{}};
  assert.equal(h.api.setCurrentTacticalManualState(state),true);
  assert(h.events.includes('xiuxian:tactical-power-updated'));
  const p=h.api.getCurrentCombatPower();
  assert.equal(p.complete,true);
  assert(p.total>620);
  assert.equal(p.total,p.base+p.skills);
  assert.equal(h.api.getCurrentCombatPower().total,p.total);
});
test('account switch prevents stale loaded manuals from contributing',()=>{
  const h=harness();
  assert(h.api.setCurrentTacticalManualState({books:{'sword-wind':{exp:0}},equipped:['wind-slash']}),true);
  const before=h.api.getCurrentCombatPower();
  assert(before.skills>0);
  h.setUser('u2');
  const after=h.api.getCurrentCombatPower();
  assert.equal(after.skills,0);
  assert.equal(after.complete,false);
  assert.equal(h.api.setCurrentTacticalManualState({books:{'sword-wind':{exp:0}},equipped:['wind-slash']},'u1'),false);
});
test('signed manual endpoint can populate the current profile',async()=>{
  const h=harness();
  h.setServerState({books:{'sword-wind':{exp:0}},equipped:['wind-slash']});
  await h.api.refreshCurrentTacticalManualState();
  assert(h.api.getCurrentCombatPower().skills>0);
});
