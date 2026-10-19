// One transport switch for all game modules. Firebase Auth remains the identity provider.
import * as native from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {getAuth} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {getApp} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import './d1-codec.js';
const C=globalThis.QAD1Codec;
const configResponse=await fetch('/api/data-config',{cache:'no-store'});
if(!configResponse.ok)throw Error('資料服務設定無法讀取，請稍後重試');
const config=await configResponse.json();
if(!['firestore','d1'].includes(config.backend))throw Error('資料服務設定無效');
export const dataBackend=config.backend;
const isD1=config.backend==='d1';
const dbs=new Map();
function roleOf(app){const name=app?.name||'[DEFAULT]';return name==='xiuxian-bd'?'BD':name==='xiuxian-battle'?'C':'A';}
export function getFirestore(app){if(!isD1)return native.getFirestore(app);return getD1Database(roleOf(app));}
export function getD1Database(role='A'){if(!dbs.has(role))dbs.set(role,{__d1:true,role});return dbs.get(role);}
function reference(parent,parts,kind){const db=parent.__d1?parent:parent.db;const path=[parent.path,...parts].filter(x=>x!=null&&x!=='').join('/');return {__d1ref:true,db,path,id:path.split('/').at(-1),kind,get parent(){return reference(db,[path.split('/').slice(0,-1).join('/')],'query');}};}
export function collection(parent,...parts){return isD1?reference(parent,parts,'query'):native.collection(parent,...parts);}
export function doc(parent,...parts){if(!isD1)return native.doc(parent,...parts);if(!parts.length)parts=[crypto.randomUUID().replaceAll('-','')];return reference(parent,parts,'doc');}
export function query(ref,...constraints){return isD1?{...ref,constraints:[...(ref.constraints||[]),...constraints]}:native.query(ref,...constraints);}
export function where(...args){return isD1?{type:'where',args}:native.where(...args);}
export function orderBy(...args){return isD1?{type:'orderBy',args}:native.orderBy(...args);}
export function limit(...args){return isD1?{type:'limit',args}:native.limit(...args);}
export function startAfter(...args){return isD1?{type:'startAfter',args:args.map(x=>x?.__snapshot?{id:x.id,data:C.encode(x.data())}:C.encode(x))}:native.startAfter(...args);}
export const Timestamp=C.Timestamp;
export function serverTimestamp(){return isD1?{__d1op:'serverTimestamp',args:[]}:native.serverTimestamp();}
export function increment(...args){return isD1?{__d1op:'increment',args}:native.increment(...args);}
export function arrayUnion(...args){return isD1?{__d1op:'arrayUnion',args}:native.arrayUnion(...args);}
export function arrayRemove(...args){return isD1?{__d1op:'arrayRemove',args}:native.arrayRemove(...args);}
export function deleteField(){return isD1?{__d1op:'delete',args:[]}:native.deleteField();}
async function request(body,signal){
  const user=getAuth(getApp()).currentUser;
  if(!user)throw Object.assign(Error('請先登入'),{code:'unauthenticated'});
  const uid=user.uid,token=await user.getIdToken();
  const response=await fetch('/api/data',{method:'POST',cache:'no-store',signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
  const result=await response.json();
  if(getAuth(getApp()).currentUser?.uid!==uid)throw Error('登入帳號已改變');
  if(!response.ok)throw Object.assign(Error(result.error||'資料存取失敗'),{code:result.code||'unavailable'});
  return result;
}
function serialize(ref){return {role:ref.db.role,path:ref.path,kind:ref.kind,constraints:ref.constraints||[]};}
function snapshot(ref,row){return {__snapshot:true,ref,id:ref.id,version:row.version,exists:()=>row.exists,data:()=>row.exists?C.decode(row.data):undefined,get:f=>C.get(C.decode(row.data),f),metadata:{fromCache:false,hasPendingWrites:false}};}
function hydrate(ref,result){
  if(ref.kind==='doc')return snapshot(ref,result);
  const docs=result.docs.map(row=>snapshot(doc(ref.db,row.path),row));
  return {docs,size:docs.length,empty:!docs.length,forEach:fn=>docs.forEach(fn),docChanges:()=>docs.map(d=>({type:'added',doc:d})),metadata:{fromCache:false}};
}
async function read(ref,signal){return hydrate(ref,await request({action:'read',target:serialize(ref)},signal));}
export function getDoc(ref){return isD1?read(ref):native.getDoc(ref);}
export function getDocs(ref){return isD1?read(ref):native.getDocs(ref);}
export function getDocsFromServer(ref){return isD1?read(ref):native.getDocsFromServer(ref);}
// No durable offline cache: using a network read avoids returning stale market inventory.
export function getDocsFromCache(ref){return isD1?read(ref):native.getDocsFromCache(ref);}
function writer(db){
  const writes=[];
  const tx={set:(ref,data,options)=>{writes.push({target:serialize(ref),type:'set',data:C.encode(data),options});return tx;},update:(ref,data)=>{writes.push({target:serialize(ref),type:'update',data:C.encode(data)});return tx;},delete:ref=>{writes.push({target:serialize(ref),type:'delete'});return tx;},writes};
  tx.commit=()=>request({action:'commit',role:db.role,writes});return tx;
}
export function writeBatch(db){return isD1?writer(db):native.writeBatch(db);}
export function setDoc(ref,data,options){if(!isD1)return native.setDoc(ref,data,options);const tx=writer(ref.db);tx.set(ref,data,options);return tx.commit();}
export function updateDoc(ref,data){if(!isD1)return native.updateDoc(ref,data);const tx=writer(ref.db);tx.update(ref,data);return tx.commit();}
export function deleteDoc(ref){if(!isD1)return native.deleteDoc(ref);const tx=writer(ref.db);tx.delete(ref);return tx.commit();}
export async function addDoc(ref,data){if(!isD1)return native.addDoc(ref,data);const target=doc(ref);await setDoc(target,data);return target;}
export async function runTransaction(db,callback){
  if(!isD1)return native.runTransaction(db,callback);
  const uid=getAuth(getApp()).currentUser?.uid;
  for(let attempt=0;attempt<5;attempt++){
    const tx=writer(db),reads=[];
    tx.get=async ref=>{if(ref.db.role!==db.role)throw Error('跨資料區交易不支援');const snap=await read(ref);reads.push({target:serialize(ref),version:snap.version});return snap;};
    const value=await callback(tx);
    if(getAuth(getApp()).currentUser?.uid!==uid)throw Error('登入帳號已改變');
    try {if(tx.writes.length)await request({action:'commit',role:db.role,reads,writes:tx.writes});return value;}
    catch(e){if(e.code!=='aborted'||attempt===4)throw e;await new Promise(r=>setTimeout(r,50+Math.random()*100));}
  }
}
const subscriptions=new Set();
export function onSnapshot(ref,...args){
  if(!isD1)return native.onSnapshot(ref,...args);
  if(args[0] && typeof args[0]==='object' && !('next' in args[0]) && !('error' in args[0]))args.shift();
  let [next,error]=args;if(typeof next==='object'){error=next.error?.bind(next);next=next.next?.bind(next);}
  let stopped=false,timer,controller,last='',failures=0,running=false;
  const uid=getAuth(getApp()).currentUser?.uid;
  async function connect(){
    if(stopped||running||document.hidden)return;
    if(getAuth(getApp()).currentUser?.uid!==uid){stop();return;}
    running=true;controller=new AbortController();
    try {
      const token=await getAuth(getApp()).currentUser.getIdToken();
      const response=await fetch('/api/data',{method:'POST',cache:'no-store',signal:controller.signal,
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
        body:JSON.stringify({action:'watch',target:serialize(ref)})});
      if(!response.ok){const body=await response.json();throw Object.assign(Error(body.error||'即時連線中斷'),{code:body.code});}
      if(stopped)return;failures=0;
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
      for(;;){
        const {value,done}=await reader.read();if(done||stopped)break;
        if(getAuth(getApp()).currentUser?.uid!==uid){stop();break;}
        buffer+=decoder.decode(value,{stream:true});
        let end;
        while((end=buffer.indexOf('\n\n'))>=0){
          const block=buffer.slice(0,end);buffer=buffer.slice(end+2);
          if(!block.startsWith('data: '))continue;
          const result=JSON.parse(block.slice(6)),snap=hydrate(ref,result);
          const sig=JSON.stringify(ref.kind==='doc'?[snap.exists(),snap.version]:snap.docs.map(d=>[d.id,d.version]));
          if(sig!==last){last=sig;try{next?.(snap);}catch(e){console.error('[Data listener callback]',e);}}
        }
        if(buffer.length>4_000_000)throw Error('即時資料過大');
      }
    }catch(e){if(!stopped&&e.name!=='AbortError'){failures++;error?.(e);}}
    finally{running=false;if(!stopped&&!document.hidden)timer=setTimeout(connect,Math.min(60000,1000*2**Math.min(failures,6)));}
  }
  function visibility(){clearTimeout(timer);if(document.hidden)controller?.abort();else {controller?.abort();timer=setTimeout(connect,50);}}
  function stop(){if(stopped)return;stopped=true;clearTimeout(timer);controller?.abort();subscriptions.delete(stop);document.removeEventListener('visibilitychange',visibility);}
  subscriptions.add(stop);document.addEventListener('visibilitychange',visibility);void connect();return stop;
}
window.addEventListener('pagehide',()=>{for(const stop of subscriptions)stop();});
