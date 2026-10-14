// 1868 修為且持有自己學制的有效五大仙仙位，才能晉入真仙。
(function () {
  const roles = new Set(['ru-xian', 'fa-xian', 'suan-xian', 'xuan-xian', 'wai-xian']);
  const cohorts = ['elementary', 'junior'];
  let members = new Map();
  window.trueImmortalBoardReady = false;
  window.setTrueImmortalBoard = (entries, ready = true) => {
    members = new Map();
    for (const entry of entries || []) {
      const cohort = cohorts.find(group => roles.has(entry.id?.slice((group + '__').length)) &&
        entry.id?.startsWith(group + '__') && entry.cohort === group);
      if (!cohort || !entry.uid) continue;
      if (!members.has(entry.uid)) members.set(entry.uid, new Set());
      members.get(entry.uid).add(cohort);
    }
    window.trueImmortalBoardReady = ready;
    window.dispatchEvent(new Event('xiuxian:immortals-updated'));
  };
  window.isTrueImmortal = (score, uid = window.getRealmUserUid?.()) => {
    if (!window.trueImmortalBoardReady || Number(score) < 1868 || !uid) return false;
    const owned = members.get(uid);
    if (!owned?.size) return false;
    if (uid !== window.getRealmUserUid?.()) return true;
    // Grade changes cannot keep a seat from a different cohort.
    const cohort = window.getLeaderboardEducationGroup?.(
      window.getCurrentUserData?.()?.profile?.educationLevel
    );
    return !!cohort && owned.has(cohort);
  };
  window.limitImmortalRank = (rank, score, realms, uid = window.getRealmUserUid?.()) => {
    const immortal = realms.findIndex(realm => realm.name === '真仙');
    return immortal >= 0 && rank >= immortal && !window.isTrueImmortal(score, uid)
      ? Math.max(0, immortal - 1) : rank;
  };
})();
