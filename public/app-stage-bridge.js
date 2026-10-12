(function () {
  'use strict';
  // 直接開啟遊戲文件時也經過比例畫面；同源框架保留登入、剪貼簿與題面手勢。
  if (window.parent === window || window.frameElement?.id !== 'game-frame') {
    const url = new URL('stage.html',location.href);
    url.search = location.search; url.hash = location.hash;
    location.replace(url.href);
    return;
  }
  document.documentElement.classList.add('game-stage-content');
  const style = document.createElement('style');
  style.textContent = 'html.game-stage-content{width:100%;height:100%;overflow:hidden;background:#000;-webkit-text-size-adjust:100%;text-size-adjust:100%}html.game-stage-content>body{width:100%;height:100%;max-width:100%;max-height:100%}';
  document.head.appendChild(style);
  function title() {window.parent.document.title=document.title;}
  new MutationObserver(title).observe(document.querySelector('title'),{childList:true,subtree:true,characterData:true});
  title();
})();
