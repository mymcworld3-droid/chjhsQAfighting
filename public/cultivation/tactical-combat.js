import './tactical-rules.js';
import {TacticalRenderer} from './tactical-renderer.js?v=20261111-stamina-map-fullbleed2';
import {EnemyDemo} from './tactical-enemy-demo.js';
import {authenticatedMainFetch,getMainUser} from './data/project-repository.js';
import {beginSoloCultivationFeedback} from './solo-cultivation-feedback.js';

const R=globalThis.QATactical;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rich=v=>window.quizMathRichText?.(String(v||''))||esc(v);
const id=()=>globalThis.crypto.randomUUID();
const localUser=()=>window.getCurrentUserData?.()||{};
let root=null,renderer=null,state=null,mode='pve',map='courtyard',action='move',selection=null,trialEntry=null;
let attackChoice='attack',wheelIgnoreClickUntil=0;
let opened=false,busy=false,epoch=0,uid='',poll=null,clock=null,retryMs=4000,op=0,appliedOp=0;
let modalOpen=false,lastTrigger=null,clockOffset=0,deadlineSyncAt=0,introDemo=null;
let autoQuizKey='',quizContext=null;
let pairQuestions=[],pairChoices=[],pairReviews=[];
let pairWhiteboardIndex=-1,pairWhiteboardPointer=null;
const pairWhiteboardInk=new Map();
const $=selector=>root?.querySelector(selector);
const myActor=()=>state?.actors.find(a=>a.uid===uid);
const myAction=()=>state?.status==='active'&&state.turnUid===uid&&(!state.quizRound||state.phase==='action');
function canQuestion(){try{R.canAnswer(state,uid,Date.now()+clockOffset);return !!state.quizRound||myActor().stamina<10||!!state.question||!!state.questionFollowup;}catch(_){return false;}}

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
  if(!document.getElementById('tactical-quarter-style')){const link=document.createElement('link');link.id='tactical-quarter-style';link.rel='stylesheet';link.href='/styles/tactical-quarter-controls.css?v=20261111-stamina-double-wheel-v1';document.head.append(link);}
  if(!document.getElementById('tactical-pair-style')){const link=document.createElement('link');link.id='tactical-pair-style';link.rel='stylesheet';link.href='/styles/tactical-question-pair.css?v=20261111-freequiz-layout-v2';document.head.append(link);}
  root=document.createElement('section');root.id='tactical-combat';root.hidden=true;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','戰棋修行');
  root.innerHTML=`<header class="tc-top"><h1 data-title>問道試煉</h1><div class="tc-top-right"><span data-turn></span><button type="button" data-close aria-label="收起戰場">收起</button></div></header>
    <div class="tc-notice" data-notice role="status" hidden></div><div class="tc-main" data-main role="region" aria-label="戰場內容"></div><div class="tc-modal" data-modal hidden></div>`;
  document.body.append(root);$('[data-close]').onclick=close;
  root.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b||b.disabled)return;
    if(b.closest('.tc-quarter-action')&&Date.now()<wheelIgnoreClickUntil)return;
    if(b.dataset.mode){if(b.dataset.mode==='pve')void open('pve');else{mode='pvp';renderHub();}}
    else if(b.dataset.map){map=b.dataset.map;renderHub();}
    else if(b.hasAttribute('data-start'))void start();
    else if(b.hasAttribute('data-join'))void start($('[data-code]').value);
    else if(b.hasAttribute('data-resume'))paint();
    else if(b.hasAttribute('data-hub')){hideModal();mode==='pve'?close():renderHub();}
    else if(b.hasAttribute('data-next-stage')||b.hasAttribute('data-retry-entry'))void open('pve');
    else if(b.hasAttribute('data-exit'))close();
    else if(b.hasAttribute('data-sync'))void sync();
    else if(b.hasAttribute('data-reset-view'))renderer?.resetView();
    else if(b.hasAttribute('data-intro-ack'))void acknowledgeIntro();
    else if(b.dataset.wheelChoice){selectWheel(b.dataset.wheelChoice);}
    else if(b.dataset.wheelAction){selectWheel(b.dataset.wheelAction);}
    else if(b.dataset.action){selectWheel(b.dataset.action);}
    else if(b.hasAttribute('data-execute'))void execute();
    else if(b.hasAttribute('data-guard'))void send({type:'guard'});
    else if(b.hasAttribute('data-end'))void send({type:'end'});
    else if(b.hasAttribute('data-quiz'))void question();
    else if(b.hasAttribute('data-dismiss')){hideModal();if(state&&$('canvas'))paint();}
    else if(b.hasAttribute('data-continue')){hideModal();paint();if(state.quizRound&&canQuestion())void question();}
    else if(b.hasAttribute('data-question-helper-for')){activatePairContext(Number(b.dataset.questionHelperFor));openQuestionTool('helper');}
    else if(b.hasAttribute('data-question-report-for')){activatePairContext(Number(b.dataset.questionReportFor));openQuestionTool('report');}
    else if(b.hasAttribute('data-pair-whiteboard-for'))openPairWhiteboard(Number(b.dataset.pairWhiteboardFor));
    else if(b.hasAttribute('data-pair-whiteboard-clear'))clearPairWhiteboard();
    else if(b.hasAttribute('data-pair-whiteboard-close'))closePairWhiteboard();
    else if(b.hasAttribute('data-submit-pair'))void submitPair();
    else if(b.hasAttribute('data-helper-toggle'))openQuestionTool('helper');
    else if(b.hasAttribute('data-tool-close'))closeQuestionTool();
    else if(b.dataset.helperPreset){$('[data-helper-input]').value=b.dataset.helperPreset;void askHelper();}
    else if(b.hasAttribute('data-helper-send'))void askHelper();
    else if(b.hasAttribute('data-report-toggle'))openQuestionTool('report');
    else if(b.hasAttribute('data-report-send'))void reportQuestion();
    else if(b.hasAttribute('data-leave'))leaveDialog();
    else if(b.hasAttribute('data-forfeit')){hideModal();void send({type:'leave'});}
    else if(b.dataset.choiceFor!==undefined)selectPairChoice(Number(b.dataset.choiceFor),Number(b.dataset.choice));
    else if(b.dataset.choice!==undefined)selectPairChoice(0,Number(b.dataset.choice));
    else if(b.hasAttribute('data-copy'))void navigator.clipboard?.writeText(state.id.replace('arena-','')).then(()=>notice('戰場代碼已複製')).catch(()=>notice('請長按上方代碼複製'));
  });
  root.addEventListener('pointerdown',pairWhiteboardPointerDown);
  root.addEventListener('pointermove',pairWhiteboardPointerMove);
  root.addEventListener('pointerup',pairWhiteboardPointerUp);
  root.addEventListener('pointercancel',pairWhiteboardPointerUp);
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();if($('[data-pair-whiteboard-panel]:not(.hidden)')){closePairWhiteboard();return;}if($('[data-question-tool]:not([hidden])')){closeQuestionTool();return;}$('[data-intro-ack]')?close():modalOpen?hideModal():close();}
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
  destroyRenderer();root.classList.remove('tc-quarter-layout');const c=selectedCore(),core=R.CORES[c];
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

function wheelMarker(marker,angle,radius){
  if(!marker)return;
  const rad=angle*Math.PI/180;
  marker.style.left=(100+radius*Math.cos(rad)).toFixed(3)+'%';
  marker.style.top=(100+radius*Math.sin(rad)).toFixed(3)+'%';
}
function selectWheel(value){
  if(!state||busy||renderer?.isAnimating||!myAction())return;
  if(value==='attack-ring')value=attackChoice;
  if(value==='player'){if(action!=='move')return;}
  else if(value==='move')action='move';
  else if(value==='attack'||value==='skill'){action=value;attackChoice=value;}
  else return;
  selection=null;
  const me=myActor();
  if(me&&(action==='skill'&&R.branchFor(me).skill.range===0||action==='attack'&&R.basicFor(me).kind==='ring')){
    selection={x:me.x,y:me.y};
  }
  updateControls();
  renderer?.update(state,uid,action,selection);
}

function buildGame(){
  destroyRenderer();$('[data-main]').className='tc-main tc-game';
  root.classList.toggle('tc-quarter-layout',state?.mode==='pve');
  $('[data-main]').innerHTML=`<section class="tc-arena"><div class="tc-arena-heading"><span data-map-name></span><span data-range-legend></span></div><canvas tabindex="0" aria-label="方格戰場；點選灰格移動或紅格攻擊，也可使用方向鍵選擇目標"></canvas><div class="tc-selection" data-selection role="status" aria-live="polite" aria-atomic="true">點選地格，預覽路線與體力消耗</div></section>
    <aside class="tc-sidebar"><div class="tc-actors" data-actors></div><section class="tc-command"><div class="tc-stamina" data-stamina></div><button type="button" data-quiz>答題</button><div class="tc-action-tabs"><button type="button" data-action="move">移動</button><button type="button" data-action="attack">攻擊 · 2</button><button type="button" data-action="skill">技能</button></div><button type="button" class="tc-confirm" data-execute>選擇目標</button><details class="tc-skill-info"><summary data-skill-title>操作說明</summary><div data-skill></div></details><div class="tc-turn-buttons"><button type="button" data-guard>護身</button><button type="button" data-end>結束回合</button></div></section>
    <div class="tc-game-footer"><details class="tc-history"><summary>戰況與詳情</summary><div class="tc-combat-info" data-combat-info></div><div class="tc-log" data-log role="log" aria-label="戰況紀錄"></div></details><button type="button" data-sync>同步</button><button type="button" data-leave>離開</button></div></aside>`;
  if(state?.mode==='pve'){
    // Strict sketch: only the map, a bottom-left charging dial and a
    // bottom-right attack/move/end-turn dial are visible. Keep unused
    // gameplay data nodes for existing rendering and server code, hidden.
    const command=$('.tc-command');
    // Ten luminous curved segments follow the quarter-circle's perimeter.
    const energySegment=i=>{
      const radius=90;
      const polar=degrees=>{
        const radians=degrees*Math.PI/180;
        return [(radius*Math.cos(radians)).toFixed(3),
          (100+radius*Math.sin(radians)).toFixed(3)];
      };
      const start=polar(-90+i*9+1.35),end=polar(-90+(i+1)*9-1.35);
      return `<path data-energy-segment="${i}" d="M ${start[0]} ${start[1]} A 90 90 0 0 1 ${end[0]} ${end[1]}"></path>`;
    };
    const wedge=(start,end,outer=100,inner=69)=>{
      const points=[];
      for(let i=0;i<=12;i++){
        const angle=(start+(end-start)*i/12)*Math.PI/180;
        points.push([100+outer*Math.cos(angle),100+outer*Math.sin(angle)]);
      }
      for(let i=12;i>=0;i--){
        const angle=(start+(end-start)*i/12)*Math.PI/180;
        points.push([100+inner*Math.cos(angle),100+inner*Math.sin(angle)]);
      }
      return 'polygon('+points.map(([x,y])=>x.toFixed(3)+'% '+y.toFixed(3)+'%').join(',')+')';
    };
    const energy=document.createElement('section');
    energy.className='tc-quarter tc-quarter-energy';
    energy.setAttribute('aria-label','答題充能與能量');
    energy.innerHTML='<svg class="tc-energy-ring" viewBox="0 0 100 100" aria-hidden="true" focusable="false">'
      +'<path class="tc-energy-track" d="M 0 10 A 90 90 0 0 1 90 100"></path>'
      +Array.from({length:10},(_,i)=>energySegment(i)).join('')+'</svg>';
    energy.append(command.querySelector('[data-stamina]'));
    const quiz=command.querySelector('[data-quiz]');
    // A precise custom lightning vector stays sharp across device sizes.
    quiz.innerHTML='<svg class="tc-energy-bolt" viewBox="0 0 72 100" aria-hidden="true" focusable="false">'
      +'<defs><linearGradient id="tc-bolt-gradient" x1="0" y1="0" x2="0.95" y2="1">'
      +'<stop offset="0%" stop-color="#fcffe5"/><stop offset="48%" stop-color="#d9ffd4"/>'
      +'<stop offset="100%" stop-color="#8cffb4"/></linearGradient></defs>'
      +'<path class="tc-bolt-outline" d="M 43 6 L 16 50 Q 14 54 20 54 H 37 L 26 94 L 63 37 H 43 L 50 6 Z"></path>'
      +'<path class="tc-bolt-fill" d="M 43 6 L 16 50 Q 14 54 20 54 H 37 L 26 94 L 63 37 H 43 L 50 6 Z"></path>'
      +'<path class="tc-bolt-glint" d="M 42 17 L 27 46 H 40"></path>'
      +'</svg><span class="tc-energy-number" data-energy-number aria-hidden="true">0</span>';
    quiz.setAttribute('aria-label','答題充能');
    energy.append(quiz);

    const actions=document.createElement('section');
    actions.className='tc-quarter tc-quarter-action';
    actions.setAttribute('aria-label','滑動選擇行動、目標與技能');
    actions.innerHTML='<svg class="tc-action-lines" viewBox="0 0 100 100" aria-hidden="true">'
      +'<path d="M 100 0 A 100 100 0 0 0 0 100"/>'
      +'<path d="M 100 26 A 74 74 0 0 0 26 100"/>'
      +'<path d="M 100 51 A 49 49 0 0 0 51 100"/></svg>';
    const tabs=command.querySelector('.tc-action-tabs');
    const attack=tabs.querySelector('[data-action="attack"]');
    const move=tabs.querySelector('[data-action="move"]');
    const end=command.querySelector('[data-end]');
    attack.className='tc-sector tc-sector-attack';
    attack.dataset.wheelAction='attack-ring';
    attack.style.clipPath=wedge(-90,-135,74,49);
    attack.innerHTML='<span>攻擊</span>';
    move.className='tc-sector tc-sector-move';
    move.dataset.wheelAction='move';
    move.style.clipPath=wedge(-135,-180,74,49);
    move.innerHTML='<span>移動</span>';
    end.className='tc-sector tc-sector-end';
    end.style.clipPath=wedge(-90,-180,49,0);
    end.innerHTML='<span>結束\n回合</span>';
    const choices=document.createElement('div');choices.className='tc-wheel-options';
    const makeChoice=(value,label,begin,finish,klass)=>{
      const b=document.createElement('button');b.type='button';
      b.dataset.wheelChoice=value;b.className='tc-sector '+klass;
      b.style.clipPath=wedge(begin,finish,100,74);
      const text=document.createElement('span');text.textContent=label;
      b.append(text);choices.append(b);return b;
    };
    makeChoice('player','玩家',-90,-180,'tc-detail-player');
    makeChoice('attack','普通攻擊',-90,-135,'tc-detail-basic');
    makeChoice('skill',R.branchFor(myActor()).skill.name,-135,-180,'tc-detail-skill');
    const actionMarker=document.createElement('span');
    actionMarker.className='tc-wheel-marker tc-wheel-action-marker';
    actionMarker.setAttribute('aria-hidden','true');
    const detailMarker=document.createElement('span');
    detailMarker.className='tc-wheel-marker tc-wheel-detail-marker';
    detailMarker.setAttribute('aria-hidden','true');
    actions.append(tabs,choices,end,actionMarker,detailMarker);
    // Dragging a ring rotates its indicator and snaps to the nearest option;
    // taps retain native button clicks and keyboard activation.
    let pointer=null;
    const pointerAngle=e=>{
      const bounds=actions.getBoundingClientRect();
      return Math.max(-180,Math.min(-90,Math.atan2(e.clientY-bounds.bottom,e.clientX-bounds.right)*180/Math.PI));
    };
    actions.addEventListener('pointerdown',e=>{
      const b=e.target.closest('button[data-wheel-action],button[data-wheel-choice]');
      if(!b||b.disabled)return;
      pointer={id:e.pointerId,x:e.clientX,y:e.clientY,ring:b.dataset.wheelChoice?'detail':'action',moved:false};
    });
    actions.addEventListener('pointermove',e=>{
      if(!pointer||pointer.id!==e.pointerId)return;
      if(Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>8){
        if(!pointer.moved){pointer.moved=true;try{actions.setPointerCapture(e.pointerId);}catch(_){}}
        wheelMarker(pointer.ring==='detail'?detailMarker:actionMarker,pointerAngle(e),pointer.ring==='detail'?76:51);
        e.preventDefault();
      }
    });
    const endPointer=e=>{
      if(!pointer||pointer.id!==e.pointerId)return;
      const gesture=pointer;pointer=null;
      if(actions.hasPointerCapture?.(e.pointerId))actions.releasePointerCapture(e.pointerId);
      if(e.type==='pointercancel'){updateControls();return;}
      if(!gesture.moved)return;
      wheelIgnoreClickUntil=Date.now()+350;
      const next=gesture.ring==='action'?(pointerAngle(e)>-135?'attack-ring':'move'):
        action==='move'?'player':pointerAngle(e)>-135?'attack':'skill';
      selectWheel(next);updateControls();
    };
    actions.addEventListener('pointerup',endPointer);
    actions.addEventListener('pointercancel',endPointer);
    command.prepend(energy,actions);
  }
  renderer=new TacticalRenderer($('canvas'),p=>{if(!busy){selection=p;updateControls();renderer.update(state,uid,action,selection);
    // The sketch has no extra confirm button: choosing a valid map tile
    // directly executes the selected move or directional attack.
    if(root.classList.contains('tc-quarter-layout')&&['move','attack','skill'].includes(action)&&!$('[data-execute]').disabled)void execute();
  }},()=>{
    if(!opened||!state||!renderer)return;updateControls();
    if(!renderer.isAnimating&&state.status==='finished'&&!modalOpen)resultDialog();
    else if(!renderer.isAnimating&&!modalOpen&&state.quizRound)schedule();
  });
}
function paint({preserveModal=false}={}){
  if(!state)return renderHub();if(!preserveModal)hideModal();
  $('[data-title]').textContent=state.mode==='pve'?'問道試煉':'鬥法論道';
  if(state.status==='waiting'){
    destroyRenderer();root.classList.remove('tc-quarter-layout');$('[data-main]').className='tc-main tc-waiting';
    $('[data-main]').innerHTML=`<div><h2>配對中…</h2><p>也可將代碼傳給道友加入。</p><code>${esc(state.id.replace('arena-',''))}</code><button type="button" data-copy>複製代碼</button><button type="button" data-leave>取消配對</button></div>`;return;
  }
  if(!renderer||!$('canvas'))buildGame();
  const me=myActor(),myTurn=myAction();
  $('[data-map-name]').textContent=state.trial?'第 '+state.trial.stage+' 關 · '+state.trial.title:R.mapFor(state.map).name;
  $('[data-actors]').innerHTML=state.actors.map(a=>`<div class="tc-actor ${a.uid===uid?'is-self':''} ${a.hp<=0?'is-down':''}" aria-label="${esc(a.name)}，生命 ${a.hp} / ${a.maxHp}"><div><b>${esc(a.name)}</b><span>${a.hp}/${a.maxHp}</span></div><div class="tc-health"><i style="width:${a.hp/a.maxHp*100}%"></i></div>${a.shield||a.slow?`<small>${[a.shield?'護盾 '+a.shield:'',a.slow?'緩速':''].filter(Boolean).join(' · ')}</small>`:''}</div>`).join('');
  $('[data-combat-info]').innerHTML=state.actors.filter(a=>a.hp>0&&a.intent).map(a=>'<p><b>'+esc(a.name)+'</b><span>'+esc(a.intent.text)+'</span></p>').join('');
  $('[data-stamina]').innerHTML=`<b>體力 <strong>${me.stamina}</strong><span> / ${R.LIMITS.stamina}</span></b><div>${Array.from({length:10},(_,i)=>`<i class="${i<me.stamina?'filled':''}"></i>`).join('')}</div><small>出手 ${me.attacks}/2</small>`;
  if(root.classList.contains('tc-quarter-layout')){
    const amount=Math.max(0,Math.min(R.LIMITS.stamina,me.stamina));
    $('[data-energy-number]').textContent=String(amount);
    root.querySelectorAll('[data-energy-segment]').forEach(segment=>
      segment.classList.toggle('is-filled',Number(segment.dataset.energySegment)<amount));
    $('[data-quiz]').setAttribute('aria-label',`答題充能，目前能量 ${amount} / ${R.LIMITS.stamina}，答對增加 4，答錯增加 1`);
  }else $('[data-quiz]').textContent=canQuestion()?`答題 ${me.questions}/2`:state.quizRound&&me.questions>=2?'答題完成':myTurn?'無法再答題':'等待對手';
  $('[data-log]').innerHTML=state.events.slice(-5).map(e=>`<p class="is-${esc(e.type)}">${esc(e.text)}</p>`).join('');
  renderer.update(state,uid,action,selection);updateControls();updateClock();
  if(state.status==='finished'&&!renderer.isAnimating&&!modalOpen)resultDialog();
  else if(state.mode==='pve'&&state.newEnemies?.length)showEnemyIntro();
}
function updateControls(){
  if(!$('[data-selection]')||!state)return;
  const me=myActor(),mine=myAction(),sk=R.branchFor(me).skill,animating=renderer?.isAnimating,locked=busy||animating;
  const quizButton=$('[data-quiz]');
  quizButton.disabled=!canQuestion()||locked;
  if(root.classList.contains('tc-quarter-layout')){
    const ready=!quizButton.disabled&&!modalOpen;
    quizButton.classList.toggle('is-charge-ready',ready);
    quizButton.setAttribute('aria-description',ready?
      '可以答題充能，按下開始答題':'目前無法答題充能');
  }
  $('[data-guard]').disabled=!mine||locked||me.attacks>=2;$('[data-end]').disabled=!mine||locked;
  $('[data-sync]').disabled=locked;root.classList.toggle('tc-animating',!!animating);
  $('[data-stamina]').classList.toggle('tc-gaining',!modalOpen&&renderer?.currentKind==='answer');
  const t=selection?R.at(state,selection):null;
  const basic=R.basicFor(me),directional=['line','cleave'].includes(basic.kind);
  if(!root.classList.contains('tc-quarter-layout'))$('[data-action="attack"]').textContent='攻擊 · '+basic.cost;
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
  const quarter=root.classList.contains('tc-quarter-layout');
  root.querySelectorAll('[data-action]').forEach(b=>{
    b.setAttribute('aria-pressed',String(b.dataset.action===action||(quarter&&b.dataset.action==='attack'&&action==='skill')));
    b.disabled=!mine||locked;
  });
  if(quarter){
    const attacking=action!=='move';
    const player=$('[data-wheel-choice="player"]');
    const basicOption=$('[data-wheel-choice="attack"]');
    const skillOption=$('[data-wheel-choice="skill"]');
    if(player)player.hidden=attacking;
    if(basicOption)basicOption.hidden=!attacking;
    if(skillOption){
      skillOption.hidden=!attacking;
      skillOption.querySelector('span').textContent=sk.name;
      skillOption.setAttribute('aria-label','使用技能：'+sk.name);
    }
    for(const option of [player,basicOption,skillOption]){
      if(!option)continue;
      option.disabled=!mine||locked;
      option.setAttribute('aria-pressed',String(option.dataset.wheelChoice===(attacking?action:'player')));
    }
    const ring=$('.tc-quarter-action');
    ring?.setAttribute('aria-label',attacking?'行動：攻擊；技能：'+(action==='skill'?sk.name:basic.name):'行動：移動；目標：玩家');
    wheelMarker($('.tc-wheel-action-marker'),attacking?-112.5:-157.5,51);
    wheelMarker($('.tc-wheel-detail-marker'),attacking?(action==='skill'?-157.5:-112.5):-135,76);
  }
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
function hideModal(){if(!root)return;closePairWhiteboard();introDemo?.destroy();introDemo=null;modalOpen=false;$('[data-modal]').hidden=true;$('[data-modal]').innerHTML='';$('[data-main]').inert=false;$('[data-close]').disabled=false;renderer?.setPaused(false);}
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
  const oldQuestion=state?.question?.id;
  const keepSelection=next?.quizRound&&next.id===state?.id&&next.actionRevision===state.actionRevision&&next.phase===state.phase&&next.turnUid===state.turnUid;
  state=next;if(!keepSelection)selection=null;
  if(next?.mode==='pve'&&next.trial){
    // Send only the authoritative habitat metadata, not actor/quiz state.
    window.dispatchEvent(new CustomEvent('xiuxian:tactical-trial-updated',{
      detail:{uid,trial:next.trial,terrain:next.terrain,map:next.map}
    }));
  }
  if(modalOpen&&$('[data-choice]')&&oldQuestion&&!next?.question){hideModal();pairQuestions=[];pairChoices=[];notice('本輪答題已結束，請查看戰場。');}
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
  const e=epoch,account=uid,remaining=Math.max(1,R.LIMITS.questions-myActor().questions);
  busy=true;notice('');showModal('<h2>正在準備兩題…</h2><p>完成後會在同一頁顯示，選好答案再一起送出。</p><button type="button" data-dismiss>返回戰場</button>');
  try{
    const first=state.question||(await api('/api/generate-quiz',{quizMode:'tactical',roomId:state.id,batchSlot:0})).tacticalQuestion;
    if(!valid(e,account))return;
    if(!first)throw Error('第一題尚未準備完成，請重試');
    state.question=first;
    const second=remaining>=2?(state.questionFollowup||(await api('/api/generate-quiz',{quizMode:'tactical',roomId:state.id,batchSlot:1})).tacticalQuestion):null;
    if(!valid(e,account))return;
    if(remaining>=2&&!second)throw Error('第二題尚未準備完成，請重試');
    state.questionFollowup=second;
    pairQuestions=[first,...(second?[second]:[])];pairChoices=pairQuestions.map(()=>-1);pairReviews=[];
    if(modalOpen)paintQuestion();
  }catch(err){
    if(valid(e,account))showModal('<h2>題目尚未就緒</h2><p>'+esc(err.message)+'</p><button type="button" data-quiz>重新準備兩題</button><button type="button" data-dismiss>返回戰場</button>');
  }finally{if(valid(e,account)){busy=false;updateControls();schedule();}}
}
function questionSheet(q,review=null,index=0){
  const options=review?.opts||q.opts;
  const buttons=options.map((value,i)=>{
    const resultClass=review?(i===review.answerIndex?' bg-green-600 border-green-400 text-white':i===review.choice?' bg-red-600 border-red-400 text-white':''):'';
    const selected=!review&&pairChoices[index]===i;
    return `<button type="button" class="w-full text-left p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition border border-slate-600 flex items-center gap-3 active:scale-95 mb-2${resultClass}${selected?' is-picked':''}"  ${review?'disabled':`data-choice-for="${index}" data-choice="${i}" aria-pressed="${selected}"`}>
      <span class="bg-slate-800 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-blue-400 border border-slate-600 shrink-0">${String.fromCharCode(65+i)}</span>
      <span class="flex-1 quiz-rich-option">${rich(value)}${review&&i===review.answerIndex?' ✓':''}</span>
    </button>`;
  }).join('');
  return `<article class="tc-pair-entry" data-pair-entry="${index}">
    <div class="glass-panel p-6 rounded-2xl mb-4 border-l-4 border-cyan-500 relative tc-question-sheet">
      <div class="quiz-card-tools absolute top-3 right-3 z-20 flex items-center gap-2">
        <span class="text-[10px] bg-slate-900/50 px-2 py-1 rounded border border-white/10 text-cyan-300 backdrop-blur-md tc-question-badge">${esc([q.subject,q.topic].filter(Boolean).join(' · ')||'問道試煉')} · 第 ${index+1} 題</span>
        <button type="button" class="quiz-whiteboard-toggle" data-pair-whiteboard-for="${index}" title="開啟計算白板" aria-label="第 ${index+1} 題計算白板"><i class="fa-solid fa-pen-to-square"></i><span>白板</span></button>
      </div>
      <div class="text-6xl text-cyan-500/10 absolute -top-2 -left-2"><i class="fa-solid fa-quote-left"></i></div>
      <h3 class="text-lg font-bold leading-relaxed relative z-10 text-white tc-question" data-question-text="${index}">${rich(review?.q||q.q)}</h3>
    </div>
    <div class="tc-options space-y-3" data-options-container="${index}">${buttons}</div>
    ${review?`<div class="tc-feedback-section mt-6 glass-panel p-5 rounded-xl border border-white/10 animate-fade-in-up">
      <div class="flex items-center gap-3 mb-3">
        <div class="text-2xl"><i class="fa-solid ${review.correct?'fa-circle-check text-green-400':'fa-circle-xmark text-red-400'}"></i></div>
        <h3 class="text-lg font-bold font-sci ${review.correct?'tc-correct':'tc-wrong'}">${review.correct?'答對':'答錯'} · 體力 +${review.gain}</h3>
      </div>
      <div class="bg-slate-950/50 p-4 rounded-lg text-sm text-gray-300 leading-relaxed border border-white/5 mb-4">
        <span class="text-cyan-400 font-bold block mb-1 text-xs uppercase tracking-wider"><i class="fa-solid fa-magnifying-glass"></i> 題解參悟</span>
        <span class="tc-feedback-text">${rich(review.explanation)}</span>
      </div>
    </div>`:''}
    <div class="mt-8 flex gap-3 w-full quiz-footer-actions tc-question-footer">
      <button type="button" data-dismiss class="flex-1 py-3 text-gray-600 text-xs text-center hover:text-cyan-400 transition border border-transparent hover:border-cyan-500/20 rounded-lg group"><i class="fa-solid fa-arrow-left group-hover:-translate-x-1 transition-transform"></i><span>返回戰場</span></button>
      <button type="button" data-question-report-for="${index}" class="flex-1 py-3 text-gray-600 text-xs text-center hover:text-yellow-400 transition border border-transparent hover:border-yellow-500/20 rounded-lg group"><i class="fa-solid fa-bug group-hover:rotate-12 transition-transform"></i><span>題目有錯</span></button>
      <button type="button" data-question-helper-for="${index}" class="flex-1 py-3 text-gray-600 text-xs text-center hover:text-cyan-400 transition border border-transparent hover:border-cyan-500/20 rounded-lg group"><i class="fa-solid fa-comments group-hover:-translate-y-0.5 transition-transform"></i><span>問道助手</span></button>
    </div>
  </article>`;
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
  return `<section class="tc-question-tools" aria-label="題目協助"><div class="tc-tools-buttons"><button type="button" class="quiz-helper-launcher" data-helper-toggle aria-haspopup="dialog" aria-expanded="false" title="開啟問道助手"><i class="fa-solid fa-comments"></i><span class="quiz-helper-launcher-label">問道</span></button></div>
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
    status.textContent=message;
    if(result.questionSkipped){
      pairQuestions=[];pairChoices=[];pairReviews=[];
      hideModal();paint();notice(message);
      if(canQuestion())void question();
      return;
    }
    if(result.compensated&&!result.battle){const user=localUser();user.stats||={};user.stats.gold=result.newGold;user.stats.totalScore=result.newTotalScore;window.updateUIStats?.();window.refreshXiuxianLiveSync?.(result.newTotalScore);}
  }catch(err){if(sameQuiz(ctx))status.textContent=err.message+'，可再次送出重試。';}
  finally{ctx.reportBusy=false;if(sameQuiz(ctx)&&$('[data-report-send]'))$('[data-report-send]').disabled=false;}
}
function activatePairContext(index){
  const q=pairQuestions[index];if(!q)return;
  setQuizContext(q,pairReviews[index]||null);
  const tools=$('.tc-question-tools');if(tools)tools.outerHTML=quizTools();
}
function selectPairChoice(index,choice){
  if(busy||pairReviews.length||!pairQuestions[index]||!Number.isInteger(choice)||choice<0||choice>3)return;
  pairChoices[index]=choice;
  root.querySelectorAll('[data-choice-for="'+index+'"]').forEach(button=>{
    const picked=Number(button.dataset.choice)===choice;
    button.classList.toggle('is-picked',picked);
    button.setAttribute('aria-pressed',String(picked));
  });
  const ready=pairChoices.length===pairQuestions.length&&pairChoices.every(value=>value>=0);
  const button=$('[data-submit-pair]');if(button)button.disabled=!ready;
  const status=$('[data-pair-status]');if(status)status.textContent=ready?'兩題答案已選好，可以一次送出。':`已選 ${pairChoices.filter(value=>value>=0).length} / ${pairQuestions.length} 題`;
}

function pairWhiteboardCanvas(){
  return $('[data-pair-whiteboard-canvas]');
}
function redrawPairWhiteboard(){
  const canvas=pairWhiteboardCanvas();if(!canvas||pairWhiteboardIndex<0)return;
  const rect=canvas.getBoundingClientRect();
  if(!rect.width||!rect.height)return;
  const ratio=Math.min(2,window.devicePixelRatio||1),width=rect.width,height=rect.height;
  canvas.width=Math.max(1,Math.round(width*ratio));
  canvas.height=Math.max(1,Math.round(height*ratio));
  const ctx=canvas.getContext('2d');if(!ctx)return;
  ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#294934';ctx.fillStyle='#294934';ctx.lineWidth=2.8;
  for(const line of pairWhiteboardInk.get(pairQuestions[pairWhiteboardIndex]?.id)||[]){
    if(!line.length)continue;
    ctx.beginPath();ctx.moveTo(line[0].x*width,line[0].y*height);
    for(const point of line.slice(1))ctx.lineTo(point.x*width,point.y*height);
    if(line.length===1){ctx.arc(line[0].x*width,line[0].y*height,1.5,0,Math.PI*2);ctx.fill();}
    else ctx.stroke();
  }
}
function openPairWhiteboard(index){
  if(!Number.isInteger(index)||index<0||index>=pairQuestions.length)return;
  const panel=$('[data-pair-whiteboard-panel]');
  if(!panel)return;
  pairWhiteboardIndex=index;panel.classList.remove('hidden');
  const stem=$('[data-question-text="'+index+'"]');
  const target=$('[data-pair-whiteboard-question]');
  if(target){target.innerHTML=stem?.innerHTML||rich(pairQuestions[index].q);void window.quizMathTypeset?.(target);}
  requestAnimationFrame(()=>{redrawPairWhiteboard();panel.querySelector('[data-pair-whiteboard-close]')?.focus({preventScroll:true});});
}
function closePairWhiteboard(){
  const panel=$('[data-pair-whiteboard-panel]');
  panel?.classList.add('hidden');pairWhiteboardPointer=null;pairWhiteboardIndex=-1;
}
function clearPairWhiteboard(){
  if(pairWhiteboardIndex<0)return;
  pairWhiteboardInk.delete(pairQuestions[pairWhiteboardIndex]?.id);redrawPairWhiteboard();
}
function pairWhiteboardPoint(canvas,event){
  const rect=canvas.getBoundingClientRect();
  return {x:Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width))),
          y:Math.max(0,Math.min(1,(event.clientY-rect.top)/Math.max(1,rect.height)))};
}
function pairWhiteboardPointerDown(event){
  const canvas=event.target.closest?.('[data-pair-whiteboard-canvas]');
  if(!canvas||pairWhiteboardIndex<0)return;
  event.preventDefault();canvas.setPointerCapture(event.pointerId);
  const id=pairQuestions[pairWhiteboardIndex]?.id;
  if(!id)return;
  const strokes=pairWhiteboardInk.get(id)||[];
  strokes.push([pairWhiteboardPoint(canvas,event)]);
  pairWhiteboardInk.set(id,strokes);
  pairWhiteboardPointer={id,pointerId:event.pointerId};
  redrawPairWhiteboard();
}
function pairWhiteboardPointerMove(event){
  const current=pairWhiteboardPointer,canvas=pairWhiteboardCanvas();
  if(!current||current.pointerId!==event.pointerId||!canvas)return;
  event.preventDefault();
  pairWhiteboardInk.get(current.id)?.at(-1)?.push(pairWhiteboardPoint(canvas,event));
  redrawPairWhiteboard();
}
function pairWhiteboardPointerUp(event){
  if(pairWhiteboardPointer?.pointerId!==event.pointerId)return;
  pairWhiteboardPointer=null;
}
function pairWhiteboardMarkup(){
  return `<section class="quiz-whiteboard-panel hidden tc-pair-whiteboard" data-pair-whiteboard-panel role="dialog" aria-modal="true" aria-label="計算白板">
    <button type="button" class="quiz-whiteboard-backdrop" data-pair-whiteboard-close aria-label="關閉白板"></button>
    <div class="quiz-whiteboard-dialog">
      <div class="quiz-whiteboard-toolbar">
        <div class="quiz-whiteboard-title"><i class="fa-solid fa-chalkboard"></i><span>計算白板</span></div>
        <div class="quiz-whiteboard-actions">
          <button type="button" class="quiz-whiteboard-action" data-pair-whiteboard-clear><i class="fa-solid fa-eraser"></i><span>清空</span></button>
          <button type="button" class="quiz-whiteboard-action" data-pair-whiteboard-close><i class="fa-solid fa-xmark"></i><span>關閉</span></button>
        </div>
      </div>
      <div class="quiz-whiteboard-question-wrap">
        <div class="quiz-whiteboard-question-label"><i class="fa-solid fa-scroll"></i><span>題目</span></div>
        <div class="quiz-whiteboard-question" data-pair-whiteboard-question></div>
      </div>
      <div class="quiz-whiteboard-stage"><canvas data-pair-whiteboard-canvas aria-label="可手寫計算的白板"></canvas></div>
    </div>
  </section>`;
}
function pairLayout(reviews=null,questions=pairQuestions){
  const done=Array.isArray(reviews);
  const count=questions.length;
  return `<div class="tc-dialog-heading"><small>${state.quizRound?'<span data-quiz-clock></span>':'問道試煉 · 答題充能'}</small><button type="button" data-dismiss aria-label="返回戰場">返回戰場</button></div>
  <div class="quiz-question-helper-layout helper-collapsed">
    <div class="quiz-main-column tc-pair-column">
      <div class="tc-pair-list">${questions.map((q,i)=>questionSheet(q,done?reviews[i]:null,i)).join('')}</div>
      ${done?`<div class="tc-pair-summary" role="status"><i class="fa-solid fa-circle-check"></i> 本次答對 ${reviews.filter(r=>r.correct).length} / ${reviews.length} 題 · 修為與體力已結算</div>
          <div class="flex gap-3 tc-pair-buttons"><button type="button" data-exit class="btn-cyber-ghost flex-1 py-3 rounded-lg text-xs">返回宗門</button><button type="button" data-continue class="btn-cyber-primary flex-1 py-3 rounded-lg text-xs">返回戰場</button></div>`:
        `<div class="tc-pair-submit">
           <div data-pair-status role="status" aria-live="polite">已選 0 / ${count} 題</div>
           <button type="button" data-submit-pair class="btn-cyber-primary flex-1 py-3 rounded-lg text-xs" disabled>${count===2?'一次送出兩題':'送出剩餘題目'}</button>
         </div>
`}
    </div>
    <aside class="tc-quiz-tools-shell" aria-label="問道助手">${quizTools()}</aside>
  </div>
  ${pairWhiteboardMarkup()}`;
}
function paintQuestion(){
  if(!pairQuestions.length)return;
  pairReviews=[];setQuizContext(pairQuestions[0]);
  showModal(pairLayout(),{quiz:true});
  updateClock();
}
async function submitPair(){
  if(busy||!pairQuestions.length||pairChoices.length!==pairQuestions.length||pairChoices.some(choice=>choice<0))return;
  busy=true;const e=epoch,account=uid,serial=++op;
  const questions=pairQuestions.slice(),choices=pairChoices.slice(),reviewed=[];
  const initialScore=Number(localUser().stats?.totalScore)||0;
  let priorScore=initialScore,cultivationVisual=null;
  root.querySelectorAll('[data-choice-for]').forEach(button=>button.disabled=true);
  const submit=$('[data-submit-pair]');if(submit){submit.disabled=true;submit.textContent='正在批改兩題…';}
  try{
    for(let i=0;i<questions.length;i++){
      const q=questions[i];
      const result=await api('/api/tactical/answer',{roomId:state.id,questionId:q.id,choice:choices[i]});
      if(!valid(e,account))return;
      if(result.state?.review?.questionId!==q.id)throw Error('答題狀態不同步，請重新開啟答題');
      state=result.state;clockOffset=state.serverNowMs-Date.now();appliedOp=serial;
      const review=state.review;
      reviewed.push(review);pairReviews=reviewed.slice();
      window.QAGameAudio?.answer(review.correct,'tactical:'+state.id+':'+q.id);
      const score=Number(state.progress?.stats?.totalScore);
      if(state.mode==='pve'&&Number.isFinite(score)&&score>priorScore&&!cultivationVisual
        &&Array.isArray(window.QASoloRealms)&&window.QASoloRealms.length){
        const source=root.querySelector('[data-choice-for="'+i+'"][data-choice="'+choices[i]+'"]');
        cultivationVisual=beginSoloCultivationFeedback({
          scoreBefore:initialScore,source,realms:window.QASoloRealms,activeWhen:()=>opened&&modalOpen
        });
      }
      if(Number.isFinite(score))priorScore=score;
      applyProgress(state);
      const status=$('[data-pair-status]');
      if(status)status.textContent=`已批改 ${reviewed.length} / ${questions.length} 題`;
    }
    pairReviews=reviewed;
    setQuizContext(questions[0],reviewed[0]);
    showModal(pairLayout(reviewed,questions),{quiz:true});
    renderer?.update(state,uid,action,null);
    const netGain=Math.max(0,priorScore-initialScore);
    if(cultivationVisual&&netGain>0)void cultivationVisual.play({gain:netGain,totalScore:priorScore});
    else cultivationVisual?.cancel();
  }catch(err){
    if(!valid(e,account)){cultivationVisual?.cancel();return;}
    if(cultivationVisual){
      const partialGain=Math.max(0,priorScore-initialScore);
      if(partialGain>0)void cultivationVisual.play({gain:partialGain,totalScore:priorScore});
      else cultivationVisual.cancel();
    }
    if(reviewed.length){
      pairQuestions=questions.slice(reviewed.length);
      pairChoices=choices.slice(reviewed.length);
      pairReviews=[];
      if(pairQuestions.length){
        paintQuestion();
        notice('已完成 '+reviewed.length+' 題並儲存獎勵；其餘題目可重新送出。'+err.message);
        const status=$('[data-pair-status]');if(status)status.textContent='前面題目已儲存，請送出剩餘題目。';
        busy=false;
        pairChoices.forEach((choice,i)=>selectPairChoice(i,choice));
      }else showModal('<h2>答題已完成</h2><p>請同步戰場查看結果。</p><button type="button" data-continue>返回戰場</button>');
    }else{
      const status=$('[data-pair-status]');if(status)status.textContent=err.message+'；可再次送出，獎勵不會重複發放。';
      root.querySelectorAll('[data-choice-for]').forEach(button=>button.disabled=false);
      if(submit){submit.disabled=false;submit.textContent='重新送出兩題';}
    }
  }finally{if(valid(e,account)){busy=false;updateControls();schedule();}}
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
  action='move';attackChoice='attack';selection=null;
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
  if(!root)return;quizContext?.abort.abort();quizContext=null;pairQuestions=[];pairChoices=[];pairReviews=[];pairWhiteboardInk.clear();closePairWhiteboard();autoQuizKey='';epoch++;opened=false;busy=false;clearTimeout(poll);clearInterval(clock);hideModal();destroyRenderer();
  root.hidden=true;root.classList.remove('tc-quarter-layout');document.body.classList.remove('tactical-open');lastTrigger?.focus?.();
}
window.openTacticalCombat=open;
window.startQuizFlow=()=>open('pve');
window.startBattleMatchmaking=()=>open('pvp');
window.joinBattleRoomV2=code=>{void open('pvp').then(()=>{if(valid(epoch,uid))void start(String(code||''));});};
window.addEventListener('xiuxian:user-data-ready',()=>{if(opened&&getMainUser()?.uid!==uid){state=null;close();}});
document.addEventListener('visibilitychange',()=>{if(!opened)return;if(document.hidden)clearTimeout(poll);else void sync();});
export {open as openTacticalCombat};
