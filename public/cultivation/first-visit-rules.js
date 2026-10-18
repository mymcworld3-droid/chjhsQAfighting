// Device-local arrival state. No account balances or privileges are copied here.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QingyunFirstVisitRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STAGES = ['welcome', 'scope', 'features', 'question', 'invite', 'background', 'gender', 'done'];
  function normalize(raw = {}) {
    if (raw?.version !== 1) raw = {};
    return { version: 1, stage: STAGES.includes(raw.stage) ? raw.stage : 'welcome',
      guestUid: String(raw.guestUid || ''), joining: raw.joining === true,
      completed: raw.completed === true || raw.stage === 'done' };
  }
  function readyStage(raw, user, data, firstLogin = false) {
    const state = normalize(raw);
    if (!user) return state.completed ? 'done' : 'welcome';
    if (user.isAnonymous) {
      if (state.completed) return 'done';
      if (state.guestUid && state.guestUid !== user.uid) return 'scope';
      if (data?.arrivalTrialAnswerV1?.id || Number(data?.stats?.totalScore) >= 1) return 'invite';
      return ['features', 'question'].includes(state.stage) ? state.stage : 'scope';
    }
    if (data?.arrivalOnboardingV1?.completed) return 'done';
    if (state.joining || ['background', 'gender'].includes(state.stage)) return state.stage === 'gender' ? 'gender' : 'background';
    return firstLogin ? 'background' : 'done';
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
