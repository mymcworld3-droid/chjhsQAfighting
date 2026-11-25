/* U01/U02: presentation adapter for the existing live navigation rail.
   Routing, guards, modal actions and visibility remain owned by their modules. */
(function(root){
  'use strict';
  function syncRail(grid){
    if(!grid)return;
    for(const button of grid.children){
      if(button.tagName!=='BUTTON'||!button.dataset.target)continue;
      const hidden=button.hidden||button.classList.contains('hidden')||button.getAttribute('aria-hidden')==='true';
      const current=!hidden&&button.classList.contains('active-nav-btn');
      if(current){if(button.getAttribute('aria-current')!=='page')button.setAttribute('aria-current','page');}
      else if(button.hasAttribute('aria-current'))button.removeAttribute('aria-current');
    }
  }
  let initialized=false;
  function init(){
    const doc=root.document,grid=doc?.getElementById('nav-grid');
    if(!grid||initialized)return;
    initialized=true;syncRail(grid);
    if(typeof root.MutationObserver==='function'){
      new root.MutationObserver(()=>syncRail(grid)).observe(grid,{
        childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden','aria-hidden','data-target']
      });
    }
  }
  if(typeof module==='object'&&module.exports)module.exports={syncRail};
  if(root.document){
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',init,{once:true});
    else init();
  }
})(globalThis);
