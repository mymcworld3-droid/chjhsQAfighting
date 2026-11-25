/* Shared teacher authoring views. Field names and mutations belong to callers. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.QAQuestionEditorPresentation=api;})(globalThis,()=>{
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function preview(question,index=0){
    const q=question||{},options=Array.isArray(q.options)?q.options:[];
    return '<div data-qy-editor-preview><h4>第 '+(index+1)+' 題</h4><div class="cc-question">'+esc(q.question)+'</div><div class="cc-options">'+options.map((value,i)=>'<div'+(i===q.answerIndex?' class="cc-status"':'')+'><b>'+String.fromCharCode(65+i)+'.</b> '+esc(value)+(i===q.answerIndex?' <span>✓ 正確答案</span>':'')+'</div>').join('')+'</div>'+(q.explanation?'<div class="cc-explanation">'+esc(q.explanation)+'</div>':'')+'</div>';
  }
  function fields(q,index,{questionName='question-',explanationName='explanation-',points='',field}={}){
    const options=Array.from({length:4},(_,i)=>q.options?.[i]||'');
    const input=field||((name,label,value,attrs)=>'<label>'+esc(label)+'<input name="'+esc(name)+'" value="'+esc(value)+'" '+attrs+'></label>');
    return '<div data-qy-question-fields><label>題目<textarea name="'+questionName+index+'" required maxlength="4000">'+esc(q.question)+'</textarea></label><div class="cc-fields">'+options.map((value,i)=>input('option-'+index+'-'+i,'選項 '+String.fromCharCode(65+i),value,'required maxlength="1200"')).join('')+'</div><div class="cc-fields"><label>正確答案<select name="answer-'+index+'">'+options.map((_,i)=>'<option value="'+i+'" '+(i===q.answerIndex?'selected':'')+'>'+String.fromCharCode(65+i)+'</option>').join('')+'</select></label><label>知識點（選填）<select name="point-'+index+'">'+points+'</select></label></div><label>解析（選填）<textarea name="'+explanationName+index+'" maxlength="4000">'+esc(q.explanation)+'</textarea></label><details class="qy-editor-preview"><summary>預覽題目</summary>'+preview(q,index)+'</details></div>';
  }
  function navigation(questions,selected,button){
    return '<nav class="cc-editor-nav" aria-label="題目清單">'+questions.map((q,i)=>button(i,'<span class="cc-editor-number">'+String(i+1).padStart(2,'0')+'</span><span class="cc-editor-nav-text">'+esc(String(q.question||'尚未填寫題目').slice(0,38))+'</span>',i===selected)).join('')+'</nav>';
  }
  return Object.freeze({fields,preview,navigation});
});
