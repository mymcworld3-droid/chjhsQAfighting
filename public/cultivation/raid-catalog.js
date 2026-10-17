// 秘境試煉目錄：入口只負責選擇試煉；實際房間／戰鬥仍由各團本後端權威結算。
// 之後新增團本時，先在此加入卡片資料，再接對應 room/boss/reward adapter。
import { RAID_MVP } from './raid-engine.js';

export const RAID_TRIALS = Object.freeze([
  Object.freeze({
    id: 'shen-qingshuang',
    status: 'open',
    title: '清霜試煉',
    bossTitle: '大師姐・沈清霜',
    location: '青雲山・演武秘境',
    minimumScore: RAID_MVP.minimumScore,
    minimumRealm: RAID_MVP.minimumRealm,
    party: '1–4 人',
    recommended: '建議 3 人',
    bossImage: 'assets/story/characters/shen-qingshuang.png',
    description: '組隊挑戰霜華劍陣，收集煉器素材。',
    rewards: ['玄鐵／靈木', '精煉玄鐵／百年靈木', '紫金玄鐵／雷擊木', '淬靈玄印', '玄天道印'],
    mechanic: '2 人破陣減傷・3 人觸發合擊'
  }),
  Object.freeze({
    id: 'sealed-trial-02',
    status: 'sealed',
    title: '第二秘境',
    bossTitle: '封印尚未解開',
    location: '問道宗・秘境深處',
    minimumScore: 68,
    party: '多人試煉',
    recommended: '開發中',
    bossImage: '',
    description: '新秘境籌備中，敬請期待。',
    rewards: ['未公開專屬素材'],
    mechanic: '封印中'
  }),
  Object.freeze({
    id: 'sealed-trial-03',
    status: 'sealed',
    title: '第三秘境',
    bossTitle: '更深層試煉',
    location: '問道宗・未知',
    minimumScore: 188,
    party: '多人試煉',
    recommended: '開發中',
    bossImage: '',
    description: '新秘境籌備中，敬請期待。',
    rewards: ['秘境玄髓', '清霜劍魄'],
    mechanic: '封印中'
  })
]);

export function raidTrialById(id) {
  return RAID_TRIALS.find((trial) => trial.id === id) || RAID_TRIALS[0];
}
