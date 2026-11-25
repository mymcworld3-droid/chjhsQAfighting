// Phase 3: owned-manual collection art and filters.
// Presentational only: visibility, levels, skill unlocks and EXP come from the server.
import {manualVisualState,manualSkillVisualState} from './manual-visual-progression.js';
import {manualAnticipation} from './manual-anticipation.js';

export function filterOwnedManuals(state, filter='all') {
  const owned=(state?.library||[]).filter(book=>book?.owned===true);
  if(Array.isArray(state?.weaponIds)){
    const equipped=new Set(state.weaponIds.filter(Boolean));
    const realms=globalThis.QAManuals?.REALMS?.map(realm=>realm.name)
      ||['煉氣','築基','金丹','元嬰','化神','煉虛','合體','渡劫','真仙'];
    const realmRank=book=>realms.indexOf(book.tierRealm);
    // Stable ties retain the original server catalog order; equipped slots are peers.
    owned.sort((a,b)=>Number(equipped.has(b.id))-Number(equipped.has(a.id))
      ||(Number(b.level)||0)-(Number(a.level)||0)
      ||realmRank(b)-realmRank(a));
  }
  return ['sword','body','spell','arcane'].includes(filter)
    ?owned.filter(book=>book.school===filter):owned;
}

export function renderManualCollectionHeader(state, filter, {esc}) {
  const owned=filterOwnedManuals(state);
  const options=[
    {id:'all',title:Array.isArray(state?.weaponIds)?'全部武器':'全部功法',count:owned.length},
    {id:'sword',title:'劍修',count:owned.filter(book=>book.school==='sword').length},
    {id:'body',title:'體修',count:owned.filter(book=>book.school==='body').length}
  ];
  if(Array.isArray(state?.weaponIds))options.push(
    {id:'spell',title:'術修',count:owned.filter(book=>book.school==='spell').length},
    {id:'arcane',title:'奇門',count:owned.filter(book=>book.school==='arcane').length}
  );
  const tabs=options.map(item=>{
    const selected=item.id===filter;
    return `<button type="button" class="manual-library-filter ${selected?'is-selected':''}"
      data-manual-collection-filter="${item.id}" aria-pressed="${selected}">
      ${item.title}<span class="manual-library-filter-count">${item.count}</span>
    </button>`;
  }).join('');
  return `<div class="manual-library-heading">
    <div class="manual-library-heading-copy">
      <span class="manual-library-kicker">問道 · ${Array.isArray(state?.weaponIds)?'兵器閣':'藏經閣'}</span>
      <h3>${Array.isArray(state?.weaponIds)?'武器收藏':'功法收藏'} <span class="manual-library-owned-count">${owned.length} ${Array.isArray(state?.weaponIds)?'件':'本'}</span></h3>
      <p>${Array.isArray(state?.weaponIds)?'點選武器可開啟修煉視窗；裝備可在下方調整。':'點選功法可開啟修煉與強化視窗。'}</p>
    </div>
    <button type="button" class="manual-refresh" data-manual-refresh title="同步武器資料"
      aria-label="更新武器資料"><i class="fa-solid fa-rotate" aria-hidden="true"></i> 更新</button>
    <div class="manual-library-filters" role="group" aria-label="篩選已獲得武器">${tabs}</div>
  </div>`;
}

export function renderManualCollectionSummary(book,focusId,equipped,{esc,bookArt,label,totalExpForLevel}) {
  if(book.weaponType){
    const selected=book.id===focusId;
    const school=({sword:'劍修',body:'體修',spell:'術修',arcane:'奇門'})[book.school]||label(book.school);
    return `<button type="button" class="manual-book-top manual-library-choice manual-art-card"
      data-feature-book="${esc(book.id)}" data-manual-focus-hero="true" aria-haspopup="dialog"
      aria-controls="manual-training-dialog" aria-pressed="${selected}"
      aria-label="修煉${esc(book.name)}，Lv. ${esc(book.level)} / 20，${esc(school)}">
      <span class="manual-art-card-picture"><span class="manual-weapon-art manual-weapon-art--${esc(book.id)} manual-library-cover"
        role="img" aria-label="${esc(book.name)}武器圖像"></span></span>
      <strong class="manual-art-card-name">${esc(book.name)}</strong>
      <span class="manual-art-card-school">${esc(school)}</span>
      <span class="manual-art-card-level">Lv. ${esc(book.level)} / 20</span>
    </button>`;
  }
  const visual=manualVisualState(book);
  const tierClass=({'煉氣':'qi','築基':'foundation','金丹':'golden','元嬰':'nascent'})[book.tierRealm]||'ascended';
  const anticipation=manualAnticipation(book,totalExpForLevel);
  const near=anticipation&&['near','imminent'].includes(anticipation.status);
  const current=book.id===focusId;
  const learned=(book.skills||[]).filter(skill=>skill.unlocked).length;
  const stage=Number(book.level)>=20?'圓滿':near?
    anticipation.status==='imminent'?'突破在即':'接近突破':
    learned===3?'三招皆已領悟':visual.label;
  const cover=bookArt(book.id);
  const art=book.weaponType?
    `<span class="manual-weapon-art manual-weapon-art--${esc(book.id)} manual-library-cover"
       role="img" aria-label="${esc(book.name)}武器圖像"></span>`:
    cover?`<img class="manual-book-art manual-library-cover" src="${esc(cover)}"
    alt="" loading="lazy" decoding="async">`:
    '<span class="manual-library-cover-fallback" aria-hidden="true">功法</span>';
  return `<button type="button" class="manual-book-top manual-library-choice"
      data-feature-book="${esc(book.id)}" data-manual-focus-hero="true" aria-haspopup="dialog" aria-controls="manual-training-dialog" aria-pressed="${current}"
      aria-label="展示${esc(book.name)}，Lv. ${visual.level}，${esc(stage)}">
    <span class="manual-library-art-zone" data-manual-stage="${visual.stage}"
      data-manual-approach="${near?anticipation.status:'none'}">
      <span class="manual-library-cover-glow" aria-hidden="true"></span>
      <span class="manual-library-cover-wrap">${art}</span>
      <span class="manual-library-school-tag is-tier-${tierClass}">${esc(book.tierRealm||'煉氣')}${book.weaponType?'武器':'功法'}</span>
      ${current?'<span class="manual-library-featured-tag">修煉中</span>':''}
    </span>
    <span class="manual-library-card-info">
      <span class="manual-library-name-row"><strong>${esc(book.name)}</strong>
        <span class="manual-library-level">Lv. ${visual.level}</span></span>
      <span class="manual-library-brief">
        <span>${esc(label(book.school))}</span>
        <span class="manual-library-brief-state ${near?'is-approaching':''}">${esc(stage)}</span>
      </span>
    </span>
  </button>`;
}
