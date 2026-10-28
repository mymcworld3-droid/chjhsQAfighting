// Versioned, permanent pool shared by browser and server. Never generated at draw time.
(function (root) {
  'use strict';
  const VERSION = 'soulbound-v5-attack200-hp800';
  const BALANCE_VERSION = 1, REFINEMENT_VERSION = 4, REFINEMENT_GROWTH = .15;
  const PITY = 20, WEAPON_RATE = .02, FRAGMENT_MIN = 20, FRAGMENT_MAX = 40;
  // One authority for generation, persistence and combat. Bounds are code-owned.
  const EFFECT_BOUNDS = Object.freeze(Object.fromEntries(Object.entries({
    equip_attack_flat:[1,200], equip_hp_flat:[1,800],
    equip_damage_reduction_flat:[1,800], equip_shield_flat:[1,6000],
    equip_true_damage_flat:[1,1500], equip_on_correct_shield_flat:[1,1800],
    equip_attack_percent:[.05,2], equip_hp_percent:[.05,2],
    equip_damage_percent:[.03,1.5], equip_streak_damage_percent:[.05,2],
    equip_damage_reduction_percent:[.02,.75], equip_crit_chance:[.02,.6],
    equip_crit_damage_percent:[.1,2.5], equip_combo_chance:[.02,.3],
    equip_combo_damage_percent:[.05,1.5], equip_lifesteal_percent:[.02,.5],
    equip_reflect_percent:[.05,1], equip_low_hp_damage_percent:[.05,2],
    equip_low_hp_reduction_percent:[.03,.75], equip_first_hit_reduction_percent:[.05,.85],
    equip_damage_cap_percent:[.1,.65]
  }).map(([type,[min,max]])=>[type,Object.freeze({min,max})])));
  const round = value => Number(value.toFixed(4));
  function normalizeValue(type, value) {
    const bounds = EFFECT_BOUNDS[type];
    if (!bounds) return value;
    const n = Number(value), finite = Number.isFinite(n) ? n : bounds.min;
    const clamped = Math.min(bounds.max, Math.max(bounds.min, finite));
    return type.endsWith('_flat') ? Math.round(clamped) : round(clamped);
  }
  function effectRange(type, order = 3, stage = 2, count = 3) {
    const minRealm = {equip_cheat_death:5,equip_copy_enemy_artifact:6,equip_damage_cap_percent:4}[type] || 1;
    if (order < minRealm || (stage < 3 && type === 'equip_copy_enemy_artifact') ||
        (stage < 2 && ['equip_cheat_death','equip_damage_cap_percent'].includes(type))) return null;
    if (['equip_cheat_death','equip_copy_enemy_artifact'].includes(type))
      return {type,field:'none',min:null,max:null,unit:'每場固定一次'};
    const bounds = EFFECT_BOUNDS[type];
    if (!bounds) return null;
    const realmFactor = .25 + .75 * Math.min(1,Math.max(0,(order - 3) / 7));
    const depthFactor = [0,.45,.75,1][Math.min(3,Math.max(1,Math.floor(stage)))] || .75;
    const ingredientFactor = 1 + (Math.min(8,Math.max(2,Math.floor(Number(count)||3))) - 3) * .05;
    const strength = Math.min(1,realmFactor * depthFactor * ingredientFactor);
    const inverse = type === 'equip_damage_cap_percent';
    const integer = type.endsWith('_flat');
    const low = inverse ? bounds.max - (bounds.max - bounds.min) * strength : bounds.max * strength * .55;
    const high = inverse ? bounds.max - (bounds.max - bounds.min) * strength * .55 : bounds.max * strength;
    const min = integer ? Math.max(bounds.min,Math.ceil(low - 1e-9)) : Math.max(bounds.min,round(low));
    const max = integer ? Math.max(min,Math.floor(high + 1e-9)) : Math.max(min,round(high));
    // The first refinement leaves room for the final 15% attack/HP upgrade.
    const reserveFinalGrowth = stage < 3 && ['equip_attack_flat','equip_hp_flat'].includes(type);
    const ceiling = reserveFinalGrowth ? Math.floor(bounds.max / (1 + REFINEMENT_GROWTH)) : bounds.max;
    return {type,field:'value',min:Math.min(min,ceiling),max:Math.min(ceiling,max),unit:integer?'點':'比例',
      note:inverse?'數值越小越強；系統固定上下限':'系統固定上下限'};
  }
  // Runtime migration is idempotent; ownership and item IDs do not change.
  function balanceArtifact(item) {
    if (!item || item.equipSlot !== '本命法寶') return item;
    const permanent = get(item.id);
    if (permanent) return permanent;
    const legacy = Number(item.soulboundBalanceVersion || 0) < BALANCE_VERSION && Number(item.soulboundRefinementVersion || 0) < 3;
    return {...item,soulboundBalanceVersion:BALANCE_VERSION,effects:(item.effects || []).map(effect=>{
      if (!Object.hasOwn(effect,'value') || !EFFECT_BOUNDS[effect.type]) return {...effect};
      const multiplier = effect.type.endsWith('_flat') || ['equip_attack_percent','equip_hp_percent'].includes(effect.type) ? 4 : 2;
      const value = legacy ? Number(effect.value) * (effect.type === 'equip_damage_cap_percent' ? .5 : multiplier) : effect.value;
      return {...effect,value:normalizeValue(effect.type,value)};
    })};
  }
  // A deliberate choice of archetype costs roughly twenty average fragment drops.
  const redemptionCost = rank => 600 + Math.max(0, rank) * 120;
  const REALMS = Object.freeze([
    ['golden-core', '金丹', 28], ['nascent-soul', '元嬰', 68], ['spirit', '化神', 188],
    ['void', '煉虛', 428], ['fusion', '合體', 788], ['mahayana', '渡劫', 1268],
    ['tribulation', '半仙', 1868], ['immortal', '真仙', 1868]
  ].map(([id, name, need]) => Object.freeze({ id, name, need })));
  const TYPES = Object.freeze([
    ['sword', '逐風飛劍', '飛劍', '劍', 'equip_combo_chance', .03, .007, '連擊率', '劍心', '#7dd3fc'],
    ['seal', '九霄雷印', '印', '印', 'equip_reflect_percent', .06, .012, '反射實際承受傷害', '雷霆', '#c4b5fd'],
    ['pearl', '太初靈珠', '寶珠', '珠', 'equip_lifesteal_percent', .04, .01, '命中後吸血', '太初', '#6ee7b7'],
    ['star', '七曜星盤', '陣盤', '星', 'equip_streak_damage_percent', .15, .025, '每連答三題的當次攻擊增傷', '星辰', '#a5b4fc'],
    ['mirror', '澄心法鏡', '法鏡', '鏡', 'equip_on_correct_shield_flat', 25, 8, '答對攻擊後獲得護盾', '凝心', '#93c5fd'],
    ['bell', '鎮岳古鐘', '鐘', '鐘', 'equip_damage_reduction_flat', 12, 5, '每次受傷固定減傷', '防守', '#fcd34d'],
    ['banner', '燎原靈幡', '幡', '幡', 'equip_low_hp_damage_percent', .12, .025, '生命不高於 30% 時增傷', '逆境', '#fb923c'],
    ['axe', '破障玄斧', '斧', '斧', 'equip_true_damage_flat', 15, 6, '命中追加真實傷害', '攻堅', '#fda4af']
  ].map(([id, name, form, icon, effect, base, step, label, synergy, color]) =>
    Object.freeze({ id, name, form, icon, effect, base, step, label, synergy, color })));
  const amount = (type, rank) => Number(((type.base + type.step * rank) * (type.effect.endsWith('_flat') ? 4 : 2)).toFixed(4));
  const valueText = (effect, value) => effect.endsWith('_percent') || effect.endsWith('_chance')
    ? `${Number((value * 100).toFixed(1))}%` : `${value} 點`;
  const ITEMS = Object.freeze(REALMS.flatMap((realm, rank) => TYPES.map(type => Object.freeze({
    id: `soul-${type.id}-${realm.id}`, name: type.name, realm: realm.name,
    icon: type.icon, weaponForm: type.form, category: '裝備法寶', equipSlot: '本命法寶',
    poolVersion: VERSION, soulboundBalanceVersion: BALANCE_VERSION, archetype: type.id, coreEffect: type.effect,
    description: `${type.label} ${valueText(type.effect, amount(type, rank))}。適合${type.synergy}配法，也可跨丹性搭配。不可交易；持有原器後可二次、三次精煉。`,
    imageUrl: `/assets/soulbound/${type.id}-ai.webp`, imageStatus: 'ready',
    imageModel: 'imagegen', imagePromptVersion: 'soulbound-art-v1',
    craft: Object.freeze({ gold: 0, yield: 1 }),
    // Defining effect first so legacy refinement paths also inherit it.
    effects: Object.freeze([
      Object.freeze({ type: type.effect, value: amount(type, rank) }),
      Object.freeze({ type: 'equip_attack_flat', value: 60 + rank * 12 }),
      Object.freeze({ type: 'equip_hp_flat', value: 240 + rank * 48 })
    ])
  }))));
  const get = id => ITEMS.find(item => item.id === id) || null;
  function rankFor(score, immortal = false) {
    if (Number(score) < 28) return -1;
    let rank = 0;
    for (let i = 0; i < REALMS.length - 1; i++) if (Number(score) >= REALMS[i].need) rank = i;
    return immortal && Number(score) >= 1868 ? 7 : rank;
  }
  const price = rank => 500 + Math.max(0, rank) * 100;
  const cost = (rank, draws, count) => price(rank) * count - (draws === 0 ? price(rank) - 250 : 0);
  function candidates(rank) {
    const realm = REALMS[rank]?.name;
    return ITEMS.filter(item => item.realm === realm);
  }
  function roll(rank, misses, random) {
    const pity = misses >= PITY - 1;
    if (!pity && random() >= WEAPON_RATE) {
      return {kind:'fragments',fragments:FRAGMENT_MIN+Math.floor(random()*(FRAGMENT_MAX-FRAGMENT_MIN+1)),pity:false};
    }
    const higher = rank < REALMS.length - 1 && random() < .2;
    // All eight archetypes share one permanent pool, including the guarantee.
    const list = candidates(higher ? rank + 1 : rank);
    const item = list[Math.min(list.length - 1, Math.floor(random() * list.length))];
    return { kind:'weapon',itemId: item.id, realm: item.realm, higher, pity };
  }
  // Ordinary caps remain for historical definitions; soulbound uses EFFECT_BOUNDS.
  const MAX_REFINEMENT_EFFECTS = 4;
  const PERCENT_EFFECT_CAPS = Object.freeze({
    equip_attack_percent:5, equip_hp_percent:5,
    equip_damage_percent:3, equip_streak_damage_percent:3,
    equip_damage_reduction_percent:.8, equip_crit_chance:.75,
    equip_crit_damage_percent:3, equip_combo_chance:.1, equip_combo_damage_percent:3,
    equip_lifesteal_percent:.5, equip_reflect_percent:1, equip_low_hp_damage_percent:2,
    equip_low_hp_reduction_percent:.8, equip_first_hit_reduction_percent:.9,
    equip_damage_cap_percent:1
  });
  function refinementCompatible(item, hasSoulbound, sources = []) {
    const compatible = hasSoulbound
      ? item?.equipSlot === '本命法寶' && item.soulboundRefinementVersion === REFINEMENT_VERSION
      : item?.equipSlot !== '本命法寶';
    if (!compatible || !hasSoulbound) return compatible;
    try { assertRefinementImproves(item, sources); return true; } catch (_) { return false; }
  }
  function refinementCap(type, ordinaryCap, soulbound = false) {
    return soulbound && EFFECT_BOUNDS[type] ? EFFECT_BOUNDS[type].max : ordinaryCap;
  }
  function refinementRange(range, soulbound = false) {
    if (!soulbound || !range || !EFFECT_BOUNDS[range.type]) return range;
    const bounds = EFFECT_BOUNDS[range.type];
    const min = Math.max(bounds.min,Math.min(bounds.max,range.min));
    return {...range,min,max:Math.max(min,Math.min(bounds.max,range.max))};
  }
  // Compare against the original catalog values, never their realm-clamped copies.
  // These floors override random generation ranges, while combat caps still apply.
  function refineEffects(proposed = [], sources = []) {
    const inherited = new Map();
    for (const item of sources.map(balanceArtifact).filter(item => item?.equipSlot === '本命法寶')) {
      const ordered = [...(item.effects || [])].sort((a,b) =>
        Number(b.type === item.coreEffect) - Number(a.type === item.coreEffect));
      for (const effect of ordered) {
        if (!String(effect.type).startsWith('equip_')) continue;
        const previous = inherited.get(effect.type);
        const inverse = effect.type === 'equip_damage_cap_percent';
        if (!previous || ('value' in effect && (inverse ? effect.value < previous.value : effect.value > previous.value))) {
          inherited.set(effect.type, { ...effect });
        }
      }
    }
    if (inherited.size > MAX_REFINEMENT_EFFECTS) throw new Error('本命法寶既有詞條超過四個，無法在保留全部屬性的條件下煉製。');
    const effects = [...inherited.values()].map(base => {
      const rolled = proposed.find(row => row.type === base.type);
      if (!('value' in base)) return { ...base };
      const value = Number(base.value);
      if (!Number.isFinite(value) || value < 0) throw new Error('本命法寶原屬性數值無效，無法煉製。');
      const inverse = base.type === 'equip_damage_cap_percent';
      const step = base.type.endsWith('_flat') ? 1 : .0001;
      const growth = Math.max(step, Math.abs(value) * REFINEMENT_GROWTH);
      const floor = base.type.endsWith('_flat') ? Math.ceil(value + growth) : round(value + (inverse ? -growth : growth));
      const limit = inverse ? EFFECT_BOUNDS.equip_damage_cap_percent.min
        : refinementCap(base.type, PERCENT_EFFECT_CAPS[base.type] ?? Infinity, true);
      if (inverse ? floor < limit || floor >= value : floor > limit || floor <= value) {
        throw new Error('本命法寶屬性已達上限，無法保證煉製後逐項提升，請更換素材。');
      }
      const candidate = Number(rolled?.value);
      const next = Number.isFinite(candidate) ? candidate : floor;
      return { ...base, value:inverse ? Math.max(limit, Math.min(floor, next)) : Math.min(limit, Math.max(floor, next)) };
    });
    for (const effect of proposed) {
      if (effects.length >= MAX_REFINEMENT_EFFECTS) break;
      if (String(effect.type).startsWith('equip_') && !effects.some(row => row.type === effect.type)) effects.push(Object.hasOwn(effect,'value') ? { ...effect,value:normalizeValue(effect.type,effect.value) } : { ...effect });
    }
    return effects;
  }
  function assertRefinementImproves(item, sources = []) {
    const effects = item?.effects || [];
    if (item?.equipSlot !== '本命法寶' || effects.length > MAX_REFINEMENT_EFFECTS || new Set(effects.map(row => row.type)).size !== effects.length) {
      throw new Error('本命法寶成品最多四個不重複詞條。');
    }
    for (const effect of effects) {
      const bounds = EFFECT_BOUNDS[effect.type];
      if (bounds && (!Number.isFinite(effect.value) || effect.value < bounds.min || effect.value > bounds.max ||
          (effect.type.endsWith('_flat') && !Number.isInteger(effect.value)))) throw new Error('本命法器屬性超出系統固定上下限。');
    }
    const required = refineEffects([], sources);
    for (const base of required) {
      const actual = effects.find(row => row.type === base.type);
      if (!actual || ('value' in base && (!Number.isFinite(actual.value) ||
        (base.type === 'equip_damage_cap_percent' ? actual.value > base.value : actual.value < base.value)))) {
        throw new Error('本命法寶成品必須保留並提升所有既有數值屬性。');
      }
    }
  }
  const api = Object.freeze({ VERSION, BALANCE_VERSION, EFFECT_BOUNDS, REFINEMENT_GROWTH, normalizeValue, effectRange, balanceArtifact, PITY, WEAPON_RATE, FRAGMENT_MIN, FRAGMENT_MAX, REALMS, TYPES, ITEMS, get, rankFor, price, cost, candidates, roll, valueText, REFINEMENT_VERSION, MAX_REFINEMENT_EFFECTS, PERCENT_EFFECT_CAPS, redemptionCost, refinementCap, refinementRange, refinementCompatible, refineEffects, assertRefinementImproves });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QASoulboundPool = api;
})(globalThis);
