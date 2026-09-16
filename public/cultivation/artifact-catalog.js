// 法寶清單：新增法寶時只需要在這個陣列增加一筆。
//
// 支援的通用 effect.type：
// - equip_attack_flat          裝備後固定增加攻擊
// - equip_attack_percent       裝備後按比例增加攻擊，例如 value: 0.2 = +20%
// - equip_hp_flat              裝備後固定增加生命上限
// - equip_hp_percent           裝備後按比例增加生命上限
// - timed_attack_multiplier    使用後一段時間攻擊倍率，例如 multiplier: 1.5
// - timed_cultivation_multiplier 使用後一段時間修為倍率，例如 multiplier: 2
// - remove_wrong_option        問道／鬥法／洞天時移除一個錯誤選項
//
// 一件法寶可以同時放多個 effects，因此不必為組合法寶另外改引擎。

export const ARTIFACT_REALMS = Object.freeze([
  { id: 'mortal', name: '凡人', order: 0, need: 0 },
  { id: 'qi', name: '煉氣', order: 1, need: 5 },
  { id: 'foundation', name: '築基', order: 2, need: 60 },
  { id: 'golden-core', name: '金丹', order: 3, need: 120 },
  { id: 'nascent-soul', name: '元嬰', order: 4, need: 500 },
  { id: 'spirit', name: '化神', order: 5, need: 800 },
  { id: 'void', name: '煉虛', order: 6, need: 1200 },
  { id: 'fusion', name: '合體', order: 7, need: 1800 },
  { id: 'mahayana', name: '大乘', order: 8, need: 2600 },
  { id: 'tribulation', name: '渡劫', order: 9, need: 3600 },
  { id: 'immortal', name: '真仙', order: 10, need: 5000 }
]);

export const ARTIFACT_CATALOG = Object.freeze([
  {
    id: 'seven-treasure-ruler',
    name: '七寶玲瓏尺',
    icon: '尺',
    realm: '築基',
    category: '消耗法寶',
    description: '問道、鬥法或洞天作答前，排除一個錯誤選項。每題最多使用一次此類效果。',
    craft: { gold: 80, yield: 1 },
    effects: [
      { type: 'remove_wrong_option', contexts: ['quiz', 'battle', 'dongtian'], perQuestion: 1 }
    ]
  },
  {
    id: 'war-drum',
    name: '破軍戰鼓',
    icon: '鼓',
    realm: '金丹',
    category: '消耗法寶',
    description: '催動後一段時間提高鬥法攻擊力。',
    craft: { gold: 150, yield: 1 },
    effects: [
      { type: 'timed_attack_multiplier', multiplier: 1.5, durationMs: 15 * 60 * 1000 }
    ]
  },
  {
    id: 'enlightenment-lamp',
    name: '悟道玄燈',
    icon: '燈',
    realm: '金丹',
    category: '消耗法寶',
    description: '點燃玄燈後，一段時間內所有正確作答所得修為翻倍。',
    craft: { gold: 180, yield: 1 },
    effects: [
      { type: 'timed_cultivation_multiplier', multiplier: 2, durationMs: 10 * 60 * 1000 }
    ]
  },
  {
    id: 'mountain-armor',
    name: '鎮嶽玄甲',
    icon: '甲',
    realm: '金丹',
    category: '裝備法寶',
    equipSlot: '護身法寶',
    description: '裝備後提升攻擊與生命。法寶境界不得低於修士目前大境界。',
    craft: { gold: 300, yield: 1 },
    effects: [
      { type: 'equip_attack_flat', value: 80 },
      { type: 'equip_hp_flat', value: 400 }
    ]
  },
  {
    id: 'void-sword',
    name: '太虛劍',
    icon: '劍',
    realm: '元嬰',
    category: '裝備法寶',
    equipSlot: '本命法寶',
    description: '以太虛劍意加持鬥法攻擊。',
    craft: { gold: 520, yield: 1 },
    effects: [
      { type: 'equip_attack_flat', value: 180 }
    ]
  },
  {
    id: 'longevity-jade',
    name: '長生玉佩',
    icon: '玉',
    realm: '元嬰',
    category: '裝備法寶',
    equipSlot: '佩飾法寶',
    description: '溫養氣血，裝備後提高生命上限。',
    craft: { gold: 480, yield: 1 },
    effects: [
      { type: 'equip_hp_flat', value: 900 }
    ]
  }
]);

export function getArtifactById(id) {
  return ARTIFACT_CATALOG.find((item) => item.id === id) || null;
}

export function realmOrderByName(name) {
  return ARTIFACT_REALMS.find((realm) => realm.name === name)?.order ?? 0;
}

export function realmForScore(score) {
  let current = ARTIFACT_REALMS[0];
  for (const realm of ARTIFACT_REALMS) {
    if (Number(score) >= realm.need) current = realm;
  }
  return current;
}

if (typeof window !== 'undefined') {
  window.XIUXIAN_ARTIFACT_CATALOG = ARTIFACT_CATALOG;
  window.XIUXIAN_ARTIFACT_REALMS = ARTIFACT_REALMS;
}
