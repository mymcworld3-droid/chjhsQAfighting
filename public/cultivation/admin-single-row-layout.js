// 管理員法寶／材料清單固定一列一項；保留境界排序與長清單捲動。
(function () {
  'use strict';

  const STYLE_ID = 'admin-single-row-layout-style';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      body.xianxia-theme #page-admin #admin-artifact-list.aam-list,
      body.xianxia-theme #page-admin #admin-material-list.amm-list {
        display:grid!important;
        grid-template-columns:minmax(0,1fr)!important;
        gap:8px!important;
        width:100%!important;
        align-items:stretch!important;
      }

      body.xianxia-theme #page-admin #admin-artifact-list > .aam-item,
      body.xianxia-theme #page-admin #admin-material-list > .amm-item {
        width:100%!important;
        min-width:0!important;
        box-sizing:border-box!important;
      }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureStyle, { once:true });
  else ensureStyle();
})();
