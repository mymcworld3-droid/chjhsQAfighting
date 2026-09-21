import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, collection, doc, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
  ARTIFACT_CATALOG,
  ARTIFACT_REALMS,
  ARTIFACT_EQUIP_SLOTS,
  SUPPORTED_ARTIFACT_EFFECTS,
  normalizeArtifactDefinition,
  replaceArtifactCatalog,
  validateArtifactCatalog,
  artifactRealmColor
} from './artifact-catalog.js';
import {
  MATERIAL_CATALOG,
  ARTIFACT_RECIPES,
  validateArtifactRecipes,
  replaceArtifactRecipes,
  getArtifactRecipe,
  artifactRecipeDepth,
  MAX_ARTIFACT_RECIPE_NESTING,
  MIN_ARTIFACT_RECIPE_MATERIALS,
  MAX_ARTIFACT_RECIPE_MATERIALS
} from './material-catalog.js';

(function () {
  'use strict';

  const PANEL_ID = 'admin-artifact-manager';
  const MODAL_ID = 'admin-artifact-modal';
  const CONFIG_COLLECTION = 'gameConfig';
  const CONFIG_DOC = 'artifactCatalogV1';
  const MATERIAL_CONFIG_DOC = 'materialCatalogV1';
  const ARTIFACT_CATEGORIES = Object.freeze(['消耗法寶', '裝備法寶']);
  const EFFECT_GUIDE = Object.freeze({
    equip_attack_flat: { title: '固定攻擊', summary: '裝備後固定增加攻擊力', hint: '例如：+80 攻擊', icon: 'fa-sword' },
    equip_attack_percent: { title: '百分比攻擊', summary: '裝備後按比例提高攻擊力', hint: '例如：0.2 = +20%', icon: 'fa-chart-line' },
    equip_hp_flat: { title: '固定生命', summary: '裝備後固定增加生命上限', hint: '例如：+400 生命', icon: 'fa-heart' },
    equip_hp_percent: { title: '百分比生命', summary: '裝備後按比例提高生命上限', hint: '例如：0.2 = +20%', icon: 'fa-heart-pulse' },
    equip_damage_percent: { title: '百分比增傷', summary: '每次攻擊造成更多傷害', hint: '例如：0.15 = +15%', icon: 'fa-burst' },
    equip_damage_reduction_flat: { title: '固定減傷', summary: '每次受到傷害先固定扣除數值', hint: '例如：80 = 每次少 80 傷害', icon: 'fa-shield' },
    equip_damage_reduction_percent: { title: '百分比減傷', summary: '每次受到傷害按比例降低', hint: '例如：0.2 = -20% 傷害', icon: 'fa-shield-halved' },
    equip_crit_chance: { title: '暴擊率', summary: '攻擊時有機率造成暴擊', hint: '例如：0.15 = 15%', icon: 'fa-crosshairs' },
    equip_crit_damage_percent: { title: '暴擊增傷', summary: '暴擊時提高額外倍率', hint: '例如：0.5 = 暴擊額外 +50%', icon: 'fa-bolt' },
    equip_combo_chance: { title: '連擊率', summary: '最多 10% 機率追加一次同等基礎攻擊', hint: '硬上限：0.10 = 10%', icon: 'fa-forward-fast' },
    equip_lifesteal_percent: { title: '吸血', summary: '依實際造成的生命傷害回復生命', hint: '例如：0.1 = 10%', icon: 'fa-droplet' },
    equip_reflect_percent: { title: '反傷', summary: '反射實際受到的生命傷害', hint: '例如：0.15 = 15%', icon: 'fa-reply' },
    equip_shield_flat: { title: '開場護盾', summary: '每場鬥法開始時獲得固定護盾', hint: '例如：300 護盾', icon: 'fa-shield-heart' },
    equip_true_damage_flat: { title: '固定真實傷害', summary: '命中時追加不受一般減傷影響的傷害', hint: '例如：+80 真傷', icon: 'fa-fire' },
    equip_low_hp_damage_percent: { title: '低血增傷', summary: '生命 ≤30% 時提高傷害', hint: '例如：0.3 = +30%', icon: 'fa-skull' },
    equip_low_hp_reduction_percent: { title: '低血減傷', summary: '生命 ≤30% 時額外降低傷害', hint: '例如：0.25 = -25%', icon: 'fa-heart-crack' },
    equip_first_hit_reduction_percent: { title: '首次受傷減免', summary: '每場第一次受傷額外減傷', hint: '例如：0.5 = -50%', icon: 'fa-hand-sparkles' },
    equip_damage_cap_percent: { title: '單次傷害上限', summary: '單次生命傷害不得超過最大生命比例', hint: '例如：0.35 = 最多 35% 最大生命', icon: 'fa-gauge-high' },
    equip_on_correct_shield_flat: { title: '答對獲盾', summary: '答對並完成攻擊後增加固定護盾', hint: '例如：+120 護盾', icon: 'fa-shield-cat' },
    equip_cheat_death: { title: '一次保命', summary: '每場一次，致命傷改為保留 1 HP', hint: '不需填數值', icon: 'fa-heart-circle-plus' },
    equip_copy_enemy_artifact: { title: '鏡映敵方法寶', summary: '每場固定複製敵方一項可複製戰鬥效果', hint: '不會複製「複製」本身', icon: 'fa-clone' },
    timed_attack_multiplier: { title: '限時攻擊倍率', summary: '催動後一段時間提高鬥法攻擊', hint: '設定倍率與持續分鐘', icon: 'fa-bolt' },
    timed_cultivation_multiplier: { title: '限時修為倍率', summary: '催動後一段時間提高答對所得修為', hint: '設定倍率與持續分鐘', icon: 'fa-fire-flame-curved' },
    remove_wrong_option: { title: '排除錯誤選項', summary: '作答前移除一個錯誤選項', hint: '可選問道／鬥法／洞天', icon: 'fa-wand-sparkles' }
  });

  const EFFECT_GROUPS = Object.freeze([
    {
      id: 'offense',
      title: '攻擊與傷害',
      icon: 'fa-khanda',
      types: ['equip_attack_flat', 'equip_attack_percent', 'equip_damage_percent', 'equip_true_damage_flat']
    },
    {
      id: 'crit-combo',
      title: '暴擊・連擊・吸血',
      icon: 'fa-bolt',
      types: ['equip_crit_chance', 'equip_crit_damage_percent', 'equip_combo_chance', 'equip_lifesteal_percent']
    },
    {
      id: 'defense',
      title: '防禦與護體',
      icon: 'fa-shield-halved',
      types: [
        'equip_hp_flat', 'equip_hp_percent',
        'equip_damage_reduction_flat', 'equip_damage_reduction_percent',
        'equip_reflect_percent', 'equip_shield_flat',
        'equip_first_hit_reduction_percent', 'equip_damage_cap_percent',
        'equip_cheat_death'
      ]
    },
    {
      id: 'conditional',
      title: '條件觸發',
      icon: 'fa-fire-flame-curved',
      types: ['equip_low_hp_damage_percent', 'equip_low_hp_reduction_percent', 'equip_on_correct_shield_flat']
    },
    {
      id: 'special',
      title: '特殊奇術',
      icon: 'fa-wand-magic-sparkles',
      types: ['equip_copy_enemy_artifact']
    },
    {
      id: 'timed-study',
      title: '限時・修煉・答題',
      icon: 'fa-hourglass-half',
      types: ['timed_attack_multiplier', 'timed_cultivation_multiplier', 'remove_wrong_option']
    }
  ]);
  let busy = false;

  function data() { return window.getCurrentUserData?.() || null; }
  function isAdmin() { return data()?.isAdmin === true; }
  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function toast(message, ok = true) {
    document.getElementById('admin-artifact-toast')?.remove();
    const el = document.createElement('div');
    el.id = 'admin-artifact-toast';
    el.textContent = message;
    el.style.cssText = `position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:12050;padding:10px 15px;border-radius:999px;background:rgba(8,8,8,.97);border:1px solid ${ok ? 'rgba(216,177,93,.55)' : 'rgba(248,113,113,.55)'};color:${ok ? '#f5dfa7' : '#fecaca'};font-size:10px;font-weight:900;box-shadow:0 15px 45px rgba(0,0,0,.55)`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  function effectLabel(effect) {
    const pct = (value) => `${Math.round((Number(value) || 0) * 100)}%`;
    const labels = {
      equip_attack_flat: `攻擊 +${Number(effect.value) || 0}`,
      equip_attack_percent: `攻擊 +${pct(effect.value)}`,
      equip_hp_flat: `生命 +${Number(effect.value) || 0}`,
      equip_hp_percent: `生命 +${pct(effect.value)}`,
      equip_damage_percent: `傷害 +${pct(effect.value)}`,
      equip_damage_reduction_flat: `固定減傷 ${Number(effect.value) || 0}`,
      equip_damage_reduction_percent: `減傷 ${pct(effect.value)}`,
      equip_crit_chance: `暴擊率 ${pct(effect.value)}`,
      equip_crit_damage_percent: `暴擊增傷 ${pct(effect.value)}`,
      equip_combo_chance: `連擊率 ${pct(Math.min(0.10, Number(effect.value) || 0))}`,
      equip_lifesteal_percent: `吸血 ${pct(effect.value)}`,
      equip_reflect_percent: `反傷 ${pct(effect.value)}`,
      equip_shield_flat: `開場護盾 +${Number(effect.value) || 0}`,
      equip_true_damage_flat: `真傷 +${Number(effect.value) || 0}`,
      equip_low_hp_damage_percent: `低血增傷 +${pct(effect.value)}`,
      equip_low_hp_reduction_percent: `低血減傷 ${pct(effect.value)}`,
      equip_first_hit_reduction_percent: `首次減傷 ${pct(effect.value)}`,
      equip_damage_cap_percent: `單次傷害≤${pct(effect.value)} 最大生命`,
      equip_on_correct_shield_flat: `答對護盾 +${Number(effect.value) || 0}`,
      equip_cheat_death: '每場一次保命',
      equip_copy_enemy_artifact: '複製敵方戰鬥效果',
      timed_attack_multiplier: `限時攻擊 ×${Number(effect.multiplier) || 1}`,
      timed_cultivation_multiplier: `限時修為 ×${Number(effect.multiplier) || 1}`,
      remove_wrong_option: `排除錯項 · ${(effect.contexts || []).join('/')}`
    };
    return labels[effect.type] || effect.type;
  }

  const VALUE_EFFECT_DEFAULTS = Object.freeze({
    equip_attack_flat: 80,
    equip_attack_percent: 0.15,
    equip_hp_flat: 400,
    equip_hp_percent: 0.15,
    equip_damage_percent: 0.15,
    equip_damage_reduction_flat: 60,
    equip_damage_reduction_percent: 0.15,
    equip_crit_chance: 0.10,
    equip_crit_damage_percent: 0.50,
    equip_combo_chance: 0.05,
    equip_lifesteal_percent: 0.10,
    equip_reflect_percent: 0.10,
    equip_shield_flat: 250,
    equip_true_damage_flat: 60,
    equip_low_hp_damage_percent: 0.25,
    equip_low_hp_reduction_percent: 0.25,
    equip_first_hit_reduction_percent: 0.40,
    equip_damage_cap_percent: 0.35,
    equip_on_correct_shield_flat: 100
  });

  function effectUsesValue(type) {
    return Object.prototype.hasOwnProperty.call(VALUE_EFFECT_DEFAULTS, type);
  }


  function defaultEffect(type) {
    if (effectUsesValue(type)) return { type, value: VALUE_EFFECT_DEFAULTS[type] };
    if (type === 'timed_attack_multiplier' || type === 'timed_cultivation_multiplier') return { type, multiplier: 1.5, durationMs: 10 * 60 * 1000 };
    if (type === 'remove_wrong_option') return { type, contexts: ['quiz', 'battle', 'dongtian'], perQuestion: 1 };
    return { type };
  }

  function categoryOptions(current) {
    const value = String(current || '消耗法寶').trim() || '消耗法寶';
    const options = [...ARTIFACT_CATEGORIES];
    if (!options.includes(value)) options.push(value);
    return options.map((category) => `<option value="${escapeHtml(category)}" ${category === value ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('');
  }

  function effectGuideItemMarkup(type) {
    const guide = EFFECT_GUIDE[type] || { title: type, summary: '通用法寶效果', hint: type, icon: 'fa-wand-magic-sparkles' };
    return `<button type="button" class="aam-guide-item" data-aam-add-effect-type="${escapeHtml(type)}"><span class="aam-guide-icon"><i class="fa-solid ${escapeHtml(guide.icon)}"></i></span><span class="aam-guide-copy"><b>${escapeHtml(guide.title)}</b><span>${escapeHtml(guide.summary)}</span><small>${escapeHtml(guide.hint)}</small></span><span class="aam-guide-add"><i class="fa-solid fa-plus"></i></span></button>`;
  }

  function effectGuideMarkup() {
    const assigned = new Set();
    const groups = EFFECT_GROUPS.map((group, index) => {
      const types = group.types.filter((type) => SUPPORTED_ARTIFACT_EFFECTS.includes(type));
      types.forEach((type) => assigned.add(type));
      if (!types.length) return '';
      return `<details class="aam-guide-group" data-aam-guide-group="${escapeHtml(group.id)}" ${index === 0 ? 'open' : ''}><summary><span><i class="fa-solid ${escapeHtml(group.icon)}"></i><b>${escapeHtml(group.title)}</b><em>${types.length}</em></span><i class="fa-solid fa-chevron-down aam-guide-chevron"></i></summary><div class="aam-guide-group-list">${types.map(effectGuideItemMarkup).join('')}</div></details>`;
    });
    const extras = SUPPORTED_ARTIFACT_EFFECTS.filter((type) => !assigned.has(type));
    if (extras.length) {
      groups.push(`<details class="aam-guide-group" data-aam-guide-group="other"><summary><span><i class="fa-solid fa-box-archive"></i><b>其他功能</b><em>${extras.length}</em></span><i class="fa-solid fa-chevron-down aam-guide-chevron"></i></summary><div class="aam-guide-group-list">${extras.map(effectGuideItemMarkup).join('')}</div></details>`);
    }
    return `<div class="aam-guide-scroll">${groups.join('')}</div>`;
  }


  function recipeTotal(recipe = []) {
    return recipe.reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row?.quantity) || 0)), 0);
  }

  function recipeSummaryText(artifactId) {
    const recipe = getArtifactRecipe(artifactId);
    if (!recipe.length) return '未設定配方';
    const depth = artifactRecipeDepth(artifactId);
    return `已設定 · ${recipeTotal(recipe)}/${MAX_ARTIFACT_RECIPE_MATERIALS} 格${depth ? ` · 二次煉製深度 ${depth}/${MAX_ARTIFACT_RECIPE_NESTING}` : ''}`;
  }

  function recipeEditorMarkup(item = null) {
    const recipe = item?.id ? getArtifactRecipe(item.id) : [];
    const materialCurrent = Object.fromEntries(recipe.filter((row) => row.materialId).map((row) => [row.materialId, row.quantity]));
    const artifactCurrent = Object.fromEntries(recipe.filter((row) => row.artifactId).map((row) => [row.artifactId, row.quantity]));
    const artifactChoices = ARTIFACT_CATALOG.filter((artifact) => artifact.id !== item?.id);
    const total = recipeTotal(recipe);
    return `<details class="aam-recipe-editor" data-aam-recipe-editor><summary><span><i class="fa-solid fa-flask"></i><b>煉器配方</b><small data-aam-recipe-summary>${escapeHtml(item?.id ? recipeSummaryText(item.id) : '未設定配方')}</small></span><i class="fa-solid fa-chevron-down aam-recipe-chevron"></i></summary><div class="aam-recipe-body"><p>直接在法寶編輯裡設定合成素材。0 個代表未設定；已設定時至少 ${MIN_ARTIFACT_RECIPE_MATERIALS} 個、最多 ${MAX_ARTIFACT_RECIPE_MATERIALS} 個。可投入一般材料與既有法寶，二次煉製套娃最多 ${MAX_ARTIFACT_RECIPE_NESTING} 層。</p><div class="aam-recipe-meter"><span>煉器陣素材格</span><b data-aam-recipe-count>${total} / ${MAX_ARTIFACT_RECIPE_MATERIALS}</b></div><div class="aam-recipe-list"><div class="aam-recipe-group-title">一般材料</div>${MATERIAL_CATALOG.map((material) => `<label class="aam-recipe-row"><span>${escapeHtml(material.icon || '材')} ${escapeHtml(material.name)}<small>${escapeHtml(material.realm || '凡人')} · ${escapeHtml(material.category || '材料')}</small></span><input type="number" min="0" max="${MAX_ARTIFACT_RECIPE_MATERIALS}" step="1" inputmode="numeric" value="${Math.max(0, Number(materialCurrent[material.id]) || 0)}" data-recipe-material="${escapeHtml(material.id)}"></label>`).join('')}<div class="aam-recipe-group-title">法寶素材（二次煉製）</div>${artifactChoices.map((artifact) => {
      const color = artifactRealmColor(artifact.realm);
      return `<label class="aam-recipe-row is-artifact" style="--artifact-realm-color:${escapeHtml(color)}"><span>${escapeHtml(artifact.icon || '◆')} ${escapeHtml(artifact.name)}<small>${escapeHtml(artifact.realm || '凡人')} · 配方深度 ${artifactRecipeDepth(artifact.id)}/${MAX_ARTIFACT_RECIPE_NESTING}</small></span><input type="number" min="0" max="${MAX_ARTIFACT_RECIPE_MATERIALS}" step="1" inputmode="numeric" value="${Math.max(0, Number(artifactCurrent[artifact.id]) || 0)}" data-recipe-artifact="${escapeHtml(artifact.id)}"></label>`;
    }).join('')}</div><div class="aam-recipe-status" data-aam-recipe-status></div></div></details>`;
  }

  function readRecipe(modal) {
    const materialRows = [...modal.querySelectorAll('[data-recipe-material]')].map((input) => ({
      materialId: input.dataset.recipeMaterial,
      quantity: Math.max(0, Math.floor(Number(input.value) || 0))
    })).filter((row) => row.quantity > 0);
    const artifactRows = [...modal.querySelectorAll('[data-recipe-artifact]')].map((input) => ({
      artifactId: input.dataset.recipeArtifact,
      quantity: Math.max(0, Math.floor(Number(input.value) || 0))
    })).filter((row) => row.quantity > 0);
    return [...materialRows, ...artifactRows];
  }

  function syncRecipeEditor(modal) {
    const inputs = [...modal.querySelectorAll('[data-recipe-material],[data-recipe-artifact]')];
    let total = 0;
    inputs.forEach((input) => {
      let value = Math.floor(Number(input.value) || 0);
      value = Math.max(0, Math.min(MAX_ARTIFACT_RECIPE_MATERIALS, value));
      if (String(value) !== input.value && document.activeElement !== input) input.value = String(value);
      total += value;
    });
    const count = modal.querySelector('[data-aam-recipe-count]');
    if (count) {
      count.textContent = `${total} / ${MAX_ARTIFACT_RECIPE_MATERIALS}`;
      count.classList.toggle('is-error', total === 1 || total > MAX_ARTIFACT_RECIPE_MATERIALS);
    }
    const summary = modal.querySelector('[data-aam-recipe-summary]');
    if (summary) summary.textContent = total ? `已選 ${total}/${MAX_ARTIFACT_RECIPE_MATERIALS} 格` : '未設定配方';
    const recipeStatus = modal.querySelector('[data-aam-recipe-status]');
    const save = modal.querySelector('.aam-save');
    const invalid = total === 1 || total > MAX_ARTIFACT_RECIPE_MATERIALS;
    if (save && !busy) save.disabled = invalid;
    if (recipeStatus) {
      if (total === 1) recipeStatus.textContent = `已設定配方至少需要 ${MIN_ARTIFACT_RECIPE_MATERIALS} 個素材。`;
      else if (total > MAX_ARTIFACT_RECIPE_MATERIALS) recipeStatus.textContent = `目前共 ${total} 個素材，超過 ${MAX_ARTIFACT_RECIPE_MATERIALS} 格上限。`;
      else recipeStatus.textContent = total === 0 ? '目前未設定配方；此法寶將不能用既有配方煉製。' : '';
    }
  }

  function bindRecipeEditor(modal) {
    modal.querySelectorAll('[data-recipe-material],[data-recipe-artifact]').forEach((input) => {
      input.addEventListener('input', () => syncRecipeEditor(modal));
    });
    syncRecipeEditor(modal);
  }

  function ensureStyle() {
    if (document.getElementById('admin-artifact-manager-style')) return;
    const style = document.createElement('style');
    style.id = 'admin-artifact-manager-style';
    style.textContent = `
      #${PANEL_ID}{padding:14px;border:1px solid rgba(216,177,93,.2);border-radius:16px;background:linear-gradient(145deg,rgba(21,17,10,.94),rgba(7,7,7,.97))}
      .aam-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.aam-head h3{margin:0;color:#f3e5c3;font-size:14px}.aam-head p{margin:3px 0 0;color:#8e816b;font-size:8px;line-height:1.5}.aam-add{min-height:36px;padding:0 12px;border-radius:11px;border:1px solid rgba(216,177,93,.38);background:rgba(216,177,93,.09);color:#f1d895;font-size:9px;font-weight:900}
      .aam-list{display:grid;gap:7px}.aam-item{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:9px;align-items:center;padding:9px;border:1px solid rgba(255,255,255,.07);border-radius:13px;background:rgba(255,255,255,.018)}.aam-icon{width:38px;height:38px;display:grid;place-items:center;border-radius:11px;border:1px solid rgba(216,177,93,.25);color:#f0d17a;background:#171005;font-weight:900}.aam-copy{min-width:0}.aam-copy strong{color:#eee1c7;font-size:10px}.aam-meta{margin-top:3px;color:#887a63;font-size:7px}.aam-effects{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px}.aam-effects span{padding:2px 5px;border-radius:999px;background:rgba(216,177,93,.05);color:#baa77d;font-size:6px}.aam-item-actions{display:grid;gap:5px;min-width:78px}.aam-edit,.aam-approve{min-height:32px;padding:0 10px;border-radius:9px;font-size:8px;font-weight:900}.aam-edit{border:1px solid rgba(216,177,93,.22);background:rgba(216,177,93,.05);color:#dbc078}.aam-approve{border:1px solid rgba(74,222,128,.28);background:rgba(22,101,52,.12);color:#86efac}.aam-pending{display:inline-flex;align-items:center;gap:4px;margin-left:6px;padding:2px 6px;border:1px solid rgba(251,191,36,.38);border-radius:999px;background:rgba(146,64,14,.16);color:#fbbf24;font-size:6px;font-weight:900}.aam-item.is-pending{border-color:rgba(251,191,36,.46)!important;box-shadow:inset 0 0 24px rgba(251,191,36,.045),0 0 20px rgba(251,191,36,.04)}.aam-ai-meta{margin-top:4px;color:#b99753;font-size:6px}
      .aam-modal{position:fixed;inset:0;z-index:12000;display:grid;place-items:center;padding:14px;background:rgba(0,0,0,.82);backdrop-filter:blur(8px)}.aam-card{width:min(100%,1080px);max-height:92dvh;overflow:auto;padding:18px;border:1px solid rgba(216,177,93,.28);border-radius:20px;background:linear-gradient(145deg,#18130c,#080808);box-shadow:0 30px 100px rgba(0,0,0,.72)}.aam-card h3{margin:0 0 4px;color:#f3e7ca;font-size:15px}.aam-note{margin:0 0 12px;color:#8f826d;font-size:8px;line-height:1.65}.aam-editor-layout{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:16px;align-items:start}.aam-editor-main{min-width:0}.aam-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.aam-field{display:grid;gap:4px}.aam-field.full{grid-column:1/-1}.aam-field label{color:#9a8d75;font-size:7px;font-weight:900}.aam-field input,.aam-field select,.aam-field textarea{width:100%;min-height:38px;padding:8px 9px;border:1px solid rgba(216,177,93,.16);border-radius:10px;background:#0a0908;color:#eadfc8;font-size:9px;outline:none}.aam-field textarea{min-height:76px;resize:vertical}.aam-field input:focus,.aam-field select:focus,.aam-field textarea:focus{border-color:rgba(216,177,93,.5)}
      .aam-effects-editor{display:grid;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.07)}.aam-effects-head{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#d7bb77;font-size:9px;font-weight:900}.aam-effect-row{padding:9px;border:1px solid rgba(255,255,255,.07);border-radius:12px;background:rgba(255,255,255,.016)}.aam-effect-main{display:grid;grid-template-columns:minmax(150px,1.2fr) repeat(3,minmax(85px,1fr)) auto;gap:6px;align-items:end}.aam-effect-main label,.aam-contexts label{display:grid;gap:3px;color:#857963;font-size:6px}.aam-effect-main input,.aam-effect-main select{min-height:34px;padding:6px;border:1px solid rgba(216,177,93,.14);border-radius:9px;background:#090807;color:#e5d8bd;font-size:8px}.aam-remove-effect{width:32px;height:32px;border-radius:9px;border:1px solid rgba(248,113,113,.2);background:rgba(127,29,29,.12);color:#fca5a5}.aam-contexts{display:flex;gap:10px;flex-wrap:wrap;margin-top:7px}.aam-contexts label{display:flex;align-items:center;gap:4px}.aam-contexts input{accent-color:#d8b15d}.aam-add-effect{min-height:32px;padding:0 10px;border-radius:9px;border:1px dashed rgba(216,177,93,.28);background:transparent;color:#cbae68;font-size:8px;font-weight:900}
      .aam-recipe-owner-editor,.aam-recipe-listing{margin-top:12px;padding:11px;border:1px solid rgba(216,177,93,.2);border-radius:12px;background:rgba(216,177,93,.025)}
      .aam-recipe-owner-editor>label,.aam-recipe-listing>label{color:#f2d793;font-size:10px;font-weight:900}
      .aam-owner-toggle{display:flex;align-items:center;gap:6px;margin:9px 0;color:#ead6aa!important}
      .aam-owner-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .aam-owner-fields label{display:grid;gap:3px;color:#cdb98e;font-size:8px}
      .aam-owner-fields input,.aam-admin-sale-row input{width:100%;min-width:0;padding:8px;border:1px solid rgba(216,177,93,.25);border-radius:8px;background:#100e0a;color:#f4e3bb;font-size:10px}
      .aam-admin-sale-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}
      .aam-admin-list-recipe{padding:8px 13px;border:1px solid #d6aa58;border-radius:9px;color:#f8dfa5;background:#694913;font-size:10px;font-weight:900}
      @media(max-width:540px){.aam-owner-fields{grid-template-columns:1fr}}
      .aam-recipe-editor{margin-top:12px;border:1px solid rgba(216,177,93,.16);border-radius:13px;background:rgba(216,177,93,.018);overflow:hidden}.aam-recipe-editor>summary{min-height:42px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 11px;cursor:pointer;list-style:none;background:linear-gradient(90deg,rgba(216,177,93,.07),rgba(255,255,255,.012));color:#d7bd7e}.aam-recipe-editor>summary::-webkit-details-marker{display:none}.aam-recipe-editor>summary>span{display:flex;align-items:center;gap:7px;min-width:0}.aam-recipe-editor>summary b{font-size:9px}.aam-recipe-editor>summary small{color:#86775e;font-size:7px;font-weight:700}.aam-recipe-chevron{font-size:8px;transition:transform .16s}.aam-recipe-editor[open] .aam-recipe-chevron{transform:rotate(180deg)}.aam-recipe-body{padding:10px;border-top:1px solid rgba(216,177,93,.08)}.aam-recipe-body>p{margin:0 0 9px;color:#81745f;font-size:7px;line-height:1.55}.aam-recipe-meter{display:flex;justify-content:space-between;gap:8px;margin-bottom:8px;padding:7px 9px;border-radius:9px;background:rgba(216,177,93,.045);color:#bca66f;font-size:7px;font-weight:900}.aam-recipe-meter b.is-error{color:#fca5a5}.aam-recipe-list{display:grid;gap:6px;max-height:42dvh;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding-right:3px}.aam-recipe-group-title{position:sticky;top:0;z-index:1;padding:6px 8px;border-radius:8px;background:#171209;color:#c9aa62;font-size:7px;font-weight:900}.aam-recipe-row{display:grid;grid-template-columns:minmax(0,1fr) 86px;gap:8px;align-items:center;padding:7px 8px;border:1px solid rgba(255,255,255,.065);border-radius:10px;background:rgba(255,255,255,.014);color:#d8c9a8;font-size:7px}.aam-recipe-row>span{min-width:0}.aam-recipe-row small{display:block;margin-top:2px;color:#766a57;font-size:6px}.aam-recipe-row input{width:100%;min-height:32px;padding:5px 7px;border:1px solid rgba(216,177,93,.14);border-radius:8px;background:#090807;color:#eadfc8;font-size:8px}.aam-recipe-row.is-artifact{border-color:color-mix(in srgb,var(--artifact-realm-color,#d8b15d) 28%,rgba(255,255,255,.07))}.aam-recipe-row.is-artifact>span{color:var(--artifact-realm-color,#d8c9a8)}.aam-recipe-status{min-height:14px;margin-top:7px;color:#d6b86e;font-size:7px}
      .aam-guide{position:sticky;top:0;display:flex;flex-direction:column;max-height:calc(92dvh - 36px);min-height:0;padding:13px;border:1px solid rgba(216,177,93,.18);border-radius:16px;background:linear-gradient(160deg,rgba(31,24,13,.9),rgba(8,8,8,.96));overflow:hidden}.aam-guide h4{margin:0;color:#efd99e;font-size:11px}.aam-guide>p{flex:0 0 auto;margin:4px 0 10px;color:#887b65;font-size:7px;line-height:1.55}.aam-guide-scroll{min-height:0;flex:1 1 auto;display:grid;align-content:start;gap:7px;max-height:min(62dvh,620px);overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:0 4px 2px 0}.aam-guide-scroll::-webkit-scrollbar{width:7px}.aam-guide-scroll::-webkit-scrollbar-thumb{border-radius:999px;background:rgba(216,177,93,.24)}.aam-guide-scroll::-webkit-scrollbar-track{background:rgba(255,255,255,.025)}.aam-guide-group{border:1px solid rgba(216,177,93,.12);border-radius:12px;background:rgba(255,255,255,.014);overflow:hidden}.aam-guide-group>summary{min-height:38px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 9px;cursor:pointer;list-style:none;color:#d8c28d;background:linear-gradient(90deg,rgba(216,177,93,.065),rgba(255,255,255,.012));user-select:none}.aam-guide-group>summary::-webkit-details-marker{display:none}.aam-guide-group>summary>span{display:flex;align-items:center;gap:7px;min-width:0}.aam-guide-group>summary>span>i{width:19px;color:#d6b764;text-align:center}.aam-guide-group>summary b{font-size:8px;white-space:nowrap}.aam-guide-group>summary em{min-width:20px;padding:2px 5px;border-radius:999px;background:rgba(216,177,93,.09);color:#9f8e69;font-size:6px;font-style:normal;text-align:center}.aam-guide-chevron{color:#8e7c59;font-size:7px;transition:transform .16s ease}.aam-guide-group[open] .aam-guide-chevron{transform:rotate(180deg)}.aam-guide-group-list{display:grid;gap:6px;padding:7px;border-top:1px solid rgba(216,177,93,.08);background:rgba(0,0,0,.12)}.aam-guide-item{width:100%;display:grid;grid-template-columns:32px minmax(0,1fr) 24px;gap:8px;align-items:center;padding:8px;border:1px solid rgba(216,177,93,.12);border-radius:11px;background:rgba(255,255,255,.018);text-align:left;transition:.15s}.aam-guide-item:hover{border-color:rgba(216,177,93,.42);background:rgba(216,177,93,.07)}.aam-guide-icon{width:30px;height:30px;display:grid;place-items:center;border-radius:9px;background:rgba(216,177,93,.08);color:#daba6b}.aam-guide-copy{display:grid;gap:2px;min-width:0}.aam-guide-copy b{color:#e6d8b8;font-size:8px}.aam-guide-copy span{color:#998b72;font-size:7px;line-height:1.4}.aam-guide-copy small{color:#6f6555;font-size:6px}.aam-guide-add{display:grid;place-items:center;color:#c8a958;font-size:8px}.aam-guide-note{flex:0 0 auto;margin-top:10px;padding:8px;border-radius:10px;background:rgba(216,177,93,.045);color:#8e816b;font-size:6px;line-height:1.6}.aam-guide-note b{color:#c9ad69}
      .aam-actions{display:flex;gap:8px;margin-top:14px}.aam-actions button{flex:1;min-height:40px;border-radius:11px;font-size:9px;font-weight:900}.aam-cancel{border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:#aaa}.aam-save{border:1px solid rgba(216,177,93,.4);background:linear-gradient(135deg,#8f651e,#4b2f09);color:#fff0bd}.aam-save:disabled{opacity:.45}
      @media(max-width:880px){.aam-editor-layout{grid-template-columns:1fr}.aam-guide{position:static;order:-1;max-height:58dvh}.aam-guide-scroll{max-height:42dvh}}
      @media(max-width:620px){.aam-item{grid-template-columns:38px minmax(0,1fr)}.aam-item-actions{grid-column:1/-1;width:100%;grid-template-columns:1fr 1fr}.aam-edit,.aam-approve{width:100%}.aam-grid{grid-template-columns:1fr}.aam-field.full{grid-column:auto}.aam-effect-main{grid-template-columns:1fr 1fr}.aam-effect-main>label:first-child{grid-column:1/-1}.aam-remove-effect{align-self:end}.aam-head{align-items:flex-start;flex-direction:column}.aam-add{width:100%}.aam-guide{max-height:54dvh}.aam-guide-scroll{max-height:38dvh}}
    `;
    document.head.appendChild(style);
  }

  function render() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !isAdmin()) return;
    const list = panel.querySelector('#admin-artifact-list');
    if (!list) return;
    const ordered = [...ARTIFACT_CATALOG].sort((a, b) => {
      const pa = a.reviewStatus === 'pending' ? 0 : 1;
      const pb = b.reviewStatus === 'pending' ? 0 : 1;
      if (pa !== pb) return pa - pb;
      if (pa === 0) return (Number(b.generatedAtMs) || 0) - (Number(a.generatedAtMs) || 0);
      return 0;
    });
    list.innerHTML = ordered.map((item) => {
      const color = artifactRealmColor(item.realm);
      const pending = item.reviewStatus === 'pending';
      const aiMeta = item.generatedByAI
        ? `<div class="aam-ai-meta">AI 生成${item.aiProvider ? ` · ${escapeHtml(item.aiProvider)}` : ''}${item.generationMaterials?.length ? ` · 素材：${item.generationMaterials.map((row) => `${escapeHtml(row.name || row.id)}×${Number(row.quantity) || 1}`).join('、')}` : ''}</div>`
        : '';
      return `<article class="aam-item ${pending ? 'is-pending' : ''}" data-admin-pending="${pending ? '1' : '0'}" style="--artifact-realm-color:${escapeHtml(color)};border-color:color-mix(in srgb,${escapeHtml(color)} 28%,rgba(255,255,255,.07))"><div class="aam-icon" style="border-color:color-mix(in srgb,${escapeHtml(color)} 55%,transparent);color:${escapeHtml(color)};background:color-mix(in srgb,${escapeHtml(color)} 10%,#171005)">${escapeHtml(item.icon || '◆')}</div><div class="aam-copy"><strong style="color:${escapeHtml(color)}">${escapeHtml(item.name)}</strong>${pending ? '<span class="aam-pending"><i class="fa-solid fa-wand-magic-sparkles"></i> AI・待處理</span>' : ''}<div class="aam-meta">${escapeHtml(item.id)} · ${escapeHtml(item.realm)} · ${escapeHtml(item.category || '法寶')} · 打造 ${Number(item.craft?.gold) || 0} 金幣 · 配方：${escapeHtml(recipeSummaryText(item.id))} · 擁有人：${escapeHtml(item.recipeOwnerName || '公共配方')}（${escapeHtml(item.recipeOwnerUid || '無 UID')}）${item.recipeSaleLocked ? ' · 付費配方' : ''}</div>${aiMeta}<div class="aam-effects">${(item.effects || []).map((effect) => `<span>${escapeHtml(effectLabel(effect))}</span>`).join('')}</div></div><div class="aam-item-actions">${pending ? `<button type="button" class="aam-approve" data-admin-artifact-approve="${escapeHtml(item.id)}"><i class="fa-solid fa-check"></i> 確認已檢查</button>` : ''}<button type="button" class="aam-edit" data-admin-artifact-edit="${escapeHtml(item.id)}"><i class="fa-solid fa-pen"></i> 編輯</button></div></article>`;
    }).join('') || '<div class="text-gray-500 text-xs">目前沒有法寶。</div>';
  }

  function effectRow(effect = {}) {
    const type = SUPPORTED_ARTIFACT_EFFECTS.includes(effect.type) ? effect.type : SUPPORTED_ARTIFACT_EFFECTS[0];
    const minutes = Math.max(1 / 60, (Number(effect.durationMs) || 60000) / 60000);
    const contexts = Array.isArray(effect.contexts) ? effect.contexts : ['quiz', 'battle', 'dongtian'];
    const row = document.createElement('div');
    row.className = 'aam-effect-row';
    row.innerHTML = `<div class="aam-effect-main"><label>效果類型<select data-aam-effect-type>${SUPPORTED_ARTIFACT_EFFECTS.map((value) => `<option value="${value}" ${value === type ? 'selected' : ''}>${escapeHtml(EFFECT_GUIDE[value]?.title || value)}</option>`).join('')}</select></label><label data-aam-value-field>數值<input data-aam-effect-value type="number" step="0.01" value="${Number(effect.value) || 0}"></label><label data-aam-multiplier-field>倍率<input data-aam-effect-multiplier type="number" min="0.01" step="0.05" value="${Number(effect.multiplier) || 1}"></label><label data-aam-duration-field>分鐘<input data-aam-effect-duration type="number" min="0.02" step="0.5" value="${minutes}"></label><button type="button" class="aam-remove-effect" aria-label="移除效果"><i class="fa-solid fa-trash"></i></button></div><div class="aam-contexts" data-aam-contexts><label><input type="checkbox" value="quiz" ${contexts.includes('quiz') ? 'checked' : ''}>問道</label><label><input type="checkbox" value="battle" ${contexts.includes('battle') ? 'checked' : ''}>鬥法</label><label><input type="checkbox" value="dongtian" ${contexts.includes('dongtian') ? 'checked' : ''}>洞天</label></div>`;
    const sync = () => {
      const current = row.querySelector('[data-aam-effect-type]').value;
      const needsValue = effectUsesValue(current);
      const timed = current.startsWith('timed_');
      const valueInput = row.querySelector('[data-aam-effect-value]');
      row.querySelector('[data-aam-value-field]').style.display = needsValue ? '' : 'none';
      if (valueInput) {
        valueInput.removeAttribute('max');
        valueInput.removeAttribute('min');
        if (current === 'equip_combo_chance') {
          valueInput.max = '0.10';
          valueInput.min = '0';
          if (Number(valueInput.value) > 0.10) valueInput.value = '0.10';
        } else if (current === 'equip_damage_cap_percent') {
          valueInput.min = '0.05';
          valueInput.max = '1';
        }
      }
      row.querySelector('[data-aam-multiplier-field]').style.display = timed ? '' : 'none';
      row.querySelector('[data-aam-duration-field]').style.display = timed ? '' : 'none';
      row.querySelector('[data-aam-contexts]').style.display = current === 'remove_wrong_option' ? 'flex' : 'none';
    };
    row.querySelector('[data-aam-effect-type]').addEventListener('change', sync);
    row.querySelector('.aam-remove-effect').onclick = () => row.remove();
    sync();
    return row;
  }

  function openEditor(item = null) {
    if (!isAdmin()) return;
    document.getElementById(MODAL_ID)?.remove();
    const editing = !!item;
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'aam-modal';
    modal.innerHTML = `<section class="aam-card" role="dialog" aria-modal="true"><h3>${editing ? '編輯法寶' : '新增法寶'}</h3><p class="aam-note">這裡直接維護全站正式法寶清單。建立後 ID 會鎖定，避免玩家既有背包與裝備失聯。右側「可用功能」可直接加入效果。</p><div class="aam-editor-layout"><div class="aam-editor-main"><div class="aam-grid"><div class="aam-field"><label>法寶 ID（英文小寫與 -）</label><input id="aam-id" maxlength="64" ${editing ? 'readonly' : ''} value="${escapeHtml(item?.id || '')}" placeholder="例如 thunder-seal"></div><div class="aam-field"><label>名稱</label><input id="aam-name" maxlength="80" value="${escapeHtml(item?.name || '')}"></div><div class="aam-field"><label>圖示（1–4 字）</label><input id="aam-icon" maxlength="4" value="${escapeHtml(item?.icon || '◆')}"></div><div class="aam-field"><label>境界</label><select id="aam-realm">${ARTIFACT_REALMS.map((realm) => `<option value="${realm.name}" ${realm.name === (item?.realm || '築基') ? 'selected' : ''}>${realm.name}</option>`).join('')}</select></div><div class="aam-field"><label>分類</label><select id="aam-category">${categoryOptions(item?.category)}</select></div><div class="aam-field"><label>裝備欄位（裝備效果才需要）</label><select id="aam-slot"><option value="">不使用裝備欄位</option>${ARTIFACT_EQUIP_SLOTS.map((slot) => `<option value="${escapeHtml(slot)}" ${slot === (item?.equipSlot || '') ? 'selected' : ''}>${escapeHtml(slot)}</option>`).join('')}</select></div><div class="aam-field"><label>打造金幣</label><input id="aam-gold" type="number" min="0" step="1" value="${Number(item?.craft?.gold) || 0}"></div><div class="aam-field"><label>每次打造數量</label><input id="aam-yield" type="number" min="1" step="1" value="${Math.max(1, Number(item?.craft?.yield) || 1)}"></div><div class="aam-field full"><label>說明</label><textarea id="aam-description" maxlength="500">${escapeHtml(item?.description || '')}</textarea></div></div><div class="aam-recipe-owner-editor aam-field full"><label><i class="fa-solid fa-crown"></i> 配方擁有人（管理員）</label><p class="aam-note">現任：${escapeHtml(item?.recipeOwnerName || '公共配方／無首發者')} · UID：${escapeHtml(item?.recipeOwnerUid || '無')}。更改後不轉移已購買者的製作指南；原擁有人的待售委託將失效。</p><label class="aam-owner-toggle"><input type="checkbox" id="aam-owner-change" ${editing ? '' : 'disabled'}> 我確認要更改此配方的擁有人</label><div class="aam-owner-fields"><label>新擁有人 UID（留空設為公共配方）<input id="aam-owner-uid" maxlength="128" value="${escapeHtml(item?.recipeOwnerUid || '')}" placeholder="玩家 Firebase UID"></label><label>新擁有人名稱<input id="aam-owner-name" maxlength="36" value="${escapeHtml(item?.recipeOwnerName || '')}" placeholder="修士名稱"></label></div></div>${editing && getArtifactRecipe(item.id).length ? `<div class="aam-recipe-listing aam-field full"><label><i class="fa-solid fa-store"></i> 管理員配方上架</label><p class="aam-note">由管理員作為賣家上架永久製作指南；不改變配方擁有權。請先儲存配方或擁有人變更，再上架。</p><div class="aam-admin-sale-row"><input type="number" id="aam-listing-price" min="1" max="1000000000" step="1" value="500" aria-label="配方售價（靈石）"><button type="button" class="aam-admin-list-recipe" data-aam-list-recipe="${escapeHtml(item.id)}"><i class="fa-solid fa-tags"></i> 上架配方</button></div></div>` : ''}<div class="aam-effects-editor"><div class="aam-effects-head"><span>法寶效果</span><button type="button" id="aam-add-effect" class="aam-add-effect"><i class="fa-solid fa-plus"></i> 新增效果</button></div><div id="aam-effect-list"></div></div>${recipeEditorMarkup(item)}<div id="aam-status" class="aam-note" style="margin-top:10px"></div></div><aside class="aam-guide"><h4><i class="fa-solid fa-list-check"></i> 可用功能</h4><p>依類別展開或縮小；功能區可獨立捲動，點選功能即可加入左側法寶效果。</p>${effectGuideMarkup()}<div class="aam-guide-note"><b>裝備類：</b>必須從四個正式裝備欄位中選擇。<br><b>連擊：</b>不論組合多少效果，總機率硬上限 10%。<br><b>鏡映：</b>每場固定複製敵方一項可複製戰鬥效果。<br><b>限時類：</b>催動時消耗 1 件法寶。<br><b>排除錯項：</b>可指定問道、鬥法、洞天。</div></aside></div><div class="aam-actions"><button type="button" class="aam-cancel">取消</button><button type="button" class="aam-save">${editing ? '儲存變更' : '建立法寶'}</button></div></section>`;
    document.body.appendChild(modal);
    const effectList = modal.querySelector('#aam-effect-list');
    (item?.effects?.length ? item.effects : [defaultEffect('equip_attack_flat')]).forEach((effect) => effectList.appendChild(effectRow(effect)));
    modal.querySelector('#aam-add-effect').onclick = () => effectList.appendChild(effectRow(defaultEffect('equip_attack_flat')));
    modal.querySelectorAll('[data-aam-add-effect-type]').forEach((button) => {
      button.onclick = () => {
        const type = button.dataset.aamAddEffectType;
        if (!SUPPORTED_ARTIFACT_EFFECTS.includes(type)) return;
        effectList.appendChild(effectRow(defaultEffect(type)));
        effectList.lastElementChild?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      };
    });
    bindRecipeEditor(modal);
    modal.querySelector('[data-aam-list-recipe]')?.addEventListener('click', () => {
      const price = Number(modal.querySelector('#aam-listing-price')?.value);
      void adminListRecipe(item?.id, price, modal);
    });
    modal.querySelector('.aam-cancel').onclick = () => modal.remove();
    modal.querySelector('.aam-save').onclick = () => saveFromModal(modal, editing ? item.id : '');
  }

  function readEffects(modal) {
    return [...modal.querySelectorAll('.aam-effect-row')].map((row) => {
      const type = row.querySelector('[data-aam-effect-type]').value;
      if (effectUsesValue(type)) {
        let value = Number(row.querySelector('[data-aam-effect-value]').value) || 0;
        if (type === 'equip_combo_chance') value = Math.min(0.10, Math.max(0, value));
        return { type, value };
      }
      if (type.startsWith('timed_')) {
        return { type, multiplier: Number(row.querySelector('[data-aam-effect-multiplier]').value) || 1, durationMs: Math.max(1000, Math.round((Number(row.querySelector('[data-aam-effect-duration]').value) || 0) * 60000)) };
      }
      if (type === 'remove_wrong_option') {
        const contexts = [...row.querySelectorAll('[data-aam-contexts] input:checked')].map((input) => input.value);
        return { type, contexts, perQuestion: 1 };
      }
      return { type };
    });
  }

  async function persistCatalog(items, recipes = null, ownerOverride = null) {
    const auth = getAuth(getApp());
    const user = auth.currentUser;
    if (!user || !isAdmin()) throw new Error('僅管理員可以修改法寶清單');
    const normalized = validateArtifactCatalog(items);
    const normalizedRecipes = recipes === null ? null : validateArtifactRecipes(recipes);
    const db = getFirestore(getApp());
    let committedCatalog = null;
    await runTransaction(db, async (tx) => {
      const userRef = doc(db, 'users', user.uid);
      const configRef = doc(db, CONFIG_COLLECTION, CONFIG_DOC);
      const transferRef = ownerOverride?.uid ? doc(db, 'users', ownerOverride.uid) : null;
      const [userSnap, configSnap, transferSnap] = await Promise.all([
        tx.get(userRef), tx.get(configRef), transferRef ? tx.get(transferRef) : Promise.resolve(null)
      ]);
      if (!userSnap.exists() || userSnap.data()?.isAdmin !== true) throw new Error('管理員權限驗證失敗');
      if (transferRef && !transferSnap?.exists()) throw new Error('新擁有人 UID 不存在，請先確認玩家帳號');
      // 以交易讀到的全站版本為準，管理員若使用舊畫面儲存，也不得擦除首發人。
      const persistedItems = Array.isArray(configSnap.data()?.items) ? configSnap.data().items : [];
      const owners = new Map(persistedItems.filter((item) => item?.id && item.recipeOwnerUid).map((item) => [item.id, item]));
      const lockedIds = new Set(persistedItems.filter((item) => item?.recipeSaleLocked === true).map((item) => item.id));
      committedCatalog = normalized.map((item) => {
        const owner = owners.get(item.id);
        const secured = lockedIds.has(item.id) ? { ...item, recipeSaleLocked:true } : item;
        if (!owner && ownerOverride?.id !== item.id) return secured;
        // Ordinary edits preserve the transaction's latest owner. Only the exact
        // artifact explicitly selected for an admin reassignment may change it.
        if (ownerOverride?.id === item.id) return normalizeArtifactDefinition({
          ...secured,
          recipeOwnerUid: ownerOverride.uid,
          recipeOwnerName: ownerOverride.name,
          recipeDiscoveredAtMs: ownerOverride.uid ? (owner?.recipeDiscoveredAtMs || Date.now()) : 0
        });
        return normalizeArtifactDefinition({
          ...secured,
          recipeOwnerUid: owner.recipeOwnerUid,
          recipeOwnerName: owner.recipeOwnerName,
          recipeDiscoveredAtMs: owner.recipeDiscoveredAtMs
        });
      });
      const audit = {
        updatedBy: user.uid,
        updatedByName: data()?.displayName || user.displayName || '管理員',
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now()
      };
      tx.set(configRef, { version: 1, items: committedCatalog, ...audit }, { merge: true });
      if (normalizedRecipes !== null) {
        const materialConfigRef = doc(db, CONFIG_COLLECTION, MATERIAL_CONFIG_DOC);
        tx.set(materialConfigRef, { version: 1, recipes: normalizedRecipes, ...audit }, { merge: true });
      }
    });
    replaceArtifactCatalog(committedCatalog, 'admin-save');
    if (normalizedRecipes !== null) replaceArtifactRecipes(normalizedRecipes, 'admin-save');
    return committedCatalog;
  }

  async function adminListRecipe(artifactId, price, modal) {
    if (busy) return;
    const activeUser = getAuth(getApp()).currentUser;
    if (!activeUser || !isAdmin()) return;
    const status = modal.querySelector('#aam-status');
    if (!Number.isSafeInteger(price) || price < 1 || price > 1_000_000_000) {
      if (status) status.textContent = '配方售價須為 1～1,000,000,000 靈石整數。';
      return;
    }
    busy = true;
    try {
      const db = getFirestore(getApp());
      const listingRef = doc(collection(db, 'marketListings'));
      let updatedCatalog = null;
      await runTransaction(db, async (tx) => {
        const userSnap = await tx.get(doc(db, 'users', activeUser.uid));
        const catalogSnap = await tx.get(doc(db, CONFIG_COLLECTION, CONFIG_DOC));
        const recipeSnap = await tx.get(doc(db, CONFIG_COLLECTION, MATERIAL_CONFIG_DOC));
        if (!userSnap.exists() || userSnap.data()?.isAdmin !== true) throw new Error('僅管理員可以上架配方');
        const official = catalogSnap.data()?.items?.find((row) => row.id === artifactId);
        if (!official || !Array.isArray(recipeSnap.data()?.recipes?.[artifactId]) ||
            !recipeSnap.data().recipes[artifactId].length) throw new Error('配方尚未儲存，請先儲存配方');
        updatedCatalog = catalogSnap.data().items.map((row) => row.id === artifactId
          ? normalizeArtifactDefinition({ ...row, recipeSaleLocked:true }) : row);
        tx.set(doc(db, CONFIG_COLLECTION, CONFIG_DOC),
          { items:updatedCatalog, updatedBy:activeUser.uid, updatedAt:serverTimestamp(),
            updatedAtMs:Date.now() }, { merge:true });
        tx.set(listingRef, {
          sellerUid:activeUser.uid,
          sellerName:String(userSnap.data().displayName || activeUser.displayName || '管理員').slice(0, 36),
          adminManaged:true, type:'recipe', itemId:artifactId,
          itemName:String(official.name || artifactId).slice(0,70),
          itemIcon:String(official.icon || '◆').slice(0,4),
          itemRealm:String(official.realm || '凡人').slice(0,20),
          quantity:1, price, status:'active', createdAtMs:Date.now(), buyerUid:'', completedAtMs:0
        });
      });
      if (updatedCatalog) replaceArtifactCatalog(updatedCatalog, 'admin-recipe-listing');
      if (status) status.textContent = '配方已由管理員上架，其他玩家可在交易市集購買。';
      toast('配方已上架至交易市集');
    } catch (error) {
      console.error('[Admin recipe listing]', error);
      if (status) status.textContent = error.message || '配方上架失敗';
      toast('配方上架失敗', false);
    } finally { busy = false; }
  }

  async function approveGeneratedArtifact(id) {
    if (busy) return;
    const current = ARTIFACT_CATALOG.find((item) => item.id === id);
    if (!current || current.reviewStatus !== 'pending') return;
    busy = true;
    try {
      const next = ARTIFACT_CATALOG.map((item) => item.id === id
        ? { ...JSON.parse(JSON.stringify(item)), reviewStatus: 'approved', reviewedAtMs: Date.now() }
        : JSON.parse(JSON.stringify(item)));
      await persistCatalog(next);
      render();
      toast(`已確認 ${current.name}`);
    } catch (error) {
      console.error('[Admin artifact approve]', error);
      toast(error.message || '確認失敗', false);
    } finally {
      busy = false;
    }
  }

  async function saveFromModal(modal, originalId) {
    if (busy) return;
    const status = modal.querySelector('#aam-status');
    const save = modal.querySelector('.aam-save');
    const id = String(modal.querySelector('#aam-id').value || '').trim().toLowerCase();
    const original = originalId ? ARTIFACT_CATALOG.find((entry) => entry.id === originalId) : null;
    const raw = {
      id,
      name: modal.querySelector('#aam-name').value,
      icon: modal.querySelector('#aam-icon').value,
      realm: modal.querySelector('#aam-realm').value,
      category: modal.querySelector('#aam-category').value,
      equipSlot: modal.querySelector('#aam-slot').value,
      description: modal.querySelector('#aam-description').value,
      craft: { gold: modal.querySelector('#aam-gold').value, yield: modal.querySelector('#aam-yield').value },
      effects: readEffects(modal),
      reviewStatus: original?.reviewStatus || 'approved',
      generatedByAI: original?.generatedByAI === true,
      generatedAtMs: original?.generatedAtMs || 0,
      reviewedAtMs: original?.reviewedAtMs || 0,
      // 普通編輯保留原主；僅勾選「更新擁有人」才可透過管理員交易改派。
      recipeSaleLocked: original?.recipeSaleLocked === true,
      recipeOwnerUid: original?.recipeOwnerUid || '',
      recipeOwnerName: original?.recipeOwnerName || '',
      recipeDiscoveredAtMs: original?.recipeDiscoveredAtMs || 0,
      generationSignature: original?.generationSignature || '',
      generationMaterials: original?.generationMaterials || [],
      aiProvider: original?.aiProvider || '',
      aiModel: original?.aiModel || ''
    };
    if (originalId && id !== originalId) { status.textContent = '既有法寶 ID 不可修改。'; return; }
    let item;
    try { item = normalizeArtifactDefinition(raw); } catch (error) { status.textContent = error.message; return; }
    const next = ARTIFACT_CATALOG.map((existing) => JSON.parse(JSON.stringify(existing)));
    const index = next.findIndex((existing) => existing.id === id);
    if (!originalId && index >= 0) { status.textContent = `法寶 ID「${id}」已存在。`; return; }
    if (originalId && index < 0) { status.textContent = '找不到要編輯的法寶，請重新整理。'; return; }
    if (index >= 0) next[index] = item; else next.push(item);
    try { validateArtifactCatalog(next); } catch (error) { status.textContent = error.message || '法寶資料不合法'; return; }

    const recipe = readRecipe(modal);
    const totalItems = recipeTotal(recipe);
    if (totalItems > 0 && totalItems < MIN_ARTIFACT_RECIPE_MATERIALS) {
      status.textContent = `已設定配方至少需要 ${MIN_ARTIFACT_RECIPE_MATERIALS} 個材料或法寶素材，目前只有 ${totalItems} 個。`;
      return;
    }
    if (totalItems > MAX_ARTIFACT_RECIPE_MATERIALS) {
      status.textContent = `配方共需 ${totalItems} 個素材，超過煉器陣 ${MAX_ARTIFACT_RECIPE_MATERIALS} 格上限。`;
      return;
    }
    const nextRecipes = JSON.parse(JSON.stringify(ARTIFACT_RECIPES));
    if (recipe.length) nextRecipes[id] = recipe;
    else delete nextRecipes[id];
    let normalizedRecipes;
    try {
      normalizedRecipes = validateArtifactRecipes(nextRecipes);
      const depth = artifactRecipeDepth(id, normalizedRecipes);
      if (depth > MAX_ARTIFACT_RECIPE_NESTING) throw new Error(`此配方二次煉製套娃深度為 ${depth}，最多只允許 ${MAX_ARTIFACT_RECIPE_NESTING} 層`);
    } catch (error) {
      status.textContent = error.message || '煉器配方不合法';
      return;
    }

    busy = true;
    save.disabled = true;
    save.textContent = '儲存中…';
    status.textContent = '正在驗證管理員權限並同步全站法寶與煉器配方設定…';
    try {
      const changeOwner = modal.querySelector('#aam-owner-change')?.checked === true;
      const nextUid = String(modal.querySelector('#aam-owner-uid')?.value || '').trim();
      const nextName = String(modal.querySelector('#aam-owner-name')?.value || '').trim();
      if (changeOwner && (!originalId || (nextUid && !nextName))) {
        status.textContent = nextUid ? '請填寫新擁有人名稱。' : '新法寶尚未登錄，不可轉移配方';
        return;
      }
      const ownerOverride = changeOwner ? { id, uid:nextUid, name:nextName } : null;
      await persistCatalog(next, normalizedRecipes, ownerOverride);
      modal.remove();
      render();
      toast(originalId ? `已更新 ${item.name}` : `已建立 ${item.name}`);
    } catch (error) {
      console.error('[Admin artifact save]', error);
      status.textContent = error.message || '法寶儲存失敗';
      toast('法寶儲存失敗', false);
    } finally {
      busy = false;
      save.disabled = false;
      save.textContent = originalId ? '儲存變更' : '建立法寶';
    }
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
      const heading = page.querySelector('h2');
      if (heading?.nextSibling) page.insertBefore(panel, heading.nextSibling);
      else page.prepend(panel);
    }

    panel.dataset.adminSectionTitle = '法寶管理';
    panel.dataset.adminSectionIcon = 'fa-hammer';

    if (panel.dataset.artifactManagerHydrated !== '1') {
      panel.dataset.artifactManagerHydrated = '1';
      panel.classList.remove('admin-preload-shell');
      panel.innerHTML = `<div class="aam-head"><div><h3><i class="fa-solid fa-hammer" style="color:#d8b15d"></i> 法寶管理</h3><p>查看並維護全站法寶。AI 新法寶會置頂標示「待處理」，但在確認前玩家已可正常使用；檢查後可編輯或按「確認已檢查」。</p></div><button type="button" class="aam-add" id="admin-artifact-add"><i class="fa-solid fa-plus"></i> 新增法寶</button></div><div id="admin-artifact-list" class="aam-list"></div>`;
      panel.querySelector('#admin-artifact-add').onclick = () => openEditor();
      panel.addEventListener('click', (event) => {
        const approve = event.target.closest('[data-admin-artifact-approve]');
        if (approve) {
          approveGeneratedArtifact(approve.dataset.adminArtifactApprove);
          return;
        }
        const button = event.target.closest('[data-admin-artifact-edit]');
        if (!button) return;
        const item = ARTIFACT_CATALOG.find((candidate) => candidate.id === button.dataset.adminArtifactEdit);
        if (item) openEditor(item);
      });
    }
    render();
  }

  function boot() {
    mount();
    window.addEventListener('xiuxian:user-ready', mount);
    window.addEventListener('artifact-catalog-updated', () => { mount(); render(); });
    new MutationObserver(() => { if (!document.getElementById(PANEL_ID)) mount(); }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();