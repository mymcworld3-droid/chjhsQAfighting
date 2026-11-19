// Trial-style presentation for the real-time dungeon. No game rules live here.
// Existing quiz, strike and movement controls are MOVED into these slots,
// avoiding duplicate handlers and retaining server-authoritative actions.
export function dungeonEnergySegments(){
  return Array.from({length:10},(_,index)=>{
    const from=(-90+index*9+1)*Math.PI/180;
    const to=(-90+(index+1)*9-1)*Math.PI/180;
    const point=angle=>[(Math.cos(angle)*91).toFixed(2),
      (100+Math.sin(angle)*91).toFixed(2)];
    const a=point(from),b=point(to);
    return '<path data-dm-energy-segment="'+index+'" d="M '+a[0]+' '+a[1]+
      ' A 91 91 0 0 1 '+b[0]+' '+b[1]+'"></path>';
  }).join('');
}

export function dungeonQuarterControlsHTML(){
  return '<div class="dm-quarter dm-quarter-energy" data-dm-quarter-energy hidden aria-label="體力與答題充能">'+
    '<svg class="dm-energy-ring" viewBox="0 0 100 100" aria-hidden="true">'+
    '<path class="dm-energy-track" d="M 0 9 A 91 91 0 0 1 91 100"></path>'+
    dungeonEnergySegments()+'</svg>'+
    '<div class="dm-charge-core" data-dm-charge-slot></div></div>'+
    '<div class="dm-quarter dm-quarter-action" data-dm-wheel hidden aria-label="副本行動圓盤">'+
    '<div class="dm-wheel-tabs" role="group" aria-label="滑動或點選移動和攻擊">'+
    '<button type="button" data-dm="wheel-attack" aria-pressed="true"><span>攻擊</span></button>'+
    '<button type="button" data-dm="wheel-move" aria-pressed="false"><span>移動</span></button></div>'+
    '<div class="dm-wheel-core dm-wheel-core-attack" data-dm-wheel-attack>'+
    '<div class="dm-wheel-strike-slot" data-dm-strike-slot></div>'+
    '<div class="dm-wheel-skills" data-dm-wheel-skills></div></div>'+
    '<div class="dm-wheel-core dm-wheel-core-move" data-dm-wheel-move hidden>'+
    '<div data-dm-move-slot></div></div>'+
    '<span class="dm-wheel-select-arc" aria-hidden="true"></span></div>'+
    '<output class="dm-focus-indicator" data-dm-focus-indicator hidden aria-live="polite" aria-label="蓄勢剩餘次數">✦ 蓄勢 6/6</output>'+
    '<button type="button" class="dm-loadout-toggle" data-dm="loadouts" aria-expanded="false" hidden>切換配置</button>';
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
