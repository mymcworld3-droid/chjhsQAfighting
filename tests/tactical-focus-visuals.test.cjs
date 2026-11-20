'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const R=require('../public/cultivation/tactical-rules.js');
const A=require('../public/cultivation/tactical-animation.js');
const Catalog=require('../public/cultivation/manual-rules.js');
const Effects=require('../public/cultivation/tactical-skill-effects.js');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const source=read('public/cultivation/tactical-renderer.js');
const ui=read('public/cultivation/tactical-combat.js');
const style=read('public/styles/tactical-focus-effects.css');
const trialNow=2000000000000;

test('trial focus keeps its own authoritative two-turn duration and half-cost body skills',()=>{
  const actor={turns:4,fistFocusUntil:5,stamina:10};
  assert.equal(R.focusTurns(actor),2);
  assert.equal(R.attackLimit(actor),3);
  const fist=Catalog.BY_SKILL['dragon-strike'];
  const sword=Catalog.BY_SKILL['wind-slash'];
  const focus=Catalog.BY_SKILL['dragon-roar'];
  assert.equal(R.techniqueCost(actor,fist),Math.ceil(fist.cost/2));
  assert.equal(R.techniqueCost(actor,sword),sword.cost);
  assert.equal(R.techniqueCost(actor,focus),focus.cost);
  actor.turns=5;assert.equal(R.focusTurns(actor),1);
  actor.turns=6;assert.equal(R.focusTurns(actor),0);
  assert.equal(R.attackLimit(actor),R.LIMITS.attacks);
  assert.equal(R.techniqueCost(actor,fist),fist.cost);
});

test('a successful trial focus cast publishes an authenticated golden activation scene',()=>{
  const state=R.create({id:'focus-trial-regression',mode:'pve',now:trialNow,
    simultaneous:false,players:[{uid:'hero',name:'修士',atk:100,maxHp:4000,
      trainingAccessScore:68,manualSkills:['dragon-roar','dragon-strike']} ]});
  state.blocks=[];
  const hero=state.actors.find(a=>a.uid==='hero');
  hero.x=3;hero.y=3;hero.stamina=10;
  const next=R.apply(state,'hero',{type:'manual',skillId:'dragon-roar',x:3,y:3},trialNow);
  const cast=next.events.find(e=>e.type==='cast'&&e.skill==='dragon-roar');
  assert.equal(cast?.animation?.focusActivated,true);
  assert.equal(cast?.animation?.focusEmpowered,undefined,
    'the focus preparation is not its own empowered attack');
  const scenes=A.plan(state,next,'hero');
  assert.ok(scenes.some(e=>e.kind==='cast'&&e.skill==='dragon-roar'&&e.focusActivated));
  const focused=next.actors.find(a=>a.uid==='hero');
  assert.ok(R.focusTurns(focused)>0);
  assert.ok(R.techniqueCost(focused,Catalog.BY_SKILL['dragon-strike'])<
    Catalog.BY_SKILL['dragon-strike'].cost);
});

test('focus visuals match all dungeon aura parts and respect reduced motion',()=>{
  for(const part of ['dm-focus-aura','dm-focus-glow','dm-focus-flames',
      'dm-focus-ring','dm-focus-orbit','dm-spark-a','dm-spark-b',
      'dm-spark-c','dm-spark-d','dm-spark-e','dm-spark-f','dm-focus-count']){
    assert.ok(source.includes(part)||style.includes(part),'missing '+part);
  }
  for(const animation of ['dmFocusBreath','dmFocusOrbit','dmFocusMote',
      'dmFocusGoldGlow','dmFocusFlameRise','tcFocusGoldSkill']){
    assert.ok(style.includes(animation),animation);
  }
  assert.match(style,/radial-gradient\(circle,\s*transparent 0 30%/);
  assert.match(style,/prefers-reduced-motion:reduce/);
  assert.match(style,/\.tc-focus-layer\{/);
  assert.match(style,/pointer-events:none/);
  assert.match(source,/if\(!present\.has\(uid\)\)\{/);
  assert.match(source,/R\.focusTurns\(authentic\)/);
  assert.match(source,/this\.updateFocusAuras\(g,positions,now\)/);
  assert.match(source,/this\.focusAuras\.clear\(\)/);
});

test('enhanced body-technique selectors, marker and persistent badge are wired to trial',()=>{
  assert.match(ui,/button\.classList\.toggle\('is-focus-empowered',empowered\)/);
  assert.match(ui,/ring\.classList\.toggle\('has-focus',focusTurns>0\)/);
  assert.match(ui,/detailThumb\.classList\.toggle\('is-focus-empowered',chosenEmpowered\)/);
  assert.match(ui,/focusBadge\.hidden=!active/);
  assert.match(ui,/金身蓄勢 '\+focusTurns\+'\/2 回合/);
  assert.match(ui,/tactical-focus-effects\.css\?v=/);
  assert.match(style,/\.tc-wheel-options>\.tc-sector\[data-wheel-choice\]\.is-focus-empowered\[aria-pressed\]/);
  assert.match(style,/background:linear-gradient\(115deg,#fff3c1/);
  assert.match(style,/\.tc-wheel-detail-marker\.is-focus-empowered/);
  assert.match(style,/\.tc-quarter-action\.has-focus/);
});

test('canvas fallback draws one golden ring and four sparks outside the avatar',()=>{
  const Renderer=new Function(source.replace(/^import .*$/gm,'')
    .replace(/^export /gm,'')+'\nreturn TacticalRenderer;')();
  const drawn=[],ctx=new Proxy({},{
    get(_obj,key){return (...args)=>{drawn.push([key,...args]);};},
    set(){return true;}
  });
  Renderer.prototype.drawFocusHalo.call({},ctx,100,200,40);
  assert.equal(drawn.filter(item=>item[0]==='arc').length,5);
  assert.equal(drawn.filter(item=>item[0]==='save').length,1);
  assert.equal(drawn.filter(item=>item[0]==='restore').length,1);
});

test('both battles share gold activation and empowered strike visual flags',()=>{
  const canvas=()=>new Proxy({calls:[]},{
    get(target,k){if(k==='calls')return target.calls;
      return (...args)=>target.calls.push([k,...args]);},
    set(){return true;}
  });
  const scene=(skill,focusActivated,focusEmpowered)=>({
    kind:'cast',skill,actor:'hero',
    style:skill==='dragon-roar'?'fist-focus':'fist-sweep',
    origin:{x:3,y:3},target:{x:4,y:3},cells:[{x:4,y:3}],
    before:[{uid:'hero',x:3,y:3}],focusActivated,focusEmpowered
  });
  const view={ox:0,oy:0,cell:48,width:10,height:10};
  for(const sceneData of [scene('dragon-roar',true,false),
    scene('dragon-strike',false,true)]){
    for(const above of [false,true]){
      const c=canvas();
      assert.equal(Effects.draw(c,sceneData,.52,view,above),true);
      assert.ok(c.calls.some(x=>x[0]==='arc'),
        'golden ring expected on '+(above?'upper':'under')+' layer');
    }
  }
});
