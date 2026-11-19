'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PROJECT_IDS}=require('../firebase-admin-projects.cjs');
const {__test:API}=require('../dungeon-room-api.cjs');
const {generateDungeonLayout,walkable}=require('../dungeon-map-generator.cjs');
const SECRET='0a1b2c3d4e5f60718293a4b5';
function store(initial={}){
  const records=new Map(Object.entries(initial));let serial=0,chain=Promise.resolve();
  const clone=value=>structuredClone(value);
  const snap=ref=>({id:ref.id,exists:records.has(ref.key),
    data:()=>clone(records.get(ref.key))});
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
        const tx={get:async ref=>{
          assert.equal(written,false,'transaction reads must precede writes');
          return snap(ref);
        },set:(ref,value)=>{written=true;changes.set(ref.key,clone(value));},
        update:(ref,value)=>{written=true;changes.set(ref.key,
          {...clone(changes.get(ref.key)||records.get(ref.key)),...clone(value)});}};
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
  const users=Object.fromEntries('ab'.split('').map(uid=>['users/'+uid,
    {uid,displayName:'修士'+uid,stats:{totalScore:50},raidTickets:{count:4}}]));
  const a=store(users),c=store(),now=1800000000000;
  const build=()=>API.createHandler({
    resolveA:()=>({db:a,auth:{verifyIdToken:async token=>{
      if(token==='invalid')throw Error('invalid');
      return {uid:token,aud:PROJECT_IDS.A,iss:'https://securetoken.google.com/'+PROJECT_IDS.A};
    }}}),
    resolveC:()=>({db:c}),seedFactory:()=>SECRET,
    clock:()=>now,logger:{error(){}}
  });
  const handlers=[build(),build()];
  async function call(uid,action,body={},instance=0){
    let status=200,result;
    await handlers[instance]({body:{action,...body},
      get:key=>key==='authorization'?'Bearer '+uid:''},{
      set(){return this;},status(value){status=value;return this;},
      json(value){result=value;return this;}
    });
    return {status,body:result};
  }
  return {a,c,call};
}
async function setup(){
  const f=fixture(),created=(await f.call('a','create')).body;
  const id=created.roomId;
  await f.call('b','join-code',{roomCode:created.room.code},1);
  for(const uid of 'ab')await f.call(uid,'ready',{roomId:id,ready:true});
  assert.equal((await f.call('a','start',{roomId:id})).status,200);
  const raw=f.c.records.get('dungeonRooms/'+id);
  const wolf=raw.enemies.find(e=>e.kind==='wolf');
  const map=generateDungeonLayout(SECRET);
  const spot=[[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy])=>
    ({x:wolf.position.x+dx,y:wolf.position.y+dy})).find(p=>walkable(map,p));
  assert.ok(spot);
  raw.enemies=[wolf];raw.members.a.position=spot;raw.members.b.position=spot;
  return {f,id,raw,wolf};
}
test('two distinct servers commit concurrent strikes once and share one enemy health',async()=>{
  const {f,id,raw,wolf}=await setup();
  const account=structuredClone(f.a.records.get('users/a'));
  const [a,b]=await Promise.all([
    f.call('a','strike',{roomId:id,enemyId:wolf.id,seq:1,
      damage:100000,explorationStamina:100000},0),
    f.call('b','strike',{roomId:id,enemyId:wolf.id,seq:1},1)
  ]);
  assert.equal(a.status,200);assert.equal(b.status,200);
  const stored=f.c.records.get('dungeonRooms/'+id);
  assert.equal(stored.enemies.length,0);
  assert.equal(stored.members.a.strikeSeq,1);
  assert.equal(stored.members.b.strikeSeq,1);
  assert.equal(stored.members.a.explorationStamina,98);
  assert.equal(stored.members.b.explorationStamina,98);
  const before=stored.revision;
  const same=await f.call('a','strike',{roomId:id,enemyId:wolf.id,seq:1},1);
  assert.equal(same.status,200);
  assert.equal(f.c.records.get('dungeonRooms/'+id).revision,before);
  assert.deepStrictEqual(f.a.records.get('users/a'),account);
});
test('forged and stale attacks are rejected, no player stamina or room revision spent',async()=>{
  const {f,id,raw,wolf}=await setup();
  const original=raw.revision;
  assert.equal((await f.call('a','strike',{roomId:id,enemyId:wolf.id,seq:0})).status,400);
  assert.equal((await f.call('a','strike',{roomId:id,enemyId:wolf.id,seq:2})).status,409);
  assert.equal((await f.call('invalid','strike',{roomId:id,enemyId:wolf.id,seq:1})).status,401);
  raw.members.a.downed=true;
  assert.equal((await f.call('a','strike',{roomId:id,enemyId:wolf.id,seq:1})).status,409);
  raw.members.a.downed=false;raw.members.a.explorationStamina=0;
  assert.equal((await f.call('a','strike',{roomId:id,enemyId:wolf.id,seq:1})).status,409);
  assert.equal(raw.revision,original);
});
