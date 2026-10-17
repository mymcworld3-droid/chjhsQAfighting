'use strict';
const crypto = require('node:crypto');

// Server-only, bounded cache of validated unused answers from a parallel quiz race.
// No Firestore reads, no issued raid tickets, no durable unbounded player data.
// Compatible future requests must match both the caller and the entire scope.
function createSparePool({ttlMs=8*60*1000,maxScopes=350,maxPerScope=4,similar=()=>false,now=Date.now}={}) {
  const scopes=new Map();
  function key(fields) {
    if (!fields || !fields.owner || !fields.subject || !fields.topic) return '';
    return crypto.createHash('sha256').update(JSON.stringify([
      fields.owner,fields.mode||'solo',fields.subject,fields.level,
      fields.topic,fields.difficulty,String(fields.rank??''),fields.knowledge||''
    ])).digest('hex');
  }
  function tidy() {
    const time=now();
    for(const [id,bucket] of scopes) if(bucket.expiry<=time) scopes.delete(id);
    while(scopes.size>maxScopes) scopes.delete(scopes.keys().next().value);
  }
  function bucket(id) {
    if(!id) return null;
    tidy();
    let b=scopes.get(id);
    if(!b){b={expiry:now()+ttlMs,items:[],seen:[]};scopes.set(id,b);}
    // Extend life during a session, but always cap total retained scopes.
    b.expiry=now()+ttlMs;
    tidy();
    return b;
  }
  function duplicate(b,q,template='') {
    return b.seen.some(old=>similar(q,old.q) || !!(template&&old.template===template)) ||
      b.items.some(row=>similar(q,row.data.q) || !!(template&&row.data.template_id===template));
  }
  function offer(id,routed) {
    if(!routed?.data || typeof routed.data.q!=='string')return false;
    const b=bucket(id);
    if(!b || b.items.length>=maxPerScope || duplicate(b,routed.data.q,routed.data.template_id))return false;
    b.items.push(routed);
    return true;
  }
  function markServed(id,data) {
    if(!data?.q)return;
    const b=bucket(id);
    if(!b)return;
    b.items=b.items.filter(row=>!similar(data.q,row.data.q) && row.data.template_id!==data.template_id);
    b.seen.push({q:data.q,template:data.template_id||''});
    if(b.seen.length>20)b.seen.shift();
  }
  function take(id,validate) {
    if(!id)return null;
    const b=scopes.get(id);
    if(!b || b.expiry<=now()){scopes.delete(id);return null;}
    while(b.items.length) {
      const routed=b.items.shift();
      try {
        if(!validate(routed.data,b.seen.map(v=>v.q),b.seen.map(v=>v.template)))continue;
        markServed(id,routed.data);
        return routed;
      } catch (_) {
        // Reject stale/invalid spare without poisoning the whole queue.
      }
    }
    return null;
  }
  function count(id){const b=scopes.get(id);return b&&b.expiry>now()?b.items.length:0;}
  return {key,offer,markServed,take,count};
}
module.exports={createSparePool};
