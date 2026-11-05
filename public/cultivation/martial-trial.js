import { authenticatedMainFetch, getMainUser } from './data/project-repository.js';
import './trial-tower-rewards.js';
import './battle-v3-stability-ui.js';
import {duelArenaMarkup} from './duel-arena-view.js';
import {battleStepFeedback,createBattleImpact} from './battle-combat-feedback.js';
import {createInnateAbilityEffect,specialImpactKind,shakeBattleScreen} from './innate-ability-effects.js';
// Single-player combat, using the server's saved build and the existing duel engine.
(function(){
 'use strict';
 let serial=0,owner='',state=null,busy=false,error='',pending=null,returnFocus=null,notice='',rewardPage=1,phase='battle',question=null,timers=[],questionJob=null,verifiedQuestionId='';
 const Rewards=globalThis.QATrialTowerRewards;
 const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
 const count=n=>Math.max(0,Math.round(Number(n)||0));
 const alive=id=>id===serial&&owner===getMainUser()?.uid&&!!document.getElementById('martial-trial-modal');
 const unlocked=()=>Math.max(Number(window.getCurrentUserData?.()?.stats?.totalScore)||0,Number(window.getTrainingAccessScore?.())||0)>=28;
 function loadStyle(){if(!document.getElementById('tower-duel-style')){const link=document.createElement('link');link.id='tower-duel-style';link.rel='stylesheet';link.href='styles/battle-mode-v2.css?v=20261105-shared-stage1';document.head.appendChild(link);}if(document.getElementById('martial-trial-style'))return;const link=document.createElement('link');link.id='martial-trial-style';link.rel='stylesheet';link.href='styles/martial-trial.css?v=20261105-native-study1';document.head.appendChild(link);}
 async function request(action,body){
  const response=await authenticatedMainFetch('/api/martial-trial'+(action?'/'+action:''),body?{method:'POST',body:JSON.stringify(body)}:{});
  const result=await response.json();if(!response.ok||!result.ok)throw Object.assign(new Error(result.error||'試煉同步失敗'),{status:response.status});return result.state;
 }
 function rewardMarkup(reward){return `<div class="tt-rewards">${Rewards.rows(reward).map(row=>`<span>${globalThis.QAItemIcons?.markup(row.icon,{size:20})||''}<b>${escape(row.name)} ×${row.quantity}</b></span>`).join('')}</div>`;}
 function rewardPreview(floor){
  const claimed=state.claimedFloors?.includes(floor),available=floor<=state.bestFloor,ticketPending=state.unclaimedTicketFloors?.includes(floor);
  return `<section class="tt-reward-preview ${claimed&&!ticketPending?'is-claimed':''}"><div><strong>第 ${floor} 層首通獎勵</strong><small>${ticketPending?'通關抽獎券待補領':claimed?'已領取 · 重打不重複發放':available?'已通關 · 可補領':'首次通關後自動入帳'}</small></div>${rewardMarkup(Rewards.forFloor(floor))}</section>`;
 }
 function rewardBook(open=false){
  const done=new Set(state.claimedFloors||[]),tickets=new Set(state.unclaimedTicketFloors||[]),first=(rewardPage-1)*10+1;
  return `<details class="tt-reward-book" ${open?'open':''}><summary>查看百層獎勵 <span>已領取 ${done.size} / 100 層</span></summary><nav aria-label="獎勵層數">${Array.from({length:10},(_,i)=>`<button type="button" data-tt-page="${i+1}" aria-current="${rewardPage===i+1?'page':'false'}">${i*10+1}–${i*10+10}</button>`).join('')}</nav><ol start="${first}">${Array.from({length:10},(_,i)=>{const floor=first+i,status=tickets.has(floor)?'抽獎券待補領':done.has(floor)?'已領取':floor<=state.bestFloor?'可補領':'未通關';return `<li class="${done.has(floor)&&!tickets.has(floor)?'is-claimed':floor<=state.bestFloor?'is-ready':''}"><div><strong>第 ${floor} 層</strong><small>${status}</small></div>${rewardMarkup(Rewards.forFloor(floor))}</li>`;}).join('')}</ol></details>`;
 }
 function backfill(){const floors=state?.unclaimedFloors||[],tickets=state?.unclaimedTicketFloors||[],reward=Rewards.total(floors);reward.drawTickets+=tickets.length;return floors.length||tickets.length?`<section class="tt-backfill"><strong>${[floors.length?`可補領 ${floors.length} 層首通獎勵`:'',tickets.length?`補發 ${tickets.length} 張通關抽獎券`:''].filter(Boolean).join(' · ')}</strong>${rewardMarkup(reward)}<button type="button" class="mt-primary" data-tt-claim ${busy||pending?'disabled':''}>一鍵補領</button></section>`:'';}
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
  if(!root.querySelector('.mt-dialog')){
   root.innerHTML=`<section class="mt-dialog" role="dialog" aria-modal="true" aria-labelledby="mt-title"><header><div><small>以學論道 · 逐層破陣</small><h2 id="mt-title" tabindex="-1">試煉之塔</h2></div><div class="mt-head-actions"><button type="button" class="mt-secondary" data-mt-modes>模式</button><button type="button" class="mt-close" data-mt-close aria-label="暫離試煉之塔">×</button></div></header><div class="mt-body"><div class="mt-messages" aria-live="polite"></div><div class="mt-content"></div></div><footer></footer></section>`;
   root.querySelector('[data-mt-modes]').onclick=()=>{close();window.openWendaoModes?.();};root.querySelector('[data-mt-close]').onclick=close;
  }
  const content=root.querySelector('.mt-content'),footer=root.querySelector('footer');
  const bookOpen=!!content.querySelector('.tt-reward-book')?.open,scroll=root.querySelector('.mt-body').scrollTop;
  const active=state?.status==='active',won=['cleared','complete'].includes(state?.status),battle=!!state?.challenger&&['active','cleared','complete','defeated'].includes(state.status);
  const studying=['question','review'].includes(phase)&&!!question;
  root.hidden=studying;document.body.classList.toggle('martial-trial-open',!studying);root.classList.toggle('mt-fighting',battle&&!studying);root.classList.toggle('mt-in-combat',(active||phase==='animation')&&!studying);
  root.querySelector('.mt-dialog').setAttribute('aria-busy',String(busy));
  root.querySelector('.mt-messages').innerHTML=(error?`<div class="mt-error" role="alert">${escape(error)}</div>`:'')+(notice?`<p class="tt-notice" role="status">${escape(notice)}</p>`:'');
  content.hidden=studying;
  const start=count(state?.checkpoint)||1,best=count(state?.bestFloor);
  if(studying){
   window.QAStudyQuestion.open(question,{runId:state.runId,onAnswer:choice=>perform('turn',{questionId:question.id,choice,help:Math.min(3,Number(window.currentActiveQuiz?.adaptiveHelp)||0)}),onContinue:continueQuestion,onLeave:close,onVerifiedError:redeemQuestion,onSkip:skipQuestion});
   window.QAStudyQuestion.disable(busy||!!pending||phase==='review');
   if(phase==='review')window.QAStudyQuestion.review(state.lastTurn,continueQuestion);
   window.QAStudyQuestion.status({busy,error,retry:pending&&!busy?sendPending:null,sync:!busy?sync:null});
  }else{
   content.innerHTML=!state?'<p class="mt-loading" role="status">正在同步試煉紀錄…</p>':battle?`
    <div id="trial-tower-stage" class="trial-tower-battle battle-v2-page"><div class="bv2-shell">${duelArenaMarkup({prefix:'tt',maxRounds:state.maxRounds})}</div></div>
    ${!active&&phase!=='animation'?`<div class="mt-outcome ${won?'is-won':''}"><h3>${state.status==='complete'?'百層破陣':won?'守衛已擊破':'本層未通過'}</h3><p>${won?'下一層將回滿生命再戰。':'調整配裝，可從尚未通過的樓層繼續挑戰。'}</p></div>`:''}
    ${!active&&phase!=='animation'?backfill()+rewardPreview(state.floor)+rewardBook(bookOpen):''}`:`
    ${backfill()}<div class="mt-lobby"><span class="mt-lobby-seal" aria-hidden="true">塔</span><h3>答題出招，逐層登塔</h3><p>與鬥法相同的戰場，答對才能先手攻擊。<br>守衛固定後手，存活時每回合都會出招；題目與解析皆不計時。</p></div>
    <div class="mt-progress"><span>最高通過 <strong>${best}</strong> / 100 層</span><b>${escape(state.title)}</b><i style="--mt-progress:${best}%"></i></div>
    ${state.rulesUpdated?'<p class="tt-notice">試煉已改為答題戰鬥，既有最高層數與獎勵紀錄皆保留。請重新開陣。</p>':''}
    ${rewardPreview(start)}<ul class="mt-rules"><li>每十層提升守衛境界：煉氣、築基、金丹、元嬰、化神、煉虛、合體、大乘、半仙、真仙。</li><li>通過一層即解鎖下一層；每層回滿生命，最多 24 回合。</li><li>題目依你的年級與設定範圍出題；可使用白板、問道助手與題目回報。</li><li>每層首次通關給 1 張本命法器抽獎券，第 50、100 層另有加碼。</li><li>每層首通獎勵限領一次，重打不重領；開陣時鎖定配裝。</li></ul>${rewardBook(bookOpen)}`;
   if(battle)paintArena();
  }
  footer.innerHTML=`${pending&&!busy?'<button type="button" class="mt-primary" data-mt-retry>重試原操作</button><button type="button" class="mt-secondary" data-mt-sync>同步戰場</button>':studying?`<p class="mt-footer-note">第 ${state.floor} 層 · ${phase==='review'?'讀完解析後，按「繼續」觀看攻擊。':busy?'答案結算中…':'不計時 · 答對才能攻擊'}</p>`:phase==='animation'?'<p class="mt-footer-note" role="status">本回合戰鬥進行中…</p>':state?`<div class="mt-actions">${active?`<button type="button" class="mt-primary" data-mt-question ${busy?'disabled':''}>${busy?'正在準備題目…':'進入題目 · 答題出招'}</button><button type="button" class="mt-secondary" data-mt-abandon ${busy?'disabled':''}>結束本次闖塔</button>`:state.status==='cleared'?'<button type="button" class="mt-primary" data-mt-next>挑戰下一層</button><button type="button" class="mt-secondary" data-mt-abandon>回到塔前</button>':`<button type="button" class="mt-primary" data-mt-start="${start}" ${busy||!unlocked()?'disabled':''}>${unlocked()?`由第 ${start} 層開陣`:'金丹境開放'}</button>${start>1?'<button type="button" class="mt-secondary" data-mt-start="1">從第一層試陣</button>':''}`}</div>`:''}${error&&!pending&&!busy?'<button type="button" class="mt-secondary" data-mt-sync>重新同步</button>':''}`;
  root.querySelector('.mt-body').scrollTop=scroll;
  root.querySelector('[data-tt-claim]')?.addEventListener('click',()=>perform('claim'));
  root.querySelectorAll('[data-tt-page]').forEach(b=>b.onclick=()=>{rewardPage=Number(b.dataset.ttPage);render();});
  root.querySelectorAll('[data-mt-start]').forEach(b=>{b.disabled=busy||!unlocked();b.onclick=()=>perform('start',{floor:Number(b.dataset.mtStart)});});
  root.querySelector('[data-mt-question]')?.addEventListener('click',loadQuestion);
  root.querySelector('[data-mt-next]')?.addEventListener('click',()=>perform('next'));
  root.querySelectorAll('[data-mt-abandon]').forEach(b=>b.onclick=()=>perform('abandon'));
  root.querySelector('[data-mt-retry]')?.addEventListener('click',sendPending);
  root.querySelectorAll('[data-mt-sync]').forEach(b=>b.onclick=sync);
 }
 function paintArena(start=false){
  const root=document.querySelector('.trial-tower-battle');if(!root)return;
  const text=(id,value)=>{const el=root.querySelector('#tt-'+id);if(el)el.textContent=value;};
  const arena=root.querySelector('#tt-arena');arena.classList.remove('hidden');arena.dataset.combatState=phase==='animation'?'clash':'ready';
  text('round',`${Math.max(1,state.round+(state.status==='active'&&phase!=='animation'?1:0))} / ${state.maxRounds}`);text('cultivation-pool',`第 ${state.floor} / 100 層`);
  for(const [side,p]of [['my',state.challenger],['enemy',state.defender]]){
   text(side+'-name',p.name+(p.realm?' · '+p.realm:''));text(side+'-core',`本命金丹：${p.core||'未調御'} · 攻擊 ${p.atk}${p.shield?' · 護盾 '+p.shield:''}`);
   const holder=root.querySelector('#tt-'+side+'-fighter'),img=holder.querySelector('img');
   holder.classList.add(side==='my'?'me':'enemy');
   const gender=p.gender||(side==='my'?window.getCurrentUserData?.()?.storyProgressV1?.gender:'');
   img.onload=()=>{img.hidden=false;holder.querySelector('span').hidden=true;};
   img.src=gender?`assets/story/characters/player-${gender==='female'?'female':'male'}-determined.png`:'assets/story/characters/battle-rival.png';
  }
  const rule=root.querySelector('.bv2-duel-rule');rule.textContent='答對先手出招 · 守衛固定後手，存活時每回合攻擊 · 不計時';
  const cue=root.querySelector('#tt-duel-cue');cue.setAttribute('aria-live','polite');
  text('cue-kicker','以學論道');text('cue-count',phase==='animation'?'出招':'凝神備戰');text('cue-message',phase==='animation'?'正在施展本回合招式':'進入題目，答對即可攻擊');
  setHp('my',start?state.lastTurn?.startHostHp:state.challenger.hp);setHp('enemy',start?state.lastTurn?.startGuestHp:state.defender.hp);
 }
 function setHp(side,hp){const p=side==='my'?state.challenger:state.defender,value=count(hp??p.hp),root=document.querySelector('.trial-tower-battle');
  const bar=root?.querySelector('#tt-'+side+'-hp'),label=root?.querySelector('#tt-'+side+'-hp-text');
  if(bar)bar.style.width=Math.min(100,100*value/Math.max(1,p.maxHp))+'%';if(label)label.textContent=String(value);
 }
 function clearAnimation(){timers.forEach(clearTimeout);timers=[];document.querySelectorAll('.trial-tower-battle .ia-ability-effect').forEach(n=>n.dispose?.());}
 async function watchCombat(){
  if(phase!=='review'||busy||pending)return;
  const current=serial;await window.QAStudyQuestion.waitForAnswer();if(!alive(current)||phase!=='review'||busy||pending)return;
  phase='animation';question=null;render();paintArena(true);clearAnimation();
  const id=serial,root=document.querySelector('.trial-tower-battle'),stage=root.querySelector('.bv2-stage'),review=state.lastTurn;
  const steps=review.steps||[],reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let offset=150;
  for(const [index,step]of steps.entries()){
   const duration=reduced?160:step.innateEffect==='meteor'?900:1850,impactAt=reduced?30:step.innateEffect==='meteor'?400:650;
   const actor=root.querySelector('#tt-'+(step.actorRole==='host'?'my':'enemy')+'-fighter'),target=root.querySelector('#tt-'+(step.actorRole==='host'?'enemy':'my')+'-fighter');
   let effect,impact,pop;
   timers.push(setTimeout(()=>{if(!alive(id))return;
    actor.classList.add(step.type==='miss'?'miss':'strike');
    root.querySelector('#tt-cue-kicker').textContent=step.actorRole==='host'?'我方先手':'守衛後手';
    root.querySelector('#tt-cue-count').textContent=step.type==='miss'?'未命中':step.skill||'出招';
    root.querySelector('#tt-cue-message').textContent=battleStepFeedback(step,step.actorRole==='host'?state.challenger:state.defender).label;
    if(step.innateEffect)effect=createInnateAbilityEffect(stage,{kind:step.innateEffect,source:actor,target,durationMs:duration});
   },offset));
   timers.push(setTimeout(()=>{if(!alive(id))return;
    setHp('my',step.hostHp);setHp('enemy',step.guestHp);
    if(step.type!=='miss'){
     target.classList.add(step.guarded?'guarded':'hit');globalThis.QAGameAudio?.play(step.guarded?'spirit-pulse':'combat-impact',{key:`tower-hit:${state.runId}:${state.round}:${index}`});
     if(!step.innateEffect)impact=createBattleImpact(stage,{step,player:step.actorRole==='host'?state.challenger:state.defender,fromMe:step.actorRole==='host'});
     const special=specialImpactKind(step);if(special)shakeBattleScreen(root,{kind:special});
    }
    pop=document.createElement('b');pop.className='bv2-damage-pop'+(step.type==='miss'?' miss':step.guarded?' blocked':step.critical?' critical':'');pop.textContent=battleStepFeedback(step,{}).label;target.append(pop);
   },offset+impactAt));
   timers.push(setTimeout(()=>{actor.classList.remove('strike','miss');target.classList.remove('hit','guarded');effect?.dispose?.();impact?.remove();pop?.remove();},offset+duration));offset+=duration;
  }
  timers.push(setTimeout(()=>{if(!alive(id))return;phase='battle';render();},offset+200));
 }
 async function fetchQuestion(){
  if(questionJob)return questionJob;
  const fetcher=window.QAAdaptiveLearning?.fetchQuiz||authenticatedMainFetch;
  const job=(async()=>{
   const response=await fetcher('/api/generate-quiz',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quizMode:'trial-tower'})});
   const payload=await response.json();if(!response.ok||!payload.towerQuestion)throw Error(payload.error||'題目準備失敗');
   return payload.towerQuestion;
  })();questionJob=job;
  try{return await job;}finally{if(questionJob===job)questionJob=null;}
 }
 async function loadQuestion(){
  if(busy||pending||state?.status!=='active')return;
  if(!window.QAStudyQuestion){error='題目工具正在載入，請稍後重試。';render();return;}
  const id=serial;busy=true;error='';render();
  try{const next=await fetchQuestion();if(!alive(id))return;question=next;phase='question';state.question=question;}
  catch(e){if(alive(id))error=e.message||'題目準備失敗，請重試。';}
  finally{if(alive(id)){busy=false;render();}}
 }
 async function prefetchPractice(questionId){
  if(state?.status!=='active'||phase!=='review')return;
  if(state.question?.recoveryOrigin&&state.question.recoveryOrigin===window.currentActiveQuiz?.data?.q){window.QAStudyQuestion.practiceStatus(questionId,{ready:true});return;}
  if(!state.queuedPractice?.length&&!state.activeExtension)return;
  const id=serial;window.QAStudyQuestion.practiceStatus(questionId,{busy:true});
  try{
   await window.QAStudyQuestion.waitForAnswer();if(!alive(id))return;
   const next=await fetchQuestion();if(!alive(id))return;state.question=next;
   window.QAStudyQuestion.practiceStatus(questionId,{ready:true});
  }catch(e){if(alive(id))window.QAStudyQuestion.practiceStatus(questionId,{failed:true});}
 }
 async function redeemQuestion(){
  const id=serial,qid=question?.id;if(!qid)return;verifiedQuestionId=qid;await window.QAStudyQuestion.waitForAnswer();
  if(!alive(id)||question?.id!==qid)return;
  if(state.lastTurn?.questionId===qid&&state.lastTurn.verifiedError)return;
  if(pending?.action==='replace')return sendPending();
  return perform('replace',{questionId:qid});
 }
 async function continueQuestion(){
  if(phase!=='review'||!question)return;
  if(verifiedQuestionId===question?.id&&!(state.lastTurn?.questionId===question.id&&state.lastTurn.verifiedError)){
   await redeemQuestion();if(pending||busy||!state.lastTurn?.verifiedError)return;
  }
  return watchCombat();
 }
 async function skipQuestion(){await redeemQuestion();if(state?.lastTurn?.verifiedError)return continueQuestion();}
 async function sendPending(){
  if(busy||!pending)return;const id=serial,operation=pending;busy=true;error='';render();
  try{
   const next=await request(operation.action,operation.body);if(!alive(id))return;
   state=next;if(!['practice','cancel-practice'].includes(operation.action))applyEconomy(next.economy);pending=null;
   if(['turn','replace'].includes(operation.action)){
    question=next.lastTurn?.question;phase='review';
   }else if(!['practice','cancel-practice'].includes(operation.action)){question=null;phase='battle';}
   if(next.awarded){notice=operation.action==='claim'?[next.awarded.floors.length?'已補領 '+next.awarded.floors.length+' 層首通獎勵':'',next.awarded.ticketFloors?.length?'已補發 '+next.awarded.ticketFloors.length+' 張通關抽獎券':''].filter(Boolean).join(' · '):'首通獎勵已入帳';globalThis.QAGameAudio?.play('reward-chime',{key:'tower:'+owner+':'+next.claimedFloors.length+':'+(next.unclaimedTicketFloors||[]).length});}
  }catch(e){if(!alive(id))return;error=e.status?e.message:'連線暫時未完成，可重新同步或重試原操作。';}
  finally{if(alive(id)){busy=false;render();if(['turn','practice'].includes(operation.action))void prefetchPractice(question?.id);}}
 }
 function perform(action,extra={}){
  if(busy||pending||phase==='animation')return;
  notice='';if(['start','next'].includes(action))rewardPage=Math.ceil((action==='next'?state.floor+1:extra.floor||1)/10);
  pending={action,body:{requestId:crypto.randomUUID(),...(['start','claim'].includes(action)?{}:{runId:state.runId,floor:state.floor,round:state.round}),...extra}};
  return sendPending();
 }
 async function sync(){
  const id=serial;if(busy)return;busy=true;error='';render();
  try{const next=await request('');if(alive(id)){
   state=next;applyEconomy(next.economy);pending=null;
   const resumable=['active','cleared','complete','defeated'].includes(next.status);
   question=resumable?(next.question||next.lastTurn?.question):null;
   phase=resumable&&next.question?'question':resumable&&next.lastTurn?.question?'review':'battle';
  }}catch(e){if(alive(id))error=e.status?e.message:'連線暫時未完成，請重新同步。';}
  finally{if(alive(id)){busy=false;render();}}
 }
 function close(){const wasOpen=!!document.getElementById('martial-trial-modal');clearAnimation();window.QAStudyQuestion?.end();serial++;document.getElementById('martial-trial-modal')?.remove();document.body.classList.remove('martial-trial-open');pending=null;busy=false;returnFocus?.isConnected&&returnFocus.focus({preventScroll:true});if(wasOpen)window.dispatchEvent(new CustomEvent('xiuxian:battle-session-ended'));}
 function keydown(event){
  const root=document.getElementById('martial-trial-modal');if(!root||root.hidden)return;
  if(document.getElementById('report-modal')&&!document.getElementById('report-modal').classList.contains('hidden'))return;
  if(document.getElementById('quiz-whiteboard-panel')&&!document.getElementById('quiz-whiteboard-panel').classList.contains('hidden'))return;
  if(event.key==='Escape'){event.preventDefault();close();return;}
  if(event.key==='Tab'){
   const buttons=[...root.querySelectorAll('button:not(:disabled),summary,textarea,input,[tabindex="0"]')].filter(e=>e.getClientRects().length);
   const first=buttons[0],last=buttons.at(-1);
   if(event.shiftKey&&(document.activeElement===first||!root.contains(document.activeElement))){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
 }
 async function open(){
  if(!getMainUser()?.uid)return;if(document.getElementById('martial-trial-modal'))close();loadStyle();returnFocus=document.activeElement;serial++;owner=getMainUser().uid;state=null;pending=null;busy=false;error='';notice='';rewardPage=1;phase='battle';question=null;questionJob=null;
  const root=document.createElement('div');root.id='martial-trial-modal';document.body.appendChild(root);document.body.classList.add('martial-trial-open');render();root.querySelector('#mt-title')?.focus();await sync();
 }
 function boot(){loadStyle();document.addEventListener('keydown',keydown);window.addEventListener('xiuxian:user-ready',()=>{if(owner!==getMainUser()?.uid)close();});}
 window.persistTrialTowerStudyHint=async quiz=>{
  if(!state||quiz.id!==question?.id||quiz.mode!=='trial-tower')return;
  const id=serial;
  try{const next=await request('hint',{requestId:crypto.randomUUID(),runId:state.runId,floor:state.floor,round:state.round,questionId:quiz.id,help:Math.min(3,Number(quiz.adaptiveHelp)||0)});
   if(alive(id)&&question?.id===quiz.id&&state.round===next.round)state=next;
  }catch(_){/* The answer request also carries the latest help count. */}
 };
 window.queueTrialTowerPractice=extra=>perform('practice',extra);
 window.cancelTrialTowerPractice=()=>perform('cancel-practice');
 window.getTrialTowerPracticeState=()=>({queued:state?.queuedPractice||[],extension:!!state?.activeExtension||!!state?.queuedPractice?.some(p=>!p.correction)});
 window.openMartialTrial=open;window.openTrialTower=open;window.closeTrialTower=close;
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
