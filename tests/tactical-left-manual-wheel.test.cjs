'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Manuals=require('../public/cultivation/manual-rules.js');
const R=require('../public/cultivation/tactical-rules.js');
const API=require('../tactical-combat-api.cjs').__test;
const {database}=require('./helpers/tactical-db.cjs');
const folder=path.join(__dirname,'..','public');
const ui=fs.readFileSync(path.join(folder,'cultivation/tactical-combat.js'),'utf8');
const css=fs.readFileSync(path.join(folder,'styles/tactical-quarter-controls.css'),'utf8');
const makeActor=(manualSkills=[],score=1)=>({uid:'u1',name:'修士',atk:200,maxHp:1000,stamina:10,
  manualSkills,trainingAccessScore:score});

test('the first skill of all six manuals costs exactly two stamina',()=>{
  for(const book of Manuals.BOOKS){
    assert.equal(book.skills.length,3);
    assert.equal(book.skills[0].cost,2,book.name);
  }
});

test('the right outer ring offers only the attacks available in attack mode',()=>{
  const equip=ui.slice(ui.indexOf('const equippedTechniques='),ui.indexOf('function syncEquippedAttack'));
  const options=ui.slice(ui.indexOf('function wheelDetailOptions'),ui.indexOf('function updateWheelChoices'));
  const {wheelDetailOptions,detailAngle,detailIndex}=new Function('R',equip+options+
    'return {wheelDetailOptions,detailAngle,detailIndex};')(R);
  const hero=makeActor(['wind-slash','wind-step','wind-thousand'],28);
  const values=opts=>opts.map(option=>option.value);
  assert.deepEqual(values(wheelDetailOptions(hero,true)),['player']);
  assert.deepEqual(values(wheelDetailOptions(hero,false)),['manual:wind-slash','manual:wind-step','manual:wind-thousand']);
  assert.deepEqual(values(wheelDetailOptions(makeActor(),false)),['attack']);
  assert.deepEqual(values(wheelDetailOptions(makeActor(['wind-step'],1),false)),['attack']);
  for(const count of [1,2,3])for(let index=0;index<count;index++){
    assert.equal(detailIndex(detailAngle(index,count),count),index);
  }
  assert.equal(detailIndex(-180,3),2);
  assert.match(ui,/actions\.append\(tabs,choices,end/);
  assert.doesNotMatch(ui,/leftAttack|tc-left-technique|攻擊目標；使用左側/);
  assert.doesNotMatch(css,/tc-left-technique/);
  assert.match(css,/\.tc-energy-ring\{/);
  assert.match(css,/\.tc-quarter-energy>\[data-quiz\]/);
});

test('attack choice is automatically replaced by equipped techniques and keeps the chosen slot on move',()=>{
  const start=ui.indexOf('const equippedTechniques='),end=ui.indexOf('const myAction=',start);
  assert(start>=0&&end>start);
  const factory=new Function('R',`
    let attackChoice='attack',selectedManualSkill='',action='move',selection=null;
    const myActor=()=>null;
    ${ui.slice(start,end)}
    return {
      sync:syncEquippedAttack,
      changeAction:value=>{action=value;},
      setManual:value=>{selectedManualSkill=value;},
      state:()=>({attackChoice,action,selectedManualSkill})
    };
  `);
  const chooser=factory(R);
  chooser.sync(makeActor([]));
  assert.equal(chooser.state().attackChoice,'attack');
  chooser.sync(makeActor(['wind-slash','wind-step'],6));
  assert.equal(chooser.state().attackChoice,'manual:wind-slash');
  assert.equal(chooser.state().action,'move');
  chooser.changeAction('attack');
  chooser.sync(makeActor(['wind-slash','wind-step'],6));
  assert.equal(chooser.state().action,'manual');
  chooser.setManual('wind-step');
  chooser.changeAction('move');
  chooser.sync(makeActor(['wind-slash','wind-step'],6));
  assert.equal(chooser.state().attackChoice,'manual:wind-step');
  chooser.sync(makeActor([]));
  assert.equal(chooser.state().attackChoice,'attack');
  assert.equal(chooser.state().action,'move');
});

test('server permits basic attack only with no equipped manual, blocks golden-core abilities',()=>{
  const fixed=2000000000000;
  const s=R.create({id:'arena-0123456789abcdef',mode:'pve',players:[makeActor()],now:fixed});
  s.blocks=[];s.actors[0].stamina=10;
  s.actors[1].x=2;s.actors[1].y=3;
  const basic=R.apply(s,'u1',{type:'attack',x:2,y:3},fixed);
  assert.equal(basic.actors[0].stamina,8);
  assert.throws(()=>R.apply(s,'u1',{type:'skill',x:2,y:3},fixed),/金丹技能已停用/);

  const equipped=R.create({id:'arena-0123456789abcdef',mode:'pve',
    players:[makeActor(['wind-slash'],1)],now:fixed});
  equipped.blocks=[];equipped.actors[0].stamina=10;
  equipped.actors[1].x=2;equipped.actors[1].y=3;
  assert.throws(()=>R.apply(equipped,'u1',{type:'attack',x:2,y:3},fixed),/普通攻擊已被替換/);
  assert.throws(()=>R.apply(equipped,'u1',{type:'skill',x:2,y:3},fixed),/金丹技能已停用/);
  const manual=R.apply(equipped,'u1',{type:'manual',skillId:'wind-slash',x:2,y:3},fixed);
  assert.equal(manual.actors[0].stamina,8);
});

test('forged legacy golden-core commands are refused by battle API',async()=>{
  const db=database(),fixed=2000000000000;
  const s=await API.start(db,'u1',{mode:'pve'},fixed);
  await assert.rejects(API.command(db,'u1',{
    roomId:s.id,revision:s.revision,requestId:'legacy-core-command-01',
    type:'skill',x:2,y:3
  },fixed),/金丹技能已停用/);
});

test('resuming an unfinished trial preserves its original skills and board',async()=>{
  const db=database(),now=2000000000000;
  await API.chooseSchool(db,'u1',{school:'sword'});
  const first=await API.start(db,'u1',{mode:'pve'},now);
  const raw=db.records.get(API.ROOMS+'/'+first.id);
  Object.assign(raw.actors[0],{x:2,y:2,stamina:6});
  await assert.rejects(API.equipManualSkills(db,'u1',{skillIds:[]}),/戰鬥進行中/);
  const resumed=await API.start(db,'u1',{mode:'pve'},now+1);
  const actor=resumed.actors.find(a=>a.uid==='u1');
  assert.equal(resumed.id,first.id);
  assert.deepEqual(actor.manualSkills,['wind-slash']);
  assert.deepEqual([actor.x,actor.y,actor.stamina],[2,2,6]);
});

test('browser rules imported before the manual catalog still resolve the equipped attack',()=>{
  const vm=require('node:vm');
  const rulesSource=fs.readFileSync(path.join(folder,'cultivation/tactical-rules.js'),'utf8');
  const manualSource=fs.readFileSync(path.join(folder,'cultivation/manual-rules.js'),'utf8');
  const browser=vm.createContext({});
  vm.runInContext(rulesSource,browser);
  vm.runInContext(manualSource,browser);
  const hero=makeActor(['wind-slash'],6);
  assert.equal(browser.QATactical.manualSkillFor(hero,'wind-slash')?.id,'wind-slash');

  const start=ui.indexOf('const equippedTechniques='),end=ui.indexOf('const myAction=',start);
  const pick=ui.slice(ui.indexOf('function selectWheel('),ui.indexOf('function buildGame('));
  const factory=new Function('R','hero',`
    let attackChoice='attack',selectedManualSkill='',action='move',selection=null;
    const myActor=()=>hero,myAction=()=>true,updateControls=()=>{};
    const state={},busy=false,renderer=null,uid='u1';
    ${ui.slice(start,end)}
    ${pick}
    selectWheel('attack-ring');
    return {action,selectedManualSkill};
  `);
  assert.deepEqual(factory(browser.QATactical,hero),{action:'manual',selectedManualSkill:'wind-slash'});
});
