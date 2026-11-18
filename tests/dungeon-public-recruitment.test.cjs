'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PROJECT_IDS}=require('../firebase-admin-projects.cjs');
const {__test:API}=require('../dungeon-room-api.cjs');
function store(initial={}){
  const records=new Map(Object.entries(initial));let seq=0,chain=Promise.resolve();
  const clone=value=>structuredClone(value);
  const snap=ref=>({id:ref.id,exists:records.has(ref.key),data:()=>clone(records.get(ref.key))});
  const ref=(col,id)=>{const name=id||'dung'+String(++seq).padStart(8,'0');const v={id:name,key:col+'/'+name};v.get=async()=>snap(v);return v;};
  return {records,collection(col){
    const constraints=[];let limit=150;
    const query={
      doc:id=>ref(col,id),
      where(field,op,val){constraints.push({field,op,val});return query;},
      limit(n){limit=n;return query;},
      async get(){
        const docs=[...records].filter(([key,data])=>key.startsWith(col+'/')&&constraints.every(
          x=>x.op==='=='&&data[x.field]===x.val)).slice(0,limit)
          .map(([key])=>snap(ref(col,key.slice(col.length+1))));
        return {docs,empty:docs.length===0};
      }
    };
    return query;
  },runTransaction(fn){
    const p=chain.then(async()=>{
      let written=false;const changes=new Map();
      const tx={
        get:async r=>{assert.equal(written,false,'all reads before writes');return snap(r);},
        set:(r,v)=>{written=true;changes.set(r.key,clone(v));},
        update:(r,v)=>{written=true;changes.set(r.key,{...clone(records.get(r.key)),...clone(v)});}
      };
      const result=await fn(tx);
      for(const [key,value] of changes)records.set(key,value);
      return result;
    });
    chain=p.catch(()=>{});return p;
  }};
}
function fixture(){
  const users=Object.fromEntries('abcdefghij'.split('').map(uid=>['users/'+uid,
    {uid,displayName:'修士'+uid,stats:{totalScore:30},raidTickets:{count:5}}]));
  const a=store(users),c=store(),at=1800000000000;
  const handler=API.createHandler({resolveA:()=>({db:a,auth:{
    verifyIdToken:async token=>({uid:token,aud:PROJECT_IDS.A,
      iss:'https://securetoken.google.com/'+PROJECT_IDS.A})
  }}),resolveC:()=>({db:c}),clock:()=>at,logger:{error(){}}});
  async function call(uid,action,payload={}){
    let status=200,body;
    await handler({body:{action,...payload},get:()=> 'Bearer '+uid},{
      set(){return this;},status(n){status=n;return this;},json(v){body=v;return this;}
    });
    return {status,body};
  }
  return {a,c,at,call};
}
test('public list contains no code, UID, member details or private parties',async()=>{
  const f=fixture();
  const pri=(await f.call('a','create')).body,pub=(await f.call('b','create',{visibility:'public'})).body;
  assert.equal(pri.room.visibility,'private');
  assert.equal(pub.room.visibility,'public');
  const found=await f.call('c','list-public');
  assert.equal(found.status,200);
  assert.equal(found.body.rooms.length,1);
  assert.equal(found.body.rooms[0].roomId,pub.roomId);
  assert.equal(found.body.rooms[0].hostName,'修士b');
  const json=JSON.stringify(found.body.rooms);
  for(const secret of [pri.roomId,pub.room.code,'"hostUid"','"members"','"uid"'])
    assert.ok(!json.includes(secret),'public response leaked '+secret);
  assert.equal((await f.call('c','join-public',{roomId:pri.roomId})).status,409);
  assert.equal((await f.call('c','get',{roomId:pub.roomId})).status,403);
});
test('host-only visibility toggle is idempotent and revokes public joining',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body;
  assert.equal((await f.call('b','set-visibility',{roomId:created.roomId,visibility:'public'})).status,403);
  assert.equal((await f.call('a','set-visibility',{roomId:created.roomId,visibility:'invalid'})).status,400);
  const opened=await f.call('a','set-visibility',{roomId:created.roomId,visibility:'public'});
  assert.equal(opened.body.room.revision,2);
  const retry=await f.call('a','set-visibility',{roomId:created.roomId,visibility:'public'});
  assert.equal(retry.body.room.revision,2);
  assert.equal((await f.call('b','join-public',{roomId:created.roomId})).status,200);
  assert.equal((await f.call('a','set-visibility',{roomId:created.roomId,visibility:'private'})).status,200);
  assert.equal((await f.call('c','join-public',{roomId:created.roomId})).status,409);
  assert.equal((await f.call('c','join-code',{roomCode:created.room.code})).status,200);
  assert.equal((await f.call('c','list-public')).body.rooms.length,0);
});
test('concurrent public joins are bounded by four and retry is stable',async()=>{
  const f=fixture(),r=(await f.call('a','create',{visibility:'public'})).body;
  const joins=await Promise.all(['b','c','d','e','f','g'].map(uid=>
    f.call(uid,'join-public',{roomId:r.roomId})));
  assert.equal(joins.filter(v=>v.status===200).length,3);
  assert.equal(joins.filter(v=>v.status===409).length,3);
  const state=(await f.call('a','get',{roomId:r.roomId})).body.room;
  assert.equal(Object.keys(state.members).length,4);
  assert.equal(state.revision,4);
  assert.equal((await f.call('b','join-public',{roomId:r.roomId})).body.room.revision,4);
  assert.equal((await f.call('a','list-public')).body.rooms.length,0,'full room hidden');
});
test('quick joins existing public lobby; never changes or enters private lobby',async()=>{
  const f=fixture();
  const privateRoom=(await f.call('a','create')).body;
  const pub=(await f.call('b','create',{visibility:'public'})).body;
  const quick=await f.call('c','quick');
  assert.equal(quick.body.roomId,pub.roomId);
  assert.notEqual(quick.body.roomId,privateRoom.roomId);
  const again=await f.call('c','quick');
  assert.equal(again.body.roomId,pub.roomId);
  const existing=await f.call('a','quick');
  assert.equal(existing.body.roomId,privateRoom.roomId);
  assert.equal(existing.body.room.visibility,'private');
});
test('quick with no available public lobby creates one and parallel retry remains a single room',async()=>{
  const f=fixture();
  const pair=await Promise.all([f.call('a','quick'),f.call('a','quick')]);
  assert.equal(pair[0].status,200);
  assert.equal(pair[1].status,200);
  assert.equal(pair[0].body.roomId,pair[1].body.roomId);
  assert.equal(pair[0].body.room.visibility,'public');
  assert.equal([...f.c.records.keys()].filter(k=>k.startsWith(API.ROOMS+'/')).length,1);
  assert.equal((await f.call('b','quick')).body.roomId,pair[0].body.roomId);
});
test('expired, started, full, missing-host and newly privatized rooms are excluded',async()=>{
  const f=fixture(),old=(await f.call('a','create',{visibility:'public'})).body;
  const key=API.ROOMS+'/'+old.roomId;
  f.c.records.get(key).expiresAtMs=f.at-1;
  assert.equal((await f.call('b','list-public')).body.rooms.length,0);
  assert.equal((await f.call('b','join-public',{roomId:old.roomId})).status,409);
  const next=(await f.call('c','create',{visibility:'public'})).body;
  const key2=API.ROOMS+'/'+next.roomId;
  f.c.records.get(key2).status='active';
  assert.equal((await f.call('b','list-public')).body.rooms.length,0);
  const third=(await f.call('d','create',{visibility:'public'})).body;
  const key3=API.ROOMS+'/'+third.roomId;
  f.c.records.get(key3).hostUid='missing';
  assert.equal((await f.call('b','list-public')).body.rooms.length,0);
  assert.equal((await f.call('b','join-public',{roomId:third.roomId})).status,409);
});
test('old raid and tactical collections remain untouched by dungeon recruitment',async()=>{
  const f=fixture(),before=structuredClone(f.a.records.get('users/a'));
  await f.call('a','quick');await f.call('b','quick');await f.call('b','leave',{
    roomId:(await f.call('b','reconnect')).body.roomId
  });
  assert.deepEqual(f.a.records.get('users/a'),before);
  assert.ok([...f.c.records.keys()].every(k=>!k.startsWith('raidRooms/')&&!k.startsWith('tacticalBattleRooms/')));
});
