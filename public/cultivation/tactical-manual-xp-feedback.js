import './weapon-presentation.js';
// Server-backed, per-book XP changes in the current PvE room.
// This projection never writes experience or unlocks: room ledgers alone decide.
const finiteCount=value=>{
  const number=Number(value);
  return Number.isFinite(number)?Math.max(0,Math.min(100000000,Math.trunc(number))):0;
};

export function manualXpDelta(previous,next,uid,catalog){
  if(!previous||!next||!uid||previous.id!==next.id||
    previous.mode!==next.mode||!['pve','dungeon'].includes(next.mode)||
    !(next.mode==='dungeon'?next.status==='assembled':
      ['active','finished'].includes(next.status))||
    (next.mode==='dungeon'&&
      (previous.manualProgressSession||previous.assembledAtMs)!==
      (next.manualProgressSession||next.assembledAtMs))||
    Number(next.revision)<Number(previous.revision))return null;
  const ownedCatalog=catalog?.BY_BOOK||{};
  const perBook=new Map();
  for(const [field,multiplier] of [
    ['manualExp',1],
    ['manualKills',finiteCount(catalog?.EXP_PER_KILL||50)]
  ]){
    const before=previous[field]?.[uid]||{},after=next[field]?.[uid]||{};
    for(const [bookId,amount] of Object.entries(after)){
      if(!Object.prototype.hasOwnProperty.call(ownedCatalog,bookId))continue;
      const difference=Math.max(0,finiteCount(amount)-finiteCount(before[bookId]));
      if(!difference)continue;
      perBook.set(bookId,(perBook.get(bookId)||0)+difference*multiplier);
    }
  }
  const books=[...perBook.entries()].map(([id,earned])=>({
    id,name:ownedCatalog[id].name,school:ownedCatalog[id].school,
    ...(ownedCatalog[id].weaponType?{weaponType:ownedCatalog[id].weaponType}:{}),
    earned:Math.min(100000000,earned)
  })).filter(row=>row.earned>0).sort((a,b)=>b.earned-a.earned||a.id.localeCompare(b.id));
  if(!books.length)return null;
  return {books,total:books.reduce((sum,row)=>sum+row.earned,0),roomId:next.id};
}

export function renderManualXpToast(delta,{esc,bookArt}={}){
  if(!delta?.books?.length)return '';
  const escape=typeof esc==='function'?esc:v=>String(v);
  const image=typeof bookArt==='function'?bookArt:()=>null;
  const kind=delta.books.some(book=>book.weaponType)?'武器':'功法';
  const compact=delta.books.slice(0,3);
  const lines=compact.map(book=>{
    const cover=image(book.id);
    const art=globalThis.QAWeaponPresentation.artMarkup(book)||(cover?`<img src="${escape(cover)}" alt="" loading="lazy" decoding="async">`:
      '<i class="fa-solid fa-book" aria-hidden="true"></i>');
    return `<div class="tc-manual-xp-entry tc-manual-xp-entry--${book.school==='body'?'body':'sword'}">
      <span class="tc-manual-xp-art">${art}</span>
      <span class="tc-manual-xp-name">${escape(book.name)}</span>
      <b class="tc-manual-xp-value">+${book.earned.toLocaleString('zh-TW')} EXP</b>
    </div>`;
  }).join('');
  const extra=delta.books.length>compact.length
    ?`<small class="tc-manual-xp-more">另外 ${delta.books.length-compact.length} ${kind==='武器'?'件':'本'}${kind}也獲得經驗，可在戰後查看。</small>`:'';
  return `<div class="tc-manual-xp-toast" data-manual-xp-toast
    aria-label="本場${kind}經驗增加">
    <div class="tc-manual-xp-top"><span><i class="fa-solid fa-sparkles" aria-hidden="true"></i>
      ${kind}修煉</span><strong>+${delta.total.toLocaleString('zh-TW')} EXP</strong></div>
    <div class="tc-manual-xp-entries">${lines}</div>
    ${extra}
  </div>`;
}

// The dungeon and trial use this same book artwork/EXP toast; only the
// verified A-side mastery snapshot may add exact level and percentage text.
export function renderManualXpProgress(delta,manualState,catalog,{esc}={}){
  if(!delta?.books?.length||!Array.isArray(manualState?.library)||
    typeof catalog?.mastery!=='function')return '';
  const escape=typeof esc==='function'?esc:value=>String(value??'');
  const owned=new Map(manualState.library.filter(book=>book?.owned)
    .map(book=>[book.id,book]));
  const list=delta.books.slice(0,3).map(row=>{
    const book=owned.get(row.id);
    if(!book)return '';
    if(book.weaponType)return `<div class="tc-manual-xp-progress-item" data-manual-xp-progress="${escape(row.id)}"><strong>${escape(book.name)}</strong>${globalThis.QAWeaponPresentation.masteryMarkup(book)}</div>`;
    const mastery=catalog.mastery(book.totalExp??book.exp);
    if(!Number.isInteger(mastery.level)||mastery.level<1)return '';
    const capped=mastery.level>=catalog.MAX_LEVEL;
    const percent=capped?100:Math.max(0,Math.min(100,mastery.progress));
    const fmt=value=>Math.max(0,Math.trunc(Number(value)||0))
      .toLocaleString('zh-TW');
    const next=capped?'已達最高等級':
      '距 Lv. '+(mastery.level+1)+' 還差 '+
        fmt(mastery.expToNext-mastery.expInLevel)+' EXP';
    const label='Lv. '+mastery.level+(capped?'（滿級）':
      ' → Lv. '+(mastery.level+1));
    return `<div class="tc-manual-xp-progress-item"
      data-manual-xp-progress="${escape(row.id)}">
      <div class="tc-manual-xp-progress-title">
        <strong>${escape(book.name)}</strong>
        <span>${escape(label)}</span>
      </div>
      <div class="tc-manual-xp-progress-track" role="progressbar"
        aria-label="${escape(book.name)}目前功法等級進度"
        aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
        <span style="width:${percent}%"></span>
      </div>
      <small>${capped?'最高 Lv. '+mastery.level:
        fmt(mastery.expInLevel)+' / '+fmt(mastery.expToNext)+' EXP · '+
        escape(next)}</small>
    </div>`;
  }).filter(Boolean);
  return list.length?`<div class="tc-manual-xp-progress"
    data-manual-progress-confirmed aria-label="功法等級進度，已依角色帳號確認">
    ${list.join('')}
  </div>`:'';
}
