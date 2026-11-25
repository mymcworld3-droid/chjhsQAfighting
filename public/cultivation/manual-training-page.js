import './weapon-presentation.js';
import './daily-meditation-rewards.js';
import './manual-rules.js?v=20261125-native-main-cultivation-v1';
import {bookArt,skillArt} from './manual-art.js';
import {renderManualHero} from './manual-hero-view.js?v=20261125-stone-price-art-v1';
import {nextManualExpedition,renderManualExpedition} from './manual-expedition-guide.js';
import {renderManualLoadout,selectSkillForSlot} from './manual-loadout-view.js';
import './contextual-asset-preloader.js';
import {filterOwnedManuals,renderManualCollectionHeader,renderManualCollectionSummary} from './manual-library-view.js?v=20261125-native-main-cultivation-v1';
import {detectManualCelebration,renderManualCelebration} from './manual-celebration.js';
import {authenticatedMainFetch,getMainUser} from './data/project-repository.js';
import {reconnectDungeonRoom,leaveDungeonRoom} from './dungeon-room.js';

const Catalog=globalThis.QAManuals;
let root=null,current=null,busy=false,loadedFor='',renderedFor='',lastFetch=0,sequence=0,selectedLoadout=0,featuredBookId='',selectedSkillId=null,pickerSlot=null,libraryFilter='all',celebrationTimer=null;
let trainingDialogOpen=false,trainingDialogTrigger=null;
let toastTimer=null,pickerTrigger=null,collectionScroll=null;
let blockedDungeonEquip=null;
// Equipment changes are optimistic and serialized independently of other page actions.
let weaponServerState=null,weaponChangeQueue=[],weaponRequest=null,weaponEpoch=0,leavingDungeon=false;
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[ch]);
const label=school=>school==='sword'?'靈劍':'圖騰';
const visible=()=>!!root?.closest('#page-training.active-page:not(.hidden)');
function ensure(){
  const page=document.getElementById('page-training');
  if(!page)return null;
  page.classList.add('manual-training-active');
  page.classList.remove('training-scene-map-active');
  document.body.classList.remove('ns-map-active');
  if(root?.parentElement!==page){
    root=document.createElement('div');
    root.id='manual-training-root';root.className='manual-training';
    root.innerHTML='<div class="manual-loading">正在開啟兵器閣…</div>';
    page.append(root);
  }
  if(!document.getElementById('manual-training-style')){
    const link=document.createElement('link');link.rel='stylesheet';
    link.id='manual-training-style';link.href='/styles/manual-training.css?v=20261116-loadout-presets';
    document.head.append(link);
  }
  if(!document.getElementById('manual-training-hero-style')){
    const link=document.createElement('link');link.rel='stylesheet';
    link.id='manual-training-hero-style';
    link.href='/styles/manual-training-hero.css?v=20261118-merged-mastery-v1';
    document.head.append(link);
  }
  if(!document.getElementById('manual-training-loadout-style')){
    const link=document.createElement('link');link.rel='stylesheet';
    link.id='manual-training-loadout-style';
    link.href='/styles/manual-training-loadout.css?v=20261117-deck-phase2';
    document.head.append(link);
  }
  if(!document.getElementById('manual-training-library-style')){
    const link=document.createElement('link');link.rel='stylesheet';
    link.id='manual-training-library-style';
    link.href='/styles/manual-training-library.css?v=20261117-gallery-phase3';
    document.head.append(link);
  }
  if(!document.getElementById('manual-training-celebration-style')){
    const link=document.createElement('link');link.rel='stylesheet';
    link.id='manual-training-celebration-style';
    link.href='/styles/manual-training-celebration.css?v=20261117-rewards-phase4';
    document.head.append(link);
  }
  if(!document.getElementById('manual-training-growth-style')){
    const link=document.createElement('link');link.rel='stylesheet';
    link.id='manual-training-growth-style';
    link.href='/styles/manual-training-growth.css?v=20261118-three-nodes-v1';
    document.head.append(link);
  }
  if(!document.getElementById('manual-training-anticipation-style')){
    const link=document.createElement('link');link.rel='stylesheet';
    link.id='manual-training-anticipation-style';
    link.href='/styles/manual-anticipation.css?v=20261118-merged-mastery-v1';
    document.head.append(link);
  }
  if(!document.getElementById('manual-expedition-guide-style')){
    const link=document.createElement('link');link.rel='stylesheet';
    link.id='manual-expedition-guide-style';
    link.href='/styles/manual-expedition-guide.css?v=20261118-expedition-phase10-v1';
    document.head.append(link);
  }
  if(!document.getElementById('manual-training-streamlined-style')){
    const link=document.createElement('link');link.rel='stylesheet';
    link.id='manual-training-streamlined-style';
    link.href='/styles/manual-training-streamlined.css?v=20261118-level20-ranks-v1';
    document.head.append(link);
  }
  if(!document.getElementById('manual-training-weapons-style')){
    const link=document.createElement('link');link.rel='stylesheet';
    link.id='manual-training-weapons-style';
    link.href='/styles/manual-training-weapons.css?v=20261125-native-main-cultivation-v1';
    document.head.append(link);
  }
  if(!document.getElementById('manual-training-layout-style')){
    const link=document.createElement('link');link.rel='stylesheet';
    link.id='manual-training-layout-style';link.href='/styles/manual-training-layout.css?v=20261125-main-card-fill-async-gear-v2';
    document.head.append(link);
  }
  return root;
}
async function request(url,body){
  const response=await authenticatedMainFetch(url,{
    ...(body!==undefined?{method:'POST',body:JSON.stringify(body)}:{method:'GET'})
  });
  let result={};try{result=await response.json();}catch(_){}
  if(!response.ok||!result.ok)throw Error(result.error||'武器資料同步失敗');
  return result.state;
}
function equippedVersion(id,equipped=current?.loadouts?.[selectedLoadout]?.skillIds||[]){
  const move=Catalog.BY_SKILL[id]?.moveId;
  return equipped.find(other=>Catalog.BY_SKILL[other]?.moveId===move);
}
function skillDetails(id){
  const base=Catalog.BY_SKILL[id];
  return base&&current?.library.find(book=>book.id===base.manualId)?.skills.find(skill=>skill.id===id);
}
function featuredHeroMarkup(){
  const activeBook=current?.library?.find(book=>book.id===featuredBookId&&book.owned);
  if(activeBook&&selectedSkillId&&!activeBook.skills.some(skill=>skill.id===selectedSkillId))
    selectedSkillId=null;
  const serverAttack=Number(current?.battleAttack),localAttack=Number(window.getCombatStats?.()?.attack);
  const attack=Number.isFinite(serverAttack)&&serverAttack>0?serverAttack:
    Number.isFinite(localAttack)&&localAttack>0?localAttack:
      Math.max(1,Number(window.getCurrentUserData?.()?.stats?.attack)||200);
  const equipped=current?.loadouts?.[selectedLoadout]?.skillIds||[];
  const view=renderManualHero(current,featuredBookId,{
    esc,bookArt,skillArt,label,totalExpForLevel:Catalog.totalExpForLevel,
    selectedSkillId,descriptionWithDamage:Catalog.descriptionWithDamage,
    moveIdOf:id=>Catalog.BY_SKILL[id]?.moveId,equipped,attack
  });
  if(view.bookId!==featuredBookId)selectedSkillId=null;
  featuredBookId=view.bookId;
  return view.html;
}
// The weapon details are a real subpage inside the game, not a modal.
function scrollContainers(){
  return [...new Set([root?.parentElement,root?.closest?.('main')].filter(Boolean))];
}
function closeTrainingDialog({restoreFocus=true}={}){
  trainingDialogOpen=false;selectedSkillId=null;clearManualToast();clearManualCelebration();
  syncTrainingDialog();
  if(restoreFocus&&visible()){
    const trigger=trainingDialogTrigger?.isConnected?trainingDialogTrigger:
      [...(root?.querySelectorAll('[data-feature-book]')||[])]
        .find(button=>button.dataset.featureBook===featuredBookId);
    trigger?.focus({preventScroll:true});
  }
  trainingDialogTrigger=null;
  fitArmoryHeight();
}
function syncTrainingDialog(){
  const screen=root?.querySelector('[data-manual-training-screen]');
  if(!screen)trainingDialogOpen=false;
  const wasActive=!!root?.classList.contains('manual-detail-active');
  if(trainingDialogOpen&&!wasActive){
    collectionScroll=[...scrollContainers(),root.querySelector('.manual-book-grid')].filter(Boolean).map(node=>({node,top:node.scrollTop,left:node.scrollLeft}));
  }
  root?.classList.toggle('manual-detail-active',trainingDialogOpen);
  if(screen)screen.hidden=!trainingDialogOpen;
  if(trainingDialogOpen&&!wasActive){
    scrollContainers().forEach(node=>{node.scrollTop=0;node.scrollLeft=0;});
    const content=screen.querySelector?.('.manual-training-screen-body');
    if(content)content.scrollTop=0;
    screen.querySelector?.('[data-manual-close-training]')?.focus({preventScroll:true});
  }else if(!trainingDialogOpen&&wasActive){
    for(const entry of collectionScroll||[]){
      entry.node.scrollTop=entry.top;entry.node.scrollLeft=entry.left;
    }
    collectionScroll=null;
  }
}
function markup(){
  if(!current)return '<div class="manual-loading">正在讀取武器…</div><div class="manual-toast" data-manual-status role="status" aria-live="polite"></div>';
  const hero=featuredHeroMarkup();
  const expedition=renderManualExpedition(nextManualExpedition(current,featuredBookId,Catalog),{esc,bookArt});
  const owned=current.library?.some(book=>book.owned);
  const training=owned?`<section id="manual-training-screen" class="manual-training-screen" data-manual-training-screen aria-labelledby="manual-training-screen-title" ${trainingDialogOpen?'':'hidden'}>
    <header class="manual-training-screen-header">
      <button type="button" data-manual-close-training data-qy-nav-action="back" aria-label="返回武器收藏"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> 返回</button>
      <h2 id="manual-training-screen-title">${esc(current.library.find(book=>book.id===featuredBookId)?.name||'武器')} · 武器修煉</h2>
      <span class="manual-training-screen-spacer" aria-hidden="true"></span>
    </header>
    <div class="manual-training-screen-body">${hero}${expedition}
      </div><div class="manual-toast" data-manual-dialog-status role="status" aria-live="polite"></div></section>`:hero;
  const cards=filterOwnedManuals(current,libraryFilter).map(book=>
    `<article class="manual-book ${book.school==='sword'?'is-sword':'is-body'} ${book.id===featuredBookId?'is-featured':''}"
       data-manual-book="${esc(book.id)}">
       ${renderManualCollectionSummary(book,featuredBookId,current.weaponIds||[],{
         esc,bookArt,label,totalExpForLevel:Catalog.totalExpForLevel
       })}
    </article>`
  ).join('');
  return `
    <section class="manual-library" aria-label="武器收藏">
      ${renderManualCollectionHeader(current,libraryFilter,{esc})}
      <div class="manual-book-grid" role="region" aria-label="武器收藏，可左右滑動" tabindex="0">${cards||'<p class="manual-empty">尚無此流派已取得的武器，請切換篩選查看。</p>'}</div>
    </section>
    ${training}
    <div class="manual-toast" data-manual-status role="status" aria-live="polite"></div>
    ${renderManualLoadout(current,selectedLoadout,pickerSlot,{
      esc,bookArt,skillArt,moveIdOf:id=>Catalog.BY_SKILL[id]?.moveId
    })}
    ${blockedDungeonEquip?'<div class="manual-dungeon-equipment-lock" role="alert"><p>你仍在進行中的多人副本隊伍，需先離開本次副本才能更換武器。其他隊員的進度不受影響。</p><button type="button" data-manual-leave-dungeon-for-gear>離開本次副本並完成剛才的換裝</button></div>':''}
    <div class="manual-celebration-host" data-manual-celebration-host></div>`;

}
// Reconcile the existing page instead of recreating every image on each
// save/upgrade. In particular, leave an unchanged <img src> untouched.
function reconcile(parent,template){
  const key=node=>node?.nodeType===1?node.getAttribute('data-manual-book'):null;
  const compatible=(a,b)=>a&&a.nodeType===b.nodeType&&a.nodeName===b.nodeName&&key(a)===key(b);
  function update(oldNode,newNode){
    if(oldNode.nodeType===3||oldNode.nodeType===8){
      if(oldNode.nodeValue!==newNode.nodeValue)oldNode.nodeValue=newNode.nodeValue;
      return;
    }
    if(oldNode.nodeType!==1)return;
    for(const attr of [...oldNode.attributes]){
      if(['DETAILS','DIALOG'].includes(oldNode.nodeName)&&attr.name==='open')continue;
      if(!newNode.hasAttribute(attr.name))oldNode.removeAttribute(attr.name);
    }
    for(const attr of [...newNode.attributes]){
      if(['DETAILS','DIALOG'].includes(oldNode.nodeName)&&attr.name==='open')continue;
      if(oldNode.getAttribute(attr.name)!==attr.value)oldNode.setAttribute(attr.name,attr.value);
    }
    if(oldNode.nodeName==='INPUT'&&document.activeElement!==oldNode&&oldNode.value!==newNode.value)oldNode.value=newNode.value;
    reconcile(oldNode,newNode);
  }
  let index=0;
  for(const next of [...template.childNodes]){
    let existing=parent.childNodes[index],wanted=key(next);
    if(wanted&&key(existing)!==wanted){
      const match=[...parent.childNodes].slice(index+1).find(node=>key(node)===wanted);
      if(match){parent.insertBefore(match,existing||null);existing=match;}
      else{parent.insertBefore(next.cloneNode(true),existing||null);index++;continue;}
    }
    if(!existing){parent.appendChild(next.cloneNode(true));}
    else if(key(existing)&&!wanted){parent.insertBefore(next.cloneNode(true),existing);}
    else if(!compatible(existing,next)){existing.replaceWith(next.cloneNode(true));}
    else update(existing,next);
    index++;
  }
  while(parent.childNodes.length>index)parent.lastChild.remove();
}
function clearManualCelebration(){
  if(celebrationTimer!==null)clearTimeout(celebrationTimer);
  celebrationTimer=null;
  root?.querySelector('[data-manual-celebration-host]')?.replaceChildren();
}
function showManualCelebration(reward){
  if(!reward||!visible())return;
  const host=root?.querySelector('[data-manual-celebration-host]');
  if(!host)return;
  const account=getMainUser()?.uid;
  if(!globalThis.QARewardPresentation.celebrateEvent({uid:account,receiptId:JSON.stringify(['weapon-growth',reward.kind,reward.bookId,reward.skillId||'',reward.level||1]),sound:false,isCurrent:()=>getMainUser()?.uid===account&&visible()}))return;
  clearManualCelebration();
  // Reward overlay stays in the shared page layer, above both subpages.
  if(host.parentElement!==root)root.append(host);
  host.innerHTML=renderManualCelebration(reward,{
    esc,bookArt,skillArt,findSkill:skillDetails
  });
  const sound=reward.kind==='unlock'||reward.kind==='discovery'?'grand-reveal':'spirit-pulse';
  try{globalThis.QAGameAudio?.play(sound,{volume:.70});}catch(_){}
  const duration=reward.kind==='discovery'?3700:reward.kind==='unlock'?2700:1700;
  celebrationTimer=setTimeout(()=>{host.replaceChildren();celebrationTimer=null;},duration);
}
function tutorialManualEvent(kind,details={}){
  const uid=getMainUser()?.uid;
  if(uid)window.dispatchEvent(new CustomEvent('qingyun:tactical-tutorial',{detail:{uid,kind,...details}}));
}
function clearManualToast(){
  if(toastTimer!==null)clearTimeout(toastTimer);toastTimer=null;
  root?.querySelectorAll('[data-manual-status],[data-manual-dialog-status]')?.forEach(node=>{node.textContent='';node.classList.remove('is-error','is-pending');});
}
function showManualToast(message,kind=''){
  clearManualToast();
  if(!message||!visible())return;
  const target=root?.querySelector(trainingDialogOpen?'[data-manual-dialog-status]':'[data-manual-status]');
  if(!target)return;
  if(kind)target.classList.add('is-'+kind);
  target.textContent=String(message);
  if(kind!=='pending')toastTimer=setTimeout(clearManualToast,3200);
}
function closeManualPicker({restoreFocus=true}={}){
  const dialog=root?.querySelector('[data-manual-weapon-dialog]');
  if(dialog?.open)dialog.close();
  pickerSlot=null;
  if(restoreFocus&&pickerTrigger?.isConnected)pickerTrigger.focus({preventScroll:true});
  pickerTrigger=null;
}
function syncManualPicker(){
  const dialog=root?.querySelector('[data-manual-weapon-dialog]');
  if(!dialog)return;
  dialog.oncancel=event=>{event.preventDefault();closeManualPicker();paint();};
  if(pickerSlot!==null&&!dialog.open)dialog.showModal();
}
// Measure the scrollable main stage, not the page's current scroll position.
 // The shelf grows to the available bottom edge without stretching its cards.
function fitArmoryHeight(){
  const main=root?.closest?.('main');
  if(!main||!visible()||root.classList.contains('manual-detail-active')||
    typeof window.getComputedStyle!=='function'||!main.getBoundingClientRect)return;
  const mainStyle=window.getComputedStyle(main),pageStyle=window.getComputedStyle(root.parentElement);
  const offset=root.getBoundingClientRect().top-main.getBoundingClientRect().top+main.scrollTop;
  const available=main.clientHeight-(parseFloat(mainStyle.paddingBottom)||0)-
    (parseFloat(pageStyle.paddingBottom)||0)-offset-2;
  if(Number.isFinite(available))root.style.setProperty('--mt-fill-height',Math.max(0,Math.floor(available))+'px');
}
function paint(message='',{kind=''}={}){
  ensure();if(!root)return;
  const template=document.createElement('template');template.innerHTML=markup();
  if(renderedFor&&renderedFor!==loadedFor)root.replaceChildren(template.content.cloneNode(true));
  else reconcile(root,template.content);
  renderedFor=loadedFor;
  syncTrainingDialog();
  syncManualPicker();
  fitArmoryHeight();
  if(message)showManualToast(message,kind);
  // An existing starter skill may already be equipped by the server.
  // The optional completion action always rechecks authoritative manual state.
  if(window.firstAnswerGuideStep?.(loadedFor)===12&&current?.equipped?.length){
    const picker=root.querySelector('[data-manual-picker]');
    if(picker&&!picker.querySelector('[data-manual-guide-finish]')){
      const button=document.createElement('button');
      button.type='button';button.className='manual-picker-close';
      button.setAttribute('data-manual-guide-finish','');
      button.textContent='確認已裝備技能，完成教學';
      picker.append(button);
    }
  }
  root.querySelectorAll('button').forEach(button=>{
    if(busy&&!button.hasAttribute('data-manual-close-training'))button.disabled=true;
  });
}
async function load({force=false}={}){
  if(busy)return;
  if(visible())window.prefetchXiuxianContext?.('manuals');
  ensure();const uid=getMainUser()?.uid;
  if(!uid){resetWeaponChanges();closeTrainingDialog({restoreFocus:false});clearManualCelebration();current=null;loadedFor='';paint('請先登入後查看武器。');return;}
  if(!force&&loadedFor===uid&&Date.now()-lastFetch<15000){paint();return;}
  const token=++sequence;lastFetch=Date.now();
  try{
    const result=await request('/api/tactical/manuals');
    if(token!==sequence||getMainUser()?.uid!==uid)return;
    const before=loadedFor===uid?current:null;
    const reward=detectManualCelebration(before,result,{kind:'sync'});
    if(loadedFor!==uid){resetWeaponChanges();closeTrainingDialog({restoreFocus:false});selectedLoadout=result.activeLoadout||0;featuredBookId='';selectedSkillId=null;pickerSlot=null;libraryFilter='all';blockedDungeonEquip=null;}
    if(weaponRequest||weaponChangeQueue.length)return;
    weaponServerState=result;current=result;loadedFor=uid;
    window.setCurrentTacticalManualState?.(result,uid);
    paint();
    // Only artwork for owned, currently browsable weapons is warmed;
    // unowned manuals and unrelated skill icons are never requested here.
    if(visible())void globalThis.QAContextualAssets?.warmImages(
      globalThis.QAContextualAssets.manualImages(result),{max:3});
    showManualCelebration(reward);
  }catch(error){
    if(token!==sequence)return;
    paint(error.message,{kind:'error'});
  }
}

function resetWeaponChanges(){
  ++weaponEpoch;weaponRequest=null;weaponChangeQueue=[];weaponServerState=null;
  blockedDungeonEquip=null;leavingDungeon=false;
}
function projectWeaponChoices(base,changes){
  if(!Array.isArray(base?.weaponIds)||!changes?.length)return base;
  const weaponIds=[...base.weaponIds];
  for(const change of changes)weaponIds[change.index]=change.weaponId;
  const books=new Map((base.library||[]).filter(book=>book.owned).map(book=>[book.id,book]));
  const loadouts=weaponIds.map((id,index)=>{
    const book=books.get(id);
    return {...(base.loadouts?.[index]||{}),weaponId:id,
      name:book?.name||'空白武器槽',
      skillIds:book?.skills?.filter(skill=>skill.unlocked).map(skill=>skill.id)||[]};
  });
  return {...base,weaponIds,loadouts,activeLoadout:0,
    equipped:loadouts.flatMap(slot=>slot.skillIds),
    library:Catalog.sortedOwnedWeapons(base.library,weaponIds)};
}
function withPendingWeaponChoices(serverState,includeCurrent=true){
  const ops=[...(includeCurrent&&weaponRequest?[weaponRequest]:[]),...weaponChangeQueue];
  return projectWeaponChoices(serverState,ops);
}
function changeWeaponInBackground(index,weaponId){
  const uid=getMainUser()?.uid;
  if(!uid||!Number.isInteger(index)||index<0||index>=2||!Array.isArray(current?.weaponIds))return;
  if(weaponId!==null&&!current.library?.some(book=>book.owned&&book.id===weaponId))return;
  if(weaponId!==null&&current.weaponIds.some((id,i)=>i!==index&&id===weaponId))return;
  if(current.weaponIds[index]===weaponId)return;
  if(!weaponServerState)weaponServerState=current;
  weaponChangeQueue=weaponChangeQueue.filter(change=>change.index!==index);
  weaponChangeQueue.push({uid,index,weaponId,epoch:weaponEpoch});
  current=withPendingWeaponChoices(weaponServerState);
  blockedDungeonEquip=null;selectedLoadout=index;
  ++sequence;lastFetch=Date.now();
  // A local state change is immediate; saving never enters the page-wide busy state.
  paint();
  void sendQueuedWeaponChanges();
}
async function sendQueuedWeaponChanges(){
  if(weaponRequest||!weaponChangeQueue.length)return;
  const job=weaponChangeQueue.shift();
  if(job.uid!==getMainUser()?.uid||job.epoch!==weaponEpoch)return;
  weaponRequest=job;
  let failure='';
  try{
    const state=await request('/api/tactical/manuals/loadout',{index:job.index,weaponId:job.weaponId});
    if(job!==weaponRequest||job.epoch!==weaponEpoch||getMainUser()?.uid!==job.uid)return;
    weaponServerState=state;loadedFor=job.uid;lastFetch=Date.now();blockedDungeonEquip=null;
    window.setCurrentTacticalManualState?.(state,job.uid);
    window.dispatchEvent(new CustomEvent('xiuxian:manual-loadout-updated',{detail:{equipped:state.equipped}}));
  }catch(error){
    if(job!==weaponRequest||job.epoch!==weaponEpoch||getMainUser()?.uid!==job.uid)return;
    failure=error.message||'武器同步失敗';
    if(failure.includes('多人副本進行中')&&!weaponChangeQueue.some(change=>change.index===job.index))
      blockedDungeonEquip={index:job.index,weaponId:job.weaponId};
  }finally{
    if(job!==weaponRequest)return;
    weaponRequest=null;
    ++sequence; // An older GET must never overwrite a newly saved loadout.
    current=withPendingWeaponChoices(weaponServerState||current);
    if(getMainUser()?.uid===job.uid){
      paint();
      if(failure)showManualToast(failure,'error'); // Errors only, never a saving popup.
    }
    if(weaponChangeQueue.length)void sendQueuedWeaponChanges();
  }
}
async function mutate(url,body){
  if(url.endsWith('/loadout')&&Object.hasOwn(body||{},'weaponId')){
    changeWeaponInBackground(body.index,body.weaponId);return;
  }
  if(busy)return;
  const uid=getMainUser()?.uid;if(!uid)return;
  const upgrading=url.endsWith('/upgrade');
  if(upgrading){
    const before=current;
    const message='確定升級至 Lv. '+body.targetLevel+'？\n將消耗 '+Number(body.expectedGold).toLocaleString('zh-TW')+' 靈石。';
    const confirmed=window.QADialogs?.confirmAction?await window.QADialogs.confirmAction(message,{title:'確認升級',confirmLabel:'確認升級',isCurrent:()=>getMainUser()?.uid===uid&&current===before&&!busy&&visible()}):typeof window.openConfirm==='function'?await window.openConfirm(message):window.confirm(message);
    if(!confirmed||busy||getMainUser()?.uid!==uid||current!==before||!visible())return;
  }
  ++sequence;busy=true;
  const pendingText=body.skillId?'正在升級招式…':upgrading?'正在升級武器…':'';
  paint(pendingText,pendingText?{kind:'pending'}:{});
  let message='',successful=false,reward=null;
  const equippedSlot=pickerSlot;
  try{
    const before=current;
    const next=await request(url,body);
    if(getMainUser()?.uid!==uid)return;
    reward=detectManualCelebration(before,next,{
      kind:url.endsWith('/school')?'school':upgrading?'upgrade':'loadout',
      bookId:body?.bookId,skillId:body?.skillId
    });
    weaponServerState=next;
    current=withPendingWeaponChoices(next);loadedFor=uid;lastFetch=Date.now();successful=true;
    if(Object.hasOwn(body||{},'weaponId'))blockedDungeonEquip=null;
    if(url.endsWith('/school')){featuredBookId='';selectedSkillId=null;pickerSlot=null;}
    if(url.endsWith('/loadout')&&Array.isArray(body?.skillIds))pickerSlot=null;
    window.setCurrentTacticalManualState?.(next,uid);
    if(upgrading){
      const local=window.getCurrentUserData?.();
      if(local){local.stats||={};local.stats.gold=next.gold;window.updateUIStats?.();}
      const skill=body.skillId&&skillDetails(body.skillId);
      const target=body.bookId&&next.library.find(book=>book.id===body.bookId);
      message=!reward?'武器資料已同步，等級沒有變更。':
        skill?`「${skill.name}」已升至 Lv. ${skill.level}。`:
        `已升級《${target?.name||'武器'}》。`;
    }else{
      message=url.endsWith('/school')?'武器流派已切換。':
        Object.hasOwn(body||{},'weaponId')?'武器裝備已儲存。':'武器配置已儲存。';
      window.dispatchEvent(new CustomEvent('xiuxian:manual-loadout-updated',{detail:{equipped:next.equipped}}));
      if(url.endsWith('/loadout')&&Array.isArray(body?.skillIds)&&body.skillIds.length&&
        selectedLoadout===next.activeLoadout&&body.skillIds.every(id=>next.equipped.includes(id)))
        tutorialManualEvent('skill-equipped',{verified:true,skillIds:[...next.equipped]});
    }
  }catch(error){
    message=error.message;
    if(Object.hasOwn(body||{},'weaponId')&&message.includes('多人副本進行中'))
      blockedDungeonEquip={index:body.index,weaponId:body.weaponId};
  }
  finally{
    busy=false;
    if(getMainUser()?.uid===uid){
      paint(message,{kind:successful?'':'error'});
      if(successful)showManualCelebration(reward);
      if(successful&&url.endsWith('/loadout')&&Array.isArray(body?.skillIds)
        &&Number.isInteger(equippedSlot)&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
        const card=root?.querySelector('[data-manual-slot="'+equippedSlot+'"]');
        card?.animate?.([
          {boxShadow:'0 0 0 0 rgba(236,203,130,0)'},
          {boxShadow:'0 0 0 2px rgba(236,203,130,.72),0 0 20px rgba(236,203,130,.32)',offset:.45},
          {boxShadow:'0 0 0 0 rgba(236,203,130,0)'}
        ],{duration:620,easing:'ease-out'});
      }
    } else if(visible())void load({force:true});
  }
}
async function leaveDungeonAndRetryEquipment(){
  if(leavingDungeon||!blockedDungeonEquip)return;
  const uid=getMainUser()?.uid;if(!uid)return;
  const pending={...blockedDungeonEquip};
  leavingDungeon=true;
  try{
    const session=await reconnectDungeonRoom();
    if(getMainUser()?.uid!==uid)return;
    if(session.roomId&&session.room?.status==='assembled')
      await leaveDungeonRoom(session.roomId);
    if(getMainUser()?.uid!==uid)return;
    blockedDungeonEquip=null;
    changeWeaponInBackground(pending.index,pending.weaponId);
  }catch(error){
    if(getMainUser()?.uid===uid)showManualToast('離開副本失敗：'+error.message,'error');
  }finally{leavingDungeon=false;}
}
function ensureNav(){
  const parent=document.getElementById('nav-grid');
  if(!parent)return;
  let nav=document.getElementById('nav-training');
  if(!nav){
    nav=document.createElement('button');
    nav.id='nav-training';nav.type='button';nav.dataset.target='page-training';
    nav.className='nav-btn training-nav-btn group flex-1 flex flex-col items-center justify-center h-full transition-all';
    nav.innerHTML='<div class="relative p-1 training-nav-orb"><i class="fa-solid fa-book-open text-lg"></i></div><span class="text-[10px] mt-1">修煉</span>';
    const home=parent.querySelector('[data-target="page-home"]');
    if(home)home.insertAdjacentElement('afterend',nav);else parent.appendChild(nav);
    nav.addEventListener('click',()=>window.switchToPage?.('page-training'));
  }
  delete nav.dataset.foundationTraining;
  nav.hidden=false;nav.disabled=false;
  nav.classList.remove('hidden','is-locked');
  nav.setAttribute('aria-label','武器修煉');
  document.body.classList.add('cultivation-training-unlocked');
}
function boot(){
  ensureNav();
  ensure();
  const trainingPage=document.getElementById('page-training');
  if(trainingPage)new MutationObserver(()=>{
    if(!visible()){
      if(trainingDialogOpen)closeTrainingDialog({restoreFocus:false});
      if(pickerSlot!==null){closeManualPicker({restoreFocus:false});paint();}
    }else fitArmoryHeight();
  }).observe(trainingPage,{attributes:true,attributeFilter:['class','hidden']});
  root?.addEventListener('click',event=>{
    if(event.target.closest('[data-manual-close-training]')){closeTrainingDialog();return;}
    const weaponDialog=root?.querySelector('[data-manual-weapon-dialog]');
    if(event.target===weaponDialog){const rect=weaponDialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom){closeManualPicker();paint();return;}}
    if(event.target.closest('[data-manual-celebration-dismiss]')){
      clearManualCelebration();return;
    }
    if(busy)return;
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-manual-leave-dungeon-for-gear')){
      void leaveDungeonAndRetryEquipment();return;
    }
    if(button.hasAttribute('data-manual-guide-finish')){
      const uid=getMainUser()?.uid;
      if(window.firstAnswerGuideStep?.(uid)!==12)return;
      button.disabled=true;
      void request('/api/tactical/manuals').then(server=>{
        if(getMainUser()?.uid!==uid)return;
        if(!Array.isArray(server?.equipped)||!server.equipped.length){
          paint('目前尚未裝備技能，請先從招式清單選擇。');return;
        }
        current=server;loadedFor=uid;
        tutorialManualEvent('skill-equipped',{verified:true,skillIds:[...server.equipped]});
        paint();
      }).catch(error=>{if(getMainUser()?.uid===uid)paint(error.message);});
      return;
    }
    if(button.dataset.manualExpeditionAction){
      const guide=nextManualExpedition(current,featuredBookId,Catalog);
      if(!guide||guide.bookId!==button.dataset.manualExpeditionId)return;
      if(guide.action==='battle'){
        closeTrainingDialog({restoreFocus:false});
        const start=window.openTacticalCombat||window.startQuizFlow;
        if(typeof start!=='function'){
          paint('戰場尚未準備完成，請從宗門的「問道試煉」入口進入。');
          return;
        }
        try{
          Promise.resolve(start('pve')).catch(error=>{
            if(visible())paint(error?.message||'無法進入問道試煉，請稍後重試。');
          });
        }catch(error){paint(error?.message||'無法進入問道試煉，請稍後重試。');}
      }else if(guide.action==='loadout'){
        closeTrainingDialog({restoreFocus:false});
        selectedLoadout=guide.activeLoadout;
        pickerSlot=null;paint();
        requestAnimationFrame(()=>root?.querySelector('.manual-loadout')?.scrollIntoView({
          behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',
          block:'start'
        }));
      }else{
        requestAnimationFrame(()=>root?.querySelector('.manual-hero-path')?.scrollIntoView({
          behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',
          block:'nearest'
        }));
      }
      return;
    }
    if(button.dataset.featureBook){
      if(current?.library.some(book=>book.owned&&book.id===button.dataset.featureBook)){
        featuredBookId=button.dataset.featureBook;
        selectedSkillId=null;
        clearManualToast();
        if(!trainingDialogOpen)trainingDialogTrigger=button;
        trainingDialogOpen=true;
        paint();
      }
      return;
    }
    if(button.dataset.manualBrowseWeapon){
      const books=filterOwnedManuals(current),at=books.findIndex(b=>b.id===featuredBookId);
      if(at<0||books.length<2)return;
      const next=books[(at+(button.dataset.manualBrowseWeapon==='prev'?-1:1)+books.length)%books.length];
      featuredBookId=next.id;selectedSkillId=null;
      paint();return;
    }
    if(button.dataset.manualCollectionFilter){
      const filter=button.dataset.manualCollectionFilter;
      if(['all','sword','body'].includes(filter)){
        libraryFilter=filter;
        paint();root?.querySelector('.manual-book-grid')?.scrollTo?.({left:0,behavior:'auto'});
      }
      return;
    }
    if(button.dataset.manualJumpSkill){
      const skillId=button.dataset.manualJumpSkill;
      const book=current?.library?.find(item=>item.owned&&item.id===featuredBookId);
      if(!book?.skills.some(skill=>skill.id===skillId))return;
      selectedSkillId=selectedSkillId===skillId?null:skillId;
      paint();

      return;
    }
    if(button.hasAttribute('data-manual-close-skill')){
      const closingSkill=selectedSkillId;selectedSkillId=null;paint();
      [...root.querySelectorAll('[data-manual-jump-skill]')]
        .find(node=>node.dataset.manualJumpSkill===closingSkill)?.focus({preventScroll:true});
      return;
    }
    if(button.hasAttribute('data-manual-close-picker')){closeManualPicker();paint();return;}
    if(button.dataset.manualPickSlot!==undefined||button.dataset.manualChangeSlot!==undefined){
      const slot=Number(button.dataset.manualPickSlot??button.dataset.manualChangeSlot);
      if(Number.isInteger(slot)&&slot>=0&&slot<=2&&current){
        if(Array.isArray(current.weaponIds)){
          if(slot>=2)return;
          selectedLoadout=slot;pickerTrigger=button;pickerSlot=slot;
          paint();return;
        }
        const filled=current.loadouts?.[selectedLoadout]?.skillIds?.length||0;
        const targetSlot=Math.min(slot,filled);
        pickerSlot=pickerSlot===targetSlot?null:targetSlot;
        paint();
        if(pickerSlot!==null){
          tutorialManualEvent('slot-opened');
          if(window.firstAnswerGuideStep?.(getMainUser()?.uid)===12)paint();
          requestAnimationFrame(()=>{
            root?.querySelector('[data-manual-picker]')?.scrollIntoView({
              behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',
              block:'nearest'
            });
          });
        }
      }
      return;
    }
    if(button.dataset.manualPickWeapon){
      const weaponId=button.dataset.manualPickWeapon;
      const slot=Number(button.dataset.manualTargetSlot);
      if(!Number.isInteger(slot)||slot<0||slot>=2||
        !current?.library?.some(book=>book.owned&&book.id===weaponId))return;
      if(current.weaponIds?.includes(weaponId)){
        closeManualPicker();paint();return;
      }
      selectedLoadout=slot;closeManualPicker();
      void mutate('/api/tactical/manuals/loadout',{index:slot,weaponId});
      return;
    }
    if(button.dataset.manualRemoveWeapon!==undefined){
      const slot=Number(button.dataset.manualRemoveWeapon);
      if(Number.isInteger(slot)&&slot>=0&&slot<2){
        pickerSlot=null;
        void mutate('/api/tactical/manuals/loadout',{index:slot,weaponId:null});
      }
      return;
    }
    if(button.dataset.manualPickSkill!==undefined){
      const id=button.dataset.manualPickSkill;
      if(!Number.isInteger(pickerSlot)||!current)return;
      const allowed=current.library.some(book=>book.owned&&book.skills.some(skill=>skill.id===id&&skill.unlocked));
      if(!allowed){paint('招式尚未解鎖，請重新整理武器資料。');return;}
      const equipped=current.loadouts?.[selectedLoadout]?.skillIds||[];
      const skillIds=selectSkillForSlot(equipped,pickerSlot,id,
        skillId=>Catalog.BY_SKILL[skillId]?.moveId);
      if(!skillIds){paint('無法裝備此招式，請確認武器裝備。');return;}
      if(skillIds.join('\u001f')===equipped.join('\u001f')){pickerSlot=null;paint();return;}
      void mutate('/api/tactical/manuals/loadout',{index:selectedLoadout,skillIds});
      return;
    }
    if(button.dataset.loadoutSelect!==undefined){
      const index=Number(button.dataset.loadoutSelect);
      if(Number.isInteger(index)&&index>=0&&index<(current?.loadouts?.length||0)){
        selectedLoadout=index;pickerSlot=null;paint();
      }
      return;
    }
    if(button.hasAttribute('data-loadout-rename')){void mutate('/api/tactical/manuals/loadout',{index:selectedLoadout,name:root.querySelector('[data-loadout-name]')?.value||''});return;}
    if(button.hasAttribute('data-loadout-apply')){
      const slot=button.hasAttribute('data-loadout-slot')?Number(button.dataset.loadoutSlot):selectedLoadout;
      if(!Number.isInteger(slot)||slot<0||slot>2)return;
      selectedLoadout=slot;
      void mutate('/api/tactical/manuals/loadout',{index:slot,apply:true});return;
    }
    if(button.hasAttribute('data-manual-refresh')){void load({force:true});return;}
    if(button.dataset.manualSchool){void mutate('/api/tactical/manuals/school',{school:button.dataset.manualSchool});return;}
    if(button.dataset.manualUpgrade){
      const book=current?.library.find(item=>item.id===button.dataset.manualUpgrade);
      if(book?.upgrade)void mutate('/api/tactical/manuals/upgrade',{
        bookId:book.id,targetLevel:book.upgrade.targetLevel,expectedGold:book.upgrade.gold
      });
      return;
    }
    if(button.dataset.skillUpgrade){
      const skill=skillDetails(button.dataset.skillUpgrade);
      if(skill?.upgrade)void mutate('/api/tactical/manuals/skills/upgrade',{
        skillId:skill.id,targetLevel:skill.upgrade.targetLevel,expectedGold:skill.upgrade.gold
      });
      return;
    }
    if(button.dataset.manualEquip){
      const id=button.dataset.manualEquip;
      if(Array.isArray(current?.weaponIds)){
        const weaponId=Catalog.BY_SKILL[id]?.manualId;
        if(!weaponId)return;
        const existing=current.weaponIds.indexOf(weaponId);
        if(existing>=0){selectedLoadout=existing;pickerSlot=null;paint();return;}
        const empty=current.weaponIds.findIndex(item=>!item);
        const slot=empty>=0?empty:Math.min(1,selectedLoadout);
        void mutate('/api/tactical/manuals/loadout',{index:slot,weaponId});
        return;
      }
      const equipped=current?.loadouts?.[selectedLoadout]?.skillIds||[],other=equippedVersion(id,equipped);
      const skillIds=other?equipped.map(slot=>slot===other?id:slot):[...equipped,id];
      void mutate('/api/tactical/manuals/loadout',{index:selectedLoadout,skillIds});return;
    }
    if(button.dataset.manualRemove){void mutate('/api/tactical/manuals/loadout',
      {index:selectedLoadout,skillIds:(current?.loadouts?.[selectedLoadout]?.skillIds||[]).filter(id=>id!==button.dataset.manualRemove)});}
  });
  document.addEventListener('click',event=>{
    if(event.target.closest('#nav-training,[data-target="page-training"]')){
      if(trainingDialogOpen)closeTrainingDialog({restoreFocus:false});
      setTimeout(()=>void load({force:true}),0);
    }
  },true);
  window.addEventListener('xiuxian:user-data-ready',()=>{ensureNav();const uid=getMainUser()?.uid||'';if(uid!==loadedFor){resetWeaponChanges();closeTrainingDialog({restoreFocus:false});clearManualCelebration();current=null;loadedFor='';featuredBookId='';selectedSkillId=null;pickerSlot=null;libraryFilter='all';}if(visible())void load({force:true});});
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||!visible()||root?.querySelector('[data-manual-weapon-dialog]')?.open)return;
    if(trainingDialogOpen){
      event.preventDefault();
      if(!selectedSkillId||busy){closeTrainingDialog();return;}
    }
    if(root?.querySelector('[data-manual-celebration-host]')?.firstChild){
      clearManualCelebration();return;
    }
    if(selectedSkillId&&visible()&&!busy){
      const closingSkill=selectedSkillId;
      selectedSkillId=null;paint();
      const button=[...root.querySelectorAll('[data-manual-jump-skill]')]
        .find(node=>node.dataset.manualJumpSkill===closingSkill);
      button?.focus({preventScroll:true});
    }
  });
  window.addEventListener('xiuxian:manual-loot',()=>{if(visible())void load({force:true});});
  window.addEventListener('xiuxian:manual-battle-settled',event=>{
    if(event.detail?.uid!==getMainUser()?.uid)return;
    // The battle view may switch pages after closing its result overlay.
    // Refresh after navigation rather than rendering stale pre-battle mastery.
    setTimeout(()=>{if(visible())void load({force:true});},0);
  });
  window.addEventListener('resize',fitArmoryHeight,{passive:true});
  window.visualViewport?.addEventListener?.('resize',fitArmoryHeight,{passive:true});
  if(typeof ResizeObserver!=='undefined'){
    const main=root?.closest?.('main');if(main)new ResizeObserver(fitArmoryHeight).observe(main);
  }
  if(visible())void load({force:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();
export const featureReady=Promise.resolve();
