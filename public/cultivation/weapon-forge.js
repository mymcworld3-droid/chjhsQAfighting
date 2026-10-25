import './weapon-system-rules.js';
import {ensureInventoryGridStyle} from './inventory-grid-style.js';
import {showWeaponDraw} from './weapon-draw-reveal.js';
import {authenticatedMainFetch,getMainUser} from './data/project-repository.js';

const W=globalThis.QAWeapons;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let host=null,view='weapons',selected='',snapshot=null,owner='',serial=0,busy=false,loading=false,message='',pending=null,payment='ticket',detail=null,destroyDraw=null;
const current=()=>window.getCurrentUserData?.()||{};
const pendingKey=uid=>'weapon-forge-pending:'+uid;
const valid=(uid,epoch)=>owner===uid&&getMainUser()?.uid===uid&&serial===epoch;
const activeTab=()=>document.querySelector('#page-training [data-training-tab].active')?.dataset.trainingTab;
function closeDetail(restore=true){detail?.close();detail?.remove();detail=null;const previous=selected;selected='';if(restore)host?.querySelector(`[data-weapon-select="${previous}"]`)?.focus();}
function identity(){const uid=getMainUser()?.uid||'';if(owner!==uid){closeDetail(false);destroyDraw?.();destroyDraw=null;owner=uid;serial++;snapshot=null;busy=false;loading=false;message='';payment='ticket';try{pending=JSON.parse(localStorage.getItem(pendingKey(uid))||'null');}catch(_){pending=null;}}return uid;}
function icon(type){
  const paths={bow:'M25 10 Q82 50 25 90 M25 10 L49 50 25 90 M18 50 H85 M73 41 L85 50 73 59',spear:'M22 86 L72 24 M64 27 L82 9 78 35 72 24 M18 78 L30 88',
    sword:'M22 82 L67 27 M57 31 L81 10 72 42 M37 56 L54 70 M18 88 L27 84',saber:'M19 85 L40 60 Q70 48 82 12 Q89 50 51 75 M31 57 L51 78',
    hammer:'M23 87 L61 45 M43 36 L62 15 87 37 68 58 Z M48 33 L73 54'};
  return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path d="${paths[type]}" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function apply(payload){if(!snapshot)payment=payload.state.chests?'chest':payload.tickets?'ticket':'gold';snapshot=payload;const user=current();user.weaponSystemV1=payload.state;user.stats||={};user.stats.gold=payload.balance;user.forgeFragments=payload.fragments;user.soulboundDrawTickets=payload.tickets;
  window.updateUIStats?.();window.dispatchEvent(new CustomEvent('xiuxian:weapon-updated',{detail:{state:payload.state}}));}
async function request(action='',body){const res=await authenticatedMainFetch('/api/weapons'+(action?'/'+action:''),{...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
  const payload=await res.json().catch(()=>({}));if(!res.ok||payload.ok!==true)throw Object.assign(Error(payload.error||'兵器服務暫時無法連線'),{definitive:res.status>=400&&res.status<500});return payload;}
async function refresh(){const uid=identity(),epoch=serial;if(!uid||loading)return;loading=true;render();try{const payload=await request();if(valid(uid,epoch))apply(payload);}
  catch(e){if(valid(uid,epoch))message=e.message;}finally{if(valid(uid,epoch)){loading=false;render();}}}
function remember(operation){pending=operation;try{if(operation)localStorage.setItem(pendingKey(owner),JSON.stringify(operation));else localStorage.removeItem(pendingKey(owner));}catch(_){}}
function resultMessage(payload){const r=payload.result||{};if(r.action==='draw')return `抽得 ${r.count} 把兵器，已收入兵器庫。`;
  if(payload.replayed)return '操作已完成，已同步最新兵器。';
  if(r.action==='upgrade')return `${W.get(r.type).name}進階至${W.realmFor(r).name}境。`;
  if(r.action==='equip')return '主武器已更換，下一場戰鬥生效。';
  if(r.action==='convert-legacy')return `傳承完成：兵器匣 ×${r.chests}、靈石 +${r.gold}。`;
  return `獲得兵器匣 ×${r.chests||1}。`;
}
function present(draw,opening=true){const uid=identity(),epoch=serial;if(!draw||!host?.isConnected)return;closeDetail(false);destroyDraw?.();
  destroyDraw=showWeaponDraw({draw,icon,opening,isCurrent:()=>valid(uid,epoch),onClose:toForge=>{destroyDraw=null;message='';if(toForge)view='weapons';render();host?.querySelector(toForge?'[data-weapon-select]':'[data-weapon-last-draw]')?.focus();}});}
async function mutate(action,body={},retry=false){
  const uid=identity(),epoch=serial;if(!uid||busy||loading||pending&&!retry)return;
  const operation=retry?pending:{action,body:{...body,requestId:crypto.randomUUID()}};if(!operation)return;
  remember(operation);busy=true;message='正在同步…';render();let draw=null;
  try{const payload=await request(operation.action,operation.body);if(!valid(uid,epoch))return;remember(null);apply(payload);message=resultMessage(payload);
    if(payload.result?.action==='draw')draw=payload.result;
    else if(!payload.replayed&&operation.action==='upgrade')window.QAGameAudio?.play?.('reward-chime');
  }catch(e){if(valid(uid,epoch)){message=e.message+(e.definitive?'':'，請按「重試原操作」。');if(e.definitive)remember(null);}}
  finally{if(valid(uid,epoch)){busy=false;render();}}
  if(draw&&valid(uid,epoch)&&['refinery','contract','equipment'].includes(activeTab())&&document.getElementById('page-training')?.classList.contains('active-page'))present(draw);
}
function cards(state){return W.TYPES.filter(t=>state.weapons[t.id]).map(t=>{const row=state.weapons[t.id];return `<button type="button" class="uib-item wf-weapon" data-weapon-select="${t.id}" style="--uib-quality:${t.color}" aria-label="查看${t.name}，${W.realmFor(row).name}境，持有 ${row.copies} 把${state.equipped===t.id?'，主武器':''}"><span class="uib-qty">×${row.copies}</span>${state.equipped===t.id?'<span class="uib-equipped">主</span>':''}<span class="uib-icon">${icon(t.id)}</span><span class="uib-name">${t.name}</span><span class="uib-bottom"><small>${t.label}</small><em>${W.realmFor(row).name}</em></span></button>`;}).join('');}
function renderDetail(){if(!detail)return;const row=snapshot?.state.weapons[selected],t=W.get(selected);if(!row||!t){closeDetail(false);return;}
  const focused=document.activeElement?.hasAttribute('data-weapon-promote')?'[data-weapon-promote]':'[data-weapon-equip]',hadFocus=detail.contains(document.activeElement);
  const fee=W.promotion(row,snapshot.playerRealmScore,snapshot.canAscendToImmortal),spares=row.copies-1,locked=busy||loading||!!pending,ready=fee.eligible&&spares>=fee.copies&&snapshot.balance>=fee.gold;
  detail.innerHTML=`<section class="uib-modal wf-detail" role="document" style="--uib-quality:${t.color}"><div class="uib-modal-head"><div class="uib-modal-icon">${icon(t.id)}</div><div><small>主武器 · ${t.label}</small><h3 id="wf-detail-title">${t.name}</h3><span>${W.realmFor(row).name}境 · 持有 ×${row.copies}</span></div><button type="button" class="uib-close" data-weapon-close aria-label="關閉兵器詳情">×</button></div><div class="uib-description">${t.description}<br>消耗 ${t.cost} 體力 · 攻擊加成 +${Number((W.realmIndex(row)*W.ATTACK_PER_REALM*100).toFixed(1))}%</div><button type="button" class="uib-equip-btn" data-weapon-equip="${t.id}" ${locked||snapshot.state.equipped===t.id?'disabled':''}>${snapshot.state.equipped===t.id?'正在使用':'裝配為主武器'}</button><div class="uib-detail-section wf-upgrade"><span>境界進階 · ${fee.current.name}${fee.next?' → '+fee.next.name:' · 已達最高境界'}</span>${fee.next?`<p class="wf-realm-gate">修士門檻：${fee.next.requiresImmortal?'半仙及相應學段真仙席位':fee.next.name+'境（'+fee.next.need+' 修為）'} · ${fee.eligible?'已達到':'尚未達到'}</p><p>同款副本 ${spares} / ${fee.copies} 把 · 靈石 ${snapshot.balance.toLocaleString('zh-TW')} / ${fee.gold.toLocaleString('zh-TW')}</p><button type="button" class="uib-use-btn wf-promote" data-weapon-promote ${locked||!ready?'disabled':''}>進階至${fee.next.name}境</button><p>同時消耗 ${fee.copies} 把同款副本與 ${fee.gold.toLocaleString('zh-TW')} 靈石，保留主武器。</p>`:'<p>已達真仙境。</p>'}</div><p class="wf-message" role="status" ${message?'':'hidden'}>${esc(message)}</p>${pending&&!busy?'<button type="button" class="uib-use-btn" data-weapon-retry>重試原操作</button>':''}<small class="wf-detail-note">裝配、進階在下一場戰鬥生效。</small></section>`;
  if(hadFocus)(detail.querySelector(focused+':not(:disabled)')||detail.querySelector('[data-weapon-close]'))?.focus();
}
function openDetail(type){if(!snapshot?.state.weapons[type])return;closeDetail(false);selected=type;detail=document.createElement('dialog');detail.className='uib-modal-backdrop wf-detail-overlay';detail.setAttribute('aria-labelledby','wf-detail-title');detail.addEventListener('click',event=>{if(event.target===detail)closeDetail();else click(event);});detail.addEventListener('cancel',event=>{event.preventDefault();closeDetail();});document.body.append(detail);renderDetail();detail.showModal();}
function balanceFor(method){return method==='chest'?snapshot.state.chests:method==='ticket'?snapshot.tickets:method==='gold'?snapshot.balance:snapshot.fragments;}
function acquireMarkup(s,locked){const legacy=snapshot.legacy,hasLegacy=legacy.equipmentCopies||legacy.materialCount||legacy.pendingJob;
  return `<section class="wf-acquire"><div class="wf-pool" aria-label="隨機兵器獎池">${W.TYPES.map(t=>`<div style="--weapon-ink:${t.color}"><span>${icon(t.id)}</span><b>${t.label}</b><small>20%</small></div>`).join('')}</div><p>每抽必得一把煉氣兵器；同款可用於境界進階。</p>${!s.starterClaimed?`<button type="button" class="wf-primary" data-weapon-free ${locked?'disabled':''}>首次免費抽取</button>`:''}<label class="wf-payment">使用<select data-weapon-payment ${locked?'disabled':''}>${['chest','ticket','gold','fragments'].map(method=>`<option value="${method}" ${payment===method?'selected':''}>${W.PAYMENTS[method].label} · 持有 ${balanceFor(method).toLocaleString('zh-TW')}</option>`).join('')}</select></label><div class="wf-draw-actions">${[1,5].map(count=>`<button type="button" data-weapon-draw="${count}" ${locked||balanceFor(payment)<W.drawCost(payment,count)?'disabled':''}>${count===1?'單抽':'五連抽'}<small>${W.drawCost(payment,count).toLocaleString('zh-TW')} ${W.PAYMENTS[payment].label}</small></button>`).join('')}</div>${s.lastDraw?'<button type="button" data-weapon-last-draw>重看上次結果</button>':''}${snapshot.pendingTrialChests?`<button type="button" data-weapon-claim ${locked?'disabled':''}>領取試煉兵器匣 ×${snapshot.pendingTrialChests}</button>`:''}<details class="wf-extra"><summary>抽取來源與舊資產</summary><p>問道試煉每關首通獲得 1 匣，每五關額外 1 匣。原契器券可直接使用，由任務與閉關取得；亦可使用靈石或煉器碎片抽取。</p><button type="button" data-weapon-trial ${locked?'disabled':''}>前往問道試煉</button>${hasLegacy?`<div class="wf-legacy"><p>舊裝備 ${legacy.equipmentCopies} 件、舊材料 ${legacy.materialCount} 個，可轉換為 ${legacy.chests} 個兵器匣與 ${legacy.gold} 靈石。${legacy.pendingJob?'未完成的煉製會退回投入，另返還 '+legacy.refundFragments+' 碎片。':''}</p><button type="button" data-weapon-convert ${locked?'disabled':''}>確認轉換上述舊資產</button></div>`:''}</details></section>`;
}
function render(){if(!host?.isConnected)return;const active=activeTab();if(active&&!['refinery','contract','equipment'].includes(active)){closeDetail(false);return;}
  if(!snapshot){host.innerHTML=`<section class="wf-page"><b>鍛造坊</b><p role="status">${esc(message||'正在整理兵器…')}</p><button type="button" data-weapon-refresh ${loading?'disabled':''}>重新同步</button></section>`;return;}
  const s=snapshot.state,equipped=W.get(s.equipped),row=s.weapons[s.equipped],locked=busy||loading||!!pending,owned=Object.keys(s.weapons).length;
  host.innerHTML=`<section class="wf-page uib-root" aria-label="${view==='acquire'?'尋器抽取':'鍛造坊兵器庫'}"><div class="uib-toolbar"><div class="uib-summary"><b>${view==='acquire'?'尋器':'鍛造坊'}</b><span>${view==='acquire'?'隨機獲得兵器':owned+' 種兵器'}</span></div><span class="wf-balance">${snapshot.balance.toLocaleString('zh-TW')} 靈石</span><button type="button" data-weapon-view="${view==='acquire'?'weapons':'acquire'}">${view==='acquire'?'兵器庫':'尋器 →'}</button><button type="button" data-weapon-refresh aria-label="重新同步兵器" ${busy||loading?'disabled':''}>同步</button></div><p class="wf-message" role="status" ${message?'':'hidden'}>${esc(message)}</p>${pending&&!busy?'<button type="button" data-weapon-retry>重試原操作</button>':''}${view==='acquire'?acquireMarkup(s,locked):`${equipped?`<button type="button" class="wf-equipped" data-weapon-select="${equipped.id}"><span>${icon(equipped.id)}</span><b>主武器 · ${equipped.name}</b><small>${W.realmFor(row).name}境</small></button>`:'<p class="wf-equipped">尚未裝配主武器</p>'}<div class="uib-grid wf-weapons" aria-label="已持有武器">${cards(s)}</div>${owned?'<p class="wf-hint">點選武器以裝配或進階。</p>':'<div class="uib-empty"><b>尚無兵器</b><button type="button" data-weapon-view="acquire">前往尋器</button></div>'}`}</section>`;
  renderDetail();
}
function draw(count,method=payment){void mutate('draw',{count,payment:method,poolVersion:W.DRAW_VERSION,expectedCost:W.drawCost(method,count)});}
function click(event){const b=event.target.closest('button');if(!b||b.disabled)return;
  if(b.hasAttribute('data-weapon-close'))closeDetail();
  else if(b.dataset.weaponSelect)openDetail(b.dataset.weaponSelect);
  else if(b.dataset.weaponView){closeDetail(false);view=b.dataset.weaponView;message='';render();}
  else if(b.hasAttribute('data-weapon-refresh'))void refresh();
  else if(b.hasAttribute('data-weapon-retry'))void mutate('',{},true);
  else if(b.hasAttribute('data-weapon-free'))draw(1,'free');
  else if(b.dataset.weaponDraw)draw(Number(b.dataset.weaponDraw));
  else if(b.hasAttribute('data-weapon-last-draw'))present(snapshot.state.lastDraw,false);
  else if(b.dataset.weaponEquip)void mutate('equip',{type:b.dataset.weaponEquip});
  else if(b.hasAttribute('data-weapon-promote'))void mutate('upgrade',{type:selected,expectedRealm:snapshot.state.weapons[selected]?.realm});
  else if(b.hasAttribute('data-weapon-claim'))void mutate('claim-trial');
  else if(b.hasAttribute('data-weapon-convert'))void mutate('convert-legacy');
  else if(b.hasAttribute('data-weapon-trial'))window.startQuizFlow?.();
}
function change(event){if(event.target.matches('[data-weapon-payment]')&&['chest','ticket','gold','fragments'].includes(event.target.value)){payment=event.target.value;render();}}
function patchTabs(){document.querySelectorAll('[data-training-tab="equipment"]').forEach(b=>{b.hidden=true;b.setAttribute('aria-hidden','true');b.tabIndex=-1;});document.querySelectorAll('[data-training-tab="contract"] span').forEach(s=>s.textContent='尋器');}
window.mountWeaponForge=(container,nextView='weapons')=>{identity();ensureInventoryGridStyle();patchTabs();if(host!==container){closeDetail(false);host?.removeEventListener('click',click);host?.removeEventListener('change',change);host=container;host.addEventListener('click',click);host.addEventListener('change',change);}view=nextView;render();if(!snapshot&&!loading)void refresh();};
window.openWeaponForge=(nextView='weapons')=>{window.switchToPage?.('page-training');patchTabs();const tab=document.querySelector(`[data-training-tab="${nextView==='acquire'?'contract':'refinery'}"]`)||document.querySelector('[data-training-tab="refinery"]');tab?.click();const container=document.getElementById('training-tab-content');if(container)window.mountWeaponForge(container,nextView);};
window.openCultivationRefinery=()=>window.openWeaponForge('weapons');window.openSoulboundDraw=()=>window.openWeaponForge('acquire');window.mountSoulboundTrainingPage=container=>window.mountWeaponForge(container,'acquire');
window.addEventListener('xiuxian:user-data-ready',()=>{identity();patchTabs();});window.addEventListener('xiuxian:weapon-updated',patchTabs);
document.addEventListener('click',event=>{if(event.target.closest('[data-training-tab],#nav-grid button'))closeDetail(false);},true);
patchTabs();
export {icon,render,refresh};
