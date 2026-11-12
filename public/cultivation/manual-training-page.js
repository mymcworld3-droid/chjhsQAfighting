import './manual-rules.js';
import {authenticatedMainFetch,getMainUser} from './data/project-repository.js';

const Catalog=globalThis.QAManuals;
let root=null,current=null,busy=false,loadedFor='',lastFetch=0,sequence=0;
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[ch]);
const label=school=>school==='sword'?'劍修':'體修';
const icon=school=>school==='sword'?'fa-khanda':'fa-hand-fist';
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
    link.id='manual-training-style';link.href='/styles/manual-training.css?v=20261112-books-v1';
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
function markup(){
  if(!current)return '<div class="manual-loading">正在讀取功法…</div>';
  const owned=current.library.filter(item=>item.owned).length;
  const equipped=current.equipped||[];
  const slots=Array.from({length:3},(_,i)=>{
    const id=equipped[i],skill=Catalog.BY_SKILL[id];
    return `<div class="manual-slot ${id?'is-active':''}">
      <small>第 ${i+1} 技能欄</small>
      ${skill?`<strong>${esc(skill.name)}</strong><span>消耗 ${skill.cost} 體力</span>
        <button type="button" data-manual-remove="${esc(id)}">卸下</button>`:
        '<span class="manual-slot-empty">尚未裝備</span>'}
      </div>`;
  }).join('');
  const cards=current.library.map(book=>{
    const next=book.skills.find(s=>!s.unlocked);
    const skills=book.skills.map((skill,i)=>{
      const active=equipped.includes(skill.id);
      const unlocked=book.owned&&skill.unlocked;
      return `<div class="manual-technique ${unlocked?'':'is-locked'}">
        <div class="manual-technique-heading"><b>${i+1}. ${esc(skill.name)}</b>
          <small>${skill.cost} 體力 · ${skill.range} 格</small></div>
        <p>${esc(skill.description)}</p>
        ${unlocked?`<button type="button" data-manual-equip="${esc(skill.id)}" ${active||equipped.length>=3?'disabled':''}>${active?'已裝備':'裝備技能'}</button>`:
          `<span class="manual-lock"><i class="fa-solid fa-lock"></i>
            ${book.owned?`擊殺 ${skill.killsRequired} 隻靈獸解鎖`:'習得功法後解鎖'}</span>`}
      </div>`;
    }).join('');
    const progress=book.owned?`<div class="manual-mastery">
      <span>熟練度 <b>${book.kills}</b> 次擊殺</span>
      ${next?`<span>下一招：${Math.max(0,next.killsRequired-book.kills)} 次擊殺後解鎖</span>`:'<span>三招已全部解鎖</span>'}
      </div>`:'<div class="manual-mastery">尚未習得 · 通關問道試煉有機會取得</div>';
    return `<article class="manual-book ${book.owned?'owned':'unknown'}" data-manual-book="${esc(book.id)}">
      <div class="manual-book-top"><div class="manual-book-glyph"><i class="fa-solid ${icon(book.school)}"></i></div>
        <div><small>${label(book.school)}功法 · ${book.owned?'已習得':'未收錄'}</small>
          <h3>${esc(book.name)}</h3></div></div>
      <p class="manual-book-description">${esc(book.description)}</p>
      ${progress}<div class="manual-techniques">${skills}</div>
    </article>`;
  }).join('');
  return `<header class="manual-header"><div><small>問道 · 功法閣</small>
    <h2>功法修煉</h2><p>完成試煉有機會獲得功法，以功法技能擊殺靈獸，逐步領悟每本功法的三招。</p>
    </div><button type="button" class="manual-refresh" data-manual-refresh><i class="fa-solid fa-rotate"></i> 更新</button></header>
    <div class="manual-summary"><div><b>${owned} / ${current.library.length}</b><span>已收錄功法</span></div>
      <div><b>${equipped.length} / 3</b><span>已裝備技能</span></div>
      <div><b>${current.school?label(current.school):'未選擇'}</b><span>目前修行方向</span></div></div>
    <section class="manual-school"><div><h3>修行流派</h3><p>第一次選擇流派免費習得一本入門功法。流派可以切換，已取得的功法及熟練度不會消失。</p></div>
      <div class="manual-school-choices"><button type="button" data-manual-school="sword" class="${current.school==='sword'?'selected':''}">
        <i class="fa-solid fa-khanda"></i> 劍修</button><button type="button" data-manual-school="body" class="${current.school==='body'?'selected':''}">
        <i class="fa-solid fa-hand-fist"></i> 體修</button></div></section>
    <section class="manual-loadout"><div class="manual-section-title"><h3>戰場技能配置</h3><p>自由搭配所有已解鎖的功法技能，最多三招。更動只影響下一場新戰鬥。</p></div>
      <div class="manual-slot-grid">${slots}</div></section>
    <section class="manual-library"><div class="manual-section-title"><h3>功法藏經閣</h3>
      <p>第 1 招取得功法即可用；第 2、3 招分別需要以本功法技能擊殺 3、8 隻靈獸。每本功法分開計算。</p>
      </div><div class="manual-book-grid">${cards}</div></section>
    <p class="manual-rules-foot">僅有試煉中的靈獸擊殺計入熟練度；普攻、金丹技能及 PvP 擊殺不計入。
      通關掉落由伺服器判定；連續未掉落會累積保底。</p>
    <div class="manual-status" data-manual-status role="status" aria-live="polite"></div>`;
}
function paint(message=''){
  ensure();if(!root)return;
  root.innerHTML=markup();
  const status=root.querySelector('[data-manual-status]');
  if(status)status.textContent=message;
  root.querySelectorAll('button').forEach(button=>{
    if(busy&&button.dataset.manualRefresh===undefined)button.disabled=true;
  });
}
async function load({force=false}={}){
  ensure();const uid=getMainUser()?.uid;
  if(!uid){current=null;loadedFor='';paint('請先登入後查看功法。');return;}
  if(!force&&loadedFor===uid&&Date.now()-lastFetch<15000){paint();return;}
  const token=++sequence;lastFetch=Date.now();
  try{
    const result=await request('/api/tactical/manuals');
    if(token!==sequence||getMainUser()?.uid!==uid)return;
    current=result;loadedFor=uid;paint();
  }catch(error){
    if(token!==sequence)return;
    paint(error.message);
  }
}
async function mutate(url,body){
  if(busy)return;
  const uid=getMainUser()?.uid;if(!uid)return;
  busy=true;paint('正在保存功法配置…');
  try{
    const next=await request(url,body);
    if(getMainUser()?.uid!==uid)return;
    current=next;loadedFor=uid;lastFetch=Date.now();paint('功法配置已儲存。');
    window.dispatchEvent(new CustomEvent('xiuxian:manual-loadout-updated',{detail:{equipped:next.equipped}}));
  }catch(error){paint(error.message);}
  finally{busy=false;root?.querySelectorAll('button').forEach(button=>button.disabled=
    button.hasAttribute('data-manual-equip')&&(current?.equipped.includes(button.dataset.manualEquip)||current?.equipped.length>=3));}
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
    if(button.dataset.manualEquip){void mutate('/api/tactical/manuals/equip',{skillIds:[...(current?.equipped||[]),button.dataset.manualEquip]});return;}
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
