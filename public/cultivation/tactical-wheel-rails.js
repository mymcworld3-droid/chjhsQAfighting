// Keep storage slots intact when empty weapons disappear from the visible rail.
export function weaponRailOptions(weaponIds,books){
  const weapons=weaponIds.flatMap((id,slot)=>id?[{
    value:'weapon:'+slot,slot,name:books[id]?.name||id
  }]:[]);
  return [{value:'move',name:'移動'},
    ...(weapons.length?weapons:[{value:'attack',name:'攻擊'}])];
}
// Both right-hand rails run from the bottom station to the top station.
export const RAIL_LANES=Object.freeze({
  outer:Object.freeze({inner:77.5,outer:97.5}),
  inner:Object.freeze({inner:51.5,outer:71.5})
});
export function railAngle(index,count){return -180+90*(index+.5)/Math.max(1,count);}
export function railIndex(angle,count){
  return Math.max(0,Math.min(count-1,Math.floor((angle+180)*count/90)));
}
export function railSlicePath(kind,count){
  const {inner,outer}=RAIL_LANES[kind];
  const half=Math.min(38,90/Math.max(1,count)*.82)/2;
  const point=(angle,radius)=>{
    const rad=angle*Math.PI/180;
    return (100+radius*Math.cos(rad)).toFixed(4)+' '+(100+radius*Math.sin(rad)).toFixed(4);
  };
  return 'M '+point(-135-half,outer)+' A '+outer+' '+outer+' 0 0 1 '+point(-135+half,outer)+
    ' L '+point(-135+half,inner)+' A '+inner+' '+inner+' 0 0 0 '+point(-135-half,inner)+' Z';
}
export function syncRail(slider,index,count){
  slider.toggleAttribute('hidden',index<0||!count);
  if(slider.dataset.count!==String(count)){
    slider.querySelector('path').setAttribute('d',railSlicePath(slider.dataset.rail,count));
    slider.dataset.count=String(count);
  }
  if(!slider.classList.contains('is-dragging')){
    slider.querySelector('g').style.transform='rotate('+(railAngle(index,count)+135)+'deg)';
  }
}

// Hit sectors stay clipped to their own rail. Their readable labels live in a
// separate, non-interactive layer so small screens cannot clip Chinese glyphs.
export function syncRailLabels(wheel,kind){
  let layer=wheel.querySelector('[data-rail-labels="'+kind+'"]');
  if(!layer){
    layer=document.createElement('div');
    layer.className='tc-rw-label-layer tc-rw-sector--'+kind;
    layer.dataset.railLabels=kind;layer.setAttribute('aria-hidden','true');
    wheel.append(layer);
  }
  const buttons=[...wheel.querySelectorAll('.tc-rw-'+kind+' > button')];
  while(layer.childElementCount>buttons.length)layer.lastElementChild.remove();
  buttons.forEach((button,index)=>{
    const source=button.querySelector('.tc-rw-sector-label');
    let label=layer.children[index];
    if(!label){label=source.cloneNode(true);layer.append(label);}
    if(label.innerHTML!==source.innerHTML)label.innerHTML=source.innerHTML;
    label.style.cssText=source.style.cssText;
    label.classList.toggle('is-selected',button.getAttribute('aria-pressed')==='true');
    label.classList.toggle('is-disabled',button.disabled);
    label.classList.toggle('is-unavailable',button.classList.contains('is-unavailable'));
  });
}

export function installWheelRails(wheel,{select,restore,isLocked,suppressClick}){
  let pointer=null;
  const groupFor=button=>button.closest('.tc-rw-outer,.tc-rw-inner');
  const buttonsFor=group=>[...group.querySelectorAll('button.tc-rw-sector')];
  const valueFor=button=>button.dataset.weaponChoice!==undefined?
    'weapon:'+button.dataset.weaponChoice:button.dataset.wheelChoice||button.dataset.wheelAction||button.dataset.skillId;
  const finish=(event,cancel=false)=>{
    if(!pointer||pointer.id!==event.pointerId)return;
    const gesture=pointer;pointer=null;
    gesture.slider.classList.remove('is-dragging');
    wheel.classList.remove('is-dragging');
    if(wheel.hasPointerCapture?.(event.pointerId))wheel.releasePointerCapture(event.pointerId);
    if(gesture.moved){
      suppressClick();
      const buttons=buttonsFor(gesture.group);
      const button=buttons[railIndex(gesture.angle,buttons.length)];
      // A poll, loadout edit or disappearing flying sword can replace a lane
      // during a gesture. Never select an option from the previous lane.
      if(!cancel&&!isLocked()&&gesture.start.isConnected&&button&&!button.disabled)
        select(valueFor(button));
    }
    restore();
  };
  wheel.addEventListener('pointerdown',event=>{
    if(pointer||isLocked()||event.isPrimary===false||event.button!==0)return;
    const button=event.target.closest('button.tc-rw-sector');
    if(!button||button.disabled)return;
    const group=groupFor(button),kind=group.classList.contains('tc-rw-outer')?'outer':'inner';
    pointer={id:event.pointerId,x:event.clientX,y:event.clientY,start:button,group,
      slider:wheel.querySelector('[data-rail="'+kind+'"]'),moved:false,angle:0};
  });
  wheel.addEventListener('pointermove',event=>{
    if(!pointer||pointer.id!==event.pointerId)return;
    if(isLocked()||!pointer.start.isConnected){finish(event,true);return;}
    if(!pointer.moved&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)<7)return;
    if(!pointer.moved){
      pointer.moved=true;
      try{wheel.setPointerCapture(event.pointerId);}catch(_){}
      pointer.slider.classList.add('is-dragging');wheel.classList.add('is-dragging');
    }
    const bounds=wheel.getBoundingClientRect(),count=buttonsFor(pointer.group).length;
    const angle=Math.atan2(event.clientY-bounds.bottom,event.clientX-bounds.right)*180/Math.PI;
    pointer.angle=Math.max(railAngle(0,count),Math.min(railAngle(count-1,count),angle));
    pointer.slider.querySelector('g').style.transform='rotate('+(pointer.angle+135)+'deg)';
    event.preventDefault();
  });
  wheel.addEventListener('pointerup',event=>finish(event));
  wheel.addEventListener('pointercancel',event=>finish(event,true));
  wheel.addEventListener('lostpointercapture',event=>finish(event,true));
  wheel.addEventListener('keydown',event=>{
    const direction={ArrowUp:1,ArrowRight:1,ArrowDown:-1,ArrowLeft:-1}[event.key];
    if(!direction&&!['Home','End'].includes(event.key))return;
    const button=event.target.closest('button.tc-rw-sector');
    if(!button||button.disabled||isLocked())return;
    const buttons=buttonsFor(groupFor(button)).filter(item=>!item.disabled);
    let index=buttons.indexOf(button);
    index=event.key==='Home'?0:event.key==='End'?buttons.length-1:
      Math.max(0,Math.min(buttons.length-1,index+direction));
    event.preventDefault();event.stopPropagation();
    select(valueFor(buttons[index]));buttons[index].focus({preventScroll:true});
  });
}
