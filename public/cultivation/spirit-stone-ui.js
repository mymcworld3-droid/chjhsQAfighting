// Display-only spirit stone prices. Never changes requests or button handlers.
export const STONE_IMAGE='/assets/items/gold.webp';
const currencyRE=/(\d{1,3}(?:,\d{3})+|\d+|—)\s*(?:靈石|金幣)/g;
const number=v=>Number.isFinite(Number(v))&&Number(v)>=0?Math.floor(Number(v)).toLocaleString('zh-TW'):'—';
export function stoneCostMarkup(value){
  return '<span class="game-stone-cost"><img class="game-stone-icon" src="'+STONE_IMAGE+
    '" alt="" aria-hidden="true" width="19" height="19" loading="lazy" decoding="async">'+
    '<b class="game-stone-amount">'+number(value)+'</b><span class="game-stone-sr-only"> 靈石</span></span>';
}
export function splitStoneText(value){
  const text=String(value??''),parts=[];let last=0;
  for(const match of text.matchAll(currencyRE)){
    if(match.index>last)parts.push({kind:'text',value:text.slice(last,match.index)});
    parts.push({kind:'stone',value:match[1]});
    last=match.index+match[0].length;
  }
  if(!parts.length)return null;
  if(last<text.length)parts.push({kind:'text',value:text.slice(last)});
  return parts;
}
function stoneNode(amount){
  const span=document.createElement('span');span.className='game-stone-cost';
  const icon=document.createElement('img');icon.className='game-stone-icon';
  icon.src=STONE_IMAGE;icon.alt='';icon.setAttribute('aria-hidden','true');
  icon.width=19;icon.height=19;icon.loading='lazy';icon.decoding='async';
  const cost=document.createElement('b');cost.className='game-stone-amount';cost.textContent=amount;
  const accessible=document.createElement('span');accessible.className='game-stone-sr-only';accessible.textContent=' 靈石';
  span.append(icon,cost,accessible);return span;
}
export function decorateStoneButton(button){
  if(!button?.isConnected||button.tagName!=='BUTTON')return 0;
  const walker=document.createTreeWalker(button,4),nodes=[];
  let node;
  while((node=walker.nextNode())){
    if(node.parentElement?.closest('.game-stone-cost'))continue;
    if(splitStoneText(node.nodeValue))nodes.push(node);
  }
  for(const current of nodes){
    const parts=splitStoneText(current.nodeValue);
    if(!parts)continue;
    const fragment=document.createDocumentFragment();
    for(const part of parts)fragment.append(part.kind==='stone'
      ?stoneNode(part.value):document.createTextNode(part.value));
    current.replaceWith(fragment);
  }
  return nodes.length;
}
export function installStoneCostObserver(){
  if(typeof document==='undefined'||!document.body||document.body.dataset.stoneCostObserver==='1')return;
  document.body.dataset.stoneCostObserver='1';
  const queue=new Set();let planned=false;
  const add=button=>{
    if(!button||button.tagName!=='BUTTON')return;
    queue.add(button);
    if(planned)return;
    planned=true;
    queueMicrotask(()=>{
      planned=false;
      const batch=[...queue];queue.clear();
      for(const item of batch)if(item.isConnected)decorateStoneButton(item);
    });
  };
  document.querySelectorAll('button').forEach(add);
  new MutationObserver(events=>{
    for(const event of events){
      if(event.type==='characterData'){add(event.target.parentElement?.closest('button'));continue;}
      for(const node of event.addedNodes){
        if(node.nodeType===3){add(node.parentElement?.closest('button'));continue;}
        if(node.nodeType!==1)continue;
        if(node.tagName==='BUTTON')add(node);
        else {add(node.closest?.('button'));node.querySelectorAll?.('button').forEach(add);}
      }
    }
  }).observe(document.body,{subtree:true,childList:true,characterData:true});
}
if(typeof document!=='undefined'){
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',installStoneCostObserver,{once:true});
  else installStoneCostObserver();
}
