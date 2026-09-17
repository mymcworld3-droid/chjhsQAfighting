import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, runTransaction } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { ARTIFACT_CATALOG } from './artifact-catalog.js';
import { MATERIAL_CATALOG, ARTIFACT_RECIPES, getMaterialById, getArtifactRecipe, materialRealmColor } from './material-catalog.js';

(function () {
  'use strict';

  const SLOT_COUNT = 8;
  const TAB = 'refinery';
  const selected = Array(SLOT_COUNT).fill(null);
  let active = false;
  let busy = false;
  let queued = false;

  const userData = () => window.getCurrentUserData?.() || null;
  function authUser() { try { return getAuth(getApp()).currentUser; } catch (_) { return null; } }
  function db() { return getFirestore(getApp()); }
  function esc(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function toast(message, ok = true) {
    document.getElementById('cultivation-refinery-toast')?.remove();
    const el = document.createElement('div');
    el.id = 'cultivation-refinery-toast';
    el.textContent = message;
    el.style.cssText = `position:fixed;left:50%;bottom:135px;z-index:10200;max-width:calc(100vw - 28px);transform:translateX(-50%);padding:10px 15px;border:1px solid ${ok ? 'rgba(216,177,93,.48)' : 'rgba(248,113,113,.5)'};border-radius:999px;background:rgba(8,8,8,.97);color:${ok ? '#f5dda0' : '#fecaca'};font-size:10px;font-weight:900;box-shadow:0 16px 48px rgba(0,0,0,.55)`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function normalizeMaterials(raw = {}) {
    const inventory = {};
    Object.entries(raw?.inventory || {}).forEach(([id, value]) => {
      const qty = Math.max(0, Math.floor(Number(value) || 0));
      if (qty > 0) inventory[id] = qty;
    });
    return { inventory };
  }
  function inventory() { return normalizeMaterials(userData()?.materialSystem || {}).inventory; }
  function selectedCounts() {
    const out = {};
    selected.forEach((id) => { if (id) out[id] = (out[id] || 0) + 1; });
    return out;
  }
  function countsKey(counts) {
    return Object.entries(counts || {}).filter(([, q]) => Number(q) > 0)
      .map(([id, q]) => [String(id), Math.floor(Number(q) || 0)])
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, q]) => `${id}:${q}`).join('|');
  }
  function recipeCounts(recipe) {
    const out = {};
    (recipe || []).forEach((row) => {
      const id = String(row?.materialId || '').trim();
      const q = Math.max(0, Math.floor(Number(row?.quantity) || 0));
      if (id && q) out[id] = (out[id] || 0) + q;
    });
    return out;
  }
  function recipeTotal(recipe) {
    return (recipe || []).reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row?.quantity) || 0)), 0);
  }
  function matches() {
    const key = countsKey(selectedCounts());
    if (!key) return [];
    return ARTIFACT_CATALOG.filter((item) => {
      const recipe = getArtifactRecipe(item.id);
      return recipe.length && recipeTotal(recipe) <= SLOT_COUNT && countsKey(recipeCounts(recipe)) === key;
    });
  }

  function ensureStyle() {
    if (document.getElementById('cultivation-refinery-v2-style')) return;
    const style = document.createElement('style');
    style.id = 'cultivation-refinery-v2-style';
    style.textContent = `
      #page-settings #artifact-forge-card,#page-settings #material-store-card{display:none!important}
      .cultivation-refinery{width:min(100%,980px);margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}
      .refinery-panel{min-width:0;padding:14px;border:1px solid rgba(216,177,93,.2);border-radius:18px;background:linear-gradient(145deg,rgba(21,17,10,.96),rgba(7,7,7,.97));box-shadow:0 16px 42px rgba(0,0,0,.3)}
      .refinery-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:11px}.refinery-head h3{margin:0;color:#f1e1bc;font-size:13px}.refinery-head p{margin:4px 0 0;color:#8d816c;font-size:8px;line-height:1.55}.refinery-badge{padding:5px 8px;border:1px solid rgba(216,177,93,.15);border-radius:999px;color:#cdb46f;font-size:7px;white-space:nowrap}
      .refinery-material-list{display:grid;gap:7px;max-height:430px;overflow:auto;padding-right:3px}.refinery-material{display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:9px;align-items:center;width:100%;padding:9px;border:1px solid rgba(255,255,255,.065);border-radius:12px;background:rgba(255,255,255,.018);text-align:left}.refinery-material:not(:disabled):hover{border-color:rgba(216,177,93,.36);background:rgba(216,177,93,.055)}.refinery-material:disabled{opacity:.4;cursor:not-allowed}.refinery-mat-icon{width:40px;height:40px;display:grid;place-items:center;border:1px solid rgba(216,177,93,.25);border-radius:11px;background:#171006;color:#efd17c;font-size:12px;font-weight:900}.refinery-mat-copy strong{display:block;color:#ede1c8;font-size:10px}.refinery-mat-copy small{display:block;margin-top:3px;color:#81745f;font-size:7px}.refinery-mat-qty{color:#d5b96e;font-size:8px;font-weight:900;white-space:nowrap}.refinery-empty{padding:22px 12px;text-align:center;color:#82745f;font-size:9px;border:1px dashed rgba(216,177,93,.13);border-radius:13px;line-height:1.7}
      .refinery-slots{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:12px 0}.refinery-slot{aspect-ratio:1;min-height:72px;display:grid;place-items:center;padding:6px;border:1px solid rgba(216,177,93,.18);border-radius:13px;background:radial-gradient(circle at 50% 35%,rgba(216,177,93,.07),rgba(255,255,255,.012));color:#6f6657;position:relative}.refinery-slot.filled{border-color:rgba(216,177,93,.42);color:#efd17c;background:radial-gradient(circle at 50% 35%,rgba(216,177,93,.14),rgba(38,24,6,.18))}.refinery-slot .idx{position:absolute;top:5px;left:6px;color:#675c4d;font-size:6px}.refinery-slot .remove{position:absolute;top:4px;right:5px;color:#a98566;font-size:7px}.refinery-slot .icon{font-size:17px;font-weight:900}.refinery-slot .name{display:block;margin-top:3px;color:#d9c89f;font-size:6px;text-align:center}.refinery-slot:not(.filled) .remove,.refinery-slot:not(.filled) .name{display:none}
      .refinery-summary,.refinery-match{padding:8px 9px;border-radius:11px;font-size:8px;line-height:1.6}.refinery-summary{min-height:35px;background:rgba(216,177,93,.035);color:#93846d}.refinery-summary strong{color:#d5bb79}.refinery-match{margin-top:8px;border:1px solid rgba(216,177,93,.13);color:#93846d}.refinery-match.ready{border-color:rgba(134,239,172,.2);color:#b9d6b4}.refinery-match.error{border-color:rgba(248,113,113,.18);color:#d7a0a0}.refinery-match b{color:#ead79f}.refinery-actions{display:flex;gap:8px;margin-top:10px}.refinery-clear,.refinery-craft{min-height:42px;border-radius:12px;font-size:9px;font-weight:900}.refinery-clear{width:34%;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.025);color:#9f9585}.refinery-craft{flex:1;border:1px solid rgba(216,177,93,.42);background:linear-gradient(135deg,#8f651e,#4b2f09);color:#fff0bd}.refinery-clear:disabled,.refinery-craft:disabled{opacity:.4;cursor:not-allowed}.refinery-note{margin-top:8px;color:#6f6556;font-size:7px;line-height:1.55}.refinery-note b{color:#aa9360}
      @media(max-width:760px){.cultivation-refinery{grid-template-columns:1fr}.refinery-material-list{max-height:300px}.refinery-slot{min-height:62px}}
      @media(max-width:430px){.refinery-slots{gap:5px}.refinery-slot{min-height:55px;border-radius:10px}.refinery-material{grid-template-columns:38px minmax(0,1fr) auto}.refinery-mat-icon{width:36px;height:36px}}
    `;
    document.head.appendChild(style);
  }

  function foundationBag() {
    return '<section class="training-v3-empty foundation-training-bag"><i class="fa-solid fa-box-open"></i><h3>修煉背包</h3><p>修煉途中取得的特殊物品會收納於此。</p></section>';
  }

  function tabActive(page) {
    return !!page?.querySelector(`[data-training-tab="${TAB}"].active`);
  }
  function activate(page) {
    active = true;
    page.querySelectorAll('[data-training-tab]').forEach((tab) => {
      const yes = tab.dataset.trainingTab === TAB;
      tab.classList.toggle('active', yes);
      tab.setAttribute('aria-selected', yes ? 'true' : 'false');
    });
    render(true);
  }
  function bindExit(page, button) {
    if (button.dataset.refineryExitBound === '1') return;
    button.dataset.refineryExitBound = '1';
    button.addEventListener('click', () => {
      active = false;
      if (page.dataset.foundationTraining === '1' && button.dataset.trainingTab === 'bag') {
        page.querySelectorAll('[data-training-tab]').forEach((tab) => {
          const yes = tab === button;
          tab.classList.toggle('active', yes);
          tab.setAttribute('aria-selected', yes ? 'true' : 'false');
        });
        const content = page.querySelector('#training-tab-content');
        if (content) { delete content.dataset.refineryRenderKey; content.innerHTML = foundationBag(); }
        window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', { detail: { refineryTabClosed: true } }));
      }
    });
  }
  function ensureTab() {
    const page = document.getElementById('page-training');
    const tabs = page?.querySelector('.training-subtabs-v3');
    const bag = tabs?.querySelector('[data-training-tab="bag"]');
    if (!page || !tabs || !bag) return;
    let tab = tabs.querySelector(`[data-training-tab="${TAB}"]`);
    if (!tab) {
      tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'training-subtab-v3';
      tab.dataset.trainingTab = TAB;
      tab.setAttribute('aria-selected', 'false');
      tab.innerHTML = '<i class="fa-solid fa-hammer"></i><span>煉器</span>';
      bag.before(tab);
      tab.addEventListener('click', () => activate(page));
    }
    tabs.querySelectorAll('[data-training-tab]').forEach((button) => {
      if (button.dataset.trainingTab !== TAB) bindExit(page, button);
    });
    if (active && tabActive(page)) render();
  }

  function currentSignature() {
    const inv = inventory();
    return JSON.stringify({
      selected,
      busy,
      inventory: Object.entries(inv).sort(([a], [b]) => a.localeCompare(b)),
      materials: MATERIAL_CATALOG.map((m) => [m.id, m.name, m.icon, m.category]),
      artifacts: ARTIFACT_CATALOG.map((a) => [a.id, a.name, a.icon, a.craft?.yield || 1]),
      recipes: ARTIFACT_RECIPES
    });
  }

  function markup() {
    const inv = inventory();
    const counts = selectedCounts();
    const used = selected.filter(Boolean).length;
    const ownedMaterials = MATERIAL_CATALOG.filter((m) => (Number(inv[m.id]) || 0) > 0);
    const matching = matches();
    const materialHtml = ownedMaterials.length ? ownedMaterials.map((m) => {
      const owned = Number(inv[m.id]) || 0;
      const placed = Number(counts[m.id]) || 0;
      const remaining = Math.max(0, owned - placed);
      const color = materialRealmColor(m.realm);
      return `<button type="button" class="refinery-material" data-refinery-material="${esc(m.id)}" data-material-realm="${esc(m.realm || '凡人')}" style="--material-realm-color:${esc(color)}" ${remaining <= 0 || used >= SLOT_COUNT || busy ? 'disabled' : ''}><span class="refinery-mat-icon">${esc(m.icon || '材')}</span><span class="refinery-mat-copy"><strong>${esc(m.name)}</strong><small>${esc(m.category || '材料')} · 已放入 ${placed}</small><span class="material-realm-badge">${esc(m.realm || '凡人')}</span></span><span class="refinery-mat-qty">可用 ${remaining}/${owned}</span></button>`;
    }).join('') : '<div class="refinery-empty"><i class="fa-solid fa-box-open"></i><br>目前沒有煉器材料。<br>可透過問道與洞天取得。</div>';
    const slotHtml = selected.map((id, index) => {
      const m = id ? getMaterialById(id) : null;
      const realm = m?.realm || '';
      const color = m ? materialRealmColor(realm) : '';
      return `<button type="button" class="refinery-slot ${m ? 'filled' : ''}" data-refinery-slot="${index}" ${m ? `data-refinery-material-id="${esc(m.id)}" data-material-realm="${esc(realm)}" style="--material-realm-color:${esc(color)}"` : 'disabled'} title="${m ? '點擊取回' : '空煉器格'}"><span class="idx">${index + 1}</span><span class="remove">×</span><span><span class="icon">${esc(m?.icon || '＋')}</span><span class="name">${esc(m?.name || '')}</span></span></button>`;
    }).join('');
    const summary = Object.entries(counts).map(([id, q]) => `${getMaterialById(id)?.name || id} ×${q}`).join(' · ') || '尚未投入材料';
    let matchClass = '', matchText = '放入材料後，依各材料數量自動辨識法寶配方。';
    if (used && matching.length === 1) {
      const item = matching[0];
      matchClass = 'ready';
      matchText = `<b>配方吻合：</b>${esc(item.icon || '◆')} ${esc(item.name)} · 將煉製 ×${Math.max(1, Math.floor(Number(item.craft?.yield) || 1))}`;
    } else if (used && matching.length > 1) {
      matchClass = 'error';
      matchText = '這組材料同時符合多個法寶配方，需由管理員將配方調整為唯一。';
    } else if (used) {
      matchClass = 'error';
      matchText = '目前材料數量不符合任何法寶配方；格子順序不影響判定。';
    }
    const matchPrefix = used && matching.length === 1 ? '配方吻合：' : '';
    const matchPlain = used && matching.length === 1
      ? `${matching[0].icon || '◆'} ${matching[0].name} · 將煉製 ×${Math.max(1, Math.floor(Number(matching[0].craft?.yield) || 1))}`
      : (used && matching.length > 1
        ? '這組材料同時符合多個法寶配方，需由管理員將配方調整為唯一。'
        : (used ? '目前材料數量不符合任何法寶配方；格子順序不影響判定。' : '放入材料後，依各材料數量自動辨識法寶配方。'));
    return `<section class="cultivation-refinery"><article class="refinery-panel"><div class="refinery-head"><div><h3><i class="fa-solid fa-gem"></i> 持有材料</h3><p>點擊材料，即放入右側第一個空格。</p></div><span class="refinery-badge">${ownedMaterials.length} 種</span></div><div class="refinery-material-list">${materialHtml}</div></article><article class="refinery-panel"><div class="refinery-head"><div><h3><i class="fa-solid fa-fire-burner"></i> 八方煉器陣</h3><p>8 格，每格只能放 1 個材料；點已放入的格子可取回。</p></div><span class="refinery-badge" data-refinery-used-badge>${used}/${SLOT_COUNT}</span></div><div class="refinery-slots">${slotHtml}</div><div class="refinery-summary"><strong>投入：</strong><span data-refinery-summary-text>${esc(summary)}</span></div><div class="refinery-match ${matchClass}" data-refinery-match><b data-refinery-match-prefix>${esc(matchPrefix)}</b><span data-refinery-match-text>${esc(matchPlain)}</span></div><div class="refinery-actions"><button type="button" class="refinery-clear" data-refinery-clear ${!used || busy ? 'disabled' : ''}>清空</button><button type="button" class="refinery-craft" data-refinery-craft ${matching.length !== 1 || busy ? 'disabled' : ''}><i class="fa-solid fa-fire"></i> <span data-refinery-craft-label>${busy ? '煉製中…' : '煉器'}</span></button></div><div class="refinery-note"><b>配方判定：</b>只比較每種材料的數量，與放入第幾格無關；多一個或少一個材料都不成立。</div></article></section>`;
  }

  function setText(node, value) {
    if (!node) return;
    const text = String(value ?? '');
    if (node.childNodes.length === 1 && node.firstChild?.nodeType === Node.TEXT_NODE) {
      if (node.firstChild.nodeValue !== text) node.firstChild.nodeValue = text;
      return;
    }
    if (!node.childNodes.length) {
      node.appendChild(document.createTextNode(text));
      return;
    }
    if (node.textContent !== text) node.textContent = text;
  }

  function syncSelectionView() {
    const page = document.getElementById('page-training');
    const content = page?.querySelector('#training-tab-content');
    if (!content?.querySelector('.cultivation-refinery')) {
      render(true);
      return;
    }

    const inv = inventory();
    const counts = selectedCounts();
    const used = selected.filter(Boolean).length;
    const matching = matches();

    content.querySelectorAll('[data-refinery-material]').forEach((button) => {
      const id = button.dataset.refineryMaterial;
      const owned = Number(inv[id]) || 0;
      const placed = Number(counts[id]) || 0;
      const remaining = Math.max(0, owned - placed);
      button.disabled = remaining <= 0 || used >= SLOT_COUNT || busy;
      const meta = button.querySelector('.refinery-mat-copy small');
      const material = getMaterialById(id);
      setText(meta, `${material?.category || '材料'} · 已放入 ${placed}`);
      setText(button.querySelector('.refinery-mat-qty'), `可用 ${remaining}/${owned}`);
    });

    content.querySelectorAll('[data-refinery-slot]').forEach((button) => {
      const index = Number(button.dataset.refinerySlot);
      const id = selected[index] || '';
      const material = id ? getMaterialById(id) : null;
      button.classList.toggle('filled', !!material);
      button.disabled = !material || busy;
      button.title = material ? '點擊取回' : '空煉器格';
      if (material) {
        button.dataset.refineryMaterialId = material.id;
        button.dataset.materialRealm = material.realm || '凡人';
        button.style.setProperty('--material-realm-color', materialRealmColor(material.realm));
      } else {
        delete button.dataset.refineryMaterialId;
        delete button.dataset.materialRealm;
        button.style.removeProperty('--material-realm-color');
      }
      setText(button.querySelector('.icon'), material?.icon || '＋');
      setText(button.querySelector('.name'), material?.name || '');
    });

    setText(content.querySelector('[data-refinery-used-badge]'), `${used}/${SLOT_COUNT}`);
    const summary = Object.entries(counts).map(([id, q]) => `${getMaterialById(id)?.name || id} ×${q}`).join(' · ') || '尚未投入材料';
    setText(content.querySelector('[data-refinery-summary-text]'), summary);

    const matchNode = content.querySelector('[data-refinery-match]');
    matchNode?.classList.remove('ready', 'error');
    let prefix = '';
    let message = '放入材料後，依各材料數量自動辨識法寶配方。';
    if (used && matching.length === 1) {
      const item = matching[0];
      matchNode?.classList.add('ready');
      prefix = '配方吻合：';
      message = `${item.icon || '◆'} ${item.name} · 將煉製 ×${Math.max(1, Math.floor(Number(item.craft?.yield) || 1))}`;
    } else if (used && matching.length > 1) {
      matchNode?.classList.add('error');
      message = '這組材料同時符合多個法寶配方，需由管理員將配方調整為唯一。';
    } else if (used) {
      matchNode?.classList.add('error');
      message = '目前材料數量不符合任何法寶配方；格子順序不影響判定。';
    }
    setText(content.querySelector('[data-refinery-match-prefix]'), prefix);
    setText(content.querySelector('[data-refinery-match-text]'), message);

    const clearButton = content.querySelector('[data-refinery-clear]');
    if (clearButton) clearButton.disabled = !used || busy;
    const craftButton = content.querySelector('[data-refinery-craft]');
    if (craftButton) craftButton.disabled = matching.length !== 1 || busy;
    setText(content.querySelector('[data-refinery-craft-label]'), busy ? '煉製中…' : '煉器');

    // Selection changes are now reflected without replacing refinery innerHTML.
    content.dataset.refineryRenderKey = currentSignature();
  }

  function bindContent(content) {
    content.querySelectorAll('[data-refinery-material]').forEach((button) => button.addEventListener('click', () => add(button.dataset.refineryMaterial)));
    content.querySelectorAll('[data-refinery-slot]').forEach((button) => button.addEventListener('click', () => remove(Number(button.dataset.refinerySlot))));
    content.querySelector('[data-refinery-clear]')?.addEventListener('click', clear);
    content.querySelector('[data-refinery-craft]')?.addEventListener('click', craft);
  }
  function render(force = false) {
    if (!active) return;
    const page = document.getElementById('page-training');
    const content = page?.querySelector('#training-tab-content');
    if (!page || !content || !tabActive(page)) return;
    const signature = currentSignature();
    if (!force && content.dataset.refineryRenderKey === signature && content.querySelector('.cultivation-refinery')) return;
    content.dataset.refineryRenderKey = signature;
    content.innerHTML = markup();
    bindContent(content);
  }

  function add(id) {
    if (busy) return;
    const empty = selected.findIndex((value) => !value);
    if (empty < 0) { toast('八個煉器格都已放滿。', false); return; }
    const inv = inventory();
    const placed = Number(selectedCounts()[id]) || 0;
    if (placed >= (Number(inv[id]) || 0)) { toast('此材料沒有更多可投入的數量。', false); return; }
    selected[empty] = id;
    render(true);
  }
  function remove(index) {
    if (busy || index < 0 || index >= SLOT_COUNT) return;
    selected[index] = null;
    render(true);
  }
  function clear() {
    if (busy) return;
    selected.fill(null);
    render(true);
  }

  async function craft() {
    if (busy) return;
    const matching = matches();
    if (matching.length !== 1) { toast('目前材料沒有對應到唯一法寶配方。', false); return; }
    const artifact = matching[0];
    const recipe = getArtifactRecipe(artifact.id);
    if (countsKey(recipeCounts(recipe)) !== countsKey(selectedCounts())) { toast('配方已改變，請重新投入材料。', false); return; }
    const user = authUser();
    if (!user) { toast('尚未登入。', false); return; }
    busy = true;
    render(true);
    try {
      let committedMaterials = null;
      let committedArtifacts = null;
      await runTransaction(db(), async (tx) => {
        const ref = doc(db(), 'users', user.uid);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('玩家資料不存在');
        const raw = snap.data();
        const materials = normalizeMaterials(raw.materialSystem || {});
        const needed = recipeCounts(recipe);
        for (const [id, q] of Object.entries(needed)) {
          if ((Number(materials.inventory[id]) || 0) < q) throw new Error(`${getMaterialById(id)?.name || id} 數量不足`);
        }
        for (const [id, q] of Object.entries(needed)) {
          const remain = (Number(materials.inventory[id]) || 0) - q;
          if (remain > 0) materials.inventory[id] = remain; else delete materials.inventory[id];
        }
        const artifacts = raw.artifactSystem && typeof raw.artifactSystem === 'object' ? { ...raw.artifactSystem } : {};
        artifacts.inventory = { ...(artifacts.inventory || {}) };
        const gain = Math.max(1, Math.floor(Number(artifact.craft?.yield) || 1));
        artifacts.inventory[artifact.id] = (Number(artifacts.inventory[artifact.id]) || 0) + gain;
        committedMaterials = materials;
        committedArtifacts = artifacts;
        tx.update(ref, { materialSystem: materials, artifactSystem: artifacts });
      });
      const data = userData();
      if (data) { data.materialSystem = committedMaterials; data.artifactSystem = committedArtifacts; }
      selected.fill(null);
      window.dispatchEvent(new CustomEvent('material-system-updated', { detail: committedMaterials }));
      window.dispatchEvent(new CustomEvent('artifact-system-updated', { detail: committedArtifacts }));
      window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', { detail: { refineryCrafted: true, artifactCrafted: artifact.id } }));
      toast(`煉器成功：${artifact.name} ×${Math.max(1, Math.floor(Number(artifact.craft?.yield) || 1))}`);
    } catch (error) {
      console.error('[Cultivation refinery]', error);
      toast(error.message || '煉器失敗。', false);
    } finally {
      busy = false;
      render(true);
    }
  }

  function reconcile() {
    const inv = inventory();
    const seen = {};
    let changed = false;
    selected.forEach((id, index) => {
      if (!id) return;
      seen[id] = (seen[id] || 0) + 1;
      if (!getMaterialById(id) || seen[id] > (Number(inv[id]) || 0)) { selected[index] = null; changed = true; }
    });
    return changed;
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      ensureStyle();
      ensureTab();
      reconcile();
      render();
    });
  }
  function observeTrainingPage() {
    const page = document.getElementById('page-training');
    if (!page) return false;
    const tabs = page.querySelector('.training-subtabs-v3');
    if (tabs && tabs.dataset.refineryObserverBound !== '1') {
      tabs.dataset.refineryObserverBound = '1';
      new MutationObserver(schedule).observe(tabs, { childList: true });
    }
    return true;
  }

  function boot() {
    ensureStyle();
    schedule();
    ['foundation-training-stage-changed','golden-core-access-changed','material-system-updated','material-catalog-updated','artifact-catalog-updated','artifact-recipes-updated','xiuxian:user-ready'].forEach((name) => window.addEventListener(name, schedule));

    // 煉器每放一個材料都會重建內容區。若監看整個 body/subtree，
    // 這些 DOM 變更會再次觸發煉器排程，材料種類多時容易造成 observer storm。
    if (!observeTrainingPage()) {
      const rootObserver = new MutationObserver(() => {
        if (observeTrainingPage()) {
          rootObserver.disconnect();
          schedule();
        }
      });
      rootObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  window.getCultivationRefinerySelection = () => [...selected];
  window.getCultivationRefineryMatch = () => matches().map((item) => item.id);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
