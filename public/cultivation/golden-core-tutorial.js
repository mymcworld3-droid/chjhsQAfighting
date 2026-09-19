import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// 金丹教學：只有真正踏入金丹期後才第一次出現。
(function () {
  'use strict';

  const FIELD = 'goldenCoreTutorialV1';
  const VERSION = 1;
  let active = false;
  let index = 0;
  let replayOnly = false;
  let startedByStory = false;
  let resizeHandler = null;

  const steps = [
    {
      target: '#nav-training', title: '金丹期已開啟', kicker: '金丹教學 · 1/5',
      body: '踏入金丹期後，修煉頁會從原本只有背包，擴充為「金丹／背包／狀態」三個分頁。',
      note: '這套教學只會在踏入金丹期後出現。'
    },
    {
      target: '#training-core-orb', title: '查看你的本命金丹', kicker: '金丹教學 · 2/5',
      body: '金丹不是外來丹藥，而是踏入金丹期後在自身靈田／丹田中凝聚出的本命金丹，而且永遠只有一顆。點擊中央丹體可查看丹性、品質、特性效果與神通。',
      note: '品質越高，丹紋、金光與特效也越華麗。'
    },
    {
      target: '#core-odds-info', title: '查看品質機率', kicker: '金丹教學 · 3/5',
      body: '右側「！」可以查看各品質的出現機率。品數越小代表品質越高，例如一品優於九品。',
      note: '洗髓前可以先了解各品質的稀有程度。'
    },
    {
      target: '#wash-golden-core', title: '洗髓重塑金丹', kicker: '金丹教學 · 4/5',
      body: '洗髓不是換一顆外來丹藥，而是消耗 100 靈石重新洗鍊靈田中的本命金丹，重塑其丹性與品級。新丹相先作候選，原本調御中的丹相會繼續生效，直到你確認切換。',
      note: '洗髓後的新丹相需要主動「調御此丹相」才會正式生效。'
    },
    {
      target: '#training-status-tab', title: '查看金丹與戰鬥數值', kicker: '金丹教學 · 5/5',
      body: '「狀態」分頁會顯示目前正在調御的本命金丹，以及玩家目前的攻擊力與生命值。之後其他戰鬥屬性也可以從這裡逐步擴充。',
      note: '完成後就可以自由研究不同丹性與丹相的調御方式。'
    }
  ];

  function ensureStyle() {
    if (document.getElementById('golden-core-tutorial-style')) return;
    const style = document.createElement('style');
    style.id = 'golden-core-tutorial-style';
    style.textContent = `
      #golden-core-tutorial-layer{position:fixed;inset:0;z-index:7300;pointer-events:none}.golden-core-tutorial-dim{position:absolute;inset:0;background:rgba(0,0,0,.76);backdrop-filter:blur(2px);pointer-events:auto}.golden-core-tutorial-spotlight{position:fixed;z-index:1;border:2px solid rgba(244,204,104,.98);border-radius:20px;box-shadow:0 0 0 9999px rgba(0,0,0,.78),0 0 10px rgba(255,225,130,.5),0 0 42px rgba(216,177,93,.4);pointer-events:none;transition:all .25s ease}.golden-core-tutorial-card{position:fixed;z-index:3;left:50%;bottom:18px;transform:translateX(-50%);width:min(calc(100vw - 28px),520px);padding:20px;border-radius:26px;border:1px solid rgba(231,192,92,.5);background:radial-gradient(circle at 50% 0,rgba(216,177,93,.11),transparent 42%),linear-gradient(145deg,rgba(25,20,10,.99),rgba(7,7,7,.995));box-shadow:0 32px 95px rgba(0,0,0,.72),0 0 40px rgba(216,177,93,.1);pointer-events:auto}.golden-core-tutorial-kicker{color:#b79549;font-size:8px;font-weight:900;letter-spacing:.17em}.golden-core-tutorial-card h3{margin:5px 0 8px;color:#fff0c8;font-size:21px;font-weight:900}.golden-core-tutorial-card p{margin:0;color:#b9aa8d;font-size:12px;line-height:1.75}.golden-core-tutorial-card strong{color:#e9c86c}.golden-core-tutorial-note{margin-top:9px!important;color:#857860!important;font-size:10px!important}.golden-core-tutorial-actions{display:grid;grid-template-columns:auto 1fr auto;gap:8px;margin-top:15px}.golden-core-tutorial-actions button{min-height:40px;border-radius:13px;padding:0 13px;font-size:10px;font-weight:900}.golden-core-tutorial-skip,.golden-core-tutorial-prev{color:#9d9179;border:1px solid rgba(216,177,93,.15);background:#0c0c0c}.golden-core-tutorial-next{color:#fff0c7;border:1px solid #d8b15d;background:linear-gradient(135deg,#a87827,#5e3b0f)}@media(max-width:520px){.golden-core-tutorial-card{bottom:12px;padding:17px}.golden-core-tutorial-actions{grid-template-columns:1fr 1fr}.golden-core-tutorial-skip{grid-column:1/-1;grid-row:2}}
    `;
    document.head.appendChild(style);
  }

  function userData(){ return window.getCurrentUserData?.() || null; }
  function marker(){ return userData()?.[FIELD] || null; }
  function unlocked(){ return typeof window.isGoldenCoreUnlocked === 'function' && window.isGoldenCoreUnlocked(); }
  function visible(el){ if(!el)return false; const s=getComputedStyle(el); return s.display!=='none'&&s.visibility!=='hidden'&&el.getClientRects().length>0; }
  function findTarget(selector){ const all=Array.from(document.querySelectorAll(selector)); return all.find(visible)||all[0]||null; }

  function ensureCoreTabOpen(){
    window.switchToPage?.('page-training');
    const coreTab=document.querySelector('[data-training-tab="core"]');
    if(coreTab && !coreTab.classList.contains('active')) coreTab.click();
  }

  function updateSpotlight(){
    const layer=document.getElementById('golden-core-tutorial-layer'); const spot=layer?.querySelector('.golden-core-tutorial-spotlight'); const dim=layer?.querySelector('.golden-core-tutorial-dim');
    if(!layer||!spot||!dim||!active)return; const el=findTarget(steps[index].target);
    if(!el||!visible(el)){spot.style.display='none';dim.style.display='block';return;}
    const r=el.getBoundingClientRect(),p=8; spot.style.display='block';dim.style.display='none';spot.style.left=`${Math.max(6,r.left-p)}px`;spot.style.top=`${Math.max(6,r.top-p)}px`;spot.style.width=`${Math.min(innerWidth-12,r.width+p*2)}px`;spot.style.height=`${Math.min(innerHeight-12,r.height+p*2)}px`;
  }

  function render(){
    if(!active)return; ensureCoreTabOpen(); const step=steps[index];
    let layer=document.getElementById('golden-core-tutorial-layer');
    if(!layer){layer=document.createElement('div');layer.id='golden-core-tutorial-layer';layer.innerHTML='<div class="golden-core-tutorial-dim"></div><div class="golden-core-tutorial-spotlight"></div><section class="golden-core-tutorial-card"></section>';document.body.appendChild(layer);}
    const card=layer.querySelector('.golden-core-tutorial-card');
    card.innerHTML=`<div class="golden-core-tutorial-kicker">${step.kicker}</div><h3>${step.title}</h3><p>${step.body}</p><p class="golden-core-tutorial-note">${step.note}</p><div class="golden-core-tutorial-actions"><button class="golden-core-tutorial-skip">跳過</button><button class="golden-core-tutorial-prev" ${index===0?'disabled':''}>上一步</button><button class="golden-core-tutorial-next">${index===steps.length-1?'完成':'下一步'}</button></div>`;
    card.querySelector('.golden-core-tutorial-skip').onclick=()=>finish(true); card.querySelector('.golden-core-tutorial-prev').onclick=()=>{if(index>0){index--;render();}}; card.querySelector('.golden-core-tutorial-next').onclick=()=>{if(index===steps.length-1)finish(false);else{index++;render();}};
    setTimeout(()=>{findTarget(step.target)?.scrollIntoView?.({behavior:'smooth',block:'center'});setTimeout(updateSpotlight,180);},160);
  }

  async function persistFinished(skipped){
    const data=userData(),user=getAuth(getApp()).currentUser;if(!data||!user)return;
    const value={version:VERSION,completed:true,skipped:!!skipped,completedAt:Date.now()};data[FIELD]=value;
    try{await updateDoc(doc(getFirestore(getApp()),'users',user.uid),{[FIELD]:value});}catch(error){console.warn('Golden Core tutorial persistence failed:',error);}
  }

  function finish(skipped) {
    if (!active) return;
    active = false;
    document.getElementById('golden-core-tutorial-layer')?.remove();
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
    if (!replayOnly) persistFinished(skipped);
    if (startedByStory) {
      window.dispatchEvent(new CustomEvent('xiuxian:story-tutorial-finished', {
        detail: { kind: 'golden-core', replay: replayOnly, skipped: !!skipped }
      }));
    }
    startedByStory = false;
  }

  function blocking() {
    return !!document.querySelector('#xiuxian-story-layer,#battle-tutorial-layer,#newbie-tutorial-layer,#progression-v2-modal,.training-v3-modal-backdrop,#realm-breakthrough-feedback');
  }

  function start(options = {}) {
    const adminPreview = options.adminPreview === true && userData()?.isAdmin === true;
    if (options.adminPreview && !adminPreview) return false;
    if (active || (!unlocked() && !adminPreview) || (!options.story && blocking())) return false;
    replayOnly = options.replay === true || adminPreview || !!marker()?.completed;
    startedByStory = options.story === true;
    ensureStyle();
    active = true;
    index = 0;
    resizeHandler ||= () => updateSpotlight();
    window.addEventListener('resize', resizeHandler);
    render();
    return true;
  }

  window.startGoldenCoreTutorial = (options = {}) => start(options);
  function boot() {
    ensureStyle();
    // 金丹教學跟隨第七章；解鎖事件不再在劇情播放中獨立搶畫面。
    setInterval(() => { if (active) updateSpotlight(); }, 650);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
