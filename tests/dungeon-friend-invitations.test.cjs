'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const { PROJECT_IDS }=require('../firebase-admin-projects.cjs');
const registerInvitationApi=require('../invitation-api.cjs');
const {validateRoom}=registerInvitationApi.__test;
const roomId='dungroom12345',code='ABCDEF';
function fixture(){
  const at=Date.now();
  const room={mode:'dungeon',version:1,status:'waiting',hostUid:'a',
    code,expiresAtMs:at+60_000,visibility:'private',
    members:{a:{uid:'a',name:'甲'},b:{uid:'b',name:'乙'}}};
  const records=new Map([
    ['dungeonRooms/'+roomId,room],
    ['users/a',{uid:'a',displayName:'甲',friends:['b']}],
    ['users/b',{uid:'b',displayName:'乙',friends:['a']}],
    ['users/c',{uid:'c',displayName:'丙',friends:[]}]
  ]);
  const collections={
    db:{collection(name){return {doc(id){return {get:async()=>{
      const row=records.get(name+'/'+id);
      return {exists:!!row,data:()=>structuredClone(row)};
    }};}};}},
    a:{db:{collection(name){return {doc(id){return {get:async()=>{
      const row=records.get(name+'/'+id);
      return {exists:!!row,data:()=>structuredClone(row)};
    }};}};}},auth:{verifyIdToken:async token=>({
      uid:token,aud:PROJECT_IDS.A,iss:'https://securetoken.google.com/'+PROJECT_IDS.A
    })}}
  };
  const events=[],handlers=new Map();
  const hub={isOnline:uid=>uid==='b',push:(uid,value)=>events.push({uid,value}),listen(){},remove(){}};
  const app={post:(url,fn)=>handlers.set(url,fn)};
  registerInvitationApi(app,{resolveA:()=>collections.a,
    resolveC:()=>collections.db,hub,logger:{error(){}}});
  async function send(uid,invitation,friendUids=['b','c']){
    let status=200,body;
    await handlers.get('/api/invitations/send')({
      body:{invitation,friendUids},get:()=> 'Bearer '+uid
    },{set(){return this;},status(n){status=n;return this;},json(v){body=v;return this;}});
    return {status,body};
  }
  return {room,records,events,collections,send};
}
test('dungeon invite validates host, room status and code before notifying actual friends',async()=>{
  const f=fixture();
  const result=await f.send('a',{dungeonVersion:1,dungeonCode:code,roomId});
  assert.equal(result.status,200);
  assert.deepEqual(result.body.queuedTo,['b']);
  assert.equal(f.events.length,1);
  assert.equal(f.events[0].uid,'b');
  const invitation=f.events[0].value;
  assert.equal(invitation.dungeonVersion,1);
  assert.equal(invitation.dungeonCode,code);
  assert.equal(invitation.dungeonRoomId,roomId);
  assert.equal(invitation.hostName,'甲');
  assert.equal(invitation.roomId,undefined,'must not invent another room identifier');
  assert.equal(f.records.get('dungeonRooms/'+roomId).status,'waiting');
});
test('forged, nonhost, wrong-code and expired dungeon invites are rejected',async()=>{
  const f=fixture();
  assert.equal((await f.send('b',{dungeonVersion:1,dungeonCode:code,roomId})).status,409);
  assert.equal((await f.send('a',{dungeonVersion:1,dungeonCode:'AAAAAA',roomId})).status,409);
  assert.equal((await f.send('a',{dungeonVersion:2,dungeonCode:code,roomId})).status,400);
  assert.equal((await f.send('a',{dungeonVersion:1,dungeonCode:code,raidVersion:2,roomId})).status,400);
  assert.equal((await f.send('a',{dungeonVersion:1,dungeonCode:code,roomId:'raid-room123'})).status,409);
  f.room.expiresAtMs=Date.now()-1000;
  assert.equal((await f.send('a',{dungeonVersion:1,dungeonCode:code,roomId})).status,409);
  assert.equal(f.events.length,0);
});
test('started, full or transferred rooms cannot send stale host invites',async()=>{
  const f=fixture(),inv={dungeonVersion:1,dungeonCode:code,roomId};
  f.room.status='active';
  assert.equal((await f.send('a',inv)).status,409);
  f.room.status='waiting';
  f.room.members.c={uid:'c'};
  f.room.members.d={uid:'d'};
  assert.equal((await f.send('a',inv)).status,409);
  delete f.room.members.d;
  f.room.hostUid='b';
  assert.equal((await f.send('a',inv)).status,409);
  assert.equal((await f.send('b',inv)).status,200);
});
test('all previous raid and battle invitation handlers remain in place',async()=>{
  const fs=require('node:fs'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../public/main-legacy.js'),'utf8');
  const client=fs.readFileSync(path.join(__dirname,'../public/cultivation/dungeon-room.js'),'utf8');
  assert.match(source,/joinRaidRoomInvite/);
  assert.match(source,/joinBattleRoomV2/);
  assert.match(source,/dungeonInvite \? '合作副本邀請！'/);
  assert.match(source,/xiuxian:dungeon-room-joined/);
  assert.match(client,/listPublicDungeonRooms/);
  assert.match(client,/quickJoinDungeonRoom/);
  assert.match(client,/inviteDungeonFriends/);
  assert.match(client,/acceptDungeonInvitation/);
});
