'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../public/cultivation/weapon-system-rules.js'),R=require('../public/cultivation/tactical-rules.js');
const api=require('../weapon-armory-api.cjs').__test,tactical=require('../tactical-combat-api.cjs').__test;
const {fakeDb}=require('./helpers/inventory-db.cjs');
const user=()=>({uid:'u1',stats:{totalScore:30,gold:100000,attack:200,maxHp:1000},soulboundDrawTickets:3,forgeFragments:1200});
const request=(id,extra={})=>({requestId:'weapon-operation-'+id,...extra});
const op=(db,action,id,extra={})=>api.transact(db,'u1',action,request(id,extra));
const armory=db=>db.docs.get('weaponArmories/u1');
const now=2000000000000;
function battlefield(type){const s=R.create({id:'weapons',players:[{uid:'u1',atk:200,maxHp:1000,weapon:{type,level:1}}],now});s.width=s.height=9;s.blocks=[];s.actors=[s.actors[0]];Object.assign(s.actors[0],{x:4,y:4,stamina:10});return s;}
function target(s,x,y,extra={}){const a=R.actor({uid:'m'+s.actors.length,bot:true,team:'monster',atk:100,maxHp:2000,...extra},{x,y});s.actors.push(a);return a;}

test('five weapon types have one selected slot, bounded levels and matching gold/merge progression',()=>{
  assert.deepEqual(W.TYPES.map(t=>t.label),['弓','槍','劍','刀','錘']);assert.equal(new Set(W.TYPES.map(t=>t.id)).size,5);
  const raw={equipped:'sword',weapons:{sword:{level:999,copies:2},forged:{level:99,copies:9}}},s=W.normalize(raw);
  assert.equal(s.weapons.sword.level,10);assert.equal(s.weapons.forged,undefined);assert.equal(W.attackMultiplier(W.snapshot(s)),1.225);
  assert.deepEqual([1,4,7].map(W.mergeCost),[1,2,3]);assert.equal(W.goldCost(3),2700);assert.equal(raw.weapons.sword.level,999);
});
test('bow has an adjacent blind spot and cannot shoot through walls or target friendly actors',()=>{
  let s=battlefield('bow');const near=target(s,5,4),far=target(s,7,4);const sk=R.basicFor(s.actors[0]);
  assert.throws(()=>R.apply(s,'u1',{type:'attack',x:5,y:4},now),/太近/);
  const next=R.apply(s,'u1',{type:'attack',x:7,y:4},now);assert.equal(next.actors.find(a=>a.uid===far.uid).hp,1830);assert.equal(next.actors.find(a=>a.uid===near.uid).hp,2000);
  assert.equal(next.actors[0].stamina,8);assert.equal(R.aimCells(s,s.actors[0],sk).some(p=>p.x===5&&p.y===4),false);
  s.blocks=[{x:6,y:4}];assert.throws(()=>R.apply(s,'u1',{type:'attack',x:7,y:4},now),/視線/);
});
test('spear pierces three cells while sword reaches two, charging once and respecting obstacles',()=>{
  for(const type of ['spear','sword']){
    const s=battlefield(type);for(let i=1;i<=4;i++)target(s,4+i,4);
    const next=R.apply(s,'u1',{type:'attack',x:5,y:4},now),hits=next.actors.slice(1).map(a=>2000-a.hp);
    assert.deepEqual(hits,type==='spear'?[180,180,180,0]:[200,200,0,0]);assert.equal(next.actors[0].stamina,8);assert.equal(next.actors[0].attacks,1);
    s.blocks=[{x:6,y:4}];assert.equal(R.skillCells(s,s.actors[0],R.basicFor(s.actors[0]),{x:5,y:4}).length,1);
  }
});
test('saber sweeps three forward cells in each direction, excluding rear, diagonal aiming and blocked cells',()=>{
  for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){
    const s=battlefield('saber');for(const i of [-1,0,1])target(s,4+dx-dy*i,4+dy+dx*i);target(s,4-dx,4-dy);
    const p={x:4+dx,y:4+dy},next=R.apply(s,'u1',{type:'attack',...p},now);
    assert.deepEqual(next.actors.slice(1).map(a=>2000-a.hp),[230,230,230,0]);assert.equal(next.actors[0].stamina,7);
    assert.throws(()=>R.apply(s,'u1',{type:'attack',x:5,y:5},now),/範圍|方向/);
    s.blocks=[p];assert.throws(()=>R.apply(s,'u1',{type:'attack',...p},now),/範圍/);
  }
});
test('hammer charges three stamina, has one-cell range and breaks shields faster without multiplying HP damage',()=>{
  const s=battlefield('hammer');target(s,5,4,{shield:600});target(s,6,4);let next=R.apply(s,'u1',{type:'attack',x:5,y:4},now);
  assert.equal(next.actors[1].shield,150);assert.equal(next.actors[1].hp,2000);assert.equal(next.actors[0].stamina,7);
  next=R.apply(next,'u1',{type:'attack',x:5,y:4},now);assert.equal(next.actors[1].shield,0);assert.equal(next.actors[1].hp,1800);
  assert.throws(()=>R.apply(s,'u1',{type:'attack',x:6,y:4},now),/範圍/);
  const plain=battlefield('hammer');target(plain,5,4);assert.equal(R.apply(plain,'u1',{type:'attack',x:5,y:4},now).actors[1].hp,1700);
});
test('upgrading a weapon increases trial damage without inflating the same stage monsters',()=>{
  const create=level=>R.create({id:'same-stage',players:[{uid:'u1',atk:Math.round(200*W.attackMultiplier({type:'sword',level})),maxHp:1000,enemyScaleAttack:200,weapon:{type:'sword',level}}],trial:{seed:'1234567890abcdef1234567890abcdef',stage:12},now});
  const first=create(1),upgraded=create(10);assert.equal(upgraded.actors[0].atk,245);assert.deepEqual(upgraded.actors.slice(1),first.actors.slice(1));
});
test('starter, selected chests and equipment use server inventory, with exactly one equipped weapon',async()=>{
  const db=fakeDb(user());const before=await api.transact(db,'u1');assert.equal(before.state.starterClaimed,false);assert.equal(db.docs.size,1,'ordinary views do not initialize or mutate assets');
  await op(db,'starter','starter',{type:'bow'});assert.equal(armory(db).equipped,'bow');
  await assert.rejects(op(db,'starter','starter-2',{type:'sword'}),/已領取/);
  await assert.rejects(op(db,'equip','unowned',{type:'hammer'}),/尚未持有/);
  await op(db,'exchange-ticket','ticket');await op(db,'open-chest','open',{type:'hammer'});await op(db,'equip','equip',{type:'hammer'});
  assert.equal(armory(db).equipped,'hammer');assert.deepEqual(Object.keys(armory(db).weapons).sort(),['bow','hammer']);assert.equal(db.docs.get('users/u1').soulboundDrawTickets,2);
});
test('gold and duplicate upgrades are alternatives; retries and concurrent requests cannot spend or upgrade twice',async()=>{
  const db=fakeDb(user());await op(db,'starter','starter',{type:'sword'});
  const req=request('gold',{type:'sword',payment:'gold',expectedLevel:1,cost:1,level:99});
  const first=await api.transact(db,'u1','upgrade',req),retry=await api.transact(db,'u1','upgrade',req);
  assert.equal(first.state.weapons.sword.level,2);assert.equal(retry.state.weapons.sword.level,2);assert.equal(retry.replayed,true);assert.equal(db.docs.get('users/u1').stats.gold,99700);assert.equal(armory(db).weapons.sword.copies,1);
  await assert.rejects(api.transact(db,'u1','upgrade',{...req,payment:'merge'}),/識別碼/);
  await op(db,'exchange-ticket','ticket');await op(db,'open-chest','open',{type:'sword'});
  const attempts=await Promise.allSettled([op(db,'upgrade','merge-a',{type:'sword',payment:'merge',expectedLevel:2}),op(db,'upgrade','merge-b',{type:'sword',payment:'merge',expectedLevel:2})]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(armory(db).weapons.sword.level,3);assert.equal(armory(db).weapons.sword.copies,1);assert.equal(db.docs.get('users/u1').stats.gold,99700);
  await assert.rejects(op(db,'upgrade','no-copy',{type:'sword',payment:'merge',expectedLevel:3}),/保留/);
});
test('database failure and transaction retries leave no partial payment, receipt or upgrade',async()=>{
  const db=fakeDb(user());await op(db,'starter','starter',{type:'sword'});const run=db.runTransaction;
  db.runTransaction=fn=>run(async tx=>{const set=tx.set;tx.set=(ref,value)=>{if(ref.key.startsWith('weaponArmoryReceipts/'))throw Error('lost database');set(ref,value);};return fn(tx);});
  await assert.rejects(op(db,'upgrade','retry',{type:'sword',payment:'gold',expectedLevel:1}),/lost database/);assert.equal(armory(db).weapons.sword.level,1);assert.equal(db.docs.get('users/u1').stats.gold,100000);
  db.runTransaction=run;db.retryNextTransaction();await op(db,'upgrade','retry',{type:'sword',payment:'gold',expectedLevel:1});assert.equal(armory(db).weapons.sword.level,2);assert.equal(db.docs.get('users/u1').stats.gold,99700);
});
test('trial entitlements come from server progress and milestone bonuses are paid exactly once',async()=>{
  const db=fakeDb(user());db.docs.set('tacticalBattlePlayers/u1',{trial:{best:5}});
  const before=await api.transact(db,'u1');assert.equal(before.pendingTrialChests,6);
  await op(db,'claim-trial','trial',{stage:999});assert.equal(armory(db).chests,6);
  await assert.rejects(op(db,'claim-trial','again'),/待領/);await op(db,'claim-trial','trial');assert.equal(armory(db).chests,6);
  db.docs.get('tacticalBattlePlayers/u1').trial.best=6;await op(db,'claim-trial','next');assert.equal(armory(db).chests,7);
});
test('legacy transfer archives equipment and a pending job, preserves other items, refunds costs and cannot replay rewards',async()=>{
  const u=user();u.artifactSystem={inventory:{'soul-sword-golden-core':1,'consumable-unknown':2},equipped:{'本命法寶':'soul-sword-golden-core'}};
  u.materialSystem={inventory:{'qi-spirit-iron':3,'unknown-growth-resource':9}};
  u.refineryJobV1={id:'old-job',currency:'forgeFragments',fragmentCost:600,recipe:[{artifactId:'soul-sword-golden-core',quantity:1},{materialId:'qi-spirit-wood',quantity:2}]};
  const db=fakeDb(u),preview=await api.transact(db,'u1');assert.equal(preview.legacy.chests,2);assert.equal(preview.legacy.gold,50);
  const result=await op(db,'convert-legacy','legacy');assert.equal(result.state.chests,2);assert.equal(result.legacy.equipmentCopies,0);assert.equal(result.legacy.pendingJob,false);
  const saved=db.docs.get('users/u1');assert.equal(saved.stats.gold,100050);assert.equal(saved.forgeFragments,1800);assert.equal(saved.refineryJobV1,null);assert.equal(saved.materialSystem.inventory['unknown-growth-resource'],9);assert.equal(saved.artifactSystem.inventory['consumable-unknown'],2);
  assert.equal([...db.docs.keys()].filter(k=>k.startsWith('weaponLegacyArchives/')).length,1);
  await op(db,'convert-legacy','legacy');assert.equal(armory(db).chests,2);await assert.rejects(op(db,'convert-legacy','other'),/沒有可轉換/);
});
test('live tactical loadouts ignore forged client weapons and old equipment bonuses; upgrades apply only to new rooms',async()=>{
  const {database}=require('./helpers/tactical-db.cjs'),db=database();db.records.get('users/u1').stats.gold=100000;
  db.records.get('users/u1').artifactSystem={inventory:{'soul-sword-golden-core':1},equipped:{'本命法寶':'soul-sword-golden-core'}};
  await api.transact(db,'u1','starter',request('start',{type:'hammer'}));await api.transact(db,'u1','upgrade',request('upgrade',{type:'hammer',payment:'gold',expectedLevel:1}));
  const s=await tactical.start(db,'u1',{mode:'pve',weapon:{type:'bow',level:99},atk:99999},now);
  assert.equal(s.actors[0].weapon.type,'hammer');assert.equal(s.actors[0].weapon.level,2);assert.equal(s.actors[0].atk,205);assert.equal(s.actors[0].shield,0);
  await api.transact(db,'u1','upgrade',request('upgrade-3',{type:'hammer',payment:'gold',expectedLevel:2}));
  assert.equal((await tactical.state(db,'u1',now)).actors[0].weapon.level,2,'in-progress room snapshots are immutable');
  db.records.get('users/u1').weaponSystemV1={equipped:'bow',weapons:{bow:{level:99,copies:99}}};
  const trusted=await require('../raid-authority.cjs').loadTrustedRaidPlayer(db,'u1');assert.equal(trusted.weapon.type,'hammer');assert.equal(trusted.weapon.level,3);assert.equal(trusted.atk,210);assert.equal(trusted.artifactShield,0);
});
test('trial victory commits milestone chests with progress and rewards, including lost-response retries',async()=>{
  const {database}=require('./helpers/tactical-db.cjs'),db=database(),s=await tactical.start(db,'u1',{mode:'pve'},now),raw=db.records.get(tactical.ROOMS+'/'+s.id);
  raw.trial.stage=5;db.records.get(tactical.PLAYERS+'/u1').trial.stage=5;raw.blocks=[];raw.actors[0].correct=1;raw.actors[0].answered=1;
  Object.assign(raw.actors[0],{x:1,y:3});
  Object.assign(raw.actors[1],{x:2,y:3,hp:1});
  const input={roomId:s.id,revision:raw.revision,type:'attack',x:2,y:3,requestId:'weapons-trial-kill'};
  const won=await tactical.command(db,'u1',input,now),retry=await tactical.command(db,'u1',input,now);
  assert.equal(won.weaponRewards.u1.chests,6);assert.equal(retry.weaponRewards.u1.chests,6);assert.equal(db.records.get('weaponArmories/u1').chests,6);assert.equal(db.records.get(tactical.PLAYERS+'/u1').trial.stage,6);
});
test('ordinary browser access cannot read or mutate authoritative weapons, receipts or legacy archives',()=>{
  const {mayRead,authorizeWrite}=require('../d1-browser-api.cjs');
  for(const col of ['weaponArmories','weaponArmoryReceipts','weaponLegacyArchives']){
    assert.equal(mayRead({role:'A',path:col+'/u1',data:{uid:'u1'},uid:'u1',admin:false}),false);
    assert.throws(()=>authorizeWrite({role:'A',path:col+'/u1',before:null,after:{uid:'u1'},operation:'set',context:{uid:'u1',admin:false}}),/無權/);
  }
});
