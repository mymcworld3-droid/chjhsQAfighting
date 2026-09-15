// 境界突破反饋：只在本次遊戲過程中真正跨過境界門檻時觸發。
(function () {
  'use strict';

  const CSS_HREF = 'realm-breakthrough-feedback.css';
  const REALMS = [
    { name: '凡人', sub: '初入仙途', need: 0, emoji: '🌱' },
    { name: '煉氣', sub: '一層', need: 5, emoji: '🌬️' },
    { name: '煉氣', sub: '二層', need: 10, emoji: '🌬️' },
    { name: '煉氣', sub: '三層', need: 15, emoji: '🌬️' },
    { name: '煉氣', sub: '四層', need: 20, emoji: '🌬️' },
    { name: '煉氣', sub: '五層', need: 25, emoji: '🌬️' },
    { name: '煉氣', sub: '六層', need: 30, emoji: '🌬️' },
    { name: '煉氣', sub: '七層', need: 35, emoji: '🌬️' },
    { name: '煉氣', sub: '八層', need: 40, emoji: '🌬️' },
    { name: '煉氣', sub: '九層', need: 45, emoji: '🌬️' },
    { name: '築基', sub: '初期', need: 60, emoji: '🪨' },
    { name: '築基', sub: '中期', need: 80, emoji: '🪨' },
    { name: '築基', sub: '後期', need: 100, emoji: '🪨' },
    { name: '金丹', sub: '丹成一品', need: 150, emoji: '☀️' },
    { name: '元嬰', sub: '元嬰出竅', need: 200, emoji: '✨' },
    { name: '化神', sub: '神念通天', need: 300, emoji: '🔮' },
    { name: '煉虛', sub: '虛空悟道', need: 450, emoji: '🌌' },
    { name: '合體', sub: '天地合一', need: 650, emoji: '☯️' },
    { name: '大乘', sub: '大道將成', need: 900, emoji: '⚡' },
    { name: '渡劫', sub: '雷劫問道', need: 1200, emoji: '⛈️' },
    { name: '真仙', sub: '踏入仙門', need: 1600, emoji: '🪽' }
  ];

  let initialized = false;
  let lastRealmIndex = 0;
  let closingTimer = null;

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
    return index;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function removeFeedback() {
    clearTimeout(closingTimer);
    const overlay = document.getElementById('realm-breakthrough-feedback');
    if (!overlay) return;
    overlay.classList.add('leaving');
    setTimeout(() => overlay.remove(), 520);
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

    document.getElementById('realm-breakthrough-feedback')?.remove();
    clearTimeout(closingTimer);

    const overlay = document.createElement('div');
    overlay.id = 'realm-breakthrough-feedback';
    overlay.className = `realm-breakthrough-feedback ${major ? 'major' : 'minor'}`;
    overlay.setAttribute('aria-live', 'assertive');
    overlay.innerHTML = `
      <div class="realm-breakthrough-flash"></div>
      <div class="realm-breakthrough-rays"></div>
      <div class="realm-breakthrough-ring ring-a"></div>
      <div class="realm-breakthrough-ring ring-b"></div>
      <div class="realm-breakthrough-particles">${particleMarkup(major ? 36 : 20)}</div>
      <section class="realm-breakthrough-card">
        <div class="realm-breakthrough-kicker">${major ? 'BREAKTHROUGH' : 'REALM ASCENSION'}</div>
        <div class="realm-breakthrough-title">${major ? '境界突破' : '境界提升'}</div>
        <div class="realm-breakthrough-emoji">${escapeHtml(to.emoji)}</div>
        <div class="realm-breakthrough-realm">${escapeHtml(to.name)}</div>
        <div class="realm-breakthrough-sub">${escapeHtml(to.sub)}</div>
        <div class="realm-breakthrough-divider"><span></span><b>◆</b><span></span></div>
        <div class="realm-breakthrough-route">${escapeHtml(from.name)} ${escapeHtml(from.sub)} <i class="fa-solid fa-arrow-right-long"></i> ${escapeHtml(to.name)} ${escapeHtml(to.sub)}</div>
        <p>${major ? '天地共鳴，道途再開。' : '靈台清明，修為更進一境。'}</p>
      </section>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    try {
      if (navigator.vibrate) navigator.vibrate(major ? [45, 55, 90] : 35);
    } catch (_) {}

    window.dispatchEvent(new CustomEvent('realm-breakthrough', {
      detail: { from: { ...from }, to: { ...to }, major }
    }));

    closingTimer = setTimeout(removeFeedback, major ? 3300 : 2500);
  }

  function checkRealm() {
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
      showBreakthrough(previousIndex, currentIndex);
      return;
    }

    if (currentIndex < lastRealmIndex) lastRealmIndex = currentIndex;
  }

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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
