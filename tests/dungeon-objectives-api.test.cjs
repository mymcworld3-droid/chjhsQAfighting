'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PROJECT_IDS}=require('../firebase-admin-projects.cjs');
const {__test:API}=require('../dungeon-room-api.cjs');
const {generateDungeonLayout,walkable}=require('../dungeon-map-generator.cjs');
const Objectives=require('../dungeon-objectives.cjs');
const SEED='0a1b2c3d4e5f60718293a4b5';
function store(initial={}){
  const records=new Map(Object.entries(initial));let serial=0,chain=Promise.resolve();
  const clone=x=>structuredClone(x);
  const snap=ref=>({id:ref.id,exists:records.has(ref.key),
    data:()=>clone(records.get(ref.key))});
  const doc=(collection,id)=>{
    const name=id||'dungroom'+String(++serial).padStart(8,'0');
    const ref={id:name,key:collection+'/'+name};
    ref.get=async()=>snap(ref);return ref;
  };
  return {records,collection:name=>({doc:id=>doc(name,id)}),
    runTransaction:fn=>{
      const work=chain.then(async()=>{
        const changes=new Map();let written=false;
        const tx={get:async ref=>{
          assert.equal(written,false,'read before write');
          return snap(ref);
        },set:(ref,value)=>{written=true;changes.set(ref.key,clone(value));},
          update:(ref,value)=>{written=true;changes.set(ref.key,{
            ...clone(changes.get(ref.key)||records.get(ref.key)),...clone(value)});}};
        const result=await fn(tx);
        for(const [key,value]of changes)records.set(key,value);
        return result;
      });
      chain=work.catch(()=>{});return work;
    }};
}
async function game(){
  const a=store(Object.fromEntries(['a','b'].map(uid=>['users/'+uid,{
    uid,displayName:'修士'+uid,stats:{totalScore:60}}])));
  const c=store();
  const make=()=>API.createHandler({
    resolveA:()=>({db:a,auth:{verifyIdToken:async token=>({
      uid:token,aud:PROJECT_IDS.A,
      iss:'https://securetoken.google.com/'+PROJECT_IDS.A
    })}}),
    resolveC:()=>({db:c}),clock:()=>1800000000000,
    seedFactory:()=>SEED,logger:{error(){}}
  });
  const servers=[make(),make()];
  async function call(uid,action,body={},instance=0){
    let status=200,json;
    await servers[instance]({body:{action,...body},
      get:key=>key==='authorization'?'Bearer '+uid:''},{
      set(){return this;},status(n){status=n;return this;},
      json(v){json=v;return this;}
    });
    return {status,body:json};
  }
  const created=await call('a','create');
  const id=created.body.roomId;
  assert.equal((await call('b','join-code',{
    roomCode:created.body.room.code},1)).status,200);
  for(const uid of ['a','b'])
    assert.equal((await call(uid,'ready',{roomId:id,ready:true})).status,200);
  const begin=await call('a','start',{roomId:id});
  assert.equal(begin.status,200);
  return {a,c,call,id,map:generateDungeonLayout(SEED),
    getRoom:()=>c.records.get('dungeonRooms/'+id)};
}
const adjacent=(map,p)=>[[0,1],[1,0],[0,-1],[-1,0]]
  .map(([dx,dy])=>({x:p.x+dx,y:p.y+dy}))
  .find(q=>walkable(map,q));
test('stage 14 guardian/key/portal: two C instances share one objective and deny forged opens',async()=>{
  const f=await game(),room=f.getRoom();
  assert.equal(room.dungeonProgress.portalStatus,'sealed');
  assert.equal(room.enemies.filter(e=>e.id===Objectives.GUARDIAN_ID).length,1);
  assert.equal((await f.call('a','activate-portal',{roomId:f.id,
    keyAcquired:true,portalStatus:'open',position:f.map.portalSite})).status,409);
  const guardian=room.enemies.find(e=>e.id===Objectives.GUARDIAN_ID);
  // Isolate guardian during this test; ordinary beasts have separate combat
  // acceptance, and monster HP is still calculated by production rules.
  room.enemies=[guardian];
  const pos=adjacent(f.map,guardian.position);
  assert.ok(pos);
  room.members.a.position={...pos};room.members.b.position={...pos};
  for(let i=1;i<=5;i++){
    const x=await f.call('a','strike',{
      roomId:f.id,enemyId:guardian.id,seq:i},i%2);
    const y=await f.call('b','strike',{
      roomId:f.id,enemyId:guardian.id,seq:i},(i+1)%2);
    assert.equal(x.status,200,x.body?.error);
    assert.equal(y.status,200,y.body?.error);
  }
  assert.equal(f.getRoom().enemies[0].battleHealth,60);
  // The preceding ten hits spent both players' ten stamina. Test fixture
  // now represents a separately verified recharge; the quiz-credit suite
  // independently rejects forged or duplicate replenishment.
  f.getRoom().members.a.explorationStamina=4;
  f.getRoom().members.b.explorationStamina=4;
  const [lastA,lastB]=await Promise.all([
    f.call('a','strike',{roomId:f.id,enemyId:guardian.id,seq:6},0),
    f.call('b','strike',{roomId:f.id,enemyId:guardian.id,seq:6},1)
  ]);
  assert.equal(lastA.status,200);assert.equal(lastB.status,200);
  assert.equal(f.getRoom().enemies.length,0);
  const progress=f.getRoom().dungeonProgress;
  assert.equal(progress.guardianStatus,'defeated');
  assert.equal(progress.keyAcquired,true);
  assert.equal(progress.portalStatus,'ready');
  assert.ok(['a','b'].includes(progress.defeatedByUid));
  assert.equal((await f.call('a','activate-portal',{roomId:f.id,
    keyAcquired:true})).status,409,'cannot remotely activate');
  const saved=f.getRoom();saved.members.a.position={...f.map.portalSite};
  saved.members.b.position={...f.map.portalSite};
  const revision=saved.revision,staminaA=saved.members.a.explorationStamina;
  const attempts=await Promise.all([
    f.call('a','activate-portal',{roomId:f.id,open:true},0),
    f.call('b','activate-portal',{roomId:f.id,keyAcquired:false},1)
  ]);
  assert.ok(attempts.every(x=>x.status===200),JSON.stringify(attempts));
  const final=f.getRoom();
  assert.equal(final.dungeonProgress.portalStatus,'open');
  assert.equal(final.revision,revision+1);
  assert.equal(final.members.a.explorationStamina,staminaA);
  assert.equal(final.dungeonProgress.openedAtTick,0);
  assert.equal((await f.call('b','activate-portal',{roomId:f.id},1)).status,200);
  assert.equal(f.getRoom().revision,final.revision,'repeated portal request no extra write');
  assert.ok([401,403].includes((await f.call('intruder','activate-portal',{roomId:f.id})).status));
  assert.equal((await f.call('a','strike',{
    roomId:f.id,enemyId:guardian.id,seq:6})).status,200,
  'a retry of the last successful kill is idempotent');
  assert.equal(f.getRoom().dungeonProgress.portalStatus,'open');
  assert.equal((await f.call('a','get',{roomId:f.id})).body.room.dungeonProgress.keyAcquired,true);
});
test('stage 14 guardian falls to an equipped verified manual; cancels reset all shared objectives',async()=>{
  const f=await game(),raw=f.getRoom();
  const record={school:'sword',books:{'sword-wind':{exp:2500}},
    equipped:['wind-slash'],loadouts:[
      {name:'劍氣',skillIds:['wind-slash']},
      {name:'其他',skillIds:[]},
      {name:'空白',skillIds:[]}],activeLoadout:0};
  f.a.records.set('tacticalManuals/a',record);
  const switchResult=await f.call('a','loadout',{roomId:f.id,index:0});
  assert.equal(switchResult.status,200);
  const current=f.getRoom(),guardian=current.enemies.find(e=>e.id===Objectives.GUARDIAN_ID);
  const pos=adjacent(f.map,guardian.position);
  current.members.a.position={...pos};current.enemies=[guardian];
  guardian.battleHealth=20;
  assert.equal((await f.call('a','strike',{roomId:f.id,
    enemyId:guardian.id,seq:1})).status,409,'manual replaces bare punch');
  const hit=await f.call('a','skill',{
    roomId:f.id,skillId:'wind-slash',target:guardian.position,seq:1,
    keyAcquired:true,damage:999999
  });
  assert.equal(hit.status,200,hit.body?.error);
  assert.equal(f.getRoom().dungeonProgress.keyAcquired,true);
  assert.equal(f.getRoom().dungeonProgress.defeatedByUid,'a');
  assert.equal(f.getRoom().enemies.length,0);
  const cancelled=await f.call('a','cancel-start',{roomId:f.id});
  assert.equal(cancelled.status,200,cancelled.body?.error);
  assert.equal(cancelled.body.room.status,'waiting');
  assert.equal(cancelled.body.room.dungeonProgress,null);
  assert.deepStrictEqual(cancelled.body.room.enemies,[]);
  for(const uid of ['a','b'])
    assert.equal((await f.call(uid,'ready',{roomId:f.id,ready:true})).status,200);
  const next=await f.call('a','start',{roomId:f.id});
  assert.equal(next.status,200);
  assert.equal(next.body.room.dungeonProgress.keyAcquired,false);
  assert.equal(next.body.room.dungeonProgress.portalStatus,'sealed');
  assert.ok(next.body.room.enemies.some(e=>e.id===Objectives.GUARDIAN_ID));
});
