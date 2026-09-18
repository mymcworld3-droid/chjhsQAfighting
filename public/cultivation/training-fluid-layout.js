// 修煉頁流動式版面：佔滿可用空間，依桌機／平板／手機自適應。
// 只覆寫排版，不改動修煉、背包或煉器邏輯。
(function () {
  'use strict';

  const STYLE_ID = 'training-fluid-layout-style';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      body.xianxia-theme main:has(#page-training.active-page){
        width:100%!important;
        max-width:none!important;
      }

      body.xianxia-theme #page-training.training-page-v3{
        width:100%!important;
        max-width:none!important;
        margin:0!important;
        padding-left:clamp(8px,1.7vw,28px)!important;
        padding-right:clamp(8px,1.7vw,28px)!important;
      }

      body.xianxia-theme #page-training .training-subtabs-v3{
        width:100%!important;
        max-width:none!important;
        display:grid!important;
        grid-template-columns:repeat(auto-fit,minmax(92px,1fr))!important;
        gap:clamp(4px,.65vw,9px)!important;
      }

      body.xianxia-theme #page-training .training-subtab-v3{
        width:100%!important;
        min-width:0!important;
        flex:1 1 auto!important;
      }

      body.xianxia-theme #page-training #training-tab-content{
        width:100%!important;
        max-width:none!important;
        min-width:0!important;
      }

      body.xianxia-theme #page-training .core-minimal-card{
        width:100%!important;
        max-width:none!important;
        padding-left:clamp(8px,2vw,36px)!important;
        padding-right:clamp(8px,2vw,36px)!important;
      }

      body.xianxia-theme #page-training .core-minimal-center{
        width:min(100%,720px)!important;
        max-width:720px!important;
      }

      body.xianxia-theme #page-training .training-v3-bag-grid,
      body.xianxia-theme #page-training .cultivation-inventory-grid{
        width:100%!important;
        max-width:none!important;
        grid-template-columns:repeat(auto-fit,minmax(250px,1fr))!important;
        gap:clamp(7px,1vw,14px)!important;
        overflow:auto!important;
        overscroll-behavior:contain;
        padding-right:2px;
      }

      body.xianxia-theme #page-training .training-v3-empty{
        width:100%!important;
        max-width:none!important;
      }

      body.xianxia-theme #page-training .cultivation-refinery{
        width:100%!important;
        max-width:none!important;
        height:100%!important;
        min-height:0!important;
        margin:0!important;
        grid-template-columns:minmax(280px,.9fr) minmax(390px,1.1fr)!important;
        gap:clamp(10px,1.3vw,20px)!important;
        align-items:stretch!important;
      }

      body.xianxia-theme #page-training .refinery-panel{
        min-height:0!important;
        height:100%!important;
        display:flex!important;
        flex-direction:column!important;
      }

      body.xianxia-theme #page-training .refinery-material-list{
        flex:1 1 auto!important;
        display:grid!important;
        grid-template-rows:repeat(2,minmax(0,1fr))!important;
        min-height:0!important;
        max-height:none!important;
        overflow:hidden!important;
      }

      body.xianxia-theme #page-training .refinery-material-roll{
        min-height:0!important;
        height:100%!important;
      }

      body.xianxia-theme #page-training .refinery-material-roll-body{
        min-height:0!important;
        overflow:auto!important;
        overscroll-behavior:contain!important;
      }

      body.xianxia-theme #page-training .refinery-slots{
        grid-template-columns:repeat(4,minmax(64px,1fr))!important;
      }

      @media (min-width:1280px){
        body.xianxia-theme #page-training .golden-core-stage-v3{
          max-height:260px!important;
        }
        body.xianxia-theme #page-training .training-v3-bag-grid,
        body.xianxia-theme #page-training .cultivation-inventory-grid{
          grid-template-columns:repeat(auto-fit,minmax(280px,1fr))!important;
        }
      }

      @media (max-width:900px){
        body.xianxia-theme #page-training.training-page-v3{
          padding-left:10px!important;
          padding-right:10px!important;
        }
        body.xianxia-theme #page-training .cultivation-refinery{
          grid-template-columns:1fr!important;
          height:auto!important;
          min-height:100%!important;
        }
        body.xianxia-theme #page-training #training-tab-content{
          overflow:auto!important;
          overscroll-behavior:contain;
        }
        body.xianxia-theme #page-training .refinery-panel{
          height:auto!important;
        }
        body.xianxia-theme #page-training .refinery-material-list{
          max-height:min(38dvh,330px)!important;
        }
      }

      @media (max-width:640px){
        body.xianxia-theme #page-training .training-subtabs-v3{
          grid-template-columns:repeat(auto-fit,minmax(78px,1fr))!important;
        }
        body.xianxia-theme #page-training .training-v3-bag-grid,
        body.xianxia-theme #page-training .cultivation-inventory-grid{
          grid-template-columns:1fr!important;
        }
        body.xianxia-theme #page-training .core-minimal-center{
          width:100%!important;
        }
        body.xianxia-theme #page-training .refinery-slots{
          grid-template-columns:repeat(4,minmax(0,1fr))!important;
          gap:5px!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function boot() {
    ensureStyle();
    window.addEventListener('resize', ensureStyle, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
