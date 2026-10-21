import './daily-meditation-rules.js';
import './daily-meditation-rewards.js';
import './nascent-growth.js';
import { getMainUser, authenticatedMainFetch } from './data/project-repository.js';

(function () {
  'use strict';
  const Rules = globalThis.QADailyMeditationRules;
  const Growth = globalThis.QANascentGrowth;
  const node = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => getMainUser()?.uid || '';
  const userData = () => window.getCurrentUserData?.();
  const today = () => Rules.meditationDateKey();
  const STATUS_CACHE_MS=60000;
  let account='', state=null, session=null, busy=false, generation=0, statusSequence=0, clock=null, lastStatusAt=0, statusRequest=null;
  function reconcile() {
    const id=uid();
    if(id!==account){globalThis.QAMeditationRewardFeedback?.clear();pauseClock();account=id;state=null;session=null;clock=null;busy=false;lastStatusAt=0;statusRequest=null;generation++;statusSequence++;node('daily-meditation-overlay')?.remove();}
    return id;
  }
  function notify(message) {const el=node('dm-status');if(el)el.textContent=message;else console.info('[閉關]',message);}
  function setContent(html) {const el=node('dm-content');if(el){el.innerHTML=html;el.closest('.dm-body')?.scrollTo?.({top:0});}const status=node('dm-status');if(status)status.textContent='';}
  function summary(items) {return '<div class="dm-summary">'+items.map(([label,value,tone='gold'])=>'<div class="dm-stat dm-tone-'+esc(tone)+'"><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></div>').join('')+'</div>';}
  function duration(ms) {if(typeof ms!=='number')return '—';const seconds=Math.max(0,ms)/1000;return seconds<60?seconds.toFixed(1)+' 秒':Math.floor(seconds/60)+' 分 '+(seconds%60).toFixed(1)+' 秒';}
  function clockKey() {return clock?'meditation-time:'+clock.uid+':'+clock.id:'';}
  function pauseClock() {
    if(!clock)return;
    if(clock.started!==null){clock.total+=Math.max(0,performance.now()-clock.started);clock.started=null;}
    try{localStorage.setItem(clockKey(),String(Math.floor(clock.total)));}catch(_){}
  }
  function resumeClock() {
    if(!clock||clock.uid!==uid()||!node('daily-meditation-overlay')||session?.questionAnswered||document.hidden||navigator.onLine===false)return;
    if(clock.started===null)clock.started=performance.now();
  }
  function startClock(question) {
    pauseClock();
    if(clock?.id!==question.id || clock.uid!==uid()){
      clock={uid:uid(),id:question.id,total:0,started:null};
      try{clock.total=Math.max(0,Number(localStorage.getItem(clockKey()))||0);}catch(_){}
    }
    resumeClock();
  }
  async function request(action,body={}) {
    const id=uid();if(!id)throw new Error('請先登入再閉關。');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await authenticatedMainFetch('/api/meditation/'+action,{method:'POST',body:JSON.stringify(body),signal:controller.signal});
      const payload=await response.json().catch(()=>({}));
      if(uid()!==id)throw new Error('帳號已切換，請重新開啟閉關。');
      if(!response.ok||payload.ok!==true)throw new Error(payload.error||'閉關同步暫時未完成，請重新同步。');
      return payload;
    }catch(error){if(error.name==='AbortError')throw new Error('閉關同步逾時，可重試原操作。');throw error;}
    finally{clearTimeout(timer);}
  }
  function applyEconomy(value) {
    const player=userData();if(!value||!player||uid()!==account)return;
    player.stats ||= {};player.stats.gold=value.gold;player.stats.totalScore=value.score;
    player.soulboundDrawTickets=value.drawTickets;
    if(value.growthState)Growth.apply(player,value.growthState);
    if(value.raidTickets){player.raidTickets=value.raidTickets;window.dispatchEvent(new CustomEvent('xiuxian:raid-tickets-updated',{detail:{uid:account,ticketState:value.raidTickets}}));}
    window.updateUIStats?.();window.refreshCultivationRealmUI?.();
    window.dispatchEvent(new CustomEvent('xiuxian:stats-updated',{detail:{source:'daily-meditation'}}));
    window.dispatchEvent(new CustomEvent('xiuxian:soulbound-tickets-updated'));
  }
  function panelState() {
    const id=uid(), player=userData();
    const record=state?.date===today()?state.record:player?.dailyMeditation || {};
    const done=record?.lastDate===today();
    return {done,streak:Math.max(0,Number(record?.streak)||0),totalDays:Math.max(0,Number(record?.totalDays)||0),
      claimable:!!id && state?.date===today() && !!state.claimable};
  }
  function syncPanel() {
    const el=node('xiuxian-meditate');if(!el)return;
    const current=panelState(),player=userData(),id=uid();
    const ready=!!id&&!!player?.stats&&(!player.uid||player.uid===id);
    const pending=ready&&(!current.done||current.claimable),dot=node('meditation-pending-dot');
    if(dot)dot.hidden=!pending;
    el.setAttribute('aria-label',current.claimable?'閉關，有共修獎勵可領':current.done?'查看今日閉關':'閉關，今日尚未完成');
    (el.querySelector('.sect-action-label')||el).textContent=current.claimable?'領取共修':current.done?'查看閉關':'閉關';
    el.disabled=false;el.style.opacity='1';
    const label=node('xiuxian-meditation-streak');if(label)label.textContent='連續閉關 '+current.streak+' 日 · 累計 '+current.totalDays+' 日';
  }
  async function refresh({render=false,force=false}={}) {
    const id=reconcile();if(!id)return;
    if(!force&&state?.date===today()&&Date.now()-lastStatusAt<STATUS_CACHE_MS)return;
    // Startup and foreground events can arrive together. Reuse one request;
    // mutations advance statusSequence so older replies cannot undo a claim.
    let pending=statusRequest;
    if(!pending||pending.uid!==id||pending.sequence!==statusSequence){
      pending={uid:id,sequence:++statusSequence,promise:request('status')};
      statusRequest=pending;
    }
    let result;
    try{result=await pending.promise;}
    finally{if(statusRequest===pending)statusRequest=null;}
    if(uid()!==id||pending.sequence!==statusSequence)return;
    state=result;lastStatusAt=Date.now();
    if(userData())userData().dailyMeditation=result.record;
    syncPanel();
    if(render&&node('daily-meditation-overlay')){
      session=result.session;
      if(session&&!result.completed)renderQuestion();else renderDashboard();
    }else if(!busy&&node('daily-meditation-overlay')&&!session)renderDashboard();
  }
  async function task(job) {
    if(busy)return;const id=reconcile();if(!id)return;
    busy=true;const version=++generation;statusSequence++;
    node('daily-meditation-overlay')?.querySelectorAll('button').forEach(button=>button.disabled=true);
    let failed=false;
    try{await job();}catch(error){failed=true;if(uid()===id&&generation===version)notify(error.message||'閉關同步未完成，請重試。');}
    finally{if(uid()===id&&generation===version){busy=false;node('dm-close')?.removeAttribute('disabled');node('dm-refresh')?.removeAttribute('disabled');
      if(!session)renderDashboard(false);
      else if(failed&&node('daily-meditation-overlay')){const message=node('dm-status')?.textContent;renderQuestion();notify(message);}
      syncPanel();}}
  }
  function ensureStyle() {
    if (node('daily-meditation-style')) return;
    const el = document.createElement('style');
    el.id = 'daily-meditation-style';
    el.textContent = [
      '.dm-overlay,.dm-overlay *{box-sizing:border-box}',
      '.dm-overlay{position:fixed;inset:0;z-index:12000;display:grid;place-items:center;padding:0;background:rgba(3,4,7,.94);backdrop-filter:blur(15px);color:#f2e9d7}',
      '.dm-card{position:relative;display:flex;flex-direction:column;width:100%;height:100dvh;max-height:100dvh;overflow:hidden;border:1px solid #608a844d;border-radius:0;background:radial-gradient(ellipse at 5% 0,#26676135,transparent 55%),radial-gradient(ellipse at 100% 70%,#63457d28,transparent 50%),linear-gradient(155deg,#101d26,#11151d 65%,#1c1726);box-shadow:0 25px 85px #000b}',
      '.dm-top{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 20px;border-bottom:1px solid #8ac4bb30;background:linear-gradient(110deg,#17353299,#191b2c80)}',
      '.dm-heading{font:700 20px "Noto Serif TC",serif;letter-spacing:.09em;color:#f2d89b}.dm-eyebrow{font-size:10px;letter-spacing:.18em;color:#bbaa8b}',
      '.dm-close{flex:0 0 auto;border:1px solid #cab48255;border-radius:100px;background:#191910;color:#e6d6b5;width:35px;height:35px;font-size:22px;cursor:pointer}',
      '.dm-body{width:min(100%,880px);margin:0 auto;min-height:0;flex:1;overflow-y:auto;overscroll-behavior:contain;padding:20px;display:grid;align-content:start;gap:14px}',
      '.dm-scene{position:relative;min-height:160px;display:grid;place-items:center;overflow:hidden;border-radius:16px;background:radial-gradient(circle at 50% 50%,#c49a4630,transparent 40%),linear-gradient(135deg,#24271c,#090d13);border:1px solid #c9a76835}',
      '.dm-circle{width:116px;height:116px;border:1px solid #d1ad634a;border-radius:50%;display:grid;place-items:center;box-shadow:0 0 45px #c49a4636,inset 0 0 32px #d7ac3925;animation:dm-pulse 4s ease-in-out infinite}',
      '.dm-circle:before{content:"";position:absolute;width:138px;height:138px;border:1px dashed #c8a45c45;border-radius:50%;animation:dm-spin 24s linear infinite}',
      '.dm-monk{font:700 50px "Noto Serif TC",serif;color:#e9ca81;text-shadow:0 0 22px #ebc97960}',
      '.dm-scene-label{position:absolute;bottom:12px;font:12px "Noto Serif TC",serif;color:#d6c49d;letter-spacing:.18em}',
      '.dm-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.dm-summary>div{--dm-stat-color:#edce8d;--dm-stat-tint:#bb8c3818;--dm-stat-line:#bca16a55;padding:14px 8px;text-align:center;border-radius:12px;background:linear-gradient(150deg,var(--dm-stat-tint),#0b14215c);border:1px solid var(--dm-stat-line);box-shadow:inset 0 2px var(--dm-stat-tint)}',
      '.dm-summary>.dm-tone-jade{--dm-stat-color:#96decd;--dm-stat-tint:#368f7b26;--dm-stat-line:#6cb7a455}.dm-summary>.dm-tone-blue{--dm-stat-color:#a8cef4;--dm-stat-tint:#457ba226;--dm-stat-line:#729ec455}.dm-summary>.dm-tone-violet{--dm-stat-color:#d5b8f1;--dm-stat-tint:#8d62aa26;--dm-stat-line:#ae8dc555}',
      '.dm-summary small{display:block;color:#b5bdc8;font-size:10px}.dm-summary strong{display:block;margin-top:4px;font-size:16px;color:var(--dm-stat-color)}',
      '.dm-note,.dm-status{font-size:12px;line-height:1.7;color:#beb7a7;white-space:pre-wrap}.dm-status:empty{display:none}',
      '.dm-action{min-height:47px;padding:10px 18px;border-radius:12px;border:1px solid #d7b66e8a;background:linear-gradient(125deg,#8a642f,#4c381c);font-size:14px;font-weight:800;color:#fff1d0;cursor:pointer}',
      '.dm-action:disabled{opacity:.5;cursor:wait}.dm-action-secondary{background:#ffffff0a;border-color:#e5c77c3d}',
      '.dm-start{position:relative;isolation:isolate;display:flex;align-items:center;justify-content:space-between;gap:18px;width:100%;min-height:84px;margin:0 0 22px;padding:18px 24px;overflow:hidden;border:1px solid #ffe0a0;border-radius:16px;background:linear-gradient(115deg,#f2cd7d,#dca64e 55%,#ba7b2d);color:#38220c;box-shadow:0 8px 28px #b97c283d,inset 0 1px 0 #fff2c5;transition:transform .18s ease,box-shadow .18s ease,filter .18s ease}.dm-start:before{content:"";position:absolute;z-index:-1;inset:5px;border:1px solid #fff0c54d;border-radius:11px;pointer-events:none}.dm-start-symbol{display:grid;place-items:center;flex:0 0 46px;width:46px;height:46px;border:1px solid #7046194d;border-radius:50%;background:#fff0be40;font-size:30px;line-height:1}.dm-start-label{flex:1;text-align:left;font:900 24px "Noto Serif TC",serif;letter-spacing:.12em}.dm-start-arrow{flex:0 0 26px;width:26px;height:26px}.dm-start:not(:disabled):hover{filter:brightness(1.07);transform:translateY(-2px);box-shadow:0 10px 34px #c28a3459,inset 0 1px 0 #fff2c5}.dm-start:not(:disabled):active{transform:translateY(1px) scale(.99)}.dm-start:focus-visible{outline:3px solid #fff2cf;outline-offset:5px}.dm-start:disabled{opacity:.6}.dm-start:disabled .dm-start-symbol{animation:dm-spin 2s linear infinite}',
      '.dm-progress{height:5px;background:#23363d;border-radius:8px;overflow:hidden}.dm-progress span{display:block;height:100%;background:linear-gradient(90deg,#64b7a7,#e0c482);transition:width .3s}',
      '.dm-question{font-size:17px;font-weight:700;line-height:1.8;color:#f5ead5;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.dm-options{display:grid;gap:9px}.dm-option{display:flex;align-items:flex-start;text-align:left;gap:10px;min-height:47px;padding:12px;border:1px solid #c4a7763b;border-radius:12px;background:#ffffff08;color:#e9e4db;line-height:1.65;cursor:pointer;overflow-wrap:anywhere;white-space:pre-wrap}',
      '.dm-option b{flex:0 0 25px;color:#e6c477}.dm-option:disabled{cursor:default;opacity:.8}.dm-option.dm-correct{border-color:#80bb8e;background:#32583a49}.dm-option.dm-wrong{border-color:#c58181;background:#6c303049}',
      '.dm-result{font:700 27px "Noto Serif TC",serif;color:#e5c77c;text-align:center;letter-spacing:.1em}',
      '.dm-star-heading{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:18px 0 16px}.dm-star-heading h3{margin:0}.dm-star-total{font-size:14px;color:#a5e0cf}.dm-star-total strong{font-size:23px}.dm-star-hint{margin:0 0 16px;padding:10px 12px;border-left:2px solid #71b9a9;border-radius:0 8px 8px 0;background:#387b7014;font-size:12px;color:#c4d3d1;line-height:1.7}',
      // Reserve half a milestone column on the right; checkpoint centers then match 3/15 through 15/15 of the rail.
      '.dm-star-journey{position:relative;margin-right:calc(100% / 11);margin-bottom:20px}.dm-star-track{position:absolute;top:16px;left:0;right:0;height:12px;border:1px solid #75b7a840;border-radius:20px;background:#172d34;overflow:hidden}.dm-star-fill{height:100%;border-radius:inherit;background:linear-gradient(90deg,#3c8a7d,#83cbb5 65%,#e5c06b);box-shadow:0 0 14px #64b9a533;transition:width .4s ease}.dm-star-track:after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(100% / 15 - 1px),#101a2380 calc(100% / 15 - 1px),#101a2380 calc(100% / 15))}',
      '.dm-milestones{position:relative;display:grid;grid-template-columns:repeat(5,minmax(0,1fr))}.dm-milestone{transform:translateX(50%);min-width:0;display:flex;flex-direction:column;align-items:center;text-align:center;gap:7px;padding:0 3px}.dm-checkpoint{position:relative;flex:0 0 auto;display:grid;place-items:center;width:44px;height:44px;padding:0;border:2px solid #665b41;border-radius:50%;background:#27291f;color:#857a60;font-size:21px;cursor:pointer}.dm-checkpoint:disabled{cursor:default}.dm-milestone.is-reached .dm-checkpoint{border-color:#c9a75b;color:#efcf83;background:#46391e}.dm-milestone.is-claimable .dm-checkpoint{border-color:#ffdc8c;background:linear-gradient(140deg,#b1843b,#705022);color:#fff1c6;box-shadow:0 0 0 4px #e6bb5320,0 0 20px #e6bb5333}.dm-checkpoint:focus-visible{outline:3px solid #fff1c6;outline-offset:4px}.dm-checkpoint:not(:disabled):hover{filter:brightness(1.2)}.dm-milestone.is-claimed .dm-checkpoint{background:#303a29;border-color:#93a77a;color:#c6d6a8}.dm-milestone strong{font-size:13px;color:#c0b598}.dm-milestone.is-reached strong{color:#eacf8a}.dm-milestone p{margin:0;font-size:12px;line-height:1.65;color:#b4ae9e;overflow-wrap:anywhere}.dm-milestone small{font-size:11px;color:#918c7e}.dm-milestone.is-claimable small{color:#f3d58e}.dm-milestone.is-claimed small{color:#b2c297}',
      '.dm-board{width:100%;border-collapse:collapse;font-size:13px}.dm-board td,.dm-board th{padding:11px 8px;text-align:left;border-bottom:1px solid #ffffff15}.dm-board th{color:#bbae91;font-weight:500}.dm-board tr.is-me{background:#dfc27f10}.dm-section-title{margin:18px 0 8px;font:700 18px Noto Serif TC,serif;color:#ead29c}.dm-body{width:min(100%,1020px)}.dm-top-actions{display:flex;gap:8px;align-items:center}.dm-top-actions .dm-action{min-height:35px;font-size:12px;padding:5px 11px}.dm-timing{font-size:11px;color:#999486}.dm-note strong{color:#eacf8a}.dm-claim-status{margin-top:10px}@media(max-width:600px){.dm-milestone p{font-size:11px}.dm-heading{font-size:17px}.dm-board td,.dm-board th{padding:10px 4px;font-size:12px}}@media(prefers-reduced-motion:reduce){.dm-star-fill{transition:none}}',
      '.dm-checkpoint{border-color:#4e6579;background:#1a2939;color:#8299ae}.dm-milestone.is-reached:not(.is-claimable):not(.is-claimed) .dm-checkpoint{border-color:#72b5aa;background:#21433f;color:#b1e9d8}.dm-milestone.is-claimed .dm-checkpoint{background:#23453c;border-color:#7ebba5;color:#c2eddb}.dm-milestone.is-claimed small{color:#9ed5be}.dm-milestone p{color:#c1c8d2}.dm-milestone small{color:#9aaabe}.dm-board thead{background:#1c2b3f80}.dm-board th{color:#a6bfd4}.dm-board tr.is-me{background:#397c6e22}.dm-board tbody tr:first-child td:first-child{color:#e9ca84}.dm-board tbody tr:nth-child(2) td:first-child{color:#97d7c6}.dm-board tbody tr:nth-child(3) td:first-child{color:#ccb1e6}',
      '@keyframes dm-pulse{50%{box-shadow:0 0 64px #c49a465c,inset 0 0 45px #d7ac3955;transform:scale(1.025)}}@keyframes dm-spin{to{transform:rotate(360deg)}}',
      '@media(max-width:500px){.dm-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.dm-top{padding:12px 15px}.dm-body{padding:13px}.dm-scene{min-height:125px}.dm-circle{width:88px;height:88px}.dm-circle:before{width:110px;height:110px}.dm-question{font-size:15px}.dm-summary strong{font-size:14px}.dm-start{min-height:78px;gap:12px;padding:16px 18px;margin-bottom:18px}.dm-start-label{font-size:22px;letter-spacing:.08em}.dm-start-symbol{flex-basis:40px;width:40px;height:40px;font-size:27px}}',
      '@media(prefers-reduced-motion:reduce){.dm-start{transition:none}.dm-start:disabled .dm-start-symbol{animation:none}}'
    ].join('\n');
    document.head.appendChild(el);
  }

  function close() {if(busy)return;pauseClock();node('daily-meditation-overlay')?.remove();}
  function ensureOverlay() {
    ensureStyle();if(node('daily-meditation-overlay'))return;
    const overlay=document.createElement('div');overlay.id='daily-meditation-overlay';overlay.className='dm-overlay';
    overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','閉關共修');
    overlay.innerHTML='<section class="dm-card"><header class="dm-top"><div><div class="dm-eyebrow">每日三題 · 同門共修</div><div class="dm-heading">聚星閉關</div></div><div class="dm-top-actions"><button class="dm-action dm-action-secondary" id="dm-refresh" type="button">重新同步</button><button type="button" class="dm-close" id="dm-close" aria-label="關閉">×</button></div></header><div class="dm-body"><div id="dm-content"></div><p id="dm-status" class="dm-status" role="status" aria-live="polite"></p></div></section>';
    document.body.appendChild(overlay);node('dm-close').onclick=close;
    node('dm-refresh').onclick=()=>void task(async()=>{pauseClock();await refresh({render:true,force:true});});
    overlay.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();close();return;}
      if(event.key!=='Tab')return;
      const controls=[...overlay.querySelectorAll('button:not(:disabled)')];
      const first=controls[0],last=controls.at(-1);if(!first)return;
      if(event.shiftKey&&document.activeElement===first||!event.shiftKey&&document.activeElement===last){event.preventDefault();(event.shiftKey?last:first).focus();}
    });
    node('dm-close').focus({preventScroll:true});
  }
  function rewardText(reward,compact=false) {
    const parts=[reward.gold+' 靈石'];
    if(reward.fragments)parts.push((compact?'碎精':'元嬰碎精')+' ×'+reward.fragments);
    if(reward.raidTickets)parts.push((compact?'團本券':'團本入場券')+' ×'+reward.raidTickets);
    if(reward.drawTickets)parts.push((compact?'抽獎券':'本命法器抽獎券')+' ×'+reward.drawTickets);
    return parts.map(esc).join('<br>');
  }
  function renderDashboard(clearStatus=true) {
    if(!state||!node('dm-content'))return;
    pauseClock();
    const savedStatus=node('dm-status')?.textContent;
    const result=state.record?.lastResult || {};
    let html=state.completed?'':'<button type="button" class="dm-action dm-start" id="dm-start" '+(busy?'disabled aria-busy="true"':'')+'><span class="dm-start-symbol" aria-hidden="true">✦</span><span class="dm-start-label">'+(busy?'正在入定…':state.session?'繼續今日閉關':'開始閉關')+'</span><svg class="dm-start-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7"/></svg></button>';
    html+=summary([['我的星星',state.personalStars+' / 3','gold'],['好友共修',state.stars+' / 15','jade'],['連續閉關',(state.record?.streak||0)+' 日','blue'],['本命抽獎券',(state.drawTickets||0)+' 張','violet']]);
    const nextMilestone=state.milestones.find(step=>step.stars>state.stars);
    html+='<div class="dm-star-heading"><h3 class="dm-section-title">同門聚星</h3><span class="dm-star-total">★ <strong>'+state.stars+'</strong> / 15</span></div>';
    html+='<p class="dm-star-hint">'+(!state.completed?'完成自己的三題後，即可點擊達標的星星領獎。':nextMilestone?'再集 '+(nextMilestone.stars-state.stars)+' 星，解鎖 '+nextMilestone.stars+' 星獎勵。':state.milestones.some(step=>step.claimable)?'共修進度已滿，點擊亮起的星星領取獎勵。':'今日共修獎勵已全數領取。')+'</p>';
    html+='<div class="dm-star-journey"><div class="dm-star-track" role="progressbar" aria-label="同門共修星數" aria-valuemin="0" aria-valuemax="15" aria-valuenow="'+state.stars+'" aria-valuetext="已集 '+state.stars+' 星，最多十五顆"><div class="dm-star-fill" style="width:'+(state.stars/15*100)+'%"></div></div>';
    html+='<div class="dm-milestones">'+state.milestones.map(step=>{
      const reached=state.stars>=step.stars;
      const status=step.claimed?'已領取':step.claimable?'點擊領取':reached?'待出關':'差 '+(step.stars-state.stars)+' 星';
      const label=step.stars+' 星，'+status+'，'+rewardText(step.reward).replace(/<br>/g,'、');
      return '<section class="dm-milestone'+(reached?' is-reached':'')+(step.claimed?' is-claimed':'')+(step.claimable?' is-claimable':'')+'"><button type="button" class="dm-checkpoint" data-dm-claim="'+step.stars+'" aria-label="'+label+'" title="'+label+'" '+(!step.claimable||busy?'disabled':'')+'><span aria-hidden="true">'+(step.claimed?'✓':'★')+'</span></button><strong>'+step.stars+' 星</strong><p>'+rewardText(step.reward,true)+'</p><small>'+status+'</small></section>';
    }).join('')+'</div></div>';
    html+='<p class="dm-note">自己與互為好友的同門，答對一題各得一星；達到節點即可領獎，每日最多十五星。好友稍後出關仍會增加進度。元嬰碎精與本命法器抽獎券可提前累積，金丹境開放抽取。團本券已滿時，該券折為額外靈石。</p>';
    if(state.completed){
      html+='<h3 class="dm-section-title">今日出關 · '+state.personalStars+' 星</h3>'+summary([['答對',state.personalStars+' / 3','jade'],['作答時間',duration(result.answerTimeMs),'blue'],['個人靈石','+'+(result.gold||0),'gold'],['個人元嬰碎精','+'+(result.fragments||0),'violet']]);
      html+='<h3 class="dm-section-title">好友今日成績</h3><p class="dm-timing">星數優先，同星依作答時間排序。各自複習的錯題不同，排行供交流參考。</p><table class="dm-board"><thead><tr><th>排名</th><th>同門</th><th>星數</th><th>作答時間</th></tr></thead><tbody>'+state.rankings.map(row=>'<tr'+(row.uid===uid()?' class="is-me"':'')+'><td>'+row.rank+'</td><td>'+esc(row.name)+(row.uid===uid()?'（你）':'')+'</td><td>'+row.stars+' / 3</td><td>'+esc(duration(row.answerTimeMs))+'</td></tr>').join('')+'</tbody></table>';
      html+='<p class="dm-note">僅列出今日已完成閉關的好友。每日 00:00（台灣時間）重置。</p><button type="button" class="dm-action dm-action-secondary" id="dm-done">返回宗門</button>';
    }
    setContent(html);if(!clearStatus&&savedStatus)notify(savedStatus);
    node('dm-start')?.addEventListener('click',()=>void start());node('dm-done')?.addEventListener('click',close);
    node('dm-content').querySelectorAll('[data-dm-claim]').forEach(button=>button.onclick=()=>void claim(Number(button.dataset.dmClaim)));
  }
  async function open() {
    if(!reconcile()){notify('請先登入再閉關。');return;}
    ensureOverlay();pauseClock();setContent('<p class="dm-note">正在同步今日共修與閉關紀錄…</p>');
    await task(()=>refresh({render:true,force:true}));
  }
  function typeset(callback) {
    const el=node('dm-content');
    try{window.MathJax?.typesetClear?.([el]);Promise.resolve(window.MathJax?.typesetPromise?.([el])).catch(()=>{}).finally(callback);}
    catch(_){callback();}
  }
  function renderQuestion() {
    if(!session||!node('dm-content'))return;
    pauseClock();const q=session.question;
    setContent('<div class="dm-eyebrow">'+esc(q.source)+' · '+(session.index+1)+' / 3 · 已得 '+session.correct+' 星</div><div class="dm-progress"><span style="width:'+Math.round(session.answered/3*100)+'%"></span></div><h3 class="dm-question" id="dm-question"></h3><div class="dm-options" id="dm-options"></div><div id="dm-feedback" class="dm-note"></div>');
    node('dm-question').textContent=q.q;
    q.opts.forEach((value,index)=>{const button=document.createElement('button');button.type='button';button.className='dm-option';
      const mark=document.createElement('b');mark.textContent=String.fromCharCode(65+index);const text=document.createElement('span');text.textContent=value;button.append(mark,text);
      button.disabled=session.questionAnswered;button.onclick=()=>void answer(index);node('dm-options').appendChild(button);
      if(session.questionAnswered&&index===session.feedback.correctIdx)button.classList.add('dm-correct');});
    if(session.questionAnswered){
      node('dm-feedback').textContent=(session.feedback.isCorrect?'參悟成功，獲得一顆星。':'本題未得星星。')+'\n'+session.feedback.exp;
      const next=document.createElement('button');next.type='button';next.className='dm-action';next.textContent=session.answered===3?'出關結算':'繼續參悟';
      next.onclick=()=>session.answered===3?void finish():void nextQuestion();node('dm-content').appendChild(next);
      typeset(()=>{});
    }else typeset(()=>{if(session?.question.id===q.id&&!session.questionAnswered)startClock(q);});
  }
  async function start() {await task(async()=>{renderDashboard();const result=await request('start');if(result.completed){await refresh({force:true});session=null;renderDashboard();}else{session=result.session;renderQuestion();}});}
  async function nextQuestion() {await task(async()=>{const result=await request('next');session=result.session;renderQuestion();});}
  async function answer(choice) {
    if(busy||!session||session.questionAnswered)return;
    pauseClock();const body={questionId:session.question.id,choice,activeMs:Math.floor(clock?.total||0)};
    await task(async()=>{
      try{const result=await request('answer',body);session=result.session;renderQuestion();
        void window.trackPlayerAnalytics?.('answer_completed',{mode:'meditation',eventId:'meditation_'+session.date+'_'+session.answered});
      }catch(error){
        notify(error.message);const retry=document.createElement('button');retry.type='button';retry.className='dm-action';retry.textContent='重試保存本題答案';
        retry.onclick=()=>void task(async()=>{const result=await request('answer',body);session=result.session;renderQuestion();});node('dm-content')?.appendChild(retry);
      }
    });
  }
  function rewardReceipt(reward, {receiptId,title,subtitle,stars,note}={}) {
    const owner=uid(),settings=userData()?.gameSettings;
    globalThis.QAMeditationRewardFeedback?.show({
      uid:owner,receiptId,reward,title,subtitle,note,
      kicker:stars?stars+' 星共修':'今日閉關',
      sound:settings?.soundEnabled!==false&&settings?.musicEnabled!==false,
      isCurrent:()=>uid()===owner,
      focusTarget:()=>node('dm-close'),
      target:()=>stars?node('dm-content')?.querySelector('[data-dm-claim="'+stars+'"]'):node('dm-content')?.querySelector('.dm-summary')
    });
  }
  async function finish() {await task(async()=>{
    const result=await request('finish');applyEconomy(result.economy);session=null;clock=null;
    // Show the committed reward even when refreshing the leaderboard is slow or offline.
    rewardReceipt(result.record?.lastResult,{receiptId:'personal:'+result.record?.lastDate,title:'今日閉關完成',subtitle:'連續 '+(result.record?.streak||1)+' 日 · 參悟 '+(result.record?.lastResult?.stars||0)+' / 3 星'});
    await refresh({force:true});renderDashboard();
  });}
  async function claim(stars) {await task(async()=>{
    const result=await request('claim',{stars,date:state.date});state=result;lastStatusAt=Date.now();applyEconomy(result.economy);renderDashboard();
    if(result.claimedNow){
      rewardReceipt(result.reward,{receiptId:'coop:'+result.date+':'+stars,stars,title:stars===15?'共修圓滿 · 獎勵入袋':'共修獎勵入袋',subtitle:'同門聚星 · '+stars+' 星達成',note:result.reward?.convertedRaidGold?'團本入場券已滿，已折為 '+result.reward.convertedRaidGold+' 靈石。':''});
    }
    notify(result.claimedNow?'已領取 '+stars+' 星共修獎勵。':'此節點今日已領取。');
  });}
  window.openDailyMeditation=open;window.getDailyMeditationPanelState=panelState;window.refreshDailyMeditationPanel=syncPanel;
  window.addEventListener('xiuxian:stats-updated',syncPanel);
  for(const name of ['xiuxian:user-data-ready','xiuxian:user-ready'])window.addEventListener(name,()=>{reconcile();syncPanel();if(!busy)void refresh().catch(()=>{});});
  function foreground(){
    if(document.hidden||navigator.onLine===false){pauseClock();return;}
    resumeClock();syncPanel();
    if(busy||session?.date===today()&&!state?.completed)return;
    const opened=!!node('daily-meditation-overlay');
    if(opened||state?.date!==today())void refresh().catch(()=>{});
    else poll();
  }
  document.addEventListener('visibilitychange',foreground);window.addEventListener('offline',pauseClock);window.addEventListener('online',foreground);window.addEventListener('pagehide',pauseClock);
  window.addEventListener('pageshow',foreground);
  function poll() {
    syncPanel();
    if(document.hidden||navigator.onLine===false||busy||!uid())return;
    if(session?.date===today()&&!state?.completed)return;
    const opened=!!node('daily-meditation-overlay');
    const waiting=panelState().done&&userData()?.friends?.length>0&&(!state||state.date!==today()||state.stars<15);
    // The badge is already on before personal completion. Stop background
    // friend reads once all fifteen stars have arrived.
    if(opened||waiting&&Date.now()-lastStatusAt>=300000)void refresh().catch(()=>{});
  }
  setInterval(poll,60000);
  reconcile();syncPanel();
})();
