// 本頁只彙整現有訂正紀錄，不修改玩家答題或獎勵資料。
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QAHomeCorrectionProgress=api;
})(globalThis,()=>{
  'use strict';
  function summarize(stats){
    const mistakes=stats?.soloLearningV1?.mistakes;
    const entries=mistakes&&typeof mistakes==='object'&&!Array.isArray(mistakes)
      ? Object.values(mistakes).filter(m=>m&&typeof m==='object'):[];
    const total=entries.length;
    const completed=entries.filter(m=>m.recovered===true).length;
    const pending=total-completed;
    const percent=total>0?Math.round(completed/total*100):0;
    return Object.freeze({total,completed,pending,percent,
      label:total===0?'目前沒有待訂正的錯題':pending===0?'目前保留的錯題皆已訂正':'尚有 '+pending+' 題待訂正'});
  }
  return Object.freeze({summarize});
});
