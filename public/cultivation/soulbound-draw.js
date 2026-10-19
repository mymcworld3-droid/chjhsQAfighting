import {} from './soulbound-pool.js';
import './training-access-rules.js';
import { getArtifactById, artifactRealmColor } from './artifact-catalog.js';
import { authenticatedMainFetch, getMainUser } from './data/project-repository.js';

(function () {
  'use strict';
  const pool = globalThis.QASoulboundPool;
  let snapshot = null, account = '', busy = false, message = '', animationTimer = null, flipTimer = null, autoTimer = null, presentation = null, externalDirty = false;
  const CAROUSEL_DELAY_MS = 4800, CAROUSEL_MOVE_MS = 660;
  let carouselStart = 0, carouselTimer = null, carouselMoveTimer = null;
  let previewItemId = '', previewTrigger = null;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const visible = () => document.getElementById('page-training')?.classList.contains('active-page') &&
    document.querySelector('[data-training-tab="contract"]')?.classList.contains('active') && !!$('soulbound-page');
  const data = () => window.getCurrentUserData?.();
  const equipped = () => getArtifactById(data()?.artifactSystem?.equipped?.['本命法寶']);
  const storageKey = uid => 'soulbound-operation:' + uid;
  function storedOperation() {
    try { return JSON.parse(localStorage.getItem(storageKey(account)) || 'null'); } catch (_) { return null; }
  }
  function forgetOperation() { try { localStorage.removeItem(storageKey(account)); } catch (_) {} }
  function reconcile() {
    const uid = getMainUser()?.uid || '';
    if (account !== uid) {
      closePresentation(false); stopCarousel(); account = uid; snapshot = null;
      carouselStart = 0; message = ''; externalDirty = false; previewItemId = ''; previewTrigger = null;
      $('soulbound-animation')?.remove(); $('soulbound-preview')?.remove();
    }
    return uid;
  }
  async function request(action = '', body) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await authenticatedMainFetch('/api/soulbound' + (action ? '/' + action : ''),
        { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) {
        throw Object.assign(new Error(payload.error || '契器台暫時無法使用'), { definitive: payload.ok === false && !!payload.error && response.status >= 400 && response.status < 500 });
      }
      return payload;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('同步逾時；可重試原操作');
      throw e;
    } finally { clearTimeout(timer); }
  }
  function apply(payload) {
    snapshot = payload;
    const current = data();
    if (current) {
      current.stats ||= {}; current.stats.gold = payload.balance; current.forgeFragments = Number(payload.fragments) || 0;
      current.soulboundDrawTickets = Number(payload.drawTickets) || 0;
      current.artifactSystem ||= {}; current.artifactSystem.inventory = { ...payload.inventory };
      window.updateUIStats?.();
      window.dispatchEvent(new CustomEvent('artifact-system-updated'));
      window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', { detail: { source: 'soulbound' } }));
    }
  }
  function effectText(item) {
    if (!item) return '尚未調御';
    return (item.effects || []).filter(e => !['equip_attack_flat', 'equip_hp_flat'].includes(e.type)).map(e => {
      const type = pool.TYPES.find(t => t.effect === e.type);
      return type ? `${type.label} ${pool.valueText(e.type, e.value)}` : `${item.description || e.type}`;
    }).join('；') || item.description || '基礎屬性加成';
  }
  function base(item, type) { return (item?.effects || []).filter(e => e.type === type).reduce((sum, e) => sum + Number(e.value || 0), 0); }
  function image(item) {
    return item?.imageUrl ? `<img src="${esc(item.imageUrl)}" alt="${esc(item.name)}" width="144" height="144">`
      : `<span class="sb-fallback" aria-hidden="true">${esc(item?.icon || '契')}</span>`;
  }
  function showcaseMarkup(candidates) {
    // Three visible weapons; a fourth offscreen card enters from the right
    // as the leftmost one slides away.
    const count = candidates.length, length = Math.min(count, 4);
    const cards = Array.from({ length }, (_, position) => {
      const a = candidates[(carouselStart + position) % count];
      const offscreen = position >= 3;
      return `<button type="button" class="sb-carousel-card${position === 1 ? ' is-center' : ''}"
        data-sb-preview="${esc(a.id)}" style="--sb-color:${esc(artifactRealmColor(a.realm))}"
        aria-label="查看${esc(a.name)}詳細資料"${offscreen ? ' aria-hidden="true" tabindex="-1"' : ''}>
        <span class="sb-carousel-art">${image(a)}</span><b>${esc(a.name)}</b>
        <small>${esc(a.realm)}</small></button>`;
    }).join('');
    const number = count ? ((carouselStart + 1) % count) + 1 : 0;
    return `<section class="sb-showcase" aria-label="常駐本命法器共用池">
      <div class="sb-showcase-heading"><h3>常駐法器</h3>
      <div class="sb-carousel-nav">
        <button type="button" data-sb-carousel-prev aria-label="查看上一件法器">‹</button>
        <span class="sb-carousel-count" aria-label="中央法器為第 ${number} 件，共 ${count} 件">${String(number).padStart(2, '0')} / ${String(count).padStart(2, '0')}</span>
        <button type="button" data-sb-carousel-next aria-label="查看下一件法器">›</button>
      </div></div>
      <div class="sb-carousel-viewport" aria-label="每次展示三件法器，中央法器較大">
        <div class="sb-carousel-track">${cards}</div>
      </div>
      <p class="sb-carousel-hint">點擊法器查看詳細資料，亦可使用碎片指定兌換</p>
    </section>`;
  }
  function probabilityMarkup(rank, version = pool.VERSION) {
    return `<details class="sb-details sb-probability"><summary>抽取機率與保底</summary>
      <p>獎池版本 ${esc(version)}。完整武器機率 2%，其餘 98% 獲得 20–40 個煉器碎片；
      連續 ${pool.PITY - 1} 抽未出武器，第 ${pool.PITY} 抽必出。八種器型共用常駐池，
      每種器型佔完整武器結果的 12.5%。${rank === 7 ? '真仙品質不再升階。' : '抽中武器時，80% 為目前品質、20% 高一階。'}
      抽取不指定器型。</p></details>`;
  }
  function stopCarousel() {
    clearTimeout(carouselTimer); clearTimeout(carouselMoveTimer);
    carouselTimer = null; carouselMoveTimer = null;
    $('soulbound-content')?.querySelector('.sb-carousel-track')?.classList.remove('is-shifting');
  }
  function carouselAllowed() {
    if (previewItemId || !visible() || document.hidden || $('soulbound-animation')) return false;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    return true;
  }
  function scheduleCarousel() {
    clearTimeout(carouselTimer); carouselTimer = null;
    if (!carouselAllowed()) return;
    carouselTimer = setTimeout(() => {
      carouselTimer = null;
      const showcase = $('soulbound-content')?.querySelector('.sb-showcase');
      if (!showcase || !carouselAllowed()) return;
      if (showcase.matches?.(':hover') || showcase.matches?.(':focus-within')) {
        scheduleCarousel(); return;
      }
      const track = showcase.querySelector('.sb-carousel-track');
      if (!track || track.children.length < 4) return;
      track.classList.add('is-shifting');
      carouselMoveTimer = setTimeout(() => {
        carouselMoveTimer = null;
        if (!carouselAllowed() || !showcase.isConnected) return;
        carouselStart = (carouselStart + 1) % pool.TYPES.length;
        const rank = snapshot?.rank ?? Math.max(0, pool.rankFor(window.getTrainingAccessScore?.() ??
          globalThis.QATrainingAccessRules.score(data())));
        const candidates = pool.candidates(Math.max(0, rank));
        if (candidates.length) showcase.outerHTML = showcaseMarkup(candidates);
        scheduleCarousel();
      }, CAROUSEL_MOVE_MS);
    }, CAROUSEL_DELAY_MS);
  }
  function manualCarousel(delta) {
    stopCarousel();
    const showcase = $('soulbound-content')?.querySelector('.sb-showcase');
    const rank = snapshot?.rank ?? Math.max(0, pool.rankFor(window.getTrainingAccessScore?.() ??
      globalThis.QATrainingAccessRules.score(data())));
    const candidates = pool.candidates(Math.max(0, rank));
    if (!showcase || !candidates.length) return;
    carouselStart = (carouselStart + delta + candidates.length) % candidates.length;
    showcase.outerHTML = showcaseMarkup(candidates);
    $('soulbound-content')?.querySelector(delta < 0 ? '[data-sb-carousel-prev]' : '[data-sb-carousel-next]')?.focus({ preventScroll: true });
    scheduleCarousel();
  }
  function previewMarkup(item) {
    const rank = snapshot?.rank ?? -1;
    const canRedeem = rank >= 0 && pool.candidates(rank).some(row => row.id === item.id);
    const price = snapshot?.redemptionCost ?? pool.redemptionCost(Math.max(0, rank));
    const disabled = busy || !!snapshot?.pending || !!storedOperation() || Number(snapshot?.fragments || 0) < price;
    return `<section class="sb-preview-card" role="dialog" aria-modal="true" aria-labelledby="sb-preview-title"
      style="--sb-color:${esc(artifactRealmColor(item.realm))}">
      <button type="button" class="sb-preview-close" data-sb-close aria-label="關閉法器詳細資料">×</button>
      <div class="sb-preview-art">${image(item)}</div>
      <div class="sb-preview-info">
        <small>${esc(item.realm)} · ${esc(item.weaponForm || '本命法器')}</small>
        <h3 id="sb-preview-title">${esc(item.name)}</h3>
        <p>${esc(effectText(item))}</p>
        <div class="sb-preview-stats"><span>攻擊 +${base(item, 'equip_attack_flat')}</span>
        <span>生命 +${base(item, 'equip_hp_flat')}</span></div>
        <p class="sb-preview-description">${esc(item.description || '')}</p>
        <span class="sb-preview-hint">抽獎仍為八器共用池；碎片兌換可指定目前境界的器型。</span>
         ${canRedeem ? `<button type="button" class="sb-primary" data-sb-redeem="${esc(item.id)}" ${disabled ? 'disabled' : ''}>${price.toLocaleString('zh-TW')} 碎片兌換此器</button>` : ''}
      </div></section>`;
  }
  function showPreview(itemId, trigger) {
    const item = getArtifactById(itemId) || pool.get(itemId);
    if (!item || item.equipSlot !== '本命法寶') return;
    stopCarousel();
    previewItemId = itemId; previewTrigger = trigger || null;
    const page = $('soulbound-page');
    if (!page) return;
    $('soulbound-preview')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'soulbound-preview'; overlay.className = 'sb-preview-overlay';
    overlay.innerHTML = previewMarkup(item);
    page.appendChild(overlay);
    overlay.addEventListener('click', e => {
      const redeem = e.target.closest?.('[data-sb-redeem]');
      if (redeem && !redeem.disabled && !busy) {
        const itemId = redeem.dataset.sbRedeem;
        const expectedFragments = snapshot?.redemptionCost;
        hidePreview();
        void runOperation({ action:'redeem', body:{ itemId, expectedFragments, poolVersion:pool.VERSION, requestId:crypto.randomUUID() } });
      } else if (e.target.closest?.('[data-sb-close]') || e.target === overlay) hidePreview();
    });
    overlay.querySelector('[data-sb-close]')?.focus();
  }
  function hidePreview() {
    if (!previewItemId) return;
    previewItemId = ''; $('soulbound-preview')?.remove();
    if (previewTrigger?.isConnected) previewTrigger.focus();
    previewTrigger = null;
    scheduleCarousel();
  }
  function render() {
    if (!$('soulbound-content')) return;
    stopCarousel(); // Data refreshes must not leave an obsolete slide transition alive.
    reconcile();
    // Switching tabs can replace the contract page while its dialog was open.
    if (previewItemId && !$('soulbound-preview')) { previewItemId = ''; previewTrigger = null; }
    const operation = storedOperation(), current = equipped(), s = snapshot;
    $('soulbound-status').textContent = message;
    $('soulbound-refresh').disabled = busy;
    if (!s) {
      const score = window.getTrainingAccessScore?.() ?? globalThis.QATrainingAccessRules.score(data());
      const rank = Math.max(0, pool.rankFor(score)), candidates = pool.candidates(rank);
      const status = !account ? '請登入後締結本命。' : busy ? '正在同步契印…' : '契印尚未同步，請按「重新同步」。';
      $('soulbound-content').innerHTML = `<p class="sb-empty">${status}</p>${showcaseMarkup(candidates)}${probabilityMarkup(rank)}`;
      scheduleCarousel();
      return;
    }
    const pending = s.pending;
    const rank = s.rank, candidates = pool.candidates(Math.max(0, rank));
    $('soulbound-content').innerHTML = `<div class="sb-summary"><div><small>靈石餘額</small><strong>${s.balance.toLocaleString('zh-TW')}</strong></div><div><small>煉器碎片</small><strong>${Number(s.fragments || 0).toLocaleString('zh-TW')}</strong></div><div><small>目前本命</small><b>${esc(current?.name || '尚未調御')}</b><span>${esc(current?.realm || '選擇適合自己的器型')}</span></div><div><small>距離武器保底</small><b>${s.untilPity} 抽</b><span>累計 ${s.draws} 抽 · 出武器後重計</span></div></div>
      <div class="sb-pity"><progress value="${Number(s.misses || 0)}" max="${pool.PITY}" aria-label="本輪未出武器 ${Number(s.misses || 0)} 抽"></progress><span>八種武器同池 · 至多 ${pool.PITY} 抽必得一件完整武器</span></div>
      ${operation && !pending ? '<button type="button" data-sb-retry class="sb-primary">重試上次未確認的操作</button><p class="sb-note">使用同一編號重試，不會再次扣除碎片或靈石。</p>' : ''}
      ${pending ? '<button type="button" data-sb-resume class="sb-primary">繼續翻牌 · 本批抽結果已保存</button>' : ''}
      <div class="sb-lobby">${showcaseMarkup(candidates)}<section class="sb-draw-controls"><h3>締結本命</h3><p>八種本命法器一起抽；至多 ${pool.PITY} 抽必得其中一件完整武器。</p>
        ${s.draws === 0 ? `<p class="sb-first">首抽 250 靈石；單抽與五連共用 ${pool.PITY} 抽保底，結果先保存再演出。</p>` : ''}
        <div class="sb-actions"><button type="button" data-sb-draw="1" class="sb-primary" ${busy || operation || pending || rank < 0 || s.balance < s.prices?.single ? 'disabled' : ''}>單抽 · ${s.prices?.single ?? '—'} 靈石</button><button type="button" data-sb-draw="5" ${busy || operation || pending || rank < 0 || s.balance < s.prices?.five ? 'disabled' : ''}>五連抽 · ${s.prices?.five ?? '—'} 靈石</button></div>
        <p class="sb-first">本命法器抽獎券：${Number(s.drawTickets || 0)} 張 · 閉關共修可獲得</p>
        <div class="sb-actions"><button type="button" data-sb-draw="1" data-sb-payment="ticket" ${busy || operation || pending || rank < 0 || Number(s.drawTickets || 0) < 1 ? 'disabled' : ''}>用券單抽 · 1 張</button><button type="button" data-sb-draw="5" data-sb-payment="ticket" ${busy || operation || pending || rank < 0 || Number(s.drawTickets || 0) < 5 ? 'disabled' : ''}>用券五連 · 5 張</button></div>
        <p class="sb-note">${pending ? '先確認本批結果，即可繼續抽取或兌換。' : `一般武器機率 2%；其餘獲得 20–40 碎片。出武器後重置保底進度。`}</p></section></div>
      ${probabilityMarkup(rank, s.poolVersion)}
      <details class="sb-details"><summary>物品分解與碎片煉器</summary><p>材料、普通法器及本命法器可多選分解，確認後換成煉器碎片；裝備中的份數會保留。</p><button type="button" data-inventory-dismantle>物品分解</button></details>`;
    if (presentation && !s.pending) closePresentation();
    else if (presentation && presentation.phase === 'revealed') renderPresentation();
    scheduleCarousel();
  }
  async function refresh() {
    if (busy || !reconcile()) { render(); return; }
    const uid = account; externalDirty = false; busy = true; render();
    try {
      const payload = await request();
      if (getMainUser()?.uid !== uid) return;
      apply(payload);
      const operation = storedOperation();
      if (operation?.action === 'draw' && payload.pending?.requestId === operation.body.requestId) forgetOperation();
      message = payload.pending ? '已找回尚未查看完的抽取結果。' : '';
      if (payload.pending && !presentation) openPresentation(payload.pending, false);
    } catch (e) { if (getMainUser()?.uid === uid) message = e.message; }
    finally { busy = false; render(); if (visible() && (getMainUser()?.uid !== uid || externalDirty)) { externalDirty = false; void refresh(); } }
  }
  function closePresentation(restoreFocus = true) {
    clearTimeout(animationTimer); clearTimeout(flipTimer); clearTimeout(autoTimer); animationTimer = null; flipTimer = null; autoTimer = null;
    const trigger = presentation?.trigger;
    presentation = null;
    const overlay = $('soulbound-animation');
    if (overlay?.open && typeof overlay.close === 'function') overlay.close();
    overlay?.remove();
    document.body.classList.remove('sb-reveal-open');
    if (restoreFocus) {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      else if (visible()) $('soulbound-content')?.querySelector('[data-sb-resume], [data-sb-draw]')?.focus({ preventScroll: true });
    }
    scheduleCarousel();
  }
  function resultMarkup(row, compact = false) {
    const item = row.itemId && (getArtifactById(row.itemId) || pool.get(row.itemId));
    return `<span class="sb-reveal-rarity">${item ? esc(item.realm) + (compact ? ' · 法器' : ' · 本命法器') : compact ? '碎片' : '煉器資源'}${row.pity ? ' · 保底' : row.higher ? ' · 高階' : ''}</span>
      <div class="sb-reveal-art">${item ? image(item) : '<span class="sb-fragment-art" aria-hidden="true">✦</span>'}</div>
      <h3>${item ? esc(item.name) : row.itemId ? esc(row.itemId) : '煉器碎片 ×' + Number(row.fragments || 0)}</h3>
      <p>${item ? esc(effectText(item)) : row.itemId ? '法器已存入寶庫。' : '已存入碎片餘額，可用於煉器或兌換法器。'}</p>
      ${item ? `<div class="sb-reveal-stats"><span>攻擊 +${base(item, 'equip_attack_flat')}</span><span>生命 +${base(item, 'equip_hp_flat')}</span></div>` : ''}`;
  }
  function renderPresentation() {
    const state = presentation, overlay = $('soulbound-animation');
    if (!state || !overlay) return;
    if (state.phase === 'seal') {
      overlay.innerHTML = '<div class="sb-reveal-stage sb-reveal-opening"><div class="sb-opening-seal-anchor"><div class="sb-seal"><span>契</span></div></div><div class="sb-opening-footer"><h2 id="sb-reveal-title">靈光聚合 · 契印開啟</h2><button type="button" data-sb-skip>略過演出</button></div></div>';
      overlay.querySelector('[data-sb-skip]')?.focus({ preventScroll: true });
      return;
    }
    if (state.batch.results.length === 5) { renderPentagon(state, overlay); return; }
    const row = state.batch.results[state.index], flipped = state.revealed.has(state.index), ready = state.phase === 'revealed';
    const item = row.itemId && (getArtifactById(row.itemId) || pool.get(row.itemId));
    const allSeen = state.revealed.size === state.batch.results.length;
    const blocked = busy || !!storedOperation();
    overlay.innerHTML = `<button type="button" class="sb-reveal-close" data-sb-dismiss aria-label="稍後繼續翻牌">×</button>
      <div class="sb-reveal-stage"><header class="sb-reveal-heading"><span>締結本命</span><h2 id="sb-reveal-title">${flipped ? '契印已啟' : '點擊翻開契牌'}</h2><p>${state.index + 1} / ${state.batch.results.length}</p></header>
      <div class="sb-reveal-card ${state.phase === 'flipping' ? 'is-flipping' : flipped ? 'is-revealed' : ''}" style="--sb-color:${flipped && item ? esc(artifactRealmColor(item.realm)) : '#f5cf83'}">
        <div class="sb-reveal-card-inner"><button type="button" class="sb-reveal-back" data-sb-flip ${flipped ? 'disabled aria-hidden="true" tabindex="-1"' : ''} aria-label="翻開第 ${state.index + 1} 張契牌"><span class="sb-card-ornament" aria-hidden="true">✧</span><span class="sb-card-seal" aria-hidden="true">契</span><span>點擊翻牌</span></button>
        <section class="sb-reveal-front" aria-hidden="${!flipped}" aria-live="polite">${flipped ? resultMarkup(row) : ''}</section></div></div>
      <footer class="sb-reveal-footer"><div class="sb-reveal-actions">
        ${state.index > 0 ? `<button type="button" data-sb-previous ${state.phase === 'flipping' || blocked ? 'disabled' : ''}>上一張</button>` : ''}
        ${ready && state.index < state.batch.results.length - 1 ? `<button type="button" class="sb-primary" data-sb-next ${blocked ? 'disabled' : ''}>下一張</button>` : ''}
        ${ready && item ? `<button type="button" data-sb-reveal-equip="${esc(item.id)}" ${blocked || !Number(snapshot?.inventory?.[item.id]) || equipped()?.id === item.id ? 'disabled' : ''}>${equipped()?.id === item.id ? '已調御' : '調御此器'}</button>` : ''}
        ${ready && allSeen ? `<button type="button" class="sb-primary" data-sb-keep ${blocked ? 'disabled' : ''}>確認收入</button>` : ''}
      </div><p class="sb-reveal-message" role="status">${esc(message)}</p>
      <small class="sb-reveal-payment">本批 ${state.batch.payment === 'ticket' ? Number(state.batch.ticketsSpent || 0) + ' 張抽獎券' : Number(state.batch.cost || 0).toLocaleString('zh-TW') + ' 靈石'}</small></footer></div>`;
    overlay.querySelector(flipped ? '[data-sb-next], [data-sb-keep], [data-sb-reveal-equip]' : '[data-sb-flip]')?.focus({ preventScroll: true });
  }
  function renderPentagon(state, overlay) {
    const ready = state.phase === 'revealed', blocked = busy || !!storedOperation();
    const selectedRow = state.batch.results[state.index];
    const selectedItem = selectedRow.itemId && (getArtifactById(selectedRow.itemId) || pool.get(selectedRow.itemId));
    const cards = state.batch.results.map((row, index) => {
      const angle = (-90 + index * 72) * Math.PI / 180;
      const x = 50 + 32 * Math.cos(angle), y = 50 + 32 * Math.sin(angle);
      const flipped = state.revealed.has(index), flipping = state.flippingIndex === index;
      const item = row.itemId && (getArtifactById(row.itemId) || pool.get(row.itemId));
      const label = flipped ? item?.name || (row.itemId ? row.itemId : '煉器碎片 ×' + Number(row.fragments || 0)) : '尚未揭曉';
      return `<div class="sb-reveal-card ${flipping ? 'is-flipping' : flipped ? 'is-revealed' : ''}${ready && state.index === index ? ' is-selected' : ''}" data-sb-card-index="${index}"
        style="--sb-x:${x.toFixed(6)}%;--sb-y:${y.toFixed(6)}%;--sb-flip-delay:${flipping ? -state.flipElapsed : 0}ms;--sb-color:${flipped && item ? esc(artifactRealmColor(item.realm)) : '#f5cf83'}">
        <div class="sb-reveal-card-inner"><div class="sb-reveal-back" aria-hidden="true"><span class="sb-card-ornament">✧</span><span class="sb-card-seal">契</span><span>${index + 1}</span></div>
          <button type="button" class="sb-reveal-front" data-sb-inspect="${index}" aria-label="查看第 ${index + 1} 張：${esc(label)}" aria-hidden="${!flipped}" aria-pressed="${ready && state.index === index}" ${!ready ? 'disabled tabindex="-1"' : ''}>${flipped ? resultMarkup(row, true) : ''}</button>
        </div></div>`;
    }).join('');
    overlay.innerHTML = `<button type="button" class="sb-reveal-close" data-sb-dismiss aria-label="稍後繼續翻牌">×</button>
      <div class="sb-reveal-stage sb-reveal-batch"><header class="sb-reveal-heading"><span>締結本命</span><h2 id="sb-reveal-title">${ready ? '五契已啟' : '五契連啟'}</h2><p role="status">${state.revealed.size} / 5</p>
        ${ready ? `<p class="sb-reveal-selection">${esc(selectedItem?.name || (selectedRow.itemId ? selectedRow.itemId : '煉器碎片 ×' + Number(selectedRow.fragments || 0)))}${selectedItem ? '<br>' + esc(effectText(selectedItem)) : ''}</p>` : ''}</header>
      <div class="sb-pentagon" aria-label="五張契牌排列於正五邊形頂點">
        <svg class="sb-pentagon-lines" viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,18 80.433809,40.111456 68.809128,75.888544 31.190872,75.888544 19.566191,40.111456"/></svg>
        <span class="sb-pentagon-mark" aria-hidden="true">契</span>${cards}</div>
      <footer class="sb-reveal-footer"><div class="sb-reveal-actions">
        ${ready && selectedItem ? `<button type="button" data-sb-reveal-equip="${esc(selectedItem.id)}" ${blocked || !Number(snapshot?.inventory?.[selectedItem.id]) || equipped()?.id === selectedItem.id ? 'disabled' : ''}>${equipped()?.id === selectedItem.id ? '已調御' : '調御此器'}</button>` : ''}
        ${ready ? `<button type="button" class="sb-primary" data-sb-keep ${blocked ? 'disabled' : ''}>確認收入</button>` : ''}
      </div><p class="sb-reveal-message" role="status">${esc(message)}</p>
      <small class="sb-reveal-payment">${ready ? '點選契牌查看獎勵 · ' : '依序揭曉中 · '}本批 ${state.batch.payment === 'ticket' ? Number(state.batch.ticketsSpent || 0) + ' 張抽獎券' : Number(state.batch.cost || 0).toLocaleString('zh-TW') + ' 靈石'}</small></footer></div>`;
    if (ready) overlay.querySelector('[data-sb-keep]')?.focus({ preventScroll: true });
  }
  function advancePentagon() {
    const state = presentation;
    if (!state || state.phase !== 'auto') return;
    clearTimeout(autoTimer); autoTimer = null;
    const elapsed = Math.max(0, Date.now() - state.autoStartedAt);
    const boundaries = [];
    state.flippingIndex = null;
    for (let index = 0; index < 5; index++) {
      const start = state.autoInitial + index * state.autoInterval, end = start + state.autoFlip;
      boundaries.push(start, end);
      if (elapsed >= start) state.revealed.add(index);
      if (elapsed >= start && elapsed < end) { state.flippingIndex = index; state.flipElapsed = elapsed - start; }
    }
    if (elapsed >= state.autoInitial + 4 * state.autoInterval + state.autoFlip) {
      state.phase = 'revealed';
      const weapon = state.batch.results.findIndex(row => row.itemId);
      state.index = weapon < 0 ? 0 : weapon;
    }
    renderPresentation();
    const next = boundaries.sort((a,b) => a-b).find(time => time > elapsed);
    if (state.phase === 'auto' && next !== undefined) autoTimer = setTimeout(() => {
      if (presentation === state) advancePentagon();
    }, next - elapsed);
  }
  function startCards() {
    clearTimeout(animationTimer); animationTimer = null;
    if (!presentation) return;
    if (presentation.batch.results.length === 5) {
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      presentation.phase = 'auto'; presentation.autoStartedAt = Date.now();
      presentation.autoInitial = reduced ? 150 : 450;
      presentation.autoInterval = reduced ? 250 : 900;
      presentation.autoFlip = reduced ? 0 : 650;
      advancePentagon(); return;
    }
    presentation.phase = presentation.revealed.has(presentation.index) ? 'revealed' : 'card';
    renderPresentation();
  }
  function flipCard() {
    const state = presentation;
    if (!state || state.phase !== 'card') return;
    state.revealed.add(state.index);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    state.phase = reduced ? 'revealed' : 'flipping'; renderPresentation();
    if (!reduced) flipTimer = setTimeout(() => {
      flipTimer = null;
      if (presentation !== state) return;
      state.phase = 'revealed'; renderPresentation();
    }, 650);
  }
  function openPresentation(batch, opening = true) {
    if (!batch?.results?.length || !visible()) return;
    if (presentation?.batch.requestId === batch.requestId) return;
    const trigger = document.activeElement;
    closePresentation(false); hidePreview(); stopCarousel();
    presentation = { batch, uid: account, index: 0, revealed: new Set(), phase: opening ? 'seal' : 'card', trigger };
    const overlay = document.createElement('dialog');
    overlay.id = 'soulbound-animation'; overlay.className = 'sb-reveal-overlay' + (batch.results.some(row => row.itemId) ? ' is-higher' : '');
    overlay.setAttribute('aria-labelledby', 'sb-reveal-title');
    document.body.appendChild(overlay); document.body.classList.add('sb-reveal-open');
    overlay.addEventListener('cancel', event => { event.preventDefault(); if (!busy) closePresentation(); });
    overlay.addEventListener('click', event => {
      const button = event.target.closest?.('button');
      if (!button || button.disabled || !presentation || getMainUser()?.uid !== presentation.uid) return;
      if (button.hasAttribute('data-sb-skip')) startCards();
      else if (button.hasAttribute('data-sb-flip')) flipCard();
      else if (button.hasAttribute('data-sb-dismiss') && !busy) closePresentation();
      else if (button.hasAttribute('data-sb-next') && presentation.phase === 'revealed' && !busy) {
        presentation.index = Math.min(presentation.index + 1, batch.results.length - 1); startCards();
      } else if (button.hasAttribute('data-sb-previous') && presentation.phase !== 'flipping' && !busy) {
        presentation.index = Math.max(0, presentation.index - 1); startCards();
      } else if (button.hasAttribute('data-sb-keep') && presentation.revealed.size === batch.results.length) void keepResults();
      else if (button.hasAttribute('data-sb-inspect') && presentation.phase === 'revealed') {
        const index = Number(button.dataset.sbInspect);
        if (Number.isInteger(index) && index >= 0 && index < batch.results.length) { presentation.index = index; renderPresentation(); }
      } else if (button.hasAttribute('data-sb-reveal-equip') && presentation.phase === 'revealed') void equipmentAction(button.dataset.sbRevealEquip);
    });
    renderPresentation();
    if (typeof overlay.showModal === 'function') overlay.showModal();
    else overlay.setAttribute('open', '');
    if (opening) animationTimer = setTimeout(startCards, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 2000);
    else if (batch.results.length === 5) startCards();
  }
  function animate(batch) {
    openPresentation(batch);
    const higher = batch.results.some(r => r.itemId);
    // Short generated chime: no external audio request and no persistent audio context.
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (Audio && data()?.gameSettings?.soundEnabled !== false && data()?.gameSettings?.musicEnabled !== false) {
        const context = new Audio(), gain = context.createGain(); gain.connect(context.destination);
        gain.gain.setValueAtTime(.035, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .6);
        [higher ? 660 : 440, higher ? 990 : 660].forEach((hz, i) => {
          const oscillator = context.createOscillator(); oscillator.frequency.value = hz; oscillator.connect(gain);
          oscillator.start(context.currentTime + i * .12); oscillator.stop(context.currentTime + .6);
        });
        setTimeout(() => { void context.close().catch(() => {}); }, 800);
      }
    } catch (_) { /* Sound is optional; results have already been committed. */ }
  }
  async function runOperation(operation) {
    if (busy || !reconcile()) return;
    const uid = account;
    // Persist the exact intent before sending so a timed-out POST can be retried.
    try { localStorage.setItem(storageKey(uid), JSON.stringify(operation)); }
    catch (_) { message = '瀏覽器無法保存重試紀錄，請允許網站儲存後再進行抽取或兌換。'; render(); return; }
    busy = true; message = '正在締結契印…'; render();
    try {
      const payload = await request(operation.action, operation.body);
      if (getMainUser()?.uid !== uid) return;
      forgetOperation(); apply(payload);
      message = operation.action === 'draw' ? ''
        : operation.action === 'redeem' ? `已兌換 ${payload.result.name}，消耗 ${payload.result.costFragments} 碎片；法器已存入寶庫。`
        : '操作已完成。';
      if (operation.action === 'draw' && payload.pending?.requestId === operation.body.requestId) {
        $('soulbound-page')?.querySelector('.sb-scroll')?.scrollTo({ top: 0 });
        animate(payload.result);
      }
    } catch (e) {
      if (getMainUser()?.uid === uid) { if (e.definitive) forgetOperation(); message = e.message; }
    } finally { busy = false; render(); if (visible() && (getMainUser()?.uid !== uid || externalDirty)) { externalDirty = false; void refresh(); } }
  }
  async function acknowledge() {
    if (!snapshot?.pending) return;
    const uid = getMainUser()?.uid;
    const payload = await request('ack', { requestId: snapshot.pending.requestId });
    if (getMainUser()?.uid === uid) apply(payload);
  }
  async function equipmentAction(itemId) {
    if (busy) return;
    const uid = reconcile(); if (!uid) return;
    busy = true; render();
    try {
      if (equipped()?.id !== itemId) await window.toggleEquipArtifact(itemId);
      if (getMainUser()?.uid !== uid) return;
      message = '已調御；原本法器保留在寶庫。';
    } catch (e) { if (getMainUser()?.uid === uid) message = e.message; }
    finally { busy = false; render(); if (visible() && (getMainUser()?.uid !== uid || externalDirty)) { externalDirty = false; void refresh(); } }
  }
  async function keepResults() {
    if (busy || !presentation || presentation.phase !== 'revealed' || presentation.revealed.size !== presentation.batch.results.length) return;
    const uid = reconcile(); busy = true; render();
    try { await acknowledge(); if (getMainUser()?.uid === uid) message = '本批結果已確認收入。'; }
    catch (e) { if (getMainUser()?.uid === uid) message = e.message; }
    finally { busy = false; render(); if (visible() && (getMainUser()?.uid !== uid || externalDirty)) { externalDirty = false; void refresh(); } }
  }
  function mount(content = document.getElementById('training-tab-content')) {
    if (!content) return false;
    if (content.querySelector('#soulbound-page')) return false;
    if (!$('soulbound-page-style')) {
      const style = document.createElement('link'); style.id = 'soulbound-page-style'; style.rel = 'stylesheet'; style.href = '/styles/soulbound-draw.css'; document.head.append(style);
    }
    const section = document.createElement('section'); section.id = 'soulbound-page'; section.className = 'sb-page';
    section.setAttribute('aria-labelledby', 'soulbound-title');
    section.innerHTML = '<header class="sb-header"><div><small>常駐本命法器</small><h2 id="soulbound-title">契器台</h2></div><button type="button" id="soulbound-refresh">重新同步</button></header><div class="sb-scroll"><div id="soulbound-content"></div><p id="soulbound-status" role="status" aria-live="polite"></p></div>';
    content.replaceChildren(section);
    $('soulbound-refresh').addEventListener('click', () => { void refresh(); });
    $('soulbound-content').addEventListener('click', e => {
      const button = e.target.closest('button'); if (!button || button.disabled) return;
      if (button.hasAttribute('data-sb-preview')) {
        showPreview(button.dataset.sbPreview, button);
        return;
      }
      if (button.hasAttribute('data-sb-carousel-prev') || button.hasAttribute('data-sb-carousel-next')) {
        manualCarousel(button.hasAttribute('data-sb-carousel-prev') ? -1 : 1);
        return;
      }
      if (busy) return;
      if (button.hasAttribute('data-sb-resume')) openPresentation(snapshot?.pending, false);
      else if (button.hasAttribute('data-sb-draw')) void runOperation({ action: 'draw', body: { count: Number(button.dataset.sbDraw), payment:button.dataset.sbPayment || 'gold', poolVersion: pool.VERSION, expectedCost: button.dataset.sbPayment === 'ticket' ? 0 : Number(button.dataset.sbDraw) === 5 ? snapshot.prices.five : snapshot.prices.single, requestId: crypto.randomUUID() } });
      else if (button.hasAttribute('data-sb-retry')) { const op = storedOperation(); if (op) void runOperation(op); }

    });
    return true;
  }
  window.mountSoulboundTrainingPage = content => {
    const fresh = mount(content); render(); if (fresh) void refresh();
  };
  function activate() {
    const page = document.getElementById('page-training'), button = page?.querySelector('[data-training-tab="contract"]');
    if (!page || !button || button.disabled) return;
    page.querySelectorAll('.training-subtab-v3').forEach(tab => {
      const active = tab === button; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active));
    });
    document.body.classList.remove('ns-map-active');
    window.dispatchEvent(new CustomEvent('xiuxian:contract-page-opened'));
    window.mountSoulboundTrainingPage(page.querySelector('#training-tab-content'));
    window.resetTrainingScroll?.();
  }
  document.addEventListener('click', e => {
    const button = e.target.closest?.('[data-training-tab="contract"]');
    if (button && !button.disabled) activate();
    else if (previewItemId && e.target.closest?.('[data-training-tab]')) hidePreview();
  });
  window.addEventListener('xiuxian:stats-updated', event => {
    if (event.detail?.source !== 'dismantle') return;
    externalDirty = true; if (visible() && !busy) void refresh();
  });
  window.addEventListener('xiuxian:soulbound-tickets-updated', () => {
    externalDirty = true; if (visible() && !busy) void refresh();
  });
  window.openSoulboundDraw = async () => {
    await window.switchToPage?.('page-training');
    document.querySelector('[data-training-tab="contract"]')?.click();
  };
  ['xiuxian:user-ready', 'xiuxian:user-data-ready'].forEach(name => window.addEventListener(name, () => {
    reconcile(); if (visible()) void refresh();
  }));
  document.addEventListener('keydown', event => {
    if (!previewItemId) return;
    if (event.key === 'Escape') { event.preventDefault(); hidePreview(); }
    if (event.key !== 'Tab') return;
    const buttons = [...($('soulbound-preview')?.querySelectorAll('button:not(:disabled)') || [])];
    if (!buttons.length) return;
    if (event.shiftKey && document.activeElement === buttons[0]) {
      event.preventDefault(); buttons[buttons.length - 1].focus();
    } else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) {
      event.preventDefault(); buttons[0].focus();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCarousel(); else scheduleCarousel();
  });
  window.addEventListener('pagehide', stopCarousel);
})();
