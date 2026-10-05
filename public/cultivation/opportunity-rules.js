// Pure rules shared by the server, browser and regression tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpportunityRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SKILLS = Object.freeze(['retrieve', 'integrate', 'infer', 'apply', 'evaluate']);
  const LABELS = Object.freeze({ retrieve: '資訊擷取', integrate: '整合比較', infer: '推論理解', apply: '情境應用', evaluate: '評估判斷' });
  const SUBJECTS = ['國文', '英文', '數學', '公民', '歷史', '地理', '物理', '化學', '生物', '自然', '社會', '國語', '生活'];
  const text = (v, max = 240) => String(v || '').trim().slice(0, max);
  const signature = v => text(v, 8000).toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  function levelFor(path, fallback = '國中一年級') {
    const p = String(path || '').split('/')[1] || '';
    if (/^[七7](?:上|下|年級)/.test(p)) return '國中一年級';
    if (/^[八8](?:上|下|年級)/.test(p)) return '國中二年級';
    if (/^[九9](?:上|下|年級)/.test(p)) return '國中三年級';
    if (/^(國小|國中|高中|高職)[一二三四五六1-6]年級/.test(p)) return p;
    return text(fallback, 40) || '國中一年級';
  }
  function normalizeScope(player = {}) {
    const s = player.gameSettings || {}, level = text(player.profile?.educationLevel, 40) || '國中一年級';
    const mode = ['focused', 'bank'].includes(s.sourceMode) ? s.sourceMode : 'random';
    const raw = mode === 'focused' ? s.focusedUnits : mode === 'random' ? s.comprehensiveUnits : [];
    const units = [], seen = new Set();
    for (const u of (Array.isArray(raw) ? raw : []).slice(0, 100)) {
      const path = text(u?.path, 240).replace(/\\/g, '/');
      const subject = path.split('/')[0];
      if (!SUBJECTS.includes(subject)) continue;
      const detail = text(u.detail, 200), topics = [...new Set((Array.isArray(u.sub_topics) ? u.sub_topics : []).map(v => text(v, 80)).filter(Boolean))].sort().slice(0, 12);
      const unit = { path, subject, detail, topics, level: levelFor(path, level) };
      const key = JSON.stringify(unit);
      if (!seen.has(key)) { seen.add(key); units.push(unit); }
    }
    units.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const source = mode === 'bank' ? text(s.source, 240) : '';
    const difficulty = ['easy', 'medium', 'hard'].includes(s.difficulty) ? s.difficulty : 'medium';
    return { version: 1, mode, level, difficulty, source, units };
  }
  function scopeKey(player) { return JSON.stringify(normalizeScope(player)); }
  function chooseTarget(scope, history = [], random = Math.random) {
    if (scope.mode === 'focused' && !scope.units.length) throw new Error('請先儲存有效的修習範圍');
    let candidates = scope.units;
    if (!candidates.length && scope.mode === 'bank') {
      const subject = scope.source.split('/')[0];
      if (!SUBJECTS.includes(subject)) throw new Error('題庫範圍無法辨識，請先選擇修習範圍');
      candidates = [{ subject, path: scope.source, detail: scope.source.replace(/\.json$/i, ''), topics: [], level: levelFor(scope.source, scope.level) }];
    }
    if (!candidates.length) {
      const allowed = /國小|小學/.test(scope.level) ? ['國語', '英文', '數學', '自然', '社會'] : SUBJECTS.slice(0, 9);
      candidates = allowed.map(subject => ({ subject, path: subject, detail: '本年級核心知識的生活應用', topics: [], level: scope.level }));
    }
    // Less recently visited units receive more weight; no unit leaves the saved scope.
    const weights = candidates.map(u => 1 / (1 + history.slice(-12).filter(h => h.path === u.path && h.detail === u.detail).length));
    let roll = Math.max(0, Math.min(0.999999, random())) * weights.reduce((a, b) => a + b, 0);
    let index = weights.length - 1;
    for (let i = 0; i < weights.length; i++) { roll -= weights[i]; if (roll < 0) { index = i; break; } }
    return { ...candidates[index], difficulty: scope.difficulty };
  }
  function chance(misses = 0) { return Math.min(0.20, 0.08 + Math.max(0, Math.floor(Number(misses) || 0)) * 0.01); }
  return { SKILLS, LABELS, SUBJECTS, signature, levelFor, normalizeScope, scopeKey, chooseTarget, chance };
});
