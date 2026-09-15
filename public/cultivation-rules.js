// 修為與答題統計由主流程一次儲存，避免另一次讀寫扣回獎勵。
const CULTIVATION_GAIN = 1;
const BONUS_AFTER_STREAK = 3;

// 在主流程更新連對數之前套用；沿用連對三題後再答對可獲得護體的規則。
// 金丹期之後，若修煉模組已解鎖，會在這裡一併結算目前本命金丹的被動效果。
export function applyCultivationReward(stats, isCorrect) {
  const previousStreak = Number(stats.currentStreak) || 0;
  stats.totalScore = Math.max(0, Number(stats.totalScore) || 0);

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

  const bonusGain = isCorrect ? Math.max(0, Number(goldenCoreEffect.bonusGain) || 0) : 0;
  const gain = isCorrect ? CULTIVATION_GAIN + bonusGain : 0;
  const shieldReady = isCorrect && (
    previousStreak >= BONUS_AFTER_STREAK ||
    !!goldenCoreEffect.forceShield
  );

  if (isCorrect) stats.totalScore += gain;

  if (isCorrect) {
    stats.cultivationShield = shieldReady || !!stats.cultivationShield;
  } else {
    stats.cultivationShield = !!goldenCoreEffect.preserveShield && !!stats.cultivationShield;
  }

  return {
    gain,
    bonusGain,
    shieldReady,
    preservedShield: !isCorrect && !!goldenCoreEffect.preserveShield,
    goldenCoreMessage: goldenCoreEffect.message || ''
  };
}

export function showCultivationFeedback(reward, isCorrect) {
  if (isCorrect) {
    const extras = [];
    if (reward.shieldReady) extras.push('道心護體準備就緒');
    if (reward.goldenCoreMessage) extras.push(reward.goldenCoreMessage);
    showToast(`悟道成功！修為 +${reward.gain}${extras.length ? `，${extras.join('；')}` : ''}`);
    return;
  }

  if (reward.preservedShield) {
    showToast(`本次失誤，修為不減；${reward.goldenCoreMessage || '金丹護住道心'}`);
    return;
  }

  showToast(`失誤，道心中斷；修為不減。${reward.goldenCoreMessage ? ` ${reward.goldenCoreMessage}` : ''}`);
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
