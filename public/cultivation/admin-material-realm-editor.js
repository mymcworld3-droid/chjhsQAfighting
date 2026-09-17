import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
  MATERIAL_CATALOG,
  MATERIAL_CATEGORIES,
  MATERIAL_REALMS,
  normalizeMaterialDefinition,
  validateMaterialCatalog,
  replaceMaterialCatalog,
  getMaterialById,
  materialRealmColor
} from './material-catalog.js';

// 取代舊材料編輯視窗，加入「材料境界」欄位。
// 其餘材料刪除與法寶配方功能仍由 admin-material-manager.js 負責。
(function () {
  'use strict';

  const MODAL_ID = 'admin-material-modal';
  const CONFIG_COLLECTION = 'gameConfig';
  const CONFIG_DOC = 'materialCatalogV1';
  let busy = false;

  function data() { return window.getCurrentUserData?.() || null; }
  function isAdmin() { return data()?.isAdmin === true; }
  function esc(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  async function persistMaterials(items) {
    const normalized = validateMaterialCatalog(items);
    const auth = getAuth(getApp());
    const user = auth.currentUser;
    if (!user || !isAdmin()) throw new Error('僅管理員可以修改材料');
    const db = getFirestore(getApp());
    await runTransaction(db, async (tx) => {
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists() || userSnap.data()?.isAdmin !== true) throw new Error('管理員權限驗證失敗');
      const configRef = doc(db, CONFIG_COLLECTION, CONFIG_DOC);
      tx.set(configRef, {
        items: normalized,
        version: 2,
        updatedBy: user.uid,
        updatedByName: data()?.displayName || user.displayName || '管理員',
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now()
      }, { merge: true });
    });
    replaceMaterialCatalog(normalized, 'admin-realm-save');
    return normalized;
  }

  function realmOptions(selected) {
    return MATERIAL_REALMS.map((realm) => `<option value="${esc(realm.name)}" ${realm.name === selected ? 'selected' : ''}>${esc(realm.name)}</option>`).join('');
  }

  function openEditor(item = null) {
    if (!isAdmin()) return;
    document.getElementById(MODAL_ID)?.remove();
    const editing = !!item;
    const realm = item?.realm || '煉氣';
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'amm-modal';
    modal.innerHTML = `<section class="amm-card" role="dialog" aria-modal="true">
      <h3>${editing ? '編輯材料' : '新增材料'}</h3>
      <p class="amm-note">材料境界同時決定顯示顏色與自然掉落稀有度。修士未達該境界前，問道與洞天不會掉落此材料；修士境界越高於材料境界，該材料越容易出現。</p>
      <div class="amm-grid">
        <div class="amm-field"><label>材料 ID（英文小寫與 -）</label><input id="amre-id" maxlength="64" ${editing ? 'readonly' : ''} value="${esc(item?.id || '')}" placeholder="例如 star-sand"></div>
        <div class="amm-field"><label>名稱</label><input id="amre-name" maxlength="80" value="${esc(item?.name || '')}"></div>
        <div class="amm-field"><label>圖示（1–4 字）</label><input id="amre-icon" maxlength="4" value="${esc(item?.icon || '材')}"></div>
        <div class="amm-field"><label>分類</label><select id="amre-category">${MATERIAL_CATEGORIES.map((category) => `<option value="${esc(category)}" ${category === (item?.category || '其他') ? 'selected' : ''}>${esc(category)}</option>`).join('')}</select></div>
        <div class="amm-field"><label>材料境界</label><select id="amre-realm">${realmOptions(realm)}</select></div>
        <div class="amm-field"><label>採購價（金幣；0 = 不可購買）</label><input id="amre-buy-gold" type="number" min="0" step="1" value="${Math.max(0, Number(item?.buyGold) || 0)}"></div>
        <div class="amm-field full"><label>境界預覽</label><div id="amre-realm-preview" style="min-height:38px;display:flex;align-items:center;padding:8px 10px;border:1px solid rgba(255,255,255,.1);border-radius:10px;font-size:9px;font-weight:900"></div></div>
        <div class="amm-field full"><label>說明</label><textarea id="amre-description" maxlength="500">${esc(item?.description || '')}</textarea></div>
      </div>
      <div id="amre-status" class="amm-status"></div>
      <div class="amm-modal-actions"><button type="button" class="amm-cancel">取消</button><button type="button" class="amm-save">${editing ? '儲存變更' : '建立材料'}</button></div>
    </section>`;
    document.body.appendChild(modal);

    const preview = () => {
      const selectedRealm = modal.querySelector('#amre-realm').value;
      const color = materialRealmColor(selectedRealm);
      const node = modal.querySelector('#amre-realm-preview');
      node.textContent = `${selectedRealm}材料 · 顏色與掉落稀有度由此境界決定`;
      node.style.color = color;
      node.style.borderColor = `${color}66`;
      node.style.background = `${color}12`;
    };
    preview();
    modal.querySelector('#amre-realm').addEventListener('change', preview);
    modal.querySelector('.amm-cancel').onclick = () => modal.remove();
    modal.querySelector('.amm-save').onclick = () => save(modal, editing ? item.id : '');
  }

  async function save(modal, originalId) {
    if (busy) return;
    const status = modal.querySelector('#amre-status');
    const saveButton = modal.querySelector('.amm-save');
    const id = String(modal.querySelector('#amre-id').value || '').trim().toLowerCase();
    const raw = {
      id,
      name: modal.querySelector('#amre-name').value,
      icon: modal.querySelector('#amre-icon').value,
      category: modal.querySelector('#amre-category').value,
      realm: modal.querySelector('#amre-realm').value,
      description: modal.querySelector('#amre-description').value,
      buyGold: modal.querySelector('#amre-buy-gold').value
    };
    if (originalId && id !== originalId) { status.textContent = '既有材料 ID 不可修改。'; return; }

    let normalized;
    try { normalized = normalizeMaterialDefinition(raw); } catch (error) { status.textContent = error.message; return; }
    const next = MATERIAL_CATALOG.map(clone);
    const index = next.findIndex((candidate) => candidate.id === id);
    if (!originalId && index >= 0) { status.textContent = `材料 ID「${id}」已存在。`; return; }
    if (originalId && index < 0) { status.textContent = '找不到要編輯的材料，請重新整理。'; return; }
    if (index >= 0) next[index] = normalized; else next.push(normalized);
    try { validateMaterialCatalog(next); } catch (error) { status.textContent = error.message || '材料資料不合法'; return; }

    busy = true;
    saveButton.disabled = true;
    saveButton.textContent = '儲存中…';
    try {
      await persistMaterials(next);
      modal.remove();
    } catch (error) {
      console.error('[Admin material realm save]', error);
      status.textContent = error.message || '材料儲存失敗';
    } finally {
      busy = false;
      if (saveButton.isConnected) {
        saveButton.disabled = false;
        saveButton.textContent = originalId ? '儲存變更' : '建立材料';
      }
    }
  }

  function intercept(event) {
    if (!isAdmin()) return;
    const add = event.target.closest?.('#admin-material-add');
    const edit = event.target.closest?.('[data-material-edit]');
    if (!add && !edit) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (add) openEditor();
    else openEditor(getMaterialById(edit.dataset.materialEdit));
  }

  function boot() {
    document.addEventListener('click', intercept, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
