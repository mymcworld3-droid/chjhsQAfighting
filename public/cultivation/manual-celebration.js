import './weapon-presentation.js';
// Stamina manual cultivation: confirmed reward classification and presentation.
// IMPORTANT: this receives successive server-authoritative states. It never
// awards items, upgrades, or changes gameplay state.
export function detectManualCelebration(before,after,context={}) {
  if(!before||!after||!Array.isArray(before.library)||!Array.isArray(after.library))return null;
  const oldBooks=new Map(before.library.filter(b=>b?.owned).map(b=>[b.id,b]));
  const currentBooks=after.library.filter(b=>b?.owned);
  const newBooks=currentBooks.filter(book=>!oldBooks.has(book.id));
  if(newBooks.length){
    const book=newBooks[0],starter=context.kind==='school';
    return {kind:'discovery',school:book.school,bookId:book.id,
      name:book.name,level:Number(book.level)||1,weaponType:book.weaponType||null,
      heading:book.weaponType?(starter?'初獲武器':'新武器入庫'):(starter?'初悟功法':'新功法入藏'),
      kicker:book.weaponType?(starter?'入門武器 · 首次獲得':'試煉機緣 · 武器收藏'):(starter?'入門功法 · 首次習得':'試煉機緣 · 功法收錄'),
      detail:book.weaponType?(starter?'入門武器已加入兵器閣，可開始修煉。':'新武器已加入兵器閣。'):(starter?'入門功法已加入藏經閣，可開始修煉。':'新功法已正式加入藏經閣。'),
      extra:newBooks.length>1?`本次共取得 ${newBooks.length} ${book.weaponType?'件武器':'本功法'}`:''
    };
  }
  const refined=currentBooks.find(book=>Number(book.refinement||0)>Number(oldBooks.get(book.id)?.refinement||0));
  if(refined){const old=oldBooks.get(refined.id);return {kind:'refinement',school:refined.school,bookId:refined.id,name:refined.name,weaponType:refined.weaponType,refinement:refined.refinement,previousRefinement:old.refinement||0,heading:'武器精煉',kicker:'同款武器 · 靈紋共鳴',detail:'本武器傷害 +'+(refined.refinement*10)+'%',extra:''};}
  const upgrades=[],unlocks=[];
  for(const book of currentBooks){
    const old=oldBooks.get(book.id);
    if(!old)continue;
    if(Number(book.level)>Number(old.level))upgrades.push({book,old});
    const oldSkills=new Map((old.skills||[]).map(skill=>[skill.id,skill]));
    for(const skill of book.skills||[]){
      const previous=oldSkills.get(skill.id);
      if(previous&&!previous.unlocked&&skill.unlocked)unlocks.push({book,skill,previous});
    }
  }
  // A genuine new unlock takes priority over an ordinary book level gain.
  if(unlocks.length){
    const {book,skill}=unlocks[0];
    return {kind:'unlock',school:book.school,bookId:book.id,skillId:skill.id,
      name:skill.name,level:Number(book.level)||1,weaponType:book.weaponType||null,heading:'招式領悟',
      kicker:book.weaponType?'武器突破 · 新招式':'功法突破 · 新招式',detail:`《${book.name}》已領悟「${skill.name}」`,
      extra:unlocks.length>1?`另外領悟 ${unlocks.length-1} 招`:'',
      bookName:book.name};
  }
  if(context.skillId){
    const oldBook=[...oldBooks.values()].find(book=>(book.skills||[]).some(skill=>skill.id===context.skillId));
    const newBook=currentBooks.find(book=>book.id===oldBook?.id);
    const oldSkill=oldBook?.skills.find(skill=>skill.id===context.skillId);
    const skill=newBook?.skills.find(item=>item.id===context.skillId);
    if(skill&&oldSkill&&Number(skill.level)>Number(oldSkill.level)){
      return {kind:'skill-upgrade',school:newBook.school,bookId:newBook.id,skillId:skill.id,
        name:skill.name,level:Number(skill.level)||1,previousLevel:Number(oldSkill.level)||1,weaponType:newBook.weaponType||null,
        heading:'招式精進',kicker:newBook.weaponType?'修行精進 · 武器招式':'修行精進 · 功法招式',
        detail:`「${skill.name}」威力更上一層。`,extra:''};
    }
  }
  if(upgrades.length){
    const entry=upgrades.find(item=>item.book.id===context.bookId)||upgrades[0];
    const {book,old}=entry;
    const extra='';
    return {kind:'manual-upgrade',school:book.school,bookId:book.id,
      name:book.name,level:Number(book.level)||1,previousLevel:Number(old.level)||1,weaponType:book.weaponType||null,
      heading:book.weaponType?'武器精進':'功法精進',kicker:'修行突破 · 熟練提升',
      detail:`《${book.name}》熟練度已提升。`,extra};
  }
  return null;
}

export function renderManualCelebration(result,{esc,bookArt,skillArt,findSkill}) {
  if(!result||!['discovery','unlock','skill-upgrade','manual-upgrade','refinement'].includes(result.kind))return '';
  const school=result.school==='body'?'body':'sword';
  const discovery=result.kind==='discovery';
  const isUnlock=result.kind==='unlock',refined=result.kind==='refinement';
  const skill= result.skillId?findSkill(result.skillId):null;
  const artwork=discovery||refined||result.kind==='manual-upgrade'?bookArt(result.bookId):skillArt(skill||result.skillId);
  const fallback=discovery?'卷':'✦';
  const icon=artwork&&result.bookId&&(discovery||refined||result.kind==='manual-upgrade')
    ?globalThis.QAWeaponPresentation.artMarkup({id:result.bookId,name:result.name},{className:'manual-celebration-art'})
    :artwork
    ?`<img src="${esc(artwork)}" alt="" decoding="async" class="manual-celebration-art">`
    :`<span class="manual-celebration-art-fallback" aria-hidden="true">${fallback}</span>`;
  const reveal=discovery||isUnlock;
  const noLevel=discovery;
  const levelLine=refined?globalThis.QAWeaponPresentation.refinementStars(result,{previous:result.previousRefinement}):noLevel?(result.weaponType?'已收入兵器閣':'已收入藏經閣'):
    `<span class="manual-celebration-level-label">${result.kind==='skill-upgrade'?'招式':result.weaponType?'武器':'功法'} Lv.</span>
      ${result.previousLevel?`<span class="manual-celebration-old-level">${Number(result.previousLevel)}</span>
       <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>`:''}
      <b>${Number(result.level)||1}</b>`;
  return `<div class="manual-celebration-backdrop manual-celebration--${school} manual-celebration--${result.kind}"
      data-qy-celebration="weapon" role="status" aria-live="polite" aria-atomic="true">
    <div class="manual-celebration-panel">
      <div class="manual-celebration-crest" aria-hidden="true">
        <span class="manual-celebration-crest-outer"></span>
        <span class="manual-celebration-crest-inner"></span>
        <span class="manual-celebration-crest-spark"><i class="fa-solid fa-star"></i></span>
      </div>
      <div class="manual-celebration-content">
        <span class="manual-celebration-kicker">${esc(result.kicker)}</span>
        <strong class="manual-celebration-heading">${esc(result.heading)}</strong>
        <span class="manual-celebration-art-frame">${icon}</span>
        <span class="manual-celebration-name">${esc(result.name)}</span>
        <span class="manual-celebration-level">${levelLine}</span>
        <span class="manual-celebration-detail">${esc(result.detail)}</span>
        ${result.extra?`<small class="manual-celebration-extra">${esc(result.extra)}</small>`:''}
        <button type="button" class="manual-celebration-dismiss"
          data-manual-celebration-dismiss aria-label="關閉修行成果">繼續修煉
          <i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
      </div>
      <div class="manual-celebration-sparks" aria-hidden="true">
        ${Array.from({length:12},(_,i)=>`<i style="--spark:${i}"></i>`).join('')}
      </div>
    </div>
  </div>`;
}
