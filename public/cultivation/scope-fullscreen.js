// 範圍研修所：將現有單元選擇器搬入全螢幕，不複製欄位或更改 focusedUnits 結構。
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  let studio, block, scopeBody, saveButton, cartSource, opened = false;
  let baseline = null, previousFocus = null, bodyOverflow = '', htmlOverflow = '', saving = false;
  const clone = value => JSON.parse(JSON.stringify(value));
  const units = () => Array.isArray(window.soloSelectedUnits) ? window.soloSelectedUnits : [];

  function snapshot() {
    return {
      units: JSON.stringify(units()),
      mode: $('set-source-mode')?.value || 'random',
      bank: $('set-source-final-value')?.value || 'ai'
    };
  }

  function changed() {
    if (!baseline) return false;
    const now = snapshot();
    return now.units !== baseline.units || now.mode !== baseline.mode || now.bank !== baseline.bank;
  }

  function updateSummary() {
    if (!studio) return;
    const selected = units();
    const c = $('ss-selection-count'),
      sum = $('ss-footer-main'), foot = $('ss-footer-sub'), tab = $('ss-tab-count'), launch = $('ss-launch-count');
    if (c) c.textContent = String(selected.length);
    if (tab) tab.textContent = String(selected.length);
    if (launch) launch.textContent = String(selected.length);
    if (sum) sum.textContent = selected.length ? '已選 ' + selected.length + ' 個複習範圍' : '建立你的專屬修習計畫';
    if (foot) foot.textContent = changed() ? '變更尚未儲存，離開前記得儲存。' : '可跨科選擇，最多 24 個範圍。';
    const placeholder = $('ss-cart-placeholder');
    if (placeholder) placeholder.hidden = selected.length > 0;
    const cardSummary = $('dongfu-scope-card')?.querySelector('.dongfu-collapse-summary');
    if (cardSummary) cardSummary.textContent = selected.length ? '已選 ' + selected.length + ' 個範圍 · 點擊全螢幕編輯' : '全螢幕選課 · 選章節、定考點';
  }

  function setView(view) {
    if (!studio) return;
    const chosen = view === 'cart' ? 'cart' : 'course';
    studio.dataset.view = chosen;
    for (const [name, id, panel] of [
      ['course', 'ss-tab-course', 'ss-picker'],
      ['cart', 'ss-tab-cart', 'ss-cart']
    ]) {
      const button = $(id), active = name === chosen;
      if (button) {
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
        button.setAttribute('aria-controls', panel);
      }
    }
  }

  function open() {
    if (!mount() || opened) return;
    previousFocus = document.activeElement;
    baseline = snapshot();
    if (block.parentNode !== $('ss-picker-body')) $('ss-picker-body').append(block);
    if (saveButton.parentNode !== $('ss-foot-actions')) $('ss-foot-actions').append(saveButton);
    saveButton.style.display = '';
    studio.hidden = false;
    opened = true;
    bodyOverflow = document.body.style.overflow;
    htmlOverflow = document.documentElement.style.overflow;
    document.body.classList.add('scope-studio-open');
    document.documentElement.classList.add('scope-studio-open');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    setView('course');
    window.resetCurriculumPages?.();
    updateSummary();
    $('ss-close')?.focus({ preventScroll: true });
  }

  function close(force = false) {
    if (!opened || saving) return false;
    if (!force && changed()) {
      if (!window.confirm('有尚未儲存的範圍變更。確定要放棄本次修改嗎？')) return false;
      window.soloSelectedUnits = clone(JSON.parse(baseline.units));
      if ($('set-source-mode')) $('set-source-mode').value = baseline.mode;
      if ($('set-source-final-value')) $('set-source-final-value').value = baseline.bank;
      window.toggleSourceMode?.();
      window.renderSelectedUnitsList?.();
    }
    if (scopeBody) {
      scopeBody.insertBefore(block, $('ss-launch-preview'));
      scopeBody.append(saveButton);
    }
    saveButton.style.display = 'none';
    saveButton.textContent = '儲存出題範圍';
    saveButton.disabled = false;
    studio.hidden = true;
    opened = false;
    baseline = null;
    document.body.classList.remove('scope-studio-open');
    document.documentElement.classList.remove('scope-studio-open');
    document.body.style.overflow = bodyOverflow;
    document.documentElement.style.overflow = htmlOverflow;
    updateSummary();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    else $('dongfu-scope-card')?.querySelector('.dongfu-collapse-head')?.focus({ preventScroll: true });
    return true;
  }

  async function save() {
    if (saving) return;
    saving = true;
    const feedback = $('ss-feedback');
    if (feedback) feedback.textContent = '正在儲存出題範圍…';
    try {
      // 必須等 Firestore 成功回應才能關閉全螢幕；失敗時保留草稿。
      const result = await window.saveProfile?.(saveButton);
      if (result !== true) {
        if (feedback) feedback.textContent = '尚未儲存，請確認暱稱、題庫或至少一個單元。';
        return;
      }
      baseline = snapshot();
      if (feedback) feedback.textContent = '出題範圍已儲存。';
      updateSummary();
      saving = false;
      close(true);
    } catch (error) {
      console.error('[Scope Studio] save failed:', error);
      saveButton.textContent = '儲存出題範圍';
      saveButton.disabled = false;
      if (feedback) feedback.textContent = '儲存失敗，變更仍在畫面上。請檢查連線後再試。';
    } finally {
      saving = false;
    }
  }

  function mount() {
    if (studio && studio.isConnected) return true;
    const card = $('dongfu-scope-card');
    scopeBody = $('dongfu-scope-body');
    block = $('set-source-mode')?.closest('.dongfu-scope-content');
    saveButton = $('dongfu-scope-save');
    cartSource = $('solo-selected-units-list')?.parentElement;
    if (!card || !scopeBody || !block || !saveButton || !cartSource) return false;

    const link = document.createElement('link');
    link.id = 'ss-studio-style';
    link.rel = 'stylesheet';
    link.href = './styles/curriculum-studio.css';
    if (!$('ss-studio-style')) document.head.append(link);

    studio = document.createElement('section');
    studio.id = 'scope-studio';
    studio.hidden = true;
    studio.dataset.view = 'course';
    studio.setAttribute('role', 'dialog');
    studio.setAttribute('aria-modal', 'true');
    studio.setAttribute('aria-labelledby', 'ss-title');
    studio.innerHTML = `
      <header class="ss-topbar">
        <span class="ss-emblem" aria-hidden="true"><i class="fa-solid fa-book-open-reader"></i></span>
        <div class="ss-brand"><span class="ss-overline">青雲問道 · 修習策劃</span><h2 id="ss-title">課程研修所</h2></div>
        <button type="button" class="ss-close" id="ss-close" aria-label="返回洞府"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>返回洞府</span></button>
      </header>
      <nav class="ss-tabs" aria-label="選課分頁" role="tablist">
        <button id="ss-tab-course" type="button" role="tab" aria-selected="true"><i class="fa-solid fa-layer-group" aria-hidden="true"></i>選擇課程</button>
        <button id="ss-tab-cart" type="button" role="tab" aria-selected="false"><i class="fa-solid fa-bookmark" aria-hidden="true"></i>已選範圍 <span id="ss-tab-count">0</span></button>
      </nav>
      <div class="ss-workspace">
        <section class="ss-picker" id="ss-picker" role="tabpanel" aria-labelledby="ss-tab-course">
          <div class="ss-panel-head"><span class="ss-panel-mark"><i class="fa-solid fa-compass" aria-hidden="true"></i></span><div><strong>探索課程</strong><small>先選出題模式，再從課程目錄挑選章節或細項。</small></div></div>
          <div class="ss-picker-body" id="ss-picker-body"></div>
        </section>
        <aside class="ss-cart" id="ss-cart" role="tabpanel" aria-labelledby="ss-tab-cart">
          <div class="ss-panel-head"><span class="ss-panel-mark"><i class="fa-solid fa-scroll" aria-hidden="true"></i></span><div><strong>我的修習卷</strong><small>已選 <span id="ss-selection-count">0</span> / 24 個範圍</small></div></div>
          <div class="ss-cart-body" id="ss-cart-body"><p class="ss-cart-note"><strong>複習提示</strong>：選擇整章會包含其考點，也可以只挑個別細項。加入清單後記得儲存。</p>
            <p class="ss-cart-empty" id="ss-cart-placeholder"><i class="fa-solid fa-book-open" aria-hidden="true"></i><span>還沒有選定範圍<br>從左側選一個章節開始吧。</span></p>
          </div>
        </aside>
      </div>
      <footer class="ss-foot">
        <div class="ss-foot-summary"><strong id="ss-footer-main">建立你的專屬修習計畫</strong><small id="ss-footer-sub">可跨科選擇，最多 24 個範圍。</small><small id="ss-feedback" role="status" aria-live="polite"></small></div>
        <div id="ss-foot-actions"></div>
      </footer>`;
    document.body.append(studio);

    // 已選清單與原有 selector 為同一份 DOM；這樣移除/儲存仍走既有流程。
    $('ss-cart-body').append(cartSource);
    cartSource.classList.add('ss-cart-source');

    const preview = document.createElement('div');
    preview.className = 'ss-launch-preview';
    preview.id = 'ss-launch-preview';
    preview.innerHTML = '<p>選擇年級、出版社與考點，打造自己的專注練習。已選 <strong id="ss-launch-count">0</strong> 個範圍。</p><button type="button" id="ss-launch-button"><i class="fa-solid fa-up-right-and-down-left-from-center" aria-hidden="true"></i>　開啟全螢幕研修所</button>';
    scopeBody.insertBefore(preview, saveButton);
    // 舊的儲存鈕只在 studio 底部顯示，收合卡不另設一個會造成誤觸的入口。
    saveButton.style.display = 'none';
    $('ss-launch-button').addEventListener('click', open);
    const header = card.querySelector('.dongfu-collapse-head');
    header?.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      open();
    }, true);
    $('ss-close').addEventListener('click', () => close());
    $('ss-tab-course').addEventListener('click', () => setView('course'));
    $('ss-tab-cart').addEventListener('click', () => setView('cart'));
    studio.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    // 當原本的清單刪除、加入或由 Firebase 載回時，立即同步所有計數。
    if (typeof window.renderSelectedUnitsList === 'function' && !window.renderSelectedUnitsList.__scopeStudioWrapped) {
      const original = window.renderSelectedUnitsList;
      const wrapped = (...args) => { const result = original(...args); updateSummary(); return result; };
      wrapped.__scopeStudioWrapped = true;
      window.renderSelectedUnitsList = wrapped;
    }
    $('set-source-mode').addEventListener('change', updateSummary);
    $('set-source-final-value')?.addEventListener('change', updateSummary);
    saveButton.removeAttribute('onclick');
    saveButton.addEventListener('click', save);
    // 先保持與其他設定頁相同的 collapsed 狀態；打開時再轉為全螢幕。
    updateSummary();
    return true;
  }

  window.openCurriculumStudio = open;
  window.closeCurriculumStudio = close;
  window.addEventListener('dongfu:settings-collapsible-ready', mount);
  window.addEventListener('curriculum:scope-draft-change', updateSummary);
  function boot() { mount(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
