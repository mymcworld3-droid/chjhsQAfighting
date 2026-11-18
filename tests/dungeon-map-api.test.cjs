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
test('room stores secure 24-digit seed once and does not trust request-supplied seed',async()=>{
  const f=fixture(),original=structuredClone(f.a.records.get('users/a'));
  const created=await f.call('a','create',{mapSeed:'user-forged',seed:'user-forged'});
  assert.equal(created.status,200);
  const roomId=created.body.roomId,raw=f.c.records.get(API.ROOMS+'/'+roomId);
  assert.equal(raw.mapVersion,LAYOUT_VERSION);
  assert.equal(raw.mapSeed,SECRET);
  assert.ok(!JSON.stringify(created.body.room).includes(SECRET),'room snapshot must not leak map seed');
  assert.deepStrictEqual(f.a.records.get('users/a'),original);
  const second=await f.call('a','create',{mapSeed:'new-seed'});
  assert.equal(second.body.roomId,roomId);
  assert.equal(f.c.records.get(API.ROOMS+'/'+roomId).mapSeed,SECRET);
});
test('all authorized members, on separate server instances, receive exactly the same map',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body;
  await f.call('b','join-code',{roomCode:created.room.code},1);
  await f.call('c','join-code',{roomCode:created.room.code});
  await f.call('d','join-code',{roomCode:created.room.code},1);
  const all=await Promise.all('abcd'.split('').map((uid,i)=>f.call(uid,'get-map',{
    roomId:created.roomId,seed:'unauthorized-override'
  },i%2)));
  assert.ok(all.every(item=>item.status===200));
  for(const item of all){
    assert.equal(item.body.roomId,created.roomId);
    assert.deepStrictEqual(item.body.map,all[0].body.map);
    assert.equal(item.body.map.layoutVersion,LAYOUT_VERSION);
    assert.equal(item.body.map.branchCount,item.body.map.branches.length);
    assert.equal(item.body.map.seed,SECRET);
  }
  assert.deepStrictEqual(all[0].body.map,generateDungeonLayout(SECRET));
  assert.ok(JSON.stringify(all[0].body).length<200000);
  // Read-only layout discovery cannot consume raid tickets or create map state.
  assert.equal(f.c.records.size,6);
  assert.deepStrictEqual(f.a.records.get('users/a').raidTickets,{count:4});
  const again=await f.call('a','get-map',{roomId:created.roomId});
  assert.deepStrictEqual(again.body.map,all[0].body.map);
});
test('unknown, expired, kicked and unauthenticated viewers cannot read a private map',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body,id=created.roomId;
  assert.equal((await f.call('invalid','get-map',{roomId:id})).status,401);
  assert.equal((await f.call('b','get-map',{roomId:id})).status,403);
  assert.equal((await f.call('b','get-map',{roomId:'nonexistent012'})).status,404);
  assert.equal((await f.call('a','get-map',{roomId:'../unsafe'})).status,400);
  assert.equal((await f.call('a','get-map',{roomId:id})).status,200);
  await f.call('b','join-code',{roomCode:created.room.code});
  assert.equal((await f.call('b','get-map',{roomId:id})).status,200);
  await f.call('a','kick',{roomId:id,targetUid:'b'});
  assert.equal((await f.call('b','get-map',{roomId:id})).status,403);
  f.clock(2*60*60*1000+1);
  assert.equal((await f.call('a','get-map',{roomId:id})).status,410);
});
test('assembled map stays fixed and closed lobbies never expose their old layout',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body,id=created.roomId;
  const before=(await f.call('a','get-map',{roomId:id})).body.map;
  await f.call('a','ready',{roomId:id,ready:true});
  assert.equal((await f.call('a','start',{roomId:id})).status,200);
  assert.deepStrictEqual((await f.call('a','get-map',{roomId:id})).body.map,before);
  await f.call('a','cancel-start',{roomId:id});
  assert.deepStrictEqual((await f.call('a','get-map',{roomId:id})).body.map,before);
  await f.call('a','disband',{roomId:id});
  assert.equal((await f.call('a','get-map',{roomId:id})).status,410);
});
test('pre-map existing rooms use a stable legacy seed without a migration or writes',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body,id=created.roomId;
  const record=f.c.records.get(API.ROOMS+'/'+id);
  delete record.mapSeed;delete record.mapVersion;
  const expected=generateDungeonLayout('legacy:'+id);
  assert.deepStrictEqual((await f.call('a','get-map',{roomId:id})).body.map,expected);
  assert.equal(f.c.records.get(API.ROOMS+'/'+id).mapSeed,undefined);
  f.c.records.get(API.ROOMS+'/'+id).mapVersion=999;
  assert.equal((await f.call('a','get-map',{roomId:id})).status,409);
});
