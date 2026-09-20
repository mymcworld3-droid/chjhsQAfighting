import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getFirestore, collection, doc, query, where, limit, onSnapshot, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { ARTIFACT_CATALOG, getArtifactById } from './artifact-catalog.js';
import { MATERIAL_CATALOG, getMaterialById } from './material-catalog.js';

// 玩家市集：材料／未裝備法寶採原子寄售，首發配方販售非專屬使用權。
// 市集文件只代表可成交的委託；每次交割均重新讀取買賣雙方玩家文件。
(function () {
  'use strict';
  const COLLECTION = 'marketListings';
  const MAX_PRICE = 1_000_000_000;
  const MAX_QUANTITY = 999;
  const TYPE_LABEL = Object.freeze({ material: '煉器材料', artifact: '法寶', recipe: '配方使用權' });
  let db = null;
  let currentUid = '';
  let unsubActive = null;
  let unsubMine = null;
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
    if (type === 'recipe') return getArtifactById(id)?.recipeOwnerUid === user()?.uid ? 1 : 0;
    const system = row?.[type === 'artifact' ? 'artifactSystem' : 'materialSystem'] || {};
    const held = qty(system.inventory?.[id]);
    if (type !== 'artifact') return held;
    // 已裝備法寶不得被委託或轉移，僅計算未裝備的實際持有量。
    const equipped = Object.values(system.equipped || {}).filter((equippedId) => equippedId === id).length;
    return Math.max(0, held - equipped);
  }
  function listable() {
    if (sellType === 'recipe') return ARTIFACT_CATALOG
      .filter((item) => item.recipeOwnerUid === user()?.uid)
      .map((item) => ({ id: item.id, name: item.name, count: 1 }));
    const items = sellType === 'material' ? MATERIAL_CATALOG : ARTIFACT_CATALOG;
    return items.map((item) => ({ id: item.id, name: item.name, count: available(sellType, item.id) }))
      .filter((item) => item.count > 0);
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
        if (!sellerSnap.exists()) throw new Error('玩家資料不存在');
        const raw = sellerSnap.data() || {};
        if (type === 'recipe') {
          // 不能只信任玩家瀏覽器中的圖鑑；對照 Firestore 正式首發權紀錄。
          const official = catalogSnap?.data()?.items?.find((record) => record?.id === id);
          if (!official?.recipeOwnerUid || official.recipeOwnerUid !== seller.uid) throw new Error('只有首發者可以出售配方使用權');
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
      message('委託已成立，物品已移入市集保管。');
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
          if (count !== 1 || !official?.recipeOwnerUid || official.recipeOwnerUid !== listing.sellerUid) throw new Error('此配方委託已失效');
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
      message('交易完成！物品或配方使用權已入帳。');
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
      message('委託已取消，寄售的材料或法寶已退還。');
    } catch (error) { safeError('cancel listing', error); }
    finally { busy = false; render(); }
  }

  function card(listing, own = false) {
    const mine = listing.sellerUid === currentUid;
    const canBuy = !own && !mine && !busy && gold(data()) >= qty(listing.price)
      && !(listing.type === 'recipe' && data()?.recipeLicenses?.[listing.itemId] === true);
    const price = qty(listing.price);
    return `<article class="pm-card"><div class="pm-card-head"><span class="pm-icon">${esc(listing.itemIcon)}</span><div><b>${esc(listing.itemName)}</b><small>${esc(TYPE_LABEL[listing.type] || '商品')} · ${esc(listing.itemRealm)} · ×${qty(listing.quantity)}</small></div></div>
      <p class="pm-seller">賣家：${esc(listing.sellerName)} · ${listing.type === 'recipe' ? '永久非專屬使用權' : '安全寄售'}</p>
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
    root.innerHTML = `<div class="pm-header"><div><small>PLAYER MARKET · 修仙交易</small><h3><i class="fa-solid fa-scale-balanced"></i> 交易市集</h3><p>玩家自由定價；金幣與商品在同一筆交易中結算。首發配方可出售永久使用權。</p></div><b>金幣 ${gold(data()).toLocaleString()}</b></div>
      <div class="pm-compose"><h4>發布委託</h4><div class="pm-form"><label>類別<select id="pm-sell-type">${Object.entries(TYPE_LABEL).map(([type,label]) => `<option value="${type}" ${type === sellType ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>商品<select id="pm-sell-item">${options.map((row) => `<option value="${esc(row.id)}" ${row.id === sellId ? 'selected' : ''}>${esc(row.name)}${sellType === 'recipe' ? ' · 首發配方' : ' · 可售 '+ row.count}</option>`).join('')}</select></label><label>數量<input id="pm-sell-qty" type="number" min="1" max="${selected?.count || 1}" value="${sellType === 'recipe' ? 1 : Math.min(Math.max(1,sellQuantity), selected?.count || 1)}" ${sellType === 'recipe' ? 'disabled' : ''}></label><label>總價（金幣）<input id="pm-sell-price" type="number" min="1" max="${MAX_PRICE}" value="${sellPrice}"></label><button id="pm-publish" ${!options.length || busy ? 'disabled' : ''}>上架寄售</button></div><p class="pm-hint">材料／法寶上架時扣除可用庫存，取消即退還。裝備中的法寶不可寄售。配方只出售使用權，首發者身分不轉移。</p></div>
      <div class="pm-filters">${[['all','全部'],['material','材料'],['artifact','法寶'],['recipe','配方'],['mine','我的委託']].map(([value,label]) => `<button data-pm-filter="${value}" class="${filter === value ? 'active' : ''}">${label}</button>`).join('')}</div>
      <div class="pm-list">${failed ? '<p class="pm-empty">市集尚未開放，請稍後再試。</p>' : list.length ? list.map((row) => card(row,filter==='mine')).join('') : '<p class="pm-empty">目前沒有符合條件的委託。</p>'}</div>
      <p id="player-market-notice" class="${noticeError ? 'market-notice-error' : ''}" aria-live="polite">${esc(noticeText)}</p>`;
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
    market?.classList.toggle('hidden', !open);
    tabs?.classList.toggle('hidden', open);
    grid?.classList.toggle('hidden', open);
    document.getElementById('pm-view-shop')?.classList.toggle('active', !open);
    document.getElementById('pm-view-market')?.classList.toggle('active', open);
    if (open) render();
  }
  function installStyle() {
    if (document.getElementById('player-market-style')) return;
    const style = document.createElement('style');
    style.id = 'player-market-style';
    style.textContent = `
      #player-market-switch{display:flex;gap:9px;margin:10px 0 15px}#player-market-switch button{flex:1;padding:12px;border:1px solid #554526;border-radius:12px;background:#15120c;color:#bea976;font-size:13px;font-weight:900}#player-market-switch button.active{color:#fff0c6;background:#4c3618;border-color:#cfa756}
      #player-market{color:#ebdcba;padding-bottom:90px}#player-market *{box-sizing:border-box}#player-market .pm-header{display:flex;justify-content:space-between;gap:15px;align-items:center;padding:20px;border:1px solid #564327;border-radius:19px;background:radial-gradient(circle at 12% 0%,#342711,#0b0a08 80%)}#player-market .pm-header small{color:#b9a06a;font-weight:800;letter-spacing:.13em}#player-market .pm-header h3{font-size:23px;font-weight:900;margin:8px 0 4px;color:#f5dfa8}#player-market .pm-header p{color:#ac9c7e;font-size:12px;line-height:1.65}#player-market .pm-header>b{flex-shrink:0;color:#ebc86c;font-size:14px}
      #player-market .pm-compose{margin:14px 0;padding:17px;border:1px solid #473921;border-radius:16px;background:#13100b}#player-market .pm-compose h4{font-weight:900;color:#e1c582;margin-bottom:12px}#player-market .pm-form{display:grid;grid-template-columns:minmax(105px,.8fr) minmax(180px,2fr) repeat(2,minmax(95px,.8fr)) auto;gap:9px;align-items:end}#player-market .pm-form label{display:flex;flex-direction:column;gap:6px;font-size:11px;color:#c7b78f}#player-market .pm-form :is(input,select){width:100%;min-width:0;height:40px;padding:0 9px;border:1px solid #554427;border-radius:9px;background:#090907;color:#eee0bc;font-size:12px}#player-market button{cursor:pointer}#player-market button:disabled{opacity:.35;cursor:not-allowed}#player-market #pm-publish,#player-market .pm-card-foot button{min-height:40px;padding:0 16px;border:1px solid #d2ad61;border-radius:10px;background:linear-gradient(150deg,#6f5226,#34250f);color:#fff0c7;font-weight:900;font-size:12px}#player-market .pm-hint{font-size:11px;color:#a79570;line-height:1.65;margin:10px 0 0}
      #player-market .pm-filters{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px}#player-market .pm-filters button{border:1px solid #554428;border-radius:9px;padding:9px 13px;color:#c5b185;background:#16120d;font-size:12px}#player-market .pm-filters button.active{background:#63491f;border-color:#d4ae5b;color:#fff0c0}#player-market .pm-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:11px}#player-market .pm-card{padding:15px;border:1px solid #4c3a24;border-radius:15px;background:linear-gradient(145deg,#1d170e,#0b0a09)}#player-market .pm-card-head{display:flex;gap:10px;align-items:center}#player-market .pm-card-head b{color:#f3dfac;font-size:15px}#player-market .pm-card-head small{display:block;margin-top:5px;color:#a79675;font-size:10px}#player-market .pm-icon{flex:0 0 43px;height:43px;display:grid;place-items:center;background:#2d220f;border:1px solid #786034;border-radius:11px;color:#efca72;font-weight:900}#player-market .pm-seller{color:#97876c;font-size:11px;margin:14px 0}#player-market .pm-card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px}#player-market .pm-card-foot strong{color:#f4d078;font-size:14px}#player-market .pm-card-foot small{color:#bca36e}#player-market .pm-empty{grid-column:1/-1;border:1px dashed #54432b;border-radius:12px;padding:33px;color:#a4916b;text-align:center}#player-market-notice{font-size:12px;color:#d3b873;margin-top:15px}#player-market-notice.market-notice-error{color:#f0abab}
      @media(max-width:900px){#player-market .pm-form{grid-template-columns:repeat(2,minmax(0,1fr))}#player-market #pm-publish{grid-column:1/-1}}@media(max-width:530px){#player-market .pm-header{flex-direction:column;align-items:flex-start}#player-market .pm-form{grid-template-columns:1fr 1fr}#player-market .pm-form label:nth-child(2){grid-column:1/-1}#player-market .pm-list{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }
  function mount() {
    const page = document.getElementById('page-store');
    if (!page || document.getElementById('player-market')) return;
    installStyle();
    const tabs = page.querySelector('.store-tab')?.parentElement;
    if (!tabs) return;
    const switcher = document.createElement('div');
    switcher.id = 'player-market-switch';
    switcher.innerHTML = '<button type="button" id="pm-view-shop" class="active"><i class="fa-solid fa-store"></i> 坊市商品</button><button type="button" id="pm-view-market"><i class="fa-solid fa-scale-balanced"></i> 玩家交易市集</button>';
    tabs.before(switcher);
    const panel = document.createElement('section');
    panel.id = 'player-market';
    panel.className = 'hidden';
    page.appendChild(panel);
    switcher.querySelector('#pm-view-shop').addEventListener('click', () => switchMarket(false));
    switcher.querySelector('#pm-view-market').addEventListener('click', () => switchMarket(true));
    panel.addEventListener('input', (event) => {
      if (event.target.id === 'pm-sell-qty') sellQuantity = Number(event.target.value);
      if (event.target.id === 'pm-sell-price') sellPrice = Number(event.target.value);
    });
    panel.addEventListener('change', (event) => {
      if (event.target.id === 'pm-sell-type') { sellType = event.target.value; sellId = ''; sellQuantity = 1; render(); }
      if (event.target.id === 'pm-sell-item') { sellId = event.target.value; render(); }
    });
    panel.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button || button.disabled) return;
      if (button.id === 'pm-publish') { void createListing(); return; }
      if (button.dataset.pmBuy) { void buyListing(button.dataset.pmBuy); return; }
      if (button.dataset.pmCancel) { void cancelListing(button.dataset.pmCancel); return; }
      if (button.dataset.pmFilter) { filter = button.dataset.pmFilter; render(); }
    });
  }
  function subscribe(uid) {
    unsubActive?.(); unsubMine?.();
    unsubActive = unsubMine = null;
    currentUid = uid || '';
    active = []; mine = []; failed = false;
    if (!uid) { scheduleRender(); return; }
    try {
      const activeQuery = query(collection(db, COLLECTION), where('status','==','active'),limit(60));
      const ownQuery = query(collection(db, COLLECTION), where('sellerUid','==',uid),limit(40));
      unsubActive = onSnapshot(activeQuery, (snapshot) => {
        active = snapshot.docs.map((item) => ({ id:item.id, ...item.data() }))
          .sort((a,b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
        failed = false; scheduleRender();
      }, (error) => { failed = true; console.error('[Player market] active listings listener',error); scheduleRender(); });
      unsubMine = onSnapshot(ownQuery, (snapshot) => {
        mine = snapshot.docs.map((item) => ({ id:item.id, ...item.data() }))
          .sort((a,b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
        scheduleRender();
      }, (error) => { console.error('[Player market] own listings listener',error); });
    } catch (error) { safeError('subscribe',error); }
  }
  function boot() {
    db = getFirestore(getApp());
    mount();
    onAuthStateChanged(getAuth(getApp()), (account) => subscribe(account?.uid || ''));
    ['artifact-system-updated','material-system-updated','artifact-catalog-updated','xiuxian:stats-updated','xiuxian:user-ready']
      .forEach((name) => window.addEventListener(name, scheduleRender));
    window.openPlayerMarketplace = () => {
      window.switchToPage?.('page-store');
      switchMarket(true);
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
