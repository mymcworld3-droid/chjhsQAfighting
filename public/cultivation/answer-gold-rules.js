// Shared per-answer spirit-stone growth; independent of cultivation/artifact multipliers.
(function (root) {
  'use strict';
  const REALMS = Object.freeze([
    { min: 0, name: '煉氣', bonus: 0 },
    { min: 6, name: '築基', bonus: 5 },
    { min: 28, name: '金丹', bonus: 10 },
    { min: 68, name: '元嬰', bonus: 20 },
    { min: 188, name: '化神', bonus: 30 },
    { min: 428, name: '煉虛', bonus: 40 },
    { min: 788, name: '合體', bonus: 50 },
    { min: 1268, name: '渡劫', bonus: 60 },
    { min: 1868, name: '半仙以上', bonus: 80 }
  ].map(Object.freeze));
  function realm(score) {
    const value = Number.isFinite(Number(score)) ? Math.max(0, Number(score)) : 0;
    return REALMS.findLast(row => value >= row.min);
  }
  function perCorrect(score, base = 20) {
    return Math.max(0, Math.floor(Number(base) || 0)) + realm(score).bonus;
  }
  const api = Object.freeze({ REALMS, realm, perCorrect });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QAAnswerGoldRules = api;
})(globalThis);
