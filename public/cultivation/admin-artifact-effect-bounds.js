import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// AI forging: edit only depth-wide effect bounds. The engine automatically
// distributes each range into twelve bands (Qi: 1-3 ... Immortal: 10-12).
(function () {
  'use strict';
  const PANEL_ID = 'admin-artifact-effect-bounds';
  const CONFIG_PATH = ['gameConfig', 'artifactCatalogV1'];
  const REALMS = ['煉氣','築基','金丹','元嬰','化神','煉虛','合體','大乘','渡劫','真仙'];
  const CAPS = Object.freeze({
    equip_attack_percent:5, equip_hp_percent:5, equip_damage_percent:3,
    equip_damage_reduction_percent:0.8, equip_crit_chance:0.75, equip_crit_damage_percent:3,
    equip_combo_chance:0.1, equip_lifesteal_percent:0.5, equip_reflect_percent:1,
    equip_low_hp_damage_percent:2, equip_low_hp_reduction_percent:0.8,
    equip_first_hit_reduction_percent:0.9, equip_damage_cap_percent:1
  });
  const pending = new Map(); // stage -> validated overrides, or null to restore defaults
  let stage = 1;
  let defaults = null;
  let firstDepthDefaults = null;
  let saving = false;
  let requestId = 0;
  const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const admin = () => window.getCurrentUserData?.()?.isAdmin === true;
  const stored = () => window.getArtifactEffectBounds?.() || {};
  const selection = () => pending.has(String(stage))
    ? pending.get(String(stage)) || {} : stored()[String(stage)] || {};
  function message(text, invalid = false) {
    const el = document.getElementById('aeb-status');
    if (el) { el.textContent = text; el.style.color = invalid ? '#fca5a5' : '#d8bf7d'; }
  }
  function validate(type, range, values) {
    const integer = range.unit === '點';
    const floor = type === 'equip_damage_cap_percent' ? .05 :
      range.field === 'multiplier' ? 1.01 : integer ? 1 : .0001;
    const cap = integer ? 1000000 : range.field === 'multiplier' ? 5 : CAPS[type] ?? 1;
    if (!Number.isFinite(values.min) || !Number.isFinite(values.max) ||
        values.min < floor || values.max > cap || values.min > values.max ||
        (integer && (!Number.isInteger(values.min) || !Number.isInteger(values.max)))) {
      throw new Error(range.label + '：上下限須在 ' + floor + '～' + cap + '，下限不能大於上限');
    }
    if (range.field === 'multiplier' && (
      !Number.isFinite(values.durationMinutesMin) || !Number.isFinite(values.durationMinutesMax) ||
      values.durationMinutesMin < .02 || values.durationMinutesMax > 1440 ||
      values.durationMinutesMin > values.durationMinutesMax)) {
      throw new Error(range.label + '：持續時間須介於 0.02～1440 分鐘，且下限不能大於上限');
    }
  }
  function numberField(range, field, value) {
    return '<input type="number" required step="' + (range.unit === '點' ? '1' : '.0001') +
      '" data-aeb-field="' + field + '" aria-label="' + esc(range.label + ' ' + field) +
      '" value="' + esc(value) + '">';
  }
  // Reference only: show actual pending/saved first-refinement values,
  // falling back to the first-refinement defaults for untouched effects.
  function firstDepthHint(range) {
    if (stage !== 2) return '';
    if (!firstDepthDefaults) return '<div class="aeb-previous">第一煉參考值暫時無法載入；不影響第二煉設定。</div>';
    const first = firstDepthDefaults.find(item => item.type === range.type);
    if (!first) return '<div class="aeb-previous">第一煉：此功能未開放，無可對照的上下限。</div>';
    if (!['value', 'multiplier'].includes(first.field))
      return '<div class="aeb-previous">第一煉：固定效果，不需設定數值上下限。</div>';
    const edits = pending.has('1') ? pending.get('1') || {} : stored()['1'] || {};
    const actual = edits[range.type] || first;
    let text = '第一煉參考：下限 ' + actual.min + ' ／ 上限 ' + actual.max + ' ' + first.unit;
    if (first.field === 'multiplier') {
      text += '；持續 ' + actual.durationMinutesMin + '～' + actual.durationMinutesMax + ' 分鐘';
    }
    return '<div class="aeb-previous" role="note">' + esc(text) + '（僅提醒，不限制第二煉填寫）</div>';
  }
  function draw() {
    const list = document.getElementById('aeb-rows');
    if (!list || !defaults) return;
    const custom = selection();
    list.innerHTML = defaults.map(range => {
      const editable = range.field === 'value' || range.field === 'multiplier';
      const current = custom[range.type] || range;
      const cell = field => numberField(range, field, current[field]);
      return '<div class="aeb-row" data-aeb-type="' + esc(range.type) + '">' +
        '<div class="aeb-name"><strong>' + esc(range.label) + '</strong><small>' + esc(range.unit) +
        (custom[range.type] ? ' · 已自訂' : ' · 預設') + '</small></div>' +
        (editable ? '<label>深度下限' + cell('min') + '</label><label>深度上限' + cell('max') + '</label>'
          : '<div class="aeb-fixed">固定規則，不需設定</div>') +
        (range.field === 'multiplier' ?
          '<label>最短分鐘' + cell('durationMinutesMin') + '</label><label>最長分鐘' + cell('durationMinutesMax') + '</label>'
          : '') + firstDepthHint(range) + '</div>';
    }).join('');
    const select = document.getElementById('aeb-preview-effect');
    if (select) {
      const prior = select.value;
      select.innerHTML = defaults.filter(r => ['value','multiplier'].includes(r.field))
        .map(r => '<option value="' + esc(r.type) + '">' + esc(r.label) + '</option>').join('');
      if ([...select.options].some(o => o.value === prior)) select.value = prior;
    }
    const note = document.getElementById('aeb-previous-note');
    if (note) note.textContent = stage === 2 ? '第二煉設定：每項功能下方顯示第一煉目前生效的上下限，供比較參考。' : '';
    preview();
    message('只需設定每個深度的上下限。未改動的項目沿用系統預設值。');
  }
  function capture() {
    if (!defaults) return;
    const byType = new Map(defaults.map(range => [range.type, range]));
    const overrides = {};
    document.querySelectorAll('#aeb-rows [data-aeb-type]').forEach(row => {
      const range = byType.get(row.dataset.aebType);
      if (!range || !['value','multiplier'].includes(range.field)) return;
      const values = {};
      row.querySelectorAll('[data-aeb-field]').forEach(input => {
        if (!input.value.trim()) throw new Error(range.label + '：數值不可留白');
        values[input.dataset.aebField] = Number(input.value);
      });
      validate(range.type, range, values);
      const fields = range.field === 'multiplier'
        ? ['min','max','durationMinutesMin','durationMinutesMax'] : ['min','max'];
      if (fields.some(field => Math.abs(values[field] - range[field]) > 1e-9))
        overrides[range.type] = values;
    });
    const original = stored()[String(stage)] || {};
    if (JSON.stringify(original) === JSON.stringify(overrides)) pending.delete(String(stage));
    else pending.set(String(stage), Object.keys(overrides).length ? overrides : null);
    message(pending.size ? '有 ' + pending.size + ' 個深度的變更尚未儲存。' : '目前沒有尚未儲存的修改。');
    preview();
  }
  function portion(bounds, index, inverse, integer) {
    const step = (bounds.max - bounds.min) / 12;
    const start = inverse ? 9 - index : index; // index 0 = Qi
    const low = bounds.min + start * step;
    const high = bounds.min + (start + 3) * step;
    if (integer) {
      const min = Math.ceil(low - 1e-9);
      return [min, Math.max(min, Math.floor(high + 1e-9))];
    }
    return [Number(low.toFixed(4)), Number(high.toFixed(4))];
  }
  function preview() {
    const table = document.getElementById('aeb-preview');
    const select = document.getElementById('aeb-preview-effect');
    if (!table || !defaults || !select) return;
    const row = defaults.find(r => r.type === select.value);
    if (!row) { table.textContent = ''; return; }
    const inputs = document.querySelector('#aeb-rows [data-aeb-type="' + row.type + '"]');
    const custom = { ...row };
    inputs?.querySelectorAll('[data-aeb-field]').forEach(input => {
      if (input.value.trim() && Number.isFinite(Number(input.value))) custom[input.dataset.aebField] = Number(input.value);
    });
    let valid = true;
    try { validate(row.type, row, custom); } catch (_) { valid = false; }
    if (!valid) { table.textContent = '請先修正上下限，才可查看各境界的換算結果。'; return; }
    table.innerHTML = REALMS.map((name, index) => {
      const [min,max] = portion(custom, index, row.type === 'equip_damage_cap_percent', row.unit === '點');
      return '<div><b>' + name + '</b><span>' + (index+1) + '～' + (index+3) + ' 份</span><strong>' +
        min + ' ～ ' + max + '</strong></div>';
    }).join('');
  }
  async function load() {
    const id = ++requestId;
    defaults = null;
    firstDepthDefaults = null;
    document.getElementById('aeb-rows').textContent = '';
    message('正在載入深度預設值…');
    try {
      const response = await fetch('/api/artifact-depth-effect-ranges?stage=' + stage);
      if (!response.ok) throw new Error('煉器伺服器尚未提供新版上下限設定（HTTP ' + response.status + '）');
      const data = await response.json();
      if (id !== requestId) return;
      if (!Array.isArray(data.ranges)) throw new Error('深度效果資料格式錯誤');
      if (stage === 2) {
        try {
          const priorResponse = await fetch('/api/artifact-depth-effect-ranges?stage=1');
          if (!priorResponse.ok) throw new Error('HTTP ' + priorResponse.status);
          const prior = await priorResponse.json();
          if (!Array.isArray(prior.ranges)) throw new Error('第一煉預設資料格式錯誤');
          if (id !== requestId) return;
          firstDepthDefaults = prior.ranges;
        } catch (error) {
          if (id !== requestId) return;
          console.warn('[Artifact depth limits] first refinement reference unavailable', error);
          firstDepthDefaults = null;
        }
      }
      if (id !== requestId) return;
      defaults = data.ranges;
      draw();
    } catch (error) {
      if (id === requestId) message(error.message || '無法讀取預設值', true);
    }
  }
  async function save() {
    if (saving || !admin()) return;
    try { capture(); } catch (error) { message(error.message, true); return; }
    if (!pending.size) { message('沒有需要儲存的修改。'); return; }
    const user = getAuth(getApp()).currentUser;
    if (!user) { message('請先登入管理員帳號。', true); return; }
    const button = document.getElementById('aeb-save');
    saving = true;
    button.disabled = true;
    button.textContent = '儲存中…';
    const changes = new Map(pending);
    try {
      const db = getFirestore(getApp());
      let committed;
      await runTransaction(db, async tx => {
        const userSnap = await tx.get(doc(db, 'users', user.uid));
        const configRef = doc(db, ...CONFIG_PATH);
        const configSnap = await tx.get(configRef);
        if (!userSnap.exists() || userSnap.data()?.isAdmin !== true) throw new Error('管理員權限驗證失敗');
        committed = JSON.parse(JSON.stringify(configSnap.data()?.effectBoundsV2 || {}));
        for (const [depth, bounds] of changes) {
          if (!['1','2','3'].includes(depth)) throw new Error('煉器深度不合法');
          if (bounds && Object.keys(bounds).length) committed[depth] = bounds;
          else delete committed[depth];
        }
        tx.set(configRef, {
          effectBoundsV2: committed,
          updatedBy:user.uid, updatedAt:serverTimestamp(), updatedAtMs:Date.now()
        }, { merge:true });
      });
      pending.clear();
      window.setArtifactEffectBoundsLocal?.(committed, 'admin-save');
      draw();
      message('已儲存全站煉製深度上下限，將套用於後續生成的法寶。');
    } catch (error) {
      console.error('[Artifact depth limits]', error);
      message(error.message || '儲存失敗', true);
    } finally {
      saving = false;
      button.disabled = false;
      button.textContent = '儲存上下限';
    }
  }
  function ensureStyle() {
    if (document.getElementById('aeb-style')) return;
    const el = document.createElement('style');
    el.id = 'aeb-style';
    el.textContent = [
      '#admin-artifact-effect-bounds{margin:10px 0;padding:12px;border:1px solid rgba(216,177,93,.25);border-radius:12px;background:rgba(216,177,93,.035);color:#ecdcb8}',
      '.aeb-head strong{font-size:12px;color:#ead08b}.aeb-note{font-size:9px;line-height:1.7;color:#aa9b7f}',
      '.aeb-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0}',
      '.aeb-controls select,.aeb-controls button{min-height:35px;padding:7px 9px;border:1px solid rgba(216,177,93,.33);border-radius:8px;background:#14110c;color:#f1d89a;font-size:10px}',
      '.aeb-controls button{cursor:pointer}.aeb-controls button:disabled{opacity:.45}',
      '.aeb-row{display:grid;grid-template-columns:minmax(130px,1.7fr) repeat(4,minmax(76px,1fr));gap:7px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(216,177,93,.1)}',
      '.aeb-row label{display:grid;gap:4px;font-size:8px;color:#ae9d7b}.aeb-row input{width:100%;min-width:0;padding:8px 5px;background:#090807;color:#f1dfb9;border:1px solid rgba(216,177,93,.25);border-radius:7px;font-size:10px}',
      '.aeb-name{display:grid;gap:2px}.aeb-name strong{font-size:10px}.aeb-name small{font-size:8px;color:#8f826b}.aeb-fixed{font-size:9px;color:#8f826b}',
      '.aeb-previous{grid-column:1/-1;padding:6px 9px;border-left:2px solid #aa8a4a;border-radius:5px;background:rgba(216,177,93,.06);color:#d4bb81;font-size:9px;line-height:1.55;overflow-wrap:anywhere}',
      '#aeb-previous-note:empty{display:none}',
      '#aeb-status{min-height:20px;font-size:9px;line-height:1.6}',
      '.aeb-preview{display:grid;gap:3px;margin-top:8px}.aeb-preview>div{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;padding:5px 8px;border-bottom:1px solid rgba(216,177,93,.1);font-size:9px}',
      '.aeb-preview span{color:#8b7e65}.aeb-preview strong{text-align:right;color:#e7c675}',
      '@media(max-width:650px){.aeb-row{grid-template-columns:repeat(2,minmax(0,1fr))}.aeb-name{grid-column:1/-1}.aeb-fixed{grid-column:1/-1}}'
    ].join('');
    document.head.appendChild(el);
  }
  function mount() {
    if (!admin()) return;
    const panel = document.getElementById('admin-artifact-manager');
    if (!panel || document.getElementById(PANEL_ID)) return;
    ensureStyle();
    const section = document.createElement('section');
    section.id = PANEL_ID;
    section.innerHTML = '<div class="aeb-head"><strong><i class="fa-solid fa-sliders"></i> 法寶功能・按深度設定上下限</strong></div>' +
      '<details><summary class="aeb-note">展開設定第一、第二、第三煉的功能上下限</summary>' +
      '<p class="aeb-note">每個功能只需設定本深度的最小值與最大值；系統自動平均分為 12 份。煉氣取第 1～3 份、築基第 2～4 份，依此類推，真仙取第 10～12 份。不生成凡人法寶。</p>' +
      '<p class="aeb-note">比例請填小數（0.10 = 10%）。單次傷害上限越小越強，因此其境界分配會反向；連擊率硬上限仍為 10%。本設定只影響新法寶，不修改既有裝備。</p>' +
      '<div class="aeb-controls"><label>煉製深度 <select id="aeb-stage"><option value="1">第一煉</option><option value="2">第二煉</option><option value="3">第三煉</option></select></label>' +
      '<button type="button" id="aeb-reset">本深度恢復預設</button><button type="button" id="aeb-save">儲存上下限</button></div>' +
      '<p id="aeb-previous-note" class="aeb-note" role="note"></p><div id="aeb-status" role="status"></div><div id="aeb-rows"></div>' +
      '<details class="aeb-preview-details"><summary class="aeb-note">查看各境界自動換算結果</summary>' +
      '<div class="aeb-controls"><label>預覽功能 <select id="aeb-preview-effect"></select></label></div>' +
      '<div id="aeb-preview" class="aeb-preview"></div></details></details>';
    (panel.querySelector('.aam-head') || panel.firstElementChild)?.after(section);
    const depthSelect = section.querySelector('#aeb-stage');
    depthSelect.addEventListener('change', () => {
      const desired = Number(depthSelect.value);
      try { capture(); } catch (error) {
        depthSelect.value = String(stage);
        message(error.message, true);
        return;
      }
      stage = desired;
      void load();
    });
    section.querySelector('#aeb-reset').onclick = () => {
      pending.set(String(stage), null);
      draw();
      message('本深度已恢復預設；按「儲存上下限」才會同步全站。');
    };
    section.querySelector('#aeb-save').onclick = () => void save();
    section.querySelector('#aeb-preview-effect').onchange = () => preview();
    section.querySelector('#aeb-rows').addEventListener('input', () => {
      try { capture(); } catch (error) { message(error.message, true); preview(); }
    });
    section.querySelector('details').addEventListener('toggle', event => {
      if (event.target.open && !defaults) void load();
    });
  }
  function boot() {
    mount();
    window.addEventListener('xiuxian:user-ready', mount);
    window.addEventListener('artifact-catalog-updated', mount);
    new MutationObserver(mount).observe(document.body, {subtree:true,childList:true});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();
