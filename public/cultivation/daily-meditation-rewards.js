// Visual receipts only. All rewards are committed by the meditation API first.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QAMeditationRewardFeedback = api;
})(typeof globalThis === 'object' ? globalThis : this, function (root) {
  'use strict';
  const kinds = [
    ['cultivation', '修為', 'M12 3 5 13h6l-1 8 9-12h-6l1-6Z'],
    ['gold', '靈石', 'm12 3 8 6-3 10H7L4 9l8-6Zm-8 6h16M7 19l5-16 5 16'],
    ['fragments', '元嬰碎精', 'm12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3 3-6Z'],
    ['raidTickets', '團本入場券', 'M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4V6Zm12 1v10'],
    ['drawTickets', '本命法器抽獎券', 'M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4V6Zm9 3 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z']
  ];
  const seen = new Set();
  let active = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function entries(reward = {}) {
    return kinds.flatMap(([key, label, path]) => {
      const amount = Math.floor(Number(reward[key]));
      return Number.isFinite(amount) && amount > 0 ? [{ key, label, amount, path }] : [];
    });
  }
  const icon = path => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+path+'"/></svg>';
  function ensureStyle() {
    if (document.getElementById('meditation-reward-style')) return;
    const style = document.createElement('link'); style.id = 'meditation-reward-style'; style.rel = 'stylesheet';
    style.href = '/styles/daily-meditation-rewards.css'; document.head.appendChild(style);
  }
  function finishNumbers(receipt) {
    receipt.elements.forEach((element, i) => { element.textContent = '+' + receipt.items[i].amount.toLocaleString('zh-TW'); });
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
    if (receipt.reduced) { clear(true); return; }
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
  function chime(receipt) {
    if (!receipt.sound) return;
    root.QAGameAudio?.play('reward-chime', { key: receipt.soundKey });
  }
  function show(options = {}) {
    const items = entries(options.reward), key = options.uid + ':' + options.receiptId;
    if (!options.uid || !options.receiptId || !items.length || seen.has(key) || options.isCurrent?.() === false) return false;
    ensureStyle(); clear();
    const overlay = document.createElement('dialog'); overlay.id='meditation-reward-receipt'; overlay.className='mr-reward-overlay';
    overlay.setAttribute('aria-labelledby','mr-reward-title'); overlay.setAttribute('aria-describedby','mr-reward-subtitle');
    overlay.innerHTML = '<section class="mr-reward-panel"><header class="mr-reward-header"><div class="mr-reward-crest" aria-hidden="true">'+icon('m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z')+'</div><span class="mr-reward-kicker">'+esc(options.kicker||'閉關共修')+'</span><h2 id="mr-reward-title">'+esc(options.title||'獎勵入袋')+'</h2><p id="mr-reward-subtitle">'+esc(options.subtitle||'本次獲得')+'</p></header><ul class="mr-reward-list" aria-label="本次獲得的獎勵">'+items.map((item,i)=>'<li class="mr-reward-item'+(item.key==='drawTickets'?' is-special':'')+'" style="--mr-delay:'+i*90+'ms" aria-label="'+esc(item.label)+' +'+item.amount+'"><span class="mr-reward-icon">'+icon(item.path)+'</span><span class="mr-reward-label">'+esc(item.label)+'</span><strong class="mr-reward-amount" aria-hidden="true">+0</strong></li>').join('')+'</ul><footer class="mr-reward-footer">'+(options.note?'<p class="mr-reward-note">'+esc(options.note)+'</p>':'')+'<button type="button" data-mr-collect>收入囊中</button></footer></section>';
    document.body.appendChild(overlay); document.body.classList.add('meditation-reward-open');
    const receipt = active = {overlay,items,elements:[...overlay.querySelectorAll('.mr-reward-amount')],reduced:root.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true,isCurrent:options.isCurrent||(()=>true),target:options.target,focusTarget:options.focusTarget,sound:options.sound!==false,soundKey:'meditation-reward:'+key,animations:[],frame:0,timer:0,collecting:false};
    overlay.querySelector('[data-mr-collect]').addEventListener('click',collect);
    overlay.addEventListener('cancel', event=>{event.preventDefault();clear(true);});
    overlay.addEventListener('click',event=>{if(event.target===overlay)collect();});
    if (typeof overlay.showModal === 'function') overlay.showModal(); else overlay.setAttribute('open','');
    seen.add(key); if(seen.size>150)seen.delete(seen.values().next().value);
    if (receipt.reduced || !root.requestAnimationFrame || !root.performance?.now) finishNumbers(receipt);
    else {
      const started = root.performance.now();
      function tick(now) {
        if (active !== receipt) return;
        if (!receipt.isCurrent()) { clear(); return; }
        receipt.elements.forEach((element,i)=>{const t=Math.max(0,Math.min(1,(now-started-i*90)/850));element.textContent='+'+Math.round(receipt.items[i].amount*(1-Math.pow(1-t,3))).toLocaleString('zh-TW');});
        if (now-started < 850+(items.length-1)*90) receipt.frame=root.requestAnimationFrame(tick);
        else finishNumbers(receipt);
      }
      receipt.frame=root.requestAnimationFrame(tick);
    }
    chime(receipt); return true;
  }
  // Fetch the small stylesheet before a claim, so the first receipt cannot flash unstyled.
  if (typeof document === 'object' && document.head) ensureStyle();
  return Object.freeze({entries,show,clear});
});
