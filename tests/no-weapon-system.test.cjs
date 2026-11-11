'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const path=require('node:path');
const R=require('../public/cultivation/tactical-rules.js');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('ordinary tactical attacks do not use weapon profiles',()=>{
  const a=R.actor({uid:'u',weapon:{type:'bow',realm:9}},{x:1,y:1});
  assert.equal(a.weapon,undefined);
  const basic=R.basicFor(a);
  assert.equal(basic.id,'attack');assert.equal(basic.cost,2);assert.equal(basic.range,2);assert.equal(basic.kind,'line');
  const s=R.create({id:'weaponless',players:[{uid:'u',maxHp:1000,atk:200,weapon:{type:'hammer',realm:8}}]});
  assert.equal(s.actors[0].weapon,undefined);
});
test('backend has no weapon inventory reads or effect grants',()=>{
  for(const p of ['tactical-combat-api.cjs','raid-authority.cjs'])
    assert.doesNotMatch(read(p),/weaponArmories|Weapons\.|QAWeapons|weaponSystemV1/);
  assert.match(read('server.js'),/app\.use\('\/api\/weapons'.*410/);
  assert.doesNotMatch(read('server.js'),/registerWeaponArmoryApi/);
});
test('weapon pages and scripts no longer load',()=>{
  const main=read('public/main.js'),html=read('public/index.html');
  assert.doesNotMatch(main,/weapon-forge\.js|QA_WEAPON_SYSTEM_ENABLED = true/);
  assert.doesNotMatch(html,/<button[^>]+data-training-tab="contract"/);
  assert.doesNotMatch(read('public/cultivation/tactical-combat.js'),/QAWeapons|weaponRewards/);
  assert.doesNotMatch(read('public/cultivation/tactical-renderer.js'),/weapon-system-rules/);
  const access=require('../public/cultivation/training-access-rules.js');
  assert.equal(access.PLACES.some(x=>x.id==='contract'),false);
  assert.equal(access.PLACES.some(x=>x.id==='forge'),true);
});
