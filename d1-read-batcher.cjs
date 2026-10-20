'use strict';

// Only short-lived, pending SELECTs are shared. Never cache completed reads:
// reward transactions and authorization must observe subsequent writes.
class ReadBatcher {
  constructor(gateway,{delayMs=2,maxStatements=40,maxBytes=1_800_000}={}) {
    this.gateway=gateway;this.delayMs=delayMs;this.maxStatements=maxStatements;
    this.maxBytes=maxBytes;this.pending=new Map();this.bytes=0;this.timer=null;
  }
  read(statement,{active=()=>true}={}) {
    if(!/^SELECT\s/i.test(statement.sql))return Promise.reject(Error('Read batch accepts SELECT only'));
    const key=JSON.stringify(statement),bytes=Buffer.byteLength(key);
    const existing=this.pending.get(key);
    if(existing){existing.active.push(active);return existing.promise;}
    if(this.pending.size&&(this.pending.size>=this.maxStatements||this.bytes+bytes>this.maxBytes))void this.flush();
    let resolve,reject;
    const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
    this.pending.set(key,{statement,promise,resolve,reject,active:[active]});this.bytes+=bytes;
    if(!this.timer)this.timer=setTimeout(()=>void this.flush(),this.delayMs);
    return promise;
  }
  async flush() {
    clearTimeout(this.timer);this.timer=null;
    const pending=[...this.pending.values()];this.pending.clear();this.bytes=0;
    const entries=pending.filter(entry=>{if(entry.active.some(active=>active()))return true;entry.resolve(undefined);return false;});
    if(!entries.length)return;
    try {
      const results=await this.gateway(entries.map(entry=>entry.statement));
      if(!Array.isArray(results)||results.length!==entries.length)throw Error('Invalid D1 read batch response');
      entries.forEach((entry,i)=>entry.resolve(results[i]));
    }catch(error){for(const entry of entries)entry.reject(error);}
  }
}
module.exports={ReadBatcher};
