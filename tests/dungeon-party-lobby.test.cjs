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

test('only authenticated members can ready and updates are revision-idempotent',async()=>{
  const f=fixture();
  const created=(await f.call('a','create')).body;
  const id=created.roomId;
  assert.equal(created.room.members.a.realm,'金丹');
  assert.equal((await f.call('b','ready',{roomId:id,ready:true})).status,403);
  assert.equal((await f.call('a','ready',{roomId:id,ready:'true'})).status,400);
  assert.equal((await f.call('a','ready',{roomId:id,ready:true})).body.room.revision,2);
  assert.equal((await f.call('a','ready',{roomId:id,ready:true})).body.room.revision,2);
  assert.equal((await f.call('a','ready',{roomId:id,ready:false})).body.room.revision,3);
});
test('captain can only assemble when everybody is ready, never entering an unfinished map',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body;
  const id=created.roomId;
  await f.call('b','join-code',{roomCode:created.room.code});
  assert.equal((await f.call('a','start',{roomId:id})).status,409);
  await f.call('a','ready',{roomId:id,ready:true});
  assert.equal((await f.call('a','start',{roomId:id})).status,409);
  await f.call('b','ready',{roomId:id,ready:true});
  assert.equal((await f.call('b','start',{roomId:id})).status,403);
  const assembled=await f.call('a','start',{roomId:id});
  assert.equal(assembled.status,200);
  assert.equal(assembled.body.room.status,'assembled');
  assert.ok(assembled.body.room.assembledAtMs);
  assert.equal((await f.call('a','start',{roomId:id})).body.room.revision,assembled.body.room.revision);
  assert.equal((await f.call('b','reconnect')).body.room.status,'assembled');
  assert.equal((await f.call('c','join-code',{roomCode:created.room.code})).status,409);
  assert.equal((await f.call('c','join-public',{roomId:id})).status,409);
  assert.equal((await f.call('b','ready',{roomId:id,ready:false})).status,409);
  assert.equal((await f.call('a','get',{roomId:id})).body.room.status,'assembled');
  assert.deepEqual(f.a.records.get('users/a').raidTickets,{count:5});
  assert.equal((await f.call('b','cancel-start',{roomId:id})).status,403);
  const reverted=await f.call('a','cancel-start',{roomId:id});
  assert.equal(reverted.status,200);
  assert.equal(reverted.body.room.status,'waiting');
  assert.deepEqual(Object.values(reverted.body.room.members).map(m=>m.ready),[false,false]);
  assert.equal((await f.call('a','cancel-start',{roomId:id})).body.room.revision,reverted.body.room.revision);
});
test('captain kick clears membership pointer and a kicked player can rejoin by invite',async()=>{
  const f=fixture(),created=(await f.call('a','create',{visibility:'public'})).body;
  const id=created.roomId;
  await f.call('b','join-code',{roomCode:created.room.code});
  await f.call('c','join-code',{roomCode:created.room.code});
  assert.equal((await f.call('b','kick',{roomId:id,targetUid:'c'})).status,403);
  assert.equal((await f.call('a','kick',{roomId:id,targetUid:'a'})).status,400);
  assert.equal((await f.call('a','kick',{roomId:id,targetUid:'missing'})).status,404);
  assert.equal((await f.call('a','kick',{roomId:id,targetUid:'c'})).status,200);
  assert.equal((await f.call('c','reconnect')).body.room,null);
  assert.equal((await f.call('c','get',{roomId:id})).status,403);
  assert.equal((await f.call('c','join-public',{roomId:id})).status,200);
  const room=(await f.call('a','get',{roomId:id})).body.room;
  assert.equal(Object.keys(room.members).length,3);
});
test('disband closes code and clears every member index without modifying the old raid',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body;
  await f.call('b','join-code',{roomCode:created.room.code});
  await f.call('c','join-code',{roomCode:created.room.code});
  assert.equal((await f.call('b','disband',{roomId:created.roomId})).status,403);
  const result=await f.call('a','disband',{roomId:created.roomId});
  assert.equal(result.status,200);
  assert.equal(result.body.room.status,'closed');
  for(const uid of ['a','b','c'])
    assert.equal((await f.call(uid,'reconnect')).body.room,null);
  assert.equal((await f.call('d','join-code',{roomCode:created.room.code})).status,404);
  assert.equal((await f.call('a','create')).status,200);
  assert.ok([...f.c.records.keys()].every(key=>!key.startsWith('raidRooms/')));
});
test('leave while assembled returns the remaining members to unready waiting and transfers host',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body,id=created.roomId;
  await f.call('b','join-code',{roomCode:created.room.code});
  await f.call('a','ready',{roomId:id,ready:true});
  await f.call('b','ready',{roomId:id,ready:true});
  await f.call('a','start',{roomId:id});
  const left=await f.call('a','leave',{roomId:id});
  assert.equal(left.status,200);
  assert.equal(left.body.room.status,'waiting');
  assert.equal(left.body.room.hostUid,'b');
  assert.equal(left.body.room.members.b.ready,false);
  assert.equal((await f.call('b','start',{roomId:id})).status,409);
  assert.equal((await f.call('a','reconnect')).body.room,null);
});
test('lobby entry, input, guarded long-press and quiz selectability are present',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  const main=read('public/main.js'),lobby=read('public/cultivation/dungeon-lobby.js');
  const rules=read('public/styles/tactical-quarter-controls.css');
  const renderer=read('public/cultivation/tactical-renderer.js');
  const quiz=read('public/styles/tactical-question-pair.css');
  assert.match(main,/\.\/cultivation\/dungeon-lobby\.js/);
  for(const label of ['data-dg="ready"','data-dg="kick"','data-dg="assemble"','data-dg="disband"','data-dg="invite"','data-dg="quick"'])
    assert.ok(lobby.includes(label),label);
  assert.match(lobby,/xiuxian:dungeon-room-joined/);
  assert.match(lobby,/window\.openDungeonLobby=openLobby/);
  assert.match(rules,/-webkit-touch-callout:none!important/);
  assert.match(rules,/user-select:none!important/);
  assert.match(renderer,/canvas\.addEventListener\('contextmenu',this\.onContextMenu\)/);
  assert.match(renderer,/this\.onContextMenu=event=>event\.preventDefault\(\)/);
  assert.match(renderer,/this\.canvas\.removeEventListener\('contextmenu',this\.onContextMenu\)/);
  assert.doesNotMatch(rules,/#tactical-combat\s*\*\s*\{[^}]*user-select/);
  assert.ok(quiz.length>100,'question styles remain separate and unmodified');
});
