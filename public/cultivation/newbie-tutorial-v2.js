import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// 新手教學 v2：只介紹基礎玩法、題目範圍與築基前後功能，不提前揭露後期系統。
(function () {
  'use strict';

  const FIELD = 'newbieTutorialV1';
  const VERSION = 1;
  let active = false;
  let index = 0;
  let autoStarted = false;
  let resizeHandler = null;

  const steps = [
    {
      page: 'page-home', target: '#xiuxian-panel', kicker: '第一步 · 仙途', title: '以答題累積修為',
      body: '《青雲問道》的核心循環是：選擇適合自己的題目範圍 → 問道答題 → 累積修為 → 突破境界 → 解鎖更多玩法。答對會增加修為，境界進度會顯示在仙府。',
      note: '先從問道開始，不需要一次記住所有系統。'
    },
    {
      page: 'page-home', target: '#btn-home-start', kicker: '第二步 · 問道', title: '問道試煉是主要修煉方式',
      body: '點「問道試煉」開始單人答題。每一輪都會記錄答對、答錯與連續答對狀態，並依結果累積修為。',
      note: '不知道從哪開始時，直接按這顆按鈕即可。'
    },
    {
      page: 'page-settings', target: '#set-source-mode', kicker: '第三步 · 範圍選擇', title: '先決定題目從哪裡來',
      body: '在洞府的「出題模式」可以控制範圍：<strong>綜合題目</strong>適合日常練習；<strong>指定題庫</strong>可以鎖定特定題庫；<strong>專注練習</strong>可以加入指定單元，只練你挑選的內容。',
      note: '考前複習建議使用指定題庫或專注練習。'
    },
    {
      page: 'page-settings', target: '#set-difficulty', kicker: '第四步 · 難度', title: '再選擇題目難度',
      body: '難度可以交給 AI AUTO 自動調整，也可以固定為簡單、中等或困難。範圍決定「考什麼」，難度決定「考多深」。',
      note: '剛開始可以先使用 AUTO 或中等。'
    },
    {
      page: 'page-home', target: 'button[onclick*="startBattleMatchmaking"]', kicker: '第五步 · 多人', title: '築基後開放多人玩法',
      body: '達到 <strong>築基初期（60 修為）</strong> 後，才會開放配對鬥法、接受邀請與仙盟等多人功能。未達門檻時會顯示鎖定。',
      note: '先用單人問道熟悉題目與修煉節奏。'
    },
    {
      page: 'page-home', target: '[data-target="page-store"]', kicker: '第六步 · 資源', title: '坊市、洞府與背包',
      body: '坊市可以取得可購買的道具；洞府可以調整題目設定並查看法寶庫。達到築基後，修煉頁也會開放背包，供後續修煉物品使用。',
      note: '常用設定都集中在洞府。'
    },
    {
      page: 'page-home', target: '#xiuxian-panel', kicker: '完成 · 開始修行', title: '先選範圍，再開始問道',
      body: '最實用的順序是：<strong>洞府選範圍 → 問道試煉 → 累積修為 → 築基後解鎖多人與修煉背包</strong>。之後任何時候都能從洞府重新開啟這份教學。',
      note: '祝你道途順遂。'
    }
  ];

  function ensureStyle() {
    if (document.getElementById('newbie-tutorial-style')) return;
    const style = document.createElement('style');
    style.id = 'newbie-tutorial-style';
    style.textContent = `
      #newbie-tutorial-layer{position:fixed;inset:0;z-index:7200;pointer-events:none}.newbie-tutorial-dim{position:absolute;inset:0;background:rgba(0,0,0,.74);backdrop-filter:blur(2px);pointer-events:auto}.newbie-tutorial-spotlight{position:fixed;z-index:1;border:2px solid rgba(236,197,103,.95);border-radius:18px;box-shadow:0 0 0 9999px rgba(0,0,0,.76),0 0 0 6px rgba(216,177,93,.10),0 0 36px rgba(216,177,93,.32);transition:all .28s ease;pointer-events:none}.newbie-tutorial-card{position:fixed;z-index:3;left:50%;bottom:22px;transform:translateX(-50%);width:min(calc(100vw - 28px),520px);padding:20px;border-radius:26px;border:1px solid rgba(216,177,93,.42);background:linear-gradient(145deg,rgba(25,21,13,.99),rgba(7,7,7,.995));box-shadow:0 30px 90px rgba(0,0,0,.7);pointer-events:auto}.newbie-tutorial-kicker{color:#9f8246;font-size:8px;font-weight:900;letter-spacing:.18em}.newbie-tutorial-card h3{margin:5px 0 8px;color:#f5ead5;font-size:21px;font-weight:900}.newbie-tutorial-card p{margin:0;color:#b8aa90;font-size:12px;line-height:1.75}.newbie-tutorial-card p strong{color:#e4bf61}.newbie-tutorial-note{margin-top:9px!important;color:#817662!important;font-size:10px!important}.newbie-tutorial-progress{display:flex;gap:5px;margin:14px 0 12px}.newbie-tutorial-progress i{width:6px;height:6px;border-radius:999px;background:rgba(216,177,93,.18)}.newbie-tutorial-progress i.active{width:21px;background:#d8b15d}.newbie-tutorial-actions{display:grid;grid-template-columns:auto 1fr auto;gap:8px}.newbie-tutorial-actions button{min-height:40px;border-radius:13px;padding:0 13px;font-size:10px;font-weight:900}.newbie-tutorial-skip,.newbie-tutorial-prev{color:#9b907b;border:1px solid rgba(216,177,93,.14);background:#0c0c0c}.newbie-tutorial-next{color:#fff0c7;border:1px solid #d8b15d;background:linear-gradient(135deg,#a87827,#5e3b0f)}.newbie-tutorial-replay{display:inline-flex;align-items:center;gap:6px;margin:8px 0 14px;min-height:34px;padding:0 11px;border-radius:12px;color:#d9bd76;border:1px solid rgba(216,177,93,.24);background:rgba(216,177,93,.055);font-size:9px;font-weight:900}@media(max-width:520px){.newbie-tutorial-card{bottom:12px;padding:17px}.newbie-tutorial-card h3{font-size:18px}.newbie-tutorial-actions{grid-template-columns:1fr 1fr}.newbie-tutorial-skip{grid-column:1/-1;grid-row:2}}
    `;
    document.head.appendChild(style);
  }

  function userData(){ return window.getCurrentUserData?.() || null; }
  function marker(){ return userData()?.[FIELD] || null; }
  function visible(el){ if(!el) return false; const s=getComputedStyle(el); return s.display!=='none'&&s.visibility!=='hidden'&&el.getClientRects().length>0; }
  function navigate(page){ if(page&&typeof window.switchToPage==='function') window.switchToPage(page); }
  function target(selector){ const all=Array.from(document.querySelectorAll(selector||'')); return all.find(visible)||all[0]||null; }

  function updateSpotlight(){
    const layer=document.getElementById('newbie-tutorial-layer'); const spot=layer?.querySelector('.newbie-tutorial-spotlight'); const dim=layer?.querySelector('.newbie-tutorial-dim');
    if(!layer||!spot||!dim||!active) return; const el=target(steps[index].target);
    if(!el||!visible(el)){ spot.style.display='none'; dim.style.display='block'; return; }
    const r=el.getBoundingClientRect(), p=8; spot.style.display='block'; dim.style.display='none'; spot.style.left=`${Math.max(6,r.left-p)}px`; spot.style.top=`${Math.max(6,r.top-p)}px`; spot.style.width=`${Math.min(innerWidth-12,r.width+p*2)}px`; spot.style.height=`${Math.min(innerHeight-12,r.height+p*2)}px`;
  }

  function render(){
    if(!active) return; const step=steps[index]; navigate(step.page);
    let layer=document.getElementById('newbie-tutorial-layer');
    if(!layer){ layer=document.createElement('div'); layer.id='newbie-tutorial-layer'; layer.innerHTML='<div class="newbie-tutorial-dim"></div><div class="newbie-tutorial-spotlight"></div><section class="newbie-tutorial-card"></section>'; document.body.appendChild(layer); }
    const card=layer.querySelector('.newbie-tutorial-card');
    card.innerHTML=`<div class="newbie-tutorial-kicker">${step.kicker}</div><h3>${step.title}</h3><p>${step.body}</p><p class="newbie-tutorial-note">${step.note}</p><div class="newbie-tutorial-progress">${steps.map((_,i)=>`<i class="${i===index?'active':''}"></i>`).join('')}</div><div class="newbie-tutorial-actions"><button class="newbie-tutorial-skip">跳過教學</button><button class="newbie-tutorial-prev" ${index===0?'disabled':''}>上一步</button><button class="newbie-tutorial-next">${index===steps.length-1?'完成':'下一步'}</button></div>`;
    card.querySelector('.newbie-tutorial-skip').onclick=()=>finish(true); card.querySelector('.newbie-tutorial-prev').onclick=()=>{if(index>0){index--;render();}}; card.querySelector('.newbie-tutorial-next').onclick=()=>{if(index===steps.length-1)finish(false);else{index++;render();}};
    setTimeout(()=>{ target(step.target)?.scrollIntoView?.({behavior:'smooth',block:'center'}); setTimeout(updateSpotlight,180); },120);
  }

  async function persistFinished(skipped){
    const data=userData(), user=getAuth(getApp()).currentUser; if(!data||!user) return;
    const value={version:VERSION,completed:true,skipped:!!skipped,completedAt:Date.now()}; data[FIELD]=value;
    try{ await updateDoc(doc(getFirestore(getApp()),'users',user.uid),{[FIELD]:value}); }catch(error){ console.warn('Tutorial completion could not be persisted:',error); }
  }

  function finish(skipped){ if(!active)return; active=false; document.getElementById('newbie-tutorial-layer')?.remove(); if(resizeHandler)window.removeEventListener('resize',resizeHandler); resizeHandler=null; navigate('page-home'); persistFinished(skipped); }
  function start(){ ensureStyle(); active=true; index=0; resizeHandler ||= ()=>updateSpotlight(); window.addEventListener('resize',resizeHandler); render(); }

  function addReplayButton(){
    const page=document.getElementById('page-settings'); if(!page||document.getElementById('newbie-tutorial-replay'))return;
    const button=document.createElement('button'); button.id='newbie-tutorial-replay'; button.type='button'; button.className='newbie-tutorial-replay'; button.innerHTML='<i class="fa-solid fa-circle-question"></i><span>重新查看新手教程</span>'; button.onclick=start;
    const first=page.firstElementChild; if(first)first.insertAdjacentElement('afterend',button); else page.prepend(button);
  }

  function blocking(){ return !!document.querySelector('#progression-v2-modal,.training-v3-modal-backdrop,#realm-breakthrough-feedback,#golden-core-tutorial-layer'); }
  function maybeAutoStart(){
    if(autoStarted||active||blocking())return; const data=userData(), user=getAuth(getApp()).currentUser; if(!data?.stats||!user)return;
    if(Number(marker()?.version)>=VERSION&&marker()?.completed){autoStarted=true;return;} if((Number(data.stats.totalScore)||0)>10){autoStarted=true;return;}
    autoStarted=true; setTimeout(()=>{if(!blocking())start();else autoStarted=false;},900);
  }

  window.startNewbieTutorial=start;
  function boot(){ ensureStyle(); addReplayButton(); maybeAutoStart(); setInterval(()=>{addReplayButton();maybeAutoStart();if(active)updateSpotlight();},700); new MutationObserver(addReplayButton).observe(document.body,{childList:true,subtree:true}); }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
