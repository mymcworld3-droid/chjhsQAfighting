import { getMaterialById } from './material-catalog.js';
function escape(value) {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
export function renderRaidLoot(payload) {
  const items = Object.entries(payload?.rewards || {}).filter(([,qty]) => Number(qty) > 0);
  return '<b>' + (payload.awarded ? '戰利品已入帳' : '本場戰利品已領取') + '</b>' +
    '<div class="raid-loot-grid">' + items.map(([id,qty]) => {
      const item = getMaterialById(id);
      const keyLabels = {
        'raid-refine-key-ii':'第二煉印記・團本限定',
        'raid-refine-key-iii':'第三煉印記・團本限定'
      };
      const key = keyLabels[id] || '';
      const image = String(item?.imageUrl || '');
      const safeImage = /^https?:\/\//i.test(image) || /^(?:assets\/|\/assets\/)/.test(image);
      const icon = safeImage ? '<img src="' + escape(image) + '" alt="" loading="lazy">'
        : '<span aria-hidden="true">' + escape(item?.icon || '材') + '</span>';
      return '<div class="raid-loot-item"><div class="raid-loot-icon">' + icon + '</div><div><strong>' +
        escape(item?.name || id) + ' ×' + Math.floor(Number(qty)) + '</strong><small>' +
        (key ? key : '團本素材') + '</small></div></div>';
    }).join('') + '</div>' +
    (payload.dailyFirstVictory ? '<small class="raid-loot-bonus">每日首勝：淬靈玄印、玄天道印各額外 ×1</small>' : '') +
    (payload.firstVictory ? '<div class="raid-memento"><b>首次通關・' + escape(payload.memento?.name || '清霜劍印') +
      '</b><small>永久紀念已收入本帳號的團本紀錄</small></div>' : '');
}
export function renderRaidLearning(member, outcome) {
  const learning = Math.max(0, Math.floor(Number(member?.learningCorrect) || 0));
  const spirit = Math.max(0, Math.floor(Number(member?.spiritCorrect) || 0));
  const pending = learning > (Number(outcome?.settledLearningCorrect) || 0) || spirit > (Number(outcome?.settledCorrect) || 0);
  return '<b>本場答題收益・勝敗皆保留</b><div class="raid-learning-grid">' +
    [['修為',learning],['靈石',learning * 20],['神識',spirit]].map(([label,qty]) =>
      '<div><small>' + label + '</small><strong>+' + qty + '</strong></div>').join('') + '</div><small>' +
    (pending ? '部分收益待入帳，請保持此頁開啟；系統會自動重試。' : '答題收益已入帳。') + '</small>';
}
