import './manual-rules.js?v=20261116-loadout-presets-v1';
import {bookArt,skillArt} from './manual-art.js';
import {renderManualHero} from './manual-hero-view.js';
import {renderManualLoadout,selectSkillForSlot} from './manual-loadout-view.js';
import {filterOwnedManuals,renderManualCollectionHeader,renderManualCollectionSummary} from './manual-library-view.js';
import {authenticatedMainFetch,getMainUser} from './data/project-repository.js';

const Catalog=globalThis.QAManuals;
let root=null,current=null,busy=false,loadedFor='',renderedFor='',lastFetch=0,sequence=0,selectedLoadout=0,featuredBookId='',pickerSlot=null,libraryFilter='all';
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[ch]);
const label=school=>school==='sword'?'劍修':'體修';
const artImg=(src,klass)=>src?`<img class="${klass}" src="${esc(src)}" alt="" loading="lazy" decoding="async">`:``;
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
    root.innerHTML='<div class="manual-loading">正在開啟功法閣…</div>';
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
    link.href='/styles/manual-training-hero.css?v=20261117-hero-phase1';
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
  return root;
}
async function request(url,body){
  const response=await authenticatedMainFetch(url,{
    ...(body!==undefined?{method:'POST',body:JSON.stringify(body)}:{method:'GET'})
  });
  let result={};try{result=await response.json();}catch(_){}
  if(!response.ok||!result.ok)throw Error(result.error||'功法資料同步失敗');
  return result.state;
}
function equippedVersion(id,equipped=current?.loadouts?.[selectedLoadout]?.skillIds||[]){
  const move=Catalog.BY_SKILL[id]?.moveId;
  return equipped.find(other=>Catalog.BY_SKILL[other]?.moveId===move);
}
function equipDisabled(id,equipped=current?.equipped||[]){
  const other=equippedVersion(id,equipped);
  return other===id||(!other&&equipped.length>=3);
}
function skillDetails(id){
  const base=Catalog.BY_SKILL[id];
  return base&&current?.library.find(book=>book.id===base.manualId)?.skills.find(skill=>skill.id===id);
}
function featuredHeroMarkup(){
  const view=renderManualHero(current,featuredBookId,{esc,bookArt,skillArt,label});
  featuredBookId=view.bookId;
  return view.html;
}
function markup(expandedBooks){
  if(!current)return '<div class="manual-loading">正在讀取功法…</div>';
  const hero=featuredHeroMarkup();
  const owned=current.library.filter(item=>item.owned).length;
  const equipped=current.loadouts?.[selectedLoadout]?.skillIds||[];
  const gold=Number(current.gold)||0;
  const tactical=window.getCombatPower?.();
  const rating=tactical?.mode==='tactical'?tactical:null;
  const fmt=value=>Math.max(0,Math.round(Number(value)||0)).toLocaleString('zh-TW');
  const serverAttack=Number(current.battleAttack);
  const projectedAttack=Number(window.getCombatStats?.()?.attack);
  // An authenticated manual response contains the attack used by the PvE
  // combat server. Do not silently show an inaccurate client-only estimate.
  const attack=Number.isFinite(serverAttack)&&serverAttack>0?serverAttack:
    Number.isFinite(projectedAttack)&&projectedAttack>0?projectedAttack:
      Math.max(1,Number(window.getCurrentUserData?.()?.stats?.attack)||200);
  const cards=filterOwnedManuals(current,libraryFilter).map(book=>{
    const next=book.skills.find(s=>!s.unlocked);
    const skills=book.skills.map((skill,i)=>{
      const other=equippedVersion(skill.id,equipped);
      const {unlocked,upgrade}=skill;
      const bonus=skill.kind==='fist-focus'?'每級少 1 體力':'每級 +10% 基礎傷害';
      const requirements=[
        !skill.mastered?'功法 Lv. '+skill.levelRequired:null,
        !skill.realmReady?'修士 '+skill.realmName+'境':null
      ].filter(Boolean);
      return `<div class="manual-technique ${unlocked?'':'is-locked'}" data-manual-skill="${esc(skill.id)}">
        <div class="manual-technique-overview">${artImg(skillArt(skill),"manual-skill-art")}<div class="manual-technique-copy">
        <div class="manual-technique-heading"><b>${i+1}. ${esc(skill.name)}${unlocked?` <span>Lv. ${skill.level}</span>`:''}</b>
          <small>${skill.cost} 體力 · ${skill.unlimited?'無固定射程':skill.range+' 格'} · ${skill.realmName}境</small></div>
        <p>${esc(Catalog.descriptionWithDamage(attack,skill))}</p></div></div>
        ${unlocked?`<div class="manual-technique-actions">
          <button type="button" data-manual-equip="${esc(skill.id)}" ${equipDisabled(skill.id,equipped)?'disabled':''}>${other===skill.id?'已裝備':other?'改用本功法':'裝備技能'}</button>
          ${upgrade?`<button type="button" class="manual-upgrade" data-skill-upgrade="${esc(skill.id)}" ${gold<upgrade.gold?'disabled':''}>
            ${gold<upgrade.gold?'靈石不足 · ':''}升級招式至 Lv. ${upgrade.targetLevel} · ${upgrade.gold} 靈石</button>`:'<small>招式已滿級</small>'}
          ${upgrade?`<small class="manual-skill-bonus">${bonus}</small>`:''}
        </div>`:
          `<span class="manual-lock"><i class="fa-solid fa-lock"></i> 需達 ${requirements.join('、')}</span>`}
      </div>`;
    }).join('');
    const progress=`<div class="manual-mastery">
      <div class="manual-mastery-head"><strong>熟練度</strong>
        <span>${book.expInLevel.toLocaleString('zh-TW')} / ${book.expToNext.toLocaleString('zh-TW')} EXP</span></div>
      <div class="manual-exp-track" role="progressbar" aria-label="${esc(book.name)}熟練經驗" aria-valuemin="0"
        aria-valuemax="${book.expToNext}" aria-valuenow="${book.expInLevel}">
        <div class="manual-exp-fill" style="width:${book.progress}%"></div></div>
      <small>${next?`${!next.mastered?'功法 Lv. '+next.levelRequired+' · ':''}${!next.realmReady?'修士 '+next.realmName+'境 · ':''}解鎖「${esc(next.name)}」`:'三招已全部解鎖'}</small>
      ${book.upgrade?`<button type="button" class="manual-upgrade" data-manual-upgrade="${esc(book.id)}" ${gold<book.upgrade.gold?'disabled':''}>
        ${gold<book.upgrade.gold?'靈石不足 · ':''}升級功法至 Lv. ${book.upgrade.targetLevel} · ${book.upgrade.gold} 靈石</button>`:''}
    </div>`;
    const focus=book.id===featuredBookId;
    const collectionCover=renderManualCollectionSummary(book,featuredBookId,equipped,{
      esc,bookArt,skillArt,label
    });
    return `<details class="manual-book ${book.school==='sword'?'is-sword':'is-body'} ${focus?'is-featured':''}"
      data-manual-book="${esc(book.id)}"${expandedBooks.has(book.id)?' open':''}>
      ${collectionCover}
      <div class="manual-book-content">
        <div class="manual-library-detail-header">
          <div><strong>《${esc(book.name)}》功法詳情</strong>
            <small>熟練度、技能說明及解鎖條件</small></div>
          <button type="button" class="manual-library-feature-button" data-feature-book="${esc(book.id)}"
            data-manual-focus-hero="true">
            <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
            ${focus?'返回上方展示':'設為展示焦點'}</button>
        </div>
        <p class="manual-book-description">${esc(book.description)}</p>
        ${progress}<div class="manual-techniques">${skills}</div>
      </div>
    </details>`;
  }).join('');
  return `${hero}<div class="manual-summary"><div><b>${owned} 本</b><span>已獲得功法</span></div>
      <div><b>${(current.equipped||[]).length} / 3</b><span>已裝備技能</span></div>
      <div><b>${gold.toLocaleString('zh-TW')}</b><span>可用靈石</span></div>
      <div class="manual-power-summary"><b>${rating?fmt(rating.total):'—'}</b><span>戰棋戰力</span>
        <small>${rating?'基礎 '+fmt(rating.base)+' + 招式 '+fmt(rating.skills):'正在計算'}</small></div></div>
    ${renderManualLoadout(current,selectedLoadout,pickerSlot,{
      esc,skillArt,moveIdOf:id=>Catalog.BY_SKILL[id]?.moveId
    })}
    <section class="manual-library" aria-label="功法收藏藏經閣">
      ${renderManualCollectionHeader(current,libraryFilter,{esc})}
      <div class="manual-book-grid">${cards||'<p class="manual-empty">此篩選沒有已獲得的功法。可切換流派或選擇「全部功法」。</p>'}</div>
    </section>
    <details class="manual-xp-reference"><summary>查看靈獸境界 EXP 獎勵</summary>
      <div>${Catalog.REALMS.map(realm=>`<span>${realm.name}境 <b>+${realm.exp}</b> EXP</span>`).join('')}</div>
      <p>使用功法技能擊殺靈獸才能累積經驗。每招同時需要達到功法等級與修士境界。</p>
    </details>
    <div class="manual-status" data-manual-status role="status" aria-live="polite"></div>`;
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
      if(oldNode.nodeName==='DETAILS'&&attr.name==='open')continue;
      if(!newNode.hasAttribute(attr.name))oldNode.removeAttribute(attr.name);
    }
    for(const attr of [...newNode.attributes]){
      if(oldNode.nodeName==='DETAILS'&&attr.name==='open')continue;
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
function paint(message='',{loadoutFeedback=false}={}){
  ensure();if(!root)return;
  const expandedBooks=new Set();
  if(renderedFor===loadedFor){
    for(const book of root.querySelectorAll('details[data-manual-book][open]'))expandedBooks.add(book.dataset.manualBook);
  }
  const template=document.createElement('template');template.innerHTML=markup(expandedBooks);
  if(renderedFor&&renderedFor!==loadedFor)root.replaceChildren(template.content.cloneNode(true));
  else reconcile(root,template.content);
  renderedFor=loadedFor;
  const status=root.querySelector('[data-manual-status]');
  if(status)status.textContent=message;
  const deckStatus=root.querySelector('[data-manual-loadout-status]');
  if(deckStatus)deckStatus.textContent=loadoutFeedback?message:'';
  root.querySelectorAll('button').forEach(button=>{
    if(busy)button.disabled=true;
  });
}
async function load({force=false}={}){
  if(busy)return;
  ensure();const uid=getMainUser()?.uid;
  if(!uid){current=null;loadedFor='';paint('請先登入後查看功法。');return;}
  if(!force&&loadedFor===uid&&Date.now()-lastFetch<15000){paint();return;}
  const token=++sequence;lastFetch=Date.now();
  try{
    const result=await request('/api/tactical/manuals');
    if(token!==sequence||getMainUser()?.uid!==uid)return;
    current=result;if(loadedFor!==uid){selectedLoadout=result.activeLoadout||0;featuredBookId='';pickerSlot=null;libraryFilter='all';}loadedFor=uid;
    window.setCurrentTacticalManualState?.(result,uid);
    paint();
  }catch(error){
    if(token!==sequence)return;
    paint(error.message);
  }
}
async function mutate(url,body){
  if(busy)return;
  const uid=getMainUser()?.uid;if(!uid)return;
  const upgrading=url.endsWith('/upgrade');
  ++sequence;busy=true;paint(body.skillId?'正在升級招式…':upgrading?'正在升級功法…':'正在保存功法配置…');
  let message='',successful=false;
  const equippedSlot=pickerSlot;
  try{
    const next=await request(url,body);
    if(getMainUser()?.uid!==uid)return;
    current=next;loadedFor=uid;lastFetch=Date.now();successful=true;
    if(url.endsWith('/school')){featuredBookId='';pickerSlot=null;}
    if(url.endsWith('/loadout')&&Array.isArray(body?.skillIds))pickerSlot=null;
    window.setCurrentTacticalManualState?.(next,uid);
    if(upgrading){
      const local=window.getCurrentUserData?.();
      if(local){local.stats||={};local.stats.gold=next.gold;window.updateUIStats?.();}
      const skill=body.skillId&&skillDetails(body.skillId);
      message=skill?`「${skill.name}」已升至 Lv. ${skill.level}。`:
        `已升級《${next.library.find(book=>book.id===body.bookId).name}》。`;
    }else{
      message=url.endsWith('/school')?'修行流派已切換。':'功法配置已儲存。';
      window.dispatchEvent(new CustomEvent('xiuxian:manual-loadout-updated',{detail:{equipped:next.equipped}}));
    }
  }catch(error){message=error.message;}
  finally{
    busy=false;
    if(getMainUser()?.uid===uid){
      paint(message,{loadoutFeedback:url.endsWith('/loadout')});
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
  nav.setAttribute('aria-label','功法修煉');
  document.body.classList.add('cultivation-training-unlocked');
}
function boot(){
  ensureNav();
  ensure();
  root?.addEventListener('click',event=>{
    if(busy)return;
    // Native details toggling and hero selection are reconciled in one paint.
    // Keep this before the button handler: summaries are not nested buttons.
    const summary=event.target.closest('summary.manual-book-top');
    if(summary&&root.contains(summary)){
      const details=summary.closest('details[data-manual-book]');
      const id=details?.dataset.manualBook;
      if(id&&current?.library.some(book=>book.owned&&book.id===id)){
        event.preventDefault();
        details.open=!details.open;
        featuredBookId=id;
        paint();
      }
      return;
    }
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.featureBook){
      if(current?.library.some(book=>book.owned&&book.id===button.dataset.featureBook)){
        featuredBookId=button.dataset.featureBook;
        paint();
        if(button.hasAttribute('data-manual-focus-hero')){
          requestAnimationFrame(()=>{
            root?.querySelector('.manual-hero')?.scrollIntoView({
              behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',
              block:'start'
            });
          });
        }
      }
      return;
    }
    if(button.dataset.manualCollectionFilter){
      const filter=button.dataset.manualCollectionFilter;
      if(['all','sword','body'].includes(filter)){
        libraryFilter=filter;
        paint();
      }
      return;
    }
    if(button.dataset.manualJumpSkill){
      const manualId=Catalog.BY_SKILL[button.dataset.manualJumpSkill]?.manualId;
      const details=[...root.querySelectorAll('details[data-manual-book]')]
        .find(item=>item.dataset.manualBook===manualId);
      if(details){
        details.open=true;
        const target=[...details.querySelectorAll('[data-manual-skill]')]
          .find(item=>item.dataset.manualSkill===button.dataset.manualJumpSkill);
        if(target){
          requestAnimationFrame(()=>{
            target.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});
          });
        }
      }
      return;
    }
    if(button.hasAttribute('data-manual-close-picker')){pickerSlot=null;paint();return;}
    if(button.dataset.manualPickSlot!==undefined){
      const slot=Number(button.dataset.manualPickSlot);
      if(Number.isInteger(slot)&&slot>=0&&slot<=2&&current){
        const filled=current.loadouts?.[selectedLoadout]?.skillIds?.length||0;
        const targetSlot=Math.min(slot,filled);
        pickerSlot=pickerSlot===targetSlot?null:targetSlot;
        paint();
        if(pickerSlot!==null){
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
    if(button.dataset.manualPickSkill!==undefined){
      const id=button.dataset.manualPickSkill;
      if(!Number.isInteger(pickerSlot)||!current)return;
      const allowed=current.library.some(book=>book.owned&&book.skills.some(skill=>skill.id===id&&skill.unlocked));
      if(!allowed){paint('招式尚未解鎖，請重新整理功法資料。');return;}
      const equipped=current.loadouts?.[selectedLoadout]?.skillIds||[];
      const skillIds=selectSkillForSlot(equipped,pickerSlot,id,
        skillId=>Catalog.BY_SKILL[skillId]?.moveId);
      if(!skillIds){paint('無法裝備此招式，請確認技能配置。');return;}
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
    if(button.hasAttribute('data-loadout-apply')){void mutate('/api/tactical/manuals/loadout',{index:selectedLoadout,apply:true});return;}
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
      const id=button.dataset.manualEquip,equipped=current?.loadouts?.[selectedLoadout]?.skillIds||[],other=equippedVersion(id,equipped);
      const skillIds=other?equipped.map(slot=>slot===other?id:slot):[...equipped,id];
      void mutate('/api/tactical/manuals/loadout',{index:selectedLoadout,skillIds});return;
    }
    if(button.dataset.manualRemove){void mutate('/api/tactical/manuals/loadout',
      {index:selectedLoadout,skillIds:(current?.loadouts?.[selectedLoadout]?.skillIds||[]).filter(id=>id!==button.dataset.manualRemove)});}
  });
  document.addEventListener('click',event=>{
    if(event.target.closest('#nav-training,[data-target="page-training"]'))setTimeout(()=>void load({force:true}),0);
  },true);
  window.addEventListener('xiuxian:user-data-ready',()=>{ensureNav();const uid=getMainUser()?.uid||'';if(uid!==loadedFor){current=null;loadedFor='';featuredBookId='';pickerSlot=null;libraryFilter='all';}if(visible())void load({force:true});});
  window.addEventListener('xiuxian:manual-loot',()=>{if(visible())void load({force:true});});
  if(visible())void load({force:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();
export const featureReady=Promise.resolve();
