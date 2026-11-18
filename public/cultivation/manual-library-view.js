// Phase 3: owned-manual collection art and filters.
// Presentational only: visibility, levels, skill unlocks and EXP come from the server.
import {manualVisualState,manualSkillVisualState} from './manual-visual-progression.js';
import {manualAnticipation} from './manual-anticipation.js';

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
      <p>選擇功法，即可在上方集中修煉與強化。</p>
    </div>
    <button type="button" class="manual-refresh" data-manual-refresh title="同步功法資料"
      aria-label="更新功法資料"><i class="fa-solid fa-rotate" aria-hidden="true"></i> 更新</button>
    <div class="manual-library-filters" role="group" aria-label="篩選已獲得功法">${tabs}</div>
  </div>`;
}

export function renderManualCollectionSummary(book,focusId,equipped,{esc,bookArt,label,totalExpForLevel}) {
  const visual=manualVisualState(book);
  const anticipation=manualAnticipation(book,totalExpForLevel);
  const near=anticipation&&['near','imminent'].includes(anticipation.status);
  const current=book.id===focusId;
  const learned=(book.skills||[]).filter(skill=>skill.unlocked).length;
  const stage=Number(book.level)>=20?'圓滿':near?
    anticipation.status==='imminent'?'突破在即':'接近突破':
    learned===3?'三招皆已領悟':visual.label;
  const cover=bookArt(book.id);
  const art=cover?`<img class="manual-book-art manual-library-cover" src="${esc(cover)}"
    alt="" loading="lazy" decoding="async">`:
    '<span class="manual-library-cover-fallback" aria-hidden="true">功法</span>';
  return `<button type="button" class="manual-book-top manual-library-choice"
      data-feature-book="${esc(book.id)}" data-manual-focus-hero="true" aria-pressed="${current}"
      aria-label="展示${esc(book.name)}，Lv. ${visual.level}，${esc(stage)}">
    <span class="manual-library-art-zone" data-manual-stage="${visual.stage}"
      data-manual-approach="${near?anticipation.status:'none'}">
      <span class="manual-library-cover-glow" aria-hidden="true"></span>
      <span class="manual-library-cover-wrap">${art}</span>
      ${current?'<span class="manual-library-featured-tag">展示中</span>':''}
    </span>
    <span class="manual-library-card-info">
      <span class="manual-library-name-row"><strong>${esc(book.name)}</strong>
        <span class="manual-library-level">Lv. ${visual.level}</span></span>
      <span class="manual-library-brief">
        <span>${esc(label(book.school))} · ${esc(book.tierRealm||'煉氣')}功法</span>
        <span class="manual-library-brief-state ${near?'is-approaching':''}">${esc(stage)}</span>
      </span>
    </span>
  </button>`;
}
