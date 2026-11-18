// These visible stages are cultivation presentation, not extra combat modifiers.
// Battle attack comes only from the server-derived sum of owned manual levels.
export function manualVisualState(book) {
  const supplied=Number(book?.level);
  const level=Number.isFinite(supplied)
    ?Math.min(20,Math.max(1,Math.trunc(supplied))):1;
  const stage=level>=20?'complete':level>=10?'refined':
    level>=8?'surge':level>=5?'inscribed':'seed';
  const descriptors={
    seed:{label:'初息',description:'靈息初聚，逐步打通招式脈絡',light:0.30},
    inscribed:{label:'凝紋',description:'靈紋凝成，靈息沿經脈流轉',light:0.55},
    surge:{label:'盛氣',description:'靈氣充盈，功法威勢更加鮮明',light:0.76},
    refined:{label:'大成',description:'三招等級門檻已達，可繼續淬鍊攻擊力',light:0.9},
    complete:{label:'圓滿',description:'功法修至 Lv.20，靈紋完整',light:1}
  };
  return {level,stage,...descriptors[stage]};
}

export function manualSkillVisualState(skill) {
  if(skill?.unlocked)return 'learned';
  if(skill?.mastered&&!skill?.realmReady)return 'realm-locked';
  return 'level-locked';
}

// The visible rail is the ORIGINAL skill-unlock route: Lv.1, 5 and 10.
// Power training continues independently through Lv.20; no new rail nodes
// appear at Lv.11–20, and the bar stays filled after the third skill milestone.
export function renderManualVisualMilestones(book,esc) {
  const {level,stage}=manualVisualState(book);
  const routeLevel=Math.min(10,level);
  const currentFraction=level>=10?1:
    Math.max(0,Math.min(1,(Number(book?.progress)||0)/100));
  const percentage=Math.max(0,Math.min(100,
    100*(level>=10?1:(level-1+currentFraction)/9)));
  const milestoneNames={1:'入門',5:'第二招等級門檻',10:'第三招等級門檻'};
  const marks=Array.from({length:10},(_,index)=>{
    const n=index+1,reached=n<=routeLevel,current=n===routeLevel;
    const milestone=Object.prototype.hasOwnProperty.call(milestoneNames,n);
    return `<span class="manual-growth-mark ${reached?'is-reached':'is-pending'} ${current?'is-current':''} ${milestone?'is-milestone':''} ${milestone?'is-milestone-'+n:''}"
      aria-hidden="true" title="功法 Lv. ${n}${milestone?' · '+milestoneNames[n]:''}">
      ${milestone?`<small>${n}</small>`:''}
    </span>`;
  }).join('');
  return `<div class="manual-growth-marks" data-manual-growth-stage="${stage}" role="progressbar"
      aria-label="${esc(book?.name||'功法')}三招修行里程碑：目前 Lv. ${level}。進度條僅涵蓋 Lv. 1 至 Lv. 10 的招式門檻，修煉可繼續提升；領悟仍需達到修士境界"
      aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(percentage)}">
      <span class="manual-growth-flow" aria-hidden="true">
        <span class="manual-growth-flow-fill" style="width:${percentage.toFixed(2)}%"></span>
      </span>
      ${marks}
    </div>`;
}
