'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createHandler,roomUsable,recruitmentCard,listPublicRooms}=require('../raid-room-api.cjs').__test;
const now=()=>Date.now();
function store(initial={}) {
  const docs=new Map(Object.entries(initial));let id=0,chain=Promise.resolve();
  const ref=(collection,name)=>({id:name,key:collection+'/'+name,
    get:async()=>snap(ref(collection,name)),set:async data=>{docs.set(collection+'/'+name,structuredClone(data));}});
  const snap=r=>({id:r.id,exists:docs.has(r.key),data:()=>structuredClone(docs.get(r.key))});
  return {docs,collection(name){
    const matches=[];let max=150;
    const query={doc(key){return ref(name,key||'room'+String(++id).padStart(7,'0'));},
      where(field,operation,val){matches.push({field,operation,val});return query;},
      limit(n){max=n;return query;},
      async get(){
        const list=[...docs].filter(([key,value])=>key.startsWith(name+'/')&&
          matches.every(x=>x.operation==='=='?value[x.field]===x.val:false))
          .slice(0,max).map(([key])=>snap(ref(name,key.slice(name.length+1))));
        return {empty:list.length===0,docs:list};
      }};
    return query;
  },runTransaction(work){
    const p=chain.then(async()=>{
      const changes=new Map();let reading=true;
      const tx={get:async r=>{assert.ok(reading,'reads must precede writes');return snap(r);},
        update:(r,patch)=>{reading=false;changes.set(r.key,{...(changes.get(r.key)||docs.get(r.key)||{}),...structuredClone(patch)});},
        set:(r,body)=>{reading=false;changes.set(r.key,structuredClone(body));}};
      const output=await work(tx);for(const [key,value] of changes)docs.set(key,value);return output;
    });chain=p.catch(()=>{});return p;
  }};
}
const profile=(uid,score=68)=>({uid,displayName:'修士'+uid,stats:{totalScore:score,attack:180,maxHp:900},
 raidTickets:{count:5,lastGrantDate:'2099-01-01'}});
function fixture(scores={a:68,b:68,c:68,d:68,e:68}) {
  const users=Object.fromEntries(Object.entries(scores).map(([uid,score])=>['users/'+uid,profile(uid,score)]));
  const a=store(users),c=store();
  const handler=createHandler({
    resolveA:()=>({db:a,auth:{verifyIdToken:async token=>({uid:token,aud:'question-learning',iss:'https://securetoken.google.com/question-learning'})}}),
    resolveC:()=>({db:c}),logger:{error(){}}
  });
  async function call(uid,action,props={}){
    let status=200,body;
    await handler({body:{action,...props},get:()=> 'Bearer '+uid},
      {set(){return this;},status(n){status=n;return this;},json(x){body=x;return this;}});
    return {status,body};
  }
  return {a,c,call};
}
test('private rooms are not discoverable, while public list exposes no invite code or player UID',async()=>{
  const {a,c,call}=fixture();
  const privateRoom=await call('a','create',{difficulty:'normal'});
  const publicRoom=await call('b','create',{difficulty:'hard',visibility:'public'});
  assert.equal(privateRoom.status,200);assert.equal(publicRoom.status,200);
  assert.equal(privateRoom.body.room.visibility,'private');assert.equal(publicRoom.body.room.visibility,'public');
  const discovered=await call('c','list-public');
  assert.equal(discovered.status,200);
  assert.equal(discovered.body.rooms.length,1);
  assert.equal(discovered.body.rooms[0].roomId,publicRoom.body.roomId);
  assert.equal(discovered.body.rooms[0].difficulty,'hard');
  assert.equal(discovered.body.rooms[0].hostName,'修士b');
  const detail=JSON.stringify(discovered.body.rooms);
  assert.ok(!detail.includes(privateRoom.body.roomId));
  assert.ok(!detail.includes(publicRoom.body.room.code));
  assert.ok(!detail.includes('"hostUid"'));
  assert.ok(!detail.includes('"members"'));
  assert.deepEqual(a.docs.get('users/c'),profile('c'), 'list must not mutate tickets');
  assert.equal((await call('c','join-public',{roomId:privateRoom.body.roomId})).status,409);
  assert.equal((await call('c','join-code',{roomCode:privateRoom.body.room.code})).status,200);
});
test('public joins enforce full state, official difficulty unlock and transactional concurrency',async()=>{
  const {c,call}=fixture({a:68,b:10,c:68,d:68,e:68,f:68});
  const result=await call('a','create',{difficulty:'extreme',visibility:'public'});
  const roomId=result.body.roomId;
  const noAccess=await call('b','join-public',{roomId});
  assert.equal(noAccess.status,403);
  assert.match(noAccess.body.error,/元嬰期/);
  const joins=await Promise.all(['c','d','e','f'].map(uid=>call(uid,'join-public',{roomId})));
  assert.equal(joins.filter(row=>row.status===200).length,3,'four seats maximum');
  assert.equal(joins.filter(row=>row.status===409).length,1);
  assert.equal(Object.keys(c.docs.get('raidRooms/'+roomId).members).length,4);
  const found=await call('a','list-public');
  assert.equal(found.body.rooms.length,0,'full rooms are hidden from open recruitment');
});
test('quick matchmaking joins public parties but never steals the private host party',async()=>{
  const {c,call}=fixture();
  const privateRoom=await call('a','create',{difficulty:'normal'});
  const publicRoom=await call('b','quick',{difficulty:'normal'});
  const quick=await call('c','quick',{difficulty:'normal'});
  assert.equal(quick.body.roomId,publicRoom.body.roomId);
  assert.notEqual(quick.body.roomId,privateRoom.body.roomId);
  assert.equal(c.docs.get('raidRooms/'+publicRoom.body.roomId).visibility,'public');
});
test('only online hosts change visibility while waiting; all invite-only rooms remain private on legacy schema',async()=>{
  const {c,call}=fixture();
  const created=await call('a','create',{difficulty:'normal'});
  const roomId=created.body.roomId;
  assert.equal((await call('b','set-visibility',{roomId,visibility:'public'})).status,403);
  const opened=await call('a','set-visibility',{roomId,visibility:'public'});
  assert.equal(opened.status,200);
  assert.equal((await call('b','list-public')).body.rooms.length,1);
  const closed=await call('a','set-visibility',{roomId,visibility:'private'});
  assert.equal(closed.status,200);
  assert.equal((await call('b','list-public')).body.rooms.length,0);
  assert.equal((await call('b','join-public',{roomId})).status,409);
  assert.equal((await call('b','join-code',{roomCode:created.body.room.code})).status,200);
  const room={...c.docs.get('raidRooms/'+roomId),visibility:undefined};
  c.docs.set('raidRooms/'+roomId,room);
  assert.equal(recruitmentCard(roomId,room),null);
  c.docs.set('raidRooms/'+roomId,{...room,status:'active',visibility:'public'});
  assert.equal((await call('a','set-visibility',{roomId,visibility:'private'})).status,409);
});
test('stale, expired, off-line host, closed and started parties are absent',async()=>{
  const online={uid:'a',name:'甲',online:true,ready:false,heartbeatAtMs:now()};
  const baseline={version:2,bossId:'shen-qingshuang',difficulty:'normal',status:'waiting',
   visibility:'public',hostUid:'a',createdAtMs:now(),members:{a:online}};
  assert.ok(recruitmentCard('room12345',baseline));
  assert.equal(recruitmentCard('room12345',{...baseline,hostUid:'b'}),null);
  assert.equal(recruitmentCard('room12345',{...baseline,status:'active'}),null);
  assert.equal(recruitmentCard('room12345',{...baseline,createdAtMs:now()-31*60*1000}),null);
  assert.equal(recruitmentCard('room12345',{...baseline,members:{a:{...online,heartbeatAtMs:now()-60*1000}}}),null);
  const four={a:online,b:{uid:'b',online:false},c:{uid:'c',online:false},d:{uid:'d',online:false}};
  assert.equal(recruitmentCard('room12345',{...baseline,members:four}),null,
    'occupied offline seats must not render misleading available slots');
  assert.equal(roomUsable({...baseline,status:'closed'}),false);
});
test('public recruitment client renders visible cards and reuses room state reconnect',()=>{
  const ui=fs.readFileSync(path.join(__dirname,'../public/cultivation/raid-mode.js'),'utf8');
  const api=fs.readFileSync(path.join(__dirname,'../public/cultivation/raid-room.js'),'utf8');
  assert.match(ui,/data-public-refresh/);
  assert.match(ui,/data-public-room-id/);
  assert.match(ui,/data-visibility/);
  assert.match(ui,/async function refreshPublicRecruitment/);
  assert.match(ui,/mode === 'public' \? await joinPublicRaidRoom/);
  assert.match(api,/export async function listPublicRaidRooms/);
  assert.match(api,/export async function joinPublicRaidRoom/);
  assert.match(api,/remember\(result.roomId\)/);
});
