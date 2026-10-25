import './weapon-system-rules.js';

// Presentation only: every card comes from an already committed draw receipt.
export function showWeaponDraw({draw,icon,isCurrent,onClose,opening=true}){
  const W=globalThis.QAWeapons,reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const overlay=document.createElement('dialog'),timers=new Set(),revealed=new Set();
  let destroyed=false,cardsStarted=false;
  overlay.className='sb-reveal-overlay wf-draw-reveal';overlay.setAttribute('aria-labelledby','wf-draw-title');
  document.body.append(overlay);document.body.classList.add('sb-reveal-open');
  const later=(fn,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);if(!destroyed){if(isCurrent())fn();else destroy();}},ms);timers.add(timer);};
  function destroy(){if(destroyed)return;destroyed=true;for(const timer of timers)clearTimeout(timer);timers.clear();overlay.close();overlay.remove();document.body.classList.remove('sb-reveal-open');}
  function close(toForge=false){const current=isCurrent();destroy();if(current)onClose(toForge);}
  function finishCard(index){
    if(revealed.has(index))return;revealed.add(index);
    const card=overlay.querySelector(`[data-draw-card="${index}"]`);card?.classList.remove('is-flipping');card?.classList.add('is-revealed');
    card?.querySelector('.sb-reveal-front')?.setAttribute('aria-hidden','false');
    const back=card?.querySelector('[data-draw-flip]');if(back){back.disabled=true;back.setAttribute('tabindex','-1');back.setAttribute('aria-hidden','true');}
    const count=overlay.querySelector('[data-draw-progress]');if(count)count.textContent=revealed.size+' / '+draw.count;
    if(revealed.size===draw.count){overlay.querySelector('#wf-draw-title').textContent='尋器所得';overlay.querySelector('[data-draw-forge]').hidden=false;overlay.querySelector('[data-draw-done]').hidden=false;overlay.querySelector('[data-draw-skip]').hidden=true;}
  }
  function flip(index){const card=overlay.querySelector(`[data-draw-card="${index}"]`);if(!card||card.classList.contains('is-flipping')||revealed.has(index))return;
    const back=card.querySelector('[data-draw-flip]');if(back)back.disabled=true;
    if(reduced)finishCard(index);else{card.classList.add('is-flipping');later(()=>finishCard(index),650);}
  }
  function startCards(){
    if(cardsStarted)return;cardsStarted=true;
    const cards=draw.results.map((row,i)=>{const type=W.get(row.type),angle=(-90+i*72)*Math.PI/180;
      return `<div class="sb-reveal-card" data-draw-card="${i}" style="--sb-x:${50+32*Math.cos(angle)}%;--sb-y:${50+32*Math.sin(angle)}%;--sb-color:${type.color}"><div class="sb-reveal-card-inner"><button type="button" class="sb-reveal-back" data-draw-flip="${i}" aria-label="翻開第 ${i+1} 張兵器牌"><span class="sb-card-ornament" aria-hidden="true">✧</span><span class="sb-card-seal" aria-hidden="true">器</span><span>${draw.count===1?'點擊翻牌':i+1}</span></button><section class="sb-reveal-front" aria-hidden="true"><small class="sb-reveal-rarity">煉氣兵器</small><div class="sb-reveal-art">${icon(type.id)}</div><h3>${type.name}</h3><p>${type.rangeText}</p></section></div></div>`;
    }).join('');
    overlay.innerHTML=`<button type="button" class="sb-reveal-close" data-draw-close aria-label="關閉抽取結果">×</button><div class="sb-reveal-stage ${draw.count===5?'sb-reveal-batch':''}"><header class="sb-reveal-heading"><span>尋器</span><h2 id="wf-draw-title">${draw.count===5?'五器連啟':'點擊翻開兵器牌'}</h2><p data-draw-progress role="status">0 / ${draw.count}</p></header>${draw.count===5?`<div class="sb-pentagon" aria-label="五張兵器牌排列於正五邊形頂點"><svg class="sb-pentagon-lines" viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,18 80.433809,40.111456 68.809128,75.888544 31.190872,75.888544 19.566191,40.111456"/></svg><span class="sb-pentagon-mark" aria-hidden="true">器</span>${cards}</div>`:cards}<footer class="sb-reveal-footer"><div class="sb-reveal-actions"><button type="button" data-draw-skip>略過演出</button><button type="button" data-draw-done hidden>完成</button><button type="button" class="sb-primary" data-draw-forge hidden>查看兵器庫</button></div><p class="sb-reveal-message">兵器已入庫，同款可用於境界進階。</p><small class="sb-reveal-payment">${draw.payment==='free'?'首次免費':draw.spent.toLocaleString('zh-TW')+' '+W.PAYMENTS[draw.payment].label}</small></footer></div>`;
    if(draw.count===5)draw.results.forEach((_,i)=>later(()=>flip(i),reduced?100+i*100:350+i*850));
    overlay.querySelector('[data-draw-flip]')?.focus({preventScroll:true});
  }
  overlay.addEventListener('click',event=>{const b=event.target.closest('button');if(!b||b.disabled)return;if(!isCurrent()){destroy();return;}
    if(b.hasAttribute('data-draw-close')||b.hasAttribute('data-draw-done'))close();
    else if(b.hasAttribute('data-draw-forge'))close(true);
    else if(b.hasAttribute('data-draw-flip'))flip(Number(b.dataset.drawFlip));
    else if(b.hasAttribute('data-draw-skip')){startCards();draw.results.forEach((_,i)=>finishCard(i));}
  });
  overlay.addEventListener('cancel',event=>{event.preventDefault();close();});overlay.showModal();
  if(opening&&!reduced){overlay.innerHTML='<div class="sb-reveal-stage sb-reveal-opening"><div class="sb-opening-seal-anchor"><div class="sb-seal"><span>器</span></div></div><div class="sb-opening-footer"><h2 id="wf-draw-title">靈光聚合 · 契印開啟</h2><button type="button" data-draw-skip>略過演出</button><button type="button" data-draw-close>稍後查看</button></div></div>';later(startCards,1400);}else startCards();
  if(opening)window.QAGameAudio?.play?.('grand-reveal',{key:'weapon-draw:'+draw.requestId});
  return destroy;
}
