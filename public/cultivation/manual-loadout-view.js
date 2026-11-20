// Stamina cultivation loadout view. All decisions remain server-authoritative.
// This module only renders acquired, unlocked skills and calculates draft slot edits.
export function selectSkillForSlot(ids, slotIndex, skillId, moveIdOf) {
  if(!Array.isArray(ids)||!Number.isInteger(slotIndex)||slotIndex<0||slotIndex>2
    ||typeof skillId!=='string'||!skillId)return null;
  const result=ids.filter(id=>typeof id==='string').slice(0,3);
  // The server stores a compact array: the next empty position is always length.
  if(slotIndex>result.length)return null;
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

function renderLegacyManualLoadout(state, selectedIndex, pickerSlot, {esc,skillArt,moveIdOf}) {
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
    const actualSlot=Math.min(i,equipped.length);
    const skill=byId.get(id);
    const art=skill?skillArt(skill):'';
    const filled=!!skill;
    const artMarkup=filled
      ?`<img class="manual-slot-art" src="${esc(art)}" alt="" loading="lazy" decoding="async">`
      :'<i class="fa-solid fa-plus" aria-hidden="true"></i>';
    const name=filled?skill.name:'空白技能槽';
    const description=filled?`${skill.bookName} · 招式 Lv. ${format(skill.level)}`:
      (actualSlot===i?'點此選擇已領悟的招式':`將先填入第 ${actualSlot+1} 格`);
    const cost=filled?`${format(skill.cost)} 體力`:'尚未裝備';
    return `<div class="manual-slot ${filled?'is-active':'is-empty'} ${filled?'is-'+skill.bookSchool:''} ${pickerSlot===i?'is-editing':''}"
      data-manual-slot="${i}">
      <button type="button" class="manual-slot-pick" data-manual-pick-slot="${i}"
        aria-expanded="${pickerSlot===i}" aria-label="${filled?'替換第'+(i+1)+'格技能':'新增技能，將填入第'+(actualSlot+1)+'格'}，${esc(name)}">
        <span class="manual-slot-topline"><span>招式 ${String(i+1).padStart(2,'0')}</span>
          <span class="manual-slot-change"><i class="fa-solid ${filled?'fa-rotate':'fa-plus'}" aria-hidden="true"></i> ${filled?'替換':actualSlot===i?'選擇':'先補空欄'}</span>
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
      const isHere=equipped[pickerSlot]===skill.id;
      const isAlternative=index===pickerSlot&&!isHere,isElsewhere=index>=0&&index!==pickerSlot;
      const art=skillArt(skill);
      return `<button type="button" class="manual-pick-skill
        ${isHere?'is-current':''} ${isElsewhere?'is-elsewhere':''}"
        data-manual-pick-skill="${esc(skill.id)}"
        aria-label="${esc(skill.name)}，${esc(skill.bookName)}，${isHere?'目前位於本欄':isAlternative?'改用此功法版本':isElsewhere?'將與第'+(index+1)+'格交換':'裝備到第'+(pickerSlot+1)+'格'}">
        <span class="manual-pick-art"><img src="${esc(art)}" alt="" loading="lazy" decoding="async"></span>
        <span class="manual-pick-info">
          <strong>${esc(skill.name)}</strong>
          <small>${esc(skill.bookName)} · Lv. ${format(skill.level)}</small>
          <small>${format(skill.cost)} 體力</small>
        </span>
        <span class="manual-pick-status">${isHere?'目前裝備':isAlternative?'切換來源':isElsewhere?'交換位置':'選用'}</span>
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
      </div>
    </div>
    <div class="manual-presets" role="group" aria-label="功法配置">${presetTabs}</div>
    <div class="manual-deck-workspace">
      <div class="manual-deck-toolbar">
        <details class="manual-deck-name-settings"><summary><i class="fa-solid fa-pen" aria-hidden="true"></i> 編輯配置名稱</summary>
        <div class="manual-deck-edit-name"><label for="manual-loadout-name">配置名稱</label>
          <div class="manual-deck-name-row"><input id="manual-loadout-name" data-loadout-name
            maxlength="20" value="${esc(preset.name||'')}"
            placeholder="為這組戰術命名" aria-label="編輯目前配置名稱">
            <button type="button" data-loadout-rename><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> 儲存名稱</button></div>
        </div></details>
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
        <small>點擊技能槽可選擇或更換招式</small></div>
      <div class="manual-slot-grid">${slotCards}</div>
      <div class="manual-deck-feedback" data-manual-loadout-status role="status" aria-live="polite"></div>
      ${picker}
    </div>
  </section>`;
}

 
// Weapon-era interface. Keep the old renderer available for old snapshots and
// integration tests; current server projections always provide weaponIds.
export function renderManualLoadout(state,selectedIndex,pickerSlot,{esc,bookArt,skillArt,moveIdOf}={}){
  if(!Array.isArray(state?.weaponIds))
    return renderLegacyManualLoadout(state,selectedIndex,pickerSlot,{esc,skillArt,moveIdOf});
  const slots=state.weaponIds.slice(0,3),owned=(state.library||[]).filter(book=>book.owned);
  const books=new Map(owned.map(book=>[book.id,book]));
  const selected=Number.isInteger(selectedIndex)&&selectedIndex>=0&&selectedIndex<3?selectedIndex:0;
  // The three slots are peers; there is no active/main weapon.
  const art=book=>book?
    '<span class="manual-weapon-art manual-weapon-art--'+esc(book.id)+'" role="img" aria-label="'+esc(book.name)+'"></span>':
    '<i class="fa-solid fa-plus" aria-hidden="true"></i>';
  const cards=Array.from({length:3},(_,i)=>{
    const book=books.get(slots[i]),chosen=i===selected;
    const names=(book?.skills||[]).map((skill,index)=>
      '<span class="manual-weapon-skill '+(skill.unlocked?'is-learned':'is-locked')+
      '" title="'+esc(skill.unlocked?skill.name:'Lv.'+skill.levelRequired+'／'+skill.realmName+'境解鎖')+'">'+
      '<small>'+['一','二','三'][index]+'式</small><strong>'+esc(skill.name)+'</strong>'+
      (skill.unlocked?' ✓':' 🔒')+'</span>').join('');
    return '<div class="manual-weapon-slot '+(book?'is-equipped':'is-empty')+' '+(chosen?'is-selected':'')+
      '" data-manual-slot="'+i+'">'+
      '<div class="manual-weapon-slot-top"><span>武器 '+(i+1)+'</span><span>'+
      (book?'● 已裝備':'○ 空欄')+'</span></div>'+
      '<button type="button" class="manual-weapon-slot-picker" data-manual-pick-slot="'+i+
      '" aria-expanded="'+(pickerSlot===i)+'" aria-label="'+(book?'更換':'裝備')+'第'+(i+1)+'格武器">'+
      '<span class="manual-weapon-slot-art">'+art(book)+'</span>'+
      '<span class="manual-weapon-slot-info"><strong>'+esc(book?.name||'尚未裝備武器')+'</strong>'+
      '<small>'+esc(book?((book.weaponType==='totem'?'圖騰':'靈劍')+' · Lv.'+book.level):'點擊選擇已持有武器')+'</small></span>'+
      '<i class="fa-solid fa-rotate" aria-hidden="true"></i></button>'+
      (book?'<div class="manual-weapon-skill-list">'+names+'</div>':
       '<div class="manual-weapon-slot-hint">每件武器有三招，隨武器熟練度自動解鎖</div>')+
      '<div class="manual-weapon-slot-actions">'+
      (book?'<button type="button" data-manual-remove-weapon="'+i+'">卸下</button>':'')+
      '<button type="button" data-loadout-select="'+i+
        '" class="manual-weapon-select" aria-pressed="'+chosen+'">選取此欄</button>'+
      '</div></div>';
  }).join('');
  const picked=Number.isInteger(pickerSlot)&&pickerSlot>=0&&pickerSlot<3;
  const chooser=picked?'<div class="manual-picker manual-weapon-picker" data-manual-picker>'+
    '<div class="manual-picker-heading"><div><span class="manual-picker-eyebrow">武器庫 · 第 '+(pickerSlot+1)+' 欄</span>'+
    '<h4>選擇已持有的劍或圖騰</h4></div><button type="button" class="manual-picker-close" data-manual-close-picker>收起</button></div>'+
    '<p class="manual-picker-hint">每種武器只能裝備一次；各武器的三招會隨熟練等級與境界自動開放。</p>'+
    '<div class="manual-weapon-choice-grid">'+owned.map(book=>{
      const inSlot=slots.indexOf(book.id),chosen=inSlot===pickerSlot;
      return '<button type="button" class="manual-weapon-choice '+(chosen?'is-current':'')+
        '" data-manual-pick-weapon="'+esc(book.id)+'" data-manual-target-slot="'+pickerSlot+
        '" '+(inSlot>=0&&!chosen?'disabled':'')+'><span class="manual-weapon-choice-art">'+art(book)+'</span>'+
        '<span><strong>'+esc(book.name)+'</strong><small>'+esc(book.weaponType==='totem'?'圖騰':'劍')+
        ' · Lv. '+book.level+' · '+book.skills.filter(s=>s.unlocked).length+'/3 招</small></span>'+
        '<em>'+ (chosen?'目前裝備':inSlot>=0?'已裝備於第 '+(inSlot+1)+' 欄':'裝備')+'</em></button>';
    }).join('')+'</div></div>':'';
  return '<section class="manual-loadout manual-weapons" aria-label="三種武器裝備">'+
    '<div class="manual-deck-heading"><div><span class="manual-deck-kicker">戰前準備 · WEAPON LOADOUT</span>'+
    '<h3><i class="fa-solid fa-khanda" aria-hidden="true"></i> 武器裝備</h3></div>'+
    '<small>三種武器地位相同，沒有主武器。單人模式可隨時卸下或裝備。</small></div>'+
    '<div class="manual-weapon-grid">'+cards+'</div>'+
    '<div class="manual-deck-feedback" data-manual-loadout-status role="status" aria-live="polite"></div>'+
    chooser+'</section>';
}
