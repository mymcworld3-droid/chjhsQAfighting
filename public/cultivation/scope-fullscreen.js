// 範圍研修所：將現有單元選擇器搬入全螢幕，不複製欄位或更改 focusedUnits 結構。
import { playerRepository } from './data/player-repository.js';
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  let studio, block, scopeBody, saveButton, cartSource, opened = false;
  let baseline = null, previousFocus = null, bodyOverflow = '', htmlOverflow = '', saving = false;
  let sharing = false, lastShared = '';
  const clone = value => JSON.parse(JSON.stringify(value));
  const units = () => { const list = $('set-source-mode')?.value === 'focused' ? window.soloSelectedUnits : []; return Array.isArray(list) ? list : []; };

  function snapshot() {
    return {
      units: JSON.stringify(window.soloSelectedUnits || []),
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
      sum = $('ss-footer-main'), foot = $('ss-footer-sub'), tab = $('ss-tab-count');
    if (c) c.textContent = String(selected.length);
    if (tab) tab.textContent = String(selected.length);
    if (sum) sum.textContent = selected.length ? '已選 ' + selected.length + ' 個複習範圍' : '建立你的專屬修習計畫';
    if (foot) foot.textContent = changed() ? '變更尚未儲存，離開前記得儲存。' : '可跨科選擇，最多 24 個範圍。';
    const cardSummary = $('dongfu-scope-card')?.querySelector('.dongfu-collapse-summary');
    if (cardSummary) cardSummary.textContent = selected.length ? '已選 ' + selected.length + ' 個範圍 · 點擊全螢幕編輯' : '全螢幕選課 · 選章節、定考點';
    for (const id of ['ss-organize', 'ss-share']) if ($(id)) $(id).disabled = saving || !selected.length;
    if ($('ss-import')) $('ss-import').disabled = saving;
    const title = window.CurriculumRangeRules.validateShareTitle($('ss-share-title')?.value);
    if ($('ss-share-title-count')) $('ss-share-title-count').textContent = (title.length || 0) + ' / 20 字' + (title.ok ? '' : '（超過上限或含換行）');
    $('ss-share-title')?.setAttribute('aria-invalid', String(!title.ok));
    if ($('ss-share-title')) $('ss-share-title').disabled = sharing;
    const chatShare = window.CurriculumRangeRules.createChatShare(selected, $('ss-share-title')?.value);
    const sent = chatShare.ok && JSON.stringify(chatShare.message) === lastShared;
    if ($('ss-transfer-chat')) {
      $('ss-transfer-chat').disabled = saving || sharing || !chatShare.ok || sent;
      $('ss-transfer-chat').textContent = sharing ? '分享中…' : sent ? '已分享到聊天室' : '分享到聊天室';
    }
    if ($('ss-transfer-panel')?.dataset.mode === 'share') {
      if (!selected.length) $('ss-transfer-panel').hidden = true;
      else {
        const result = window.shareCustomCurriculumRanges?.();
        if (result?.ok) $('ss-transfer-text').value = result.text;
      }
    }
  }

  function feedback(message) { if ($('ss-feedback')) $('ss-feedback').textContent = message; }

  function transferPanel(mode) {
    if (saving) return;
    const panel = $('ss-transfer-panel'), input = $('ss-transfer-text');
    if (mode === 'share') {
      const result = window.shareCustomCurriculumRanges?.();
      if (!result?.ok) { feedback(result?.message || '清單尚未準備好。'); return; }
      input.value = result.text;
    } else input.value = '';
    panel.dataset.mode = mode;
    panel.hidden = false;
    input.readOnly = mode === 'share';
    $('ss-transfer-title').textContent = mode === 'share' ? '分享已選清單' : '匯入修習清單';
    $('ss-transfer-help').textContent = mode === 'share' ? '填寫標題後可分享到全服聊天室，其他修士可查看並加入；也可複製分享內容。' : '貼上收到的完整分享內容或分享碼，會加入目前清單並略過重複項目。完成後記得儲存。';
    $('ss-share-title-field').hidden = mode !== 'share';
    $('ss-transfer-chat').hidden = mode !== 'share';
    $('ss-transfer-copy').hidden = mode !== 'share';
    $('ss-transfer-native').hidden = mode !== 'share' || typeof navigator.share !== 'function';
    $('ss-transfer-apply').hidden = mode !== 'import';
    (mode === 'share' ? $('ss-share-title') : input).focus({ preventScroll:true });
    panel.scrollIntoView({ block:'nearest' });
    updateSummary();
  }

  async function shareToChat() {
    if (saving || sharing) return;
    const shared = window.CurriculumRangeRules.createChatShare(units(), $('ss-share-title').value);
    if (!shared.ok) { feedback(shared.message); return; }
    const key = JSON.stringify(shared.message);
    if (key === lastShared) return;
    sharing = true; updateSummary(); feedback('正在分享到全服聊天室…');
    try {
      await playerRepository.shareCurriculum({ code:shared.message.scopeCode, title:shared.message.scopeTitle });
      lastShared = key;
      feedback('已分享到全服聊天室，其他修士可查看並加入清單。');
    } catch (error) {
      feedback(error?.message || '分享失敗，請檢查連線後再試。');
    } finally { sharing = false; updateSummary(); }
  }

  function openShared(message) {
    const shared = window.CurriculumRangeRules.readChatShare(message);
    if (!shared.ok) { window.showToast?.(shared.message); return false; }
    if (!playerRepository.currentUser()) { window.showToast?.('請先登入'); return false; }
    if (opened || saving || sharing || document.querySelector('.page-section.active-page')?.id !== 'page-social' ||
        window.isXiuxianBattleBusy?.() || window.isXiuxianRaidInviteBlocked?.()) return false;
    if (typeof window.importCustomCurriculumRanges !== 'function' || !mount()) {
      window.showToast?.('修習清單功能載入中，請稍後再試。'); return false;
    }
    const importedShare = window.CurriculumRangeRules.shareSelection(shared.units);
    if (!importedShare.ok) { window.showToast?.(importedShare.message); return false; }
    open(); setView('cart'); transferPanel('import');
    $('ss-transfer-text').value = importedShare.text;
    $('ss-transfer-help').textContent = '「' + shared.title + '」共 ' + shared.units.length + ' 個範圍。確認下方清單後按「加入修習卷」，再儲存出題範圍。';
    return true;
  }

  async function copySelection() {
    const result = window.shareCustomCurriculumRanges?.();
    if (!result?.ok) { feedback(result?.message || '清單尚未準備好。'); return; }
    const input = $('ss-transfer-text'); input.value = result.text;
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw Error('clipboard unavailable');
      await navigator.clipboard.writeText(result.text);
      feedback('清單已複製，可分享給其他修士。');
    } catch (_) {
      input.focus({ preventScroll:true }); input.select();
      feedback('已選取分享內容，請用複製功能或 Ctrl／⌘＋C 複製。');
    }
  }

  async function nativeShare() {
    const result = window.shareCustomCurriculumRanges?.();
    if (!result?.ok) { feedback(result?.message || '清單尚未準備好。'); return; }
    try {
      await navigator.share({ title:'青雲問道 · 修習清單', text:result.text });
      feedback('已開啟系統分享。');
    } catch (error) {
      feedback(error?.name === 'AbortError' ? '已取消分享，仍可複製清單。' : '系統分享無法使用，請按「複製清單」。');
    }
  }

  function organize() {
    if (saving) return;
    const result = window.organizeCustomCurriculumRanges?.();
    feedback(result?.message || '範圍選擇器尚未準備好。'); updateSummary();
  }

  function importSelection() {
    if (saving) return;
    const result = window.importCustomCurriculumRanges?.($('ss-transfer-text').value);
    feedback(result?.message || '範圍選擇器尚未準備好。');
    if (result?.ok) $('ss-transfer-panel').hidden = true;
    updateSummary();
  }

  function setView(view) {
    if (!studio) return;
    const chosen = view === 'cart' ? 'cart' : 'course';
    const previous = studio.dataset.view === 'cart' ? $('ss-cart') : $('ss-picker');
    const next = chosen === 'cart' ? $('ss-cart') : $('ss-picker');
    const finishTransition = window.beginSceneTransition?.(previous, next, 'scroll', 'scope-view');
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
    finishTransition?.();
  }

  function open() {
    if (!mount() || opened) return;
    const finishTransition = window.beginSceneTransition?.(document.querySelector('.active-page'), studio, 'scroll', 'scope-open');
    previousFocus = document.activeElement;
    baseline = snapshot();
    $('ss-transfer-panel').hidden = true;
    $('ss-transfer-text').value = '';
    $('ss-share-title').value = '';
    lastShared = '';
    feedback('');
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
    finishTransition?.();
  }

  function close(force = false) {
    if (!opened || saving || sharing) return false;
    if (!force && changed()) {
      if (!window.confirm('有尚未儲存的範圍變更。確定要放棄本次修改嗎？')) return false;
      window.soloSelectedUnits = clone(JSON.parse(baseline.units));
      if ($('set-source-mode')) $('set-source-mode').value = baseline.mode;
      if ($('set-source-final-value')) $('set-source-final-value').value = baseline.bank;
      window.toggleSourceMode?.();
      window.renderSelectedUnitsList?.();
    }
    const finishTransition = window.beginSceneTransition?.(studio, document.querySelector('.active-page'), 'scroll', 'scope-close');
    if (scopeBody) {
      // 關閉時把控制項送回隱藏的原始設定容器，保留相同 ID 與事件。
      scopeBody.prepend(block);
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
    finishTransition?.();
    return true;
  }

  async function save() {
    if (saving || sharing) return;
    saving = true;
    updateSummary();
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
      updateSummary();
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
    link.href = './styles/curriculum-studio.css?v=20261007-scope-chat2';
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
          <div class="ss-cart-tools" aria-label="已選清單操作">
            <button id="ss-organize" type="button" title="拆開舊的自訂章節並移除重複項目">重新整理</button>
            <button id="ss-share" type="button">分享清單</button>
            <button id="ss-import" type="button">匯入清單</button>
          </div>
          <div class="ss-cart-body" id="ss-cart-body">
            <section id="ss-transfer-panel" class="ss-transfer-panel" hidden aria-labelledby="ss-transfer-title">
              <strong id="ss-transfer-title">分享已選清單</strong>
              <p id="ss-transfer-help"></p>
              <div id="ss-share-title-field" class="ss-share-title-field">
                <label for="ss-share-title">聊天室標題（選填，最多 20 字）</label>
                <input id="ss-share-title" type="text" placeholder="例如：物理段考複習" aria-describedby="ss-share-title-count" autocomplete="off">
                <small id="ss-share-title-count" aria-live="polite">0 / 20 字</small>
              </div>
              <label for="ss-transfer-text" class="ss-transfer-label">清單分享內容</label>
              <textarea id="ss-transfer-text" rows="5" maxlength="64000" aria-describedby="ss-transfer-help"></textarea>
              <div class="ss-transfer-actions">
                <button id="ss-transfer-chat" type="button">分享到聊天室</button>
                <button id="ss-transfer-copy" type="button">複製清單</button>
                <button id="ss-transfer-native" type="button">系統分享</button>
                <button id="ss-transfer-apply" type="button">加入修習卷</button>
                <button id="ss-transfer-close" type="button">收起</button>
              </div>
            </section>
          </div>
          <div class="ss-foot-summary" aria-live="polite">
            <strong id="ss-footer-main">建立你的專屬修習計畫</strong>
            <small id="ss-footer-sub">可跨科選擇，最多 24 個範圍。</small>
          </div>
        </aside>
      </div>
      <footer class="ss-foot">
        <small id="ss-feedback" role="status" aria-live="polite"></small>
        <div id="ss-foot-actions"></div>
      </footer>`;
    document.body.append(studio);

    // 已選清單與原有 selector 為同一份 DOM；這樣移除/儲存仍走既有流程。
    $('ss-cart-body').append(cartSource);
    cartSource.classList.add('ss-cart-source');

    // 卡片標題由 Dongfu controller 直接導向本頁，不再建置「先展開再按進入」的入口。
    saveButton.style.display = 'none';
    $('ss-close').addEventListener('click', () => close());
    $('ss-tab-course').addEventListener('click', () => setView('course'));
    $('ss-tab-cart').addEventListener('click', () => setView('cart'));
    $('ss-organize').addEventListener('click', organize);
    $('ss-share').addEventListener('click', () => transferPanel('share'));
    $('ss-import').addEventListener('click', () => transferPanel('import'));
    $('ss-transfer-copy').addEventListener('click', copySelection);
    $('ss-share-title').addEventListener('input', updateSummary);
    $('ss-transfer-chat').addEventListener('click', shareToChat);
    $('ss-transfer-native').addEventListener('click', nativeShare);
    $('ss-transfer-apply').addEventListener('click', importSelection);
    $('ss-transfer-close').addEventListener('click', () => {
      const origin = $('ss-transfer-panel').dataset.mode === 'share' ? $('ss-share') : $('ss-import');
      $('ss-transfer-panel').hidden = true; origin.focus({ preventScroll:true });
    });
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
    // 範圍卡片永不展開；表單只在獨立研修所顯示。
    updateSummary();
    return true;
  }

  window.openCurriculumStudio = open;
  window.closeCurriculumStudio = close;
  window.openSharedCurriculum = openShared;
  window.addEventListener('dongfu:settings-collapsible-ready', mount);
  window.addEventListener('curriculum:scope-draft-change', updateSummary);
  function boot() { mount(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
