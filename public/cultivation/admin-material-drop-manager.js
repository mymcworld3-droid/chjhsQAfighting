import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, onSnapshot, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { MATERIAL_CATALOG } from './material-catalog.js';

(function () {
  'use strict';

  const PANEL_ID = 'admin-material-drop-manager';
  const CONFIG_COLLECTION = 'gameConfig';
  const CONFIG_DOC = 'materialDropV1';
  let rules = {};
  let busy = false;
  let unwatch = null;

  const BUILTIN_RATES = Object.freeze({
    'spirit-iron': { quizRate: 0.04, dongtianRate: 0.20 },
    'spirit-wood': { quizRate: 0.05, dongtianRate: 0.22 },
    'spirit-crystal': { quizRate: 0.03, dongtianRate: 0.15 },
    'beast-core-shard': { quizRate: 0.02, dongtianRate: 0.10 },
    'talisman-paper': { quizRate: 0.06, dongtianRate: 0.25 }
  });

  function data() { return window.getCurrentUserData?.() || null; }
  function isAdmin() { return data()?.isAdmin === true; }
  function database() { return getFirestore(getApp()); }
  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function clampRate(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
  }
  function defaultRule(materialId) {
    return BUILTIN_RATES[materialId] ? { ...BUILTIN_RATES[materialId] } : { quizRate: 0.03, dongtianRate: 0.15 };
  }
  function normalizedRule(materialId, raw) {
    const fallback = defaultRule(materialId);
    return {
      quizRate: clampRate(raw?.quizRate, fallback.quizRate),
      dongtianRate: clampRate(raw?.dongtianRate, fallback.dongtianRate)
    };
  }
  function normalizeRules(raw = {}) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const next = {};
    MATERIAL_CATALOG.forEach((material) => {
      next[material.id] = normalizedRule(material.id, source[material.id]);
    });
    return next;
  }
  function toast(message, ok = true) {
    document.getElementById('admin-material-drop-toast')?.remove();
    const el = document.createElement('div');
    el.id = 'admin-material-drop-toast';
    el.textContent = message;
    el.style.cssText = `position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:12400;padding:10px 15px;border-radius:999px;background:rgba(8,8,8,.97);border:1px solid ${ok ? 'rgba(216,177,93,.55)' : 'rgba(248,113,113,.55)'};color:${ok ? '#f5dfa7' : '#fecaca'};font-size:10px;font-weight:900;box-shadow:0 15px 45px rgba(0,0,0,.55)`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function ensureStyle() {
    if (document.getElementById('admin-material-drop-style')) return;
    const style = document.createElement('style');
    style.id = 'admin-material-drop-style';
    style.textContent = `
      #${PANEL_ID}{padding:14px;border:1px solid rgba(167,139,250,.2);border-radius:16px;background:linear-gradient(145deg,rgba(18,14,26,.94),rgba(7,7,7,.97))}
      .amdm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}.amdm-head h3{margin:0;color:#eadcff;font-size:14px}.amdm-head p{margin:3px 0 0;color:#8f819d;font-size:8px;line-height:1.55}.amdm-save{min-height:36px;padding:0 12px;border-radius:11px;border:1px solid rgba(167,139,250,.38);background:rgba(167,139,250,.09);color:#e3d5ff;font-size:9px;font-weight:900}.amdm-save:disabled{opacity:.45}
      .amdm-table{display:grid;gap:7px}.amdm-row{display:grid;grid-template-columns:42px minmax(0,1fr) 150px 150px;gap:9px;align-items:center;padding:9px;border:1px solid rgba(255,255,255,.07);border-radius:13px;background:rgba(255,255,255,.018)}.amdm-icon{width:38px;height:38px;display:grid;place-items:center;border-radius:11px;border:1px solid rgba(167,139,250,.25);background:#120d1b;color:#d9c2ff;font-weight:900}.amdm-copy strong{display:block;color:#eee3fa;font-size:10px}.amdm-copy small{display:block;margin-top:3px;color:#81738d;font-size:7px}.amdm-field{display:grid;gap:3px;color:#9688a3;font-size:7px;font-weight:900}.amdm-field input{width:100%;min-height:36px;padding:7px 8px;border:1px solid rgba(167,139,250,.16);border-radius:9px;background:#09070d;color:#eadcff;font-size:9px;outline:none}.amdm-field input:focus{border-color:rgba(167,139,250,.48)}.amdm-help{margin-top:9px;padding:8px 10px;border-radius:10px;background:rgba(167,139,250,.045);color:#8d8098;font-size:7px;line-height:1.6}.amdm-help b{color:#cdb4f3}
      @media(max-width:720px){.amdm-head{flex-direction:column}.amdm-save{width:100%}.amdm-row{grid-template-columns:38px minmax(0,1fr)}.amdm-field{grid-column:1/-1}.amdm-field input{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function render() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !isAdmin()) return;
    const list = panel.querySelector('#admin-material-drop-list');
    if (!list) return;
    rules = normalizeRules(rules);
    list.innerHTML = MATERIAL_CATALOG.map((material) => {
      const rule = normalizedRule(material.id, rules[material.id]);
      return `<article class="amdm-row" data-material-drop-row="${escapeHtml(material.id)}"><div class="amdm-icon">${escapeHtml(material.icon || '材')}</div><div class="amdm-copy"><strong>${escapeHtml(material.name)}</strong><small>${escapeHtml(material.category || '材料')} · ${escapeHtml(material.id)}</small></div><label class="amdm-field">問道答對掉落率（%）<input type="number" min="0" max="100" step="0.1" data-drop-quiz value="${(rule.quizRate * 100).toFixed(1)}"></label><label class="amdm-field">洞天首次通關掉落率（%）<input type="number" min="0" max="100" step="0.1" data-drop-dongtian value="${(rule.dongtianRate * 100).toFixed(1)}"></label></article>`;
    }).join('') || '<div style="color:#8f819d;font-size:8px">目前沒有材料。</div>';
  }

  function readRulesFromPanel() {
    const next = {};
    document.querySelectorAll(`#${PANEL_ID} [data-material-drop-row]`).forEach((row) => {
      const materialId = row.dataset.materialDropRow;
      next[materialId] = {
        quizRate: clampRate((Number(row.querySelector('[data-drop-quiz]')?.value) || 0) / 100, 0),
        dongtianRate: clampRate((Number(row.querySelector('[data-drop-dongtian]')?.value) || 0) / 100, 0)
      };
    });
    return normalizeRules(next);
  }

  async function saveRules() {
    if (busy || !isAdmin()) return;
    const auth = getAuth(getApp());
    const user = auth.currentUser;
    if (!user) return;
    const button = document.querySelector(`#${PANEL_ID} .amdm-save`);
    const next = readRulesFromPanel();
    busy = true;
    if (button) { button.disabled = true; button.textContent = '儲存中…'; }
    try {
      await runTransaction(database(), async (tx) => {
        const userRef = doc(database(), 'users', user.uid);
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists() || userSnap.data()?.isAdmin !== true) throw new Error('管理員權限驗證失敗');
        tx.set(doc(database(), CONFIG_COLLECTION, CONFIG_DOC), {
          version: 1,
          rules: next,
          updatedBy: user.uid,
          updatedByName: data()?.displayName || user.displayName || '管理員',
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now()
        }, { merge: true });
      });
      rules = next;
      window.XIUXIAN_MATERIAL_DROP_RULES = JSON.parse(JSON.stringify(next));
      window.dispatchEvent(new CustomEvent('material-drop-rules-updated', { detail: window.XIUXIAN_MATERIAL_DROP_RULES }));
      toast('材料掉落機率已更新');
    } catch (error) {
      console.error('[Admin material drop]', error);
      toast(error.message || '掉落機率儲存失敗', false);
    } finally {
      busy = false;
      if (button) { button.disabled = false; button.textContent = '儲存掉落率'; }
    }
  }

  function mount() {
    if (!isAdmin()) return;
    ensureStyle();
    const page = document.getElementById('page-admin');
    if (!page || document.getElementById(PANEL_ID)) return;
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.dataset.adminSectionTitle = '材料掉落機率';
    panel.dataset.adminSectionIcon = 'fa-dice';
    panel.innerHTML = `<div class="amdm-head"><div><h3><i class="fa-solid fa-dice" style="color:#c4b5fd"></i> 材料掉落機率</h3><p>每種材料獨立抽取。問道只在本機實際答對時抽取；洞天只在該玩家首次完整通關該洞天時抽取。</p></div><button type="button" class="amdm-save">儲存掉落率</button></div><div id="admin-material-drop-list" class="amdm-table"></div><div class="amdm-help"><b>例：</b>問道 5% 表示每次答對有 5% 機率得到該材料。不同材料會各自抽一次，所以同一題可能沒有掉落，也可能同時掉落兩種以上材料。</div>`;
    const materialPanel = document.getElementById('admin-material-manager');
    if (materialPanel?.nextSibling) page.insertBefore(panel, materialPanel.nextSibling);
    else if (materialPanel) materialPanel.after(panel);
    else page.appendChild(panel);
    panel.querySelector('.amdm-save').onclick = saveRules;
    render();
  }

  function watchConfig() {
    if (unwatch) return;
    try {
      unwatch = onSnapshot(doc(database(), CONFIG_COLLECTION, CONFIG_DOC), (snap) => {
        rules = normalizeRules(snap.exists() ? snap.data()?.rules : {});
        render();
      }, (error) => console.warn('[Admin material drop config]', error));
    } catch (error) {
      console.warn('[Admin material drop config]', error);
    }
  }

  function boot() {
    rules = normalizeRules(window.XIUXIAN_MATERIAL_DROP_RULES || {});
    mount();
    watchConfig();
    window.addEventListener('xiuxian:user-ready', () => { mount(); watchConfig(); });
    window.addEventListener('material-catalog-updated', () => { rules = normalizeRules(rules); render(); mount(); });
    window.addEventListener('material-drop-rules-updated', (event) => { rules = normalizeRules(event.detail || {}); render(); });
    new MutationObserver(() => { if (!document.getElementById(PANEL_ID)) mount(); }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
