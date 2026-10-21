// Purely visual: reads settled effect kinds and never changes battle state or damage.
let serial=0;
const NS='http://www.w3.org/2000/svg';
const KINDS=new Set(['vital-orb','triple-beam']);
export function createInnateAbilityEffect(stage,{kind,source,target,elapsedMs=0,durationMs=1450}={}) {
  if(!stage || !source || !target || !KINDS.has(kind))return null;
  const duration=Math.max(300,Number(durationMs)||1450),elapsed=Math.max(0,Number(elapsedMs)||0);
  if(elapsed>=duration)return null;
  const rect=stage.getBoundingClientRect(),a=source.getBoundingClientRect(),b=target.getBoundingClientRect();
  if(!rect.width || !rect.height)return null;
  // SVG coordinates follow the real portrait centers in either screen orientation.
  const sx=a.left+a.width/2-rect.left,sy=a.top+a.height/2-rect.top;
  const tx=b.left+b.width/2-rect.left,ty=b.top+b.height/2-rect.top;
  const distance=Math.hypot(tx-sx,ty-sy),angle=Math.atan2(ty-sy,tx-sx)*180/Math.PI;
  if(distance<1)return null;
  const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true;
  const effect=document.createElementNS(NS,'svg');
  effect.setAttribute('class','ia-ability-effect');effect.setAttribute('aria-hidden','true');
  effect.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);
  effect.setAttribute('preserveAspectRatio','none');effect.dataset.kind=kind;
  Object.assign(effect.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'8',overflow:'hidden'});
  const node=(tag,attrs,parent=effect)=>{
    const el=document.createElementNS(NS,tag);
    for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));
    parent.appendChild(el);return el;
  };
  const animations=[];
  const motion=(el,frames)=>{
    if(typeof el.animate!=='function')return;
    const animation=el.animate(frames,{duration,fill:'both',easing:'linear'});
    animation.currentTime=elapsed;animations.push(animation);
  };
  const axis=node('g',{transform:`translate(${sx} ${sy}) rotate(${angle})`});
  const color=kind==='vital-orb'?'#78ffb2':'#ff6338';
  axis.style.filter=`drop-shadow(0 0 5px ${color})`;
  const size=Math.max(16,Math.min(36,rect.height*.055));
  const hit=node('circle',{cx:distance,cy:0,r:size*.9,fill:'none',stroke:color,'stroke-width':3},axis);
  motion(hit,[{opacity:0,offset:0},{opacity:0,offset:.44},{opacity:1,offset:.46},
    {opacity:0,transform:reduced?'none':'scale(1.5)',transformOrigin:`${distance}px 0px`,offset:.8},{opacity:0,offset:1}]);
  if(kind==='vital-orb') {
    const start=distance*.1,id='ia-vital-'+(++serial),defs=node('defs',{});
    const gradient=node('radialGradient',{id},defs);
    node('stop',{offset:'0%','stop-color':'#ffffff'},gradient);
    node('stop',{offset:'35%','stop-color':'#c7ffd8'},gradient);
    node('stop',{offset:'72%','stop-color':color},gradient);
    node('stop',{offset:'100%','stop-color':'#238a55','stop-opacity':0},gradient);
    // Wisps converge from around the caster before the single energy orb is fired.
    if(!reduced)for(let i=0;i<10;i++) {
      const theta=i*Math.PI*2/10,radius=size*(1.3+(i%3)*.3);
      const particle=node('circle',{cx:0,cy:0,r:2.5,fill:color,class:'ia-vital-wisp'},axis);
      motion(particle,[{opacity:0,transform:`translate(${Math.cos(theta)*radius}px,${Math.sin(theta)*radius}px)`,offset:0},
        {opacity:.9,transform:`translate(${Math.cos(theta)*radius}px,${Math.sin(theta)*radius}px)`,offset:.07+i*.009},
        {opacity:0,transform:`translate(${start}px,0px)`,offset:.28+i*.006},{opacity:0,offset:1}]);
    }
    const orb=node('circle',{cx:0,cy:0,r:size*.58,fill:`url(#${id})`,class:'ia-vital-orb'},axis);
    motion(orb,reduced?[{opacity:0,transform:`translate(${distance}px,0px)`,offset:0},{opacity:1,transform:`translate(${distance}px,0px)`,offset:.45},{opacity:0,transform:`translate(${distance}px,0px)`,offset:1}]:[
      {opacity:0,transform:`translate(${start}px,0px) scale(.15)`,offset:0},
      {opacity:1,transform:`translate(${start}px,0px) scale(1)`,offset:.30},
      {opacity:1,transform:`translate(${start}px,0px) scale(1.1)`,offset:.35},
      {opacity:1,transform:`translate(${distance}px,0px) scale(.9)`,offset:.45},
      {opacity:0,transform:`translate(${distance}px,0px) scale(1.8)`,offset:.58},{opacity:0,offset:1}]);
  } else {
    for(let i=0;i<3;i++) {
      const x=distance*(.18+i*.105),h=size*(1+i*.13),w=h*.48;
      const hex=node('polygon',{points:`${x},${-h} ${x+w},${-h/2} ${x+w},${h/2} ${x},${h} ${x-w},${h/2} ${x-w},${-h/2}`,
        fill:'#f0441820',stroke:color,'stroke-width':2.5,class:'ia-fire-hexagon'},axis);
      motion(hex,[{opacity:0,offset:0},{opacity:0,offset:.03+i*.055},{opacity:1,offset:.12+i*.055},
        {opacity:1,offset:.53},{opacity:0,offset:.85},{opacity:0,offset:1}]);
    }
    const origin=distance*.13,length=distance-origin;
    for(const [width,tint] of [[size*.60,'#f43c22'],[size*.30,'#ffab58'],[size*.09,'#fff7d3']]) {
      const beam=node('line',{x1:origin,y1:0,x2:distance,y2:0,stroke:tint,'stroke-width':width,'stroke-linecap':'round',
        'stroke-dasharray':length,'stroke-dashoffset':length,class:'ia-fire-beam'},axis);
      motion(beam,[{opacity:0,strokeDasharray:`${length}`,strokeDashoffset:`${length}`,offset:0},
        {opacity:0,strokeDashoffset:`${length}`,offset:.32},
        {opacity:1,strokeDashoffset:reduced?`${length}`:'0',offset:.45},
        {opacity:1,strokeDashoffset:'0',offset:.55},{opacity:0,strokeDashoffset:'0',offset:.78},{opacity:0,offset:1}]);
    }
    const charge=node('circle',{cx:origin,cy:0,r:size*.32,fill:'#fff1bd',class:'ia-beam-charge'},axis);
    motion(charge,[{opacity:0,offset:0},{opacity:1,offset:.30},{opacity:1,offset:.44},{opacity:0,offset:.60},{opacity:0,offset:1}]);
  }
  stage.appendChild(effect);
  let timer;
  effect.dispose=()=>{clearTimeout(timer);for(const animation of animations)animation.cancel();effect.remove();};
  timer=setTimeout(()=>effect.dispose(),duration-elapsed+30);
  return effect;
}
