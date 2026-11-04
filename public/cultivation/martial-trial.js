import { authenticatedMainFetch, getMainUser } from './data/project-repository.js';
import './trial-tower-rewards.js';
// Single-player combat, using the server's saved build and the existing duel engine.
(function(){
 'use strict';
 let serial=0,owner='',state=null,busy=false,error='',pending=null,returnFocus=null,notice='',rewardPage=1;
 const Rewards=globalThis.QATrialTowerRewards;
 const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
 const count=n=>Math.max(0,Math.round(Number(n)||0));
 const alive=id=>id===serial&&owner===getMainUser()?.uid&&!!document.getElementById('martial-trial-modal');
 const unlocked=()=>Math.max(Number(window.getCurrentUserData?.()?.stats?.totalScore)||0,Number(window.getTrainingAccessScore?.())||0)>=28;
 function loadStyle(){if(document.getElementById('martial-trial-style'))return;const link=document.createElement('link');link.id='martial-trial-style';link.rel='stylesheet';link.href='styles/martial-trial.css?v=20261104-tower-rewards1';document.head.appendChild(link);}
 async function request(action,body){
  const response=await authenticatedMainFetch('/api/martial-trial'+(action?'/'+action:''),body?{method:'POST',body:JSON.stringify(body)}:{});
  const result=await response.json();if(!response.ok||!result.ok)throw Object.assign(new Error(result.error||'試煉同步失敗'),{status:response.status});return result.state;
 }
 function fighter(p,enemy=false){
  const ratio=Math.min(100,Math.max(0,100*p.hp/Math.max(1,p.maxHp)));
  return `<article class="mt-fighter ${enemy?'mt-enemy':''}"><div class="mt-fighter-face">${!enemy&&p.portrait?`<img src="${escape(p.portrait)}" alt="">`:`<span aria-hidden="true">${enemy?'陣':'修'}</span>`}</div><div class="mt-fighter-name"><small>${enemy?'守陣傀儡':'出戰配裝'}</small><strong>${escape(p.name)}</strong></div><div class="mt-health" role="progressbar" aria-label="${escape(p.name)}生命" aria-valuemin="0" aria-valuemax="${count(p.maxHp)}" aria-valuenow="${count(p.hp)}"><i style="width:${ratio}%"></i></div><p class="mt-fighter-stats"><span>生命 ${count(p.hp)} / ${count(p.maxHp)}</span><b>攻擊 ${count(p.atk)}</b></p>${p.shield?`<small class="mt-shield">護盾 ${count(p.shield)}</small>`:''}${p.core?`<small class="mt-core">${escape(p.core)}</small>`:''}</article>`;
 }
 function rewardMarkup(reward){return `<div class="tt-rewards">${Rewards.rows(reward).map(row=>`<span>${globalThis.QAItemIcons?.markup(row.icon,{size:20})||''}<b>${escape(row.name)} ×${row.quantity}</b></span>`).join('')}</div>`;}
 function rewardPreview(floor){
  const claimed=state.claimedFloors?.includes(floor),available=floor<=state.bestFloor;
  return `<section class="tt-reward-preview ${claimed?'is-claimed':''}"><div><strong>第 ${floor} 層首通獎勵</strong><small>${claimed?'已領取 · 重打不重複發放':available?'已通關 · 可補領':'首次通關後自動入帳'}</small></div>${rewardMarkup(Rewards.forFloor(floor))}</section>`;
 }
 function rewardBook(open=false){
  const done=new Set(state.claimedFloors||[]),first=(rewardPage-1)*10+1;
  return `<details class="tt-reward-book" ${open?'open':''}><summary>查看百層獎勵 <span>已領取 ${done.size} / 100 層</span></summary><nav aria-label="獎勵層數">${Array.from({length:10},(_,i)=>`<button type="button" data-tt-page="${i+1}" aria-current="${rewardPage===i+1?'page':'false'}">${i*10+1}–${i*10+10}</button>`).join('')}</nav><ol start="${first}">${Array.from({length:10},(_,i)=>{const floor=first+i,status=done.has(floor)?'已領取':floor<=state.bestFloor?'可補領':'未通關';return `<li class="${done.has(floor)?'is-claimed':floor<=state.bestFloor?'is-ready':''}"><div><strong>第 ${floor} 層</strong><small>${status}</small></div>${rewardMarkup(Rewards.forFloor(floor))}</li>`;}).join('')}</ol></details>`;
 }
 function backfill(){const floors=state?.unclaimedFloors||[];return floors.length?`<section class="tt-backfill"><strong>可補領 ${floors.length} 層首通獎勵</strong>${rewardMarkup(Rewards.total(floors))}<button type="button" class="mt-primary" data-tt-claim ${busy||pending?'disabled':''}>一鍵補領</button></section>`:'';}
 function applyEconomy(value){
  const player=window.getCurrentUserData?.();if(!value||!player||owner!==getMainUser()?.uid)return;
  const before=JSON.stringify([count(player.stats?.gold),count(player.forgeFragments),count(player.soulboundDrawTickets),...Object.keys(Rewards.ITEMS).map(id=>count(player.materialSystem?.inventory?.[id]))]);
  player.stats||={};player.stats.gold=count(value.gold);player.forgeFragments=count(value.forgeFragments);player.soulboundDrawTickets=count(value.drawTickets);
  player.materialSystem||={};player.materialSystem.inventory={...(player.materialSystem.inventory||{}),...value.materials};
  const after=JSON.stringify([player.stats.gold,player.forgeFragments,player.soulboundDrawTickets,...Object.keys(Rewards.ITEMS).map(id=>count(player.materialSystem.inventory[id]))]);
  if(before!==after){window.updateUIStats?.();for(const event of ['material-system-updated','xiuxian:stats-updated','xiuxian:soulbound-tickets-updated'])window.dispatchEvent(new CustomEvent(event,{detail:{source:'trial-tower'}}));}
 }
 function render(){
  const root=document.getElementById('martial-trial-modal');if(!root)return;
  const rewardOpen=!!root.querySelector('.tt-reward-book')?.open,scroll=root.querySelector('.mt-body')?.scrollTop||0;
  const active=state?.status==='active',won=['cleared','complete'].includes(state?.status),battle=state?.challenger&&['active','cleared','complete','defeated'].includes(state.status);
  const warning=error?`<div class="mt-error" role="alert">${escape(error)}</div>`:'';
  const best=count(state?.bestFloor),start=count(state?.checkpoint)||1;
  root.innerHTML=`<section class="mt-dialog" role="dialog" aria-modal="true" aria-labelledby="mt-title" aria-busy="${busy}"><header><div><small>以戰驗道</small><h2 id="mt-title" tabindex="-1">試煉之塔</h2></div><div class="mt-head-actions"><button type="button" class="mt-secondary" data-mt-modes>模式</button><button type="button" class="mt-close" data-mt-close aria-label="暫離試煉之塔">×</button></div></header><div class="mt-body">${warning}${notice?`<p class="tt-notice" role="status">${escape(notice)}</p>`:''}${state?backfill():''}${!state?'<p class="mt-loading" role="status">正在同步試煉紀錄…</p>':battle?`
   <div class="mt-round"><span>第 ${state.floor} / ${state.maxFloor} 層</span><b>回合 ${state.round} / ${state.maxRounds}</b><span>蓄力 ${state.charge} / 2</span></div>
   <div class="mt-arena ${state.lastTurn?'mt-resolved':''}">${fighter(state.challenger)}${fighter(state.defender,true)}</div>
   ${active?`<div class="mt-intent"><small>守衛下一步</small><strong>${escape(state.intent.name)}</strong><p>${escape(state.intent.hint.replaceAll('化身','守衛'))}</p></div>`:`<div class="mt-outcome ${won?'is-won':''}"><h3>${state.status==='complete'?'百層破陣':won?'守衛已擊破':'本層未通過'}</h3><p>${won?'你的金丹、元嬰與法器已完成這一戰。下一層將回滿生命再戰。':'調整配裝或改變攻守節奏，可由最近的五層起點重試。'}</p></div>`}
   ${rewardPreview(state.floor)}
   ${state.lastTurn?`<details class="mt-record"><summary>本回合戰況</summary>${state.lastTurn.notes.map(n=>`<p>${escape(n)}</p>`).join('')}<ol>${state.lastTurn.logs.map(log=>`<li>${escape(log.actorUid===owner?'你':'守衛')} · ${escape(log.skill||log.message||log.type||'出手')}${log.damage?`　${count(log.damage)} 傷害`:''}${log.heal?`　回復 ${count(log.heal)}`:''}</li>`).join('')}</ol></details>`:''}`:`
   <div class="mt-lobby"><span class="mt-lobby-seal" aria-hidden="true">塔</span><h3>逐層破陣，領取首通獎勵</h3><p>不需答題，直接以目前金丹、元嬰、神通與法器迎戰。<br>看清敵方意圖，選擇強攻、守勢或蓄力。</p></div>
   <div class="mt-progress"><span>最高通過 <strong>${best}</strong> / 100 層</span><b>${escape(state.title)}</b><i style="--mt-progress:${best}%"></i></div>
   ${rewardPreview(start)}<ul class="mt-rules"><li>每五層解鎖新起點，隨時能再戰。</li><li>每層回滿生命，最多 24 回合，擊破守衛且自己存活才通過。</li><li>不消耗體力或門票；每層首通獎勵限領一次，重打可磨練配裝。</li><li>開陣時鎖定目前配裝，換裝後請重新開陣。</li></ul>${state.status==='expired'?'<p class="mt-error">上一場已逾兩小時，最高紀錄已保留。</p>':''}`}${state?rewardBook(rewardOpen):''}</div>
   <footer>${error&&!pending&&!busy?'<button type="button" class="mt-secondary" data-mt-sync>重新同步</button>':''}${pending&&!busy?'<button type="button" class="mt-primary" data-mt-retry>重試原操作</button><button type="button" class="mt-secondary" data-mt-sync>同步戰場</button>':active?`<div class="mt-tactics" role="group" aria-label="本回合作戰方式">${[['assault','強攻','120% 攻擊，釋放蓄力'],['guard','守勢','70% 攻擊，敵方攻擊降至 45%'],['charge','蓄力','35% 攻擊，下次強攻每層 +65%']].map(([id,name,note])=>`<button type="button" data-mt-tactic="${id}" ${busy?'disabled':''}><strong>${name}</strong><small>${note}</small></button>`).join('')}</div><div class="mt-footer-note"><span>${busy?'招式結算中…':'每次點選一種戰術，推進一個回合。'}</span><button type="button" class="mt-link" data-mt-abandon ${busy?'disabled':''}>結束本次闖塔</button></div>`:state?`<div class="mt-actions">${state.status==='cleared'?'<button type="button" class="mt-primary" data-mt-next>挑戰下一層</button><button type="button" class="mt-secondary" data-mt-abandon>回到塔前</button>':`<button type="button" class="mt-primary" data-mt-start="${start}" ${busy||!unlocked()?'disabled':''}>${unlocked()?`由第 ${start} 層開陣`:'金丹境開放'}</button>${start>1?'<button type="button" class="mt-secondary" data-mt-start="1">從第一層試陣</button>':''}`}</div><p class="mt-footer-note">最高紀錄 ${best} 層 · 關閉可暫離，兩小時內續戰。</p>`:''}</footer></section>`;
  root.querySelector('.mt-body').scrollTop=scroll;
  root.querySelector('[data-mt-modes]')?.addEventListener('click',()=>{close();window.openWendaoModes?.();});
  root.querySelector('[data-tt-claim]')?.addEventListener('click',()=>perform('claim'));
  root.querySelectorAll('[data-tt-page]').forEach(b=>b.onclick=()=>{rewardPage=Number(b.dataset.ttPage);render();});
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
   if(!alive(id))return;state=next;applyEconomy(next.economy);pending=null;
   if(next.awarded){notice=operation.action==='claim'?'已補領 '+next.awarded.floors.length+' 層首通獎勵':'首通獎勵已入帳';globalThis.QAGameAudio?.play('reward-chime',{key:'tower:'+owner+':'+next.claimedFloors.length});}
  }catch(e){if(!alive(id))return;error=e.status?e.message:'連線暫時未完成，可重新同步或重試原操作。';}
  finally{if(alive(id)){busy=false;render();document.querySelector('#martial-trial-modal footer button:not(:disabled)')?.focus({preventScroll:true});}}
 }
 function perform(action,extra={}){
  if(busy||pending)return;
  notice='';if(['start','next'].includes(action)){rewardPage=Math.ceil((action==='next'?state.floor+1:extra.floor||1)/10);const book=document.querySelector('.tt-reward-book');if(book)book.open=false;document.querySelector('#martial-trial-modal .mt-body')?.scrollTo(0,0);}
  pending={action,body:{requestId:crypto.randomUUID(),...(['start','claim'].includes(action)?{}:{runId:state.runId,floor:state.floor,round:state.round}),...extra}};
  void sendPending();
 }
 async function sync(){const id=serial;if(busy)return;busy=true;error='';render();try{const next=await request('');if(alive(id)){state=next;applyEconomy(next.economy);pending=null;}}catch(e){if(alive(id))error=e.status?e.message:'連線暫時未完成，可重新同步或重試原操作。';}finally{if(alive(id)){busy=false;render();document.querySelector('#martial-trial-modal footer button:not(:disabled)')?.focus({preventScroll:true});}}}
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
  if(!getMainUser()?.uid)return;loadStyle();returnFocus=document.activeElement;serial++;owner=getMainUser().uid;state=null;pending=null;busy=false;error='';notice='';rewardPage=1;
  document.getElementById('martial-trial-modal')?.remove();const root=document.createElement('div');root.id='martial-trial-modal';document.body.appendChild(root);document.body.classList.add('martial-trial-open');render();root.querySelector('#mt-title')?.focus();await sync();
 }
 function boot(){loadStyle();document.addEventListener('keydown',keydown);window.addEventListener('xiuxian:user-ready',()=>{if(owner!==getMainUser()?.uid)close();});}
 window.openMartialTrial=open;window.openTrialTower=open;window.closeTrialTower=close;
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
