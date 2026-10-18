// Nine golden-core identities, with three actual painted assets per identity.
(function (root,factory) {
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else {
    root.QAGoldenCoreArt=api;
    if(typeof document==='object'&&document.head&&!document.querySelector('link[data-golden-core-art-style]')){
      const link=document.createElement('link');link.rel='stylesheet';link.href='styles/golden-core-art.css';
      link.dataset.goldenCoreArtStyle='1';document.head.appendChild(link);
    }
  }
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const TYPES=Object.freeze(['ocean','taichu','ningxin','pojing','xingchen','wugou','thunder','reverse','sword']);
  const TIERS=Object.freeze(['low','mid','high']);
  const grade=value=>Math.min(9,Math.max(1,Math.floor(Number(value)||9)));
  const tier=value=>grade(value)<=3?'high':grade(value)<=6?'mid':'low';
  const source=(type,value)=>`assets/golden-cores/${TYPES.includes(type)?type:'taichu'}-${tier(value)}.webp`;
  const all=()=>TYPES.flatMap(type=>TIERS.map(level=>`assets/golden-cores/${type}-${level}.webp`));
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function markup(type,value,name='',className='golden-core-thumbnail'){
    return `<img class="${className}" src="${source(type,value)}" width="384" height="384" alt="${escape(name)}" decoding="async" draggable="false" style="width:100%;height:100%;object-fit:contain">`;
  }
  function update(stage,core){
    if(!stage||!core)return;
    stage.dataset.coreVisualGrade=String(grade(core.grade));
    stage.dataset.coreVisualType=TYPES.includes(core.type)?core.type:'taichu';
    const image=stage.querySelector('.golden-core-art');
    if(!image)return;
    const fallback=stage.querySelector('.golden-core-art-fallback');
    image.onload=()=>{image.hidden=false;if(fallback)fallback.hidden=true;};
    image.onerror=()=>{image.hidden=true;if(fallback)fallback.hidden=false;};
    const src=source(core.type,core.grade);
    if(core.name)image.alt=String(core.name);
    if(image.getAttribute('src')!==src){image.hidden=false;if(fallback)fallback.hidden=true;image.setAttribute('src',src);}
    else if(image.complete){if(image.naturalWidth>0)image.onload();else image.onerror();}
  }
  return Object.freeze({TYPES,TIERS,grade,tier,source,all,markup,update});
});
