import {} from './soulbound-pool.js';
import './training-access-rules.js';
import { getArtifactById, artifactRealmColor } from './artifact-catalog.js';
import { authenticatedMainFetch, getMainUser } from './data/project-repository.js';

(function () {
  'use strict';
  const pool = globalThis.QASoulboundPool;
  let snapshot = null, account = '', busy = false, selected = 0, message = '', animationTimer = null, previewArchetype = 'sword';
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
      clearTimeout(animationTimer); account = uid; snapshot = null; selected = 0; message = '';
      $('soulbound-animation')?.remove();
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
      current.stats ||= {}; current.stats.gold = payload.balance;
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
  function previewItem(candidates) {
    return candidates.find(a => a.archetype === previewArchetype) || candidates[0];
  }
  function showcaseMarkup(preview) {
    return `<section class="sb-showcase" style="--sb-color:${artifactRealmColor(preview.realm)}" aria-label="${esc(preview.name)}展示">
      <small>常駐本命法器 · ${esc(preview.realm)}</small><div class="sb-showcase-art">${image(preview)}</div><h3>${esc(preview.name)}</h3><p>${esc(effectText(preview))}</p><span>攻擊 +${base(preview, 'equip_attack_flat')} · 生命 +${base(preview, 'equip_hp_flat')}</span>
    </section>`;
  }
  function galleryMarkup(candidates, rank, version = pool.VERSION) {
    return `<section class="sb-gallery"><div class="sb-gallery-heading"><h3>八種常駐本命法器</h3><span>點選查看器型與核心能力</span></div>
      <div class="sb-pool">${candidates.map(a => `<button type="button" data-sb-preview="${esc(a.id)}" aria-pressed="${a.archetype === previewArchetype}" style="--sb-color:${artifactRealmColor(a.realm)}">${image(a)}<b>${esc(a.name)}</b><small>${esc(a.realm)} · ${esc(effectText(a))}</small></button>`).join('')}</div>
      <details class="sb-details"><summary>完整機率與高一階效果</summary><p>版本 ${esc(version)}。${rank === 7 ? '一般抽取八種器型各 12.5%；第五次飛劍、靈珠、星盤、古鐘各 25%。' : '一般抽取同境界八種器型各 10%，高一階各 2.5%；第五次高一階各 12.5%。'}數值依境界提升，所有器型均可跨丹性搭配。</p>
        ${rank >= 0 && rank < 7 ? `<ul>${pool.candidates(rank + 1).map(a => `<li>${esc(a.name)}（${esc(a.realm)}）：${esc(effectText(a))}；攻擊 +${base(a, 'equip_attack_flat')}、生命 +${base(a, 'equip_hp_flat')}</li>`).join('')}</ul>` : ''}</details>
    </section>`;
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
      $('soulbound-content').innerHTML = `<p class="sb-empty">${status}</p>${showcaseMarkup(previewItem(candidates))}${galleryMarkup(candidates, rank)}`;
      return;
    }
    const pending = s.pending, row = pending?.results[Math.min(selected, pending.results.length - 1)], item = row && getArtifactById(row.itemId);
    const rank = s.rank, realm = pool.REALMS[rank], next = pool.REALMS[Math.min(7, Math.max(0, rank) + 1)];
    const candidates = pool.candidates(Math.max(0, rank));
    const preview = previewItem(candidates);
    const owned = Object.entries(s.inventory).flatMap(([id, count]) => {
      const item = getArtifactById(id);
      return count > 0 && item?.equipSlot === '本命法寶' ? [{ item, count }] : [];
    });
    $('soulbound-content').innerHTML = `<div class="sb-summary"><div><small>靈石餘額</small><strong>${s.balance.toLocaleString('zh-TW')}</strong></div><div><small>目前本命</small><b>${esc(current?.name || '尚未調御')}</b><span>${esc(current?.realm || '選擇適合自己的器型')}</span></div><div><small>距離品質保底</small><b>${s.untilPity} 次</b><span>累計 ${s.draws} 抽 · 升境界保留</span></div></div>
      <div class="sb-pity" aria-label="本輪已抽 ${s.draws % 5} 次，共五次">${Array.from({ length: 5 }, (_, i) => `<i class="${i < s.draws % 5 ? 'filled' : ''}">${i === 4 ? '✦' : '◆'}</i>`).join('')}<span>第五次${rank === 7 ? '必得真仙精選器型' : `必得${esc(next?.name || '高一階')}法器`}</span></div>
      ${operation && !pending ? '<button type="button" data-sb-retry class="sb-primary">重試上次未確認的操作</button><p class="sb-note">重試只確認原結果，不會重新抽取或重複扣款。</p>' : ''}
      ${item ? `<section class="sb-results"><div class="sb-result-heading"><h3>契印已成 · ${pending.results.length} 件已收入寶庫</h3><span>本批 ${pending.cost} 靈石</span></div>
        <div class="sb-result-tabs" role="group" aria-label="查看每件結果">${pending.results.map((r, i) => {
          const a = getArtifactById(r.itemId);
          return `<button type="button" data-sb-select="${i}" aria-pressed="${i === selected}" style="--sb-color:${artifactRealmColor(r.realm)}">${esc(a?.name || r.itemId)}<small>${esc(r.realm)}${r.pity ? ' · 保底' : r.higher ? ' · 高階' : ''}</small></button>`;
        }).join('')}</div><div class="sb-featured" style="--sb-color:${artifactRealmColor(item.realm)}">${image(item)}<div><small>${esc(item.realm)} · 本命法器 · 不可交易</small><h3>${esc(item.name)}</h3><p>${esc(effectText(item))}</p><span>攻擊 +${base(item, 'equip_attack_flat')} · 生命 +${base(item, 'equip_hp_flat')} · 持有 ×${s.inventory[item.id]}</span></div></div>
        ${comparison(item)}<div class="sb-actions"><button type="button" data-sb-equip="${esc(item.id)}" class="sb-primary" ${busy || current?.id === item.id ? 'disabled' : ''}>${current?.id === item.id ? '正在調御' : '調御此器'}</button><button type="button" data-sb-vault ${busy ? 'disabled' : ''}>收入寶庫</button><button type="button" data-sb-again ${busy ? 'disabled' : ''}>再次抽取</button></div></section>` : ''}
      <div class="sb-lobby">${showcaseMarkup(preview)}<section class="sb-draw-controls"><small>常駐契器台 · ${esc(realm?.name || '金丹境開放')}</small><h3>一器一契，長伴仙途</h3>
        <p>${rank < 0 ? '到達金丹境即可抽取。既有本命法器仍可調御與精煉。' : rank === 7 ? '真仙品質固定；每第五次必得四種精選器型之一。' : `一般抽取：80% ${esc(realm.name)}、20% ${esc(next.name)}。提早抽到高階不重置保底。`}</p>
        ${s.draws === 0 ? '<p class="sb-first">首抽只需 250 靈石；每抽必得一件，五連逐抽共享保底。結果先保存再演出，法器不會因關頁而遺失。</p>' : ''}
        <div class="sb-actions"><button type="button" data-sb-draw="1" class="sb-primary" ${busy || operation || pending || rank < 0 || s.balance < s.prices?.single ? 'disabled' : ''}>單抽 · ${s.prices?.single ?? '—'} 靈石</button><button type="button" data-sb-draw="5" ${busy || operation || pending || rank < 0 || s.balance < s.prices?.five ? 'disabled' : ''}>五連抽 · ${s.prices?.five ?? '—'} 靈石</button></div>
        <p class="sb-note">${pending ? '先調御或收入本批結果，即可繼續抽取。' : s.draws === 0 ? '首批五連已包含一次首抽優惠。' : `每抽 ${rank < 0 ? 500 : pool.price(rank)} 靈石；沒有空抽，也不會自動替換裝備。`}</p></section></div>
      ${galleryMarkup(candidates, rank, s.poolVersion)}
      <details class="sb-details"><summary>寶庫 · 調御與精煉（${owned.reduce((n, a) => n + Number(a.count), 0)} 件）</summary><p>已持有的原器可投入八方煉器陣，使用團本素材與印記二次、三次精煉；先卸下裝備中的法器。</p><div class="sb-owned">${owned.length ? owned.map(({ item: a, count }) => `<article><div><b>${esc(a.name)}</b><small>${esc(a.realm)} · ×${count} · ${esc(effectText(a))}</small></div><button type="button" data-sb-equip="${esc(a.id)}" ${busy || a.id === current?.id ? 'disabled' : ''}>${a.id === current?.id ? '正在調御' : '調御'}</button></article>`).join('') : '<p>尚無本命法器。</p>'}</div><button type="button" data-sb-refine>前往八方煉器陣</button></details>
      <details class="sb-details"><summary>重複原器回收 · 返還實付價格的 30%</summary><p>只回收你選擇的一件重複原器，至少保留一件。裝備中的一件與精煉器不會被回收；相同器型依較低實付價格先回收。</p><div class="sb-owned">${s.recovery.map(r => `<article><div><b>${esc(getArtifactById(r.itemId)?.name || r.itemId)}</b><small>${esc(getArtifactById(r.itemId)?.realm)} · 可回收 ${r.available} 件 · 該次實付 ${r.paid}</small></div><button type="button" data-sb-recover="${esc(r.itemId)}" ${busy || operation || pending ? 'disabled' : ''}>回收一件 +${r.refund} 靈石</button></article>`).join('') || '<p>尚無可回收的重複原器。</p>'}</div></details>`;
  }
  async function refresh() {
    if (busy || !reconcile()) { render(); return; }
    const uid = account; busy = true; render();
    try {
      const payload = await request();
      if (getMainUser()?.uid !== uid) return;
      apply(payload);
      const operation = storedOperation();
      if (operation?.action === 'draw' && payload.pending?.requestId === operation.body.requestId) forgetOperation();
      message = payload.pending ? '已找回尚未查看完的抽取結果。' : '';
    } catch (e) { if (getMainUser()?.uid === uid) message = e.message; }
    finally { busy = false; render(); if (getMainUser()?.uid !== uid && visible()) void refresh(); }
  }
  function reveal() { clearTimeout(animationTimer); animationTimer = null; $('soulbound-animation')?.remove(); render(); }
  function animate(batch) {
    if (!visible() || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const higher = batch.results.some(r => r.higher || r.featured);
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
      message = operation.action === 'draw' ? '法器已保存，可選擇調御或收入寶庫。' : `已回收一件，獲得 ${payload.result.refund} 靈石。`;
      if (operation.action === 'draw' && payload.pending?.requestId === operation.body.requestId) {
        $('soulbound-page')?.querySelector('.sb-scroll')?.scrollTo({ top: 0 });
        animate(payload.result);
      }
    } catch (e) {
      if (getMainUser()?.uid === uid) { if (e.definitive) forgetOperation(); message = e.message; }
    } finally { busy = false; render(); if (getMainUser()?.uid !== uid && visible()) void refresh(); }
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
    finally { busy = false; render(); if (getMainUser()?.uid !== uid && visible()) void refresh(); }
  }
  async function keepResults() {
    if (busy) return;
    const uid = reconcile(); busy = true; render();
    try { await acknowledge(); if (getMainUser()?.uid === uid) message = '本批法器已收入寶庫。'; }
    catch (e) { if (getMainUser()?.uid === uid) message = e.message; }
    finally { busy = false; render(); if (getMainUser()?.uid !== uid && visible()) void refresh(); }
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
        previewArchetype = pool.get(button.dataset.sbPreview)?.archetype || 'sword'; render();
        $('soulbound-content')?.querySelector(`[data-sb-preview="${button.dataset.sbPreview}"]`)?.focus({ preventScroll: true });
        return;
      }
      if (busy) return;
      if (button.hasAttribute('data-sb-select')) { selected = Number(button.dataset.sbSelect); render(); }
      else if (button.hasAttribute('data-sb-draw')) void runOperation({ action: 'draw', body: { count: Number(button.dataset.sbDraw), expectedCost: Number(button.dataset.sbDraw) === 5 ? snapshot.prices.five : snapshot.prices.single, requestId: crypto.randomUUID() } });
      else if (button.hasAttribute('data-sb-retry')) { const op = storedOperation(); if (op) void runOperation(op); }
      else if (button.hasAttribute('data-sb-equip')) void equipmentAction(button.dataset.sbEquip);
      else if (button.hasAttribute('data-sb-vault') || button.hasAttribute('data-sb-again')) void keepResults();
      else if (button.hasAttribute('data-sb-recover')) void runOperation({ action: 'recover', body: { itemId: button.dataset.sbRecover, requestId: crypto.randomUUID() } });
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
  window.openSoulboundDraw = async () => {
    await window.switchToPage?.('page-training');
    document.querySelector('[data-training-tab="contract"]')?.click();
  };
  ['xiuxian:user-ready', 'xiuxian:user-data-ready'].forEach(name => window.addEventListener(name, () => {
    reconcile(); if (visible()) void refresh();
  }));
})();
