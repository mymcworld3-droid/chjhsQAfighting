import './tactical-rules.js';
import {TacticalRenderer} from './tactical-renderer.js';
import {authenticatedMainFetch,getMainUser} from './data/project-repository.js';

const R=globalThis.QATactical;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rich=v=>window.quizMathRichText?.(String(v||''))||esc(v);
const id=()=>globalThis.crypto.randomUUID();
const localUser=()=>window.getCurrentUserData?.()||{};
let root=null,renderer=null,state=null,mode='pve',map='courtyard',action='move',selection=null,trialEntry=null;
let opened=false,busy=false,epoch=0,uid='',poll=null,clock=null,retryMs=4000,op=0,appliedOp=0;
let modalOpen=false,lastTrigger=null,clockOffset=0,deadlineSyncAt=0;
const $=selector=>root?.querySelector(selector);

async function api(path,body){
  const response=await authenticatedMainFetch(path,{...(body?{method:'POST',body:JSON.stringify(body)}:{method:'GET'}),signal:AbortSignal.timeout(65000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.error)throw Object.assign(Error(data.error||'戰場連線暫時中斷'),{status:response.status});
  return data;
}
function valid(e,account){return opened&&e===epoch&&account===getMainUser()?.uid;}
function notice(text){const box=$('[data-notice]');if(box){box.textContent=text;box.hidden=!text;}}
function selectedCore(){const user=localUser(),score=window.QATrainingAccessRules?.score(user)??Number(user.stats?.totalScore||0);const raw=score<28||user.cultivationTraining?.coreEnabled===false?null:user.cultivationTraining?.equippedCore;return R.CORES[raw?.type]?raw.type:'none';}
function ensure(){
  if(root)return;
  if(!document.getElementById('tactical-style')){const link=document.createElement('link');link.id='tactical-style';link.rel='stylesheet';link.href='/styles/tactical-combat.css';document.head.append(link);}
  root=document.createElement('section');root.id='tactical-combat';root.hidden=true;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','戰棋修行');
  root.innerHTML=`<header class="tc-top"><div><small>青雲宗 · 演武司</small><h1 data-title>問道獵妖</h1></div><div class="tc-top-right"><span data-turn></span><button type="button" data-close aria-label="收起戰場">收起 ×</button></div></header>
    <div class="tc-notice" data-notice role="status" hidden></div><main class="tc-main" data-main></main><div class="tc-modal" data-modal hidden></div>`;
  document.body.append(root);$('[data-close]').onclick=close;
  root.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b||b.disabled)return;
    if(b.dataset.mode){if(b.dataset.mode==='pve')void open('pve');else{mode='pvp';renderHub();}}
    else if(b.dataset.map){map=b.dataset.map;renderHub();}
    else if(b.hasAttribute('data-start'))void start();
    else if(b.hasAttribute('data-join'))void start($('[data-code]').value);
    else if(b.hasAttribute('data-resume'))paint();
    else if(b.hasAttribute('data-hub')){hideModal();mode==='pve'?close():renderHub();}
    else if(b.hasAttribute('data-next-stage')||b.hasAttribute('data-retry-entry'))void open('pve');
    else if(b.hasAttribute('data-exit'))close();
    else if(b.hasAttribute('data-sync'))void sync();
    else if(b.dataset.action){action=b.dataset.action;selection=null;
      const me=state?.actors.find(a=>a.uid===uid);if(action==='skill'&&me&&R.branchFor(me).skill.range===0)selection={x:me.x,y:me.y};
      updateControls();renderer?.update(state,uid,action,selection);}
    else if(b.hasAttribute('data-execute'))void execute();
    else if(b.hasAttribute('data-guard'))void send({type:'guard'});
    else if(b.hasAttribute('data-end'))void send({type:'end'});
    else if(b.hasAttribute('data-quiz'))void question();
    else if(b.hasAttribute('data-dismiss')){hideModal();if(state&&$('canvas'))paint();}
    else if(b.hasAttribute('data-continue')){hideModal();paint();}
    else if(b.hasAttribute('data-leave'))leaveDialog();
    else if(b.hasAttribute('data-forfeit')){hideModal();void send({type:'leave'});}
    else if(b.dataset.choice!==undefined)void answer(Number(b.dataset.choice));
    else if(b.hasAttribute('data-copy'))void navigator.clipboard?.writeText(state.id.replace('arena-','')).then(()=>notice('戰場代碼已複製')).catch(()=>notice('請長按上方代碼複製'));
  });
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();modalOpen?hideModal():close();}
    if(event.key==='Tab'){
      const scope=modalOpen?$('[data-modal]'):root,focusable=[...scope.querySelectorAll('button:not(:disabled),input,canvas[tabindex],summary')].filter(el=>el.getClientRects().length);
      if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&(document.activeElement===first||!scope.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
}
function destroyRenderer(){renderer?.destroy();renderer=null;}
function renderHub(){
  destroyRenderer();const c=selectedCore(),core=R.CORES[c],pref=localUser().tacticalPreferences?.[c];
  const chosen=R.savedBranch(localUser(),c);
  $('[data-title]').textContent='戰棋修行';$('[data-turn]').textContent='';
  $('[data-main]').className='tc-main tc-hub';
  $('[data-main]').innerHTML=`<div class="tc-hub-intro"><small>步步為營 · 以學御法</small><h2>答題蓄力，走出你的戰局。</h2><p>答對 +4 體力，答錯 +1；每格移動消耗 1，普通攻擊消耗 2。每回合最多兩題、兩次攻擊或技能，體力可保留至下一回合。</p>
    ${state&&['active','waiting'].includes(state.status)?'<button type="button" class="tc-primary" data-resume>繼續尚未結束的戰場 →</button>':''}</div>
    <div class="tc-hub-config"><div class="tc-tabs"><button type="button" data-mode="pvp" aria-pressed="true">鬥法論道 <small>雙人戰棋</small></button></div>
    <label class="tc-label">選擇戰場</label><div class="tc-maps">${R.MAPS.map(m=>`<button type="button" data-map="${m.id}" aria-pressed="${map===m.id}"><b>${m.name}</b><span>${m.width} × ${m.height} · ${mode==='pvp'?'雙人演武':m.id==='courtyard'?'1 隻妖獸':m.id==='bamboo'?'2 隻妖獸':'3 隻妖獸'}</span></button>`).join('')}</div>
    <label class="tc-label">${esc(core.name)} · 已裝配神通</label><div class="tc-equipped-skill"><b>${esc(chosen.skill.name)} · ${chosen.skill.cost} 體力</b><p>${esc(chosen.skill.description)}</p><small>分支於元神頁面調整，進場自動沿用。</small></div>
    <button type="button" class="tc-primary" data-start ${busy?'disabled':''}>${mode==='pve'?'進入戰場 · 問道獵妖':'尋找道友 · 開始鬥法'}</button>
    ${mode==='pvp'?'<div class="tc-join"><input data-code aria-label="戰場代碼" maxlength="22" placeholder="輸入道友的 16 碼戰場代碼"><button type="button" data-join>加入</button></div><p class="tc-muted">配對同一戰場的道友，或將戰場代碼分享給朋友。每人行動時間兩分鐘。</p>':'<p class="tc-muted">怪物會預告下一次攻擊的位置。紅格是危險區域，可以先移開再出招。</p>'}
    <details class="tc-codex"><summary>查看九丹十八條技能分支</summary>${Object.entries(R.CORES).filter(([key])=>key!=='none').map(([,c])=>`<section><h3>${esc(c.name)}</h3>${c.branches.map(b=>`<p><b>${esc(b.name)} · ${esc(b.skill.name)}</b> ${esc(b.skill.description)}</p>`).join('')}</section>`).join('')}</details></div>`;
}
function buildGame(){
  destroyRenderer();$('[data-main]').className='tc-main tc-game';
  $('[data-main]').innerHTML=`<section class="tc-arena"><div class="tc-arena-heading"><span data-map-name></span><span>紅格：妖獸預告 · 紫格：隕星</span></div><canvas tabindex="0" aria-label="方格戰場；點選地格或使用方向鍵選擇目標"></canvas><div class="tc-selection" data-selection>點選地格，預覽路線與體力消耗</div></section>
    <aside class="tc-sidebar"><div class="tc-actors" data-actors></div><section class="tc-command"><div class="tc-stamina" data-stamina></div><button type="button" class="tc-primary" data-quiz>答題補充體力</button><div class="tc-action-tabs"><button type="button" data-action="move">移動</button><button type="button" data-action="attack">攻擊 · 2</button><button type="button" data-action="skill">金丹技能</button></div><div class="tc-skill-info" data-skill></div><button type="button" class="tc-confirm" data-execute>選擇目標</button><div class="tc-turn-buttons"><button type="button" data-guard>護身 · 免費</button><button type="button" data-end>結束回合 →</button></div></section>
    <div class="tc-log" data-log role="log" aria-label="戰況紀錄"></div><div class="tc-game-footer"><button type="button" data-sync>重新同步</button><button type="button" data-leave>離開戰場</button></div></aside>`;
  renderer=new TacticalRenderer($('canvas'),p=>{if(!busy){selection=p;updateControls();renderer.update(state,uid,action,selection);}});
}
function paint(){
  if(!state)return renderHub();hideModal();
  $('[data-title]').textContent=state.mode==='pve'?'問道試煉':'鬥法論道';
  if(state.status==='waiting'){
    destroyRenderer();$('[data-main]').className='tc-main tc-waiting';
    $('[data-main]').innerHTML=`<div><small>演武庭已備妥</small><h2>靜候道友入場</h2><p>正在尋找同一戰場的道友，也可以分享代碼邀請朋友。</p><code>${esc(state.id.replace('arena-',''))}</code><button type="button" data-copy>複製戰場代碼</button><p class="tc-muted">${esc(R.mapFor(state.map).name)} · ${state.width} × ${state.height}</p><button type="button" data-leave>取消配對</button></div>`;return;
  }
  if(!$('canvas'))buildGame();
  const me=state.actors.find(a=>a.uid===uid),myTurn=state.turnUid===uid&&state.status==='active';
  $('[data-map-name]').textContent=(state.trial?'第 '+state.trial.stage+' 關 · '+state.trial.title:R.mapFor(state.map).name)+' · '+state.width+' × '+state.height;
  $('[data-actors]').innerHTML=state.actors.map(a=>`<div class="tc-actor ${a.uid===uid?'is-self':''} ${a.hp<=0?'is-down':''}"><div><b>${esc(a.name)}</b><span>${a.uid===uid?'我方':a.bot?'妖獸':'對手'}</span></div><div class="tc-health"><i style="width:${a.hp/a.maxHp*100}%"></i></div><small>${a.hp} / ${a.maxHp}${a.shield?' · 護盾 '+a.shield:''}${a.slow?' · 緩速':''}</small>${a.intent&&a.hp>0?'<p>'+esc(a.intent.text)+'</p>':''}</div>`).join('');
  $('[data-stamina]').innerHTML=`<b>體力 <strong>${me.stamina}</strong><span> / ${R.LIMITS.stamina}</span></b><div>${Array.from({length:10},(_,i)=>`<i class="${i<me.stamina?'filled':''}"></i>`).join('')}</div><small>本回合答題 ${me.questions}/2 · 攻擊／技能 ${me.attacks}/2</small>`;
  $('[data-quiz]').textContent=myTurn?`答題補充體力 · ${me.questions}/2`:'等待對手行動';
  $('[data-quiz]').disabled=!myTurn||busy||me.questions>=2||me.stamina>=10;
  $('[data-guard]').disabled=!myTurn||busy||me.attacks>=2;$('[data-end]').disabled=!myTurn||busy;
  $('[data-log]').innerHTML=state.events.slice(-5).map(e=>`<p class="is-${esc(e.type)}">${esc(e.text)}</p>`).join('');
  updateControls();renderer.update(state,uid,action,selection);updateClock();
  if(state.status==='finished')resultDialog();
}
function updateControls(){
  if(!$('[data-selection]')||!state)return;
  const me=state.actors.find(a=>a.uid===uid),mine=state.status==='active'&&state.turnUid===uid,sk=R.branchFor(me).skill;
  const t=selection?R.at(state,selection):null;
  let label='選擇目標',error='';
  if(action==='move'&&selection){const path=R.path(state,me,selection,uid),cost=(path?.length-1)*(1+(me.slow||0));
    label=path&&path.length>1?`移動至此 · ${cost} 體力`:'無法移動至此';
    if(!path||path.length<2)error='此地格無法到達';else if(cost>me.stamina)error='體力不足';
  }else if(selection){
    const chosen=action==='attack'?R.BASIC:sk;label=chosen.name+' · '+chosen.cost+' 體力';
    try{R.validateSkill(state,me,chosen,selection);}catch(e){error=e.message;}
  }
  const cooling=Math.max(0,(me.cooldowns[sk.id]||0)-me.turns);
  $('[data-skill]').innerHTML=`<b>${esc(R.branchFor(me).name)} · ${esc(sk.name)} <span>${sk.cost} 體力${cooling?' · 冷卻 '+cooling+' 回合':''}</span></b><p>${esc(sk.description)}</p>`;
  $('[data-execute]').textContent=error||label;$('[data-execute]').disabled=!mine||busy||!selection||!!error||me.actions>=R.LIMITS.actions;
  root.querySelectorAll('[data-action]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.action===action));b.disabled=!mine||busy;});
  $('[data-selection]').textContent=selection?`地格 ${selection.x+1}, ${selection.y+1}${t?' · '+t.name+' · 生命 '+t.hp+'/'+t.maxHp:''}${error?' · '+error:''}`:mine?'點選地格，預覽路線與體力消耗':'對手正在思考。你可以查看戰場與攻擊預告。';
}
function updateClock(){
  if(!opened||!state)return;
  if(getMainUser()?.uid!==uid){state=null;close();return;}
  const mine=state.turnUid===uid,now=Date.now()+clockOffset;
  $('[data-turn]').textContent=state.status==='waiting'?'等待配對':state.status==='finished'?'戰鬥結束':
    `${state.trial?'第 '+state.trial.stage+' 關 · ':''}第 ${state.turn} 回合 · ${mine?'你的行動':'對手行動'}${state.deadlineMs?' · '+Math.max(0,Math.ceil((state.deadlineMs-now)/1000))+' 秒':''}`;
  if(state.status==='active'&&state.deadlineMs&&now>=state.deadlineMs&&!busy&&Date.now()>=deadlineSyncAt){deadlineSyncAt=Date.now()+retryMs;void sync();}
}
function showModal(html){
  modalOpen=true;$('[data-modal]').hidden=false;$('[data-modal]').innerHTML=`<section class="tc-dialog" role="dialog" aria-modal="true" tabindex="-1">${html}</section>`;
  $('[data-main]').inert=true;$('[data-close]').disabled=true;
  $('[data-modal] .tc-dialog').focus();window.quizMathTypeset?.($('[data-modal]'));
}
function hideModal(){if(!root)return;modalOpen=false;$('[data-modal]').hidden=true;$('[data-modal]').innerHTML='';$('[data-main]').inert=false;$('[data-close]').disabled=false;}
function resultDialog(){
  const me=state.actors.find(a=>a.uid===uid),win=state.winner===me.team,draw=state.winner==='draw',reward=state.rewards?.[uid];
  if(state.mode==='pve'){
    const stage=state.trial?.stage||1,next=state.nextStage||stage+1;
    showModal(`<small>問道試煉 · 第 ${stage} 關</small><h2>${win?'此關已破':'整裝再戰'}</h2><p>${win?'本關妖獸已盡，前方還有新的地勢與敵人。':'調整走位與體力分配，再次挑戰本關。'}</p><div class="tc-result-stats"><b>答對 ${me.correct} / ${me.answered}</b><b>生命 ${me.hp} / ${me.maxHp}</b></div><p>${reward?.gold?'獲得 '+reward.gold+' 靈石 · '+reward.cultivation+' 修為':'答題紀錄已保存。'}</p><button type="button" class="tc-primary" data-next-stage>${win?'前往第 '+next+' 關 →':'重試第 '+stage+' 關'}</button><button type="button" data-exit>返回宗門</button>`);return;
  }
  showModal(`<small>此戰已結算</small><h2>${draw?'平分秋色':win?'克敵制勝':'整裝再戰'}</h2><p>${state.finishReason==='timeout'?'連續兩次行動逾時，戰鬥結束。':state.finishReason==='forfeit'?'一方收法離場。':state.finishReason==='turn-limit'?'達到回合上限，以剩餘生命比例判定。':win?'你以走位與招式取得勝利。':'複習這次的攻擊範圍與體力分配，再次挑戰。'}</p><div class="tc-result-stats"><b>答對 ${me.correct} / ${me.answered}</b><b>生命 ${me.hp} / ${me.maxHp}</b></div><p>${reward?.gold?'獲得 '+reward.gold+' 靈石 · '+reward.cultivation+' 修為':'本場沒有額外通關獎勵；答題紀錄已保存。'}</p><button type="button" class="tc-primary" data-hub>返回演武司</button>`);
}
function leaveDialog(){
  if(state?.status==='finished')return state.mode==='pve'?resultDialog():renderHub();
  showModal(`<h2>${state?.status==='waiting'?'取消配對':'收法離場'}</h2><p>${state?.status==='waiting'?'取消後可以重新選擇戰場與技能分支。':'離場將結束這場戰鬥。按「收起」則能保留進度；雙人鬥法的行動時間仍會繼續。'}</p><button type="button" class="tc-primary" data-forfeit>${state?.status==='waiting'?'取消配對':'認輸並離開'}</button><button type="button" data-dismiss>繼續留在戰場</button>`);
}
function accept(next,serial){
  if(serial<appliedOp)return;appliedOp=serial;
  if(next&&state?.id===next.id&&next.revision<state.revision)return;
  if(next?.serverNowMs)clockOffset=next.serverNowMs-Date.now();
  applyProgress(next);
  state=next;selection=null;paint();
}
function applyProgress(next){
  if(!next?.progress||getMainUser()?.uid!==uid)return;const local=localUser();local.stats||={};
  Object.assign(local.stats,next.progress.stats);if(next.progress.questProgress)local.questProgress=next.progress.questProgress;
  if(next.progress.tacticalTrialV1)local.tacticalTrialV1=next.progress.tacticalTrialV1;
  window.dispatchEvent(new CustomEvent('xiuxian:stats-updated',{detail:{totalScore:local.stats.totalScore,gold:local.stats.gold,source:'tactical'}}));
  window.refreshXiuxianLiveSync?.(local.stats.totalScore);window.updateUIStats?.();window.renderKnowledgeGraph?.();
}
async function task(work,{render=true}={}){
  if(busy)return;busy=true;const e=epoch,account=uid,serial=++op;notice('');
  if(state&&$('canvas'))paint();
  try{const next=await work();if(!valid(e,account))return;
    retryMs=4000;if(render)accept(next,serial);return next;
  }catch(err){if(valid(e,account)){notice(err.message);retryMs=Math.min(30000,retryMs*2);}}
  finally{if(valid(e,account)){busy=false;if(state&&$('canvas')&&!modalOpen)paint();else root?.querySelectorAll('[data-start]').forEach(b=>b.disabled=false);schedule();}}
}
async function start(code=''){
  await task(async()=>{const result=await api('/api/tactical/start',{mode,map,...(code?{code}:{})});return result.state;});
}
async function sync(){await task(async()=>{const result=await api('/api/tactical/state');return result.state;});}
async function send(command){
  if(!state)return;
  // Retrying the same command uses the same idempotency key after a lost response.
  const request={...command,roomId:state.id,revision:state.revision,requestId:id()};
  await task(async()=>{
    try{return (await api('/api/tactical/action',request)).state;}
    catch(err){if(!err.status||err.status>=500){try{return (await api('/api/tactical/action',request)).state;}catch(_){}}
      if(err.status===409){const latest=await api('/api/tactical/state');if(latest.state)state=latest.state;}throw err;}
  });
}
async function execute(){if(selection)await send({type:action,x:selection.x,y:selection.y});}
async function question(){
  if(!state||busy)return;
  const e=epoch,account=uid;
  busy=true;notice('');showModal('<small>以學御法</small><h2>凝神問道</h2><p>正在準備題目…</p><button type="button" data-dismiss>先返回戰場</button>');
  try{
    const q=state.question||(await api('/api/generate-quiz',{quizMode:'tactical',roomId:state.id})).tacticalQuestion;
    if(!valid(e,account))return;if(!q)throw Error('題目尚未準備完成，請重試');state.question=q;
    if(modalOpen)paintQuestion(q);
  }catch(err){if(valid(e,account))showModal('<h2>題目尚未就緒</h2><p>'+esc(err.message)+'</p><button type="button" data-dismiss>返回戰場後重試</button>');}
  finally{if(valid(e,account)){busy=false;updateControls();const button=$('[data-quiz]');if(button)button.disabled=state.turnUid!==uid||state.actors.find(a=>a.uid===uid).questions>=2;schedule();}}
}
function paintQuestion(q){
  showModal(`<div class="tc-dialog-heading"><small>${esc(q.subject)} · 答對 +4 / 答錯 +1 體力</small><button type="button" data-dismiss aria-label="返回戰場">×</button></div><h2 class="tc-question">${rich(q.q)}</h2><div class="tc-options">${q.opts.map((v,i)=>`<button type="button" data-choice="${i}"><span>${String.fromCharCode(65+i)}</span><div>${rich(v)}</div></button>`).join('')}</div><p class="tc-muted">每回合最多答兩題；體力上限 10。</p>`);
}
async function answer(choice){
  if(busy||!state?.question)return;busy=true;const e=epoch,account=uid,q=state.question,serial=++op;
  root.querySelectorAll('[data-choice]').forEach(b=>b.disabled=true);
  try{
    const result=await api('/api/tactical/answer',{roomId:state.id,questionId:q.id,choice});
    if(!valid(e,account))return;
    state=result.state;applyProgress(state);clockOffset=state.serverNowMs-Date.now();appliedOp=serial;const review=state.review;
    window.QAGameAudio?.answer(review.correct,'tactical:'+state.id+':'+q.id);
    showModal(`<small>體力 +${review.gain}</small><h2 class="${review.correct?'tc-correct':'tc-wrong'}">${review.correct?'靈思通明':'訂正後再出發'}</h2><div class="tc-review-question">${rich(review.q)}</div><div class="tc-review-options">${review.opts.map((v,i)=>`<p class="${i===review.answerIndex?'is-correct':i===review.choice?'is-wrong':''}">${String.fromCharCode(65+i)}. ${rich(v)}${i===review.answerIndex?' ✓':''}</p>`).join('')}</div><div class="tc-explanation">${rich(review.explanation)}</div><button type="button" class="tc-primary" data-continue>返回戰場 · 使用體力</button>`);
    renderer?.update(state,uid,action,null);
  }catch(err){if(valid(e,account)){
    const message=document.createElement('p');message.className='tc-wrong';message.setAttribute('role','alert');message.textContent=err.message+'；可再按一次答案重試，體力不會重複計算。';
    $('[data-modal] .tc-dialog')?.append(message);root.querySelectorAll('[data-choice]').forEach(b=>b.disabled=false);
  }}
  finally{if(valid(e,account)){busy=false;updateControls();schedule();}}
}
function schedule(){
  clearTimeout(poll);if(!opened||document.hidden||!state||state.status==='finished')return;
  if(state.status==='waiting')poll=setTimeout(()=>{if(!busy)void start();else schedule();},Math.max(6000,retryMs));
  else if(state.mode==='pvp'&&state.turnUid!==uid)poll=setTimeout(()=>{if(!busy)void sync();else schedule();},retryMs);
}
async function enterTrial(e,account){
  // Start preparation immediately while the existing full-screen clouds close.
  // Resolve failures into values so a slow curtain cannot cause an unhandled rejection.
  const prepared=api('/api/tactical/start',{mode:'pve'}).then(value=>({value}),error=>({error}));
  const reveal=async()=>{
    const result=await prepared;if(!valid(e,account))return;
    if(result.error)throw result.error;
    root.hidden=false;accept(result.value.state,++op);$('[data-close]').focus();
  };
  try{
    if(typeof window.playStartupCloudCurtain==='function')await window.playStartupCloudCurtain(reveal,{isCurrent:()=>valid(e,account),blockInput:true});
    else await reveal();
  }catch(error){
    if(!valid(e,account))return;
    root.hidden=false;hideModal();destroyRenderer();$('[data-title]').textContent='問道試煉';$('[data-turn]').textContent='';
    $('[data-main]').className='tc-main tc-waiting';
    $('[data-main]').innerHTML=`<div><h2>暫時未能進入試煉</h2><p>${esc(error.message)}</p><button type="button" class="tc-primary" data-retry-entry>重新進入</button><button type="button" data-exit>返回宗門</button></div>`;
  }finally{
    if(valid(e,account)){busy=false;if($('canvas'))paint();schedule();}
  }
}
async function open(nextMode='pve'){
  ensure();
  if(nextMode==='pve'&&trialEntry?.uid===getMainUser()?.uid)return trialEntry.promise;
  lastTrigger=document.activeElement;mode=nextMode;
  const accountUid=getMainUser()?.uid||'';if(uid!==accountUid)state=null;uid=accountUid;
  if(!uid){window.showToast?.('請先登入後進入戰場');return;}
  epoch++;opened=true;busy=true;op=0;appliedOp=0;document.body.classList.add('tactical-open');
  clearInterval(clock);clock=setInterval(updateClock,1000);
  const e=epoch,account=uid;
  if(nextMode==='pve'){
    const promise=enterTrial(e,account);trialEntry={uid:account,promise};
    try{await promise;}finally{if(trialEntry?.promise===promise)trialEntry=null;}
    return;
  }
  root.hidden=false;renderHub();$('[data-close]').focus();
  try{const result=await api('/api/tactical/state');if(!valid(e,account))return;state=result.state;applyProgress(state);if(state?.serverNowMs)clockOffset=state.serverNowMs-Date.now();
    if(state&&['active','waiting'].includes(state.status)){mode=state.mode;map=state.map;paint();}else renderHub();schedule();
  }catch(err){if(valid(e,account))notice(err.message);}
  finally{if(valid(e,account)){busy=false;if(state&&['active','waiting'].includes(state.status))paint();else renderHub();schedule();}}
}
function close(){
  if(!root)return;epoch++;opened=false;busy=false;clearTimeout(poll);clearInterval(clock);hideModal();destroyRenderer();
  root.hidden=true;document.body.classList.remove('tactical-open');lastTrigger?.focus?.();
}
window.openTacticalCombat=open;
window.startQuizFlow=()=>open('pve');
window.startBattleMatchmaking=()=>open('pvp');
window.joinBattleRoomV2=code=>{void open('pvp').then(()=>{if(valid(epoch,uid))void start(String(code||''));});};
window.addEventListener('xiuxian:user-data-ready',()=>{if(opened&&getMainUser()?.uid!==uid){state=null;close();}});
document.addEventListener('visibilitychange',()=>{if(!opened)return;if(document.hidden)clearTimeout(poll);else void sync();});
export {open as openTacticalCombat};
