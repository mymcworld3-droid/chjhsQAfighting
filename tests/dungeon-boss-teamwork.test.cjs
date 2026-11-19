'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Boss=require('../dungeon-boss-battle.cjs');
const Player=require('../dungeon-player-combat.cjs');
const Skills=require('../dungeon-skill-combat.cjs');
const {initialClock}=require('../dungeon-battle-clock.cjs');
const NOW=1800000000000;
const SEED='cooperative-boss-teamwork-2026';
const map=Boss.mapFor(SEED);
const near={x:10,y:6};
const another={x:13,y:6};
const defender={x:11,y:10};
function member(uid,position,stamina=100){
  return {uid,name:uid,position:{...position},battleHealth:100,
    downed:false,explorationStamina:stamina,
    moveSeq:0,strikeSeq:0,skillSeq:0,guardSeq:0};
}
function room(members={a:member('a',near),b:member('b',another)}){
  const boss={...Boss.initialBoss(),nextActionTick:2};
  return {mode:'dungeon',status:'assembled',dungeonArena:'boss',
    bossEncounter:{version:Boss.VERSION,status:'fighting'},
    ...initialClock(NOW),battleAppliedTick:0,members,enemies:[boss]};
}
const update=(r,o)=>({...r,members:o.members,enemies:o.enemies});
test('solo attacks chip the shield and HP without needing any cooperative token',()=>{
  let r=room({a:member('a',near)});
  assert.equal(r.enemies[0].shield,Boss.SHIELD_MAX);
  for(let seq=1;seq<=6;seq++){
    const result=Player.strikeEnemy(r,'a',map,{enemyId:Boss.ID,seq});
    assert.equal(result.hit.combo,false);
    assert.equal(result.hit.shieldDamage,30);
    r=update(r,result);
  }
  assert.equal(r.enemies[0].shield,0,'six solo hits break 180 shield');
  assert.ok(r.enemies[0].battleHealth<900,'shield still permits HP damage');
  assert.equal(r.enemies[0].lastTeamHit.shieldBroken,true);
  assert.equal(r.enemies[0].exposedUntilTick,6);
  const prev=r.enemies[0].battleHealth;
  const next=Player.strikeEnemy(r,'a',map,{enemyId:Boss.ID,seq:7});
  assert.equal(next.hit.damage,38,'30 damage becomes 38 during break window');
  assert.equal(next.enemies[0].battleHealth,prev-38);
});
test('co-op combo is server-calculated, based only on distinct recent contributors',()=>{
  let r=room();
  const a=Player.strikeEnemy(r,'a',map,{enemyId:Boss.ID,seq:1});
  assert.equal(a.hit.damage,21);
  r=update(r,a);
  const b=Player.strikeEnemy(r,'b',map,{enemyId:Boss.ID,seq:1});
  assert.equal(b.hit.combo,true);
  assert.equal(b.hit.shieldDamage,36);
  assert.equal(b.hit.damage,25);
  r=update(r,b);
  const retry=Player.strikeEnemy(r,'b',map,{enemyId:Boss.ID,seq:1});
  assert.equal(retry.duplicate,true,'network retries never double count');
  const repeat=Player.strikeEnemy(r,'b',map,{enemyId:Boss.ID,seq:2});
  assert.equal(repeat.hit.combo,false,'same attacker cannot self-chain');
  r=update(r,repeat);
  r={...r,battleAppliedTick:6};
  const expiry=Player.strikeEnemy(r,'a',map,{enemyId:Boss.ID,seq:2});
  assert.equal(expiry.hit.combo,false,'combo expires after five full ticks');
});
test('breaking the shield interrupts a pending boss warning exactly once',()=>{
  const boss=Boss.initialBoss();
  boss.shield=10;boss.attack={kind:'quake',cells:[{x:11,y:10}],
    damage:11,startedAtTick:2,resolvesAtTick:4};
  const impact=Boss.damage(boss,'a',30,2);
  assert.equal(impact.shieldBroken,true);
  assert.equal(boss.attack,null);
  assert.equal(boss.intent,'staggered');
  assert.ok(boss.nextActionTick>=2+Boss.STAGGER_TICKS);
  assert.equal(boss.exposedUntilTick,2+Boss.EXPOSED_TICKS);
  assert.equal(Boss.damage(boss,'a',1,3).shieldBroken,false);
});
test('multi-hit manuscript skill contributes one actor, with combo only after an ally',()=>{
  const record={school:'sword',
    books:{'sword-wind':{exp:2500},'sword-sky':{exp:2500}},
    equipped:['wind-slash','wind-step','wind-thousand'],
    loadouts:[
      {name:'A',skillIds:['wind-slash','wind-step','wind-thousand']},
      {name:'B',skillIds:['sky-pierce','sky-cloud','sky-sever']},
      {name:'C',skillIds:[]}],activeLoadout:0};
  const player={...member('a',{x:11,y:9}),accessScore:200};
  const combat=Skills.initialCombatLoadout({...player,accessScore:200},record);
  let r=room({a:{...player,...combat}});
  const changed=Skills.switchLoadout(r,'a',record,1);
  r={...r,members:changed.members};
  assert.ok(r.members.a.dungeonSkillIds.includes('sky-cloud'));
  const first=Skills.castSkill(r,'a',map,record,{
    skillId:'sky-cloud',target:{x:11,y:7},seq:1
  });
  assert.ok(first.result.hits.length>1,'the skill must actually hit repeatedly');
  assert.ok(first.result.hits.every(hit=>hit.combo===false));
  if(first.enemies.length)assert.equal(first.enemies[0].lastContributorUid,'a');
  assert.equal(r.enemies[0].shield,Boss.SHIELD_MAX,'source must remain untouched');
});
test('guard reduces one boss hit, is consumed, and is not available to outsiders',()=>{
  let r=room({a:member('a',{x:10,y:10}),b:member('b',defender)});
  r.enemies[0].attack={kind:'quake',label:'震地',damage:11,
    cells:[{...defender}],startedAtTick:2,resolvesAtTick:4};
  r.battleAppliedTick=2;
  const protective=Boss.guard(r,'a',map,{targetUid:'b',seq:1});
  assert.equal(protective.members.a.explorationStamina,97);
  assert.equal(protective.members.b.bossGuard.sourceUid,'a');
  assert.equal(Boss.guard({...r,members:protective.members},'a',map,{
    targetUid:'b',seq:1}).duplicate,true);
  assert.throws(()=>Boss.guard(r,'outsider',map,{targetUid:'b',seq:1}),/不是此副本/);
  assert.throws(()=>Boss.guard(r,'a',map,{targetUid:'ghost',seq:1}),/不是目前/);
  assert.throws(()=>Boss.guard(r,'a',map,{targetUid:'b',seq:3}),/不同步/);
  const resolved=Boss.resolveGuardedAttack(r.enemies[0],protective.members,4);
  assert.deepEqual(resolved.hits,['b']);
  assert.equal(resolved.members.b.battleHealth,94,'11 damage becomes 6');
  assert.equal(resolved.members.b.lastDamage.blockedAmount,5);
  assert.equal(resolved.members.b.bossGuard,null);
  assert.equal(Boss.resolveGuardedAttack(r.enemies[0],r.members,4).members.b.battleHealth,89);
});
test('solo guard costs six stamina, expires, and does not block more than one hit',()=>{
  const solo=room({a:member('a',defender)});
  const g=Boss.guard(solo,'a',map,{targetUid:'a',seq:1});
  assert.equal(g.members.a.explorationStamina,94);
  const enemy={...solo.enemies[0],attack:{kind:'quake',damage:16,
    cells:[{...defender}],startedAtTick:1,resolvesAtTick:2}};
  const protectedHit=Boss.resolveGuardedAttack(enemy,g.members,2);
  assert.equal(protectedHit.members.a.battleHealth,92);
  const repeat=Boss.resolveGuardedAttack(enemy,protectedHit.members,2);
  assert.equal(repeat.members.a.battleHealth,76,'consumed shield cannot protect twice');
  enemy.attack.resolvesAtTick=7;
  const expired=Boss.resolveGuardedAttack(enemy,g.members,7);
  assert.equal(expired.members.a.battleHealth,84,'expired guard gives no reduction');
});
test('guard cannot be used while far away, downed, short of stamina or after victory',()=>{
  const r=room({a:member('a',{x:7,y:13}),b:member('b',defender)});
  assert.throws(()=>Boss.guard(r,'a',map,{targetUid:'b',seq:1}),/兩格/);
  r.members.a.position={x:11,y:9};
  r.members.a.explorationStamina=2;
  assert.throws(()=>Boss.guard(r,'a',map,{targetUid:'b',seq:1}),/體力不足/);
  r.members.a.explorationStamina=100;
  r.members.a.downed=true;
  assert.throws(()=>Boss.guard(r,'a',map,{targetUid:'b',seq:1}),/倒地/);
  r.members.a.downed=false;
  r.bossEncounter.status='defeated';
  assert.throws(()=>Boss.guard(r,'a',map,{targetUid:'b',seq:1}),/目前無法/);
});

test('unassisted solo victory stays possible inside the original 100 stamina budget',()=>{
  let r=room({a:member('a',near)});
  let strikes=0;
  while(r.enemies.some(e=>e.id===Boss.ID)&&strikes<50){
    const out=Player.strikeEnemy(r,'a',map,{enemyId:Boss.ID,seq:strikes+1});
    r=update(r,out);
    strikes++;
  }
  assert.ok(strikes<50,'basic melee alone must be able to defeat the boss');
  assert.equal(r.enemies.some(e=>e.id===Boss.ID),false);
  assert.equal(r.members.a.explorationStamina,100-strikes*2);
  const defeated=Boss.onDefeat({...r,enemies:[Boss.initialBoss()]},r.enemies,'a');
  assert.equal(defeated.status,'defeated');
});
test('the autonomous boss clock consumes guard before applying the real attack',()=>{
  let r=room({a:member('a',{x:10,y:10}),b:member('b',defender)});
  r.enemies[0].attack={kind:'quake',label:'裂地',damage:11,
    cells:[{...defender}],startedAtTick:2,resolvesAtTick:4};
  r.battleAppliedTick=2;
  const prepared=Boss.guard(r,'a',map,{targetUid:'b',seq:1});
  r={...r,members:prepared.members};
  const applied=Boss.advance(r,map,NOW+4000);
  assert.equal(applied.battleAppliedTick,4);
  assert.equal(applied.members.b.battleHealth,94);
  assert.equal(applied.members.b.lastDamage.blockedAmount,5);
  assert.equal(applied.members.b.bossGuard,null);
  const later=Boss.advance({...r,...applied},map,NOW+4000);
  assert.equal(later,null,'replaying the same server tick cannot deal damage twice');
});
