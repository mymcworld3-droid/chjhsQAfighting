(function(root) {
  'use strict';
  const forbidden = new Set(['__proto__','prototype','constructor']);
  class Timestamp {
    constructor(seconds,nanoseconds=0) {this.seconds=seconds;this.nanoseconds=nanoseconds;}
    toMillis(){return this.seconds*1000+this.nanoseconds/1e6;}
    toDate(){return new Date(this.toMillis());}
    static fromMillis(ms){const s=Math.floor(ms/1000);return new Timestamp(s,Math.round((ms-s*1000)*1e6));}
    static now(){return Timestamp.fromMillis(Date.now());}
  }
  function entries(value) {
    return Object.entries(value).map(([k,v])=>{if(forbidden.has(k))throw Error('Invalid field');return [k,v];});
  }
  function encode(v) {
    if(v===null || typeof v==='string' || typeof v==='boolean')return v;
    if(typeof v==='number')return Number.isFinite(v)?v:{__d1type:'number',value:String(v)};
    if(v instanceof Date)return {__d1type:'date',value:v.toISOString()};
    if(v && typeof v.toMillis==='function' && typeof v.seconds==='number')return {__d1type:'timestamp',seconds:v.seconds,nanoseconds:v.nanoseconds||0};
    if(v instanceof Uint8Array)return {__d1type:'bytes',value:Array.from(v)};
    if(v && typeof v.latitude==='number' && typeof v.longitude==='number')return {__d1type:'geopoint',latitude:v.latitude,longitude:v.longitude};
    if(v && v.path && v.firestore)return {__d1type:'reference',path:v.path};
    if(Array.isArray(v))return v.map(encode);
    if(v && typeof v==='object')return Object.fromEntries(entries(v).map(([k,x])=>[k,encode(x)]));
    throw Error('Unsupported/undefined document value');
  }
  function decode(v) {
    if(!v || typeof v!=='object')return v;
    if(v.__d1type==='timestamp')return new Timestamp(v.seconds,v.nanoseconds);
    if(v.__d1type==='date')return new Date(v.value);
    if(v.__d1type==='bytes')return new Uint8Array(v.value);
    if(v.__d1type==='number')return Number(v.value);
    if(Array.isArray(v))return v.map(decode);
    return Object.fromEntries(entries(v).map(([k,x])=>[k,decode(x)]));
  }
  function fieldParts(path) {
    if(typeof path!=='string' || !path || path.length>500)throw Error('Invalid field path');
    const parts=path.split('.');
    if(parts.some(p=>!p || forbidden.has(p)))throw Error('Invalid field path');
    return parts;
  }
  function get(obj,path){return fieldParts(path).reduce((v,k)=>v?.[k],obj);}
  function equal(a,b){return JSON.stringify(encode(a))===JSON.stringify(encode(b));}
  function transform(v,old,now) {
    if(v && typeof v==='object' && v.__d1op) {
      const a=v.args||[];
      switch(v.__d1op) {
        case 'serverTimestamp':return Timestamp.fromMillis(now);
        case 'increment':if(typeof a[0]!=='number'||!Number.isFinite(a[0]))throw Error('Invalid increment');return (typeof old==='number'?old:0)+a[0];
        case 'arrayUnion':return [...(Array.isArray(old)?old:[]),...a.filter((x,i)=>!(Array.isArray(old)?old:[]).some(y=>equal(x,y))&&!a.slice(0,i).some(y=>equal(x,y)))];
        case 'arrayRemove':return (Array.isArray(old)?old:[]).filter(x=>!a.some(y=>equal(x,y)));
        case 'delete':return undefined;
        default:throw Error('Unknown transform');
      }
    }
    if(v && Object.getPrototypeOf(v)===Object.prototype) return Object.fromEntries(entries(v).map(([k,x])=>[k,transform(x,old?.[k],now)]).filter(([,x])=>x!==undefined));
    return v;
  }
  function set(obj,path,value){
    const keys=fieldParts(path),last=keys.pop();let target=obj;
    for(const key of keys) {if(!target[key]||typeof target[key]!=='object'||Array.isArray(target[key]))target[key]={};target=target[key];}
    if(value===undefined)delete target[last];else target[last]=value;
  }
  function merge(base,patch,now) {
    const out=decode(encode(base&&Object.getPrototypeOf(base)===Object.prototype?base:{}));
    for(const [k,v] of entries(patch)) {
      fieldParts(k);
      if(v && Object.getPrototypeOf(v)===Object.prototype && !v.__d1op && Object.keys(v).length)out[k]=merge(out[k],v,now);
      else {const next=transform(v,out[k],now);if(next===undefined)delete out[k];else out[k]=next;}
    }
    return out;
  }
  function apply(old,operation,now=Date.now()) {
    if(operation.type==='delete')return null;
    const value=operation.data;
    if(!value || typeof value!=='object' || Array.isArray(value))throw Error('Document must be an object');
    if(operation.type==='update') {
      if(old===null)throw Object.assign(Error('Document does not exist'),{code:'not-found'});
      const out=decode(encode(old));
      for(const [key,v] of entries(value))set(out,key,transform(v,get(old,key),now));
      return out;
    }
    if(operation.type==='create' && old!==null)throw Object.assign(Error('Document already exists'),{code:'already-exists'});
    return operation.options?.merge?merge(old,value,now):transform(value,old,now);
  }
  const api={Timestamp,encode,decode,get,equal,apply,fieldParts};
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.QAD1Codec=api;
})(globalThis);
