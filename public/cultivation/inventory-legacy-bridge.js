// 統一背包啟用後，舊 cultivation-inventory.js 仍會維持資料與使用函式，
// 但不再讓舊長條卡佔據畫面；避免回魂聚靈丹重複顯示。
(function () {
  'use strict';
  const id = 'inventory-legacy-bridge-style';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    #training-tab-content:has(#unified-cultivation-bag) > .cultivation-inventory-grid,
    #training-tab-content:has(#unified-cultivation-bag) > #training-revival-pill-item{
      display:none!important;
    }
  `;
  document.head.appendChild(style);
})();
