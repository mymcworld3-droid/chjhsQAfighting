// 煉虛返璞重修：累積修為不歸零，顯示與下一境進度改走半程重修。
(function (root) {
  'use strict';
  const START=428, REQUIRED=214, FUSION=START+REQUIRED;
  const PHASES=Object.freeze([
    {baseName:'煉氣',sub:'返璞重修',need:START},
    {baseName:'築基',sub:'重修築基',need:START+6/2},
    {baseName:'金丹',sub:'重修凝丹',need:START+28/2},
    {baseName:'元嬰',sub:'重修元嬰',need:START+68/2},
    {baseName:'化神',sub:'重修化神',need:START+188/2}
  ].map(row=>Object.freeze({...row,name:row.baseName+'期（煉虛）',majorName:'煉虛',retraining:true})));
  const COMPLETE=Object.freeze({name:'合體',baseName:'合體',sub:'天地合一',need:FUSION});
  const value=n=>Number.isFinite(Number(n))?Math.max(0,Number(n)):0;
  function phase(score){
    const current=value(score);
    if(current<START||current>=FUSION)return -1;
    return PHASES.findLastIndex(row=>current>=row.need);
  }
  function display(score,realm){const index=phase(score);return index>=0?{...realm,...PHASES[index]}:realm;}
  function progress(score,realms,index,cursor){
    const current=value(score),raw=realms[index]||realms[0];
    let realm=raw,next=realms[index+1],phaseIndex=-1;
    if(raw?.name==='煉虛'){
      phaseIndex=Number.isInteger(cursor?.phaseIndex)&&cursor.phaseIndex>=0?cursor.phaseIndex:phase(current);
      if(phaseIndex>=0){realm={...raw,...PHASES[phaseIndex]};next=PHASES[phaseIndex+1]||COMPLETE;}
    }
    // A fixed animation cursor must finish its original segment before carryover.
    const future=next?.need>realm.need?next:realms.slice(index+1).find(row=>row.need>realm.need);
    const required=future?future.need-realm.need:0;
    const earned=future?Math.min(required,Math.max(0,current-realm.need)):Math.max(0,current-realm.need);
    return {index,realm,next,earned,required,ratio:future?earned/required:1,
      cursor:{index,phaseIndex},step:index*10+(phaseIndex+1),
      retraining:phaseIndex>=0,cycleEarned:Math.min(REQUIRED,Math.max(0,current-START)),cycleRequired:REQUIRED};
  }
  const api=Object.freeze({START,REQUIRED,FUSION,PHASES,COMPLETE,phase,display,progress});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QAVoidRetraining=api;
})(globalThis);
