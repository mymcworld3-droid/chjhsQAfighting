(function () {
  'use strict';
  const stage = document.getElementById('game-stage'), frame = document.getElementById('game-frame');
  const safeArea = document.getElementById('game-safe-area');
  let state, queued = 0;
  function sync() {
    const vv = window.visualViewport;
    const layoutWidth = window.innerWidth, layoutHeight = window.innerHeight;
    const inset = getComputedStyle(safeArea);
    const safe = key => Math.max(0,parseFloat(inset[key])||0);
    const width = Math.max(1,(vv?.width||layoutWidth)-safe('paddingLeft')-safe('paddingRight'));
    const height = Math.max(1,(vv?.height||layoutHeight)-safe('paddingTop')-safe('paddingBottom'));
    // 軟鍵盤縮短可見高度時維持原本直／橫式，僅縮小整個畫面。
    const keyboard = state && vv && vv.height < layoutHeight*.75 &&
      frame.contentDocument?.activeElement?.matches('input,textarea,[contenteditable="true"]');
    const mode = keyboard ? state.mode : layoutWidth >= layoutHeight ? 'landscape' : 'portrait';
    state = window.QAGameStageRules.fit({width,height,mode,
      left:(vv?.offsetLeft||0)+safe('paddingLeft'),top:(vv?.offsetTop||0)+safe('paddingTop')});
    const values = {'--stage-left':state.left+'px','--stage-top':state.top+'px',
      '--stage-width':state.width+'px','--stage-height':state.height+'px',
      '--stage-design-width':state.designWidth+'px','--stage-design-height':state.designHeight+'px',
      '--stage-scale':String(state.scale)};
    for (const [key,value] of Object.entries(values)) {
      if (stage.style.getPropertyValue(key)!==value) stage.style.setProperty(key,value);
    }
    stage.dataset.mode = state.mode;
  }
  function schedule() {
    if (queued) return;
    queued = requestAnimationFrame(() => { queued = 0; sync(); });
  }
  window.QAGameStage = Object.freeze({getState:() => ({...state}),sync});
  sync();
  const url = new URL('app.html',location.href);
  url.search = location.search; url.hash = location.hash;
  frame.src = url.href;
  window.addEventListener('resize',schedule,{passive:true});
  window.addEventListener('orientationchange',schedule,{passive:true});
  window.addEventListener('pageshow',schedule);
  window.visualViewport?.addEventListener('resize',schedule,{passive:true});
  window.visualViewport?.addEventListener('scroll',schedule,{passive:true});
  // 黑邊不接受頁面縮放；題面手勢由遊戲內的縮放政策處理。
  document.addEventListener('wheel',event => {if(event.ctrlKey||event.metaKey)event.preventDefault();},{passive:false});
  for (const type of ['touchstart','touchmove']) {
    document.addEventListener(type,event => {if(event.touches.length>1)event.preventDefault();},{passive:false,capture:true});
  }
  for (const type of ['gesturestart','gesturechange','gestureend']) {
    document.addEventListener(type,event => event.preventDefault(),{passive:false});
  }
  document.addEventListener('keydown',event => {
    if ((event.ctrlKey||event.metaKey)&&['0','+','=','-','_','Add','Subtract'].includes(event.key)) event.preventDefault();
  });
})();
