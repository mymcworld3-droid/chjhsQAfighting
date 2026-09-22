// 全站共用境界紋章：固定向量路徑，不依賴作業系統表情符號與第三方圖片。
(function () {
  'use strict';

  const GLYPHS = Object.freeze({
    '凡人': '<path d="M8 37l8-12 7 7 9-19 8 24H8z"/><path d="M19 37l5-9 5 9M24 7v7m-4-4h8"/>',
    '煉氣': '<path d="M10 29c7 8 23 5 26-5 3-11-16-16-24-7-7 8 1 19 11 16 9-2 12-12 5-15-5-3-11 0-10 5 0 3 4 5 6 2"/><path d="M8 16l3 2-1 4M37 31l-4-1-1-4"/>',
    '築基': '<path d="M24 5l16 10v18L24 43 8 33V15L24 5z"/><path d="M24 11l11 7v12l-11 7-11-7V18l11-7z"/><path d="M24 16v16m-8-8h16"/><circle cx="24" cy="24" r="3"/>',
    '金丹': '<circle cx="24" cy="24" r="12"/><circle cx="24" cy="24" r="7"/><path d="M24 3v6m0 30v6M3 24h6m30 0h6M9 9l4 4m22 22 4 4M39 9l-4 4M13 35l-4 4"/><path d="M24 19l2 5-2 5-2-5z"/>',
    '元嬰': '<path d="M24 5c-13 0-19 9-16 22 2 9 10 15 16 16 7-1 15-7 16-16C43 14 37 5 24 5z"/><circle cx="24" cy="17" r="4"/><path d="M16 33c1-8 4-9 8-9s7 1 8 9M14 27l-3 6m23-6 3 6M20 37h8"/>',
    '化神': '<path d="M5 24c6-8 12-12 19-12s13 4 19 12c-6 8-12 12-19 12S11 32 5 24z"/><circle cx="24" cy="24" r="6"/><circle cx="24" cy="24" r="2"/><path d="M24 3v7m0 28v7M7 7l5 5m24 24 5 5M41 7l-5 5M12 36l-5 5"/>',
    '煉虛': '<path d="M32 9c-12-3-23 5-23 16 0 12 12 19 23 14M29 15c-7-1-13 4-13 10s6 11 13 10"/><path d="M33 4l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6zM37 26l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5 1.5-4z"/>',
    '合體': '<path d="M12 10c-8 6-9 19-2 27 8 9 21 7 28-2M36 38c8-6 9-19 2-27-8-9-21-7-28 2"/><path d="M16 24l8-8 8 8-8 8-8-8z"/><path d="M24 8v7m0 18v7M8 24h7m18 0h7"/>',
    '大乘': '<path d="M5 38h38M9 32h30M13 26h22M17 20h14M21 14h6M24 4v10M15 7l4 5m14-5-4 5"/><path d="M7 32l6-6 4-6 4-6M41 32l-6-6-4-6-4-6"/>',
    '渡劫': '<path d="M9 19c0-6 5-10 10-10 3-5 13-6 17 0 6 0 9 5 9 10 0 5-4 8-9 8h-5M11 27H7"/><path d="M26 18l-9 13h8l-4 13 14-18h-9l5-8z"/>',
    '登仙': '<path d="M7 41V15l17-9 17 9v26M13 41V19l11-6 11 6v22M19 41V26h10v15M4 41h40"/><path d="M24 2v5M7 8l5 5M41 8l-5 5M24 18v4"/>',
    '真仙': '<path d="M24 3l5 9 11-2-3 11 8 7-11 5-1 11-9-6-9 6-1-11-11-5 8-7-3-11 11 2 5-9z"/><path d="M16 30l2-11 6 5 6-5 2 11H16z"/><path d="M18 34h12M24 12v5"/><circle cx="24" cy="19" r="1.5"/>'
  });

  const CSS_HREF = 'realm-icons.css?v=20260922-realm-crest1';

  // name 僅經白名單索引；不得拼接使用者資料到 SVG 或 HTML。
  function getRealmIconMarkup(name, className = '') {
    const key = Object.prototype.hasOwnProperty.call(GLYPHS, name) ? name : '凡人';
    const extra = String(className).split(/\s+/).filter(part => /^[a-zA-Z0-9_-]+$/.test(part)).join(' ');
    return `<span class="realm-icon${extra ? ' ' + extra : ''}" data-realm="${key}" aria-hidden="true"><svg viewBox="0 0 48 48" focusable="false" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[key]}</svg></span>`;
  }

  window.getRealmIconMarkup = getRealmIconMarkup;
  window.XIUXIAN_REALM_ICON_NAMES = Object.freeze(Object.keys(GLYPHS));

  if (!document.querySelector(`link[href="${CSS_HREF}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_HREF;
    document.head.appendChild(link);
  }
})();
