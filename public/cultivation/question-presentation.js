/* Q01/Q02: shared presentation, not grading or submission. */
(function(root){
  'use strict';
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function stemMarkup(value,rich){
    const text=String(value??'');
    const render=typeof rich==='function'?rich:root.quizMathRichText||root.formatQuizRichText;
    const plain=typeof render==='function'?render:v=>escape(v).replace(/\n/g,'<br>');
    const visual=root.QAQuestionVisualEngine?.renderInline(text,plain);
    return visual??plain(text);
  }
  function optionMarkup(value,index,{rich,correctMark=false,contentClass='',contentTag='span',state}={}){
    const letter=Number.isInteger(index)&&index>=0&&index<26?String.fromCharCode(65+index):'—';
    const tag=contentTag==='b'?'b':'span';
    return '<span class="bg-slate-800 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-blue-400 border border-slate-600 shrink-0 qy-option-letter" data-qy-option-letter>'+letter+'</span>'+
      '<'+tag+' class="flex-1 quiz-rich-option qy-option-content'+(contentClass?' '+escape(contentClass):'')+'" data-qy-option-content>'+stemMarkup(value,rich)+(correctMark?' ✓':'')+'</'+tag+'>'+optionStateMarkup(state);
  }
  const labels=Object.freeze({correct:'✓ 正確答案',wrong:'× 你的答案（錯誤）',selected:'你的答案',answered:'已作答',unanswered:'未作答'});
  function optionState(index,{answered=false,reveal=false,correctIndex,selectedIndex}={}){
    if(!answered)return '';
    if(!reveal||!Number.isInteger(correctIndex)||correctIndex<0)return index===selectedIndex?'selected':'';
    if(Number.isInteger(correctIndex)&&correctIndex>=0&&index===correctIndex)return 'correct';
    if(Number.isInteger(selectedIndex)&&selectedIndex>=0&&index===selectedIndex)return 'wrong';
    return '';
  }
  function optionStateMarkup(state){
    return Object.hasOwn(labels,state)?'<small class="qy-option-state" data-qy-option-state="'+state+'">'+labels[state]+'</small>':'';
  }
  function markOption(node,state){
    if(!node?.querySelector||!node.ownerDocument)return;
    node.querySelector('[data-qy-option-state]')?.remove();
    if(!Object.hasOwn(labels,state))return;
    const mark=node.ownerDocument.createElement('small');
    mark.className='qy-option-state';mark.dataset.qyOptionState=state;mark.textContent=labels[state];
    node.appendChild(mark);
  }
  function verdictMarkup(state,title){
    const key=['correct','wrong','answered','unanswered'].includes(state)?state:'answered';
    return '<strong class="qy-verdict" data-qy-verdict="'+key+'">'+escape(title||labels[key])+'</strong>';
  }
  function explanationMarkup(value,rich){
    return '<div data-qy-explanation>'+stemMarkup(value||'未提供解析。',rich)+'</div>';
  }
  function feedbackMarkup({state='answered',title,explanation,rich}={}){
    // Deferred review must never render explanation or correctness into the DOM.
    return verdictMarkup(state,title)+(['correct','wrong'].includes(state)?explanationMarkup(explanation,rich):'');
  }
  const validCount=v=>Number.isInteger(v)&&v>=0;
  function scoreText(correct,total){
    return validCount(correct)&&validCount(total)&&correct<=total?correct.toLocaleString('zh-TW')+' / '+total.toLocaleString('zh-TW'):'—';
  }
  function accuracyText(correct,total){
    return validCount(correct)&&validCount(total)&&total>0&&correct<=total?Math.round(100*correct/total)+'%':'—';
  }
  function progressAttrs(answered,total){
    if(!validCount(answered)||!validCount(total)||total===0||answered>total)return '';
    return 'data-qy-progress="linear" role="progressbar" aria-label="作答進度" aria-valuemin="0" aria-valuemax="'+total+'" aria-valuenow="'+answered+'"';
  }
  function progressMarkup(answered,total){
    const attrs=progressAttrs(answered,total);
    return attrs?'<div class="qy-quiz-progress"><small>已完成 '+scoreText(answered,total)+' 題</small><div '+attrs+'><i style="width:'+(100*answered/total)+'%"></i></div></div>':'';
  }
  function metricMarkup(label,value){
    return '<div data-qy-metric><span>'+escape(label)+'</span><b>'+escape(value)+'</b></div>';
  }
  // Q06–Q09: presentation only. Callers own permissions, requests and awards.
  const statusLabels=Object.freeze({loading:'載入中',generating:'生成題目中',preparing:'題庫準備中',reviewing:'審核中',pending:'待處理',confirmed:'已確認有誤',rejected:'未確認有誤',incomplete:'尚未確認',success:'已完成',error:'處理失敗',empty:'暫無可用題目',ready:'已準備好',neutral:''});
  function statusKey(state){return Object.hasOwn(statusLabels,state)?state:'neutral';}
  function setLearningStatus(node,state,message){
    if(!node)return;
    const key=statusKey(state);
    node.setAttribute?.('data-qy-learning-status',key);
    if(!node.hasAttribute?.('role'))node.setAttribute?.('role','status');
    if(!node.hasAttribute?.('aria-live'))node.setAttribute?.('aria-live','polite');
    node.textContent=String(message??statusLabels[key]);
  }
  function learningStatusMarkup(state,message){
    const key=statusKey(state);
    return '<p data-qy-learning-status="'+key+'" role="status" aria-live="polite">'+escape(message??statusLabels[key])+'</p>';
  }
  function reportState(status){
    const map={confirmed:'confirmed',duplicate:'confirmed',rejected:'rejected',limit:'incomplete',approved:'confirmed',pending:'pending'};
    return Object.hasOwn(map,status)?map[status]:'incomplete';
  }
  function createDisclosure(doc,{id,kind,className='',title=''}={}){
    const panel=doc.createElement('details'),summary=doc.createElement('summary');
    panel.id=id;panel.className=className;panel.open=false;
    panel.setAttribute?.('data-qy-disclosure',kind==='lesson'?'lesson':'footprint');
    summary.textContent=String(title);panel.appendChild(summary);
    return {panel,summary};
  }
  const api=Object.freeze({setLearningStatus,learningStatusMarkup,reportState,createDisclosure,stemMarkup,optionMarkup,optionState,optionStateMarkup,markOption,verdictMarkup,explanationMarkup,feedbackMarkup,scoreText,accuracyText,progressAttrs,progressMarkup,metricMarkup});
  root.QAQuestionPresentation=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
