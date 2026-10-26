import './weapon-system-rules.js';

// Match the main branch's three-item showcase without changing the random pool.
export function createWeaponShowcase({icon,find,visible}) {
  const W=globalThis.QAWeapons, motion=matchMedia('(prefers-reduced-motion: reduce)');
  const DELAY=4800, MOVE=660;
  let start=0, timer=null, moveTimer=null, preview=null, trigger=null;

  function markup() {
    const count=W.TYPES.length, center=(start+1)%count+1;
    const cards=Array.from({length:Math.min(count,4)},(_,position)=>{
      const type=W.TYPES[(start+position)%count], offscreen=position>=3;
      return `<button type="button" class="sb-carousel-card${position===1?' is-center':''}" data-weapon-preview="${type.id}" style="--sb-color:${type.color}" aria-label="查看${type.name}詳細資料"${offscreen?' aria-hidden="true" tabindex="-1"':''}><span class="sb-carousel-art">${icon(type.id)}</span><b>${type.name}</b><small>${type.label} · 20%</small></button>`;
    }).join('');
    return `<section class="sb-showcase wf-showcase" aria-label="五種兵器共用獎池"><div class="sb-showcase-heading"><h3>常駐兵器</h3><div class="sb-carousel-nav"><button type="button" data-weapon-prev aria-label="查看上一件兵器">‹</button><span class="sb-carousel-count" aria-label="中央兵器為第 ${center} 件，共 ${count} 件">${String(center).padStart(2,'0')} / ${String(count).padStart(2,'0')}</span><button type="button" data-weapon-next aria-label="查看下一件兵器">›</button></div></div><div class="sb-carousel-viewport" aria-label="每次展示三件兵器，中央兵器較大"><div class="sb-carousel-track">${cards}</div></div><p class="sb-carousel-hint">點擊兵器查看詳細資料 · 五種兵器隨機抽取</p></section>`;
  }
  function stop() {
    clearTimeout(timer);clearTimeout(moveTimer);timer=moveTimer=null;
    find()?.querySelector('.sb-carousel-track')?.classList.remove('is-shifting');
  }
  function allowed() {
    return visible()&&!document.hidden&&!preview&&!document.querySelector('.wf-draw-reveal')&&!motion.matches;
  }
  function schedule() {
    clearTimeout(timer);timer=null;
    if(!allowed())return;
    timer=setTimeout(()=>{
      timer=null;
      const showcase=find();if(!showcase||!allowed())return;
      if(showcase.matches(':hover')||showcase.matches(':focus-within')){schedule();return;}
      const track=showcase.querySelector('.sb-carousel-track');if(!track)return;
      track.classList.add('is-shifting');
      moveTimer=setTimeout(()=>{
        moveTimer=null;
        if(!allowed()||!showcase.isConnected){stop();return;}
        start=(start+1)%W.TYPES.length;showcase.outerHTML=markup();schedule();
      },MOVE);
    },DELAY);
  }
  function manual(delta) {
    stop();const showcase=find();if(!showcase)return;
    start=(start+delta+W.TYPES.length)%W.TYPES.length;showcase.outerHTML=markup();
    find()?.querySelector(delta<0?'[data-weapon-prev]':'[data-weapon-next]')?.focus({preventScroll:true});
    schedule();
  }
  function closePreview(restore=true) {
    if(!preview)return;
    preview.close();preview.remove();preview=null;
    if(restore&&trigger?.isConnected)trigger.focus({preventScroll:true});
    trigger=null;if(restore)schedule();
  }
  function showPreview(typeId,button) {
    const type=W.get(typeId);if(!type||!visible())return;
    stop();closePreview(false);trigger=button;
    preview=document.createElement('dialog');preview.className='wf-preview-overlay';
    preview.setAttribute('aria-labelledby','wf-preview-title');
    preview.innerHTML=`<section class="sb-preview-card" style="--sb-color:${type.color}"><button type="button" class="sb-preview-close" data-weapon-preview-close aria-label="關閉兵器預覽">×</button><div class="sb-preview-art">${icon(type.id)}</div><div class="sb-preview-info"><small>煉氣境 · ${type.label} · ${type.tag}</small><h3 id="wf-preview-title">${type.name}</h3><p>${type.rangeText}</p><div class="sb-preview-stats"><span>體力 ${type.cost}</span><span>傷害 ${Math.round(type.power*100)}% 攻擊</span><span>機率 20%</span></div><p class="sb-preview-description">${type.description}</p><span class="sb-preview-hint">每抽必得一把煉氣兵器，同款可用於境界進階。</span></div></section>`;
    preview.addEventListener('click',event=>{if(event.target===preview||event.target.closest('[data-weapon-preview-close]'))closePreview();});
    preview.addEventListener('cancel',event=>{event.preventDefault();closePreview();});
    document.body.append(preview);preview.showModal();
    preview.querySelector('[data-weapon-preview-close]').focus({preventScroll:true});
  }
  function handle(button) {
    if(button.dataset.weaponPreview){showPreview(button.dataset.weaponPreview,button);return true;}
    if(button.hasAttribute('data-weapon-prev')||button.hasAttribute('data-weapon-next')){manual(button.hasAttribute('data-weapon-prev')?-1:1);return true;}
    return false;
  }
  function pause() {stop();closePreview(false);}
  function reset() {pause();start=0;}
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else schedule();});
  window.addEventListener('pagehide',pause);
  motion.addEventListener('change',()=>{stop();schedule();});
  return {markup,schedule,stop,pause,reset,handle};
}
