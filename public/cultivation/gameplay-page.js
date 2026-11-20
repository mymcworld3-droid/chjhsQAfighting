// Dedicated bottom navigation destination for independent game modes.
// Training is dynamically replaced at several realm thresholds, so keep this
// button immediately to its right without assuming any single training module.
const NAV_ID='nav-gameplay';
function positionGameplayNav(){
  const nav=document.getElementById('nav-grid');
  if(!nav)return;
  let button=document.getElementById(NAV_ID);
  if(!button){
    button=document.createElement('button');
    button.id=NAV_ID;
    button.type='button';
    button.dataset.target='page-gameplay';
    button.className='nav-btn gameplay-nav-btn group flex-1 flex flex-col items-center justify-center h-full transition-all';
    button.innerHTML='<div class="relative p-1"><i class="fa-solid fa-dice-d20 text-lg" aria-hidden="true"></i></div>'+
      '<span class="text-[10px] mt-1">玩法</span>';
    button.setAttribute('aria-label','前往玩法');
    button.addEventListener('click',()=>window.switchToPage?.('page-gameplay'));
  }
  const training=nav.querySelector('#nav-training');
  const home=nav.querySelector('[data-target="page-home"]');
  const anchor=training||home;
  if(anchor&&button.previousElementSibling!==anchor){
    anchor.insertAdjacentElement('afterend',button);
  }else if(!anchor&&!button.isConnected){
    nav.append(button);
  }
}
function initializeGameplayNavigation(){
  positionGameplayNav();
  const nav=document.getElementById('nav-grid');
  if(nav&&typeof MutationObserver==='function'){
    // Avoid nested-observer loops: positionGameplayNav mutates only if the
    // immediate predecessor actually changed.
    new MutationObserver(positionGameplayNav).observe(nav,{childList:true});
  }
  for(const event of ['xiuxian:user-ready','xiuxian:training-access-updated',
    'foundation-training-stage-changed','golden-core-access-changed']){
    window.addEventListener(event,positionGameplayNav);
  }
}
if(document.readyState==='loading')
  document.addEventListener('DOMContentLoaded',initializeGameplayNavigation,{once:true});
else initializeGameplayNavigation();
