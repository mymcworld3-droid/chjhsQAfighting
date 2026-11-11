// Local AI-painted item artwork. IDs, balances and reward rules stay unchanged.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QAItemIcons=api;
})(globalThis,function(){
  'use strict';
  const names=Object.freeze({
    gold:'靈石','raid-ticket':'團本入場券','draw-ticket':'本命法器抽獎券',
    'forge-fragment':'煉器碎片','nascent-soul-essence':'元嬰碎精','revival-pill':'回魂聚靈丹',cultivation:'修為',
    'qi-spirit-iron':'玄鐵','foundation-refined-iron':'精煉玄鐵','golden-purple-iron':'紫金玄鐵',
    'qi-spirit-wood':'靈木','foundation-century-wood':'百年靈木','golden-lightning-wood':'雷擊木',
    'nascent-star-iron':'玄冥星鐵','nascent-soul-wood':'千載魂木',
    'raid-refine-key-ii':'二階升級石','raid-refine-key-iii':'三階升級石',
    'seven-treasure-ruler':'七寶玲瓏尺','war-drum':'破軍戰鼓','enlightenment-lamp':'悟道玄燈',
    'mountain-armor':'鎮嶽玄甲','longevity-jade':'長生玉佩','treasure-pouch':'修煉物品'
  });
  const catalog=Object.freeze(Object.fromEntries(Object.entries(names).map(([id,name])=>
    [id,Object.freeze({id,name,imageUrl:'/assets/items/'+id+'.webp'})])));
  const aliases=Object.freeze({fragments:'nascent-soul-essence',raidTickets:'raid-ticket',drawTickets:'draw-ticket',forgeFragments:'forge-fragment',
    'void-sword':'sword'});
  const forms=Object.freeze({劍:'sword',飛劍:'sword',刀:'sword',槍:'sword',斧:'axe',錘:'axe',戟:'axe',
    印:'seal',寶珠:'pearl',陣盤:'star',法鏡:'mirror',鐘:'bell',鈴:'bell',幡:'banner'});
  const types=new Set(['sword','seal','pearl','star','mirror','bell','banner','axe']);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function safeImage(value){const s=String(value||'').trim();return /^(?:https?:\/\/|\/assets\/|assets\/)/i.test(s)?s:'';}
  function url(input){
    const item=typeof input==='object'&&input?input:{id:String(input||'')};
    const existing=safeImage(item.imageUrl);if(existing)return existing;
    let id=String(item.id||'');id=Object.hasOwn(aliases,id)?aliases[id]:id;
    if(Object.hasOwn(catalog,id))return catalog[id].imageUrl;
    const type=item.archetype||forms[item.weaponForm]||(/^soul-([a-z]+)-/.exec(id)?.[1])||id;
    return types.has(type)?'/assets/soulbound/'+type+'-ai.webp':catalog['treasure-pouch'].imageUrl;
  }
  function markup(input,{size=22,alt=''}={}){
    const pixels=Math.max(12,Math.min(128,Math.floor(Number(size)||22)));
    return '<img class="game-item-icon" src="'+esc(url(input))+'" alt="'+esc(alt)+'" width="'+pixels+'" height="'+pixels+'" loading="lazy" decoding="async">';
  }
  return Object.freeze({catalog,url,markup,safeImage});
});
