// Phase 1 of the stamina cultivation redesign: a read-only visual
// projection of the existing, server-authoritative manual and skill data.
// Selecting a book here changes only the current view, not the learned school.
import {manualVisualState,manualSkillVisualState,renderManualVisualMilestones} from './manual-visual-progression.js';
import {manualAnticipation,renderManualAnticipation} from './manual-anticipation.js';

export function renderManualHero(state, selectedBookId, { esc, bookArt, skillArt, label, totalExpForLevel }) {
  const owned=(state?.library||[]).filter(book=>book.owned);
  const chosen=owned.find(book=>book.id===selectedBookId)
    || owned.find(book=>book.school===state?.school)
    || owned[0] || null;
  const schoolButtons=['sword','body'].map(school=>
    `<button type="button" class="manual-hero-school ${state?.school===school?'is-selected':''}"
      data-manual-school="${school}" aria-pressed="${state?.school===school}">
      <i class="fa-solid ${school==='sword'?'fa-khanda':'fa-hand-fist'}" aria-hidden="true"></i>
      ${label(school)}</button>`).join('');
  const heading=`<div class="manual-hero-top">
    <div class="manual-hero-brand"><span class="manual-hero-kicker">問道 · 功法閣</span>
      <h2>功法修煉</h2></div>
    <div class="manual-hero-schools" role="group" aria-label="選擇修行流派">${schoolButtons}</div>
  </div>`;
  if(!chosen) return {
    bookId:'',
    html:`<section class="manual-hero manual-hero--empty" aria-label="功法修煉">
      ${heading}<div class="manual-hero-empty-state">
        <i class="fa-solid fa-book-open" aria-hidden="true"></i>
        <strong>你的修行之路即將開始</strong>
        <p>選擇劍修或體修，即可免費習得第一本入門功法。</p>
      </div></section>`
  };

  const book=chosen;
  const visual=manualVisualState(book);
  const growth=renderManualVisualMilestones(book,esc);
  const anticipation=manualAnticipation(book,totalExpForLevel);
  const milestone=renderManualAnticipation(anticipation,esc);
  const near=anticipation&&['near','imminent'].includes(anticipation.status);
  const fmt=value=>Math.max(0,Math.round(Number(value)||0)).toLocaleString('zh-TW');
  const progress=Math.max(0,Math.min(100,Number(book.progress)||0));
  const maxed=Number(book.level)>=10;
  const next=book.skills.find(skill=>!skill.unlocked);
  const goalTitle=next?`下一招 · ${next.name}`:'三招皆已領悟';
  const requirements=next?[
    !next.mastered?`功法 Lv. ${next.levelRequired}`:null,
    !next.realmReady?`修士 ${next.realmName}境`:null
  ].filter(Boolean):[];
  const goalSubtitle=next?(requirements.join(' ＋ ')||'符合條件後即可使用'):'可繼續培養已領悟的招式';
  const progressLabel=maxed?'功法已達最高等級':
    `${fmt(book.expInLevel)} / ${fmt(book.expToNext)} EXP`;
  const roster=owned.map(item=>`<button type="button" data-feature-book="${esc(item.id)}"
      class="manual-hero-book-tab ${item.id===book.id?'is-current':''}"
      aria-pressed="${item.id===book.id}">
      <span class="manual-hero-tab-mark" aria-hidden="true"></span>
      ${esc(item.name)}<small>Lv. ${fmt(item.level)}</small>
    </button>`).join('');
  const cover=bookArt(book.id);
  const coverMarkup=cover
    ?`<img class="manual-hero-cover" src="${esc(cover)}" alt="${esc(book.name)}封面" decoding="async" fetchpriority="high">`
    :'<span class="manual-hero-cover-fallback" aria-hidden="true">卷</span>';
  const steps=book.skills.map((skill,index)=>{
    const unlocked=!!skill.unlocked;
    const skillState=manualSkillVisualState(skill);
    const missing=[
      !skill.mastered?`功法 Lv. ${skill.levelRequired}`:null,
      !skill.realmReady?`${skill.realmName}境`:null
    ].filter(Boolean).join(' · ');
    const detail=unlocked?
      `招式 Lv. ${fmt(skill.level)} · ${fmt(skill.cost)} 體力`:
      (missing||'尚未符合解鎖條件');
    const art=skillArt(skill);
    const artMarkup=art
      ?`<img src="${esc(art)}" alt="" loading="lazy" decoding="async">`
      :'<span aria-hidden="true">✦</span>';
    return `<button type="button" class="manual-hero-step ${unlocked?'is-unlocked':'is-locked'} is-${skillState} ${next?.id===skill.id?'is-next':''} ${near&&next?.id===skill.id?'is-approaching':''}"
        data-manual-skill-visual="${skillState}"
        data-manual-jump-skill="${esc(skill.id)}" aria-label="查看${esc(skill.name)}，${esc(detail)}">
      <span class="manual-hero-node">${artMarkup}</span>
      <span class="manual-hero-node-tier">第 ${index+1} 招 · Lv. ${fmt(skill.levelRequired)}</span>
      <strong>${esc(skill.name)}</strong>
      <small>${esc(detail)}</small>
      <span class="manual-hero-node-status">${unlocked?'已領悟':skillState==='realm-locked'?'修士境界未達':'功法等級未達'}</span>
    </button>`;
  }).join('');
  const upgrade=book.upgrade;
  const needGold=upgrade&&Number(state.gold||0)<Number(upgrade.gold||0);
  const action=upgrade
    ?`<button type="button" class="manual-hero-upgrade" data-manual-upgrade="${esc(book.id)}"
      ${needGold?'disabled title="靈石不足"':''}>
      <i class="fa-solid fa-arrow-up-right-dots" aria-hidden="true"></i>
      ${needGold?'靈石不足 · ':''}升至 Lv. ${fmt(upgrade.targetLevel)}
      <span>${fmt(upgrade.gold)} 靈石</span></button>`
    :`<span class="manual-hero-max-level">${maxed?'功法已達 Lv. 10':'熟練度持續累積中'}</span>`;

  return {
    bookId:book.id,
    html:`<section class="manual-hero manual-hero--${book.school} manual-hero--tier-${visual.stage} ${near?'manual-hero--approaching':''} ${anticipation?.status==='imminent'?'manual-hero--imminent':''}"
      data-manual-visual-stage="${visual.stage}" data-manual-visual-level="${visual.level}"
      aria-label="功法修煉焦點">
      ${heading}
      <div class="manual-hero-roster" role="group" aria-label="切換展示的已獲得功法">${roster}</div>
      <div class="manual-hero-main">
        <div class="manual-hero-art-stage">
          <div class="manual-hero-art-halo" aria-hidden="true"></div>
          <div class="manual-hero-qi-ring" aria-hidden="true">
            <span class="manual-hero-qi-orbit"></span>
            <span class="manual-hero-qi-seal"></span>
          </div>
          <span class="manual-hero-qi-spark manual-hero-qi-spark--one" aria-hidden="true"></span>
          <span class="manual-hero-qi-spark manual-hero-qi-spark--two" aria-hidden="true"></span>
          ${coverMarkup}
          <span class="manual-hero-art-caption">${label(book.school)} · ${visual.label}</span>
        </div>
        <div class="manual-hero-details">
          <div class="manual-hero-title-row">
            <div><span class="manual-hero-eyebrow">正在查看的功法</span>
              <h3>${esc(book.name)}</h3></div>
            <div class="manual-hero-level"><small>功法等級</small><b>Lv. ${fmt(book.level)}</b></div>
          </div>
          <div class="manual-hero-mastery">
            <div class="manual-hero-progress-head"><strong>修煉熟練度</strong><span>${progressLabel}</span></div>
            <div class="manual-hero-track" role="progressbar" aria-label="${esc(book.name)}熟練度"
              aria-valuemin="0" aria-valuemax="100" aria-valuenow="${maxed?100:progress}">
              <span class="manual-hero-progress" style="width:${maxed?100:progress}%"></span></div>
          </div>
          ${growth}
          ${milestone}
          <div class="manual-hero-goal">
            <span class="manual-hero-goal-symbol" aria-hidden="true">✧</span>
            <div><strong>${esc(goalTitle)}</strong><small>${esc(goalSubtitle)}</small></div>
          </div>
          <div class="manual-hero-actions">${action}<span class="manual-hero-tip">升級僅使用現有靈石與熟練度規則</span></div>
        </div>
      </div>
      <div class="manual-hero-path">
        <div class="manual-hero-path-heading"><strong>三招修行路線</strong><small>點選招式查看詳細效果與強化選項</small></div>
        <div class="manual-hero-path-grid">${steps}</div>
      </div>
    </section>`
  };
}
