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
test('six sequential difficulty tiers omit 煉虛 and end at 渡劫; next-tier drop above that is 真仙',()=>{
 assert.deepEqual(W.DIFFICULTIES.map(d=>d.name),['築基','金丹','元嬰','化神','合體','渡劫']);
 assert.equal(W.selection({dungeonId:W.ID,difficulty:5}).nextRealm,'真仙');
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
 for(const [tracking,skill,expected]of [[true,'rock-fist',276],[false,'rock-fist',240],[true,'wind-slash',230]]){
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
 const drop=Rewards.roll(room,'u1',record,max=>max===100?30:0);assert.equal(drop.tierRealm,'真仙');
 const id=drop.id;const low={weaponDungeon:W.selection({dungeonId:W.ID,difficulty:0})};
 Rewards.roll(low,'u1',record,()=>0);
 assert.equal(M.publicState(record).library.find(b=>b.id===id).tierRealm,'真仙');
});
