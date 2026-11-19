'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PROJECT_IDS}=require('../firebase-admin-projects.cjs');
const {__test:API}=require('../dungeon-room-api.cjs');
const {__test:STREAM}=require('../dungeon-room-stream.cjs');

function database(initial={}){
  const records=new Map(Object.entries(initial)),listeners=new Map();
  let next=0,chain=Promise.resolve();
  const clone=v=>structuredClone(v);
  const key=ref=>ref.collection+'/'+ref.id;
  const snap=ref=>({
    exists:records.has(key(ref)),id:ref.id,data:()=>clone(records.get(key(ref)))
  });
  const fire=ref=>{
    const subs=listeners.get(key(ref));
    for(const callback of subs||[])callback(snap(ref));
  };
  const doc=(collection,id)=>{
    const ref={id:id||'dungroom'+String(++next).padStart(8,'0'),collection};
    ref.get=async()=>snap(ref);
    ref.onSnapshot=(onNext,onError)=>{
      const id=key(ref);
      if(!listeners.has(id))listeners.set(id,new Set());
      listeners.get(id).add(onNext);
      queueMicrotask(()=>{if(listeners.get(id)?.has(onNext))onNext(snap(ref));});
      return ()=>listeners.get(id)?.delete(onNext);
    };
    return ref;
  };
  const db={
    records,listeners,collection(name){
      const query={
        doc:id=>doc(name,id),
        where(){return query;},limit(){return query;},
        async get(){return {docs:[]};}
      };
      return query;
    },
    runTransaction(fn){
      const task=chain.then(async()=>{
        const changes=new Map();let wrote=false;
        const tx={
          get:async ref=>{
            assert.equal(wrote,false,'Firestore reads must precede transaction writes');
            return snap(ref);
          },
          set:(ref,value)=>{wrote=true;changes.set(key(ref),clone(value));},
          update:(ref,value)=>{
            wrote=true;
            changes.set(key(ref),{...clone(changes.get(key(ref))||records.get(key(ref))),...clone(value)});
          }
        };
        const result=await fn(tx);
        for(const [id,data]of changes){
          records.set(id,data);
          const split=id.indexOf('/');
          fire(doc(id.slice(0,split),id.slice(split+1)));
        }
        return result;
      });
      chain=task.catch(()=>{});return task;
    },
    listenerCount(roomId){
      return listeners.get('dungeonRooms/'+roomId)?.size||0;
    },
    forceRoom(roomId,patch){
      const k='dungeonRooms/'+roomId;
      records.set(k,{...clone(records.get(k)),...clone(patch)});
      fire(doc('dungeonRooms',roomId));
    }
  };
  return db;
}
function fixture(){
  let at=Date.now();
  const players=Object.fromEntries('abcdef'.split('').map(uid=>['users/'+uid,{
    uid,displayName:'修士'+uid,stats:{totalScore:30},raidTickets:{count:5}
  }]));
  const a=database(players),c=database();
  const make=()=>API.createHandler({
    resolveA:()=>({db:a,auth:{verifyIdToken:async token=>{
      if(token==='invalid')throw Error('expired token');
      return {uid:token,aud:PROJECT_IDS.A,
        iss:'https://securetoken.google.com/'+PROJECT_IDS.A};
    }}}),
    resolveC:()=>({db:c}),clock:()=>at,logger:{error(){}}
  });
  const handlers=[make(),make()]; // distinct server instances, shared Firestore
  async function call(uid,action,payload={},instance=0){
    const req=new EventEmitter();
    req.aborted=false;req.body={action,...payload};
    req.get=key=>key==='authorization'?'Bearer '+uid:'';
    const res=new EventEmitter();
    res.writes=[];res.statusCode=200;res.writableLength=0;
    res.destroyed=false;res.writableEnded=false;
    res.set=function(value){this.headers={...this.headers,...value};return this;};
    res.status=function(value){this.statusCode=value;return this;};
    res.json=function(value){this.body=value;return this;};
    res.write=function(text){this.writes.push(String(text));return true;};
    res.flushHeaders=()=>{};
    res.end=function(){this.writableEnded=true;this.emit('close');};
    await handlers[instance](req,res);
    await new Promise(resolve=>setImmediate(resolve));
    return {req,res,status:res.statusCode,body:res.body};
  }
  const advance=ms=>{at+=ms;};
  const close=session=>{session.req.aborted=true;session.req.emit('aborted');};
  const packets=session=>session.res.writes.filter(x=>x.startsWith('data: '))
    .map(x=>JSON.parse(x.slice(6).trim()));
  return {a,c,advance,call,close,packets,get at(){return at;}};
}

test('connected SSE starts server pulses and dual instances converge to one clock cursor',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body,id=created.roomId;
  await f.call('b','join-code',{roomCode:created.room.code});
  const streamA=await f.call('a','subscribe',{roomId:id},0);
  const streamB=await f.call('b','subscribe',{roomId:id},1);
  await f.call('a','ready',{roomId:id,ready:true});
  await f.call('b','ready',{roomId:id,ready:true});
  const started=(await f.call('a','start',{roomId:id})).body.room;
  assert.equal(started.battleClock.tick,0);
  f.advance(3400);
  await new Promise(resolve=>setTimeout(resolve,1250));
  const db=f.c.records.get('dungeonRooms/'+id);
  assert.equal(db.battleAppliedTick,3);
  assert.equal(db.revision,started.revision+1,
    'multiple server pulses must persist a tick only once');
  const latestA=f.packets(streamA).at(-1).room;
  const latestB=f.packets(streamB).at(-1).room;
  assert.equal(latestA.battleClock.tick,3);
  assert.equal(latestB.battleClock.tick,3);
  assert.equal(latestA.battleClock.appliedTick,3);
  assert.equal(latestB.battleClock.appliedTick,3);
  f.close(streamA);f.close(streamB);
  assert.equal(f.c.listenerCount(id),0);
});
test('closing the last authenticated stream stops its pulse timer',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body,id=created.roomId;
  await f.call('a','ready',{roomId:id,ready:true});
  await f.call('a','start',{roomId:id});
  const stream=await f.call('a','subscribe',{roomId:id});
  f.close(stream);
  const revision=f.c.records.get('dungeonRooms/'+id).revision;
  f.advance(5200);
  await new Promise(resolve=>setTimeout(resolve,1150));
  assert.equal(f.c.records.get('dungeonRooms/'+id).revision,revision);
  const late=(await f.call('a','get',{roomId:id})).body.room;
  assert.equal(late.battleClock.tick,5);
  assert.equal(late.battleClock.appliedTick,0);
});
