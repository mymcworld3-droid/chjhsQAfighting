import './forge-fragments.js';
import { soulboundItemFrameMarkup } from './soulbound-item-frame.js';
import { getArtifactById, artifactRealmColor } from './artifact-catalog.js';
import { getMaterialById, materialRealmColor } from './material-catalog.js';
import { authenticatedMainFetch, getMainUser } from './data/project-repository.js';

(function () {
  'use strict';
  const ID = 'inventory-dismantle-modal';
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const key = row => row.type+':'+row.id;
  const storageKey = uid => 'inventory-dismantle-operation:'+uid;
  let session = null;
  function saved(uid) {try{return JSON.parse(localStorage.getItem(storageKey(uid))||'null');}catch(_){return null;}}
  function forget(uid) {try{localStorage.removeItem(storageKey(uid));}catch(_){/* Receipt still prevents replay. */}}
  function close(force=false) {
    if (!session || (session.busy && !force)) return;
    const trigger=session.trigger;session.root.remove();session=null;
    if(trigger?.isConnected)trigger.focus();
  }
  async function request(body) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await authenticatedMainFetch('/api/inventory/dismantle',{...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:controller.signal});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||payload.ok!==true)throw Object.assign(new Error(payload.error||'分解暫時無法使用'),{definitive:payload.ok===false&&response.status>=400&&response.status<500});
      return payload;
    }catch(e){if(e.name==='AbortError')throw new Error('結果尚未確認，請重試原操作；不會重複分解。');throw e;}
    finally{clearTimeout(timer);}
  }
  function apply(payload,uid) {
    if(getMainUser()?.uid!==uid)return;
    const data=window.getCurrentUserData?.();
    if(!data)return;
    data.forgeFragments=payload.fragments;
    data.artifactSystem||={};data.artifactSystem.inventory={...payload.artifactInventory};
    data.materialSystem||={};data.materialSystem.inventory={...payload.materialInventory};
    window.updateUIStats?.();
    for(const name of ['artifact-system-updated','material-system-updated','xiuxian:stats-updated'])window.dispatchEvent(new CustomEvent(name,{detail:{source:'dismantle',forgeFragments:payload.fragments}}));
  }
  function chosen(s) {return(s.snapshot?.items||[]).filter(row=>s.selected.has(key(row))).map(row=>({...row,quantity:s.selected.get(key(row))}));}
  function itemMarkup(row, area, s, disabled) {
    const id=key(row), selected=s.selected.has(id), soulbound=row.equipSlot==='本命法寶';
    const item=row.type==='artifact'?getArtifactById(row.id):getMaterialById(row.id);
    const color=(row.type==='artifact'?artifactRealmColor:materialRealmColor)(row.realm);
    const imageUrl=(soulbound||row.type==='material')?String(item?.imageUrl||''):'';
    const fallback=esc(item?.icon||(row.type==='material'?'材':'◆'));
    const icon=imageUrl?`<img src="${esc(imageUrl)}" alt="" loading="lazy" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span hidden>${fallback}</span>`:fallback;
    const left=area==='selected', quantity=left?s.selected.get(id):row.owned;
    const blocked=disabled||(!left&&(selected||!row.available||s.selected.size>=100));
    const action=left?'移回玩家背包':selected?'已加入待分解':!row.available?'裝備中，無可分解份數':'加入待分解';
    return `<article class="ids-grid-entry"><button type="button" class="ids-item is-${row.type}${soulbound?' is-soulbound':''}${!left&&selected?' is-selected':''}${!row.available?' is-locked':''}" ${left?'data-ids-remove':'data-ids-add'}="${esc(id)}" style="--ids-quality:${esc(color)}" aria-label="${esc(action+'：'+row.name)}" title="${esc(row.name+' · '+row.realm+' · 每件 '+row.unitFragments+' 碎片'+(row.reserved?' · 裝備保留 '+row.reserved:''))}" ${blocked?'disabled':''}>
      <span class="ids-qty">×${quantity}</span>${!left&&selected?'<span class="ids-selected-marker">已選</span>':''}<span class="ids-icon">${soulbound?soulboundItemFrameMarkup():''}${icon}</span><b class="ids-name">${esc(row.name)}</b><span class="ids-meta">${esc(row.realm)}${!left&&row.reserved?' · 保留 '+row.reserved:''}</span>
      </button>${left?`<label class="ids-quantity">數量<input type="number" inputmode="numeric" min="1" max="${row.available}" value="${quantity}" data-ids-quantity="${esc(id)}" aria-label="${esc(row.name)}分解數量" ${disabled?'disabled':''}></label>`:''}</article>`;
  }
  function emptySlots(count=8) {return '<div class="ids-slot-empty" aria-hidden="true"></div>'.repeat(Math.max(0,count));}
  function focusItem(s,attribute,value) {
    [...s.root.querySelectorAll('['+attribute+']')].find(node=>node.getAttribute(attribute)===value)?.focus({preventScroll:true});
  }
  function render(s) {
    if(session!==s)return;
    const scrolls=[...s.root.querySelectorAll('[data-ids-pane-scroll]')].map(node=>node.scrollTop);
    const active=document.activeElement,quantityFocus=active?.getAttribute('data-ids-quantity');
    const filterFocused=active?.hasAttribute('data-ids-filter');
    const rows=s.snapshot?.items||[],selected=chosen(s),total=selected.reduce((n,row)=>n+row.quantity*row.unitFragments,0);
    const unresolved=!!saved(s.uid),filtered=rows.filter(row=>s.filter==='all'||row.type===s.filter);
    const disabled=s.busy||unresolved,quantity=selected.reduce((n,row)=>n+row.quantity,0);
    const confirmation=s.confirm?`<div class="ids-confirm-layer"><section class="ids-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="ids-confirm-title"><h3 id="ids-confirm-title" tabindex="-1">確認本次分解</h3><p class="ids-warning">確認後將扣除以下物品並換成碎片，無法復原。</p><ul class="ids-confirm-list">${selected.map(row=>`<li><span>${esc(row.name)} <small>${esc(row.realm)}</small> ×${row.quantity}</span><b>+${row.quantity*row.unitFragments}</b></li>`).join('')}</ul><div class="ids-confirm-reward">將獲得 <strong>${total.toLocaleString('zh-TW')}</strong> 煉器碎片</div>${unresolved&&!s.busy&&s.message?`<p class="ids-confirm-status" role="status">${esc(s.message)}</p>`:''}<div class="ids-confirm-actions"><button type="button" data-ids-back ${s.busy?'disabled':''}>返回選擇</button>${unresolved&&!s.busy?'<button type="button" class="ids-primary" data-ids-retry>重試本次分解</button>':`<button type="button" class="ids-primary" data-ids-confirm ${disabled||!selected.length?'disabled':''}>${s.busy?'分解中…':'確認分解'}</button>`}</div></section></div>`:'';
    s.root.innerHTML=`<section class="ids-panel" role="dialog" aria-modal="true" aria-labelledby="ids-title"><header class="ids-header"><div><h2 id="ids-title" tabindex="-1">物品分解</h2><small>現有煉器碎片 <b>${Number(s.snapshot?.fragments??window.QAForgeFragments.balance(window.getCurrentUserData?.())).toLocaleString('zh-TW')}</b></small></div><div class="ids-header-actions"><button type="button" data-ids-refresh ${s.busy||s.confirm?'disabled':''}>重新同步</button><button type="button" data-ids-close aria-label="關閉物品分解" ${s.busy?'disabled':''}>×</button></div></header>
      ${unresolved&&!s.confirm?'<div class="ids-pending"><span>上次分解尚未確認，請先重試原操作。</span><button type="button" data-ids-retry '+(s.busy?'disabled':'')+'>重試上次分解</button></div>':''}
      <div class="ids-workspace" ${s.confirm?'inert aria-hidden="true"':''}>
        <section class="ids-bag-pane ids-selected-pane" aria-label="待分解背包"><div class="ids-tools ids-selected-tools"><button type="button" data-ids-clear ${disabled||!selected.length?'disabled':''}>清空</button></div>
          <div class="ids-pane-scroll" data-ids-pane-scroll="selected">${!selected.length?'<p class="ids-empty-message">點右側物品，放入此處</p>':''}<div class="ids-backpack-grid">${selected.map(row=>itemMarkup(row,'selected',s,disabled)).join('')}${emptySlots(8-selected.length)}</div></div>
          <footer class="ids-selected-footer"><small>分解後將獲得</small><div class="ids-reward" aria-live="polite"><span aria-hidden="true">✦</span><strong data-ids-reward-total>${total.toLocaleString('zh-TW')}</strong><span>煉器碎片</span></div><span class="ids-selection-count">已選 ${quantity} 件</span><button type="button" class="ids-primary" data-ids-review ${disabled||!selected.length?'disabled':''}>確定分解</button></footer>
        </section>
        <section class="ids-bag-pane ids-owned-pane" aria-label="玩家背包"><div class="ids-tools"><label>種類 <select data-ids-filter ${disabled?'disabled':''}><option value="all" ${s.filter==='all'?'selected':''}>全部</option><option value="material" ${s.filter==='material'?'selected':''}>材料</option><option value="artifact" ${s.filter==='artifact'?'selected':''}>法寶</option></select></label><button type="button" data-ids-all ${disabled||!filtered.some(row=>row.available)?'disabled':''}>全選</button></div>
          <div class="ids-pane-scroll" data-ids-pane-scroll="owned">${!filtered.length?`<p class="ids-empty-message">${s.snapshot?'沒有此類物品':s.busy?'正在同步物品…':'請重新同步'}</p>`:''}<div class="ids-backpack-grid">${filtered.map(row=>itemMarkup(row,'owned',s,disabled)).join('')}${emptySlots(8-filtered.length)}</div></div><p class="ids-note">裝備中的份數會保留</p>
        </section>
      </div><p class="ids-status" role="status" aria-live="polite">${esc(s.message)}</p>${confirmation}</section>`;
    [...s.root.querySelectorAll('[data-ids-pane-scroll]')].forEach((node,i)=>{node.scrollTop=scrolls[i]||0;});
    if(quantityFocus)focusItem(s,'data-ids-quantity',quantityFocus);
    else if(filterFocused)s.root.querySelector('[data-ids-filter]')?.focus({preventScroll:true});
  }
  async function refresh(s) {
    if(s.busy||getMainUser()?.uid!==s.uid)return;
    s.busy=true;s.confirm=false;s.selected.clear();render(s);
    try{const payload=await request();if(getMainUser()?.uid!==s.uid)return;s.snapshot=payload;s.message='';}
    catch(e){s.message=e.message;}finally{s.busy=false;render(s);}
  }
  async function submit(s,retry=false) {
    if(s.busy||getMainUser()?.uid!==s.uid)return;
    let body=retry?saved(s.uid):null;
    if(!retry){
      if(!s.confirm)return;
      const rows=chosen(s);if(!rows.length)return;
      body={requestId:crypto.randomUUID(),confirmed:true,items:rows.map(({type,id,quantity})=>({type,id,quantity})),expectedFragments:rows.reduce((n,row)=>n+row.quantity*row.unitFragments,0)};
      try{localStorage.setItem(storageKey(s.uid),JSON.stringify(body));}catch(_){s.message='無法保存分解請求，請先允許儲存後重試。';render(s);return;}
    }
    if(!body)return;
    s.busy=true;render(s);
    try{
      const payload=await request(body);
      if(getMainUser()?.uid!==s.uid)return;
      forget(s.uid);s.snapshot=payload;s.selected.clear();s.confirm=false;
      s.message=`已分解 ${payload.result.items.reduce((n,row)=>n+row.quantity,0)} 件，獲得 ${payload.result.fragments} 煉器碎片。`;
      apply(payload,s.uid);
    }catch(e){if(getMainUser()?.uid===s.uid){if(e.definitive){forget(s.uid);s.confirm=false;s.selected.clear();}s.message=e.message;}}
    finally{s.busy=false;render(s);}
  }
  function open(trigger=document.activeElement) {
    const uid=getMainUser()?.uid;
    if(!uid){window.showToast?.('請先登入');return;}
    if(session?.uid===uid){session.root.querySelector('h2')?.focus();return;}
    close(true);
    if(!document.getElementById('inventory-dismantle-style')){const css=document.createElement('link');css.id='inventory-dismantle-style';css.rel='stylesheet';css.href='/styles/inventory-dismantle.css';document.head.append(css);}
    const root=document.createElement('div');root.id=ID;root.className='ids-backdrop';document.body.append(root);
    const s=session={uid,root,trigger,selected:new Map(),snapshot:null,busy:false,confirm:false,filter:'all',message:''};
    root.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||button.disabled)return;
      if(button.hasAttribute('data-ids-close'))close();
      else if(button.hasAttribute('data-ids-refresh'))void refresh(s);
      else if(button.hasAttribute('data-ids-retry'))void submit(s,true);
      else if(button.hasAttribute('data-ids-review')){s.confirm=true;render(s);root.querySelector('#ids-confirm-title')?.focus();}
      else if(button.hasAttribute('data-ids-back')){s.confirm=false;render(s);root.querySelector('[data-ids-review]')?.focus();}
      else if(button.hasAttribute('data-ids-confirm'))void submit(s);
      else if(button.hasAttribute('data-ids-add')){
        if(s.busy||saved(s.uid)||s.selected.size>=100)return;
        const id=button.dataset.idsAdd,row=s.snapshot?.items.find(row=>key(row)===id);
        if(!row?.available||s.selected.has(id))return;
        s.selected.set(id,1);render(s);focusItem(s,'data-ids-remove',id);
      }
      else if(button.hasAttribute('data-ids-remove')){
        if(s.busy||saved(s.uid))return;
        const id=button.dataset.idsRemove;s.selected.delete(id);render(s);focusItem(s,'data-ids-add',id);
      }
      else if(button.hasAttribute('data-ids-clear')){s.selected.clear();render(s);}
      else if(button.hasAttribute('data-ids-all')){s.selected.clear();for(const row of(s.snapshot?.items||[]).filter(r=>r.available&&(s.filter==='all'||r.type===s.filter)).slice(0,100))s.selected.set(key(row),row.available);render(s);}
    });
    root.addEventListener('change',event=>{
      const input=event.target;if(s.busy||saved(s.uid))return;
      if(input.hasAttribute('data-ids-filter'))s.filter=input.value;
      else if(input.hasAttribute('data-ids-quantity')){const row=s.snapshot.items.find(r=>key(r)===input.dataset.idsQuantity);if(row)s.selected.set(key(row),Math.max(1,Math.min(row.available,Math.floor(Number(input.value)||1))));}
      render(s);
    });
    render(s);root.querySelector('h2')?.focus();void refresh(s);
  }
  document.addEventListener('click',event=>{const button=event.target.closest?.('[data-inventory-dismantle]');if(button&&!button.disabled)open(button);});
  document.addEventListener('keydown',event=>{
    if(!session)return;
    if(event.key==='Escape'){event.preventDefault();if(session.confirm&&!session.busy){session.confirm=false;render(session);session.root.querySelector('[data-ids-review]')?.focus();}else close();}
    if(event.key==='Tab'){
      const scope=session.root.querySelector('.ids-confirmation')||session.root;
      const controls=[...scope.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];
      const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement))){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!controls.includes(document.activeElement))){event.preventDefault();first?.focus();}
    }
  });
  for(const name of ['xiuxian:user-ready','xiuxian:user-data-ready'])window.addEventListener(name,()=>{if(session&&getMainUser()?.uid!==session.uid)close(true);});
  window.openInventoryDismantle=open;
})();
