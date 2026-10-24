'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const World=require('../public/world/world-core.js');
const Aura=require('../public/world/world-aura.js');

test('holy landmarks receive restrained, distinct sacred effects',()=>{
  assert.equal(Aura.profile({kind:'sect'}).tone,'gold');
  assert.equal(Aura.profile({kind:'realm',name:'靈泉洞天'}).tone,'jade');
  assert.equal(Aura.profile({kind:'realm',name:'星隕石窟'}).tone,'violet');
  assert.ok(Aura.profile({kind:'building',id:'raid'}).beam>0);
  assert.equal(Aura.profile({kind:'monster',name:'靈狼'}),null);
  assert.equal(Aura.profile({kind:'structure',subtype:'camp'}),null);
});

test('spirit motes are deterministic for the same seed and change for another seed',()=>{
  const world=World.createWorld('aura-seed'),other=World.createWorld('other-aura-seed');
  const site={kind:'realm',x:345,y:276,name:'靈泉洞天'};
  const p=Aura.profile(site);
  const a=Aura.motes(world,site,p.motes);
  assert.deepEqual(a,Aura.motes(World.createWorld('aura-seed'),site,p.motes));
  assert.notDeepEqual(a,Aura.motes(other,site,p.motes));
  assert.equal(a.length,p.motes);
  assert.ok(a.every(m=>Math.abs(m.dx)<=1&&Math.abs(m.dy)<=1&&m.size<2));
});

test('visual atmosphere caches immutable bitmaps and does not animate the moving camera',()=>{
  const draws=[],gradient={addColorStop(){}};
  const context={
    globalAlpha:1,globalCompositeOperation:'source-over',save(){},restore(){},translate(){},scale(){},
    createRadialGradient(){return gradient;},createLinearGradient(){return gradient;},
    fillRect(){},drawImage(_bitmap,...location){draws.push(location);},
    beginPath(){},arc(){},stroke(){},fill(){},moveTo(){},lineTo(){},closePath(){}
  };
  const aura=Aura.create(World.createWorld('smoke'),()=>({width:0,height:0,getContext:()=>context}));
  const anchors=[{kind:'sect',x:500,y:500},{kind:'realm',x:502,y:501,name:'古陣秘境'}];
  const worldVersion=aura.world.VERSION;
  aura.drawGround(context,anchors,1000);
  aura.drawAir(context,anchors,1000,false);
  const baseline=draws.slice();
  assert.equal(baseline.length,4,'two static layers per landmark');
  assert.equal(aura.cachedGround,2);
  assert.equal(aura.cachedAir,2);
  assert.equal(context.globalCompositeOperation,'source-over');
  aura.drawGround(context,anchors,9000);
  aura.drawAir(context,anchors,9000,true);
  assert.deepEqual(draws.slice(4),baseline,'later timestamps produce exactly the same stable image positions');
  assert.equal(aura.cachedGround,2);
  assert.equal(aura.cachedAir,2);
  assert.equal(aura.world.VERSION,worldVersion);
});
