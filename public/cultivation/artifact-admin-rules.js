// Read-only diagnostics preserve the submitted values after gameplay normalization.
(function(root){
 'use strict';
 const fixed=typeof module==='object'&&module.exports?require('./soulbound-pool.js'):null;
 const pool=()=>fixed||root.QASoulboundPool;
 function bounds(item,type){
  const rules=pool();
  if(item?.equipSlot==='本命法寶')return rules?.EFFECT_BOUNDS[type]||null;
  const cap=rules?.PERCENT_EFFECT_CAPS[type];
  return Number.isFinite(cap)?{min:type==='equip_damage_cap_percent'?.05:0,max:cap}:null;
 }
 function warnings(item={}){
  const result=new Map(),current=Array.isArray(item.effects)?item.effects:[];
  const inspect=(type,raw)=>{
   const limit=bounds(item,type);if(!limit)return;
   const value=Number(raw);
   if(Number.isFinite(value)&&value>=limit.min&&value<=limit.max)return;
   const original=Number.isFinite(value)?value:String(raw).slice(0,40);
   result.set(type+':'+original,{type,value:original,min:limit.min,max:limit.max});
  };
  for(const e of current)if(e&&Object.hasOwn(e,'value'))inspect(e.type,e.value);
  // Old values remain visible to administrators until the item is explicitly corrected.
  for(const e of (Array.isArray(item.statLimitWarnings)?item.statLimitWarnings:[]).slice(0,64))
   if(current.some(row=>row?.type===e?.type))inspect(e.type,e.value);
  const totals=new Map();
  for(const e of current){if(!bounds(item,e?.type)||!Number.isFinite(Number(e.value)))continue;
   const row=totals.get(e.type)||{sum:0,count:0};row.sum+=Math.max(0,Number(e.value));row.count++;totals.set(e.type,row);}
  for(const [type,row]of totals)if(row.count>1&&type!=='equip_damage_cap_percent')inspect(type,row.sum);
  return [...result.values()];
 }
 function custom(item,defaultIds=[]){
  if(pool()?.get(item?.id))return false;
  return item?.customArtifact===true||item?.generatedByAI===true||!(defaultIds instanceof Set?defaultIds:new Set(defaultIds)).has(item?.id);
 }
 function ordered(items,defaultIds=[]){
  const defaults=new Set(defaultIds);
  return [...items].sort((a,b)=>Number(custom(b,defaults))-Number(custom(a,defaults))||
   Number(warnings(b).length>0)-Number(warnings(a).length>0)||
   Number(b.reviewStatus==='pending')-Number(a.reviewStatus==='pending')||
   (Number(b.generatedAtMs||b.customUpdatedAtMs)||0)-(Number(a.generatedAtMs||a.customUpdatedAtMs)||0));
 }
 const api=Object.freeze({bounds,warnings,custom,ordered});
 if(typeof module==='object'&&module.exports)module.exports=api;else root.QAArtifactAdminRules=api;
})(globalThis);
