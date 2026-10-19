// Device-local arrival state. No account balances or privileges are copied here.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QingyunFirstVisitRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STAGES = ['welcome', 'invite', 'gender', 'done'];
  function normalize(raw = {}) {
    if (raw?.version !== 1) raw = {};
    return { version: 1, stage: raw.stage === 'background' ? 'gender' : STAGES.includes(raw.stage) ? raw.stage : 'welcome',
      guestUid: String(raw.guestUid || ''), joining: raw.joining === true,
      completed: raw.completed === true || raw.stage === 'done' };
  }
  function readyStage(raw, user, data, firstLogin = false) {
    const state = normalize(raw);
    if (!user) return state.completed ? 'done' : 'welcome';
    if (user.isAnonymous) return 'done';
    if (needsGender(data) && (firstLogin || state.joining || ['gender', 'background'].includes(raw?.stage))) return 'gender';
    return 'done';
  }
  // Existing accounts keep their saved character and progression when logging in.
  function needsGender(data) { return !['male', 'female'].includes(data?.storyProgressV1?.gender); }
  function guestProgress(data = {}) {
    const stats = {};
    for (const key of ['totalScore','gold','currentStreak','bestStreak','totalCorrect','totalAnswered']) {
      const value = Number(data.stats?.[key]);
      if (Number.isFinite(value) && value >= 0) stats[key] = value;
    }
    const profile = {};
    for (const key of ['educationLevel','strongSubjects','weakSubjects']) {
      if (typeof data.profile?.[key] === 'string') profile[key] = data.profile[key];
    }
    return { stats, profile, ...(data.gameSettings && typeof data.gameSettings === 'object'
      ? { gameSettings: JSON.parse(JSON.stringify(data.gameSettings)) } : {}) };
  }
  return { STAGES, normalize, readyStage, needsGender, guestProgress };
});
