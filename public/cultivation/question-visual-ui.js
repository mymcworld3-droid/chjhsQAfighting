/* Shared visual zoom and fail-closed answer interaction. No nested buttons inside answer buttons. */
(function(root){
'use strict';
if(typeof document==='undefined'||root.QAQuestionVisualUI)return;
const invalid='[data-qy-invalid-visual]';
const scopes=[
 ['#options-container button','#quiz-container','#question-text,#options-container'],
 ['#battle-options button','#battle-options','#battle-q-text,#battle-options'],
 ['#bv2-options button','#bv2-quiz','#bv2-question,#bv2-options'],
 ['[data-choice-for]','[data-pair-entry]','[data-qy-stem],[data-qy-options]'],
 ['[data-submit-pair]','.tc-pair-entry','[data-qy-stem],[data-qy-options]'],
 ['[data-dq="answer"]','[data-dq-content]','.dm-quiz-question,.dm-quiz-options'],
 ['#dm-options button','#daily-meditation-overlay','#dm-question,#dm-options'],
 ['[data-dt-answer]','.dt-question','[data-qy-stem],[data-qy-options]'],
 ['.raid-options [data-choice]','.raid-study-body','.raid-question-sheet,.raid-options'],
 ['#enlightenment-body [data-answer]','#enlightenment-body','.enlightenment-question,.enlightenment-options'],
 ['.fi-option','#fi-body','.fi-question'],
 ['[data-op-answer]','.op-question','h3,.op-options'],
 ['[data-action="answer"],[data-action="correct"]','.cc-card','.cc-question,.cc-options']
];
function invalidIn(node){return Boolean(node&&(node.matches?.(invalid)||node.querySelector?.(invalid)||/\[\[QYVISUAL|QYVISUAL\]\]/.test(node.textContent||'')))}
function blocked(button){
 for(const [selector,scope,parts] of scopes){
  if(!button.matches(selector))continue;
  const parent=button.closest(scope);
  const nodes=parent?Array.from(parent.querySelectorAll(parts)):scope==='#battle-options'?Array.from(document.querySelectorAll(parts)):[];
  if(parent&&scope==='#battle-options')nodes.push(document.getElementById('battle-q-text'),parent);
  if(nodes.some(invalidIn))return true;
 }
 return false;
}
function notify(button){
 const old=document.getElementById('qy-visual-block-notice');old?.remove();
 const box=document.createElement('div');box.id='qy-visual-block-notice';box.role='alert';
 box.textContent='題目圖表不完整，本次未送出作答。請返回重新取得題目或使用題目回報。';
 box.className='qy-visual-block-notice';document.body.append(box);
 setTimeout(()=>box.remove(),6000);
}
function allowAnswer(stem,options){
 const engine=root.QAQuestionVisualEngine;
 if(engine? !engine.answerIssue(stem,options) : ![stem,...(Array.isArray(options)?options:[])].some(v=>/\[\[QYVISUAL|QYVISUAL\]\]/.test(String(v??''))))return true;
 notify();return false;
}
let dialog=null,previous=null;
function close(){if(dialog?.open)dialog.close();}
function open(visual){
 if(!visual||!visual.matches('.qy-visual'))return;
 close();previous=document.activeElement;
 const el=document.createElement('dialog');el.className='qy-visual-dialog';el.setAttribute('aria-label','圖表放大檢視');
 const top=document.createElement('header');const title=document.createElement('strong');title.textContent='圖表檢視';top.append(title);
 const body=document.createElement('div');body.className='qy-visual-dialog-body';
 const copy=visual.cloneNode(true);copy.removeAttribute('tabindex');copy.removeAttribute('role');copy.classList.add('qy-visual-dialog-copy');body.append(copy);
 let scale=1;function update(){copy.style.setProperty('width',Math.round(scale*100)+'%','important');copy.style.setProperty('max-width','none','important');}
 for(const [label,fn] of [['−',()=>{scale=Math.max(1,scale-.25);update()}],['適合畫面',()=>{scale=1;update()}],['＋',()=>{scale=Math.min(4,scale+.25);update()}],['關閉',close]]){
  const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',fn);top.append(b);
 }
 el.append(top,body);document.body.append(el);dialog=el;update();
 el.addEventListener('close',()=>{el.remove();if(dialog===el)dialog=null;if(previous?.isConnected)previous.focus?.();},{once:true});
 el.addEventListener('click',e=>{if(e.target===el)close()});el.showModal();top.lastElementChild.focus();
}
function stop(e){e.preventDefault();e.stopImmediatePropagation();}
document.addEventListener('click',e=>{
 const target=e.target?.closest?.('*');if(!target)return;
 const visual=target.closest('.qy-visual');
 if(visual&&!visual.closest('.qy-visual-dialog')&&(!visual.classList.contains('qy-visual-table')||target.closest('[data-qy-zoom]'))){stop(e);open(visual);return;}
 const b=target.closest('button');
 if(b&&blocked(b)){stop(e);notify(b);}
},true);
document.addEventListener('keydown',e=>{
 if(e.key!=='Enter'&&e.key!==' ')return;
 const visual=e.target?.closest?.('.qy-visual');
 if(visual&&!visual.closest('.qy-visual-dialog')&&e.target===visual){stop(e);open(visual);return}
 const button=e.target?.closest?.('button');
 if(button&&e.shiftKey&&e.key==='Enter'){const v=button.querySelector('.qy-visual');if(v){stop(e);open(v);return}}
 if(button&&blocked(button)){stop(e);notify(button);}
},true);
function decorate(scope){
 const items=[];if(scope.matches?.('.qy-visual'))items.push(scope);items.push(...scope.querySelectorAll?.('.qy-visual')||[]);
 for(const v of items){
  if(v.closest('.qy-visual-dialog')||v.dataset.qyZoomReady)continue;
  v.dataset.qyZoomReady='1';
  const hint=document.createElement('span');hint.dataset.qyZoom='';hint.className='qy-visual-zoom-label';hint.textContent='放大圖表';
  if(!v.closest('button')){v.tabIndex=0;v.setAttribute('role','button');v.setAttribute('aria-label','放大圖表');}
  else{hint.title='點此放大；鍵盤 Shift+Enter 放大，Enter 選答';}
  v.append(hint);
 }
}
function start(){decorate(document);new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1)decorate(n)}).observe(document.body,{childList:true,subtree:true});}
if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
root.QAQuestionVisualUI={open,close,allowAnswer,blocked};
})(globalThis);
