// Shared numeric interpreters for the only visible quarter circle:
// the live trial wheel, not the retired dungeon-specific wheel layout.
export function dungeonEnergySegments(){
  return Array.from({length:10},(_,index)=>{
    const from=(-90+index*9+1.35)*Math.PI/180;
    const to=(-90+(index+1)*9-1.35)*Math.PI/180;
    const point=angle=>[(Math.cos(angle)*90).toFixed(3),
      (100+Math.sin(angle)*90).toFixed(3)];
    const a=point(from),b=point(to);
    return '<path data-dm-energy-segment="'+index+'" d="M '+a[0]+' '+a[1]+
      ' A 90 90 0 0 1 '+b[0]+' '+b[1]+'"></path>';
  }).join('');
}

// The skill costs and six-cast duration are server-owned. These helpers
// interpret a received room snapshot without adding any client-side power.
export function dungeonFocusCharges(member){
  return Number.isSafeInteger(member?.focusCharges)?
    Math.max(0,Math.min(6,member.focusCharges)):0;
}
export function dungeonFocusEmpowers(member,skill){
  return dungeonFocusCharges(member)>0&&
    skill?.school==='body'&&skill?.kind!=='fist-focus';
}

export function energyRingFill(stamina){
  const value=Number.isFinite(Number(stamina))?Number(stamina):0;
  return Math.max(0,Math.min(10,Math.floor(value)));
}
