// Shared reward presentation only. Gameplay modules own all reward calculation and persistence.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.QARewardPresentation = api; root.QAMeditationRewardFeedback = api; }
})(typeof globalThis === 'object' ? globalThis : this, function (root) {
  'use strict';
  const kinds = [
    ['cultivation', '修為', 'M12 3 5 13h6l-1 8 9-12h-6l1-6Z'],
    ['gold', '靈石', 'm12 3 8 6-3 10H7L4 9l8-6Zm-8 6h16M7 19l5-16 5 16'],
    ['fragments', '元嬰碎精', 'm12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3 3-6Z'],
    ['raidTickets', '團本入場券', 'M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4V6Zm12 1v10'],
    ['weaponDungeonTicket', '副本券', 'M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4V6Zm12 1v10'],
    ['drawTickets', '本命法器抽獎券', 'M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4V6Zm9 3 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z']
  ];
  const seen = new Set();
  const storageKey='qa.reward.presentation.seen.v2';
  // Cosmetic ledger only: never consulted by a claim or transaction.
  function readSeen(){
    try {const values=JSON.parse(root.localStorage?.getItem(storageKey)||'[]');return Array.isArray(values)?values.filter(v=>typeof v==='string').slice(-1024):[];}catch{return [];}
  }
  function identity(options){return JSON.stringify([String(options.uid),String(options.receiptId)]);}
  function hasSeen(key){return seen.has(key)||readSeen().includes(key);}
  function remember(key){
    seen.add(key);
    try {root.localStorage?.setItem(storageKey,JSON.stringify([...new Set([...readSeen(),key])].slice(-1024)));}catch{}
  }
  const reducedMotion=()=>root.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true;
  function eligible(options,items){return !!(options.uid&&options.receiptId&&items.length&&options.isCurrent?.()!==false&&!hasSeen(identity(options)));}
  function cue(options){
    if(options.sound===false)return;
    try {root.QAGameAudio?.play('reward-chime',{key:'reward-presentation:'+identity(options)});}catch{}
  }
  function celebrate(options={}){
    if(!eligible(options,entries(options.reward)))return false;
    remember(identity(options));cue(options);return true;
  }
  const inlineRuns = new WeakMap();
  let active = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const itemArt=Object.freeze({
    cultivation:'cultivation',gold:'gold',fragments:'nascent-soul-essence',
    raidTickets:'raid-ticket',drawTickets:'draw-ticket',weaponDungeonTicket:'weapon-dungeon-ticket'
  });
  const weaponIds=new Set(['sword-wind','sword-flight','sword-sky','body-rock','body-dragon','body-tiger']);
  const number=value=>{
    if(typeof value!=='number'&&typeof value!=='string'||String(value).trim()==='')return null;
    const n=Number(value);return Number.isFinite(n)?Math.trunc(n):null;
  };
  const rows=value=>Array.isArray(value)?value:value&&typeof value==='object'?[value]:[];
  function entries(reward = {}, {feedback = false} = {}) {
    reward=reward||{};
    const result=kinds.flatMap(([key,label,path])=>{
      if(!Object.hasOwn(reward,key))return [];
      const amount=number(reward[key]);
      return amount!==null&&(feedback||amount>0)?[{key,label,amount,path,image:'/assets/items/'+itemArt[key]+'.webp'}]:[];
    });
    // The caller supplies already-authoritative drop / XP rows, not inventory balances.
    for(const [key,field,suffix] of [['weapon','quantity',''],['weaponXp','earned',' EXP']]){
      for(const row of rows(reward[key])){
        if(!row||!weaponIds.has(row.id))continue;
        const amount=number(row[field]);
        if(amount===null||amount<=0)continue;
        const name=String(row.name||'武器');
        result.push({key,label:name,amount,suffix,detail:key==='weapon'?String(row.tierRealm||'武器'):'武器熟練度',
          image:'/assets/weapons/'+row.id+'-hd.webp'});
      }
    }
    // Legacy material IDs are displayed only when explicitly supplied; never convert them to tickets.
    for(const [id,value] of Object.entries(reward.materials||{})){
      const catalog=root.QAItemIcons?.catalog;
      const legacyNames={'raid-refine-key-ii':'淬靈玄印','raid-refine-key-iii':'玄天道印'};
      const label=Object.hasOwn(legacyNames,id)?legacyNames[id]:catalog&&Object.hasOwn(catalog,id)?catalog[id].name:id;
      const amount=number(value);
      if(amount!==null&&amount>0)result.push({key:'material',label,amount,
        path:'M12 3 21 12 12 21 3 12Z'});
    }
    return result;
  }
  const icon = path => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+path+'"/></svg>';
  const rewardIcon=item=>item.image
    ?'<img class="'+(item.key==='gold'?'game-stone-icon':'game-resource-icon')+'" src="'+esc(item.image)+'" width="40" height="40" alt="" aria-hidden="true" decoding="async">'
    :icon(item.path||'M12 3 21 12 12 21 3 12Z');
  function amountText(item,{preview=false,value=item.amount}={}){
    const sign=value<0?'−':preview?'':'+';
    return sign+Math.abs(value).toLocaleString('zh-TW')+(item.suffix||'');
  }
  function renderItem(item,i,{small=false,preview=false,animated=false}={}){
    const label=item.label+(item.detail?' · '+item.detail:'');
    const amount=amountText(item,{preview,value:animated?0:item.amount});
    const tag=small?'span':'li';
    return '<'+tag+' class="mr-reward-item'+(item.key==='drawTickets'?' is-special':'')+(item.key==='weapon'?' mr-reward-item--weapon':'')+'" style="--mr-delay:'+i*90+'ms" aria-label="'+esc(label)+' '+esc(amountText(item,{preview}))+'"><span class="mr-reward-icon">'+rewardIcon(item)+'</span><span class="mr-reward-label">'+esc(item.label)+(item.detail?'<small class="mr-reward-detail">'+esc(item.detail)+'</small>':'')+'</span><strong class="mr-reward-amount" aria-hidden="true">'+esc(amount)+'</strong></'+tag+'>';
  }
  // Small feedback, general cards and full settlement share the same item renderer.
  function renderList(reward, {animated=false,inline=false,variant='full',preview=false}={}){
    const size=['small','general','full'].includes(variant)?variant:'full';
    const small=size==='small',items=entries(reward,{feedback:small});
    if(!items.length)return '';
    const tag=small?'span':'ul';
    const play=animated&&!small&&!preview;
    return '<'+tag+' class="mr-reward-list'+(inline?' mr-reward-list--inline':'')+(play?'':' mr-reward-list--static')+' mr-reward-list--'+size+'" aria-label="'+(preview?'可獲得的獎勵':'本次獲得的獎勵')+'">'+items.map((item,i)=>renderItem(item,i,{small,preview,animated:play})).join('')+'</'+tag+'>';
  }
  function renderFeedback(reward){return renderList(reward,{variant:'small'});}
  const states=Object.freeze({
    obtainable:'可獲得',pending:'待領取',settling:'結算中',claimed:'已領取',
    unconfirmed:'尚未確認入帳',none:'本次無額外獎勵'
  });
  function renderStatus(state,detail=''){
    const key=Object.hasOwn(states,state)?state:'unconfirmed';
    return '<span class="mr-reward-state mr-reward-state--'+key+'" data-reward-state="'+key+'">'+esc(states[key])+(detail?'<small>'+esc(detail)+'</small>':'')+'</span>';
  }
  function renderSettlement(reward,{emptyText='本次無額外獎勵。',pendingText='獎勵尚未確認入帳。',title='本次獲得'}={}){
    const cards=renderList(reward,{inline:true,variant:'full'});
    if(!cards)return '<p class="mr-reward-empty" role="status">'+renderStatus(reward==null?'unconfirmed':'none',reward==null?pendingText:emptyText)+'</p>';
    return '<section class="tc-trial-rewards" data-trial-reward-list><h3>'+esc(title)+'</h3>'+renderStatus('claimed')+cards+'</section>';
  }
  function ensureStyle() {
    if (document.getElementById('meditation-reward-style')) return;
    const style = document.createElement('link'); style.id = 'meditation-reward-style'; style.rel = 'stylesheet';
    style.href = '/styles/daily-meditation-rewards.css'; document.head.appendChild(style);
  }
  function finishNumbers(receipt) {
    receipt.elements.forEach((element, i) => { element.textContent = amountText(receipt.items[i]); });
  }
  // Number animation is presentation-only, shared by both settlement modes.
  function animateAmounts(receipt, isActive) {
    if (receipt.reduced || !root.requestAnimationFrame || !root.performance?.now) {
      finishNumbers(receipt); return;
    }
    const duration=receipt.duration||850;
    const stagger=receipt.stagger??90;
    const started = root.performance.now();
    function tick(now) {
      if (!isActive()) return;
      if(reducedMotion()){finishNumbers(receipt);receipt.onFinish?.();return;}
      receipt.elements.forEach((element,i)=>{
        const t=Math.max(0,Math.min(1,(now-started-i*stagger)/duration));
        element.textContent=amountText(receipt.items[i],{value:Math.round(receipt.items[i].amount*(1-Math.pow(1-t,3)))});
      });
      if (now-started < duration+(receipt.items.length-1)*stagger) receipt.frame=root.requestAnimationFrame(tick);
      else {finishNumbers(receipt);receipt.onFinish?.();}
    }
    receipt.frame=root.requestAnimationFrame(tick);
  }
  // Embedded receipts never take over focus, create another dialog, or claim rewards.
  function skipInline(host){
    const receipt=host&&inlineRuns.get(host);
    if(!receipt)return false;
    root.cancelAnimationFrame?.(receipt.frame);
    finishNumbers(receipt);receipt.onFinish?.();return true;
  }
  function animateInline(host, options = {}) {
    const items=entries(options.reward);
    if (!host || !eligible(options,items) || inlineRuns.has(host)) return false;
    const list=host.querySelector('.mr-reward-list');
    const elements=[...host.querySelectorAll('.mr-reward-amount')];
    if (!list || elements.length!==items.length) return false;
    const reduced=reducedMotion();
    remember(identity(options));cue(options);
    if (reduced || !root.requestAnimationFrame || !root.performance?.now) return false;
    const important=options.important!==false;
    const receipt={items,elements,reduced,frame:0,duration:important?850:250,stagger:important?90:30};
    let skip;
    receipt.onFinish=()=>{receipt.done=true;list.classList.add?.('mr-reward-list--static');skip?.remove();};
    inlineRuns.set(host,receipt);
    if(important&&host.ownerDocument&&typeof host.appendChild==='function'){
      skip=host.ownerDocument.createElement('button');skip.type='button';skip.className='mr-reward-skip';
      skip.textContent='略過動畫';skip.addEventListener('click',()=>skipInline(host));host.appendChild(skip);
    }
    list.classList.remove('mr-reward-list--static');
    elements.forEach((element,i)=>{element.textContent=amountText(items[i],{value:0});});
    animateAmounts(receipt,()=>{
      if(receipt.done)return false;
      if(host.isConnected===false||options.isCurrent?.()===false){finishNumbers(receipt);receipt.onFinish();return false;}
      return true;
    });
    return true;
  }
  function clear(restoreFocus = false) {
    const receipt = active;
    if (!receipt) return;
    active = null;
    root.cancelAnimationFrame?.(receipt.frame); root.clearTimeout(receipt.timer);
    receipt.animations.forEach(animation => animation.cancel());
    if (receipt.overlay.open && typeof receipt.overlay.close === 'function') receipt.overlay.close();
    receipt.overlay.remove(); document.body.classList.remove('meditation-reward-open');
    if (restoreFocus && receipt.isCurrent()) receipt.focusTarget?.()?.focus?.({ preventScroll: true });
  }
  function collect() {
    const receipt = active;
    if (!receipt || receipt.collecting) return;
    if (!receipt.isCurrent()) { clear(); return; }
    receipt.collecting = true; root.cancelAnimationFrame?.(receipt.frame); finishNumbers(receipt);
    receipt.overlay.querySelector('[data-mr-collect]').disabled = true;
    if (receipt.reduced || reducedMotion()) { clear(true); return; }
    receipt.overlay.classList.add('is-collecting');
    const target = receipt.target?.()?.getBoundingClientRect?.();
    const destination = target?.width && target?.height ? {x:target.left+target.width/2,y:target.top+target.height/2} : {x:root.innerWidth/2,y:48};
    const cards = [...receipt.overlay.querySelectorAll('.mr-reward-item')];
    const flights = cards.map((card, i) => {
      if (!card.animate) return Promise.resolve();
      const rect = card.getBoundingClientRect();
      const animation = card.animate([
        {transform:'translate(0,0) scale(1)',opacity:1},
        {transform:`translate(${destination.x-rect.left-rect.width/2}px,${destination.y-rect.top-rect.height/2}px) scale(.12)`,opacity:0}
      ], {duration:520,delay:i*55,easing:'cubic-bezier(.25,.65,.2,1)',fill:'forwards'});
      receipt.animations.push(animation); return animation.finished;
    });
    // The timeout also covers browsers without Web Animations or a suspended tab.
    receipt.timer = root.setTimeout(() => { if (active === receipt) clear(true); }, 650 + cards.length*55);
    if (cards.every(card => typeof card.animate === 'function')) void Promise.allSettled(flights).then(() => { if (active === receipt) clear(true); });
  }
  function show(options = {}) {
    const items = entries(options.reward);
    if (!eligible(options,items)) return false;
    ensureStyle(); clear();
    const overlay = document.createElement('dialog'); overlay.id='meditation-reward-receipt'; overlay.className='mr-reward-overlay';
    overlay.setAttribute('aria-labelledby','mr-reward-title'); overlay.setAttribute('aria-describedby','mr-reward-subtitle');
    overlay.innerHTML = '<section class="mr-reward-panel"><header class="mr-reward-header"><div class="mr-reward-crest" aria-hidden="true">'+icon('m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z')+'</div><span class="mr-reward-kicker">'+esc(options.kicker||'閉關共修')+'</span><h2 id="mr-reward-title">'+esc(options.title||'獎勵入袋')+'</h2><p id="mr-reward-subtitle">'+esc(options.subtitle||'本次獲得')+'</p></header>'+renderList(options.reward,{animated:true,variant:'full'})+'<footer class="mr-reward-footer">'+renderStatus('claimed')+(options.note?'<p class="mr-reward-note">'+esc(options.note)+'</p>':'')+'<button type="button" data-mr-collect>收入囊中</button><button type="button" class="mr-reward-skip" data-mr-skip>略過動畫</button></footer></section>';
    document.body.appendChild(overlay); document.body.classList.add('meditation-reward-open');
    const receipt = active = {overlay,items,elements:[...overlay.querySelectorAll('.mr-reward-amount')],reduced:reducedMotion(),isCurrent:options.isCurrent||(()=>true),target:options.target,focusTarget:options.focusTarget,animations:[],frame:0,timer:0,collecting:false};
    overlay.querySelector('[data-mr-collect]').addEventListener('click',collect);
    overlay.querySelector('[data-mr-skip]').addEventListener('click',()=>clear(true));
    if(receipt.reduced)overlay.querySelector('[data-mr-skip]').hidden=true;
    overlay.addEventListener('cancel', event=>{event.preventDefault();clear(true);});
    overlay.addEventListener('click',event=>{if(event.target===overlay)collect();});
    if (typeof overlay.showModal === 'function') overlay.showModal(); else overlay.setAttribute('open','');
    remember(identity(options));
    animateAmounts(receipt,()=>{if(active!==receipt)return false;if(!receipt.isCurrent()){clear();return false;}return true;});
    cue(options); return true;
  }
  // Fetch the small stylesheet before a claim, so the first receipt cannot flash unstyled.
  if (typeof document === 'object' && document.head) ensureStyle();
  return Object.freeze({entries,renderList,renderFeedback,renderStatus,renderSettlement,animateInline,skipInline,celebrate,show,clear});
});
