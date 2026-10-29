import './spirit-farm-rules.js';
import { getMainUser, authenticatedMainFetch } from './data/project-repository.js';

const Rules=globalThis.QASpiritFarmRules, KEY='xiuxian:spirit-farm-pending:v1:';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let account='',snapshot=null,selected=0,seed='jade',busy=false,serial=0,clockOffset=0,timer=null,notice='',failed=false;
const pendingMemory=new Map();
const visible=()=>$('page-spirit-farm')?.classList.contains('active-page')&&!$('page-spirit-farm')?.classList.contains('hidden');
const current=()=>Date.now()+clockOffset;
function pending(uid=account){if(pendingMemory.has(uid))return pendingMemory.get(uid);try{const value=JSON.parse(localStorage.getItem(KEY+uid)||'null');pendingMemory.set(uid,value);return value;}catch(_){return null;}}
function storePending(uid,op){pendingMemory.set(uid,op||null);try{if(op)localStorage.setItem(KEY+uid,JSON.stringify(op));else localStorage.removeItem(KEY+uid);}catch(_){}}
function align(){const uid=getMainUser()?.uid||'';if(uid===account)return;account=uid;snapshot=null;busy=false;selected=0;seed='jade';notice='';failed=false;serial++;render();updateEntrance();}
function status(text,error=false){notice=text;failed=error;const node=$('farm-status');if(node){node.textContent=text;node.classList.toggle('is-error',error);}}
function art(id,classes=''){return `<span class="farm-herb farm-herb-${esc(id)} ${classes}" aria-hidden="true"></span>`;}
function names(cost){return Object.entries(cost||{}).map(([id,n])=>`${Rules.crop(id)?.name||id} ×${n}`).join('、');}
function canPay(cost){return Object.entries(cost||{}).every(([id,n])=>(snapshot?.harvest?.[id]||0)>=n);}
function timeText(ms){if(ms<=0)return '可採收';const minutes=Math.ceil(ms/60000);return minutes>=60?`${Math.floor(minutes/60)} 小時 ${minutes%60} 分`:`${minutes} 分鐘`;}
function readyPlots(){return snapshot?.plots?.filter(p=>!p.locked&&!p.empty&&p.readyAt<=current())||[];}
function updateEntrance(){const button=$('spirit-farm-entrance');if(!button)return;const ready=account===getMainUser()?.uid&&readyPlots().length>0;button.querySelector('.refinery-ready-dot').hidden=!ready;button.setAttribute('aria-label',ready?'靈田，有靈草可採收':'進入靈田');}
function plotHTML(p){
  const active=p.index===selected,base=`type="button" class="farm-plot ${active?'is-selected':''} ${p.locked?'is-locked':''}" data-farm-plot="${p.index}" style="--farm-depth:${Math.floor(p.index/3)+1}" aria-pressed="${active}"`;
  if(p.locked)return `<button ${base} aria-label="第 ${p.index+1} 畦，尚未開墾"><span class="farm-plot-number">${p.index+1}</span><span class="farm-soil-mark" aria-hidden="true">鎖</span><span class="farm-plot-label">待開墾</span></button>`;
  if(p.empty)return `<button ${base} aria-label="第 ${p.index+1} 畦，空田，可種植"><span class="farm-plot-number">${p.index+1}</span><span class="farm-soil-mark" aria-hidden="true">＋</span><span class="farm-plot-label">種植</span></button>`;
  const ready=p.readyAt<=current(),progress=Math.max(0,Math.min(1,(current()-p.plantedAt)/Math.max(1,p.readyAt-p.plantedAt)));
  return `<button ${base} data-ready-at="${p.readyAt}" data-planted-at="${p.plantedAt}" aria-label="第 ${p.index+1} 畦，${esc(p.name)}，${ready?'可採收':timeText(p.readyAt-current())}"><span class="farm-plot-number">${p.index+1}</span>${art(p.cropId,ready?'is-mature':progress<.5?'is-sprout':'is-growing')}<span class="farm-plot-label" data-farm-countdown="${p.readyAt}">${ready?'可採收':timeText(p.readyAt-current())}</span>${p.pest?'<span class="farm-pest" title="靈蟲靠近，可驅散提升品質">蟲</span>':''}</button>`;
}
function detailHTML(){
  const p=snapshot?.plots?.[selected];if(!p)return '';
  if(p.locked)return `<h3>第 ${selected+1} 畦 · 待開墾</h3><p>用收成開墾下一排，就能種植更多靈草。</p><button type="button" data-farm-action="expand" ${!canPay(snapshot.expansionCost)?'disabled':''}>開墾下一排 · ${esc(names(snapshot.expansionCost))}</button>`;
  if(p.empty){const c=Rules.crop(seed);return `<h3>第 ${selected+1} 畦 · 種下新苗</h3><p>${esc(c.description)}</p><dl><div><dt>自然生長</dt><dd>${timeText(c.minutes*60000)}</dd></div><div><dt>基本收成</dt><dd>${c.yield} 株 · 留種 1 顆</dd></div><div><dt>共植搭配</dt><dd>相鄰${esc(Rules.crop(c.companion).name)}，採收品質 +1</dd></div></dl><button type="button" class="farm-primary" data-farm-action="plant" data-crop-id="${seed}" ${!snapshot.seeds[seed]?'disabled':''}>種下${esc(c.name)} · 種子 ${snapshot.seeds[seed]}</button>${!snapshot.seeds[seed]?'<p>種子不足，可在下方種子袋換取。</p>':''}`;}
  const ready=p.readyAt<=current();
  return `<h3>第 ${selected+1} 畦 · ${esc(p.name)}</h3><p class="farm-detail-time" data-farm-countdown="${p.readyAt}">${timeText(p.readyAt-current())}</p><div class="farm-traits"><span>${p.watered?'已灌溉':'未灌溉'}</span><span>${p.fertilized?'已施肥':'未施肥'}</span><span>${p.companion?'共植相合':'可搭配'+esc(Rules.crop(Rules.crop(p.cropId).companion).name)}</span>${p.channelBonus?'<span>水渠滋養</span>':''}</div><p>預估${esc(p.label)} · 基本 ${Rules.crop(p.cropId).yield+p.bonus} 株。變異植株另有驚喜。</p>${ready?'<button type="button" class="farm-primary" data-farm-action="harvest">採收這一畦</button>':`<div class="farm-care"><button type="button" data-farm-action="water" ${p.watered?'disabled':''}>${p.watered?'已灌溉':'灌溉 · 免費'}</button><button type="button" data-farm-action="fertilize" ${p.fertilized||snapshot.energy<2?'disabled':''}>${p.fertilized?'已施肥':'施肥 · 靈氣 2'}</button>${p.pest?`<button type="button" data-farm-action="purify" ${snapshot.energy<1?'disabled':''}>驅散靈蟲 · 靈氣 1</button>`:''}</div>`}<p class="farm-small">灌溉縮短原生長時間 10%，施肥縮短 15%；每株各一次。靈蟲不影響基本收成，驅散可再提升品質。</p>`;
}
function inventoryHTML(){return `<details class="farm-drawer"><summary>種子袋與收成 <span>累計採收 ${snapshot.totalHarvest} 株</span></summary><div class="farm-stock-grid">${snapshot.crops.map(c=>`<article>${art(c.id)}<h4>${esc(c.name)}</h4><p>收成 ${snapshot.harvest[c.id]} · 種子 ${snapshot.seeds[c.id]}</p><button type="button" data-farm-action="seed" data-crop-id="${c.id}" ${!canPay(c.seedCost)?'disabled':''}>換種子 · ${esc(names(c.seedCost))}</button><button type="button" data-farm-action="exchange" data-crop-id="${c.id}" ${!c.exchangeUnlocked||!canPay({[c.id]:c.exchange})?'disabled':''}>${c.exchangeUnlocked?`${c.exchange} 株換${esc(c.materialName)} ×1`:`${c.minScore===28?'金丹境':'築基初期'}開放兌換`}</button><p class="farm-small">已培育變異 ${snapshot.mutations[c.id]} 株</p></article>`).join('')}</div></details>`;}
function constructionHTML(){return `<details class="farm-drawer"><summary>田園建設 <span>${snapshot.openPlots}／9 畦 · ${snapshot.channel?'水渠已通':'水渠待修'}</span></summary><div class="farm-buildings"><article><h4>${snapshot.channel?'清泉已入田':'修復灌溉水渠'}</h4><p>左側三畦自動灌溉，生長時間縮短 25%。中間、右側仍可手動照料。</p><button type="button" data-farm-action="channel" ${snapshot.channel||!canPay(snapshot.channelCost)?'disabled':''}>${snapshot.channel?'水渠已修復':'修復 · '+esc(names(snapshot.channelCost))}</button></article><article><h4>${snapshot.openPlots===9?'九畦靈植園':'開墾下一排'}</h4><p>${snapshot.openPlots===9?'靈田已完整開墾，可自由安排三種靈植。':'每次增加三畦；收成也能用來擴大種植規模。'}</p><button type="button" data-farm-action="expand" ${!snapshot.expansionCost||!canPay(snapshot.expansionCost)?'disabled':''}>${snapshot.expansionCost?'開墾 · '+esc(names(snapshot.expansionCost)):'已全部開墾'}</button></article></div></details>`;}
function render(){
  const host=$('farm-body');if(!host)return;
  if(!account){host.innerHTML='<p class="farm-empty">登入後即可照料自己的靈田。</p>';return;}
  if(!snapshot){host.innerHTML='<p class="farm-empty" role="status">'+esc(notice||'正在開啟靈田…')+'</p>'+(pending()?'<button type="button" data-farm-retry>重試上次田務</button>':'');$('farm-refresh').disabled=busy;return;}
  const opened=[...host.querySelectorAll('.farm-drawer')].map(node=>node.open);
  host.innerHTML=`<div class="farm-resources"><span>靈氣 <b>${snapshot.energy}</b>／${snapshot.energyCap}</span><span>可種 <b>${snapshot.openPlots}</b> 畦</span><button type="button" data-farm-action="study" ${snapshot.studyClaimed>=snapshot.studyCap||snapshot.energy>=snapshot.energyCap?'disabled':''}>納取修習靈氣 <small>${snapshot.studyClaimed}／${snapshot.studyCap}</small></button></div><div class="farm-layout"><section class="farm-garden ${snapshot.channel?'has-channel':''}" aria-label="三乘三靈田"><div class="farm-garden-heading"><span>青雲靈植園</span><button type="button" data-farm-action="harvest-all" ${!readyPlots().length?'disabled':''}>採收成熟靈草</button></div><div class="farm-channel" aria-hidden="true"><i></i><span>${snapshot.channel?'清泉入田':'待修水渠'}</span></div><div class="farm-grid" role="group" aria-label="選擇田地">${snapshot.plots.map(plotHTML).join('')}</div></section><aside class="farm-workbench"><div class="farm-seeds" role="group" aria-label="選擇種子">${Rules.CROPS.map(c=>`<button type="button" data-farm-seed="${c.id}" aria-pressed="${seed===c.id}" class="${seed===c.id?'is-selected':''}">${art(c.id)}<strong>${esc(c.name)}</strong><small>${c.minutes} 分 · 種子 ${snapshot.seeds[c.id]}</small></button>`).join('')}</div><div id="farm-detail" class="farm-detail">${detailHTML()}</div></aside></div><p id="farm-status" role="status" aria-live="polite" class="${failed?'is-error':''}">${esc(notice)}</p>${pending()?'<button type="button" class="farm-retry" data-farm-retry>上次田務尚待確認 · 重試原操作</button>':''}${inventoryHTML()}${constructionHTML()}<details class="farm-drawer farm-guide"><summary>田間手札</summary><p>離線也會生長，成熟後一直等待採收。每次採收至少留種一顆，變異植株多留一顆。</p><p>青露草喜赤穗花、赤穗花喜月華蘭、月華蘭喜青露草；上下左右相鄰可在採收時提升品質。一鍵採收會先計算所有共植加成。</p><p>今日每道不同、已保存的作答可納取 1 點靈氣，每日最多 20 點，答對與答錯皆計入。靈氣用於施肥與驅蟲，作物也能自然長成。</p></details>`;
  host.querySelectorAll('.farm-drawer').forEach((node,i)=>{node.open=opened[i]||false;});
  host.setAttribute('aria-busy',String(busy));if(busy||pending())host.querySelectorAll('[data-farm-action]').forEach(button=>{button.disabled=true;});
  $('farm-refresh').disabled=busy;updateEntrance();
}
function apply(payload){
  snapshot=payload.farm;clockOffset=snapshot.serverNow-Date.now();
  const user=window.getCurrentUserData?.();
  if(user&&getMainUser()?.uid===account&&payload.materialInventory){user.materialSystem={...user.materialSystem,inventory:payload.materialInventory};
    window.dispatchEvent(new CustomEvent('material-system-updated',{detail:{source:'spirit-farm'}}));}
  if(selected>=snapshot.openPlots)selected=Math.min(selected,8);
}
async function send(op=null){
  align();const uid=account;if(!uid||busy)return;busy=true;const request=++serial;
  if(op)storePending(uid,op);render();
  const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await authenticatedMainFetch('/api/spirit-farm',{method:op?'POST':'GET',...(op?{body:JSON.stringify(op)}:{}),signal:controller.signal});
    const payload=await response.json().catch(()=>({}));
    if(getMainUser()?.uid!==uid||account!==uid||request!==serial)return;
    if(!response.ok||!payload.ok){
      if(op&&response.status>=400&&response.status<500)storePending(uid,null);
      const error=Error(payload.error||'田務尚未確認，請重試');error.conflict=response.status===409;throw error;
    }
    if(op)storePending(uid,null);apply(payload);status(payload.result?.message||'清風過田，靈草正在生長。');
    if(payload.result?.action==='harvest'||payload.result?.action==='harvest-all'){
      $('farm-body')?.classList.remove('farm-harvested');requestAnimationFrame(()=>$('farm-body')?.classList.add('farm-harvested'));
      window.QAGameAudio?.answer?.(true,'farm:'+op.requestId);
    }
  }catch(error){
    if(getMainUser()?.uid!==uid||account!==uid||request!==serial)return;
    status(error.name==='AbortError'?'連線等待較久，上次田務會保留供重試。':error.message,true);
    if(error.conflict){snapshot=null;busy=false;await send();return;}
  }finally{clearTimeout(deadline);if(uid===account&&request===serial){busy=false;render();}}
}
async function refresh(){align();return send(pending()||null);}
function act(action,cropId=seed){
  align();if(!snapshot||busy||pending())return;
  const p=snapshot.plots[selected],op={action,expectedRevision:snapshot.revision,requestId:crypto.randomUUID()};
  if(['plant','water','fertilize','purify','harvest'].includes(action))op.index=selected;
  if(['water','fertilize','purify','harvest'].includes(action))op.plantId=p?.id;
  if(['plant','seed','exchange'].includes(action))op.cropId=cropId;
  void send(op);
}
function tick(){
  if(!visible()||document.hidden||account!==getMainUser()?.uid||!snapshot)return;
  let matured=false;
  for(const node of $('farm-body').querySelectorAll('[data-farm-countdown]')){const at=Number(node.dataset.farmCountdown);node.textContent=timeText(at-current());}
  for(const node of $('farm-body').querySelectorAll('[data-ready-at]')){
    const at=Number(node.dataset.readyAt),was=node.dataset.matured==='true';
    if(at<=current()&&!was){node.dataset.matured='true';node.querySelector('.farm-herb')?.classList.add('is-mature');node.querySelector('.farm-herb')?.classList.remove('is-sprout','is-growing');matured=true;}
    else if(at>current()){const planted=Number(node.dataset.plantedAt);if((current()-planted)/(at-planted)>=.5){node.querySelector('.farm-herb')?.classList.remove('is-sprout');node.querySelector('.farm-herb')?.classList.add('is-growing');}}
  }
  const button=$('farm-body').querySelector('[data-farm-action="harvest-all"]');if(button&&!busy&&!pending())button.disabled=!readyPlots().length;
  if(matured&&!busy&&!pending())$('farm-detail').innerHTML=detailHTML();updateEntrance();
}
function timers(){if(visible()&&!document.hidden){if(!timer)timer=setInterval(tick,1000);tick();}else{clearInterval(timer);timer=null;}}
function entrance(){
  const map=document.querySelector('#page-training .training-map');if(!map||$('spirit-farm-entrance'))return;
  const button=document.createElement('button');button.id='spirit-farm-entrance';button.className='training-garden-entrance';button.type='button';
  button.innerHTML='<span class="farm-entrance-art" aria-hidden="true"></span><span><strong>靈田</strong><small>耕植 · 收成 · 經營</small></span><span class="refinery-ready-dot" hidden></span>';
  button.addEventListener('click',()=>void window.openSpiritFarm());map.appendChild(button);updateEntrance();
}
function boot(){
  if(!$('spirit-farm-style')){const link=document.createElement('link');link.id='spirit-farm-style';link.rel='stylesheet';link.href='styles/spirit-farm.css';document.head.appendChild(link);}
  if(!$('page-spirit-farm')){
    const page=document.createElement('section');page.id='page-spirit-farm';page.className='page-section hidden px-4';
    page.innerHTML='<header class="farm-header"><button type="button" id="farm-back">← 修煉</button><div><small>一方靈壤 · 四時長青</small><h2>靈田</h2></div><button type="button" id="farm-refresh">重新同步</button></header><div id="farm-body"></div>';
    document.querySelector('main').appendChild(page);
    $('farm-back').addEventListener('click',()=>void window.switchToPage?.('page-training'));
    $('farm-refresh').addEventListener('click',()=>void refresh());
    page.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||button.disabled)return;
      if(button.hasAttribute('data-farm-plot')){selected=Number(button.dataset.farmPlot);$('farm-body').querySelectorAll('[data-farm-plot]').forEach(node=>{const active=Number(node.dataset.farmPlot)===selected;node.classList.toggle('is-selected',active);node.setAttribute('aria-pressed',String(active));});$('farm-detail').innerHTML=detailHTML();if(busy||pending())$('farm-detail').querySelectorAll('button').forEach(node=>{node.disabled=true;});}
      else if(button.hasAttribute('data-farm-seed')){seed=button.dataset.farmSeed;render();}
      else if(button.hasAttribute('data-farm-action'))act(button.dataset.farmAction,button.dataset.cropId||seed);
      else if(button.hasAttribute('data-farm-retry'))void refresh();
    });
    new MutationObserver(timers).observe(page,{attributes:true,attributeFilter:['class']});
  }
  entrance();
  const training=$('page-training');if(training){new MutationObserver(entrance).observe(training,{childList:true,subtree:true});new MutationObserver(updateEntrance).observe(training,{attributes:true,attributeFilter:['class']});}
  window.openSpiritFarm=async()=>{align();if(!account){window.showToast?.('請先登入');return;}await window.switchToPage?.('page-spirit-farm');if(!visible())return;$('nav-training')?.classList.add('active-nav-btn');render();timers();await refresh();};
}
window.addEventListener('xiuxian:user-data-ready',()=>{align();entrance();});
window.addEventListener('xiuxian:user-ready',()=>{align();entrance();});
window.addEventListener('online',()=>{if(visible())void refresh();});
document.addEventListener('visibilitychange',()=>{timers();updateEntrance();});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
