import './tactical-rules.js';
import './home-trial-ecology.js';
import './answer-cultivation-bonus.js';
import './manual-rules.js';
import { authenticatedMainFetch, getMainUser } from './data/project-repository.js';

const $=id=>document.getElementById(id);
const Ecology=globalThis.QAHomeTrialEcology;
const Tactical=globalThis.QATactical;
let initialized=false,selectedUid='',loadedPreview=null,query=null,lastQueryAt=0;

function currentUid(){return getMainUser?.()?.uid||'';}
function visible(){return $('page-home')?.classList.contains('active-page')===true;}
const formatStones=new Intl.NumberFormat('zh-TW',{maximumFractionDigits:0});
function refreshSpiritStones(){
  const balance=$('home-spirit-stones-count'),host=$('home-spirit-stones');
  if(!balance||!host)return;
  // Read the same signed-in player stats used by the rest of the game.
  // Never show a previous account's balance after switching users.
  const uid=currentUid(),player=window.getCurrentUserData?.();
  const raw=player?.stats?.gold;
  const amount=uid&&(!player?.uid||player.uid===uid)&&raw!==null&&raw!==undefined&&String(raw).trim()!==''
    ?Number(raw):NaN;
  const valid=Number.isFinite(amount)&&amount>=0;
  const label=valid?formatStones.format(Math.floor(amount)):'—';
  if(balance.textContent!==label)balance.textContent=label;
  host.dataset.balanceLoaded=valid?'true':'false';
}
function display(preview){
  if(!preview)return;
  loadedPreview=preview;
  const disc=document.querySelector('#home-realm-emblem .home-realm-disc');
  const image=$('home-trial-ecology-image'),name=$('home-trial-ecology-name');
  const stage=$('home-trial-ecology-stage');
  if(disc)disc.dataset.ecology=preview.id;
  if(image){
    if(image.getAttribute('src')!==preview.image)image.setAttribute('src',preview.image);
    image.alt=preview.stage
      ? '問道試煉第 '+preview.stage+' 關，'+preview.name+'的生態場景圖片'
      : '問道試煉場地生態預覽圖片';
  }
  if(name)name.textContent=preview.name;
  if(stage)stage.textContent=preview.stage
    ? '問道試煉 · 第 '+preview.stage+' 關'
    : '進入試煉後顯示目前關卡';
}
function refreshFromProgress(){
  const uid=currentUid();
  if(uid!==selectedUid){
    selectedUid=uid;lastQueryAt=0;query=null;loadedPreview=null;
  }
  if(!uid){display(Ecology.DEFAULT);return;}
  // The saved user record is bound to the signed-in UID, and the deterministic
  // rules use the same seed and stage as the server that builds the battle.
  const info=window.getCurrentUserData?.()?.tacticalTrialV1;
  const scene=Ecology.fromProgress(info,Tactical);
  if(scene && (!loadedPreview?.stage || scene.stage>loadedPreview.stage))display(scene);
  else if(!loadedPreview)display(Ecology.DEFAULT);
}
async function syncTrialState(){
  const uid=currentUid();
  if(!uid||!visible()||query||Date.now()-lastQueryAt<30000)return;
  lastQueryAt=Date.now();
  query=(async()=>{
    try{
      const response=await authenticatedMainFetch('/api/tactical/state?mode=pve');
      if(!response.ok)return;
      const data=await response.json().catch(()=>({}));
      if(currentUid()!==uid)return;
      // An active server battle outranks the next-stage approximation.
      const scene=Ecology.fromBattle(data.state);
      if(scene && (!loadedPreview?.stage || scene.stage>=loadedPreview.stage))display(scene);
    }catch(_){/* Preview must not interrupt navigation or question generation. */}
  })().finally(()=>{query=null;});
  await query;
}
function renderAnswerBonus(){
  const node=$('home-answer-bonus'),rules=globalThis.QAAnswerCultivationBonus;
  if(!node||!rules)return;
  const uid=currentUid(),player=window.getCurrentUserData?.();
  node.hidden=!uid||!player||(player.uid&&player.uid!==uid);
  if(node.hidden)return;
  const state=rules.normalize(player.stats?.answerCultivationV1),manual=window.getCurrentTacticalManualState?.();
  const percent=rules.maxedWeapons(manual,globalThis.QAManuals)*10;
  node.textContent=(manual?'武器精通 +'+percent+'%':'武器精通同步中')+' · '+(state.remaining?'頓悟 +100% · 剩餘 '+state.remaining+' 題':'悟道值 '+state.progress+' / 10');
  node.classList.toggle('is-awake',!!state.remaining);
}
function update(){
  renderAnswerBonus();
  refreshSpiritStones();
  refreshFromProgress();
  if(visible())void syncTrialState();
}
function forward(id){
  const button=$(id);
  if(button){button.click();return;}
  window.showToast?.('這項功能暫時無法開啟，請稍後重試。');
}
function activate(action){
  switch(action){
    case 'path':return window.openCultivationPathQuests ? window.openCultivationPathQuests() : window.showToast?.('仙道暫時無法開啟，請稍後重試。');
    case 'quest':return forward('quest-open');
    case 'meditation':return forward('xiuxian-meditate');
    case 'learning':return window.switchToPage?.('page-learning');
    case 'rank':
      window.switchToPage?.('page-rank');window.loadLeaderboard?.();return;
    case 'store':
      window.loadStoreItems?.();window.switchToPage?.('page-store');return;
  }
}
function mirrorAlert(sourceId,action){
  const target=document.querySelector('[data-home-alert="'+action+'"]');
  const source=$(sourceId);
  if(!target||!source)return;
  const sync=()=>{target.hidden=source.hidden;};
  sync();
  new MutationObserver(sync).observe(source,{attributes:true,attributeFilter:['hidden','aria-hidden']});
}
function init(){
  if(initialized||!$('home-realm-emblem'))return;
  initialized=true;
  const root=$('page-home');
  root.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-home-action]');
    if(button&&root.contains(button))activate(button.dataset.homeAction);
  });
  for(const name of ['xiuxian:user-data-ready','xiuxian:user-ready','xiuxian:stats-updated','xiuxian:tactical-power-updated','xiuxian:quest-progress-updated'])
    window.addEventListener(name,update);
  window.addEventListener('xiuxian:tactical-trial-updated',event=>{
    if(!currentUid()||event.detail?.uid!==currentUid())return;
    const scene=Ecology.fromBattle({mode:'pve',trial:event.detail.trial,
      terrain:event.detail.terrain,map:event.detail.map});
    if(scene)display(scene);
  });
  mirrorAlert('quest-ready-dot','quest');
  mirrorAlert('meditation-pending-dot','meditation');
  const observer=new MutationObserver(()=>{if(visible())update();});
  observer.observe(root,{attributes:true,attributeFilter:['class']});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
  window.addEventListener('pageshow',update);
  window.addEventListener('focus',update);
  update();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
