import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { ARTIFACT_REALMS } from './artifact-catalog.js';

// Each realm and refinement stage has its own independent AI-generation bounds.
// This editor lives INSIDE the existing admin artifact manager, not in the bag.
(function () {
  'use strict';
  const PANEL_ID = 'admin-artifact-effect-bounds';
  const CONFIG_PATH = ['gameConfig', 'artifactCatalogV1'];
  const changed = new Map();
  let realm = '煉氣';
  let stage = 1;
  let currentRanges = null;
  let busy = false;
  let requestId = 0;
  const key = () => realm + '/' + stage;
  const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const isAdmin = () => window.getCurrentUserData?.()?.isAdmin === true;
  const status = (message, bad = false) => {
    const el = document.getElementById('aeb-status');
    if (el) { el.textContent = message; el.style.color = bad ? '#fca5a5' : '#d8bf7d'; }
  };
  function savedSelection() {
    const [name, level] = [realm, String(stage)];
    const base = window.getArtifactEffectBounds?.() || {};
    if (changed.has(key())) return changed.get(key()) || {};
    return base[name]?.[level] || {};
  }
  function check(type, range, values) {
    const integer = range.unit === '點';
    const minAbs = type === 'equip_damage_cap_percent' ? 0.05
      : range.field === 'multiplier' ? 1.01 : integer ? 1 : 0.0001;
    const hardCaps = { equip_attack_percent:5, equip_hp_percent:5, equip_damage_percent:3,
      equip_damage_reduction_percent:0.8, equip_crit_chance:0.75, equip_crit_damage_percent:3,
      equip_combo_chance:0.10, equip_lifesteal_percent:0.5, equip_reflect_percent:1,
      equip_low_hp_damage_percent:2, equip_low_hp_reduction_percent:0.8,
      equip_first_hit_reduction_percent:0.9, equip_damage_cap_percent:1 };
    const maxAbs = integer ? 1000000 : range.field === 'multiplier' ? 5 : hardCaps[type] ?? 1;
    if (values.min < minAbs || values.max > maxAbs || values.min > values.max ||
        !Number.isFinite(values.min) || !Number.isFinite(values.max) ||
        (integer && (!Number.isInteger(values.min) || !Number.isInteger(values.max)))) {
      throw new Error(range.label + '：下限須 ≤ 上限，範圍 ' + minAbs + '～' + maxAbs);
    }
    if (range.field === 'multiplier' && (
      !Number.isFinite(values.durationMinutesMin) || !Number.isFinite(values.durationMinutesMax) ||
      values.durationMinutesMin < 0.02 || values.durationMinutesMax > 1440 ||
      values.durationMinutesMin > values.durationMinutesMax)) {
      throw new Error(range.label + '：持續時間須為 0.02～1440 分鐘，且下限不可大於上限');
    }
  }
  function numericInput(type, field, value, range) {
    const integer = range.unit === '點';
    const step = integer ? 1 : 0.0001;
    return '<input type="number" required step="' + step + '" data-aeb-field="' + field +
      '" aria-label="' + esc(range.label + ' ' + field) + '" value="' + esc(value) + '">';
  }
  function drawRows() {
    const body = document.getElementById('aeb-rows');
    if (!body || !currentRanges) return;
    const overrides = savedSelection();
    body.innerHTML = currentRanges.map((range) => {
      const editable = range.field === 'value' || range.field === 'multiplier';
      const entry = overrides[range.type] || {};
      const custom = !!overrides[range.type];
      const cell = (field) => numericInput(range.type, field, entry[field] ?? range[field], range);
      return '<div class="aeb-row" data-aeb-type="' + esc(range.type) + '">' +
        '<div class="aeb-name"><strong>' + esc(range.label) + '</strong><small>' + esc(range.unit) +
        (custom ? ' · 自訂' : ' · 預設') + '</small><small>' + esc(range.note || '') + '</small></div>' +
        (editable ? '<label>下限' + cell('min') + '</label><label>上限' + cell('max') + '</label>'
          : '<div class="aeb-fixed">固定規則</div>') +
        (range.field === 'multiplier'
          ? '<label>最短分鐘' + cell('durationMinutesMin') + '</label><label>最長分鐘' + cell('durationMinutesMax') + '</label>'
          : '') + '</div>';
    }).join('');
    status('百分比使用小數（0.10 = 10%）；每個境界與第 1～3 煉分開設定。未修改的功能沿用原預設。');
  }
  function capture() {
    if (!currentRanges) return;
    const overrides = {};
    const byType = new Map(currentRanges.map((range) => [range.type, range]));
    document.querySelectorAll('#aeb-rows [data-aeb-type]').forEach((row) => {
      const range = byType.get(row.dataset.aebType);
      if (!range || (range.field !== 'value' && range.field !== 'multiplier')) return;
      const values = {};
      row.querySelectorAll('[data-aeb-field]').forEach((input) => {
        if (!input.value.trim()) throw new Error(range.label + '：不可留空');
        const value = Number(input.value);
        if (!Number.isFinite(value)) throw new Error(range.label + '：請輸入有效數值');
        values[input.dataset.aebField] = value;
      });
      check(range.type, range, values);
      const fields = range.field === 'multiplier'
        ? ['min', 'max', 'durationMinutesMin', 'durationMinutesMax'] : ['min', 'max'];
      if (fields.some((field) => Math.abs(values[field] - range[field]) > 1e-9)) {
        overrides[range.type] = values;
      }
    });
    const original = window.getArtifactEffectBounds?.()?.[realm]?.[String(stage)] || {};
    // A return to defaults must be persisted too, to remove old overrides.
    if (JSON.stringify(original) === JSON.stringify(overrides)) changed.delete(key());
    else changed.set(key(), Object.keys(overrides).length ? overrides : null);
    const count = changed.size;
    status(count ? '尚有 ' + count + ' 組境界／煉製階段修改未儲存。' : '目前設定與已儲存版本相同。');
  }
  async function load() {
    const id = ++requestId;
    currentRanges = null;
    document.getElementById('aeb-rows').textContent = '';
    status('正在取得正式效果預設值…');
    try {
      const res = await fetch('/api/artifact-effect-ranges?realm=' + encodeURIComponent(realm) + '&stage=' + stage);
      if (!res.ok) throw new Error('生成服務未提供效果數值表（HTTP ' + res.status + '）');
      const data = await res.json();
      if (id !== requestId) return;
      if (!Array.isArray(data.ranges)) throw new Error('效果數值表格式錯誤');
      currentRanges = data.ranges;
      drawRows();
    } catch (error) {
      if (id === requestId) status(error.message || '無法載入效果數值表', true);
    }
  }
  async function save() {
    if (busy || !isAdmin()) return;
    try { capture(); } catch (error) { status(error.message, true); return; }
    if (!changed.size) { status('沒有需要儲存的修改。'); return; }
    const user = getAuth(getApp()).currentUser;
    if (!user) { status('請先登入管理員帳號。', true); return; }
    busy = true;
    const button = document.getElementById('aeb-save');
    button.disabled = true;
    button.textContent = '儲存中…';
    const changes = new Map(changed);
    try {
      let committed;
      const db = getFirestore(getApp());
      await runTransaction(db, async (tx) => {
        const userSnap = await tx.get(doc(db, 'users', user.uid));
        const configRef = doc(db, ...CONFIG_PATH);
        const configSnap = await tx.get(configRef);
        if (!userSnap.exists() || userSnap.data()?.isAdmin !== true) throw new Error('管理員權限驗證失敗');
        committed = JSON.parse(JSON.stringify(configSnap.data()?.effectBoundsV1 || {}));
        for (const [entry, values] of changes) {
          const [name, level] = entry.split('/');
          if (!ARTIFACT_REALMS.some((r) => r.name === name) || !['1', '2', '3'].includes(level))
            throw new Error('境界或煉製階段不合法');
          if (values && Object.keys(values).length) {
            (committed[name] ||= {})[level] = values;
          } else if (committed[name]) {
            delete committed[name][level];
          }
          if (committed[name] && !Object.keys(committed[name]).length) delete committed[name];
        }
        tx.set(configRef, {
          effectBoundsV1: committed,
          updatedBy: user.uid,
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now()
        }, { merge: true });
      });
      changed.clear();
      window.setArtifactEffectBoundsLocal?.(committed, 'admin-save');
      drawRows();
      status('已儲存全站效果上下限；之後生成的新法寶將使用此設定。');
    } catch (error) {
      console.error('[Admin artifact effect bounds]', error);
      status(error.message || '法寶效果上下限儲存失敗', true);
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = '儲存上下限';
    }
  }
  function style() {
    if (document.getElementById('aeb-style')) return;
    const el = document.createElement('style');
    el.id = 'aeb-style';
    el.textContent = [
      '#admin-artifact-effect-bounds{margin:10px 0;padding:12px;border:1px solid rgba(216,177,93,.25);border-radius:12px;background:rgba(216,177,93,.035);color:#ecdcb8}',
      '.aeb-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
      '.aeb-head strong{font-size:12px;color:#ead08b}.aeb-note{font-size:9px;line-height:1.7;color:#aa9b7f}',
      '.aeb-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}',
      '.aeb-controls select,.aeb-controls button{min-height:35px;padding:7px 9px;border:1px solid rgba(216,177,93,.33);border-radius:8px;background:#14110c;color:#f1d89a;font-size:10px}',
      '.aeb-controls button{cursor:pointer}.aeb-controls button:disabled{opacity:.45}',
      '.aeb-row{display:grid;grid-template-columns:minmax(130px,1.7fr) repeat(4,minmax(76px,1fr));gap:7px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(216,177,93,.1)}',
      '.aeb-row label{display:grid;gap:4px;font-size:8px;color:#ae9d7b}.aeb-row input{width:100%;min-width:0;padding:8px 5px;background:#090807;color:#f1dfb9;border:1px solid rgba(216,177,93,.25);border-radius:7px;font-size:10px}',
      '.aeb-name{display:grid;gap:2px}.aeb-name strong{font-size:10px}.aeb-name small{font-size:8px;color:#8f826b}.aeb-fixed{font-size:9px;color:#8f826b}',
      '#aeb-status{min-height:20px;font-size:9px;line-height:1.6}',
      '@media(max-width:650px){.aeb-row{grid-template-columns:repeat(2,minmax(0,1fr))}.aeb-name{grid-column:1/-1}.aeb-fixed{grid-column:1/-1}}'
    ].join('');
    document.head.appendChild(el);
  }
  function mount() {
    if (!isAdmin()) return;
    const panel = document.getElementById('admin-artifact-manager');
    if (!panel || document.getElementById(PANEL_ID)) return;
    style();
    const section = document.createElement('section');
    section.id = PANEL_ID;
    section.innerHTML = '<div class="aeb-head"><strong><i class="fa-solid fa-sliders"></i> 法寶功能・各境界數值上下限</strong></div>' +
      '<details><summary class="aeb-note">展開設定各境界／各煉器階段的 AI 生成效果數值</summary>' +
      '<p class="aeb-note">只影響新生成法寶，不會追溯修改已持有、已裝備的法寶。連擊率硬上限仍為 10%；不開放的效果與每場固定效果維持原限制。</p>' +
      '<div class="aeb-controls"><label>法寶境界 <select id="aeb-realm">' +
      ARTIFACT_REALMS.map((r) => '<option value="' + esc(r.name) + '"' + (r.name === realm ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') +
      '</select></label><label>煉製階段 <select id="aeb-stage"><option value="1">第一煉</option><option value="2">第二煉</option><option value="3">第三煉</option></select></label>' +
      '<button type="button" id="aeb-reset">本組恢復預設</button><button type="button" id="aeb-save">儲存上下限</button></div>' +
      '<div id="aeb-status" role="status"></div><div id="aeb-rows"></div></details>';
    (panel.querySelector('.aam-head') || panel.firstElementChild)?.after(section);
    const changeSelection = (target) => {
      try { capture(); } catch (error) {
        target.value = target.id === 'aeb-realm' ? realm : String(stage);
        status(error.message, true);
        return;
      }
      realm = section.querySelector('#aeb-realm').value;
      stage = Number(section.querySelector('#aeb-stage').value);
      void load();
    };
    section.querySelector('#aeb-realm').addEventListener('change', (event) => changeSelection(event.target));
    section.querySelector('#aeb-stage').addEventListener('change', (event) => changeSelection(event.target));
    section.querySelector('#aeb-reset').onclick = () => {
      changed.set(key(), null);
      drawRows();
      status('本組已恢復預設；按「儲存上下限」才會同步全站。');
    };
    section.querySelector('#aeb-save').onclick = () => void save();
    section.querySelector('#aeb-rows').addEventListener('input', () => {
      try { capture(); } catch (error) { status(error.message, true); }
    });
    section.querySelector('details').addEventListener('toggle', (event) => {
      if (event.target.open && !currentRanges) void load();
    });
  }
  function boot() {
    mount();
    window.addEventListener('xiuxian:user-ready', mount);
    window.addEventListener('artifact-catalog-updated', mount);
    new MutationObserver(mount).observe(document.body, { subtree:true, childList:true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
