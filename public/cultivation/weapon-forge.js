import './weapon-system-rules.js';
import {authenticatedMainFetch,getMainUser} from './data/project-repository.js';

const W=globalThis.QAWeapons;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let host=null,view='weapons',selected='sword',snapshot=null,owner='',serial=0,busy=false,loading=false,message='',pending=null;
const current=()=>window.getCurrentUserData?.()||{};
const pendingKey=uid=>'weapon-forge-pending:'+uid;
const valid=(uid,epoch)=>owner===uid&&getMainUser()?.uid===uid&&serial===epoch;
function identity(){const uid=getMainUser()?.uid||'';if(owner!==uid){owner=uid;serial++;snapshot=null;busy=false;loading=false;message='';selected='sword';try{pending=JSON.parse(localStorage.getItem(pendingKey(uid))||'null');}catch(_){pending=null;}}return uid;}
function icon(type){
  const paths={bow:'M25 10 Q82 50 25 90 M25 10 L49 50 25 90 M18 50 H85 M73 41 L85 50 73 59',spear:'M22 86 L72 24 M64 27 L82 9 78 35 72 24 M18 78 L30 88',
    sword:'M22 82 L67 27 M57 31 L81 10 72 42 M37 56 L54 70 M18 88 L27 84',saber:'M19 85 L40 60 Q70 48 82 12 Q89 50 51 75 M31 57 L51 78',
    hammer:'M23 87 L61 45 M43 36 L62 15 87 37 68 58 Z M48 33 L73 54'};
  return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path d="${paths[type]}" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function apply(payload){snapshot=payload;const user=current();user.weaponSystemV1=payload.state;user.stats||={};user.stats.gold=payload.balance;user.forgeFragments=payload.fragments;user.soulboundDrawTickets=payload.tickets;
  window.updateUIStats?.();window.dispatchEvent(new CustomEvent('xiuxian:weapon-updated',{detail:{state:payload.state}}));}
async function request(action='',body){const res=await authenticatedMainFetch('/api/weapons'+(action?'/'+action:''),{...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
  const payload=await res.json().catch(()=>({}));if(!res.ok||payload.ok!==true)throw Object.assign(Error(payload.error||'兵器服務暫時無法連線'),{definitive:res.status>=400&&res.status<500});return payload;}
async function refresh(){const uid=identity(),epoch=serial;if(!uid||loading)return;loading=true;render();try{const payload=await request();if(valid(uid,epoch)){apply(payload);if(payload.state.equipped)selected=payload.state.equipped;}}
  catch(e){if(valid(uid,epoch))message=e.message;}finally{if(valid(uid,epoch)){loading=false;render();}}}
function remember(operation){pending=operation;try{if(operation)localStorage.setItem(pendingKey(owner),JSON.stringify(operation));else localStorage.removeItem(pendingKey(owner));}catch(_){}}
function resultMessage(payload){const r=payload.result||{};if(payload.replayed)return '操作已完成，已同步最新兵器。';
  if(r.action==='upgrade')return `${W.get(r.type).name}提升至 Lv.${r.level}。`;
  if(r.name)return `獲得${r.name}，可在煉器頁裝配。`;
  if(r.action==='equip')return '主武器已更換，下一場戰鬥生效。';
  if(r.action==='convert-legacy')return `傳承完成：自選兵器匣 ×${r.chests}、靈石 +${r.gold}。`;
  return `獲得自選兵器匣 ×${r.chests||1}。`;
}
async function mutate(action,body={},retry=false){
  const uid=identity(),epoch=serial;if(!uid||busy||loading||pending&&!retry)return;
  const operation=retry?pending:{action,body:{...body,requestId:crypto.randomUUID()}};if(!operation)return;
  remember(operation);busy=true;message='正在同步…';render();
  try{const payload=await request(operation.action,operation.body);if(!valid(uid,epoch))return;remember(null);apply(payload);message=resultMessage(payload);
    if(!payload.replayed&&['upgrade','starter','open-chest'].includes(operation.action))window.QAGameAudio?.play?.('reward-chime');
  }catch(e){if(valid(uid,epoch)){message=e.message+(e.definitive?'':'，請按「重試原操作」。');if(e.definitive)remember(null);}}
  finally{if(valid(uid,epoch)){busy=false;render();}}
}
function cards(state){return W.TYPES.map(t=>{const row=state.weapons[t.id];return `<button type="button" class="wf-weapon ${selected===t.id?'is-selected':''}" data-weapon-select="${t.id}" aria-pressed="${selected===t.id}" style="--weapon-ink:${t.color}"><span class="wf-art">${icon(t.id)}</span><b>${t.name}</b><span>${t.label} · ${t.tag}</span><small>${row?'Lv.'+row.level+' · 持有 '+row.copies+' 把':'尚未獲得'}</small>${state.equipped===t.id?'<em>主武器</em>':''}</button>`;}).join('');}
function weaponsMarkup(s,locked){const t=W.get(selected),row=s.weapons[selected],level=row?.level||1,max=row?.level>=W.MAX_LEVEL,need=W.mergeCost(level),gold=W.goldCost(level),spares=Math.max(0,(row?.copies||0)-1),owned=!!row;
  return `<div class="wf-workbench"><div class="wf-detail-art" style="--weapon-ink:${t.color}">${icon(t.id)}</div><div class="wf-detail"><small>${t.label} · ${t.tag}</small><h3>${t.name} <span>${owned?'Lv.'+level:'未持有'}</span></h3><p>${t.description}</p><div class="wf-stats"><span>消耗 ${t.cost} 體力</span><span>射程 ${t.minRange?t.minRange+'～':''}${t.range} 格</span><span>攻擊加成 +${Number(((level-1)*W.ATTACK_PER_LEVEL*100).toFixed(1))}%</span></div>
    <button type="button" data-weapon-equip="${t.id}" ${locked||!owned||s.equipped===t.id?'disabled':''}>${s.equipped===t.id?'正在使用':'裝配為主武器'}</button></div></div>
    <section class="wf-upgrade"><div><h3>淬鍊升級 <small>${owned?'Lv.'+level+(max?' · 已滿級':' → Lv.'+(level+1)):'先獲得這把武器'}</small></h3><p>最高 Lv.${W.MAX_LEVEL}；每級增加 2.5% 攻擊。同款合併與靈石升級擇一支付。</p></div><div class="wf-upgrade-options"><button type="button" data-weapon-upgrade="merge" ${locked||!owned||max||spares<need?'disabled':''}><b>合併同款 ×${need}</b><span>可用副本 ${spares} 把 · 保留主武器</span></button><button type="button" data-weapon-upgrade="gold" ${locked||!owned||max||snapshot.balance<gold?'disabled':''}><b>${gold.toLocaleString('zh-TW')} 靈石升級</b><span>不消耗同款武器</span></button></div></section>`;
}
function acquireMarkup(s,locked){const t=W.get(selected),legacy=snapshot.legacy,hasLegacy=legacy.equipmentCopies||legacy.materialCount||legacy.pendingJob;
  return `<section class="wf-acquire"><div class="wf-choice"><small>正在選擇</small><h3>${t.name}</h3><p>點選上方兵器後領取；兵器匣可以選新類型，也能選同款用於合併。</p><div class="wf-choice-actions">${!s.starterClaimed?`<button type="button" class="wf-primary" data-weapon-starter ${locked?'disabled':''}>免費領取第一把 · ${t.label}</button>`:''}<button type="button" data-weapon-open ${locked||s.chests<1?'disabled':''}>開啟自選兵器匣 · 剩 ${s.chests} 匣</button></div></div>
    <div class="wf-sources"><article><b>問道試煉</b><p>每關首次通關獲得 1 匣，每五關額外 1 匣。失敗重試不消耗兵器，已領關卡不重複發獎。</p><button type="button" data-weapon-trial ${locked?'disabled':''}>前往試煉 →</button>${snapshot.pendingTrialChests?`<button type="button" data-weapon-claim ${locked?'disabled':''}>補領已通關獎勵 ×${snapshot.pendingTrialChests}</button>`:''}</article>
    <article><b>日常與仙道任務</b><p>任務與閉關獎勵中的契器券，可直接兌換自選兵器匣。</p><button type="button" data-weapon-ticket ${locked||snapshot.tickets<1?'disabled':''}>1 券換 1 匣 · 持有 ${snapshot.tickets} 券</button></article>
    <article><b>舊碎片兌換</b><p>原有煉器碎片仍可使用；每 600 碎片指定換得一個自選兵器匣。</p><button type="button" data-weapon-fragments ${locked||snapshot.fragments<W.FRAGMENTS_PER_CHEST?'disabled':''}>600 碎片換 1 匣 · 持有 ${snapshot.fragments}</button></article></div>
    ${hasLegacy?`<details class="wf-legacy"><summary>舊資產傳承</summary><p>持有舊裝備 ${legacy.equipmentCopies} 件、舊材料 ${legacy.materialCount} 個。轉換可得 ${legacy.chests} 個自選兵器匣與 ${legacy.gold} 靈石；舊物將移入傳承紀錄。</p><p>每件舊裝備換一匣，每個材料換 10 靈石。只轉換本次列出的物品，已轉換物品不重複發獎。${legacy.pendingJob?'未完成的煉製會退回投入，另返還 '+legacy.refundFragments+' 碎片。':''}</p><button type="button" data-weapon-convert ${locked?'disabled':''}>確認轉換上述舊資產</button></details>`:''}</section>`;
}
function render(){if(!host?.isConnected)return;
  const active=document.querySelector('#page-training [data-training-tab].active')?.dataset.trainingTab;
  if(active&&!['refinery','contract','equipment'].includes(active))return;
  if(!snapshot){host.innerHTML=`<section class="wf-page"><h2>煉器 · 兵器庫</h2><p role="status">${esc(message||'正在整理兵器…')}</p><button type="button" data-weapon-refresh ${loading?'disabled':''}>重新同步</button></section>`;return;}
  const s=snapshot.state,equipped=W.get(s.equipped),row=s.weapons[s.equipped],locked=busy||loading||!!pending;
  host.innerHTML=`<section class="wf-page" aria-label="單一主武器裝配與升級"><header class="wf-heading"><h2>${view==='acquire'?'尋器':'煉器'} · 兵器庫</h2><span>${snapshot.balance.toLocaleString('zh-TW')} 靈石</span></header>
    <div class="wf-equipped"><span class="wf-equipped-art">${equipped?icon(equipped.id):'未持武器'}</span><div><small>主武器 · 單一欄位</small><b>${equipped?equipped.name+' · Lv.'+row.level:'尚未裝配主武器'}</b><span>${equipped?equipped.tag+' · '+equipped.cost+' 體力 · 射程 '+(equipped.minRange?equipped.minRange+'～':'')+equipped.range+' 格':'前往尋器，自選領取第一把武器。'}</span></div></div>
    <nav class="wf-tabs" aria-label="兵器操作"><button type="button" data-weapon-view="weapons" aria-pressed="${view==='weapons'}">裝配與升級</button><button type="button" data-weapon-view="acquire" aria-pressed="${view==='acquire'}">獲取兵器 <span>${s.chests?'· '+s.chests+' 匣':''}</span></button></nav>
    <p class="wf-message" role="status" ${message?'':'hidden'}>${esc(message)}</p>${pending&&!busy?'<button type="button" class="wf-retry" data-weapon-retry>重試原操作</button>':''}
    <div class="wf-weapons" aria-label="五種武器">${cards(s)}</div>${view==='acquire'?acquireMarkup(s,locked):weaponsMarkup(s,locked)}<footer class="wf-footer"><span>裝配、升級在下一場戰鬥生效。</span><button type="button" data-weapon-refresh ${busy||loading?'disabled':''}>重新同步</button></footer></section>`;
}
function click(event){const b=event.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.weaponSelect){selected=b.dataset.weaponSelect;render();}
  else if(b.dataset.weaponView){view=b.dataset.weaponView;render();}
  else if(b.hasAttribute('data-weapon-refresh'))void refresh();
  else if(b.hasAttribute('data-weapon-retry'))void mutate('',{},true);
  else if(b.hasAttribute('data-weapon-starter'))void mutate('starter',{type:selected});
  else if(b.hasAttribute('data-weapon-open'))void mutate('open-chest',{type:selected});
  else if(b.dataset.weaponEquip)void mutate('equip',{type:b.dataset.weaponEquip});
  else if(b.dataset.weaponUpgrade)void mutate('upgrade',{type:selected,payment:b.dataset.weaponUpgrade,expectedLevel:snapshot.state.weapons[selected]?.level});
  else if(b.hasAttribute('data-weapon-claim'))void mutate('claim-trial');
  else if(b.hasAttribute('data-weapon-ticket'))void mutate('exchange-ticket');
  else if(b.hasAttribute('data-weapon-fragments'))void mutate('exchange-fragments');
  else if(b.hasAttribute('data-weapon-convert'))void mutate('convert-legacy');
  else if(b.hasAttribute('data-weapon-trial'))window.startQuizFlow?.();
}
function patchTabs(){document.querySelectorAll('[data-training-tab="equipment"]').forEach(b=>{b.hidden=true;b.setAttribute('aria-hidden','true');b.tabIndex=-1;});
  document.querySelectorAll('[data-training-tab="contract"] span').forEach(s=>s.textContent='尋器');}
window.mountWeaponForge=(container,nextView='weapons')=>{identity();patchTabs();if(host!==container){host?.removeEventListener('click',click);host=container;host.addEventListener('click',click);}view=nextView;render();if(!snapshot&&!loading)void refresh();};
window.openWeaponForge=(nextView='weapons')=>{window.switchToPage?.('page-training');patchTabs();const tab=document.querySelector(`[data-training-tab="${nextView==='acquire'?'contract':'refinery'}"]`)||document.querySelector('[data-training-tab="refinery"]');tab?.click();const container=document.getElementById('training-tab-content');if(container)window.mountWeaponForge(container,nextView);};
window.openCultivationRefinery=()=>window.openWeaponForge('weapons');window.openSoulboundDraw=()=>window.openWeaponForge('acquire');window.mountSoulboundTrainingPage=container=>window.mountWeaponForge(container,'acquire');
window.addEventListener('xiuxian:user-data-ready',()=>{identity();patchTabs();});
window.addEventListener('xiuxian:weapon-updated',()=>patchTabs());
patchTabs();
export {icon,render,refresh};
