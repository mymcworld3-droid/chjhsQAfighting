import {getApp} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {getAuth,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {autoMigrationEnabled,dataBackend} from '../data-store.js';

// Start once per authenticated session. The SERVER checks isAdmin before it
// starts or reveals job status; no player data is downloaded by this module.
(function(){
  'use strict';
  if(!autoMigrationEnabled||dataBackend==='d1')return;
  let serial=0,timer=null,controller=null,panel=null,lastState=null;
  const auth=getAuth(getApp());
  function remove(){panel?.remove();panel=null;}
  function show(state,uid){
    if(auth.currentUser?.uid!==uid)return;
    if(!panel){
      panel=document.createElement('aside');panel.id='admin-d1-migration';panel.setAttribute('aria-label','管理員資料搬遷');
      panel.style.cssText='position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));z-index:2147483000;width:min(360px,calc(100vw - 24px));padding:14px 16px;border:1px solid #a7884b;border-radius:12px;background:#17140ff2;color:#e8dec8;box-shadow:0 8px 32px #0008;font:13px/1.6 sans-serif';
      panel.innerHTML='<div style="display:flex;justify-content:space-between;gap:12px"><strong>D1 資料搬遷</strong><button type="button" data-toggle style="color:#dbc48d">收合</button></div><div data-detail><p data-message role="status"></p><p data-count style="font-size:12px;color:#bdae91"></p><button type="button" data-retry hidden style="color:#dbc48d;text-decoration:underline">重新檢查並續傳</button></div>';
      panel.querySelector('[data-toggle]').addEventListener('click',event=>{const detail=panel.querySelector('[data-detail]');detail.hidden=!detail.hidden;event.target.textContent=detail.hidden?'展開':'收合';});
      panel.querySelector('[data-retry]').addEventListener('click',()=>{clearTimeout(timer);void check(uid,serial,'start');});
      document.body.append(panel);
    }
    panel.querySelector('[data-message]').textContent=state.message||'正在確認搬遷進度…';
    const processed=Number(state.processed)||0,total=Number(state.discovered)||0;
    panel.querySelector('[data-count]').textContent=`已處理 ${processed.toLocaleString('zh-TW')}／已發現 ${total.toLocaleString('zh-TW')} 筆；本階段寫入 ${Number(state.copied||0).toLocaleString('zh-TW')} 筆，相同資料 ${Number(state.unchanged||0).toLocaleString('zh-TW')} 筆。`;
    panel.querySelector('[data-retry]').hidden=!['paused','blocked'].includes(state.status);
  }
  async function check(uid,generation,action='status'){
    if(generation!==serial||auth.currentUser?.uid!==uid)return;
    if(document.hidden&&action==='status')return;
    controller?.abort();controller=new AbortController();
    try{
      const token=await auth.currentUser.getIdToken();
      const response=await fetch('/api/admin/d1-migration',{method:'POST',cache:'no-store',signal:controller.signal,
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action})});
      if(generation!==serial||auth.currentUser?.uid!==uid)return;
      if(response.status===401||response.status===403){remove();return;}
      const state=await response.json();
      if(!response.ok){
        if(state.administrator===true)lastState={status:'blocked',message:state.error};
        throw Error(state.error||'暫時無法確認搬遷進度');
      }
      if(['disabled','active'].includes(state.status)){remove();return;}
      lastState=state;show(state,uid);
      if(['pending','running','paused','copied'].includes(state.status))timer=setTimeout(()=>void check(uid,generation),state.status==='copied'?60000:Math.max(5000,Math.min(60000,(state.retryAfterMs||0)-Date.now())));
    }catch(error){
      if(error.name==='AbortError'||generation!==serial)return;
      // An ordinary player never sees an admin panel just because a request failed.
      if(lastState){show({...lastState,message:lastState.status==='blocked'?lastState.message:'連線暫時中斷，正在重新確認搬遷進度…'},uid);timer=setTimeout(()=>void check(uid,generation),15000);}
    }
  }
  onAuthStateChanged(auth,user=>{
    serial++;clearTimeout(timer);controller?.abort();remove();lastState=null;
    if(user)void check(user.uid,serial,'start');
  });
  document.addEventListener('visibilitychange',()=>{
    clearTimeout(timer);controller?.abort();
    if(!document.hidden&&lastState&&auth.currentUser)void check(auth.currentUser.uid,serial);
  });
  window.addEventListener('pagehide',()=>{serial++;clearTimeout(timer);controller?.abort();});
})();
