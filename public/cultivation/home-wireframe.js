import './home-correction-progress.js';

const $=id=>document.getElementById(id);
const Progress=globalThis.QAHomeCorrectionProgress;
let observer=null,initialized=false;

function refresh(){
  const card=$('home-correction-panel');
  if(!card)return;
  const stats=window.getCurrentUserData?.()?.stats;
  const p=Progress.summarize(stats);
  const text=$('home-correction-count');
  const note=$('home-correction-note');
  const bar=$('home-correction-fill');
  const meter=$('home-correction-meter');
  if(text)text.textContent=p.completed+' / '+p.total;
  if(note)note.textContent=p.label;
  if(bar)bar.style.width=p.percent+'%';
  if(meter){
    meter.setAttribute('aria-valuemax',String(p.total||1));
    meter.setAttribute('aria-valuenow',String(p.completed));
    meter.setAttribute('aria-valuetext',p.label);
  }
  const realm=$('xiuxian-realm'),circle=$('home-realm-emblem-name');
  if(realm&&circle)circle.textContent=realm.textContent.trim()||'凡人';
}

function forward(id){
  const button=$(id);
  if(button){button.click();return;}
  window.showToast?.('這項功能暫時無法開啟，請稍後重試。');
}
function act(action){
  switch(action){
    case 'path':return forward('xiuxian-path');
    case 'quest':return forward('quest-open');
    case 'meditation':return forward('xiuxian-meditate');
    case 'raid':return forward('sect-raid-entry');
    case 'rank':
      window.switchToPage?.('page-rank');window.loadLeaderboard?.();return;
    case 'share':
      if(window.switchToPage?.('page-social')!==false)window.switchSocialTab?.('shares');
      return;
    case 'correction':
      window.startQuizFlow?.();
      return;
  }
}
function mirrorAlert(sourceId,action){
  const target=document.querySelector('[data-home-alert="'+action+'"]');
  const source=$(sourceId);
  if(!target||!source)return;
  const sync=()=>{target.hidden=source.hidden||source.getAttribute('aria-hidden')==='true';};
  sync();
  new MutationObserver(sync).observe(source,{attributes:true,attributeFilter:['hidden','aria-hidden']});
}
function init(){
  if(initialized||!$('home-realm-emblem'))return;
  initialized=true;
  const root=$('page-home');
  root.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-home-action]');
    if(!button||!root.contains(button))return;
    act(button.dataset.homeAction);
  });
  for(const eventName of [
    'xiuxian:user-data-ready','xiuxian:user-ready','xiuxian:stats-updated',
    'xiuxian:quest-progress-updated','xiuxian:learning-progress'
  ])window.addEventListener(eventName,refresh);
  mirrorAlert('quest-ready-dot','quest');
  mirrorAlert('meditation-pending-dot','meditation');
  mirrorAlert('sect-raid-ticket-dot','raid');
  const realm=$('xiuxian-realm');
  if(realm){
    observer=new MutationObserver(refresh);
    observer.observe(realm,{childList:true,characterData:true,subtree:true});
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.addEventListener('pageshow',refresh);
  refresh();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
