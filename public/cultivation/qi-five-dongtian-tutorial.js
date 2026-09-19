import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// 煉氣五層洞天實作教學：玩家必須自己找到入口、建立私人範例、完整遊玩並刪除。
(function () {
  'use strict';

  const SCORE_REQUIRED = 5;
  const FIELD = 'qiFiveDongtianTutorialV1';
  const VERSION = 2;
  const LAYER_ID = 'qi-five-dongtian-tutorial-layer';

  let active = false;
  let phase = 'intro';
  let demoCompleted = false;
  let busy = false;
  let snoozeUntil = 0;
  let resizeHandler = null;

  function userData() { return window.getCurrentUserData?.() || null; }
  function marker() { return userData()?.[FIELD] || null; }
  function score() { return Math.max(0, Number(userData()?.stats?.totalScore) || 0); }
  function visible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
  }
  function target(selector) {
    const nodes = Array.from(document.querySelectorAll(selector || ''));
    return nodes.find(visible) || nodes[0] || null;
  }

  function ensureStyle() {
    if (document.getElementById('qi-five-dongtian-tutorial-style')) return;
    const style = document.createElement('style');
    style.id = 'qi-five-dongtian-tutorial-style';
    style.textContent = `
      #${LAYER_ID}{position:fixed;inset:0;z-index:12600;pointer-events:none}
      #${LAYER_ID} .qfd-spot{position:fixed;z-index:1;border:2px solid rgba(196,142,247,.96);border-radius:18px;box-shadow:0 0 0 9999px rgba(0,0,0,.74),0 0 0 6px rgba(180,112,239,.10),0 0 42px rgba(175,104,236,.36);pointer-events:none;transition:all .25s ease}
      #${LAYER_ID} .qfd-card{position:fixed;z-index:2;left:50%;bottom:18px;transform:translateX(-50%);width:min(calc(100vw - 28px),630px);padding:19px;border:1px solid rgba(199,150,247,.36);border-radius:24px;background:linear-gradient(145deg,rgba(24,16,29,.99),rgba(7,6,8,.995));box-shadow:0 28px 90px rgba(0,0,0,.7);pointer-events:auto}
      #${LAYER_ID} .qfd-kicker{color:#b98ade;font-size:8px;font-weight:900;letter-spacing:.18em}
      #${LAYER_ID} h3{margin:5px 0 8px;color:#f2e5f8;font-size:20px}
      #${LAYER_ID} p{margin:0;color:#b9a9c0;font-size:11px;line-height:1.75}
      #${LAYER_ID} p strong{color:#dfbbff}
      #${LAYER_ID} .qfd-note{margin-top:8px;color:#807287;font-size:9px;line-height:1.65}
      #${LAYER_ID} .qfd-actions{display:grid;grid-template-columns:auto 1fr;gap:8px;margin-top:13px}
      #${LAYER_ID} button{min-height:40px;border-radius:12px;padding:0 13px;font-size:9px;font-weight:900}
      #${LAYER_ID} .qfd-later{border:1px solid rgba(255,255,255,.09);background:#0d0b0e;color:#918698}
      #${LAYER_ID} .qfd-next{border:1px solid rgba(198,144,248,.42);background:linear-gradient(135deg,#76439d,#442259);color:#f4e5ff}
      #${LAYER_ID} .qfd-next:disabled{opacity:.42;cursor:not-allowed}
      #${LAYER_ID} .qfd-progress{height:4px;margin-top:12px;border-radius:999px;background:rgba(255,255,255,.07);overflow:hidden}
      #${LAYER_ID} .qfd-progress i{display:block;height:100%;background:linear-gradient(90deg,#75439b,#d2a0f3);transition:width .25s ease}
      @media(max-width:560px){#${LAYER_ID} .qfd-card{bottom:10px;padding:16px}#${LAYER_ID} h3{font-size:17px}}
    `;
    document.head.appendChild(style);
  }

  function phaseInfo() {
    if (phase === 'intro') return {
      kicker:'煉氣五層 · 洞天專屬教學',
      title:'現在完整學會「洞天」',
      body:'洞天能把<strong>圖片或文字教材</strong>煉成固定題序的知識秘境。這次不只看說明：你會自己找到入口、看懂建立規則、生成一座<strong>不公開的 1 題範例</strong>、實際答完，再親手刪除。',
      note:'私人教學範例只存在於本次教學，不寫入公開洞天資料，也不會被其他修士遇見。',
      button:'開始找洞天入口'
    };
    if (phase === 'settings') return {
      kicker:'第 1 步 · 找到入口', title:'先找到底部「洞府」',
      body:'洞天功能放在<strong>洞府</strong>裡。請自己點擊底部導覽的「洞府」，教學不會直接把你傳送過去。',
      note:'請點紫色框標示的「洞府」。', button:'請點洞府', target:'[data-target="page-settings"]', locked:true
    };
    if (phase === 'card') return {
      kicker:'第 2 步 · 打開洞天', title:'在洞府裡找到「洞天」',
      body:'洞府裡的「洞天」區塊就是建立、重玩、管理與刪除洞天的位置。現在請親自點開它。',
      note:'之後使用洞天，都從這個入口開始。', button:'請點開洞天', target:'#dongtian-card .dongfu-collapse-head', locked:true
    };
    if (phase === 'create') return {
      kicker:'第 3 步 · 建立素材', title:'圖片、文字都可以煉成洞天',
      body:'你可以貼上<strong>課文、筆記、公式、重點文字</strong>，也可以上傳多張圖片。AI 會先辨認知識點、判斷題量與題目結構，再開始生成。',
      note:'正式洞天至少 10 題；原始教材不會直接顯示給其他玩家。', button:'了解題量與結構', target:'#dongtian-card .dt-create'
    };
    if (phase === 'amount') return {
      kicker:'第 4 步 · 題量與出題', title:'少／中／多，全部都是單選題',
      body:'<strong>少＝10 題</strong>、<strong>中＝15～20 題</strong>、<strong>多＝25～30 題</strong>。每題固定四選一、只有一個正解。生成時固定<strong>每 5 題一批</strong>，後一批會帶入前面全部題目，避免重複或近義重複。',
      note:'全部生成後仍會進行全題 AI 複核。', button:'建立私人教學洞天', target:'#dongtian-card .dt-amount-options'
    };
    if (phase === 'prepare') return {
      kicker:'第 5 步 · 私人範例', title:'建立「青雲入門洞天」',
      body:'現在系統會建立一座<strong>1 題、教學專用、不公開</strong>的範例洞天。它不呼叫 AI、不寫入 Firestore，也不會進入其他玩家的洞天遭遇池。',
      note:'這座範例不發正式靈石、修為或材料，只用來學完整操作。', button:busy?'正在準備…':'建立私人範例', target:'#dongtian-card .dt-library', busy
    };
    if (phase === 'play') return {
      kicker:'第 6 步 · 實際遊玩', title:'親自按「進入範例」',
      body:'「我的洞天」裡現在會看到標示<strong>教學專用 · 不公開</strong>的青雲入門洞天。請自己按「進入範例」，教學不會替你瞬移。',
      note:'請完成這 1 題、閱讀解析，並按「前往下一境」查看結算。', button:'請按「進入範例」', target:'#dongtian-card [data-dt-tutorial-play]', locked:true
    };
    if (phase === 'delete') return {
      kicker:'第 7 步 · 管理與刪除', title:'最後親自刪除教學洞天',
      body:'你已完成 1 題體驗。現在回到「我的洞天」，請按教學洞天右側的<strong>「刪除範例」</strong>。正式洞天的刪除按鈕也在同一區域。',
      note:'正式洞天刪除後會移除公開洞天與相關遊玩／回報資料；這個私人範例只會清除本機教學資料。', button:'請按「刪除範例」', target:'#dongtian-card [data-dt-tutorial-delete]', locked:true
    };
    return {
      kicker:'完成 · 洞天已掌握', title:'你已完成洞天實作教學',
      body:'你已實際完成：<strong>找到入口 → 看懂建立方式 → 選題量 → 建立私人範例 → 完成 1 題 → 返回名冊 → 刪除範例</strong>。正式洞天首次完整通關還會依題數給靈石，並依答對題數給修為。',
      note:'正式洞天修為：每答對 5 題 +1；至少答對 1 題保底 +1，而且只在該洞天首次完整通關時發放。',
      button:'完成教學'
    };
  }

  function progressPercent() {
    const order=['intro','settings','card','create','amount','prepare','play','delete','done'];
    return Math.round((Math.max(0,order.indexOf(phase))/(order.length-1))*100);
  }

  function ensureLayer() {
    ensureStyle();
    let layer=document.getElementById(LAYER_ID);
    if(!layer){
      layer=document.createElement('div');
      layer.id=LAYER_ID;
      layer.innerHTML='<div class="qfd-spot"></div><section class="qfd-card"></section>';
      document.body.appendChild(layer);
    }
    return layer;
  }

  function updateSpotlight() {
    if(!active)return;
    const info=phaseInfo();
    const spot=document.querySelector('#'+LAYER_ID+' .qfd-spot');
    if(!spot)return;
    const el=info.target?target(info.target):null;
    if(!el||!visible(el)){spot.style.display='none';return;}
    const r=el.getBoundingClientRect(),p=8;
    spot.style.display='block';
    spot.style.left=Math.max(6,r.left-p)+'px';
    spot.style.top=Math.max(6,r.top-p)+'px';
    spot.style.width=Math.min(innerWidth-12,r.width+p*2)+'px';
    spot.style.height=Math.min(innerHeight-12,r.height+p*2)+'px';
  }

  function render() {
    if(!active)return;
    const info=phaseInfo();
    const layer=ensureLayer();
    const card=layer.querySelector('.qfd-card');
    card.innerHTML=`<div class="qfd-kicker">${info.kicker}</div><h3>${info.title}</h3><p>${info.body}</p><div class="qfd-note">${info.note||''}</div><div class="qfd-progress"><i style="width:${progressPercent()}%"></i></div><div class="qfd-actions"><button class="qfd-later" type="button">稍後再教</button><button class="qfd-next" type="button" ${info.locked||info.busy?'disabled':''}>${info.button}</button></div>`;
    card.querySelector('.qfd-later').onclick=snooze;
    card.querySelector('.qfd-next').onclick=next;
    if(info.target)setTimeout(()=>{target(info.target)?.scrollIntoView?.({behavior:'smooth',block:'center'});setTimeout(updateSpotlight,150);},80);
    else updateSpotlight();
  }

  async function persistProgress(patch) {
    const data=userData(),user=getAuth(getApp()).currentUser;
    if(!data||!user)return;
    const next={version:VERSION,...(data[FIELD]||{}),...patch,updatedAt:Date.now()};
    data[FIELD]=next;
    try{await updateDoc(doc(getFirestore(getApp()),'users',user.uid),{[FIELD]:next});}
    catch(error){console.warn('[Qi-five Dongtian tutorial] progress persistence failed:',error);}
  }

  function cleanupDemo() {
    try{window.deleteNewbieDongtianDemo?.({silent:true});}catch(_){}
  }

  function snooze() {
    cleanupDemo();
    active=false;
    snoozeUntil=Date.now()+5*60*1000;
    document.getElementById(LAYER_ID)?.remove();
    if(resizeHandler)window.removeEventListener('resize',resizeHandler);
    resizeHandler=null;
  }

  async function next() {
    if(busy)return;
    if(phase==='intro')phase='settings';
    else if(phase==='create')phase='amount';
    else if(phase==='amount')phase='prepare';
    else if(phase==='prepare'){
      busy=true;render();
      try{
        const demo=window.prepareNewbieDongtianDemo?.();
        if(!demo)throw new Error('洞天私人範例尚未就緒');
        await persistProgress({started:true});
        phase='play';
      }catch(error){
        console.error('[Qi-five Dongtian tutorial] prepare demo',error);
      }finally{busy=false;}
    }else if(phase==='done'){await finish();return;}
    render();
  }

  async function finish() {
    await persistProgress({completed:true,completedAt:Date.now(),played:true,deleted:true});
    cleanupDemo();
    active=false;
    document.getElementById(LAYER_ID)?.remove();
    if(resizeHandler)window.removeEventListener('resize',resizeHandler);
    resizeHandler=null;
  }

  function handleClick(event) {
    if(!active)return;
    if(phase==='settings'&&event.target.closest?.('[data-target="page-settings"]')){
      phase='card';setTimeout(render,120);return;
    }
    if(phase==='card'&&event.target.closest?.('#dongtian-card .dongfu-collapse-head')){
      setTimeout(()=>{
        if(!document.getElementById('dongtian-body')?.hidden){phase='create';render();}
      },120);
    }
  }

  function onDemoStarted() {
    if(!active||phase!=='play')return;
    document.getElementById(LAYER_ID)?.remove();
  }

  function onDemoCompleted() {
    if(!active)return;
    demoCompleted=true;
    persistProgress({played:true,playedAt:Date.now()});
  }

  function onDemoReturned() {
    if(!active)return;
    if(!demoCompleted){
      phase='play';setTimeout(render,160);return;
    }
    phase='delete';
    setTimeout(render,180);
  }

  async function onDemoDeleted() {
    if(!active||phase!=='delete')return;
    await persistProgress({played:true,deleted:true,deletedAt:Date.now(),completed:true,completedAt:Date.now()});
    phase='done';
    setTimeout(render,120);
  }

  function blocking() {
    return !!document.querySelector('#xiuxian-story-layer,#newbie-tutorial-layer,#golden-core-tutorial-layer,#progression-v2-modal,.training-v3-modal-backdrop,#realm-breakthrough-feedback,#dongtian-overlay,#five-immortal-challenge');
  }

  function start() {
    if(active||score()<SCORE_REQUIRED||marker()?.completed)return;
    cleanupDemo();
    active=true;
    demoCompleted=false;
    phase='intro';
    resizeHandler ||= ()=>updateSpotlight();
    window.addEventListener('resize',resizeHandler);
    render();
  }

  function maybeAutoStart() {
    if(active||Date.now()<snoozeUntil||score()<SCORE_REQUIRED||marker()?.completed||blocking())return;
    setTimeout(()=>{
      if(!active&&Date.now()>=snoozeUntil&&score()>=SCORE_REQUIRED&&!marker()?.completed&&!blocking())start();
    },550);
  }

  window.startQiFiveDongtianTutorial=start;

  function boot() {
    ensureStyle();
    document.addEventListener('click',handleClick,true);
    window.addEventListener('newbie:dongtian-demo-started',onDemoStarted);
    window.addEventListener('newbie:dongtian-demo-completed',onDemoCompleted);
    window.addEventListener('newbie:dongtian-demo-returned',onDemoReturned);
    window.addEventListener('newbie:dongtian-demo-deleted',onDemoDeleted);
    window.addEventListener('xiuxian:stats-updated',maybeAutoStart);
    window.addEventListener('xiuxian:user-ready',maybeAutoStart);
    setInterval(()=>{maybeAutoStart();if(active)updateSpotlight();},900);
    setTimeout(maybeAutoStart,1300);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
