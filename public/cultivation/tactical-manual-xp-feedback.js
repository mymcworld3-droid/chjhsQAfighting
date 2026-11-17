// Server-backed, per-book XP changes in the current PvE room.
// This projection never writes experience or unlocks: room ledgers alone decide.
const finiteCount=value=>{
  const number=Number(value);
  return Number.isFinite(number)?Math.max(0,Math.min(100000000,Math.trunc(number))):0;
};

export function manualXpDelta(previous,next,uid,catalog){
  if(!previous||!next||!uid||previous.id!==next.id||
    previous.mode!=='pve'||next.mode!=='pve'||
    !['active','finished'].includes(next.status)||
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
    earned:Math.min(100000000,earned)
  })).filter(row=>row.earned>0).sort((a,b)=>b.earned-a.earned||a.id.localeCompare(b.id));
  if(!books.length)return null;
  return {books,total:books.reduce((sum,row)=>sum+row.earned,0),roomId:next.id};
}

export function renderManualXpToast(delta,{esc,bookArt}={}){
  if(!delta?.books?.length)return '';
  const escape=typeof esc==='function'?esc:v=>String(v);
  const image=typeof bookArt==='function'?bookArt:()=>null;
  const compact=delta.books.slice(0,3);
  const lines=compact.map(book=>{
    const cover=image(book.id);
    const art=cover?`<img src="${escape(cover)}" alt="" loading="lazy" decoding="async">`:
      '<i class="fa-solid fa-book" aria-hidden="true"></i>';
    return `<div class="tc-manual-xp-entry tc-manual-xp-entry--${book.school==='body'?'body':'sword'}">
      <span class="tc-manual-xp-art">${art}</span>
      <span class="tc-manual-xp-name">${escape(book.name)}</span>
      <b class="tc-manual-xp-value">+${book.earned.toLocaleString('zh-TW')} EXP</b>
    </div>`;
  }).join('');
  const extra=delta.books.length>compact.length
    ?`<small class="tc-manual-xp-more">另外 ${delta.books.length-compact.length} 本功法也獲得經驗，可在戰後查看。</small>`:'';
  return `<div class="tc-manual-xp-toast" data-manual-xp-toast
    aria-label="本場功法經驗增加">
    <div class="tc-manual-xp-top"><span><i class="fa-solid fa-sparkles" aria-hidden="true"></i>
      功法修煉</span><strong>+${delta.total.toLocaleString('zh-TW')} EXP</strong></div>
    <div class="tc-manual-xp-entries">${lines}</div>
    ${extra}
  </div>`;
}
