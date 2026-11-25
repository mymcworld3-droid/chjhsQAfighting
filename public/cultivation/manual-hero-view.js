import './weapon-presentation.js';
import {stoneCostMarkup} from './spirit-stone-ui.js?v=20261125-stone-price-art-v1';
// Phase 1 of the stamina cultivation redesign: a read-only visual
// projection of the existing, server-authoritative manual and skill data.
// Selecting a book here changes only the current view, not the learned school.
import {manualVisualState,manualSkillVisualState,renderManualVisualMilestones} from './manual-visual-progression.js';
import {manualAnticipation} from './manual-anticipation.js';
import {renderManualSkillDetail} from './manual-skill-detail-view.js?v=20261125-stone-price-art-v1';

export function renderManualHero(state, selectedBookId, { esc, bookArt, skillArt, label, totalExpForLevel, selectedSkillId=null, descriptionWithDamage=()=>'', moveIdOf=()=>null, equipped=[], attack=200 }) {
  const weaponMode=Array.isArray(state?.weaponIds);
  const owned=weaponMode&&typeof globalThis.QAManuals?.sortedOwnedWeapons==='function'
    ?globalThis.QAManuals.sortedOwnedWeapons(state.library,state.weaponIds)
    :(state?.library||[]).filter(book=>book.owned);
  const chosen=owned.find(book=>book.id===selectedBookId)
    || owned.find(book=>book.school===state?.school)
    || owned[0] || null;
  const schoolButtons=['sword','body'].map(school=>
    `<button type="button" class="manual-hero-school ${state?.school===school?'is-selected':''}"
      data-manual-school="${school}" aria-pressed="${state?.school===school}">
      <i class="fa-solid ${school==='sword'?'fa-khanda':'fa-hand-fist'}" aria-hidden="true"></i>
      ${label(school)}</button>`).join('');
  const heading=`<div class="manual-hero-top">
    <div class="manual-hero-brand"><span class="manual-hero-kicker">問道 · ${weaponMode?'兵器閣':'功法閣'}</span>
      <h2>${weaponMode?'武器修煉':'功法修煉'}</h2></div>
    <div class="manual-hero-schools" role="group" aria-label="選擇修行流派">${schoolButtons}</div>
  </div>`;
  if(!chosen) return {
    bookId:'',
    html:`<section class="manual-hero manual-hero--empty" aria-label="武器修煉">
      ${heading}<div class="manual-hero-empty-state">
        <i class="fa-solid fa-book-open" aria-hidden="true"></i>
        <strong>你的修行之路即將開始</strong>
        <p>選擇劍修或體修，即可免費習得第一件入門武器。</p>
      </div></section>`
  };

  const book=chosen;
  const tierClass=({'煉氣':'qi','築基':'foundation','金丹':'golden','元嬰':'nascent'})[book.tierRealm]||'ascended';
  const copies=esc(globalThis.QAWeaponPresentation.copiesText(book));
  const visual=manualVisualState(book);
  const growth=renderManualVisualMilestones(book,esc);
  const anticipation=manualAnticipation(book,totalExpForLevel);
  const nextNote=anticipation?
    anticipation.status==='pending'?'領悟條件待同步確認':
    '距第 '+(anticipation.targetLevel===5?'二':'三')+' 招等級門檻尚差 '+Math.max(0,anticipation.remaining).toLocaleString('zh-TW')+' EXP':
    '';
  const near=anticipation&&['near','imminent'].includes(anticipation.status);
  const fmt=value=>Math.max(0,Math.round(Number(value)||0)).toLocaleString('zh-TW');
  const maxed=Number(book.level)>=20;
  const next=book.skills.find(skill=>!skill.unlocked);
  const progressLabel=maxed?'靈紋完整':
    `${fmt(book.expInLevel)} / ${fmt(book.expToNext)} EXP`;
  const ownAttack=Math.max(1,Number(book.level)||1);
  const allAttack=Number.isFinite(Number(state.attackBonus))?
    Math.max(0,Number(state.attackBonus)):
    owned.reduce((sum,item)=>sum+Math.max(1,Number(item.level)||1),0);
  const cover=bookArt(book.id);
  const coverMarkup=weaponMode?
    globalThis.QAWeaponPresentation.artMarkup(book,{className:'manual-hero-cover'}):
    cover?`<img class="manual-hero-cover" src="${esc(cover)}" alt="${esc(book.name)}封面" decoding="async" fetchpriority="high">`:
    '<span class="manual-hero-cover-fallback" aria-hidden="true">卷</span>';
  const steps=book.skills.map((skill,index)=>{
    const unlocked=!!skill.unlocked;
    const skillState=manualSkillVisualState(skill);
    const missing=[
      !skill.mastered?`${weaponMode?'武器':'功法'} Lv. ${skill.levelRequired}`:null
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
        data-manual-jump-skill="${esc(skill.id)}" aria-expanded="${selectedSkillId===skill.id}" aria-label="查看${esc(skill.name)}，${esc(detail)}">
      <span class="manual-hero-node">${artMarkup}</span>
      <span class="manual-hero-node-tier">第 ${index+1} 招 · Lv. ${fmt(skill.levelRequired)}</span>
      <strong>${esc(skill.name)}</strong>
      <small>${esc(detail)}</small>
      <span class="manual-hero-node-status">${unlocked?'已領悟':'武器等級未達'}</span>
    </button>`;
  }).join('');
  const upgrade=book.upgrade;
  const needGold=upgrade&&Number(state.gold||0)<Number(upgrade.gold||0);
  const action=upgrade
    ?`<button type="button" class="manual-hero-upgrade" data-manual-upgrade="${esc(book.id)}"
      ${needGold?'disabled':''} title="升至 Lv. ${fmt(upgrade.targetLevel)}，消耗 ${fmt(upgrade.gold)} 靈石${needGold?'（靈石不足）':''}">
      <i class="fa-solid fa-arrow-up-right-dots" aria-hidden="true"></i>
      ${needGold?'靈石不足 · ':''}升級 ${stoneCostMarkup(upgrade.gold)}</button>`
    :maxed?'':`<span class="manual-hero-max-level">Lv.10 後需以武器技能擊殺靈獸累積 EXP</span>`;

  const carousel=weaponMode?`<div class="manual-native-carousel">
    <button type="button" data-manual-browse-weapon="prev" aria-label="上一件武器" ${owned.length<2?'disabled':''}>‹</button>
    <strong>${esc(book.name)}</strong>
    <button type="button" data-manual-browse-weapon="next" aria-label="下一件武器" ${owned.length<2?'disabled':''}>›</button>
    <span class="manual-native-dots" aria-label="第 ${owned.indexOf(book)+1} 件，共 ${owned.length} 件">${owned.map(item=>'<i class="'+(item.id===book.id?'is-current':'')+'"></i>').join('')}</span>
  </div>`:'';
  const masteryMarkup=`<div class="manual-hero-details">
          <div class="manual-hero-title-row">
            <div><span class="manual-hero-eyebrow">${weaponMode?'正在查看的武器':'正在查看的功法'}</span>
              <h3>${esc(book.name)}</h3></div>
          </div>
          <div class="manual-hero-mastery" data-manual-mastery-stage="${visual.stage}">
            <div class="manual-hero-mastery-heading">
              <strong>修煉熟練度</strong>
              <span class="manual-hero-mastery-level">Lv. ${visual.level}</span>
            </div>
            <div class="manual-hero-mastery-summary">
              <span class="manual-hero-stage-badge">${esc(visual.label)}</span>
              <span class="manual-hero-mastery-status">${progressLabel}</span>
            </div>
            <small class="manual-hero-attack-bonus">${weaponMode?'本武器':'本功法'}攻擊 +${fmt(ownAttack)} · 已獲${weaponMode?'武器':'功法'}合計 +${fmt(allAttack)}</small>
            ${copies?`<small class="manual-hero-weapon-copies">持有：${copies}</small>`:''}
            ${weaponMode?globalThis.QAWeaponPresentation.masteryMarkup(book):''}
            ${growth}
            ${nextNote?`<small class="manual-hero-next-inline">${esc(nextNote)}</small>`:''}
            <small class="manual-hero-mastery-footnote">武器 Lv.1、5、10 依序領悟三招。</small>
          </div>
          <div class="manual-hero-actions">${action}
            ${upgrade?'<span class="manual-hero-tip">靈石只可升至 Lv.10；之後需戰鬥修煉</span>':''}
          </div>
        </div>`;
  const skillMarkup=renderManualSkillDetail(book,selectedSkillId,{esc,skillArt,descriptionWithDamage,attack,
    gold:state.gold,equipped,moveIdOf,weaponIds:weaponMode?state.weaponIds:null});
  return {
    bookId:book.id,
    html:`<section class="manual-hero${weaponMode?' manual-native-hero':''} manual-hero--${book.school} manual-hero--tier-${visual.stage} ${near?'manual-hero--approaching':''} ${anticipation?.status==='imminent'?'manual-hero--imminent':''}"
      data-ritual-weapon="${esc(book.id)}" data-manual-visual-stage="${visual.stage}" data-manual-visual-level="${visual.level}"
      aria-label="武器修煉焦點">
      ${heading}
      <div class="manual-hero-main">
        <div class="manual-hero-art-stage">
          <div class="manual-hero-art-halo" aria-hidden="true"></div>
          <div class="manual-hero-qi-ring" aria-hidden="true">
            <span class="manual-hero-qi-orbit"></span>
            <span class="manual-hero-qi-seal"></span>
          </div>
          <span class="manual-hero-qi-spark manual-hero-qi-spark--one" aria-hidden="true"></span>
          <span class="manual-hero-qi-spark manual-hero-qi-spark--two" aria-hidden="true"></span>
          ${weaponMode?`<svg class="manual-ritual-seal" viewBox="0 0 240 240" aria-hidden="true" focusable="false">
            <circle cx="120" cy="120" r="116" class="manual-ritual-outline"/>
            <circle cx="120" cy="120" r="108" class="manual-ritual-outline"/>
            <g class="manual-ritual-wheel">
              <circle cx="120" cy="120" r="112" class="manual-ritual-ticks" pathLength="360" stroke-dasharray="1 5"/>
              <circle cx="120" cy="120" r="102" class="manual-ritual-orbit" stroke-dasharray="56 9 14 12"/>
              ${Array.from({length:8},(_,i)=>`<path class="manual-ritual-jewel" d="M120 2 l4 6 -4 6 -4 -6 Z" transform="rotate(${i*45} 120 120)"/>`).join('')}
            </g>
            <path class="manual-ritual-cross" d="M120 0v14m0 212v14M0 120h14m212 0h14"/>
          </svg><span class="manual-ritual-energy" aria-hidden="true"></span>`:''}
          ${coverMarkup}
          <span class="manual-hero-art-caption manual-hero-tier-badge is-tier-${tierClass}">${esc(book.tierRealm||'煉氣')}${weaponMode?'武器':'功法'}</span>
        </div>
        ${carousel}
        ${weaponMode?'':masteryMarkup}
      </div>
      <div class="manual-hero-path">
        ${weaponMode?'<div class="manual-native-skills-panel">':''}
        <div class="manual-hero-path-heading"><strong>${weaponMode?'武器技能（'+book.skills.filter(s=>s.unlocked).length+'/'+book.skills.length+'）':'三招修行路線'}</strong><small>點選招式查看詳細效果與強化選項</small></div>
        <div class="manual-hero-path-grid">${steps}</div>
        ${weaponMode?'</div>':''}
        ${weaponMode?`<div class="manual-shared-detail" data-manual-detail-mode="${skillMarkup?'skill':'mastery'}">${skillMarkup||masteryMarkup}</div>`:skillMarkup}
      </div>
    </section>`
  };
}
