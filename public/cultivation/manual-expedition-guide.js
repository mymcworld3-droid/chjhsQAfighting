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
  const noun=book.weaponType?'武器':'功法';
  const title=missingRealm?'先突破修士境界':
    anticipation?'朝下一招的門檻前進':
    Number(book.level)>=20?`${noun}圓滿，精進已領悟招式`:Number(book.level)>=10?`第三招門檻已達，繼續淬鍊${noun}`:`持續鍛鍊${noun}`;
  const nextGoal=missingRealm?
    noun+'等級已達成，仍需符合'+anticipation.realmName+'境門檻':
    anticipation?('距 Lv. '+anticipation.targetLevel+' 還差 '+formatAmount(anticipation.remaining)+' EXP'):
    Number(book.level)>=20?`${noun}已達 Lv. 20`:Number(book.level)>=10?'可繼續修煉至 Lv. 20，增加攻擊力':`可持續累積${noun}修煉經驗`;
  return {
    bookId:book.id,bookName:book.name,school:book.school,weaponType:book.weaponType||null,
    stage,enemyRealm:enemyRealm.name,xpPerKill:Number(enemyRealm.exp),
    targetSkill:anticipation?.skillName||null,
    targetLevel:anticipation?.targetLevel||null,
    remaining:upcoming,estimatedKills:kills,
    path,action,activeSkillName:activeSkill?.name||null,
    activeLoadout:activeIndex,activeLoadoutName:state.loadouts?.[activeIndex]?.name||('配置 '+(activeIndex+1)),
    title,nextGoal,unlockedSkills:enabledSkills.length
  };
}

export function renderManualExpedition(guide,{esc}={}) {
  if(!guide)return '';
  const safe=typeof esc==='function'?esc:value=>String(value??'');
  const noun=guide.weaponType?'武器':'功法';
  const actionText=guide.action==='battle'?'前往問道試煉':
    guide.action==='skills'?'查看招式解鎖條件':'前往裝備武器';
  const estimate=guide.estimatedKills?
    `<strong>約 ${formatAmount(guide.estimatedKills)} 次</strong>
     <span>皆由此${noun}完成擊殺估算，並非保證次數</span>`:
    '<span>已達等級門檻，或目前沒有下一個招式等級目標</span>';
  const readiness=guide.path==='ready'?
    `使用中的「${safe(guide.activeLoadoutName)}」已裝備 ${safe(guide.activeSkillName)}`:
    guide.path==='needs-loadout'?
      `使用中的「${safe(guide.activeLoadoutName)}」尚未裝備此${noun}招式`:
      '目前尚無符合條件的已領悟招式，請先提升修煉等級或境界';
  return `<section class="manual-expedition manual-expedition--${guide.school==='body'?'body':'sword'}"
    data-manual-expedition data-manual-expedition-book="${safe(guide.bookId)}"
    aria-label="下一場問道試煉">
    <div class="manual-expedition-strip">
      <div class="manual-expedition-summary">
        <span class="manual-expedition-eyebrow"><i class="fa-solid fa-compass" aria-hidden="true"></i> 下一場試煉</span>
        <strong>第 ${formatAmount(guide.stage)} 關 · ${safe(guide.enemyRealm)}境</strong>
        <span class="manual-expedition-reward">武器擊殺 <b>+${formatAmount(guide.xpPerKill)} EXP</b>／隻</span>
      </div>
      <button type="button" class="manual-expedition-action"
        data-manual-expedition-action="${guide.action}" data-manual-expedition-id="${safe(guide.bookId)}">
        ${actionText} <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
      </button>
    </div>
    <details class="manual-expedition-more">
      <summary>查看擊殺估算與出戰條件</summary>
      <div class="manual-expedition-advanced">
        <p><strong>目前出戰狀態：</strong>${readiness}</p>
        <p><strong>下一招等級目標：</strong>${safe(guide.nextGoal)}</p>
        <p><strong>距等級門檻估計：</strong>${estimate}</p>
        <small>依下一關與現有${noun}規則估算；只有以該${noun}完成擊殺才取得對應 EXP。
          戰場無法自行指定靈獸境界，實際收穫依出現的靈獸與伺服器結算為準。</small>
      </div>
    </details>
  </section>`;
}
