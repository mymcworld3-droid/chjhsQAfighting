'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../public/cultivation/tactical-rules.js');
const A=require('../public/cultivation/tactical-animation.js');
const now=2000000000000;
function battle(core='thunder',branch='lightning'){
  const s=R.create({id:'arena-animation',players:[{uid:'u1',name:'修士',atk:200,maxHp:2000,core,branch}],now});
  s.blocks=[];Object.assign(s.actors[0],{x:1,y:3,stamina:10,hp:1000});Object.assign(s.actors[1],{x:3,y:3,maxHp:2000,hp:2000});return s;
}
const timeline=(s,next)=>A.plan(s,next,'u1');
const apply=(s,type,p={})=>R.apply(s,'u1',{type,...p},now);
function endpoint(scene,uid,position){const sampled=A.sample(scene,1).find(a=>a.uid===uid);assert.ok(Math.abs(sampled.x-position.x)<1e-9);assert.ok(Math.abs(sampled.y-position.y)<1e-9);}

test('animation plans do not mutate snapshots and never replay initial, duplicate or stale states',()=>{
  const s=battle(),next=apply(s,'move',{x:2,y:3}),before=JSON.stringify([s,next]);
  const scenes=timeline(s,next);assert.equal(scenes.length,1);assert.equal(scenes[0].kind,'move');
  const middle=A.sample(scenes[0],.5).find(a=>a.uid==='u1');assert.ok(middle.x>1&&middle.x<2);endpoint(scenes[0],'u1',{x:2,y:3});
  assert.equal(JSON.stringify([s,next]),before);
  assert.deepEqual(A.plan(null,next,'u1'),[]);assert.deepEqual(timeline(next,next),[]);assert.deepEqual(timeline(next,s),[]);
  assert.deepEqual(timeline(s,{...next,id:'another-room'}),[]);assert.deepEqual(timeline(s,{...next,width:9}),[]);
  assert.deepEqual(timeline(next,{...next,newEnemies:[8]}),[],'revision-neutral introduction acknowledgements produce no combat replay');
});

test('all nineteen equipped skills produce a cast with their real footprint and correct recovery or displacement',()=>{
  let count=0;
  for(const [core,c]of Object.entries(R.CORES))for(const branch of c.branches){
    const s=battle(core,branch.id),a=s.actors[0],sk=branch.skill;
    const p=sk.range===0?{x:a.x,y:a.y}:sk.kind==='blink'?{x:2,y:3}:{x:3,y:3};
    const next=apply(s,'skill',p),scenes=timeline(s,next),cast=scenes.find(s=>s.kind==='cast');
    assert.ok(cast,sk.id);assert.equal(cast.style,sk.kind);assert.equal(cast.skill,sk.id);
    assert.deepEqual(cast.cells,R.skillCells(s,a,sk,p));
    if(sk.kind==='restore')assert.ok(scenes.some(s=>s.kind==='restore'),sk.id);
    if(['blink','swap','lunge'].includes(sk.kind)){
      const move=scenes.find(s=>s.kind==='move');assert.ok(move,sk.id);endpoint(move,'u1',next.actors[0]);
      if(sk.kind==='swap'){assert.equal(move.moves.length,2);endpoint(move,'monster-0',next.actors[1]);}
      if(sk.kind==='lunge')assert.ok(scenes.indexOf(move)<scenes.indexOf(cast),'dash arrives before its sword strike');
    }
    count++;
  }
  assert.equal(count,19);
});

test('two-cell attacks animate their whole ray even when empty and group simultaneous area damage',()=>{
  const s=battle();Object.assign(s.actors[1],{x:2,y:3});
  s.actors.push(R.actor({uid:'m2',name:'妖獸二',bot:true,team:'monster',maxHp:2000},{x:3,y:3}));
  const next=apply(s,'attack',{x:2,y:3}),scenes=timeline(s,next);
  assert.deepEqual(scenes.map(s=>s.kind),['cast','damage']);assert.equal(scenes[1].numbers.length,2);
  assert.deepEqual(scenes[0].cells,[{x:2,y:3},{x:3,y:3}]);
  const empty=timeline(s,apply(s,'attack',{x:1,y:2}));assert.deepEqual(empty.map(s=>s.kind),['cast']);
});

test('twenty monster types have visible attacks, dodges and movement styles in committed order',()=>{
  for(const profile of R.MONSTERS){
    let s=battle();s.width=11;s.height=11;Object.assign(s.actors[0],{x:5,y:5,hp:2000});
    const m=s.actors[1];m.species=profile.species;
    const spot=Array.from({length:121},(_,i)=>({x:i%11,y:Math.floor(i/11)})).find(p=>R.key(p)!==R.key(s.actors[0])&&R.monsterCells(s,{...m,...p},s.actors[0]).some(c=>R.key(c)===R.key(s.actors[0])));
    assert.ok(spot,profile.name);Object.assign(m,spot);R.prepareIntents(s);
    // Some ranged profiles reposition when too close, so select a legal warning.
    if(m.intent.kind!=='attack'){
      const alternative=Array.from({length:121},(_,i)=>({x:i%11,y:Math.floor(i/11)})).find(p=>R.dist(p,s.actors[0])>=(profile.move.minDistance||0)&&R.monsterCells(s,{...m,...p},s.actors[0]).some(c=>R.key(c)===R.key(s.actors[0])));
      Object.assign(m,alternative);R.prepareIntents(s);
    }
    const next=apply(s,'end'),scenes=timeline(s,next),attack=scenes.find(v=>v.kind==='cast'&&v.actor===m.uid);
    assert.ok(attack,profile.name);assert.deepEqual(attack.cells,m.intent.cells);
    assert.ok(scenes.some(v=>v.kind==='damage'),profile.name);
    for(const scene of scenes)for(const a of A.sample(scene,.5))assert.ok(Number.isFinite(a.x)&&Number.isFinite(a.y),profile.name);
    Object.assign(m,{x:0,y:0,intent:{kind:'advance',cells:[]}});Object.assign(s.actors[0],{x:9,y:9});
    const advance=timeline(s,apply(s,'end')).find(v=>v.kind==='move'&&v.actor===m.uid);
    if(profile.move.steps){assert.ok(advance,profile.name);assert.equal(advance.style,profile.move.kind);}
    else assert.ok(timeline(s,apply(s,'end')).some(v=>v.kind==='guard'&&v.actor===m.uid));
  }
});

test('pushes, swaps, recovery and reflected hits retain exact independent animation outcomes',()=>{
  const s=battle('ocean','surge');Object.assign(s.actors[1],{x:2,y:3});
  const pushed=apply(s,'skill',{x:2,y:3}),push=timeline(s,pushed).find(s=>s.kind==='move');assert.equal(push.style,'push');endpoint(push,'monster-0',pushed.actors[1]);
  const drain=battle('taichu','drain'),healed=apply(drain,'skill',{x:3,y:3}),heal=timeline(drain,healed).find(s=>s.kind==='restore');
  assert.equal(heal.numbers[0].heal,176);assert.equal(heal.after[0].hp,1176);
  const counter=battle('thunder','counter');Object.assign(counter.actors[1],{x:2,y:3});R.prepareIntents(counter);
  const guarded=apply(counter,'skill',{x:1,y:3}),end=apply(guarded,'end'),hits=timeline(guarded,end).filter(s=>s.kind==='damage');
  assert.equal(hits.length,2);assert.equal(hits[1].style,'counter');assert.notEqual(hits[0].actor,hits[1].actor);
});

test('meteor marking and delayed impact are separate, and defeat is visible before the result scene',()=>{
  const s=battle('xingchen','meteor'),mark=apply(s,'skill',{x:3,y:3});
  assert.deepEqual(timeline(s,mark).map(s=>s.kind),['cast']);assert.equal(mark.actors[1].hp,s.actors[1].hp);
  mark.actors[1].intent={kind:'wait',cells:[]};mark.actors[1].hp=1;
  const next=apply(mark,'end'),scenes=timeline(mark,next),impact=scenes.findIndex(s=>s.kind==='impact'),damage=scenes.findIndex(s=>s.kind==='damage');
  assert.ok(impact>=0&&impact<damage);assert.equal(scenes.at(-1).kind,'finish');assert.equal(scenes.at(-1).style,'victory');
  const dying=A.sample(scenes[damage],.8).find(a=>a.uid==='monster-0');assert.ok(dying.opacity<.5&&dying.opacity>0);
  assert.equal(A.sample(scenes[damage],1).find(a=>a.uid==='monster-0').opacity,0);
});

test('answers, guarding, end-turn, waiting and leaving all have bounded presentation beats',()=>{
  const s=battle();s.actors[0].stamina=2;
  const answered=R.answer(s,'u1',true,now),answer=timeline(s,answered)[0];assert.equal(answer.kind,'answer');assert.equal(answer.numbers[0].gain,4);
  const guard=apply(answered,'guard');assert.equal(timeline(answered,guard)[0].kind,'guard');
  const scenes=timeline(guard,apply(guard,'end'));assert.equal(scenes[0].kind,'turn');assert.equal(scenes.at(-1).kind,'turn');
  const left=timeline(s,R.forfeit(s,'u1',now));assert.deepEqual(left.map(s=>s.kind),['withdraw','finish']);
  for(const group of [scenes,left])assert.ok(group.reduce((sum,s)=>sum+s.duration,0)<=4200.001);
});

test('long battles keep event IDs unique and replay the latest multi-monster turn only once',()=>{
  let s=battle();s.actors[0].hp=2000;s.actors[1].intent={kind:'wait',cells:[]};
  for(let i=0;i<18;i++)s=apply(s,'end');
  const next=apply(s,'end');assert.equal(next.events.length,28);assert.equal(new Set(next.events.map(e=>e.id)).size,28);
  const scenes=timeline(s,next);assert.ok(scenes.length>=3);assert.ok(scenes.length<=5);assert.deepEqual(timeline(next,structuredClone(next)),[]);
  const legacy=structuredClone(s);legacy.events=[{id:'old:0',type:'move',actor:'u1',path:[{x:1,y:3},{x:2,y:3}],text:'舊版移動'}];legacy.revision=s.revision+1;
  assert.equal(timeline(s,legacy)[0].kind,'move','pre-animation move logs remain usable');
});
