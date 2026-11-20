// Read-only next-skill milestones. Lv.5/Lv.10 is NOT proof that a technique unlocked.
// The battle projection is deliberately labelled as provisional.
export function manualAnticipation(book,totalExpForLevel,projectedGain=0){
  if(!book||typeof totalExpForLevel!=='function'||!Array.isArray(book.skills))return null;
  const skill=book.skills.find(s=>!s.unlocked&&[5,10].includes(Number(s.levelRequired)));
  if(!skill)return null;
  const targetLevel=Number(skill.levelRequired);
  const rawExp=book.totalExp??book.exp;
  if(rawExp==null||!Number.isFinite(Number(rawExp))||Number(rawExp)<0)return null;
  const confirmedExp=Math.trunc(Number(rawExp));
  const startExp=Number(totalExpForLevel(targetLevel===5?1:5));
  const targetExp=Number(totalExpForLevel(targetLevel));
  if(!Number.isFinite(startExp)||!Number.isFinite(targetExp)||targetExp<=startExp)return null;
  const gain=Number.isFinite(Number(projectedGain))&&Number(projectedGain)>0?
    Math.trunc(Number(projectedGain)):0;
  const estimatedExp=confirmedExp+gain;
  const percent=Math.round(100*Math.max(0,Math.min(1,(estimatedExp-startExp)/(targetExp-startExp))));
  const remaining=Math.max(0,targetExp-estimatedExp);
  const realmBlocked=skill.mastered===true&&skill.realmReady===false;
  const stale=skill.mastered===true&&skill.realmReady===true||
    (!skill.mastered&&Number(book.level)>=targetLevel);
  const status=realmBlocked?'realm':stale?'pending':percent>=90?'imminent':percent>=75?'near':'training';
  return {bookId:book.id,skillId:skill.id,skillName:skill.name,realmName:skill.realmName||'指定',
    level:Number(book.level)||1,targetLevel,confirmedExp,estimatedExp,projectedGain:gain,
    remaining,targetExp,percent,status};
}
export function renderManualAnticipation(hint,esc){
  if(!hint)return '';
  const text=value=>esc(String(value??''));
  const fmt=value=>Math.max(0,Number(value)||0).toLocaleString('zh-TW');
  const badge={training:'逐步修煉',near:'靈氣漸滿',imminent:'突破在即',
    realm:'境界待突破',pending:'等待確認'}[hint.status]||'修煉中';
  const message=hint.status==='realm'?
    '功法門檻已達，仍需達到修士 '+hint.realmName+'境':
    hint.status==='pending'?'功法門檻資料待同步，尚未確認解鎖':
    '距 Lv. '+hint.targetLevel+' 功法門檻還差 '+fmt(hint.remaining)+' EXP';
  return `<div class="manual-anticipation manual-anticipation--${hint.status}"
    data-manual-anticipation="${hint.status}" data-manual-next-level="${hint.targetLevel}">
    <div class="manual-anticipation-head">
      <span><i class="fa-solid fa-compass" aria-hidden="true"></i> 下一個修行目標</span>
      <strong>${text(badge)}</strong>
    </div>
    <div class="manual-anticipation-target">
      <span>第 ${hint.targetLevel===5?'二':'三'} 招 · ${text(hint.skillName)}</span>
      <span>${hint.percent}%</span>
    </div>
    <div class="manual-anticipation-track" role="progressbar" aria-valuemin="0"
      aria-valuemax="100" aria-valuenow="${hint.percent}" aria-label="下一招功法等級門檻進度">
      <span style="width:${hint.percent}%"></span>
    </div>
    <p>${text(message)}</p>
    <small>功法等級達標後，仍須符合修士境界才能領悟招式。</small>
  </div>`;
}
export function manualRoomExp(room,uid,bookId,catalog){
  if(!room||room.mode!=='pve'||!uid||!catalog?.BY_BOOK?.[bookId])return 0;
  const positive=v=>Number.isFinite(Number(v))?Math.max(0,Math.trunc(Number(v))):0;
  return Math.min(100000000,positive(room.manualExp?.[uid]?.[bookId])+
    positive(room.manualKills?.[uid]?.[bookId])*positive(catalog.EXP_PER_KILL));
}
export function battleBreakthroughEstimate(snapshot,room,uid,delta,catalog,baseline){
  if(!Array.isArray(snapshot?.library)||!room||room.mode!=='pve'||!delta?.books?.length||
    !baseline||baseline.roomId!==room.id||baseline.uid!==uid||
    typeof catalog?.totalExpForLevel!=='function')return null;
  const owned=new Map(snapshot.library.filter(b=>b.owned).map(b=>[b.id,b]));
  const candidates=[];
  for(const row of delta.books){
    const book=owned.get(row.id),start=Number(baseline.ledger?.[row.id]);
    if(!book||!Number.isFinite(start)||start<0)continue;
    const gain=Math.max(0,manualRoomExp(room,uid,row.id,catalog)-start);
    const hint=manualAnticipation(book,catalog.totalExpForLevel,gain);
    if(hint&&['near','imminent','realm'].includes(hint.status))
      candidates.push({...hint,bookName:book.name,isEstimate:gain>0});
  }
  const priority={imminent:0,realm:1,near:2};
  candidates.sort((a,b)=>priority[a.status]-priority[b.status]||a.remaining-b.remaining);
  return candidates[0]||null;
}
export function renderBattleBreakthroughEstimate(hint,esc,{confirmed=false}={}){
  if(!hint)return '';
  const txt=v=>esc(String(v??'')),fmt=v=>Math.max(0,Number(v)||0).toLocaleString('zh-TW');
  const realm=hint.status==='realm';
  const title=realm?'功法門檻已達 · 待境界提升':
    hint.status==='imminent'?'靈氣將滿 · 接近突破':'功法逐漸接近門檻';
  const detail=realm?'仍須達到修士 '+hint.realmName+'境':
    (confirmed?'距 Lv. ':'試算距 Lv. ')+hint.targetLevel+
      ' 等級門檻'+(confirmed?'還差 ':'約 ')+fmt(hint.remaining)+' EXP';
  const note=confirmed?
    'EXP 已依角色帳號確認，領悟招式仍須達到指定境界。':
    '本場僅為試算，實際 EXP 與領悟以伺服器結算為準。';
  return `<div class="tc-manual-breakthrough tc-manual-breakthrough--${hint.status}"
    data-manual-battle-breakthrough data-manual-breakthrough-status="${hint.status}">
    <div class="tc-manual-breakthrough-title"><strong>${txt(title)}</strong><small>${hint.percent}%</small></div>
    <div class="tc-manual-breakthrough-track" role="progressbar"
      aria-valuemin="0" aria-valuemax="100" aria-valuenow="${hint.percent}"
      aria-label="本場試算功法門檻進度"><span style="width:${hint.percent}%"></span></div>
    <small>${txt(detail)} · ${txt(note)}</small>
  </div>`;
}
