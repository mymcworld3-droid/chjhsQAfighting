// 修為與答題統計由主流程一次儲存，避免另一次讀寫扣回獎勵。
const CULTIVATION_GAIN = 1;
const BONUS_AFTER_STREAK = 3;

// 在主流程更新連對數之前套用；沿用連對三題後再答對可獲得護體的規則。
export function applyCultivationReward(stats, isCorrect) {
  const previousStreak = Number(stats.currentStreak) || 0;
  stats.totalScore = Math.max(0, Number(stats.totalScore) || 0);
  const shieldReady = isCorrect && previousStreak >= BONUS_AFTER_STREAK;
  if (isCorrect) stats.totalScore += CULTIVATION_GAIN;
  stats.cultivationShield = isCorrect
    ? (shieldReady || !!stats.cultivationShield)
    : false;
  return { gain: isCorrect ? CULTIVATION_GAIN : 0, shieldReady };
}

export function showCultivationFeedback(reward, isCorrect) {
  showToast(isCorrect
    ? `悟道成功！修為 +${reward.gain}${reward.shieldReady ? '，道心護體準備就緒' : ''}`
    : '失誤，道心中斷；修為不減。');
}

function showToast(message) {
  const old = document.getElementById('cultivation-rule-toast');
  if (old) old.remove();

  const el = document.createElement('div');
  el.id = 'cultivation-rule-toast';
  el.textContent = message;
  el.style.cssText = 'position:fixed;left:50%;bottom:145px;transform:translateX(-50%);z-index:1000;padding:10px 16px;border-radius:999px;background:rgba(12,15,29,.96);border:1px solid rgba(233,196,106,.4);color:#f6e6b0;font-size:12px;font-weight:800;box-shadow:0 8px 30px rgba(0,0,0,.35);pointer-events:none';

  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}
