import './forge-fragments.js';
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
  function render(s) {
    if(session!==s)return;
    const rows=s.snapshot?.items||[],selected=chosen(s),total=selected.reduce((n,row)=>n+row.quantity*row.unitFragments,0);
    const unresolved=!!saved(s.uid),filtered=rows.filter(row=>s.filter==='all'||row.type===s.filter);
    const disabled=s.busy||unresolved;
    const contents=s.confirm?`<p class="ids-warning">確認後將扣除以下物品並換成碎片，無法復原。</p><ul class="ids-confirm-list">${selected.map(row=>`<li><span>${esc(row.name)} <small>${esc(row.realm)}</small> ×${row.quantity}</span><b>+${row.quantity*row.unitFragments}</b></li>`).join('')}</ul>`:
      `<div class="ids-tools"><label>種類 <select data-ids-filter ${disabled?'disabled':''}><option value="all" ${s.filter==='all'?'selected':''}>全部</option><option value="material" ${s.filter==='material'?'selected':''}>材料</option><option value="artifact" ${s.filter==='artifact'?'selected':''}>法寶</option></select></label><button type="button" data-ids-all ${disabled?'disabled':''}>全選可分解物品</button><button type="button" data-ids-clear ${disabled?'disabled':''}>清除選擇</button></div>
      <p class="ids-note">裝備中的份數會保留；元嬰碎精與消耗道具不列入分解。一次最多選 100 種。</p>
      <div class="ids-list">${filtered.map((row,i)=>`<article class="ids-row ${s.selected.has(key(row))?'is-selected':''}"><label><input type="checkbox" data-ids-pick="${esc(key(row))}" ${s.selected.has(key(row))?'checked':''} ${disabled||!row.available?'disabled':''}><span class="ids-kind ${row.equipSlot==='本命法寶'?'is-soulbound':''}">${row.type==='material'?'材料':row.equipSlot==='本命法寶'?'本命':'法寶'}</span><span><b>${esc(row.name)}</b><small>${esc(row.realm)} · 持有 ${row.owned}${row.reserved?` · 裝備保留 ${row.reserved}`:''} · 每件 +${row.unitFragments} 碎片</small></span></label><label class="ids-quantity" for="ids-quantity-${i}">數量<input id="ids-quantity-${i}" type="number" inputmode="numeric" min="1" max="${row.available}" value="${s.selected.get(key(row))||1}" data-ids-quantity="${esc(key(row))}" aria-label="${esc(row.name)}分解數量" ${disabled||!s.selected.has(key(row))?'disabled':''}></label></article>`).join('')||`<p class="ids-empty">${s.snapshot?'沒有可分解的物品。':s.busy?'正在同步物品…':'同步未完成，請重新同步。'}</p>`}</div>`;
    s.root.innerHTML=`<section class="ids-panel" role="dialog" aria-modal="true" aria-labelledby="ids-title"><header><div><h2 id="ids-title" tabindex="-1">${s.confirm?'確認分解':'物品分解'}</h2><small>煉器碎片 <b>${Number(s.snapshot?.fragments??window.QAForgeFragments.balance(window.getCurrentUserData?.())).toLocaleString('zh-TW')}</b></small></div><button type="button" data-ids-close aria-label="關閉物品分解" ${s.busy?'disabled':''}>×</button></header>
      <div class="ids-scroll">${unresolved?'<div class="ids-pending"><p>上次分解尚未確認，請先重試原操作。</p><button type="button" data-ids-retry '+(s.busy?'disabled':'')+'>重試上次分解</button></div>':''}${contents}</div>
      <p class="ids-status" role="status" aria-live="polite">${esc(s.message)}</p><footer><div>已選 <b>${selected.reduce((n,row)=>n+row.quantity,0)}</b> 件 · 可得 <strong>${total.toLocaleString('zh-TW')}</strong> 碎片</div><div>${s.confirm?'<button type="button" data-ids-back '+(s.busy?'disabled':'')+'>返回選擇</button><button type="button" class="ids-primary" data-ids-confirm '+(disabled||!selected.length?'disabled':'')+'>'+(s.busy?'分解中…':'確認分解')+'</button>':'<button type="button" data-ids-refresh '+(s.busy?'disabled':'')+'>重新同步</button><button type="button" class="ids-primary" data-ids-review '+(disabled||!selected.length?'disabled':'')+'>查看分解清單</button>'}</div></footer></section>`;
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
      else if(button.hasAttribute('data-ids-review')){s.confirm=true;render(s);root.querySelector('h2')?.focus();}
      else if(button.hasAttribute('data-ids-back')){s.confirm=false;render(s);}
      else if(button.hasAttribute('data-ids-confirm'))void submit(s);
      else if(button.hasAttribute('data-ids-clear')){s.selected.clear();render(s);}
      else if(button.hasAttribute('data-ids-all')){s.selected.clear();for(const row of(s.snapshot?.items||[]).filter(r=>r.available&&(s.filter==='all'||r.type===s.filter)).slice(0,100))s.selected.set(key(row),row.available);render(s);}
    });
    root.addEventListener('change',event=>{
      const input=event.target;if(s.busy||saved(s.uid))return;
      if(input.hasAttribute('data-ids-filter'))s.filter=input.value;
      else if(input.hasAttribute('data-ids-pick')){if(input.checked&&s.selected.size<100)s.selected.set(input.dataset.idsPick,1);else s.selected.delete(input.dataset.idsPick);}
      else if(input.hasAttribute('data-ids-quantity')){const row=s.snapshot.items.find(r=>key(r)===input.dataset.idsQuantity);if(row)s.selected.set(key(row),Math.max(1,Math.min(row.available,Math.floor(Number(input.value)||1))));}
      render(s);
    });
    render(s);root.querySelector('h2')?.focus();void refresh(s);
  }
  document.addEventListener('click',event=>{const button=event.target.closest?.('[data-inventory-dismantle]');if(button&&!button.disabled)open(button);});
  document.addEventListener('keydown',event=>{
    if(!session)return;
    if(event.key==='Escape'){event.preventDefault();close();}
    if(event.key==='Tab'){
      const controls=[...session.root.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];
      const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement))){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!controls.includes(document.activeElement))){event.preventDefault();first?.focus();}
    }
  });
  for(const name of ['xiuxian:user-ready','xiuxian:user-data-ready'])window.addEventListener(name,()=>{if(session&&getMainUser()?.uid!==session.uid)close(true);});
  window.openInventoryDismantle=open;
})();
