// Pure presentation tiers for the stamina cultivation screen.
// These four labels are cosmetic, NOT player realms, combat buffs, or unlocks.
// The server's manual.level / skill.unlocked flags remain authoritative.
export function manualVisualState(book) {
  const supplied=Number(book?.level);
  const level=Number.isFinite(supplied)
    ?Math.min(10,Math.max(1,Math.trunc(supplied))):1;
  const stage=level===10?'complete':level>=8?'surge':level>=5?'inscribed':'seed';
  const descriptors={
    seed:{label:'初息',description:'靈息初聚，逐步打通招式脈絡',light:0.30},
    inscribed:{label:'凝紋',description:'靈紋凝成，功法氣象漸顯',light:0.55},
    surge:{label:'盛氣',description:'靈氣充盈，功法威勢更加鮮明',light:0.76},
    complete:{label:'圓滿',description:'功法修至最高等級，靈紋完整',light:1}
  };
  return {level,stage,...descriptors[stage]};
}

export function manualSkillVisualState(skill) {
  // Lv. 5 / Lv. 10 are mastery thresholds, not unconditional unlocks.
  if(skill?.unlocked)return 'learned';
  if(skill?.mastered&&!skill?.realmReady)return 'realm-locked';
  return 'level-locked';
}

export function renderManualVisualMilestones(book,esc) {
  const {level,stage,label,description}=manualVisualState(book);
  const anchors=new Map([[1,'入門'],[5,'第二招門檻'],[10,'第三招門檻']]);
  const marks=Array.from({length:10},(_,index)=>{
    const n=index+1,passed=n<=level,current=n===level,anchor=anchors.get(n);
    return `<span class="manual-growth-mark ${passed?'is-reached':'is-pending'} ${current?'is-current':''} ${anchor?'is-milestone':''}"
      aria-hidden="true" title="功法 Lv. ${n}${anchor?' · '+anchor:''}">
      ${anchor?`<small>${n}</small>`:''}
    </span>`;
  }).join('');
  return `<div class="manual-growth" data-manual-growth-stage="${stage}">
    <div class="manual-growth-header">
      <span class="manual-growth-heading">功法氣象 <strong>${esc(label)}</strong></span>
      <span class="manual-growth-level">Lv. ${level} / 10</span>
    </div>
    <div class="manual-growth-marks" role="img" aria-label="功法等級 ${level} / 10。第一、五、十級為功法成長節點；技能仍需符合修士境界才解鎖。">
      ${marks}
    </div>
    <div class="manual-growth-footnote">
      <span>${esc(description)}</span>
      <small>氣象為視覺成長，不增加額外戰力</small>
    </div>
  </div>`;
}
