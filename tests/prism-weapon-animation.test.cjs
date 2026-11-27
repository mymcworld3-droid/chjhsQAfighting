'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../public/cultivation/prism-weapon-rules.js'),D=require('../public/cultivation/new-weapon-drafts.js'),W=require('../public/cultivation/weapon-effects.js'),A=require('../public/cultivation/tactical-animation.js'),R=require('../public/cultivation/tactical-rules.js'),C=require('../public/cultivation/dungeon-skill-resolution.js');
const p=(x,y)=>({x,y}),board={width:9,height:9,blocked:q=>q.x===7&&q.y===4};
test('prism timeline has a parallel causal tree and bounded duration for every direction',()=>{
  for(const id of ['prism-slash','prism-reflect','prism-scatter']){
    const sk=D.skillAtLevel(id,1,0);
    for(const plan of Object.values(P.plans(board,p(2,4),sk).byDirection)){
      const timeline=P.timeline(plan,sk,[]);assert.ok(W.normalize(timeline));
      assert.equal(timeline.durationMs,{'prism-slash':260,'prism-reflect':440,'prism-scatter':600}[id]);
      assert.equal(timeline.segments.length,plan.rays.length);
      for(const ray of plan.rays){
        const s=timeline.segments[ray.id];
        assert.deepEqual(s.rays[0].cells,[ray.origin,...ray.cells]);
        if(ray.parent!==null)assert.ok(s.start>=timeline.segments[ray.parent].impact);
        assert.ok(timeline.segments.filter((_,i)=>plan.rays[i].depth===ray.depth).every(q=>q.start===s.start&&q.impact===s.impact));
      }
    }
  }
});
test('real private trial simulation emits exactly committed hits, including shield and counter, without mutating state',()=>{
  const s=R.create({id:'prism-vfx',mode:'pve',players:[{uid:'u',name:'u',atk:100,maxHp:10000,manualSkills:[]}],now:2000000000000});
  s.width=9;s.height=9;s.blocks=[p(7,4)];
  Object.assign(s.actors[0],{x:2,y:4,atk:100,stamina:10});
  Object.assign(s.actors[1],{x:4,y:4,hp:1000,maxHp:1000,shield:30,guard:0,counter:.1,atk:100});
  const before=JSON.stringify(s),out=R.previewCast(s,s.actors[0],D.skillAtLevel('prism-reflect',1,0),p(3,4));
  const timeline=W.normalize(out.weaponTimeline);assert.ok(timeline);
  const hits=timeline.segments.flatMap(q=>q.hits);
  assert.deepEqual(hits.filter(h=>h.uid!== 'u').map(h=>[h.damage,h.absorbed]),[[130,30],[100,0]]);
  assert.equal(hits.find(h=>h.uid==='u').damage,10);
  assert.equal(JSON.stringify(s),before);
  const previous={...s,events:[],revision:1},changes=[{uid:'u',hp:s.actors[0].hp-10},{uid:s.actors[1].uid,hp:770,shield:0}];
  const next={...previous,revision:2,events:[{id:'1:1',actor:'u',type:'cast',skill:'prism-reflect',animation:{kind:'cast',style:'prism-reflect',weaponGroup:'g',weaponTimeline:timeline,changes}},{id:'1:2',actor:'u',type:'damage',animation:{kind:'damage',weaponGroup:'g',numbers:[]}}]};
  const scenes=A.plan(previous,next,'u');assert.equal(scenes.length,1);assert.equal(scenes[0].duration,440);
  assert.equal(A.sample(scenes[0],1)[1].hp,770);
});
test('realtime resolver publishes version 2 and exact per-ray damage with no cap-created hits',()=>{
  const map={width:9,height:9,tiles:Array(81).fill(1)};map.tiles[4*9+7]=0;
  const room={status:'assembled',battleAppliedTick:0,members:{u:{uid:'u',position:p(2,4),battleHealth:1000,explorationStamina:10}},enemies:[{id:'e',kind:'wolf',position:p(4,4),battleHealth:1000,battleMaxHealth:1000}]};
  for(const id of ['prism-reflect','prism-scatter']){
    const out=C.resolveCast(room,'u',map,D.skillAtLevel(id,1,0),{target:p(3,4),seq:1,base:100});
    assert.equal(out.result.visualVersion,2);
    const timeline=W.normalize(out.result.weaponTimeline);assert.ok(timeline);
    assert.equal(timeline.segments.flatMap(s=>s.hits).reduce((n,h)=>n+h.damage,0),out.result.totalDamage);
    assert.equal(W.numberFrames(timeline,0).length,0);
    assert.ok(timeline.segments.flatMap(s=>s.hits).every(h=>h.damage>0));
  }
});

test('maximum prism scatter renders the committed ray tree in both layers and reduced effects',()=>{
  const blocks=[p(3,1),p(12,3),p(4,4),p(7,4),p(13,4),p(3,6),p(11,7),p(6,8),p(7,10),p(6,11),p(13,11)];
  const board={width:15,height:15,blocked:q=>blocks.some(b=>b.x===q.x&&b.y===q.y)},sk=D.skillAtLevel('prism-scatter',1,0);
  const plan=P.build(board,p(7,7),sk,p(1,0));
  assert.equal(plan.rays.length,21);
  const enemy={uid:'e',x:9,y:7},hits=P.hitIntents(plan,sk,[enemy]).map(h=>({...h,damage:Math.round(h.power*100)}));
  const timeline=W.normalize(P.timeline(plan,sk,hits));assert.ok(timeline);
  const before=JSON.stringify(timeline),view={ox:0,oy:0,cell:36,width:15,height:15};
  for(const reduced of [false,true])for(const above of [false,true]){
    let depth=0,draws=0;
    const ctx=new Proxy({},{
      get(o,k){if(k in o)return o[k];return (...args)=>{
        if(k==='save')depth++;if(k==='restore')depth--;
        for(const value of args)if(typeof value==='number')assert.ok(Number.isFinite(value));
        if(k==='stroke'||k==='fill'||k==='fillText')draws++;
      };},
      set(o,k,value){if(typeof value==='number')assert.ok(Number.isFinite(value));o[k]=value;return true;}
    });
    for(let ms=0;ms<=600;ms+=10){
      assert.equal(W.draw(ctx,timeline,ms/600,view,above,{reduced}),true);
      if(above)W.drawNumbers(ctx,timeline,ms/600,view,[enemy]);
      assert.equal(depth,0);
    }
    assert.ok(draws>0);
  }
  assert.equal(JSON.stringify(timeline),before);
  assert.equal(W.active(timeline,174/600).filter(s=>s.tone==='jade').length,0);
  assert.equal(W.active(timeline,175/600).filter(s=>s.tone==='jade').length,4);
  assert.equal(W.active(timeline,319/600).filter(s=>s.tone==='violet').length,0);
  assert.equal(W.active(timeline,320/600).filter(s=>s.tone==='violet').length,16);
});
