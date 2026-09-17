// 坊市滿版自適應版型：解除全站 page-section 寬度上限，商品依實際可用寬度自動排欄。
(function () {
  'use strict';

  const STYLE_ID = 'market-fluid-layout-style';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      body.xianxia-theme #page-store{
        box-sizing:border-box;
        width:100%!important;
        max-width:none!important;
        margin-inline:0!important;
        padding-left:clamp(10px,2vw,30px)!important;
        padding-right:clamp(10px,2vw,30px)!important;
      }

      body.xianxia-theme #page-store > .sticky{
        width:100%;
        box-sizing:border-box;
        padding-left:clamp(2px,.6vw,10px);
        padding-right:clamp(2px,.6vw,10px);
      }

      body.xianxia-theme #page-store > div:has(> .store-tab){
        width:100%;
        display:grid!important;
        grid-template-columns:repeat(3,minmax(0,1fr));
        gap:clamp(5px,.7vw,10px)!important;
        box-sizing:border-box;
      }

      body.xianxia-theme #page-store .store-tab{
        width:100%;
        min-width:0;
      }

      body.xianxia-theme #store-grid{
        width:100%;
        box-sizing:border-box;
        display:grid!important;
        grid-template-columns:repeat(auto-fit,minmax(170px,1fr))!important;
        gap:clamp(10px,1.15vw,18px)!important;
        align-items:stretch;
      }

      body.xianxia-theme #store-grid > *{
        min-width:0;
        width:100%;
      }

      body.xianxia-theme #store-grid :is(.shop-card,.item-card){
        width:100%;
        height:100%;
        box-sizing:border-box;
      }

      body.xianxia-theme #store-grid img:not([class~="h-[140%]"]){
        max-width:100%;
        height:auto;
      }

      /* 坊市中的頭像框只縮商品預覽，不影響玩家實際裝備後的頭像框。 */
      body.xianxia-theme #store-grid img[class~="h-[140%]"]{
        height:118%!important;
        width:auto!important;
        max-width:118%!important;
        object-fit:contain!important;
      }

      @media (min-width:1500px){
        body.xianxia-theme #store-grid{
          grid-template-columns:repeat(auto-fit,minmax(190px,1fr))!important;
        }
      }

      @media (max-width:760px){
        body.xianxia-theme #page-store{
          padding-left:10px!important;
          padding-right:10px!important;
        }
        body.xianxia-theme #store-grid{
          grid-template-columns:repeat(3,minmax(0,1fr))!important;
          gap:9px!important;
        }
      }

      @media (max-width:520px){
        body.xianxia-theme #page-store > div:has(> .store-tab){
          gap:5px!important;
          padding:4px!important;
        }
        body.xianxia-theme #page-store .store-tab{
          padding-left:4px!important;
          padding-right:4px!important;
          font-size:10px!important;
        }
        body.xianxia-theme #store-grid{
          grid-template-columns:repeat(2,minmax(0,1fr))!important;
          gap:8px!important;
          padding-bottom:86px!important;
        }
      }

      @media (max-width:330px){
        body.xianxia-theme #store-grid{
          grid-template-columns:1fr!important;
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
