import './weapon-presentation.js';
// Only the server-confirmed per-room manual ledgers are used here.
// This is a visual recap. No XP, loot, or level updates are issued by the client.
const count = value => Number.isFinite(Number(value))
  ? Math.max(0,Math.min(100000000,Math.trunc(Number(value)))):0;
const format = value => count(value).toLocaleString('zh-TW');

export function manualBattleEarnings(battle,uid,manuals) {
  if(!battle||battle.mode!=='pve'||battle.status!=='finished'
    ||typeof uid!=='string'||!uid||!Array.isArray(battle.rewarded)
    ||!battle.rewarded.includes(uid))return null;
  const modern=battle.manualExp?.[uid]||{};
  const legacy=battle.manualKills?.[uid]||{};
  const permitted=manuals?.BY_BOOK||{};
  const ids=[...new Set([...Object.keys(modern),...Object.keys(legacy)])]
    .filter(id=>Object.prototype.hasOwnProperty.call(permitted,id));
  const books=ids.map(id=>{
    const earned=count(modern[id])+count(legacy[id])*count(manuals?.EXP_PER_KILL||50);
    const info=permitted[id];
    return {id,name:info.name,school:info.school,earned,...(info.weaponType?{weaponType:info.weaponType}:{})};
  }).filter(row=>row.earned>0).sort((a,b)=>b.earned-a.earned||a.id.localeCompare(b.id));
  return {books,total:books.reduce((sum,row)=>sum+row.earned,0),roomId:String(battle.id||'')};
}

function masteryHint(book,manuals) {
  if(!book)return null;
  const level=count(book.level)||1, exp=count(book.totalExp??book.exp);
  const next=(book.skills||[]).find(skill=>!skill.unlocked);
  const maxed=level>=20;
  const progress=Math.min(100,Math.max(0,Number(book.progress)||0));
  let headline='';
  if(next){
    const master=next.mastered===true;
    if(!master){
      const goalLevel=count(next.levelRequired);
      const needed=Math.max(0,count(manuals.totalExpForLevel(goalLevel))-exp);
      headline='距離第 '+goalLevel+' 級招式門檻尚需 '+format(needed)+' EXP';
    }
    else headline='招式尚未解鎖，請在功法閣確認';
  }else headline='三招皆已領悟';
  return {
    level,progress,expInLevel:count(book.expInLevel),expToNext:count(book.expToNext),
    remaining:maxed?0:Math.max(0,count(book.expToNext)-count(book.expInLevel)),
    maxed,headline,
    skillName:next?.name||''
  };
}

export function renderManualBattleRecap(battle,uid,manuals,manualState=null,{esc,bookArt,syncFailed=false}={}) {
  const result=manualBattleEarnings(battle,uid,manuals);
  if(!result)return '';
  const escape=typeof esc==='function'?esc:(x=>String(x));
  const art=typeof bookArt==='function'?bookArt:(()=>null);
  if(!result.books.length){
    return `<section class="tc-manual-recap tc-manual-recap--empty" data-manual-recap
      aria-label="本場功法修煉紀錄">
      <div class="tc-manual-recap-title"><span>功法修煉</span><small>本場紀錄</small></div>
      <p>本場沒有記錄功法 EXP。使用功法完成擊殺，或達成指定關卡的功法參與條件，才能累積經驗。</p>
    </section>`;
  }
  const weaponMode=result.books.some(row=>row.weaponType);
  const kind=weaponMode?'武器':'功法';
  const library=new Map((manualState?.library||[]).filter(x=>x.owned).map(book=>[book.id,book]));
  const details=result.books.map(row=>{
    const server=library.get(row.id);
    const mastery=masteryHint(server,manuals);
    const weapon=server?.weaponType?globalThis.QAWeaponPresentation.artMarkup(server):'';
    const image=art(row.id);
    const imageMarkup=weapon|| (image?`<img src="${escape(image)}" alt="" decoding="async" loading="lazy">`:
      '<i class="fa-solid fa-book-open" aria-hidden="true"></i>');
    const levelMarkup=mastery?`<span class="tc-manual-recap-level">Lv. ${mastery.level}</span>`:'';
    const bar=server?.weaponType?globalThis.QAWeaponPresentation.masteryMarkup(server):mastery?`
      <div class="tc-manual-recap-progress-meta">
        <span>${mastery.maxed?'功法已達最高等級':'本級熟練度 · 尚需 '+format(mastery.remaining)+' EXP 升級'}</span>
        <small>${mastery.maxed?'100%':format(mastery.expInLevel)+' / '+format(mastery.expToNext)}</small>
      </div>
      <div class="tc-manual-recap-track" role="progressbar" aria-valuemin="0"
        aria-valuemax="100" aria-valuenow="${mastery.maxed?100:mastery.progress}"
        aria-label="${escape(row.name)}熟練度">
        <span style="width:${mastery.maxed?100:mastery.progress}%"></span>
      </div>
      <div class="tc-manual-recap-goal">${mastery.skillName?
        `<strong>下一招 · ${escape(mastery.skillName)}</strong>`:''}
        <small>${escape(mastery.headline)}</small>
      </div>`:null;
    const progress=bar!==null?bar:`<p class="tc-manual-recap-sync">${syncFailed?'最新功法等級暫時無法取得':'正在同步功法等級與下一招目標…'}</p>`;
    return `<article class="tc-manual-recap-card tc-manual-recap--${row.school==='body'?'body':'sword'}"
      data-manual-recap-book="${escape(row.id)}">
      <div class="tc-manual-recap-card-top">
        <span class="tc-manual-recap-icon">${imageMarkup}</span>
        <span class="tc-manual-recap-name"><strong>${escape(row.name)}</strong>
          <small>${row.school==='body'?'體修':'劍修'}${kind} · 本場累積</small></span>
        <span class="tc-manual-recap-exp">+${format(row.earned)} <small>EXP</small></span>
      </div>
      ${levelMarkup}
      ${server?.weaponType&&globalThis.QAWeaponPresentation.copiesText(server)?'<small>持有：'+escape(globalThis.QAWeaponPresentation.copiesText(server))+'</small>':''}
      ${progress}
    </article>`;
  }).join('');
  return `<section class="tc-manual-recap" data-manual-recap
    aria-label="本場功法修煉紀錄">
    <div class="tc-manual-recap-title">
      <div><small>戰鬥結算 · ${kind}修煉</small><strong>本場熟練度成果</strong></div>
      <span class="tc-manual-recap-total">+${format(result.total)} <small>EXP</small></span>
    </div>
    <div class="tc-manual-recap-list">${details}</div>
    <p class="tc-manual-recap-note">本場 EXP 依戰鬥紀錄計算；${kind}等級與下一招進度以最新資料確認。${manualState?'':'同步期間可先查看本場紀錄。'}</p>
  </section>`;
}
