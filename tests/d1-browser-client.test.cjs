'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const Codec=require('../public/d1-codec.js');
async function harness(transport){
  let uid='u';const document=new EventTarget();document.hidden=false;
  const window=new EventTarget(),requests=[];
  const user={get uid(){return uid;},getIdToken:async()=> 'id-token'};
  const fetch=async(url,options)=>{
    if(url==='/api/data-config')return {ok:true,json:async()=>({backend:'d1',pollMs:5})};
    requests.push({url,body:JSON.parse(options.body),options});return transport(JSON.parse(options.body),options,requests.length);
  };
  const code=fs.readFileSync(require.resolve('../public/data-store.js'),'utf8')
    .replace(/^import[\s\S]*?;\n/gm,'').replace(/^export /gm,'');
  const context=vm.createContext({globalThis:{QAD1Codec:Codec},getAuth:()=>({currentUser:user}),getApp:()=>({}),fetch,native:{},window,document,crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,AbortController,TextDecoder,console});
  await vm.runInContext('(async()=>{'+code+'\nthis.api={getFirestore,doc,collection,query,where,limit,startAfter,getDoc,getDocs,runTransaction,updateDoc,onSnapshot};})()',context);
  return {api:context.api,requests,window,document,setUid:v=>{uid=v;}};
}
test('D1 client retries explicit transaction conflicts and uses renewed snapshots',async()=>{
  let revision=1,gold=10,commits=0;
  const h=await harness(async body=>{
    if(body.action==='read')return {ok:true,json:async()=>({exists:true,version:revision,data:{gold}})};
    commits++;if(commits===1){revision++;gold=20;return {ok:false,json:async()=>({code:'aborted',error:'retry'})};}
    assert.equal(body.reads[0].version,2);gold=body.writes[0].data.gold;return {ok:true,json:async()=>({ok:true})};
  });
  const db=h.api.getFirestore(),ref=h.api.doc(db,'users','u');
  await h.api.runTransaction(db,async tx=>{const snap=await tx.get(ref);tx.update(ref,{gold:snap.data().gold+1});});
  assert.equal(commits,2);assert.equal(gold,21);
  assert.equal(h.requests.every(r=>r.options.headers.Authorization==='Bearer id-token'),true);
  assert.equal(ref.parent.id,'users');
});
test('D1 client listener supports Firebase metadata options and cancels stream when unsubscribed',async()=>{
  let streamController,aborted=false;
  const h=await harness(async(body,options)=>{
    assert.equal(body.action,'watch');
    options.signal.addEventListener('abort',()=>{aborted=true;streamController.close();});
    const stream=new ReadableStream({start(c){streamController=c;c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({exists:true,version:1,data:{gold:10}})+'\n\n'));}});
    return {ok:true,body:stream};
  });
  let got=0;
  const stop=h.api.onSnapshot(h.api.doc(h.api.getFirestore(),'users','u'),{includeMetadataChanges:true},snap=>{got++;assert.equal(snap.data().gold,10);});
  await new Promise(r=>setTimeout(r,10));assert.equal(got,1);stop();assert.equal(aborted,true);
  await new Promise(r=>setTimeout(r,15));assert.equal(h.requests.length,1);
});
