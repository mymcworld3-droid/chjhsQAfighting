'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PROJECT_IDS}=require('../firebase-admin-projects.cjs');
const API=require('../dungeon-room-api.cjs').__test;

function store(initial={}){
  const records=new Map(Object.entries(initial));let next=0,chain=Promise.resolve();
  const doc=(collection,id)=>{const name=id||'dungeon'+String(++next).padStart(8,'0');const ref={id:name,key:collection+'/'+name};ref.get=async()=>snap(ref);return ref;};
  const snap=ref=>({id:ref.id,exists:records.has(ref.key),data:()=>structuredClone(records.get(ref.key))});
  return {records,collection(name){return {doc:id=>doc(name,id),get:()=>null};},
    runTransaction(fn){
      const p=chain.then(async()=>{
        const changes=new Map();let written=false;
        const tx={
          get:async ref=>{assert.equal(written,false,'transaction must read before writes');return snap(ref);},
          set:(ref,value)=>{written=true;changes.set(ref.key,structuredClone(value));},
          update:(ref,patch)=>{written=true;changes.set(ref.key,{...structuredClone(changes.get(ref.key)||records.get(ref.key)),...structuredClone(patch)});}
        };
        const result=await fn(tx);
        for(const [key,val]of changes)records.set(key,val);
        return result;
      });
      chain=p.catch(()=>{});return p;
    },
    read:(collection,id)=>snap(doc(collection,id))
  };
}
function fixture({codeFactory}={}){
  const users=Object.fromEntries('abcdef'.split('').map(uid=>['users/'+uid,
    {uid,displayName:'修士'+uid,raidTickets:{count:3},stats:{totalScore:10}}]));
  const a=store(users),c=store(),at=1800000000000;
  const handler=API.createHandler({
    resolveA:()=>({db:a,auth:{verifyIdToken:async token=>{
      if(token==='invalid')throw Error('bad token');
      return {uid:token,aud:PROJECT_IDS.A,iss:'https://securetoken.google.com/'+PROJECT_IDS.A};
    }}}),
    resolveC:()=>({db:c}),
    clock:()=>at,
    codeFactory,
    logger:{error(){}}
  });
  async function call(uid,action,props={},authorized=true){
    let status=200,body;
    await handler({body:{action,...props},get:()=>authorized?'Bearer '+uid:''},{
      set(){return this;},status(value){status=value;return this;},json(value){body=value;return this;}
    });
    return {status,body};
  }
  return {a,c,at,call};
}
test('dungeon uses separate private C-domain storage, A auth, and does not spend raid tickets',async()=>{
  const f=fixture(),before=structuredClone(f.a.records.get('users/a'));
  assert.equal((await f.call('a','create',{},false)).status,401);
  assert.equal((await f.call('invalid','create')).status,401);
  const created=await f.call('a','create');
  assert.equal(created.status,200);
  assert.equal(created.body.room.mode,'dungeon');
  assert.equal(created.body.room.visibility,'private');
  assert.equal(created.body.room.maxMembers,4);
  assert.match(created.body.room.code,/^[A-HJ-NP-Z2-9]{6}$/);
  assert.deepEqual(Object.keys(created.body.room.members),['a']);
  assert.deepEqual(f.a.records.get('users/a'),before);
  assert.equal(f.c.records.size,3);
  assert.equal([...f.c.records.keys()].some(k=>k.startsWith('raidRooms/')),false);
  const duplicate=await f.call('a','create');
  assert.equal(duplicate.body.roomId,created.body.roomId,'lost create reply is idempotent');
  assert.equal(duplicate.body.room.revision,1);
});
test('joining by normalized six-digit code is atomic and capped at four users',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body;
  const code=created.room.code;
  const joins=await Promise.all(['b','c','d','e'].map(uid=>f.call(uid,'join-code',{roomCode:code.toLowerCase()})));
  assert.equal(joins.filter(v=>v.status===200).length,3);
  assert.equal(joins.filter(v=>v.status===409).length,1);
  const joined=(await f.call('a','get',{roomId:created.roomId})).body.room;
  assert.equal(Object.keys(joined.members).length,4);
  assert.equal(joined.revision,4);
  const retry=await f.call('b','join-code',{roomCode:code});
  assert.equal(retry.status,200);
  assert.equal(retry.body.room.revision,4,'duplicate join must not consume a second seat');
  assert.equal((await f.call('e','join-code',{roomCode:'BAD'})).status,400);
  assert.equal((await f.call('e','join-code',{roomCode:'ABCDEF'})).status,404);
});
test('private details are member-only and reconnect works across devices',async()=>{
  const f=fixture(),room=(await f.call('a','create')).body;
  assert.equal((await f.call('b','get',{roomId:room.roomId})).status,403);
  assert.equal((await f.call('b','reconnect')).body.room,null);
  assert.equal((await f.call('b','join-code',{roomCode:room.room.code})).status,200);
  const resumed=await f.call('b','reconnect');
  assert.equal(resumed.body.roomId,room.roomId);
  assert.equal(resumed.body.room.members.a.name,'修士a');
  assert.equal((await f.call('b','get',{roomId:'../../../raidRooms'})).status,400);
});
test('one user cannot be in two live dungeons and different pending creates reuse their room',async()=>{
  const f=fixture(),a=(await f.call('a','create')).body,b=(await f.call('b','create')).body;
  await f.call('c','join-code',{roomCode:a.room.code});
  assert.equal((await f.call('c','join-code',{roomCode:b.room.code})).status,409);
  const two=await Promise.all([f.call('d','create'),f.call('d','create')]);
  assert.equal(two[0].status,200);
  assert.equal(two[1].body.roomId,two[0].body.roomId);
});
test('host departure transfers leadership, last departure closes code and clears pointer',async()=>{
  const f=fixture(),room=(await f.call('a','create')).body;
  await f.call('b','join-code',{roomCode:room.room.code});
  await f.call('c','join-code',{roomCode:room.room.code});
  const leave=await f.call('a','leave',{roomId:room.roomId});
  assert.equal(leave.status,200);
  assert.equal(leave.body.room.hostUid,'b');
  assert.equal(leave.body.room.members.a,undefined);
  assert.equal((await f.call('a','reconnect')).body.room,null);
  assert.equal((await f.call('a','get',{roomId:room.roomId})).status,403);
  assert.equal((await f.call('b','leave',{roomId:room.roomId})).status,200);
  assert.equal((await f.call('c','leave',{roomId:room.roomId})).body.room.status,'closed');
  assert.equal((await f.call('c','leave',{roomId:room.roomId})).status,200,'leave retry idempotent');
  assert.equal((await f.call('d','join-code',{roomCode:room.room.code})).status,404);
  assert.equal(f.c.records.get(API.CODES+'/'+room.room.code).status,'closed');
  assert.equal((await f.call('a','create')).status,200);
});
test('stale leave cannot kick a user from another live room',async()=>{
  const f=fixture(),r=(await f.call('a','create')).body;
  await f.call('a','leave',{roomId:r.roomId});
  const newer=(await f.call('a','create')).body;
  assert.notEqual(newer.roomId,r.roomId);
  assert.equal((await f.call('a','leave',{roomId:r.roomId})).status,403);
  assert.equal((await f.call('a','reconnect')).body.roomId,newer.roomId);
});
test('expired, closed and already-started rooms cannot be joined; old pointers do not revive expired rooms',async()=>{
  const f=fixture(),room=(await f.call('a','create')).body;
  const key=API.ROOMS+'/'+room.roomId;
  const existing=f.c.records.get(key);
  f.c.records.set(key,{...existing,expiresAtMs:f.at-1});
  assert.equal((await f.call('b','join-code',{roomCode:room.room.code})).status,409);
  assert.equal((await f.call('a','reconnect')).body.room,null);
  const replacement=(await f.call('a','create')).body;
  assert.notEqual(replacement.roomId,room.roomId);
  const secondKey=API.ROOMS+'/'+replacement.roomId;
  f.c.records.set(secondKey,{...f.c.records.get(secondKey),status:'active'});
  assert.equal((await f.call('b','join-code',{roomCode:replacement.room.code})).status,409);
});
test('existing raid room API and tactical core remain separately wired',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  const client=fs.readFileSync(path.join(__dirname,'../public/cultivation/dungeon-room.js'),'utf8');
  assert.match(server,/registerRaidRoomApi\(app\)/);
  assert.match(server,/registerTacticalCombatApi\(app\)/);
  assert.match(server,/registerDungeonRoomApi\(app\)/);
  assert.match(client,/authenticatedMainFetch/);
  assert.match(client,/reconnectDungeonRoom/);
  assert.doesNotMatch(client,/localStorage/);
});

test('closing an expired lobby cannot invalidate a newer lobby reusing its old code',async()=>{
  const f=fixture({codeFactory:()=> 'AAAAAA'});
  const old=(await f.call('a','create')).body;
  const oldPath=API.ROOMS+'/'+old.roomId, codePath=API.CODES+'/AAAAAA';
  f.c.records.get(oldPath).expiresAtMs=f.at-1;
  f.c.records.get(codePath).expiresAtMs=f.at-1;
  const newer=(await f.call('b','create')).body;
  assert.equal(newer.room.code,'AAAAAA');
  assert.notEqual(newer.roomId,old.roomId);
  assert.equal((await f.call('a','leave',{roomId:old.roomId})).status,200);
  assert.equal(f.c.records.get(codePath).roomId,newer.roomId);
  assert.equal((await f.call('c','join-code',{roomCode:'AAAAAA'})).status,200);
});

test('room codes reserve transactionally and retry collisions instead of leaking another party',async()=>{
  const codes=['BBBBBB','BBBBBB','CCCCCC'];let n=0;
  const f=fixture({codeFactory:()=>codes[n++]||'DDDDDD'});
  const a=(await f.call('a','create')).body,b=(await f.call('b','create')).body;
  assert.equal(a.room.code,'BBBBBB');
  assert.equal(b.room.code,'CCCCCC');
  assert.notEqual(a.roomId,b.roomId);
  assert.equal((await f.call('c','join-code',{roomCode:'BBBBBB'})).body.roomId,a.roomId);
  assert.equal((await f.call('d','join-code',{roomCode:'CCCCCC'})).body.roomId,b.roomId);
});

test('A-side isAdmin alone authorizes dungeon-wide fixed stamina; browser flags are ignored',async()=>{
  const f=fixture();
  const adminUser=f.a.records.get('users/a');
  const normalUser=f.a.records.get('users/b');
  adminUser.isAdmin=true;normalUser.isAdmin=false;
  const created=await f.call('a','create',{dungeonAdmin:false,isAdmin:false});
  assert.equal(created.status,200);
  assert.equal(created.body.room.members.a.dungeonAdmin,true);
  const join=await f.call('b','join-code',{
    roomCode:created.body.room.code,dungeonAdmin:true,isAdmin:true
  });
  assert.equal(join.status,200);
  assert.equal(join.body.room.members.b.dungeonAdmin,false,
    'a regular player cannot claim the administrator privilege in a request');
  // Read permissions again at departure, including changes made in A after
  // creating the room. Browser content cannot set that bit.
  adminUser.isAdmin=false;normalUser.isAdmin=true;
  await f.call('a','ready',{roomId:created.body.roomId,ready:true});
  await f.call('b','ready',{roomId:created.body.roomId,ready:true});
  const started=await f.call('a','start',{roomId:created.body.roomId});
  assert.equal(started.status,200,JSON.stringify(started.body));
  assert.equal(started.body.room.members.a.dungeonAdmin,false);
  assert.equal(started.body.room.members.b.dungeonAdmin,true);
  assert.equal(started.body.room.members.b.explorationStamina,10);
  assert.equal(started.body.room.members.a.explorationStamina,10);
});

test('reconnecting to a pre-upgrade dungeon refreshes admin rights from A, not the browser',async()=>{
  const f=fixture(),user=f.a.records.get('users/a');
  user.isAdmin=false;
  const created=(await f.call('a','create')).body;
  const id=created.roomId,ref=API.ROOMS+'/'+id;
  let room=f.c.records.get(ref);
  room={...room,status:'assembled',assembledAtMs:f.at,
    members:{...room.members,a:{...room.members.a,explorationStamina:2}}};
  delete room.members.a.dungeonAdmin; // saved by an older deployment
  f.c.records.set(ref,room);
  user.isAdmin=true;
  const updated=await f.call('a','reconnect');
  assert.equal(updated.status,200);
  assert.equal(updated.body.room.members.a.dungeonAdmin,true);
  assert.equal(updated.body.room.members.a.explorationStamina,10);
  assert.equal(f.c.records.get(ref).members.a.explorationStamina,10);
  const revision=f.c.records.get(ref).revision;
  assert.equal((await f.call('a','get',{roomId:id})).body.room.revision,revision,
    'refreshing a current role cannot produce an endless SSE revision loop');
  user.isAdmin=false;
  const revoked=await f.call('a','get',{roomId:id});
  assert.equal(revoked.body.room.members.a.dungeonAdmin,false);
  assert.equal(revoked.body.room.members.a.explorationStamina,10);
  assert.equal(f.c.records.get(ref).members.a.dungeonAdmin,false);
});
