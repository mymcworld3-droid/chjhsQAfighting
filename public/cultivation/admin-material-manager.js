import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { ARTIFACT_CATALOG, getArtifactById, artifactRealmColor } from './artifact-catalog.js';
import {
  MATERIAL_CATALOG,
  MATERIAL_CATEGORIES,
  ARTIFACT_RECIPES,
  normalizeMaterialDefinition,
  validateMaterialCatalog,
  validateArtifactRecipes,
  replaceMaterialCatalog,
  replaceArtifactRecipes,
  getArtifactRecipe,
  getMaterialById,
  artifactRecipeDepth,
  MAX_ARTIFACT_RECIPE_NESTING,
  MIN_ARTIFACT_RECIPE_MATERIALS
} from './material-catalog.js';

(function () {
  'use strict';

  const PANEL_ID = 'admin-material-manager';
  const MATERIAL_MODAL_ID = 'admin-material-modal';
  const RECIPE_MODAL_ID = 'admin-artifact-recipe-modal';
  const CONFIG_COLLECTION = 'gameConfig';
  const CONFIG_DOC = 'materialCatalogV1';
  let busy = false;

  function data() { return window.getCurrentUserData?.() || null; }
  function isAdmin() { return data()?.isAdmin === true; }
  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function toast(message, ok = true) {
    document.getElementById('admin-material-toast')?.remove();
    const el = document.createElement('div');
    el.id = 'admin-material-toast';
    el.textContent = message;
    el.style.cssText = `position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:12300;padding:10px 15px;border-radius:999px;background:rgba(8,8,8,.97);border:1px solid ${ok ? 'rgba(216,177,93,.55)' : 'rgba(248,113,113,.55)'};color:${ok ? '#f5dfa7' : '#fecaca'};font-size:10px;font-weight:900;box-shadow:0 15px 45px rgba(0,0,0,.55)`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function ensureStyle() {
    if (document.getElementById('admin-material-manager-style')) return;
    const style = document.createElement('style');
    style.id = 'admin-material-manager-style';
    style.textContent = `
      #${PANEL_ID}{padding:14px;border:1px solid rgba(216,177,93,.2);border-radius:16px;background:linear-gradient(145deg,rgba(21,17,10,.94),rgba(7,7,7,.97))}
      .amm-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.amm-head h3{margin:0;color:#f3e5c3;font-size:14px}.amm-head p{margin:3px 0 0;color:#8e816b;font-size:8px;line-height:1.5}.amm-add{min-height:36px;padding:0 12px;border-radius:11px;border:1px solid rgba(216,177,93,.38);background:rgba(216,177,93,.09);color:#f1d895;font-size:9px;font-weight:900}
      .amm-section-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:13px 0 7px;padding-top:12px;border-top:1px solid rgba(255,255,255,.07);color:#d6ba76;font-size:9px;font-weight:900}.amm-section-title:first-of-type{margin-top:0;padding-top:0;border-top:0}.amm-list{display:grid;gap:7px}.amm-item{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:9px;align-items:center;padding:9px;border:1px solid rgba(255,255,255,.07);border-radius:13px;background:rgba(255,255,255,.018)}.amm-icon{width:38px;height:38px;display:grid;place-items:center;border-radius:11px;border:1px solid rgba(216,177,93,.25);color:#f0d17a;background:#171005;font-weight:900}.amm-copy{min-width:0}.amm-copy strong{color:#eee1c7;font-size:10px}.amm-meta{margin-top:3px;color:#887a63;font-size:7px}.amm-description{margin-top:4px;color:#716653;font-size:7px;line-height:1.45}.amm-actions{display:flex;gap:5px}.amm-actions button{min-height:31px;padding:0 8px;border-radius:9px;font-size:7px;font-weight:900}.amm-edit,.amm-recipe-edit{border:1px solid rgba(216,177,93,.22);background:rgba(216,177,93,.05);color:#dbc078}.amm-delete{border:1px solid rgba(248,113,113,.25);background:rgba(127,29,29,.12);color:#fca5a5}.amm-recipe-missing{color:#f0a5a5}.amm-recipe-ok{color:#bfa966}
      .amm-modal{position:fixed;inset:0;z-index:12200;display:grid;place-items:center;padding:14px;background:rgba(0,0,0,.82);backdrop-filter:blur(8px)}.amm-card{width:min(100%,650px);max-height:92dvh;overflow:auto;padding:18px;border:1px solid rgba(216,177,93,.28);border-radius:20px;background:linear-gradient(145deg,#18130c,#080808);box-shadow:0 30px 100px rgba(0,0,0,.72)}.amm-card h3{margin:0 0 4px;color:#f3e7ca;font-size:15px}.amm-note{margin:0 0 12px;color:#8f826d;font-size:8px;line-height:1.65}.amm-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.amm-field{display:grid;gap:4px}.amm-field.full{grid-column:1/-1}.amm-field label{color:#9a8d75;font-size:7px;font-weight:900}.amm-field input,.amm-field select,.amm-field textarea{width:100%;min-height:38px;padding:8px 9px;border:1px solid rgba(216,177,93,.16);border-radius:10px;background:#0a0908;color:#eadfc8;font-size:9px;outline:none}.amm-field textarea{min-height:78px;resize:vertical}.amm-status{margin-top:9px;color:#d6b86e;font-size:8px}.amm-modal-actions{display:flex;gap:8px;margin-top:14px}.amm-modal-actions button{flex:1;min-height:40px;border-radius:11px;font-size:9px;font-weight:900}.amm-cancel{border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:#aaa}.amm-save{border:1px solid rgba(216,177,93,.4);background:linear-gradient(135deg,#8f651e,#4b2f09);color:#fff0bd}.amm-save:disabled{opacity:.45}
      .amm-recipe-list{display:grid;gap:7px}.amm-recipe-row{display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:9px;align-items:center;padding:9px;border:1px solid rgba(255,255,255,.07);border-radius:12px}.amm-recipe-row label{color:#d9cba9;font-size:8px}.amm-recipe-row small{display:block;margin-top:2px;color:#766b58;font-size:6px}.amm-recipe-row input{width:100%;min-height:35px;padding:6px 8px;border:1px solid rgba(216,177,93,.14);border-radius:9px;background:#090807;color:#eadfc8;font-size:9px}.amm-recipe-group-title{margin:12px 0 6px;padding:7px 9px;border-radius:9px;background:rgba(216,177,93,.045);color:#d7bb77;font-size:8px;font-weight:900}.amm-recipe-row.is-artifact{border-color:color-mix(in srgb,var(--artifact-realm-color,#d8b15d) 28%,rgba(255,255,255,.07));background:radial-gradient(circle at 8% 50%,color-mix(in srgb,var(--artifact-realm-color,#d8b15d) 8%,transparent),transparent 34%)}.amm-recipe-row.is-artifact label{color:var(--artifact-realm-color,#d9cba9)}
      @media(max-width:620px){.amm-head{align-items:flex-start;flex-direction:column}.amm-add{width:100%}.amm-item{grid-template-columns:38px minmax(0,1fr)}.amm-actions{grid-column:1/-1}.amm-actions button{flex:1}.amm-grid{grid-template-columns:1fr}.amm-field.full{grid-column:auto}.amm-recipe-row{grid-template-columns:minmax(0,1fr) 90px}}
    `;
    document.head.appendChild(style);
  }

  function recipeRowName(row) {
    if (row?.artifactId) return getArtifactById(row.artifactId)?.name || row.artifactId;
    return getMaterialById(row?.materialId)?.name || row?.materialId || '未知素材';
  }

  function recipeLabel(artifactId) {
    const recipe = getArtifactRecipe(artifactId);
    if (!recipe.length) return '<span class="amm-recipe-missing">未設定材料配方</span>';
    const depth = artifactRecipeDepth(artifactId);
    const depthText = depth > 0 ? ` · 二次煉製深度 ${depth}/${MAX_ARTIFACT_RECIPE_NESTING}` : '';
    return `<span class="amm-recipe-ok">${recipe.map((row) => `${row.artifactId ? '法寶・' : ''}${escapeHtml(recipeRowName(row))} ×${row.quantity}`).join(' · ')}${depthText}</span>`;
  }

  function render() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !isAdmin()) return;
    const materialList = panel.querySelector('#admin-material-list');
    const recipeList = panel.querySelector('#admin-recipe-list');
    if (materialList) {
      materialList.innerHTML = MATERIAL_CATALOG.map((item) => `<article class="amm-item"><div class="amm-icon">${escapeHtml(item.icon || '材')}</div><div class="amm-copy"><strong>${escapeHtml(item.name)}</strong><div class="amm-meta">${escapeHtml(item.id)} · ${escapeHtml(item.category)} · ${item.buyGold > 0 ? `採購 ${item.buyGold} 金幣` : '不可直接採購'}</div><div class="amm-description">${escapeHtml(item.description || '')}</div></div><div class="amm-actions"><button type="button" class="amm-edit" data-material-edit="${escapeHtml(item.id)}"><i class="fa-solid fa-pen"></i> 編輯</button><button type="button" class="amm-delete" data-material-delete="${escapeHtml(item.id)}"><i class="fa-solid fa-trash"></i> 刪除</button></div></article>`).join('');
    }
    if (recipeList) {
      recipeList.innerHTML = ARTIFACT_CATALOG.map((artifact) => {
        const color = artifactRealmColor(artifact.realm);
        return `<article class="amm-item" style="--artifact-realm-color:${escapeHtml(color)};border-color:color-mix(in srgb,${escapeHtml(color)} 22%,rgba(255,255,255,.07))"><div class="amm-icon" style="border-color:color-mix(in srgb,${escapeHtml(color)} 48%,transparent);color:${escapeHtml(color)};background:color-mix(in srgb,${escapeHtml(color)} 10%,#171005)">${escapeHtml(artifact.icon || '◆')}</div><div class="amm-copy"><strong style="color:${escapeHtml(color)}">${escapeHtml(artifact.name)}</strong><div class="amm-meta">${escapeHtml(artifact.realm)} · ${recipeLabel(artifact.id)}</div></div><div class="amm-actions"><button type="button" class="amm-recipe-edit" data-recipe-edit="${escapeHtml(artifact.id)}"><i class="fa-solid fa-flask"></i> 設定配方</button></div></article>`;
      }).join('');
    }
  }

  async function verifyAndWrite(patch) {
    const auth = getAuth(getApp());
    const user = auth.currentUser;
    if (!user || !isAdmin()) throw new Error('僅管理員可以修改材料與配方');
    const db = getFirestore(getApp());
    await runTransaction(db, async (tx) => {
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists() || userSnap.data()?.isAdmin !== true) throw new Error('管理員權限驗證失敗');
      const configRef = doc(db, CONFIG_COLLECTION, CONFIG_DOC);
      tx.set(configRef, {
        ...patch,
        version: 1,
        updatedBy: user.uid,
        updatedByName: data()?.displayName || user.displayName || '管理員',
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now()
      }, { merge: true });
    });
  }

  async function persistMaterials(items) {
    const normalized = validateMaterialCatalog(items);
    await verifyAndWrite({ items: normalized });
    replaceMaterialCatalog(normalized, 'admin-save');
    return normalized;
  }

  async function persistRecipes(recipes) {
    const normalized = validateArtifactRecipes(recipes);
    await verifyAndWrite({ recipes: normalized });
    replaceArtifactRecipes(normalized, 'admin-save');
    return normalized;
  }

  function openMaterialEditor(item = null) {
    if (!isAdmin()) return;
    document.getElementById(MATERIAL_MODAL_ID)?.remove();
    const editing = !!item;
    const modal = document.createElement('div');
    modal.id = MATERIAL_MODAL_ID;
    modal.className = 'amm-modal';
    modal.innerHTML = `<section class="amm-card" role="dialog" aria-modal="true"><h3>${editing ? '編輯材料' : '新增材料'}</h3><p class="amm-note">材料 ID 建立後會鎖定。採購價設為 0 代表玩家不能直接用金幣取得，可留給未來洞天、鬥法或活動掉落。</p><div class="amm-grid"><div class="amm-field"><label>材料 ID（英文小寫與 -）</label><input id="amm-id" maxlength="64" ${editing ? 'readonly' : ''} value="${escapeHtml(item?.id || '')}" placeholder="例如 star-sand"></div><div class="amm-field"><label>名稱</label><input id="amm-name" maxlength="80" value="${escapeHtml(item?.name || '')}"></div><div class="amm-field"><label>圖示（1–4 字）</label><input id="amm-icon" maxlength="4" value="${escapeHtml(item?.icon || '材')}"></div><div class="amm-field"><label>分類</label><select id="amm-category">${MATERIAL_CATEGORIES.map((category) => `<option value="${escapeHtml(category)}" ${category === (item?.category || '其他') ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select></div><div class="amm-field"><label>採購價（金幣；0 = 不可購買）</label><input id="amm-buy-gold" type="number" min="0" step="1" value="${Math.max(0, Number(item?.buyGold) || 0)}"></div><div class="amm-field full"><label>說明</label><textarea id="amm-description" maxlength="500">${escapeHtml(item?.description || '')}</textarea></div></div><div id="amm-status" class="amm-status"></div><div class="amm-modal-actions"><button type="button" class="amm-cancel">取消</button><button type="button" class="amm-save">${editing ? '儲存變更' : '建立材料'}</button></div></section>`;
    document.body.appendChild(modal);
    modal.querySelector('.amm-cancel').onclick = () => modal.remove();
    modal.querySelector('.amm-save').onclick = () => saveMaterial(modal, editing ? item.id : '');
  }

  async function saveMaterial(modal, originalId) {
    if (busy) return;
    const status = modal.querySelector('#amm-status');
    const save = modal.querySelector('.amm-save');
    const id = String(modal.querySelector('#amm-id').value || '').trim().toLowerCase();
    const raw = {
      id,
      name: modal.querySelector('#amm-name').value,
      icon: modal.querySelector('#amm-icon').value,
      category: modal.querySelector('#amm-category').value,
      description: modal.querySelector('#amm-description').value,
      buyGold: modal.querySelector('#amm-buy-gold').value
    };
    if (originalId && id !== originalId) { status.textContent = '既有材料 ID 不可修改。'; return; }
    let item;
    try { item = normalizeMaterialDefinition(raw); } catch (error) { status.textContent = error.message; return; }
    const next = MATERIAL_CATALOG.map(clone);
    const index = next.findIndex((existing) => existing.id === id);
    if (!originalId && index >= 0) { status.textContent = `材料 ID「${id}」已存在。`; return; }
    if (originalId && index < 0) { status.textContent = '找不到要編輯的材料，請重新整理。'; return; }
    if (index >= 0) next[index] = item; else next.push(item);
    try { validateMaterialCatalog(next); } catch (error) { status.textContent = error.message || '材料資料不合法'; return; }
    busy = true; save.disabled = true; save.textContent = '儲存中…';
    try {
      await persistMaterials(next);
      modal.remove();
      render();
      toast(originalId ? `已更新材料：${item.name}` : `已建立材料：${item.name}`);
    } catch (error) {
      console.error('[Admin material save]', error);
      status.textContent = error.message || '材料儲存失敗';
      toast('材料儲存失敗', false);
    } finally {
      busy = false; save.disabled = false; save.textContent = originalId ? '儲存變更' : '建立材料';
    }
  }

  async function deleteMaterial(materialId) {
    if (busy || !isAdmin()) return;
    const item = getMaterialById(materialId);
    if (!item) return;
    const usedBy = ARTIFACT_CATALOG.filter((artifact) => getArtifactRecipe(artifact.id).some((row) => row.materialId === materialId));
    if (usedBy.length) {
      toast(`無法刪除：仍被 ${usedBy.map((artifact) => artifact.name).join('、')} 的配方使用`, false);
      return;
    }
    if (MATERIAL_CATALOG.length <= 1) { toast('至少需要保留 1 種材料', false); return; }
    if (!window.confirm(`確定要刪除材料「${item.name}」嗎？\n\n玩家既有材料數量會保留為休眠資料；若日後以相同 ID 重建，可重新顯示。`)) return;
    busy = true;
    try {
      const next = MATERIAL_CATALOG.filter((candidate) => candidate.id !== materialId).map(clone);
      await persistMaterials(next);
      render();
      toast(`已刪除材料：${item.name}`);
    } catch (error) {
      console.error('[Admin material delete]', error);
      toast(error.message || '材料刪除失敗', false);
    } finally { busy = false; }
  }

  function openRecipeEditor(artifact) {
    if (!artifact || !isAdmin()) return;
    document.getElementById(RECIPE_MODAL_ID)?.remove();
    const recipe = getArtifactRecipe(artifact.id);
    const materialCurrent = Object.fromEntries(recipe.filter((row) => row.materialId).map((row) => [row.materialId, row.quantity]));
    const artifactCurrent = Object.fromEntries(recipe.filter((row) => row.artifactId).map((row) => [row.artifactId, row.quantity]));
    const artifactChoices = ARTIFACT_CATALOG.filter((item) => item.id !== artifact.id);
    const modal = document.createElement('div');
    modal.id = RECIPE_MODAL_ID;
    modal.className = 'amm-modal';
    modal.innerHTML = `<section class="amm-card" role="dialog" aria-modal="true"><h3>${escapeHtml(artifact.name)} · 合成配方</h3><p class="amm-note">材料與既有法寶都可以放入 8 格煉器陣；每個配方至少投入 2 個素材。法寶可做二次煉製素材，但套娃深度最多 ${MAX_ARTIFACT_RECIPE_NESTING} 層；自己吃自己、循環配方或第 3 層套娃都會被拒絕。被裝備中的法寶不會被玩家煉器消耗。</p><div class="amm-recipe-list"><div class="amm-recipe-group-title">一般材料</div>${MATERIAL_CATALOG.map((material) => `<div class="amm-recipe-row"><label>${escapeHtml(material.icon || '材')} ${escapeHtml(material.name)}<small>${escapeHtml(material.category)} · ${escapeHtml(material.realm || '凡人')} · ${material.buyGold > 0 ? `採購 ${material.buyGold} 金幣` : '不可購買'}</small></label><input type="number" min="0" step="1" value="${Math.max(0, Number(materialCurrent[material.id]) || 0)}" data-recipe-material="${escapeHtml(material.id)}"></div>`).join('')}<div class="amm-recipe-group-title">法寶素材（二次煉製）</div>${artifactChoices.map((item) => {
      const color = artifactRealmColor(item.realm);
      return `<div class="amm-recipe-row is-artifact" style="--artifact-realm-color:${escapeHtml(color)}"><label>${escapeHtml(item.icon || '◆')} ${escapeHtml(item.name)}<small>${escapeHtml(item.realm)} · 目前配方深度 ${artifactRecipeDepth(item.id)}/${MAX_ARTIFACT_RECIPE_NESTING}</small></label><input type="number" min="0" step="1" value="${Math.max(0, Number(artifactCurrent[item.id]) || 0)}" data-recipe-artifact="${escapeHtml(item.id)}"></div>`;
    }).join('')}</div><div id="amm-recipe-status" class="amm-status"></div><div class="amm-modal-actions"><button type="button" class="amm-cancel">取消</button><button type="button" class="amm-save">儲存配方</button></div></section>`;
    document.body.appendChild(modal);
    modal.querySelector('.amm-cancel').onclick = () => modal.remove();
    modal.querySelector('.amm-save').onclick = () => saveRecipe(modal, artifact);
  }

  async function saveRecipe(modal, artifact) {
    if (busy) return;
    const status = modal.querySelector('#amm-recipe-status');
    const save = modal.querySelector('.amm-save');
    const materialRows = [...modal.querySelectorAll('[data-recipe-material]')].map((input) => ({
      materialId: input.dataset.recipeMaterial,
      quantity: Math.max(0, Math.floor(Number(input.value) || 0))
    })).filter((row) => row.quantity > 0);
    const artifactRows = [...modal.querySelectorAll('[data-recipe-artifact]')].map((input) => ({
      artifactId: input.dataset.recipeArtifact,
      quantity: Math.max(0, Math.floor(Number(input.value) || 0))
    })).filter((row) => row.quantity > 0);
    const recipe = [...materialRows, ...artifactRows];
    const totalItems = recipe.reduce((sum, row) => sum + Math.max(0, Number(row.quantity) || 0), 0);
    if (totalItems < MIN_ARTIFACT_RECIPE_MATERIALS) {
      status.textContent = `每個法寶配方至少需要 ${MIN_ARTIFACT_RECIPE_MATERIALS} 個材料或法寶素材，目前只有 ${totalItems} 個。`;
      return;
    }
    const next = clone(ARTIFACT_RECIPES);
    next[artifact.id] = recipe;
    try { validateArtifactRecipes(next); } catch (error) { status.textContent = error.message; return; }
    busy = true; save.disabled = true; save.textContent = '儲存中…';
    try {
      await persistRecipes(next);
      modal.remove();
      render();
      toast(`已更新 ${artifact.name} 的煉器配方`);
    } catch (error) {
      console.error('[Admin recipe save]', error);
      status.textContent = error.message || '配方儲存失敗';
      toast('配方儲存失敗', false);
    } finally { busy = false; save.disabled = false; save.textContent = '儲存配方'; }
  }

  function mount() {
    if (!isAdmin()) return;
    ensureStyle();
    const page = document.getElementById('page-admin');
    if (!page) return;

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('section');
      panel.id = PANEL_ID;
      const artifactPanel = document.getElementById('admin-artifact-manager');
      if (artifactPanel?.nextSibling) page.insertBefore(panel, artifactPanel.nextSibling);
      else if (artifactPanel) artifactPanel.after(panel);
      else page.prepend(panel);
    }

    panel.dataset.adminSectionTitle = '材料管理';
    panel.dataset.adminSectionIcon = 'fa-gem';

    if (panel.dataset.materialManagerHydrated !== '1') {
      panel.dataset.materialManagerHydrated = '1';
      panel.classList.remove('admin-preload-shell');
      panel.innerHTML = `<div class="amm-head"><div><h3><i class="fa-solid fa-gem" style="color:#d8b15d"></i> 材料與法寶配方</h3><p>管理全站煉器材料，並設定每件法寶合成時必須消耗的材料。</p></div><button type="button" class="amm-add" id="admin-material-add"><i class="fa-solid fa-plus"></i> 新增材料</button></div><div class="amm-section-title"><span>材料清單</span><span>${MATERIAL_CATALOG.length} 種</span></div><div id="admin-material-list" class="amm-list"></div><div class="amm-section-title"><span>法寶合成配方</span><span>未設定配方的法寶不可合成</span></div><div id="admin-recipe-list" class="amm-list"></div>`;
      panel.querySelector('#admin-material-add').onclick = () => openMaterialEditor();
      panel.addEventListener('click', (event) => {
        const edit = event.target.closest('[data-material-edit]');
        const del = event.target.closest('[data-material-delete]');
        const recipe = event.target.closest('[data-recipe-edit]');
        if (edit) {
          const item = getMaterialById(edit.dataset.materialEdit);
          if (item) openMaterialEditor(item);
        } else if (del) {
          deleteMaterial(del.dataset.materialDelete);
        } else if (recipe) {
          const artifact = ARTIFACT_CATALOG.find((item) => item.id === recipe.dataset.recipeEdit);
          if (artifact) openRecipeEditor(artifact);
        }
      });
    }
    render();
  }

  function refresh() { mount(); render(); }
  function boot() {
    refresh();
    window.addEventListener('xiuxian:user-ready', refresh);
    window.addEventListener('material-catalog-updated', refresh);
    window.addEventListener('artifact-recipes-updated', refresh);
    window.addEventListener('artifact-catalog-updated', refresh);
    new MutationObserver(() => { if (!document.getElementById(PANEL_ID)) mount(); }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
