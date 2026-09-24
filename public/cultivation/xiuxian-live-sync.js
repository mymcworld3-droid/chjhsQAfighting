// 仙途修行即時同步：收到修為變更事件後立即更新首頁面板。
(function () {
  'use strict';

  const REALMS = [
    { name: '凡人', sub: '初入仙途', need: 0 },
    { name: '煉氣', sub: '一層', need: 1 },
    { name: '煉氣', sub: '二層', need: 2 },
    { name: '煉氣', sub: '三層', need: 3 },
    { name: '煉氣', sub: '四層', need: 4 },
    { name: '煉氣', sub: '五層', need: 5 },
    { name: '煉氣', sub: '六層', need: 6 },
    { name: '煉氣', sub: '七層', need: 7 },
    { name: '煉氣', sub: '八層', need: 8 },
    { name: '煉氣', sub: '九層', need: 9 },
    { name: '築基', sub: '初期', need: 10 },
    { name: '築基', sub: '中期', need: 16 },
    { name: '築基', sub: '後期', need: 22 },
    { name: '金丹', sub: '丹成一品', need: 28 },
    { name: '元嬰', sub: '元嬰出竅', need: 68 },
    { name: '化神', sub: '神念通天', need: 188 },
    { name: '煉虛', sub: '虛空悟道', need: 428 },
    { name: '合體', sub: '天地合一', need: 788 },
    { name: '大乘', sub: '大道將成', need: 1268 },
    { name: '渡劫', sub: '雷劫問道', need: 1868 },
    { name: '半仙', sub: '仙門在望', need: 2588 },
    { name: '真仙', sub: '榜上仙位', need: 2588 }
  ];

  function realmFor(value) {
    let current = REALMS[0];
    for (const realm of REALMS) {
      if (value >= realm.need) current = realm;
      else break;
    }
    const index = REALMS.indexOf(current);
    return REALMS[window.limitImmortalRank(index, value, REALMS)] || current;
  }

  function nextRealm(value) {
    const current = realmFor(value);
    return REALMS[REALMS.indexOf(current) + 1] || null;
  }

  function refresh(score) {
    const value = Math.max(0, Number(score) || 0);
    const realm = realmFor(value);
    const next = nextRealm(value);

    const scoreEl = document.getElementById('xiuxian-score');
    const realmEl = document.getElementById('xiuxian-realm');
    const subEl = document.getElementById('xiuxian-sub');
    const barEl = document.getElementById('xiuxian-progress');
    const nextEl = document.getElementById('xiuxian-next');
    const labelEl = document.getElementById('xiuxian-progress-label');

    if (!scoreEl || !realmEl || !subEl || !barEl || !nextEl || !labelEl) return false;

    realmEl.textContent = realm.name;
    subEl.textContent = realm.sub;
    scoreEl.textContent = `${value.toLocaleString()} 修為`;

    if (!next) {
      barEl.style.width = '100%';
      nextEl.textContent = '已成真仙';
      labelEl.textContent = '榜上有名，位列真仙';
      return true;
    }

    if (next.name === '真仙' && next.need <= value) {
      barEl.style.width = '100%';
      nextEl.textContent = '需登上九州五大仙榜';
      labelEl.textContent = '半仙已成 · 爭奪真仙席位';
      return true;
    }

    const percent = Math.max(0, Math.min(100,
      ((value - realm.need) / Math.max(1, next.need - realm.need)) * 100
    ));
    barEl.style.width = `${percent}%`;
    nextEl.textContent = `${Math.max(0, next.need - value).toLocaleString()} 修為`;
    labelEl.textContent = `下一境界：${next.name} ${next.sub}`;
    return true;
  }

  window.refreshXiuxianLiveSync = refresh;

  window.addEventListener('xiuxian:stats-updated', (event) => {
    const score = event.detail?.totalScore;
    if (score != null) refresh(Number(score));
  });

  function boot() {
    const score = window.getCurrentUserData?.()?.stats?.totalScore;
    if (score != null) refresh(score);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
