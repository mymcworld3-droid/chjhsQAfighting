import './weapon-presentation.js';
import './weapon-dungeon-rules.js';
import {authenticatedMainFetch,getMainUser} from './data/project-repository.js';
import {weaponDungeonTicketMarkup} from './spirit-stone-ui.js?v=20261125-stone-reward-icon-v2';
let panel=null,data=null,loading=false,serial=0,trigger=null,selectedId=null,selectedTier=0,atlasScroll=0;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const catalog=()=>Array.isArray(data?.dungeons)?data.dungeons:[];
const selected=()=>catalog().find(d=>d.id===selectedId);
const activeId=()=>data?.active?.dungeonId||data?.dungeonId;
const isResume=(d,i)=>data?.active&&activeId()===d.id&&data.active.difficulty===i;
const canEnter=(d,t)=>!loading&&t&&!t.locked&&(isResume(d,t.index)||(!data.active&&data.tickets>0));
const theme=d=>d.theme==='stone'?' wd-stone':d.theme==='desert'?' wd-desert':'';
function ensureStyle(){
  if(!document.getElementById('weapon-dungeons-style')){const link=document.createElement('link');link.id='weapon-dungeons-style';link.rel='stylesheet';link.href='/styles/weapon-dungeons.css';document.head.append(link);}
}
function ensure(){
  if(panel)return true;
  const host=document.querySelector('#page-gameplay .gameplay-shell')||document.querySelector('#page-gameplay');
  if(!host)return false;
  ensureStyle();
  panel=document.createElement('section');panel.id='weapon-dungeons-panel';panel.setAttribute('aria-labelledby','weapon-dungeons-title');panel.hidden=true;host.append(panel);
  panel.addEventListener('click',event=>{
    if(event.target.closest('[data-wd-close]')){hidePanel();return;}
    if(event.target.closest('[data-wd-back]')){hidePanel();return;}
    if(loading||!data)return;
    const button=event.target.closest('[data-wd-difficulty]');
    if(button&&selected()){selectDifficulty(Number(button.dataset.wdDifficulty));return;}
    const start=event.target.closest('[data-wd-enter]');
    if(start&&!start.disabled&&selected())void enter(selectedTier);
  });

  return true;
}
function showPanel(){
  const page=document.getElementById('page-gameplay');
  if(panel.hidden)atlasScroll=page?.scrollTop||0;
  panel.hidden=false;panel.parentElement?.setAttribute('data-wd-open','true');
}
function hidePanel(restoreFocus=true){
  if(!panel||panel.hidden)return;
  if(loading){serial++;loading=false;}
  panel.hidden=true;panel.removeAttribute('data-wd-entering');panel.parentElement?.removeAttribute('data-wd-open');
  if(restoreFocus){
    const page=document.getElementById('page-gameplay');
    if(atlas&&page)page.scrollTop=atlasScroll;
    const focus=trigger?.isConnected!==false&&trigger?.closest?.('[data-atlas-dungeon]')?trigger:
      atlas?atlas.querySelector?.('[data-atlas-dungeon]')||trigger:trigger;
    focus?.focus?.({preventScroll:true});
  }
}
const count=d=>d.difficulties.filter(t=>Number(d.clears[t.index])>0).length;
const traits=d=>'<div class="wd-traits">'+d.traits.map(t=>'<span>'+esc(t)+'</span>').join('')+'</div>';
function sceneHero(d){
  return `<section class="wd-hero${theme(d)}"><img class="wd-island" src="${esc(atlasArt[d.id]||'/assets/training/layers/landscape-island-secret.webp')}" alt="" draggable="false"><div class="wd-scene-caption"><small>${esc(d.subtitle)} · 單人挑戰</small><h3>${esc(d.name)}</h3>${traits(d)}<div class="wd-bonus"><i class="fa-solid fa-bolt" aria-hidden="true"></i> ${esc(d.bonus)}</div></div></section>`;
}
function detail(d){
  return `<div class="wd-expedition">${sceneHero(d)}<section class="wd-preparation" aria-label="挑戰準備">
  <div class="wd-section-heading"><h3>選擇挑戰境界</h3><span>已征服 ${count(d)} / ${d.difficulties.length}</span></div>
  <div class="wd-difficulties" role="group" aria-label="選擇副本難度" style="--wd-selected-index:${selectedTier}"><span class="wd-difficulty-selection" aria-hidden="true"></span>${d.difficulties.map(t=>{
    const resume=isResume(d,t.index),cleared=Number(d.clears[t.index])||0;
    const badge=globalThis.QAWeaponPresentation.difficultyState({locked:t.locked,clears:cleared,resume});
    return `<button type="button" data-wd-difficulty="${t.index}" data-qy-difficulty="${badge.key}" class="${t.index===selectedTier?'active ':''}${t.locked?'locked':''}" aria-pressed="${t.index===selectedTier}" ${loading?'disabled':''}><i class="fa-solid ${t.locked?'fa-lock':cleared?'fa-circle-check':resume?'fa-play':'fa-diamond'}" aria-hidden="true"></i><strong>${globalThis.QAWeaponPresentation.realmMarkup(t.name,{kind:'difficulty'})}</strong><small>${esc(resume?'續戰':t.locked?'未解鎖':cleared?'已通關':'可挑戰')}</small></button>`;
  }).join('')}</div>
  <div class="wd-tier-preview" data-wd-preview aria-live="polite">${tierPreview(d)}</div>
  <details class="wd-intel"><summary>秘境情報與掉落規則</summary><p>${esc(d.description)}</p><ol>${d.tactics.map(t=>'<li>'+esc(t)+'</li>').join('')}</ol><p>通關時擲一次，三種結果互斥。若該階沒有可掉落武器，則不發放。重複武器累計持有數，保留最高等階。</p></details><div class="wd-action"><button type="button" class="wd-enter" data-wd-enter ${canEnter(d,currentTier(d))?'':'disabled'}>${tierAction(d)}</button><small class="wd-cost">新挑戰消耗 ${weaponDungeonTicketMarkup(1)}；失敗或中途離場不退券。收起戰場可續戰。</small></div></section></div>`;
}
const defaultTier=d=>d&&data?.active&&activeId()===d.id&&d.difficulties.some(t=>t.index===data.active.difficulty)?data.active.difficulty:0;
const currentTier=d=>d?.difficulties.find(t=>t.index===selectedTier);
function tierAction(d){
  const t=currentTier(d);
  if(!t)return '選擇挑戰境界';
  if(loading)return '正在進入秘境…';
  if(isResume(d,t.index))return '繼續挑戰 · 不耗券';
  if(t.locked)return '通過前一難度解鎖';
  if(data.active)return '其他挑戰進行中';
  if(data.tickets<1)return '副本券不足';
  return (Number(d.clears[t.index])?'再次挑戰 · ':'開始挑戰 · ')+weaponDungeonTicketMarkup(1);
}
function rewardGroup(d,realm,chance,next=false){
  const pool=(d.rewardPools??data?.rewardPools)?.[realm],known=Array.isArray(pool);
  const art=globalThis.QAWeaponPresentation.art;
  const items=known?pool.map(book=>{
    const url=art(book.id);
    return '<div class="wd-reward-item" data-wd-reward-id="'+esc(book.id)+'">'+(url?'<img src="'+esc(url)+'" alt="" decoding="async" draggable="false">':'<i class="fa-solid fa-gem" aria-hidden="true"></i>')+'<small>'+esc(book.name)+'</small></div>';
  }).join(''):'';
  return '<section class="wd-reward'+(next?' wd-reward-next':'')+'"><div class="wd-reward-label"><small>'+chance+'% '+esc(realm)+'武器</small><b>'+(!known?'掉落池待同步':pool.length?(next?'低一階掉落':'當階掉落'):'此階暫無武器')+'</b></div>'+(items?'<div class="wd-reward-items" aria-label="'+esc(realm)+'可掉落武器">'+items+'</div>':'')+'</section>';
}
function tierPreview(d){
  const t=currentTier(d);
  if(!t)return '';
  const badge=globalThis.QAWeaponPresentation.difficultyState({locked:t.locked,clears:Number(d.clears[t.index])||0,resume:isResume(d,t.index)});
  const pools=d.rewardPools??data?.rewardPools;
  const lower=t.lowerRealm??globalThis.QAWeaponDungeons.lowerRealm(t.name);
  const current=pools?.[t.name],next=pools?.[lower];
  const known=Array.isArray(current)&&Array.isArray(next);
  const none=50+(known&&!current.length?30:0)+(known&&!next.length?20:0);
  return '<div class="wd-preview-title"><strong>可能獲得'+(d.rewardWeaponType==='sword'?' · 僅劍類':'')+'</strong><small>'+globalThis.QAWeaponPresentation.realmMarkup(t.name,{kind:'difficulty'})+' · '+esc(badge.label)+'</small></div><div class="wd-reward-pair">'+rewardGroup(d,t.name,30)+rewardGroup(d,lower,20,true)+'</div><small class="wd-no-drop">'+(known?'實際未掉落武器機率 '+none+'%':'基礎未掉落機率 50%（空池時增加）')+'</small>';
}
function selectDifficulty(index){
  const d=selected();
  if(loading||!d?.difficulties.some(t=>t.index===index))return;
  selectedTier=index;
  const picker=panel.querySelector?.('.wd-difficulties');
  picker?.style.setProperty('--wd-selected-index',String(index));
  picker?.querySelectorAll('[data-wd-difficulty]').forEach(button=>{
    const active=Number(button.dataset.wdDifficulty)===index;
    button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
  });
  const preview=panel.querySelector?.('[data-wd-preview]'),action=panel.querySelector?.('[data-wd-enter]');
  if(preview)preview.innerHTML=tierPreview(d);
  if(action){action.disabled=!canEnter(d,currentTier(d));action.innerHTML=tierAction(d);}
}

function paint(message=''){
  const d=selected(),destination=(atlasEntries||globalThis.QAWeaponDungeons?.CATALOG?.filter(entry=>!entry.hidden)||[]).find(entry=>entry.id===selectedId);
  panel.innerHTML=`<header><div class="wd-heading"><button type="button" data-wd-close data-wd-back data-qy-nav-action="back" aria-label="返回秘境選擇"><svg class="wd-nav-glyph" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button><h2 id="weapon-dungeons-title" tabindex="-1">武器秘境</h2></div><details class="wd-tickets"><summary><strong>副本券 ${data?weaponDungeonTicketMarkup(data.tickets):'同步中'}</strong><svg class="wd-info-glyph" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/></svg></summary><span class="wd-ticket-help">每日補發 3 張 · 補發上限 5 張<br>臺灣時間 00:00</span></details></header>
    <div class="wd-body">
    ${data?.active?'<div class="wd-active">已有進行中的挑戰，續戰不耗券；完成或離場後才能開啟其他挑戰。</div>':''}
    ${!data?(destination?'<div class="wd-expedition wd-loading">'+sceneHero(destination)+'<section class="wd-preparation wd-pending" aria-busy="'+loading+'"><p data-qy-state="'+(loading?'loading':'error')+'">'+(loading?'正在讀取秘境資料…':'秘境資料未能同步，請返回後重新開啟。')+'</p></section></div>':'<p data-qy-state="'+(loading?'loading':'error')+'">'+(loading?'正在讀取秘境資料…':'秘境資料未能同步，請返回後重新開啟。')+'</p>'):d?detail(d):'<p data-qy-state="error">此秘境目前未開放，請返回島嶼選擇。</p>'}
    <p class="wd-message" role="status" aria-live="polite"${message?' data-qy-state="'+(loading?'syncing':'error')+'"':''}>${esc(message)}</p></div>`;

}
async function enter(difficulty){
  const d=selected(),tier=d?.difficulties.find(t=>t.index===difficulty);
  if(!d||!canEnter(d,tier))return;
  const account=getMainUser()?.uid,token=++serial;loading=true;panel.setAttribute('data-wd-entering','true');paint('正在進入秘境…');
  try{
    const battle=await import('./tactical-combat.js?v=20261125-weapon-lord-cleared-v1');
    if(serial!==token||getMainUser()?.uid!==account)return;
    loading=false;hidePanel(false);
    await battle.openTacticalCombat('weapon-dungeon',{dungeonId:d.id,difficulty,...(isResume(d,difficulty)&&data.active.roomId?{resumeRoomId:data.active.roomId}:{})});
  }catch(error){if(serial===token&&getMainUser()?.uid===account){loading=false;paint(error.message||'副本暫時無法開啟');showPanel();}}
  finally{if(serial===token){loading=false;panel.removeAttribute('data-wd-entering');}}
}
export async function openWeaponDungeons(dungeonId=null,origin=null){
  const account=getMainUser()?.uid;
  if(!account){window.showToast?.('請先登入後挑戰武器副本');return;}
  if(!ensure())return;
  navigatingToAtlas=true;
  try{window.switchToPage?.('page-gameplay');}finally{navigatingToAtlas=false;}
  if(typeof dungeonId!=='string'||!dungeonId){
    hidePanel(false);openAtlas();return refreshAtlasTickets();
  }
  trigger=origin||document.activeElement;
  openAtlas();
  invalidateAtlasTickets();
  data=null;selectedId=dungeonId;selectedTier=0;loading=true;paint('');
  showPanel();const page=document.getElementById('page-gameplay');if(page)page.scrollTop=0;
  panel.querySelector?.('#weapon-dungeons-title')?.focus?.({preventScroll:true});const token=++serial;
  try{
    const response=await authenticatedMainFetch('/api/tactical/weapon-dungeons'),result=await response.json();
    if(serial!==token||getMainUser()?.uid!==account)return;
    if(!response.ok||!result.ok)throw Error(result.error||'副本資料同步失敗');
    data=result.state;setAtlasTickets(data.tickets);setAtlasActive(data);selectedId=typeof dungeonId==='string'&&catalog().some(d=>d.id===dungeonId)?dungeonId:null;selectedTier=defaultTier(selected());loading=false;paint();
  }catch(error){if(serial===token){loading=false;paint(error.message||'副本資料同步失敗');}}
}
// Both orientations use the same island atlas. Portrait has a separate launcher state.
const landscape=()=>window.matchMedia?.('(orientation: landscape)')?.matches===true;
let atlas=null,atlasCategory='weapon',atlasShown=false,navigatingToAtlas=false;
let atlasTickets=null,atlasTicketEpoch=0,atlasTicketRequest=null,atlasActive=null,quickResumeBusy=false;
let atlasProgress=new Map(),atlasEntries=null;
function atlasTicketMarkup(){
  return '武器副本券 '+weaponDungeonTicketMarkup(atlasTickets===null?'—':atlasTickets);
}
function setAtlasTickets(value){
  atlasTickets=Number.isSafeInteger(value)&&value>=0?value:null;
  const balance=atlas?.querySelector?.('[data-atlas-tickets]');
  if(balance)balance.innerHTML=atlasTicketMarkup();
}
function progressMarkup(id){
  const d=atlasProgress.get(id);
  if(!d)return '';
  const cleared=count(d),total=d.difficulties.length;
  return '<span class="wd-atlas-pips" aria-hidden="true">'+d.difficulties.map(t=>'<i class="'+(Number(d.clears[t.index])>0?'is-cleared':t.locked?'is-locked':'is-ready')+'"></i>').join('')+'</span><span>已征服 '+cleared+' / '+total+'</span>';
}
function setAtlasProgress(state){
  const previous=(atlasEntries||globalThis.QAWeaponDungeons?.CATALOG?.filter(d=>!d.hidden)||[]).map(d=>d.id).join(',');
  atlasEntries=Array.isArray(state?.dungeons)?state.dungeons:null;
  atlasProgress=new Map((atlasEntries||[]).filter(d=>Array.isArray(d.difficulties)&&Array.isArray(d.clears)).map(d=>[d.id,d]));
  const next=(atlasEntries||globalThis.QAWeaponDungeons?.CATALOG?.filter(d=>!d.hidden)||[]).map(d=>d.id).join(',');
  if(atlas&&atlasCategory==='weapon'&&previous!==next)atlas.innerHTML=atlasMarkup('weapon');
  atlas?.querySelectorAll?.('[data-atlas-progress]').forEach(slot=>{slot.innerHTML=progressMarkup(slot.dataset.atlasProgress);});
}
function setAtlasActive(state){
  setAtlasProgress(state);
  const active=state?.active,d=state?.dungeons?.find(d=>d.id===(active?.dungeonId||state.dungeonId)),tier=d?.difficulties.find(t=>t.index===active?.difficulty);
  atlasActive=active?.roomId&&tier&&!tier.locked?{roomId:active.roomId,dungeonId:d.id,difficulty:tier.index,name:d.name,realm:tier.name,account:getMainUser()?.uid}:null;
  const slot=atlas?.querySelector?.('[data-atlas-resume-slot]');
  if(slot)slot.innerHTML=atlasResumeMarkup();
}
function atlasResumeMarkup(){
  return atlasActive?'<button type="button" class="wd-quick-resume" data-atlas-resume '+(quickResumeBusy?'disabled':'')+'><i class="fa-solid fa-play" aria-hidden="true"></i><span><strong>繼續挑戰</strong><small>'+esc(atlasActive.name)+' · '+esc(atlasActive.realm)+'</small></span><small>不耗券</small></button>':'';
}
async function quickResume(){
  const active=atlasActive;
  if(!active||quickResumeBusy||panel&&!panel.hidden||getMainUser()?.uid!==active.account)return;
  quickResumeBusy=true;
  const slot=atlas?.querySelector?.('[data-atlas-resume-slot]');
  if(slot)slot.innerHTML=atlasResumeMarkup();
  try{
    const battle=await import('./tactical-combat.js?v=20261125-weapon-lord-cleared-v1');
    if(atlasActive!==active||getMainUser()?.uid!==active.account)return;
    await battle.openTacticalCombat('weapon-dungeon',{dungeonId:active.dungeonId,difficulty:active.difficulty,resumeRoomId:active.roomId});
  }catch(error){window.showToast?.(error.message||'續戰暫時無法開啟');}
  finally{quickResumeBusy=false;const current=atlas?.querySelector?.('[data-atlas-resume-slot]');if(current)current.innerHTML=atlasResumeMarkup();}
}
function invalidateAtlasTickets(){
  atlasTicketEpoch++;atlasTicketRequest=null;setAtlasTickets(null);setAtlasActive(null);
}
function refreshAtlasTickets(){
  const account=getMainUser()?.uid;
  if(!account){invalidateAtlasTickets();return Promise.resolve();}
  if(atlasTicketRequest?.account===account)return atlasTicketRequest.promise;
  const epoch=++atlasTicketEpoch;
  setAtlasTickets(null);setAtlasActive(null);
  const promise=(async()=>{
    try{
      const response=await authenticatedMainFetch('/api/tactical/weapon-dungeons'),result=await response.json();
      if(epoch!==atlasTicketEpoch||getMainUser()?.uid!==account)return;
      if(!response.ok||!result.ok)throw Error('副本券同步失敗');
      setAtlasTickets(result.state?.tickets);setAtlasActive(result.state);
    }catch(error){if(epoch===atlasTicketEpoch&&getMainUser()?.uid===account)setAtlasTickets(null);}
    finally{if(atlasTicketRequest?.epoch===epoch)atlasTicketRequest=null;}
  })();
  atlasTicketRequest={account,epoch,promise};
  return promise;
}
const atlasArt={ 'peak-stone':'/assets/dungeons/peak-stone.png' };
function atlasMarkup(category){
  if(category==='coop'&&window.QA_COOP_DUNGEON_ENABLED===true){
    return `<div class="gameplay-atlas-heading"><h3>合作副本</h3></div><div class="gameplay-atlas-sites"><button type="button" class="gameplay-atlas-node" data-atlas-coop><img src="/assets/training/layers/landscape-island-secret.webp" alt="" draggable="false"><span class="gameplay-atlas-name"><span>合作秘境</span></span><small>組隊挑戰</small></button></div>`;
  }
  const entries=atlasEntries||globalThis.QAWeaponDungeons?.CATALOG?.filter(d=>!d.hidden)||[];
  return `<div class="gameplay-atlas-heading"><button type="button" class="gameplay-atlas-back" data-atlas-back aria-label="返回歷練">‹ 返回</button><h3>武器副本</h3><span class="gameplay-atlas-tickets" data-atlas-tickets aria-live="polite">${atlasTicketMarkup()}</span></div>
    <div class="gameplay-atlas-sites">${entries.map(d=>`<button type="button" class="gameplay-atlas-node" data-atlas-dungeon="${esc(d.id)}" data-atlas-theme="${esc(d.theme)}" aria-label="選擇${esc(d.name)}">
      <img src="${atlasArt[d.id]||'/assets/training/layers/landscape-island-secret.webp'}" alt="" draggable="false">
      <span class="gameplay-atlas-name"><span>${esc(d.name)}</span></span>
      <small>${esc(d.subtitle)}</small><span class="wd-atlas-progress" data-atlas-progress="${esc(d.id)}">${progressMarkup(d.id)}</span></button>`).join('')}</div>
    <div class="wd-atlas-footer"><div data-atlas-resume-slot>${atlasResumeMarkup()}</div><p class="gameplay-atlas-hint"><i class="fa-solid fa-compass" aria-hidden="true"></i> 選擇秘境，查看可挑戰的境界</p></div>`;
}
function selectCategory(category='weapon'){
  if(panel&&!panel.hidden)hidePanel(false);
  atlasCategory=category==='coop'&&window.QA_COOP_DUNGEON_ENABLED===true?'coop':'weapon';
  if(!atlas)return;
  atlas.innerHTML=atlasMarkup(atlasCategory);
  for(const [id,key] of [['gameplay-weapon-dungeon-entry','weapon'],['gameplay-dungeon-entry','coop']]){
    const button=document.getElementById(id);
    if(landscape())button?.setAttribute('aria-pressed',String(key===atlasCategory));
    else button?.removeAttribute?.('aria-pressed');
  }
}
function openAtlas(){
  if(!atlas)return;
  if(atlasCategory!=='weapon')selectCategory('weapon');
  const alreadyShown=atlasShown;atlasShown=true;atlas.parentElement?.setAttribute('data-wd-atlas','true');
  const page=document.getElementById('page-gameplay');
  if(page&&!alreadyShown&&!landscape())page.scrollTop=0;
}
function closeAtlas(restoreFocus=true){
  atlasShown=false;atlas?.parentElement?.removeAttribute('data-wd-atlas');invalidateAtlasTickets();
  if(restoreFocus){
    const page=document.getElementById('page-gameplay');if(page)page.scrollTop=0;
    document.getElementById('gameplay-weapon-dungeon-entry')?.focus?.({preventScroll:true});
  }
}
function mountAtlas(target){
  const shell=document.querySelector('#page-gameplay .gameplay-shell');
  if(!shell||atlas)return;
  ensureStyle();
  atlas=document.createElement('section');atlas.id='gameplay-dungeon-atlas';atlas.className='gameplay-atlas';
  atlas.setAttribute('aria-label','副本選擇');shell.append(atlas);shell.dataset.atlasReady='true';
  atlas.addEventListener('click',event=>{
    if(event.target.closest('[data-atlas-back]')){closeAtlas();return;}
    if(event.target.closest('[data-atlas-resume]')){void quickResume();return;}
    const node=event.target.closest('[data-atlas-dungeon]');
    if(node){if(quickResumeBusy||panel&&!panel.hidden)return;void openWeaponDungeons(node.dataset.atlasDungeon,node);return;}
    if(event.target.closest('[data-atlas-coop]')&&window.QA_COOP_DUNGEON_ENABLED===true)void window.openDungeonLobby?.();
  });
  // Preserve the inactive cooperative mode and its existing portrait launcher.
  target.addEventListener('click',event=>{
    if(!landscape()||window.QA_COOP_DUNGEON_ENABLED!==true||!event.target.closest('#gameplay-dungeon-entry'))return;
    event.preventDefault();event.stopImmediatePropagation();selectCategory('coop');
  },true);
  const media=window.matchMedia?.('(orientation: landscape)');
  media?.addEventListener?.('change',()=>{if(!panel||panel.hidden)selectCategory('weapon');});
  const page=document.getElementById('page-gameplay');
  let active=page?.classList.contains('active-page');
  const refreshVisible=()=>{
    if(!navigatingToAtlas&&(!panel||panel.hidden)&&atlasCategory==='weapon'&&(landscape()||atlasShown))void refreshAtlasTickets();
  };
  window.addEventListener('xiuxian:page-switched',event=>{
    if(event.detail?.pageId==='page-gameplay')refreshVisible();
    else if(event.detail?.pageId){hidePanel(false);closeAtlas(false);}
  });
  window.addEventListener('xiuxian:user-data-ready',()=>{
    hidePanel(false);closeAtlas(false);serial++;data=null;loading=false;selectedId=null;selectedTier=0;
    if(page?.classList.contains('active-page'))refreshVisible();
  });
  window.addEventListener('xiuxian:weapon-dungeon-closed',()=>{
    invalidateAtlasTickets();
    if(page?.classList.contains('active-page'))refreshVisible();
  });
  if(page&&typeof MutationObserver==='function'){
    new MutationObserver(()=>{
      const next=page.classList.contains('active-page');
      if(!next&&active){hidePanel(false);closeAtlas(false);}
      if(next&&!active&&(!panel||panel.hidden)){selectCategory('weapon');refreshVisible();}
      active=next;
    }).observe(page,{attributes:true,attributeFilter:['class']});
  }
  selectCategory('weapon');
  if(active)refreshVisible();
}
function mount(){
  const target=document.querySelector('#page-gameplay .gameplay-entries');
  if(!target||document.getElementById('gameplay-weapon-dungeon-entry'))return;
  const button=document.createElement('button');button.type='button';button.id='gameplay-weapon-dungeon-entry';button.className='gameplay-dungeon-entry';
  button.innerHTML='<i class="fa-solid fa-mountain" aria-hidden="true"></i><span><strong>武器副本</strong><small>單人秘境 · 武器掉落 · 六階挑戰</small></span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i>';
  button.addEventListener('click',()=>{if(landscape()&&atlas){selectCategory('weapon');void refreshAtlasTickets();}else void openWeaponDungeons();});target.append(button);
  mountAtlas(target);
}
window.openWeaponDungeons=openWeaponDungeons;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
export const featureReady=Promise.resolve();
