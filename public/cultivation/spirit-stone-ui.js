// Cosmetic presentation only. Do not change the transaction, reward or click semantics.
export const STONE_IMAGE='/assets/items/gold.webp';
// Accept both "靈石 +30" and "+30 靈石" (also balances, prices and minus signs).
const moneyPattern=/(?:靈石|金幣)[ \t]*[:：]?[ \t]*((?:[+＋\-−×xX][ \t]*)?(?:\d[\d,]*|—))|((?:[+＋\-−×xX][ \t]*)?(?:\d[\d,]*|—))[ \t]*(?:靈石|金幣)/g;
export const formatResourceAmount=value=>{
  const raw=String(value??'').trim();
  if(raw==='—')return raw;
  const parts=/^([+＋\-−×xX]?)[ \t]*(\d[\d,]*)$/.exec(raw);
  if(!parts){
    return '—';
  }
  const amount=Number(parts[2].replaceAll(',',''));
  if(!Number.isFinite(amount))return '—';
  const sign=({'＋':'+','-':'−','x':'×','X':'×'})[parts[1]]??parts[1];
  return sign+Math.floor(amount).toLocaleString('zh-TW');
};
const resources=Object.freeze({
  gold:Object.freeze({name:'靈石',image:STONE_IMAGE}),
  cultivation:Object.freeze({name:'修為',image:'/assets/items/cultivation.svg'}),
  weaponDungeonTicket:Object.freeze({name:'副本券',image:'/assets/items/weapon-dungeon-ticket.svg'})
});
export function resourceIconMarkup(kind,{size=19}={}){
  if(!Object.hasOwn(resources,kind))return '';
  const px=Math.max(12,Math.min(128,Math.floor(Number(size)||19)));
  const cls=kind==='gold'?'game-stone-icon':'game-resource-icon';
  return '<img class="'+cls+'" src="'+resources[kind].image+'" alt="" aria-hidden="true" width="'+px+'" height="'+px+'" loading="lazy" decoding="async">';
}
export function resourceMarkup(kind,value,{max,showName=false}={}){
  if(!Object.hasOwn(resources,kind))return '';
  const name=resources[kind].name;
  const amount=formatResourceAmount(value)+(max===undefined?'':' / '+formatResourceAmount(max));
  const gold=kind==='gold';
  return '<span class="'+(gold?'game-stone-cost':'game-resource-value')+'">'+resourceIconMarkup(kind)+
    '<b class="'+(gold?'game-stone-amount':'game-resource-amount')+'">'+amount+'</b><span class="'+(showName?'game-resource-label':'game-stone-sr-only')+'"> '+name+'</span></span>';
}
export function cultivationMarkup(value,options){return resourceMarkup('cultivation',value,options);}
export function weaponDungeonTicketMarkup(value,options){return resourceMarkup('weaponDungeonTicket',value,options);}
export function stoneCostMarkup(value){return resourceMarkup('gold',value);}
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
  const amount=document.createElement('b');amount.className='game-stone-amount';amount.textContent=formatResourceAmount(value);
  const assist=document.createElement('span');assist.className='game-stone-sr-only';assist.textContent=' 靈石';
  outer.append(image,amount,assist);return outer;
}
const compatibilityScopes='.quest-reward,#quest-spotlight-reward,#quest-status,#quest-spotlight-status,.dt-owner-reward,.dt-library-note,.dt-reward,.dv-reward-amounts,.pm-card-foot,.pm-header,[data-game-resource-text]';
const excluded='script,style,noscript,textarea,select,option,code,pre,svg,math,mjx-container,.MathJax,.katex,.dm-question,.dv-question,.tc-question,.quiz-question,#page-quiz,.question-text,template,[contenteditable],.game-stone-cost,.game-resource-value,#home-spirit-stones,#question-text,#options-container,[data-options-container],.tc-options,.dm-options,.dv-options,#chat-messages,#scope-share-messages,#alliance-chat-messages,.alliance-chat-bubble,[role=log]';
function decorateTextNode(node){
  if(!node||node.nodeType!==3||!node.isConnected)return 0;
  const parent=node.parentElement;
  if(!parent||parent.closest(excluded)||!parent.closest(compatibilityScopes))return 0;
  const parts=splitStoneText(node.nodeValue);
  if(!parts)return 0;
  const fragment=document.createDocumentFragment();
  for(const part of parts)
    fragment.append(part.kind==='stone'?stoneNode(part.value):document.createTextNode(part.value));
  node.replaceWith(fragment);
  return 1;
}
// Compatibility only in explicitly trusted game-owned resource fields; never scan arbitrary player text.
export function decorateStoneContent(root){
  if(!root||!root.isConnected)return 0;
  if(root.nodeType===3)return decorateTextNode(root);
  if(root.nodeType!==1||root.closest(excluded))return 0;
  const walker=document.createTreeWalker(root,4); // NodeFilter.SHOW_TEXT
  const nodes=[];let node;
  while((node=walker.nextNode())){
    if(node.parentElement&&!node.parentElement.closest(excluded)&&node.parentElement.closest(compatibilityScopes)&&splitStoneText(node.nodeValue))nodes.push(node);
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
  for(const scope of document.querySelectorAll(compatibilityScopes))enqueue(scope);
  new MutationObserver(events=>{
    for(const event of events){
      if(event.type==='characterData'){if(event.target.parentElement?.closest(compatibilityScopes))enqueue(event.target);continue;}
      for(const node of event.addedNodes){
        if(node.nodeType===3){if(node.parentElement?.closest(compatibilityScopes))enqueue(node);continue;}
        if(node.nodeType!==1)continue;
        if(node.closest(compatibilityScopes))enqueue(node);
        else for(const scope of node.querySelectorAll(compatibilityScopes))enqueue(scope);
      }
    }
  }).observe(document.body,{subtree:true,childList:true,characterData:true});
}
if(typeof document!=='undefined'){
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',installStoneCostObserver,{once:true});
  else installStoneCostObserver();
}
