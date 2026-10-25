'use strict';
const assert=require('node:assert/strict');
function database(){
  const records=new Map(['u1','u2','u3'].map(uid=>['users/'+uid,{uid,displayName:uid,stats:{attack:200,maxHp:1000,totalScore:30,gold:0},profile:{educationLevel:'國中一年級'},cultivationTraining:{equippedCore:{type:'thunder',grade:9}}}]));
  const snap=k=>({id:k.split('/').at(-1),exists:records.has(k),data:()=>structuredClone(records.get(k))});
  const ref=k=>({key:k,get:async()=>snap(k)});let queue=Promise.resolve();
  const db={records,collection(name){return {
    doc:id=>ref(name+'/'+id),
    where(field,op,value){const query={orderBy(){return query;},limit(){return query;},async get(){return {
      docs:[...records].filter(([key,v])=>key.startsWith(name+'/')&&(op==='>'?v[field]>value:v[field]===value)).map(([k])=>snap(k))
    };}};return query;}
  };},
    runTransaction(callback){const work=queue.then(async()=>{
      const writes=new Map();const tx={get:async r=>{assert.equal(writes.size,0,'all transaction reads precede writes');return snap(r.key);},set:(r,v)=>writes.set(r.key,structuredClone(v)),update:(r,p)=>{
        const v=structuredClone(writes.get(r.key)||records.get(r.key));for(const [k,value]of Object.entries(p)){const keys=k.split('.');let at=v;for(const part of keys.slice(0,-1))at=at[part]||=( {} );at[keys.at(-1)]=structuredClone(value);}writes.set(r.key,v);
      }};const value=await callback(tx);for(const [k,v]of writes)records.set(k,v);return value;
    });queue=work.catch(()=>{});return work;}};return db;
}

module.exports={database};
