(function (root) {
  'use strict';
  const layouts = Object.freeze({
    landscape:Object.freeze({width:1280,height:720}),
    portrait:Object.freeze({width:360,height:640})
  });
  function fit({width,height,left=0,top=0,mode}={}) {
    width = Math.max(1,Number(width)||1); height = Math.max(1,Number(height)||1);
    mode = Object.hasOwn(layouts,mode) ? mode : width >= height ? 'landscape' : 'portrait';
    const design = layouts[mode];
    const scale = Math.min(width/design.width,height/design.height);
    const fittedWidth = design.width*scale, fittedHeight = design.height*scale;
    return {mode,ratio:design.width/design.height,designWidth:design.width,designHeight:design.height,
      scale,width:fittedWidth,height:fittedHeight,left:left+(width-fittedWidth)/2,top:top+(height-fittedHeight)/2};
  }
  const api = Object.freeze({layouts,fit});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QAGameStageRules = api;
})(globalThis);
