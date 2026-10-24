import {getMainUser,authenticatedMainFetch} from '../cultivation/data/project-repository.js';
import {WorldView} from './world-view.js';
import {createWorldTransport} from './world-transport.js';

const css=document.createElement('link');css.rel='stylesheet';css.href='world/world.css';
export const featureReady=new Promise((resolve,reject)=>{css.onload=resolve;css.onerror=()=>reject(new Error('大世界樣式載入失敗'));});
document.head.append(css);
const root=document.createElement('section');root.id='page-world';root.className='page-section hidden';root.setAttribute('aria-label','青雲界大世界');
document.querySelector('main').append(root);
let view,owner='',opening=false;
const transport=createWorldTransport(authenticatedMainFetch);
async function openEntry(entry,data={}){
  const toast=message=>window.showToast?.(message);
  if(entry==='sect-guide'){view?.sectGuide();return;}
  if(entry.startsWith('facility:')){view?.facilityPanel(entry);return;}
  if(['market','library','alchemy','dining','residence'].includes(entry)){view?.facilityPanel(entry);return;}
  if(['store','store-avatar','store-frame'].includes(entry)){
    await window.switchToPage?.('page-store');document.getElementById('pm-view-shop')?.click();
    const tab={'store-avatar':'tab_avatar','store-frame':'tab_frame'}[entry];
    if(tab)document.querySelector(`[data-i18n="${tab}"]`)?.click();return;
  }
  const marketViews={'market-all':'all','market-material':'material','market-artifact':'artifact','market-recipe':'recipe','market-mine':'mine'};
  if(marketViews[entry]){
    if(!window.openPlayerMarketplace){toast('坊市正在準備，請稍後再試');return;}
    window.openPlayerMarketplace(marketViews[entry]);return;
  }
  if(entry==='commissions'){
    const button=document.getElementById('quest-open');
    if(!document.getElementById('quest-panel')||!button){toast('宗門委託正在準備，請稍後再試');return;}
    button.click();document.getElementById('quest-tab-daily')?.click();return;
  }
  if(entry==='meditation'){window.openDailyMeditation?.();return;}
  if(entry==='profile'){window.openPlayerProfileByUid?.(data.uid);return;}
  if(entry==='chat'){
    if(!(window.getCurrentUserData?.()?.friends||[]).includes(data.uid)){window.openPlayerProfileByUid?.(data.uid);toast('先加入好友，就能開啟道友私訊');return;}
    if(!window.QAFriendChat){toast('好友交流正在準備，請稍後再試');return;}
    window.QAFriendChat.open(data.uid,data.name);return;
  }
  if(entry==='quest'){view?.questPanel();return;}
  if(entry==='invite-raid'){
    try{
      await window.createWorldRaidRoom?.();const room=window.getRaidMvpState?.();if(!room?.roomId)return;
      const result=await transport.request('invite',{targetUid:data.uid,kind:'raid',roomId:room.roomId});toast(result.message);
    }catch(error){toast(error.message);}return;
  }
  if(entry==='invite-duel'){
    try{const roomId=await window.startWorldDuelWith?.(data.uid);if(!roomId)return;
      const result=await transport.request('invite',{targetUid:data.uid,kind:'duel',roomId});toast(result.message);
    }catch(error){toast(error.message);}return;
  }
  if(entry==='accept-invite'){
    if(!data||data.expiresAtMs<Date.now()){toast('這則邀請已過期');return;}
    if(data.kind==='raid')await window.joinRaidRoomInvite?.(data.roomCode);
    else if(!await window.joinBattleRoomV2?.(data.roomId))toast('鬥法房間已結束，或目前無法加入');return;
  }
  if(entry==='practice'){window.startQuizFlow?.();return;}
  if(entry==='duel'){window.startBattleMatchmaking?.();return;}
  if(entry==='raid'){window.openRaidHub?.();return;}
  if(entry==='rank'){await window.switchToPage?.('page-rank');void window.loadLeaderboard?.();return;}
  const pages={settings:'page-settings',friends:'page-social',sect:'page-home',history:'page-history'};
  if(pages[entry]){await window.switchToPage?.(pages[entry]);return;}
  const place={refinery:'forge',contract:'contract',core:'meditation',bag:'vault'}[entry];
  await window.switchToPage?.('page-training');
  if(place){
    const target=document.querySelector(`[data-training-location="${place}"]`);
    if(target?.disabled){toast(target.getAttribute('aria-label')||'這項修行尚未解鎖');return;}
    target?.click();
  }
}
function ensureView(){
  const uid=getMainUser()?.uid;if(!uid)return null;
  if(view&&owner===uid)return view;
  view?.destroy();owner=uid;
  view=new WorldView(root,{api:(...args)=>getMainUser()?.uid===uid?transport.request(...args):Promise.reject(new Error('登入帳號已變更')),
    subscribe:transport.subscribe,uid,openEntry,
    confirm:message=>window.openConfirm?window.openConfirm(message):Promise.resolve(window.confirm(message)),
    applyUser(result){
      if(getMainUser()?.uid!==uid)return;const user=window.getCurrentUserData?.();if(!user)return;
      if(result.inventory)user.materialSystem={...user.materialSystem,inventory:result.inventory};
      if(result.stats)user.stats={...user.stats,...result.stats};
      window.updateUIStats?.();window.dispatchEvent(new CustomEvent('xiuxian:stats-updated',{detail:{source:'world'}}));
      window.dispatchEvent(new CustomEvent('xiuxian:materials-updated'));
    }});
  return view;
}
function sync(){
  const active=root.classList.contains('active-page')&&!root.classList.contains('hidden')&&!!getMainUser();
  document.body.classList.toggle('world-page-open',active);
  if(active)document.querySelector('#nav-grid [data-target="page-home"]')?.classList.add('active-nav-btn');
  if(active&&!document.hidden)ensureView()?.start();else view?.suspend();
}
new MutationObserver(sync).observe(root,{attributes:true,attributeFilter:['class']});
window.addEventListener('xiuxian:user-data-ready',sync);
window.addEventListener('xiuxian:signed-out',()=>{
  view?.destroy();view=null;owner='';root.classList.remove('active-page');root.classList.add('hidden');document.body.classList.remove('world-page-open');
});
window.addEventListener('pagehide',()=>view?.suspend());
document.addEventListener('visibilitychange',sync);
window.openWorldMap=async()=>{
  if(opening)return;opening=true;
  try{await window.switchToPage?.('page-world');sync();}finally{opening=false;}
};
window.QAWorld=Object.freeze({open:()=>window.openWorldMap(),active:()=>!!view?.battle()&&view.battle().status==='active'});
document.getElementById('brand-home')?.setAttribute('aria-label','青雲問道，返回大世界');
document.getElementById('brand-home')?.setAttribute('title','返回大世界');
// Keep the original five navigation buttons, icons, order and styling.
// The existing title button returns from cultivation and social pages to the world.
