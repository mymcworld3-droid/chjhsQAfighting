// 高內容量頁面版型修正：充分利用可用空間，超量內容改為可捲動而不是被裁切。
(function () {
  'use strict';

  const STYLE_ID = 'content-capacity-layout-style';
  const PAGE_ID = 'page-training';
  const NAV_ID = 'bottom-nav';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      body.xianxia-theme main:has(#page-training.active-page),
      body.xianxia-theme main:has(#page-training:not(.hidden)){
        overflow-y:auto!important;
        overscroll-behavior-y:contain!important;
      }

      /* 高度直接由實際底部導覽位置量測，不再重複扣除 dvh / main padding。 */
      body.xianxia-theme #page-training.training-page-v3{
        height:auto!important;
        max-height:none!important;
        min-height:var(--training-fill-height,calc(100dvh - 208px))!important;
        overflow:visible!important;
        padding-bottom:8px!important;
      }

      body.xianxia-theme #page-training.training-page-v3.active-page{
        display:grid!important;
        grid-template-rows:auto minmax(0,1fr)!important;
        align-content:stretch!important;
      }

      body.xianxia-theme #page-training #training-tab-content{
        width:100%!important;
        height:auto!important;
        min-height:var(--training-content-height,calc(100dvh - 260px))!important;
        max-height:none!important;
        overflow:visible!important;
        padding-bottom:0!important;
      }

      body.xianxia-theme #page-training .core-minimal-card{
        min-height:var(--training-content-height,calc(100dvh - 270px))!important;
        height:auto!important;
        overflow:visible!important;
        align-items:stretch!important;
      }

      body.xianxia-theme #page-training .core-minimal-center{
        width:min(100%,920px)!important;
        max-width:920px!important;
        min-height:max(0px,calc(var(--training-content-height,calc(100dvh - 260px)) - 8px))!important;
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

      body.xianxia-theme #page-training .training-v3-bag-grid,
      body.xianxia-theme #page-training .cultivation-inventory-grid{
        height:auto!important;
        min-height:min(360px,var(--training-content-height,calc(100dvh - 290px)))!important;
        max-height:var(--training-content-height,calc(100dvh - 270px))!important;
        overflow:auto!important;
        overscroll-behavior:contain!important;
        scrollbar-gutter:stable;
        align-content:start!important;
        padding:2px 4px 10px 2px!important;
      }

      /* 煉器吃滿導覽列上方空間，材料過多只滾左側清單。 */
      body.xianxia-theme #page-training .cultivation-refinery{
        width:100%!important;
        max-width:none!important;
        height:auto!important;
        min-height:var(--training-content-height,calc(100dvh - 270px))!important;
        align-items:stretch!important;
        overflow:visible!important;
        padding-bottom:0!important;
      }

      body.xianxia-theme #page-training .refinery-panel{
        height:auto!important;
        min-height:max(0px,calc(var(--training-content-height,calc(100dvh - 270px)) - 4px))!important;
        max-height:none!important;
        overflow:visible!important;
      }

      body.xianxia-theme #page-training .refinery-material-list{
        flex:1 1 auto!important;
        display:grid!important;
        grid-template-rows:repeat(2,minmax(0,1fr))!important;
        min-height:220px!important;
        max-height:max(220px,calc(var(--training-content-height,calc(100dvh - 270px)) - 110px))!important;
        overflow:hidden!important;
        padding-right:5px!important;
      }

      body.xianxia-theme #page-training .refinery-material-roll{
        min-height:0!important;
        height:100%!important;
      }

      body.xianxia-theme #page-training .refinery-material-roll-body{
        min-height:0!important;
        overflow:auto!important;
        overscroll-behavior:contain!important;
        scrollbar-gutter:stable;
      }

      body.xianxia-theme #page-training .refinery-slots,
      body.xianxia-theme #page-training .refinery-summary,
      body.xianxia-theme #page-training .refinery-match,
      body.xianxia-theme #page-training .refinery-actions,
      body.xianxia-theme #page-training .refinery-note{
        flex:0 0 auto!important;
      }

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

      body.xianxia-theme #page-admin :is(.amm-item,.aam-item){min-width:0!important}
      body.xianxia-theme :is(#page-store,#page-admin,#page-training) *{min-width:0}

      @media(max-width:900px){
        body.xianxia-theme #page-training.training-page-v3{
          min-height:var(--training-fill-height,calc(100dvh - 190px))!important;
        }
        body.xianxia-theme #page-training #training-tab-content{
          min-height:var(--training-content-height,0px)!important;
          overflow:visible!important;
        }
        body.xianxia-theme #page-training .core-minimal-card,
        body.xianxia-theme #page-training .core-minimal-center{
          min-height:var(--training-content-height,0px)!important;
        }
        body.xianxia-theme #page-training .cultivation-refinery{
          grid-template-columns:1fr!important;
          min-height:var(--training-content-height,0px)!important;
        }
        body.xianxia-theme #page-training .refinery-panel{min-height:0!important}
        body.xianxia-theme #page-training .refinery-material-list{
          min-height:180px!important;
          max-height:min(42dvh,360px)!important;
        }
        body.xianxia-theme #page-training .training-v3-bag-grid,
        body.xianxia-theme #page-training .cultivation-inventory-grid{
          max-height:none!important;
          min-height:var(--training-content-height,0px)!important;
          overflow:visible!important;
        }
        body.xianxia-theme #page-admin .admin-collapse-body{max-height:none;overflow:visible}
      }

      @media(max-width:640px){
        body.xianxia-theme #page-training .core-minimal-center{grid-template-rows:auto auto auto auto auto!important}
        body.xianxia-theme #page-training .golden-core-stage-v3{
          height:clamp(190px,36dvh,290px)!important;
          min-height:160px!important;
          min-width:160px!important;
        }
        body.xianxia-theme #page-admin :is(.amm-list,.aam-list){grid-template-columns:1fr!important}
      }

      @media(max-height:650px){
        body.xianxia-theme #page-training .golden-core-stage-v3{
          height:clamp(150px,30dvh,220px)!important;
          min-height:130px!important;
          min-width:130px!important;
        }
        body.xianxia-theme #page-training .refinery-material-list{max-height:230px!important}
      }
    `;
    document.head.appendChild(style);
  }

  function updateTrainingFillHeight() {
    const page = document.getElementById(PAGE_ID);
    if (!page || page.classList.contains('hidden')) return;
    const nav = document.getElementById(NAV_ID);
    const pageRect = page.getBoundingClientRect();
    if (!pageRect.height && !pageRect.top) return;

    const viewportBottom = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0;
    const navRect = nav && !nav.classList.contains('hidden') ? nav.getBoundingClientRect() : null;
    const navTop = navRect && navRect.top > pageRect.top ? navRect.top : viewportBottom;
    const safeGap = 8;
    const fillHeight = Math.max(280, Math.floor(navTop - pageRect.top - safeGap));

    const tabs = page.querySelector('.training-subtabs-v3');
    const tabsRect = tabs?.getBoundingClientRect();
    const contentTop = tabsRect ? Math.max(pageRect.top, tabsRect.bottom + 4) : pageRect.top;
    const contentHeight = Math.max(240, Math.floor(navTop - contentTop - safeGap));

    page.style.setProperty('--training-fill-height', `${fillHeight}px`);
    page.style.setProperty('--training-content-height', `${contentHeight}px`);
  }

  function scheduleMeasure() {
    updateTrainingFillHeight();
    requestAnimationFrame(updateTrainingFillHeight);
    setTimeout(updateTrainingFillHeight, 80);
  }

  function boot() {
    ensureStyle();
    scheduleMeasure();
    window.addEventListener('resize', scheduleMeasure, { passive:true });
    window.visualViewport?.addEventListener('resize', scheduleMeasure, { passive:true });
    window.addEventListener('orientationchange', scheduleMeasure, { passive:true });
    document.addEventListener('click', (event) => {
      if (event.target.closest?.('#nav-training,[data-training-tab],[data-target="page-training"]')) scheduleMeasure();
    }, true);
    new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.target?.id === PAGE_ID || mutation.target?.id === NAV_ID)) scheduleMeasure();
    }).observe(document.body, { subtree:true, attributes:true, attributeFilter:['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
