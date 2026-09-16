// 修為與答題統計由主流程一次儲存，避免另一次讀寫扣回獎勵。
// 築基期以前答對固定 +1；金丹期起答對固定 +2、答錯 -1。所有額外修為與「金丹道心」效果只能由目前調御中的本命金丹觸發。
const GOLDEN_CORE_SCORE = 120;
const PRE_GOLDEN_CORE_GAIN = 1;
const GOLDEN_CORE_GAIN = 2;
const GOLDEN_CORE_MISS_PENALTY = 1;

export function applyCultivationReward(stats, isCorrect) {
  stats.totalScore = Math.max(0, Number(stats.totalScore) || 0);
  const scoreBeforeAnswer = stats.totalScore;
  const isGoldenCoreOrAbove = scoreBeforeAnswer >= GOLDEN_CORE_SCORE;

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
  const baseGain = isCorrect ? (isGoldenCoreOrAbove ? GOLDEN_CORE_GAIN : PRE_GOLDEN_CORE_GAIN) : 0;
  const gain = baseGain + bonusGain;
  const penalty = !isCorrect && isGoldenCoreOrAbove ? GOLDEN_CORE_MISS_PENALTY : 0;
  const goldenCoreMindReady = !!goldenCoreEffect.forceShield;

  if (isCorrect) {
    stats.totalScore += gain;
    if (goldenCoreMindReady) stats.goldenCoreShield = true;
  } else {
    if (penalty > 0) stats.totalScore = Math.max(0, stats.totalScore - penalty);

    if (goldenCoreMindReady) {
      // 部分金丹（例如無垢清心丹）可在答錯時直接凝聚金丹道心。
      stats.goldenCoreShield = true;
    } else {
      stats.goldenCoreShield = !!goldenCoreEffect.preserveShield && !!stats.goldenCoreShield;
    }
  }

  return {
    gain,
    baseGain,
    bonusGain,
    penalty,
    isGoldenCoreOrAbove,
    goldenCoreMindReady,
    preservedGoldenCoreMind: !isCorrect && !goldenCoreMindReady && !!goldenCoreEffect.preserveShield && !!stats.goldenCoreShield,
    goldenCoreMessage: goldenCoreEffect.message || ''
  };
}

function showGoldenCoreTrigger(reward) {
  const message = reward?.goldenCoreMessage || (reward?.goldenCoreMindReady ? '金丹道心護體成形' : '');
  if (!message || typeof window.showGoldenCoreActivation !== 'function') return;
  const core = window.getEquippedGoldenCoreState?.() || {};
  window.showGoldenCoreActivation({
    type: core.type,
    name: core.name || '金丹',
    message,
    kind: reward?.bonusGain > 0 ? `修為額外 +${reward.bonusGain}` : '金丹道心效果'
  });
}

export function showCultivationFeedback(reward, isCorrect) {
  showGoldenCoreTrigger(reward);

  if (isCorrect) {
    const extras = [];
    if (reward.goldenCoreMindReady) extras.push('金丹道心凝聚');
    if (reward.goldenCoreMessage) extras.push(reward.goldenCoreMessage);
    showToast(`悟道成功！修為 +${reward.gain}${extras.length ? `，${extras.join('；')}` : ''}`);
    return;
  }

  const lossText = reward.penalty > 0 ? `修為 -${reward.penalty}` : '修為不減';

  if (reward.goldenCoreMindReady) {
    showToast(`本次失誤，${lossText}；${reward.goldenCoreMessage || '金丹道心護體成形'}`);
    return;
  }

  if (reward.preservedGoldenCoreMind) {
    showToast(`本次失誤，${lossText}；${reward.goldenCoreMessage || '金丹道心未散'}`);
    return;
  }

  showToast(`失誤，${lossText}。${reward.goldenCoreMessage ? ` ${reward.goldenCoreMessage}` : ''}`);
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
