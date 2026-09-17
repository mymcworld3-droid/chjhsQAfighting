// 高內容量頁面版型修正：充分利用可用空間，超量內容改為可捲動而不是被裁切。
(function () {
  'use strict';

  const STYLE_ID = 'content-capacity-layout-style';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* 修煉頁：舊 compact 版型曾把內容硬裁掉；改成自然延展，超量時由 main / 區塊自身捲動。 */
      body.xianxia-theme main:has(#page-training.active-page),
      body.xianxia-theme main:has(#page-training:not(.hidden)){
        overflow-y:auto!important;
        overscroll-behavior-y:contain!important;
      }

      body.xianxia-theme #page-training.training-page-v3{
        height:auto!important;
        max-height:none!important;
        min-height:calc(100dvh - 208px)!important;
        overflow:visible!important;
        padding-bottom:18px!important;
      }

      body.xianxia-theme #page-training.training-page-v3.active-page{
        display:grid!important;
        grid-template-rows:auto minmax(calc(100dvh - 260px),auto)!important;
        align-content:start!important;
      }

      body.xianxia-theme #page-training #training-tab-content{
        width:100%!important;
        height:auto!important;
        min-height:calc(100dvh - 260px)!important;
        max-height:none!important;
        overflow:visible!important;
        padding-bottom:10px!important;
      }

      /* 金丹主頁：讓金丹視覺真正吃到剩餘高度，不再只佔 220~260px。 */
      body.xianxia-theme #page-training .core-minimal-card{
        min-height:calc(100dvh - 270px)!important;
        height:auto!important;
        overflow:visible!important;
        align-items:stretch!important;
      }

      body.xianxia-theme #page-training .core-minimal-center{
        width:min(100%,920px)!important;
        max-width:920px!important;
        min-height:calc(100dvh - 288px)!important;
        height:auto!important;
        max-height:none!important;
        grid-template-rows:minmax(250px,1fr) auto auto auto auto!important;
        align-content:stretch!important;
      }

      body.xianxia-theme #page-training .golden-core-stage-v3{
        width:auto!important;
        height:clamp(240px,44dvh,430px)!important;
        max-height:430px!important;
        min-height:180px!important;
        min-width:180px!important;
      }

      /* 背包／庫存：物品變多時固定使用整個剩餘視窗並在清單內捲動。 */
      body.xianxia-theme #page-training .training-v3-bag-grid,
      body.xianxia-theme #page-training .cultivation-inventory-grid{
        height:auto!important;
        min-height:min(360px,calc(100dvh - 290px))!important;
        max-height:calc(100dvh - 270px)!important;
        overflow:auto!important;
        overscroll-behavior:contain!important;
        scrollbar-gutter:stable;
        align-content:start!important;
        padding:2px 4px 18px 2px!important;
      }

      /* 煉器：兩側都可完整長高；材料很多時只滾材料區，右側不再被 overflow:hidden 截斷。 */
      body.xianxia-theme #page-training .cultivation-refinery{
        width:100%!important;
        max-width:none!important;
        height:auto!important;
        min-height:calc(100dvh - 270px)!important;
        align-items:start!important;
        overflow:visible!important;
        padding-bottom:12px!important;
      }

      body.xianxia-theme #page-training .refinery-panel{
        height:auto!important;
        min-height:calc(100dvh - 290px)!important;
        max-height:none!important;
        overflow:visible!important;
      }

      body.xianxia-theme #page-training .refinery-material-list{
        flex:1 1 auto!important;
        min-height:220px!important;
        max-height:calc(100dvh - 395px)!important;
        overflow:auto!important;
        overscroll-behavior:contain!important;
        scrollbar-gutter:stable;
        padding-right:5px!important;
      }

      body.xianxia-theme #page-training .refinery-slots{
        flex:0 0 auto!important;
      }

      body.xianxia-theme #page-training .refinery-summary,
      body.xianxia-theme #page-training .refinery-match,
      body.xianxia-theme #page-training .refinery-actions,
      body.xianxia-theme #page-training .refinery-note{
        flex:0 0 auto!important;
      }

      /* 坊市／管理員：內容可能持續增加，解除窄版限制並提供穩定捲動區。 */
      body.xianxia-theme #page-store,
      body.xianxia-theme #page-admin{
        width:100%!important;
        max-width:none!important;
        margin-inline:0!important;
        box-sizing:border-box!important;
      }

      body.xianxia-theme #page-admin{
        padding-left:clamp(10px,2vw,30px)!important;
        padding-right:clamp(10px,2vw,30px)!important;
      }

      body.xianxia-theme #page-admin .admin-collapse-body{
        max-height:min(72dvh,760px);
        overflow:auto;
        overscroll-behavior:contain;
        scrollbar-gutter:stable;
      }

      body.xianxia-theme #page-admin :is(.amm-list,.aam-list){
        display:grid!important;
        grid-template-columns:repeat(auto-fit,minmax(320px,1fr))!important;
        gap:9px!important;
        align-items:start!important;
      }

      body.xianxia-theme #page-admin :is(.amm-item,.aam-item){
        min-width:0!important;
      }

      /* 大量資料列表統一避免橫向撐爆。 */
      body.xianxia-theme :is(#page-store,#page-admin,#page-training) *{
        min-width:0;
      }

      @media(max-width:900px){
        body.xianxia-theme #page-training.training-page-v3,
        body.xianxia-theme #page-training #training-tab-content,
        body.xianxia-theme #page-training .core-minimal-card,
        body.xianxia-theme #page-training .core-minimal-center,
        body.xianxia-theme #page-training .cultivation-refinery,
        body.xianxia-theme #page-training .refinery-panel{
          min-height:0!important;
        }

        body.xianxia-theme #page-training #training-tab-content{
          overflow:visible!important;
        }

        body.xianxia-theme #page-training .cultivation-refinery{
          grid-template-columns:1fr!important;
        }

        body.xianxia-theme #page-training .refinery-material-list{
          min-height:180px!important;
          max-height:min(42dvh,360px)!important;
        }

        body.xianxia-theme #page-training .training-v3-bag-grid,
        body.xianxia-theme #page-training .cultivation-inventory-grid{
          max-height:none!important;
          min-height:0!important;
          overflow:visible!important;
        }

        body.xianxia-theme #page-admin .admin-collapse-body{
          max-height:none;
          overflow:visible;
        }
      }

      @media(max-width:640px){
        body.xianxia-theme #page-training .core-minimal-center{
          grid-template-rows:auto auto auto auto auto!important;
        }

        body.xianxia-theme #page-training .golden-core-stage-v3{
          height:clamp(190px,36dvh,290px)!important;
          min-height:160px!important;
          min-width:160px!important;
        }

        body.xianxia-theme #page-admin :is(.amm-list,.aam-list){
          grid-template-columns:1fr!important;
        }
      }

      @media(max-height:650px){
        body.xianxia-theme #page-training .golden-core-stage-v3{
          height:clamp(150px,30dvh,220px)!important;
          min-height:130px!important;
          min-width:130px!important;
        }
        body.xianxia-theme #page-training .refinery-material-list{
          max-height:230px!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function boot() {
    ensureStyle();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
