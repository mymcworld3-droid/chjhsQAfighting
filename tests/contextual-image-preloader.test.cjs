'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const policy=require('../public/cultivation/contextual-asset-preloader.js');

test('no images are requested merely by importing the asset policy',()=>{
  assert.equal(typeof policy.warmImages,'function');
  assert.deepEqual(policy.trialImages(null,'u1'),[]);
  assert.deepEqual(policy.dungeonImages({status:'waiting',members:{u1:{}}},'u1'),[]);
});

test('solo battle warms only actual map, visible actor, current objective and equipped weapons',()=>{
  const base={status:'active',actors:[
    {uid:'u1',gender:'female',manualWeaponIds:['sword-wind','body-rock',null]},
    {uid:'wild',bot:true,gender:'male'}]};
  const assets=policy.trialImages({...base,objective:{type:'sealing'}},'u1');
  assert(assets.includes(policy.WORLD.ground));
  assert(assets.includes(policy.WORLD.props));
  assert(assets.includes(policy.WORLD.monsters));
  assert(assets.includes(policy.WORLD.female));
  assert(assets.includes(policy.WORLD.seals));
  assert(assets.includes('/assets/weapons/sword-wind-hd.webp'));
  assert(assets.includes('/assets/weapons/body-rock-hd.webp'));
  for(const unused of [policy.WORLD.male,policy.WORLD.guardian,
    '/assets/weapons/sword-sky-hd.webp','/assets/skills/wind-slash.png'])
    assert.equal(assets.includes(unused),false,unused+' should not preload');
  const defense=policy.trialImages({...base,objective:{type:'defense'}},'u1');
  assert(defense.includes(policy.WORLD.guardian));
  assert(!defense.includes(policy.WORLD.seals));
  assert.deepEqual(policy.trialImages({...base,status:'waiting'},'u1'),[]);
});

test('co-op waits for an assembled room and warms only present players, not every gender',()=>{
  const base={status:'waiting',members:{
    u1:{gender:'male',dungeonWeaponIds:['sword-sky',null,'body-tiger']},
    u2:{gender:'male',dungeonWeaponIds:[]}}};
  assert.deepEqual(policy.dungeonImages(base,'u1'),[]);
  const assets=policy.dungeonImages({...base,status:'assembled'},'u1');
  assert(assets.includes(policy.WORLD.male));
  assert(!assets.includes(policy.WORLD.female));
  assert(!assets.includes(policy.WORLD.seals));
  assert(!assets.includes(policy.WORLD.guardian));
  assert(!assets.includes(policy.WORLD.props));
  assert(assets.includes('/assets/weapons/sword-sky-hd.webp'));
  assert(assets.includes('/assets/weapons/body-tiger-hd.webp'));
});

test('weapon library never preloads unowned weapons or all skill illustrations',()=>{
  const assets=policy.manualImages({library:[
    {id:'sword-wind',owned:true},{id:'body-dragon',owned:false},
    {id:'body-rock',owned:true}]});
  assert.deepEqual(assets,['/assets/weapons/sword-wind-hd.webp','/assets/weapons/body-rock-hd.webp']);
  assert.deepEqual(policy.weaponImages(['body-tiger','body-tiger','invalid',null]),
    ['/assets/weapons/body-tiger-hd.webp']);
  const chosen=policy.chosenSkills('sword-wind',{
    'sword-wind':{skills:[{id:'a'},{id:'b'},{id:'c'}]},
    'sword-sky':{skills:[{id:'unused'}]}
  },skill=>'/assets/skills/'+skill.id+'.png');
  assert.deepEqual(chosen,['/assets/skills/a.png','/assets/skills/b.png',
    '/assets/skills/c.png']);
  assert.deepEqual(policy.chosenSkills('body-dragon',{},()=>'/assets/unused.png'),[]);
});

test('a bounded preload queue deduplicates requests and excludes unapproved URLs',async()=>{
  const prior=global.Image;
  let active=0,peak=0;
  const seen=[];
  class MockImage{
    constructor(){this.complete=false;this.naturalWidth=0;}
    set src(value){
      active++;peak=Math.max(peak,active);seen.push(value);
      queueMicrotask(()=>{active--;this.complete=true;this.naturalWidth=100;this.onload?.();});
    }
  }
  global.Image=MockImage;
  try{
    const urls=['/assets/test-prefetch-01.png','/assets/test-prefetch-02.png',
      '/assets/test-prefetch-03.png','/assets/test-prefetch-01.png',
      'https://tracker.invalid/pixel','/api/private'];
    const result=await policy.warmImages(urls);
    assert.equal(result.length,3);
    assert.equal(peak<=2,true,'at most two images load simultaneously');
    await policy.warmImages(urls);
    assert.deepEqual(seen,urls.slice(0,3),'successful warmups never fetch twice');
    const stopped=await policy.warmImages(['/assets/should-not-request.png'],
      {signal:{aborted:true}});
    assert.deepEqual(stopped,[]);
  }finally{global.Image=prior;}
});
