'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Visual=require('../public/cultivation/tactical-ambience.js');

const fake=(terrain=0,biome='竹影溪谷')=>({
  id:'arena-ambience',mode:'pve',terrain,trial:{seed:'stable',layoutHash:'f0e9a123',biome},
  width:9,height:7,ground:Array(63).fill(terrain),blocks:[{x:2,y:3,kind:'tree'}],
  actors:[{uid:'u1',bot:false,team:'player',x:1,y:1,hp:500,maxHp:500},
          {uid:'m1',species:0,bot:true,x:6,y:3,hp:400,maxHp:400}]
});
function mock(){
  let draws=0;
  const methods=['save','restore','translate','rotate','beginPath','moveTo','quadraticCurveTo',
    'lineTo','fill','stroke','ellipse','arc','rect','clip','fillRect'];
  const ctx={};
  for(const name of methods)ctx[name]=()=>{draws++};
  const gradient=()=>({addColorStop:()=>{draws++}});
  ctx.createLinearGradient=gradient;ctx.createRadialGradient=gradient;
  ctx.count=()=>draws;
  return ctx;
}

test('habitat identity derives from biome and supports legacy terrain codes',()=>{
  for(const [name,terrain,wanted] of [
    ['竹影溪谷',0,'bamboo'],['荒漠殘垣',13,'desert'],['雪嶺險徑',14,'snow'],
    ['碧水庭苑',2,'water'],['古陣遺墟',16,'ruins']
  ])assert.equal(Visual.themeFor(fake(terrain,name)),wanted);
  assert.equal(Visual.themeFor({terrain:14}), 'snow');
  assert.equal(Visual.themeFor({terrain:16}), 'ruins');
  assert.equal(Visual.themeFor({terrain:0}), 'bamboo');
});

test('decorations are deterministic per room seed and have no effect on actor or room data',()=>{
  const s=fake(),original=JSON.stringify(s),a=Visual.prepare(s),b=Visual.prepare(structuredClone(s));
  assert.deepEqual(a,b);
  assert.equal(JSON.stringify(s),original,'render plan does not mutate server state');
  assert.equal(a.id,s.id);
  assert.ok(a.details.length>0);
  assert.ok(a.motes.length>=7&&a.motes.length<=22);
  for(const d of a.details){
    assert.ok(d.x>=0&&d.x<s.width&&d.y>=0&&d.y<s.height);
    assert.notDeepEqual([d.x,d.y],[2,3],'props do not generate conflicting ground details');
  }
  const changed=Visual.prepare({...s,trial:{...s.trial,layoutHash:'another-layout'}});
  assert.notDeepEqual(a.details,changed.details);
  s.actors[1].hp=1;s.actors[0].x=7;
  assert.deepEqual(Visual.prepare(s),a,'combat actions do not reshuffle the decorations');
});

test('water surface ripples are purely visual even when a water block is impassable',()=>{
  const s=fake(2,'碧水庭苑');
  s.blocks=[{x:2,y:3,kind:'water'}];s.ground[3*s.width+2]=4;
  const plan=Visual.prepare(s);
  assert.ok(plan.details.some(d=>d.x===2&&d.y===3&&d.kind==='ripple'));
  assert.deepEqual(s.blocks,[{x:2,y:3,kind:'water'}]);
});

test('idle poses stay inside a small visual offset and stop exactly in reduced motion',()=>{
  const base=[{uid:'hero',bot:false,hp:500},{uid:'wolf',species:0,bot:true,hp:400},
    {uid:'snake',species:3,bot:true,hp:400},{uid:'eagle',species:12,bot:true,hp:400},
    {uid:'boss',species:8,bot:true,boss:true,hp:400}];
  for(const actor of base){
    const a=Visual.idlePose(actor,0),b=Visual.idlePose(actor,1400);
    for(const pose of [a,b]){
      assert.ok(Math.abs(pose.dx)<=.045&&Math.abs(pose.dy)<=.045,actor.uid);
      assert.ok(pose.sx>=.95&&pose.sx<=1.05,actor.uid);
      assert.ok(pose.sy>=.95&&pose.sy<=1.05,actor.uid);
    }
    assert.notDeepEqual(a,b,actor.uid+' should animate without moving its hitbox');
    assert.deepEqual(Visual.idlePose(actor,1400,true),{dx:0,dy:0,sx:1,sy:1});
  }
  assert.deepEqual(Visual.idlePose({bot:true,hp:0},3000),{dx:0,dy:0,sx:1,sy:1});
});

test('static accents cache to one bitmap and reduced motion removes dynamic drawing',()=>{
  const plan=Visual.prepare(fake(16,'古陣遺墟'));
  const ctx=mock();
  Visual.drawDetails(ctx,plan,{ox:10,oy:20,cell:44});
  assert.ok(ctx.count()>0);
  const bitmap=Visual.rasterize(plan,()=>({width:0,height:0,getContext:()=>mock()}));
  assert.equal(bitmap.width,plan.width*64);
  assert.equal(bitmap.height,plan.height*64);
  assert.equal(Visual.rasterize(plan,null),null);
  const before=ctx.count();
  Visual.drawAtmosphere(ctx,plan,{ox:0,oy:0,cell:40},5000,true);
  assert.equal(ctx.count(),before,'reduced motion draws no animated particles or light');
  Visual.drawAtmosphere(ctx,plan,{ox:0,oy:0,cell:40},5000,false,'normal');
  assert.ok(ctx.count()>before);
  const another=ctx.count();
  Visual.drawAtmosphere(ctx,plan,{ox:0,oy:0,cell:40},9000,false,'low');
  assert.ok(ctx.count()>another,'low quality retains a small amount of ambience');
});

test('cached map identity changes with geometry, terrain and stage, not HP or turn changes',()=>{
  const old=fake(),initial=Visual.stageIdentity(old),key=Visual.mapIdentity(old);
  const combat=structuredClone(old);
  combat.actors[0].hp=23;combat.actors[1].x=4;combat.revision=49;combat.turn=11;
  assert.equal(Visual.stageIdentity(combat),initial,'live combat must not reset the camera');
  assert.equal(Visual.mapIdentity(combat),key,'live combat must not rerasterize the ground');
  const stage={...old,trial:{...old.trial,stage:2,layoutHash:'different'}};
  assert.notEqual(Visual.stageIdentity(stage),initial,'the same room can advance to a new stage');
  assert.notEqual(Visual.mapIdentity(stage),key);
  const blocks={...old,blocks:[{x:3,y:2,kind:'tree'}]};
  assert.equal(Visual.stageIdentity(blocks),initial);
  assert.notEqual(Visual.mapIdentity(blocks),key,'same-count moving obstacles invalidate scenery');
  const water={...old,ground:old.ground.slice()};
  water.ground[0]=4;
  assert.notEqual(Visual.mapIdentity(water),key,'a water tile must invalidate the raster cache');
  const biome={...old,trial:{...old.trial,biome:'雪嶺險徑'},terrain:14};
  assert.notEqual(Visual.mapIdentity(biome),key);
  assert.equal(Visual.prepare(old).key,key);
  assert.equal(Visual.prepare(blocks).key,Visual.mapIdentity(blocks));
});

test('canvas backing pixel ratio stays within mobile/desktop memory budgets',()=>{
  for(const [w,h,memory,budget] of [
    [360,640,2,2200000],[360,640,8,3300000],
    [1280,720,2,2200000],[1280,720,8,3300000],
    [2048,1536,2,2200000],[2048,1536,8,3300000]
  ]){
    const ratio=Visual.pixelRatioFor(w,h,3,memory);
    assert.ok(ratio>=1&&ratio<=3,'valid display ratio');
    assert.ok(w*h*ratio*ratio<=Math.max(budget,w*h)+.01,
      'backing store must not exceed the capped pixel budget');
  }
  assert.equal(Visual.pixelRatioFor(360,640,3,8),3,
    'standard portrait mobile keeps sharp native resolution');
  assert.equal(Visual.pixelRatioFor(1280,720,1,8),1,
    'a 1× device is never upscaled unnecessarily');
  assert.ok(Visual.pixelRatioFor(1280,720,3,2)<
            Visual.pixelRatioFor(1280,720,3,8),
    'low-memory hardware uses a smaller backing buffer');
});
