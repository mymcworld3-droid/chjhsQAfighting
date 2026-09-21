import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getFirestore, collection, doc, query, where, limit, getDoc, getDocs, getDocsFromCache, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { ARTIFACT_CATALOG, getArtifactById } from './artifact-catalog.js';
import { MATERIAL_CATALOG, getMaterialById, getArtifactRecipe, materialMarketReferencePrice, materialMarketMinimumTotal } from './material-catalog.js';

// 玩家市集：材料／未裝備法寶採原子寄售，首發配方出售永久製作知識，不限制他人自由嘗試煉製。
// 市集文件只代表可成交的委託；每次交割均重新讀取買賣雙方玩家文件。
(function () {
  'use strict';
  const COLLECTION = 'marketListings';
  const MAX_PRICE = 1_000_000_000;
  const MAX_QUANTITY = 999;
  const TYPE_LABEL = Object.freeze({ material: '煉器材料', artifact: '法寶', recipe: '配方製作指南' });
  let db = null;
  let currentUid = '';
  let refreshTimer = null;
  let active = [];
  let mine = [];
  let filter = 'all';
  let sellType = 'material';
  let sellId = '';
  let sellQuantity = 1;
  let sellPrice = 50;
  let busy = false;
  let failed = false;
  let pendingRender = false;
  let noticeText = '';
  let noticeError = false;
  let marketInitialized = false;
  let requestedView = '';
  let reloading = false;

  const user = () => { try { return getAuth(getApp()).currentUser; } catch (_) { return null; } };
  const data = () => window.getCurrentUserData?.() || null;
  const gold = (row) => Math.max(0, Math.floor(Number(row?.stats?.gold) || 0));
  const qty = (value) => Math.max(0, Math.floor(Number(value) || 0));
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const cleanName = (value) => String(value || '無名修士').trim().slice(0, 36) || '無名修士';
  function amount(value, cap, field) {
    const num = Number(value);
    if (!Number.isSafeInteger(num) || num < 1 || num > cap) throw new Error(field + '必須是 1～' + cap + ' 的整數');
    return num;
  }
  function itemFor(type, id) {
    if (type === 'material') return getMaterialById(id);
    return getArtifactById(id);
  }
  function available(type, id, row = data()) {
    if (type === 'recipe') return getArtifactById(id)?.recipeOwnerUid === user()?.uid && getArtifactRecipe(id).length ? 1 : 0;
    const system = row?.[type === 'artifact' ? 'artifactSystem' : 'materialSystem'] || {};
    const held = qty(system.inventory?.[id]);
    if (type !== 'artifact') return held;
    // 已裝備法寶不得被委託或轉移，僅計算未裝備的實際持有量。
    const equipped = Object.values(system.equipped || {}).filter((equippedId) => equippedId === id).length;
    return Math.max(0, held - equipped);
  }
  function listable() {
    if (sellType === 'recipe') return ARTIFACT_CATALOG
      .filter((item) => item.recipeOwnerUid === user()?.uid && getArtifactRecipe(item.id).length)
      .map((item) => ({ id: item.id, name: item.name, count: 1 }));
    const items = sellType === 'material' ? MATERIAL_CATALOG : ARTIFACT_CATALOG;
    return items.map((item) => ({ id: item.id, name: item.name, count: available(sellType, item.id) }))
      .filter((item) => item.count > 0);
  }
  function materialListingThreshold(item, count) {
    return item ? materialMarketMinimumTotal(item, count) : 0;
  }
  function checkMaterialListingPrice(type, item, count, price) {
    if (type !== 'material') return;
    const refPrice = materialMarketReferencePrice(item);
    const minimum = materialListingThreshold(item, count);
    if (price < minimum) {
      throw new Error('材料「' + item.name + '」參考單價為 ' + refPrice.toLocaleString() +
        ' 金幣；' + count + ' 件上架總價必須大於 ' +
        (minimum - 1).toLocaleString() + '，至少 ' + minimum.toLocaleString() + ' 金幣。');
    }
  }
  function updatePriceHint() {
    const hint = document.getElementById('pm-material-price-hint');
    const publish = document.getElementById('pm-publish');
    if (!hint || !publish) return;
    const item = sellType === 'material' ? getMaterialById(sellId) : null;
    if (!item) {
      hint.textContent = '';
      publish.disabled = busy || !listable().length;
      return;
    }
    const count = Number(sellQuantity);
    const price = Number(sellPrice);
    const validQuantity = Number.isSafeInteger(count) && count >= 1 && count <= MAX_QUANTITY;
    const minimum = validQuantity ? materialListingThreshold(item, count) : 0;
    const canList = validQuantity && Number.isSafeInteger(price) && price >= minimum && price <= MAX_PRICE;
    const ref = materialMarketReferencePrice(item);
    hint.textContent = '材料單件參考價 ' + ref.toLocaleString() +
      ' 金幣；' + (validQuantity ? count + ' 件總價至少 ' + minimum.toLocaleString() + ' 金幣。' : '請輸入有效數量。') +
      (canList ? '' : ' 目前價格未達上架門檻。');
    hint.classList.toggle('market-notice-error', !canList);
    publish.disabled = busy || !listable().length || !canList;
  }
  function notify(type, row) {
    const local = data();
    if (!local) return;
    if (type === 'material') {
      local.materialSystem = row.materialSystem;
      window.dispatchEvent(new CustomEvent('material-system-updated', { detail: row.materialSystem }));
    } else if (type === 'artifact') {
      local.artifactSystem = row.artifactSystem;
      window.dispatchEvent(new CustomEvent('artifact-system-updated', { detail: row.artifactSystem }));
    } else {
      local.recipeLicenses = row.recipeLicenses || {};
      window.dispatchEvent(new CustomEvent('xiuxian:recipe-license-updated'));
    }
    if (row.stats) {
      local.stats = local.stats || {};
      local.stats.gold = gold(row);
      window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', { detail: { gold: gold(row) } }));
    }
  }
  function message(text, ok = true) {
    noticeText = text;
    noticeError = !ok;
    const node = document.getElementById('player-market-notice');
    if (!node) return;
    node.textContent = text;
    node.classList.toggle('market-notice-error', !ok);
  }
  function safeError(label, error) {
    console.error('[Player market] ' + label, error);
    message('本次操作未完成，請稍後重試；若持續無法使用，請聯絡管理員。', false);
  }

  async function createListing() {
    if (busy || !user()) return;
    const seller = user();
    const type = sellType;
    const id = String(sellId || '');
    const item = itemFor(type, id);
    if (!item) { message('請先選擇可出售的物品或配方。', false); return; }
    let count, price;
    try {
      count = type === 'recipe' ? 1 : amount(sellQuantity, MAX_QUANTITY, '數量');
      price = amount(sellPrice, MAX_PRICE, '總價');
      checkMaterialListingPrice(type, item, count, price);
    } catch (error) { message(error.message, false); return; }
    busy = true;
    message('正在提交委託…');
    let committed;
    try {
      const listingRef = doc(collection(db, COLLECTION));
      await runTransaction(db, async (tx) => {
        const sellerRef = doc(db, 'users', seller.uid);
        const sellerSnap = await tx.get(sellerRef);
        const catalogSnap = type === 'recipe' ? await tx.get(doc(db, 'gameConfig', 'artifactCatalogV1')) : null;
        const recipeSnap = type === 'recipe' ? await tx.get(doc(db, 'gameConfig', 'materialCatalogV1')) : null;
        if (!sellerSnap.exists()) throw new Error('玩家資料不存在');
        // Revalidate the listing rule inside the same transaction before inventory escrow.
        checkMaterialListingPrice(type, itemFor(type, id), count, price);
        const raw = sellerSnap.data() || {};
        if (type === 'recipe') {
          // 不能只信任玩家瀏覽器中的圖鑑；對照 Firestore 正式首發權紀錄。
          const official = catalogSnap?.data()?.items?.find((record) => record?.id === id);
          if (!official?.recipeOwnerUid || official.recipeOwnerUid !== seller.uid || !recipeSnap?.data()?.recipes?.[id]?.length) throw new Error('只有已登錄配方的首發者可以出售使用權');
        } else {
          const systemField = type === 'material' ? 'materialSystem' : 'artifactSystem';
          const system = { ...(raw[systemField] || {}), inventory: { ...(raw[systemField]?.inventory || {}) } };
          const held = qty(system.inventory[id]);
          const reserved = type === 'artifact'
            ? Object.values(raw.artifactSystem?.equipped || {}).filter((equippedId) => equippedId === id).length : 0;
          if (held - reserved < count) throw new Error('可出售數量不足，已裝備法寶不能上架');
          const remain = held - count;
          if (remain) system.inventory[id] = remain;
          else delete system.inventory[id];
          tx.update(sellerRef, { [systemField]: system });
          committed = { ...raw, [systemField]: system };
        }
        tx.set(listingRef, {
          sellerUid: seller.uid,
          sellerName: cleanName(raw.displayName || seller.displayName),
          type, itemId: id, itemName: String(item.name || id).slice(0, 70),
          itemIcon: String(item.icon || '◆').slice(0, 4),
          itemRealm: String(item.realm || '凡人').slice(0, 20),
          quantity: count, price, status: 'active', createdAtMs: Date.now(),
          buyerUid: '', completedAtMs: 0
        });
      });
      if (committed) notify(type, committed);
      message(type === 'recipe' ? '首發配方指南已上架，首發擁有權仍歸你。' : '委託已成立，物品已移入市集保管。');
      sellId = '';
      sellQuantity = 1;
    } catch (error) { safeError('create listing', error); }
    finally { busy = false; render(); }
  }

  async function buyListing(listingId) {
    if (busy || !user()) return;
    const buyer = user();
    busy = true;
    message('正在確認交易…');
    let committed = null;
    let tradeType = '';
    try {
      await runTransaction(db, async (tx) => {
        const listingRef = doc(db, COLLECTION, listingId);
        const buyerRef = doc(db, 'users', buyer.uid);
        const listingSnap = await tx.get(listingRef);
        const buyerSnap = await tx.get(buyerRef);
        if (!listingSnap.exists() || !buyerSnap.exists()) throw new Error('委託或玩家資料不存在');
        const listing = listingSnap.data();
        if (listing.status !== 'active') throw new Error('這件商品已售出或下架');
        if (listing.sellerUid === buyer.uid) throw new Error('不可購買自己的委託');
        const sellerRef = doc(db, 'users', listing.sellerUid);
        const sellerSnap = await tx.get(sellerRef);
        const catalogSnap = listing.type === 'recipe' ? await tx.get(doc(db, 'gameConfig', 'artifactCatalogV1')) : null;
        const recipeSnap = listing.type === 'recipe' ? await tx.get(doc(db, 'gameConfig', 'materialCatalogV1')) : null;
        if (!sellerSnap.exists()) throw new Error('賣家已不存在');
        const count = amount(listing.quantity, MAX_QUANTITY, '數量');
        const price = amount(listing.price, MAX_PRICE, '總價');
        const type = listing.type;
        if (!TYPE_LABEL[type]) throw new Error('未知商品種類');
        const rawBuyer = buyerSnap.data() || {};
        const rawSeller = sellerSnap.data() || {};
        const buyerGold = gold(rawBuyer);
        if (buyerGold < price) throw new Error('金幣不足');
        const item = itemFor(type, listing.itemId);
        if (!item) throw new Error('商品已被管理員移除');
        let update = {};
        if (type === 'recipe') {
          const official = catalogSnap?.data()?.items?.find((record) => record?.id === listing.itemId);
          const validOwner = !!official?.recipeOwnerUid && official.recipeOwnerUid === listing.sellerUid;
          const validAdmin = listing.adminManaged === true && rawSeller.isAdmin === true;
          if (count !== 1 || (!validOwner && !validAdmin) ||
              !recipeSnap?.data()?.recipes?.[listing.itemId]?.length) throw new Error('此配方委託已失效');
          if (rawBuyer.recipeLicenses?.[listing.itemId] === true) throw new Error('你已持有該配方的使用權');
          update = { recipeLicenses: { ...(rawBuyer.recipeLicenses || {}), [listing.itemId]: true } };
        } else {
          const field = type === 'material' ? 'materialSystem' : 'artifactSystem';
          const system = { ...(rawBuyer[field] || {}), inventory: { ...(rawBuyer[field]?.inventory || {}) } };
          system.inventory[listing.itemId] = qty(system.inventory[listing.itemId]) + count;
          update = { [field]: system };
        }
        tx.update(buyerRef, { ...update, 'stats.gold': buyerGold - price });
        tx.update(sellerRef, { 'stats.gold': gold(rawSeller) + price });
        tx.update(listingRef, { status:'sold', buyerUid:buyer.uid, completedAtMs:Date.now() });
        tradeType = type;
        committed = { ...rawBuyer, ...update, stats: { ...(rawBuyer.stats || {}), gold: buyerGold - price } };
      });
      if (committed) notify(tradeType, committed);
      message(tradeType === 'recipe' ? '已學會這張配方！前往煉器圖鑑查看所需素材與數量。' : '交易完成！物品已入帳。');
    } catch (error) { safeError('buy listing', error); }
    finally { busy = false; render(); }
  }

  async function cancelListing(listingId) {
    if (busy || !user()) return;
    const seller = user();
    busy = true;
    message('正在取消委託…');
    let committed = null;
    let tradeType = '';
    try {
      await runTransaction(db, async (tx) => {
        const listingRef = doc(db, COLLECTION, listingId);
        const sellerRef = doc(db, 'users', seller.uid);
        const listingSnap = await tx.get(listingRef);
        const sellerSnap = await tx.get(sellerRef);
        if (!listingSnap.exists() || !sellerSnap.exists()) throw new Error('委託或玩家資料不存在');
        const listing = listingSnap.data();
        if (listing.sellerUid !== seller.uid || listing.status !== 'active') throw new Error('委託已成交或不可取消');
        tradeType = listing.type;
        if (tradeType !== 'recipe') {
          const field = tradeType === 'material' ? 'materialSystem' : 'artifactSystem';
          if (!TYPE_LABEL[tradeType]) throw new Error('未知商品種類');
          const count = amount(listing.quantity, MAX_QUANTITY, '數量');
          const raw = sellerSnap.data() || {};
          const system = { ...(raw[field] || {}), inventory: { ...(raw[field]?.inventory || {}) } };
          system.inventory[listing.itemId] = qty(system.inventory[listing.itemId]) + count;
          tx.update(sellerRef, { [field]: system });
          committed = { ...raw, [field]: system };
        }
        tx.update(listingRef, { status:'cancelled', completedAtMs:Date.now() });
      });
      if (committed) notify(tradeType, committed);
      message(tradeType === 'recipe' ? '已取消配方指南委託。' : '委託已取消，寄售的材料或法寶已退還。');
    } catch (error) { safeError('cancel listing', error); }
    finally { busy = false; render(); }
  }

  const EFFECT_LABELS = Object.freeze({
    equip_attack_flat:'攻擊', equip_attack_percent:'攻擊加成', equip_hp_flat:'生命',
    equip_hp_percent:'生命加成', equip_damage_percent:'傷害加成',
    equip_damage_reduction_flat:'固定減傷', equip_damage_reduction_percent:'減傷',
    equip_crit_chance:'暴擊率', equip_crit_damage_percent:'暴擊傷害',
    equip_combo_chance:'連擊率', equip_lifesteal_percent:'吸血',
    equip_reflect_percent:'反彈', equip_shield_flat:'初始護盾',
    equip_true_damage_flat:'真實傷害', equip_cheat_death:'保命',
    remove_wrong_option:'排除錯誤選項', timed_attack_multiplier:'限時攻擊加成',
    timed_cultivation_multiplier:'限時修為加成'
  });
  function detailMarkup(listing) {
    const item = itemFor(listing.type, listing.itemId);
    if (!item) return '<p>商品資料已變更，請重新整理後確認。</p>';
    const isRecipe = listing.type === 'recipe';
    const knows = isRecipe && (data()?.isAdmin === true || (!!currentUid && item.recipeOwnerUid === currentUid) ||
      data()?.recipeLicenses?.[item.id] === true || (!item.recipeOwnerUid && item.recipeSaleLocked !== true));
    // AI-generated descriptions may embed the discovery story or ingredient hints.
    // Never display them before the buyer receives a recipe license.
    const desc = esc(!isRecipe || knows ? (item.description || '暫無詳細描述') : '成品故事與製作資料購買後解鎖');
    const category = esc(item.category || (listing.type === 'recipe' ? '配方指南' : '法寶'));
    const attributes = listing.type === 'material'
      ? `<p><b>材料種類：</b>${category} · <b>境界：</b>${esc(item.realm || '凡人')}</p>`
      : `<p><b>法寶類型：</b>${category} · <b>境界：</b>${esc(item.realm || '凡人')}</p>`;
    const effects = (item.effects || []).map((effect) => {
      const label = EFFECT_LABELS[effect.type] || effect.type || '特殊效果';
      const amount = effect.value ?? effect.multiplier ?? '';
      return `<li>${esc(label)}${amount === '' ? '' : '：' + esc(amount)}</li>`;
    }).join('');
    const ingredients = isRecipe
      ? (knows
        ? `<p><b>製作材料：</b>${getArtifactRecipe(item.id).map((row) => {
            const ingredient = row.artifactId ? getArtifactById(row.artifactId) : getMaterialById(row.materialId);
            return esc(ingredient?.name || row.artifactId || row.materialId || '素材') + ' ×' + qty(row.quantity);
          }).join(' · ') || '目前未登錄配方'}</p>`
        : '<p>購買後可在煉器配方圖鑑查看確切材料與數量；沒有配方仍能自由開爐。</p>')
      : '';
    return `<div class="pm-item-details"><p>${desc}</p>${attributes}
      ${listing.type === 'material' ? `<p><b>境界統一參考單價：</b>${materialMarketReferencePrice(item).toLocaleString()} 金幣</p>` : ''}
      ${effects ? `<b>成品屬性與效果</b><ul>${effects}</ul>` : ''}
      ${isRecipe ? `<p><b>配方擁有人：</b>${esc(item.recipeOwnerName || '公共配方')} · 永久製作指南，購買不轉移擁有權</p>` : ''}
      ${ingredients}${isRecipe && !knows ? '<p class="pm-recipe-lock"><i class="fa-solid fa-lock"></i> 故事、材料、製作方法與完整說明將於購買後開放。</p>' : ''}</div>`;
  }

  function card(listing, own = false) {
    const mine = listing.sellerUid === currentUid;
    const canBuy = !own && !mine && !busy && gold(data()) >= qty(listing.price)
      && !(listing.type === 'recipe' && data()?.recipeLicenses?.[listing.itemId] === true);
    const price = qty(listing.price);
    return `<article class="pm-card"><div class="pm-card-head"><span class="pm-icon">${esc(listing.itemIcon)}</span><div><b>${esc(listing.itemName)}</b><small>${esc(TYPE_LABEL[listing.type] || '商品')} · ${esc(listing.itemRealm)} · ×${qty(listing.quantity)}</small></div></div>
      <p class="pm-seller">賣家：${esc(listing.sellerName)} · ${listing.type === 'recipe' ? '永久配方知識' : '安全寄售'}</p>
      <details class="pm-detail"><summary>查看商品資訊</summary>${detailMarkup(listing)}</details>
      <div class="pm-card-foot"><strong><i class="fa-solid fa-coins"></i> ${price.toLocaleString()} 金幣</strong>
      ${own ? (listing.status === 'active' ? `<button data-pm-cancel="${esc(listing.id)}" ${busy ? 'disabled' : ''}>取消委託</button>` : `<small>${listing.status === 'sold' ? '已成交' : '已取消'}</small>`)
      : `<button data-pm-buy="${esc(listing.id)}" ${canBuy ? '' : 'disabled'}>${mine ? '我的委託' : listing.type === 'recipe' && data()?.recipeLicenses?.[listing.itemId] ? '已獲授權' : gold(data()) < price ? '金幣不足' : '購買'}</button>`}</div></article>`;
  }
  function render() {
    if (!document.getElementById('player-market')) return;
    const root = document.getElementById('player-market');
    if (root.classList.contains('hidden')) return;
    const options = listable();
    if (!options.some((row) => row.id === sellId)) sellId = options[0]?.id || '';
    const selected = options.find((row) => row.id === sellId);
    const list = filter === 'mine' ? mine : active.filter((listing) => filter === 'all' || listing.type === filter);
    root.innerHTML = `<div class="pm-header"><div><small>PLAYER MARKET · 修仙交易</small><h3><i class="fa-solid fa-scale-balanced"></i> 交易市集</h3><p>玩家自由定價；金幣與商品在同一筆交易中結算。首發配方可出售製作指南；沒有配方也能自由摸索煉製。</p></div><b>金幣 ${gold(data()).toLocaleString()}</b></div>
      <div class="pm-compose"><h4>發布委託</h4><div class="pm-form"><label>類別<select id="pm-sell-type">${Object.entries(TYPE_LABEL).map(([type,label]) => `<option value="${type}" ${type === sellType ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>商品<select id="pm-sell-item">${options.map((row) => `<option value="${esc(row.id)}" ${row.id === sellId ? 'selected' : ''}>${esc(row.name)}${sellType === 'recipe' ? ' · 首發配方' : ' · 可售 '+ row.count}</option>`).join('')}</select></label><label>數量<input id="pm-sell-qty" type="number" min="1" max="${selected?.count || 1}" value="${sellType === 'recipe' ? 1 : Math.min(Math.max(1,sellQuantity), selected?.count || 1)}" ${sellType === 'recipe' ? 'disabled' : ''}></label><label>總價（金幣）<input id="pm-sell-price" type="number" min="1" max="${MAX_PRICE}" value="${sellPrice}"></label><button id="pm-publish" ${!options.length || busy ? 'disabled' : ''}>上架寄售</button></div><p id="pm-material-price-hint" class="pm-price-reference" role="status"></p><p class="pm-hint">材料／法寶上架時扣除可用庫存，取消即退還。裝備中的法寶不可寄售。配方交易只傳授製作方法，首發者身分不轉移；沒有配方也能嘗試煉器。</p></div>
      <div class="pm-filters">${[['all','全部'],['material','材料'],['artifact','法寶'],['recipe','配方'],['mine','我的委託']].map(([value,label]) => `<button data-pm-filter="${value}" class="${filter === value ? 'active' : ''}">${label}</button>`).join('')}</div>
      ${failed ? '<div class="pm-connection"><span>市集連線暫時中斷，以下若有商品為上次取得的資料；交易會在送出時重新驗證。</span><button type="button" data-pm-refresh>重新載入商品</button></div>' : ''}
      <div class="pm-list">${list.length ? list.map((row) => card(row,filter==='mine')).join('') : '<p class="pm-empty">目前沒有符合條件的委託。</p>'}</div>
      <p id="player-market-notice" class="${noticeError ? 'market-notice-error' : ''}" aria-live="polite">${esc(noticeText)}</p>`;
    updatePriceHint();
  }
  function scheduleRender() {
    if (pendingRender) return;
    pendingRender = true;
    requestAnimationFrame(() => { pendingRender = false; render(); });
  }
  function switchMarket(open) {
    const market = document.getElementById('player-market');
    const store = document.getElementById('page-store');
    const tabs = store?.querySelector('.store-tab')?.parentElement;
    const grid = document.getElementById('store-grid');
    if (!market || !store) {
      console.error('[Player market] market panel was not mounted before tab switch');
      return false;
    }
    store.classList.toggle('pm-market-active', open);
    market.classList.toggle('hidden', !open);
    tabs?.classList.toggle('hidden', open);
    grid?.classList.toggle('hidden', open);
    // 舊坊市版型的 #store-grid 與分頁列有 display:grid!important。
    // hidden 無法勝出；用 inline !important 明確遮蔽舊畫面。
    if (open) {
      tabs?.style.setProperty('display', 'none', 'important');
      grid?.style.setProperty('display', 'none', 'important');
      market.style.setProperty('display', 'block', 'important');
    } else {
      tabs?.style.removeProperty('display');
      grid?.style.removeProperty('display');
      market.style.removeProperty('display');
    }
    const shopButton = document.getElementById('pm-view-shop');
    const marketButton = document.getElementById('pm-view-market');
    shopButton?.classList.toggle('active', !open);
    marketButton?.classList.toggle('active', open);
    shopButton?.style.removeProperty('background');
    shopButton?.style.removeProperty('color');
    marketButton?.style.removeProperty('background');
    marketButton?.style.removeProperty('color');
    const loading = document.getElementById('pm-market-load-state');
    if (loading) loading.textContent = '';
    if (open) { render(); void refreshListings(); }
    return true;
  }
  function installStyle() {
    if (document.getElementById('player-market-style')) return;
    const style = document.createElement('style');
    style.id = 'player-market-style';
    style.textContent = `
      #page-store.pm-market-active > div:has(> .store-tab),#page-store.pm-market-active #store-grid{display:none!important}
      #page-store.pm-market-active #player-market{display:block!important}
      #player-market-switch{display:flex;gap:9px;margin:10px 0 15px}#player-market-switch button{flex:1;padding:12px;border:1px solid #554526;border-radius:12px;background:#15120c;color:#bea976;font-size:13px;font-weight:900}#player-market-switch button.active{color:#fff0c6;background:#4c3618;border-color:#cfa756}
      #player-market{color:#ebdcba;padding-bottom:90px}#player-market *{box-sizing:border-box}#player-market .pm-header{display:flex;justify-content:space-between;gap:15px;align-items:center;padding:20px;border:1px solid #564327;border-radius:19px;background:radial-gradient(circle at 12% 0%,#342711,#0b0a08 80%)}#player-market .pm-header small{color:#b9a06a;font-weight:800;letter-spacing:.13em}#player-market .pm-header h3{font-size:23px;font-weight:900;margin:8px 0 4px;color:#f5dfa8}#player-market .pm-header p{color:#ac9c7e;font-size:12px;line-height:1.65}#player-market .pm-header>b{flex-shrink:0;color:#ebc86c;font-size:14px}
      #player-market .pm-compose{margin:14px 0;padding:17px;border:1px solid #473921;border-radius:16px;background:#13100b}#player-market .pm-compose h4{font-weight:900;color:#e1c582;margin-bottom:12px}#player-market .pm-form{display:grid;grid-template-columns:minmax(105px,.8fr) minmax(180px,2fr) repeat(2,minmax(95px,.8fr)) auto;gap:9px;align-items:end}#player-market .pm-form label{display:flex;flex-direction:column;gap:6px;font-size:11px;color:#c7b78f}#player-market .pm-form :is(input,select){width:100%;min-width:0;height:40px;padding:0 9px;border:1px solid #554427;border-radius:9px;background:#090907;color:#eee0bc;font-size:12px}#player-market button{cursor:pointer}#player-market button:disabled{opacity:.35;cursor:not-allowed}#player-market #pm-publish,#player-market .pm-card-foot button{min-height:40px;padding:0 16px;border:1px solid #d2ad61;border-radius:10px;background:linear-gradient(150deg,#6f5226,#34250f);color:#fff0c7;font-weight:900;font-size:12px}#player-market .pm-hint{font-size:11px;color:#a79570;line-height:1.65;margin:10px 0 0}#player-market .pm-price-reference{margin:10px 0 0;font-size:11px;line-height:1.6;color:#e3c37b}#player-market .pm-price-reference.market-notice-error{color:#f0abab}
      #player-market .pm-filters{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px}#player-market .pm-filters button{border:1px solid #554428;border-radius:9px;padding:9px 13px;color:#c5b185;background:#16120d;font-size:12px}#player-market .pm-filters button.active{background:#63491f;border-color:#d4ae5b;color:#fff0c0}#player-market .pm-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:11px}#player-market .pm-card{padding:15px;border:1px solid #4c3a24;border-radius:15px;background:linear-gradient(145deg,#1d170e,#0b0a09)}#player-market .pm-card-head{display:flex;gap:10px;align-items:center}#player-market .pm-card-head b{color:#f3dfac;font-size:15px}#player-market .pm-card-head small{display:block;margin-top:5px;color:#a79675;font-size:10px}#player-market .pm-icon{flex:0 0 43px;height:43px;display:grid;place-items:center;background:#2d220f;border:1px solid #786034;border-radius:11px;color:#efca72;font-weight:900}#player-market .pm-seller{color:#97876c;font-size:11px;margin:14px 0}#player-market .pm-card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px}#player-market .pm-card-foot strong{color:#f4d078;font-size:14px}#player-market .pm-card-foot small{color:#bca36e}#player-market .pm-empty{grid-column:1/-1;border:1px dashed #54432b;border-radius:12px;padding:33px;color:#a4916b;text-align:center}#player-market-notice{font-size:12px;color:#d3b873;margin-top:15px}#player-market-notice.market-notice-error{color:#f0abab}
      #player-market .pm-detail{margin:9px 0;border:1px solid #564428;border-radius:9px;background:#100d08}
      #player-market .pm-detail summary{cursor:pointer;color:#ead29b;font-size:12px;font-weight:850;padding:10px 12px}
      #player-market .pm-item-details{padding:0 12px 11px;color:#c7b998;font-size:11px;line-height:1.7}
      #player-market .pm-item-details p{margin:6px 0;overflow-wrap:anywhere}
      #player-market .pm-item-details ul{padding-left:19px;margin-top:5px;list-style:disc}
      #player-market .pm-connection{display:flex;align-items:center;justify-content:space-between;gap:10px;color:#e8c999;font-size:11px;border:1px solid #775b31;border-radius:12px;padding:11px;margin-bottom:13px}
      #player-market .pm-connection button{padding:8px 12px;border-radius:7px;background:#694b1d;color:#fce3b4;flex-shrink:0}
      @media(max-width:900px){#player-market .pm-form{grid-template-columns:repeat(2,minmax(0,1fr))}#player-market #pm-publish{grid-column:1/-1}}@media(max-width:530px){#player-market .pm-header{flex-direction:column;align-items:flex-start}#player-market .pm-form{grid-template-columns:1fr 1fr}#player-market .pm-form label:nth-child(2){grid-column:1/-1}#player-market .pm-list{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }
  // 市集進入時主動載入一次商品；即時 Listen 中斷時也可手動重新整理，
  // 不會因為一次傳輸錯誤永久遮住已取得的商品。
  async function refreshListings() {
    if (!db || !currentUid || reloading) return;
    reloading = true;
    try {
      const [publicRows, ownRows] = await Promise.all([
        getDocs(query(collection(db,COLLECTION),where('status','==','active'),limit(60))),
        getDocs(query(collection(db,COLLECTION),where('sellerUid','==',currentUid),limit(40)))
      ]);
      active = publicRows.docs.map((row) => ({ id:row.id,...row.data() }))
        .sort((a,b) => Number(b.createdAtMs || 0)-Number(a.createdAtMs || 0));
      mine = ownRows.docs.map((row) => ({ id:row.id,...row.data() }))
        .sort((a,b) => Number(b.createdAtMs || 0)-Number(a.createdAtMs || 0));
      failed = false;
    } catch (error) {
      failed = true;
      console.error('[Player market] refresh listings', error);
      // 離線／Listen 傳輸暫時中斷時，仍可讀取先前的本機快取供玩家瀏覽。
      // 不宣稱快取是即時資料；最終成交仍由 Firestore 交易重新驗證。
      try {
        const [publicRows, ownRows] = await Promise.all([
          getDocsFromCache(query(collection(db,COLLECTION),where('status','==','active'),limit(60))),
          getDocsFromCache(query(collection(db,COLLECTION),where('sellerUid','==',currentUid),limit(40)))
        ]);
        if (publicRows.size) active = publicRows.docs.map((row) => ({ id:row.id,...row.data() }))
          .sort((a,b) => Number(b.createdAtMs || 0)-Number(a.createdAtMs || 0));
        if (ownRows.size) mine = ownRows.docs.map((row) => ({ id:row.id,...row.data() }))
          .sort((a,b) => Number(b.createdAtMs || 0)-Number(a.createdAtMs || 0));
      } catch (cacheError) {
        console.warn('[Player market] no cached listings available', cacheError);
      }
    } finally {
      reloading = false;
      scheduleRender();
    }
  }

  function mount() {
    const page = document.getElementById('page-store');
    if (!page) return false;
    installStyle();
    const tabs = page.querySelector('.store-tab')?.parentElement;
    const grid = page.querySelector('#store-grid');
    if (!tabs && !grid) {
      console.error('[Player market] store tabs and grid are both missing');
      return false;
    }
    let switcher = document.getElementById('player-market-switch');
    if (!switcher) {
      switcher = document.createElement('div');
      switcher.id = 'player-market-switch';
      switcher.innerHTML = '<button type="button" id="pm-view-shop" class="active"><i class="fa-solid fa-store"></i> 坊市商品</button><button type="button" id="pm-view-market"><i class="fa-solid fa-scale-balanced"></i> 玩家交易市集</button>';
      (tabs || grid).before(switcher);
    }
    let panel = document.getElementById('player-market');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'player-market';
      panel.className = 'hidden';
      page.appendChild(panel);
    }
    if (switcher.dataset.marketBound === '1' && panel.dataset.marketBound === '1') return true;
    switcher.dataset.marketBound = '1';
    panel.dataset.marketBound = '1';
    switcher.querySelector('#pm-view-shop')?.addEventListener('click', () => switchMarket(false));
    const marketButton = switcher.querySelector('#pm-view-market');
    // 靜態坊市已有 onclick；避免重複執行，動態建立的入口才在這裡綁事件。
    if (!marketButton?.hasAttribute('onclick')) marketButton?.addEventListener('click', () => switchMarket(true));
    panel.addEventListener('input', (event) => {
      if (event.target.id === 'pm-sell-qty') sellQuantity = Number(event.target.value);
      if (event.target.id === 'pm-sell-price') sellPrice = Number(event.target.value);
      if (event.target.id === 'pm-sell-qty' || event.target.id === 'pm-sell-price') updatePriceHint();
    });
    panel.addEventListener('change', (event) => {
      if (event.target.id === 'pm-sell-type') { sellType = event.target.value; sellId = ''; sellQuantity = 1; render(); }
      if (event.target.id === 'pm-sell-item') { sellId = event.target.value; render(); }
    });
    panel.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button || button.disabled) return;
      if (button.id === 'pm-publish') { void createListing().then(() => void refreshListings()); return; }
      if (button.dataset.pmRefresh !== undefined) { void refreshWallet(); void refreshListings(); return; }
      if (button.dataset.pmBuy) { void buyListing(button.dataset.pmBuy).then(() => { void refreshWallet(); void refreshListings(); }); return; }
      if (button.dataset.pmCancel) { void cancelListing(button.dataset.pmCancel).then(() => void refreshListings()); return; }
      if (button.dataset.pmFilter) { filter = button.dataset.pmFilter; render(); }
    });
    return true;
  }

  async function refreshWallet() {
    if (!db || !currentUid) return;
    try {
      const snap = await getDoc(doc(db,'users',currentUid));
      const current = data();
      if (!snap.exists() || !current || user()?.uid !== currentUid) return;
      const latest = snap.data() || {};
      const remoteGold = gold(latest);
      if (gold(current) !== remoteGold) {
        current.stats = current.stats || {};
        current.stats.gold = remoteGold;
        window.dispatchEvent(new CustomEvent('xiuxian:stats-updated',{detail:{gold:remoteGold}}));
      }
      const oldLicenses = JSON.stringify(current.recipeLicenses || {});
      const newLicenses = JSON.stringify(latest.recipeLicenses || {});
      if (oldLicenses !== newLicenses) {
        current.recipeLicenses = latest.recipeLicenses || {};
        window.dispatchEvent(new CustomEvent('xiuxian:recipe-license-updated'));
      }
    } catch (error) {
      console.error('[Player market] refresh wallet',error);
    }
  }

  function subscribe(uid) {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    currentUid = uid || '';
    active = []; mine = []; failed = false;
    if (!uid) { scheduleRender(); return; }
    void refreshWallet();
    void refreshListings();
    // 市集不使用 Firestore Listen stream，避免 WebChannel transport error
    // 讓整個市集畫面失效；開啟時、交易後及每 20 秒以一次性讀取更新。
    refreshTimer = setInterval(() => {
      if (!document.getElementById('page-store')?.classList.contains('hidden')) {
        void refreshWallet();
        void refreshListings();
      }
    },20000);
  }

  function boot() {
    db = getFirestore(getApp());
    mount();
    onAuthStateChanged(getAuth(getApp()), (account) => subscribe(account?.uid || ''));
    ['artifact-system-updated','material-system-updated','artifact-catalog-updated','artifact-recipes-updated','xiuxian:recipe-license-updated','xiuxian:stats-updated','xiuxian:user-ready']
      .forEach((name) => window.addEventListener(name, scheduleRender));
  }
  // 先註冊入口，避免 DOMContentLoaded 前從煉器頁點擊時遺失請求。
  window.openPlayerMarketplace = (view = 'all') => {
    if (['all','material','artifact','recipe','mine'].includes(view)) filter = view;
    if (!marketInitialized) { requestedView = filter; return; }
    if (!mount()) return;
    window.switchToPage?.('page-store');
    switchMarket(true);
  };
  function initMarket() {
    try {
      boot();
      marketInitialized = true;
      if (requestedView) {
        const target = requestedView;
        requestedView = '';
        window.openPlayerMarketplace(target);
      }
    } catch (error) {
      console.error('[Player market] boot failure', error);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMarket, { once:true });
  else initMarket();
})();
