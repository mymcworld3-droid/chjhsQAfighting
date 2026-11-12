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

test('the first skill of all four manuals costs exactly two stamina',()=>{
  for(const book of Manuals.BOOKS){
    assert.equal(book.skills.length,3);
    assert.equal(book.skills[0].cost,2,book.name);
  }
});

test('left-circle second ring is the only skill picker; right circle only selects targets and actions',()=>{
  assert.match(ui,/energy\.append\(techniqueRing\)/);
  assert.match(ui,/const leftSkills=available\.length\?available:\[R\.basicFor\(myActor\(\)\)\]/);
  assert.match(ui,/button\.dataset\.leftAttack=available\.length\?'manual:'/);
  assert.match(ui,/const start=-90\+90\*index\/leftSkills\.length/);
  assert.match(ui,/makeChoice\('attack-ring','攻擊目標',-90,-180/);
  assert.match(ui,/selectWheel\(b\.dataset\.leftAttack\)/);
  assert.match(css,/\.tc-left-technique-ring\{display:contents\}/);
  assert.match(css,/\.tc-left-technique\[aria-pressed=true\]/);
  assert.match(css,/\.tc-energy-track\{/,'original outer energy bar stays visible');
  assert.match(css,/\.tc-quarter-energy>\[data-quiz\]/,'original quiz button stays clickable');
  assert.doesNotMatch(ui,/manualPickerOpen|manual-menu|data-manual-pick/);
  assert.doesNotMatch(ui,/data-action="skill"|金丹技能/);
  assert.doesNotMatch(ui,/makeChoice\('skill'/);
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
