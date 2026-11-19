'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Rescue=require('../dungeon-team-rescue.cjs');
const Victory=require('../dungeon-victory-reward.cjs');
const Boss=require('../dungeon-boss-battle.cjs');
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
test('rescue rules: 8 stamina ally, 25 stamina self and exact HP, sequence replay',()=>{
  const map=generateDungeonLayout(SEED);
  const x={...map.spawnPads[0]},y=adjacent(map,x);
  assert.ok(y);
  const room={mode:'dungeon',status:'assembled',dungeonArena:'exploration',
    battleAppliedTick:11,enemies:[],members:{
      a:{uid:'a',position:x,explorationStamina:50,battleHealth:100,
        rescueSeq:0,allyReviveCount:0,selfRescueCount:0},
      b:{uid:'b',position:y,explorationStamina:30,battleHealth:0,
        downed:true,allyReviveCount:0,selfRescueCount:0}
    }};
  assert.throws(()=>Rescue.help(room,'b',map,{targetUid:'a',seq:1}),/尚未倒地/);
  const helped=Rescue.help(room,'a',map,{targetUid:'b',seq:1});
  assert.equal(helped.members.a.explorationStamina,42);
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
  assert.equal(self.members.b.explorationStamina,5);
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
  room.members.b.downed=true;room.members.a.explorationStamina=40;
  const revision=room.revision;
  const [a,b]=await Promise.all([
    f.call('a','rescue',{roomId:f.roomId,targetUid:'b',seq:1,
      health:999,stamina:999},0),
    f.call('a','rescue',{roomId:f.roomId,targetUid:'b',seq:1},1)
  ]);
  assert.equal(a.status,200,a.body?.error);assert.equal(b.status,200,b.body?.error);
  assert.equal(f.raw().revision,revision+1);
  assert.equal(f.raw().members.a.explorationStamina,32);
  assert.equal(f.raw().members.b.battleHealth,40);
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
