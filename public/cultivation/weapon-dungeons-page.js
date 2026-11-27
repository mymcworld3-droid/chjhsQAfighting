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
const theme=d=>d.theme==='stone'?' wd-stone':'';
function ensure(){
  if(panel)return true;
  const host=document.querySelector('#page-gameplay .gameplay-shell')||document.querySelector('#page-gameplay');
  if(!host)return false;
  if(!document.getElementById('weapon-dungeons-style')){const link=document.createElement('link');link.id='weapon-dungeons-style';link.rel='stylesheet';link.href='/styles/weapon-dungeons.css';document.head.append(link);}
  panel=document.createElement('section');panel.id='weapon-dungeons-panel';panel.setAttribute('aria-labelledby','weapon-dungeons-title');panel.hidden=true;host.append(panel);
  panel.addEventListener('click',event=>{
    if(event.target.closest('[data-wd-close]')){hidePanel();return;}
    if(event.target.closest('[data-wd-back]')){
      if(landscape()&&atlas){hidePanel();return;}
      if(loading||!data)return;
      selectedId=null;selectedTier=0;paint();panel.querySelector?.('[data-wd-dungeon]')?.focus();return;
    }
    if(loading||!data)return;
    const card=event.target.closest('[data-wd-dungeon]');
    if(card&&catalog().some(d=>d.id===card.dataset.wdDungeon)){selectedId=card.dataset.wdDungeon;selectedTier=defaultTier(selected());paint();panel.querySelector?.('#weapon-dungeons-title')?.focus();return;}
    const button=event.target.closest('[data-wd-difficulty]');
    if(button&&selected()){selectDifficulty(Number(button.dataset.wdDifficulty));return;}
    const start=event.target.closest('[data-wd-enter]');
    if(start&&!start.disabled&&selected())void enter(selectedTier);
  });
  window.addEventListener('xiuxian:page-switched',event=>{if(event.detail?.pageId&&event.detail.pageId!=='page-gameplay')hidePanel(false);});
  window.addEventListener('xiuxian:user-data-ready',()=>{hidePanel(false);serial++;data=null;loading=false;selectedId=null;selectedTier=0;});
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
  panel.hidden=true;panel.parentElement?.removeAttribute('data-wd-open');
  if(restoreFocus){
    const page=document.getElementById('page-gameplay');
    if(landscape()&&atlas&&page)page.scrollTop=atlasScroll;
    const focus=trigger?.isConnected!==false&&trigger?.closest?.('[data-atlas-dungeon]')?trigger:
      landscape()&&atlas?atlas.querySelector?.('[data-atlas-dungeon]')||trigger:trigger;
    focus?.focus?.({preventScroll:true});
  }
}
const count=d=>d.difficulties.filter(t=>Number(d.clears[t.index])>0).length;
const traits=d=>'<div class="wd-traits">'+d.traits.map(t=>'<span>'+esc(t)+'</span>').join('')+'</div>';
function card(d){
  const active=data.active&&activeId()===d.id;
  return `<button type="button" class="wd-card${theme(d)}" data-wd-dungeon="${esc(d.id)}">
    <div class="wd-card-art"><span class="wd-chip">單人秘境</span><span class="wd-chip">${active?'挑戰進行中':count(d)===6?'六階皆通關':'可探索'}</span><div class="wd-card-name"><small>${esc(d.subtitle)}</small><strong>${esc(d.name)}</strong></div></div>
    <div class="wd-card-body"><p>${esc(d.description)}</p>${traits(d)}<div class="wd-progress"><span>境界征服</span><b>${count(d)} / ${d.difficulties.length}</b></div>
    <div class="wd-progress-track" data-qy-progress="segmented" role="progressbar" aria-label="境界征服" aria-valuemin="0" aria-valuenow="${count(d)}" aria-valuemax="${d.difficulties.length}">${d.difficulties.map(t=>'<i class="'+(d.clears[t.index]?'cleared':t.locked?'':'available')+'"></i>').join('')}</div>
    <div class="wd-card-footer"><span>${esc(d.bonus)}</span><b>${active?'查看續戰':'探索秘境'} ›</b></div></div></button>`;
}
function detail(d){
  return `<section class="wd-hero${theme(d)}"><div><small>${esc(d.subtitle)}</small><h3>${esc(d.name)}</h3><p>${esc(d.description)}</p>${traits(d)}</div><div class="wd-emblem" aria-hidden="true"></div></section>
  <div class="wd-detail-grid"><section class="wd-panel"><h3>秘境法則</h3><div class="wd-bonus">${esc(d.bonus)}</div><ol>${d.tactics.map(t=>'<li>'+esc(t)+'</li>').join('')}</ol></section>
  <section class="wd-panel"><h3>武器掉落</h3><div class="wd-loot-bar" aria-hidden="true"><i></i><i></i><i></i></div><div class="wd-loot-legend"><span>30% 當階</span><span>20% 下一階</span><span>50% 無武器</span></div><p>通關時擲一次，三種結果互斥。重複武器累計持有數，保留最高等階。</p></section></div>
  <div class="wd-section-heading"><h3>選擇挑戰境界</h3><span>已征服 ${count(d)} / ${d.difficulties.length}</span></div>
  <div class="wd-difficulties" role="group" aria-label="選擇副本難度" style="--wd-selected-index:${selectedTier}"><span class="wd-difficulty-selection" aria-hidden="true"></span>${d.difficulties.map(t=>{
    const resume=isResume(d,t.index),cleared=Number(d.clears[t.index])||0;
    const badge=globalThis.QAWeaponPresentation.difficultyState({locked:t.locked,clears:cleared,resume});
    return `<button type="button" data-wd-difficulty="${t.index}" data-qy-difficulty="${badge.key}" class="${t.index===selectedTier?'active ':''}${t.locked?'locked':''}" aria-pressed="${t.index===selectedTier}" ${loading?'disabled':''}><strong>${globalThis.QAWeaponPresentation.realmMarkup(t.name,{kind:'difficulty'})}</strong><small>${esc(resume?'續戰':t.locked?'未解鎖':cleared?'已通關':'可挑戰')}</small></button>`;
  }).join('')}</div>
  <div class="wd-tier-preview" data-wd-preview aria-live="polite">${tierPreview(d)}</div>
  <button type="button" class="wd-enter" data-wd-enter ${canEnter(d,currentTier(d))?'':'disabled'}>${tierAction(d)}</button>`;
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
function tierPreview(d){
  const t=currentTier(d);
  if(!t)return '';
  const badge=globalThis.QAWeaponPresentation.difficultyState({locked:t.locked,clears:Number(d.clears[t.index])||0,resume:isResume(d,t.index)});
  return '<strong>'+globalThis.QAWeaponPresentation.realmMarkup(t.name,{kind:'difficulty'})+' · '+esc(badge.label)+'</strong><small>30% '+esc(t.name)+'武器 · 20% '+esc(t.nextRealm)+'武器</small>';
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
  const d=selected();
  panel.innerHTML=`<header><div class="wd-heading">${d?'<button type="button" data-wd-back data-qy-nav-action="back" aria-label="返回秘境選擇">‹</button>':''}<div><small>青雲問道 / 歷練 / 武器副本</small><h2 id="weapon-dungeons-title" tabindex="-1">${d?esc(d.name):'武器秘境'}</h2></div></div><button type="button" data-wd-close data-qy-nav-action="close" aria-label="返回歷練">返回歷練</button></header>
    <div class="wd-body"><div class="wd-tickets"><div><strong>副本券 ${data?weaponDungeonTicketMarkup(data.tickets):'同步中'}</strong><div class="wd-ticket-pips" aria-hidden="true">${Array.from({length:5},(_,i)=>'<i class="'+(data&&i<data.tickets?'filled':'')+'"></i>').join('')}</div></div><span>每日補發 3 張 · 補發上限 5 張<br>臺灣時間 00:00</span></div>
    ${data?.active?'<div class="wd-active">已有進行中的挑戰，續戰不耗券；完成或離場後才能開啟其他挑戰。</div>':''}
    ${!data?'<p data-qy-state="'+(loading?'loading':'error')+'">'+(loading?'正在讀取秘境資料…':'秘境資料未能同步，請返回後重新開啟。')+'</p>':d?detail(d):`<div class="wd-section-heading"><h3>尋訪秘境</h3><span>${catalog().length} 座開放</span></div><p>選擇秘境，探索不同戰鬥法則，挑戰更高境界並尋找武器。</p><div class="wd-catalog">${catalog().map(card).join('')}<div class="wd-coming"><span aria-hidden="true">◇</span><strong>群山之外</strong><small>更多秘境尚待開放</small></div></div>`}
    <p class="wd-cost">新挑戰消耗 ${weaponDungeonTicketMarkup(1)}；失敗或中途離場不退券。收起戰場可續戰。</p>
    <p class="wd-message" role="status" aria-live="polite"${message?' data-qy-state="'+(loading?'syncing':'error')+'"':''}>${esc(message)}</p></div>`;

}
async function enter(difficulty){
  const d=selected(),tier=d?.difficulties.find(t=>t.index===difficulty);
  if(!d||!canEnter(d,tier))return;
  const account=getMainUser()?.uid,token=++serial;loading=true;paint('正在進入秘境…');
  try{
    const battle=await import('./tactical-combat.js?v=20261125-weapon-lord-cleared-v1');
    if(serial!==token||getMainUser()?.uid!==account)return;
    loading=false;hidePanel(false);
    await battle.openTacticalCombat('weapon-dungeon',{dungeonId:d.id,difficulty});
  }catch(error){if(serial===token&&getMainUser()?.uid===account){loading=false;paint(error.message||'副本暫時無法開啟');showPanel();}}
  finally{if(serial===token)loading=false;}
}
export async function openWeaponDungeons(dungeonId=null,origin=null){
  const account=getMainUser()?.uid;
  if(!account){window.showToast?.('請先登入後挑戰武器副本');return;}
  if(!ensure())return;
  trigger=origin||document.activeElement;
  window.switchToPage?.('page-gameplay');data=null;selectedId=null;selectedTier=0;loading=true;paint('正在同步副本券與秘境進度…');
  showPanel();panel.scrollIntoView?.({block:'nearest'});const token=++serial;
  try{
    const response=await authenticatedMainFetch('/api/tactical/weapon-dungeons'),result=await response.json();
    if(serial!==token||getMainUser()?.uid!==account)return;
    if(!response.ok||!result.ok)throw Error(result.error||'副本資料同步失敗');
    data=result.state;selectedId=typeof dungeonId==='string'&&catalog().some(d=>d.id===dungeonId)?dungeonId:null;selectedTier=defaultTier(selected());loading=false;paint();
  }catch(error){if(serial===token){loading=false;paint(error.message||'副本資料同步失敗');}}
}
// Landscape swaps the entire atlas for inline detail and restores the original atlas on return.
const landscape=()=>window.matchMedia?.('(orientation: landscape)')?.matches===true;
let atlas=null,atlasCategory='weapon';
const atlasArt={ 'peak-stone':'/assets/dungeons/peak-stone.png' };
function atlasMarkup(category){
  if(category==='coop'&&window.QA_COOP_DUNGEON_ENABLED===true){
    return `<div class="gameplay-atlas-heading"><h3>合作副本</h3></div><div class="gameplay-atlas-sites"><button type="button" class="gameplay-atlas-node" data-atlas-coop><img src="/assets/training/layers/landscape-island-secret.webp" alt="" draggable="false"><span class="gameplay-atlas-name"><span>合作秘境</span></span><small>組隊挑戰</small></button></div>`;
  }
  const entries=globalThis.QAWeaponDungeons?.CATALOG||[];
  return `<div class="gameplay-atlas-heading"><h3>武器副本</h3><span>${entries.length} 座秘境開放</span></div>
    <div class="gameplay-atlas-sites">${entries.map(d=>`<button type="button" class="gameplay-atlas-node" data-atlas-dungeon="${esc(d.id)}" aria-label="選擇${esc(d.name)}">
      <img src="${atlasArt[d.id]||'/assets/training/layers/landscape-island-secret.webp'}" alt="" draggable="false">
      <span class="gameplay-atlas-name"><span>${esc(d.name)}</span></span>
      <small>${esc(d.subtitle)}</small></button>`).join('')}</div>
    <p class="gameplay-atlas-hint"><i class="fa-solid fa-compass" aria-hidden="true"></i> 選擇秘境，查看可挑戰的境界</p>`;
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
function mountAtlas(target){
  const shell=document.querySelector('#page-gameplay .gameplay-shell');
  if(!shell||atlas)return;
  atlas=document.createElement('section');atlas.id='gameplay-dungeon-atlas';atlas.className='gameplay-atlas';
  atlas.setAttribute('aria-label','副本選擇');shell.append(atlas);shell.dataset.atlasReady='true';
  atlas.addEventListener('click',event=>{
    if(!landscape())return;
    const node=event.target.closest('[data-atlas-dungeon]');
    if(node){void openWeaponDungeons(node.dataset.atlasDungeon,node);return;}
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
  if(page&&typeof MutationObserver==='function'){
    new MutationObserver(()=>{
      const next=page.classList.contains('active-page');
      if(!next&&active)hidePanel(false);
      if(next&&!active&&(!panel||panel.hidden))selectCategory('weapon');
      active=next;
    }).observe(page,{attributes:true,attributeFilter:['class']});
  }
  selectCategory('weapon');
}
function mount(){
  const target=document.querySelector('#page-gameplay .gameplay-entries');
  if(!target||document.getElementById('gameplay-weapon-dungeon-entry'))return;
  const button=document.createElement('button');button.type='button';button.id='gameplay-weapon-dungeon-entry';button.className='gameplay-dungeon-entry';
  button.innerHTML='<i class="fa-solid fa-mountain" aria-hidden="true"></i><span><strong>武器副本</strong><small>單人秘境 · 武器掉落 · 六階挑戰</small></span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i>';
  button.addEventListener('click',()=>{if(landscape()&&atlas)selectCategory('weapon');else void openWeaponDungeons();});target.append(button);
  mountAtlas(target);
}
window.openWeaponDungeons=openWeaponDungeons;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
export const featureReady=Promise.resolve();
