import {} from './soulbound-pool.js';
import './training-access-rules.js';
import { getArtifactById, artifactRealmColor } from './artifact-catalog.js';
import { authenticatedMainFetch, getMainUser } from './data/project-repository.js';

(function () {
  'use strict';
  const pool = globalThis.QASoulboundPool;
  let snapshot = null, account = '', busy = false, selected = 0, message = '', animationTimer = null, externalDirty = false;
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
      clearTimeout(animationTimer); stopCarousel(); account = uid; snapshot = null; selected = 0;
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
  const signed = value => value > 0 ? `+${value}` : String(value);
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
      <span class="sb-carousel-count" aria-label="中央法器為第 ${number} 件，共 ${count} 件">${String(number).padStart(2, '0')} / ${String(count).padStart(2, '0')}</span></div>
      <div class="sb-carousel-viewport" aria-label="每次展示三件法器，中央法器較大">
        <div class="sb-carousel-track">${cards}</div>
      </div>
      <p class="sb-carousel-hint">點擊法器查看詳細資料</p>
    </section>`;
  }
  function probabilityMarkup(rank, version = pool.VERSION) {
    return `<details class="sb-details sb-probability"><summary>抽取機率與保底</summary>
      <p>獎池版本 ${esc(version)}。完整武器機率 2%，其餘 98% 獲得 20–40 個煉器碎片；
      連續 49 抽未出武器，第 50 抽必出。八種器型共用常駐池，
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
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
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
  function previewMarkup(item) {
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
        <span class="sb-preview-hint">僅查看法器資料，實際抽取仍為八器共用池。</span>
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
      if (e.target.closest?.('[data-sb-close]') || e.target === overlay) hidePreview();
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
  function comparison(item) {
    const current = equipped();
    return `<div class="sb-compare"><h4>調御比較 · ${esc(current?.name || '空本命格')} → ${esc(item.name)}</h4>
      <p>攻擊加成 ${base(current, 'equip_attack_flat')} → ${base(item, 'equip_attack_flat')} <b>${signed(base(item, 'equip_attack_flat') - base(current, 'equip_attack_flat'))}</b></p>
      <p>生命加成 ${base(current, 'equip_hp_flat')} → ${base(item, 'equip_hp_flat')} <b>${signed(base(item, 'equip_hp_flat') - base(current, 'equip_hp_flat'))}</b></p>
      ${(base(current, 'equip_attack_percent') || base(item, 'equip_attack_percent')) ? `<p>攻擊比例 ${pool.valueText('equip_attack_percent', base(current, 'equip_attack_percent'))} → ${pool.valueText('equip_attack_percent', base(item, 'equip_attack_percent'))}</p>` : ''}
      ${(base(current, 'equip_hp_percent') || base(item, 'equip_hp_percent')) ? `<p>生命比例 ${pool.valueText('equip_hp_percent', base(current, 'equip_hp_percent'))} → ${pool.valueText('equip_hp_percent', base(item, 'equip_hp_percent'))}</p>` : ''}
      <p>目前能力：${esc(effectText(current))}</p><p>換上能力：${esc(effectText(item))}</p><small>此處比較本命格屬性；戰鬥總值會再套用其他裝備與加成。原法器留在寶庫。</small></div>`;
  }
  function render() {
    if (!$('soulbound-content')) return;
    reconcile();
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
    const pending = s.pending, row = pending?.results[Math.min(selected, pending.results.length - 1)], item = row?.itemId && getArtifactById(row.itemId);
    const rank = s.rank, candidates = pool.candidates(Math.max(0, rank));
    $('soulbound-content').innerHTML = `<div class="sb-summary"><div><small>靈石餘額</small><strong>${s.balance.toLocaleString('zh-TW')}</strong></div><div><small>煉器碎片</small><strong>${Number(s.fragments || 0).toLocaleString('zh-TW')}</strong></div><div><small>目前本命</small><b>${esc(current?.name || '尚未調御')}</b><span>${esc(current?.realm || '選擇適合自己的器型')}</span></div><div><small>距離武器保底</small><b>${s.untilPity} 抽</b><span>累計 ${s.draws} 抽 · 出武器後重計</span></div></div>
      <div class="sb-pity"><progress value="${Number(s.misses || 0)}" max="50" aria-label="本輪未出武器 ${Number(s.misses || 0)} 抽"></progress><span>八種武器同池 · 至多 50 抽必得一件完整武器</span></div>
      ${operation && !pending ? '<button type="button" data-sb-retry class="sb-primary">重試上次未確認的操作</button><p class="sb-note">重試只確認原結果，不會重新抽取或重複扣款。</p>' : ''}
      ${row ? `<section class="sb-results"><div class="sb-result-heading"><h3>${pending.results.length} 抽結果已保存</h3><span>本批 ${pending.cost} 靈石</span></div>
        <div class="sb-result-tabs" role="group" aria-label="查看每抽結果">${pending.results.map((r, i) => {
          const a = r.itemId && getArtifactById(r.itemId);
          return `<button type="button" data-sb-select="${i}" aria-pressed="${i === selected}" style="--sb-color:${r.realm ? artifactRealmColor(r.realm) : '#f5cf83'}">${esc(a?.name || (r.itemId ? r.itemId : '煉器碎片 ×' + r.fragments))}<small>${a ? esc(r.realm) : '碎片'}${r.pity ? ' · 武器保底' : r.higher ? ' · 高階' : ''}</small></button>`;
        }).join('')}</div><div class="sb-featured" style="--sb-color:${item ? artifactRealmColor(item.realm) : '#f5cf83'}">${item ? image(item) : '<span class="sb-fragment-art" aria-hidden="true">✦</span>'}<div><small>${item ? esc(item.realm) : '煉器資源'}</small><h3>${item ? esc(item.name) : '煉器碎片 ×' + Number(row.fragments || 0)}</h3><p>${item ? esc(effectText(item)) : '已加入碎片餘額，可在八方煉器陣使用。'}</p></div></div>${item ? comparison(item) : ''}
        <div class="sb-actions">${item ? `<button type="button" class="sb-primary" data-sb-equip="${esc(item.id)}" ${busy || operation || !Number(s.inventory[item.id]) ? 'disabled' : ''}>調御此器</button>` : ''}<button type="button" data-sb-vault ${busy || operation ? 'disabled' : ''}>確認收入</button><button type="button" data-sb-again ${busy || operation ? 'disabled' : ''}>再次抽取</button></div></section>` : ''}
      <div class="sb-lobby">${showcaseMarkup(candidates)}<section class="sb-draw-controls"><small>常駐共用池 · 八器同契</small><h3>締結本命</h3><p>八種本命法器一起抽；至多 50 抽必得其中一件完整武器。</p>
        ${s.draws === 0 ? '<p class="sb-first">首抽 250 靈石；單抽與五連共用 50 抽保底，結果先保存再演出。</p>' : ''}
        <div class="sb-actions"><button type="button" data-sb-draw="1" class="sb-primary" ${busy || operation || pending || rank < 0 || s.balance < s.prices?.single ? 'disabled' : ''}>單抽 · ${s.prices?.single ?? '—'} 靈石</button><button type="button" data-sb-draw="5" ${busy || operation || pending || rank < 0 || s.balance < s.prices?.five ? 'disabled' : ''}>五連抽 · ${s.prices?.five ?? '—'} 靈石</button></div>
        <p class="sb-note">${pending ? '先確認本批結果，即可繼續抽取。' : `一般武器機率 2%；其餘獲得 20–40 碎片。出武器後重置保底進度。`}</p></section></div>
      ${probabilityMarkup(rank, s.poolVersion)}
      <details class="sb-details"><summary>物品分解與碎片煉器</summary><p>材料、普通法器及本命法器可多選分解，確認後換成煉器碎片；裝備中的份數會保留。</p><button type="button" data-inventory-dismantle>物品分解</button></details>`;
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
    } catch (e) { if (getMainUser()?.uid === uid) message = e.message; }
    finally { busy = false; render(); if (visible() && (getMainUser()?.uid !== uid || externalDirty)) { externalDirty = false; void refresh(); } }
  }
  function reveal() { clearTimeout(animationTimer); animationTimer = null; $('soulbound-animation')?.remove(); render(); }
  function animate(batch) {
    if (!visible() || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const higher = batch.results.some(r => r.itemId);
    const el = document.createElement('div'); el.id = 'soulbound-animation'; el.className = 'sb-animation' + (higher ? ' is-higher' : '');
    el.innerHTML = '<div class="sb-seal"><span>契</span></div><p>靈光聚合 · 契印開啟</p><button type="button">略過演出</button>';
    $('soulbound-page').append(el); el.querySelector('button').addEventListener('click', reveal);
    animationTimer = setTimeout(reveal, 2000);
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
    catch (_) { message = '瀏覽器無法保存重試紀錄，請允許網站儲存後再抽取或回收。'; render(); return; }
    busy = true; message = '正在締結契印…'; render();
    try {
      const payload = await request(operation.action, operation.body);
      if (getMainUser()?.uid !== uid) return;
      forgetOperation(); apply(payload); selected = 0;
      message = operation.action === 'draw' ? '抽取結果已保存，可確認收入。' : `已回收一件，獲得 ${payload.result.refund} 靈石。`;
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
      await acknowledge(); if (getMainUser()?.uid === uid) message = '已調御；原本法器保留在寶庫。';
    } catch (e) { if (getMainUser()?.uid === uid) message = e.message; }
    finally { busy = false; render(); if (visible() && (getMainUser()?.uid !== uid || externalDirty)) { externalDirty = false; void refresh(); } }
  }
  async function keepResults() {
    if (busy) return;
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
      if (busy) return;
      if (button.hasAttribute('data-sb-select')) { selected = Number(button.dataset.sbSelect); render(); }
      else if (button.hasAttribute('data-sb-draw')) void runOperation({ action: 'draw', body: { count: Number(button.dataset.sbDraw), poolVersion: pool.VERSION, expectedCost: Number(button.dataset.sbDraw) === 5 ? snapshot.prices.five : snapshot.prices.single, requestId: crypto.randomUUID() } });
      else if (button.hasAttribute('data-sb-retry')) { const op = storedOperation(); if (op) void runOperation(op); }
      else if (button.hasAttribute('data-sb-equip')) void equipmentAction(button.dataset.sbEquip);
      else if (button.hasAttribute('data-sb-vault') || button.hasAttribute('data-sb-again')) void keepResults();
      else if (button.hasAttribute('data-sb-refine')) document.querySelector('[data-training-tab="refinery"]')?.click();
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
  });
  window.addEventListener('xiuxian:stats-updated', event => {
    if (event.detail?.source !== 'dismantle') return;
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
