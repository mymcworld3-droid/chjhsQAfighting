// Stamina cultivation loadout view. All decisions remain server-authoritative.
// This module only renders acquired, unlocked skills and calculates draft slot edits.
export function selectSkillForSlot(ids, slotIndex, skillId, moveIdOf) {
  if(!Array.isArray(ids)||!Number.isInteger(slotIndex)||slotIndex<0||slotIndex>2
    ||typeof skillId!=='string'||!skillId)return null;
  const result=ids.filter(id=>typeof id==='string').slice(0,3);
  const move=moveIdOf(skillId);
  if(!move)return null;
  const existingIndex=result.findIndex(id=>moveIdOf(id)===move);
  if(existingIndex===slotIndex) {
    result[slotIndex]=skillId;
  } else if(existingIndex>=0) {
    if(slotIndex<result.length) {
      // Reposition an equipped technique by swapping slots. Preserve three slots.
      result[existingIndex]=result[slotIndex];
      result[slotIndex]=skillId;
    } else {
      result.splice(existingIndex,1);
      result.push(skillId);
    }
  } else if(slotIndex<result.length) {
    result[slotIndex]=skillId;
  } else if(result.length<3) {
    result.push(skillId);
  } else return null;
  return new Set(result.map(moveIdOf)).size===result.length?result:null;
}

export function renderManualLoadout(state, selectedIndex, pickerSlot, {esc,skillArt,moveIdOf}) {
  const presets=Array.isArray(state?.loadouts)?state.loadouts.slice(0,3):[];
  const selected=Number.isInteger(selectedIndex)&&selectedIndex>=0&&selectedIndex<presets.length
    ?selectedIndex:Math.max(0,Math.min(presets.length-1,Number(state?.activeLoadout)||0));
  const preset=presets[selected]||{name:'配置一',skillIds:[]};
  const equipped=Array.isArray(preset.skillIds)?preset.skillIds:[];
  const activeIndex=Number(state?.activeLoadout)||0;
  const active=selected===activeIndex;
  const owned=(state?.library||[]).filter(book=>book.owned);
  const available=owned.flatMap(book=>book.skills.filter(skill=>skill.unlocked).map(skill=>({
    ...skill,bookName:book.name,bookSchool:book.school
  })));
  const byId=new Map(available.map(skill=>[skill.id,skill]));
  const format=value=>Math.max(0,Math.round(Number(value)||0)).toLocaleString('zh-TW');
  const icon=school=>school==='sword'?'fa-khanda':'fa-hand-fist';
  const displayName=value=>String(value||'未命名配置');
  const presetTabs=presets.map((item,i)=>{
    const chosen=i===selected,onField=i===activeIndex,count=Array.isArray(item.skillIds)?item.skillIds.length:0;
    return `<button type="button" data-loadout-select="${i}"
      class="manual-deck-tab ${chosen?'is-selected':''} ${onField?'is-active':''}"
      aria-pressed="${chosen}" aria-label="查看${esc(displayName(item.name))}，${count}招，${onField?'目前使用中':'未套用'}">
      <span class="manual-deck-tab-index">第 ${i+1} 組</span>
      <strong>${esc(displayName(item.name))}</strong>
      <span class="manual-deck-tab-bottom">
        <small>${count} / 3 招</small><small>${onField?'● 使用中':chosen?'● 正在編輯':'點選查看'}</small>
      </span></button>`;
  }).join('');
  const slotCards=Array.from({length:3},(_,i)=>{
    const id=equipped[i];
    const skill=byId.get(id);
    const art=skill?skillArt(skill):'';
    const filled=!!skill;
    const artMarkup=filled
      ?`<img class="manual-slot-art" src="${esc(art)}" alt="" loading="lazy" decoding="async">`
      :'<i class="fa-solid fa-plus" aria-hidden="true"></i>';
    const name=filled?skill.name:'空白技能槽';
    const description=filled?`${skill.bookName} · 招式 Lv. ${format(skill.level)}`:
      '點此選擇已領悟的招式';
    const cost=filled?`${format(skill.cost)} 體力`:'尚未裝備';
    return `<div class="manual-slot ${filled?'is-active':'is-empty'} ${pickerSlot===i?'is-editing':''}"
      data-manual-slot="${i}">
      <button type="button" class="manual-slot-pick" data-manual-pick-slot="${i}"
        aria-expanded="${pickerSlot===i}" aria-label="${filled?'替換':'設定'}第${i+1}格技能，${esc(name)}">
        <span class="manual-slot-topline"><span>招式 ${String(i+1).padStart(2,'0')}</span>
          <span class="manual-slot-change"><i class="fa-solid ${filled?'fa-rotate':'fa-plus'}" aria-hidden="true"></i> ${filled?'替換':'選擇'}</span>
        </span>
        <span class="manual-slot-art-frame ${filled?'is-filled':''}">${artMarkup}</span>
        <span class="manual-slot-meta"><strong>${esc(name)}</strong>
          <small>${esc(description)}</small></span>
        <span class="manual-slot-bottom"><small>${esc(cost)}</small>
          <span class="manual-slot-school">${filled?esc(skill.bookSchool==='sword'?'劍修':'體修'):'空位'}</span></span>
      </button>
      ${filled?`<button type="button" class="manual-slot-remove" data-manual-remove="${esc(id)}"
        aria-label="卸下第${i+1}格的${esc(name)}">
        <i class="fa-solid fa-xmark" aria-hidden="true"></i> 卸下</button>`:''}
    </div>`;
  }).join('');

  const pickerVisible=Number.isInteger(pickerSlot)&&pickerSlot>=0&&pickerSlot<=2;
  const picker=pickerVisible?(()=>{
    const candidateCards=available.map(skill=>{
      const index=equipped.findIndex(id=>moveIdOf(id)===moveIdOf(skill.id));
      const isHere=index===pickerSlot,isElsewhere=index>=0&&!isHere;
      const art=skillArt(skill);
      return `<button type="button" class="manual-pick-skill
        ${isHere?'is-current':''} ${isElsewhere?'is-elsewhere':''}"
        data-manual-pick-skill="${esc(skill.id)}"
        aria-label="${esc(skill.name)}，${esc(skill.bookName)}，${isHere?'目前位於本欄':isElsewhere?'將與第'+(index+1)+'格交換':'裝備到第'+(pickerSlot+1)+'格'}">
        <span class="manual-pick-art"><img src="${esc(art)}" alt="" loading="lazy" decoding="async"></span>
        <span class="manual-pick-info">
          <strong>${esc(skill.name)}</strong>
          <small>${esc(skill.bookName)} · Lv. ${format(skill.level)}</small>
          <small>${format(skill.cost)} 體力</small>
        </span>
        <span class="manual-pick-status">${isHere?'目前裝備':isElsewhere?'交換位置':'選用'}</span>
      </button>`;
    }).join('');
    return `<div class="manual-picker" data-manual-picker role="region"
        aria-label="為第${pickerSlot+1}格選擇技能">
      <div class="manual-picker-heading"><div>
        <span class="manual-picker-eyebrow">招式寶庫 · 第 ${pickerSlot+1} 格</span>
        <h4>選擇要裝備的招式</h4>
      </div><button type="button" class="manual-picker-close" data-manual-close-picker
        aria-label="關閉招式選擇"><i class="fa-solid fa-xmark" aria-hidden="true"></i> 收起</button>
      </div>
      <p class="manual-picker-hint">只能選擇已領悟且符合境界的招式。同類招式不會重複裝備；已裝備招式可互換位置。</p>
      <div class="manual-picker-grid">${candidateCards||
        '<div class="manual-picker-empty">目前沒有可裝備的招式。可先提升功法等級或修士境界。</div>'}</div>
    </div>`;
  })():'';

  return `<section class="manual-loadout" aria-label="戰場技能配置">
    <div class="manual-deck-heading">
      <div><span class="manual-deck-kicker">戰前準備 · SKILL LOADOUT</span>
        <h3><i class="fa-solid fa-layer-group" aria-hidden="true"></i> 戰場技能配置</h3>
        <p>三組戰術方案，最多裝備三招。選擇配置後，需要按「套用」才會切換戰場技能。</p>
      </div>
      <span class="manual-deck-count"><strong>${equipped.length}<small> / 3</small></strong><span>已裝備招式</span></span>
    </div>
    <div class="manual-presets" role="group" aria-label="功法配置">${presetTabs}</div>
    <div class="manual-deck-workspace">
      <div class="manual-deck-toolbar">
        <div class="manual-deck-edit-name"><label for="manual-loadout-name">配置名稱</label>
          <div class="manual-deck-name-row"><input id="manual-loadout-name" data-loadout-name
            maxlength="20" value="${esc(preset.name||'')}"
            placeholder="為這組戰術命名" aria-label="編輯目前配置名稱">
            <button type="button" data-loadout-rename><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> 儲存名稱</button></div>
        </div>
        <div class="manual-deck-apply">
          <span class="manual-deck-state ${active?'is-live':'is-draft'}">
            <i class="fa-solid ${active?'fa-circle-check':'fa-eye'}" aria-hidden="true"></i>
            ${active?'這組正在使用':'正在編輯未使用的配置'}
          </span>
          <button type="button" data-loadout-apply ${active?'disabled':''}>
            <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
            ${active?'目前使用中':'套用此配置'}</button>
        </div>
      </div>
      <div class="manual-deck-slots-header"><strong>招式裝備欄</strong>
        <small>點擊技能卡可直接替換 · 不需拖曳</small></div>
      <div class="manual-slot-grid">${slotCards}</div>
      <div class="manual-deck-feedback" data-manual-loadout-status role="status" aria-live="polite"></div>
      ${picker}
    </div>
  </section>`;
}
