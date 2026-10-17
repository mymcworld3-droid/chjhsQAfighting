const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const {createHandler} = require('../raid-room-api.cjs').__test;
const read = name => fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const clean = source => source.replace(/^import .*;\n/gm,'').replace(/^export /gm,'');

function store(initial = {}) {
  const docs = new Map(Object.entries(initial)), listeners = new Map();
  let counter = 0, chain = Promise.resolve();
  function snapshot(ref) {return {id:ref.id,ref,exists:docs.has(ref.key),data:()=>structuredClone(docs.get(ref.key))};}
  function notify(ref) {queueMicrotask(()=>listeners.get(ref.key)?.forEach(next=>next(snapshot(ref))));}
  function reference(collection,id) {
    const ref={id,key:collection+'/'+id,get:async()=>snapshot(ref),set:async value=>{docs.set(ref.key,structuredClone(value));notify(ref);},
      onSnapshot(next){
        if (!listeners.has(ref.key)) listeners.set(ref.key,new Set());
        listeners.get(ref.key).add(next);queueMicrotask(()=>next(snapshot(ref)));
        return()=>listeners.get(ref.key)?.delete(next);
      }};
    return ref;
  }
  function collection(name) {
    const filters=[];let max=100;
    const query={doc:id=>reference(name,id||'room'+String(++counter).padStart(6,'0')),
      where(field,op,value){filters.push({field,op,value});return query;},limit(value){max=value;return query;},
      async get(){const rows=[...docs].filter(([key,value])=>key.startsWith(name+'/')&&filters.every(filter=>
        filter.op==='=='?value[filter.field]===filter.value:filter.value.includes(value[filter.field]))).slice(0,max)
        .map(([key])=>snapshot(reference(name,key.slice(name.length+1))));return {empty:rows.length===0,docs:rows};}};
    return query;
  }
  return {collection,docs,listenerCount:()=>[...listeners.values()].reduce((sum,set)=>sum+set.size,0),
    runTransaction(fn){
      const job=chain.then(async()=>{
        const pending=new Map();
        const result=await fn({get:async ref=>snapshot(ref),
          update:(ref,patch)=>pending.set(ref.key,{ref,value:{...(pending.get(ref.key)?.value||docs.get(ref.key)||{}),...structuredClone(patch)}}),
          set:(ref,value)=>pending.set(ref.key,{ref,value:structuredClone(value)})});
        for(const {ref,value} of pending.values()){docs.set(ref.key,value);notify(ref);}
        return result;
      });chain=job.catch(()=>{});return job;
    }};
}

function client(origin,uid,requests) {
  const context={TextDecoder,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,
    getMainUser:()=>({uid}),authenticatedMainFetch:(endpoint,init)=>{
      const action=JSON.parse(init.body).action;requests.push({uid,action});
      return fetch(origin+endpoint,{...init,headers:{'content-type':'application/json',authorization:'Bearer '+uid}});
    }};
  vm.createContext(context);
  vm.runInContext(clean(read('public/cultivation/data/room-event-stream.js'))+'\n'+
    clean(read('public/cultivation/data/raid-repository.js')),context);
  context.window={getCurrentUserData:()=>user};
  const user={uid,stats:{}};
  const saved=new Map();
  context.localStorage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)};
  vm.runInContext(clean(read('public/cultivation/raid-room.js'))+
    '\nthis.operations={createRaidRoom,joinRaidRoomByCode,subscribeRaidRoom,setRaidReady,startRaidRoom,kickRaidMember,reconnectRaidRoom,savedRoom:()=>localStorage.getItem(STORAGE_KEY)};',context);
  return context.operations;
}
async function until(predicate) {
  const deadline=Date.now()+2000;
  while(!predicate()) {if(Date.now()>deadline)throw Error('room push timeout');await new Promise(resolve=>setTimeout(resolve,5));}
}

test('three clients see joins, readiness and start through real HTTP streaming without get polling',async t=>{
  const playerDb=store(Object.fromEntries(['a','b','c'].map(uid=>['users/'+uid,
    {displayName:uid,stats:{totalScore:68,attack:200,maxHp:1000},raidTickets:{count:3,lastGrantDate:'2099-01-01'}}])));
  const raidDb=store();
  const handler=createHandler({resolveA:()=>({db:playerDb,auth:{verifyIdToken:async token=>
    ({uid:token,aud:'question-learning',iss:'https://securetoken.google.com/question-learning'})}}),
    resolveC:()=>({db:raidDb}),logger:{error(){}}});
  const app=express();app.use(express.json());app.post('/api/raid/room',handler);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin='http://127.0.0.1:'+server.address().port,requests=[],stops=[],errors=[];
  t.after(async()=>{stops.forEach(stop=>stop());server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const clients=['a','b','c'].map(uid=>client(origin,uid,requests));
  const seen=[[],[],[]];let initial;
  const id=await clients[0].createRaidRoom(result=>{initial=result;});
  stops.push(clients[0].subscribeRaidRoom(id,value=>seen[0].push(value),error=>errors.push(error),initial));
  const code=initial.room.code;
  for(let index=1;index<3;index++){
    let joined;const joinedId=await clients[index].joinRaidRoomByCode(code,result=>{joined=result;});
    assert.equal(joinedId,id);
    stops.push(clients[index].subscribeRaidRoom(id,value=>seen[index].push(value),error=>errors.push(error),joined));
    await until(()=>seen.slice(0,index+1).every(list=>Object.keys(list.at(-1).members).length===index+1));
  }
  await Promise.all(clients.map(c=>c.setRaidReady(id,true)));
  await until(()=>seen.every(list=>Object.values(list.at(-1).members).every(member=>member.ready)));
  const started=await clients[0].startRaidRoom(id);
  await until(()=>seen.every(list=>list.at(-1).status==='active'));
  assert.equal(started.room.bossMaxHp,2000);
  assert.equal(playerDb.docs.get('users/a').raidTickets.count,2);
  assert.equal(playerDb.docs.get('users/b').raidTickets.count,2);
  assert.equal(playerDb.docs.get('users/c').raidTickets.count,2);
  assert.equal(requests.filter(row=>row.action==='get').length,0);
  assert.equal(raidDb.listenerCount(),3);
  seen.forEach(list=>{for(let index=1;index<list.length;index++)assert.ok(list[index].revision>=list[index-1].revision);});
  stops.forEach(stop=>stop());await until(()=>raidDb.listenerCount()===0);
  assert.deepEqual(errors,[]);
});

test('kicking pushes the new roster to teammates and closes the removed client with cleared reconnect storage',async t=>{
  const playerDb=store(Object.fromEntries(['a','b','c'].map(uid=>['users/'+uid,
    {displayName:uid,stats:{totalScore:68,attack:200,maxHp:1000},raidTickets:{count:3,lastGrantDate:'2099-01-01'}}])));
  const raidDb=store();
  const handler=createHandler({resolveA:()=>({db:playerDb,auth:{verifyIdToken:async token=>
    ({uid:token,aud:'question-learning',iss:'https://securetoken.google.com/question-learning'})}}),
    resolveC:()=>({db:raidDb}),logger:{error(){}}});
  const app=express();app.use(express.json());app.post('/api/raid/room',handler);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin='http://127.0.0.1:'+server.address().port,requests=[],stops=[],errors=[];
  t.after(async()=>{stops.forEach(stop=>stop());server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const clients=['a','b','c'].map(uid=>client(origin,uid,requests)),seen=[[],[],[]];let initial;
  const id=await clients[0].createRaidRoom(result=>{initial=result;});
  stops.push(clients[0].subscribeRaidRoom(id,value=>seen[0].push(value),error=>errors.push(error),initial));
  for(let i=1;i<3;i++){
    let joined;await clients[i].joinRaidRoomByCode(initial.room.code,result=>{joined=result;});
    stops.push(clients[i].subscribeRaidRoom(id,value=>seen[i].push(value),error=>errors.push(error),joined));
  }
  await until(()=>seen.every(rows=>Object.keys(rows.at(-1)?.members||{}).length===3));
  await clients[0].kickRaidMember(id,'b');
  await until(()=>seen[1].at(-1)===null && [0,2].every(i=>Object.keys(seen[i].at(-1)?.members||{}).length===2));
  assert.equal(errors.length,1);assert.equal(errors[0].status,403);
  assert.equal(clients[1].savedRoom(),null);
  assert.equal(await clients[1].reconnectRaidRoom(),null);
  assert.equal(clients[0].savedRoom(),id);assert.equal(clients[2].savedRoom(),id);
  await until(()=>raidDb.listenerCount()===2);
  assert.equal(requests.filter(row=>row.action==='get').length,0);
});
