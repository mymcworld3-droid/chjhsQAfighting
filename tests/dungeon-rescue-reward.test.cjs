'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Rescue=require('../dungeon-team-rescue.cjs');
const Victory=require('../dungeon-victory-reward.cjs');
const Boss=require('../dungeon-boss-battle.cjs');
const Player=require('../dungeon-player-combat.cjs');
const {generateDungeonLayout,walkable}=require('../dungeon-map-generator.cjs');
const {PROJECT_IDS}=require('../firebase-admin-projects.cjs');
const {__test:API}=require('../dungeon-room-api.cjs');
const SEED='0a1b2c3d4e5f60718293a4b5',NOW=1800000000000;
function store(initial={}){
  const records=new Map(Object.entries(initial)),clone=x=>structuredClone(x);
  let chain=Promise.resolve(),serial=0;
  const snap=r=>({id:r.id,exists:records.has(r.key),data:()=>clone(records.get(r.key))});
  const doc=(coll,id)=>{
    const name=id||'dungroom'+String(++serial).padStart(8,'0');
    const r={id:name,key:coll+'/'+name};r.get=async()=>snap(r);return r;
  };
  const patch=(base,values)=>{
    const next=clone(base);
    for(const [field,value] of Object.entries(values)){
      const keys=field.split('.');let p=next;
      for(const k of keys.slice(0,-1))p=p[k]||=(Object.create(null));
      p[keys.at(-1)]=clone(value);
    }
    return next;
  };
  return {records,collection:coll=>({doc:id=>doc(coll,id)}),
    runTransaction:fn=>{
      const pending=chain.then(async()=>{
        const writes=new Map();let started=false;
        const tx={
          get:async r=>{assert.equal(started,false,'Firestore read before write');return snap(r);},
          set:(r,value)=>{started=true;writes.set(r.key,clone(value));},
          update:(r,value)=>{
            started=true;writes.set(r.key,patch(writes.get(r.key)||records.get(r.key),value));
          }};
        const response=await fn(tx);
        for(const [k,v]of writes)records.set(k,v);
        return response;
      });
      chain=pending.catch(()=>{});return pending;
    }};
}
async function fixture(){
  const users=Object.fromEntries(['a','b'].map(uid=>['users/'+uid,
    {uid,displayName:'修士'+uid,stats:{totalScore:50,gold:5}}]));
  const a=store(users),c=store(),clock=()=>NOW;
  const create=()=>API.createHandler({
    resolveA:()=>({db:a,auth:{verifyIdToken:async t=>{
      if(t==='invalid')throw Error('invalid');
      return {uid:t,aud:PROJECT_IDS.A,
        iss:'https://securetoken.google.com/'+PROJECT_IDS.A};
    }}}),resolveC:()=>({db:c}),clock,seedFactory:()=>SEED,logger:{error(){}}
  });
  const handlers=[create(),create()];
  const call=async(uid,action,extra={},instance=0)=>{
    let status=200,body;
    await handlers[instance]({body:{action,...extra},get:k=>
      k==='authorization'?'Bearer '+uid:''},{
      set(){return this;},status(v){status=v;return this;},
      json(v){body=v;return this;}
    });
    return {status,body};
  };
  const born=await call('a','create');
  const roomId=born.body.roomId;
  assert.equal((await call('b','join-code',{roomCode:born.body.room.code},1)).status,200);
  for(const uid of ['a','b'])
    assert.equal((await call(uid,'ready',{roomId,ready:true})).status,200);
  assert.equal((await call('a','start',{roomId})).status,200);
  const raw=()=>c.records.get('dungeonRooms/'+roomId);
  return {a,c,call,roomId,raw,map:generateDungeonLayout(SEED)};
}
function adjacent(map,p){
  return [[1,0],[-1,0],[0,1],[0,-1]]
    .map(([dx,dy])=>({x:p.x+dx,y:p.y+dy}))
    .find(q=>walkable(map,q));
}
function win(room,uid='a'){
  room.dungeonArena='boss';
  room.dungeonProgress={...room.dungeonProgress,
    guardianStatus:'defeated',keyAcquired:true,portalStatus:'open'};
  room.bossEncounter={version:Boss.VERSION,status:'defeated',
    enteredByUid:uid,enteredAtTick:3,defeatedAtTick:12,
    defeatedByUid:uid};
  room.enemies=[];
}
test('rescue rules: 8 stamina ally, 10 stamina self and exact HP, sequence replay',()=>{
  const map=generateDungeonLayout(SEED);
  const x={...map.spawnPads[0]},y=adjacent(map,x);
  assert.ok(y);
  const room={mode:'dungeon',status:'assembled',dungeonArena:'exploration',
    battleAppliedTick:11,enemies:[],members:{
      a:{uid:'a',position:x,explorationStamina:10,battleHealth:100,
        rescueSeq:0,allyReviveCount:0,selfRescueCount:0},
      b:{uid:'b',position:y,explorationStamina:10,battleHealth:0,
        downed:true,allyReviveCount:0,selfRescueCount:0}
    }};
  assert.throws(()=>Rescue.help(room,'b',map,{targetUid:'a',seq:1}),/尚未倒地/);
  const helped=Rescue.help(room,'a',map,{targetUid:'b',seq:1});
  assert.equal(helped.members.a.explorationStamina,2);
  assert.equal(helped.members.b.battleHealth,40);
  assert.equal(helped.members.b.downed,false);
  assert.equal(helped.members.b.allyReviveCount,1);
  assert.equal(helped.members.a.rescueSeq,1);
  const retry=Rescue.help({...room,members:helped.members},'a',map,{targetUid:'b',seq:1});
  assert.equal(retry.duplicate,true);
  assert.strictEqual(retry.members,helped.members);
  assert.throws(()=>Rescue.help({...room,members:helped.members},
    'a',map,{targetUid:'b',seq:2}),/尚未倒地/);
  const self=Rescue.help(room,'b',map,{targetUid:'b',seq:1});
  assert.equal(self.members.b.battleHealth,25);
  assert.equal(self.members.b.explorationStamina,0);
  assert.equal(self.members.b.selfRescueCount,1);
  const fallen={...room,members:{...self.members,
    b:{...self.members.b,downed:true,battleHealth:0}}};
  assert.throws(()=>Rescue.help(fallen,'b',map,{targetUid:'b',seq:2}),/已使用過/);
  assert.equal(room.members.b.battleHealth,0,'pure computation never mutates room');
});
test('rescue guardrails: no teleport, self spoof, negative stamina or unlimited revives',()=>{
  const map=generateDungeonLayout(SEED);
  const base={mode:'dungeon',status:'assembled',members:{
    a:{uid:'a',position:map.spawn,explorationStamina:4,battleHealth:100},
    b:{uid:'b',position:map.deepest,explorationStamina:30,
      battleHealth:0,downed:true}
  }};
  assert.throws(()=>Rescue.help(base,'a',map,{targetUid:'b',seq:1}),/相鄰/);
  const near={...base,members:{...base.members,
    b:{...base.members.b,position:base.members.a.position}}};
  assert.throws(()=>Rescue.help(near,'a',map,{targetUid:'b',seq:1}),/體力不足/);
  assert.throws(()=>Rescue.help(near,'a',map,{targetUid:'a',seq:1}),/尚未倒地/);
  assert.throws(()=>Rescue.help(near,'visitor',map,{targetUid:'b',seq:1}),/不是此副本/);
  assert.throws(()=>Rescue.help({...near,members:{...near.members,
    a:{...near.members.a,explorationStamina:50},
    b:{...near.members.b,allyReviveCount:2}}},'a',map,{targetUid:'b',seq:1}),/上限/);
  assert.throws(()=>Rescue.help(near,'a',map,{targetUid:'b',seq:0}),/無效/);
  assert.throws(()=>Rescue.help(near,'a',map,{targetUid:'b',seq:2}),/不同步/);
});
test('two C servers rescue one downed ally once and keep retries resource-neutral',async()=>{
  const f=await fixture(),room=f.raw(),p={...f.map.spawnPads[0]};
  room.enemies=[];room.members.a.position=p;
  room.members.b.position={...p};room.members.b.battleHealth=0;
  room.members.b.downed=true;room.members.a.explorationStamina=10;
  const revision=room.revision;
  const [a,b]=await Promise.all([
    f.call('a','rescue',{roomId:f.roomId,targetUid:'b',seq:1,
      health:999,stamina:999},0),
    f.call('a','rescue',{roomId:f.roomId,targetUid:'b',seq:1},1)
  ]);
  assert.equal(a.status,200,a.body?.error);assert.equal(b.status,200,b.body?.error);
  assert.equal(f.raw().revision,revision+1);
  assert.equal(f.raw().members.a.explorationStamina,2);
  assert.equal(f.raw().members.b.battleHealth,
    Math.round(f.raw().members.b.battleMaxHealth*.4));
  assert.equal((await f.call('b','rescue',{roomId:f.roomId,
    targetUid:'b',seq:1})).status,409,'cannot self-revive when healthy');
  assert.equal((await f.call('visitor','rescue',{roomId:f.roomId,
    targetUid:'b',seq:1})).status,403);
  assert.equal((await f.call('a','rescue',{roomId:f.roomId,
    targetUid:'b',seq:1},1)).status,200);
  assert.equal(f.raw().revision,revision+1);
});
test('C victory requires Boss death, then A pays each participant once across servers',async()=>{
  const f=await fixture();
  const none=await f.call('a','claim-boss-reward',{roomId:f.roomId,
    gold:9999999,isCorrect:true});
  assert.equal(none.status,409);
  assert.equal(f.a.records.get('users/a').stats.gold,5);
  win(f.raw());
  const [a,b,replay]=await Promise.all([
    f.call('a','claim-boss-reward',{roomId:f.roomId,
      gold:999999,uid:'b',bossHp:0},0),
    f.call('b','claim-boss-reward',{roomId:f.roomId},1),
    f.call('a','claim-boss-reward',{roomId:f.roomId},1)
  ]);
  assert.equal(a.status,200,a.body?.error);
  assert.equal(b.status,200,b.body?.error);
  assert.equal(replay.status,200,replay.body?.error);
  assert.equal(Number(a.body.reward.awarded)+Number(replay.body.reward.awarded),1);
  assert.equal(b.body.reward.awarded,true);
  for(const uid of ['a','b']){
    const player=f.a.records.get('users/'+uid);
    assert.equal(player.stats.gold,125,'permanent gold');
    assert.equal(player.stats.totalScore,53,'permanent cultivation');
    assert.equal(player.stats.dungeonBossWins,1);
  }
  const receipts=[...f.a.records.keys()].filter(x=>x.startsWith('dungeonVictoryClaims/'));
  assert.equal(receipts.length,2,'one unique receipt per participant');
  assert.ok(receipts.every(x=>!x.endsWith('/a')&&!x.endsWith('/b')));
  assert.equal(f.raw().revision>0,true);
  const banned=await f.call('visitor','claim-boss-reward',{roomId:f.roomId});
  assert.equal(banned.status,403);
  const duplicated=await f.call('b','claim-boss-reward',{roomId:f.roomId});
  assert.equal(duplicated.body.reward.status,'duplicate');
  assert.equal(f.a.records.get('users/b').stats.gold,125);
});
test('C victory validation denies forged progress and unearned rewards',()=>{
  const roomId='dungroom000001';
  const room={mode:'dungeon',version:1,status:'assembled',
    assembledAtMs:NOW,dungeonArena:'boss',
    dungeonProgress:{guardianStatus:'defeated',keyAcquired:true,portalStatus:'open'},
    bossEncounter:{version:1,status:'defeated',enteredAtTick:4,
      defeatedAtTick:6,defeatedByUid:'a'},
    enemies:[],members:{a:{uid:'a'}}};
  assert.equal(Victory.validate(roomId,room,'a').uid,'a');
  assert.equal(Victory.receiptId(roomId,roomId+':'+NOW,'a').length,64);
  assert.throws(()=>Victory.validate(roomId,room,'b'),/不是這場/);
  assert.throws(()=>Victory.validate(roomId,{...room,
    dungeonProgress:{...room.dungeonProgress,keyAcquired:false}},'a'),/先真正擊敗/);
  assert.throws(()=>Victory.validate(roomId,{...room,
    bossEncounter:{...room.bossEncounter,defeatedAtTick:2}},'a'),/不完整/);
  assert.throws(()=>Victory.validate(roomId,{...room,
    enemies:[Boss.initialBoss()]},'a'),/先真正擊敗/);
  assert.throws(()=>Victory.validate(roomId,{...room,status:'waiting'},'a'),/有效/);
});


test('real boss death atomically archives a permanent C victory and personal inbox',async()=>{
  const f=await fixture(),room=f.raw();
  room.dungeonProgress={...room.dungeonProgress,
    guardianStatus:'defeated',keyAcquired:true,portalStatus:'open'};
  room.members.a.position={...f.map.portalSite};
  room.members.b.position={...f.map.portalSite};
  assert.equal((await f.call('a','enter-boss',{roomId:f.roomId})).status,200);
  assert.equal(f.raw().dungeonArena,'exploration');
  assert.equal((await f.call('b','enter-boss',{roomId:f.roomId},1)).status,200);
  assert.equal(f.raw().dungeonArena,'boss');
  assert.equal((await f.call('a','recent-victories')).body.rewards.length,0,
    'live boss cannot be mistaken for a completed victory');
  const fight=f.raw();
  const probe={...fight.enemies[0],battleHealth:Boss.HP};
  const firstDamage=Boss.damage(probe,'a',
    Player.playerStrikeDamage(fight.members.a),
    fight.battleAppliedTick).damage;
  fight.enemies[0].battleHealth=firstDamage+1; // Both contributors must hit.
  fight.members.a.position={x:11,y:8};
  fight.members.b.position={x:12,y:8};
  const [a,b]=await Promise.all([
    f.call('a','strike',{roomId:f.roomId,enemyId:Boss.ID,seq:1},0),
    f.call('b','strike',{roomId:f.roomId,enemyId:Boss.ID,seq:1},1)
  ]);
  assert.equal(a.status,200,a.body?.error);
  assert.equal(b.status,200,b.body?.error);
  assert.equal(f.raw().bossEncounter.status,'defeated');
  const archive=f.c.records.get('dungeonVictoryRecords/'+f.roomId);
  assert.ok(archive,'C archive must commit with real boss death');
  assert.equal(archive.recordVersion,1);
  assert.equal(archive.roomId,f.roomId);
  assert.equal(archive.bossEncounter.status,'defeated');
  assert.deepStrictEqual(Object.keys(archive.members).sort(),['a','b']);
  assert.equal(archive.members.a.uid,'a');
  assert.equal(archive.members.a.battleHealth,undefined,
    'archive must omit health, quiz state and other battle-private fields');
  assert.equal(archive.mapSeed,undefined,'seed stays secret');
  assert.equal(archive.enemies.length,0);
  assert.equal(f.c.records.get('dungeonVictoryInbox/a').recent.length,1);
  assert.equal(f.c.records.get('dungeonVictoryInbox/b').recent.length,1);
  const before=await f.call('a','recent-victories');
  assert.equal(before.status,200);
  assert.deepStrictEqual(before.body.rewards.map(x=>x.claimed),[false]);
  assert.equal(before.body.rewards[0].partySize,2);
  assert.equal((await f.call('visitor','recent-victories')).body.rewards.length,0);
  assert.equal((await f.call('visitor','claim-boss-reward',
    {roomId:f.roomId})).status,403);
  // A departure preserves the surviving party, and immutable victory
  // records and each member's inbox remain intact and redeemable.
  assert.equal((await f.call('b','leave',{roomId:f.roomId},1)).status,200);
  assert.equal(f.raw().status,'assembled');
  assert.equal(f.raw().bossEncounter.status,'defeated');
  assert.equal((await f.call('a','disband',{roomId:f.roomId})).status,200);
  assert.equal(f.raw().status,'closed');
  const [claimedB,claimedA,replayedB]=await Promise.all([
    f.call('b','claim-boss-reward',{roomId:f.roomId,gold:999999},1),
    f.call('a','claim-boss-reward',{roomId:f.roomId},0),
    f.call('b','claim-boss-reward',{roomId:f.roomId},0)
  ]);
  assert.equal(claimedA.status,200,claimedA.body?.error);
  assert.equal(claimedB.status,200,claimedB.body?.error);
  assert.equal(replayedB.status,200,replayedB.body?.error);
  assert.equal(Number(claimedB.body.reward.awarded)+
    Number(replayedB.body.reward.awarded),1);
  for(const uid of ['a','b']){
    assert.equal(f.a.records.get('users/'+uid).stats.gold,125);
    assert.equal(f.a.records.get('users/'+uid).stats.totalScore,53);
    assert.equal(f.a.records.get('users/'+uid).stats.dungeonBossWins,1);
    const list=await f.call(uid,'recent-victories');
    assert.equal(list.body.rewards[0].claimed,true);
  }
  assert.equal([...f.a.records.keys()].filter(k=>
    k.startsWith('dungeonVictoryClaims/')).length,2);
  assert.ok(f.c.records.has('dungeonVictoryRecords/'+f.roomId));
  assert.equal((await f.call('b','claim-boss-reward',{roomId:f.roomId}))
    .body.reward.status,'duplicate');
});
test('archive excludes unverified wins and mismatched room identity',()=>{
  const roomId='dungroom000001',room={mode:'dungeon',version:1,
    status:'assembled',assembledAtMs:NOW,dungeonArena:'boss',
    dungeonProgress:{guardianStatus:'defeated',keyAcquired:true,portalStatus:'open'},
    bossEncounter:{version:Boss.VERSION,status:'defeated',enteredAtTick:1,
      defeatedAtTick:3,defeatedByUid:'a'},
    enemies:[],members:{a:{uid:'a',battleHealth:10,quizCreditSeq:90},
      b:{uid:'b',battleHealth:0,downed:true}}};
  const archived=Victory.makeArchive(roomId,room,NOW+3000);
  assert.equal(Victory.verifiedArchive(roomId,archived,'b').partySize,2,
    'downed participants are still entitled to the same team victory');
  assert.throws(()=>Victory.verifiedArchive('dungroom000002',archived,'a'),
    /存檔/);
  assert.throws(()=>Victory.verifiedArchive(roomId,archived,'intruder'),
    /不是這場/);
  assert.throws(()=>Victory.makeArchive(roomId,{
    ...room,enemies:[Boss.initialBoss()]},NOW),/先真正擊敗/);
  assert.throws(()=>Victory.makeArchive(roomId,{
    ...room,bossEncounter:{...room.bossEncounter,status:'fighting'}},NOW),
    /先真正擊敗/);
});


test('a legitimate equipped manual kill also writes the same durable C victory proof',async()=>{
  const f=await fixture(),record={school:'sword',
    books:{'sword-wind':{exp:2500}},equipped:['wind-slash'],
    loadouts:[{name:'劍氣',skillIds:['wind-slash']},
      {name:'守勢',skillIds:[]},{name:'空白',skillIds:[]}],
    activeLoadout:0};
  f.a.records.set('tacticalManuals/a',record);
  assert.equal((await f.call('a','loadout',
    {roomId:f.roomId,index:0})).status,200);
  const prior=f.raw();
  prior.dungeonProgress={...prior.dungeonProgress,
    guardianStatus:'defeated',keyAcquired:true,portalStatus:'open'};
  prior.members.a.position={...f.map.portalSite};
  prior.members.b.position={...f.map.portalSite};
  assert.equal((await f.call('a','enter-boss',
    {roomId:f.roomId})).status,200);
  assert.equal(f.raw().dungeonArena,'exploration');
  assert.equal((await f.call('b','enter-boss',
    {roomId:f.roomId},1)).status,200);
  assert.equal(f.raw().dungeonArena,'boss');
  const battle=f.raw();
  battle.members.a.position={x:11,y:8};
  battle.enemies[0].battleHealth=20;
  const target={...battle.enemies[0].position};
  const response=await f.call('a','skill',{
    roomId:f.roomId,skillId:'wind-slash',target,seq:1,damage:9999999
  });
  assert.equal(response.status,200,response.body?.error);
  assert.equal(f.raw().bossEncounter.status,'defeated');
  const proof=f.c.records.get('dungeonVictoryRecords/'+f.roomId);
  assert.ok(proof);
  assert.equal(proof.bossEncounter.defeatedByUid,'a');
  assert.equal(f.c.records.get('dungeonVictoryInbox/a').recent[0].roomId,f.roomId);
  assert.equal(f.c.records.get('dungeonVictoryInbox/b').recent[0].roomId,f.roomId);
  assert.equal((await f.call('b','recent-victories')).body.rewards[0].claimed,false);
});
