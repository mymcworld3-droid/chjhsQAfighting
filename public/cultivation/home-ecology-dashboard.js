import './home-ecology-scenes.js';

const Scenes=globalThis.QAHomeEcologyScenes;
const $=id=>document.getElementById(id);
const defaults={subject:'靈氣浮動',message:'以學入道，今日也能在問道場地有所收穫。'};
let root=null,account='',place='sect',ready=false;

function accountId(){
  const user=window.getCurrentUserData?.();
  return String(user?.uid||user?.id||'guest');
}
function key(){return 'qingyun:home-ecology:'+account;}
function load(){
  const next=accountId();
  if(next===account&&ready)return;
  account=next;
  try{place=Scenes.find(localStorage.getItem(key())).id;}catch(_){place='sect';}
  ready=true;
}
function persist(){
  if(account==='guest')return;
  try{localStorage.setItem(key(),place);}catch(_){/* Private browsing: state stays in memory. */}
}
function timePeriod(){
  let hour=new Date().getHours();
  try{
    hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
  }catch(_){}
  return hour>=18||hour<5?{id:'night',label:'夜色'}:hour<9?{id:'dawn',label:'晨光'}:hour>=16?{id:'dusk',label:'暮光'}:{id:'day',label:'晴光'};
}
function paint(){
  if(!root)return;
  const scene=Scenes.find(place),period=timePeriod();
  root.dataset.scene=scene.id;
  root.dataset.period=period.id;
  const picture=$('home-ecology-picture');
  const landscape=picture?.querySelector('source');
  const image=picture?.querySelector('img');
  if(landscape&&landscape.srcset!==scene.portrait)landscape.srcset=scene.portrait;
  if(image){if(image.getAttribute('src')!==scene.landscape)image.setAttribute('src',scene.landscape);image.alt=scene.alt;}
  const name=$('home-ecology-name'),region=$('home-ecology-region'),intro=$('home-ecology-description');
  const ambient=$('home-ecology-ambient'),cta=$('home-ecology-enter');
  if(name)name.textContent=scene.name;
  if(region)region.textContent=scene.region;
  if(intro)intro.textContent=scene.detail;
  if(ambient)ambient.textContent=period.label+' · '+scene.region;
  if(cta)cta.querySelector('span').textContent=scene.action;
  const position=$('home-ecology-position');
  if(position)position.textContent=(Scenes.SCENES.indexOf(scene)+1)+' / '+Scenes.SCENES.length;
}
function setPlace(id,save=true){
  const next=Scenes.find(id).id;
  if(next===place)return;
  place=next;
  if(save)persist();
  paint();
}
function openTraining(){
  const score=Number(window.getTrainingAccessScore?.()??window.getCurrentUserData?.()?.stats?.totalScore??0);
  if(score<6){
    // A first-day player has not unlocked the training grounds yet.
    window.startQuizFlow?.();
    return;
  }
  if(typeof window.switchToPage==='function'){
    window.switchToPage('page-training');
    window.openTrainingSceneMap?.();
  }else $('nav-training')?.click();
}
function enter(){
  if(Scenes.find(place).type==='sect')openTraining();
  else window.startQuizFlow?.();
}
function forward(id){
  const original=$(id);
  if(original){
    original.click();
    return;
  }
  window.showToast?.('這項功能尚未準備好，請稍後再試。');
}
function openAction(action){
  switch(action){
    case 'quest':return forward('quest-open');
    case 'meditation':return forward('xiuxian-meditate');
    case 'raid':return forward('sect-raid-entry');
    case 'path':return forward('xiuxian-path');
    case 'story':return forward('story-archive-launcher');
    case 'rank':
      window.switchToPage?.('page-rank');
      window.loadLeaderboard?.();
      return;
    case 'share':
      if(window.switchToPage?.('page-social')!==false)window.switchSocialTab?.('shares');
      return;
  }
}
function syncNotification(id,button){
  const source=$(id),dest=root?.querySelector('[data-home-alert="'+button+'"]');
  if(!source||!dest)return;
  const sync=()=>{dest.hidden=source.hidden||source.getAttribute('aria-hidden')==='true';};
  sync();
  const observer=new MutationObserver(sync);
  observer.observe(source,{attributes:true,attributeFilter:['hidden','aria-hidden','class']});
}
function boot(){
  root=$('home-ecology');
  if(!root||root.dataset.initialized==='1')return;
  root.dataset.initialized='1';
  load();
  paint();
  root.addEventListener('click',event=>{
    const button=event.target.closest('button');
    if(!button||!root.contains(button))return;
    if(button.dataset.sceneDelta){
      setPlace(Scenes.next(place,Number(button.dataset.sceneDelta)).id);
      return;
    }
    if(button.id==='home-ecology-enter'){enter();return;}
    if(button.dataset.homeAction)openAction(button.dataset.homeAction);
  });
  syncNotification('quest-ready-dot','quest');
  syncNotification('meditation-pending-dot','meditation');
  syncNotification('sect-raid-ticket-dot','raid');
  window.addEventListener('xiuxian:user-data-ready',()=>{load();paint();});
  window.addEventListener('xiuxian:user-ready',()=>{load();paint();});
  // Record the last genuinely selected battlefield terrain, not a fabricated
  // per-player geographic position. The main CG reflects the user's last pick.
  document.addEventListener('click',event=>{
    const selected=event.target.closest?.('#tactical-combat [data-map]');
    if(selected){
      load();
      setPlace(Scenes.forBattleMap(selected.dataset.map));
    }
  },true);
  window.addEventListener('pageshow',paint);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)paint();});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();

export const featureReady=Promise.resolve(true);
