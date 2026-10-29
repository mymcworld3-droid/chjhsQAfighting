import './spirit-farm-rules.js';
import { getMainUser, authenticatedMainFetch } from './data/project-repository.js';

const Rules=globalThis.QASpiritFarmRules, KEY='xiuxian:spirit-farm-pending:v1:';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let account='',snapshot=null,selected=0,seed='jade',busy=false,serial=0,clockOffset=0,timer=null,notice='',failed=false,inspectOpen=false,focusAfter='';
const pendingMemory=new Map();
const visible=()=>$('page-spirit-farm')?.classList.contains('active-page')&&!$('page-spirit-farm')?.classList.contains('hidden');
const current=()=>Date.now()+clockOffset;
function pending(uid=account){if(pendingMemory.has(uid))return pendingMemory.get(uid);try{const value=JSON.parse(localStorage.getItem(KEY+uid)||'null');pendingMemory.set(uid,value);return value;}catch(_){return null;}}
function storePending(uid,op){pendingMemory.set(uid,op||null);try{if(op)localStorage.setItem(KEY+uid,JSON.stringify(op));else localStorage.removeItem(KEY+uid);}catch(_){}}
function align(){const uid=getMainUser()?.uid||'';if(uid===account)return;account=uid;snapshot=null;busy=false;selected=0;seed='jade';notice='';failed=false;inspectOpen=false;focusAfter='';serial++;render();updateEntrance();}
function status(text,error=false){notice=text;failed=error;const node=$('farm-status');if(node){node.textContent=text;node.classList.toggle('is-error',error);}}
function art(id,classes=''){return `<span class="farm-herb farm-herb-${esc(id)} ${classes}" aria-hidden="true"></span>`;}
function names(cost){return Object.entries(cost||{}).map(([id,n])=>`${Rules.crop(id)?.name||id} ×${n}`).join('、');}
function canPay(cost){return Object.entries(cost||{}).every(([id,n])=>(snapshot?.harvest?.[id]||0)>=n);}
function timeText(ms){if(ms<=0)return '可採收';const minutes=Math.ceil(ms/60000);return minutes>=60?`${Math.floor(minutes/60)} 小時 ${minutes%60} 分`:`${minutes} 分鐘`;}
function readyPlots(){return snapshot?.plots?.filter(p=>!p.locked&&!p.empty&&p.readyAt<=current())||[];}
const work=()=>Rules.workPlan(snapshot,current(),seed);
function updateEntrance(){const button=$('spirit-farm-entrance');if(!button)return;const ready=account===getMainUser()?.uid&&readyPlots().length>0;button.querySelector('.refinery-ready-dot').hidden=!ready;button.setAttribute('aria-label',ready?'靈田，有靈草可採收':'進入靈田');}
function plotHTML(p){
  const active=p.index===selected,base=`type="button" class="farm-plot ${active?'is-selected':''} ${p.locked?'is-locked':''}" data-farm-plot="${p.index}" style="--farm-depth:${Math.floor(p.index/3)+1}" aria-pressed="${active}"`;
  if(p.locked)return `<button ${base} aria-label="第 ${p.index+1} 畦，尚未開墾"><span class="farm-plot-number">${p.index+1}</span><span class="farm-soil-mark" aria-hidden="true">鎖</span><span class="farm-plot-label">待開墾</span></button>`;
  if(p.empty)return `<button ${base} aria-label="第 ${p.index+1} 畦，點擊種下${esc(Rules.crop(seed).name)}，使用種子 1 顆"><span class="farm-plot-number">${p.index+1}</span><span class="farm-soil-mark" aria-hidden="true">＋</span><span class="farm-plot-label">點此種植</span></button>`;
  const ready=p.readyAt<=current(),progress=Math.max(0,Math.min(1,(current()-p.plantedAt)/Math.max(1,p.readyAt-p.plantedAt)));
  return `<button ${base} data-ready-at="${p.readyAt}" data-planted-at="${p.plantedAt}" data-matured="${ready}" aria-label="第 ${p.index+1} 畦，${esc(p.name)}，${ready?'點擊採收':!p.watered?'點擊免費灌溉':'點擊查看詳情'}，${timeText(p.readyAt-current())}"><span class="farm-plot-number">${p.index+1}</span>${art(p.cropId,ready?'is-mature':progress<.5?'is-sprout':'is-growing')}<span class="farm-plot-label" data-farm-countdown="${p.readyAt}">${ready?'點此採收':timeText(p.readyAt-current())}</span>${p.pest?'<span class="farm-pest" title="靈蟲靠近，可驅散提升品質">蟲</span>':!ready&&!p.watered?'<span class="farm-water-mark" aria-hidden="true">待澆</span>':''}</button>`;
}
function detailHTML(){
  const p=snapshot?.plots?.[selected];if(!p)return '';
  if(p.locked)return `<h3>第 ${selected+1} 畦 · 待開墾</h3><p>用收成開墾下一排，就能種植更多靈草。</p><button type="button" data-farm-action="expand" ${!canPay(snapshot.expansionCost)?'disabled':''}>開墾下一排 · ${esc(names(snapshot.expansionCost))}</button>`;
  if(p.empty){const c=Rules.crop(seed);return `<p>${esc(c.description)}生長 ${c.minutes} 分，收成 ${c.yield} 株；喜鄰${esc(Rules.crop(c.companion).name)}。每畦使用 1 顆種子，採收後會留種。</p><button type="button" class="farm-primary" data-farm-action="plant" data-crop-id="${seed}" ${!snapshot.seeds[seed]?'disabled':''}>種下${esc(c.name)}</button>${!snapshot.seeds[seed]?`<button type="button" data-farm-action="seed" data-crop-id="${seed}" ${!canPay(c.seedCost)?'disabled':''}>換種子 · ${esc(names(c.seedCost))}</button>`:''}`;}
  const ready=p.readyAt<=current();
  return `<p class="farm-detail-time" data-farm-countdown="${p.readyAt}">${timeText(p.readyAt-current())}</p><div class="farm-traits"><span>${p.watered?'已灌溉':'未灌溉'}</span><span>${p.fertilized?'已施肥':'未施肥'}</span><span>${p.companion?'共植相合':'可搭配'+esc(Rules.crop(Rules.crop(p.cropId).companion).name)}</span>${p.channelBonus?'<span>水渠滋養</span>':''}</div><p>預估${esc(p.label)} · ${Rules.crop(p.cropId).yield+p.bonus} 株，另留種 1 顆。</p>${ready?'<button type="button" class="farm-primary" data-farm-action="harvest">採收這一畦</button>':`<div class="farm-care">${!p.watered?'<button type="button" data-farm-action="water">灌溉 · 免費</button>':''}<button type="button" data-farm-action="fertilize" ${p.fertilized||snapshot.energy<2?'disabled':''}>${p.fertilized?'已施肥':'施肥 · 靈氣 2'}</button>${p.pest?`<button type="button" data-farm-action="purify" ${snapshot.energy<1?'disabled':''}>驅蟲 · 靈氣 1</button>`:''}</div>`}`;
}
function inspectorHTML(){
  const p=snapshot.plots[selected],label=p.locked?'待開墾':p.empty?'空田':p.name;
  return `<details id="farm-inspector" class="farm-inspector" ${inspectOpen?'open':''}><summary><span>第 ${selected+1} 畦 · ${esc(label)}</span><small>單畦照料</small></summary><div id="farm-detail" class="farm-detail">${detailHTML()}</div></details>`;
}
function actionsHTML(plan){
  const c=Rules.crop(seed);
  return `<div class="farm-actions" role="group" aria-label="整片田地快捷操作"><button type="button" data-farm-action="plant-all" data-crop-id="${seed}" ${!plan.plant.length?'disabled':''}><strong>播種${plan.plant.length?' '+plan.plant.length+' 畦':''}</strong><small>${plan.plant.length?esc(c.name)+' · 種子 '+plan.plant.length:plan.empty.length?'種子不足':'暫無空田'}</small></button><button type="button" data-farm-action="water-all" ${!plan.water.length?'disabled':''}><strong>灌溉${plan.water.length?' '+plan.water.length+' 畦':''}</strong><small>${plan.water.length?'全部灌溉 · 免費':'暫無需灌溉'}</small></button><button type="button" class="${plan.harvest.length?'farm-primary':''}" data-farm-action="harvest-all" ${!plan.harvest.length?'disabled':''}><strong>採收${plan.harvest.length?' '+plan.harvest.length+' 畦':''}</strong><small>${plan.harvest.length?'全部成熟靈植':'等待靈植成熟'}</small></button></div>`;
}
function inventoryHTML(){return `<details class="farm-drawer"><summary>種子袋與收成 <span>累計採收 ${snapshot.totalHarvest} 株</span></summary><div class="farm-stock-grid">${snapshot.crops.map(c=>`<article>${art(c.id)}<h4>${esc(c.name)}</h4><p>收成 ${snapshot.harvest[c.id]} · 種子 ${snapshot.seeds[c.id]}</p><button type="button" data-farm-action="seed" data-crop-id="${c.id}" ${!canPay(c.seedCost)?'disabled':''}>換種子 · ${esc(names(c.seedCost))}</button><button type="button" data-farm-action="exchange" data-crop-id="${c.id}" ${!c.exchangeUnlocked||!canPay({[c.id]:c.exchange})?'disabled':''}>${c.exchangeUnlocked?`${c.exchange} 株換${esc(c.materialName)} ×1`:`${c.minScore===28?'金丹境':'築基初期'}開放兌換`}</button><p class="farm-small">已培育變異 ${snapshot.mutations[c.id]} 株</p></article>`).join('')}</div></details>`;}
function constructionHTML(){return `<details class="farm-drawer"><summary>田園建設 <span>${snapshot.openPlots}／9 畦 · ${snapshot.channel?'水渠已通':'水渠待修'}</span></summary><div class="farm-buildings"><article><h4>${snapshot.channel?'清泉已入田':'修復灌溉水渠'}</h4><p>左側三畦自動灌溉，生長時間縮短 25%。中間、右側仍可手動照料。</p><button type="button" data-farm-action="channel" ${snapshot.channel||!canPay(snapshot.channelCost)?'disabled':''}>${snapshot.channel?'水渠已修復':'修復 · '+esc(names(snapshot.channelCost))}</button></article><article><h4>${snapshot.openPlots===9?'九畦靈植園':'開墾下一排'}</h4><p>${snapshot.openPlots===9?'靈田已完整開墾，可自由安排三種靈植。':'每次增加三畦；收成也能用來擴大種植規模。'}</p><button type="button" data-farm-action="expand" ${!snapshot.expansionCost||!canPay(snapshot.expansionCost)?'disabled':''}>${snapshot.expansionCost?'開墾 · '+esc(names(snapshot.expansionCost)):'已全部開墾'}</button></article></div></details>`;}
function render(){
  const host=$('farm-body');if(!host)return;
  const hud=$('farm-header-values');if(!snapshot&&hud)hud.innerHTML='';
  $('farm-refresh').disabled=busy;
  if(!account){host.innerHTML='<p class="farm-empty">登入後即可照料自己的靈田。</p>';return;}
  if(!snapshot){host.innerHTML='<p class="farm-empty" role="status">'+esc(notice||'正在開啟靈田…')+'</p>'+(pending()?'<button type="button" data-farm-retry>重試上次田務</button>':'');$('farm-refresh').disabled=busy;return;}
  const opened=[...host.querySelectorAll('.farm-drawer')].map(node=>node.open);
  const plan=work(),c=Rules.crop(seed);
  if(hud)hud.innerHTML=`<span class="farm-energy"><small>靈氣</small> <b>${snapshot.energy}</b><small>／${snapshot.energyCap}</small></span><button type="button" data-farm-action="study" title="今日已領 ${snapshot.studyClaimed}／${snapshot.studyCap}，依已保存作答領取" ${busy||pending()||snapshot.studyClaimed>=snapshot.studyCap||snapshot.energy>=snapshot.energyCap?'disabled':''}>領氣<small>${snapshot.studyClaimed}／${snapshot.studyCap}</small></button>`;
  host.innerHTML=`<div class="farm-layout"><div class="farm-seed-dock"><div class="farm-seeds" role="group" aria-label="選擇播種用種子">${Rules.CROPS.map(c=>`<button type="button" data-farm-seed="${c.id}" aria-pressed="${seed===c.id}" class="${seed===c.id?'is-selected':''}">${art(c.id)}<span><strong>${esc(c.name)}</strong><small>${c.minutes} 分 · ${snapshot.seeds[c.id]} 顆</small></span></button>`).join('')}</div><p class="farm-seed-info">${esc(c.name)} · 收成 ${c.yield} 株 · 喜鄰${esc(Rules.crop(c.companion).name)}</p></div><div class="farm-field-wrap">${actionsHTML(plan)}<section class="farm-garden ${snapshot.channel?'has-channel':''}" aria-label="三乘三靈田"><div class="farm-garden-heading"><span>青雲靈植園</span><small>${snapshot.openPlots}／9 畦${plan.harvest.length?' · '+plan.harvest.length+' 畦成熟':''}</small></div><div class="farm-channel" aria-hidden="true"><i></i><span>${snapshot.channel?'清泉入田':'待修水渠'}</span></div><div class="farm-grid" role="group" aria-label="直接點田地播種、灌溉或採收">${[0,1,2].map(row=>`<div class="farm-row" data-farm-row="${row}" style="--farm-depth:${row+1}">${snapshot.plots.slice(row*3,row*3+3).map(plotHTML).join('')}</div>`).join('')}</div></section><p class="farm-touch-hint">點空田播種 · 點幼苗灌溉 · 點成熟採收</p><p id="farm-status" role="status" aria-live="polite" class="${failed?'is-error':''}">${esc(notice)}</p>${pending()&&!busy?'<button type="button" class="farm-retry" data-farm-retry>上次田務尚待確認 · 點此重試</button>':''}</div><aside class="farm-workbench"><div class="farm-batch-care" role="group" aria-label="花費靈氣培育"><button type="button" data-farm-action="fertilize-all" ${!plan.fertilize.length||snapshot.energy<plan.fertilizeCost?'disabled':''}><strong>全部施肥${plan.fertilize.length?' · '+plan.fertilize.length+' 畦':''}</strong><small>${plan.fertilize.length?'靈氣 '+plan.fertilizeCost+' · 加速 15%'+(snapshot.energy<plan.fertilizeCost?'（不足）':''):'暫無需施肥'}</small></button><button type="button" data-farm-action="purify-all" ${!plan.purify.length||snapshot.energy<plan.purifyCost?'disabled':''}><strong>全部驅蟲${plan.purify.length?' · '+plan.purify.length+' 畦':''}</strong><small>${plan.purify.length?'靈氣 '+plan.purifyCost+' · 提升品質'+(snapshot.energy<plan.purifyCost?'（不足）':''):'田間無靈蟲'}</small></button></div>${inspectorHTML()}</aside></div>${inventoryHTML()}${constructionHTML()}<details class="farm-drawer farm-guide"><summary>田間手札</summary><p>離線也會生長，成熟後一直等待採收。點空田直接種下目前選擇的種子；點未灌溉的幼苗免費灌溉；點成熟靈植直接採收。已灌溉的植株可點開單畦詳情。</p><p>整批播種從後排往前填入空田，最多使用現有種子；整批照料只處理仍在生長且尚需該項照料的靈植。施肥每畦靈氣 2，驅蟲每畦靈氣 1，按鈕顯示合計花費；靈氣不足時仍可免費灌溉或逐畦照料。</p><p>灌溉縮短原生長時間 10%，施肥縮短 15%，各提升一點品質，每株各一次。靈蟲不影響基本收成。青露草喜赤穗花、赤穗花喜月華蘭、月華蘭喜青露草；上下左右相鄰可在採收時提升品質。一鍵採收先計算所有共植加成。</p><p>今日每道不同、已保存的作答可領 1 點靈氣，每日最多 20 點，答對與答錯皆計入；採收至少留種一顆，變異多留一顆。</p></details>`;
  host.querySelectorAll('.farm-drawer').forEach((node,i)=>{node.open=opened[i]||false;});
  host.setAttribute('aria-busy',String(busy));if(busy||pending())host.querySelectorAll('[data-farm-action],[data-farm-plot],[data-farm-seed]').forEach(button=>{button.disabled=true;});
  if(!busy&&focusAfter){(host.querySelector?.(focusAfter)||hud?.querySelector?.(focusAfter))?.focus({preventScroll:true});focusAfter='';}
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
  if(op)storePending(uid,op);status(op?({plant:'正在播種','plant-all':'正在整批播種',water:'正在灌溉','water-all':'正在整批灌溉',fertilize:'正在施肥','fertilize-all':'正在整批施肥',purify:'正在驅蟲','purify-all':'正在整批驅蟲',harvest:'正在採收','harvest-all':'正在整批採收'}[op.action]||'正在處理田務')+'…':'正在同步靈田…');render();
  const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await authenticatedMainFetch('/api/spirit-farm',{method:op?'POST':'GET',...(op?{body:JSON.stringify(op)}:{}),signal:controller.signal});
    const payload=await response.json().catch(()=>({}));
    if(getMainUser()?.uid!==uid||account!==uid||request!==serial)return;
    if(!response.ok||!payload.ok){
      if(op&&response.status>=400&&response.status<500)storePending(uid,null);
      const error=Error(payload.error||'田務尚未確認，請重試');error.conflict=response.status===409;throw error;
    }
    if(op)storePending(uid,null);apply(payload);
    const harvest=payload.result?.items;
    const summary=harvest?.reduce((rows,item)=>{rows[item.name]=(rows[item.name]||0)+item.quantity;return rows;},{});
    const mutations=harvest?.filter(item=>item.mutated).length||0;
    status(summary?'採收 '+Object.entries(summary).map(([name,n])=>name+' ×'+n).join('、')+(mutations?' · 發現變異 '+mutations+' 株！':'')+' · 已留下種子':payload.result?.message||'清風過田，靈草正在生長。');
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
  if(['plant','plant-all','seed','exchange'].includes(action))op.cropId=cropId;
  return send(op);
}
function tapPlot(index){
  align();if(!snapshot||busy||pending())return;
  selected=index;const p=snapshot.plots[index];if(!p)return;
  focusAfter=`[data-farm-plot="${index}"]`;
  if(p.locked){inspectOpen=true;render();return;}
  if(p.empty){if(snapshot.seeds[seed])return act('plant');inspectOpen=true;status(''+Rules.crop(seed).name+'種子不足，可換種子或改選其他靈植。',true);render();return;}
  if(p.readyAt<=current())return act('harvest');
  inspectOpen=true;
  if(!p.watered)return act('water');
  render();
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
  if(matured&&!busy&&!pending())render();updateEntrance();
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
    page.innerHTML='<header class="farm-header"><button type="button" id="farm-back" aria-label="返回修煉" title="返回修煉">←</button><h2>靈田</h2><div id="farm-header-values"></div><button type="button" id="farm-refresh" title="重新同步靈田">同步</button></header><div id="farm-body"></div>';
    document.querySelector('main').appendChild(page);
    $('farm-back').addEventListener('click',()=>void window.switchToPage?.('page-training'));
    $('farm-refresh').addEventListener('click',()=>void refresh());
    page.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||button.disabled)return;
      if(button.hasAttribute('data-farm-plot'))void tapPlot(Number(button.dataset.farmPlot));
      else if(button.hasAttribute('data-farm-seed')){seed=button.dataset.farmSeed;focusAfter=`[data-farm-seed="${seed}"]`;render();}
      else if(button.hasAttribute('data-farm-action')){focusAfter=`[data-farm-action="${button.dataset.farmAction}"]`;void act(button.dataset.farmAction,button.dataset.cropId||seed);}
      else if(button.hasAttribute('data-farm-retry'))void refresh();
    });
    page.addEventListener('toggle',event=>{if(event.target.id==='farm-inspector')inspectOpen=event.target.open;},true);
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
