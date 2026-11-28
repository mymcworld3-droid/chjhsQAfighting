'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../public/cultivation/weapon-dungeon-rules.js');
const M=require('../public/cultivation/manual-rules.js');
const R=require('../public/cultivation/tactical-rules.js');
const API=require('../tactical-combat-api.cjs').__test;
const Rewards=require('../weapon-dungeon-rewards.cjs');
const {database}=require('./helpers/tactical-db.cjs');
const NOW=Date.UTC(2026,10,22,4);
const input=(requestId='weapon-start-001',difficulty=0)=>({activity:'weapon-dungeon',dungeonId:W.ID,difficulty,requestId});
const hero=()=>({uid:'u1',atk:200,maxHp:10000,manualWeaponMode:true,manualWeaponIds:['body-rock','sword-wind'],manualSkills:['rock-fist','rock-break','wind-slash'],trainingAccessScore:0});
function scene({tracking=true,boss=false,skills=['rock-fist'],enemy={x:4,y:4},player={x:6,y:4}}={}){
 const s=R.create({id:'scene',players:[hero()],trial:{seed:'scene',weaponDungeon:{difficulty:0}},now:NOW});
 s.blocks=[];s.actors=s.actors.slice(0,1);
 Object.assign(s.actors[0],player,{stamina:10,manualSkills:skills,answered:1,correct:1});
 s.actors.push(R.actor({uid:'beast',bot:true,name:'石獸',species:8,team:'monster',atk:100,maxHp:10000,
   trackingAttack:tracking,boss,weaponDungeonLord:boss},enemy));
 if(!tracking)delete s.weaponDungeon;
 R.prepareIntents(s);return s;
}
function own(db){db.records.set(API.MANUALS+'/u1',M.weaponize({school:'body',books:{'body-rock':{exp:M.totalExpForLevel(10)},'sword-wind':{exp:0}},weaponIds:['body-rock','sword-wind']}));}
test('six sequential difficulty tiers omit 煉虛 and reward the preceding tier',()=>{
 assert.deepEqual(W.DIFFICULTIES.map(d=>d.name),['築基','金丹','元嬰','化神','合體','渡劫']);
 assert.deepEqual(W.DIFFICULTIES.map(d=>W.selection({dungeonId:W.ID,difficulty:d.index}).lowerRealm),['煉氣','築基','金丹','元嬰','化神','合體']);
 for(const difficulty of [-1,6,1.5,'0',NaN])assert.throws(()=>W.selection({dungeonId:W.ID,difficulty}));
});
test('Taipei midnight grants 3 tickets once, carries unused tickets up to 5 and cannot roll the clock back',()=>{
 const before=Date.UTC(2026,10,22,15,59),after=before+60000;
 let p=W.progress(null,before);assert.equal(p.tickets,3);
 p.tickets=1;assert.equal(W.progress(p,before).tickets,1);
 p=W.progress(p,after);assert.equal(p.tickets,4);
 assert.equal(W.progress(p,after).tickets,4);
 assert.equal(W.progress(p,after+86400000*8).tickets,5);
 assert.equal(W.progress(p,before).grantDay,p.grantDay);
});
test('all six seed maps have reachable guards, a legal 2x2 deepest lord, and at least 8 low-mobility guards',()=>{
 for(let d=0;d<6;d++)for(let seed=0;seed<20;seed++){
   const s=R.create({id:'map',players:[hero()],trial:{seed:String(seed),weaponDungeon:{difficulty:d}},now:NOW});
   const [player,lord,...guards]=s.actors;
   assert.equal(s.terrain,16);assert.equal(s.ground.length,s.width*s.height);assert.ok(s.ground.every(t=>t===16));
   assert.equal(s.trial.attempt,0);assert.match(s.trial.layoutHash,/^peak-stone:/);
   const noUndefined=value=>{if(value&&typeof value==='object')for(const v of Object.values(value)){assert.notEqual(v,undefined);noUndefined(v);}};
   noUndefined(s);
   assert(lord.boss&&lord.weaponDungeonLord);assert(guards.length>=8);
   assert(guards.every(a=>a.y>lord.y+1));
   assert(R.footprint(lord).every(p=>!R.blocked(s,p)));
   const queue=[{x:player.x,y:player.y}],seen=new Set([R.key(player)]);
   for(let i=0;i<queue.length;i++)for(const p of R.neighbours(s,queue[i]))if(!seen.has(R.key(p))){seen.add(R.key(p));queue.push(p);}
   assert(s.actors.every(a=>seen.has(R.key(a))),'each actor lies in the connected floor');
   assert(s.actors.filter(a=>a.bot).every(a=>R.monsterProfileFor(a).move.steps===1));
 }
});
test('skills unlock only by weapon mastery even for a zero-realm player; old book IDs/XP are preserved',async()=>{
 for(const book of M.BOOKS){
   assert(book.skills.every(skill=>!Object.hasOwn(skill,'realmRequired')));
   const state=M.publicState({books:{[book.id]:{exp:M.totalExpForLevel(10)}},weaponIds:[book.id,null]},0);
   assert(state.library[0].skills.every(skill=>skill.unlocked));
 }
 assert.equal(M.BY_BOOK['sword-sky'].tierRealm,'金丹');assert.equal(M.BY_BOOK['body-dragon'].tierRealm,'金丹');
 const db=database();own(db);db.records.get('users/u1').stats.totalScore=0;
 const state=await API.manualsState(db,'u1');
 assert.equal(state.library.find(b=>b.id==='body-rock').skills.filter(s=>s.unlocked).length,3);
 const upgraded=await API.updateLoadout(db,'u1',{index:0,weaponId:'body-rock'});
 assert(upgraded.equipped.includes('rock-break'));
});
test('moving ordinary beasts prepare their next attack immediately after landing, without an immediate hit',()=>{
 const s=scene({tracking:false});assert.equal(s.actors[1].intent.kind,'advance');
 const next=R.apply(s,'u1',{type:'end'},NOW);
 assert.equal(next.actors[1].x,5);assert.equal(next.actors[1].intent.kind,'attack');
 assert.equal(next.actors[0].hp,s.actors[0].hp);
});
test('armed stone attacks track player movement within range and miss only when the player exits range',()=>{
 const s=scene();assert.equal(s.actors[1].intent.kind,'attack');
 const inside=R.apply(s,'u1',{type:'move',x:6,y:5},NOW);
 assert(inside.actors[1].intent.cells.some(p=>p.x===6&&p.y===5));
 const hit=R.apply(inside,'u1',{type:'end'},NOW);assert.equal(hit.actors[0].hp,9900);
 const outside=R.apply(s,'u1',{type:'move',x:7,y:5},NOW);
 assert.equal(outside.actors[1].intent.cells.length,0);
 const missed=R.apply(outside,'u1',{type:'end'},NOW);assert.equal(missed.actors[0].hp,10000);
});
test('knockback cancels a tracking windup; moving back into range cannot resurrect the interrupted attack',()=>{
 let s=scene({skills:['rock-break'],enemy:{x:7,y:4},player:{x:6,y:4}});
 s=R.apply(s,'u1',{type:'manual',skillId:'rock-break',x:7,y:4},NOW);
 assert(s.actors[1].x>7);assert.equal(s.actors[1].intent.kind,'stagger');assert.deepEqual(s.actors[1].intent.cells,[]);
 s=R.apply(s,'u1',{type:'move',x:8,y:4},NOW);assert.equal(s.actors[1].intent.kind,'stagger');
 const hp=s.actors[0].hp;s=R.apply(s,'u1',{type:'end'},NOW);
 assert.equal(s.actors[0].hp,hp);assert.equal(s.actors[1].intent.kind,'attack','only the next windup may start');
});
test('the awakened lord also interrupts when successfully knocked back, with full-footprint collision checks',()=>{
 let s=scene({boss:true,skills:['rock-break'],enemy:{x:7,y:4},player:{x:6,y:4}});
 s=R.apply(s,'u1',{type:'manual',skillId:'rock-break',x:7,y:4},NOW);
 assert(s.actors[1].x>7);assert.equal(s.actors[1].intent.kind,'stagger');
 assert(R.footprint(s.actors[1]).every(p=>!R.blocked(s,p)));
});
test('a blocked knockback does not cancel a windup, while an ordinary beast also interrupts on displacement',()=>{
 let s=scene({skills:['rock-break'],enemy:{x:7,y:4},player:{x:6,y:4}});
 s.blocks=[{x:8,y:4}];
 let next=R.apply(s,'u1',{type:'manual',skillId:'rock-break',x:7,y:4},NOW);
 assert.equal(next.actors[1].x,7);assert.equal(next.actors[1].intent.kind,'attack');
 s=scene({tracking:false,skills:['rock-break'],enemy:{x:7,y:4},player:{x:6,y:4}});
 assert.equal(s.actors[1].intent.kind,'attack');
 next=R.apply(s,'u1',{type:'manual',skillId:'rock-break',x:7,y:4},NOW);
 assert.equal(next.actors[1].intent.kind,'stagger');
 const hp=next.actors[0].hp;next=R.apply(next,'u1',{type:'end'},NOW);
 assert.equal(next.actors[0].hp,hp);
});
test('deepest lord is vulnerable and active even when all guards remain',()=>{
 let s=R.create({id:'awake',players:[hero()],trial:{seed:'awake',weaponDungeon:{difficulty:0}},now:NOW});
 Object.assign(s.actors[0],{x:6,y:3,stamina:10});
 const hp=s.actors[1].hp,guards=s.actors.filter(a=>a.bot&&!a.weaponDungeonLord&&a.hp>0).length;
 R.prepareIntents(s);assert.notEqual(s.actors[1].intent.kind,'wait');
 s=R.apply(s,'u1',{type:'manual',skillId:'rock-fist',x:6,y:2},NOW);
 assert(s.actors[1].hp<hp);
 assert.equal(s.actors.filter(a=>a.bot&&!a.weaponDungeonLord&&a.hp>0).length,guards);
});

test('totem hits receive exactly 15% extra damage only in the weapon dungeon; sword damage is unchanged',()=>{
 for(const [tracking,skill,expected]of [[true,'rock-fist',299],[false,'rock-fist',260],[true,'wind-slash',240]]){
   const s=scene({tracking,skills:[skill],enemy:{x:7,y:4},player:{x:6,y:4}}),hp=s.actors[1].hp;
   const next=R.apply(s,'u1',{type:'manual',skillId:skill,x:7,y:4},NOW);
   assert.equal(hp-next.actors[1].hp,expected);
 }
});
test('ticket claims are atomic; unlocked difficulties and both solo room pointers are independent',async()=>{
 const db=database();own(db);
 const ordinary=await API.start(db,'u1',{mode:'pve'},NOW);
 const [a,b]=await Promise.all([API.weaponDungeonState(db,'u1',NOW),API.weaponDungeonState(db,'u1',NOW)]);
 assert.equal(a.tickets,3);assert.equal(b.tickets,3);
 await assert.rejects(API.start(db,'u1',input('locked-room-01',1),NOW),/前一個難度/);
 const [first,replay]=await Promise.all([API.start(db,'u1',input(),NOW),API.start(db,'u1',input(),NOW)]);
 assert.equal(first.id,replay.id);assert.equal((await API.weaponDungeonState(db,'u1',NOW)).tickets,2);
 assert.equal((await API.start(db,'u1',input('another-resume-id'),NOW)).id,first.id);
 assert.equal((await API.state(db,'u1',NOW,'pve')).id,ordinary.id);
 assert.equal((await API.state(db,'u1',NOW,'weapon-dungeon')).id,first.id);
 await assert.rejects(API.start(db,'u1',{...input('pvp-invalid-01'),mode:'pvp'},NOW),/單人/);
});
test('failed attempts spend one ticket each; retry receipts cannot spend twice even after a room finishes',async()=>{
 const db=database();
 for(let i=0;i<3;i++){
   const request=input('ticket-start-'+i),s=await API.start(db,'u1',request,NOW);
   await API.command(db,'u1',{roomId:s.id,type:'leave',requestId:'leave-room-'+i},NOW);
   assert.equal((await API.start(db,'u1',request,NOW)).id,s.id);
 }
 assert.equal((await API.weaponDungeonState(db,'u1',NOW)).tickets,0);
 await assert.rejects(API.start(db,'u1',input('exhausted-ticket'),NOW),/副本券不足/);
 assert.equal((await API.weaponDungeonState(db,'u1',NOW+86400000)).tickets,3);
});
test('the first weapon dungeon preserves a legacy unfinished trial with only a roomId pointer',async()=>{
 const db=database();own(db);
 const trial=await API.start(db,'u1',{mode:'pve'},NOW);
 delete db.records.get(API.PLAYERS+'/u1').roomIds;
 const weapon=await API.start(db,'u1',input('legacy-dungeon-start'),NOW);
 assert.equal((await API.state(db,'u1',NOW,'pve')).id,trial.id);
 assert.equal((await API.state(db,'u1',NOW,'weapon-dungeon')).id,weapon.id);
 assert.equal((await API.start(db,'u1',{mode:'pve'},NOW)).id,trial.id);
});
test('server victory unlocks exactly the next difficulty once and never advances the ordinary trial',async()=>{
 const db=database();own(db);
 const ordinary=await API.start(db,'u1',{mode:'pve'},NOW),campaign=structuredClone(db.records.get(API.PLAYERS+'/u1').trial);
 const s=await API.start(db,'u1',input(),NOW),raw=db.records.get(API.ROOMS+'/'+s.id);
 // Guards stay alive: killing only the lord is sufficient for progression.
 const guardCount=raw.actors.filter(a=>a.bot&&!a.weaponDungeonLord&&a.hp>0).length;
 assert(guardCount>=8);
 Object.assign(raw.actors[0],{x:6,y:3,stamina:10,answered:1,correct:1});raw.actors[1].hp=1;
 R.prepareIntents(raw);
 const command={roomId:s.id,type:'manual',skillId:'rock-fist',x:6,y:2,revision:raw.revision,requestId:'victory-cast-001'};
 const result=await API.command(db,'u1',command,NOW),saved=structuredClone(db.records);
 assert.equal(result.status,'finished');assert.equal(result.weaponDungeonResult.cleared,true);
 assert.equal((await API.weaponDungeonState(db,'u1',NOW)).unlocked,1);
 assert.deepEqual(db.records.get(API.PLAYERS+'/u1').trial,campaign);
 const repeat=await API.command(db,'u1',command,NOW);assert.deepEqual(repeat.manualDrops,result.manualDrops);
 assert.equal((await API.weaponDungeonState(db,'u1',NOW)).clears[0],1);
 assert.deepEqual(db.records.get(API.MANUALS+'/u1'),saved.get(API.MANUALS+'/u1'));
 assert.equal((await API.state(db,'u1',NOW,'pve')).id,ordinary.id);
 assert((await API.start(db,'u1',input('now-unlocked-room',1),NOW)).weaponDungeon.difficulty===1);
});
test('lord defeat immediately settles weapon dungeon, unlocks next difficulty and awards drop with guards alive and no answer',async()=>{
 const db=database();own(db);
 const started=await API.start(db,'u1',input('boss-only-completion-01'),NOW);
 const raw=db.records.get(API.ROOMS+'/'+started.id);
 raw.blocks=[];
 Object.assign(raw.actors[0],{x:6,y:3,stamina:10,answered:0,correct:0});
 raw.actors.find(a=>a.weaponDungeonLord).hp=1;
 const guardsAlive=raw.actors.filter(a=>a.bot&&!a.weaponDungeonLord&&a.hp>0).length;
 assert(guardsAlive>=8);
 R.prepareIntents(raw);
 const action={roomId:started.id,type:'manual',skillId:'rock-fist',x:6,y:2,
   revision:raw.revision,requestId:'boss-only-final-blow'};
 const settled=await API.command(db,'u1',action,NOW);
 assert.equal(settled.status,'finished');
 assert.equal(settled.winner,'player');
 assert.equal(settled.finishReason,'objective');
 assert.equal(settled.objective.completed,true);
 assert.equal(settled.actors.find(a=>a.weaponDungeonLord).hp,0);
 assert.equal(settled.actors.filter(a=>a.bot&&!a.weaponDungeonLord&&a.hp>0).length,guardsAlive);
 assert.equal(settled.actors[0].answered,0);
 assert.equal(settled.weaponDungeonResult.cleared,true);
 assert.equal(settled.weaponDungeonResult.newlyUnlocked,1);
 const progress=await API.weaponDungeonState(db,'u1',NOW);
 assert.equal(progress.unlocked,1);
 assert.equal(progress.clears[0],1);
 const replay=await API.command(db,'u1',action,NOW);
 assert.deepEqual(replay.weaponDungeonResult,settled.weaponDungeonResult);
 assert.equal((await API.weaponDungeonState(db,'u1',NOW)).clears[0],1);
});
test('all six difficulties unlock through actual winning commands and repeat settlement never adds a clear',async()=>{
 const db=database();own(db);
 for(let difficulty=0;difficulty<6;difficulty++){
   const now=NOW+Math.floor(difficulty/3)*86400000;
   if(difficulty<5)await assert.rejects(API.start(db,'u1',input('skip-tier-00'+difficulty,difficulty+1),now),/前一個難度/);
   const s=await API.start(db,'u1',input('clear-tier-00'+difficulty,difficulty),now);
   const raw=db.records.get(API.ROOMS+'/'+s.id);
   // Guards stay alive: killing only the lord is sufficient for progression.
 const guardCount=raw.actors.filter(a=>a.bot&&!a.weaponDungeonLord&&a.hp>0).length;
 assert(guardCount>=8);
   Object.assign(raw.actors[0],{x:6,y:3,stamina:10,answered:1,correct:1});raw.actors[1].hp=1;R.prepareIntents(raw);
   const command={roomId:s.id,type:'manual',skillId:'rock-fist',x:6,y:2,revision:raw.revision,requestId:'tier-win-000'+difficulty};
   const result=await API.command(db,'u1',command,now);
   assert.equal(result.weaponDungeonResult.cleared,true);
   await API.command(db,'u1',command,now);
   const progress=await API.weaponDungeonState(db,'u1',now);
   assert.equal(progress.unlocked,Math.min(5,difficulty+1));
   assert.deepEqual(progress.clears,Array.from({length:6},(_,i)=>Number(i<=difficulty)));
   assert.equal(progress.tickets,2-difficulty%3);
 }
});
test('zero-cultivation players may upgrade mastered weapon techniques and saved tier copies preserve XP',async()=>{
 const db=database();own(db);const user=db.records.get('users/u1');user.stats.totalScore=0;user.stats.gold=1000;
 const quote=M.skillUpgradeQuote(1);
 const result=await API.upgradeSkill(db,'u1',{skillId:'rock-break',targetLevel:2,expectedGold:quote.gold});
 assert.equal(result.skillLevels['rock-break'],2);
 assert.equal(result.library.find(b=>b.id==='body-rock').level,10);
 const record=M.normalize(db.records.get(API.MANUALS+'/u1'));
 Rewards.roll({weaponDungeon:W.selection({dungeonId:W.ID,difficulty:0})},'u1',record,()=>0);
 assert.equal(record.books['body-rock'].exp,M.totalExpForLevel(10));
});
test('exclusive reward roll has exactly 30/20/50 outcomes, including duplicates, and survives inventory normalization',()=>{
 const record=M.normalize({}),counts={current:0,next:0,none:0};
 for(let i=0;i<100;i++){
   const room={weaponDungeon:W.selection({dungeonId:W.ID,difficulty:0})};
   const drop=Rewards.roll(room,'u1',record,max=>max===100?i:0);
   counts[!drop?'none':drop.tierRealm==='築基'?'current':'next']++;
 }
 assert.deepEqual(counts,{current:30,next:20,none:50});
 const normalized=M.weaponize(record),copies=Object.values(normalized.books).reduce((n,b)=>n+Object.values(b.copies||{}).reduce((a,b)=>a+b,0),0);
 assert.equal(copies,50);
 const room={weaponDungeon:W.selection({dungeonId:W.ID,difficulty:5})};
 const drop=Rewards.roll(room,'u1',record,max=>max===100?30:0);assert.equal(drop,null);
 assert.ok(M.publicState(record).library.every(b=>b.tierRealm===M.BY_BOOK[b.id].tierRealm&&b.refinement===5));
});


test('earned weapon dungeon tickets survive daily refill above the cap',()=>{
 const now=NOW, day=W.day(now);
 const earned={tickets:12,grantDay:day,unlocked:2,clears:[1,1]};
 assert.equal(W.progress(earned,now).tickets,12);
 assert.equal(W.progress(earned,now+86400000).tickets,12);
 assert.equal(W.progress({...earned,tickets:4},now+86400000).tickets,5);
 assert.equal(W.progress(earned,now+86400000).unlocked,2);
});

test('resume-only request cannot create a new dungeon or consume tickets if room is missing or mismatched',async()=>{
 const db=database();own(db);
 await assert.rejects(API.start(db,'u1',{...input('resume-missing-001'),resumeRoomId:'arena-missing'},NOW),/原副本已結束或變更/);
 assert.equal((await API.weaponDungeonState(db,'u1',NOW)).tickets,3);
 const first=await API.start(db,'u1',input('resume-original-001'),NOW);
 await assert.rejects(API.start(db,'u1',{...input('resume-wrong-001'),resumeRoomId:'arena-wrong'},NOW),/原副本已結束或變更/);
 const again=await API.start(db,'u1',{...input('resume-correct-001'),resumeRoomId:first.id},NOW);
 assert.equal(again.id,first.id);assert.equal((await API.weaponDungeonState(db,'u1',NOW)).tickets,2);
});

test('preview pools contain precisely the live reward catalog, including empty tiers',async()=>{
 const db=database();own(db);
 const state=await API.weaponDungeonState(db,'u1',NOW);
 for(const realm of W.WEAPON_REALMS){
  assert.deepEqual(state.rewardPools[realm],M.BOOKS.filter(b=>b.tierRealm===realm&&b.weaponType==='sword').map(({id,name,tierRealm})=>({id,name,tierRealm})));
  assert.deepEqual(state.dungeons.find(d=>d.id===W.ID).rewardPools[realm],state.rewardPools[realm]);
 }
 assert.deepEqual(state.rewardPools['元嬰'],[]);
});

test('settlement retry is room-bound and idempotent; failed and repeated clears do not fake unlocks',async()=>{
 const db=database();own(db);
 const first=await API.start(db,'u1',input('settle-first-001'),NOW);
 const raw=db.records.get(API.ROOMS+'/'+first.id);raw.blocks=[];Object.assign(raw.actors[0],{x:6,y:3,stamina:10});raw.actors.find(a=>a.weaponDungeonLord).hp=1;R.prepareIntents(raw);
 const clear=await API.command(db,'u1',{roomId:first.id,type:'manual',skillId:'rock-fist',x:6,y:2,revision:raw.revision,requestId:'settle-kill-001'},NOW);
 assert.equal(clear.weaponDungeonResult.newlyUnlocked,1);
 const retry={...input('settle-retry-001'),retryFromRoomId:first.id};
 const second=await API.start(db,'u1',retry,NOW);const replay=await API.start(db,'u1',retry,NOW);
 assert.equal(second.id,replay.id);assert.notEqual(first.id,second.id);
 assert.equal((await API.weaponDungeonState(db,'u1',NOW)).tickets,1);
 await assert.rejects(API.start(db,'u1',{...input('settle-stale-001'),retryFromRoomId:first.id},NOW),/原結算已失效/);
 const loss=await API.command(db,'u1',{roomId:second.id,type:'leave',requestId:'settle-leave-001'},NOW);
 assert.equal(loss.weaponDungeonResult.cleared,false);assert.equal(loss.weaponDungeonResult.newlyUnlocked,null);assert.equal(loss.weaponDungeonResult.tickets,1);
 const third=await API.start(db,'u1',{...input('settle-retry-002'),retryFromRoomId:second.id},NOW);
 const raw3=db.records.get(API.ROOMS+'/'+third.id);raw3.blocks=[];Object.assign(raw3.actors[0],{x:6,y:3,stamina:10});raw3.actors.find(a=>a.weaponDungeonLord).hp=1;R.prepareIntents(raw3);
 const repeated=await API.command(db,'u1',{roomId:third.id,type:'manual',skillId:'rock-fist',x:6,y:2,revision:raw3.revision,requestId:'settle-kill-002'},NOW);
 assert.equal(repeated.weaponDungeonResult.newlyUnlocked,null);assert.equal(repeated.weaponDungeonResult.tickets,0);
 await assert.rejects(API.start(db,'u1',{...input('settle-retry-003'),retryFromRoomId:third.id},NOW),/副本券不足/);
 assert.deepEqual((await API.weaponDungeonState(db,'u1',NOW)).clears,[2,0,0,0,0,0]);
});

test('Peak Stone rolls only swords from the exact current or lower realm, including legacy rooms',()=>{
 for(let difficulty=0;difficulty<6;difficulty++){
  const info=W.selection({dungeonId:W.ID,difficulty});
  for(let roll=0;roll<100;roll++){
   const expectedRealm=roll<30?info.realm:['煉氣','築基','金丹','元嬰','化神','合體'][difficulty];
   const expected=roll>=50?[]:M.BOOKS.filter(b=>b.weaponType==='sword'&&b.tierRealm===expectedRealm);
   for(let index=0;index<Math.max(1,expected.length);index++){
    const room={weaponDungeon:{...info,nextRealm:'真仙',lowerRealm:'真仙',rewardWeaponType:'totem'}};
    if(index===0)delete room.weaponDungeon.id;
    const record=M.normalize({}),drop=Rewards.roll(room,'u1',record,max=>max===100?roll:index);
    assert.equal(drop?.id??null,expected[index]?.id??null);
    if(drop)assert.equal(M.BY_BOOK[drop.id].weaponType,'sword');
    assert.ok(Object.keys(record.books).every(id=>M.BY_BOOK[id].weaponType==='sword'));
   }
  }
 }
 assert.ok(Object.values(Rewards.previewPools(W.WEAPON_REALMS,'unknown')).every(pool=>pool.length===0));
});

test('Peak Stone legacy desert terrain is restored to grid-world stone without changing gameplay or other maps',async()=>{
 const db=database();own(db);
 const first=await API.start(db,'u1',input('stone-terrain-legacy'),NOW);
 const raw=db.records.get(API.ROOMS+'/'+first.id);
 raw.terrain=13;raw.ground=raw.ground.map(()=>13);
 const expected=JSON.parse(JSON.stringify(raw.actors));
 const resumed=await API.start(db,'u1',{...input('stone-terrain-resume'),resumeRoomId:first.id},NOW);
 assert.equal(resumed.id,first.id);assert.equal(resumed.terrain,16);assert.ok(resumed.ground.every(t=>t===16));
 // Public rooms deliberately omit the private knowledgeScope. Compare like
 // projections and separately assert the persisted actors are unchanged.
 assert.deepEqual(resumed.actors,first.actors);
 assert.deepEqual(db.records.get(API.ROOMS+'/'+first.id).actors,expected);
 assert.equal((await API.weaponDungeonState(db,'u1',NOW)).tickets,2);
 const ordinary={terrain:13,ground:[13,4]};assert.deepEqual(W.restoreTerrain(ordinary),{terrain:13,ground:[13,4]});
 const A=require('../public/cultivation/tactical-ambience.js');
 assert.equal(A.themeFor(resumed),'stone');assert.equal(A.themeFor(ordinary),'desert');
});

test('solo guards and 2x2 lords attack once, move one legal step, and warn again in the same window',()=>{
 for(const boss of [false,true]){
   let s=scene({boss,enemy:{x:4,y:4},player:{x:7,y:4}});
   assert.equal(s.actors[1].intent.kind,'attack');
   const hp=s.actors[0].hp;
   s=R.apply(s,'u1',{type:'end'},NOW);
   assert.equal(s.actors[0].hp,hp-100);
   assert.equal(s.actors[1].x,5);
   assert.equal(s.actors[1].intent.kind,'attack');
   assert.deepEqual(s.actors[1].intent.origin,{x:5,y:4});
   assert.ok(s.actors[1].intent.cells.some(p=>p.x===7&&p.y===4));
   const actions=s.events.filter(e=>e.actor==='beast'&&['monster-attack','monster-move'].includes(e.type));
   assert.deepEqual(actions.map(e=>e.type),['monster-attack','monster-move']);
   assert.ok(R.footprint(s.actors[1]).every(p=>!R.blocked(s,p)&&R.key(p)!==R.key(s.actors[0])));
   const saved=JSON.parse(JSON.stringify(s)),next=R.apply(saved,'u1',{type:'end'},NOW);
   assert.equal(next.actors[0].hp,hp-200);
   assert.deepEqual(next,R.apply(s,'u1',{type:'end'},NOW),'saved warning has the same deterministic result');
 }
});
test('solo pursuit and a missed attack move at most once and never deal an unannounced hit',()=>{
 let s=scene({enemy:{x:4,y:4},player:{x:8,y:4}});
 assert.equal(s.actors[1].intent.kind,'advance');
 s=R.apply(s,'u1',{type:'end'},NOW);
 assert.equal(s.actors[1].x,5);assert.equal(s.actors[1].intent.kind,'attack');
 assert.equal(s.actors[0].hp,10000);
 s=R.apply(s,'u1',{type:'move',x:9,y:4},NOW);
 assert.equal(s.actors[1].intent.cells.length,0);
 s=R.apply(s,'u1',{type:'end'},NOW);
 assert.equal(s.actors[1].x,6);assert.equal(s.actors[1].intent.kind,'attack');
 assert.equal(s.actors[0].hp,10000);
 s=R.apply(s,'u1',{type:'end'},NOW);
 assert.equal(s.actors[0].hp,9900);
});
test('solo stagger cancels the attack but resumes pursuit and preparation on the next action',()=>{
 let s=scene({enemy:{x:7,y:4},player:{x:6,y:4},skills:['rock-break']});
 s=R.apply(s,'u1',{type:'manual',skillId:'rock-break',x:7,y:4},NOW);
 const x=s.actors[1].x;assert.ok(x>7);assert.equal(s.actors[1].intent.kind,'stagger');
 s=R.apply(s,'u1',{type:'end'},NOW);
 assert.equal(s.actors[0].hp,10000);assert.equal(s.actors[1].x,x-1);
 assert.equal(s.actors[1].intent.kind,'attack');
});
test('solo blocked large lord can stay and warn without moving through a wall',()=>{
 let s=scene({boss:true,enemy:{x:4,y:4},player:{x:7,y:4}});
 s.blocks=[{x:3,y:4},{x:6,y:5},{x:4,y:3},{x:5,y:6}];
 s=R.apply(s,'u1',{type:'end'},NOW);
 assert.equal(s.actors[0].hp,9900);
 assert.deepEqual({x:s.actors[1].x,y:s.actors[1].y},{x:4,y:4});
 assert.equal(s.actors[1].intent.kind,'attack');
});
test('a lord killed by a counter ends the dungeon before it can move or the next guard can act',()=>{
 let s=scene({boss:true,enemy:{x:4,y:4},player:{x:7,y:4}});
 s.actors[1].hp=1;s.actors[0].counter=1;
 s.actors.push(R.actor({uid:'guard',bot:true,name:'守衛',species:8,team:'monster',atk:100,maxHp:10000,trackingAttack:true},{x:8,y:4}));
 R.prepareIntents(s);
 s=R.apply(s,'u1',{type:'end'},NOW);
 assert.equal(s.status,'finished');assert.equal(s.winner,s.actors[0].team);
 assert.equal(s.actors[1].hp,0);assert.equal(s.actors[1].x,4);
 assert.ok(!s.events.some(e=>e.actor==='guard'&&['monster-attack','monster-move'].includes(e.type)));
 assert.ok(!s.events.some(e=>e.actor==='beast'&&e.type==='monster-move'));
});

const enemySkill=(extra={})=>({id:'test-locked',name:'測試用靈獸技',shape:'line',range:4,power:1,warning:'locked',animation:'line',...extra});
function configuredScene(skill,options={}){
 const s=scene(options);
 s.actors[1].dungeonSkills=Array.isArray(skill)?skill:[skill];
 R.prepareIntents(s);return s;
}
test('configured enemy selects the first legal skill with difficulty and lord restrictions',()=>{
 const s=configuredScene([enemySkill({id:'later',minDifficulty:1}),enemySkill({id:'lord',lordOnly:true}),enemySkill({id:'short',range:1}),enemySkill({id:'legal'})]);
 assert.equal(s.actors[1].intent.skillId,'legal');
 assert.equal(s.actors[1].intent.warning,'locked');
 assert.ok(s.actors[1].intent.cells.some(p=>R.key(p)===R.key(s.actors[0])));
});
test('locked enemy warning survives movement and serialization; only advertised cells can hit',()=>{
 let s=configuredScene(enemySkill());
 const warning=JSON.parse(JSON.stringify(s.actors[1].intent));
 s=R.apply(s,'u1',{type:'move',x:6,y:5},NOW);
 assert.deepEqual(s.actors[1].intent,warning);
 const restored=JSON.parse(JSON.stringify(s));
 const next=R.apply(restored,'u1',{type:'end'},NOW);
 assert.equal(next.actors[0].hp,10000);
 assert.ok(next.events.some(e=>e.type==='dodge'&&e.actor==='u1'));
 assert.deepEqual(next,R.apply(s,'u1',{type:'end'},NOW));
});
test('tracking enemy preserves the selected skill, even when another skill would hit',()=>{
 let s=configuredScene([enemySkill({id:'tracking-line',warning:'tracking'}),enemySkill({id:'fallback',shape:'blast',radius:0})]);
 assert.equal(s.actors[1].intent.skillId,'tracking-line');
 s=R.apply(s,'u1',{type:'move',x:6,y:5},NOW);
 assert.equal(s.actors[1].intent.skillId,'tracking-line');
 assert.deepEqual(s.actors[1].intent.cells,[]);
 s=R.apply(s,'u1',{type:'end'},NOW);assert.equal(s.actors[0].hp,10000);
});
test('2x2 enemy line and square geometry include full front edge without duplicates or blocked tiles',()=>{
 const s=configuredScene(enemySkill(),{boss:true,enemy:{x:4,y:4},player:{x:7,y:5}});
 const m=s.actors[1],hero=s.actors[0];
 assert.ok(m.intent.cells.some(p=>p.x===6&&p.y===4));
 assert.ok(m.intent.cells.some(p=>p.x===6&&p.y===5));
 s.blocks=[{x:6,y:4}];
 const line=R.dungeonSkillPlan(s,m,hero,enemySkill());
 assert.ok(!line.cells.some(p=>p.y===4&&p.x>=6));
 const square=R.dungeonSkillPlan(s,m,hero,enemySkill({shape:'square',range:2,rings:2}));
 assert.equal(square.waves.length,2);
 assert.equal(new Set(square.cells.map(R.key)).size,square.cells.length);
 assert.ok(square.waves[0].cells.some(p=>p.x===6&&p.y===5));
 assert.ok(square.waves[1].cells.some(p=>p.x===7&&p.y===5));
 assert.ok(square.cells.every(p=>!R.blocked(s,p)&&!R.covers(m,p)));
});
test('configured displacement is saved and rechecks full occupancy; knockback interrupts locked warning',()=>{
 let s=configuredScene(enemySkill({moveSteps:2}),{boss:true,enemy:{x:4,y:4},player:{x:8,y:4}});
 assert.deepEqual(s.actors[1].intent.path,[{x:5,y:4},{x:6,y:4}]);
 s.blocks=[{x:7,y:5}];
 s=R.apply(s,'u1',{type:'end'},NOW);
 assert.ok(R.footprint(s.actors[1]).every(p=>!R.blocked(s,p)&&R.key(p)!==R.key(s.actors[0])));
 assert.ok(s.actors[1].x<=5);
 s=configuredScene(enemySkill(),{enemy:{x:7,y:4},player:{x:6,y:4},skills:['rock-break']});
 s=R.apply(s,'u1',{type:'manual',skillId:'rock-break',x:7,y:4},NOW);
 assert.equal(s.actors[1].intent.kind,'stagger');
 assert.deepEqual(s.actors[1].intent.cells,[]);
 const hp=s.actors[0].hp;s=R.apply(s,'u1',{type:'end'},NOW);
 assert.equal(s.actors[0].hp,hp);
});
test('legacy v2 prepared stone warning still resolves once after reload without resetting the room',()=>{
 let s=scene();const m=s.actors[1];
 m.intent={version:2,kind:'attack',cells:[{x:6,y:4}],origin:{x:4,y:4},target:{x:6,y:4},shape:'blast',power:1,tracking:true,slow:false,push:0,text:'舊預告'};
 s=R.apply(JSON.parse(JSON.stringify(s)),'u1',{type:'end'},NOW);
 assert.equal(s.actors[0].hp,9900);assert.equal(s.actors[1].intent.version,3);
 assert.equal(s.actors[1].intent.skillId,'stone-fall');
});

test('new Peak Stone layouts assign distinct sword techniques to guards and all four to the lord',()=>{
 for(let difficulty=0;difficulty<6;difficulty++){
  const s=R.create({id:'swords',players:[hero()],trial:{seed:'swords',weaponDungeon:{difficulty}},now:NOW});
  const lord=s.actors[1],guards=s.actors.slice(2);
  assert.deepEqual(new Set(lord.dungeonSkills.map(sk=>sk.id)),new Set(Object.values(W.PEAK_SKILLS).map(sk=>sk.id)));
  assert.ok(guards.every(m=>m.dungeonSkills.length===2&&!m.dungeonSkills.some(sk=>sk.lordOnly)));
  assert.ok(guards.some(m=>m.dungeonSkills.some(sk=>sk.id===W.PEAK_SKILLS.line.id)));
  assert.ok(guards.some(m=>m.dungeonSkills.some(sk=>sk.id===W.PEAK_SKILLS.thrust.id)));
  assert.equal(s.width,13);assert.equal(s.height,21);assert.equal(s.weaponDungeon.totemDamageMultiplier,1.15);
 }
});
test('all four Peak Stone sword skills use published cells, real damage and committed animation identifiers',()=>{
 for(const [name,sk] of Object.entries(W.PEAK_SKILLS)){
  const options={boss:name==='rain',enemy:{x:4,y:4},player:{x:7,y:4}};
  let s=configuredScene(sk,options);
  const intent=s.actors[1].intent;assert.equal(intent.skillId,sk.id);
  assert.ok(intent.cells.some(q=>R.key(q)===R.key(s.actors[0])));
  const before=JSON.parse(JSON.stringify(s));
  s=R.apply(s,'u1',{type:'end'},NOW);
  assert.equal(s.actors[0].hp,9900);
  const cast=s.events.find(ev=>ev.type==='monster-attack'&&ev.actor==='beast');
  assert.equal(cast.skill,sk.id);assert.deepEqual(cast.animation.cells,intent.cells);
  const animation=require('../public/cultivation/tactical-animation.js');
  const plan=animation.plan(before,s,'u1');
  assert.ok(plan.some(scene=>scene.skill===sk.id&&scene.kind==='cast'));
  if(name==='thrust'){
   const dash=s.events.find(ev=>ev.type==='displace'&&ev.actor==='beast');
   assert.deepEqual(dash.path,[{x:4,y:4},{x:5,y:4},{x:6,y:4}]);
   assert.equal(s.actors[1].x,6);
   assert.ok(plan.some(scene=>scene.kind==='move'&&scene.visualSkill===sk.id&&scene.moves.some(m=>m.uid==='beast'&&m.path.length===3)));
  }
 }
});
test('sword line tracks a new legal cardinal direction but cannot turn a corner or cross walls',()=>{
 const sk=W.PEAK_SKILLS.line;
 let s=configuredScene(sk,{enemy:{x:4,y:4},player:{x:7,y:4}});
 s=R.apply(s,'u1',{type:'move',x:4,y:7},NOW);
 assert.equal(s.actors[1].intent.skillId,sk.id);
 assert.deepEqual(s.actors[1].intent.direction,{x:0,y:1});
 s=R.apply(s,'u1',{type:'move',x:5,y:7},NOW);
 assert.equal(s.actors[1].intent.cells.length,0);
 assert.equal(R.apply(s,'u1',{type:'end'},NOW).actors[0].hp,10000);
 s=configuredScene(sk,{enemy:{x:4,y:4},player:{x:7,y:4}});
 s.blocks=[{x:5,y:4}];R.prepareIntents(s);
 assert.equal(s.actors[1].intent.kind,'advance');
});
test('sweep follows lateral steps, lord rain is finite, and all sword warnings can be interrupted',()=>{
 let s=configuredScene(W.PEAK_SKILLS.sweep,{enemy:{x:4,y:4},player:{x:6,y:4}});
 s=R.apply(s,'u1',{type:'move',x:6,y:5},NOW);
 assert.ok(s.actors[1].intent.cells.some(q=>R.key(q)===R.key(s.actors[0])));
 const rain=configuredScene(W.PEAK_SKILLS.rain,{boss:true,enemy:{x:4,y:4},player:{x:7,y:4}});
 assert.equal(rain.actors[1].intent.cells.length,12); // one body tile is excluded
 for(const [name,sk] of Object.entries(W.PEAK_SKILLS)){
  const boss=name==='rain',enemy={x:7,y:4},player={x:name==='thrust'?5:6,y:4};
  let st=configuredScene(sk,{boss,enemy,player,skills:['rock-break']});
  assert.equal(st.actors[1].intent.kind,'attack');
  // The fist selects the adjacent direction tile, not the distant victim.
  const aim={x:player.x+1,y:player.y};
  assert.ok(R.aimCells(st,st.actors[0],R.manualSkillFor(st.actors[0],'rock-break')).some(p=>R.key(p)===R.key(aim)));
  st=R.apply(st,'u1',{type:'manual',skillId:'rock-break',...aim},NOW);
  assert.ok(st.actors[1].x>enemy.x,'every sword skill must be interrupted by actual displacement');
  assert.equal(st.actors[1].intent.kind,'stagger');
  assert.equal(R.apply(st,'u1',{type:'end'},NOW).actors[0].hp,10000);
 }
});
test('large thrust cannot cross a blocked body lane or another beast, and saved warning resolves deterministically',()=>{
 const sk=W.PEAK_SKILLS.thrust,options={boss:true,enemy:{x:4,y:4},player:{x:8,y:4}};
 let s=configuredScene(sk,options);
 assert.equal(s.actors[1].intent.path.length,2);
 const saved=JSON.parse(JSON.stringify(s));assert.deepEqual(R.apply(saved,'u1',{type:'end'},NOW),R.apply(s,'u1',{type:'end'},NOW));
 s.blocks=[{x:6,y:5}];R.prepareIntents(s);assert.equal(s.actors[1].intent.kind,'advance');
 s=configuredScene(sk,options);
 const blocker=R.actor({uid:'blocker',bot:true,team:'monster',species:8,atk:1,maxHp:1000,dungeonSkills:[]},{x:6,y:5});
 s.actors.push(blocker);
 const next=R.apply(s,'u1',{type:'end'},NOW);
 assert.equal(next.actors[0].hp,10000);
 assert.ok(R.footprint(next.actors[1]).every(q=>!R.blocked(next,q)&&!R.covers(next.actors[2],q)));
});
test('the next legal sword rotates after a cast without changing the already announced skill',()=>{
 const skills=[W.PEAK_SKILLS.line,W.PEAK_SKILLS.sweep];
 let s=configuredScene(skills,{enemy:{x:4,y:4},player:{x:7,y:4}});
 assert.equal(s.actors[1].intent.skillId,skills[0].id);
 s=R.apply(s,'u1',{type:'end'},NOW);
 assert.equal(s.actors[1].lastDungeonSkill,skills[0].id);
 assert.equal(s.actors[1].intent.skillId,skills[1].id);
});
