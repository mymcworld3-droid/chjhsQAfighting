// Stage 1: independent, server-authorized preview shell. No old sourceMode,
// draft, answers, learning records or rewards are changed by this module.
import {getMainUser,authenticatedMainFetch} from './data/project-repository.js';
const $=id=>document.getElementById(id);
const ENTRY='adaptive-learning-beta-entry', DIALOG='adaptive-learning-beta-dialog';
const endpoint='/api/adaptive-learning-engine-beta/status';
let generation=0,context=false,timer=null,allowedUid='',bound=false;
let controller=null;
const uid=()=>getMainUser()?.uid||'';
const studioOpen=()=>context&&$('scope-studio')?.hidden===false&&$('page-settings')?.classList.contains('active-page');
function hide(){
  allowedUid='';
  const entry=$(ENTRY);if(entry)entry.hidden=true;
  const dialog=$(DIALOG);if(dialog?.open)dialog.close();
}
function reset(){
  generation++;controller?.abort();controller=null;
  context=false;clearInterval(timer);timer=null;hide();
}
function dialogFor(){
  let dialog=$(DIALOG);
  if(dialog)return dialog;
  const studio=$('scope-studio');if(!studio)return null;
  dialog=document.createElement('dialog');dialog.id=DIALOG;
  dialog.className='ss-transfer-panel adaptive-beta-dialog';
  dialog.setAttribute('aria-labelledby','adaptive-beta-title');
  dialog.innerHTML='<div class="ss-transfer-head"><strong id="adaptive-beta-title">自適應學習引擎 <small>Beta</small></strong></div>'+
    '<div class="ss-transfer-body"><p role="status">開發驗收版本 · 目前僅提供入口預覽，正式出題尚未開放。</p></div>'+
    '<div class="ss-transfer-actions"><button type="button" data-beta-close autofocus>返回範圍選擇</button></div>';
  dialog.querySelector('[data-beta-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('keydown',e=>{if(e.key==='Escape')e.stopPropagation();});
  dialog.addEventListener('cancel',e=>{e.preventDefault();dialog.close();});
  dialog.addEventListener('close',()=>{const entry=$(ENTRY);if(studioOpen()&&entry&&!entry.hidden)entry.focus({preventScroll:true});});
  studio.append(dialog);return dialog;
}
async function refresh({open=false}={}){
  const n=++generation,requestUid=uid(),entry=$(ENTRY);
  controller?.abort();controller=null;
  if(!entry||!studioOpen()||!requestUid){hide();return false;}
  if(allowedUid!==requestUid)hide();
  const request=new AbortController();controller=request;
  const timeout=setTimeout(()=>request.abort(),5000);
  let allowed=false;
  try{
    const response=await authenticatedMainFetch(endpoint,{signal:request.signal,cache:'no-store'});
    if(response.ok){const data=await response.json();allowed=data?.ok===true&&data?.enabled===true&&data?.phase==='preview-shell';}
  }catch(_){}
  finally{clearTimeout(timeout);if(controller===request)controller=null;}
  if(n!==generation)return false;
  if(!studioOpen()||uid()!==requestUid||!allowed){hide();return false;}
  allowedUid=requestUid;entry.hidden=false;
  if(open){
    const dialog=dialogFor();
    if(dialog&&!dialog.open)try{dialog.showModal();}catch(_){hide();return false;}
  }
  return true;
}
function bind(){
  if(bound)return;bound=true;
  $(ENTRY)?.addEventListener('click',()=>{if(!$(ENTRY).hidden&&studioOpen())void refresh({open:true});});
  window.addEventListener('qingyun:scope-studio-closed',reset);
  window.addEventListener('focus',()=>{if(context)void refresh();});
  window.addEventListener('xiuxian:user-ready',()=>{if(context)void refresh();});
  document.addEventListener('visibilitychange',()=>{if(context&&!document.hidden)void refresh();});
}
export function openBetaContext(){
  // An import resolved after the original overlay closed cannot reopen it.
  if($('scope-studio')?.hidden!==false||window.curriculumStudioReturnPage?.()!=='page-settings'||!$('page-settings')?.classList.contains('active-page'))return;
  bind();reset();context=true;
  void refresh();
  timer=setInterval(()=>{if(!studioOpen()){reset();return;}if(!document.hidden&&!controller)void refresh();},15000);
}
