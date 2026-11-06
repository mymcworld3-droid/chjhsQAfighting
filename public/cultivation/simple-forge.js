import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { ARTIFACT_CATALOG, replaceArtifactCatalog } from './artifact-catalog.js';

(function(){
  'use strict';
  let state=null, busy=false, selected='', pending=null, activeUid='', lastMessage='';
  const auth=()=>{try{return getAuth(getApp()).currentUser;}catch(_){return null;}};
  const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const key=uid=>'simple-forge-pending:'+uid;
  function style(){
    if(document.getElementById('simple-forge-style'))return;
    const el=document.createElement('style');el.id='simple-forge-style';el.textContent=`
      .simple-forge{display:block!important;grid-template-columns:none!important;width:100%;max-width:100%;height:100%;min-height:0;overflow:auto;padding:20px;color:#f5e6c4;background:#111710;font-family:inherit;box-sizing:border-box}
      .sf-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px}.sf-head h2{margin:0;font-size:20px}.sf-head p,.sf-help{margin:5px 0;color:#b7b09c;font-size:13px}.sf-head button,.sf-action,.sf-retry{border:1px solid #b9944c;border-radius:8px;padding:9px 13px;background:#3a301a;color:#ffe4a6;cursor:pointer}.sf-action:disabled{opacity:.45;cursor:not-allowed}
      .sf-summary,.sf-detail,.sf-legacy{border:1px solid #8f75443d;border-radius:12px;background:#1a2119;padding:14px;margin-bottom:14px}.sf-legacy{border-color:#bf9458;color:#ffdaa0}.sf-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(125px,1fr));gap:10px}.sf-card{text-align:center;border:1px solid #b4945638;border-radius:10px;background:#1b241a;color:#eadbbd;padding:10px;cursor:pointer}.sf-card[aria-pressed=true]{border-color:#e4bd70;background:#3a3622}.sf-card img{width:68px;height:68px;object-fit:contain;display:block;margin:auto}.sf-card b,.sf-card small{display:block;margin-top:5px}.sf-card small{color:#b8ae91}.sf-detail p{margin:7px 0}.sf-good{color:#bfe1a2}.sf-bad{color:#f2a59a}.sf-message{color:#f2c985;min-height:1.5em}.sf-detail button{margin-top:8px}
    `;document.head.append(el);
  }
  async function api(method,body){const user=auth();if(!user)throw Error('請先登入');const response=await fetch('/api/simple-forge',{method,headers:{Authorization:'Bearer '+await user.getIdToken(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});let data;try{data=await response.json();}catch(_){throw Error('連線未完成，請重試原操作');}if(!response.ok)throw Object.assign(Error(data.error||'操作失敗'),{status:response.status});return data;}
  function sync(data,includeGold=false){const user=auth(),local=window.getCurrentUserData?.();if(!user||!local||user.uid!==activeUid)return;
    local.artifactSystem=data.artifactSystem;local.materialSystem=data.materialSystem;local.forgeFragments=data.fragments;local.refineryJobV1=data.job;
    if(includeGold){local.stats||={};local.stats.gold=data.gold;}
    window.dispatchEvent(new CustomEvent('artifact-system-updated'));window.dispatchEvent(new CustomEvent('material-system-updated'));window.dispatchEvent(new CustomEvent('xiuxian:stats-updated'));window.dispatchEvent(new CustomEvent('xiuxian:refinery-job-updated',{detail:data.job}));
  }
  async function refresh(apply=false,includeGold=false){const user=auth();if(!user)throw Error('請先登入');const uid=user.uid;const data=await api('GET');if(auth()?.uid!==uid)return;activeUid=uid;state=data;if(apply)sync(data,includeGold);render();}
  const current=()=>document.querySelector('#page-training [data-training-tab="refinery"].active');
  function render(message){
    if (message !== undefined) lastMessage=message;
    if(!current())return;style();const content=document.querySelector('#page-training #training-tab-content');if(!content)return;
    const balance=state?.fragments||0, stones=state?.materialSystem?.inventory||{},list=state?.weapons||[];
    const row=list.find(x=>x.item.id===selected)||null;
    const cards=list.map(x=>`<button class="sf-card" type="button" data-sf-item="${escape(x.item.id)}" aria-pressed="${x.item.id===selected}">${x.item.imageUrl?`<img src="${escape(x.item.imageUrl)}" alt="">`:`<span>${escape(x.item.icon||'◆')}</span>`}<b>${escape(x.item.name)}</b><small>${escape(x.item.realm)} · ${x.stage||'?'} 次煉製 · ×${x.quantity}</small></button>`).join('');
    let detail='<p class="sf-help">選擇一件法器，查看所需資源。</p>';
    if(row){const r=row.requirement;const error=row.error||(!r?'已達三次煉製':'');
      detail=`<h3>${escape(row.item.name)} · ${row.stage||'?'} 次煉製</h3>${error?`<p>${escape(error)}</p>`:`<p>升至第 ${r.stage} 次煉製，沿用原有武器效果並提升數值。</p><p class="${row.quantity>=2?'sf-good':'sf-bad'}">相同法器：${row.quantity} / 2</p><p class="${balance>=r.fragments?'sf-good':'sf-bad'}">煉器碎片：${balance} / ${r.fragments}</p><p class="${(stones[r.stone]||0)>=r.quantity?'sf-good':'sf-bad'}">${r.stage} 階升級石：${stones[r.stone]||0} / ${r.quantity}</p><p class="sf-help">將兩件相同法器合為一件；若已裝備，升階後會自動換成新法器。</p><button class="sf-action" data-sf-upgrade ${busy||pending||state.job||row.quantity<2||balance<r.fragments||(stones[r.stone]||0)<r.quantity?'disabled':''}>確認升階</button>`}`;
    }
    content.innerHTML=`<section class="cultivation-refinery simple-forge"><div class="sf-head"><div><h2>法器升階</h2><p>每次消耗 2 件同款、同煉製次數的武器＋碎片＋對應升階石，即可升階</p></div><button data-inventory-dismantle>分解物品</button></div><div class="sf-summary">煉器碎片 <b>${balance.toLocaleString('zh-TW')}</b>　｜　二階升級石 ${stones['raid-refine-key-ii']||0}　｜　三階升級石 ${stones['raid-refine-key-iii']||0}</div>${state?.job?`<div class="sf-legacy"><b>舊煉製工作</b><p>請先取消舊工作，退還當時投入的法器、舊材料、升階石與費用。</p><button class="sf-action" data-sf-refund ${busy||pending?'disabled':''}>退還舊煉製</button></div>`:''}${pending?'<div class="sf-legacy">上次操作尚待確認，請先重試。 <button class="sf-retry" data-sf-resume>確認上次操作</button></div>':''}<p class="sf-message">${escape(lastMessage)}</p><div class="sf-list">${cards||'<p class="sf-help">尚未持有本命法器，可前往契器台取得。</p>'}</div><div class="sf-detail">${detail}</div></section>`;
    content.querySelectorAll('[data-sf-item]').forEach(button=>button.addEventListener('click',()=>{selected=button.dataset.sfItem;render();}));
    content.querySelector('[data-sf-upgrade]')?.addEventListener('click',()=>operate({action:'upgrade',itemId:selected,expected:row.requirement}));
    content.querySelector('[data-sf-refund]')?.addEventListener('click',()=>operate({action:'refund',jobId:state.job.id}));
    content.querySelector('[data-sf-resume]')?.addEventListener('click',()=>operate(pending,true));
  }
  async function operate(body,resume=false){if(busy)return;const user=auth();if(!user)return;const uid=user.uid;
    if(!resume){body={...body,requestId:crypto.randomUUID().replaceAll('-','')};pending=body;try{localStorage.setItem(key(uid),JSON.stringify(body));}catch(_){pending=null;render('無法儲存操作紀錄，請檢查瀏覽器儲存設定。');return;}}
    busy=true;render();try{const result=await api('POST',body);if(auth()?.uid!==uid)return;
      if(result.item && !ARTIFACT_CATALOG.some(item=>item.id===result.item.id))replaceArtifactCatalog([result.item,...ARTIFACT_CATALOG],'simple-forge');
      pending=null;localStorage.removeItem(key(uid));state=null;selected='';await refresh(true,result.kind==='refund');render(result.kind==='refund'?'舊煉製已退還。':'升階完成！');
    }catch(error){if(auth()?.uid!==uid)return;if(error.status && error.status<500){pending=null;localStorage.removeItem(key(uid));await refresh().catch(()=>{});}render(error.message||'操作尚未確認，請重試。');}finally{busy=false;render();}
  }
  async function open(){const page=document.getElementById('page-training');if(!page?.querySelector('#training-tab-content'))return false;
    page.querySelectorAll('[data-training-tab]').forEach(tab=>{const yes=tab.dataset.trainingTab==='refinery';tab.classList.toggle('active',yes);tab.setAttribute('aria-selected',String(yes));});
    const user=auth();if(user?.uid!==activeUid){state=null;selected='';activeUid=user?.uid||'';try{pending=JSON.parse(localStorage.getItem(key(activeUid))||'null');}catch(_){pending=null;}}
    render('載入中…');try{await refresh();}catch(error){render(error.message||'載入失敗，請重新開啟煉器。');}return true;
  }
  window.openCultivationRefinery=open;
  window.openCultivationRecipe=()=>{open();return true;};
  window.addEventListener('xiuxian:refinery-open-request',open);
})();
