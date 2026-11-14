'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../public/cultivation/tactical-rules.js');
const A=require('../public/cultivation/tactical-animation.js');
const Manuals=require('../public/cultivation/manual-rules.js');
const Effects=require('../public/cultivation/tactical-skill-effects.js');
const now=2000000000000;

function fixture(skill){
  const s=R.create({id:'arena-effects',mode:'pve',players:[{
    uid:'hero',name:'修士',atk:100,maxHp:10000,trainingAccessScore:68,manualSkills:[skill]
  }],now});
  s.width=12;s.height=9;s.blocks=[];
  Object.assign(s.actors[0],{x:4,y:4,stamina:10});
  Object.assign(s.actors[1],{x:7,y:4,hp:3000,maxHp:3000,intent:{kind:'wait',cells:[]}});
  s.actors.push(R.actor({uid:'spare',bot:true,team:'monster',maxHp:3000},{x:10,y:8}));
  return s;
}
function context(){
  const calls=[],stack=[];
  const target={calls};
  return new Proxy(target,{
    get(o,key){
      if(key in o)return o[key];
      if(key==='measureText')return text=>({width:String(text).length*8});
      return (...args)=>{
        assert(args.every(value=>typeof value!=='number'||Number.isFinite(value)),String(key));
        if(key==='save')stack.push(1);
        if(key==='restore')assert(stack.pop(),'canvas restore without save');
        calls.push([key,...args]);
      };
    },
    set(o,key,value){
      if(typeof value==='number')assert(Number.isFinite(value),String(key));
      o[key]=value;return true;
    }
  });
}
const aim={
  'wind-step':{x:6,y:4},'rock-quake':{x:6,y:4},'tiger-step':{x:6,y:4},
  'sky-cloud':{x:7,y:4},'sky-sever':{x:7,y:4},'dragon-roar':{x:4,y:4}
};

test('every manual slot resolves to an animated skill using the committed battle events',()=>{
  for(const book of Manuals.BOOKS)for(const skill of book.skills){
    const before=fixture(skill.id),target=aim[skill.id]||{x:5,y:4};
    const after=R.apply(before,'hero',{type:'manual',skillId:skill.id,...target},now);
    const scenes=A.plan(before,after,'hero');
    const cast=scenes.find(scene=>scene.kind==='cast'&&scene.skill===skill.id);
    assert.ok(cast,skill.id);
    assert.equal(Effects.moveFor(skill.id),skill.moveId);
    assert.deepEqual(cast.cells,R.skillCells(before,before.actors[0],skill,target),skill.id);
    const snapshot=JSON.stringify(cast),view={cell:48,ox:0,oy:0,width:12,height:9};
    const first=context(),later=context();
    for(const above of [false,true]){
      assert(Effects.draw(first,cast,.25,view,above),skill.id);
      assert(Effects.draw(later,cast,.65,view,above),skill.id);
    }
    assert.notDeepEqual(first.calls,later.calls,'animation phase '+skill.id);
    assert.equal(JSON.stringify(cast),snapshot,'read-only '+skill.id);
  }
  assert.equal(Effects.moveFor('unknown'),null);
  assert.equal(Effects.draw(context(),{skill:'unknown',kind:'cast'},.5,{cell:48,ox:0,oy:0,width:12,height:9},true),false);
});

test('flying sword animation follows the previous sword position and each chain cast marks its step',()=>{
  const s=fixture('flight-summon');
  const summoned=R.apply(s,'hero',{type:'manual',skillId:'flight-summon',x:5,y:4},now);
  const moved=R.apply(summoned,'hero',{type:'manual',skillId:'flight-summon',x:8,y:4},now);
  const scene=A.plan(summoned,moved,'hero').find(item=>item.kind==='cast');
  assert.deepEqual(scene.origin,{x:5,y:4});
  assert.deepEqual(scene.target,{x:8,y:4});
  const chain=fixture('dragon-guard');
  Object.assign(chain.actors[1],{x:5,y:4});
  const after=R.apply(chain,'hero',{type:'manual',skillId:'dragon-guard',x:5,y:4},now);
  const casts=A.plan(chain,after,'hero').filter(item=>item.kind==='cast'&&item.skill==='dragon-guard');
  assert.deepEqual(casts.map(item=>item.step),[1,2,3,4,5]);
  assert.deepEqual(casts.map(item=>item.origin.x),[4,5,6,7,8]);
});

test('dash and throw effects follow committed movement without changing endpoints',()=>{
  for(const [skill,monsterX,target] of [
    ['wind-step',7,{x:6,y:4}],['rock-quake',7,{x:6,y:4}],
    ['tiger-step',7,{x:6,y:4}],['tiger-throw',5,{x:5,y:4}],
    ['dragon-guard',5,{x:5,y:4}]
  ]){
    const before=fixture(skill);
    before.actors[1].x=monsterX;
    const after=R.apply(before,'hero',{type:'manual',skillId:skill,...target},now);
    const scenes=A.plan(before,after,'hero');
    const movements=scenes.filter(scene=>scene.kind==='move'&&scene.visualSkill===skill);
    assert(movements.length,skill);
    for(const scene of movements){
      const original=JSON.stringify(scene),c=context();
      assert(Effects.drawMotion(c,scene,.5,{cell:48,ox:0,oy:0,width:12,height:9}),skill);
      for(const motion of scene.moves){
        const actor=A.sample(scene,1).find(item=>item.uid===motion.uid);
        assert.equal(actor.x,motion.path.at(-1).x);
        assert.equal(actor.y,motion.path.at(-1).y);
      }
      assert.equal(JSON.stringify(scene),original);
    }
  }
});

test('the battlefield renderer uses manual effects for new and saved cast events',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/tactical-renderer.js'),'utf8')
    .replace(/^import .*;$/gm,'').replace('export class TacticalRenderer','class TacticalRenderer');
  const rendererClass=new Function('globalThis',source+'\nreturn TacticalRenderer;')({
    QATactical:R,QATacticalAnimation:A,QATacticalCamera:{},QATacticalSkillEffects:Effects
  });
  const before=fixture('wind-slash'),after=R.apply(before,'hero',{type:'manual',skillId:'wind-slash',x:5,y:4},now);
  const cast=A.plan(before,after,'hero').find(scene=>scene.kind==='cast');
  const c=context(),renderer=Object.create(rendererClass.prototype);
  Object.assign(renderer,{ctx:c,cell:48,ox:0,oy:0,state:after});
  for(const above of [false,true])renderer.drawEffect(cast,.5,above);
  assert(c.calls.some(call=>call[0]==='arc'));
  const unknown={...cast,skill:'old-custom',style:'line'};
  renderer.drawEffect(unknown,.5,true);
  assert(c.calls.some(call=>call[0]==='stroke'));
});

test('knockback and damage begin at the attack impact, including every step of the chain',()=>{
  for(const skill of ['wind-thousand','rock-break','dragon-guard']){
    const before=fixture(skill);before.actors[1].x=skill==='wind-thousand'?7:5;
    const after=R.apply(before,'hero',{type:'manual',skillId:skill,x:5,y:4},now);
    const snapshot=JSON.stringify([before,after]);
    const scenes=A.plan(before,after,'hero'),casts=scenes.filter(s=>s.skill===skill&&s.kind==='cast');
    assert.equal(casts.length,skill==='dragon-guard'?5:1,skill);
    for(const cast of casts){
      assert.equal(cast.parallelImpact,true,skill);
      const start=cast.before.find(a=>a.uid==='monster-0');
      const early=A.sample(cast,.3).find(a=>a.uid==='monster-0');
      const impact=A.sample(cast,.7).find(a=>a.uid==='monster-0');
      const end=A.sample(cast,1).find(a=>a.uid==='monster-0');
      assert.equal(early.x,start.x,skill);assert.equal(early.hp,start.hp,skill);
      assert(impact.x>start.x&&impact.hp<start.hp,skill);
      assert.equal(end.x,cast.after.find(a=>a.uid==='monster-0').x,skill);
      assert.equal(end.hp,cast.after.find(a=>a.uid==='monster-0').hp,skill);
      assert(cast.numbers.some(n=>n.uid==='monster-0'),skill);
    }
    assert(!scenes.some(s=>s.kind==='move'&&s.style==='push'),skill);
    assert.equal(JSON.stringify([before,after]),snapshot,skill);
  }
});

test('area knockback preserves collision order and never invents movement through a wall',()=>{
  const before=fixture('wind-thousand');before.actors[1].x=6;
  before.actors.push(R.actor({uid:'far',bot:true,team:'monster',maxHp:3000},{x:8,y:4}));
  const after=R.apply(before,'hero',{type:'manual',skillId:'wind-thousand',x:5,y:4},now);
  const cast=A.plan(before,after,'hero').find(s=>s.kind==='cast');
  assert.deepEqual(cast.moves.map(m=>m.uid),['far','monster-0']);
  for(const progress of [.5,.7,.95,1]){
    const actors=A.sample(cast,progress),near=actors.find(a=>a.uid==='monster-0'),far=actors.find(a=>a.uid==='far');
    assert(near.x<far.x,'targets must not pass through one another');
  }
  for(const move of cast.moves){
    const ending=after.actors.find(a=>a.uid===move.uid);
    assert.deepEqual(move.path.at(-1),{x:ending.x,y:ending.y});
  }
  const blocked=fixture('rock-break');blocked.actors[1].x=5;blocked.blocks=[{x:6,y:4}];
  const blockedAfter=R.apply(blocked,'hero',{type:'manual',skillId:'rock-break',x:5,y:4},now);
  assert.equal(blockedAfter.actors[1].x,5);
  assert(!A.plan(blocked,blockedAfter,'hero').some(s=>s.moves.some(m=>m.uid==='monster-0')));
});

test('reflected damage and a monster push retain their committed outcomes',()=>{
  const before=fixture('rock-break');before.actors[1].x=5;before.actors[1].counter=.5;
  const after=R.apply(before,'hero',{type:'manual',skillId:'rock-break',x:5,y:4},now);
  const cast=A.plan(before,after,'hero').find(s=>s.kind==='cast');
  assert(cast.parallelImpact);assert(cast.numbers.some(n=>n.uid==='hero'));
  assert.deepEqual(cast.reflections,[{actor:'monster-0',target:'hero'}]);
  assert.equal(A.sample(cast,1).find(a=>a.uid==='hero').hp,after.actors[0].hp);

  const fight=fixture('rock-fist');Object.assign(fight.actors[0],{x:5,y:4});
  Object.assign(fight.actors[1],{x:3,y:4,species:16,atk:100});
  fight.actors[2].intent={kind:'wait',cells:[]};R.prepareIntents(fight);
  const ended=R.apply(fight,'hero',{type:'end'},now);
  const monsterCast=A.plan(fight,ended,'hero').find(s=>s.kind==='cast'&&s.actor==='monster-0');
  assert(monsterCast.parallelImpact);assert(monsterCast.moves.some(m=>m.uid==='hero'));
  const endHero=A.sample(monsterCast,1).find(a=>a.uid==='hero');
  assert.equal(endHero.x,ended.actors[0].x);assert.equal(endHero.hp,ended.actors[0].hp);
});

test('damage numbers appear at impact on top of the manual animation',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/tactical-renderer.js'),'utf8')
    .replace(/^import .*;$/gm,'').replace('export class TacticalRenderer','class TacticalRenderer');
  const Renderer=new Function('globalThis',source+'\nreturn TacticalRenderer;')({
    QATactical:R,QATacticalAnimation:A,QATacticalCamera:{},QATacticalSkillEffects:Effects
  });
  const before=fixture('rock-break');before.actors[1].x=5;
  const after=R.apply(before,'hero',{type:'manual',skillId:'rock-break',x:5,y:4},now);
  const cast=A.plan(before,after,'hero').find(s=>s.kind==='cast');
  const early=context(),later=context(),renderer=Object.create(Renderer.prototype);
  Object.assign(renderer,{ctx:early,cell:48,ox:0,oy:0,state:after});renderer.drawEffect(cast,.3,true);
  renderer.ctx=later;renderer.drawEffect(cast,.7,false);renderer.drawEffect(cast,.7,true);
  assert(!early.calls.some(call=>call[0]==='fillText'));
  assert(later.calls.some(call=>call[0]==='fillText'&&String(call[1]).startsWith('−')));
});
