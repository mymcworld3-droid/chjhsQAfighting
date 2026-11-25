/* V2 B01/B07/B09. Read-only projections for every tactical battle surface. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QABattlePresentation=api;
})(globalThis,()=>{
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const amount=v=>Number.isFinite(Number(v))?Math.max(0,Number(v)):0;
  const format=v=>Math.ceil(amount(v)).toLocaleString('zh-TW');
  const colors=Object.freeze({track:'#14251c',player:'#c8d895',enemy:'#df8a73',damage:'#ffe0c5',shield:'#bde5ed',heal:'#d1edb5',stamina:'#b6e6bb',notice:'#ede1b9'});
  function health(actor={}){
    const max=amount(actor.maxHp),current=Math.min(max,amount(actor.hp));
    return {current,max,percent:max?current/max*100:0,text:format(current)+' / '+format(max)};
  }
  function healthMarkup(actor,{trackClass='tc-health',fillClass='',label=String(actor?.name||'角色')+'生命',kind=actor?.bot?'enemy':'player'}={}){
    const h=health(actor);
    return '<div class="'+esc(trackClass)+' qy-health" data-qy-health="'+(kind==='player'?'player':'enemy')+'" role="progressbar" aria-label="'+esc(label)+'" aria-valuemin="0" aria-valuemax="'+h.max+'" aria-valuenow="'+h.current+'" aria-valuetext="'+h.text+'"><i class="'+esc(fillClass)+'" style="width:'+h.percent.toFixed(2)+'%"></i></div>';
  }
  function syncHealth(track,fill,actor){
    if(!track)return;
    const h=health(actor);
    track.classList?.add('qy-health');
    track.setAttribute('data-qy-health',actor?.bot||actor?.boss?'enemy':'player');
    track.setAttribute('role','progressbar');track.setAttribute('aria-valuemin','0');
    track.setAttribute('aria-valuemax',String(h.max));track.setAttribute('aria-valuenow',String(h.current));
    track.setAttribute('aria-valuetext',h.text);
    if(fill)fill.style.width=h.percent.toFixed(2)+'%';
    return h;
  }
  function drawHealth(ctx,actor,x,y,width,height=4){
    const h=health(actor);
    ctx.fillStyle=colors.track;ctx.fillRect(x,y,width,height);
    ctx.fillStyle=actor?.bot?colors.enemy:colors.player;ctx.fillRect(x,y,width*h.percent/100,height);
    return h;
  }
  function eventLines(number={}){
    if(number.text)return [{text:String(number.text),ink:colors.notice}];
    return [
      ...(number.damage!==undefined?[{text:(number.critical?'暴擊 ':'')+'−'+format(number.damage)+(number.hits?' · 命中 '+format(number.hits)+' 次':''),ink:colors.damage}]:[]),
      ...(number.absorbed?[{text:'護盾 −'+format(number.absorbed),ink:colors.shield}]:[]),
      ...(number.heal?[{text:'+'+format(number.heal)+' 生命',ink:colors.heal}]:[]),
      ...(number.shield?[{text:'護盾 +'+format(number.shield),ink:colors.shield}]:[]),
      ...(number.gain!==undefined?[{text:'體力 +'+format(number.gain),ink:colors.stamina}]:[])
    ];
  }
  function resultMetrics(actor,presentation){
    return '<div class="tc-result-stats qy-quiz-metrics" data-qy-battle-result>'+presentation.metricMarkup('答對',presentation.scoreText(actor.correct,actor.answered))+presentation.metricMarkup('正確率',presentation.accuracyText(actor.correct,actor.answered))+'<b>生命 '+health(actor).text+'</b></div>';
  }
  function notice(node,text){
    if(!node)return;
    node.textContent=String(text||'');node.hidden=!text;
    node.setAttribute('data-qy-combat-notice','');node.setAttribute('role','status');node.setAttribute('aria-live','polite');
  }
  return Object.freeze({colors,health,healthMarkup,syncHealth,drawHealth,eventLines,resultMetrics,notice});
});
