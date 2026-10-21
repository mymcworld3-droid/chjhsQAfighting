// Purely visual: reads settled effect kinds and never changes battle state or damage.
let serial=0;
const NS='http://www.w3.org/2000/svg';
const KINDS=new Set(['vital-orb','triple-beam','meteor']);
const shakes=new WeakMap();
export function specialImpactKind(step={}) {
  if(step.guarded || !(Number(step.damage)>0))return '';
  if(KINDS.has(step.innateEffect))return step.innateEffect;
  if(['ocean','sword'].includes(step.coreEffect?.type))return step.coreEffect.type;
  const skill=String(step.skill||'');
  if(/星隕|隕石|三星聚曜/.test(skill))return 'meteor';
  if(/滄潮|滄溟|百川|巨浪|大海/.test(skill))return 'ocean';
  if(/劍心|劍氣|御劍|萬劍|劍意/.test(skill))return 'sword';
  return '';
}
export function shakeBattleScreen(surface,{kind,elapsedMs=0,delayMs=0}={}) {
  if(!surface?.animate || !['ocean','sword','vital-orb','triple-beam','meteor'].includes(kind) ||
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)return null;
  const age=Math.max(0,Number(elapsedMs)||0);if(age>=340)return null;
  shakes.get(surface)?.cancel();
  const force=kind==='meteor'?9:kind==='triple-beam'||kind==='ocean'?7:5;
  const animation=surface.animate([0,-1,1,-.75,.65,-.4,.25,0].map((v,i)=>({
    transform:`translate(${v*force}px,${(i%2?-.45:.45)*Math.abs(v)*force}px)`
  })),{duration:340,delay:Math.max(0,delayMs),easing:'linear',composite:'add'});
  animation.currentTime=age;shakes.set(surface,animation);
  const release=()=>{if(shakes.get(surface)===animation)shakes.delete(surface);};
  animation.finished?.then(release,release);
  return animation;
}
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
  if(kind==='meteor') {
    const rock=node('g',{class:'ia-meteor'});
    node('path',{d:`M${-size*2.8},${-size*.8} Q${-size},0 ${-size*2.8},${size*.8} L${size*.5},0 Z`,fill:'#ff6c32'},rock);
    node('path',{d:`M${-size*2.1},${-size*.3} L${size*.4},0 L${-size*2.1},${size*.3} Z`,fill:'#ffdb7a'},rock);
    node('circle',{cx:0,cy:0,r:size*.50,fill:'#a44329',stroke:'#ffd39c','stroke-width':3},rock);
    node('path',{d:`M${-size*.3},0 L0,${-size*.3} L${size*.25},0 L0,${size*.25} Z`,fill:'#ffbd60'},rock);
    rock.style.filter='drop-shadow(0 0 8px #ff8c40)';
    const startX=Math.min(rect.width-size,tx+size*3),startY=Math.max(size,ty-size*5);
    const rotation=Math.atan2(ty-startY,tx-startX)*180/Math.PI;
    motion(rock,reduced?[{opacity:0,transform:`translate(${tx}px,${ty}px)`,offset:0},
      {opacity:1,transform:`translate(${tx}px,${ty}px)`,offset:.45},{opacity:0,transform:`translate(${tx}px,${ty}px)`,offset:1}]:[{opacity:0,transform:`translate(${startX}px,${startY}px) rotate(${rotation}deg)`,offset:0},
      {opacity:1,transform:`translate(${startX}px,${startY}px) rotate(${rotation}deg)`,offset:.06},
      {opacity:1,transform:`translate(${tx}px,${ty}px) rotate(${rotation}deg)`,offset:.45},
      {opacity:0,transform:`translate(${tx}px,${ty}px) rotate(${rotation}deg)`,offset:.58},{opacity:0,offset:1}]);
  } else if(kind==='vital-orb') {
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
