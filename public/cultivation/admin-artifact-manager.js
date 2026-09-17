import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
  ARTIFACT_CATALOG,
  ARTIFACT_REALMS,
  SUPPORTED_ARTIFACT_EFFECTS,
  normalizeArtifactDefinition,
  replaceArtifactCatalog,
  validateArtifactCatalog
} from './artifact-catalog.js';

(function () {
  'use strict';

  const PANEL_ID = 'admin-artifact-manager';
  const MODAL_ID = 'admin-artifact-modal';
  const CONFIG_COLLECTION = 'gameConfig';
  const CONFIG_DOC = 'artifactCatalogV1';
  const ARTIFACT_CATEGORIES = Object.freeze(['消耗法寶', '裝備法寶']);
  const EFFECT_GUIDE = Object.freeze({
    equip_attack_flat: { title: '固定攻擊', summary: '裝備後固定增加攻擊力', hint: '例如：+80 攻擊', icon: 'fa-sword' },
    equip_attack_percent: { title: '百分比攻擊', summary: '裝備後按比例提高攻擊力', hint: '例如：0.2 = +20%', icon: 'fa-chart-line' },
    equip_hp_flat: { title: '固定生命', summary: '裝備後固定增加生命上限', hint: '例如：+400 生命', icon: 'fa-heart' },
    equip_hp_percent: { title: '百分比生命', summary: '裝備後按比例提高生命上限', hint: '例如：0.2 = +20%', icon: 'fa-heart-pulse' },
    timed_attack_multiplier: { title: '限時攻擊倍率', summary: '催動後一段時間提高鬥法攻擊', hint: '設定倍率與持續分鐘', icon: 'fa-bolt' },
    timed_cultivation_multiplier: { title: '限時修為倍率', summary: '催動後一段時間提高答對所得修為', hint: '設定倍率與持續分鐘', icon: 'fa-fire-flame-curved' },
    remove_wrong_option: { title: '排除錯誤選項', summary: '作答前移除一個錯誤選項', hint: '可選問道／鬥法／洞天', icon: 'fa-wand-sparkles' }
  });
  let busy = false;

  function data() { return window.getCurrentUserData?.() || null; }
  function isAdmin() { return data()?.isAdmin === true; }
  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function toast(message, ok = true) {
    document.getElementById('admin-artifact-toast')?.remove();
    const el = document.createElement('div');
    el.id = 'admin-artifact-toast';
    el.textContent = message;
    el.style.cssText = `position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:12050;padding:10px 15px;border-radius:999px;background:rgba(8,8,8,.97);border:1px solid ${ok ? 'rgba(216,177,93,.55)' : 'rgba(248,113,113,.55)'};color:${ok ? '#f5dfa7' : '#fecaca'};font-size:10px;font-weight:900;box-shadow:0 15px 45px rgba(0,0,0,.55)`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  function effectLabel(effect) {
    const labels = {
      equip_attack_flat: `攻擊 +${Number(effect.value) || 0}`,
      equip_attack_percent: `攻擊 +${Math.round((Number(effect.value) || 0) * 100)}%`,
      equip_hp_flat: `生命 +${Number(effect.value) || 0}`,
      equip_hp_percent: `生命 +${Math.round((Number(effect.value) || 0) * 100)}%`,
      timed_attack_multiplier: `限時攻擊 ×${Number(effect.multiplier) || 1}`,
      timed_cultivation_multiplier: `限時修為 ×${Number(effect.multiplier) || 1}`,
      remove_wrong_option: `排除錯項 · ${(effect.contexts || []).join('/')}`
    };
    return labels[effect.type] || effect.type;
  }

  function defaultEffect(type) {
    if (['equip_attack_flat', 'equip_attack_percent', 'equip_hp_flat', 'equip_hp_percent'].includes(type)) return { type, value: 0 };
    if (type === 'timed_attack_multiplier' || type === 'timed_cultivation_multiplier') return { type, multiplier: 1.5, durationMs: 10 * 60 * 1000 };
    if (type === 'remove_wrong_option') return { type, contexts: ['quiz', 'battle', 'dongtian'], perQuestion: 1 };
    return { type };
  }

  function categoryOptions(current) {
    const value = String(current || '消耗法寶').trim() || '消耗法寶';
    const options = [...ARTIFACT_CATEGORIES];
    if (!options.includes(value)) options.push(value);
    return options.map((category) => `<option value="${escapeHtml(category)}" ${category === value ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('');
  }

  function effectGuideMarkup() {
    return SUPPORTED_ARTIFACT_EFFECTS.map((type) => {
      const guide = EFFECT_GUIDE[type] || { title: type, summary: '通用法寶效果', hint: type, icon: 'fa-wand-magic-sparkles' };
      return `<button type="button" class="aam-guide-item" data-aam-add-effect-type="${escapeHtml(type)}"><span class="aam-guide-icon"><i class="fa-solid ${escapeHtml(guide.icon)}"></i></span><span class="aam-guide-copy"><b>${escapeHtml(guide.title)}</b><span>${escapeHtml(guide.summary)}</span><small>${escapeHtml(guide.hint)}</small></span><span class="aam-guide-add"><i class="fa-solid fa-plus"></i></span></button>`;
    }).join('');
  }

  function ensureStyle() {
    if (document.getElementById('admin-artifact-manager-style')) return;
    const style = document.createElement('style');
    style.id = 'admin-artifact-manager-style';
    style.textContent = `
      #${PANEL_ID}{padding:14px;border:1px solid rgba(216,177,93,.2);border-radius:16px;background:linear-gradient(145deg,rgba(21,17,10,.94),rgba(7,7,7,.97))}
      .aam-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.aam-head h3{margin:0;color:#f3e5c3;font-size:14px}.aam-head p{margin:3px 0 0;color:#8e816b;font-size:8px;line-height:1.5}.aam-add{min-height:36px;padding:0 12px;border-radius:11px;border:1px solid rgba(216,177,93,.38);background:rgba(216,177,93,.09);color:#f1d895;font-size:9px;font-weight:900}
      .aam-list{display:grid;gap:7px}.aam-item{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:9px;align-items:center;padding:9px;border:1px solid rgba(255,255,255,.07);border-radius:13px;background:rgba(255,255,255,.018)}.aam-icon{width:38px;height:38px;display:grid;place-items:center;border-radius:11px;border:1px solid rgba(216,177,93,.25);color:#f0d17a;background:#171005;font-weight:900}.aam-copy{min-width:0}.aam-copy strong{color:#eee1c7;font-size:10px}.aam-meta{margin-top:3px;color:#887a63;font-size:7px}.aam-effects{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px}.aam-effects span{padding:2px 5px;border-radius:999px;background:rgba(216,177,93,.05);color:#baa77d;font-size:6px}.aam-edit{min-height:32px;padding:0 10px;border-radius:9px;border:1px solid rgba(216,177,93,.22);background:rgba(216,177,93,.05);color:#dbc078;font-size:8px;font-weight:900}
      .aam-modal{position:fixed;inset:0;z-index:12000;display:grid;place-items:center;padding:14px;background:rgba(0,0,0,.82);backdrop-filter:blur(8px)}.aam-card{width:min(100%,1080px);max-height:92dvh;overflow:auto;padding:18px;border:1px solid rgba(216,177,93,.28);border-radius:20px;background:linear-gradient(145deg,#18130c,#080808);box-shadow:0 30px 100px rgba(0,0,0,.72)}.aam-card h3{margin:0 0 4px;color:#f3e7ca;font-size:15px}.aam-note{margin:0 0 12px;color:#8f826d;font-size:8px;line-height:1.65}.aam-editor-layout{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:16px;align-items:start}.aam-editor-main{min-width:0}.aam-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.aam-field{display:grid;gap:4px}.aam-field.full{grid-column:1/-1}.aam-field label{color:#9a8d75;font-size:7px;font-weight:900}.aam-field input,.aam-field select,.aam-field textarea{width:100%;min-height:38px;padding:8px 9px;border:1px solid rgba(216,177,93,.16);border-radius:10px;background:#0a0908;color:#eadfc8;font-size:9px;outline:none}.aam-field textarea{min-height:76px;resize:vertical}.aam-field input:focus,.aam-field select:focus,.aam-field textarea:focus{border-color:rgba(216,177,93,.5)}
      .aam-effects-editor{display:grid;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.07)}.aam-effects-head{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#d7bb77;font-size:9px;font-weight:900}.aam-effect-row{padding:9px;border:1px solid rgba(255,255,255,.07);border-radius:12px;background:rgba(255,255,255,.016)}.aam-effect-main{display:grid;grid-template-columns:minmax(150px,1.2fr) repeat(3,minmax(85px,1fr)) auto;gap:6px;align-items:end}.aam-effect-main label,.aam-contexts label{display:grid;gap:3px;color:#857963;font-size:6px}.aam-effect-main input,.aam-effect-main select{min-height:34px;padding:6px;border:1px solid rgba(216,177,93,.14);border-radius:9px;background:#090807;color:#e5d8bd;font-size:8px}.aam-remove-effect{width:32px;height:32px;border-radius:9px;border:1px solid rgba(248,113,113,.2);background:rgba(127,29,29,.12);color:#fca5a5}.aam-contexts{display:flex;gap:10px;flex-wrap:wrap;margin-top:7px}.aam-contexts label{display:flex;align-items:center;gap:4px}.aam-contexts input{accent-color:#d8b15d}.aam-add-effect{min-height:32px;padding:0 10px;border-radius:9px;border:1px dashed rgba(216,177,93,.28);background:transparent;color:#cbae68;font-size:8px;font-weight:900}
      .aam-guide{position:sticky;top:0;padding:13px;border:1px solid rgba(216,177,93,.18);border-radius:16px;background:linear-gradient(160deg,rgba(31,24,13,.9),rgba(8,8,8,.96))}.aam-guide h4{margin:0;color:#efd99e;font-size:11px}.aam-guide>p{margin:4px 0 10px;color:#887b65;font-size:7px;line-height:1.55}.aam-guide-list{display:grid;gap:6px}.aam-guide-item{width:100%;display:grid;grid-template-columns:32px minmax(0,1fr) 24px;gap:8px;align-items:center;padding:8px;border:1px solid rgba(216,177,93,.12);border-radius:11px;background:rgba(255,255,255,.018);text-align:left;transition:.15s}.aam-guide-item:hover{border-color:rgba(216,177,93,.42);background:rgba(216,177,93,.07)}.aam-guide-icon{width:30px;height:30px;display:grid;place-items:center;border-radius:9px;background:rgba(216,177,93,.08);color:#daba6b}.aam-guide-copy{display:grid;gap:2px;min-width:0}.aam-guide-copy b{color:#e6d8b8;font-size:8px}.aam-guide-copy span{color:#998b72;font-size:7px;line-height:1.4}.aam-guide-copy small{color:#6f6555;font-size:6px}.aam-guide-add{display:grid;place-items:center;color:#c8a958;font-size:8px}.aam-guide-note{margin-top:10px;padding:8px;border-radius:10px;background:rgba(216,177,93,.045);color:#8e816b;font-size:6px;line-height:1.6}.aam-guide-note b{color:#c9ad69}
      .aam-actions{display:flex;gap:8px;margin-top:14px}.aam-actions button{flex:1;min-height:40px;border-radius:11px;font-size:9px;font-weight:900}.aam-cancel{border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:#aaa}.aam-save{border:1px solid rgba(216,177,93,.4);background:linear-gradient(135deg,#8f651e,#4b2f09);color:#fff0bd}.aam-save:disabled{opacity:.45}
      @media(max-width:880px){.aam-editor-layout{grid-template-columns:1fr}.aam-guide{position:static;order:-1}.aam-guide-list{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:620px){.aam-item{grid-template-columns:38px minmax(0,1fr)}.aam-edit{grid-column:1/-1;width:100%}.aam-grid{grid-template-columns:1fr}.aam-field.full{grid-column:auto}.aam-effect-main{grid-template-columns:1fr 1fr}.aam-effect-main>label:first-child{grid-column:1/-1}.aam-remove-effect{align-self:end}.aam-head{align-items:flex-start;flex-direction:column}.aam-add{width:100%}.aam-guide-list{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function render() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !isAdmin()) return;
    const list = panel.querySelector('#admin-artifact-list');
    if (!list) return;
    list.innerHTML = ARTIFACT_CATALOG.map((item) => `<article class="aam-item"><div class="aam-icon">${escapeHtml(item.icon || '◆')}</div><div class="aam-copy"><strong>${escapeHtml(item.name)}</strong><div class="aam-meta">${escapeHtml(item.id)} · ${escapeHtml(item.realm)} · ${escapeHtml(item.category || '法寶')} · 打造 ${Number(item.craft?.gold) || 0} 金幣</div><div class="aam-effects">${(item.effects || []).map((effect) => `<span>${escapeHtml(effectLabel(effect))}</span>`).join('')}</div></div><button type="button" class="aam-edit" data-admin-artifact-edit="${escapeHtml(item.id)}"><i class="fa-solid fa-pen"></i> 編輯</button></article>`).join('') || '<div class="text-gray-500 text-xs">目前沒有法寶。</div>';
  }

  function effectRow(effect = {}) {
    const type = SUPPORTED_ARTIFACT_EFFECTS.includes(effect.type) ? effect.type : SUPPORTED_ARTIFACT_EFFECTS[0];
    const minutes = Math.max(1 / 60, (Number(effect.durationMs) || 60000) / 60000);
    const contexts = Array.isArray(effect.contexts) ? effect.contexts : ['quiz', 'battle', 'dongtian'];
    const row = document.createElement('div');
    row.className = 'aam-effect-row';
    row.innerHTML = `<div class="aam-effect-main"><label>效果類型<select data-aam-effect-type>${SUPPORTED_ARTIFACT_EFFECTS.map((value) => `<option value="${value}" ${value === type ? 'selected' : ''}>${escapeHtml(EFFECT_GUIDE[value]?.title || value)}</option>`).join('')}</select></label><label data-aam-value-field>數值<input data-aam-effect-value type="number" step="0.01" value="${Number(effect.value) || 0}"></label><label data-aam-multiplier-field>倍率<input data-aam-effect-multiplier type="number" min="0.01" step="0.05" value="${Number(effect.multiplier) || 1}"></label><label data-aam-duration-field>分鐘<input data-aam-effect-duration type="number" min="0.02" step="0.5" value="${minutes}"></label><button type="button" class="aam-remove-effect" aria-label="移除效果"><i class="fa-solid fa-trash"></i></button></div><div class="aam-contexts" data-aam-contexts><label><input type="checkbox" value="quiz" ${contexts.includes('quiz') ? 'checked' : ''}>問道</label><label><input type="checkbox" value="battle" ${contexts.includes('battle') ? 'checked' : ''}>鬥法</label><label><input type="checkbox" value="dongtian" ${contexts.includes('dongtian') ? 'checked' : ''}>洞天</label></div>`;
    const sync = () => {
      const current = row.querySelector('[data-aam-effect-type]').value;
      const needsValue = ['equip_attack_flat', 'equip_attack_percent', 'equip_hp_flat', 'equip_hp_percent'].includes(current);
      const timed = current.startsWith('timed_');
      row.querySelector('[data-aam-value-field]').style.display = needsValue ? '' : 'none';
      row.querySelector('[data-aam-multiplier-field]').style.display = timed ? '' : 'none';
      row.querySelector('[data-aam-duration-field]').style.display = timed ? '' : 'none';
      row.querySelector('[data-aam-contexts]').style.display = current === 'remove_wrong_option' ? 'flex' : 'none';
    };
    row.querySelector('[data-aam-effect-type]').addEventListener('change', sync);
    row.querySelector('.aam-remove-effect').onclick = () => row.remove();
    sync();
    return row;
  }

  function openEditor(item = null) {
    if (!isAdmin()) return;
    document.getElementById(MODAL_ID)?.remove();
    const editing = !!item;
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'aam-modal';
    modal.innerHTML = `<section class="aam-card" role="dialog" aria-modal="true"><h3>${editing ? '編輯法寶' : '新增法寶'}</h3><p class="aam-note">這裡直接維護全站正式法寶清單。建立後 ID 會鎖定，避免玩家既有背包與裝備失聯。右側「可用功能」可直接加入效果。</p><div class="aam-editor-layout"><div class="aam-editor-main"><div class="aam-grid"><div class="aam-field"><label>法寶 ID（英文小寫與 -）</label><input id="aam-id" maxlength="64" ${editing ? 'readonly' : ''} value="${escapeHtml(item?.id || '')}" placeholder="例如 thunder-seal"></div><div class="aam-field"><label>名稱</label><input id="aam-name" maxlength="80" value="${escapeHtml(item?.name || '')}"></div><div class="aam-field"><label>圖示（1–4 字）</label><input id="aam-icon" maxlength="4" value="${escapeHtml(item?.icon || '◆')}"></div><div class="aam-field"><label>境界</label><select id="aam-realm">${ARTIFACT_REALMS.map((realm) => `<option value="${realm.name}" ${realm.name === (item?.realm || '築基') ? 'selected' : ''}>${realm.name}</option>`).join('')}</select></div><div class="aam-field"><label>分類</label><select id="aam-category">${categoryOptions(item?.category)}</select></div><div class="aam-field"><label>裝備欄位（裝備效果才需要）</label><input id="aam-slot" maxlength="40" value="${escapeHtml(item?.equipSlot || '')}" placeholder="例如 本命法寶"></div><div class="aam-field"><label>打造金幣</label><input id="aam-gold" type="number" min="0" step="1" value="${Number(item?.craft?.gold) || 0}"></div><div class="aam-field"><label>每次打造數量</label><input id="aam-yield" type="number" min="1" step="1" value="${Math.max(1, Number(item?.craft?.yield) || 1)}"></div><div class="aam-field full"><label>說明</label><textarea id="aam-description" maxlength="500">${escapeHtml(item?.description || '')}</textarea></div></div><div class="aam-effects-editor"><div class="aam-effects-head"><span>法寶效果</span><button type="button" id="aam-add-effect" class="aam-add-effect"><i class="fa-solid fa-plus"></i> 新增效果</button></div><div id="aam-effect-list"></div></div><div id="aam-status" class="aam-note" style="margin-top:10px"></div></div><aside class="aam-guide"><h4><i class="fa-solid fa-list-check"></i> 可用功能</h4><p>點選任一功能即可直接加入左側法寶效果，可同時組合多種功能。</p><div class="aam-guide-list">${effectGuideMarkup()}</div><div class="aam-guide-note"><b>裝備類：</b>需要填「裝備欄位」。<br><b>限時類：</b>催動時消耗 1 件法寶。<br><b>排除錯項：</b>可指定問道、鬥法、洞天。</div></aside></div><div class="aam-actions"><button type="button" class="aam-cancel">取消</button><button type="button" class="aam-save">${editing ? '儲存變更' : '建立法寶'}</button></div></section>`;
    document.body.appendChild(modal);
    const effectList = modal.querySelector('#aam-effect-list');
    (item?.effects?.length ? item.effects : [defaultEffect('equip_attack_flat')]).forEach((effect) => effectList.appendChild(effectRow(effect)));
    modal.querySelector('#aam-add-effect').onclick = () => effectList.appendChild(effectRow(defaultEffect('equip_attack_flat')));
    modal.querySelectorAll('[data-aam-add-effect-type]').forEach((button) => {
      button.onclick = () => {
        const type = button.dataset.aamAddEffectType;
        if (!SUPPORTED_ARTIFACT_EFFECTS.includes(type)) return;
        effectList.appendChild(effectRow(defaultEffect(type)));
        effectList.lastElementChild?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      };
    });
    modal.querySelector('.aam-cancel').onclick = () => modal.remove();
    modal.querySelector('.aam-save').onclick = () => saveFromModal(modal, editing ? item.id : '');
  }

  function readEffects(modal) {
    return [...modal.querySelectorAll('.aam-effect-row')].map((row) => {
      const type = row.querySelector('[data-aam-effect-type]').value;
      if (['equip_attack_flat', 'equip_attack_percent', 'equip_hp_flat', 'equip_hp_percent'].includes(type)) {
        return { type, value: Number(row.querySelector('[data-aam-effect-value]').value) || 0 };
      }
      if (type.startsWith('timed_')) {
        return { type, multiplier: Number(row.querySelector('[data-aam-effect-multiplier]').value) || 1, durationMs: Math.max(1000, Math.round((Number(row.querySelector('[data-aam-effect-duration]').value) || 0) * 60000)) };
      }
      if (type === 'remove_wrong_option') {
        const contexts = [...row.querySelectorAll('[data-aam-contexts] input:checked')].map((input) => input.value);
        return { type, contexts, perQuestion: 1 };
      }
      return { type };
    });
  }

  async function persistCatalog(items) {
    const auth = getAuth(getApp());
    const user = auth.currentUser;
    if (!user || !isAdmin()) throw new Error('僅管理員可以修改法寶清單');
    const normalized = validateArtifactCatalog(items);
    const db = getFirestore(getApp());
    await runTransaction(db, async (tx) => {
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists() || userSnap.data()?.isAdmin !== true) throw new Error('管理員權限驗證失敗');
      const configRef = doc(db, CONFIG_COLLECTION, CONFIG_DOC);
      tx.set(configRef, {
        version: 1,
        items: normalized,
        updatedBy: user.uid,
        updatedByName: data()?.displayName || user.displayName || '管理員',
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now()
      }, { merge: true });
    });
    replaceArtifactCatalog(normalized, 'admin-save');
    return normalized;
  }

  async function saveFromModal(modal, originalId) {
    if (busy) return;
    const status = modal.querySelector('#aam-status');
    const save = modal.querySelector('.aam-save');
    const id = String(modal.querySelector('#aam-id').value || '').trim().toLowerCase();
    const raw = {
      id,
      name: modal.querySelector('#aam-name').value,
      icon: modal.querySelector('#aam-icon').value,
      realm: modal.querySelector('#aam-realm').value,
      category: modal.querySelector('#aam-category').value,
      equipSlot: modal.querySelector('#aam-slot').value,
      description: modal.querySelector('#aam-description').value,
      craft: { gold: modal.querySelector('#aam-gold').value, yield: modal.querySelector('#aam-yield').value },
      effects: readEffects(modal)
    };
    if (originalId && id !== originalId) { status.textContent = '既有法寶 ID 不可修改。'; return; }
    let item;
    try { item = normalizeArtifactDefinition(raw); } catch (error) { status.textContent = error.message; return; }
    const next = ARTIFACT_CATALOG.map((existing) => JSON.parse(JSON.stringify(existing)));
    const index = next.findIndex((existing) => existing.id === id);
    if (!originalId && index >= 0) { status.textContent = `法寶 ID「${id}」已存在。`; return; }
    if (originalId && index < 0) { status.textContent = '找不到要編輯的法寶，請重新整理。'; return; }
    if (index >= 0) next[index] = item; else next.push(item);
    try { validateArtifactCatalog(next); } catch (error) { status.textContent = error.message || '法寶資料不合法'; return; }

    busy = true;
    save.disabled = true;
    save.textContent = '儲存中…';
    status.textContent = '正在驗證管理員權限並同步全站法寶設定…';
    try {
      await persistCatalog(next);
      modal.remove();
      render();
      toast(originalId ? `已更新 ${item.name}` : `已建立 ${item.name}`);
    } catch (error) {
      console.error('[Admin artifact save]', error);
      status.textContent = error.message || '法寶儲存失敗';
      toast('法寶儲存失敗', false);
    } finally {
      busy = false;
      save.disabled = false;
      save.textContent = originalId ? '儲存變更' : '建立法寶';
    }
  }

  function mount() {
    if (!isAdmin()) return;
    ensureStyle();
    const page = document.getElementById('page-admin');
    if (!page || document.getElementById(PANEL_ID)) return;
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.dataset.adminSectionTitle = '法寶管理';
    panel.dataset.adminSectionIcon = 'fa-hammer';
    panel.innerHTML = `<div class="aam-head"><div><h3><i class="fa-solid fa-hammer" style="color:#d8b15d"></i> 法寶管理</h3><p>查看並維護全站法寶。新增或編輯後，所有玩家的煉器室與法寶效果會同步更新。</p></div><button type="button" class="aam-add" id="admin-artifact-add"><i class="fa-solid fa-plus"></i> 新增法寶</button></div><div id="admin-artifact-list" class="aam-list"></div>`;
    const heading = page.querySelector('h2');
    if (heading?.nextSibling) page.insertBefore(panel, heading.nextSibling);
    else page.prepend(panel);
    panel.querySelector('#admin-artifact-add').onclick = () => openEditor();
    panel.addEventListener('click', (event) => {
      const button = event.target.closest('[data-admin-artifact-edit]');
      if (!button) return;
      const item = ARTIFACT_CATALOG.find((candidate) => candidate.id === button.dataset.adminArtifactEdit);
      if (item) openEditor(item);
    });
    render();
  }

  function boot() {
    mount();
    window.addEventListener('xiuxian:user-ready', mount);
    window.addEventListener('artifact-catalog-updated', () => { mount(); render(); });
    new MutationObserver(() => { if (!document.getElementById(PANEL_ID)) mount(); }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();