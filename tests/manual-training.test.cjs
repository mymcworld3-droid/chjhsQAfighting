'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Catalog=require('../public/cultivation/manual-rules.js');
const R=require('../public/cultivation/tactical-rules.js');
const API=require('../tactical-combat-api.cjs').__test;
const {database}=require('./helpers/tactical-db.cjs');
const now=2000000000000;
const bookRecord=db=>db.records.get(API.MANUALS+'/u1');
const lowBeast=(id,x,y,hp=80,level=1)=>R.actor({
  uid:id,name:id,bot:true,team:'monster',atk:15,maxHp:hp,level
},{x,y});

test('each of the six manuals has exactly three skills unlocked at Lv.1 / Lv.5 / Lv.10',()=>{
  assert.equal(Catalog.BOOKS.length,6);
  assert.equal(Catalog.BOOKS.filter(book=>book.school==='sword').length,3);
  assert.equal(Catalog.BOOKS.filter(book=>book.school==='body').length,3);
  for(const book of Catalog.BOOKS){
    assert.equal(book.skills.length,3);
    assert.deepEqual(book.skills.map(skill=>skill.levelRequired),[1,5,10]);
  }
  assert.equal(Catalog.EXP_PER_KILL,50);
});

test('XP required increases with every level and exact level boundaries are respected',()=>{
  assert.deepEqual([1,2,3,4,5].map(Catalog.xpForNextLevel),[40,60,80,100,120]);
  for(let level=1;level<=100;level++){
    const next=Catalog.totalExpForLevel(level);
    assert.equal(Catalog.levelForExp(next),level);
    assert.equal(Catalog.mastery(next).expInLevel,0);
    if(level>1)assert.equal(Catalog.levelForExp(next-1),level-1);
    assert(Catalog.xpForNextLevel(level+1)>Catalog.xpForNextLevel(level));
  }
  assert.equal(Catalog.totalExpForLevel(5),280);
  assert.equal(Catalog.totalExpForLevel(10),1080);
  assert.equal(Catalog.levelForExp(279),4);
  assert.equal(Catalog.levelForExp(1079),9);
  const raw={school:'sword',books:{'sword-wind':{exp:280}},
    equipped:['wind-slash','wind-step','wind-thousand']};
  assert.deepEqual(Catalog.normalize(raw).equipped,['wind-slash','wind-step']);
  raw.books['sword-wind'].exp=1080;
  assert.deepEqual(Catalog.normalize(raw).equipped,['wind-slash','wind-step','wind-thousand']);
});

test('only owned manuals are returned, and legacy kill records retain their unlocked skills',()=>{
  assert.equal(Catalog.publicState(null).library.length,0);
  const legacy={version:1,school:'sword',
    books:{'sword-wind':{kills:8},'body-rock':{kills:3}},
    equipped:['wind-slash','wind-step','wind-thousand','wind-slash']};
  const normalized=Catalog.normalize(legacy);
  assert.equal(normalized.version,2);
  assert.equal(normalized.books['sword-wind'].exp,1080);
  assert.equal(normalized.books['body-rock'].exp,280);
  assert.deepEqual(normalized.equipped,['wind-slash','wind-step','wind-thousand']);
  assert.equal(Catalog.normalize(normalized).books['sword-wind'].exp,1080);
  const visible=Catalog.publicState(legacy);
  assert.equal(visible.library.length,2);
  assert(visible.library.every(book=>book.owned&&book.level>=5));
  assert.equal(visible.library.find(book=>book.id==='sword-wind').level,10);
});

test('school selection grants one starter manual and switching does not duplicate its grant',async()=>{
  const db=database();
  const first=await API.chooseSchool(db,'u1',{school:'sword'});
  assert.equal(first.school,'sword');
  assert.equal(first.library.length,1,'unobtained manuals stay hidden');
  assert.equal(first.library[0].id,'sword-wind');
  assert.equal(first.library[0].level,1);
  assert.deepEqual(first.equipped,['wind-slash']);
  const second=await API.chooseSchool(db,'u1',{school:'body'});
  assert.equal(second.school,'body');
  assert.equal(second.library.length,1);
  assert.deepEqual(second.equipped,['wind-slash'],'cross-school skills remain selectable');
  assert.equal(bookRecord(db).starterClaimed,true);
  assert.deepEqual(bookRecord(db).books['sword-wind'],{exp:0});
});

test('server rejects unowned, locked, duplicate and four-slot loadouts',async()=>{
  const db=database();await API.chooseSchool(db,'u1',{school:'body'});
  await assert.rejects(API.equipManualSkills(db,'u1',{skillIds:['rock-break']}),/尚未解鎖/);
  await assert.rejects(API.equipManualSkills(db,'u1',{skillIds:['wind-slash']}),/尚未解鎖/);
  await assert.rejects(API.equipManualSkills(db,'u1',{skillIds:['rock-fist','rock-fist']}),/不重複/);
  await assert.rejects(API.equipManualSkills(db,'u1',{skillIds:['a','b','c','d']}),/最多/);
  const state=await API.equipManualSkills(db,'u1',{skillIds:[]});
  assert.equal(state.equipped.length,0);
  assert.equal((await API.manualsState(db,'u2')).library.length,0);
});

test('only equipped manual killing blows grant EXP, once per idempotent request',async()=>{
  const db=database();await API.chooseSchool(db,'u1',{school:'sword'});
  const state=await API.start(db,'u1',{mode:'pve'},now),raw=db.records.get(API.ROOMS+'/'+state.id);
  raw.blocks=[];Object.assign(raw.actors[0],{x:1,y:3,stamina:10});
  raw.actors=[raw.actors[0],lowBeast('m1',2,3),lowBeast('m2',3,3),lowBeast('m3',4,3),lowBeast('keep',6,6,1000)];
  const request={roomId:state.id,revision:state.revision,requestId:'manual-kill-once-01',
    type:'manual',skillId:'wind-slash',x:2,y:3};
  const first=await API.command(db,'u1',request,now);
  assert.equal(first.manualExp.u1['sword-wind'],150);
  assert.equal(bookRecord(db).books['sword-wind'].exp,150);
  assert.equal(Catalog.mastery(150).level,3);
  assert.equal(first.actors[0].stamina,8,'first manual technique costs two stamina');
  const again=await API.command(db,'u1',request,now);
  assert.equal(again.manualExp.u1['sword-wind'],150);
  assert.equal(bookRecord(db).books['sword-wind'].exp,150);
  await assert.rejects(API.command(db,'u1',{...request,requestId:'manual-forged-02',
    skillId:'wind-thousand',revision:first.revision},now),/尚未裝備/);
  assert.equal(bookRecord(db).books['sword-wind'].exp,150);
});

test('per-skill realm requirements are independent of manual level, using current cultivation realm cutoffs',()=>{
  const first=Catalog.BY_SKILL['wind-slash'],second=Catalog.BY_SKILL['wind-step'],
    third=Catalog.BY_SKILL['wind-thousand'],advanced=Catalog.BY_SKILL['sky-pierce'];
  assert.deepEqual([first.realmRequired,second.realmRequired,third.realmRequired],[1,6,28]);
  assert.deepEqual(Catalog.BY_BOOK['sword-sky'].skills.map(s=>s.realmRequired),[6,28,68]);
  assert.deepEqual(Catalog.BY_BOOK['body-dragon'].skills.map(s=>s.realmRequired),[6,28,68]);
  assert.equal(Catalog.meetsRealm(first,0),false);
  assert.equal(Catalog.meetsRealm(first,1),true);
  assert.equal(Catalog.realmForScore(0).name,'凡人');
  assert.equal(Catalog.meetsRealm(second,5),false);
  assert.equal(Catalog.meetsRealm(second,6),true);
  assert.equal(Catalog.meetsRealm(third,27),false);
  assert.equal(Catalog.meetsRealm(third,28),true);
  assert.equal(Catalog.meetsRealm(advanced,5),false);
  assert.equal(Catalog.meetsRealm(advanced,6),true);
  const state={books:{'sword-sky':{exp:1080}},equipped:['sky-pierce','sky-cloud','sky-sever']};
  const low=Catalog.publicState(state,5);
  assert.equal(low.library[0].skills[0].unlocked,false);
  assert.equal(low.library[0].skills[0].mastered,true);
  assert.equal(low.library[0].skills[0].realmReady,false);
  const intermediate=Catalog.publicState(state,28);
  assert.deepEqual(intermediate.library[0].skills.map(s=>s.unlocked),[true,true,false]);
  assert.deepEqual(Catalog.publicState(state,68).library[0].skills.map(s=>s.unlocked),[true,true,true]);
  assert.equal(R.manualSkillFor({manualSkills:['sky-pierce'],trainingAccessScore:5},'sky-pierce'),null);
  assert.equal(R.manualSkillFor({manualSkills:['sky-pierce'],trainingAccessScore:6},'sky-pierce')?.id,'sky-pierce');
});
test('spirit-beast realm rewards grow by trial stage, while the Lv. 5 and 10 EXP formula stays intact',()=>{
  assert.deepEqual(Catalog.REALMS.map(r=>r.exp),[50,70,100,140,190,250,330,430,550]);
  assert.deepEqual(Catalog.REALMS.map(r=>r.stage),[1,5,10,20,35,55,80,110,150]);
  for(let i=0;i<Catalog.REALMS.length;i++){
    const realm=Catalog.REALMS[i],upper=Catalog.REALMS[i+1];
    assert.equal(Catalog.expForBeast(realm.stage),realm.exp);
    assert.equal(Catalog.realmForStage(realm.stage).name,realm.name);
    if(upper)assert.equal(Catalog.expForBeast(upper.stage-1),realm.exp);
    if(upper)assert(upper.exp>realm.exp);
  }
  assert.equal(Catalog.totalExpForLevel(5),280);
  assert.equal(Catalog.totalExpForLevel(10),1080);
});
test('server blocks early skill equipment even when manual XP is high',async()=>{
  const db=database();
  await API.chooseSchool(db,'u1',{school:'sword'});
  const user=db.records.get('users/u1'),manual=db.records.get(API.MANUALS+'/u1');
  manual.books['sword-sky']={exp:1080};
  user.stats.totalScore=5;
  await assert.rejects(API.equipManualSkills(db,'u1',{skillIds:['sky-pierce']}),/境界未達/);
  user.stats.totalScore=6;
  assert.deepEqual((await API.equipManualSkills(db,'u1',{skillIds:['sky-pierce']})).equipped,['sky-pierce']);
  await assert.rejects(API.equipManualSkills(db,'u1',{skillIds:['sky-cloud']}),/境界未達/);
  user.stats.totalScore=28;
  assert.deepEqual((await API.equipManualSkills(db,'u1',{skillIds:['sky-cloud']})).equipped,['sky-cloud']);
  await assert.rejects(API.equipManualSkills(db,'u1',{skillIds:['sky-sever']}),/境界未達/);
  user.stats.totalScore=68;
  assert.deepEqual((await API.equipManualSkills(db,'u1',{skillIds:['sky-sever']})).equipped,['sky-sever']);
});
test('real battle killing blows award the sum of each defeated beast realm XP',()=>{
  const s=R.create({id:'arena-0123456789abcdef',mode:'pve',
    players:[{uid:'u1',name:'u1',atk:200,maxHp:1000,
      trainingAccessScore:28,manualSkills:['wind-slash']}],now});
  s.blocks=[];Object.assign(s.actors[0],{x:1,y:3,stamina:10});
  s.actors=[s.actors[0],lowBeast('low',2,3,80,1),
    lowBeast('mid',3,3,80,5),lowBeast('high',4,3,80,20),
    lowBeast('spare',6,6,1200,20)];
  const after=R.apply(s,'u1',{type:'manual',skillId:'wind-slash',x:2,y:3},now);
  assert.equal(after.manualExp.u1['sword-wind'],260);
  assert.equal(after.manualKills,undefined,'new battles use EXP receipts, not kill counts');
  assert.deepEqual(after.events.filter(e=>e.type==='manual-mastery').map(e=>e.exp),[50,70,140]);
});
test('battle authority refuses equipped skills when actor realm is too low',()=>{
  const s=R.create({id:'arena-0123456789abcdef',mode:'pve',
    players:[{uid:'u1',name:'u1',atk:200,maxHp:1000,
      trainingAccessScore:5,manualSkills:['sky-pierce']}],now});
  s.blocks=[];Object.assign(s.actors[0],{x:1,y:3,stamina:10});
  s.actors=[s.actors[0],lowBeast('low',2,3)];
  assert.throws(()=>R.apply(s,'u1',{type:'manual',skillId:'sky-pierce',x:2,y:3},now),
    /尚未裝備|尚未解鎖/);
  s.actors[0].trainingAccessScore=6;
  const after=R.apply(s,'u1',{type:'manual',skillId:'sky-pierce',x:2,y:3},now);
  assert(after.manualExp.u1['sword-sky']>0);
});
test('cumulative kill receipts translate into XP, unlocking Lv.5 and Lv.10 without duplication',()=>{
  const raw={version:2,books:{'sword-wind':{exp:0}},equipped:['wind-slash']};
  const battle={manualKills:{u1:{'sword-wind':6}}};
  const first=API.applyManualKills(battle,'u1',raw);
  assert(first.changed);
  assert.equal(first.state.books['sword-wind'].exp,300);
  assert.equal(Catalog.levelForExp(300),5);
  assert(Catalog.unlocked(first.state,'wind-step'));
  assert(!Catalog.unlocked(first.state,'wind-thousand'));
  const replay=API.applyManualKills(battle,'u1',first.state);
  assert.equal(replay.changed,false);
  assert.equal(replay.state.books['sword-wind'].exp,300);
  battle.manualKills.u1['sword-wind']=22;
  const maxed=API.applyManualKills(battle,'u1',replay.state);
  assert.equal(maxed.state.books['sword-wind'].exp,1100);
  assert.equal(Catalog.levelForExp(1100),10);
  assert(Catalog.unlocked(maxed.state,'wind-thousand'));
});

test('modern XP receipts aggregate different beast realms and reject double awards',()=>{
  const state={version:2,books:{'sword-wind':{exp:0}},equipped:['wind-slash']};
  const room={manualExp:{u1:{'sword-wind':50+70+140}}};
  const first=API.applyManualKills(room,'u1',state);
  assert.equal(first.state.books['sword-wind'].exp,260);
  assert.equal(first.changed,true);
  const second=API.applyManualKills(room,'u1',first.state);
  assert.equal(second.changed,false);
  assert.equal(second.state.books['sword-wind'].exp,260);
  room.manualExp.u1['sword-wind']+=100;
  const third=API.applyManualKills(room,'u1',second.state);
  assert.equal(third.state.books['sword-wind'].exp,360);
  assert.equal(Catalog.levelForExp(360),5);
});
test('equipped manuals replace basic attack and golden-core commands are retired',()=>{
  const s=R.create({id:'arena-0123456789abcdef',mode:'pve',
    players:[{uid:'u1',name:'u1',atk:200,maxHp:1000,trainingAccessScore:1,
      manualSkills:['rock-fist']}],now});
  s.blocks=[];Object.assign(s.actors[0],{x:1,y:3,stamina:10});
  s.actors=[s.actors[0],lowBeast('weak',2,3),lowBeast('far',6,6,900)];
  assert.throws(()=>R.apply(s,'u1',{type:'attack',x:2,y:3},now),/普通攻擊已被替換/);
  assert.throws(()=>R.apply(s,'u1',{type:'skill',x:2,y:3},now),/金丹技能已停用/);
  assert.equal(s.manualExp,undefined);
  const killed=R.apply(s,'u1',{type:'manual',skillId:'rock-fist',x:2,y:3},now);
  assert.equal(killed.manualExp.u1['body-rock'],50);
  assert.equal(killed.actors[0].stamina,8,'first manual skill costs 2');
});

test('trial clear awards a fresh manual with zero EXP, once, in the same transaction',async()=>{
  const db=database();
  await API.chooseSchool(db,'u1',{school:'body'});
  const ref=API.MANUALS+'/u1';db.records.get(ref).dropMisses=3;
  const state=await API.start(db,'u1',{mode:'pve'},now),raw=db.records.get(API.ROOMS+'/'+state.id);
  raw.blocks=[];Object.assign(raw.actors[0],{x:1,y:3,stamina:10,correct:1});
  raw.actors=[raw.actors[0],lowBeast('last',2,3)];
  const request={roomId:state.id,revision:state.revision,requestId:'manual-clear-0001',
    type:'manual',skillId:'rock-fist',x:2,y:3};
  const complete=await API.command(db,'u1',request,now);
  assert.equal(complete.status,'finished');
  const drop=complete.manualDrops?.u1;
  assert.ok(drop?.id&&drop?.name);
  assert.equal(bookRecord(db).books[drop.id].exp,0);
  const count=Object.keys(bookRecord(db).books).length;
  const replay=await API.command(db,'u1',request,now);
  assert.equal(replay.manualDrops?.u1?.id,drop.id);
  assert.equal(Object.keys(bookRecord(db).books).length,count);
  assert.equal(db.records.get(API.PLAYERS+'/u1').trial.stage,2);
  assert.equal(db.records.get('users/u1').stats.gold,35);
});

test('the original sword manuals retain their save slots while shared techniques use one slot',async()=>{
  const db=database(),ref=API.MANUALS+'/u1';
  db.records.get('users/u1').stats.totalScore=68;
  const owned={'sword-wind':{exp:1080},'sword-sky':{exp:1080},'sword-flight':{exp:1080}};
  db.records.set(ref,{version:2,books:owned,equipped:['wind-slash','wind-step','sky-sever']});
  const state=await API.manualsState(db,'u1');
  assert.deepEqual(state.equipped,['wind-slash','wind-step','sky-sever']);
  assert.deepEqual(state.library.map(book=>[book.name,...book.skills.map(skill=>skill.name)]),[
    ['流風劍訣','流風斬','突進橫斬','遠線破擊'],
    ['御劍真訣','流風斬','召劍','遠線破擊'],
    ['八方劍典','流風斬','交叉劍斬','八方合劍']
  ]);
  await assert.rejects(API.equipManualSkills(db,'u1',{skillIds:['wind-slash','sky-pierce']}),/相同招式/);
  await assert.rejects(API.equipManualSkills(db,'u1',{skillIds:['wind-thousand','flight-break']}),/相同招式/);
  await API.equipManualSkills(db,'u1',{skillIds:['flight-slash']});
  const battle=await API.start(db,'u1',{mode:'pve'},now);
  const raw=db.records.get(API.ROOMS+'/'+battle.id),hero=raw.actors[0];
  raw.blocks=[];Object.assign(hero,{x:1,y:3,stamina:10});
  raw.actors=[hero,lowBeast('beast',2,3,1)];
  const result=await API.command(db,'u1',{type:'manual',skillId:'flight-slash',x:2,y:3,
    roomId:battle.id,revision:battle.revision,requestId:'shared-sword-source-01'},now);
  assert.deepEqual(result.manualExp.u1,{'sword-flight':50});
});

function swordBattle(skillId,beasts){
  const battle=R.create({id:'arena-sword-manuals',mode:'pve',
    players:[{uid:'u1',atk:100,maxHp:1000,trainingAccessScore:68,manualSkills:[skillId]}],now});
  const hero=battle.actors[0];
  battle.width=12;battle.height=9;battle.blocks=[];
  Object.assign(hero,{x:1,y:4,stamina:10});
  battle.actors=[hero,...beasts];
  return battle;
}
const castSword=(battle,skillId,x,y)=>R.apply(battle,'u1',{type:'manual',skillId,x,y},now);

test('flying sword persists, crosses enemies on its own path and can be used twice in a turn',()=>{
  const skill='flight-summon',battle=swordBattle(skill,[lowBeast('m1',5,4,500),lowBeast('m2',7,4,500)]);
  battle.blocks=[{x:8,y:4}];
  const summoned=castSword(battle,skill,4,4);
  assert.deepEqual(summoned.actors[0].flyingSword,{x:4,y:4});
  assert.equal(summoned.actors[0].stamina,7);
  assert.equal(summoned.actors[1].hp,500);
  assert.throws(()=>castSword(summoned,skill,8,4),/直線地格/);
  const moved=castSword(summoned,skill,7,4);
  assert.deepEqual(moved.actors[0].flyingSword,{x:7,y:4});
  assert.equal(moved.actors[0].stamina,4);
  assert.deepEqual(moved.actors.slice(1).map(a=>a.hp),[390,390]);
  assert.throws(()=>castSword(moved,skill,6,4),/兩次/);
  const scenes=require('../public/cultivation/tactical-animation.js').plan(summoned,moved,'u1');
  assert.deepEqual(scenes[0].origin,{x:4,y:4});
  assert.deepEqual(scenes[0].after[0].flyingSword,{x:7,y:4});
});

test('dash cleave previews a clear landing and strikes the next row in two hits',()=>{
  const skill='wind-step',battle=swordBattle(skill,[
    lowBeast('center',6,4,500),lowBeast('side',6,3,500),lowBeast('outside',7,4,500)]);
  const hero=battle.actors[0],technique=Catalog.BY_SKILL[skill],landing={x:5,y:4};
  assert.deepEqual(R.skillCells(battle,hero,technique,landing),[{x:6,y:3},{x:6,y:4},{x:6,y:5}]);
  assert.throws(()=>castSword(battle,skill,6,4),/可突進/);
  const after=castSword(battle,skill,5,4);
  assert.deepEqual([after.actors[0].x,after.actors[0].y,after.actors[0].stamina],[5,4,5]);
  assert.deepEqual(after.actors.slice(1).map(a=>a.hp),[320,320,500]);
  assert.equal(after.events.filter(e=>e.type==='damage'&&e.target==='center').length,2);
  assert.equal(after.events.find(e=>e.animation?.style==='dash').path.length,5);
});

test('sword arrays draw nine and twenty-one cells and resolve the center in multiple hits',()=>{
  for(const [skill,size,hits,centerHP] of [['sky-cloud',9,2,340],['sky-sever',21,8,260]]){
    const battle=swordBattle(skill,[lowBeast('center',4,4,500),lowBeast('diagonal',6,6,500)]);
    const technique=Catalog.BY_SKILL[skill],center={x:4,y:4};
    assert.equal(R.skillCells(battle,battle.actors[0],technique,center).length,size);
    const after=castSword(battle,skill,center.x,center.y);
    assert.equal(after.actors[1].hp,centerHP);
    assert.equal(after.events.filter(e=>e.type==='damage'&&e.target==='center').length,hits);
    assert.equal(after.events.filter(e=>e.type==='damage'&&e.target==='diagonal').length,1);
    const scenes=require('../public/cultivation/tactical-animation.js').plan(battle,after,'u1');
    const centerNumbers=scenes.find(scene=>scene.numbers.some(number=>number.uid==='center')).numbers.find(number=>number.uid==='center');
    assert.deepEqual([centerNumbers.damage,centerNumbers.hits],[500-centerHP,hits]);
    battle.blocks=[{x:5,y:5}];
    assert(!R.skillCells(battle,battle.actors[0],technique,center).some(p=>p.x===6&&p.y===6));
  }
});

test('far break reaches beyond four cells and pushes survivors farthest first up to stone or edge',()=>{
  for(const [blocks,edge] of [[[],11],[[{x:10,y:4}],9]]){
    const skill='wind-thousand',battle=swordBattle(skill,[
      lowBeast('near',3,4,500),lowBeast('far',8,4,500),lowBeast('other-row',9,3,500)]);
    battle.blocks=blocks;
    const after=castSword(battle,skill,edge,4);
    assert.deepEqual(after.actors.slice(1).map(a=>[a.x,a.hp]),[[edge-1,350],[edge,350],[9,500]]);
    assert.deepEqual(after.events.filter(e=>e.animation?.style==='push').map(e=>e.actor),['far','near']);
  }
});

test('throw moves each enemy to its own rear tile and leaves blocked lanes in place',()=>{
  const id='tiger-throw',battle=swordBattle(id,[
    lowBeast('left',5,3,500),lowBeast('center',5,4,500),
    lowBeast('right',5,5,500),lowBeast('occupied',3,5,500)
  ]);
  const hero=battle.actors[0];hero.x=4;
  battle.blocks=[{x:3,y:3}];
  const preview=R.techniquePreview(battle,hero,Catalog.BY_SKILL[id],{x:5,y:4});
  assert.deepEqual(preview.landings,[{x:3,y:4}]);
  const result=castSword(battle,id,5,4);
  assert.deepEqual(result.actors.map(a=>[a.x,a.y]),[[4,4],[5,3],[3,4],[5,5],[3,5]]);
  assert.equal(result.actors[2].intent.kind,'stagger');
  assert.equal(result.actors[0].stamina,6);
  assert.equal(result.actors[2].hp,500);
});

test('fist advances stop against a wall or an enemy that cannot be pushed',()=>{
  const id='dragon-guard';
  for(const blocker of ['wall','enemy']){
    const battle=swordBattle(id,[lowBeast('front',2,4,500),lowBeast('spare',11,8,500)]);
    if(blocker==='wall')battle.blocks=[{x:3,y:4}];
    else battle.actors.push(lowBeast('blocker',3,4,500));
    const hero=battle.actors[0],preview=R.techniquePreview(battle,hero,Catalog.BY_SKILL[id],{x:2,y:4});
    assert.deepEqual(preview.path,[{x:1,y:4}]);
    assert.equal(battle.actors[1].hp,500,'preview leaves the room intact');
    const result=castSword(battle,id,2,4);
    assert.equal(result.actors[0].x,1);
    assert.equal(result.actors[1].x,2);
    assert.equal(result.actors[1].hp,455);
  }
});

test('four-step fist rechecks enemies and terrain after each step',()=>{
  const id='dragon-guard',battle=swordBattle(id,[
    lowBeast('center',2,4,500),lowBeast('side',2,5,500)
  ]);
  const hero=battle.actors[0],preview=R.techniquePreview(battle,hero,Catalog.BY_SKILL[id],{x:2,y:4});
  const result=castSword(battle,id,2,4);
  assert.deepEqual(result.actors.map(a=>a.x),[5,6,6]);
  assert.equal(preview.path.length,5);
  assert.equal(result.actors[0].attacks,1);
  assert.equal(result.actors[0].stamina,5);
  assert.deepEqual(result.actors.slice(1).map(a=>a.hp),[320,320]);
  assert.equal(result.events.filter(e=>e.type==='cast'&&e.skill===id).length,4);
});

test('T-shaped fists and the double strike match their preview and directional push',()=>{
  const dash='rock-quake',battle=swordBattle(dash,[lowBeast('m',6,5,500)]);
  assert.deepEqual(R.skillCells(battle,battle.actors[0],Catalog.BY_SKILL[dash],{x:4,y:4}),
    [{x:5,y:4},{x:6,y:3},{x:6,y:4},{x:6,y:5}]);
  assert.equal(castSword(battle,dash,4,4).actors[1].hp,385);
  const sweep='rock-break',pushing=swordBattle(sweep,[lowBeast('center',2,4,500),lowBeast('side',3,5,500)]);
  const pushed=castSword(pushing,sweep,2,4);
  assert.deepEqual(pushed.actors.slice(1).map(a=>[a.x,a.y]),[[5,4],[6,5]]);
  const step='tiger-step',two=swordBattle(step,[lowBeast('side',4,3,500)]);
  const result=castSword(two,step,3,4);
  assert.equal(result.actors[1].hp,350);
  assert.equal(result.events.filter(e=>e.type==='damage'&&e.target==='side').length,2);
});

test('the server treats focus as ending the turn, clears pending questions and settles a retry once',async()=>{
  const db=database(),id='dragon-roar';
  db.records.get('users/u1').stats.totalScore=68;
  db.records.set(API.MANUALS+'/u1',{
    version:2,school:'body',books:{'body-dragon':{exp:1080}},equipped:[id]
  });
  const state=await API.start(db,'u1',{mode:'pve'},now);
  const room=db.records.get(API.ROOMS+'/'+state.id),hero=room.actors[0];
  hero.stamina=10;
  room.pending={u1:{id:'old-question'}};
  room.pendingFollowup={u1:{id:'old-followup'}};
  const input={roomId:state.id,revision:state.revision,requestId:'fist-focus-retry-01',
    type:'manual',skillId:id,x:hero.x,y:hero.y};
  const result=await API.command(db,'u1',input,now);
  const retry=await API.command(db,'u1',input,now);
  assert.equal(result.turn,state.turn+1);
  assert.equal(result.actors[0].stamina,3);
  assert.equal(result.actors[0].actions,0);
  assert.equal(R.focusTurns(result.actors[0]),2);
  assert.equal(result.question,null);
  assert.equal(result.questionFollowup,null);
  assert.equal(retry.revision,result.revision);
  assert.equal(retry.actors[0].fistFocusUntil,result.actors[0].fistFocusUntil);
});
