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
const {START_STAMINA}=require('../dungeon-movement.cjs');
function cardinal(map,p){
  return [[1,0],[0,1],[-1,0],[0,-1]].find(([dx,dy])=>
    walkable(map,{x:p.x+dx,y:p.y+dy}));
}
async function readyGroup(f,code){
  const created=(await f.call('a','create')).body;
  for(const [i,uid]of ['b','c','d'].entries()){
    assert.equal((await f.call(uid,'join-code',{roomCode:created.room.code},i%2)).status,200);
  }
  const id=created.roomId;
  for(const uid of 'abcd')await f.call(uid,'ready',{roomId:id,ready:true});
  const assembled=await f.call('a','start',{roomId:id});
  assert.equal(assembled.status,200);
  return {id,room:assembled.body.room,map:generateDungeonLayout(SECRET)};
}
test('only assembled players get four distinct server-stored positions and 10 private movement stamina',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body;
  assert.equal((await f.call('a','move',{roomId:created.roomId,dx:1,dy:0,step:1})).status,409);
  for(const uid of 'bcd')await f.call(uid,'join-code',{roomCode:created.room.code});
  for(const uid of 'abcd')await f.call(uid,'ready',{roomId:created.roomId,ready:true});
  const assembled=await f.call('a','start',{roomId:created.roomId});
  assert.equal(assembled.status,200);
  const map=generateDungeonLayout(SECRET);
  for(let i=0;i<4;i++){
    const member=assembled.body.room.members['abcd'[i]];
    assert.deepStrictEqual(member.position,map.spawnPads[i]);
    assert.equal(member.explorationStamina,START_STAMINA);
    assert.equal(member.moveSeq,0);
  }
  assert.deepStrictEqual(f.a.records.get('users/a').raidTickets,{count:4});
});
test('four players moving on two server instances preserve all independent positions and energy',async()=>{
  const f=fixture(),{id,room,map}=await readyGroup(f);
  const actions='abcd'.split('').map((uid,i)=>{
    const p=room.members[uid].position;
    const [dx,dy]=cardinal(map,p);
    return {uid,dx,dy,i,initial:p};
  });
  const responses=await Promise.all(actions.map(({uid,dx,dy,i})=>
    f.call(uid,'move',{roomId:id,dx,dy,step:1,position:{x:9999,y:9999},
      explorationStamina:100000},i%2)));
  assert.ok(responses.every(r=>r.status===200));
  const result=(await f.call('a','get',{roomId:id},1)).body.room;
  assert.equal(result.revision,room.revision+4);
  for(const {uid,dx,dy,initial}of actions){
    const member=result.members[uid];
    assert.deepStrictEqual(member.position,{x:initial.x+dx,y:initial.y+dy});
    assert.equal(member.explorationStamina,START_STAMINA-1);
    assert.equal(member.moveSeq,1);
  }
  assert.deepStrictEqual(f.a.records.get('users/a').raidTickets,{count:4});
});
test('retries across instances do not double charge or move; stale/forged steps fail',async()=>{
  const f=fixture(),{id,room,map}=await readyGroup(f);
  const [dx,dy]=cardinal(map,room.members.a.position);
  const first=await f.call('a','move',{roomId:id,dx,dy,step:1},0);
  const same=await f.call('a','move',{roomId:id,dx,dy,step:1},1);
  assert.equal(first.status,200);assert.equal(same.status,200);
  assert.deepStrictEqual(same.body.room.members.a,first.body.room.members.a);
  assert.equal(same.body.room.revision,first.body.room.revision);
  assert.equal((await f.call('a','move',{roomId:id,dx:-dx,dy:-dy,step:1})).status,409);
  assert.equal((await f.call('a','move',{roomId:id,dx,dy,step:3})).status,409);
  assert.equal((await f.call('a','move',{roomId:id,dx:100,dy:0,step:2})).status,400);
  assert.equal((await f.call('a','move',{roomId:id,dx:1,dy:1,step:2})).status,400);
  assert.equal((await f.call('a','cancel-start',{roomId:id})).status,409);
});
test('blocked walls and zero energy cause no writes, while disconnect and reconnect preserve position',async()=>{
  const f=fixture(),{id,room,map}=await readyGroup(f);
  const dbRoom=f.c.records.get('dungeonRooms/'+id);
  let wall;
  for(let y=1;y<map.height-1&&!wall;y++)for(let x=1;x<map.width-1;x++){
    if(!walkable(map,{x,y}))continue;
    const d=[[0,-1],[1,0],[0,1],[-1,0]].find(([dx,dy])=>!walkable(map,{x:x+dx,y:y+dy}));
    if(d){wall={x,y,dx:d[0],dy:d[1]};break;}
  }
  assert.ok(wall);
  dbRoom.members.a.position={x:wall.x,y:wall.y};
  const before=dbRoom.revision;
  const blocked=await f.call('a','move',{roomId:id,dx:wall.dx,dy:wall.dy,step:1});
  assert.equal(blocked.status,409);
  assert.equal(f.c.records.get('dungeonRooms/'+id).revision,before);
  const open=[[0,-1],[1,0],[0,1],[-1,0]].find(([dx,dy])=>
    walkable(map,{x:wall.x+dx,y:wall.y+dy}));
  dbRoom.members.a.explorationStamina=1;
  const step=await f.call('a','move',{roomId:id,dx:open[0],dy:open[1],step:1},1);
  assert.equal(step.status,200);
  assert.equal(step.body.room.members.a.explorationStamina,0);
  assert.equal((await f.call('a','move',{roomId:id,dx:-open[0],dy:-open[1],step:2})).status,409);
  const restored=(await f.call('a','reconnect')).body.room;
  assert.deepStrictEqual(restored.members.a.position,step.body.room.members.a.position);
});
test('outsiders, stale lobbies, expired rooms and leave cannot mutate exploration state',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body,id=created.roomId;
  assert.equal((await f.call('b','move',{roomId:id,dx:1,dy:0,step:1})).status,403);
  assert.equal((await f.call('invalid','move',{roomId:id,dx:1,dy:0,step:1})).status,401);
  await f.call('a','ready',{roomId:id,ready:true});
  const start=(await f.call('a','start',{roomId:id})).body.room;
  const map=generateDungeonLayout(SECRET),[dx,dy]=cardinal(map,start.members.a.position);
  f.clock(2*60*60*1000+1);
  assert.equal((await f.call('a','move',{roomId:id,dx,dy,step:1})).status,410);
  const another=fixture(),next=(await another.call('a','create')).body,other=next.roomId;
  await another.call('a','ready',{roomId:other,ready:true});
  await another.call('a','start',{roomId:other});
  await another.call('a','leave',{roomId:other});
  assert.equal((await another.call('a','move',{roomId:other,dx,dy,step:1})).status,403);
});
test('room restart resets exploration counters only after a new ready assembly',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body,id=created.roomId;
  await f.call('a','ready',{roomId:id,ready:true});
  const start=await f.call('a','start',{roomId:id});
  assert.equal(start.status,200);
  await f.call('a','cancel-start',{roomId:id});
  assert.equal((await f.call('a','move',{roomId:id,dx:1,dy:0,step:1})).status,409);
  await f.call('a','ready',{roomId:id,ready:true});
  const restarted=await f.call('a','start',{roomId:id});
  assert.equal(restarted.body.room.members.a.moveSeq,0);
  assert.equal(restarted.body.room.members.a.explorationStamina,START_STAMINA);
});

test('tap-to-walk move-route is admitted by the API and advances exactly one move',async()=>{
  const f=fixture(),{id,room,map}=await readyGroup(f);
  const [dx,dy]=cardinal(map,room.members.a.position);
  const payload={roomId:id,vectors:[{dx,dy}],step:1};
  const first=await f.call('a','move-route',payload);
  assert.equal(first.status,200,first.body?.error);
  assert.deepStrictEqual(first.body.room.members.a.position,{
    x:room.members.a.position.x+dx,y:room.members.a.position.y+dy
  });
  assert.equal(first.body.room.members.a.moveSeq,1);
  assert.equal(first.body.room.members.a.explorationStamina,START_STAMINA-1);
  const duplicate=await f.call('a','move-route',payload,1);
  assert.equal(duplicate.status,200,duplicate.body?.error);
  assert.equal(duplicate.body.room.revision,first.body.room.revision,
    'retries cannot double-charge movement');
  assert.equal((await f.call('a','move-route',{
    roomId:id,vectors:[{dx:2,dy:0}],step:2
  })).status,400,'invalid vectors remain rejected');
});
