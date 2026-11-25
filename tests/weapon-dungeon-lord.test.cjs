'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../public/cultivation/tactical-rules.js');
const W=require('../public/cultivation/weapon-dungeon-rules.js');
const Impact=require('../public/cultivation/tactical-impact-presentation.js');
const NOW=2000000000000;
const make=(manualSkills=[])=>R.create({
  id:'arena-0123456789abcdef',mode:'pve',now:NOW,
  players:[{uid:'u1',name:'修士',atk:200,maxHp:2000,manualSkills}],
  trial:{seed:'boss-no-guard-shield',stage:5,
    weaponDungeon:{id:W.ID,difficulty:0}}
});
const lord=s=>s.actors.find(a=>a.weaponDungeonLord);
const guards=s=>s.actors.filter(a=>a.bot&&!a.weaponDungeonLord&&a.hp>0);
test('weapon dungeon lord has an active intent while all guards are alive',()=>{
  const s=make();assert.equal(guards(s).length,8);
  assert.notEqual(lord(s).intent?.kind,'wait');
  assert.equal(Impact.bossStatus(s).dormant,undefined);
  s.blocks=[];Object.assign(s.actors[0],{x:4,y:3});
  R.prepareIntents(s);
  assert.equal(lord(s).intent.kind,'attack');
  const next=R.apply(s,'u1',{type:'end'},NOW);
  assert(next.actors[0].hp<s.actors[0].hp,
    'the lord attacks without waiting for its guards');
  assert(guards(next).length>0);
});
test('lord takes direct damage before the guards fall',()=>{
  const s=make();s.blocks=[];
  Object.assign(s.actors[0],{x:3,y:1,stamina:10});
  const hp=lord(s).hp;
  const next=R.apply(s,'u1',{type:'attack',x:5,y:1},NOW);
  assert(lord(next).hp<hp);
  assert.equal(guards(next).length,guards(s).length);
  assert(!next.events.some(e=>e.text?.includes('守衛石陣庇護領主')));
});
test('lord may be pushed and interrupted while guards live',()=>{
  const s=make(['wind-thousand']);s.blocks=[];
  Object.assign(s.actors[0],{x:3,y:1,stamina:10});
  const before={x:lord(s).x,y:lord(s).y,hp:lord(s).hp};
  const next=R.apply(s,'u1',{type:'manual',skillId:'wind-thousand',x:5,y:1},NOW);
  assert(lord(next).hp<before.hp);
  assert(lord(next).x>before.x);
  assert.equal(lord(next).intent.kind,'stagger');
  assert.equal(guards(next).length,guards(s).length);
});
test('old persisted sleeping intent no longer protects the lord',()=>{
  const s=make();s.blocks=[];
  Object.assign(s.actors[0],{x:4,y:3});
  R.prepareIntents(s);
  lord(s).intent={kind:'wait',cells:[],text:'舊版沉眠'};
  const next=R.apply(s,'u1',{type:'end'},NOW);
  assert(next.actors[0].hp<s.actors[0].hp);
});
test('weapon dungeon guidance no longer demands clearing guards first',()=>{
  const info=W.CATALOG.find(d=>d.id===W.ID);
  assert(info.tactics.some(s=>s.includes('不必先清除守衛')));
  assert(!info.tactics.some(s=>s.includes('免疫傷害')||s.includes('沉眠')));
  assert.equal(info.totemDamageMultiplier,1.15);
});

test('defeating only the lord ends weapon dungeon immediately with guards still alive',()=>{
  const s=make(['rock-fist']);
  s.blocks=[];
  Object.assign(s.actors[0],{x:6,y:3,stamina:10,answered:0,correct:0});
  lord(s).hp=1;
  R.prepareIntents(s);
  const original=guards(s).length;
  assert(original>=8);
  const win=R.apply(s,'u1',{type:'manual',skillId:'rock-fist',x:6,y:2},NOW);
  assert.equal(win.status,'finished');
  assert.equal(win.winner,'player');
  assert.equal(win.finishReason,'objective');
  assert.equal(win.objective.completed,true);
  assert.equal(guards(win).length,original);
  assert.equal(win.actors[0].answered,0);
  assert(win.events.some(event=>event.text.includes('領主已被擊敗')));
});
test('old weapon dungeon snapshots using elimination objective also end on lord defeat',()=>{
  const s=make(['rock-fist']);
  s.objective={type:'elimination',completed:false};
  s.blocks=[];
  Object.assign(s.actors[0],{x:6,y:3,stamina:10,answered:0});
  lord(s).hp=1;
  R.prepareIntents(s);
  const win=R.apply(s,'u1',{type:'manual',skillId:'rock-fist',x:6,y:2},NOW);
  assert.equal(win.status,'finished');
  assert(guards(win).length>0);
});
test('ordinary elimination still requires all enemies and the regular answer gate',()=>{
  const s=make(['rock-fist']);
  s.weaponDungeon=null;
  s.objective={type:'elimination',completed:false};
  s.blocks=[];
  Object.assign(s.actors[0],{x:6,y:3,stamina:10,answered:0});
  lord(s).hp=1;
  R.prepareIntents(s);
  const after=R.apply(s,'u1',{type:'manual',skillId:'rock-fist',x:6,y:2},NOW);
  assert.equal(after.status,'active');
  assert.equal(after.objective.completed,false);
});
