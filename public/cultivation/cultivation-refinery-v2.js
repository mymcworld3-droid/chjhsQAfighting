import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, runTransaction } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { ARTIFACT_CATALOG, getArtifactById, artifactRealmColor } from './artifact-catalog.js';
import { MATERIAL_CATALOG, ARTIFACT_RECIPES, getMaterialById, getArtifactRecipe, materialRealmColor, artifactRecipeDepth, MAX_ARTIFACT_RECIPE_NESTING } from './material-catalog.js';

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
      .cultivation-refinery{width:min(100%,1080px);margin:0 auto;display:grid;grid-template-columns:minmax(300px,.88fr) minmax(430px,1.12fr);gap:14px}
      .refinery-panel{min-width:0;padding:14px;border:1px solid rgba(216,177,93,.2);border-radius:20px;background:linear-gradient(145deg,rgba(21,17,10,.97),rgba(7,7,7,.985));box-shadow:0 16px 42px rgba(0,0,0,.34);position:relative;overflow:hidden}
      .refinery-panel:before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(135deg,rgba(255,226,151,.045),transparent 25%,transparent 75%,rgba(216,177,93,.025))}
      .refinery-forge-panel{background:radial-gradient(circle at 50% 42%,rgba(124,82,16,.16),transparent 36%),radial-gradient(circle at 50% 50%,rgba(75,52,19,.12),transparent 62%),linear-gradient(150deg,rgba(19,15,9,.985),rgba(5,5,6,.99))}
      .refinery-forge-panel:after{content:"煉";position:absolute;right:-8px;bottom:-38px;font-size:150px;font-weight:900;line-height:1;color:rgba(216,177,93,.022);pointer-events:none;transform:rotate(-8deg)}
      .refinery-head{position:relative;z-index:2;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:11px}.refinery-head h3{margin:0;color:#f1e1bc;font-size:13px;letter-spacing:.04em}.refinery-head h3 i{color:#d8b15d;margin-right:4px}.refinery-head p{margin:4px 0 0;color:#8d816c;font-size:8px;line-height:1.55}.refinery-badge{padding:5px 8px;border:1px solid rgba(216,177,93,.18);border-radius:999px;background:rgba(216,177,93,.035);color:#d8bd78;font-size:7px;white-space:nowrap}
      .refinery-material-list{position:relative;z-index:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));grid-auto-rows:max-content;align-content:start;gap:8px;max-height:430px;overflow:auto;padding:2px 4px 4px 1px}.refinery-material{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;width:100%;aspect-ratio:1;min-width:0;padding:9px 7px;border:1px solid color-mix(in srgb,var(--material-realm-color,#d8b15d) 25%,rgba(255,255,255,.05));border-radius:14px;background:radial-gradient(circle at 50% 25%,color-mix(in srgb,var(--material-realm-color,#d8b15d) 9%,transparent),rgba(255,255,255,.012) 62%);text-align:center;overflow:hidden;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}.refinery-material:not(:disabled):hover{border-color:color-mix(in srgb,var(--material-realm-color,#d8b15d) 55%,#d8b15d);box-shadow:0 8px 20px rgba(0,0,0,.25),inset 0 0 18px color-mix(in srgb,var(--material-realm-color,#d8b15d) 8%,transparent);transform:translateY(-2px)}.refinery-material:disabled{opacity:.4;cursor:not-allowed}.refinery-mat-icon{width:42px;height:42px;flex:0 0 42px;display:grid;place-items:center;border:1px solid color-mix(in srgb,var(--material-realm-color,#d8b15d) 45%,rgba(216,177,93,.18));border-radius:12px;background:#171006;color:var(--material-realm-color,#efd17c);font-size:12px;font-weight:900;box-shadow:inset 0 0 14px rgba(0,0,0,.3)}.refinery-mat-copy{display:flex;min-width:0;width:100%;flex-direction:column;align-items:center;gap:2px}.refinery-mat-copy strong{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#ede1c8;font-size:9px}.refinery-mat-copy small{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#81745f;font-size:6px}.refinery-mat-copy .material-realm-badge{margin-top:1px!important}.refinery-mat-qty{position:absolute;right:6px;top:6px;padding:2px 5px;border-radius:999px;background:rgba(0,0,0,.52);color:#d5b96e;font-size:6px;font-weight:900;white-space:nowrap}.refinery-empty{grid-column:1/-1;padding:22px 12px;text-align:center;color:#82745f;font-size:9px;border:1px dashed rgba(216,177,93,.13);border-radius:13px;line-height:1.7}.refinery-group-title{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;margin-top:4px;padding:6px 8px;border-radius:9px;background:rgba(216,177,93,.04);color:#bfa66a;font-size:7px;font-weight:900}.refinery-group-title:first-child{margin-top:0}.refinery-artifact-ingredient{border-color:color-mix(in srgb,var(--material-realm-color,#d8b15d) 42%,rgba(255,255,255,.05));background:radial-gradient(circle at 50% 25%,color-mix(in srgb,var(--material-realm-color,#d8b15d) 14%,transparent),rgba(255,255,255,.012) 62%)}.refinery-artifact-ingredient .refinery-mat-copy strong{color:var(--material-realm-color,#eee1c8)}
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
      .refinery-job-box{position:relative;z-index:3;margin:8px 0;padding:11px 12px;border:1px solid rgba(216,177,93,.22);border-radius:13px;background:linear-gradient(135deg,rgba(216,177,93,.075),rgba(255,255,255,.015));color:#a99a7d;font-size:8px;line-height:1.65}.refinery-job-box strong{color:#efd58e}.refinery-job-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:7px}.refinery-job-stat{padding:7px;border-radius:9px;background:rgba(0,0,0,.22);text-align:center}.refinery-job-stat b{display:block;color:#ead59b;font-size:9px}.refinery-job-progress{height:5px;margin-top:9px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.06)}.refinery-job-progress>i{display:block;height:100%;width:0;background:linear-gradient(90deg,#8a611e,#f1cd6d);transition:width .25s linear}.refinery-discovery-note{color:#c6a85f!important}.refinery-craft.job-ready{animation:refinery-craft-pulse 1.1s ease-in-out infinite}.refinery-material-list.is-job-locked{opacity:.52;pointer-events:none}@media(max-width:520px){.refinery-job-grid{grid-template-columns:1fr 1fr}.refinery-job-stat:last-child{grid-column:1/-1}}
      @keyframes refinery-array-spin{to{transform:rotate(360deg)}}@keyframes refinery-craft-pulse{0%,100%{box-shadow:0 0 0 5px rgba(216,177,93,.07),0 0 20px rgba(241,191,72,.15),0 12px 28px rgba(0,0,0,.42)}50%{box-shadow:0 0 0 8px rgba(216,177,93,.11),0 0 34px rgba(241,191,72,.31),0 12px 28px rgba(0,0,0,.42)}}
      @media(max-width:900px){.cultivation-refinery{grid-template-columns:1fr}.refinery-material-list{max-height:300px}.refinery-slots{--array-size:min(62vw,410px)}}
      @media(max-width:520px){.refinery-slots{--array-size:min(88vw,350px);--slot-size:clamp(52px,18%,64px)}.refinery-array-center{width:30%}.refinery-craft .craft-main{font-size:8px}.refinery-craft i{font-size:12px}.refinery-slot .name{max-width:50px;font-size:5.5px}.refinery-slot .direction{font-size:6px}}
      @media(max-width:430px){.refinery-material-list{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.refinery-material{padding:7px 5px}.refinery-mat-icon{width:36px;height:36px;flex-basis:36px}.refinery-mat-copy strong{font-size:7px}.refinery-mat-copy small{font-size:5.5px}}
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
    }
    if (tab.dataset.refineryOpenBound !== '1') {
      tab.dataset.refineryOpenBound = '1';
      tab.addEventListener('click', () => activate(page));
    }
    tabs.querySelectorAll('[data-training-tab]').forEach((button) => {
      if (button.dataset.trainingTab !== TAB) bindExit(page, button);
    });
    if (tabActive(page)) {
      active = true;
      render();
    }
  }

  function currentSignature() {
    const materials = materialInventory();
    const artifacts = artifactInventory();
    return JSON.stringify({
      selected,
      busy,
      materialInventory: Object.entries(materials).sort(([a], [b]) => a.localeCompare(b)),
      artifactInventory: Object.entries(artifacts).sort(([a], [b]) => a.localeCompare(b)),
      equipped: Object.entries(userData()?.artifactSystem?.equipped || {}).sort(([a], [b]) => a.localeCompare(b)),
      materials: MATERIAL_CATALOG.map((m) => [m.id, m.name, m.icon, m.category, m.realm]),
      artifacts: ARTIFACT_CATALOG.map((a) => [a.id, a.name, a.icon, a.realm, a.craft?.yield || 1]),
      recipes: ARTIFACT_RECIPES,
      refineryJob: window.getCultivationRefineryJob?.() || null
    });
  }

  function markup() {
    const matInv = materialInventory();
    const artInv = artifactInventory();
    const equippedCounts = equippedArtifactCounts();
    const counts = selectedCounts();
    const used = selected.filter(Boolean).length;
    const ownedMaterials = MATERIAL_CATALOG.filter((m) => (Number(matInv[m.id]) || 0) > 0);
    const ownedArtifacts = ARTIFACT_CATALOG.filter((a) => (Number(artInv[a.id]) || 0) > 0);
    const matching = matches();
    const job = window.getCultivationRefineryJob?.() || null;
    const plan = !job && matching.length <= 1 ? window.getCultivationRefineryPlan?.(selected, matching[0]?.id || '') : null;
    const jobReady = !!job && Date.now() >= Number(job.readyAtMs || 0);
    const directions = ['乾','坎','艮','震','巽','離','坤','兌'];

    const materialHtml = ownedMaterials.map((m) => {
      const token = `material:${m.id}`;
      const owned = Number(matInv[m.id]) || 0;
      const placed = Number(counts[token]) || 0;
      const remaining = Math.max(0, owned - placed);
      const color = materialRealmColor(m.realm);
      return `<button type="button" class="refinery-material" data-refinery-ingredient="${esc(token)}" style="--material-realm-color:${esc(color)}" ${remaining <= 0 || used >= SLOT_COUNT || busy || job ? 'disabled' : ''}><span class="refinery-mat-icon">${esc(m.icon || '材')}</span><span class="refinery-mat-copy"><strong>${esc(m.name)}</strong><small>${esc(m.category || '材料')} · 已放入 ${placed}</small><span class="material-realm-badge">${esc(m.realm || '凡人')}</span></span><span class="refinery-mat-qty">可用 ${remaining}/${owned}</span></button>`;
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
      return `<button type="button" class="refinery-material refinery-artifact-ingredient" data-refinery-ingredient="${esc(token)}" style="--material-realm-color:${esc(color)}" ${remaining <= 0 || used >= SLOT_COUNT || busy || job ? 'disabled' : ''}><span class="refinery-mat-icon">${esc(a.icon || '◆')}</span><span class="refinery-mat-copy"><strong>${esc(a.name)}</strong><small>法寶素材 · 深度 ${depth}/${MAX_ARTIFACT_RECIPE_NESTING} · 已放入 ${placed}</small><span class="material-realm-badge">${esc(a.realm || '凡人')}</span></span><span class="refinery-mat-qty">可用 ${remaining}/${owned}${reserved ? ` · 裝備保留 ${reserved}` : ''}</span></button>`;
    }).join('');

    const ingredientHtml = (ownedMaterials.length || ownedArtifacts.length)
      ? `<div class="refinery-group-title"><span>一般材料</span><span>${ownedMaterials.length} 種</span></div>${materialHtml || '<div class="refinery-empty">目前沒有一般材料。</div>'}<div class="refinery-group-title"><span>法寶素材・二次煉製</span><span>套娃最多 2 層</span></div>${artifactHtml || '<div class="refinery-empty">目前沒有可投入的法寶；已裝備法寶會保留。</div>'}`
      : '<div class="refinery-empty"><i class="fa-solid fa-box-open"></i><br>目前沒有煉器素材。<br>材料與未裝備法寶都會顯示在這裡。</div>';

    const slotHtml = selected.map((token, index) => {
      const meta = token ? ingredientMeta(token) : null;
      return `<button type="button" class="refinery-slot ${meta?.item ? 'filled' : ''}" data-refinery-slot="${index}" ${meta?.item ? `data-refinery-token="${esc(token)}" style="--material-realm-color:${esc(meta.color)}"` : 'disabled'} title="${meta?.item ? '點擊取回' : `陣位 ${directions[index]}`}"><span class="idx">${index + 1}</span><span class="remove">×</span><span class="direction">${directions[index]}</span><span><span class="icon">${esc(meta?.icon || '＋')}</span><span class="name">${esc(meta?.name || '')}</span></span></button>`;
    }).join('');

    const summary = Object.entries(counts).map(([token, q]) => `${ingredientMeta(token).name} ×${q}`).join(' · ') || '尚未投入素材';
    let matchClass = '';
    let matchPrefix = '';
    let matchPlain = '放入 2～8 個素材後即可煉製。';

    if (job) {
      matchClass = jobReady ? 'ready' : '';
      matchPrefix = jobReady ? '煉製完成：' : '爐火運轉：';
      matchPlain = job.kind === 'discovery'
        ? (jobReady ? '未知配方已完成，點中央「開爐」後由 AI 開創新法寶。' : '未知配方正在孕化；完成後取出時才會啟動 AI 推演。')
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
      matchPlain = `AI 將以最高素材境界「${plan.targetRealm}」創造新法寶 · 金幣 ${plan.gold} · 約 ${window.formatCultivationRefineryDuration?.(plan.durationMs) || ''}`;
    } else if (used) {
      matchClass = 'error';
      matchPlain = plan?.reason || '煉器至少需要 2 個素材。';
    }

    const craftReady = !busy && (job ? jobReady : !!plan?.valid) && matching.length <= 1;
    const craftLabel = job ? (jobReady ? '開爐' : '煉製中') : '煉製';
    const jobBox = job ? `<div class="refinery-job-box"><strong>${job.kind === 'discovery' ? 'AI 未知配方煉製' : '法寶煉製中'}</strong><div class="refinery-job-grid"><div class="refinery-job-stat">法寶境界<b>${esc(job.targetRealm || '凡人')}</b></div><div class="refinery-job-stat">已付金幣<b>${Math.max(0, Number(job.goldCost) || 0)}</b></div><div class="refinery-job-stat">剩餘時間<b data-refinery-job-clock>--</b></div></div><div class="refinery-job-progress"><i data-refinery-job-progress></i></div><div class="refinery-note ${job.kind === 'discovery' ? 'refinery-discovery-note' : ''}">${job.kind === 'discovery' ? '此組合沒有既有配方；煉製完成後按「開爐」時，AI 才會依全部材料圖鑑創造新法寶與永久配方。' : '素材與金幣已在按「煉製」時扣除，完成後按「開爐」取出。'}</div></div>` : '';


    return `<section class="cultivation-refinery"><article class="refinery-panel"><div class="refinery-head"><div><h3><i class="fa-solid fa-gem"></i> 持有煉器素材</h3><p>一般材料與未裝備法寶都可投入；法寶最多套娃兩層。</p></div><span class="refinery-badge">${ownedMaterials.length + ownedArtifacts.length} 種</span></div><div class="refinery-material-list ${job ? 'is-job-locked' : ''}">${ingredientHtml}</div></article><article class="refinery-panel refinery-forge-panel"><div class="refinery-head"><div><h3><i class="fa-solid fa-fire-burner"></i> 八方煉器陣</h3><p>八方歸位，陣心煉器；點已放入素材可取回。</p></div><span class="refinery-badge" data-refinery-used-badge>${used}/${SLOT_COUNT}</span></div><div class="refinery-array-wrap"><div class="refinery-slots" aria-label="八方煉器陣"><span class="refinery-array-lines"></span><span class="refinery-array-ring"></span>${slotHtml}<div class="refinery-array-center"><button type="button" class="refinery-craft ${craftReady ? 'ready' : ''} ${jobReady ? 'job-ready' : ''}" data-refinery-craft ${craftReady ? '' : 'disabled'}><i class="fa-solid fa-fire-flame-curved"></i><span class="craft-main" data-refinery-craft-label>${busy ? '處理中' : craftLabel}</span><span class="craft-sub">REFINE</span></button></div><span class="refinery-array-caption">八方聚靈 · 一器成形</span></div></div>${jobBox}<div class="refinery-summary"><strong>投入：</strong><span data-refinery-summary-text>${esc(summary)}</span></div><div class="refinery-match ${matchClass}" data-refinery-match><b data-refinery-match-prefix>${esc(matchPrefix)}</b><span data-refinery-match-text>${esc(matchPlain)}</span></div><div class="refinery-actions"><button type="button" class="refinery-clear" data-refinery-clear ${!used || busy ? 'disabled' : ''}><i class="fa-solid fa-rotate-left"></i> 清空陣位</button></div><div class="refinery-note"><b>陣法規則：</b>按「煉製」即扣素材與金幣；境界越高、玩家境界越低，耗時與費用越高。煉製完成後按「開爐」取出法寶；未知配方會在開爐時由 AI 創造法寶，最高投入素材境界決定新法寶境界。</div></article></section>`;
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
    const plan = matching.length <= 1 ? window.getCultivationRefineryPlan?.(selected, matching[0]?.id || '') : null;
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
      message = `AI 將以最高素材境界「${plan.targetRealm}」創造新法寶 · 金幣 ${plan.gold} · 約 ${window.formatCultivationRefineryDuration?.(plan.durationMs) || ''}`;
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
    content.querySelectorAll('[data-refinery-ingredient]').forEach((button) => button.addEventListener('click', () => add(button.dataset.refineryIngredient)));
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

  async function craft() {
    if (busy) return;
    busy = true;
    render(true);
    try {
      const job = window.getCultivationRefineryJob?.() || null;
      if (job) {
        if (Date.now() < Number(job.readyAtMs || 0)) {
          throw new Error('尚需 ' + (window.formatCultivationRefineryDuration?.(Number(job.readyAtMs) - Date.now()) || '一段時間'));
        }
        const item = await window.claimCultivationRefineryJob?.();
        toast(`開爐成功：${item?.name || '新生法寶'}`);
        selected.fill(null);
      } else {
        const matching = matches();
        if (matching.length > 1) throw new Error('目前素材對應多個配方，暫時無法開爐。');
        const plan = window.getCultivationRefineryPlan?.(selected, matching[0]?.id || '');
        if (!plan?.valid) throw new Error(plan?.reason || '煉器至少需要 2 個素材。');
        const started = await window.startCultivationRefineryJob?.(selected, matching[0]?.id || '');
        selected.fill(null);
        toast(`開始煉製：消耗 ${started.goldCost} 金幣，約 ${window.formatCultivationRefineryDuration?.(started.durationMs) || ''} 完成`);
      }
    } catch (error) {
      console.error('[Cultivation refinery job]', error);
      toast(error.message || '煉器失敗。', false);
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
    ['foundation-training-stage-changed','golden-core-access-changed','material-system-updated','artifact-system-updated','material-catalog-updated','artifact-catalog-updated','artifact-recipes-updated','xiuxian:user-ready','xiuxian:refinery-job-updated'].forEach((name) => window.addEventListener(name, schedule));
    window.addEventListener('xiuxian:refinery-open-request', () => {
      const page = document.getElementById('page-training');
      if (page) activate(page);
    });

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
