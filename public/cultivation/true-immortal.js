// 868 修為只能進入「登仙」；只有同時持有九州五大仙榜有效仙位者才顯示為「真仙」。
(function () {
  const roles = new Set(['ru-xian', 'fa-xian', 'suan-xian', 'xuan-xian', 'wai-xian']);
  let members = new Set();
  window.trueImmortalBoardReady = false;
  window.setTrueImmortalBoard = (entries, ready = true) => {
    members = new Set(entries.filter(entry => roles.has(entry.id) && entry.uid).map(entry => entry.uid));
    window.trueImmortalBoardReady = ready;
    window.dispatchEvent(new Event('xiuxian:immortals-updated'));
  };
  window.isTrueImmortal = (score, uid = window.getRealmUserUid?.()) =>
    window.trueImmortalBoardReady && Number(score) >= 868 && !!uid && members.has(uid);
  window.limitImmortalRank = (rank, score, realms, uid = window.getRealmUserUid?.()) => {
    const immortal = realms.findIndex(realm => realm.name === '真仙');
    return immortal >= 0 && rank >= immortal && !window.isTrueImmortal(score, uid)
      ? Math.max(0, immortal - 1) : rank;
  };
})();
