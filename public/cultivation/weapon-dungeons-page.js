import {authenticatedMainFetch,getMainUser} from './data/project-repository.js';
import {weaponDungeonTicketMarkup} from './spirit-stone-ui.js?v=20261125-stone-reward-icon-v2';
let dialog=null,data=null,loading=false,serial=0,trigger=null,selectedId=null;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const catalog=()=>Array.isArray(data?.dungeons)?data.dungeons:[];
const selected=()=>catalog().find(d=>d.id===selectedId);
const activeId=()=>data?.active?.dungeonId||data?.dungeonId;
const isResume=(d,i)=>data?.active&&activeId()===d.id&&data.active.difficulty===i;
const canEnter=(d,t)=>!loading&&t&&!t.locked&&(isResume(d,t.index)||(!data.active&&data.tickets>0));
const theme=d=>d.theme==='stone'?' wd-stone':'';
function ensure(){
  if(dialog)return;
  if(!document.getElementById('weapon-dungeons-style')){const link=document.createElement('link');link.id='weapon-dungeons-style';link.rel='stylesheet';link.href='/styles/weapon-dungeons.css';document.head.append(link);}
  dialog=document.createElement('dialog');dialog.id='weapon-dungeons-dialog';dialog.setAttribute('aria-labelledby','weapon-dungeons-title');document.body.append(dialog);
  dialog.addEventListener('click',event=>{
    if(event.target.closest('[data-wd-close]')){dialog.close();return;}
    if(event.target===dialog){const b=dialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)dialog.close();return;}
    if(loading||!data)return;
    if(event.target.closest('[data-wd-back]')){selectedId=null;paint();dialog.querySelector?.('[data-wd-dungeon]')?.focus();return;}
    const card=event.target.closest('[data-wd-dungeon]');
    if(card&&catalog().some(d=>d.id===card.dataset.wdDungeon)){selectedId=card.dataset.wdDungeon;paint();dialog.querySelector?.('#weapon-dungeons-title')?.focus();return;}
    const button=event.target.closest('[data-wd-difficulty]');
    if(!button||button.disabled||!selected())return;
    void enter(Number(button.dataset.wdDifficulty));
  });
  dialog.addEventListener('close',()=>{if(loading){serial++;loading=false;}trigger?.focus?.({preventScroll:true});});
  window.addEventListener('xiuxian:user-data-ready',()=>{serial++;data=null;loading=false;selectedId=null;if(dialog.open)dialog.close();});
}
const count=d=>d.difficulties.filter(t=>Number(d.clears[t.index])>0).length;
const traits=d=>'<div class="wd-traits">'+d.traits.map(t=>'<span>'+esc(t)+'</span>').join('')+'</div>';
function card(d){
  const active=data.active&&activeId()===d.id;
  return `<button type="button" class="wd-card${theme(d)}" data-wd-dungeon="${esc(d.id)}">
    <div class="wd-card-art"><span class="wd-chip">單人秘境</span><span class="wd-chip">${active?'挑戰進行中':count(d)===6?'六階皆通關':'可探索'}</span><div class="wd-card-name"><small>${esc(d.subtitle)}</small><strong>${esc(d.name)}</strong></div></div>
    <div class="wd-card-body"><p>${esc(d.description)}</p>${traits(d)}<div class="wd-progress"><span>境界征服</span><b>${count(d)} / ${d.difficulties.length}</b></div>
    <div class="wd-progress-track" aria-hidden="true">${d.difficulties.map(t=>'<i class="'+(d.clears[t.index]?'cleared':t.locked?'':'available')+'"></i>').join('')}</div>
    <div class="wd-card-footer"><span>${esc(d.bonus)}</span><b>${active?'查看續戰':'探索秘境'} ›</b></div></div></button>`;
}
function detail(d){
  return `<section class="wd-hero${theme(d)}"><div><small>${esc(d.subtitle)}</small><h3>${esc(d.name)}</h3><p>${esc(d.description)}</p>${traits(d)}</div><div class="wd-emblem" aria-hidden="true"></div></section>
  <div class="wd-detail-grid"><section class="wd-panel"><h3>秘境法則</h3><div class="wd-bonus">${esc(d.bonus)}</div><ol>${d.tactics.map(t=>'<li>'+esc(t)+'</li>').join('')}</ol></section>
  <section class="wd-panel"><h3>武器掉落</h3><div class="wd-loot-bar" aria-hidden="true"><i></i><i></i><i></i></div><div class="wd-loot-legend"><span>30% 當階</span><span>20% 下一階</span><span>50% 無武器</span></div><p>通關時擲一次，三種結果互斥。重複武器累計持有數，保留最高等階。</p></section></div>
  <div class="wd-section-heading"><h3>選擇挑戰境界</h3><span>已征服 ${count(d)} / ${d.difficulties.length}</span></div>
  <div class="wd-difficulties" role="group" aria-label="選擇副本難度">${d.difficulties.map(t=>{
    const resume=isResume(d,t.index),cleared=Number(d.clears[t.index])||0;
    const status=resume?'繼續挑戰 · 不耗券':t.locked?'通過前一難度解鎖':data.active?'其他挑戰進行中':data.tickets<1?'副本券不足':(cleared?'再次挑戰 · ':'開始挑戰 · ')+weaponDungeonTicketMarkup(1);
    return `<button type="button" data-wd-difficulty="${t.index}" ${canEnter(d,t)?'':'disabled'} class="${resume?'wd-resume':t.locked?'wd-locked':cleared?'wd-cleared':'wd-available'}"><div class="wd-tier-top"><span>${String(t.index+1).padStart(2,'0')}</span><span>${resume?'進行中':cleared?'通關 '+cleared+' 次':t.locked?'未解鎖':'已解鎖'}</span></div><strong>${esc(t.name)}</strong><small>30% ${esc(t.name)}武器 · 20% ${esc(t.nextRealm)}武器</small><span class="wd-tier-action">${status}</span></button>`;
  }).join('')}</div>`;
}
function paint(message=''){
  const d=selected();
  dialog.innerHTML=`<header><div class="wd-heading">${d?'<button type="button" data-wd-back data-qy-nav-action="back" aria-label="返回秘境選擇">‹</button>':''}<div><small>青雲問道 / 玩法 / 武器副本</small><h2 id="weapon-dungeons-title" tabindex="-1">${d?esc(d.name):'武器秘境'}</h2></div></div><button type="button" data-wd-close data-qy-nav-action="close" aria-label="關閉武器副本">×</button></header>
    <div class="wd-body"><div class="wd-tickets"><div><strong>副本券 ${data?weaponDungeonTicketMarkup(data.tickets,{max:data.maxTickets||5}):'同步中'}</strong><div class="wd-ticket-pips" aria-hidden="true">${Array.from({length:5},(_,i)=>'<i class="'+(data&&i<data.tickets?'filled':'')+'"></i>').join('')}</div></div><span>每日補發 3 張 · 最多持有 5 張<br>臺灣時間 00:00</span></div>
    ${data?.active?'<div class="wd-active">已有進行中的挑戰，續戰不耗券；完成或離場後才能開啟其他挑戰。</div>':''}
    ${d?detail(d):`<div class="wd-section-heading"><h3>尋訪秘境</h3><span>${catalog().length} 座開放</span></div><p>選擇秘境，探索不同戰鬥法則，挑戰更高境界並尋找武器。</p><div class="wd-catalog">${catalog().map(card).join('')}<div class="wd-coming"><span aria-hidden="true">◇</span><strong>群山之外</strong><small>更多秘境尚待開放</small></div></div>`}
    <p class="wd-cost">新挑戰消耗 ${weaponDungeonTicketMarkup(1)}；失敗或中途離場不退券。收起戰場可續戰。</p>
    <p class="wd-message" role="status" aria-live="polite">${esc(message)}</p></div>`;
  const body=dialog.querySelector?.('.wd-body');if(body)body.scrollTop=0;
}
async function enter(difficulty){
  const d=selected(),tier=d?.difficulties.find(t=>t.index===difficulty);
  if(!d||!canEnter(d,tier))return;
  const account=getMainUser()?.uid,token=++serial;loading=true;paint('正在進入秘境…');
  try{
    const battle=await import('./tactical-combat.js?v=20261125-weapon-lord-cleared-v1');
    if(serial!==token||getMainUser()?.uid!==account)return;
    loading=false;dialog.close();
    await battle.openTacticalCombat('weapon-dungeon',{dungeonId:d.id,difficulty});
  }catch(error){if(serial===token&&getMainUser()?.uid===account){loading=false;paint(error.message||'副本暫時無法開啟');if(!dialog.open)dialog.showModal();}}
  finally{if(serial===token)loading=false;}
}
export async function openWeaponDungeons(){
  const account=getMainUser()?.uid;
  if(!account){window.showToast?.('請先登入後挑戰武器副本');return;}
  ensure();trigger=document.activeElement;data=null;selectedId=null;loading=true;paint('正在同步副本券與秘境進度…');
  if(!dialog.open)dialog.showModal();const token=++serial;
  try{
    const response=await authenticatedMainFetch('/api/tactical/weapon-dungeons'),result=await response.json();
    if(serial!==token||getMainUser()?.uid!==account)return;
    if(!response.ok||!result.ok)throw Error(result.error||'副本資料同步失敗');
    data=result.state;loading=false;paint();
  }catch(error){if(serial===token){loading=false;paint(error.message||'副本資料同步失敗');}}
}
function mount(){
  const target=document.querySelector('#page-gameplay .gameplay-entries');
  if(!target||document.getElementById('gameplay-weapon-dungeon-entry'))return;
  const button=document.createElement('button');button.type='button';button.id='gameplay-weapon-dungeon-entry';button.className='gameplay-dungeon-entry';
  button.innerHTML='<i class="fa-solid fa-mountain" aria-hidden="true"></i><span><strong>武器副本</strong><small>單人秘境 · 武器掉落 · 六階挑戰</small></span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i>';
  button.addEventListener('click',()=>void openWeaponDungeons());target.append(button);
}
window.openWeaponDungeons=openWeaponDungeons;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
export const featureReady=Promise.resolve();
