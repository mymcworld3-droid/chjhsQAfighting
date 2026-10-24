'use strict';
const assert=require('node:assert/strict');
function worldDb(seed={}){
  const docs=new Map(Object.entries(seed).map(([k,v])=>[k,structuredClone(v)]));let queue=Promise.resolve(),writes=0,failNext=false;const reads=[];
  const snap=ref=>{reads.push(ref.key);return {exists:docs.has(ref.key),data:()=>structuredClone(docs.get(ref.key)),id:ref.key.split('/').at(-1)};};
  const db={docs,reads,get writes(){return writes;},failNext(){failNext=true;},collection(name){return{doc(id){const ref={key:name+'/'+id,get:async()=>snap(ref)};return ref;}};},
    runTransaction(work){const task=queue.catch(()=>{}).then(async()=>{
      let writing=false;const pending=new Map();
      const tx={get:async ref=>{assert.equal(writing,false,'all reads precede writes');return snap(ref);},
        set(ref,data){writing=true;pending.set(ref.key,structuredClone(data));},
        update(ref,patch){writing=true;assert.ok(docs.has(ref.key));const out=structuredClone(pending.get(ref.key)||docs.get(ref.key));
          for(const[field,value]of Object.entries(patch)){const parts=field.split('.'),last=parts.pop();let target=out;for(const p of parts)target=target[p]||={};target[last]=structuredClone(value);}pending.set(ref.key,out);}};
      const result=await work(tx);if(failNext){failNext=false;throw Error('simulated database outage');}
      for(const[k,v]of pending){docs.set(k,v);writes++;}return result;
    });queue=task;return task;}};return db;
}
module.exports={worldDb};
