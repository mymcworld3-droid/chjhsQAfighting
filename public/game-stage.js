(function () {
  'use strict';
  const stage = document.getElementById('game-stage'), frame = document.getElementById('game-frame');
  const safeArea = document.getElementById('game-safe-area');
  let state, queued = 0;
  function sync() {
    const root = document.documentElement;
    const layoutWidth = Math.max(1, Number(root.clientWidth) || Number(window.innerWidth) || 1);
    const layoutHeight = Math.max(1, Number(root.clientHeight) || Number(window.innerHeight) || 1);
    const inset = getComputedStyle(safeArea);
    const safe = key => Math.max(0,parseFloat(inset[key])||0);
    const width = Math.max(1,layoutWidth-safe('paddingLeft')-safe('paddingRight'));
    const height = Math.max(1,layoutHeight-safe('paddingTop')-safe('paddingBottom'));
    // Fit the page layout; a keyboard or visual-viewport pan does not resize the game.
    const mode = layoutWidth >= layoutHeight ? 'landscape' : 'portrait';
    state = window.QAGameStageRules.fit({width,height,mode,
      left:safe('paddingLeft'),top:safe('paddingTop')});
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
  if (window.ResizeObserver) new ResizeObserver(schedule).observe(document.documentElement);
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
