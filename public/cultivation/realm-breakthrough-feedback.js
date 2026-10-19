// 境界突破反饋：只在本次遊戲過程中真正跨過境界門檻時觸發。
(function () {
  'use strict';

  const CSS_HREF = 'realm-breakthrough-feedback.css';
  const REALMS = [
    { name: '凡人', sub: '初入仙途', need: 0 },
    { name: '煉氣', sub: '一層', need: 1 },
    { name: '煉氣', sub: '二層', need: 2 },
    { name: '煉氣', sub: '三層', need: 3 },
    { name: '煉氣', sub: '四層', need: 4 },
    { name: '煉氣', sub: '五層', need: 5 },
    { name: '築基', sub: '初期', need: 6 },
    { name: '築基', sub: '中期', need: 16 },
    { name: '築基', sub: '後期', need: 22 },
    { name: '金丹', sub: '丹成一品', need: 28 },
    { name: '元嬰', sub: '元嬰出竅', need: 68 },
    { name: '化神', sub: '神念通天', need: 188 },
    { name: '煉虛', sub: '虛空悟道', need: 428 },
    { name: '合體', sub: '天地合一', need: 788 },
    { name: '渡劫', sub: '雷劫問道', need: 1268 },
    { name: '半仙', sub: '仙門在望', need: 1868 },
    { name: '真仙', sub: '榜上仙位', need: 1868 }
  ];

  let initialized = false;
  let lastRealmIndex = 0;
  let activeFeedback = null;
  const CONTINUE_AFTER_MS = 1000;
  const EXIT_MS = 240;

  function loadStyle() {
    if (document.querySelector(`link[href="${CSS_HREF}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_HREF;
    document.head.appendChild(link);
  }

  function currentScore() {
    const data = window.getCurrentUserData?.();
    if (!data?.stats) return null;
    const value = Number(data.stats.totalScore);
    return Number.isFinite(value) ? Math.max(0, value) : null;
  }

  function realmIndexFor(value) {
    let index = 0;
    for (let i = 0; i < REALMS.length; i += 1) {
      if (value >= REALMS[i].need) index = i;
      else break;
    }
    return window.limitImmortalRank(index, value, REALMS);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function particleMarkup(count) {
    return Array.from({ length: count }, (_, index) => {
      const angle = (360 / count) * index + (index % 3) * 4;
      const distance = 112 + (index % 5) * 20;
      const delay = (index % 9) * 0.035;
      const size = 2 + (index % 4);
      return `<i class="realm-breakthrough-particle" style="--angle:${angle}deg;--distance:${distance}px;--delay:${delay}s;--size:${size}px"></i>`;
    }).join('');
  }

  function showBreakthrough(fromIndex, toIndex) {
    const from = REALMS[Math.max(0, fromIndex)] || REALMS[0];
    const to = REALMS[Math.max(0, toIndex)] || REALMS[0];
    const major = from.name !== to.name;
    const firstQi = fromIndex === 0 && toIndex === 1;

    activeFeedback?.dispose();
    let resolveCompletion;
    const completion = new Promise(resolve => { resolveCompletion = resolve; });

    const overlay = document.createElement('div');
    overlay.id = 'realm-breakthrough-feedback';
    overlay.className = `realm-breakthrough-feedback show ${major ? 'major' : 'minor'} ${firstQi ? 'first-qi' : ''}`;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `${to.name} ${to.sub}，境界突破`);
    overlay.setAttribute('aria-describedby', 'realm-breakthrough-continue');
    overlay.tabIndex = -1;
    overlay.innerHTML = `
      <div class="realm-breakthrough-flash"></div>
      <div class="realm-breakthrough-rays"></div>
      <div class="realm-breakthrough-ring ring-a"></div>
      <div class="realm-breakthrough-ring ring-b"></div>
      ${firstQi ? '<div class="realm-breakthrough-sigil" aria-hidden="true">引氣入體</div><div class="realm-breakthrough-wave wave-a"></div><div class="realm-breakthrough-wave wave-b"></div>' : ''}
      <div class="realm-breakthrough-particles">${particleMarkup(firstQi ? 52 : major ? 36 : 20)}</div>
      <section class="realm-breakthrough-card">
        <div class="realm-breakthrough-kicker">${major ? '大道突破' : '修為精進'}</div>
        <div class="realm-breakthrough-title">${major ? '境界突破' : '境界提升'}</div>
        <div class="realm-breakthrough-icon">${window.getRealmIconMarkup?.(to.name) || ''}</div>
        <div class="realm-breakthrough-realm">${escapeHtml(to.name)}</div>
        <div class="realm-breakthrough-sub">${escapeHtml(to.sub)}</div>
        <div class="realm-breakthrough-divider"><span></span><b>◆</b><span></span></div>
        <div class="realm-breakthrough-route">${escapeHtml(from.name)} ${escapeHtml(from.sub)} <i class="fa-solid fa-arrow-right-long"></i> ${escapeHtml(to.name)} ${escapeHtml(to.sub)}</div>
        <p>${firstQi ? '一念明悟，靈氣入體。你的第一步，已刻入仙途。' : major ? '天地共鳴，道途再開。' : '靈台清明，修為更進一境。'}</p>
      </section>
      <p id="realm-breakthrough-continue" class="realm-breakthrough-continue" aria-live="polite" aria-hidden="true">按任何地方以繼續</p>
    `;

    // One monotonic deadline controls the one-second lock, independent of FPS.
    const readyAt = performance.now() + CONTINUE_AFTER_MS;
    let closing = false, disposed = false, closeTimer, readyTimer;
    const previousFocus = document.activeElement;
    const documents = [document];
    // The fixed-ratio stage has black margins outside its iframe. They count too.
    try { if (window.parent !== window && window.parent?.document) documents.push(window.parent.document); } catch (_) {}
    const revealContinue = () => {
      if (disposed || closing) return;
      clearTimeout(readyTimer);
      const remaining = readyAt - performance.now();
      if (remaining > 0) {
        readyTimer = setTimeout(revealContinue, remaining);
        return;
      }
      overlay.querySelector('.realm-breakthrough-continue')?.setAttribute('aria-hidden', 'false');
    };
    readyTimer = setTimeout(revealContinue, Math.max(0, readyAt - performance.now()));
    const session = { dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(readyTimer); clearTimeout(closeTimer);
      document.removeEventListener('visibilitychange', revealContinue);
      window.removeEventListener('pageshow', revealContinue);
      for (const doc of documents) {
        doc.removeEventListener('click', onContinue, true);
        doc.removeEventListener('pointerdown', blockPointer, true);
        doc.removeEventListener('keydown', onKeyDown, true);
      }
      overlay.remove();
      if (activeFeedback === session) activeFeedback = null;
      if (previousFocus?.isConnected) previousFocus.focus?.({ preventScroll:true });
      resolveCompletion();
    } };
    function blockPointer(event) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
    function onContinue(event) {
      blockPointer(event);
      if (closing || performance.now() < readyAt) return;
      revealContinue();
      closing = true;
      overlay.classList.add('leaving');
      closeTimer = setTimeout(session.dispose, EXIT_MS);
    }
    function onKeyDown(event) {
      if (['Enter', ' ', 'Escape'].includes(event.key)) onContinue(event);
      else if (event.key === 'Tab') blockPointer(event);
    }
    activeFeedback = session;
    document.body.appendChild(overlay);
    overlay.focus?.({ preventScroll:true });
    for (const doc of documents) {
      doc.addEventListener('click', onContinue, true);
      doc.addEventListener('pointerdown', blockPointer, true);
      doc.addEventListener('keydown', onKeyDown, true);
    }
    document.addEventListener('visibilitychange', revealContinue);
    window.addEventListener('pageshow', revealContinue);

    try {
      if (navigator.vibrate) navigator.vibrate(major ? [45, 55, 90] : 35);
    } catch (_) {}

    window.dispatchEvent(new CustomEvent('realm-breakthrough', {
      detail: { from: { ...from }, to: { ...to }, major }
    }));

    return completion;
  }

  function checkRealm() {
    // 問道收益先完成光球吸收與進度條；保留舊境界，結束後才檢查跨境。
    if (window.isSoloCultivationFeedbackActive?.()) return;
    const value = currentScore();
    if (value == null) return;
    const currentIndex = realmIndexFor(value);

    if (!initialized) {
      initialized = true;
      lastRealmIndex = currentIndex;
      return;
    }

    if (currentIndex > lastRealmIndex) {
      const previousIndex = lastRealmIndex;
      lastRealmIndex = currentIndex;
      // 首題先等資料保存成功，再由首次流程交棒播放突破。
      if (window.isFirstVisitTrial?.()) return;
      showBreakthrough(previousIndex, currentIndex);
      return;
    }

    if (currentIndex < lastRealmIndex) lastRealmIndex = currentIndex;
  }

  window.showFirstQiBreakthrough = async () => {
    await window.waitForSoloCultivationFeedback?.();
    loadStyle();
    initialized = true;
    lastRealmIndex = realmIndexFor(currentScore() || 1);
    return showBreakthrough(0, 1);
  };

  function boot() {
    loadStyle();
    checkRealm();
    setInterval(checkRealm, 300);

    const scoreEl = document.getElementById('display-score');
    if (scoreEl) {
      new MutationObserver(checkRealm).observe(scoreEl, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }

    window.addEventListener('xiuxian:stats-updated', checkRealm);
    window.addEventListener('xiuxian:solo-cultivation-feedback-end', checkRealm);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
