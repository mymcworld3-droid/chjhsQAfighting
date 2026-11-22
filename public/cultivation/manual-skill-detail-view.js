// A single skill-details surface for the selected, already-owned manual.
// The same server-validated equip/upgrade handlers are used by the main page.
export function renderManualSkillDetail(book,skillId,{esc,skillArt,descriptionWithDamage,attack=200,gold=0,equipped=[],moveIdOf,weaponIds=null}={}){
  const skill=book?.skills?.find(item=>item.id===skillId);
  if(!book?.owned||!skill)return '';
  const fmt=value=>Math.max(0,Math.round(Number(value)||0)).toLocaleString('zh-TW');
  const art=skillArt(skill);
  const other=equipped.find(id=>moveIdOf(id)===moveIdOf(skill.id));
  const full=!other&&equipped.length>=3;
  const locked=!skill.unlocked;
  const missing=[
    !skill.mastered?'功法 Lv. '+skill.levelRequired:null
  ].filter(Boolean);
  const upgrade=skill.upgrade;
  const gain=skill.kind==='fist-focus'?'每級降低 1 體力':'每級提高 10% 基礎傷害';
  const upgradeAction=!locked&&upgrade?
    `<button type="button" class="manual-upgrade" data-skill-upgrade="${esc(skill.id)}" ${Number(gold)<Number(upgrade.gold)?'disabled':''}>
      ${Number(gold)<Number(upgrade.gold)?'靈石不足 · ':''}強化至 Lv. ${fmt(upgrade.targetLevel)} · ${fmt(upgrade.gold)} 靈石</button>`:'';
  const weaponMode=Array.isArray(weaponIds);
  const worn=weaponMode&&weaponIds.includes(book.id);
  const equipment=weaponMode?
    (locked?`<p class="manual-focus-skill-lock">尚需 ${esc(missing.join('、')||'符合領悟條件')}</p>`:
      `<button type="button" data-manual-equip="${esc(skill.id)}" ${worn?'disabled':''}>
        ${worn?'此武器已裝備':'裝備整件武器（三招自動啟用）'}</button>`):
    locked?
    `<p class="manual-focus-skill-lock"><i class="fa-solid fa-lock" aria-hidden="true"></i>
      尚需 ${esc(missing.join('、')||'符合領悟條件')}</p>`:
    `<button type="button" data-manual-equip="${esc(skill.id)}" ${other===skill.id||full?'disabled':''}>
      ${other===skill.id?'此配置已裝備':other?'改用本功法版本':full?'配置已滿，請先卸下技能':'裝備到所選配置'}
    </button>`;
  return `<section class="manual-focus-skill ${locked?'is-locked':'is-learned'}"
    data-manual-skill="${esc(skill.id)}" aria-label="${esc(skill.name)}招式詳細資料">
    <div class="manual-focus-skill-head">
      <span class="manual-focus-skill-title">招式詳情 · 第 ${book.skills.indexOf(skill)+1} 招</span>
      <button type="button" data-manual-close-skill aria-label="關閉招式詳細資料">
        <i class="fa-solid fa-xmark" aria-hidden="true"></i> 收起
      </button>
    </div>
    <div class="manual-focus-skill-main">
      ${art?`<img class="manual-skill-art" src="${esc(art)}" alt="" loading="lazy" decoding="async">`:''}
      <div class="manual-focus-skill-info">
        <strong>${esc(skill.name)}${skill.unlocked?' · Lv. '+fmt(skill.level):''}</strong>
        <small>${fmt(skill.cost)} 體力 · ${skill.unlimited?'無固定射程':fmt(skill.range)+' 格'}</small>
        <p>${esc(descriptionWithDamage(attack,skill))}</p>
      </div>
    </div>
    ${!locked?`<small class="manual-focus-skill-benefit">${esc(gain)}</small>`:''}
    <div class="manual-focus-skill-actions">${equipment}
      ${upgradeAction}
      ${!locked&&!upgrade?'<span class="manual-focus-skill-max">招式已滿級</span>':''}
    </div>
  </section>`;
}
