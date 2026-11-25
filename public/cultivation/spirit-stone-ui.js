// Cosmetic presentation only. Do not change the transaction, reward or click semantics.
export const STONE_IMAGE='/assets/items/gold.webp';
// Accept both "靈石 +30" and "+30 靈石" (also balances, prices and minus signs).
const moneyPattern=/(?:靈石|金幣)[ \t]*[:：]?[ \t]*((?:[+＋\-−×xX][ \t]*)?(?:\d[\d,]*|—))|((?:[+＋\-−×xX][ \t]*)?(?:\d[\d,]*|—))[ \t]*(?:靈石|金幣)/g;
const num=value=>{
  const raw=String(value??'').trim();
  if(raw==='—')return raw;
  const parts=/^([+＋\-−×xX]?)[ \t]*(\d[\d,]*)$/.exec(raw);
  if(!parts){
    const amount=Number(value);
    return Number.isFinite(amount)&&amount>=0?Math.floor(amount).toLocaleString('zh-TW'):'—';
  }
  const amount=Number(parts[2].replaceAll(',',''));
  if(!Number.isFinite(amount))return '—';
  return parts[1]+Math.floor(amount).toLocaleString('zh-TW');
};
export function stoneCostMarkup(value){
  return '<span class="game-stone-cost"><img class="game-stone-icon" src="'+STONE_IMAGE+
    '" alt="" aria-hidden="true" width="19" height="19" loading="lazy" decoding="async">'+
    '<b class="game-stone-amount">'+num(value)+'</b><span class="game-stone-sr-only"> 靈石</span></span>';
}
export function splitStoneText(value){
  const text=String(value??''),parts=[];let last=0;
  for(const match of text.matchAll(moneyPattern)){
    if(match.index>last)parts.push({kind:'text',value:text.slice(last,match.index)});
    parts.push({kind:'stone',value:(match[1]??match[2]).replace(/[ \t]+/g,'')});
    last=match.index+match[0].length;
  }
  if(!parts.length)return null;
  if(last<text.length)parts.push({kind:'text',value:text.slice(last)});
  return parts;
}
function stoneNode(value){
  const outer=document.createElement('span');outer.className='game-stone-cost';
  const image=document.createElement('img');image.className='game-stone-icon';
  image.src=STONE_IMAGE;image.alt='';image.setAttribute('aria-hidden','true');
  image.width=19;image.height=19;image.loading='lazy';image.decoding='async';
  const amount=document.createElement('b');amount.className='game-stone-amount';amount.textContent=num(value);
  const assist=document.createElement('span');assist.className='game-stone-sr-only';assist.textContent=' 靈石';
  outer.append(image,amount,assist);return outer;
}
const excluded='script,style,noscript,textarea,select,option,code,pre,svg,math,mjx-container,.MathJax,.katex,.dm-question,.dv-question,.tc-question,.quiz-question,#page-quiz,.question-text,template,[contenteditable],.game-stone-cost,#home-spirit-stones';
function decorateTextNode(node){
  if(!node||node.nodeType!==3||!node.isConnected)return 0;
  const parent=node.parentElement;
  if(!parent||parent.closest(excluded))return 0;
  const parts=splitStoneText(node.nodeValue);
  if(!parts)return 0;
  const fragment=document.createDocumentFragment();
  for(const part of parts)
    fragment.append(part.kind==='stone'?stoneNode(part.value):document.createTextNode(part.value));
  node.replaceWith(fragment);
  return 1;
}
// Decorate all visible currency amounts, not only purchase buttons:
// quest rewards, settlement receipts, shop prices, cost hints, and +30 gains.
export function decorateStoneContent(root){
  if(!root||!root.isConnected)return 0;
  if(root.nodeType===3)return decorateTextNode(root);
  if(root.nodeType!==1||root.closest(excluded))return 0;
  const walker=document.createTreeWalker(root,4); // NodeFilter.SHOW_TEXT
  const nodes=[];let node;
  while((node=walker.nextNode())){
    if(node.parentElement&&!node.parentElement.closest(excluded)&&splitStoneText(node.nodeValue))nodes.push(node);
  }
  for(const item of nodes)decorateTextNode(item);
  return nodes.length;
}
export function decorateStoneButton(button){
  if(!button||button.tagName!=='BUTTON')return 0;
  return decorateStoneContent(button);
}
export function installStoneCostObserver(){
  if(typeof document==='undefined'||!document.body||document.body.dataset.stoneCostObserver==='1')return;
  document.body.dataset.stoneCostObserver='1';
  const queued=new Set();let scheduled=false;
  const enqueue=node=>{
    if(!node)return;
    queued.add(node);
    if(scheduled)return;
    scheduled=true;
    queueMicrotask(()=>{
      scheduled=false;
      const batch=[...queued];queued.clear();
      for(const item of batch)decorateStoneContent(item);
    });
  };
  enqueue(document.body);
  new MutationObserver(events=>{
    for(const event of events){
      if(event.type==='characterData'){enqueue(event.target);continue;}
      for(const node of event.addedNodes)enqueue(node);
    }
  }).observe(document.body,{subtree:true,childList:true,characterData:true});
}
if(typeof document!=='undefined'){
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',installStoneCostObserver,{once:true});
  else installStoneCostObserver();
}
