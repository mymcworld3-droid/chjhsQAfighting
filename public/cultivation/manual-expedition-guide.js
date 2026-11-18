// The cultivation "next expedition" guide is a pure projection of data
// already returned by the authenticated manuals endpoint. It never chooses a
// stage, mutates skill loadouts, grants EXP or changes trial difficulty.
import {manualAnticipation} from './manual-anticipation.js';

const formatAmount=value=>Math.max(0,Math.trunc(Number(value)||0)).toLocaleString('zh-TW');
export function nextManualExpedition(state,requestedBookId,rules) {
  if(!state||!Array.isArray(state.library)||!rules?.BY_BOOK||
    typeof rules.realmForStage!=='function'||typeof rules.totalExpForLevel!=='function')return null;
  const books=state.library.filter(item=>item?.owned&&rules.BY_BOOK[item.id]);
  const book=books.find(item=>item.id===requestedBookId)||
    books.find(item=>item.school===state.school)||books[0];
  if(!book)return null;
  const stage=Number.isInteger(state.trialStage)&&state.trialStage>=1?
    Math.min(1000000,state.trialStage):1;
  const enemyRealm=rules.realmForStage(stage);
  if(!enemyRealm||!Number.isFinite(Number(enemyRealm.exp))||enemyRealm.exp<=0)return null;
  const activeIndex=Number.isInteger(state.activeLoadout)&&state.activeLoadout>=0&&
    state.activeLoadout<(state.loadouts?.length||0)?state.activeLoadout:0;
  const active=state.loadouts?.[activeIndex]?.skillIds||state.equipped||[];
  const equipped=Array.isArray(active)?active:[];
  const enabledSkills=(book.skills||[]).filter(skill=>skill.unlocked);
  const activeSkill=enabledSkills.find(skill=>equipped.includes(skill.id))||null;
  const anticipation=manualAnticipation(book,rules.totalExpForLevel);
  const missingRealm=anticipation?.status==='realm';
  const upcoming=anticipation&&!missingRealm&&anticipation.status!=='pending'
    ?Math.max(0,Math.trunc(anticipation.remaining)):null;
  const kills=upcoming>0?Math.ceil(upcoming/enemyRealm.exp):null;
  const path=activeSkill?'ready':enabledSkills.length?'needs-loadout':'locked';
  const action=path==='ready'?'battle':path==='needs-loadout'?'loadout':'skills';
  const title=missingRealm?'先突破修士境界':
    anticipation?'朝下一招的門檻前進':
    Number(book.level)>=10?'圓滿之後，精進已領悟招式':'持續鍛鍊功法';
  const nextGoal=missingRealm?
    '功法等級已達成，仍需符合'+anticipation.realmName+'境門檻':
    anticipation?('距 Lv. '+anticipation.targetLevel+' 還差 '+formatAmount(anticipation.remaining)+' EXP'):
    Number(book.level)>=10?'功法已達 Lv. 10':'可持續累積功法修煉經驗';
  return {
    bookId:book.id,bookName:book.name,school:book.school,
    stage,enemyRealm:enemyRealm.name,xpPerKill:Number(enemyRealm.exp),
    targetSkill:anticipation?.skillName||null,
    targetLevel:anticipation?.targetLevel||null,
    remaining:upcoming,estimatedKills:kills,
    path,action,activeSkillName:activeSkill?.name||null,
    activeLoadout:activeIndex,activeLoadoutName:state.loadouts?.[activeIndex]?.name||('配置 '+(activeIndex+1)),
    title,nextGoal,unlockedSkills:enabledSkills.length
  };
}

export function renderManualExpedition(guide,{esc,bookArt}={}) {
  if(!guide)return '';
  const safe=typeof esc==='function'?esc:value=>String(value??'');
  const artwork=typeof bookArt==='function'?bookArt:()=>null;
  const cover=artwork(guide.bookId);
  const art=cover?
    `<img src="${safe(cover)}" alt="" loading="lazy" decoding="async">`:
    '<i class="fa-solid fa-scroll" aria-hidden="true"></i>';
  const canBattle=guide.path==='ready';
  const actionText=canBattle?'前往問道試煉':guide.action==='skills'?'查看招式解鎖條件':'前往配置招式';
  const caption=canBattle?
    `已在使用中的「${safe(guide.activeLoadoutName)}」裝備 ${safe(guide.activeSkillName)}`:
    guide.path==='locked'?'此功法目前沒有符合條件的已領悟招式，需先提升修煉進度或境界':
    `目前使用中的「${safe(guide.activeLoadoutName)}」尚未裝備這本功法的招式`;
  const estimate=guide.estimatedKills?
    `<strong>約 ${formatAmount(guide.estimatedKills)} 次</strong><small>以本關對應境界的靈獸、皆由此功法完成擊殺估算</small>`:
    '<strong>—</strong><small>已達等級門檻，或目前沒有下一個招式等級目標</small>';
  return `<section class="manual-expedition manual-expedition--${guide.school==='body'?'body':'sword'}"
    data-manual-expedition data-manual-expedition-book="${safe(guide.bookId)}"
    aria-label="下一場修煉作戰指引">
    <div class="manual-expedition-heading">
      <span class="manual-expedition-eyebrow">修煉懸賞 · 下一場試煉</span>
      <h3><i class="fa-solid fa-compass" aria-hidden="true"></i> ${safe(guide.title)}</h3>
    </div>
    <div class="manual-expedition-main">
      <div class="manual-expedition-book">
        <span class="manual-expedition-cover">${art}</span>
        <div class="manual-expedition-book-copy">
          <small>目前修煉功法</small>
          <strong>${safe(guide.bookName)}</strong>
          <span>${safe(guide.nextGoal)}</span>
        </div>
      </div>
      <div class="manual-expedition-forecast">
        <div><small>下一關</small><strong>第 ${formatAmount(guide.stage)} 關</strong></div>
        <div><small>對應靈獸境界</small><strong>${safe(guide.enemyRealm)}境</strong></div>
        <div><small>功法擊殺 EXP</small><strong>+${formatAmount(guide.xpPerKill)} <em>／隻</em></strong></div>
        <div class="manual-expedition-kills"><small>距等級門檻估計</small>${estimate}</div>
      </div>
    </div>
    <div class="manual-expedition-footer">
      <div class="manual-expedition-readiness ${canBattle?'is-ready':'is-not-ready'}">
        <i class="fa-solid ${canBattle?'fa-circle-check':'fa-circle-info'}" aria-hidden="true"></i>
        <span>${caption}</span>
      </div>
      <button type="button" class="manual-expedition-action"
        data-manual-expedition-action="${guide.action}" data-manual-expedition-id="${safe(guide.bookId)}">
        ${actionText} <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
      </button>
    </div>
    <p class="manual-expedition-disclaimer">依下一關與現有功法規則估算；只有以該功法完成擊殺才取得對應 EXP。
      戰場無法自行指定靈獸境界，實際收穫依出現的靈獸與伺服器結算為準。</p>
  </section>`;
}
