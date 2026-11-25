/* Q01/Q02: shared presentation, not grading or submission. */
(function(root){
  'use strict';
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function stemMarkup(value,rich){
    const text=String(value??'');
    const render=typeof rich==='function'?rich:root.quizMathRichText||root.formatQuizRichText;
    return typeof render==='function'?render(text):escape(text).replace(/\n/g,'<br>');
  }
  function optionMarkup(value,index,{rich,correctMark=false,contentClass='',contentTag='span'}={}){
    const letter=Number.isInteger(index)&&index>=0&&index<26?String.fromCharCode(65+index):'—';
    const tag=contentTag==='b'?'b':'span';
    return '<span class="bg-slate-800 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-blue-400 border border-slate-600 shrink-0 qy-option-letter" data-qy-option-letter>'+letter+'</span>'+
      '<'+tag+' class="flex-1 quiz-rich-option qy-option-content'+(contentClass?' '+escape(contentClass):'')+'" data-qy-option-content>'+stemMarkup(value,rich)+(correctMark?' ✓':'')+'</'+tag+'>';
  }
  const api=Object.freeze({stemMarkup,optionMarkup});
  root.QAQuestionPresentation=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
