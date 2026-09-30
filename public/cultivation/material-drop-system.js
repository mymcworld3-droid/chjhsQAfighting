// 現行煉器素材只由團本產生。
// 問道、洞天與其他一般玩法不再進行任何素材掉落或 Firebase 寫入。
(function () {
  'use strict';
  window.XIUXIAN_MATERIAL_DROP_STATE = Object.freeze({
    enabled:false,
    source:'raid-only',
    quizDrops:false,
    dongtianDrops:false
  });
})();
