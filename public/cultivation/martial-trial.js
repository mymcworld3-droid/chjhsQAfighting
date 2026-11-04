import { authenticatedMainFetch, getMainUser } from './data/project-repository.js';
// Single-player combat, using the server's saved build and the existing duel engine.
(function(){
 'use strict';
 let serial=0,owner='',state=null,busy=false,error='',pending=null,returnFocus=null;
 const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
 const count=n=>Math.max(0,Math.round(Number(n)||0));
 const alive=id=>id===serial&&owner===getMainUser()?.uid&&!!document.getElementById('martial-trial-modal');
 const unlocked=()=>Math.max(Number(window.getCurrentUserData?.()?.stats?.totalScore)||0,Number(window.getTrainingAccessScore?.())||0)>=28;
 function loadStyle(){if(document.getElementById('martial-trial-style'))return;const link=document.createElement('link');link.id='martial-trial-style';link.rel='stylesheet';link.href='styles/martial-trial.css?v=20261104-trial1';document.head.appendChild(link);}
 async function request(action,body){
  const response=await authenticatedMainFetch('/api/martial-trial'+(action?'/'+action:''),body?{method:'POST',body:JSON.stringify(body)}:{});
  const result=await response.json();if(!response.ok||!result.ok)throw Object.assign(new Error(result.error||'演武同步失敗'),{status:response.status});return result.state;
 }
 function fighter(p,enemy=false){
  const ratio=Math.min(100,Math.max(0,100*p.hp/Math.max(1,p.maxHp)));
  return `<article class="mt-fighter ${enemy?'mt-enemy':''}"><div class="mt-fighter-face">${!enemy&&p.portrait?`<img src="${escape(p.portrait)}" alt="">`:`<span aria-hidden="true">${enemy?'陣':'修'}</span>`}</div><div class="mt-fighter-name"><small>${enemy?'守陣傀儡':'出戰配裝'}</small><strong>${escape(p.name)}</strong></div><div class="mt-health" role="progressbar" aria-label="${escape(p.name)}生命" aria-valuemin="0" aria-valuemax="${count(p.maxHp)}" aria-valuenow="${count(p.hp)}"><i style="width:${ratio}%"></i></div><p class="mt-fighter-stats"><span>生命 ${count(p.hp)} / ${count(p.maxHp)}</span><b>攻擊 ${count(p.atk)}</b></p>${p.shield?`<small class="mt-shield">護盾 ${count(p.shield)}</small>`:''}${p.core?`<small class="mt-core">${escape(p.core)}</small>`:''}</article>`;
 }
 function render(){
  const root=document.getElementById('martial-trial-modal');if(!root)return;
  const active=state?.status==='active',won=['cleared','complete'].includes(state?.status),battle=state?.challenger&&['active','cleared','complete','defeated'].includes(state.status);
  const warning=error?`<div class="mt-error" role="alert">${escape(error)}</div>`:'';
  const best=count(state?.bestFloor),start=count(state?.checkpoint)||1;
  root.innerHTML=`<section class="mt-dialog" role="dialog" aria-modal="true" aria-labelledby="mt-title" aria-busy="${busy}"><header><div><small>以戰驗道</small><h2 id="mt-title" tabindex="-1">演武試煉</h2></div><button type="button" class="mt-close" data-mt-close aria-label="暫離演武">×</button></header><div class="mt-body">${warning}${!state?'<p class="mt-loading" role="status">正在同步演武紀錄…</p>':battle?`
   <div class="mt-round"><span>第 ${state.floor} / ${state.maxFloor} 層</span><b>回合 ${state.round} / ${state.maxRounds}</b><span>蓄力 ${state.charge} / 2</span></div>
   <div class="mt-arena ${state.lastTurn?'mt-resolved':''}">${fighter(state.challenger)}${fighter(state.defender,true)}</div>
   ${active?`<div class="mt-intent"><small>守衛下一步</small><strong>${escape(state.intent.name)}</strong><p>${escape(state.intent.hint.replaceAll('化身','守衛'))}</p></div>`:`<div class="mt-outcome ${won?'is-won':''}"><h3>${state.status==='complete'?'百層破陣':won?'守衛已擊破':'本層未通過'}</h3><p>${won?'你的金丹、元嬰與法器已完成這一戰。下一層將回滿生命再戰。':'調整配裝或改變攻守節奏，可由最近的五層起點重試。'}</p></div>`}
   ${state.lastTurn?`<details class="mt-record"><summary>本回合戰況</summary>${state.lastTurn.notes.map(n=>`<p>${escape(n)}</p>`).join('')}<ol>${state.lastTurn.logs.map(log=>`<li>${escape(log.actorUid===owner?'你':'守衛')} · ${escape(log.skill||log.message||log.type||'出手')}${log.damage?`　${count(log.damage)} 傷害`:''}${log.heal?`　回復 ${count(log.heal)}`:''}</li>`).join('')}</ol></details>`:''}`:`
   <div class="mt-lobby"><span class="mt-lobby-seal" aria-hidden="true">武</span><h3>讓你的配裝，打出一條路</h3><p>不需答題，直接以目前金丹、元嬰、神通與法器迎戰。<br>看清敵方意圖，選擇強攻、守勢或蓄力。</p></div>
   <div class="mt-progress"><span>最高通過 <strong>${best}</strong> / 100 層</span><b>${escape(state.title)}</b><i style="--mt-progress:${best}%"></i></div>
   <ul class="mt-rules"><li>每五層解鎖新起點，隨時能再戰。</li><li>每層回滿生命，最多 24 回合，擊破守衛且自己存活才通過。</li><li>不消耗體力或門票，不發放修為與靈石；最高紀錄與演武稱號會保留。</li><li>開陣時鎖定目前配裝，換裝後請重新開陣。</li></ul>${state.status==='expired'?'<p class="mt-error">上一場已逾兩小時，最高紀錄已保留。</p>':''}`}</div>
   <footer>${error&&!pending&&!busy?'<button type="button" class="mt-secondary" data-mt-sync>重新同步</button>':''}${pending&&!busy?'<button type="button" class="mt-primary" data-mt-retry>重試原操作</button><button type="button" class="mt-secondary" data-mt-sync>同步戰場</button>':active?`<div class="mt-tactics" role="group" aria-label="本回合作戰方式">${[['assault','強攻','120% 攻擊，釋放蓄力'],['guard','守勢','70% 攻擊，敵方攻擊降至 45%'],['charge','蓄力','35% 攻擊，下次強攻每層 +65%']].map(([id,name,note])=>`<button type="button" data-mt-tactic="${id}" ${busy?'disabled':''}><strong>${name}</strong><small>${note}</small></button>`).join('')}</div><div class="mt-footer-note"><span>${busy?'招式結算中…':'每次點選一種戰術，推進一個回合。'}</span><button type="button" class="mt-link" data-mt-abandon ${busy?'disabled':''}>結束本次演武</button></div>`:state?`<div class="mt-actions">${state.status==='cleared'?'<button type="button" class="mt-primary" data-mt-next>挑戰下一層</button><button type="button" class="mt-secondary" data-mt-abandon>回到演武台</button>':`<button type="button" class="mt-primary" data-mt-start="${start}" ${busy||!unlocked()?'disabled':''}>${unlocked()?`由第 ${start} 層開陣`:'金丹境開放'}</button>${start>1?'<button type="button" class="mt-secondary" data-mt-start="1">從第一層試陣</button>':''}`}</div><p class="mt-footer-note">最高紀錄 ${best} 層 · 關閉可暫離，兩小時內續戰。</p>`:''}</footer></section>`;
  root.querySelectorAll('[data-mt-close]').forEach(b=>b.onclick=close);
  root.querySelectorAll('[data-mt-start]').forEach(b=>{b.disabled=busy||!unlocked();b.onclick=()=>perform('start',{floor:Number(b.dataset.mtStart)});});
  root.querySelectorAll('[data-mt-tactic]').forEach(b=>b.onclick=()=>perform('turn',{tactic:b.dataset.mtTactic}));
  root.querySelector('[data-mt-next]')?.addEventListener('click',()=>perform('next'));
  root.querySelectorAll('[data-mt-abandon]').forEach(b=>{b.disabled=busy;b.onclick=()=>perform('abandon');});
  root.querySelector('[data-mt-retry]')?.addEventListener('click',()=>sendPending());
  root.querySelector('[data-mt-sync]')?.addEventListener('click',sync);
 }
 async function sendPending(){
  if(busy||!pending)return;const id=serial,operation=pending;busy=true;error='';render();
  const begun=performance.now();
  try{
   const next=await request(operation.action,operation.body);
   // Keep one readable attack beat, including fast local responses.
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,520-(performance.now()-begun))));
   if(!alive(id))return;state=next;pending=null;
  }catch(e){if(!alive(id))return;error=e.status?e.message:'連線暫時未完成，可重新同步或重試原操作。';}
  finally{if(alive(id)){busy=false;render();document.querySelector('#martial-trial-modal footer button:not(:disabled)')?.focus({preventScroll:true});}}
 }
 function perform(action,extra={}){
  if(busy||pending)return;
  pending={action,body:{requestId:crypto.randomUUID(),...(action==='start'?{}:{runId:state.runId,floor:state.floor,round:state.round}),...extra}};
  void sendPending();
 }
 async function sync(){const id=serial;if(busy)return;busy=true;error='';render();try{const next=await request('');if(alive(id)){state=next;pending=null;}}catch(e){if(alive(id))error=e.status?e.message:'連線暫時未完成，可重新同步或重試原操作。';}finally{if(alive(id)){busy=false;render();document.querySelector('#martial-trial-modal footer button:not(:disabled)')?.focus({preventScroll:true});}}}
 function close(){serial++;document.getElementById('martial-trial-modal')?.remove();document.body.classList.remove('martial-trial-open');pending=null;busy=false;returnFocus?.isConnected&&returnFocus.focus({preventScroll:true});}
 function keydown(event){
  const root=document.getElementById('martial-trial-modal');if(!root)return;
  if(event.key==='Escape'){event.preventDefault();close();return;}
  if(event.key==='Tab'){
   const buttons=[...root.querySelectorAll('button:not(:disabled),summary')].filter(e=>e.getClientRects().length);
   const first=buttons[0],last=buttons.at(-1);
   if(event.shiftKey&&(document.activeElement===first||!root.contains(document.activeElement))){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
 }
 async function open(){
  if(!getMainUser()?.uid)return;loadStyle();returnFocus=document.activeElement;serial++;owner=getMainUser().uid;state=null;pending=null;busy=false;error='';
  document.getElementById('martial-trial-modal')?.remove();const root=document.createElement('div');root.id='martial-trial-modal';document.body.appendChild(root);document.body.classList.add('martial-trial-open');render();root.querySelector('#mt-title')?.focus();await sync();
 }
 function boot(){loadStyle();document.addEventListener('click',e=>{if(e.target.closest?.('[data-martial-trial-open]'))void open();});document.addEventListener('keydown',keydown);window.addEventListener('xiuxian:user-ready',()=>{if(owner!==getMainUser()?.uid)close();});}
 window.openMartialTrial=open;
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
