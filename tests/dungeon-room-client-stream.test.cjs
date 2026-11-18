'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/dungeon-room.js'),'utf8')
  .replace(/^import [^\n]+;\s*$/gm,'')
  .replace(/^export (const|function|async function)\b/gm,'$1');

function harness(){
  let uid='a',nextTimer=0;
  const callbacks=new Map(),sessions=[],requests=[],errors=[],statuses=[],updates=[];
  const currentUser=()=>uid?{uid}:null;
  const setTimeoutFake=(fn,delay)=>{
    const id=++nextTimer;
    callbacks.set(id,{fn,delay});return id;
  };
  const clearTimeoutFake=id=>callbacks.delete(id);
  const transport=async(url,init)=>{
    const payload=JSON.parse(init.body);
    requests.push({url,...payload});
    return {
      ok:true,status:200,
      json:async()=>({ok:true,revision:5})
    };
  };
  const events=(response,next,signal,progress)=>new Promise(resolve=>{
    const session={next,signal,resolve,reject:null};
    sessions.push(session);
    session.reject=error=>{
      session.rejectWith(error);
    };
    const rejectHolder=new Promise((_,reject)=>{session.rejectWith=reject;});
    // A second promise permits testing server-enforced 403 revocation.
    signal.addEventListener('abort',resolve,{once:true});
    progress();
    rejectHolder.catch(error=>{session.error=error;resolve();});
  }).then(()=>{
    const session=sessions.at(-1);
    if(session?.error)throw session.error;
  });
  const context={
    authenticatedMainFetch:transport,getMainUser:currentUser,readRoomEvents:events,
    AbortController,setTimeout:setTimeoutFake,clearTimeout:clearTimeoutFake,
    Error,JSON,Array,Number,String,Math,RegExp
  };
  const exposed=vm.runInNewContext(source+
    '\n({subscribeDungeonRoom,heartbeatDungeonRoom})',context);
  const connect=roomId=>exposed.subscribeDungeonRoom(roomId,
    state=>updates.push(state),error=>errors.push(error),online=>statuses.push(online));
  const flush=async()=>{await Promise.resolve();await new Promise(resolve=>setImmediate(resolve));};
  const runTimer=delay=>{
    const entry=[...callbacks].find(([,value])=>value.delay===delay);
    assert.ok(entry,'missing retry timer '+delay);
    callbacks.delete(entry[0]);entry[1].fn();
  };
  return {connect,flush,runTimer,requests,updates,statuses,errors,sessions,callbacks,
    changeUid:value=>{uid=value},heartbeat:exposed.heartbeatDungeonRoom};
}
test('lobby SSE transport discards duplicate/older room revisions and can unsubscribe',async()=>{
  const h=harness(),id='dungroom001';
  const stop=h.connect(id);
  await h.flush();
  assert.equal(h.requests.length,1);
  assert.deepEqual(h.requests[0],{url:'/api/dungeon/room',action:'subscribe',roomId:id});
  assert.deepEqual(h.statuses,[true]);
  const push=revision=>h.sessions[0].next({room:{id,revision}});
  push(2);push(1);push(2);push(3);
  assert.deepEqual(h.updates.map(x=>x.revision),[2,3]);
  stop();
  await h.flush();
  assert.deepEqual(h.statuses,[true,false]);
  assert.equal(h.callbacks.size,0);
});
test('stream EOF reconnects using bounded delay, retaining monotone version',async()=>{
  const h=harness(),id='dungroom001';
  const stop=h.connect(id);
  await h.flush();
  h.sessions[0].next({room:{id,revision:5}});
  h.sessions[0].resolve();
  await h.flush();
  assert.equal(h.statuses.at(-1),false);
  h.runTimer(1000);
  await h.flush();
  assert.equal(h.sessions.length,2);
  h.sessions[1].next({room:{id,revision:4}});
  h.sessions[1].next({room:{id,revision:6}});
  assert.deepEqual(h.updates.map(x=>x.revision),[5,6]);
  stop();
  await h.flush();
  assert.equal(h.callbacks.size,0);
});
test('server 403 error terminates stream without subscribing again',async()=>{
  const h=harness(),id='dungroom001',stop=h.connect(id);
  await h.flush();
  h.sessions[0].reject(Object.assign(new Error('隊伍權限已撤銷'),{status:403}));
  await h.flush();
  assert.equal(h.errors.length,1);
  assert.equal(h.errors[0].status,403);
  assert.deepEqual(h.statuses,[true,false]);
  assert.equal([...h.callbacks.values()].filter(x=>x.delay===1000).length,0);
  stop();
});
test('account change aborts delivery and reauthentication is required',async()=>{
  const h=harness(),id='dungroom001',stop=h.connect(id);
  await h.flush();
  h.sessions[0].next({room:{id,revision:1}});
  h.changeUid('b');
  h.sessions[0].next({room:{id,revision:2}});
  await h.flush();
  assert.deepEqual(h.updates.map(x=>x.revision),[1]);
  stop();
});
test('heartbeat client sends only an authenticated room intent',async()=>{
  const h=harness();
  const result=await h.heartbeat('dungroom001');
  assert.equal(result.ok,true);
  assert.equal(result.revision,5);
  assert.deepEqual(h.requests[0],{
    url:'/api/dungeon/room',action:'heartbeat',roomId:'dungroom001'
  });
});
