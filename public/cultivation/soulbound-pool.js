// Versioned, permanent pool shared by browser and server. Never generated at draw time.
(function (root) {
  'use strict';
  const VERSION = 'soulbound-v3-fragments20';
  const PITY = 20, WEAPON_RATE = .02, FRAGMENT_MIN = 20, FRAGMENT_MAX = 40;
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
  const amount = (type, rank) => Number((type.base + type.step * rank).toFixed(4));
  const valueText = (effect, value) => effect.endsWith('_percent') || effect.endsWith('_chance')
    ? `${Number((value * 100).toFixed(1))}%` : `${value} 點`;
  const ITEMS = Object.freeze(REALMS.flatMap((realm, rank) => TYPES.map(type => Object.freeze({
    id: `soul-${type.id}-${realm.id}`, name: type.name, realm: realm.name,
    icon: type.icon, weaponForm: type.form, category: '裝備法寶', equipSlot: '本命法寶',
    poolVersion: VERSION, archetype: type.id, coreEffect: type.effect,
    description: `${type.label} ${valueText(type.effect, amount(type, rank))}。適合${type.synergy}配法，也可跨丹性搭配。不可交易；持有原器後可二次、三次精煉。`,
    imageUrl: `/assets/soulbound/${type.id}-ai.webp`, imageStatus: 'ready',
    imageModel: 'imagegen', imagePromptVersion: 'soulbound-art-v1',
    craft: Object.freeze({ gold: 0, yield: 1 }),
    // Defining effect first so legacy refinement paths also inherit it.
    effects: Object.freeze([
      Object.freeze({ type: type.effect, value: amount(type, rank) }),
      Object.freeze({ type: 'equip_attack_flat', value: 25 + rank * 15 }),
      Object.freeze({ type: 'equip_hp_flat', value: 80 + rank * 45 })
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
  const api = Object.freeze({ VERSION, PITY, WEAPON_RATE, FRAGMENT_MIN, FRAGMENT_MAX, REALMS, TYPES, ITEMS, get, rankFor, price, cost, candidates, roll, valueText });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QASoulboundPool = api;
})(globalThis);
