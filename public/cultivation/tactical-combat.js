import './daily-meditation-rewards.js';
import {stoneCostMarkup,cultivationMarkup} from './spirit-stone-ui.js?v=20261125-stone-reward-icon-v2';
import './manual-rules.js?v=20261118-gold-cap10-v1';
import './weapon-dungeon-rules.js?v=20261125-weapon-lord-cleared-v1';
import './contextual-asset-preloader.js';
import {skillArt,bookArt} from './manual-art.js';
import {manualBattleEarnings,renderManualBattleRecap} from './tactical-manual-recap.js';
import {manualXpDelta,renderManualXpToast} from './tactical-manual-xp-feedback.js';
import {manualRoomExp,battleBreakthroughEstimate,renderBattleBreakthroughEstimate} from './manual-anticipation.js';
import './flying-sword-path.js?v=20261120-sword-movement-v1';
import './tactical-rules.js?v=20261125-weapon-lord-cleared-v1';
import './tactical-seal-targeting.js?v=20261119-seal-target-v1';
import {TacticalRenderer} from './tactical-renderer.js?v=20261120-guided-first-stage-v2';
import './tactical-impact-presentation.js?v=20261125-weapon-lord-unprotected-v1';
import {EnemyDemo} from './tactical-enemy-demo.js?v=20261116-pve-v4';
import {BeastInspector} from './tactical-beast-inspector.js?v=20261118-phase4-focus-v1';
import {SealInspector} from './tactical-seal-inspector.js?v=20261119-seal-inspector-v2';
import {authenticatedMainFetch,getMainUser} from './data/project-repository.js';
import {installTacticalKeyboardGuard} from './tactical-keyboard-guard.js';
import {weaponRailOptions,railAngle,syncRail,syncRailLabels,installWheelRails} from './tactical-wheel-rails.js';

const R=globalThis.QATactical;
const SealTargets=globalThis.QATacticalSealTargeting;
const Manuals=globalThis.QAManuals;
const AssetWarmup=globalThis.QAContextualAssets;
const CombatImpact=globalThis.QATacticalImpact;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rich=v=>window.quizMathRichText?.(String(v||''))||esc(v);
const id=()=>globalThis.crypto.randomUUID();
const localUser=()=>window.getCurrentUserData?.()||{};
let battleChannel='pve',weaponDungeonSelection=null;
let root=null,keyboardGuard=null,renderer=null,beastInspector=null,sealInspector=null,state=null,mode='pve',map='courtyard',action='move',selection=null,trialEntry=null;
let attackChoice='attack',selectedManualSkill='',wheelIgnoreClickUntil=0;
// Selection only: every equipped weapon is equally usable, never a main weapon.
let selectedWeaponId='',selectedWeaponSlot=-1;
// Local view preference; never sent to the server or charged as a battle action.
let sealRangeMode='all',sealRangeFocusId=null;
let sealPeekPosition=null,sealGuideForced=false;
const sealGuideSeenLocally=new Set();
let battleLoadouts=null,loadoutFetchedFor='',loadoutFetchingFor='',loadoutMenuOpen=false;
let manualRecapCache=null,manualRecapLoadingKey='',manualXpTimer=null,battleMasteryBaseline=null;
const battlefieldMode=()=>action==='manual'?'manual:'+selectedManualSkill:action;
let opened=false,busy=false,epoch=0,uid='',poll=null,clock=null,retryMs=4000,op=0,appliedOp=0;
let freshRewardReceipt='';
let modalOpen=false,lastTrigger=null,clockOffset=0,deadlineSyncAt=0,introDemo=null;
let bossIntroSeenRoom='',bossTransitionPending=null,bossBannerTimer=null;
let warmedCombatAudioRoomId='';
let autoQuizKey='',quizContext=null;
let pairQuestions=[],pairChoices=[],pairReviews=[],pairDisplayIndex=0;
let pairGeneration=0,pairFollowupPromise=null,pairFollowupError='';
let preloadedTacticalQuestions=null;
const mathReviewSent=new Set();
let pairWhiteboardIndex=-1,pairWhiteboardPointer=null;
const pairWhiteboardInk=new Map();
const $=selector=>root?.querySelector(selector);
const myActor=()=>state?.actors.find(a=>a.uid===uid);
const equippedTechniques=hero=>(hero?.manualSkills||[]).map(id=>R.manualSkillFor(hero,id)).filter(Boolean);
// PvE always uses two weapon slots even if an older room was resumed.
function currentWeaponIds(hero){
  if(Array.isArray(hero?.manualWeaponIds))
    return Array.from({length:2},(_,i)=>hero.manualWeaponIds[i]||null);
  if(Array.isArray(battleLoadouts?.weaponIds))
    return Array.from({length:2},(_,i)=>battleLoadouts.weaponIds[i]||null);
  const known=[...new Set((hero?.manualSkills||[])
    .map(skillId=>Manuals.BY_SKILL[skillId]?.manualId).filter(Boolean))];
  return [known[0]||null,known[1]||null];
}
function modernPveWheel(){return state?.mode==='pve';}
function syncEquippedAttack(hero=myActor()){
  const skills=equippedTechniques(hero);
  if(hero?.manualWeaponMode||modernPveWheel()){
    const worn=currentWeaponIds(hero);
    if(action==='attack'&&worn.some(Boolean)){action='move';selection=null;}
    if(selectedWeaponId&&!worn.includes(selectedWeaponId)){selectedWeaponId='';selectedWeaponSlot=-1;}
    if(action==='manual'&&!skills.some(skill=>skill.id===selectedManualSkill)){
      action='move';selection=null;selectedManualSkill='';
    }
    attackChoice=action==='manual'?'manual:'+selectedManualSkill:'attack';
    return skills;
  }
  if(skills.length){
    if(!skills.some(skill=>skill.id===selectedManualSkill)){
      selectedManualSkill=skills[0].id;
      if(action==='manual')selection=null;
    }
    attackChoice='manual:'+selectedManualSkill;
    if(action==='attack'||action==='skill'){action='manual';selection=null;}
  }else{
    selectedManualSkill='';attackChoice='attack';
    if(action==='manual'||action==='skill'){action='attack';selection=null;}
  }
  return skills;
}
const myAction=()=>state?.status==='active'&&state.turnUid===uid&&(!state.quizRound||state.phase==='action');
function canQuestion(){try{R.canAnswer(state,uid,Date.now()+clockOffset);return state.mode==='pve'||!!state.quizRound||myActor().stamina<R.LIMITS.stamina||!!state.question||!!state.questionFollowup;}catch(_){return false;}}

async function api(path,body,signal){
  // Same full solo prompt/adaptive analysis can need more time than the old
  // short combat prompt. Fetch starts before charge, so keep its own deadline
  // without unnecessarily interrupting the player at 65 seconds.
  const maxMs=path==='/api/generate-quiz'?120000:65000;
  const controller=new AbortController();
  const cancel=()=>controller.abort();
  if(signal?.aborted)cancel();
  else signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(cancel,maxMs);
  try{
    const response=await authenticatedMainFetch(path,{
      ...(body?{method:'POST',body:JSON.stringify(body)}:{method:'GET'}),
      signal:controller.signal
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.error)throw Object.assign(Error(data.error||'戰場連線暫時中斷'),{status:response.status});
    return data;
  }finally{
    clearTimeout(timer);
    signal?.removeEventListener('abort',cancel);
  }
}
function valid(e,account){return opened&&e===epoch&&account===getMainUser()?.uid;}
function notice(text){const box=$('[data-notice]');if(box){box.textContent=text;box.hidden=!text;}}
function tutorialStep(){
  return mode==='pve'&&state?.trial?.stage===1
    ? (window.firstAnswerGuideStep?.(uid)??-1) : -1;
}
function tutorialEvent(kind,details={}){
  if(mode==='pve'&&uid)window.dispatchEvent(new CustomEvent('qingyun:tactical-tutorial',{
    detail:{uid,kind,roomId:state?.id,stage:state?.trial?.stage,...details}
  }));
}
function clearLiveManualXp(){
  if(manualXpTimer!==null)clearTimeout(manualXpTimer);
  manualXpTimer=null;
  $('[data-manual-xp-host]')?.replaceChildren();
}
function showLiveManualXp(delta){
  if(!delta||!opened||state?.mode!=='pve'||state.status!=='active'||root?.hidden||document.hidden)return;
  const host=$('[data-manual-xp-host]');
  if(!host)return;
  clearLiveManualXp();
  host.innerHTML=renderManualXpToast(delta,{esc,bookArt});
  // Progress here is an explicitly labelled estimate since the last trusted
  // manual snapshot. It must NEVER change the underlying combat or manual state.
  const hint=battleBreakthroughEstimate(battleLoadouts,state,uid,delta,Manuals,battleMasteryBaseline);
  if(hint)host.firstElementChild?.insertAdjacentHTML('beforeend',
    renderBattleBreakthroughEstimate(hint,esc));
  // Only one quiet sound per actual server-ledger change; player mute still wins.
  try{window.QAGameAudio?.play('spirit-pulse',{volume:.25});}catch(_){}
  manualXpTimer=setTimeout(()=>{
    host.replaceChildren();
    manualXpTimer=null;
  },2150);
}
// The menu stays outside the battle canvas so the quarter-circle controls are unchanged.
function renderBattleLoadouts(){
  const toggle=$('[data-loadout-toggle]'),menu=$('[data-loadout-menu]');
  if(!toggle||!menu)return;
  const active=state?.status==='active'&&state.mode==='pve',actor=myActor();
  const index=Number.isInteger(actor?.manualLoadoutIndex)?actor.manualLoadoutIndex:
    (battleLoadouts?.activeLoadout??0);
  toggle.hidden=!active;toggle.disabled=busy;
  const weapons=Array.isArray(battleLoadouts?.weaponIds);
  toggle.textContent=weapons?'武器 '+(battleLoadouts?.weaponIds?.filter(Boolean).length||0)+'/2':'配置 '+(index+1);
  toggle.setAttribute('aria-expanded',String(active&&loadoutMenuOpen));
  menu.hidden=!active||!loadoutMenuOpen;
  if(menu.hidden)return;
  const presets=battleLoadouts?.loadouts||[];
  if(weapons){
    const worn=battleLoadouts.weaponIds||[];
    menu.innerHTML='<strong>戰場武器裝備</strong><small>單人試煉可隨時調整，最多兩件，沒有主武器。</small>'+
      Array.from({length:2},(_,i)=>{
        const name=Manuals.BY_BOOK[worn[i]]?.name||'空白武器欄';
        return '<div class="tc-weapon-manage-slot"><span>第 '+(i+1)+' 欄 · '+esc(name)+'</span>'+
          (worn[i]?'<button type="button" data-battle-unequip="'+i+'">卸下</button>':'')+
          '<button type="button" data-battle-weapon-picker="'+i+'">更換</button></div>';
      }).join('')+
      '<div class="tc-weapon-manage-candidates" data-battle-weapon-candidates hidden></div>';
    return;
  }
  menu.innerHTML='<strong>戰場技能配置</strong><small>切換不耗體力，也不占行動次數</small>'+
    Array.from({length:3},(_,i)=>{
      const preset=presets[i],ids=preset?.skillIds||[];
      const names=ids.map(id=>Manuals.BY_SKILL[id]?.name).filter(Boolean);
      const label=preset?.name||'配置 '+(i+1);
      return '<button type="button" data-loadout-index="'+i+'" aria-pressed="'+(index===i)+
        '" '+(busy||index===i?'disabled':'')+'><span>'+esc(label)+'</span><small>'+
        esc(names.length?names.join(' · '):weapons?'尚未裝備武器':'普通攻擊')+(index===i?' · 使用中':'')+'</small></button>';
    }).join('');
}
async function refreshBattleLoadouts(){
  const account=uid,room=state?.id,e=epoch;
  if(!room||!valid(e,account)||state.status!=='active'||state.mode!=='pve'||loadoutFetchedFor===account||
    loadoutFetchingFor===account+':'+room)return;
  const key=account+':'+room;loadoutFetchingFor=key;
  try{
    const result=(await api('/api/tactical/manuals')).state;
    if(!valid(e,account)||state?.id!==room)return;
    battleLoadouts=result;loadoutFetchedFor=account;
    // Snapshot the room tally at the SAME moment we retrieve authoritative
    // permanent mastery. The later difference is only a provisional estimate.
    battleMasteryBaseline={
      uid:account,roomId:room,
      ledger:Object.fromEntries((result.library||[]).filter(book=>book.owned)
        .map(book=>[book.id,manualRoomExp(state,account,book.id,Manuals)]))
    };
    renderBattleLoadouts();
  }catch(error){
    if(valid(e,account)&&state?.id===room){
      loadoutFetchedFor=account;
      console.warn('[Tactical loadouts] preset names unavailable',error.message);
    }
  }finally{if(loadoutFetchingFor===key)loadoutFetchingFor='';}
}

function showBattleWeaponChoices(slot){
  if(!battleLoadouts||!Number.isInteger(slot)||slot<0||slot>=2)return;
  const host=$('[data-battle-weapon-candidates]');
  if(!host)return;
  const worn=battleLoadouts.weaponIds||[];
  const available=(battleLoadouts.library||[]).filter(book=>book.owned);
  host.hidden=false;
  host.innerHTML='<p>選擇第 '+(slot+1)+' 欄（相同武器不可重複裝備）</p>'+
    available.map(book=>{
      const other=worn.indexOf(book.id),disabled=other>=0&&other!==slot;
      return '<button type="button" data-battle-equip="'+slot+'" data-weapon-id="'+esc(book.id)+
        '" '+(disabled?'disabled':'')+'>'+esc(book.name)+' · Lv.'+book.level+
        (disabled?'（已裝備）':'')+'</button>';
    }).join('');
}
async function editBattleWeapon(slot,weaponId){
  if(!state||state.mode!=='pve'||state.status!=='active'||!Number.isInteger(slot)||
    slot<0||slot>=2||busy||!battleLoadouts)return;
  const roomId=state.id,account=uid,session=epoch;
  busy=true;updateControls();
  try{
    const result=await api('/api/tactical/manuals/loadout',{index:slot,weaponId});
    if(!valid(session,account)||state?.id!==roomId)return;
    battleLoadouts=result.state;loadoutFetchedFor=account;
    loadoutMenuOpen=false;selectedWeaponSlot=-1;selectedWeaponId='';
    // Refresh directly: task()/sync() would refuse while this edit is busy.
    const live=await api('/api/tactical/state?mode='+battleChannel);
    if(valid(session,account)&&state?.id===roomId&&live.state)
      accept(live.state,++op);
    if(valid(session,account))notice(weaponId?'武器已裝備，可立即選用三招':'武器已卸下');
  }catch(error){if(valid(session,account))notice(error.message||'武器更新失敗');}
  finally{busy=false;if(valid(session,account)){renderBattleLoadouts();updateControls();}}
}
async function switchBattleLoadout(index){
  if(!state||state.status!=='active'||state.mode!=='pve'||busy||!Number.isInteger(index)||index<0||index>2)return;
  const current=Number.isInteger(myActor()?.manualLoadoutIndex)?myActor().manualLoadoutIndex:
    (battleLoadouts?.activeLoadout??0);
  if(index===current)return;
  loadoutMenuOpen=false;selection=null;
  const request={roomId:state.id,index,requestId:id()};
  const next=await task(async()=>{
    try{return (await api('/api/tactical/loadout',request)).state;}
    catch(error){
      if(!error.status||error.status>=500){
        try{return (await api('/api/tactical/loadout',request)).state;}catch(_){}
      }
      throw error;
    }
  });
  if(next){
    if(battleLoadouts)battleLoadouts.activeLoadout=index;
    const name=battleLoadouts?.loadouts?.[index]?.name||'配置 '+(index+1);
    notice('已切換至「'+name+'」');
    syncEquippedAttack();renderer?.update(state,uid,battlefieldMode(),selection);
    updateControls();renderBattleLoadouts();
  }
}
function syncPvpSkillTabs(){
  if(state?.mode!=='pvp')return;
  const tabs=$('.tc-action-tabs'),actor=myActor();
  if(!tabs||!actor)return;
  const skills=equippedTechniques(actor);
  const key=(skills.map(skill=>skill.id).join('|')||'basic')+'|sword:'+!!actor.flyingSword;
  if(tabs.dataset.loadoutKey===key)return;
  const move=tabs.querySelector('[data-action="move"]')||document.createElement('button');
  move.type='button';move.dataset.action='move';move.textContent='移動';
  const buttons=skills.length?skills.map(skill=>{
    const button=document.createElement('button');button.type='button';button.dataset.action='manual:'+skill.id;
    showPvpSkill(button,skill,R.techniqueCost(actor,skill),actor.atk,!!actor.flyingSword);
    return button;
  }):[Object.assign(document.createElement('button'),{type:'button',textContent:'普通攻擊 · 2'})];
  if(!skills.length)buttons[0].dataset.action='attack';
  const moveSword=document.createElement('button');
  moveSword.type='button';moveSword.dataset.action='sword-move';moveSword.textContent='移動飛劍';
  tabs.replaceChildren(move,...(actor.flyingSword?[moveSword]:[]),...buttons);tabs.dataset.loadoutKey=key;
}
function ensure(){
  if(root){keyboardGuard||=installTacticalKeyboardGuard(root);return;}
  if(!document.getElementById('tactical-style')){const link=document.createElement('link');link.id='tactical-style';link.rel='stylesheet';link.href='/styles/tactical-combat.css?v=20261116-live-loadouts-v1';document.head.append(link);}
  if(!document.getElementById('tactical-manual-recap-style')){
    const link=document.createElement('link');link.id='tactical-manual-recap-style';link.rel='stylesheet';
    link.href='/styles/tactical-manual-recap.css?v=20261118-battle-exp-v1';document.head.append(link);
  }
  if(!document.getElementById('tactical-manual-xp-feedback-style')){
    const link=document.createElement('link');link.id='tactical-manual-xp-feedback-style';link.rel='stylesheet';
    link.href='/styles/tactical-manual-xp-feedback.css?v=20261120-dungeon-mastery-v1';
    document.head.append(link);
  }
  if(!document.getElementById('tactical-manual-anticipation-style')){
    const link=document.createElement('link');link.id='tactical-manual-anticipation-style';link.rel='stylesheet';
    link.href='/styles/manual-anticipation.css?v=20261120-dungeon-mastery-v1';
    document.head.append(link);
  }
  if(!document.getElementById('tactical-quarter-style')){const link=document.createElement('link');link.id='tactical-quarter-style';link.rel='stylesheet';link.href='/styles/tactical-quarter-controls.css?v=20261116-skill-damage-inline-v1';document.head.append(link);}
  if(!document.getElementById('tactical-quarter-weapons-style')){
    const link=document.createElement('link');link.id='tactical-quarter-weapons-style';
    link.rel='stylesheet';link.href='/styles/tactical-quarter-weapons.css?v=20261122-rightwheel-rails-v5';
    document.head.append(link);
  }
  if(!document.getElementById('tactical-focus-effects-style')){
    const link=document.createElement('link');
    link.id='tactical-focus-effects-style';link.rel='stylesheet';
    link.href='/styles/tactical-focus-effects.css?v=20261120-focus-parity-v1';
    document.head.append(link);
  }
  if(!document.getElementById('tactical-boss-presentation-style')){
    const link=document.createElement('link');link.id='tactical-boss-presentation-style';
    link.rel='stylesheet';link.href='/styles/tactical-boss-presentation.css?v=20261118-combat-phase3-v1';
    document.head.append(link);
  }
  if(!document.getElementById('tactical-beast-style')){
    const link=document.createElement('link');link.id='tactical-beast-style';link.rel='stylesheet';
    link.href='/styles/tactical-beast-inspector.css?v=20261118-phase1-v1';document.head.append(link);
  }
  if(!document.getElementById('tactical-seal-inspector-style')){
    const link=document.createElement('link');link.id='tactical-seal-inspector-style';
    link.rel='stylesheet';link.href='/styles/tactical-seal-inspector.css?v=20261119-seal-inspector-v2';
    document.head.append(link);
  }
  if(!document.getElementById('tactical-pair-style')){const link=document.createElement('link');link.id='tactical-pair-style';link.rel='stylesheet';link.href='/styles/tactical-question-pair.css?v=20261115-field-ink';document.head.append(link);}
  root=document.createElement('section');root.id='tactical-combat';root.hidden=true;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','戰棋修行');
  root.innerHTML=`<header class="tc-top"><h1 data-title>問道試煉</h1><div class="tc-top-right"><span data-turn></span><button type="button" class="tc-loadout-toggle" data-loadout-toggle aria-expanded="false" hidden>配置</button><button type="button" data-close aria-label="收起戰場">收起</button></div></header>
    <div class="tc-loadout-popover" data-loadout-menu role="group" aria-label="戰場功法配置" hidden></div>
    <div class="tc-notice" data-notice role="status" hidden></div><div class="tc-manual-xp-host" data-manual-xp-host role="status" aria-live="polite" aria-atomic="true"></div><div class="tc-main" data-main role="region" aria-label="戰場內容"></div><div class="tc-modal" data-modal hidden></div>`;
  document.body.append(root);
  keyboardGuard=installTacticalKeyboardGuard(root);
  window.addEventListener('qa:invalid-tex',event=>{
    const node=event.detail?.node,q=pairQuestions[pairDisplayIndex];
    const isQuestion=node?.closest?.('[data-question-text], [data-options-container], [data-pair-whiteboard-question]');
    if(!node?.isConnected||!isQuestion||!root?.contains(node)||!opened||
       state?.mode!=='pvp'||!modalOpen||!q||pairReviews[pairDisplayIndex])return;
    const account=uid,roomId=state.id,key=account+':'+roomId+':'+q.id;
    if(!account||mathReviewSent.has(key))return;
    mathReviewSent.add(key);
    // Do not reveal the PvP answer or interrupt the player's answer timer.
    void api('/api/tactical/review-math-issue',{roomId,questionId:q.id}).then(result=>{
      if(result.state?.submitted&&valid(epoch,account)&&state?.id===roomId)
        window.showToast?.('公式顯示異常，已自動送審。');
    }).catch(error=>{
      mathReviewSent.delete(key);
      console.warn('[Quiz Math Auto Review] tactical review unavailable',error);
    });
  });
  $('[data-close]').onclick=close;
  root.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b||b.disabled)return;
    if(b.closest('.tc-quarter-action')&&Date.now()<wheelIgnoreClickUntil)return;
    if(b.hasAttribute('data-beast-toggle')){sealInspector?.dismiss();loadoutMenuOpen=false;renderBattleLoadouts();}
    if(sealInspector?.handleButton(b))return;
    if(beastInspector?.handleButton(b))return;
    if(b.dataset.mode){if(b.dataset.mode==='pve')void open('pve');else{mode='pvp';renderHub();}}
    else if(b.dataset.map){map=b.dataset.map;renderHub();}
    else if(b.hasAttribute('data-start'))void start();
    else if(b.hasAttribute('data-join'))void start($('[data-code]').value);
    else if(b.hasAttribute('data-resume'))paint();
    else if(b.hasAttribute('data-hub')){hideModal();mode==='pve'?close():renderHub();}
    else if(b.hasAttribute('data-tutorial-collapse'))close();
    else if(b.hasAttribute('data-weapon-dungeon-menu')){close();void window.openWeaponDungeons?.();}
    else if(b.hasAttribute('data-weapon-dungeon-retry'))void open('weapon-dungeon',weaponDungeonSelection);
    else if(b.hasAttribute('data-next-stage')||b.hasAttribute('data-retry-entry'))void open(battleChannel,weaponDungeonSelection||{});
    else if(b.hasAttribute('data-manual-training')){
      const account=uid;
      close();window.switchToPage?.('page-training');
      window.dispatchEvent(new CustomEvent('xiuxian:manual-battle-settled',{detail:{uid:account}}));
    }
    else if(b.hasAttribute('data-manual-recap-retry')){manualRecapCache=null;void refreshManualRecap({force:true});}
    else if(b.hasAttribute('data-exit'))close();
    else if(b.hasAttribute('data-sync'))void sync();
    else if(b.hasAttribute('data-reset-view'))renderer?.resetView();
    else if(b.hasAttribute('data-seal-range-toggle'))cycleSealRangeMode();
    else if(b.hasAttribute('data-seal-range-next'))nextSealRangeFocus();
    else if(b.hasAttribute('data-seal-guide-dismiss'))ackSealGuide();
    else if(b.hasAttribute('data-seal-guide-help')){sealGuideForced=true;refreshSealTargetGuidance();}
    else if(b.hasAttribute('data-loadout-toggle')){loadoutMenuOpen=!loadoutMenuOpen;renderBattleLoadouts();}
    else if(b.hasAttribute('data-loadout-index'))void switchBattleLoadout(Number(b.dataset.loadoutIndex));
    else if(b.hasAttribute('data-battle-unequip'))void editBattleWeapon(Number(b.dataset.battleUnequip),null);
    else if(b.hasAttribute('data-battle-weapon-picker'))showBattleWeaponChoices(Number(b.dataset.battleWeaponPicker));
    else if(b.hasAttribute('data-battle-equip'))void editBattleWeapon(Number(b.dataset.battleEquip),b.dataset.weaponId);
    else if(b.hasAttribute('data-intro-ack'))void acknowledgeIntro();
    else if(b.dataset.weaponChoice){selectWheel('weapon:'+b.dataset.weaponChoice);}
    else if(b.dataset.wheelChoice){selectWheel(b.dataset.wheelChoice);}
    else if(b.dataset.wheelAction){selectWheel(b.dataset.wheelAction);}
    else if(b.dataset.action){selectWheel(b.dataset.action);}
    else if(b.hasAttribute('data-execute'))void execute();
    else if(b.hasAttribute('data-guard'))void send({type:'guard'});
    else if(b.hasAttribute('data-end')){
      if(tutorialStep()>=4&&tutorialStep()<=7)notice('先完成移動與攻擊教學，或按「略過教學」。');
      else void send({type:'end'});
    }
    else if(b.hasAttribute('data-quiz'))void question();
    else if(b.hasAttribute('data-dismiss')){hideModal();if(state&&$('canvas'))paint();}
    else if(b.hasAttribute('data-continue')){hideModal();paint();if(state.quizRound&&canQuestion())void question();}
    else if(b.hasAttribute('data-question-helper-for')){activatePairContext(Number(b.dataset.questionHelperFor));openQuestionTool('helper');}
    else if(b.hasAttribute('data-question-report-for')){activatePairContext(Number(b.dataset.questionReportFor));openQuestionTool('report');}
    else if(b.hasAttribute('data-solo-correction-for'))void queueTacticalCorrection(Number(b.dataset.soloCorrectionFor));
    else if(b.dataset.helperExtend)void queueTacticalExtension(b.dataset.helperExtend,b);
    else if(b.hasAttribute('data-correction-hint-for')){activatePairContext(Number(b.dataset.correctionHintFor));openQuestionTool('helper');$('[data-helper-input]').value='請針對我這題的錯誤給一個簡短的概念提示，協助我理解關鍵步驟，再嘗試同概念訂正題。';void askHelper();}
    else if(b.hasAttribute('data-pair-whiteboard-for'))openPairWhiteboard(Number(b.dataset.pairWhiteboardFor));
    else if(b.hasAttribute('data-pair-whiteboard-clear'))clearPairWhiteboard();
    else if(b.hasAttribute('data-pair-whiteboard-close'))closePairWhiteboard();
    else if(b.hasAttribute('data-submit-pair'))void submitPair();
    else if(b.hasAttribute('data-next-pair-question'))showNextPairQuestion();
    else if(b.hasAttribute('data-helper-toggle'))openQuestionTool('helper');
    else if(b.hasAttribute('data-tool-close'))closeQuestionTool();
    else if(b.dataset.helperPreset){$('[data-helper-input]').value=b.dataset.helperPreset;void askHelper(b.dataset.helperIntent||'discussion');}
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
    if(event.key==='Escape'){event.preventDefault();if(sealInspector?.isOpen()){sealInspector.dismiss({restoreFocus:true});return;}if(beastInspector?.isOpen()){beastInspector.dismiss({restoreFocus:true});return;}if($('[data-pair-whiteboard-panel]:not(.hidden)')){closePairWhiteboard();return;}if($('[data-question-tool]:not([hidden])')){closeQuestionTool();return;}$('[data-intro-ack]')?close():modalOpen?hideModal():close();}
    if(event.key==='Tab'){
      const scope=$('[data-question-tool]:not([hidden])')||(modalOpen?$('[data-modal]'):null)||sealInspector?.dialogElement()||beastInspector?.dialogElement()||root,focusable=[...scope.querySelectorAll('button:not(:disabled),input,textarea,canvas[tabindex],summary')].filter(el=>el.getClientRects().length);
      if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&(document.activeElement===first||!scope.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  beastInspector=new BeastInspector(root,{
    getState:()=>state,
    getRenderer:()=>renderer,
    getManuals:()=>Manuals,
    openDemo:species=>showBeastDemo(species)
  });
  sealInspector=new SealInspector(root,{
    getState:()=>state,
    getRenderer:()=>renderer,
    rules:R,
    closeOther:()=>beastInspector?.dismiss(),
    isOtherOpen:()=>!!beastInspector?.isOpen(),
    onNavigate:seal=>renderer?.focusCameraOn(seal),
    onFocusRange:seal=>{
      sealRangeMode='focus';sealRangeFocusId=seal.id;
      refreshSealRangeControls();
      renderer?.focusCameraOn(seal);
    }
  });
}
function destroyRenderer(){renderer?.destroy();renderer=null;}
function renderHub(){
  hideBossBanner();bossTransitionPending=null;
  destroyRenderer();beastInspector?.reset();sealInspector?.reset();root.classList.remove('tc-quarter-layout');
  $('[data-title]').textContent='鬥法論道';$('[data-turn]').textContent='';
  $('[data-main]').className='tc-main tc-hub';
  $('[data-main]').innerHTML=`<div class="tc-hub-config">
    ${state&&['active','waiting'].includes(state.status)?'<button type="button" data-resume>繼續戰鬥</button>':''}
    <span class="tc-label" id="tc-map-label">戰場</span><div class="tc-maps" role="group" aria-labelledby="tc-map-label">${R.MAPS.map(m=>`<button type="button" data-map="${m.id}" aria-pressed="${map===m.id}"><b>${m.name}</b></button>`).join('')}</div>
    <button type="button" class="tc-primary" data-start ${busy?'disabled':''}>開始配對</button>
    <div class="tc-join"><input data-code aria-label="戰場代碼" maxlength="22" placeholder="輸入道友的戰場代碼"><button type="button" data-join>加入</button></div>
    <details class="tc-codex"><summary>玩法說明</summary><p>每輪各答兩題，先答完者先行動；對手須在 50 秒內完成答題。每人行動 30 秒。</p><p>答對 +4 體力，答錯 +1，上限 10。每格移動消耗 1 體力，攻擊依兵器消耗；每回合最多攻擊或施法兩次，剩餘體力可保留。</p><p>灰格可移動，紅格為攻擊範圍，紅框為怪物攻擊預告。</p></details>
</div>`;
}

const WHEEL_ANGLES=Object.freeze({upper:-112.5,lower:-157.5,center:-135});
// Each slider has free space on BOTH radial sides of its own ring.
// Action lane: 49–74, selection: 54–70; detail lane: 74–100, selection: 79–95.
const WHEEL_LANES=Object.freeze({
  action:Object.freeze({inner:54,outer:70}),
  detail:Object.freeze({inner:79,outer:95})
});
const WHEEL_RADII=Object.freeze({
  action:(WHEEL_LANES.action.inner+WHEEL_LANES.action.outer)/2,
  detail:(WHEEL_LANES.detail.inner+WHEEL_LANES.detail.outer)/2
});
// Width is proportional to the available angle per option, with breathing room.
// One target -> 38°, two choices -> 31.5° (previously always 45°).
function wheelSliceDegrees(count){
  return Math.min(38,90/Math.max(1,count)*.7);
}
function wheelSlicePath(count,outer,inner){
  const radians=d=>d*Math.PI/180;
  const polar=(degrees,radius)=>[
    100+radius*Math.cos(radians(degrees)),
    100+radius*Math.sin(radians(degrees))
  ].map(value=>value.toFixed(4)).join(' ');
  const half=wheelSliceDegrees(count)/2;
  const first=WHEEL_ANGLES.upper+half,last=WHEEL_ANGLES.upper-half;
  return 'M '+polar(first,outer)
    +' A '+outer+' '+outer+' 0 0 0 '+polar(last,outer)
    +' L '+polar(last,inner)
    +' A '+inner+' '+inner+' 0 0 1 '+polar(first,inner)+' Z';
}
function wheelSliderShape(slider,count){
  if(!slider||slider.dataset.optionCount===String(count))return;
  const kind=slider.classList.contains('tc-wheel-slider-detail')?'detail':'action';
  const lane=WHEEL_LANES[kind];
  slider.querySelector('.tc-wheel-slider-shape')?.setAttribute('d',wheelSlicePath(count,lane.outer,lane.inner));
  slider.dataset.optionCount=String(count);
}

function leftWheelWedge(start,end,outer,inner){
  const points=[];
  for(let i=0;i<=24;i++){const rad=(start+(end-start)*i/24)*Math.PI/180;
    points.push([(outer*Math.cos(rad)).toFixed(3),(100+outer*Math.sin(rad)).toFixed(3)]);
  }
  for(let i=24;i>=0;i--){const rad=(start+(end-start)*i/24)*Math.PI/180;
    points.push([(inner*Math.cos(rad)).toFixed(3),(100+inner*Math.sin(rad)).toFixed(3)]);
  }
  return 'polygon('+points.map(p=>p[0]+'% '+p[1]+'%').join(',')+')';
}
// Independent weapon rails: movement and the first skill sit nearest the bottom.
function renderModernWeaponWheel(hero,locked,mine){
  const ring=$('.tc-quarter-action');
  if(!ring)return;
  root.classList.add('tc-modern-weapon-wheel');
  const equipped=currentWeaponIds(hero);
  if(action==='manual'&&selectedWeaponSlot<0){
    selectedWeaponSlot=equipped.indexOf(Manuals.BY_SKILL[selectedManualSkill]?.manualId);
  }
  if(!Number.isInteger(selectedWeaponSlot)||selectedWeaponSlot<-1||selectedWeaponSlot>1||
      (selectedWeaponSlot>=0&&!equipped[selectedWeaponSlot]))
    selectedWeaponSlot=-1;
  selectedWeaponId=selectedWeaponSlot>=0?(equipped[selectedWeaponSlot]||''):'';

  // Prevent the original attack/move controls from competing for hit targets.
  // The central End Turn button is kept as the original single action.
  ring.querySelector('[data-wheel-action="attack-ring"]')?.setAttribute('hidden','');
  ring.querySelector('[data-wheel-action="move"]')?.setAttribute('hidden','');
  root.dataset.rightWheel='two-weapons-v4';
  ring.dataset.interaction='sliding-rails';

  let wheel=ring.querySelector('.tc-rightwheel-v3');
  if(!wheel){
    wheel=document.createElement('div');
    wheel.className='tc-rightwheel-v3';
    wheel.innerHTML='<svg class="tc-rw-guides" viewBox="0 0 100 100" aria-hidden="true" focusable="false">'+
      '<path d="M 100 0 A 100 100 0 0 0 0 100"/>'+
      '<path d="M 100 26 A 74 74 0 0 0 26 100"/>'+
      '<path d="M 100 51 A 49 49 0 0 0 51 100"/>'+
      '<path class="tc-wheel-lane-guide" d="M 100 5 A 95 95 0 0 0 5 100"/>'+
      '<path class="tc-wheel-lane-guide" d="M 100 21 A 79 79 0 0 0 21 100"/>'+
      '<path class="tc-wheel-lane-guide" d="M 100 30 A 70 70 0 0 0 30 100"/>'+
      '<path class="tc-wheel-lane-guide" d="M 100 46 A 54 54 0 0 0 46 100"/></svg>'+
      ['outer','inner'].map(kind=>'<svg class="tc-rw-slider" data-rail="'+kind+'" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><g><path /></g></svg>').join('')+
      '<div class="tc-rw-outer" role="group" aria-label="右圈外圈行動"></div>'+
      '<div class="tc-rw-inner" role="group" aria-label="右圈內圈選項"></div>'+
      '<span class="tc-rw-empty" role="status" hidden></span>';
    ring.append(wheel);
    installWheelRails(wheel,{
      select:selectWheel,restore:updateControls,
      isLocked:()=>busy||renderer?.isAnimating||!myAction()||modalOpen,
      allowClick:()=>{wheelIgnoreClickUntil=0;},
      suppressClick:()=>{wheelIgnoreClickUntil=Date.now()+350;}
    });
  }
  const outer=wheel.querySelector('.tc-rw-outer');
  const inner=wheel.querySelector('.tc-rw-inner');
  const empty=wheel.querySelector('.tc-rw-empty');
  const outerOptions=weaponRailOptions(equipped,Manuals.BY_BOOK);
  const basicSelected=!equipped.some(Boolean)&&action==='attack';
  const outerValue=selectedWeaponSlot>=0?'weapon:'+selectedWeaponSlot:basicSelected?'attack':'move';
  const key=JSON.stringify(outerOptions);
  if(outer.dataset.weapons!==key){
    outer.dataset.weapons=key;
    const count=outerOptions.length;
    const sectors=outerOptions.map((entry,i)=>{
      const button=document.createElement('button');
      button.type='button';
      button.className='tc-rw-sector tc-rw-sector--outer';
      button.style.clipPath=wheelWedge(-180+90*i/count+.6,-180+90*(i+1)/count-.6,99.5,75.5);
      if(entry.slot!==undefined)button.dataset.weaponChoice=String(entry.slot);
      else button.dataset.wheelAction=entry.value==='move'?'move-menu':'attack';
      const label=document.createElement('span');
      label.className='tc-rw-sector-label';
      wheelMarker(label,railAngle(i,count),87.5);
      const art=i===0?'<i class="fa-solid fa-person-walking" aria-hidden="true"></i>':
        '<i class="fa-solid fa-khanda" aria-hidden="true"></i>';
      label.innerHTML=art+'<strong>'+esc(entry.name)+'</strong>';
      button.append(label);
      button.title=i===0?'移動：選擇角色或飛劍':
        entry.name+(entry.value==='attack'?'：普通攻擊':'：選擇技能');
      button.setAttribute('aria-label',button.title);
      button.setAttribute('aria-keyshortcuts','ArrowUp ArrowDown ArrowLeft ArrowRight Home End');
      return button;
    });
    outer.replaceChildren(...sectors);
  }
  [...outer.children].forEach((button,i)=>{
    button.disabled=!mine||locked;
    button.setAttribute('aria-pressed',String(outerOptions[i].value===outerValue));
  });

  // Each weapon shows only its currently unlocked moves; visible options
  // share the inner rail evenly.
  const book=Manuals.BY_BOOK[selectedWeaponId];
  const detail=basicSelected?[]:selectedWeaponSlot<0?[
    {value:'player',name:'角色',cost:'1 體力/格'},
    ...(hero.flyingSword?[{value:'sword',name:'飛劍',cost:'2 格/體力'}]:[])
  ]:(book?.skills||[]).filter(skill=>R.manualSkillFor(hero,skill.id)).map(skill=>({
    value:'manual:'+skill.id,name:skill.name,skill
  }));
  const detailKey=(selectedWeaponSlot<0?'movement':selectedWeaponSlot+':'+selectedWeaponId)+
    ':'+detail.map(item=>item.value).join('|');
  inner.hidden=!detail.length;
  inner.setAttribute('aria-label',selectedWeaponSlot<0?'移動對象':
    book?'選擇'+book.name+'的已解鎖技能':'武器尚未裝備');
  if(inner.dataset.detail!==detailKey){
    inner.dataset.detail=detailKey;
    const count=detail.length;
    inner.replaceChildren(...detail.map((entry,i)=>{
      const button=document.createElement('button');button.type='button';
      button.className='tc-rw-sector tc-rw-sector--inner';
      button.dataset.wheelChoice=entry.value;
      button.style.clipPath=wheelWedge(
        -180+90*i/count+.6,-180+90*(i+1)/count-.6,73.5,49.5);
      const label=document.createElement('span');
      label.className='tc-rw-sector-label';
      wheelMarker(label,railAngle(i,count),61.5);
      wheelText(label,entry.name,'',entry.skill?skillArt(entry.skill):'');
      label.querySelector('.tc-wheel-cost').classList.add('tc-rw-price');
      button.append(label);
      button.setAttribute('aria-keyshortcuts','ArrowUp ArrowDown ArrowLeft ArrowRight Home End');
      return button;
    }));
  }
  [...inner.children].forEach((button,i)=>{
    const entry=detail[i],available=entry.skill?R.manualSkillFor(hero,entry.skill.id):null;
    const unlocked=!entry.skill||!!available;
    const cost=available?R.techniqueCost(hero,available):null;
    const price=entry.skill?(unlocked?cost+' 體力':'未解鎖'):entry.cost;
    const selected=entry.skill?action==='manual'&&selectedManualSkill===entry.skill.id:
      entry.value==='player'?action==='move':action==='sword-move';
    const unavailable=entry.skill&&unlocked?(hero.attacks>=R.attackLimit(hero)?'本回合出手次數已滿':
      hero.actions>=R.LIMITS.actions?'本回合行動次數已滿':
      cost>hero.stamina?'體力不足，還需要 '+(cost-hero.stamina)+' 點':''):'';
    button.disabled=!mine||locked||!unlocked;
    button.classList.toggle('is-locked',!unlocked);
    button.classList.toggle('is-unavailable',!!unavailable);
    button.setAttribute('aria-pressed',String(selected));
    button.querySelector('.tc-rw-price').textContent=price;
    button.title=entry.skill?(unlocked?entry.name+' · '+price+(unavailable?' · '+unavailable:''):
      entry.name+'：尚未達到武器 Lv.'+entry.skill.levelRequired+' 解鎖'):
      entry.name+' · '+price;
    button.setAttribute('aria-label',button.title);
  });
  syncRail(wheel.querySelector('[data-rail="outer"]'),
    outerOptions.findIndex(entry=>entry.value===outerValue),outerOptions.length);
  const detailSelected=[...inner.children].findIndex(button=>button.getAttribute('aria-pressed')==='true');
  syncRail(wheel.querySelector('[data-rail="inner"]'),detailSelected,detail.length);
  syncRailLabels(wheel,'outer');syncRailLabels(wheel,'inner');
  empty.hidden=true;
  ring.setAttribute('aria-label',basicSelected?'右圈：攻擊，點選戰場方向進行普通攻擊':
    selectedWeaponSlot<0?'右圈：移動，選擇內圈移動對象':
      '右圈：'+(book?.name||selectedWeaponId)+'，選擇內圈技能');
  ring.setAttribute('aria-description','兩圈皆可點選或沿滑軌拖曳，放開後選定；移動與第一招位於下方。');
}
function wheelWedge(start,end,outer,inner){
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
}
function wheelDetailOptions(hero,moving){
  if(moving)return [{value:'player',name:'角色'},
    ...(hero?.flyingSword?[{value:'sword',name:'飛劍'}]:[])];
  const skills=equippedTechniques(hero);
  const attacks=skills.length?skills:[R.basicFor(hero)];
  return attacks.map(skill=>({
    value:skills.length?'manual:'+skill.id:'attack',name:skill.name,skill
  }));
}
function detailAngle(index,count){return -90-90*(index+.5)/count;}
function detailIndex(angle,count){return Math.min(count-1,Math.floor((-90-angle)*count/90));}
function updateWheelChoices(container,options,selected,moveCost,hero,locked){
  const key=options.map(option=>option.value).join('|');
  if(container.dataset.choices!==key){
    container.dataset.choices=key;
    const sweep=90/options.length,gap=options.length>1?1:0;
    const buttons=options.map(({value},index)=>{
      const button=document.createElement('button');
      button.type='button';button.className='tc-sector';
      button.dataset.wheelChoice=value;
      button.style.clipPath=wheelWedge(-90-sweep*index-gap,-90-sweep*(index+1)+gap,100,74);
      const label=document.createElement('span');
      wheelMarker(label,detailAngle(index,options.length),WHEEL_RADII.detail);
      button.append(label);return button;
    });
    container.replaceChildren(...buttons);
  }
  for(const [index,option] of options.entries()){
    const button=container.children[index],cost=option.skill?R.techniqueCost(hero,option.skill):null;
    const empowered=!!option.skill&&R.focusTurns(hero)>0&&
      option.skill.school==='body'&&option.skill.kind!=='fist-focus';
    const price=cost===null?(option.value==='sword'?'每 2 格 1 體力':moveCost):cost+' 體力';
    const unavailable=cost===null?'':hero.attacks>=R.attackLimit(hero)?'本回合出手次數已滿':
      hero.actions>=R.LIMITS.actions?'本回合行動次數已滿':
      cost>hero.stamina?'體力不足，還需要 '+(cost-hero.stamina)+' 點':'';
    button.disabled=locked;
    button.setAttribute('aria-pressed',String(option.value===selected));
    const description=option.skill?Manuals.descriptionWithDamage(hero.atk*(state?.weaponDungeon&&option.skill?.school==='body'?(state.weaponDungeon.totemDamageMultiplier??1.15):1),option.skill,
      {flyingSwordReady:!!hero.flyingSword}):'';
    button.setAttribute('aria-label',option.name+'，'+price+
      (description?'。'+description:'')+(unavailable?'，'+unavailable:''));
    button.title=unavailable||option.name+' · '+price+(description?' · '+description:'');
    button.classList.toggle('is-unavailable',!!unavailable);
    button.classList.toggle('is-focus-empowered',empowered);
    if(empowered)button.title='✦ 金身蓄勢強化 · 體力減半 · '+option.name+' · '+price;
    wheelText(button.firstElementChild,empowered?'✦ '+option.name:option.name,price,skillArt(option.skill));
  }
}
function wheelMarker(marker,angle,radius){
  if(!marker)return;
  const rad=angle*Math.PI/180;
  marker.style.left=(100+radius*Math.cos(rad)).toFixed(3)+'%';
  marker.style.top=(100+radius*Math.sin(rad)).toFixed(3)+'%';
}
// Keep outer-sector labels and sliding indicator consistent with actual cost.
// Reuse the nodes so frequent battle updates do not restart the slide animation.
function wheelText(container,name,cost,art=''){
  if(!container)return;
  // One compact horizontal unit, not an image stacked above the cost text.
  // The selected marker and all fixed outer-ring options share this markup.
  let copy=container.querySelector('.tc-wheel-copy');
  let title=container.querySelector('.tc-wheel-name');
  let fee=container.querySelector('.tc-wheel-cost');
  if(!copy||!title||!fee){
    container.replaceChildren();
    copy=document.createElement('span');copy.className='tc-wheel-copy';
    title=document.createElement('span');title.className='tc-wheel-name';
    fee=document.createElement('small');fee.className='tc-wheel-cost';
    copy.append(title,fee);
    container.append(copy);
  }
  let image=container.querySelector('.tc-wheel-skill-art');
  if(art){
    if(!image){
      image=document.createElement('img');
      image.className='tc-wheel-skill-art';image.alt='';
      image.decoding='async';image.draggable=false;
      container.prepend(image);
    }
    if(image.getAttribute('src')!==art)image.src=art;
  }else image?.remove();
  container.classList.toggle('has-skill-art',!!art);
  if(title.textContent!==name)title.textContent=name;
  if(fee.textContent!==cost)fee.textContent=cost;
}
function showPvpSkill(button,skill,cost,attack=200,flyingSwordReady=false){
  const art=skillArt(skill),key=skill.id+'|'+art;
  if(button.dataset.artSkill!==key){
    button.replaceChildren();
    if(art){
      const image=document.createElement('img');
      image.className='tc-pvp-skill-art';image.alt='';image.decoding='async';image.src=art;
      button.append(image);
    }
    const name=document.createElement('span');name.className='tc-pvp-skill-name';
    button.append(name);button.dataset.artSkill=key;
  }
  const description=Manuals.descriptionWithDamage(attack,skill,{flyingSwordReady});
  button.querySelector('.tc-pvp-skill-name').textContent=skill.name+' · '+cost+' 體力';
  button.setAttribute('aria-label','功法技能：'+skill.name+'，消耗 '+cost+
    ' 體力。'+description);
  button.title=skill.name+' · '+cost+' 體力 · '+description;
}
// The slider is an actual curved annular pizza-sector, not a floating pill.
// Its SVG rotor pivots at the bottom-right corner of the quarter-circle.
function wheelSliderAngle(slider,angle){
  const rotor=slider?.querySelector('.tc-wheel-slider-rotor');
  if(rotor)rotor.style.transform='rotate('+(angle-WHEEL_ANGLES.upper).toFixed(3)+'deg)';
}
function selectWheel(value,tutorialAutomatic=false){
  if(!state||busy||renderer?.isAnimating||!myAction())return;
  const pressedAttack=value==='attack-ring'||value==='attack';
  syncEquippedAttack();
  const hero=myActor();
  if(hero?.manualWeaponMode||modernPveWheel()){
    const worn=currentWeaponIds(hero);
    if(value==='attack-ring'){
      const first=worn.findIndex(Boolean);
      if(first>=0){selectWheel('weapon:'+first,true);}
      else {selectWheel('attack',tutorialAutomatic);return;}
      if(!tutorialAutomatic&&tutorialStep()>=4){
        const prior=tutorialStep();tutorialEvent('attack-selected');
        if(prior===4&&tutorialStep()===5)selectWheel('move',true);
      }
      return;
    }
    if(value==='attack'&&!worn.some(Boolean)){
      selectedWeaponSlot=-1;selectedWeaponId='';
    }
    if(value==='move-menu'||value==='move'||value==='sword-move'){
      selectedWeaponSlot=-1;selectedWeaponId='';
      if(value==='move-menu')value='move';
    }else if(value.startsWith('weapon:')){
      const slot=Number(value.slice(7));
      if(!Number.isInteger(slot)||slot<0||slot>=2||!worn[slot])return;
      selectedWeaponSlot=slot;selectedWeaponId=worn[slot]||'';
      action='move';selection=null;
      if(selectedWeaponId)void AssetWarmup.warmImages(
        AssetWarmup.chosenSkills(selectedWeaponId,Manuals.BY_BOOK,skillArt),{max:3});
      renderer?.update(state,uid,battlefieldMode(),selection);
      updateControls();
      if(!tutorialAutomatic&&selectedWeaponId&&tutorialStep()>=4){
        const prior=tutorialStep();tutorialEvent('attack-selected');
        if(prior===4&&tutorialStep()===5)selectWheel('move',true);
      }
      return;
    }else if(value.startsWith('manual:')){
      const skillBook=Manuals.BY_SKILL[value.slice(7)]?.manualId;
      if(selectedWeaponSlot<0||worn[selectedWeaponSlot]!==skillBook)return;
    }else if((value==='player'||value==='sword')&&selectedWeaponSlot>=0)return;
  }
  if(value==='attack-ring'||value==='attack')value=attackChoice;
  if(value==='player'){
    if(action!=='move'&&action!=='sword-move')return;
    value='move';
  }
  if(value==='sword'){
    if(!myActor()?.flyingSword)return;
    value='sword-move';
  }
  const previousAction=action,previousManual=selectedManualSkill;
  if(value==='move')action='move';
  else if(value==='sword-move'&&myActor()?.flyingSword)action='sword-move';
  else if(value==='attack'&&!equippedTechniques(myActor()).length){
    action='attack';attackChoice='attack';
  }else if(value.startsWith('manual:')&&R.manualSkillFor(myActor(),value.slice(7))){
    action='manual';selectedManualSkill=value.slice(7);
    if(myActor()?.manualWeaponMode||modernPveWheel()){
      selectedWeaponId=Manuals.BY_SKILL[selectedManualSkill]?.manualId||'';
      selectedWeaponSlot=currentWeaponIds(myActor()).indexOf(selectedWeaponId);
    }
    attackChoice=value;
  }else return;
  if(action!==previousAction||selectedManualSkill!==previousManual){
    sealPeekPosition=null;selection=null;
    const me=myActor(),attackSkill=action==='manual'?R.manualSkillFor(me,selectedManualSkill):R.basicFor(me);
    if(me&&action!=='move'&&action!=='sword-move'&&(attackSkill?.range===0||attackSkill?.kind==='ring')){
      selection={x:me.x,y:me.y};
    }
  }
  renderer?.update(state,uid,battlefieldMode(),selection);
  updateControls();
  if(pressedAttack&&!tutorialAutomatic&&tutorialStep()>=4){
    const prior=tutorialStep();
    tutorialEvent('attack-selected');
    if(prior===4&&tutorialStep()===5)selectWheel('move',true);
  }
}


function sealGuideKey(){return 'qa:seal-attack-guide:v1:'+String(uid||'local');}
function hasReadSealGuide(){
  if(sealGuideSeenLocally.has(sealGuideKey()))return true;
  try{return localStorage.getItem(sealGuideKey())==='1';}catch(_){return false;}
}
function ackSealGuide(){
  const key=sealGuideKey();sealGuideSeenLocally.add(key);sealGuideForced=false;
  try{localStorage.setItem(key,'1');}catch(_){}
  refreshSealTargetGuidance();
  $('[data-seal-guide-help]')?.focus({preventScroll:true});
}
function peekSealTarget(seal){
  sealPeekPosition=seal?{x:seal.x,y:seal.y}:null;
  refreshSealTargetGuidance();
  if(seal)sealInspector?.inspect(seal);
}
function refreshSealTargetGuidance(){
  const guide=$('[data-seal-guide]'),hint=$('[data-seal-target-hint]');
  if(!guide||!hint)return;
  const inSeal=SealTargets.active(state,R);
  const active=inSeal&&state.status==='active';
  guide.hidden=!active||(hasReadSealGuide()&&!sealGuideForced);
  if(!inSeal){hint.hidden=true;return;}
  const chosen=SealTargets.at(renderer?.sealTargetPlan,selection)||
    SealTargets.at(renderer?.sealTargetPlan,sealPeekPosition);
  hint.hidden=!chosen;
  if(!chosen)return;
  const mode=battlefieldMode(),needsDirection=renderer?.sealTargetPlan?.skill&&
    ['line','cleave','fist-sweep','fist-throw','fist-chain'].includes(renderer.sealTargetPlan.skill.kind);
  const text=SealTargets.summary(chosen,mode)+
    (chosen.status==='ready'&&needsDirection?' · 請點選能覆蓋陣眼的紅色方向格':'');
  if(hint.textContent!==text)hint.textContent=text;
  hint.dataset.status=chosen.status;
}
function refreshSealRangeControls(){
  const toolbar=$('[data-seal-range-toolbar]');
  if(!toolbar||!state)return;
  const sealRanges=R.sealInfos(state).filter(p=>p.active);
  const available=state.mode==='pve'&&state.trial?.layoutVersion===4&&
    state.objective?.type==='sealing'&&sealRanges.length>0;
  toolbar.hidden=!available;
  if(!available){renderer?.setSealRangeMode('off',null);return;}
  if(!sealRanges.some(p=>p.id===sealRangeFocusId))sealRangeFocusId=sealRanges[0].id;
  const focused=sealRanges.find(p=>p.id===sealRangeFocusId);
  renderer?.setSealRangeMode(sealRangeMode,sealRangeFocusId);
  const toggle=$('[data-seal-range-toggle]'),next=$('[data-seal-range-next]'),
    note=$('[data-seal-range-note]');
  toggle.textContent='陣眼範圍：'+({all:'全部',focus:'單座',off:'隱藏'}[sealRangeMode]||'全部');
  toggle.setAttribute('aria-pressed',String(sealRangeMode!=='off'));
  toggle.title='切換陣眼效果範圍（全部／單座／隱藏）';
  next.hidden=sealRangeMode!=='focus'||sealRanges.length<2;
  if(note){
    const text=sealRangeMode==='all'?'藍：減傷 · 橙：增攻 · 紫紅：預告 · 綠：開路':
      sealRangeMode==='off'?'範圍已隱藏，實際戰鬥效果仍然生效':
      focused?.name+' · '+(focused?.range.kind==='warning'?
        (state.objective?.hazards?.length?'目前危險格已標示':'目前沒有危險格預告'):
        focused?.range.kind==='linked-block'?'顯示連動石障':focused?.range.label);
    if(note.textContent!==text)note.textContent=text;
  }
}
function cycleSealRangeMode(){
  if(!state||state.objective?.type!=='sealing')return;
  const modes=['all','focus','off'],index=modes.indexOf(sealRangeMode);
  sealRangeMode=modes[(index+1)%modes.length];
  refreshSealRangeControls();
}
function nextSealRangeFocus(){
  if(!state||state.objective?.type!=='sealing')return;
  const seals=R.sealInfos(state).filter(p=>p.active);
  if(seals.length<2)return;
  const index=seals.findIndex(p=>p.id===sealRangeFocusId);
  const next=seals[(index+1+seals.length)%seals.length];
  sealRangeMode='focus';sealRangeFocusId=next.id;
  refreshSealRangeControls();
  // Explicit navigation button moves the camera; no battle tile is selected
  // and no movement/attack command is submitted.
  renderer?.focusCameraOn(next);
}
function buildGame(){
  destroyRenderer();$('[data-main]').className='tc-main tc-game';
  root.classList.toggle('tc-quarter-layout',state?.mode==='pve');
  $('[data-main]').innerHTML=`<section class="tc-arena"><div class="tc-arena-heading"><span data-map-name></span><span data-range-legend></span></div><div class="tc-seal-range-toolbar" data-seal-range-toolbar role="group" aria-label="陣眼效果範圍" hidden><button type="button" data-seal-range-toggle aria-pressed="true" title="切換陣眼效果範圍">陣眼範圍：全部</button><button type="button" data-seal-range-next hidden title="查看下一座陣眼的範圍">下一座</button><button type="button" data-seal-guide-help title="再看一次陣眼攻擊教學" aria-label="陣眼攻擊教學">？</button><span data-seal-range-note aria-live="polite"></span></div><canvas tabindex="0" aria-label="方格戰場；點選灰格移動或紅格攻擊，也可使用方向鍵選擇目標"></canvas><div class="tc-focus-layer" data-focus-layer aria-hidden="true"></div><span class="tc-focus-indicator" data-focus-indicator role="status" aria-live="polite" hidden></span><span data-threat-a11y class="tc-threat-a11y" role="status" aria-live="polite" aria-atomic="true"></span><div class="tc-seal-guide" data-seal-guide hidden role="note"><strong>封印關卡 · 攻擊陣眼</strong><p>發光的懸浮晶核是可破壞的目標。先選擇普通攻擊或有效功法，再點選紅色射程內的陣眼；通常命中兩次就能破除。體力不足可先答題充能。</p><button type="button" data-seal-guide-dismiss>知道了</button></div><div class="tc-seal-target-hint" data-seal-target-hint hidden role="status" aria-live="polite"></div><div class="tc-objective" data-objective role="status" aria-live="polite" hidden></div>
      <section class="tc-boss-hud" data-boss-hud data-phase="1" data-boss-kind="rock" aria-label="首領生命與攻擊預告" hidden>
        <div class="tc-boss-line"><strong class="tc-boss-name" data-boss-name></strong><span class="tc-boss-phase" data-boss-phase>第一階段</span></div>
        <div class="tc-boss-health" data-boss-health role="progressbar" aria-label="首領生命">
          <div class="tc-boss-fill" data-boss-fill></div><div class="tc-boss-half" aria-hidden="true"></div>
        </div>
        <div class="tc-boss-subline"><span class="tc-boss-intent" data-boss-intent></span><span class="tc-boss-number" data-boss-number></span></div>
      </section>
      <div class="tc-boss-announcement" data-boss-announcement role="status" aria-live="polite" hidden></div>
      <div class="tc-selection" data-selection role="status" aria-live="polite" aria-atomic="true">點選地格，預覽路線與體力消耗</div><div class="tc-action-feedback" data-action-feedback role="status" aria-live="polite" aria-atomic="true" hidden></div></section>
    <aside class="tc-sidebar"><div class="tc-actors" data-actors></div><section class="tc-command"><div class="tc-stamina" data-stamina></div><button type="button" data-quiz>答題</button><div class="tc-action-tabs"><button type="button" data-action="move">移動</button><button type="button" data-action="attack">普通攻擊 · 2</button></div><button type="button" class="tc-confirm" data-execute>選擇目標</button><details class="tc-skill-info"><summary data-skill-title>操作說明</summary><div data-skill></div></details><div class="tc-turn-buttons"><button type="button" data-guard>護身</button><button type="button" data-end>結束回合</button></div></section>
    <div class="tc-game-footer"><details class="tc-history"><summary>戰況與詳情</summary><div class="tc-combat-info" data-combat-info></div><div class="tc-log" data-log role="log" aria-label="戰況紀錄"></div></details><button type="button" data-sync>同步</button><button type="button" data-leave>離開</button></div></aside>`;
  if(state?.mode==='pvp')syncPvpSkillTabs();
  if(state?.mode==='pve'){
    // PvE puts charging on the left and actions with their choices on the right.
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
      +'</svg><span class="tc-energy-number" data-energy-number aria-hidden="true">0</span>'
      +'<span class="tc-charge-label" data-charge-label aria-hidden="true">答題充能（0/2）</span>';
    quiz.setAttribute('aria-label','答題充能');
    energy.append(quiz);
    const actions=document.createElement('section');
    actions.className='tc-quarter tc-quarter-action';
    actions.setAttribute('aria-label','選擇行動與技能');
    actions.innerHTML='<svg class="tc-action-lines" viewBox="0 0 100 100" aria-hidden="true">'
      +'<path d="M 100 0 A 100 100 0 0 0 0 100"/>'
      +'<path d="M 100 26 A 74 74 0 0 0 26 100"/>'
      +'<path d="M 100 51 A 49 49 0 0 0 51 100"/>'
      // Thin rails surround the shorter/narrower coloured moving slices.
      +'<path class="tc-wheel-lane-guide" d="M 100 5 A 95 95 0 0 0 5 100"/>'
      +'<path class="tc-wheel-lane-guide" d="M 100 21 A 79 79 0 0 0 21 100"/>'
      +'<path class="tc-wheel-lane-guide" d="M 100 30 A 70 70 0 0 0 30 100"/>'
      +'<path class="tc-wheel-lane-guide" d="M 100 46 A 54 54 0 0 0 46 100"/></svg>';
    const tabs=command.querySelector('.tc-action-tabs');
    const attack=tabs.querySelector('[data-action="attack"]');
    const move=tabs.querySelector('[data-action="move"]');
    const end=command.querySelector('[data-end]');
    attack.className='tc-sector tc-sector-attack';
    attack.dataset.wheelAction='attack-ring';
    attack.style.clipPath=wheelWedge(-90,-135,74,49);
    attack.innerHTML='<span>攻擊</span>';
    move.className='tc-sector tc-sector-move';move.dataset.wheelAction='move';
    move.style.clipPath=wheelWedge(-135,-180,74,49);
    move.innerHTML='<span>移動</span>';
    end.className='tc-sector tc-sector-end';
    end.style.clipPath=wheelWedge(-90,-180,49,0);
    end.innerHTML='<span><b>結束</b><b>回合</b></span>';
    end.setAttribute('aria-label','結束回合');
    const choices=document.createElement('div');
    choices.className='tc-wheel-options';
    choices.setAttribute('role','group');
    choices.setAttribute('aria-label','選擇攻擊技能');
    // Narrow curved selection pieces glide *inside* each ring. The visible
    // arc angle is driven by the number of choices, not hard-coded to 45°.
    const makeSlider=(kind,choicesCount)=>{
      const ns='http://www.w3.org/2000/svg';
      const svg=document.createElementNS(ns,'svg');
      svg.classList.add('tc-wheel-slider','tc-wheel-slider-'+kind);
      svg.setAttribute('viewBox','0 0 100 100');
      svg.setAttribute('aria-hidden','true');
      svg.setAttribute('focusable','false');
      const rotor=document.createElementNS(ns,'g');
      rotor.classList.add('tc-wheel-slider-rotor');
      const shape=document.createElementNS(ns,'path');
      shape.classList.add('tc-wheel-slider-shape');
      rotor.append(shape);svg.append(rotor);
      wheelSliderShape(svg,choicesCount);
      return svg;
    };
    const actionSlider=makeSlider('action',2);
    const detailSlider=makeSlider('detail',1);
    const actionMarker=document.createElement('span');
    actionMarker.className='tc-wheel-marker tc-wheel-action-marker';
    actionMarker.setAttribute('aria-hidden','true');
    actionMarker.textContent='移動';
    const detailMarker=document.createElement('span');
    detailMarker.className='tc-wheel-marker tc-wheel-detail-marker';
    detailMarker.setAttribute('aria-hidden','true');
    detailMarker.textContent='玩家';
    actions.append(tabs,choices,end,actionSlider,detailSlider,actionMarker,detailMarker);
    // Both rings are independently draggable. A click selects a fixed
    // station; the labelled slider smoothly glides to that station.
    let pointer=null;
    const pointerAngle=e=>{
      const bounds=actions.getBoundingClientRect();
      return Math.max(-180,Math.min(-90,Math.atan2(e.clientY-bounds.bottom,e.clientX-bounds.right)*180/Math.PI));
    };
    actions.addEventListener('pointerdown',e=>{
      if(modernPveWheel())return;
      if(pointer||e.target.closest('[data-end]'))return;
      const b=e.target.closest('button[data-wheel-action],button[data-wheel-choice]');
      if(!b||b.disabled)return;
      pointer={id:e.pointerId,x:e.clientX,y:e.clientY,ring:b.dataset.wheelChoice?'detail':'action',moved:false};
    });
    actions.addEventListener('pointermove',e=>{
      if(modernPveWheel())return;
      if(!pointer||pointer.id!==e.pointerId)return;
      if(Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>8){
        if(!pointer.moved){
          pointer.moved=true;
          try{actions.setPointerCapture(e.pointerId);}catch(_){}
          // Drag follows the finger instantly; releasing snaps to a station.
          (pointer.ring==='detail'?detailMarker:actionMarker).classList.add('is-dragging');
          (pointer.ring==='detail'?detailSlider:actionSlider).classList.add('is-dragging');
        }
        const angle=pointerAngle(e);
        wheelMarker(pointer.ring==='detail'?detailMarker:actionMarker,
          angle,WHEEL_RADII[pointer.ring]);
        wheelSliderAngle(pointer.ring==='detail'?detailSlider:actionSlider,angle);
        e.preventDefault();
      }
    });
    const endPointer=e=>{
      if(!pointer||pointer.id!==e.pointerId)return;
      const gesture=pointer;pointer=null;
      const marker=gesture.ring==='detail'?detailMarker:actionMarker;
      marker.classList.remove('is-dragging');
      (gesture.ring==='detail'?detailSlider:actionSlider).classList.remove('is-dragging');
      if(actions.hasPointerCapture?.(e.pointerId))actions.releasePointerCapture(e.pointerId);
      if(e.type==='pointercancel'){updateControls();return;}
      if(!gesture.moved)return;
      wheelIgnoreClickUntil=Date.now()+350;
      const next=gesture.ring==='action'?
        (pointerAngle(e)>WHEEL_ANGLES.center?'attack-ring':'move'):
        choices.children[detailIndex(pointerAngle(e),choices.childElementCount)]?.dataset.wheelChoice;
      if(next)selectWheel(next);
      updateControls(); // also snaps back if the turn became locked
    };
    actions.addEventListener('pointerup',endPointer);
    actions.addEventListener('pointercancel',endPointer);
    actions.addEventListener('lostpointercapture',e=>{
      if(pointer&&pointer.id===e.pointerId){
        pointer=null;
        actionMarker.classList.remove('is-dragging');
        detailMarker.classList.remove('is-dragging');
        actionSlider.classList.remove('is-dragging');
        detailSlider.classList.remove('is-dragging');
        updateControls();
      }
    });
    actions.addEventListener('keydown',e=>{
      if(modernPveWheel())return;
      const b=e.target.closest('button[data-wheel-action],button[data-wheel-choice]');
      if(!b||!['ArrowLeft','ArrowRight'].includes(e.key))return;
      e.preventDefault();
      const upper=e.key==='ArrowRight';
      if(b.dataset.wheelAction){
        const next=upper?'attack-ring':'move';
        selectWheel(next);
        (upper?attack:move).focus();
      }else{
        const buttons=[...choices.children];
        const index=Math.max(0,Math.min(buttons.length-1,buttons.indexOf(b)+(upper?-1:1)));
        const next=buttons[index];
        if(next){selectWheel(next.dataset.wheelChoice);next.focus();}
      }
    });
    command.prepend(energy,actions);
  }
  renderer=new TacticalRenderer($('canvas'),p=>{if(!busy){
    const step=tutorialStep(),target=R.TUTORIAL_STAGE1;
    if(step===4||step===6){notice('請先點選右環外圈的武器名稱或「攻擊」。');return;}
    if(step===5&&(action!=='move'||p.x!==target.move.x||p.y!==target.move.y)){
      notice('這一階段請點選角色正右方一格（只移動一格）。');return;
    }
    if(step===7&&(!['attack','manual'].includes(action)||
      p.x!==target.enemy.x||p.y!==target.enemy.y)){
      notice('請點選正右方靈狼的方向，對準牠攻擊。');return;
    }
    // In move mode a live seal is an information target, not a walk tile.
    // Attack mode retains its existing tap-to-cast and direction handling.
    if((action==='move'||action==='sword-move')&&R.sealInfo(state,p)?.active&&sealInspector?.inspect(p))return;
    if(modernPveWheel()&&selectedWeaponSlot>=0&&action==='move'){
      notice('請先選擇這把武器內圈的技能');return;
    }
    sealPeekPosition=null;selection=p;renderer.update(state,uid,battlefieldMode(),selection);updateControls();
    // The sketch has no extra confirm button: choosing a valid map tile
    // directly executes the selected move or directional attack.
    const selectedSeal=R.sealInfo(state,p);
    if(root.classList.contains('tc-quarter-layout')&&
      ['move','sword-move','attack','skill','manual'].includes(action)&&
      !(selectedSeal?.active&&(action==='move'||action==='sword-move'))&&
      !$('[data-execute]').disabled)void execute();
  }},()=>{
    if(!opened||!state||!renderer)return;updateControls();
    if(!renderer.isAnimating&&state.status==='finished'&&!modalOpen)resultDialog();
    else if(!renderer.isAnimating&&!modalOpen&&state.quizRound)schedule();
  },(actorUid,kind)=>beastInspector?.inspect(actorUid,kind),seal=>peekSealTarget(seal));
}
function hideBossBanner(){
  clearTimeout(bossBannerTimer);bossBannerTimer=null;
  const el=$('[data-boss-announcement]');
  if(el)el.hidden=true;
}
function updateBossHud(){
  const node=$('[data-boss-hud]');if(!node)return;
  const boss=CombatImpact.bossStatus(state);
  node.hidden=!boss||!boss.alive;
  if(!boss||!boss.alive)return;
  node.dataset.phase=String(boss.phase);
  node.dataset.bossKind=boss.kind;
  node.querySelector('[data-boss-name]').textContent=boss.name;
  node.querySelector('[data-boss-phase]').textContent=state.weaponDungeon?'領主交戰':boss.phase===2?'第二階段':'第一階段';
  node.querySelector('[data-boss-intent]').textContent=boss.intent;
  node.querySelector('[data-boss-number]').textContent=Math.ceil(boss.hp)+' / '+Math.ceil(boss.maxHp);
  const meter=node.querySelector('[data-boss-health]');
  meter.setAttribute('aria-valuemin','0');meter.setAttribute('aria-valuemax',String(Math.ceil(boss.maxHp)));
  meter.setAttribute('aria-valuenow',String(Math.ceil(boss.hp)));
  node.querySelector('[data-boss-fill]').style.width=(boss.ratio*100).toFixed(2)+'%';
}
function showBossBanner(kind,name){
  const node=$('[data-boss-announcement]');
  if(!node||!state||state.mode!=='pve')return;
  hideBossBanner();node.dataset.kind=kind;
  const title=state.weaponDungeon?'石域領主現身':kind==='phase'?'靈壓暴漲 · 第二階段':'鎮關靈獸現身';
  const subtitle=state.weaponDungeon?'追蹤落石已啟動，可退出射程或擊退打斷':kind==='phase'?'攻擊形態已改變，留意地面的紅色預告格':'觀察首領攻擊意圖，避開危險範圍';
  node.innerHTML='<small>'+esc(title)+'</small><strong>'+esc(name)+'</strong><span>'+esc(subtitle)+'</span>';
  // Reinsert only the passive announcement; none of the battle controls move.
  node.hidden=false;
  try{window.QAGameAudio?.play('spirit-pulse',{volume:kind==='phase'?.36:.27});}catch(_){}
  bossBannerTimer=setTimeout(()=>{if(node.isConnected)node.hidden=true;bossBannerTimer=null;},1400);
}
function maybeAnnounceBoss(){
  if(modalOpen||state?.mode!=='pve'||state?.status!=='active'||state.newEnemies?.length)return;
  const boss=CombatImpact.bossStatus(state);
  if(!boss||!boss.alive)return;
  if(bossTransitionPending?.roomId===state.id){
    const pending=bossTransitionPending;bossTransitionPending=null;
    bossIntroSeenRoom=state.id;
    showBossBanner('phase',pending.name);return;
  }
  if(bossIntroSeenRoom!==state.id){
    bossIntroSeenRoom=state.id;showBossBanner('entry',boss.name);
  }
}
function paint({preserveModal=false}={}){
  if(!state)return renderHub();syncEquippedAttack();if(!preserveModal)hideModal();
  renderBattleLoadouts();
  if(state.status==='active')void refreshBattleLoadouts();
  $('[data-title]').textContent=state.weaponDungeon?state.trial.title:state.mode==='pve'?'問道試煉':'鬥法論道';
  if(state.status==='waiting'){
    destroyRenderer();root.classList.remove('tc-quarter-layout');$('[data-main]').className='tc-main tc-waiting';
    $('[data-main]').innerHTML=`<div><h2>配對中…</h2><p>也可將代碼傳給道友加入。</p><code>${esc(state.id.replace('arena-',''))}</code><button type="button" data-copy>複製代碼</button><button type="button" data-leave>取消配對</button></div>`;return;
  }
  if(state.status==='active'&&warmedCombatAudioRoomId!==state.id){
    warmedCombatAudioRoomId=state.id;
    void window.QAGameAudio?.preload(['combat-impact','spirit-pulse','reward-chime']);
  }
  if(!renderer||!$('canvas'))buildGame();
  if(state.mode==='pvp')syncPvpSkillTabs();
  const me=myActor(),myTurn=myAction();
  $('[data-map-name]').textContent=state.weaponDungeon?state.trial.title:state.trial?'第 '+state.trial.stage+' 關 · '+state.trial.title:R.mapFor(state.map).name;
  const objective=state.objective,objectiveNode=$('[data-objective]');
  objectiveNode.hidden=!objective;
  if(objective){
    const living=state.actors.filter(a=>a.bot&&a.hp>0).length;
    const weaponLord=state.weaponDungeon?state.actors.find(a=>a.bot&&a.weaponDungeonLord):null;
    const tracking=state.weaponDungeon?state.actors.filter(a=>a.bot&&a.hp>0&&a.intent?.tracking&&a.intent.kind==='attack'&&a.intent.cells?.some(p=>p.x===me.x&&p.y===me.y)).length:0;
    const label=state.trial?.variant?.includes('breakthrough')?'突圍運送':objective.item?'尋物運送':'運送';
    // Keep the battlefield objective summary in sync with the server's seal metadata.
    const sealEffects=[...new Set((objective.points||[]).filter(p=>!p.activated)
      .map(p=>R.sealDefinition(p.kind)?.shortEffect).filter(Boolean))].join('／');
    const text=state.weaponDungeon?`${state.weaponDungeon.name} · ${weaponLord?.hp>0?'擊敗領主即通關':'領主已擊敗'} · ${tracking?'危險：'+tracking+' 道追蹤落石':'圖騰 +'+Math.round(((state.weaponDungeon.totemDamageMultiplier??1.15)-1)*100)+'%'}`:
      objective.type==='transport'?(objective.carrying?`${label} · 將靈物送至交付點`:`${label} · 先取得靈物`):
      objective.type==='defense'?`鎮守 · ${objective.completedRounds} / ${objective.rounds} 回合 · 靈陣 ${objective.hp} / ${objective.maxHp}`:
      objective.type==='sealing'?`封印 · ${objective.points.filter(p=>p.activated).length} / ${objective.points.length} 陣眼${state.trial?.layoutVersion===4?' · 攻擊陣眼'+(sealEffects?' · '+sealEffects:''):''}`:
      objective.type==='boss'?'首領 · 擊敗大型靈獸':`討伐 · 剩餘 ${living} 隻靈獸`;
    objectiveNode.textContent=objective.completed&&!state.weaponDungeon&&!me.answered?'目標完成 · 請先作答一題':text;
  }
  $('[data-actors]').innerHTML=state.actors.map(a=>`<div class="tc-actor ${a.uid===uid?'is-self':''} ${a.hp<=0?'is-down':''}" aria-label="${esc(a.name)}，生命 ${a.hp} / ${a.maxHp}"><div><b>${esc(a.name)}</b><span>${a.hp}/${a.maxHp}</span></div><div class="tc-health"><i style="width:${a.hp/a.maxHp*100}%"></i></div>${a.bot?`<small>${Manuals.realmForStage(a.level).name}境 · 功法 +${Manuals.expForBeast(a.level)} EXP</small>`:''}${a.shield||a.slow?`<small>${[a.shield?'護盾 '+a.shield:'',a.slow?'緩速':''].filter(Boolean).join(' · ')}</small>`:''}</div>`).join('');
  $('[data-combat-info]').innerHTML=state.actors.filter(a=>a.hp>0&&a.intent).map(a=>'<p><b>'+esc(a.name)+'</b><span>'+esc(a.intent.text)+'</span></p>').join('');
  $('[data-stamina]').innerHTML=`<b>體力 <strong>${me.stamina}</strong><span> / ${R.LIMITS.stamina}</span></b><div>${Array.from({length:10},(_,i)=>`<i class="${i<me.stamina?'filled':''}"></i>`).join('')}</div><small>出手 ${me.attacks}/${R.attackLimit(me)}</small>`;
  if(root.classList.contains('tc-quarter-layout')){
    const amount=Math.max(0,Math.min(R.LIMITS.stamina,me.stamina));
    $('[data-energy-number]').textContent=String(amount);
    root.querySelectorAll('[data-energy-segment]').forEach(segment=>
      segment.classList.toggle('is-filled',Number(segment.dataset.energySegment)<amount));
    const quizButton=$('[data-quiz]');
    $('[data-charge-label]').textContent=`答題充能（${me.questions}/${R.LIMITS.questions}）`;
    quizButton.title=`本回合充能 ${me.questions} / ${R.LIMITS.questions} 次`;
    quizButton.setAttribute('aria-label',`答題充能，${quizButton.title}，目前能量 ${amount} / ${R.LIMITS.stamina}，答對增加 4，答錯增加 1`);
  }else $('[data-quiz]').textContent=canQuestion()?`答題 ${me.questions}/2`:state.quizRound&&me.questions>=2?'答題完成':myTurn?'無法再答題':'等待對手';
  $('[data-log]').innerHTML=state.events.slice(-5).map(e=>`<p class="is-${esc(e.type)}">${esc(e.text)}</p>`).join('');
  // Scene-specific warmup: only current players, objective art and the
  // actively equipped weapons. No six-weapon/whole-game asset sweep.
  void AssetWarmup.warmImages(AssetWarmup.trialImages(state,uid),{max:8});
  renderer.update(state,uid,battlefieldMode(),selection);refreshSealRangeControls();updateControls();refreshSealTargetGuidance();updateClock();
  beastInspector?.refresh();sealInspector?.refresh();updateBossHud();
  // Resume/open through room-state polling also prefetches before any click.
  if(!modalOpen)preloadTacticalQuestions();
  if(state.status==='finished'&&!renderer.isAnimating&&!modalOpen)resultDialog();
  else if(state.mode==='pve'&&state.newEnemies?.length)showEnemyIntro();
  else maybeAnnounceBoss();
}
function updateControls(){
  if(!$('[data-selection]')||!state)return;
  const me=myActor(),mine=myAction(),basic=R.basicFor(me),
    chosenSkill=action==='manual'?R.manualSkillFor(me,selectedManualSkill):basic,
    shown=chosenSkill||basic,animating=renderer?.isAnimating,locked=busy||animating;
  const quizButton=$('[data-quiz]');
  const focusTurns=me?R.focusTurns(me):0;
  const focusBadge=$('[data-focus-indicator]');
  if(focusBadge){
    const active=state.mode==='pve'&&state.status==='active'&&
      R.alive(me)&&focusTurns>0;
    focusBadge.hidden=!active;
    focusBadge.textContent=active?'✦ 金身蓄勢 '+focusTurns+'/2 回合':'';
    focusBadge.title=active?'體術技能體力減半；每回合最多施放三次技能':'';
  }
  quizButton.disabled=!canQuestion()||locked;
  if(root.classList.contains('tc-quarter-layout')){
    const ready=!quizButton.disabled&&!modalOpen;
    quizButton.classList.toggle('is-charge-ready',ready);
    quizButton.setAttribute('aria-description',ready?
      '可以答題充能，按下開始答題':'目前無法答題充能');
  }
  $('[data-guard]').disabled=!mine||locked||me.attacks>=R.attackLimit(me);
  $('[data-end]').disabled=!mine||locked;
  $('[data-sync]').disabled=locked;
  root.classList.toggle('tc-animating',!!animating);
  $('[data-stamina]').classList.toggle('tc-gaining',!modalOpen&&renderer?.currentKind==='answer');
  const t=selection?R.at(state,selection):null;
  const selectedSeal=selection?R.sealInfo(state,selection):null;
  const directional=['line','cleave','fist-sweep','fist-throw','fist-chain'].includes(shown.kind);
  const quarter=root.classList.contains('tc-quarter-layout'),cost=R.techniqueCost(me,shown);
  const basicTab=$('[data-action="attack"]');
  if(basicTab&&!quarter&&basicTab.dataset.action==='attack')basicTab.textContent='普通攻擊 · '+basic.cost;
  let label=action==='move'?'選擇移動位置':action==='sword-move'?'選擇飛劍移動位置':directional?'選擇攻擊方向':
    shown.kind==='ring'?'震擊周圍':shown.kind==='dash-cleave'?'選擇突進落點':
      shown.kind==='flying-sword'?(me.flyingSword?'選擇飛劍移動位置':'選擇召劍位置'):'選擇施放位置';
  let error='',moveStamina=null;
  const d=selection&&directional&&(selection.x===me.x||selection.y===me.y)?
    R.attackDirection(me,selection):null;
  const direction=d?(d.x>0?'右':d.x<0?'左':d.y>0?'下':'上'):'';
  if((action==='move'||action==='sword-move')&&selectedSeal?.active){
    label='這是可攻擊的陣眼，請切換攻擊模式';
    error='此處是陣眼，請先選擇攻擊招式';
  }else if(action==='sword-move'&&selection){
    const route=R.swordRoute(state,me,selection),steps=route?route.length-1:0;
    if(steps>0&&steps%2===0)moveStamina=steps/2;
    label=steps>0?'飛劍移動 '+steps+' 格 · '+(steps/2)+' 體力':'無法移動飛劍至此';
    if(!me.flyingSword)error='目前沒有飛劍';
    else if(!steps||steps%2)error='飛劍必須移動偶數格';
    else if(R.at(state,selection))error='飛劍落點必須是空地';
    else if(steps/2>me.stamina)error='體力不足';
  }else if(action==='move'&&selection){
    const route=R.path(state,me,selection,uid),cost=route?route.length-1:0;
    if(route&&route.length>1)moveStamina=cost;
    label=route&&route.length>1?`移動至此 · ${cost} 體力`:'無法移動至此';
    if(!route||route.length<2)error='此地格無法到達';
    else if(me.slow&&cost>2)error='緩速中，一次最多移動 2 格';
    else if(cost>me.stamina)error='體力不足';
  }else if(selection){
    if(action==='manual'&&!chosenSkill)error='尚未裝備此功法技能';
    else {
      label=(action==='attack'&&directional&&direction?'向'+direction+'攻擊':shown.name)+' · '+cost+' 體力';
      try{R.validateSkill(state,me,shown,selection);}catch(e){error=e.message;}
    }
  }
  // A valid aim does not guarantee that an AoE actually hits the seal.
  // Block an auto-cast when the selected seal is outside its real hit cells.
  if(selectedSeal?.active&&action!=='move'&&action!=='sword-move'&&!error){
    const guidance=SealTargets.at(renderer?.sealTargetPlan,selection);
    if(guidance&&guidance.status!=='ready')error=guidance.reason;
    let affected=[];
    try{affected=R.skillCells(state,me,shown,selection)||[];}catch(_){}
    if(!error&&!affected.some(p=>p.x===selectedSeal.x&&p.y===selectedSeal.y))
      error='此招式不會命中所選陣眼，請改選能覆蓋陣眼的攻擊方向';
  }
  const description=Manuals.descriptionWithDamage(me.atk*(state?.weaponDungeon&&shown?.school==='body'?(state.weaponDungeon.totemDamageMultiplier??1.15):1),shown,
    {flyingSwordReady:!!me.flyingSword});
  $('[data-skill-title]').textContent=action==='move'||action==='sword-move'?'移動說明':
    `${shown.name} · ${cost} 體力`;
  $('[data-skill]').innerHTML=action==='move'?
    '<p>每移動一格固定消耗 1 體力，路線繞路也計入；緩速時一次最多移動 2 格。選好位置後移動。</p>':
    action==='sword-move'?'<p>飛劍沿最短路徑移動偶數格，每 2 格消耗 1 體力，穿過靈獸會造成傷害。</p>':
    `<p>${esc(description)}</p>`;
  $('[data-execute]').textContent=error||label;
  $('[data-execute]').disabled=!mine||locked||!selection||!!error||me.actions>=R.LIMITS.actions;
  // The confirm button is intentionally hidden in the quarter-wheel PvE layout.
  // Show why the selected attack cannot be executed, even before a tile is tapped.
  const feedback=$('[data-action-feedback]');
  if(feedback){
    let reason='';
    const attackMode=action==='attack'||action==='manual';
    if(!mine)reason=state.status!=='active'?'本場戰鬥尚未進入行動階段':
      state.quizRound&&state.phase!=='action'?'請先完成本輪答題，或等待行動階段':'尚未輪到你的行動回合';
    else if(animating)reason='招式動畫播放中，演出結束後可繼續操作';
    else if(busy)reason='上一個行動處理中，請稍候';
    else if(me.actions>=R.LIMITS.actions)reason='本回合行動次數已滿，請結束回合';
    else if(attackMode&&me.attacks>=R.attackLimit(me))reason='本回合出手次數已滿（'+R.attackLimit(me)+' 次），請結束回合';
    else if(attackMode&&action==='manual'&&!chosenSkill)reason='尚未裝備或解鎖此武器技能';
    else if(attackMode&&me.stamina<cost)reason='體力不足：需要 '+cost+' 點，目前 '+me.stamina+' 點，請答題充能';
    else if(selection&&error)reason=error;
    else if(attackMode&&shown&&!R.aimCells(state,me,shown).length)reason='目前沒有可指定的攻擊地格，請移動或改用其他招式';
    feedback.textContent=reason?(attackMode?'無法攻擊：':'無法移動：')+reason:'';
    feedback.hidden=!reason;
  }
  root.querySelectorAll('[data-action]').forEach(b=>{
    b.setAttribute('aria-pressed',String(b.dataset.action===action||
      (action==='manual'&&b.dataset.action==='manual:'+selectedManualSkill)||
      (quarter&&b.dataset.action==='attack'&&action==='manual')));
    b.disabled=!mine||locked;
    if(!quarter&&b.dataset.action.startsWith('manual:')){
      const technique=R.manualSkillFor(me,b.dataset.action.slice(7));
      if(technique){
        const cost=R.techniqueCost(me,technique);
        showPvpSkill(b,technique,cost,me.atk,!!me.flyingSword);
        
      }
    }
  });
  if(quarter){
    renderModernWeaponWheel(me,locked,mine);
  }else if(quarter){
    root.classList.remove('tc-modern-weapon-wheel');
    const attacking=action!=='move'&&action!=='sword-move';
    const chosenCost=cost+' 體力',moveCostLabel=moveStamina===null?'1 體力/格':moveStamina+' 體力';
    const ring=$('.tc-quarter-action'),choices=ring.querySelector('.tc-wheel-options');
    const options=wheelDetailOptions(me,!attacking),selected=attacking?attackChoice:(action==='sword-move'?'sword':'player');
    updateWheelChoices(choices,options,selected,moveCostLabel,me,!mine||locked);
    ring.classList.toggle('has-focus',focusTurns>0);
    choices.setAttribute('aria-label',attacking?'選擇攻擊技能':'移動目標');
    const targetName=attacking?shown.name:action==='sword-move'?'飛劍':'角色',targetCost=attacking?chosenCost:moveCostLabel;
    const detailSelection=Math.max(0,options.findIndex(option=>option.value===selected));
    const selectedAngle=detailAngle(detailSelection,options.length);
    ring.setAttribute('aria-label',attacking?
      '行動：攻擊；'+targetName+'，'+targetCost:
      '行動：移動；目標：'+targetName+'，'+moveCostLabel);
    const actionThumb=$('.tc-wheel-action-marker'),detailThumb=$('.tc-wheel-detail-marker');
    actionThumb.textContent=attacking?'攻擊':'移動';
    wheelText(detailThumb,targetName,targetCost,attacking?skillArt(shown):'');
    const chosenEmpowered=attacking&&focusTurns>0&&shown.school==='body'&&
      shown.kind!=='fist-focus';
    detailThumb.classList.toggle('is-focus-empowered',chosenEmpowered);
    detailThumb.title=(chosenEmpowered?'✦ 金身蓄勢強化 · ':'')+
      targetName+' · '+targetCost+(attacking?' · '+description:'');
    const actionAngle=attacking?WHEEL_ANGLES.upper:WHEEL_ANGLES.lower;
    wheelMarker(actionThumb,actionAngle,WHEEL_RADII.action);
    wheelMarker(detailThumb,selectedAngle,WHEEL_RADII.detail);
    wheelSliderShape($('.tc-wheel-slider-action'),ring.querySelectorAll('[data-wheel-action]').length);
    wheelSliderShape($('.tc-wheel-slider-detail'),options.length);
    wheelSliderAngle($('.tc-wheel-slider-action'),actionAngle);
    wheelSliderAngle($('.tc-wheel-slider-detail'),selectedAngle);
  }
  $('[data-range-legend]').textContent=(action==='move'?'灰格可走':
    action==='sword-move'?'青格可飛':
    ['dash-cleave','flying-sword'].includes(shown.kind)?'金格為落點':'紅格射程')+' · 紅框預告';
  const hint=action==='move'?'點選灰格移動':
    action==='sword-move'?'點選青格讓飛劍沿最短路徑移動':
    action==='attack'?(directional?'點選紅格，選擇攻擊方向':'點選紅格內的敵人'):
    shown.kind==='dash-cleave'?'點選金色地格突進，紅格為攻擊範圍':
    shown.kind==='flying-sword'?(me.flyingSword?'點選金色地格御劍':'點選金色地格召喚飛劍'):
    shown.kind==='fist-focus'?'點選自己蓄勢，施放後立即結束回合':
    directional?'點選紅格，選擇出拳或出劍方向':
    shown.range===0?'點選自己施放技能':'點選紅格施放技能';
  $('[data-selection]').textContent=selection?
    `${action==='attack'&&basic.kind==='ring'?'震擊周圍一圈 · '+R.skillCells(state,me,basic,selection).length+' 格':
      action==='attack'&&directional&&direction?'向'+direction+'攻擊 '+R.skillCells(state,me,basic,selection).length+' 格':
      t?t.name+' · 生命 '+t.hp+'/'+t.maxHp:'位置 '+(selection.x+1)+', '+(selection.y+1)}
      ${error?' · '+error:''}`:
    mine?hint:'等待對手行動';
  if(animating)$('[data-selection]').textContent=renderer.currentAction;
  refreshSealTargetGuidance();
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
    `${state.weaponDungeon?state.weaponDungeon.realm+' · ':state.trial?'第 '+state.trial.stage+' 關 · ':''}第 ${state.turn} 回合 · ${mine?'你的行動':'對手行動'}${state.deadlineMs?' · '+Math.max(0,Math.ceil((state.deadlineMs-now)/1000))+' 秒':''}`;
  const fighter=myActor(),focus=fighter?R.focusTurns(fighter):0;
  if(state.status==='active'&&mine&&focus)$('[data-turn]').textContent+=` · 蓄勢 ${focus} 回合 · 出手 ${fighter.attacks}/${R.attackLimit(fighter)}`;
  $('[data-quiz-clock]')?.replaceChildren(document.createTextNode(quizLabel||'兩題已完成'));
  const answerExpired=state.answerDeadlineMs&&now>=state.answerDeadlineMs&&state.actors.some(a=>a.questions<2&&!a.quizExpired);
  if(state.status==='active'&&(state.deadlineMs&&now>=state.deadlineMs||answerExpired)&&!busy&&Date.now()>=deadlineSyncAt){deadlineSyncAt=Date.now()+retryMs;void sync();}
}
function showModal(html,{quiz=false,encounter=false}={}){
  hideBossBanner();beastInspector?.dismiss();sealInspector?.dismiss();
  loadoutMenuOpen=false;renderBattleLoadouts();
  introDemo?.destroy();introDemo=null;
  modalOpen=true;$('[data-modal]').hidden=false;$('[data-modal]').innerHTML=`<section class="tc-dialog${quiz?' tc-quiz':''}${encounter?' tc-encounter':''}" role="dialog" aria-modal="true" tabindex="-1">${html}</section>`;
  $('[data-main]').inert=true;$('[data-close]').disabled=true;renderer?.setPaused(true);
  beastInspector?.refresh();
  $('[data-modal] .tc-dialog').focus({preventScroll:true});
  const modal=$('[data-modal]');
  const mathFields=[...modal.querySelectorAll('[data-question-text], .quiz-rich-option, .tc-feedback-text')];
  window.quizMathTypeset?.(mathFields.length?mathFields:modal);
}
function hideModal(){if(!root)return;window.currentTacticalQuiz=null;closePairWhiteboard();introDemo?.destroy();introDemo=null;modalOpen=false;$('[data-modal]').hidden=true;$('[data-modal]').innerHTML='';$('[data-main]').inert=false;$('[data-close]').disabled=false;renderer?.setPaused(false);beastInspector?.refresh();sealInspector?.refresh();}
function showBeastDemo(species){
  if(!state||state.mode!=='pve'||!R.MONSTERS[Number(species)])return;
  const encounter=state.actors.find(a=>a.bot&&a.species===Number(species));
  const beast=encounter?.trackingAttack?R.monsterProfileFor(encounter):R.monsterProfile(species);
  showModal('<div class="tc-enemy-heading"><div class="tc-enemy-portrait" role="img" aria-label="'+esc(beast.name)+
    '" style="background-position:'+(species%5/4*100)+'% '+(Math.floor(species/5)/3*100)+'%"></div>'+
    '<div><small>戰場靈獸 · 招式資料</small><h2>'+esc(beast.name)+'</h2>'+
    '<small>'+(state.weaponDungeon?esc(state.weaponDungeon.name)+' · '+esc(state.weaponDungeon.realm):'第 '+beast.unlockStage+' 關起登場')+'</small></div></div>'+
    '<div class="tc-enemy-body"><section class="tc-enemy-attack"><small>攻擊方式</small><h3>'+esc(beast.attackName)+'</h3>'+
    '<p>'+esc(beast.attackText)+'</p></section>'+
    '<figure class="tc-enemy-demo" data-enemy-demo><div class="tc-demo-heading"><b>招式演練</b>'+
    '<span data-demo-mode>自動循環</span></div>'+
    '<canvas role="img" aria-label="'+esc(beast.name)+'的移動與招式演練"></canvas>'+
    '<figcaption data-demo-caption role="status" aria-live="polite"></figcaption>'+
    '<div class="tc-demo-tools"><span>紅框：攻擊預告 · 金圈：修士</span>'+
    '<button type="button" data-demo-toggle>暫停</button><button type="button" data-demo-next hidden>下一步</button>'+
    '<button type="button" data-demo-replay>重播</button></div></figure>'+
    '<dl class="tc-enemy-details"><dt>移動方式</dt><dd>'+esc(beast.moveText)+'</dd>'+
    '<dt>應對方式</dt><dd>'+esc(beast.tip)+'</dd></dl></div>'+
    '<div class="tc-enemy-footer"><button type="button" class="tc-primary" data-dismiss>返回戰場</button></div>',
    {encounter:true});
  if(state.weaponDungeon){$('[data-enemy-demo]').hidden=true;}
  else introDemo=new EnemyDemo($('[data-enemy-demo]'),species);
}
function showEnemyIntro(error=''){
  const species=state.newEnemies[0],encounter=state.actors.find(a=>a.bot&&a.species===species),p=encounter?.trackingAttack?R.monsterProfileFor(encounter):R.monsterProfile(species),remaining=state.newEnemies.length,
    beastRealm=Manuals.realmForStage(state.trial?.stage||1);
  showModal(`<div class="tc-enemy-heading"><div class="tc-enemy-portrait" role="img" aria-label="${esc(p.name)}" style="background-position:${species%5/4*100}% ${Math.floor(species/5)/3*100}%"></div><div><small>初遇妖獸${state.weaponDungeon?' · '+esc(state.weaponDungeon.name):state.trial?' · 第 '+state.trial.stage+' 關':''}</small><h2>${esc(p.name)}</h2><p>${beastRealm.name}境 · 功法擊殺 +${beastRealm.exp} EXP</p><small>${state.weaponDungeon?esc(state.weaponDungeon.name)+'專屬招式':'第 '+p.unlockStage+' 關起登場'}</small></div></div><div class="tc-enemy-body"><section class="tc-enemy-attack"><small>攻擊方式</small><h3>${esc(p.attackName)}</h3><p>${esc(p.attackText)}</p></section><figure class="tc-enemy-demo" data-enemy-demo><div class="tc-demo-heading"><b>招式演練</b><span data-demo-mode>自動循環</span></div><canvas role="img" aria-label="${esc(p.name)}的移動、命中與閃避模擬" data-demo-species="${species}"></canvas><figcaption data-demo-caption role="status" aria-live="polite"></figcaption><div class="tc-demo-tools"><span>紅框：攻擊預告 · 金圈：修士</span><button type="button" data-demo-toggle>暫停</button><button type="button" data-demo-next hidden>下一步</button><button type="button" data-demo-replay>重播</button></div></figure><dl class="tc-enemy-details"><dt>移動</dt><dd>${esc(p.moveText)}</dd><dt>應對</dt><dd>${esc(p.tip)}</dd></dl></div><p class="tc-enemy-error" role="alert" ${error?'':'hidden'}>${esc(error)}</p><div class="tc-enemy-footer"><button type="button" class="tc-primary" data-intro-ack ${busy?'disabled':''}>${remaining>1?'記住招式 · 下一種（'+(remaining-1)+'）':'記住招式 · 開始行動'}</button><button type="button" data-exit>收起試煉</button></div>`,{encounter:true});
  if(state.weaponDungeon){$('[data-enemy-demo]').hidden=true;}
  else introDemo=new EnemyDemo($('[data-enemy-demo]'),species);
}
async function acknowledgeIntro(){
  if(busy||!state?.newEnemies?.length)return;
  const e=epoch,account=uid,serial=++op,species=state.newEnemies[0];let error='';busy=true;$('[data-intro-ack]').disabled=true;
  try{const result=await api('/api/tactical/acknowledge-enemy',{roomId:state.id,species});if(valid(e,account))accept(result.state,serial);}
  catch(err){error=err.message;}
  finally{if(valid(e,account)){busy=false;if(error&&state.newEnemies?.length)showEnemyIntro(error);else paint();schedule();}}
}
function manualRecapKey(room,account){
  return String(account||'')+':'+String(room?.id||'');
}
function manualRecapMarkup(room,account) {
  const earnings=manualBattleEarnings(room,account,Manuals);
  if(!earnings)return '';
  const key=manualRecapKey(room,account);
  const bookState=manualRecapCache?.key===key?manualRecapCache.state:null;
  const content=renderManualBattleRecap(room,account,Manuals,bookState,{esc,bookArt,syncFailed:!!manualRecapCache?.error});
  const retry=manualRecapCache?.key===key&&manualRecapCache.error
    ?'<p class="tc-manual-recap-sync-error" role="status">最新功法等級暫時無法同步，可前往功法閣確認，或在此重試。</p><button type="button" class="tc-manual-recap-retry" data-manual-recap-retry>重試同步</button>':'';
  return '<div data-manual-battle-result data-room-id="'+esc(room.id)+'">'+content+retry+'</div>';
}
async function refreshManualRecap({force=false}={}){
  const room=state,account=uid;
  const earnings=manualBattleEarnings(room,account,Manuals);
  if(!earnings||!earnings.books.length)return;
  const key=manualRecapKey(room,account);
  if(!force&&(manualRecapCache?.key===key||manualRecapLoadingKey===key))return;
  if(manualRecapLoadingKey===key)return;
  const e=epoch,roomId=room.id;
  manualRecapLoadingKey=key;
  try{
    const result=await api('/api/tactical/manuals');
    if(!valid(e,account)||state?.id!==roomId||state.status!=='finished')return;
    if(!Array.isArray(result.state?.library))throw Error('功法資料尚未就緒');
    manualRecapCache={key,state:result.state};
  }catch(error){
    if(!valid(e,account)||state?.id!==roomId)return;
    manualRecapCache={key,error:error.message};
  }finally{
    if(manualRecapLoadingKey===key)manualRecapLoadingKey='';
    if(valid(e,account)&&state?.id===roomId){
      const host=$('[data-manual-battle-result]');
      if(host?.dataset.roomId===roomId)host.outerHTML=manualRecapMarkup(room,account);
    }
  }
}
function resultDialog(){
  clearLiveManualXp();
  const me=state.actors.find(a=>a.uid===uid),win=state.winner===me.team,draw=state.winner==='draw',reward=state.rewards?.[uid];
  const drop=state.manualDrops?.[uid];
  const manualRecap=state.mode==='pve'?manualRecapMarkup(state,uid):'';
  const receiptIdentity=JSON.stringify([uid,state.id,state.trial?.stage??null,state.weaponDungeon?.difficulty??null,state.createdAtMs??null]);
  const celebrateFresh=freshRewardReceipt===receiptIdentity;
  if(celebrateFresh)freshRewardReceipt='';
  if(state.weaponDungeon){
    const info=state.weaponDungeon,result=state.weaponDungeonResult;
    const presentation=globalThis.QARewardPresentation;
    const weaponDrop=drop&&Manuals.BY_BOOK[drop.id]?drop:null;
    const dungeonReward=reward==null?(weaponDrop?{weapon:weaponDrop}:null):{...reward,...(weaponDrop?{weapon:weaponDrop}:{})};
    const dungeonCards=presentation.renderSettlement(dungeonReward,{emptyText:'本次無額外獎勵。'});
    showModal(`<small>單人武器副本 · ${esc(info.realm)}</small><h2>${esc(info.name)} · ${win?'通關':'挑戰結束'}</h2>
      <p>${win?'已擊敗石域領主，副本通關；剩餘守衛不影響結算。':'副本券已消耗，可調整武器與走位後再次挑戰。'}</p>
      <div class="tc-result-stats"><b>答對 ${me.correct} / ${me.answered}</b><b>生命 ${me.hp} / ${me.maxHp}</b></div>
      ${win?`<p>${result?.unlocked>info.difficulty?'下一個難度已解鎖。':info.difficulty===5?'已完成最高難度。':''}</p>`:''}
      ${dungeonCards}
      ${drop?.duplicate?'<p class="tc-manual-loot">同款武器數量已累計，保留最高等階。</p>':!drop&&win?'<p>本次未掉落武器。</p>':''}
      ${drop&&!weaponDrop?`<p class="tc-manual-loot">獲得 ${esc(drop.tierRealm)}武器：${esc(drop.name)}</p>`:''}
      ${manualRecap}<button type="button" class="tc-primary" data-weapon-dungeon-menu>返回武器副本</button>
      <button type="button" data-weapon-dungeon-retry>再次挑戰（消耗 1 張券）</button><button type="button" data-exit>收起</button>`);
    const receiptRoom=state,receiptUid=uid,receiptEpoch=epoch;
    if(celebrateFresh)presentation.animateInline($('[data-trial-reward-list]'),{
      uid:receiptUid,receiptId:JSON.stringify(['weapon-dungeon',receiptRoom.id,info.difficulty,receiptRoom.createdAtMs??null]),reward:dungeonReward,
      isCurrent:()=>valid(receiptEpoch,receiptUid)&&state?.id===receiptRoom.id&&state?.status==='finished'&&state?.weaponDungeon?.difficulty===info.difficulty
    });
    if(manualRecap)void refreshManualRecap();return;
  }
  if(state.mode==='pve'){
    const stage=state.trial?.stage||1,next=state.nextStage||stage+1;
    const presentation=globalThis.QARewardPresentation;
    const weaponDrop=drop&&Manuals.BY_BOOK[drop.id]?{...drop,quantity:1,tierRealm:Manuals.BY_BOOK[drop.id].tierRealm}:null;
    const settlementReward=reward==null?reward:{...reward,...(weaponDrop?{weapon:weaponDrop}:{})};
    const rewardSection=presentation.renderSettlement(settlementReward,{emptyText:'本次無額外獎勵；答題紀錄已保存。'});
    const guideCollapse=win&&stage===1&&tutorialStep()>=7&&tutorialStep()<=9
      ?'<button type="button" class="tc-primary" data-tutorial-collapse>收起戰場</button>':'';
    showModal(`<small>問道試煉 · 第 ${stage} 關</small><h2>${win?'此關已破':'整裝再戰'}</h2><p>${win?'已完成本關目標，前方還有新的地勢與挑戰。':'調整走位與體力分配，再次挑戰本關。'}</p><div class="tc-result-stats"><b>答對 ${me.correct} / ${me.answered}</b><b>生命 ${me.hp} / ${me.maxHp}</b></div>${rewardSection}${manualRecap}${drop?'<p class="tc-manual-loot">'+(weaponDrop&&settlementReward?'已獲得上述武器，前往修煉查看。':'獲得功法：《'+esc(drop.name)+'》！前往修煉查看。')+'</p>':''}${me.manualLoadoutName?'<p>本場配置：'+esc(me.manualLoadoutName)+'</p>':''}${guideCollapse}<button type="button" class="${guideCollapse?'':'tc-primary'}" data-next-stage>${win?'前往第 '+next+' 關 →':'重試第 '+stage+' 關'}</button><button type="button" data-manual-training>前往功法閣</button><button type="button" data-exit>返回宗門</button>`);
    const receiptRoom=state,receiptUid=uid,receiptEpoch=epoch;
    if(celebrateFresh&&$('[data-trial-reward-list]'))presentation.animateInline($('[data-trial-reward-list]'),{
      uid:receiptUid,receiptId:JSON.stringify(['trial',receiptRoom.id,stage,receiptRoom.createdAtMs??null]),reward:settlementReward,
      isCurrent:()=>valid(receiptEpoch,receiptUid)&&state?.id===receiptRoom.id&&state?.trial?.stage===receiptRoom.trial?.stage&&state?.status==='finished'
    });
    if(manualRecap)void refreshManualRecap();
    return;
  }
  showModal(`<small>此戰已結算</small><h2>${draw?'平分秋色':win?'克敵制勝':'整裝再戰'}</h2><p>${state.finishReason==='timeout'?'連續兩次行動逾時，戰鬥結束。':state.finishReason==='forfeit'?'一方收法離場。':state.finishReason==='turn-limit'?'達到回合上限，以剩餘生命比例判定。':win?'你以走位與招式取得勝利。':'複習這次的攻擊範圍與體力分配，再次挑戰。'}</p><div class="tc-result-stats"><b>答對 ${me.correct} / ${me.answered}</b><b>生命 ${me.hp} / ${me.maxHp}</b></div><p>${reward?.gold?'獲得 '+stoneCostMarkup('+'+reward.gold)+' · '+cultivationMarkup('+'+reward.cultivation,{showName:true}):'本場沒有額外通關獎勵；答題紀錄已保存。'}</p><button type="button" class="tc-primary" data-hub>返回演武司</button>`);
}
function leaveDialog(){
  if(state?.status==='finished')return state.mode==='pve'?resultDialog():renderHub();
  showModal(`<h2>${state?.status==='waiting'?'取消配對':'收法離場'}</h2><p>${state?.status==='waiting'?'取消後可以重新選擇戰場與技能分支。':'離場將結束這場戰鬥。按「收起」則能保留進度；雙人鬥法的行動時間仍會繼續。'}</p><button type="button" class="tc-primary" data-forfeit>${state?.status==='waiting'?'取消配對':'認輸並離開'}</button><button type="button" data-dismiss>繼續留在戰場</button>`);
}
function markFreshReward(next){
  if(next?.status==='finished'&&state?.id===next.id&&state?.status==='active'&&next.rewarded?.includes(uid))
    freshRewardReceipt=JSON.stringify([uid,next.id,next.trial?.stage??null,next.weaponDungeon?.difficulty??null,next.createdAtMs??null]);
}
function accept(next,serial){
  if(serial<appliedOp)return;appliedOp=serial;
  if(next&&state?.id===next.id&&next.revision<state.revision)return;
  if(next?.serverNowMs)clockOffset=next.serverNowMs-Date.now();
  applyProgress(next);
  const oldQuestion=state?.question?.id;
  // UI-only: compare two server revisions from the SAME PvE room.
  // New rooms, repeated snapshots and older revisions must not replay XP.
  const expDelta=manualXpDelta(state,next,uid,Manuals);
  const keepSelection=next?.quizRound&&next.id===state?.id&&next.actionRevision===state.actionRevision&&next.phase===state.phase&&next.turnUid===state.turnUid;
  const bossTransition=CombatImpact.phaseTransition(state,next);
  // A new stage may reuse the same room ID: never keep the previous stage's
  // pinned seal coordinates or open its inspector over a different layout.
  if(state?.id===next?.id&&state?.trial?.stage!==next?.trial?.stage)sealInspector?.dismiss();
  if(state?.id!==next?.id){
    sealPeekPosition=null;sealGuideForced=false;
    hideBossBanner();bossTransitionPending=null;
    beastInspector?.dismiss();sealInspector?.dismiss();
    battleLoadouts=null;loadoutFetchedFor='';loadoutMenuOpen=false;
    selectedWeaponSlot=-1;selectedWeaponId='';
    battleMasteryBaseline=null;
    clearLiveManualXp();
  }
  if(bossTransition)bossTransitionPending={roomId:next.id,...bossTransition};
  markFreshReward(next);
  state=next;if(!keepSelection)selection=null;
  // Only a server-settled first-stage victory can release the final tutorial.
  // Replaying a finished room also restores this step after a page refresh.
  if(next?.mode==='pve'&&next.trial?.stage===1&&next.status==='finished'&&next.winner==='player')
    tutorialEvent('stage-cleared',{won:true});
  // EXP sound and animated cue are emitted after paint, never from a guessed kill.
  if(next?.manualDrops?.[uid])window.dispatchEvent(new CustomEvent('xiuxian:manual-loot'));
  // Kick off real match-scoped question requests immediately on an eligible
  // battle state, even while the player is reading an encounter introduction.
  // This happens before they can press the charging wheel.
  if(next?.status==='active'&&!(modalOpen&&pairQuestions.length))preloadTacticalQuestions();
  if(next?.mode==='pve'&&!next.weaponDungeon&&next.trial){
    // Send only the authoritative habitat metadata, not actor/quiz state.
    window.dispatchEvent(new CustomEvent('xiuxian:tactical-trial-updated',{
      detail:{uid,trial:next.trial,terrain:next.terrain,map:next.map}
    }));
  }
  if(next?.mode==='pvp'&&modalOpen&&$('[data-choice]')&&oldQuestion&&!next?.question){hideModal();pairQuestions=[];pairChoices=[];notice('本輪答題已結束，請查看戰場。');}
  paint({preserveModal:modalOpen});
  if(expDelta)showLiveManualXp(expDelta);
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
  finally{if(valid(e,account)){busy=false;if(state&&$('canvas')){updateControls();const acknowledge=$('[data-intro-ack]');if(acknowledge)acknowledge.disabled=false;}else root?.querySelectorAll('[data-start]').forEach(b=>b.disabled=false);renderBattleLoadouts();schedule();}}
}
async function start(code=''){
  await task(async()=>{const result=await api('/api/tactical/start',{mode,map,...(battleChannel==='weapon-dungeon'?{activity:'weapon-dungeon',...weaponDungeonSelection}:{}),...(code?{code}:{})});return result.state;});
}
async function sync(){await task(async()=>{const result=await api('/api/tactical/state?mode='+battleChannel);return result.state;});}
async function send(command){
  if(!state||renderer?.isAnimating&&command.type!=='leave')return;
  // Retrying the same command uses the same idempotency key after a lost response.
  const request={...command,roomId:state.id,revision:state.revision,actionRevision:state.actionRevision,requestId:id()};
  const committed=await task(async()=>{
    try{return (await api('/api/tactical/action',request)).state;}
    catch(err){if(!err.status||err.status>=500){try{return (await api('/api/tactical/action',request)).state;}catch(_){}}
      if(err.status===409){const latest=await api('/api/tactical/state?mode='+battleChannel);if(latest.state)accept(latest.state,++op);}throw err;}
  });
  // A real successful server action, not a wheel selection or preview, advances the guide.
  if(committed&&committed.id===request.roomId&&committed.revision>request.revision){
    if(command.type==='move')tutorialEvent('moved',{x:command.x,y:command.y});
    else if(['attack','manual','skill'].includes(command.type)){
      tutorialEvent('attacked',{x:command.x,y:command.y});
      // A single finishing blow can settle before the 'attacked' guide event.
      // Replay the verified win event after the attack so neither is lost.
      if(state?.mode==='pve'&&state?.trial?.stage===1&&state?.status==='finished'&&state?.winner==='player')
        tutorialEvent('stage-cleared',{won:true});
    }
    else if(command.type==='end')tutorialEvent('ended');
  }
}
async function execute(){
  const previousMode=battlefieldMode();
  syncEquippedAttack();
  if(battlefieldMode()!==previousMode){
    selection=null;
    updateControls();
    renderer?.update(state,uid,battlefieldMode(),selection);
    return;
  }
  if(selection)await send({type:action,x:selection.x,y:selection.y,...(action==='manual'?{skillId:selectedManualSkill}:{})});
}
// Start both requests as soon as a battle can accept a charge, BEFORE the
// player presses the charging button. The server still checks the selected
// learning scope, round eligibility and answers, and returns no answer keys.
function tacticalPreloadKey(){
  const me=myActor();
  if(!state||!me)return '';
  // Changing the practice selection invalidates even an already preloaded
  // question. The backend independently checks the saved server-side scope.
  const user=localUser(),settings=user.gameSettings||{};
  const selected=JSON.stringify([
    settings.sourceMode||'random',settings.source||'',
    settings.sourceMode==='focused'?settings.focusedUnits||[]:[],
    user.profile?.educationLevel||''
  ]);
  return [epoch,uid,state.id,state.turn,state.quizRound||0,me.questions,me.answered,selected].join(':');
}
function preloadTacticalQuestions(){
  if(!opened||state?.mode!=='pvp'||state.status!=='active'||!canQuestion())return null;
  if(modalOpen&&pairQuestions.length)return null;
  const key=tacticalPreloadKey();
  if(!key)return null;
  if(preloadedTacticalQuestions?.key===key)return preloadedTacticalQuestions;
  const e=epoch,account=uid,roomId=state.id;
  const remaining=Math.max(1,R.LIMITS.questions-myActor().questions);
  const job={key,first:null,second:null,firstError:'',secondError:'',
    firstPromise:null,secondPromise:null};
  preloadedTacticalQuestions=job;
  const launch=(slot)=>{
    // Always confirm the question against the currently SAVED scope, even if
    // a room snapshot has an old pending question from a previous selection.
    return api('/api/generate-quiz',{
      quizMode:'tactical',roomId,batchSlot:slot
    }).then(result=>result.tacticalQuestion).then(q=>{
      if(preloadedTacticalQuestions===job&&valid(e,account)&&state?.id===roomId&&q?.id){
        if(slot===0)job.first=q;
        else job.second=q;
      }
      return q?.id?q:null;
    }).catch(error=>{
      if(preloadedTacticalQuestions===job){
        if(slot===0)job.firstError=error.message;
        else job.secondError=error.message;
      }
      return null;
    });
  };
  // Launch without waiting for either request. Both promises absorb errors so
  // the user can keep playing while the bank/model works.
  job.firstPromise=launch(0);
  job.secondPromise=remaining>=2?launch(1):Promise.resolve(null);
  return job;
}
// The two requests may resolve in either order. The second is never a
// prerequisite for showing the first question, and keys stay on the server.
function pairIsCurrent(e,account,roomId,generation){
  return valid(e,account)&&state?.id===roomId&&pairGeneration===generation;
}
function fetchPairFollowup(e,account,roomId,generation){
  if(pairQuestions.length<2)return Promise.resolve(null);
  if(pairQuestions[1])return Promise.resolve(pairQuestions[1]);
  if(pairFollowupPromise)return pairFollowupPromise;
  pairFollowupError='';
  const flight=(async()=>{
    // A long-running slot-1 generation may lose the race to the first answer.
    // If that happens, re-request slot 0 after the first answer advances state.
    let lastError=null;
    for(let attempt=0;attempt<3;attempt++){
      if(!pairIsCurrent(e,account,roomId,generation))return null;
      const slot=pairReviews.length>0?0:1;
      try{
        const item=(await api('/api/generate-quiz',{
          quizMode:'tactical',roomId,batchSlot:slot
        })).tacticalQuestion;
        if(!pairIsCurrent(e,account,roomId,generation))return null;
        if(!item?.id)throw Error('下一題尚未準備完成');
        // An answer response may have promoted a committed follow-up first.
        if(!pairQuestions[1])pairQuestions[1]=item;
        return pairQuestions[1];
      }catch(error){
        lastError=error;
        if(!pairIsCurrent(e,account,roomId,generation))return null;
        if(attempt===2||error.status&&![409,429,500,503].includes(error.status))break;
      }
    }
    pairFollowupError=lastError?.message||'下一題暫時未就緒';
    return null;
  })().finally(()=>{if(pairFollowupPromise===flight)pairFollowupPromise=null;});
  pairFollowupPromise=flight;
  return flight;
}
function soloSubmission(q){
  const quiz=q.soloQuiz;
  if(!quiz)return {};
  return {
    turn:q.turn,
    soloQuestion:{question:q.q,options:q.opts,proof:quiz.soloProof,
      bankId:quiz.bankQuestionId,drawId:quiz.soloDrawId}
  };
}
async function soloBattleQuestion(){
  const study=window.QATrialQuestion;
  if(!study){notice('答題頁尚未就緒，請稍後再試');return;}
  const e=epoch,account=uid,roomId=state.id,turn=state.turn;
  const current=()=>valid(e,account)&&state?.id===roomId&&state.turn===turn;
  const inputFor=quiz=>{
    if(!current())throw Error('試煉回合已更新，請返回戰場');
    const questionId=quiz.bankQuestionId?'bank-'+quiz.soloDrawId:
      quiz.soloProof?'solo-'+quiz.soloProof.split('.')[1]:'';
    if(!questionId)throw Error('題目驗證資料尚未就緒，請重新取得題目');
    return {roomId,questionId,...soloSubmission({q:quiz.data.q,opts:quiz.data.opts,soloQuiz:quiz,turn})};
  };
  const back=()=>{
    if(!study.close())return;
    window.switchToPage?.(previousPage);
    if(!valid(e,account)||state?.id!==roomId)return;
    root.hidden=false;
    renderer?.setPaused(false);
    paint();
    if(tutorialStep()===4)selectWheel('attack-ring',true);
    $('[data-quiz]')?.focus({preventScroll:true});
  };
  const previousPage=document.querySelector('.page-section.active-page')?.id||'page-home';
  hideModal();
  renderer?.setPaused(true);
  root.hidden=true;
  await study.open({
    back,
    leave:close,
    next:back,
    skip:async()=>{
      if(current()&&myActor().questions<R.LIMITS.questions)await study.next();
      else back();
    },
    async submit(quiz,choice,startedAt){
      const input=inputFor(quiz);
      const {state:next}=await api('/api/tactical/answer',{
        ...input,choice,help:quiz.adaptiveHelp||0,
        timeTaken:Math.max(0,(Date.now()-startedAt)/1000)
      });
      if(next?.review?.questionId!==input.questionId)throw Error('答題狀態不同步，請重試');
      if(current()&&next.review.correct)tutorialEvent('answered');
      // Let the common feedback renderer capture the pre-answer score first.
      if(current()){markFreshReward(next);state=next;appliedOp=++op;}
      return {review:next.review,applyProgress:()=>{if(getMainUser()?.uid===account)applyProgress(next);}};
    },
    async reviewMath(quiz){
      return (await api('/api/tactical/review-math-issue',inputFor(quiz))).state;
    },
    async report(quiz,reason){
      const {state:result}=await api('/api/tactical/report-question',{...inputFor(quiz),reason});
      if(current()&&result.battle){markFreshReward(result.battle);state=result.battle;appliedOp=++op;applyProgress(state);}
      return result;
    }
  });
  if(current())tutorialEvent('question');
}
async function question(){
  if(!state||busy||root.hidden||!canQuestion()||renderer?.isAnimating&&!modalOpen)return;
  if(state.mode==='pve')return soloBattleQuestion();
  const e=epoch,account=uid,roomId=state.id;
  const remaining=Math.max(1,R.LIMITS.questions-myActor().questions);
  // Reuse the same in-flight/ready questions. Clicking must never launch an
  // identical pair of API calls while a background request is already pending.
  const ready=preloadedTacticalQuestions?.key===tacticalPreloadKey()
    ?preloadedTacticalQuestions:preloadTacticalQuestions();
  const generation=++pairGeneration;
  const existingFirst=ready?.first;
  const existingSecond=ready?.second;
  pairQuestions=Array(remaining).fill(null);
  pairChoices=Array(remaining).fill(-1);
  pairReviews=[];pairDisplayIndex=0;pairFollowupPromise=null;pairFollowupError='';
  if(remaining>=2){
    if(existingSecond)pairQuestions[1]=existingSecond;
    else if(ready?.secondPromise){
      const preloadSecond=ready.secondPromise.then(item=>{
        if(item?.id&&pairIsCurrent(e,account,roomId,generation)
          &&item.id!==pairQuestions[0]?.id&&!pairQuestions[1]){
          pairQuestions[1]=item;
        }
        return pairQuestions[1]||null;
      });
      pairFollowupPromise=preloadSecond.finally(()=>{
        if(pairFollowupPromise===wrapped)pairFollowupPromise=null;
      });
      const wrapped=pairFollowupPromise;
    }else void fetchPairFollowup(e,account,roomId,generation);
  }
  busy=true;notice('');
  if(!existingFirst)showModal('<h2>正在取得第一題…</h2><p>題目已提前在背景請求，取得第一題後立即開放作答。</p><button type="button" data-dismiss>返回戰場</button>');
  else showModal('<h2>題目已準備好</h2><p>正在開啟題目…</p>');
  try{
    let first=existingFirst||(await ready?.firstPromise);
    if(!first?.id)first=(await api('/api/generate-quiz',{quizMode:'tactical',roomId,batchSlot:0})).tacticalQuestion;
    if(!pairIsCurrent(e,account,roomId,generation))return;
    if(!first?.id)throw Error('第一題尚未準備完成，請重試');
    state.question=first;
    pairQuestions[0]=first;
    if(modalOpen)paintQuestion();
  }catch(err){
    if(pairIsCurrent(e,account,roomId,generation))
      showModal('<h2>第一題尚未就緒</h2><p>'+esc(err.message)+'</p><button type="button" data-quiz>重新準備第一題</button><button type="button" data-dismiss>返回戰場</button>');
  }finally{
    if(pairIsCurrent(e,account,roomId,generation)){
      busy=false;updateControls();schedule();
    }
  }
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
        ${state.mode==='pve'&&review.reward?`<div class="tc-solo-learning-reward">
          ${globalThis.QARewardPresentation.renderFeedback({cultivation:review.reward.cultivation})}
          ${review.reward.learning?`<small>${esc(review.reward.learning)}</small>`:''}
        </div>`:''}
      </div>
      <div class="bg-slate-950/50 p-4 rounded-lg text-sm text-gray-300 leading-relaxed border border-white/5 mb-4">
        <span class="text-cyan-400 font-bold block mb-1 text-xs uppercase tracking-wider"><i class="fa-solid fa-magnifying-glass"></i> 題解參悟</span>
        <span class="tc-feedback-text">${rich(review.explanation)}</span>
      </div>
      ${!review.correct&&review.choice>=0&&state.mode==='pve'?`<div class="tc-correction-actions">
        <button type="button" class="btn-cyber-primary" data-solo-correction-for="${index}">加入訂正練習 · 訂正修為 +1</button>
        <button type="button" class="btn-cyber-ghost" data-correction-hint-for="${index}">先看概念提示</button>
        <small>訂正題生成後，會在共用待答題庫優先出現。</small>
      </div>`:''}
    </div>`:''}
    <div class="mt-8 flex gap-3 w-full quiz-footer-actions tc-question-footer">
      <button type="button" data-dismiss class="flex-1 py-3 text-gray-600 text-xs text-center hover:text-cyan-400 transition border border-transparent hover:border-cyan-500/20 rounded-lg group"><i class="fa-solid fa-arrow-left group-hover:-translate-x-1 transition-transform"></i><span>返回戰場</span></button>
      <button type="button" data-question-report-for="${index}" class="flex-1 py-3 text-gray-600 text-xs text-center hover:text-yellow-400 transition border border-transparent hover:border-yellow-500/20 rounded-lg group"><i class="fa-solid fa-bug group-hover:rotate-12 transition-transform"></i><span>題目有錯</span></button>
      <button type="button" data-question-helper-for="${index}" class="flex-1 py-3 text-gray-600 text-xs text-center hover:text-cyan-400 transition border border-transparent hover:border-cyan-500/20 rounded-lg group"><i class="fa-solid fa-comments group-hover:-translate-y-0.5 transition-transform"></i><span>問道助手</span></button>
    </div>
  </article>`;
}
async function queueTacticalCorrection(index){
  const q=pairQuestions[index],review=pairReviews[index];
  if(state?.mode!=='pve'||!q||!review||review.correct||review.choice<0)return;
  const button=root?.querySelector('[data-solo-correction-for="'+index+'"]');
  if(!button||button.disabled)return;
  button.disabled=true;button.textContent='訂正題生成中…';
  try{
    if(typeof window.queueTacticalSoloCorrection!=='function')
      throw Error('主問道訂正練習尚未就緒');
    await window.queueTacticalSoloCorrection({
      question:q.q,subject:q.subject,
      topic:q.learningTopic||q.topic,
      difficulty:q.learningDifficulty,
      adaptive:q.adaptive||null
    });
    if(button.isConnected)button.textContent='訂正題已加入待答題庫';
  }catch(error){
    if(button.isConnected){button.disabled=false;button.textContent='加入訂正練習 · 重試';}
    window.showToast?.(error?.message||'訂正題暫時無法生成');
  }
}
async function queueTacticalExtension(point,button){
  if(!quizContext||!point||state?.mode!=='pve'||button.disabled)return;
  button.disabled=true;button.textContent='延伸題準備中…';
  try{
    if(typeof window.queueTacticalSoloExtension!=='function')
      throw Error('主問道延伸練習尚未就緒');
    await window.queueTacticalSoloExtension({
      question:quizContext.q.q,subject:quizContext.q.subject,
      topic:point,adaptive:quizContext.q.adaptive||null
    });
    if(button.isConnected)button.textContent='延伸題已加入待答題庫';
  }catch(error){
    if(button.isConnected){button.disabled=false;button.textContent='延伸練習 · 點此重試';}
    window.showToast?.(error?.message||'延伸題暫時無法準備');
  }
}
function setQuizContext(q,review=null){
  if(quizContext?.id!==q.id||quizContext.roomId!==state.id){
    quizContext?.abort.abort();
    // Same quiz fields as the main solo controller. This view is never used
    // to award or persist an answer: the trusted battle transaction does that.
    const learningQuiz={
      id:q.id,data:{q:q.q,opts:q.opts},
      learningSubject:q.subject,
      learningTopic:q.learningTopic||q.topic,
      learningDifficulty:q.learningDifficulty||'easy',
      meta:q.meta||{},adaptive:q.adaptive||null,
      adaptiveAnswered:!!review,adaptiveHelp:q.soloQuiz?.adaptiveHelp||0
    };
    quizContext={id:q.id,roomId:state.id,q,review,owner:uid,epoch,
      abort:new AbortController(),messages:[],helperBusy:false,reportBusy:false,
      shownAtMs:Date.now(),learningQuiz};
  }else {
    quizContext.review=review;
    quizContext.learningQuiz.adaptiveAnswered=!!review;
  }
  window.currentTacticalQuiz=quizContext.learningQuiz;
}
function quizTools(){
  if(state.mode!=='pve')return '';
  const message=(m)=>`<p class="quiz-helper-message ${m.role==='user'?'user':'assistant'}"><span class="quiz-helper-message-stack"><span class="quiz-helper-message-body">${m.role==='user'?esc(m.text):rich(m.text)}</span></span></p>`;
  return `<section class="tc-question-tools" aria-label="題目協助"><div class="tc-tools-buttons"><button type="button" class="quiz-helper-launcher" data-helper-toggle aria-haspopup="dialog" aria-expanded="false" title="開啟問道助手"><i class="fa-solid fa-comments"></i><span class="quiz-helper-launcher-label">問道</span></button></div>
    <div class="tc-tool-overlay tc-report-overlay" data-question-tool="report" data-report-panel hidden><section class="tc-report-box glass-panel" role="dialog" aria-modal="true" aria-labelledby="tc-report-title"><h3 id="tc-report-title"><i class="fa-solid fa-triangle-exclamation"></i> 回報題目錯誤</h3><p>請簡述題目問題 (例如: 答案錯誤、選項重複、錯字)，AI 將進行嚴格審查。</p><label class="sr-only" for="tc-report-reason">問題描述（至少六個字）</label><textarea id="tc-report-reason" data-report-reason maxlength="1200" rows="4" placeholder="請輸入問題描述..."></textarea><p data-report-status role="status" aria-live="polite"></p><div class="tc-report-actions"><button type="button" class="btn-cyber-ghost" data-tool-close>取消</button><button type="button" class="btn-cyber-primary" data-report-send>送出審查</button></div></section></div>
    <div class="tc-tool-overlay tc-helper-overlay" data-question-tool="helper" data-helper-panel hidden><section class="quiz-helper-panel" role="dialog" aria-modal="true" aria-labelledby="tc-helper-title"><header class="quiz-helper-header"><div class="quiz-helper-heading"><span class="quiz-helper-avatar"><i class="fa-solid fa-user-graduate"></i></span><div><strong id="tc-helper-title">問道助手</strong><small>一起核對、討論題目</small></div></div><button type="button" class="quiz-helper-collapse" data-tool-close aria-label="關閉問道助手">×</button></header><div class="quiz-helper-messages" data-helper-messages role="log" aria-label="問道助手對話">${quizContext.messages.map(message).join('')}</div><div class="quiz-helper-prompts" aria-label="快速提問"><button type="button" data-helper-preset="給我一個提示，但不要直接告訴我答案。">給我提示</button><button type="button" data-helper-preset="這題應該先從哪個觀念開始？">從哪開始</button><button type="button" data-helper-preset="可以把這題拆成幾個步驟嗎？">拆解步驟</button><button type="button" data-helper-preset="請檢查題目條件和選項是否一致，作答前不要透露答案。" data-helper-intent="check-question">檢查題目</button></div><div class="quiz-helper-compose"><textarea id="tc-helper-input" data-helper-input maxlength="600" rows="1" placeholder="輸入你對這題的疑問…" aria-label="輸入對題目的疑問"></textarea><button type="button" data-helper-send aria-label="送出問題"><i class="fa-solid fa-paper-plane"></i></button></div><div class="quiz-helper-status" data-helper-status role="status" aria-live="polite"></div></section></div></section>`;
}
function openQuestionTool(kind){
  closeQuestionTool(false);
  const panel=$(`[data-${kind}-panel]`);if(!panel)return;
  panel.hidden=false;$(`[data-${kind}-toggle]`)?.setAttribute('aria-expanded','true');
  const column=$('.quiz-main-column');if(column)for(const child of column.children)if(!child.classList.contains('tc-question-tools'))child.inert=true;
  const heading=$('.tc-dialog-heading');if(heading)heading.inert=true;
  // Do not open the virtual keyboard just by showing the dialog. The user
  // explicitly taps the textarea; focus only a non-editable close control.
  panel.querySelector?.('[data-tool-close]')?.focus({preventScroll:true});
}
function closeQuestionTool(restore=true){
  for(const kind of ['helper','report']){const panel=$(`[data-${kind}-panel]`);if(panel&&!panel.hidden){panel.hidden=true;const trigger=$(`[data-${kind}-toggle]`);trigger?.setAttribute('aria-expanded','false');if(restore)trigger?.focus({preventScroll:true});}}
  const column=$('.quiz-main-column');if(column)for(const child of column.children)child.inert=false;
  const heading=$('.tc-dialog-heading');if(heading)heading.inert=false;
}
function sameQuiz(ctx){return quizContext===ctx&&valid(ctx.epoch,ctx.owner);}
async function askHelper(intent='discussion'){
  const ctx=quizContext,input=$('[data-helper-input]'),message=input?.value.trim().slice(0,600);
  if(!ctx||!message||ctx.helperBusy||state.mode!=='pve')return;
  const history=ctx.messages.slice(-6);ctx.messages.push({role:'user',text:message});ctx.helperBusy=true;
  // As in main solo, only a successful assistant response counts as help;
  // a pure question-integrity check is not a learning hint.
  const append=(role,text)=>{const row=document.createElement('p'),label=document.createElement('span'),body=document.createElement('span');row.className='quiz-helper-message '+(role==='user'?'user':'assistant');label.className='quiz-helper-message-stack';body.className='quiz-helper-message-body';if(role==='user')body.textContent=text;else body.innerHTML=rich(text);label.append(body);row.append(label);$('[data-helper-messages]')?.append(row);window.quizMathTypeset?.(body);return row;};
  append('user',message);input.value='';$('[data-helper-send]').disabled=true;$('[data-helper-status]').textContent='問道助手正在思考…';
  try{
    const review=ctx.review,q=ctx.q;
    const math=v=>window.QAMathGuard?.normalizeMathText?.(v)??v;
    const result=await api('/api/question-helper',{
      question:math(q.q),options:q.opts.map(math),subject:q.subject,message,
      ...(intent==='check-question'?{intent}:{}),
      history,answered:!!review,
      explanation:math(review?.explanation||''),
      selectedOption:review?math(q.opts[review.choice]||''):'',
      correctOption:review?math(q.opts[review.answerIndex]||''):''
    },ctx.abort.signal);
    if(!sameQuiz(ctx))return;
    if(!result.answer)throw Error('問道助手暫時沒有回覆，請重試。');
    if(!review&&!result.interfaceIssue&&intent!=='check-question'){
      window.QAAdaptiveLearning?.hint(ctx.learningQuiz);
      if(q.soloQuiz){
        q.soloQuiz.adaptiveHelp=ctx.learningQuiz.adaptiveHelp;
        window.QASoloQuestionQueue?.persist(q.soloQuiz);
      }
    }
    const point=String(result.knowledgePoint||'').trim().slice(0,60);
    ctx.messages.push({role:'assistant',text:result.answer,knowledgePoint:point});
    const reply=append('assistant',result.answer);
    if(point&&state.mode==='pve'&&reply){
      const extend=document.createElement('button');
      extend.type='button';extend.className='quiz-helper-practice-btn';
      extend.dataset.helperExtend=point;
      extend.textContent='延伸練習 · '+point;
      extend.title='使用主問道相同的生成演算法，加入一般問道待答題庫';
      reply.querySelector('.quiz-helper-message-stack')?.append(extend);
    }
    $('[data-helper-status]').textContent='';
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
    const result=(await api('/api/tactical/report-question',{
      roomId:ctx.roomId,questionId:ctx.id,reason,...soloSubmission(ctx.q)
    },ctx.abort.signal)).state;
    if(!valid(ctx.epoch,ctx.owner))return;
    if(result.battle&&state?.id===ctx.roomId)accept(result.battle,++op);
    if(!sameQuiz(ctx))return;
    const message=result.reason+(result.compensated?` 已補償 ${result.cultivationAdded} 修為。`:'')+
      (result.staminaRefunded>0?` 已返還 ${result.staminaRefunded} 體力。`:'');
    status.textContent=message;
    if(result.questionSkipped){
      if(ctx.q.soloQuiz)window.QASoloQuestionQueue?.consume(ctx.q.soloQuiz);
      pairGeneration++;pairQuestions=[];pairChoices=[];pairReviews=[];pairFollowupPromise=null;
      hideModal();paint();notice(message);
      if(canQuestion())void question();
      return;
    }
    if(result.compensated&&!result.battle){const user=localUser();user.stats||={};if(result.goldAdded)user.stats.gold=result.newGold;user.stats.totalScore=result.newTotalScore;window.updateUIStats?.();window.refreshXiuxianLiveSync?.(result.newTotalScore);}
  }catch(err){if(sameQuiz(ctx))status.textContent=err.message+'，可再次送出重試。';}
  finally{ctx.reportBusy=false;if(sameQuiz(ctx)&&$('[data-report-send]'))$('[data-report-send]').disabled=false;}
}
function activatePairContext(index){
  const q=pairQuestions[index];if(!q)return;
  setQuizContext(q,pairReviews[index]||null);
  const tools=$('.tc-question-tools');if(tools)tools.outerHTML=quizTools();
}
function selectPairChoice(index,choice){
  if(busy||index!==pairDisplayIndex||index!==pairReviews.length||!pairQuestions[index]||!Number.isInteger(choice)||choice<0||choice>=pairQuestions[index].opts.length)return;
  pairChoices[index]=choice;
  // A single option tap commits this answer immediately. submitPair sets
  // busy synchronously, so rapid second taps cannot dispatch another answer.
  root.querySelectorAll('[data-choice-for="'+index+'"]').forEach(button=>{
    const picked=Number(button.dataset.choice)===choice;
    button.classList.toggle('is-picked',picked);
    button.setAttribute('aria-pressed',String(picked));
    button.disabled=true;
  });
  const status=$('[data-pair-status]');
  if(status)status.textContent=`第 ${index+1} / ${pairQuestions.length} 題 · 正在批改…`;
  void submitPair();
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
function pairLayout(){
  const count=pairQuestions.length,current=pairDisplayIndex;
  const review=pairReviews[current]||null;
  // Grade and explain each question on its own screen. After the final
  // explanation, the player goes straight back to the battlefield.
  const sheet=pairQuestions[current]?questionSheet(pairQuestions[current],review,current):'';
  return `<div class="tc-dialog-heading"><small>${state.quizRound?'<span data-quiz-clock></span>':'問道試煉 · 答題充能'} · 第 ${current+1} / ${count} 題</small><button type="button" data-dismiss aria-label="返回戰場">返回戰場</button></div>
  <div class="quiz-question-helper-layout helper-collapsed">
    <div class="quiz-main-column tc-pair-column">
      <div class="tc-pair-list">${sheet}</div>
      ${review?`<div class="tc-pair-reviewed-actions">
        <div class="tc-pair-review-status" role="status">第 ${current+1} 題已批改，請先閱讀上方解析。</div>
        <button type="button" class="btn-cyber-primary tc-pair-next" ${current+1<count?'data-next-pair-question':'data-dismiss'}>
          ${current+1<count?'下一題':'返回戰場'}
        </button>
      </div>`:`<div class="tc-pair-submit">
        <div data-pair-status role="status" aria-live="polite">第 ${current+1} / ${count} 題 · 點選答案後直接批改。</div>
        <button type="button" data-submit-pair class="btn-cyber-primary flex-1 py-3 rounded-lg text-xs" hidden>重新送出本題</button>
      </div>`}
    </div>
    <aside class="tc-quiz-tools-shell" aria-label="問道助手">${quizTools()}</aside>
  </div>
  ${pairWhiteboardMarkup()}`;
}
function paintQuestion(){
  if(!pairQuestions.length||pairDisplayIndex>=pairQuestions.length)return;
  const current=pairDisplayIndex;
  setQuizContext(pairQuestions[current],pairReviews[current]||null);
  showModal(pairLayout(),{quiz:true});
  // Render the main branch's actual 範圍學習足跡 component and status
  // algorithm inside the tactical question, not a look-alike widget.
  window.QAAdaptiveLearning?.render?.(
    quizContext.learningQuiz,$('[data-question-text="'+current+'"]'));
  updateClock();
}
async function showNextPairQuestion(){
  if(busy||!modalOpen||pairDisplayIndex>=pairQuestions.length-1||!pairReviews[pairDisplayIndex])return;
  if(!pairQuestions[pairDisplayIndex+1]){
    const button=$('[data-next-pair-question]');
    if(button){button.disabled=true;button.textContent='正在取得下一題…';}
    const e=epoch,account=uid,roomId=state.id,generation=pairGeneration;
    const pending=pairFollowupPromise||fetchPairFollowup(e,account,roomId,generation);
    let next=await pending;
    if(!pairIsCurrent(e,account,roomId,generation)||!modalOpen)return;
    if(!next)next=await fetchPairFollowup(e,account,roomId,generation);
    if(!pairIsCurrent(e,account,roomId,generation)||!modalOpen)return;
    if(!next){
      if(button){button.disabled=false;button.textContent='下一題（重新取得）';}
      notice(pairFollowupError||'正在填充題庫，請再按一次下一題');
      return;
    }
  }
  pairDisplayIndex++;
  notice('');
  paintQuestion();
}
async function submitPair(){
  // The first question is graded before the next is displayed. No second
  // press of 答題充能 and no double-answer form is required.
  const index=pairReviews.length,q=pairQuestions[index],choice=pairChoices[index];
  if(busy||index!==pairDisplayIndex||!q||!Number.isInteger(choice)||choice<0||choice>=q.opts.length)return;
  busy=true;
  const e=epoch,account=uid,serial=++op,roomId=state.id;
  const timeTaken=Math.max(0,(Date.now()-(quizContext?.shownAtMs||Date.now()))/1000);
  root.querySelectorAll('[data-choice-for]').forEach(button=>button.disabled=true);
  const submit=$('[data-submit-pair]');
  if(submit){submit.hidden=true;submit.disabled=true;}
  const status=$('[data-pair-status]');
  if(status)status.textContent=`正在批改第 ${index+1} / ${pairQuestions.length} 題…`;
  try{
    const result=await api('/api/tactical/answer',{roomId,questionId:q.id,choice,timeTaken});
    if(!valid(e,account)||!state||state.id!==roomId)return;
    if(result.state?.review?.questionId!==q.id)throw Error('答題狀態不同步，請重新開啟答題');
    state=result.state;
    if(Number.isFinite(state.serverNowMs))clockOffset=state.serverNowMs-Date.now();
    appliedOp=serial;
    const review=state.review;
    pairReviews.push(review);
    // If the backend already promoted a ready follow-up into the current
    // pending slot, use it even when the parallel preload is still in flight.
    if(index===0&&pairQuestions.length>1&&!pairQuestions[1]&&state.question?.id)
      pairQuestions[1]=state.question;
    window.QAGameAudio?.answer(review.correct,'tactical:'+roomId+':'+q.id);
    applyProgress(state);
    renderer?.update(state,uid,action,null);
    paintQuestion();
  }catch(err){
    if(!valid(e,account))return;
    const label=$('[data-pair-status]');
    if(label)label.textContent=err.message+'；可以重新點選答案，或重試送出已選答案。';
    root.querySelectorAll('[data-choice-for]').forEach(button=>button.disabled=false);
    if(submit){submit.hidden=false;submit.disabled=false;submit.textContent='重試送出';}
  }finally{
    if(valid(e,account)){busy=false;updateControls();schedule();}
  }
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
  const prepared=api('/api/tactical/start',{mode:'pve',...(battleChannel==='weapon-dungeon'?{activity:'weapon-dungeon',...weaponDungeonSelection}:{})}).then(value=>({value}),error=>({error}));
  const reveal=async()=>{
    const result=await prepared;if(!valid(e,account))return;
    if(result.error)throw result.error;
    root.hidden=false;accept(result.value.state,++op);$('[data-close]').focus();
    tutorialEvent('entered');
  };
  try{
    if(typeof window.playStartupCloudCurtain==='function')await window.playStartupCloudCurtain(reveal,{isCurrent:()=>valid(e,account),blockInput:true});
    else await reveal();
  }catch(error){
    if(!valid(e,account))return;
    root.hidden=false;hideModal();destroyRenderer(); $('[data-title]').textContent=battleChannel==='weapon-dungeon'?'武器副本':'問道試煉';$('[data-turn]').textContent='';
    $('[data-main]').className='tc-main tc-waiting';
    $('[data-main]').innerHTML=`<div><h2>暫時未能進入試煉</h2><p>${esc(error.message)}</p><button type="button" class="tc-primary" data-retry-entry>重新進入</button><button type="button" data-exit>返回宗門</button></div>`;
  }finally{
    if(valid(e,account)){busy=false;if($('canvas'))paint();schedule();}
  }
}
async function open(nextMode='pve',options={}){
  const requestedChannel=nextMode;
  nextMode=requestedChannel==='pvp'?'pvp':'pve';
  window.prefetchXiuxianContext?.('trial');
  ensure();
  if(opened&&battleChannel===requestedChannel&&mode==='pve'&&nextMode==='pve'&&trialEntry?.uid===getMainUser()?.uid)return trialEntry.promise;
  if(opened)close();
  if(battleChannel!==requestedChannel)state=null;
  lastTrigger=document.activeElement;mode=nextMode;battleChannel=requestedChannel;
  weaponDungeonSelection=battleChannel==='weapon-dungeon'?{dungeonId:options.dungeonId||'peak-stone',difficulty:options.difficulty,requestId:id()}:null;root.dataset.mode=mode;
  action='move';attackChoice='attack';selectedManualSkill='';selection=null;
  sealPeekPosition=null;sealGuideForced=false;
  const accountUid=getMainUser()?.uid||'';if(uid!==accountUid||state?.mode!==nextMode)state=null;uid=accountUid;
  if(!uid){window.showToast?.('請先登入後進入戰場');return;}
  clearLiveManualXp();battleMasteryBaseline=null;
  epoch++;opened=true;busy=true;op=0;appliedOp=0;manualRecapCache=null;manualRecapLoadingKey='';document.body.classList.add('tactical-open');
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
  if(!root)return;
  warmedCombatAudioRoomId='';
  const completedFirstStage=mode==='pve'&&state?.trial?.stage===1&&state.status==='finished'&&
    state.winner==='player'&&tutorialStep()===9;
  hideBossBanner();bossTransitionPending=null;
  sealPeekPosition=null;sealGuideForced=false;
  beastInspector?.dismiss();sealInspector?.reset();
  window.QATrialQuestion?.close();keyboardGuard?.blur();quizContext?.abort.abort();quizContext=null;window.currentTacticalQuiz=null;pairGeneration++;preloadedTacticalQuestions=null;pairQuestions=[];pairChoices=[];pairReviews=[];pairDisplayIndex=0;pairFollowupPromise=null;pairFollowupError='';pairWhiteboardInk.clear();closePairWhiteboard();autoQuizKey='';epoch++;opened=false;busy=false;manualRecapCache=null;manualRecapLoadingKey='';battleMasteryBaseline=null;clearLiveManualXp();clearTimeout(poll);clearInterval(clock);hideModal();destroyRenderer();
  root.hidden=true;root.classList.remove('tc-quarter-layout');document.body.classList.remove('tactical-open');lastTrigger?.focus?.();
  if(completedFirstStage)tutorialEvent('battle-closed');
}
window.openTacticalCombat=open;
window.startQuizFlow=()=>open('pve');
window.startBattleMatchmaking=()=>open('pvp');
window.joinBattleRoomV2=code=>{void open('pvp').then(()=>{if(valid(epoch,uid))void start(String(code||''));});};
window.addEventListener('xiuxian:user-data-ready',()=>{if(opened&&getMainUser()?.uid!==uid){state=null;close();}});
document.addEventListener('visibilitychange',()=>{if(!opened||root.hidden)return;if(document.hidden)clearTimeout(poll);else void sync();});
export {open as openTacticalCombat};
