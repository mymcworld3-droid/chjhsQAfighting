'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PROJECT_IDS}=require('../firebase-admin-projects.cjs');
const {__test:API}=require('../dungeon-room-api.cjs');
const {generateDungeonLayout,LAYOUT_VERSION}=require('../dungeon-map-generator.cjs');
const SECRET='0a1b2c3d4e5f60718293a4b5';

function store(initial={}){
  const records=new Map(Object.entries(initial));let serial=0,chain=Promise.resolve();
  const clone=value=>structuredClone(value);
  const snap=ref=>({id:ref.id,exists:records.has(ref.key),data:()=>clone(records.get(ref.key))});
  const doc=(collection,id)=>{
    const name=id||'dungroom'+String(++serial).padStart(8,'0');
    const ref={id:name,key:collection+'/'+name};
    ref.get=async()=>snap(ref);
    return ref;
  };
  return {records,collection(collection){return {doc:id=>doc(collection,id)};},
    runTransaction(fn){
      const task=chain.then(async()=>{
        const changes=new Map();let written=false;
        const tx={
          get:async ref=>{
            assert.equal(written,false,'Firestore transactions must read before writes');
            return snap(ref);
          },
          set:(ref,value)=>{written=true;changes.set(ref.key,clone(value));},
          update:(ref,value)=>{
            written=true;changes.set(ref.key,{
              ...clone(changes.get(ref.key)||records.get(ref.key)),...clone(value)
            });
          }
        };
        const result=await fn(tx);
        for(const [id,value]of changes)records.set(id,value);
        return result;
      });
      chain=task.catch(()=>{});
      return task;
    }
  };
}
function fixture(){
  const players=Object.fromEntries('abcd'.split('').map(uid=>['users/'+uid,
    {uid,displayName:'修士'+uid,stats:{totalScore:50},raidTickets:{count:4}}]));
  const a=store(players),c=store();let at=1800000000000;
  const build=()=>API.createHandler({
    resolveA:()=>({db:a,auth:{verifyIdToken:async token=>{
      if(token==='invalid')throw Error('expired');
      return {uid:token,aud:PROJECT_IDS.A,
        iss:'https://securetoken.google.com/'+PROJECT_IDS.A};
    }}}),
    resolveC:()=>({db:c}),seedFactory:()=>SECRET,
    clock:()=>at,logger:{error(){}}
  });
  const handlers=[build(),build()];
  async function call(uid,action,body={},instance=0){
    let status=200,result;
    await handlers[instance]({
      body:{action,...body},
      get:field=>field==='authorization'?'Bearer '+uid:''
    },{
      set(){return this;},
      status(value){status=value;return this;},
      json(value){result=value;return this;}
    });
    return {status,body:result};
  }
  return {a,c,call,clock:advance=>{at+=advance;}};
}

const {walkable}=require('../dungeon-map-generator.cjs');
const AI=require('../dungeon-enemy-ai.cjs');
const Objectives=require('../dungeon-objectives.cjs');
const ROOMS='dungeonRooms';
const cardinal=(layout,p)=>[[1,0],[0,1],[-1,0],[0,-1]]
  .find(([dx,dy])=>walkable(layout,{x:p.x+dx,y:p.y+dy}));
async function assembled(f,withFriend=true){
  const created=(await f.call('a','create')).body,id=created.roomId;
  if(withFriend)await f.call('b','join-code',{roomCode:created.room.code},1);
  await f.call('a','ready',{roomId:id,ready:true});
  if(withFriend)await f.call('b','ready',{roomId:id,ready:true},1);
  const started=await f.call('a','start',{roomId:id});
  assert.equal(started.status,200);
  return {id,room:started.body.room,map:generateDungeonLayout(SECRET)};
}
test('server assembles ordinary NPCs plus one guardian transactionally, without harming accounts',async()=>{
  const f=fixture(),first=structuredClone(f.a.records.get('users/a'));
  const {id,room,map}=await assembled(f);
  const saved=f.c.records.get(ROOMS+'/'+id);
  assert.equal(saved.enemyAiVersion,AI.ENEMY_AI_VERSION);
  assert.equal(room.enemies.length,AI.initialEnemies(map).length+1);
  assert.equal(room.enemies.filter(e=>e.id===Objectives.GUARDIAN_ID).length,1);
  assert.equal(room.dungeonProgress.keyAcquired,false);
  assert.equal(room.dungeonProgress.portalStatus,'sealed');
  assert.equal(room.enemies.length,saved.enemies.length);
  for(const beast of room.enemies){
    assert.equal(walkable(map,beast.position),true);
    assert.equal(beast.intent,'patrol');
    assert.equal(beast.lastActionTick,0);
    assert.ok(!Object.hasOwn(beast,'patrolIndex'));
    assert.ok(!Object.hasOwn(beast,'zone'));
    assert.ok(!Object.hasOwn(beast,'spawn'));
  }
  assert.ok(!Object.hasOwn(room,'mapSeed'));
  assert.deepStrictEqual(f.a.records.get('users/a'),first);
});
test('two backend instances coalesce a due tick and publish exactly one NPC state',async()=>{
  const f=fixture(),{id,room,map}=await assembled(f);
  f.clock(2100);
  const ticks=await Promise.all(Array.from({length:10},(_,i)=>
    f.call(i%2?'b':'a','clock',{roomId:id,nowMs:10000000000000,
      enemyPosition:{x:0,y:0},tick:100000},i%2)));
  assert.ok(ticks.every(t=>t.status===200));
  assert.ok(ticks.every(t=>t.body.clock.tick===2));
  const saved=f.c.records.get(ROOMS+'/'+id);
  assert.equal(saved.battleAppliedTick,2);
  assert.equal(saved.revision,room.revision+1);
  assert.deepStrictEqual(saved.enemies,AI.simulate(map,
    Objectives.spawn(map,AI.initialEnemies(map)).enemies,saved.members,1,2));
  assert.equal((await f.call('a','clock',{roomId:id})).body.clock.tick,2);
  assert.equal(f.c.records.get(ROOMS+'/'+id).revision,saved.revision);
});
test('AI pursues player via legal path without player movement, resource loss or attack',async()=>{
  const f=fixture(),{id,map}=await assembled(f);
  const raw=f.c.records.get(ROOMS+'/'+id);
  const enemy=raw.enemies.find(e=>e.cadence===2)||raw.enemies[0];
  const route=AI.routeFor(map,enemy.zone);
  const player=route[Math.max(0,enemy.patrolIndex-4)];
  raw.members.a.position={...player};
  const oldEnemy={...enemy,position:{...enemy.position}};
  const oldStamina=raw.members.a.explorationStamina;
  f.clock(enemy.cadence*1000);
  const next=await f.call('b','clock',{roomId:id},1);
  assert.equal(next.status,200);
  const latest=f.c.records.get(ROOMS+'/'+id);
  const moved=latest.enemies.find(e=>e.id===enemy.id);
  assert.ok(['pursuit','alert'].includes(moved.intent));
  assert.equal(moved.targetUid,'a');
  assert.ok(Math.abs(moved.position.x-oldEnemy.position.x)+
    Math.abs(moved.position.y-oldEnemy.position.y)<=1);
  assert.equal(walkable(map,moved.position),true);
  assert.notDeepStrictEqual(moved.position,raw.members.a.position);
  assert.equal(latest.members.a.explorationStamina,oldStamina);
  assert.equal(latest.members.a.health,undefined);
  assert.equal(latest.members.a.damage,undefined);
});
test('a player move transaction also catches up the NPCs and reports positions to all teammates',async()=>{
  const f=fixture(),{id,room,map}=await assembled(f);
  f.clock(3400);
  const [dx,dy]=cardinal(map,room.members.a.position);
  const moved=await f.call('a','move',{roomId:id,dx,dy,step:1,
    enemies:[{id:'beast-1',position:{x:1,y:1}}],
    enemyAiVersion:100000},0);
  assert.equal(moved.status,200);
  assert.equal(moved.body.room.battleClock.appliedTick,3);
  assert.equal(moved.body.room.enemies.length,room.enemies.length);
  assert.equal(moved.body.room.members.a.explorationStamina,99);
  const teammate=(await f.call('b','get',{roomId:id},1)).body.room;
  assert.deepStrictEqual(teammate.enemies,moved.body.room.enemies);
  assert.deepStrictEqual(teammate.members.a.position,moved.body.room.members.a.position);
});
test('nonmembers, expired room, waiting state and corrupted AI versions are rejected',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body,id=created.roomId;
  assert.equal((await f.call('a','clock',{roomId:id})).status,409);
  assert.equal((await f.call('b','clock',{roomId:id})).status,403);
  await f.call('a','ready',{roomId:id,ready:true});
  assert.equal((await f.call('a','start',{roomId:id})).status,200);
  const raw=f.c.records.get(ROOMS+'/'+id);
  raw.enemyAiVersion=7777;
  f.clock(1000);
  assert.equal((await f.call('a','clock',{roomId:id})).status,409);
  raw.enemyAiVersion=AI.ENEMY_AI_VERSION;
  f.clock(7200001);
  assert.equal((await f.call('a','clock',{roomId:id})).status,410);
});
test('cancel or departure clears all enemies; reassembly creates the same seeded population',async()=>{
  const f=fixture(),{id,room}=await assembled(f,false);
  const before=structuredClone(room.enemies);
  const cancel=await f.call('a','cancel-start',{roomId:id});
  assert.equal(cancel.status,200);
  assert.deepStrictEqual(cancel.body.room.enemies,[]);
  assert.equal(cancel.body.room.battleClock,null);
  await f.call('a','ready',{roomId:id,ready:true});
  const again=await f.call('a','start',{roomId:id});
  assert.deepStrictEqual(again.body.room.enemies,before);
  const leave=await f.call('a','leave',{roomId:id});
  assert.equal(leave.status,200);
  assert.equal(leave.body.room.status,'closed');
  assert.equal(leave.body.room.enemies.length,0);
  assert.equal(leave.body.room.battleClock,null);
});
test('old stage-8 assembled rooms lazily initialize enemies without map migration',async()=>{
  const f=fixture(),{id,map}=await assembled(f);
  const raw=f.c.records.get(ROOMS+'/'+id);
  delete raw.enemyAiVersion;delete raw.enemies;
  const tick=await f.call('a','clock',{roomId:id});
  assert.equal(tick.status,200);
  assert.equal(tick.body.clock.tick,0);
  const updated=f.c.records.get(ROOMS+'/'+id);
  assert.equal(updated.enemyAiVersion,AI.ENEMY_AI_VERSION);
  assert.deepStrictEqual(updated.enemies,AI.initialEnemies(map));
  const before=updated.revision;
  await f.call('a','clock',{roomId:id},1);
  assert.equal(f.c.records.get(ROOMS+'/'+id).revision,before);
});
