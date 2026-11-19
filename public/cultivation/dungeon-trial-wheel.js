import { dungeonEnergySegments } from './dungeon-quarter-controls.js';

// This is the same two-ring control geometry used by 問道試煉.
// Its actions are supplied by the dungeon view, never by the turn-based engine.
const ANGLES={upper:-112.5,lower:-157.5,center:-135};
const LANES={action:{inner:54,outer:70},detail:{inner:79,outer:95}};
const RADII={action:62,detail:87};
const deg=x=>x*Math.PI/180;
const polar=(angle,radius)=>[
  100+radius*Math.cos(deg(angle)),100+radius*Math.sin(deg(angle))
];
const xy=(angle,radius)=>polar(angle,radius).map(n=>n.toFixed(4)).join(' ');
export function dungeonWheelWedge(start,end,outer,inner){
  const points=[];
  for(let i=0;i<=12;i++)points.push(polar(start+(end-start)*i/12,outer));
  for(let i=12;i>=0;i--)points.push(polar(start+(end-start)*i/12,inner));
  return 'polygon('+points.map(p=>p.map(n=>n.toFixed(3)+'%').join(' ')).join(',')+')';
}
export function dungeonWheelAngle(index,count){
  return -90-90*(index+.5)/Math.max(1,count);
}
export function dungeonWheelIndex(angle,count){
  return Math.max(0,Math.min(count-1,
    Math.floor((-90-angle)*Math.max(1,count)/90)));
}
const sliceDegrees=count=>Math.min(38,90/Math.max(1,count)*.7);
const sliderPath=(count,outer,inner)=>{
  const half=sliceDegrees(count)/2;
  const first=ANGLES.upper+half,last=ANGLES.upper-half;
  return 'M '+xy(first,outer)+
    ' A '+outer+' '+outer+' 0 0 0 '+xy(last,outer)+
    ' L '+xy(last,inner)+
    ' A '+inner+' '+inner+' 0 0 1 '+xy(first,inner)+' Z';
};
const wheelLines='<svg class="tc-action-lines" viewBox="0 0 100 100" aria-hidden="true">'+
  '<path d="M 100 0 A 100 100 0 0 0 0 100"/>'+
  '<path d="M 100 26 A 74 74 0 0 0 26 100"/>'+
  '<path d="M 100 51 A 49 49 0 0 0 51 100"/>'+
  '<path class="tc-wheel-lane-guide" d="M 100 5 A 95 95 0 0 0 5 100"/>'+
  '<path class="tc-wheel-lane-guide" d="M 100 21 A 79 79 0 0 0 21 100"/>'+
  '<path class="tc-wheel-lane-guide" d="M 100 30 A 70 70 0 0 0 30 100"/>'+
  '<path class="tc-wheel-lane-guide" d="M 100 46 A 54 54 0 0 0 46 100"/></svg>';
const slider=kind=>'<svg class="tc-wheel-slider tc-wheel-slider-'+kind+
  '" viewBox="0 0 100 100" aria-hidden="true" focusable="false">'+
  '<g class="tc-wheel-slider-rotor"><path class="tc-wheel-slider-shape" d="'+
  sliderPath(kind==='action'?2:1,LANES[kind].outer,LANES[kind].inner)+
  '"></path></g></svg>';

// Same class names and DOM structure as the trial's wheel and green quarter.
// No end-turn wedge: dungeon is real-time, so the center remains empty.
export function dungeonTrialWheelHTML(){
  const segments=dungeonEnergySegments().replace(/data-dm-energy-segment=/g,
    'data-energy-segment="" data-dm-energy-segment=');
  return '<section class="tc-quarter tc-quarter-energy" data-dm-quarter-energy hidden aria-label="答題充能與體力">'+
    '<svg class="tc-energy-ring" viewBox="0 0 100 100" aria-hidden="true" focusable="false">'+
    '<path class="tc-energy-track" d="M 0 10 A 90 90 0 0 1 90 100"></path>'+
    segments+'</svg>'+
    '</section>'+
    '<section class="tc-quarter tc-quarter-action" data-dm-wheel hidden aria-label="選擇行動與技能">'+
    wheelLines+
    '<button type="button" class="tc-sector tc-sector-attack" data-dm="wheel-attack" data-wheel-action="attack-ring" aria-pressed="true" style="clip-path:'+
    dungeonWheelWedge(-90,-135,74,49)+'"><span>攻擊</span></button>'+
    '<button type="button" class="tc-sector tc-sector-move" data-dm="wheel-move" data-wheel-action="move" aria-pressed="false" style="clip-path:'+
    dungeonWheelWedge(-135,-180,74,49)+'"><span>移動</span></button>'+
    '<div class="tc-wheel-options" role="group" aria-label="選擇攻擊技能"></div>'+
    slider('action')+slider('detail')+
    '<span class="tc-wheel-marker tc-wheel-action-marker" aria-hidden="true">攻擊</span>'+
    '<span class="tc-wheel-marker tc-wheel-detail-marker" aria-hidden="true">功法</span></section>'+
    '<output class="dm-focus-indicator" data-dm-focus-indicator hidden aria-live="polite" aria-label="蓄勢剩餘次數"></output>'+
    '<button type="button" class="dm-loadout-toggle" data-dm="loadouts" aria-expanded="false" hidden>配置</button>'+
    '<div class="dm-trial-legacy-slots" hidden aria-hidden="true">'+
    '<div data-dm-strike-slot></div><div data-dm-move-slot></div>'+
    '<div data-dm-wheel-skills></div></div>';
}
const setMarker=(marker,angle,radius)=>{
  if(!marker)return;
  const [x,y]=polar(angle,radius);
  marker.style.left=x.toFixed(3)+'%';
  marker.style.top=y.toFixed(3)+'%';
};
const setSlider=(wheel,kind,count,angle)=>{
  const svg=wheel.querySelector('.tc-wheel-slider-'+kind);
  if(!svg)return;
  if(svg.dataset.optionCount!==String(count)){
    svg.dataset.optionCount=String(count);
    svg.querySelector('.tc-wheel-slider-shape')?.setAttribute('d',
      sliderPath(count,LANES[kind].outer,LANES[kind].inner));
  }
  const rotor=svg.querySelector('.tc-wheel-slider-rotor');
  if(rotor)rotor.style.transform='rotate('+
    (angle-ANGLES.upper).toFixed(3)+'deg)';
};
function wheelText(label,name,cost,art=''){
  if(!label)return;
  let copy=label.querySelector('.tc-wheel-copy');
  if(!copy){
    label.replaceChildren();
    copy=document.createElement('span');
    copy.className='tc-wheel-copy';
    const title=document.createElement('span');
    title.className='tc-wheel-name';
    const fee=document.createElement('small');
    fee.className='tc-wheel-cost';
    copy.append(title,fee);label.append(copy);
  }
  label.querySelector('.tc-wheel-name').textContent=String(name||'');
  label.querySelector('.tc-wheel-cost').textContent=String(cost||'');
  let image=label.querySelector('.tc-wheel-skill-art');
  if(art){
    if(!image){
      image=document.createElement('img');
      image.className='tc-wheel-skill-art';image.decoding='async';
      image.alt='';image.draggable=false;label.prepend(image);
    }
    if(image.getAttribute('src')!==art)image.src=art;
  }else image?.remove();
}
export function renderDungeonTrialWheel(wheel,{mode='attack',options=[],selected,
  locked=false,stamina=0,focusCharges=0}={}){
  if(!wheel)return;
  const attacking=mode!=='move';
  const choices=wheel.querySelector('.tc-wheel-options');
  const shown=attacking?(options.length?options:[{
    value:'basic',name:'普通攻擊',cost:2
  }]):[{value:'player',name:'玩家',cost:'1 體力/格'}];
  const key=shown.map(item=>item.value).join('|');
  const count=shown.length;
  if(choices.dataset.choices!==key){
    choices.dataset.choices=key;
    const sweep=90/count,gap=count>1?1:0;
    choices.replaceChildren(...shown.map((item,index)=>{
      const button=document.createElement('button');
      button.type='button';button.className='tc-sector';
      button.dataset.dm='wheel-choice';button.dataset.skillId=item.value;
      button.dataset.wheelChoice=item.value;
      button.style.clipPath=dungeonWheelWedge(
        -90-sweep*index-gap,-90-sweep*(index+1)+gap,100,74);
      const label=document.createElement('span');
      setMarker(label,dungeonWheelAngle(index,count),RADII.detail);
      button.append(label);
      return button;
    }));
  }
  const selection=shown.find(x=>x.value===selected)||shown[0];
  const chosenIndex=shown.indexOf(selection);
  choices.setAttribute('aria-label',attacking?'選擇攻擊技能':'移動目標');
  for(const [index,item]of shown.entries()){
    const button=choices.children[index];
    const price=typeof item.cost==='string'?item.cost:(item.cost+' 體力');
    const low=typeof item.cost==='number'&&item.cost>stamina;
    button.disabled=locked; // selecting a different skill never costs stamina
    button.setAttribute('aria-pressed',String(item.value===selection.value));
    button.classList.toggle('is-unavailable',!!low);
    button.classList.toggle('is-focus-empowered',!!item.empowered);
    button.setAttribute('aria-label',item.name+'，'+price+
      (low?'，體力不足':'')+(item.description?'。'+item.description:''));
    button.title=low?'體力不足，需要 '+item.cost+' 體力':
      item.name+' · '+price;
    wheelText(button.firstElementChild,item.name,price,item.art);
  }
  wheel.dataset.mode=mode;
  wheel.classList.toggle('has-focus',focusCharges>0);
  for(const name of ['attack','move']){
    wheel.querySelector('[data-dm="wheel-'+name+'"]')
      ?.setAttribute('aria-pressed',String(mode===name));
  }
  const actionAngle=attacking?ANGLES.upper:ANGLES.lower;
  const detailAngle=dungeonWheelAngle(chosenIndex,count);
  const actionMarker=wheel.querySelector('.tc-wheel-action-marker');
  const detailMarker=wheel.querySelector('.tc-wheel-detail-marker');
  actionMarker.textContent=attacking?'攻擊':'移動';
  const cost=typeof selection.cost==='string'?selection.cost:
    selection.cost+' 體力';
  wheelText(detailMarker,selection.name,cost,selection.art);
  detailMarker.classList.toggle('is-focus-empowered',!!selection.empowered);
  detailMarker.title=selection.name+' · '+cost;
  setMarker(actionMarker,actionAngle,RADII.action);
  setMarker(detailMarker,detailAngle,RADII.detail);
  setSlider(wheel,'action',2,actionAngle);
  setSlider(wheel,'detail',count,detailAngle);
  wheel.setAttribute('aria-label',attacking?
    '行動：攻擊，'+selection.name+'，'+cost:
    '行動：移動，目標：玩家，1 體力/格');
  return selection.value;
}
export function bindDungeonTrialWheel(wheel,{select,refresh,ignoreClick}={}){
  let pointer=null,dragClickUntil=0;
  const angle=e=>{
    const rect=wheel.getBoundingClientRect();
    return Math.max(-180,Math.min(-90,
      Math.atan2(e.clientY-rect.bottom,e.clientX-rect.right)*180/Math.PI));
  };
  const moveMarker=(kind,where)=>{
    const marker=wheel.querySelector('.tc-wheel-'+(kind==='detail'?
      'detail':'action')+'-marker');
    setMarker(marker,where,RADII[kind]);
    setSlider(wheel,kind,kind==='action'?2:
      Math.max(1,wheel.querySelectorAll('[data-wheel-choice]').length),where);
  };
  wheel.addEventListener('pointerdown',e=>{
    if(pointer)return;
    const button=e.target.closest('button[data-wheel-action],button[data-wheel-choice]');
    if(!button||button.disabled)return;
    pointer={id:e.pointerId,x:e.clientX,y:e.clientY,
      ring:button.dataset.wheelChoice?'detail':'action',moved:false};
  });
  wheel.addEventListener('pointermove',e=>{
    if(!pointer||pointer.id!==e.pointerId)return;
    if(Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>8){
      if(!pointer.moved){
        pointer.moved=true;
        try{wheel.setPointerCapture(e.pointerId)}catch(_){}
        wheel.querySelector('.tc-wheel-'+pointer.ring+'-marker')
          ?.classList.add('is-dragging');
        wheel.querySelector('.tc-wheel-slider-'+pointer.ring)
          ?.classList.add('is-dragging');
      }
      moveMarker(pointer.ring,angle(e));e.preventDefault();
    }
  });
  const end=e=>{
    if(!pointer||pointer.id!==e.pointerId)return;
    const gesture=pointer;pointer=null;
    wheel.querySelector('.tc-wheel-'+gesture.ring+'-marker')
      ?.classList.remove('is-dragging');
    wheel.querySelector('.tc-wheel-slider-'+gesture.ring)
      ?.classList.remove('is-dragging');
    try{if(wheel.hasPointerCapture?.(e.pointerId))
      wheel.releasePointerCapture(e.pointerId)}catch(_){}
    if(e.type==='pointercancel'){refresh?.();return;}
    if(!gesture.moved)return;
    ignoreClick?.();dragClickUntil=Date.now()+350;
    const selected=gesture.ring==='action'?
      (angle(e)>ANGLES.center?'attack':'move'):
      [...wheel.querySelectorAll('[data-wheel-choice]')]
        [dungeonWheelIndex(angle(e),
          wheel.querySelectorAll('[data-wheel-choice]').length)]?.dataset.wheelChoice;
    if(selected)select?.(selected);
    refresh?.();
  };
  wheel.addEventListener('pointerup',end);
  wheel.addEventListener('pointercancel',end);
  wheel.addEventListener('lostpointercapture',e=>{
    if(pointer?.id!==e.pointerId)return;
    pointer=null;
    for(const el of wheel.querySelectorAll('.is-dragging'))
      el.classList.remove('is-dragging');
    refresh?.();
  });
  // Native full-quarter clipped buttons share overlapping DOM rectangles.
  // If a browser dispatches a tap to the inner "move" button while its
  // *coordinates* lie on the outer skill ring, honor the ring that was
  // physically touched. This prevents an intended 四步連推 cast from
  // silently becoming a one-cell move. The server still validates every cast.
  wheel.addEventListener('click',event=>{
    if(Date.now()<dragClickUntil)return;
    if(wheel.dataset.mode!=='attack')return;
    const rect=wheel.getBoundingClientRect(),size=Math.min(rect.width,rect.height);
    if(!size)return;
    const dx=event.clientX-rect.right,dy=event.clientY-rect.bottom;
    if(dx>0||dy>0)return;
    const radius=Math.hypot(dx,dy)/size;
    if(radius<.745||radius>1.01)return;
    const buttons=[...wheel.querySelectorAll('[data-wheel-choice]')];
    if(!buttons.length)return;
    const chosen=buttons[dungeonWheelIndex(angle(event),buttons.length)];
    if(!chosen||chosen.disabled)return;
    event.preventDefault();event.stopPropagation();
    select?.(chosen.dataset.wheelChoice);
    refresh?.();
  });
  wheel.addEventListener('keydown',e=>{
    const button=e.target.closest('button[data-wheel-action],button[data-wheel-choice]');
    if(!button||!['ArrowLeft','ArrowRight'].includes(e.key))return;
    e.preventDefault();
    const upper=e.key==='ArrowRight';
    if(button.dataset.wheelAction){
      const next=upper?'attack':'move';
      select?.(next);
      wheel.querySelector('[data-dm="wheel-'+next+'"]')?.focus();
    }else{
      const buttons=[...wheel.querySelectorAll('[data-wheel-choice]')];
      const index=Math.max(0,Math.min(buttons.length-1,
        buttons.indexOf(button)+(upper?-1:1)));
      const next=buttons[index];
      if(next){select?.(next.dataset.wheelChoice);next.focus();}
    }
  });
}
