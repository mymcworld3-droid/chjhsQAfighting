// Entry selection only. Internal question continuation still calls startQuizFlow directly.
(function(){
 'use strict';
 let returnFocus=null,account='';
 function close(restore=true){document.getElementById('wendao-modes-modal')?.remove();document.body.classList.remove('wendao-modes-open');if(restore&&returnFocus?.isConnected)returnFocus.focus({preventScroll:true});}
 function open(){
  window.closeTrialTower?.();close(false);returnFocus=document.activeElement;account=window.getCurrentUserData?.()?.uid||'';
  if(!document.getElementById('wendao-modes-style')){const link=document.createElement('link');link.id='wendao-modes-style';link.rel='stylesheet';link.href='styles/wendao-modes.css?v=20261104-two-modes1';document.head.appendChild(link);}
  const root=document.createElement('div');root.id='wendao-modes-modal';
  root.innerHTML=`<section class="wm-dialog" role="dialog" aria-modal="true" aria-labelledby="wm-title"><header><div><small>問道有途 · 試煉有賞</small><h2 id="wm-title" tabindex="-1">問道試煉</h2></div><button type="button" data-wm-close aria-label="關閉模式選擇">×</button></header><p>選擇這次的修行方式</p><div class="wm-choices"><button type="button" class="wm-choice" data-wm-free><span class="wm-seal" aria-hidden="true">問</span><strong>自由問道</strong><span>依目前學習範圍持續答題，累積修為與靈石。</span><small>保留原有作答進度</small><b>開始問道 →</b></button><button type="button" class="wm-choice wm-tower" data-wm-tower><span class="wm-seal" aria-hidden="true">塔</span><strong>試煉之塔</strong><span>以金丹、元嬰與法器配裝挑戰百層守衛，領取每層首通獎勵。</span><small>金丹境開放 · 每五層解鎖起點</small><b>進入試煉之塔 →</b></button></div></section>`;
  document.body.appendChild(root);document.body.classList.add('wendao-modes-open');
  root.querySelector('[data-wm-close]').onclick=()=>close();
  root.querySelector('[data-wm-free]').onclick=()=>{close();void window.startQuizFlow?.();};
  root.querySelector('[data-wm-tower]').onclick=()=>{close();void (window.openTrialTower||window.openMartialTrial)?.();};
  root.querySelector('#wm-title').focus();
 }
 document.addEventListener('keydown',event=>{
  const root=document.getElementById('wendao-modes-modal');if(!root)return;
  if(event.key==='Escape'){event.preventDefault();close();}
  if(event.key==='Tab'){
   const buttons=[...root.querySelectorAll('button')],first=buttons[0],last=buttons.at(-1);
   if(event.shiftKey&&(document.activeElement===first||!root.contains(document.activeElement))){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
 });
 window.addEventListener('xiuxian:user-ready',()=>{if(account!==(window.getCurrentUserData?.()?.uid||''))close();});
 window.openWendaoModes=open;
})();
