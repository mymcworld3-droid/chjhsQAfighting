import './weapon-system-rules.js';
import './tactical-rules.js';
import {TacticalRenderer} from './tactical-renderer.js';
import {EnemyDemo} from './tactical-enemy-demo.js';
import {authenticatedMainFetch,getMainUser} from './data/project-repository.js';

const R=globalThis.QATactical;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rich=v=>window.quizMathRichText?.(String(v||''))||esc(v);
const id=()=>globalThis.crypto.randomUUID();
const localUser=()=>window.getCurrentUserData?.()||{};
let root=null,renderer=null,state=null,mode='pve',map='courtyard',action='move',selection=null,trialEntry=null;
let opened=false,busy=false,epoch=0,uid='',poll=null,clock=null,retryMs=4000,op=0,appliedOp=0;
let modalOpen=false,lastTrigger=null,clockOffset=0,deadlineSyncAt=0,introDemo=null;
let autoQuizKey='',quizContext=null;
const $=selector=>root?.querySelector(selector);
const myActor=()=>state?.actors.find(a=>a.uid===uid);
const myAction=()=>state?.status==='active'&&state.turnUid===uid&&(!state.quizRound||state.phase==='action');
function canQuestion(){try{R.canAnswer(state,uid,Date.now()+clockOffset);return !!state.quizRound||myActor().stamina<10;}catch(_){return false;}}

async function api(path,body,signal){
  const response=await authenticatedMainFetch(path,{...(body?{method:'POST',body:JSON.stringify(body)}:{method:'GET'}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(65000)]):AbortSignal.timeout(65000)});
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
  root.innerHTML=`<header class="tc-top"><h1 data-title>問道試煉</h1><div class="tc-top-right"><span data-turn></span><button type="button" data-close aria-label="收起戰場">收起</button></div></header>
    <div class="tc-notice" data-notice role="status" hidden></div><div class="tc-main" data-main role="region" aria-label="戰場內容"></div><div class="tc-modal" data-modal hidden></div>`;
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
    else if(b.hasAttribute('data-intro-ack'))void acknowledgeIntro();
    else if(b.dataset.action){action=b.dataset.action;selection=null;
      const me=state?.actors.find(a=>a.uid===uid);if(me&&(action==='skill'&&R.branchFor(me).skill.range===0||action==='attack'&&R.basicFor(me).kind==='ring'))selection={x:me.x,y:me.y};
      updateControls();renderer?.update(state,uid,action,selection);}
    else if(b.hasAttribute('data-execute'))void execute();
    else if(b.hasAttribute('data-guard'))void send({type:'guard'});
    else if(b.hasAttribute('data-end'))void send({type:'end'});
    else if(b.hasAttribute('data-quiz'))void question();
    else if(b.hasAttribute('data-dismiss')){hideModal();if(state&&$('canvas'))paint();}
    else if(b.hasAttribute('data-continue')){if(state.quizRound&&canQuestion())void question();else{hideModal();paint();}}
    else if(b.hasAttribute('data-helper-toggle'))openQuestionTool('helper');
    else if(b.hasAttribute('data-tool-close'))closeQuestionTool();
    else if(b.dataset.helperPreset){$('[data-helper-input]').value=b.dataset.helperPreset;void askHelper();}
    else if(b.hasAttribute('data-helper-send'))void askHelper();
    else if(b.hasAttribute('data-report-toggle'))openQuestionTool('report');
    else if(b.hasAttribute('data-report-send'))void reportQuestion();
    else if(b.hasAttribute('data-leave'))leaveDialog();
    else if(b.hasAttribute('data-forfeit')){hideModal();void send({type:'leave'});}
    else if(b.dataset.choice!==undefined)void answer(Number(b.dataset.choice));
    else if(b.hasAttribute('data-copy'))void navigator.clipboard?.writeText(state.id.replace('arena-','')).then(()=>notice('戰場代碼已複製')).catch(()=>notice('請長按上方代碼複製'));
  });
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();if($('[data-question-tool]:not([hidden])')){closeQuestionTool();return;}$('[data-intro-ack]')?close():modalOpen?hideModal():close();}
    if(event.key==='Tab'){
      const scope=$('[data-question-tool]:not([hidden])')||(modalOpen?$('[data-modal]'):root),focusable=[...scope.querySelectorAll('button:not(:disabled),input,textarea,canvas[tabindex],summary')].filter(el=>el.getClientRects().length);
      if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&(document.activeElement===first||!scope.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
}
function destroyRenderer(){renderer?.destroy();renderer=null;}
function renderHub(){
  destroyRenderer();const c=selectedCore(),core=R.CORES[c];
  const chosen=R.savedBranch(localUser(),c);
  $('[data-title]').textContent='鬥法論道';$('[data-turn]').textContent='';
  $('[data-main]').className='tc-main tc-hub';
  $('[data-main]').innerHTML=`<div class="tc-hub-config">
    ${state&&['active','waiting'].includes(state.status)?'<button type="button" data-resume>繼續戰鬥</button>':''}
    <span class="tc-label" id="tc-map-label">戰場</span><div class="tc-maps" role="group" aria-labelledby="tc-map-label">${R.MAPS.map(m=>`<button type="button" data-map="${m.id}" aria-pressed="${map===m.id}"><b>${m.name}</b></button>`).join('')}</div>
    <details class="tc-equipped-skill"><summary>${esc(chosen.skill.name)}<span>${chosen.skill.cost} 體力</span></summary><p>${esc(core.name)} · ${esc(chosen.skill.description)}</p><small>沿用已裝配分支，可於元神頁面調整。</small></details>
    <button type="button" class="tc-primary" data-start ${busy?'disabled':''}>開始配對</button>
    <div class="tc-join"><input data-code aria-label="戰場代碼" maxlength="22" placeholder="輸入道友的戰場代碼"><button type="button" data-join>加入</button></div>
    <details class="tc-codex"><summary>玩法說明</summary><p>每輪各答兩題，先答完者先行動；對手須在 50 秒內完成答題。每人行動 30 秒。</p><p>答對 +4 體力，答錯 +1，上限 10。每格移動消耗 1 體力，攻擊依兵器消耗；每回合最多攻擊或施法兩次，剩餘體力可保留。</p><p>灰格可移動，紅格為攻擊範圍，紅框為怪物攻擊預告。</p></details>
    <details class="tc-codex"><summary>金丹技能</summary>${Object.entries(R.CORES).filter(([key])=>key!=='none').map(([,c])=>`<section><h3>${esc(c.name)}</h3>${c.branches.map(b=>`<p><b>${esc(b.name)} · ${esc(b.skill.name)}</b> ${esc(b.skill.description)}</p>`).join('')}</section>`).join('')}</details></div>`;
}
function buildGame(){
  destroyRenderer();$('[data-main]').className='tc-main tc-game';
  $('[data-main]').innerHTML=`<section class="tc-arena"><div class="tc-arena-heading"><span data-map-name></span><span data-range-legend></span></div><canvas tabindex="0" aria-label="方格戰場；點選灰格移動或紅格攻擊，也可使用方向鍵選擇目標"></canvas><div class="tc-selection" data-selection role="status" aria-live="polite" aria-atomic="true">點選地格，預覽路線與體力消耗</div></section>
    <aside class="tc-sidebar"><div class="tc-actors" data-actors></div><section class="tc-command"><div class="tc-stamina" data-stamina></div><button type="button" data-quiz>答題</button><div class="tc-action-tabs"><button type="button" data-action="move">移動</button><button type="button" data-action="attack">攻擊 · 2</button><button type="button" data-action="skill">技能</button></div><button type="button" class="tc-confirm" data-execute>選擇目標</button><details class="tc-skill-info"><summary data-skill-title>操作說明</summary><div data-skill></div></details><div class="tc-turn-buttons"><button type="button" data-guard>護身</button><button type="button" data-end>結束回合</button></div></section>
    <div class="tc-game-footer"><details class="tc-history"><summary>戰況與詳情</summary><div class="tc-combat-info" data-combat-info></div><div class="tc-log" data-log role="log" aria-label="戰況紀錄"></div></details><button type="button" data-sync>同步</button><button type="button" data-leave>離開</button></div></aside>`;
  renderer=new TacticalRenderer($('canvas'),p=>{if(!busy){selection=p;updateControls();renderer.update(state,uid,action,selection);}},()=>{
    if(!opened||!state||!renderer)return;updateControls();
    if(!renderer.isAnimating&&state.status==='finished'&&!modalOpen)resultDialog();
    else if(!renderer.isAnimating&&!modalOpen&&state.quizRound)schedule();
  });
}
function paint({preserveModal=false}={}){
  if(!state)return renderHub();if(!preserveModal)hideModal();
  $('[data-title]').textContent=state.mode==='pve'?'問道試煉':'鬥法論道';
  if(state.status==='waiting'){
    destroyRenderer();$('[data-main]').className='tc-main tc-waiting';
    $('[data-main]').innerHTML=`<div><h2>配對中…</h2><p>也可將代碼傳給道友加入。</p><code>${esc(state.id.replace('arena-',''))}</code><button type="button" data-copy>複製代碼</button><button type="button" data-leave>取消配對</button></div>`;return;
  }
  if(!renderer||!$('canvas'))buildGame();
  const me=myActor(),myTurn=myAction();
  $('[data-map-name]').textContent=state.trial?'第 '+state.trial.stage+' 關 · '+state.trial.title:R.mapFor(state.map).name;
  $('[data-actors]').innerHTML=state.actors.map(a=>`<div class="tc-actor ${a.uid===uid?'is-self':''} ${a.hp<=0?'is-down':''}" aria-label="${esc(a.name)}，生命 ${a.hp} / ${a.maxHp}"><div><b>${esc(a.name)}</b><span>${a.hp}/${a.maxHp}</span></div><div class="tc-health"><i style="width:${a.hp/a.maxHp*100}%"></i></div>${a.shield||a.slow||a.weapon&&a.uid===uid?`<small>${[a.shield?'護盾 '+a.shield:'',a.slow?'緩速':'',a.weapon&&a.uid===uid?esc(globalThis.QAWeapons.get(a.weapon.type).label)+' · '+globalThis.QAWeapons.realmFor(a.weapon).name+'境':''].filter(Boolean).join(' · ')}</small>`:''}</div>`).join('');
  $('[data-combat-info]').innerHTML=state.actors.filter(a=>a.hp>0&&(a.intent||a.weapon)).map(a=>`<p><b>${esc(a.name)}</b>${a.weapon?esc(globalThis.QAWeapons.get(a.weapon.type).name)+' · '+globalThis.QAWeapons.realmFor(a.weapon).name+'境':''}${a.intent?'<span>'+esc(a.intent.text)+'</span>':''}</p>`).join('');
  $('[data-stamina]').innerHTML=`<b>體力 <strong>${me.stamina}</strong><span> / ${R.LIMITS.stamina}</span></b><div>${Array.from({length:10},(_,i)=>`<i class="${i<me.stamina?'filled':''}"></i>`).join('')}</div><small>出手 ${me.attacks}/2</small>`;
  $('[data-quiz]').textContent=canQuestion()?`答題 ${me.questions}/2`:state.quizRound&&me.questions>=2?'答題完成':myTurn?'無法再答題':'等待對手';
  $('[data-log]').innerHTML=state.events.slice(-5).map(e=>`<p class="is-${esc(e.type)}">${esc(e.text)}</p>`).join('');
  renderer.update(state,uid,action,selection);updateControls();updateClock();
  if(state.status==='finished'&&!renderer.isAnimating&&!modalOpen)resultDialog();
  else if(state.mode==='pve'&&state.newEnemies?.length)showEnemyIntro();
}
function updateControls(){
  if(!$('[data-selection]')||!state)return;
  const me=myActor(),mine=myAction(),sk=R.branchFor(me).skill,animating=renderer?.isAnimating,locked=busy||animating;
  $('[data-quiz]').disabled=!canQuestion()||locked;
  $('[data-guard]').disabled=!mine||locked||me.attacks>=2;$('[data-end]').disabled=!mine||locked;
  $('[data-sync]').disabled=locked;root.classList.toggle('tc-animating',!!animating);
  $('[data-stamina]').classList.toggle('tc-gaining',!modalOpen&&renderer?.currentKind==='answer');
  const t=selection?R.at(state,selection):null;
  const basic=R.basicFor(me),directional=['line','cleave'].includes(basic.kind);
  $('[data-action="attack"]').textContent=`${me.weapon?globalThis.QAWeapons.get(me.weapon.type).label:'攻擊'} · ${basic.cost}`;
  let label=action==='attack'?(directional?'選擇攻擊方向':basic.kind==='ring'?'震擊周圍':'選擇敵人'):action==='move'?'選擇移動位置':'選擇施放位置',error='';
  const d=selection&&(basic.kind==='cleave'||selection.x===me.x||selection.y===me.y)?R.attackDirection(me,selection):null;
  const direction=d?(d.x>0?'右':d.x<0?'左':d.y>0?'下':'上'):'';
  if(action==='move'&&selection){const path=R.path(state,me,selection,uid),cost=(path?.length-1)*(1+(me.slow||0));
    label=path&&path.length>1?`移動至此 · ${cost} 體力`:'無法移動至此';
    if(!path||path.length<2)error='此地格無法到達';else if(cost>me.stamina)error='體力不足';
  }else if(selection){
    const chosen=action==='attack'?basic:sk;label=(action==='attack'&&directional&&direction?'向'+direction+'攻擊':chosen.name)+' · '+chosen.cost+' 體力';
    try{R.validateSkill(state,me,chosen,selection);}catch(e){error=e.message;}
  }
  const cooling=Math.max(0,(me.cooldowns[sk.id]||0)-me.turns);
  const shown=action==='attack'?basic:sk;
  $('[data-skill-title]').textContent=action==='move'?'移動說明':`${shown.name} · ${shown.cost} 體力${action==='skill'&&cooling?' · 冷卻 '+cooling+' 回合':''}`;
  $('[data-skill]').innerHTML=action==='move'?'<p>每格消耗 1 體力；緩速時消耗增加。選好位置後按下移動確認。</p>':`<p>${esc(shown.description)}</p>`;
  $('[data-execute]').textContent=error||label;$('[data-execute]').disabled=!mine||locked||!selection||!!error||me.actions>=R.LIMITS.actions;
  root.querySelectorAll('[data-action]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.action===action));b.disabled=!mine||locked;});
  $('[data-range-legend]').textContent=(action==='move'?'灰格可走':'紅格射程')+' · 紅框預告';
  const hint=action==='move'?'點選灰格移動':action==='attack'?(directional?'點選紅格，選擇攻擊方向':'點選紅格內的敵人'):sk.range===0?'按下確認施放技能':'點選紅格施放技能';
  $('[data-selection]').textContent=selection?`${action==='attack'&&basic.kind==='ring'?'震擊周圍一圈 · '+R.skillCells(state,me,basic,selection).length+' 格':action==='attack'&&directional&&direction?'向'+direction+'攻擊 '+R.skillCells(state,me,basic,selection).length+' 格':t?`${t.name} · 生命 ${t.hp}/${t.maxHp}`:`位置 ${selection.x+1}, ${selection.y+1}`}${error?' · '+error:''}`:mine?hint:'等待對手行動';
  if(animating)$('[data-selection]').textContent=renderer.currentAction;
}
function updateClock(){
  if(!opened||!state)return;
  if(getMainUser()?.uid!==uid){state=null;close();return;}
  const mine=state.turnUid===uid,now=Date.now()+clockOffset;
  const answerLeft=state.answerDeadlineMs?Math.max(0,Math.ceil((state.answerDeadlineMs-now)/1000)):null;
  const quizPending=state.quizRound&&myActor().questions<2&&!myActor().quizExpired;
  const quizLabel=quizPending?`答題 ${myActor().questions}/2${answerLeft!==null?' · 剩 '+answerLeft+' 秒':' · 雙方同時作答'}`:'';
  $('[data-turn]').textContent=state.status==='waiting'?'等待配對':state.status==='finished'?'戰鬥結束':state.quizRound?
    `第 ${state.quizRound} 輪 · ${quizLabel||state.phase==='answer'&&'雙方答題'||state.phase==='waiting-answer'&&'等待對手完成答題'||(mine?'你的行動':'對手行動')}${state.phase==='action'?' · 行動 '+Math.max(0,Math.ceil((state.deadlineMs-now)/1000))+' 秒':''}`:
    `${state.trial?'第 '+state.trial.stage+' 關 · ':''}第 ${state.turn} 回合 · ${mine?'你的行動':'對手行動'}${state.deadlineMs?' · '+Math.max(0,Math.ceil((state.deadlineMs-now)/1000))+' 秒':''}`;
  $('[data-quiz-clock]')?.replaceChildren(document.createTextNode(quizLabel||'兩題已完成'));
  const answerExpired=state.answerDeadlineMs&&now>=state.answerDeadlineMs&&state.actors.some(a=>a.questions<2&&!a.quizExpired);
  if(state.status==='active'&&(state.deadlineMs&&now>=state.deadlineMs||answerExpired)&&!busy&&Date.now()>=deadlineSyncAt){deadlineSyncAt=Date.now()+retryMs;void sync();}
}
function showModal(html,{quiz=false,encounter=false}={}){
  introDemo?.destroy();introDemo=null;
  modalOpen=true;$('[data-modal]').hidden=false;$('[data-modal]').innerHTML=`<section class="tc-dialog${quiz?' tc-quiz':''}${encounter?' tc-encounter':''}" role="dialog" aria-modal="true" tabindex="-1">${html}</section>`;
  $('[data-main]').inert=true;$('[data-close]').disabled=true;renderer?.setPaused(true);
  $('[data-modal] .tc-dialog').focus();window.quizMathTypeset?.($('[data-modal]'));
}
function hideModal(){if(!root)return;introDemo?.destroy();introDemo=null;modalOpen=false;$('[data-modal]').hidden=true;$('[data-modal]').innerHTML='';$('[data-main]').inert=false;$('[data-close]').disabled=false;renderer?.setPaused(false);}
function showEnemyIntro(error=''){
  const species=state.newEnemies[0],p=R.monsterProfile(species),remaining=state.newEnemies.length;
  showModal(`<div class="tc-enemy-heading"><div class="tc-enemy-portrait" role="img" aria-label="${esc(p.name)}" style="background-position:${species%5/4*100}% ${Math.floor(species/5)/3*100}%"></div><div><small>初遇妖獸${state.trial?' · 第 '+state.trial.stage+' 關':''}</small><h2>${esc(p.name)}</h2><p>第 ${p.unlockStage} 關起登場</p></div></div><div class="tc-enemy-body"><section class="tc-enemy-attack"><small>攻擊方式</small><h3>${esc(p.attackName)}</h3><p>${esc(p.attackText)}</p></section><figure class="tc-enemy-demo" data-enemy-demo><div class="tc-demo-heading"><b>招式演練</b><span data-demo-mode>自動循環</span></div><canvas role="img" aria-label="${esc(p.name)}的移動、命中與閃避模擬" data-demo-species="${species}"></canvas><figcaption data-demo-caption role="status" aria-live="polite"></figcaption><div class="tc-demo-tools"><span>紅框：攻擊預告 · 金圈：修士</span><button type="button" data-demo-toggle>暫停</button><button type="button" data-demo-next hidden>下一步</button><button type="button" data-demo-replay>重播</button></div></figure><dl class="tc-enemy-details"><dt>移動</dt><dd>${esc(p.moveText)}</dd><dt>應對</dt><dd>${esc(p.tip)}</dd></dl></div><p class="tc-enemy-error" role="alert" ${error?'':'hidden'}>${esc(error)}</p><div class="tc-enemy-footer"><button type="button" class="tc-primary" data-intro-ack ${busy?'disabled':''}>${remaining>1?'記住招式 · 下一種（'+(remaining-1)+'）':'記住招式 · 開始行動'}</button><button type="button" data-exit>收起試煉</button></div>`,{encounter:true});
  introDemo=new EnemyDemo($('[data-enemy-demo]'),species);
}
async function acknowledgeIntro(){
  if(busy||!state?.newEnemies?.length)return;
  const e=epoch,account=uid,serial=++op,species=state.newEnemies[0];let error='';busy=true;$('[data-intro-ack]').disabled=true;
  try{const result=await api('/api/tactical/acknowledge-enemy',{roomId:state.id,species});if(valid(e,account))accept(result.state,serial);}
  catch(err){error=err.message;}
  finally{if(valid(e,account)){busy=false;if(error&&state.newEnemies?.length)showEnemyIntro(error);else paint();schedule();}}
}
function resultDialog(){
  const me=state.actors.find(a=>a.uid===uid),win=state.winner===me.team,draw=state.winner==='draw',reward=state.rewards?.[uid];
  if(state.mode==='pve'){
    const stage=state.trial?.stage||1,next=state.nextStage||stage+1;
    showModal(`<small>問道試煉 · 第 ${stage} 關</small><h2>${win?'此關已破':'整裝再戰'}</h2><p>${win?'本關妖獸已盡，前方還有新的地勢與敵人。':'調整走位與體力分配，再次挑戰本關。'}</p><div class="tc-result-stats"><b>答對 ${me.correct} / ${me.answered}</b><b>生命 ${me.hp} / ${me.maxHp}</b></div><p>${reward?.gold?'獲得 '+reward.gold+' 靈石 · '+reward.cultivation+' 修為':'答題紀錄已保存。'}${state.weaponRewards?.[uid]?.chests?' · 兵器匣 ×'+state.weaponRewards[uid].chests+'（尋器頁開啟）':''}</p><button type="button" class="tc-primary" data-next-stage>${win?'前往第 '+next+' 關 →':'重試第 '+stage+' 關'}</button><button type="button" data-exit>返回宗門</button>`);return;
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
  const oldQuestion=state?.question?.id;
  const keepSelection=next?.quizRound&&next.id===state?.id&&next.actionRevision===state.actionRevision&&next.phase===state.phase&&next.turnUid===state.turnUid;
  state=next;if(!keepSelection)selection=null;
  if(modalOpen&&$('[data-choice]')&&oldQuestion&&!next?.question){hideModal();notice('本輪答題已結束，請查看戰場。');}
  paint({preserveModal:modalOpen});
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
  if(state&&$('canvas'))updateControls();
  try{const next=await work();if(!valid(e,account))return;
    retryMs=4000;if(render)accept(next,serial);return next;
  }catch(err){if(valid(e,account)){notice(err.message);retryMs=Math.min(30000,retryMs*2);}}
  finally{if(valid(e,account)){busy=false;if(state&&$('canvas')){updateControls();const acknowledge=$('[data-intro-ack]');if(acknowledge)acknowledge.disabled=false;}else root?.querySelectorAll('[data-start]').forEach(b=>b.disabled=false);schedule();}}
}
async function start(code=''){
  await task(async()=>{const result=await api('/api/tactical/start',{mode,map,...(code?{code}:{})});return result.state;});
}
async function sync(){await task(async()=>{const result=await api('/api/tactical/state?mode='+mode);return result.state;});}
async function send(command){
  if(!state||renderer?.isAnimating&&command.type!=='leave')return;
  // Retrying the same command uses the same idempotency key after a lost response.
  const request={...command,roomId:state.id,revision:state.revision,actionRevision:state.actionRevision,requestId:id()};
  await task(async()=>{
    try{return (await api('/api/tactical/action',request)).state;}
    catch(err){if(!err.status||err.status>=500){try{return (await api('/api/tactical/action',request)).state;}catch(_){}}
      if(err.status===409){const latest=await api('/api/tactical/state?mode='+mode);if(latest.state)accept(latest.state,++op);}throw err;}
  });
}
async function execute(){if(selection)await send({type:action,x:selection.x,y:selection.y});}
async function question(){
  if(!state||busy||!canQuestion()||renderer?.isAnimating&&!modalOpen)return;
  const e=epoch,account=uid;
  busy=true;notice('');showModal('<h2>正在準備題目…</h2><button type="button" data-dismiss>返回戰場</button>');
  try{
    const q=state.question||(await api('/api/generate-quiz',{quizMode:'tactical',roomId:state.id})).tacticalQuestion;
    if(!valid(e,account))return;if(!q)throw Error('題目尚未準備完成，請重試');state.question=q;
    if(modalOpen)paintQuestion(q);
  }catch(err){if(valid(e,account))showModal('<h2>題目尚未就緒</h2><p>'+esc(err.message)+'</p><button type="button" data-dismiss>返回戰場後重試</button>');}
  finally{if(valid(e,account)){busy=false;updateControls();schedule();}}
}
function questionSheet(q,review=null){
  return `<div class="glass-panel tc-question-sheet"><div class="quiz-card-tools"><span class="tc-question-badge">${esc([q.subject,q.topic].filter(Boolean).join(' · ')||'問道試煉')}</span></div><h3 class="tc-question">${rich(q.q)}</h3></div><div class="tc-options">${q.opts.map((v,i)=>`<button type="button" ${review?`disabled class="cursor-not-allowed ${i===review.answerIndex?'bg-green-600':i===review.choice?'bg-red-600':''}"`:`data-choice="${i}"`}><span>${String.fromCharCode(65+i)}</span><span class="quiz-rich-option">${rich(v)}${review&&i===review.answerIndex?' ✓':''}</span></button>`).join('')}</div>`;
}
function setQuizContext(q,review=null){
  if(quizContext?.id!==q.id||quizContext.roomId!==state.id){
    quizContext?.abort.abort();
    quizContext={id:q.id,roomId:state.id,q,review,owner:uid,epoch,abort:new AbortController(),messages:[],helperBusy:false,reportBusy:false};
  }else quizContext.review=review;
}
function quizTools(){
  if(state.mode!=='pve')return '';
  const message=(m)=>`<p class="quiz-helper-message ${m.role==='user'?'user':'assistant'}"><span class="quiz-helper-message-stack"><span class="quiz-helper-message-body">${m.role==='user'?esc(m.text):rich(m.text)}</span></span></p>`;
  return `<section class="tc-question-tools" aria-label="題目協助"><div class="tc-tools-buttons"><button type="button" class="btn-cyber-ghost" data-report-toggle aria-haspopup="dialog" aria-expanded="false"><i class="fa-solid fa-triangle-exclamation"></i> 問題回報</button><button type="button" class="btn-cyber-ghost" data-helper-toggle aria-haspopup="dialog" aria-expanded="false"><i class="fa-solid fa-comments"></i> 問道助手</button></div>
    <div class="tc-tool-overlay tc-report-overlay" data-question-tool="report" data-report-panel hidden><section class="tc-report-box glass-panel" role="dialog" aria-modal="true" aria-labelledby="tc-report-title"><h3 id="tc-report-title"><i class="fa-solid fa-triangle-exclamation"></i> 回報題目錯誤</h3><p>請簡述題目問題 (例如: 答案錯誤、選項重複、錯字)，AI 將進行嚴格審查。</p><label class="sr-only" for="tc-report-reason">問題描述（至少六個字）</label><textarea id="tc-report-reason" data-report-reason maxlength="1200" rows="4" placeholder="請輸入問題描述..."></textarea><p data-report-status role="status" aria-live="polite"></p><div class="tc-report-actions"><button type="button" class="btn-cyber-ghost" data-tool-close>取消</button><button type="button" class="btn-cyber-primary" data-report-send>送出審查</button></div></section></div>
    <div class="tc-tool-overlay tc-helper-overlay" data-question-tool="helper" data-helper-panel hidden><section class="quiz-helper-panel" role="dialog" aria-modal="true" aria-labelledby="tc-helper-title"><header class="quiz-helper-header"><div class="quiz-helper-heading"><span class="quiz-helper-avatar"><i class="fa-solid fa-user-graduate"></i></span><div><strong id="tc-helper-title">問道助手</strong><small>一起核對、討論題目</small></div></div><button type="button" class="quiz-helper-collapse" data-tool-close aria-label="關閉問道助手">×</button></header><div class="quiz-helper-messages" data-helper-messages role="log" aria-label="問道助手對話">${quizContext.messages.map(message).join('')}</div><div class="quiz-helper-prompts" aria-label="快速提問"><button type="button" data-helper-preset="給我一個提示，但不要直接告訴我答案。">給我提示</button><button type="button" data-helper-preset="這題應該先從哪個觀念開始？">從哪開始</button><button type="button" data-helper-preset="可以把這題拆成幾個步驟嗎？">拆解步驟</button><button type="button" data-helper-preset="請檢查題目條件和選項是否一致，作答前不要透露答案。">檢查題目</button></div><div class="quiz-helper-compose"><textarea id="tc-helper-input" data-helper-input maxlength="600" rows="1" placeholder="輸入你對這題的疑問…" aria-label="輸入對題目的疑問"></textarea><button type="button" data-helper-send aria-label="送出問題"><i class="fa-solid fa-paper-plane"></i></button></div><div class="quiz-helper-status" data-helper-status role="status" aria-live="polite"></div></section></div></section>`;
}
function openQuestionTool(kind){
  closeQuestionTool(false);
  const panel=$(`[data-${kind}-panel]`);if(!panel)return;
  panel.hidden=false;$(`[data-${kind}-toggle]`)?.setAttribute('aria-expanded','true');
  const column=$('.quiz-main-column');if(column)for(const child of column.children)if(!child.classList.contains('tc-question-tools'))child.inert=true;
  const heading=$('.tc-dialog-heading');if(heading)heading.inert=true;
  $(`[data-${kind==='helper'?'helper-input':'report-reason'}]`)?.focus();
}
function closeQuestionTool(restore=true){
  for(const kind of ['helper','report']){const panel=$(`[data-${kind}-panel]`);if(panel&&!panel.hidden){panel.hidden=true;const trigger=$(`[data-${kind}-toggle]`);trigger?.setAttribute('aria-expanded','false');if(restore)trigger?.focus();}}
  const column=$('.quiz-main-column');if(column)for(const child of column.children)child.inert=false;
  const heading=$('.tc-dialog-heading');if(heading)heading.inert=false;
}
function sameQuiz(ctx){return quizContext===ctx&&valid(ctx.epoch,ctx.owner);}
async function askHelper(){
  const ctx=quizContext,input=$('[data-helper-input]'),message=input?.value.trim().slice(0,600);
  if(!ctx||!message||ctx.helperBusy||state.mode!=='pve')return;
  const history=ctx.messages.slice(-6);ctx.messages.push({role:'user',text:message});ctx.helperBusy=true;
  const append=(role,text)=>{const row=document.createElement('p'),label=document.createElement('span'),body=document.createElement('span');row.className='quiz-helper-message '+(role==='user'?'user':'assistant');label.className='quiz-helper-message-stack';body.className='quiz-helper-message-body';if(role==='user')body.textContent=text;else body.innerHTML=rich(text);label.append(body);row.append(label);$('[data-helper-messages]')?.append(row);window.quizMathTypeset?.(body);};
  append('user',message);input.value='';$('[data-helper-send]').disabled=true;$('[data-helper-status]').textContent='問道助手正在思考…';
  try{
    const review=ctx.review,q=ctx.q;
    const result=await api('/api/question-helper',{question:q.q,options:q.opts,subject:q.subject,message,history,answered:!!review,
      explanation:review?.explanation||'',selectedOption:review?q.opts[review.choice]:'',correctOption:review?q.opts[review.answerIndex]:''},ctx.abort.signal);
    if(!sameQuiz(ctx))return;
    if(!result.answer)throw Error('問道助手暫時沒有回覆，請重試。');
    ctx.messages.push({role:'assistant',text:result.answer});append('assistant',result.answer);$('[data-helper-status]').textContent='';
    if(result.questionIssue?.confirmed)void reportQuestion(result.questionIssue.reason);
  }catch(err){if(sameQuiz(ctx)&&$('[data-helper-status]'))$('[data-helper-status]').textContent=err.message;}
  finally{ctx.helperBusy=false;if(sameQuiz(ctx)&&$('[data-helper-send]'))$('[data-helper-send]').disabled=false;}
}
async function reportQuestion(helperReason=''){
  const ctx=quizContext,reason=String(helperReason||$('[data-report-reason]')?.value||'').trim().slice(0,1200);
  if(!ctx||ctx.reportBusy||state.mode!=='pve')return;
  openQuestionTool('report');
  const status=$('[data-report-status]');if(reason.length<6){status.textContent='請至少用六個字具體指出題目錯誤。';return;}
  ctx.reportBusy=true;$('[data-report-send]').disabled=true;status.textContent='正在獨立審核題目…';
  try{
    const result=(await api('/api/tactical/report-question',{roomId:ctx.roomId,questionId:ctx.id,reason},ctx.abort.signal)).state;
    if(!valid(ctx.epoch,ctx.owner))return;
    if(result.battle&&state?.id===ctx.roomId)accept(result.battle,++op);
    if(!sameQuiz(ctx))return;
    const message=result.reason+(result.compensated?` 已補償 ${result.goldAdded} 靈石、${result.cultivationAdded} 修為。`:'')+
      (result.staminaRefunded>0?` 已返還 ${result.staminaRefunded} 體力。`:'');
    status.textContent=message;if(result.questionSkipped)notice(message);
    if(result.compensated&&!result.battle){const user=localUser();user.stats||={};user.stats.gold=result.newGold;user.stats.totalScore=result.newTotalScore;window.updateUIStats?.();window.refreshXiuxianLiveSync?.(result.newTotalScore);}
  }catch(err){if(sameQuiz(ctx))status.textContent=err.message+'，可再次送出重試。';}
  finally{ctx.reportBusy=false;if(sameQuiz(ctx)&&$('[data-report-send]'))$('[data-report-send]').disabled=false;}
}
function paintQuestion(q){
  setQuizContext(q);
  showModal(`<div class="tc-dialog-heading"><small>${state.quizRound?'<span data-quiz-clock></span>':'答題 '+myActor().questions+'/2 · 答對 +4／答錯 +1 體力'}</small><button type="button" data-dismiss aria-label="返回戰場">返回戰場</button></div><div class="quiz-main-column">${questionSheet(q)}${quizTools()}</div>`,{quiz:true});
  updateClock();
}
async function answer(choice){
  if(busy||!state?.question)return;busy=true;const e=epoch,account=uid,q=state.question,serial=++op;
  root.querySelectorAll('[data-choice]').forEach(b=>b.disabled=true);
  try{
    const result=await api('/api/tactical/answer',{roomId:state.id,questionId:q.id,choice});
    if(!valid(e,account))return;
    state=result.state;applyProgress(state);clockOffset=state.serverNowMs-Date.now();appliedOp=serial;const review=state.review;
    window.QAGameAudio?.answer(review.correct,'tactical:'+state.id+':'+q.id);
    setQuizContext(q,review);
    showModal(`<div class="tc-dialog-heading"><small>體力 +${review.gain}${state.quizRound?' · 已完成 '+myActor().questions+'/2':''}</small></div><div class="quiz-main-column">${questionSheet({...q,q:review.q,opts:review.opts},review)}<section class="glass-panel tc-feedback"><h3 class="tc-feedback-title ${review.correct?'tc-correct':'tc-wrong'}">${review.correct?'答對':'答錯'}</h3><div class="tc-explanation"><span class="tc-explanation-label">解析</span><div class="tc-feedback-text">${rich(review.explanation)}</div></div><button type="button" class="tc-primary" data-continue>${state.quizRound&&canQuestion()?'下一題':'返回戰場'}</button></section>${quizTools()}</div>`,{quiz:true});
    renderer?.update(state,uid,action,null);
  }catch(err){if(valid(e,account)){
    const message=document.createElement('p');message.className='tc-wrong';message.setAttribute('role','alert');message.textContent=err.message+'；可再按一次答案重試，體力不會重複計算。';
    $('[data-modal] .tc-dialog')?.append(message);root.querySelectorAll('[data-choice]').forEach(b=>b.disabled=false);
  }}
  finally{if(valid(e,account)){busy=false;updateControls();schedule();}}
}
function schedule(){
  clearTimeout(poll);if(!opened||document.hidden||!state||state.status==='finished')return;
  const key=state.id+':'+state.quizRound;
  if(state.quizRound&&!busy&&!modalOpen&&!renderer?.isAnimating&&canQuestion()&&autoQuizKey!==key){autoQuizKey=key;void question();return;}
  if(state.status==='waiting')poll=setTimeout(()=>{if(!busy)void start();else schedule();},Math.max(6000,retryMs));
  else if(state.mode==='pvp')poll=setTimeout(()=>{if(!busy)void sync();else schedule();},retryMs);
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
  if(opened&&mode==='pve'&&nextMode==='pve'&&trialEntry?.uid===getMainUser()?.uid)return trialEntry.promise;
  if(opened)close();
  lastTrigger=document.activeElement;mode=nextMode;root.dataset.mode=mode;
  const accountUid=getMainUser()?.uid||'';if(uid!==accountUid||state?.mode!==nextMode)state=null;uid=accountUid;
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
  try{const result=await api('/api/tactical/state?mode='+nextMode);if(!valid(e,account))return;state=result.state?.mode===nextMode?result.state:null;applyProgress(state);if(state?.serverNowMs)clockOffset=state.serverNowMs-Date.now();
    if(state&&['active','waiting'].includes(state.status)){map=state.map;paint();}else renderHub();schedule();
  }catch(err){if(valid(e,account))notice(err.message);}
  finally{if(valid(e,account)){busy=false;if(state&&['active','waiting'].includes(state.status))paint();else renderHub();schedule();}}
}
function close(){
  if(!root)return;quizContext?.abort.abort();quizContext=null;autoQuizKey='';epoch++;opened=false;busy=false;clearTimeout(poll);clearInterval(clock);hideModal();destroyRenderer();
  root.hidden=true;document.body.classList.remove('tactical-open');lastTrigger?.focus?.();
}
window.openTacticalCombat=open;
window.startQuizFlow=()=>open('pve');
window.startBattleMatchmaking=()=>open('pvp');
window.joinBattleRoomV2=code=>{void open('pvp').then(()=>{if(valid(epoch,uid))void start(String(code||''));});};
window.addEventListener('xiuxian:user-data-ready',()=>{if(opened&&getMainUser()?.uid!==uid){state=null;close();}});
document.addEventListener('visibilitychange',()=>{if(!opened)return;if(document.hidden)clearTimeout(poll);else void sync();});
export {open as openTacticalCombat};
