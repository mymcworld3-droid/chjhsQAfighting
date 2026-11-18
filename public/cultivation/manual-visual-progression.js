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
    inscribed:{label:'凝紋',description:'靈紋凝成，靈息沿經脈流轉',light:0.55},
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

// Single integrated mastery rail: 10 stations, three raised round acupoints.
// The continuous fill reflects authoritative current-level EXP.
export function renderManualVisualMilestones(book,esc) {
  const {level,stage}=manualVisualState(book);
  const currentFraction=level>=10?1:Math.max(0,Math.min(1,(Number(book?.progress)||0)/100));
  const fraction=level>=10?1:(level-1+currentFraction)/9;
  const percentage=Math.max(0,Math.min(100,fraction*100));
  const milestoneNames={1:'入門',5:'第二招等級門檻',10:'第三招等級門檻'};
  const marks=Array.from({length:10},(_,index)=>{
    const n=index+1,reached=n<=level,current=n===level;
    const milestone=Object.prototype.hasOwnProperty.call(milestoneNames,n);
    return `<span class="manual-growth-mark ${reached?'is-reached':'is-pending'} ${current?'is-current':''} ${milestone?'is-milestone':''}"
        aria-hidden="true" title="功法 Lv. ${n}${milestone?' · '+milestoneNames[n]:''}">
        ${milestone?`<small>${n}</small>`:''}
      </span>`;
  }).join('');
  return `<div class="manual-growth-marks" data-manual-growth-stage="${stage}" role="progressbar"
      aria-label="${esc(book?.name||'功法')}整體熟練度：Lv. ${level} / 10。Lv. 5 與 Lv. 10 為招式等級門檻，領悟仍需達到修士境界"
      aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(percentage)}">
      <span class="manual-growth-flow" aria-hidden="true">
        <span class="manual-growth-flow-fill" style="width:${percentage.toFixed(2)}%"></span>
      </span>
      ${marks}
    </div>`;
}
