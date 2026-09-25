import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, runTransaction } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { ARTIFACT_CATALOG, getArtifactById, artifactRealmColor, realmOrderByName } from './artifact-catalog.js';
import { MATERIAL_CATALOG, ARTIFACT_RECIPES, getMaterialById, getArtifactRecipe, materialRealmColor, materialRealmOrderByName, artifactRecipeDepth, MAX_ARTIFACT_RECIPE_NESTING } from './material-catalog.js';

(function () {
  'use strict';

  const SLOT_COUNT = 8;
  const TAB = 'refinery';
  const selected = Array(SLOT_COUNT).fill(null);
  let active = false;
  let busy = false;
  let queued = false;
  let recipeBookOpen = false;
  let expandedRecipeId = '';
  let adminForgeDirection = '自由發揮';
  let forgeMethod = '自由發揮';
  const FORGE_METHODS = ['自由發揮','劍道鍛造','護體鑄造','符籙煉製','陣法刻印'];
  function recipeMethod(item) {
    return FORGE_METHODS.includes(item?.forgeMethod) ? item.forgeMethod : '自由發揮';
  }
  function recipeSignatureFor(item, recipe) {
    const key = countsKey(recipeCounts(recipe));
    return key && recipeMethod(item) !== '自由發揮'
      ? key + '|method:' + recipeMethod(item) : key;
  }
  let adminForgePrompt = '';

  const userData = () => window.getCurrentUserData?.() || null;
  function authUser() { try { return getAuth(getApp()).currentUser; } catch (_) { return null; } }
  function db() { return getFirestore(getApp()); }
  function esc(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function itemImageMarkup(item, fallback) {
    const url = String(item?.imageUrl || '').trim();
    if (!url) return esc(fallback || '◆');
    return `<img src="${esc(url)}" alt="" loading="lazy" decoding="async">`;
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
  function materialInventory() { return normalizeMaterials(userData()?.materialSystem || {}).inventory; }
  function artifactInventory() {
    const inventory = {};
    Object.entries(userData()?.artifactSystem?.inventory || {}).forEach(([id, value]) => {
      const qty = Math.max(0, Math.floor(Number(value) || 0));
      if (qty > 0) inventory[id] = qty;
    });
    return inventory;
  }
  function equippedArtifactCounts(system = userData()?.artifactSystem || {}) {
    const counts = {};
    Object.values(system?.equipped || {}).forEach((id) => {
      const key = String(id || '').trim();
      if (key) counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }
  function ingredientToken(row = {}) {
    const artifactId = String(row?.artifactId || '').trim();
    if (artifactId) return `artifact:${artifactId}`;
    const materialId = String(row?.materialId || '').trim();
    return materialId ? `material:${materialId}` : '';
  }
  function parseToken(token) {
    const text = String(token || '');
    if (text.startsWith('artifact:')) return { type: 'artifact', id: text.slice(9) };
    if (text.startsWith('material:')) return { type: 'material', id: text.slice(9) };
    return { type: 'material', id: text };
  }
  function ingredientMeta(token) {
    const parsed = parseToken(token);
    if (parsed.type === 'artifact') {
      const item = getArtifactById(parsed.id);
      return {
        ...parsed,
        item,
        name: item?.name || parsed.id,
        icon: item?.icon || '◆',
        imageUrl: item?.imageUrl || '',
        realm: item?.realm || '凡人',
        category: '法寶素材',
        color: artifactRealmColor(item?.realm)
      };
    }
    const item = getMaterialById(parsed.id);
    return {
      ...parsed,
      item,
      name: item?.name || parsed.id,
      icon: item?.icon || '材',
      imageUrl: item?.imageUrl || '',
      realm: item?.realm || '凡人',
      category: item?.category || '材料',
      color: materialRealmColor(item?.realm)
    };
  }
  function ingredientOwned(token) {
    const parsed = parseToken(token);
    if (parsed.type === 'artifact') return Math.max(0, Number(artifactInventory()[parsed.id]) || 0);
    return Math.max(0, Number(materialInventory()[parsed.id]) || 0);
  }
  function ingredientAvailable(token) {
    const parsed = parseToken(token);
    if (parsed.type === 'artifact') {
      const owned = Math.max(0, Number(artifactInventory()[parsed.id]) || 0);
      const equipped = Math.max(0, Number(equippedArtifactCounts()[parsed.id]) || 0);
      return Math.max(0, owned - equipped);
    }
    return Math.max(0, Number(materialInventory()[parsed.id]) || 0);
  }
  function selectedCounts() {
    const out = {};
    selected.forEach((token) => { if (token) out[token] = (out[token] || 0) + 1; });
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
      const token = ingredientToken(row);
      const q = Math.max(0, Math.floor(Number(row?.quantity) || 0));
      if (token && q) out[token] = (out[token] || 0) + q;
    });
    return out;
  }
  function recipeTotal(recipe) {
    return (recipe || []).reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row?.quantity) || 0)), 0);
  }
  function matches() {
    const key = countsKey(selectedCounts());
    if (!key) return [];
    const signature = key + (forgeMethod === '自由發揮' ? '' : '|method:' + forgeMethod);
    return ARTIFACT_CATALOG.filter((item) => {
      const recipe = getArtifactRecipe(item.id);
      return recipe.length && recipeTotal(recipe) <= SLOT_COUNT &&
        recipeSignatureFor(item, recipe) === signature;
    });
  }

  // 配方是製作知識；只有公共、首發本人或已取得授權者可看見素材細節。
  function recipeIngredientMarkup(row) {
    const token = ingredientToken(row);
    const meta = ingredientMeta(token);
    const needed = Math.max(1, Math.floor(Number(row.quantity) || 1));
    const available = ingredientAvailable(token);
    const enough = available >= needed;
    const description = String(meta.item?.description || '').trim();
    return `<li class="refinery-recipe-ingredient ${enough ? 'is-ready' : 'is-missing'}"
        style="--recipe-ingredient-color:${esc(meta.color)}">
        <span class="refinery-recipe-material-icon ${row?.artifactId ? 'is-artifact' : 'is-material'}" aria-hidden="true">${esc(meta.icon)}</span>
        <div class="refinery-recipe-material-copy">
          <strong>${esc(meta.name)}</strong>
          <span class="refinery-recipe-material-meta">${esc(meta.realm)} · ${esc(meta.category)}</span>
          ${description ? `<small class="refinery-recipe-material-note">${esc(description)}</small>` : ''}
          <span class="refinery-recipe-stock ${enough ? 'is-ready' : 'is-missing'}">可用 ${available} / 需要 ${needed}${enough ? ' · 齊備' : ' · 尚缺 ' + (needed - available)}</span>
        </div>
        <b class="refinery-recipe-required">×${needed}</b>
      </li>`;
  }

  function recipeTokens(recipe) {
    const tokens = [];
    for (const row of recipe || []) {
      const token = ingredientToken(row);
      const quantity = Number(row?.quantity);
      if (!token || !Number.isInteger(quantity) || quantity < 1 ||
          tokens.length + quantity > SLOT_COUNT) return [];
      for (let i = 0; i < quantity; i++) tokens.push(token);
    }
    return tokens.length >= 2 ? tokens : [];
  }

  function recipeAvailableToPlayer(item, uid = authUser()?.uid || '') {
    return !!item && (userData()?.isAdmin === true ||
      (!!uid && item.recipeOwnerUid === uid) ||
      userData()?.recipeLicenses?.[item.id] === true ||
      (!item.recipeOwnerUid && item.recipeSaleLocked !== true));
  }

  function matchingRecipeForTokens(tokens, artifactId) {
    const key = countsKey(recipeCounts(tokens.map((token) => {
      const parsed = parseToken(token);
      return parsed.type === 'artifact' ? { artifactId: parsed.id, quantity: 1 } :
        { materialId: parsed.id, quantity: 1 };
    })));
    if (!key) return false;
    const target = getArtifactById(artifactId);
    if (!target) return false;
    const signature = key + (recipeMethod(target) === '自由發揮' ? '' : '|method:' + recipeMethod(target));
    const found = ARTIFACT_CATALOG.filter((item) => {
      const recipe = getArtifactRecipe(item.id);
      return recipe.length && recipeTotal(recipe) <= SLOT_COUNT &&
        recipeSignatureFor(item, recipe) === signature;
    });
    return found.length === 1 && found[0].id === artifactId;
  }

  function recipeBookMarkup() {
    const myUid = authUser()?.uid || '';
    const known = ARTIFACT_CATALOG.filter((item) => getArtifactRecipe(item.id).length);
    const owned = known.filter((item) => myUid && item.recipeOwnerUid === myUid);
    const licensed = known.filter((item) => item.recipeOwnerUid !== myUid && userData()?.recipeLicenses?.[item.id] === true);
    // 配方只用來查看製作方法；沒有配方仍可在八方煉器陣自由嘗試。
    const entries = known.slice().sort((a, b) =>
      Number(myUid && b.recipeOwnerUid === myUid) - Number(myUid && a.recipeOwnerUid === myUid)
      || (Number(b.recipeDiscoveredAtMs) || 0) - (Number(a.recipeDiscoveredAtMs) || 0)
      || String(a.name).localeCompare(String(b.name), 'zh-Hant'));
    const cards = entries.map((item) => {
      const mine = !!myUid && item.recipeOwnerUid === myUid;
      const learned = userData()?.recipeLicenses?.[item.id] === true;
      const canReadRecipe = recipeAvailableToPlayer(item, myUid);
      const owner = item.recipeOwnerUid
        ? (mine ? '你是首位發現者 · 配方擁有權已登錄' : `首發擁有者：${esc(item.recipeOwnerName || '無名修士')}`)
        : '既有公共配方';
      const access = item.recipeOwnerUid && !mine ? (learned ? ' · 已學會製作方法' : ' · 製作方法尚未習得') : '';
      const discovered = item.recipeOwnerUid && item.recipeDiscoveredAtMs
        ? new Date(item.recipeDiscoveredAtMs).toLocaleDateString('zh-TW') : '';
      const recipe = canReadRecipe ? getArtifactRecipe(item.id) : [];
      const cost = recipeTotal(recipe);
      const tokens = canReadRecipe ? recipeTokens(recipe) : [];
      const unique = canReadRecipe && !!tokens.length && matchingRecipeForTokens(tokens, item.id);
      const plan = unique ? window.getCultivationRefineryPlan?.(tokens, item.id) : null;
      const job = window.getCultivationRefineryJob?.() || null;
      const missing = canReadRecipe ? Object.entries(recipeCounts(recipe)).reduce((total, [token, quantity]) =>
        total + Math.max(0, quantity - ingredientAvailable(token)), 0) : 0;
      const statusLabel = mine ? '首發持有' : !item.recipeOwnerUid ? '公共配方' : learned ? '已學會' : '尚未解鎖';
      const statusIcon = mine ? 'fa-crown' : !item.recipeOwnerUid ? 'fa-book-open' : learned ? 'fa-circle-check' : 'fa-lock';
      const color = artifactRealmColor(item.realm);
      const ingredients = canReadRecipe
        ? `<div class="refinery-recipe-ingredients-head"><b><i class="fa-solid fa-cubes-stacked"></i> 合成材料</b><span>${cost} / ${SLOT_COUNT} 格 · ${missing ? `尚缺 ${missing} 個` : '素材齊備'}</span></div>
           <ul class="refinery-recipe-ingredients">${recipe.map(recipeIngredientMarkup).join('')}</ul>`
        : `<div class="refinery-recipe-sealed" role="note"><div class="refinery-recipe-seal-mark"><i class="fa-solid fa-lock"></i></div><strong>製作方法尚未習得</strong><p>此配方的素材與數量尚未公開。可在交易市集取得製作指南，或自行投入材料探索。</p></div>`;
      const gold = Math.max(0, Number(userData()?.stats?.gold) || 0);
      const canCraft = !!myUid && canReadRecipe && unique && !missing && plan?.valid &&
        gold >= Number(plan.gold || 0) && !busy && !job;
      const actionText = !myUid ? '請先登入' : job ? '已有法寶正在煉製' :
        missing ? `尚缺 ${missing} 個素材` :
        !unique ? '配方待修正' :
        !plan?.valid ? '目前無法煉製' :
        gold < Number(plan.gold || 0) ? '靈石不足' : '以此煉製';
      const stage = Math.min(3, artifactRecipeDepth(item.id) + 1);
      const teaser = canReadRecipe && item.description
        ? String(item.description).trim().slice(0, 72)
        : '製作指南尚未習得；點擊查看配方資訊。';
      return `<details class="refinery-recipe-card ${mine ? 'is-owner' : ''} ${canReadRecipe ? 'is-known' : 'is-sealed'}"
        data-refinery-recipe-card="${esc(item.id)}" ${expandedRecipeId === item.id ? 'open' : ''}
        style="--recipe-realm-color:${esc(color)}">
        <summary class="refinery-recipe-card-head">
          <span class="refinery-recipe-artifact-icon" aria-hidden="true">${esc(item.icon || '◆')}</span>
          <span class="refinery-recipe-artifact-title">
            <small class="refinery-recipe-eyebrow">煉 器 · 配 方</small>
            <strong>${esc(item.name)}</strong>
            <span class="refinery-recipe-subtitle">${esc(item.realm || '凡人')} · ${esc(item.category || '法寶')}${item.weaponForm ? ' · ' + esc(item.weaponForm) : ''}${recipeMethod(item) !== '自由發揮' ? ' · ' + esc(recipeMethod(item)) : ''}</span>
            <span class="refinery-recipe-intro">${esc(teaser || '此件法寶的製作指南')}</span>
          </span>
          <span class="refinery-recipe-access ${canReadRecipe ? 'is-unlocked' : 'is-locked'}"><i class="fa-solid ${statusIcon}"></i> ${statusLabel}</span>
          <i class="fa-solid fa-chevron-down refinery-recipe-card-chevron" aria-hidden="true"></i>
        </summary>
        <div class="refinery-recipe-detail">
          ${canReadRecipe && item.description ? `<p class="refinery-recipe-description">${esc(item.description)}</p>` : ''}
          ${canReadRecipe ? `<p class="refinery-recipe-depth"><i class="fa-solid fa-gem"></i> 煉製深度 ${artifactRecipeDepth(item.id)}/${MAX_ARTIFACT_RECIPE_NESTING} · 第 ${stage} 煉</p>` : ''}
          ${ingredients}
          ${canReadRecipe ? `<section class="refinery-recipe-method" aria-label="製作方法">
            <h4><i class="fa-solid fa-scroll"></i> 製作方法</h4>
            <ol>
              <li><b>備齊材料</b><span>依上方配方投入共 ${cost} 件素材，已裝備的法寶不可投入。</span></li>
              <li><b>八方煉製</b><span>消耗 ${Math.max(0, Number(plan?.gold) || 0).toLocaleString()} 靈石，${plan?.valid ? `約需 ${esc(window.formatCultivationRefineryDuration?.(plan.durationMs) || '一段時間')}` : '目前無法計算煉製時間'}。</span></li>
              <li><b>開爐取寶</b><span>煉製完成後，按陣心「開爐」領取 ${esc(item.name)}。</span></li>
            </ol>
            <button type="button" class="refinery-recipe-craft" data-refinery-craft-recipe="${esc(item.id)}" ${canCraft ? '' : 'disabled'}><i class="fa-solid fa-fire-flame-curved"></i> ${esc(actionText)}</button>
            <p class="refinery-recipe-craft-note">${canCraft ? '點擊即按此配方投入素材、扣除靈石並開始煉製。' : '請先確認配方、材料、靈石及目前的煉製狀態。'}</p>
          </section>` : ''}
          <footer class="refinery-recipe-card-foot">
            <span class="refinery-recipe-owner"><i class="fa-solid fa-fingerprint"></i> ${owner}${access}</span>
            ${discovered ? `<time class="refinery-recipe-date">${esc(discovered)}</time>` : ''}
          </footer>
        </div>
      </details>`;
    }).join('');
    return `<details class="refinery-recipe-book" data-refinery-recipe-book ${recipeBookOpen ? 'open' : ''}>
      <summary><span class="refinery-recipe-book-heading"><i class="fa-solid fa-scroll"></i><strong>配方圖鑑</strong><small>RECIPE COMPENDIUM</small></span><span class="refinery-recipe-summary-count">首發 ${owned.length} · 已學會 ${licensed.length} · 登錄 ${known.length}</span><i class="fa-solid fa-chevron-down refinery-recipe-book-chevron"></i></summary>
      <div class="refinery-recipe-book-content">
        <p class="refinery-recipe-guide"><i class="fa-solid fa-circle-info"></i><span>配方是製作指南，不是煉器許可證。沒有配方也能自由投入素材嘗試煉製；首發者永久保有發現紀錄，購買配方後可查看具體素材與數量。</span></p>
        <div class="refinery-recipe-toolbar"><span><i class="fa-solid fa-layer-group"></i> 已收錄 ${known.length} 張法寶配方</span><button type="button" class="refinery-clear refinery-recipe-market" data-refinery-open-market><i class="fa-solid fa-scale-balanced"></i> 前往交易市集</button></div>
        <div class="refinery-recipe-grid">${cards || '<div class="refinery-recipe-empty"><i class="fa-solid fa-book-open"></i><strong>尚無已登錄的配方</strong><p>投入 2～8 個素材，開爐探索第一張配方。</p></div>'}</div>
      </div>
    </details>`;
  }

  function ensureStyle() {
    // index.html has only the temporary loading/preload rules. Do not treat
    // those as the complete component CSS: otherwise the actual recipe cards
    // fall back to unstyled inline text while the HTML renders correctly.
    if (document.getElementById('cultivation-refinery-v2-runtime-style')) {
      document.getElementById('cultivation-refinery-v2-preload-style')?.remove();
      return;
    }
    const style = document.createElement('style');
    style.id = 'cultivation-refinery-v2-runtime-style';
    style.textContent = `
      #page-settings #artifact-forge-card,#page-settings #material-store-card{display:none!important}
      .cultivation-refinery{width:min(100%,1080px);margin:0 auto;display:grid;grid-template-columns:minmax(300px,.88fr) minmax(430px,1.12fr);gap:14px}
      .refinery-panel{min-width:0;padding:14px;border:1px solid rgba(216,177,93,.2);border-radius:20px;background:linear-gradient(145deg,rgba(21,17,10,.97),rgba(7,7,7,.985));box-shadow:0 16px 42px rgba(0,0,0,.34);position:relative;overflow:hidden}.refinery-material-panel{--refinery-bottom-extension:64px;padding:0;display:grid;grid-template-rows:minmax(0,1fr);overflow:hidden}
      .refinery-panel:before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(135deg,rgba(255,226,151,.045),transparent 25%,transparent 75%,rgba(216,177,93,.025))}
      .refinery-forge-panel{background:radial-gradient(circle at 50% 42%,rgba(124,82,16,.16),transparent 36%),radial-gradient(circle at 50% 50%,rgba(75,52,19,.12),transparent 62%),linear-gradient(150deg,rgba(19,15,9,.985),rgba(5,5,6,.99))}
      .refinery-forge-panel:after{content:"煉";position:absolute;right:-8px;bottom:-38px;font-size:150px;font-weight:900;line-height:1;color:rgba(216,177,93,.022);pointer-events:none;transform:rotate(-8deg)}
      .refinery-head{position:relative;z-index:2;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:11px}.refinery-head h3{margin:0;color:#f1e1bc;font-size:13px;letter-spacing:.04em}.refinery-head h3 i{color:#d8b15d;margin-right:4px}.refinery-head p{margin:4px 0 0;color:#8d816c;font-size:8px;line-height:1.55}.refinery-badge{padding:5px 8px;border:1px solid rgba(216,177,93,.18);border-radius:999px;background:rgba(216,177,93,.035);color:#d8bd78;font-size:7px;white-space:nowrap}
      .refinery-material-list{position:relative;z-index:1;display:grid;grid-template-rows:repeat(2,minmax(0,1fr));gap:0;width:100%;height:100%;min-height:0;max-height:none;overflow:hidden}.refinery-material-roll{box-sizing:border-box;min-height:0;height:100%;display:grid;grid-template-rows:auto minmax(0,1fr);gap:6px;padding:10px 10px 8px;border:0;border-radius:0;background:rgba(216,177,93,.018);overflow:hidden}.refinery-material-roll+.refinery-material-roll{border-top:1px solid rgba(216,177,93,.18);padding-bottom:8px}.refinery-material-roll+.refinery-material-roll .refinery-group-title{margin-top:0}.refinery-material-roll+.refinery-material-roll .refinery-material-roll-body{padding-bottom:8px}.refinery-material-roll-body{min-height:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));grid-auto-rows:max-content;align-content:start;gap:8px;overflow:auto;padding:1px 3px 3px 1px;overscroll-behavior:contain;scrollbar-gutter:stable}.refinery-material-roll-body.is-empty{display:flex;flex-direction:column;justify-content:flex-end}.refinery-material-roll-body.is-empty .refinery-empty{width:100%;box-sizing:border-box}.refinery-material-roll[data-refinery-material-roll="artifacts"] .refinery-material-roll-body:not(.is-empty){align-content:start}.refinery-material{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;width:100%;aspect-ratio:1;min-width:0;padding:9px 7px;border:1px solid color-mix(in srgb,var(--material-realm-color,#d8b15d) 25%,rgba(255,255,255,.05));border-radius:14px;background:radial-gradient(circle at 50% 25%,color-mix(in srgb,var(--material-realm-color,#d8b15d) 9%,transparent),rgba(255,255,255,.012) 62%);text-align:center;overflow:hidden;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}.refinery-material:not(:disabled):hover{border-color:color-mix(in srgb,var(--material-realm-color,#d8b15d) 55%,#d8b15d);box-shadow:0 8px 20px rgba(0,0,0,.25),inset 0 0 18px color-mix(in srgb,var(--material-realm-color,#d8b15d) 8%,transparent);transform:translateY(-2px)}.refinery-material:disabled{opacity:.4;cursor:not-allowed}.refinery-mat-icon{width:42px;height:42px;flex:0 0 42px;display:grid;place-items:center;overflow:hidden;border:1px solid color-mix(in srgb,var(--material-realm-color,#d8b15d) 45%,rgba(216,177,93,.18));border-radius:12px;background:#171006;color:var(--material-realm-color,#efd17c);font-size:12px;font-weight:900;box-shadow:inset 0 0 14px rgba(0,0,0,.3)}.refinery-mat-icon img,.refinery-slot .icon img,.refinery-recipe-artifact-icon img,.refinery-recipe-material-icon img{width:100%;height:100%;display:block;object-fit:cover}.refinery-slot .icon{overflow:hidden}
      .refinery-mat-copy{display:flex;min-width:0;width:100%;flex-direction:column;align-items:center;gap:2px}.refinery-mat-copy strong{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#ede1c8;font-size:9px}.refinery-mat-copy small{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#81745f;font-size:6px}.refinery-mat-copy .material-realm-badge{margin-top:1px!important}.refinery-mat-qty{position:absolute;right:6px;top:6px;padding:2px 5px;border-radius:999px;background:rgba(0,0,0,.52);color:#d5b96e;font-size:6px;font-weight:900;white-space:nowrap}.refinery-empty{grid-column:1/-1;padding:22px 12px;text-align:center;color:#82745f;font-size:9px;border:1px dashed rgba(216,177,93,.13);border-radius:13px;line-height:1.7}.refinery-group-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0;padding:6px 8px;border-radius:9px;background:rgba(216,177,93,.04);color:#bfa66a;font-size:7px;font-weight:900}.refinery-group-title span:last-child{text-align:right;color:#8f7b51;font-size:6px}.refinery-artifact-ingredient{border-color:color-mix(in srgb,var(--material-realm-color,#d8b15d) 42%,rgba(255,255,255,.05));background:radial-gradient(circle at 50% 25%,color-mix(in srgb,var(--material-realm-color,#d8b15d) 14%,transparent),rgba(255,255,255,.012) 62%)}.refinery-artifact-ingredient .refinery-mat-copy strong{color:var(--material-realm-color,#eee1c8)}
      .refinery-forge-method{position:relative;z-index:3;display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:5px 0 8px;padding:7px 10px;border:1px solid rgba(216,177,93,.19);border-radius:11px;color:#ddc58c;font-size:9px;font-weight:800;background:#17130b}
      .refinery-forge-method select{min-width:120px;max-width:100%;padding:6px 9px;border:1px solid rgba(216,177,93,.32);border-radius:8px;background:#090806;color:#f0d99d;font-size:10px}.refinery-forge-method select:disabled{opacity:.5}.refinery-forge-method small{flex:1 1 100%;color:#96856a;font-size:7px;font-weight:400}
      .refinery-mat-icon.is-material,.refinery-recipe-material-icon.is-material{border-radius:50%!important;background:radial-gradient(circle at 32% 25%,rgba(255,255,255,.17),rgba(99,70,29,.3) 42%,#100f0c 100%);box-shadow:inset 0 0 0 2px rgba(255,239,184,.07),0 0 12px rgba(233,187,93,.09)}
      .refinery-mat-icon.is-artifact,.refinery-recipe-artifact-icon{border-radius:10px;box-shadow:inset 0 0 0 2px rgba(255,236,173,.09),0 0 16px rgba(217,169,66,.13)}
      .refinery-slot.is-material .icon{width:28px;height:28px;display:grid;place-items:center;margin:auto;border:1px solid var(--material-realm-color,#d8b15d);border-radius:50%;background:radial-gradient(circle at 30% 20%,rgba(255,255,255,.15),rgba(0,0,0,.1) 70%);font-size:12px}
      .refinery-slot.is-artifact .icon{color:var(--material-realm-color,#efd17c)}
      .refinery-array-wrap{position:relative;z-index:1;display:flex;justify-content:center;align-items:center;padding:2px 0 6px}
      .refinery-slots{--array-size:min(44dvh,430px);--slot-size:clamp(58px,17%,78px);position:relative;width:min(100%,var(--array-size));max-width:430px;aspect-ratio:1;margin:0 auto;isolation:isolate}
      .refinery-slots:before{content:"";position:absolute;inset:8.5%;clip-path:polygon(29.3% 0,70.7% 0,100% 29.3%,100% 70.7%,70.7% 100%,29.3% 100%,0 70.7%,0 29.3%);background:linear-gradient(135deg,rgba(248,217,139,.3),rgba(107,69,14,.08),rgba(248,217,139,.22));filter:drop-shadow(0 0 10px rgba(216,177,93,.12));z-index:0}
      .refinery-slots:after{content:"";position:absolute;inset:9%;clip-path:polygon(29.3% 0,70.7% 0,100% 29.3%,100% 70.7%,70.7% 100%,29.3% 100%,0 70.7%,0 29.3%);background:radial-gradient(circle,rgba(216,177,93,.08),rgba(4,4,5,.96) 63%);z-index:0}
      .refinery-array-lines{position:absolute;inset:13%;border-radius:50%;z-index:1;pointer-events:none;background:repeating-conic-gradient(from 22.5deg,rgba(216,177,93,.18) 0deg 1deg,transparent 1deg 45deg);-webkit-mask:radial-gradient(circle,transparent 0 27%,#000 28% 71%,transparent 72%);mask:radial-gradient(circle,transparent 0 27%,#000 28% 71%,transparent 72%);opacity:.7}
      .refinery-array-ring{position:absolute;inset:26%;border:1px solid rgba(216,177,93,.19);border-radius:50%;z-index:1;pointer-events:none;box-shadow:0 0 22px rgba(216,177,93,.06),inset 0 0 18px rgba(216,177,93,.04)}
      .refinery-array-ring:before,.refinery-array-ring:after{content:"";position:absolute;border-radius:50%;border:1px dashed rgba(216,177,93,.12)}.refinery-array-ring:before{inset:9px}.refinery-array-ring:after{inset:20px}
      .refinery-slot{position:absolute;left:50%;top:50%;width:var(--slot-size);height:var(--slot-size);min-height:0!important;aspect-ratio:1;display:grid;place-items:center;padding:6px;border:1px solid rgba(216,177,93,.22);border-radius:18px;background:radial-gradient(circle at 50% 28%,rgba(216,177,93,.09),rgba(11,9,7,.98) 67%);color:#6f6657;transform:translate(-50%,-50%);z-index:4;box-shadow:0 7px 22px rgba(0,0,0,.32),inset 0 0 16px rgba(216,177,93,.025);transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}.refinery-slot:not(:disabled):hover{transform:translate(-50%,-50%) scale(1.06);border-color:rgba(239,209,124,.58);box-shadow:0 10px 26px rgba(0,0,0,.38),0 0 18px rgba(216,177,93,.12)}.refinery-slot.filled{border-color:color-mix(in srgb,var(--material-realm-color,#d8b15d) 65%,#d8b15d);color:var(--material-realm-color,#efd17c);background:radial-gradient(circle at 50% 28%,color-mix(in srgb,var(--material-realm-color,#d8b15d) 18%,transparent),rgba(18,12,6,.98) 70%);box-shadow:0 8px 24px rgba(0,0,0,.34),0 0 15px color-mix(in srgb,var(--material-realm-color,#d8b15d) 12%,transparent)}
      .refinery-slot[data-refinery-slot="0"]{left:50%;top:8.5%}.refinery-slot[data-refinery-slot="1"]{left:79.35%;top:20.65%}.refinery-slot[data-refinery-slot="2"]{left:91.5%;top:50%}.refinery-slot[data-refinery-slot="3"]{left:79.35%;top:79.35%}.refinery-slot[data-refinery-slot="4"]{left:50%;top:91.5%}.refinery-slot[data-refinery-slot="5"]{left:20.65%;top:79.35%}.refinery-slot[data-refinery-slot="6"]{left:8.5%;top:50%}.refinery-slot[data-refinery-slot="7"]{left:20.65%;top:20.65%}
      .refinery-slot .idx{position:absolute;top:5px;left:7px;color:#6f6250;font-size:6px}.refinery-slot .direction{position:absolute;right:6px;bottom:4px;color:rgba(214,187,125,.55);font-size:7px;font-weight:800}.refinery-slot .remove{position:absolute;top:3px;right:6px;color:#b38c69;font-size:9px}.refinery-slot .icon{display:block;font-size:19px;font-weight:900;line-height:1}.refinery-slot .name{display:block;max-width:64px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#dbcba8;font-size:6px;text-align:center}.refinery-slot:not(.filled) .remove,.refinery-slot:not(.filled) .name{display:none}.refinery-slot:not(.filled) .icon{color:#796b54;font-size:21px}
      .refinery-array-center{position:absolute;left:50%;top:50%;width:31%;aspect-ratio:1;transform:translate(-50%,-50%);z-index:5;display:grid;place-items:center;border-radius:50%;background:radial-gradient(circle,rgba(216,177,93,.12),rgba(25,16,5,.5) 52%,transparent 54%);box-shadow:0 0 30px rgba(216,177,93,.08)}
      .refinery-array-center:before,.refinery-array-center:after{content:"";position:absolute;border-radius:50%;pointer-events:none}.refinery-array-center:before{inset:0;border:1px solid rgba(238,206,124,.28);box-shadow:inset 0 0 18px rgba(216,177,93,.08),0 0 18px rgba(216,177,93,.07)}.refinery-array-center:after{inset:10%;border:1px dashed rgba(238,206,124,.2);animation:refinery-array-spin 18s linear infinite}
      .refinery-craft{position:relative;z-index:2;width:72%;aspect-ratio:1;border-radius:50%;border:1px solid rgba(216,177,93,.42);background:radial-gradient(circle at 35% 28%,#8b6a2e,#3f2809 55%,#1d1205 100%);color:#d9c390;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:8px;font-weight:900;letter-spacing:.08em;box-shadow:0 8px 25px rgba(0,0,0,.38),inset 0 2px 4px rgba(255,255,255,.06);transition:transform .2s ease,box-shadow .2s ease,filter .2s ease}.refinery-craft i{font-size:15px;margin-bottom:1px}.refinery-craft .craft-main{font-size:10px}.refinery-craft .craft-sub{font-size:5.5px;color:#a99468;letter-spacing:.12em}.refinery-craft:disabled{opacity:.48;cursor:not-allowed;filter:saturate(.45)}.refinery-craft.ready:not(:disabled){color:#2a1904;background:radial-gradient(circle at 34% 25%,#fff0b5,#e9b64c 48%,#9d5d13 100%);border-color:#f5d57c;box-shadow:0 0 0 5px rgba(216,177,93,.08),0 0 28px rgba(241,191,72,.24),0 12px 28px rgba(0,0,0,.42);animation:refinery-craft-pulse 2s ease-in-out infinite}.refinery-craft.ready:not(:disabled) .craft-sub{color:#73501e}.refinery-craft:not(:disabled):hover{transform:scale(1.055)}
      .refinery-array-caption{position:absolute;left:50%;top:70%;transform:translateX(-50%);z-index:2;color:rgba(216,177,93,.28);font-size:6px;letter-spacing:.36em;white-space:nowrap;pointer-events:none}
      .refinery-summary,.refinery-match{position:relative;z-index:2;padding:8px 10px;border-radius:11px;font-size:8px;line-height:1.6}.refinery-summary{min-height:35px;background:rgba(216,177,93,.035);border:1px solid rgba(216,177,93,.07);color:#93846d}.refinery-summary strong{color:#d5bb79}.refinery-match{margin-top:8px;border:1px solid rgba(216,177,93,.13);background:rgba(0,0,0,.12);color:#93846d}.refinery-match.ready{border-color:rgba(134,239,172,.22);background:rgba(55,108,68,.07);color:#b9d6b4}.refinery-match.error{border-color:rgba(248,113,113,.18);color:#d7a0a0}.refinery-match b{color:#ead79f}.refinery-actions{position:relative;z-index:2;display:flex;justify-content:flex-end;gap:8px;margin-top:9px}.refinery-clear{min-height:34px;padding:0 14px;border-radius:10px;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.022);color:#948b7c;font-size:8px;font-weight:800}.refinery-clear:not(:disabled):hover{border-color:rgba(216,177,93,.26);color:#cfbd95}.refinery-clear:disabled{opacity:.4;cursor:not-allowed}.refinery-note{position:relative;z-index:2;margin-top:7px;color:#6f6556;font-size:7px;line-height:1.55}.refinery-note b{color:#aa9360}
      .refinery-recipe-book{position:relative;z-index:2;margin-top:12px;border:1px solid rgba(216,177,93,.27);border-radius:13px;background:rgba(216,177,93,.035);color:#dbc18c;overflow:hidden}
      .refinery-recipe-book>summary{display:flex;align-items:center;gap:8px;padding:11px 12px;cursor:pointer;font-weight:900;font-size:11px;list-style:none}.refinery-recipe-book>summary::-webkit-details-marker{display:none}.refinery-recipe-book>summary small{margin-left:auto;color:#a48b5c;font-size:9px}
      .refinery-recipe-book-content{max-height:320px;overflow:auto;padding:0 10px 10px}.refinery-recipe-book-content>p{font-size:10px;line-height:1.6;color:#a99a7c}
      .refinery-recipe-card{margin-top:8px;padding:10px;border:1px solid rgba(216,177,93,.15);border-radius:10px;background:rgba(0,0,0,.2)}.refinery-recipe-card.is-owner{border-color:rgba(240,190,80,.57);background:rgba(216,177,93,.07)}
      .refinery-recipe-card>div{display:flex;justify-content:space-between;gap:10px;align-items:center}.refinery-recipe-card b{font-size:11px;color:#f0dfb3}.refinery-recipe-card small,.refinery-recipe-owner{font-size:9px;color:#a98f64}.refinery-recipe-card p{margin:6px 0;font-size:10px;color:#ccc0a7}.refinery-recipe-card.is-owner .refinery-recipe-owner{color:#f4cf81}
      /* 配方圖鑑：真正的圖鑑卡片、法寶徽記與可辨識的材料格。 */
      .refinery-recipe-book{position:relative;z-index:2;margin-top:16px;isolation:isolate;border:1px solid rgba(218,181,103,.38);border-radius:17px;background:radial-gradient(circle at 94% 0,rgba(169,113,34,.12),transparent 52%),linear-gradient(155deg,#221a10,#0c0b0a);color:#efdfbf;box-shadow:inset 0 1px rgba(255,235,181,.08),0 15px 28px rgba(0,0,0,.16)}
      .refinery-recipe-book>summary{display:flex;align-items:center;gap:10px;min-height:65px;padding:12px 16px;cursor:pointer;list-style:none;border:0;background:linear-gradient(90deg,rgba(230,187,104,.12),transparent 74%);font-size:13px}
      .refinery-recipe-book>summary::-webkit-details-marker{display:none}
      .refinery-recipe-book-heading{min-width:0;display:flex;align-items:center;flex-wrap:wrap;gap:7px}
      .refinery-recipe-book-heading>i{display:grid;place-items:center;flex:0 0 35px;width:35px;height:35px;border:1px solid rgba(244,202,113,.28);border-radius:11px;background:rgba(222,171,62,.1);color:#f1d58b;font-size:15px}
      .refinery-recipe-book-heading strong{color:#f7e6bc;font-size:14px;letter-spacing:.08em;white-space:nowrap}
      .refinery-recipe-book-heading small{font-size:8px;letter-spacing:.15em;color:#ad966c;white-space:nowrap}
      .refinery-recipe-summary-count{margin-left:auto;color:#d8bd85;font-size:10px;font-weight:800;white-space:nowrap}
      .refinery-recipe-book-chevron{color:#ccb276;font-size:11px;transition:transform .2s ease}
      .refinery-recipe-book[open] .refinery-recipe-book-chevron{transform:rotate(180deg)}
      .refinery-recipe-book-content{box-sizing:border-box;max-height:min(75dvh,760px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable;padding:14px;border-top:1px solid rgba(225,181,95,.15)}
      .refinery-recipe-guide{display:flex;align-items:flex-start;gap:8px;margin:0 0 12px!important;padding:11px 12px;border:1px solid rgba(222,180,100,.18);border-radius:11px;background:rgba(218,172,81,.055);color:#cbbd9d!important;font-size:11px!important;line-height:1.65!important}
      .refinery-recipe-guide i{margin-top:3px;color:#dec47f}
      .refinery-recipe-toolbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px}
      .refinery-recipe-toolbar>span{color:#b9a77f;font-size:11px;font-weight:800}
      .refinery-recipe-toolbar>span i{margin-right:5px;color:#e9cd84}
      .refinery-recipe-market{min-height:35px!important;padding:8px 12px!important;border-color:rgba(216,177,93,.36)!important;color:#f0d28c!important;font-size:10px!important}
      .refinery-recipe-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));align-items:start;gap:12px}
      .refinery-recipe-card{box-sizing:border-box;min-width:0;margin:0;padding:0;border:1px solid color-mix(in srgb,var(--recipe-realm-color,#d8b15d) 32%,rgba(216,177,93,.12));border-radius:15px;background:linear-gradient(155deg,rgba(37,31,25,.96),rgba(15,14,13,.98));overflow:hidden;box-shadow:inset 0 1px rgba(255,255,255,.05),0 10px 22px rgba(0,0,0,.15)}
      .refinery-recipe-card.is-owner{border-color:rgba(249,210,124,.66);background:linear-gradient(150deg,#342916,#17130d);box-shadow:0 0 0 1px rgba(244,199,94,.045),0 12px 30px rgba(0,0,0,.2)}
      .refinery-recipe-card.is-sealed{background:linear-gradient(155deg,#211b19,#121012)}
      .refinery-recipe-card-head{display:flex;align-items:flex-start;gap:10px;min-width:0;padding:13px 12px;border-bottom:1px solid rgba(223,185,113,.12);background:radial-gradient(circle at 0 0,color-mix(in srgb,var(--recipe-realm-color,#d8b15d) 15%,transparent),transparent 65%)}
      .refinery-recipe-artifact-icon{display:grid;place-items:center;flex:0 0 51px;width:51px;height:51px;border:1px solid color-mix(in srgb,var(--recipe-realm-color,#d8b15d) 60%,#3a2a11);border-radius:13px;background:radial-gradient(circle at 50% 27%,color-mix(in srgb,var(--recipe-realm-color,#d8b15d) 18%,transparent),#130e0a 82%);color:var(--recipe-realm-color,#f2d996);font-size:18px;font-weight:900;box-shadow:inset 0 0 17px rgba(0,0,0,.36),0 5px 12px rgba(0,0,0,.22)}
      .refinery-recipe-artifact-title{display:flex;flex:1 1 auto;min-width:0;flex-direction:column;gap:3px}
      .refinery-recipe-eyebrow{color:#977e50;font-size:8px;letter-spacing:.12em}
      .refinery-recipe-artifact-title strong{overflow-wrap:anywhere;color:#f1dfb9;font-size:14px;font-weight:900;line-height:1.35}
      .refinery-recipe-subtitle{color:var(--recipe-realm-color,#bda47c);font-size:9px;line-height:1.5}
      .refinery-recipe-access{display:inline-flex;align-items:center;justify-content:center;gap:4px;flex:0 0 auto;padding:4px 6px;border:1px solid rgba(216,177,93,.21);border-radius:999px;color:#e4cd9b;background:rgba(213,161,66,.09);font-size:9px;font-weight:850;white-space:nowrap}
      .refinery-recipe-access.is-locked{border-color:rgba(167,158,143,.21);color:#a5a19d;background:rgba(123,117,109,.1)}
      .refinery-recipe-card .refinery-recipe-description{margin:0;padding:12px 13px;color:#c9bca2;font-size:11px;line-height:1.7;overflow-wrap:anywhere}
      .refinery-recipe-ingredients-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-top:1px solid rgba(216,177,93,.1);border-bottom:1px solid rgba(216,177,93,.08);background:rgba(224,180,92,.06)}
      .refinery-recipe-ingredients-head b{font-size:10px;font-weight:900;color:#e7ce95;white-space:nowrap}
      .refinery-recipe-ingredients-head span{color:#a9a08c;font-size:9px;text-align:right}
      .refinery-recipe-ingredients{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,185px),1fr));gap:7px;margin:0;padding:11px 10px;list-style:none}
      .refinery-recipe-ingredient{display:grid;grid-template-columns:37px minmax(0,1fr) auto;align-items:center;gap:7px;min-width:0;margin:0;padding:8px 7px;border:1px solid color-mix(in srgb,var(--recipe-ingredient-color,#d8b15d) 26%,rgba(255,255,255,.07));border-radius:11px;background:linear-gradient(110deg,color-mix(in srgb,var(--recipe-ingredient-color,#d8b15d) 7%,#181411),#11100f)}
      .refinery-recipe-material-icon{display:grid;place-items:center;min-height:37px;min-width:37px;border:1px solid color-mix(in srgb,var(--recipe-ingredient-color,#d8b15d) 42%,#372b1a);border-radius:9px;background:rgba(3,3,4,.28);color:var(--recipe-ingredient-color,#d8b15d);font-size:11px;font-weight:900;text-align:center}
      .refinery-recipe-material-copy{display:flex;min-width:0;flex-direction:column;gap:2px}
      .refinery-recipe-material-copy strong{color:#eee0c5;font-size:10px;line-height:1.3;overflow-wrap:anywhere}
      .refinery-recipe-material-meta,.refinery-recipe-material-note{color:#968a74;font-size:8px;line-height:1.45;overflow-wrap:anywhere}
      .refinery-recipe-material-note{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .refinery-recipe-stock{margin-top:2px;color:#91c6a1;font-size:8px;line-height:1.4}
      .refinery-recipe-stock.is-missing{color:#eab58b}
      .refinery-recipe-required{align-self:start;color:#efce83;font-size:12px;white-space:nowrap}
      .refinery-recipe-sealed{display:flex;flex-direction:column;align-items:center;gap:7px;margin:12px;padding:19px 15px;border:1px dashed rgba(171,160,144,.28);border-radius:12px;background:repeating-linear-gradient(135deg,rgba(158,145,126,.025) 0 6px,transparent 6px 12px);text-align:center}
      .refinery-recipe-seal-mark{display:grid;place-items:center;width:42px;height:42px;border:1px solid rgba(171,160,144,.25);border-radius:50%;color:#aaa08f;font-size:15px}
      .refinery-recipe-sealed strong{color:#d2c5b1;font-size:12px}
      .refinery-recipe-card .refinery-recipe-sealed p{margin:0;max-width:260px;color:#9a9082;font-size:10px;line-height:1.7}
      .refinery-recipe-card-foot{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:7px;padding:11px 12px;border-top:1px solid rgba(221,180,99,.1);background:rgba(0,0,0,.13)}
      .refinery-recipe-owner{color:#b69d74;font-size:9px;line-height:1.6;overflow-wrap:anywhere}
      .refinery-recipe-card.is-owner .refinery-recipe-owner{color:#e4c47e}
      .refinery-recipe-owner i{color:#caa768;margin-right:4px}
      .refinery-recipe-date{flex:0 0 auto;color:#948570;font-size:9px}
      .refinery-recipe-empty{grid-column:1/-1;display:flex;flex-direction:column;align-items:center;gap:8px;padding:24px 16px;border:1px dashed rgba(216,177,93,.24);border-radius:13px;text-align:center;color:#d4bc86;font-size:12px}
      .refinery-recipe-empty i{font-size:23px}
      .refinery-recipe-empty p{margin:0;color:#a99a7c;font-size:10px}
      @media(max-width:520px){.refinery-recipe-book>summary{flex-wrap:wrap;padding:11px 12px}.refinery-recipe-summary-count{margin-left:0}.refinery-recipe-book-content{padding:10px;max-height:72dvh}.refinery-recipe-card-head{flex-wrap:wrap}.refinery-recipe-access{margin-left:auto}.refinery-recipe-ingredients{grid-template-columns:1fr}.refinery-recipe-toolbar{align-items:stretch}.refinery-recipe-market{width:100%}}
      /* Browser UA <details> hiding must win over our card layout rules.
         Explicitly hide the details body when closed, including in WebKit/iPadOS. */
      #page-training .refinery-recipe-book:not([open]) > .refinery-recipe-book-content,
      #page-training .refinery-recipe-card:not([open]) > .refinery-recipe-detail{
        display:none!important;visibility:hidden!important
      }
      #page-training .refinery-recipe-book[open] > .refinery-recipe-book-content{
        display:block;visibility:visible
      }
      #page-training .refinery-recipe-card[open] > .refinery-recipe-detail{
        display:block;visibility:visible
      }
      /* 摘要卡：預設只顯示成品與短介紹，點開後再顯示配方內容。 */
      .refinery-recipe-grid{grid-template-columns:minmax(0,1fr);gap:8px}
      .refinery-recipe-card>summary{list-style:none;cursor:pointer;align-items:center;min-height:69px;padding:10px 11px;border-bottom:0;user-select:none}
      .refinery-recipe-card>summary::-webkit-details-marker{display:none}
      .refinery-recipe-card>summary:hover{background-color:rgba(224,178,92,.055)}
      .refinery-recipe-card[open]>summary{border-bottom:1px solid rgba(223,185,113,.15)}
      .refinery-recipe-card .refinery-recipe-artifact-icon{flex-basis:43px;width:43px;height:43px;font-size:17px}
      .refinery-recipe-card .refinery-recipe-eyebrow{font-size:7px}
      .refinery-recipe-card .refinery-recipe-artifact-title{gap:2px}
      .refinery-recipe-card .refinery-recipe-artifact-title strong{font-size:12px}
      .refinery-recipe-intro{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;color:#b9aa92;font-size:9px;line-height:1.5;overflow-wrap:anywhere}
      .refinery-recipe-card-chevron{flex:0 0 auto;color:#bb9c66;font-size:10px;transition:transform .18s}
      .refinery-recipe-card[open] .refinery-recipe-card-chevron{transform:rotate(180deg)}
      .refinery-recipe-card>.refinery-recipe-detail{display:block;min-width:0;padding:0 0 2px}
      .refinery-recipe-depth{display:flex;gap:5px;align-items:center;margin:0!important;padding:0 13px 12px;color:#c1ab81;font-size:10px;line-height:1.5}
      .refinery-recipe-method{margin:2px 11px 12px;padding:12px;border:1px solid rgba(225,179,91,.18);border-radius:12px;background:linear-gradient(140deg,rgba(215,159,61,.075),rgba(0,0,0,.16))}
      .refinery-recipe-method h4{margin:0 0 10px;color:#f1d693;font-size:12px;letter-spacing:.04em}
      .refinery-recipe-method h4 i{margin-right:5px}
      .refinery-recipe-method ol{display:grid;gap:8px;margin:0 0 13px;padding:0;list-style:none;counter-reset:forge-recipe-step}
      .refinery-recipe-method li{display:grid;grid-template-columns:23px minmax(0,1fr);column-gap:9px;align-items:start;counter-increment:forge-recipe-step}
      .refinery-recipe-method li:before{content:counter(forge-recipe-step);display:grid;place-items:center;width:23px;height:23px;border:1px solid rgba(219,183,101,.35);border-radius:50%;color:#f0d594;font-size:10px;font-weight:900}
      .refinery-recipe-method li b{color:#ecddbb;font-size:10px}
      .refinery-recipe-method li span{grid-column:2;color:#b3a48b;font-size:10px;line-height:1.6}
      .refinery-recipe-craft{width:100%;min-height:42px;padding:10px 13px;border:1px solid #d6a752;border-radius:10px;background:linear-gradient(130deg,#6e4a19,#a7742c);color:#fff1c8;font-size:12px;font-weight:900;cursor:pointer;box-shadow:0 7px 16px rgba(0,0,0,.2)}
      .refinery-recipe-craft:not(:disabled):hover{filter:brightness(1.15)}
      .refinery-recipe-craft:disabled{cursor:not-allowed;opacity:.55;box-shadow:none}
      .refinery-recipe-craft i{margin-right:6px}
      .refinery-recipe-craft-note{margin:6px 0 0!important;color:#95876e!important;font-size:9px!important;line-height:1.55!important}
      @media(max-width:520px){.refinery-recipe-card>summary{padding:9px;gap:8px}.refinery-recipe-card .refinery-recipe-artifact-icon{flex-basis:39px;width:39px;height:39px}.refinery-recipe-access{font-size:8px}.refinery-recipe-card-chevron{font-size:9px}}
      .refinery-job-box{position:relative;z-index:3;margin:8px 0;padding:11px 12px;border:1px solid rgba(216,177,93,.22);border-radius:13px;background:linear-gradient(135deg,rgba(216,177,93,.075),rgba(255,255,255,.015));color:#a99a7d;font-size:8px;line-height:1.65}.refinery-job-box strong{color:#efd58e}.refinery-job-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:7px}.refinery-job-stat{padding:7px;border-radius:9px;background:rgba(0,0,0,.22);text-align:center}.refinery-job-stat b{display:block;color:#ead59b;font-size:9px}.refinery-job-progress{height:5px;margin-top:9px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.06)}.refinery-job-progress>i{display:block;height:100%;width:0;background:linear-gradient(90deg,#8a611e,#f1cd6d);transition:width .25s linear}.refinery-discovery-note{color:#c6a85f!important}.refinery-admin-guidance{position:relative;z-index:3;margin:8px 0;padding:11px 12px;border:1px solid rgba(125,211,252,.22);border-radius:13px;background:linear-gradient(135deg,rgba(56,189,248,.065),rgba(216,177,93,.035));box-shadow:inset 0 1px rgba(255,255,255,.035)}.refinery-admin-guidance-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;color:#c8e9ec;font-size:8px;font-weight:900}.refinery-admin-guidance-head small{color:#758d8a;font-size:6px;font-weight:700}.refinery-admin-guidance-grid{display:grid;grid-template-columns:170px minmax(0,1fr);gap:8px}.refinery-admin-guidance label{display:grid;gap:4px;color:#9eb9b4;font-size:6px;font-weight:900}.refinery-admin-guidance select,.refinery-admin-guidance textarea{width:100%;border:1px solid rgba(148,209,198,.18);border-radius:9px;background:rgba(7,12,11,.84);color:#e8eee9;outline:none}.refinery-admin-guidance select{min-height:36px;padding:6px 8px;font-size:8px}.refinery-admin-guidance textarea{min-height:66px;max-height:150px;padding:8px;resize:vertical;font-size:8px;line-height:1.55}.refinery-admin-guidance select:focus,.refinery-admin-guidance textarea:focus{border-color:rgba(147,230,211,.48);box-shadow:0 0 0 2px rgba(147,230,211,.05)}.refinery-admin-guidance-note{margin-top:6px;color:#74847d;font-size:6px;line-height:1.5}.refinery-admin-guidance-preview{margin-top:7px;padding:7px 8px;border-radius:9px;background:rgba(0,0,0,.18);color:#8fa39b;font-size:6px;line-height:1.55}.refinery-admin-guidance-preview b{color:#c5ddd4}.refinery-craft.job-ready{animation:refinery-craft-pulse 1.1s ease-in-out infinite}.refinery-material-list.is-job-locked{opacity:.52;pointer-events:none}@media(max-width:520px){.refinery-job-grid{grid-template-columns:1fr 1fr}.refinery-job-stat:last-child{grid-column:1/-1}.refinery-admin-guidance-grid{grid-template-columns:1fr}}
      @keyframes refinery-array-spin{to{transform:rotate(360deg)}}@keyframes refinery-craft-pulse{0%,100%{box-shadow:0 0 0 5px rgba(216,177,93,.07),0 0 20px rgba(241,191,72,.15),0 12px 28px rgba(0,0,0,.42)}50%{box-shadow:0 0 0 8px rgba(216,177,93,.11),0 0 34px rgba(241,191,72,.31),0 12px 28px rgba(0,0,0,.42)}}
      @media(max-width:900px){.cultivation-refinery{grid-template-columns:1fr}.refinery-material-panel{height:clamp(520px,70dvh,680px);min-height:520px}.refinery-material-list{height:100%;max-height:none}.refinery-slots{--array-size:min(62vw,410px)}}
      @media(max-width:520px){.refinery-slots{--array-size:min(88vw,350px);--slot-size:clamp(52px,18%,64px)}.refinery-array-center{width:30%}.refinery-craft .craft-main{font-size:8px}.refinery-craft i{font-size:12px}.refinery-slot .name{max-width:50px;font-size:5.5px}.refinery-slot .direction{font-size:6px}}
      @media(max-width:430px){.refinery-material-list{gap:7px}.refinery-material-roll{padding:5px}.refinery-material-roll-body{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.refinery-material{padding:7px 5px}.refinery-mat-icon{width:36px;height:36px;flex-basis:36px}.refinery-mat-copy strong{font-size:7px}.refinery-mat-copy small{font-size:5.5px}}
    `;
    document.head.appendChild(style);
    document.getElementById('cultivation-refinery-v2-preload-style')?.remove();
  }

  function tabActive(page) {
    return !!page?.querySelector(`[data-training-tab="${TAB}"].active`);
  }
  function activate(page = document.getElementById('page-training')) {
    if (!page || !page.querySelector('#training-tab-content')) return false;
    active = true;
    page.querySelectorAll('[data-training-tab]').forEach((tab) => {
      const yes = tab.dataset.trainingTab === TAB;
      tab.classList.toggle('active', yes);
      tab.setAttribute('aria-selected', yes ? 'true' : 'false');
    });
    try {
      render(true);
      const content = page.querySelector('#training-tab-content');
      if (!content?.querySelector('.cultivation-refinery:not([aria-busy="true"])')) {
        throw new Error('煉器介面尚未完成載入');
      }
      return true;
    } catch (error) {
      // 細節由全域 console.error 進入管理員 Debugger，不向一般玩家顯示例外訊息。
      console.error('[Cultivation refinery] open failed:', error);
      const content = page.querySelector('#training-tab-content');
      if (content) {
        // 保留可操作的重試入口；不輸出「Bug／載入失敗」等技術提示。
        content.innerHTML = '<section class="training-v3-empty refinery-open-error"><h3>八方煉器陣</h3><p>煉器陣尚未準備完成。</p><button type="button" class="bt-primary" data-refinery-retry>重新準備煉器陣</button></section>';
        content.querySelector('[data-refinery-retry]')?.addEventListener('click', () => activate(page));
      }
      return false;
    }
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
    }
    // 分頁點擊只由築基／金丹頁管理。這裡不再重複綁定 click 或回寫舊背包。
    // v2 只在煉器分頁啟用時接管內容，從而避免覆蓋統一背包與裝備格。
    if (tabActive(page)) {
      active = true;
      render();
    }
  }

  const ADMIN_FORGE_DIRECTIONS = Object.freeze([
    '自由發揮',
    '偏攻擊爆發',
    '偏暴擊連擊',
    '偏吸血續戰',
    '偏防禦減傷',
    '偏護盾保命',
    '偏反傷反制',
    '偏低血逆轉',
    '偏修煉輔助',
    '偏答題奇術',
    '偏特殊創意'
  ]);

  function adminGuidanceMarkup(job, matchingCount) {
    if (userData()?.isAdmin !== true) return '';
    if (job) {
      if (job.kind !== 'discovery' || (!job.adminGenerationDirection && !job.adminGenerationPrompt)) return '';
      return `<div class="refinery-admin-guidance-preview"><b>本爐管理員導引：</b>${esc(job.adminGenerationDirection || '自由發揮')}${job.adminGenerationPrompt ? ` · ${esc(job.adminGenerationPrompt)}` : ''}</div>`;
    }
    const options = ADMIN_FORGE_DIRECTIONS.map((value) =>
      `<option value="${esc(value)}" ${value === adminForgeDirection ? 'selected' : ''}>${esc(value)}</option>`
    ).join('');
    const knownHint = matchingCount === 1 ? '目前為既有配方，導引只會在未知配方生成新法寶時使用。' : '未知配方煉製時會沿用這一爐的設定。';
    return `<div class="refinery-admin-guidance"><div class="refinery-admin-guidance-head"><span><i class="fa-solid fa-compass"></i> 管理員煉器導引</span><small>只影響新法寶創作方向</small></div><div class="refinery-admin-guidance-grid"><label>大概動向<select data-refinery-admin-direction>${options}</select></label><label>額外提示詞<textarea data-refinery-admin-prompt maxlength="1200" placeholder="例如：偏防禦、玄武意象、不要暴擊；名稱古樸，效果以護盾與反震為主。">${esc(adminForgePrompt)}</textarea></label></div><div class="refinery-admin-guidance-note">${esc(knownHint)}　提示詞不能突破境界、數值上限或連擊率等硬規則。</div></div>`;
  }

  function currentSignature() {
    const materials = materialInventory();
    const artifacts = artifactInventory();
    return JSON.stringify({
      selected,
      forgeMethod,
      busy,
      materialInventory: Object.entries(materials).sort(([a], [b]) => a.localeCompare(b)),
      artifactInventory: Object.entries(artifacts).sort(([a], [b]) => a.localeCompare(b)),
      equipped: Object.entries(userData()?.artifactSystem?.equipped || {}).sort(([a], [b]) => a.localeCompare(b)),
      materials: MATERIAL_CATALOG.map((m) => [m.id, m.name, m.icon, m.imageUrl || '', m.category, m.realm, m.description]),
      artifacts: ARTIFACT_CATALOG.map((a) => [a.id, a.name, a.icon, a.imageUrl || '', a.realm, a.category, a.description, a.weaponForm, a.forgeMethod, a.generationSignature, a.craft?.yield || 1, a.recipeOwnerUid, a.recipeDiscoveredAtMs]),
      licenses: Object.entries(userData()?.recipeLicenses || {}).sort(([a], [b]) => a.localeCompare(b)),
      gold: Number(userData()?.stats?.gold) || 0,
      cultivation: Number(userData()?.stats?.totalScore) || 0,
      recipes: ARTIFACT_RECIPES,
      refineryJob: window.getCultivationRefineryJob?.() || null,
      isAdmin: userData()?.isAdmin === true
    });
  }

  function compareOwnedMaterials(a, b) {
    const realmDiff = materialRealmOrderByName(a?.realm || '凡人') - materialRealmOrderByName(b?.realm || '凡人');
    if (realmDiff !== 0) return realmDiff;
    return String(a?.name || a?.id || '').localeCompare(String(b?.name || b?.id || ''), 'zh-Hant');
  }

  function compareOwnedArtifacts(a, b) {
    const realmDiff = realmOrderByName(a?.realm || '凡人') - realmOrderByName(b?.realm || '凡人');
    if (realmDiff !== 0) return realmDiff;
    return String(a?.name || a?.id || '').localeCompare(String(b?.name || b?.id || ''), 'zh-Hant');
  }

  function markup() {
    const matInv = materialInventory();
    const artInv = artifactInventory();
    const equippedCounts = equippedArtifactCounts();
    const counts = selectedCounts();
    const used = selected.filter(Boolean).length;
    const ownedMaterials = MATERIAL_CATALOG
      .filter((m) => (Number(matInv[m.id]) || 0) > 0)
      .slice()
      .sort(compareOwnedMaterials);
    const ownedArtifacts = ARTIFACT_CATALOG
      .filter((a) => (Number(artInv[a.id]) || 0) > 0)
      .slice()
      .sort(compareOwnedArtifacts);
    const matching = matches();
    const job = window.getCultivationRefineryJob?.() || null;
    const plan = !job && matching.length <= 1 ? window.getCultivationRefineryPlan?.(selected, matching[0]?.id || '', forgeMethod) : null;
    const jobReady = !!job && Date.now() >= Number(job.readyAtMs || 0);
    const canAdminSkip = !!job && !jobReady && userData()?.isAdmin === true;
    const directions = ['乾','坎','艮','震','巽','離','坤','兌'];
    const forgeMethodOptions = FORGE_METHODS.map((method) =>
      `<option value="${esc(method)}" ${method === forgeMethod ? 'selected' : ''}>${esc(method)}</option>`).join('');
    const methodSelect = `<label class="refinery-forge-method">煉器手法
      <select data-refinery-forge-method ${job || busy ? 'disabled' : ''} aria-label="選擇煉器手法">${forgeMethodOptions}</select>
      <small>同樣的材料可以用不同手法探索新配方；舊配方使用「自由發揮」。</small>
    </label>`;

    const materialHtml = ownedMaterials.map((m) => {
      const token = `material:${m.id}`;
      const owned = Number(matInv[m.id]) || 0;
      const placed = Number(counts[token]) || 0;
      const remaining = Math.max(0, owned - placed);
      const color = materialRealmColor(m.realm);
      return `<button type="button" class="refinery-material" data-refinery-ingredient="${esc(token)}" style="--material-realm-color:${esc(color)}" ${remaining <= 0 || used >= SLOT_COUNT || busy || job ? 'disabled' : ''}><span class="refinery-mat-icon is-material">${itemImageMarkup(m, m.icon || '材')}</span><span class="refinery-mat-copy"><strong>${esc(m.name)}</strong><small>${esc(m.category || '材料')} · 已放入 ${placed}</small><span class="material-realm-badge">${esc(m.realm || '凡人')}</span></span><span class="refinery-mat-qty">可用 ${remaining}/${owned}</span></button>`;
    }).join('');

    const artifactHtml = ownedArtifacts.map((a) => {
      const token = `artifact:${a.id}`;
      const owned = Number(artInv[a.id]) || 0;
      const reserved = Number(equippedCounts[a.id]) || 0;
      const usableOwned = Math.max(0, owned - reserved);
      const placed = Number(counts[token]) || 0;
      const remaining = Math.max(0, usableOwned - placed);
      const color = artifactRealmColor(a.realm);
      const depth = artifactRecipeDepth(a.id);
      return `<button type="button" class="refinery-material refinery-artifact-ingredient" data-refinery-ingredient="${esc(token)}" style="--material-realm-color:${esc(color)}" ${remaining <= 0 || used >= SLOT_COUNT || busy || job ? 'disabled' : ''}><span class="refinery-mat-icon is-artifact">${itemImageMarkup(a, a.icon || '◆')}</span><span class="refinery-mat-copy"><strong>${esc(a.name)}</strong><small>${a.weaponForm ? esc(a.weaponForm) + ' · ' : ''}法寶素材 · 深度 ${depth}/${MAX_ARTIFACT_RECIPE_NESTING} · 已放入 ${placed}</small><span class="material-realm-badge">${esc(a.realm || '凡人')}</span></span><span class="refinery-mat-qty">可用 ${remaining}/${owned}${reserved ? ` · 裝備保留 ${reserved}` : ''}</span></button>`;
    }).join('');

    const ingredientHtml = `<section class="refinery-material-roll" data-refinery-material-roll="materials"><div class="refinery-group-title"><span><i class="fa-solid fa-gem"></i> 持有煉器素材 · 一般素材</span><span>${ownedMaterials.length} 種</span></div><div class="refinery-material-roll-body" data-refinery-material-roll-body="materials">${materialHtml || '<div class="refinery-empty">目前沒有一般素材。</div>'}</div></section><section class="refinery-material-roll" data-refinery-material-roll="artifacts"><div class="refinery-group-title"><span><i class="fa-solid fa-recycle"></i> 二次煉製</span><span>${ownedArtifacts.length} 種 · 最多 2 層</span></div><div class="refinery-material-roll-body ${artifactHtml ? '' : 'is-empty'}" data-refinery-material-roll-body="artifacts">${artifactHtml || '<div class="refinery-empty">目前沒有可投入的法寶；已裝備法寶會保留。</div>'}</div></section>`;

    const slotHtml = selected.map((token, index) => {
      const meta = token ? ingredientMeta(token) : null;
      return `<button type="button" class="refinery-slot ${meta?.item ? 'filled' : ''} ${meta?.type === 'material' ? 'is-material' : meta?.type === 'artifact' ? 'is-artifact' : ''}" data-refinery-slot="${index}" ${meta?.item ? `data-refinery-token="${esc(token)}" style="--material-realm-color:${esc(meta.color)}"` : 'disabled'} title="${meta?.item ? '點擊取回' : `陣位 ${directions[index]}`}"><span class="idx">${index + 1}</span><span class="remove">×</span><span class="direction">${directions[index]}</span><span><span class="icon">${meta?.item ? itemImageMarkup(meta, meta.icon || '◆') : '＋'}</span><span class="name">${esc(meta?.name || '')}</span></span></button>`;
    }).join('');

    const summary = Object.entries(counts).map(([token, q]) => `${ingredientMeta(token).name} ×${q}`).join(' · ') || '尚未投入素材';
    let matchClass = '';
    let matchPrefix = '';
    let matchPlain = '放入 2～8 個素材後即可煉製。';

    if (job) {
      matchClass = jobReady ? 'ready' : '';
      matchPrefix = jobReady ? '煉製完成：' : '爐火運轉：';
      matchPlain = job.kind === 'discovery'
        ? (jobReady ? '煉製已完成，點中央「開爐」取出新法寶。' : '未知配方正在孕化；完成後即可開爐。')
        : (jobReady ? '法寶已完成，點中央「開爐」。' : `正在煉製 ${getArtifactById(job.knownArtifactId)?.name || '法寶'}。`);
    } else if (used && matching.length === 1) {
      const matchedDepth = artifactRecipeDepth(matching[0].id);
      matchClass = 'ready';
      matchPrefix = '既有配方：';
      matchPlain = `${matching[0].icon || '◆'} ${matching[0].name} · 深度 ${matchedDepth}/${MAX_ARTIFACT_RECIPE_NESTING} · 金幣 ${plan?.gold || 0} · 約 ${window.formatCultivationRefineryDuration?.(plan?.durationMs || 0) || ''}`;
    } else if (used && matching.length > 1) {
      matchClass = 'error';
      matchPlain = '這組素材同時符合多個法寶配方，需由管理員將配方調整為唯一。';
    } else if (used && plan?.valid) {
      matchClass = 'ready';
      matchPrefix = '未知配方：';
      matchPlain = `新法寶境界「${plan.targetRealm}」 · 金幣 ${plan.gold} · 約 ${window.formatCultivationRefineryDuration?.(plan.durationMs) || ''}`;
    } else if (used) {
      matchClass = 'error';
      matchPlain = plan?.reason || '煉器至少需要 2 個素材。';
    }

    const craftReady = !busy && (job ? jobReady : !!plan?.valid) && matching.length <= 1;
    const craftLabel = job ? (jobReady ? '開爐' : '煉製中') : '煉製';
    const jobBox = job ? `<div class="refinery-job-box"><strong>${job.kind === 'discovery' ? '未知配方煉製' : '法寶煉製中'}</strong><div class="refinery-job-grid"><div class="refinery-job-stat">法寶境界<b>${esc(job.targetRealm || '凡人')}</b></div><div class="refinery-job-stat">已付金幣<b>${Math.max(0, Number(job.goldCost) || 0)}</b></div><div class="refinery-job-stat">剩餘時間<b data-refinery-job-clock>--</b></div></div><div class="refinery-job-progress"><i data-refinery-job-progress></i></div><div class="refinery-note ${job.kind === 'discovery' ? 'refinery-discovery-note' : ''}">${job.kind === 'discovery' ? '此組合沒有既有配方；煉製完成後按「開爐」即可取得新法寶。' : '素材與金幣已在按「煉製」時扣除，完成後按「開爐」取出。'}</div>${canAdminSkip ? `<div class="refinery-actions"><button type="button" class="refinery-clear" data-refinery-admin-skip ${busy ? 'disabled' : ''}><i class="fa-solid fa-forward-fast"></i> 管理員：跳過等待</button></div>` : ''}</div>` : '';

    const adminGuidance = adminGuidanceMarkup(job, matching.length);


    return `<section class="cultivation-refinery"><article class="refinery-panel refinery-material-panel"><div class="refinery-material-list ${job ? 'is-job-locked' : ''}">${ingredientHtml}</div></article><article class="refinery-panel refinery-forge-panel"><div class="refinery-head"><div><h3><i class="fa-solid fa-fire-burner"></i> 八方煉器陣</h3><p>八方歸位，陣心煉器；點已放入素材可取回。</p></div><span class="refinery-badge" data-refinery-used-badge>${used}/${SLOT_COUNT}</span></div>${methodSelect}<div class="refinery-array-wrap"><div class="refinery-slots" aria-label="八方煉器陣"><span class="refinery-array-lines"></span><span class="refinery-array-ring"></span>${slotHtml}<div class="refinery-array-center"><button type="button" class="refinery-craft ${craftReady ? 'ready' : ''} ${jobReady ? 'job-ready' : ''}" data-refinery-craft ${craftReady ? '' : 'disabled'}><i class="fa-solid fa-fire-flame-curved"></i><span class="craft-main" data-refinery-craft-label>${busy ? '處理中' : craftLabel}</span><span class="craft-sub">REFINE</span></button></div><span class="refinery-array-caption">八方聚靈 · 一器成形</span></div></div>${jobBox}${adminGuidance}<div class="refinery-summary"><strong>投入：</strong><span data-refinery-summary-text>${esc(summary)}</span></div><div class="refinery-match ${matchClass}" data-refinery-match><b data-refinery-match-prefix>${esc(matchPrefix)}</b><span data-refinery-match-text>${esc(matchPlain)}</span></div><div class="refinery-actions"><button type="button" class="refinery-clear" data-refinery-clear ${!used || busy ? 'disabled' : ''}><i class="fa-solid fa-rotate-left"></i> 清空陣位</button></div><div class="refinery-note"><b>陣法規則：</b>按「煉製」即扣素材與金幣；境界越高、玩家境界越低，耗時與費用越高。煉製完成後按「開爐」取出法寶。</div>${recipeBookMarkup()}</article></section>`;
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

    const job = window.getCultivationRefineryJob?.() || null;
    if (job) {
      render(true);
      updateJobClock();
      return;
    }

    const counts = selectedCounts();
    const used = selected.filter(Boolean).length;
    const matching = matches();

    content.querySelectorAll('[data-refinery-ingredient]').forEach((button) => {
      const token = button.dataset.refineryIngredient;
      const meta = ingredientMeta(token);
      const owned = ingredientOwned(token);
      const available = ingredientAvailable(token);
      const placed = Number(counts[token]) || 0;
      const remaining = Math.max(0, available - placed);
      button.disabled = remaining <= 0 || used >= SLOT_COUNT || busy;
      const detail = meta.type === 'artifact'
        ? `法寶素材 · 深度 ${artifactRecipeDepth(meta.id)}/${MAX_ARTIFACT_RECIPE_NESTING} · 已放入 ${placed}`
        : `${meta.category} · 已放入 ${placed}`;
      setText(button.querySelector('.refinery-mat-copy small'), detail);
      const reserved = meta.type === 'artifact' ? Math.max(0, owned - available) : 0;
      setText(button.querySelector('.refinery-mat-qty'), `可用 ${remaining}/${owned}${reserved ? ` · 裝備保留 ${reserved}` : ''}`);
    });

    content.querySelectorAll('[data-refinery-slot]').forEach((button) => {
      const index = Number(button.dataset.refinerySlot);
      const token = selected[index] || '';
      const meta = token ? ingredientMeta(token) : null;
      button.classList.toggle('filled', !!meta?.item);
      button.disabled = !meta?.item || busy;
      button.title = meta?.item ? '點擊取回' : '空煉器格';
      if (meta?.item) {
        button.dataset.refineryToken = token;
        button.style.setProperty('--material-realm-color', meta.color);
      } else {
        delete button.dataset.refineryToken;
        button.style.removeProperty('--material-realm-color');
      }
      setText(button.querySelector('.icon'), meta?.icon || '＋');
      setText(button.querySelector('.name'), meta?.name || '');
    });

    setText(content.querySelector('[data-refinery-used-badge]'), `${used}/${SLOT_COUNT}`);
    const summary = Object.entries(counts).map(([token, q]) => `${ingredientMeta(token).name} ×${q}`).join(' · ') || '尚未投入素材';
    setText(content.querySelector('[data-refinery-summary-text]'), summary);

    const matchNode = content.querySelector('[data-refinery-match]');
    matchNode?.classList.remove('ready', 'error');
    const plan = matching.length <= 1 ? window.getCultivationRefineryPlan?.(selected, matching[0]?.id || '', forgeMethod) : null;
    let prefix = '';
    let message = '放入 2～8 個素材後即可煉製。';
    if (used && matching.length === 1 && plan?.valid) {
      const item = matching[0];
      matchNode?.classList.add('ready');
      prefix = '既有配方：';
      message = `${item.icon || '◆'} ${item.name} · 深度 ${artifactRecipeDepth(item.id)}/${MAX_ARTIFACT_RECIPE_NESTING} · 金幣 ${plan.gold} · 約 ${window.formatCultivationRefineryDuration?.(plan.durationMs) || ''}`;
    } else if (used && matching.length > 1) {
      matchNode?.classList.add('error');
      message = '這組素材同時符合多個法寶配方，需由管理員將配方調整為唯一。';
    } else if (used && plan?.valid) {
      matchNode?.classList.add('ready');
      prefix = '未知配方：';
      message = `新法寶境界「${plan.targetRealm}」 · 金幣 ${plan.gold} · 約 ${window.formatCultivationRefineryDuration?.(plan.durationMs) || ''}`;
    } else if (used) {
      matchNode?.classList.add('error');
      message = plan?.reason || '煉器至少需要 2 個素材。';
    }
    setText(content.querySelector('[data-refinery-match-prefix]'), prefix);
    setText(content.querySelector('[data-refinery-match-text]'), message);

    const clearButton = content.querySelector('[data-refinery-clear]');
    if (clearButton) clearButton.disabled = !used || busy;
    const craftButton = content.querySelector('[data-refinery-craft]');
    if (craftButton) {
      const ready = !!plan?.valid && matching.length <= 1 && !busy;
      craftButton.disabled = !ready;
      craftButton.classList.toggle('ready', ready);
    }
    setText(content.querySelector('[data-refinery-craft-label]'), busy ? '處理中' : '開爐');
    content.dataset.refineryRenderKey = currentSignature();
  }

  function bindContent(content) {
    content.querySelector('[data-refinery-open-market]')?.addEventListener('click', () => window.openPlayerMarketplace?.('recipe'));
    content.querySelector('[data-refinery-recipe-book]')?.addEventListener('toggle', (event) => {
      recipeBookOpen = event.currentTarget.open;
    });
    content.querySelectorAll('[data-refinery-recipe-card]').forEach((card) => card.addEventListener('toggle', () => {
      const id = card.dataset.refineryRecipeCard;
      if (card.open) {
        expandedRecipeId = id;
        content.querySelectorAll('[data-refinery-recipe-card]').forEach((other) => {
          if (other !== card && other.open) other.open = false;
        });
      } else if (expandedRecipeId === id) {
        expandedRecipeId = '';
      }
    }));
    content.querySelectorAll('[data-refinery-craft-recipe]').forEach((button) =>
      button.addEventListener('click', () => { void craftFromRecipe(button.dataset.refineryCraftRecipe); }));
    content.querySelectorAll('[data-refinery-ingredient]').forEach((button) => button.addEventListener('click', () => add(button.dataset.refineryIngredient)));
    content.querySelectorAll('[data-refinery-slot]').forEach((button) => button.addEventListener('click', () => remove(Number(button.dataset.refinerySlot))));
    content.querySelector('[data-refinery-clear]')?.addEventListener('click', clear);
    content.querySelector('[data-refinery-forge-method]')?.addEventListener('change', (event) => {
      forgeMethod = FORGE_METHODS.includes(event.target.value) ? event.target.value : '自由發揮';
      render(true);
    });
    content.querySelector('[data-refinery-craft]')?.addEventListener('click', craft);
    content.querySelector('[data-refinery-admin-skip]')?.addEventListener('click', skipAdminWait);
    const direction = content.querySelector('[data-refinery-admin-direction]');
    if (direction) direction.addEventListener('change', () => { adminForgeDirection = direction.value || '自由發揮'; });
    const prompt = content.querySelector('[data-refinery-admin-prompt]');
    if (prompt) prompt.addEventListener('input', () => { adminForgePrompt = String(prompt.value || '').slice(0, 1200); });
  }
  function render(force = false) {
    if (!active) return;
    const page = document.getElementById('page-training');
    const content = page?.querySelector('#training-tab-content');
    if (!page || !content || !tabActive(page)) return;
    const signature = currentSignature();
    if (!force && content.dataset.refineryRenderKey === signature && content.querySelector('.cultivation-refinery')) return;
    const previousBookScroll = content.querySelector('.refinery-recipe-book-content')?.scrollTop || 0;
    content.dataset.refineryRenderKey = signature;
    content.innerHTML = markup();
    bindContent(content);
    const nextBook = content.querySelector('.refinery-recipe-book-content');
    if (nextBook && recipeBookOpen) nextBook.scrollTop = previousBookScroll;
  }

  async function craftFromRecipe(artifactId) {
    if (busy || window.getCultivationRefineryJob?.()) {
      toast('目前已有法寶正在煉製。', false);
      return;
    }
    const item = getArtifactById(artifactId);
    if (!item || !authUser()?.uid || !recipeAvailableToPlayer(item)) {
      toast('尚未取得這張配方的製作指南。', false);
      return;
    }
    // Never trust an old rendered button: re-read the official recipe, inventory,
    // equipped reservations and current economy immediately before consuming funds.
    const recipe = getArtifactRecipe(item.id);
    const tokens = recipeTokens(recipe);
    if (!tokens.length || !matchingRecipeForTokens(tokens, item.id)) {
      toast('配方內容已更動或與其他配方重複，暫時無法煉製。', false);
      return;
    }
    const required = recipeCounts(recipe);
    for (const [token, quantity] of Object.entries(required)) {
      if (ingredientAvailable(token) < quantity) {
        toast('製作材料不足，請先補齊可用素材；已裝備的法寶不可投入。', false);
        return;
      }
    }
    const plan = window.getCultivationRefineryPlan?.(tokens, item.id);
    if (!plan?.valid || plan.knownArtifactId !== item.id) {
      toast(plan?.reason || '配方暫時無法煉製。', false);
      return;
    }
    if (Math.max(0, Number(userData()?.stats?.gold) || 0) < Number(plan.gold || 0)) {
      toast('靈石不足，無法開始這張配方。', false);
      return;
    }
    // The recipe's own method must be selected before deciding whether this is a known item.
    forgeMethod = recipeMethod(item);
    selected.splice(0, SLOT_COUNT, ...tokens, ...Array(SLOT_COUNT - tokens.length).fill(null));
    render(true);
    // Use the exact same validated job creation, payment and finishing flow as
    // pressing the center of the eight-slot furnace.
    await craft();
  }

  function add(token) {
    if (busy) return;
    if (window.getCultivationRefineryJob?.()) { toast('目前已有法寶正在煉製。', false); return; }
    const empty = selected.findIndex((value) => !value);
    if (empty < 0) { toast('八個煉器格都已放滿。', false); return; }
    const placed = Number(selectedCounts()[token]) || 0;
    if (placed >= ingredientAvailable(token)) {
      toast(parseToken(token).type === 'artifact' ? '此法寶沒有更多未裝備數量可投入。' : '此材料沒有更多可投入的數量。', false);
      return;
    }
    selected[empty] = token;
    syncSelectionView();
  }
  function remove(index) {
    if (busy || window.getCultivationRefineryJob?.() || index < 0 || index >= SLOT_COUNT) return;
    selected[index] = null;
    syncSelectionView();
  }
  function clear() {
    if (busy || window.getCultivationRefineryJob?.()) return;
    selected.fill(null);
    syncSelectionView();
  }

  async function skipAdminWait() {
    if (busy) return;
    if (userData()?.isAdmin !== true) {
      toast('只有管理員可以跳過煉製時間。', false);
      return;
    }
    const job = window.getCultivationRefineryJob?.() || null;
    if (!job) {
      toast('目前沒有煉器任務。', false);
      return;
    }
    if (Date.now() >= Number(job.readyAtMs || 0)) {
      toast('此法寶已可開爐。');
      render(true);
      updateJobClock();
      return;
    }

    busy = true;
    render(true);
    try {
      await window.skipCultivationRefineryWait?.();
      toast('管理員已跳過煉製時間，可立即開爐。');
    } catch (error) {
      console.error('[Cultivation refinery admin skip]', error);
      toast('本次操作未完成，請稍後再試。', false);
    } finally {
      busy = false;
      render(true);
      updateJobClock();
    }
  }

  function refineryFailureNotice(error, phase) {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    const transient = /refinery-api-network|unavailable|deadline-exceeded|resource-exhausted/i.test(code) ||
      /Load failed|Failed to fetch|NetworkError|network request failed|network connection/i.test(message);
    if (code === 'refinery-api-network' || (phase === 'claim-discovery' && transient)) {
      return '煉器推演服務暫時無法連線，煉製進度已保留。請確認網路後再按「開爐」。';
    }
    if (error?.refineryStage === 'generation' || (phase === 'claim-discovery' && code === 'permission-denied')) {
      return '法寶推演暫時無法完成，煉製進度已保留。請稍後再按「開爐」。';
    }
    if (transient && phase === 'start') {
      return '目前無法確認是否開始煉製。請重新整理確認素材、靈石和煉製進度後再操作。';
    }
    if (transient && phase.startsWith('claim')) {
      return '開爐暫時未完成，煉製工作已保留。請確認連線後再按「開爐」。';
    }
    return window.xiuxianSafeActionError?.('煉器操作', error, '本次操作未完成，請稍後再試。') ||
      '本次操作未完成，請稍後再試。';
  }

  async function craft() {
    if (busy) return;
    busy = true;
    let phase = 'start';
    let attemptedJobId = '';
    render(true);
    try {
      const job = window.getCultivationRefineryJob?.() || null;
      if (job) {
        phase = job.kind === 'discovery' ? 'claim-discovery' : 'claim-known';
        attemptedJobId = String(job.id || '');
        if (Date.now() < Number(job.readyAtMs || 0)) {
          throw new Error('尚需 ' + (window.formatCultivationRefineryDuration?.(Number(job.readyAtMs) - Date.now()) || '一段時間'));
        }
        const item = await window.claimCultivationRefineryJob?.();
        toast(item?.recipeFirstDiscovery
          ? `首發成功！${item?.name || '新生法寶'} 配方擁有權已歸你所有。`
          : `開爐成功：${item?.name || '新生法寶'}`);
        selected.fill(null);
        adminForgeDirection = '自由發揮';
        adminForgePrompt = '';
        forgeMethod = '自由發揮';
      } else {
        const matching = matches();
        if (matching.length > 1) throw new Error('目前素材對應多個配方，暫時無法開爐。');
        const plan = window.getCultivationRefineryPlan?.(selected, matching[0]?.id || '', forgeMethod);
        if (!plan?.valid) throw new Error(plan?.reason || '煉器至少需要 2 個素材。');
        const started = await window.startCultivationRefineryJob?.(
          selected,
          matching[0]?.id || '',
          { direction: adminForgeDirection, prompt: adminForgePrompt, forgeMethod }
        );
        selected.fill(null);
        adminForgeDirection = '自由發揮';
        adminForgePrompt = '';
        forgeMethod = '自由發揮';
        toast(`開始煉製：消耗 ${started.goldCost} 金幣，約 ${window.formatCultivationRefineryDuration?.(started.durationMs) || ''} 完成`);
      }
    } catch (error) {
      console.error('[Cultivation refinery job]', {
        phase: error?.refineryStage || phase,
        jobId: attemptedJobId,
        code: String(error?.code || ''),
        httpStatus: error?.httpStatus || null,
        serverReason: String(error?.serverReason || '').slice(0, 180),
        cause: String(error?.cause?.message || '')
      }, error);
      toast(refineryFailureNotice(error, phase), false);
    } finally {
      busy = false;
      render(true);
      updateJobClock();
    }
  }

  function updateJobClock() {
    const job = window.getCultivationRefineryJob?.() || null;
    const page = document.getElementById('page-training');
    const content = page?.querySelector('#training-tab-content');
    if (!job || !content?.querySelector('.cultivation-refinery')) return;

    const now = Date.now();
    const remaining = Math.max(0, Number(job.readyAtMs || 0) - now);
    const duration = Math.max(1, Number(job.durationMs || 1));
    const elapsed = Math.max(0, duration - remaining);
    setText(content.querySelector('[data-refinery-job-clock]'), remaining > 0 ? (window.formatCultivationRefineryDuration?.(remaining) || '') : '可開爐');
    const progress = content.querySelector('[data-refinery-job-progress]');
    if (progress) progress.style.width = `${Math.min(100, Math.max(0, elapsed / duration * 100))}%`;

    const button = content.querySelector('[data-refinery-craft]');
    if (button) {
      const ready = remaining <= 0 && !busy;
      button.disabled = !ready;
      button.classList.toggle('ready', ready);
      button.classList.toggle('job-ready', ready);
      setText(button.querySelector('[data-refinery-craft-label]'), busy ? '處理中' : (ready ? '開爐' : '煉製中'));
    }
  }

  function reconcile() {
    const seen = {};
    let changed = false;
    selected.forEach((token, index) => {
      if (!token) return;
      seen[token] = (seen[token] || 0) + 1;
      const meta = ingredientMeta(token);
      if (!meta.item || seen[token] > ingredientAvailable(token)) {
        selected[index] = null;
        changed = true;
      }
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
    ['foundation-training-stage-changed','golden-core-access-changed','material-system-updated','artifact-system-updated','material-catalog-updated','artifact-catalog-updated','artifact-recipes-updated','xiuxian:recipe-license-updated','xiuxian:user-ready','xiuxian:refinery-job-updated'].forEach((name) => window.addEventListener(name, schedule));
    window.addEventListener('xiuxian:refinery-open-request', () => activate());
    window.openCultivationRefinery = () => activate();

    // 煉器每放一個材料都會重建內容區。若監看整個 body/subtree，
    // 這些 DOM 變更會再次觸發煉器排程，材料種類多時容易造成 observer storm。
    setInterval(updateJobClock, 1000);

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
