// 修為與答題統計由主流程一次儲存，避免另一次讀寫扣回獎勵。
// 一般答題只提供固定基礎修為；所有額外修為與「金丹道心」效果只能由已裝配金丹觸發。
const CULTIVATION_GAIN = 1;

export function applyCultivationReward(stats, isCorrect) {
  stats.totalScore = Math.max(0, Number(stats.totalScore) || 0);

  // 舊版通用「道心護體」已停用。每次結算都移除舊欄位，避免舊帳號殘留狀態生效。
  if (Object.prototype.hasOwnProperty.call(stats, 'cultivationShield')) {
    delete stats.cultivationShield;
  }

  let goldenCoreEffect = { bonusGain: 0, forceShield: false, preserveShield: false, message: '' };
  if (typeof window.resolveGoldenCoreCultivationReward === 'function') {
    try {
      goldenCoreEffect = {
        ...goldenCoreEffect,
        ...(window.resolveGoldenCoreCultivationReward({ stats, isCorrect }) || {})
      };
    } catch (error) {
      console.warn('Golden Core reward effect skipped:', error);
    }
  }

  // 額外修為只能來自金丹；一般連勝本身不再提供任何修為加成。
  const bonusGain = isCorrect ? Math.max(0, Number(goldenCoreEffect.bonusGain) || 0) : 0;
  const gain = isCorrect ? CULTIVATION_GAIN + bonusGain : 0;
  const goldenCoreMindReady = isCorrect && !!goldenCoreEffect.forceShield;

  if (isCorrect) {
    stats.totalScore += gain;
    if (goldenCoreMindReady) stats.goldenCoreShield = true;
  } else {
    stats.goldenCoreShield = !!goldenCoreEffect.preserveShield && !!stats.goldenCoreShield;
  }

  return {
    gain,
    bonusGain,
    goldenCoreMindReady,
    preservedGoldenCoreMind: !isCorrect && !!goldenCoreEffect.preserveShield && !!stats.goldenCoreShield,
    goldenCoreMessage: goldenCoreEffect.message || ''
  };
}

export function showCultivationFeedback(reward, isCorrect) {
  if (isCorrect) {
    const extras = [];
    if (reward.goldenCoreMindReady) extras.push('金丹道心凝聚');
    if (reward.goldenCoreMessage) extras.push(reward.goldenCoreMessage);
    showToast(`悟道成功！修為 +${reward.gain}${extras.length ? `，${extras.join('；')}` : ''}`);
    return;
  }

  if (reward.preservedGoldenCoreMind) {
    showToast(`本次失誤，修為不減；${reward.goldenCoreMessage || '金丹道心未散'}`);
    return;
  }

  showToast(`失誤，修為不減。${reward.goldenCoreMessage ? ` ${reward.goldenCoreMessage}` : ''}`);
}

function showToast(message) {
  const old = document.getElementById('cultivation-rule-toast');
  if (old) old.remove();

  const el = document.createElement('div');
  el.id = 'cultivation-rule-toast';
  el.textContent = message;
  el.style.cssText = 'position:fixed;left:50%;bottom:145px;transform:translateX(-50%);z-index:1000;padding:10px 16px;border-radius:999px;background:rgba(10,10,10,.96);border:1px solid rgba(216,177,93,.4);color:#f6e6b0;font-size:12px;font-weight:800;box-shadow:0 8px 30px rgba(0,0,0,.35);pointer-events:none';

  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
