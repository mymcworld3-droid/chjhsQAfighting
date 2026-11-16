import './manual-rules.js?v=20261116-wind-step-rebalance-v1';
import {bookArt,skillArt} from './manual-art.js';
import {authenticatedMainFetch,getMainUser} from './data/project-repository.js';

const Catalog=globalThis.QAManuals;
let root=null,current=null,busy=false,loadedFor='',renderedFor='',lastFetch=0,sequence=0;
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
    link.id='manual-training-style';link.href='/styles/manual-training.css?v=20261116-damage-in-description';
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
function equippedVersion(id,equipped=current?.equipped||[]){
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
function markup(expandedBooks){
  if(!current)return '<div class="manual-loading">正在讀取功法…</div>';
  const owned=current.library.filter(item=>item.owned).length;
  const equipped=current.equipped||[];
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
  const slots=Array.from({length:3},(_,i)=>{
    const id=equipped[i],skill=skillDetails(id);
    return `<div class="manual-slot ${id?'is-active':''}">
      <small>第 ${i+1} 技能欄</small>
      ${skill?`<div class="manual-slot-equipped">${artImg(skillArt(skill),"manual-slot-art")}<div class="manual-slot-meta"><strong>${esc(skill.name)}</strong><span>招式 Lv. ${skill.level} · ${esc(Catalog.BY_BOOK[skill.manualId].name)} · ${skill.cost} 體力</span></div></div>
        <button type="button" data-manual-remove="${esc(id)}">卸下</button>`:
        '<span class="manual-slot-empty">尚未裝備</span>'}
      </div>`;
  }).join('');
  const cards=current.library.filter(book=>book.owned).map(book=>{
    const next=book.skills.find(s=>!s.unlocked);
    const skills=book.skills.map((skill,i)=>{
      const other=equippedVersion(skill.id,equipped);
      const {unlocked,upgrade}=skill;
      const bonus=skill.kind==='fist-focus'?'每級少 1 體力':'每級 +10% 基礎傷害';
      const requirements=[
        !skill.mastered?'功法 Lv. '+skill.levelRequired:null,
        !skill.realmReady?'修士 '+skill.realmName+'境':null
      ].filter(Boolean);
      return `<div class="manual-technique ${unlocked?'':'is-locked'}">
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
    return `<details class="manual-book" data-manual-book="${esc(book.id)}"${expandedBooks.has(book.id)?' open':''}>
      <summary class="manual-book-top">
        <span class="manual-book-glyph" aria-hidden="true">${artImg(bookArt(book.id),"manual-book-art")}</span>
        <span class="manual-book-title"><small>${label(book.school)}功法</small><strong>${esc(book.name)}</strong></span>
        <span class="manual-book-level">Lv. ${book.level}</span>
        <span class="manual-book-chevron" aria-hidden="true"></span>
      </summary>
      <div class="manual-book-content">
        <p class="manual-book-description">${esc(book.description)}</p>
        ${progress}<div class="manual-techniques">${skills}</div>
      </div>
    </details>`;
  }).join('');
  return `<div class="manual-summary"><div><b>${owned} 本</b><span>已獲得功法</span></div>
      <div><b>${equipped.length} / 3</b><span>已裝備技能</span></div>
      <div><b>${gold.toLocaleString('zh-TW')}</b><span>可用靈石</span></div>
      <div class="manual-power-summary"><b>${rating?fmt(rating.total):'—'}</b><span>戰棋戰力</span>
        <small>${rating?'基礎 '+fmt(rating.base)+' + 招式 '+fmt(rating.skills):'正在計算'}</small></div></div>
    <details class="manual-power-details"><summary>查看戰棋戰力計算</summary>
      <p>戰力 = 攻擊力 × 2 + 最大生命 × 0.2 + 裝備招式的加權評分。第二、三強招式分別只計 40%／20%，避免重複當作同回合全部輸出。舊金丹及法寶不再額外加分；戰力僅供比較，不改變戰鬥傷害。</p>
      <div>基礎 ${rating?fmt(rating.base):'—'} ／ 已裝備招式 ${rating?fmt(rating.skills):'—'}</div>
      ${rating?.items?.length?'<ul>'+rating.items.map(item=>'<li>'+esc(item.name)+' Lv.'+item.level+'：+'+fmt(item.power)+'（權重 '+Math.round(item.weight*100)+'%）</li>').join('')+'</ul>':'<p>目前尚未裝備符合境界與功法等級的招式。</p>'}
    </details>
    <section class="manual-school"><div><h3>修行流派</h3><p>第一次選擇流派免費習得一本入門功法。流派可以切換，已取得的功法及熟練度不會消失。</p></div>
      <div class="manual-school-choices"><button type="button" data-manual-school="sword" class="${current.school==='sword'?'selected':''}">
        <i class="fa-solid fa-khanda"></i> 劍修</button><button type="button" data-manual-school="body" class="${current.school==='body'?'selected':''}">
        <i class="fa-solid fa-hand-fist"></i> 體修</button></div></section>
    <section class="manual-loadout"><div class="manual-section-title"><h3>戰場技能配置</h3><p>自由搭配所有已解鎖的功法技能，最多三招。重新進入試煉時會套用目前配置。</p></div>
      <div class="manual-slot-grid">${slots}</div></section>
    <section class="manual-library"><div class="manual-section-title"><h3>已獲得的功法</h3>
      <button type="button" class="manual-refresh" data-manual-refresh title="同步功法"><i class="fa-solid fa-rotate"></i> 更新</button>
      </div><div class="manual-book-grid">${cards||'<p class="manual-empty">尚無功法，選擇劍修或體修即可獲得一本入門功法。</p>'}</div></section>
    <details class="manual-xp-reference"><summary>查看靈獸境界 EXP 獎勵</summary>
      <div>${Catalog.REALMS.map(realm=>`<span>${realm.name}境 <b>+${realm.exp}</b> EXP</span>`).join('')}</div>
      <p>使用功法技能擊殺靈獸才能累積經驗。每招同時需要達到功法等級與修士境界。</p>
    </details>
    <div class="manual-status" data-manual-status role="status" aria-live="polite"></div>`;
}
function paint(message=''){
  ensure();if(!root)return;
  const expandedBooks=new Set();
  if(renderedFor===loadedFor){
    for(const book of root.querySelectorAll('details[data-manual-book][open]'))expandedBooks.add(book.dataset.manualBook);
  }
  root.innerHTML=markup(expandedBooks);
  renderedFor=loadedFor;
  const status=root.querySelector('[data-manual-status]');
  if(status)status.textContent=message;
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
    current=result;loadedFor=uid;
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
  let message='';
  try{
    const next=await request(url,body);
    if(getMainUser()?.uid!==uid)return;
    current=next;loadedFor=uid;lastFetch=Date.now();
    window.setCurrentTacticalManualState?.(next,uid);
    if(upgrading){
      const local=window.getCurrentUserData?.();
      if(local){local.stats||={};local.stats.gold=next.gold;window.updateUIStats?.();}
      const skill=body.skillId&&skillDetails(body.skillId);
      message=skill?`「${skill.name}」已升至 Lv. ${skill.level}。`:
        `已升級《${next.library.find(book=>book.id===body.bookId).name}》。`;
    }else{
      message='功法配置已儲存。';
      window.dispatchEvent(new CustomEvent('xiuxian:manual-loadout-updated',{detail:{equipped:next.equipped}}));
    }
  }catch(error){message=error.message;}
  finally{
    busy=false;
    if(getMainUser()?.uid===uid)paint(message);
    else if(visible())void load({force:true});
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
    const button=event.target.closest('button');if(!button||busy)return;
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
      const id=button.dataset.manualEquip,equipped=current?.equipped||[],other=equippedVersion(id,equipped);
      const skillIds=other?equipped.map(slot=>slot===other?id:slot):[...equipped,id];
      void mutate('/api/tactical/manuals/equip',{skillIds});return;
    }
    if(button.dataset.manualRemove){void mutate('/api/tactical/manuals/equip',
      {skillIds:(current?.equipped||[]).filter(id=>id!==button.dataset.manualRemove)});}
  });
  document.addEventListener('click',event=>{
    if(event.target.closest('#nav-training,[data-target="page-training"]'))setTimeout(()=>void load({force:true}),0);
  },true);
  window.addEventListener('xiuxian:user-data-ready',()=>{ensureNav();const uid=getMainUser()?.uid||'';if(uid!==loadedFor){current=null;loadedFor='';}if(visible())void load({force:true});});
  window.addEventListener('xiuxian:manual-loot',()=>{if(visible())void load({force:true});});
  if(visible())void load({force:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();
export const featureReady=Promise.resolve();
