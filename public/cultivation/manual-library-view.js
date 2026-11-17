// Phase 3: owned-manual collection art and filters.
// Presentational only: visibility, levels, skill unlocks and EXP come from the server.
export function filterOwnedManuals(state, filter='all') {
  const owned=(state?.library||[]).filter(book=>book?.owned===true);
  return filter==='sword'||filter==='body'
    ?owned.filter(book=>book.school===filter):owned;
}

export function renderManualCollectionHeader(state, filter, {esc}) {
  const owned=filterOwnedManuals(state);
  const options=[
    {id:'all',title:'全部功法',count:owned.length},
    {id:'sword',title:'劍修',count:owned.filter(book=>book.school==='sword').length},
    {id:'body',title:'體修',count:owned.filter(book=>book.school==='body').length}
  ];
  const tabs=options.map(item=>{
    const selected=item.id===filter;
    return `<button type="button" class="manual-library-filter ${selected?'is-selected':''}"
      data-manual-collection-filter="${item.id}" aria-pressed="${selected}">
      ${item.title}<span class="manual-library-filter-count">${item.count}</span>
    </button>`;
  }).join('');
  return `<div class="manual-library-heading">
    <div class="manual-library-heading-copy">
      <span class="manual-library-kicker">問道 · 藏經閣</span>
      <h3>功法收藏 <span class="manual-library-owned-count">${owned.length} 本</span></h3>
      <p>每本功法都有獨立的修煉進度。選擇卡片可查看詳情，並同步上方展示。</p>
    </div>
    <button type="button" class="manual-refresh" data-manual-refresh title="同步功法資料"
      aria-label="更新功法資料"><i class="fa-solid fa-rotate" aria-hidden="true"></i> 更新</button>
    <div class="manual-library-filters" role="group" aria-label="篩選已獲得功法">${tabs}</div>
  </div>`;
}

export function renderManualCollectionSummary(book, focusId, equipped, {esc,bookArt,skillArt,label}) {
  const fmt=v=>Math.max(0,Math.round(Number(v)||0)).toLocaleString('zh-TW');
  const level=Math.max(1,Math.min(10,Math.round(Number(book.level)||1)));
  const capped=level>=10;
  const progress=capped?100:Math.min(100,Math.max(0,Number(book.progress)||0));
  const learned=book.skills.filter(skill=>skill.unlocked).length;
  const selected=book.id===focusId;
  const equippedCount=book.skills.filter(skill=>equipped.includes(skill.id)).length;
  const upcoming=book.skills.find(skill=>!skill.unlocked);
  const blocked=upcoming?[
    !upcoming.mastered?`功法 Lv. ${fmt(upcoming.levelRequired)}`:null,
    !upcoming.realmReady?`${upcoming.realmName}境`:null
  ].filter(Boolean):[];
  const nextLabel=upcoming?`下一招：${upcoming.name}`:'三招皆已領悟';
  const nextHint=upcoming?(blocked.join(' · ')||'待符合解鎖條件'):'功法技能已完整領悟';
  const cover=bookArt(book.id);
  const coverElement=cover
    ?`<img class="manual-book-art manual-library-cover" src="${esc(cover)}" alt="" loading="lazy" decoding="async">`
    :'<span class="manual-library-cover-fallback" aria-hidden="true">功法</span>';
  const skills=book.skills.map((skill,i)=>{
    const art=skillArt(skill);
    return `<span class="manual-library-skill ${skill.unlocked?'is-learned':'is-locked'}"
      title="${esc(skill.name)}：${skill.unlocked?'已領悟':'未解鎖'}">
      <span class="manual-library-skill-picture">
        ${art?`<img class="manual-library-skill-art" src="${esc(art)}" alt="" loading="lazy" decoding="async">`:
          '<i class="fa-solid fa-star" aria-hidden="true"></i>'}
        ${skill.unlocked?'':'<i class="fa-solid fa-lock manual-library-skill-lock" aria-hidden="true"></i>'}
      </span>
      <small>第 ${i+1} 招</small>
    </span>`;
  }).join('');
  const bonus=equippedCount
    ?`<span class="manual-library-equipped"><i class="fa-solid fa-khanda" aria-hidden="true"></i>
      此配置已裝 ${equippedCount} 招</span>`:'';
  return `<summary class="manual-book-top" aria-label="查看${esc(book.name)}功法詳情">
    <span class="manual-library-art-zone">
      <span class="manual-library-cover-glow" aria-hidden="true"></span>
      <span class="manual-library-cover-wrap">${coverElement}</span>
      <span class="manual-library-school-tag">
        <i class="fa-solid ${book.school==='sword'?'fa-khanda':'fa-hand-fist'}" aria-hidden="true"></i>
        ${label(book.school)}</span>
      ${selected?'<span class="manual-library-featured-tag">展示中</span>':''}
    </span>
    <span class="manual-library-card-info">
      <span class="manual-library-name-row"><strong>${esc(book.name)}</strong>
        <span class="manual-library-level">Lv. ${fmt(level)}</span></span>
      <span class="manual-library-submeta">
        <span><i class="fa-solid fa-seedling" aria-hidden="true"></i> 已領悟 ${learned} / 3 招</span>
        ${bonus}
      </span>
      <span class="manual-library-mastery">
        <span class="manual-library-mastery-head"><span>${capped?'功法已達最高等級':'本級修煉熟練度'}</span>
          <span>${capped?'Lv. 10':fmt(book.expInLevel)+' / '+fmt(book.expToNext)+' EXP'}</span></span>
        <span class="manual-library-exp-track" role="progressbar"
          aria-label="${esc(book.name)}熟練度" aria-valuemin="0" aria-valuemax="100"
          aria-valuenow="${progress}"><span style="width:${progress}%"></span></span>
      </span>
      <span class="manual-library-three-skills" aria-label="三招領悟進度">${skills}</span>
      <span class="manual-library-next-goal">
        <span><i class="fa-solid fa-bullseye" aria-hidden="true"></i>
          ${esc(nextLabel)}<small>${esc(nextHint)}</small></span>
        <i class="fa-solid fa-chevron-down manual-library-disclosure" aria-hidden="true"></i>
      </span>
    </span>
  </summary>`;
}
