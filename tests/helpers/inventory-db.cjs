'use strict';
const assert=require('node:assert/strict');
function fakeDb(user,state) {
  const docs=new Map([['users/u1',structuredClone(user)]]);
  if(state)docs.set('soulboundDrawStates/u1',structuredClone(state));
  let queue=Promise.resolve(),failCreate=false,retry=false;
  const snap=key=>({exists:docs.has(key),data:()=>structuredClone(docs.get(key))});
  return {docs,failNextCreate(){failCreate=true;},retryNextTransaction(){retry=true;},
    collection(name){return{doc(id){return{key:name+'/'+id};}};},
    runTransaction(worker){
      const run=queue.then(async()=>{
        async function attempt(){
          let writing=false;const writes=new Map();
          const tx={get:async ref=>{assert.equal(writing,false,'reads must precede writes');return snap(ref.key);},
            set(ref,value){writing=true;writes.set(ref.key,structuredClone(value));},
            create(ref,value){writing=true;if(failCreate){failCreate=false;throw Error('database unavailable');}assert.ok(!docs.has(ref.key));writes.set(ref.key,structuredClone(value));},
            update(ref,patch){writing=true;assert.ok(docs.has(ref.key));const value=structuredClone(writes.get(ref.key)||docs.get(ref.key));
              for(const [field,v]of Object.entries(patch)){const parts=field.split('.'),last=parts.pop();let target=value;for(const part of parts)target=target[part]||={};target[last]=structuredClone(v);}writes.set(ref.key,value);}
          };
          return{result:await worker(tx),writes};
        }
        if(retry){retry=false;await attempt();}
        const {result,writes}=await attempt();for(const[key,value]of writes)docs.set(key,value);return result;
      });queue=run.catch(()=>{});return run;
    }
  };
}
module.exports={fakeDb};
