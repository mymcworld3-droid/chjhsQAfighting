// 修為與答題統計由主流程一次儲存，避免另一次讀寫扣回獎勵。
// 築基期以前答對固定 +1；金丹期起答對固定 +2、答錯 -1。金丹道心護體可抵銷一次修為下降。
const GOLDEN_CORE_SCORE = 28;
const PRE_GOLDEN_CORE_GAIN = 1;
const GOLDEN_CORE_GAIN = 2;
const GOLDEN_CORE_MISS_PENALTY = 1;

export function applyCultivationReward(stats, isCorrect) {
  stats.totalScore = Math.max(0, Number(stats.totalScore) || 0);
  const scoreBeforeAnswer = stats.totalScore;
  const isGoldenCoreOrAbove = scoreBeforeAnswer >= GOLDEN_CORE_SCORE;
  const hadGoldenCoreShield = !!stats.goldenCoreShield;

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

  // 額外修為可來自金丹；一般連勝本身不再提供任何修為加成。
  const bonusGain = isCorrect ? Math.max(0, Number(goldenCoreEffect.bonusGain) || 0) : 0;
  const baseGain = isCorrect ? (isGoldenCoreOrAbove ? GOLDEN_CORE_GAIN : PRE_GOLDEN_CORE_GAIN) : 0;
  const preArtifactGain = baseGain + bonusGain;

  // 法寶倍率作用在「本次實際可獲得的全部修為」上，因此也會包含金丹額外修為。
  let artifactEffect = { gain: preArtifactGain, bonusGain: 0, multiplier: 1, message: '' };
  if (isCorrect && typeof window.applyArtifactCultivationGain === 'function') {
    try {
      artifactEffect = {
        ...artifactEffect,
        ...(window.applyArtifactCultivationGain(preArtifactGain) || {})
      };
    } catch (error) {
      console.warn('Artifact cultivation reward effect skipped:', error);
    }
  }
  const gain = isCorrect ? Math.max(0, Number(artifactEffect.gain) || preArtifactGain) : 0;
  const artifactBonusGain = isCorrect ? Math.max(0, gain - preArtifactGain) : 0;
  const goldenCoreMindReady = !!goldenCoreEffect.forceShield;

  // 已有金丹道心，或本次答錯當下由金丹凝聚出的道心，都能擋下這一次 -1。
  const shieldBlockedPenalty = !isCorrect && isGoldenCoreOrAbove && (hadGoldenCoreShield || goldenCoreMindReady);
  const penalty = !isCorrect && isGoldenCoreOrAbove && !shieldBlockedPenalty ? GOLDEN_CORE_MISS_PENALTY : 0;

  if (isCorrect) {
    stats.totalScore += gain;
    if (goldenCoreMindReady) stats.goldenCoreShield = true;
  } else if (shieldBlockedPenalty) {
    // 道心護體是一次性防護：抵銷本次修為下降後消耗，之後需再次凝聚。
    stats.goldenCoreShield = false;
  } else {
    if (penalty > 0) stats.totalScore = Math.max(0, stats.totalScore - penalty);

    if (goldenCoreMindReady) {
      stats.goldenCoreShield = true;
    } else {
      stats.goldenCoreShield = !!goldenCoreEffect.preserveShield && !!stats.goldenCoreShield;
    }
  }

  return {
    gain,
    baseGain,
    bonusGain,
    artifactBonusGain,
    artifactMultiplier: Number(artifactEffect.multiplier) || 1,
    artifactMessage: artifactEffect.message || '',
    penalty,
    isGoldenCoreOrAbove,
    goldenCoreMindReady,
    hadGoldenCoreShield,
    shieldBlockedPenalty,
    goldenCoreShieldConsumed: shieldBlockedPenalty,
    preservedGoldenCoreMind: !isCorrect && !shieldBlockedPenalty && !goldenCoreMindReady && !!goldenCoreEffect.preserveShield && !!stats.goldenCoreShield,
    goldenCoreMessage: goldenCoreEffect.message || ''
  };
}

function showGoldenCoreTrigger(reward) {
  const message = reward?.goldenCoreMessage ||
    (reward?.shieldBlockedPenalty ? '金丹道心護體發動，抵銷本次修為下降' : '') ||
    (reward?.goldenCoreMindReady ? '金丹道心護體成形' : '');
  if (!message || typeof window.showGoldenCoreActivation !== 'function') return;
  const core = window.getEquippedGoldenCoreState?.() || {};
  window.showGoldenCoreActivation({
    type: core.type,
    name: core.name || '金丹',
    message,
    kind: reward?.shieldBlockedPenalty
      ? '道心護體・修為不減'
      : (reward?.bonusGain > 0 ? `修為額外 +${reward.bonusGain}` : '金丹道心效果')
  });
}

export function showCultivationFeedback(reward, isCorrect) {
  showGoldenCoreTrigger(reward);

  if (isCorrect) {
    const extras = [];
    if (reward.goldenCoreMindReady) extras.push('金丹道心凝聚');
    if (reward.goldenCoreMessage) extras.push(reward.goldenCoreMessage);
    if (reward.artifactMessage) extras.push(reward.artifactMessage);
    showToast(`悟道成功！修為 +${reward.gain}${extras.length ? `，${extras.join('；')}` : ''}`);
    return;
  }

  if (reward.shieldBlockedPenalty) {
    const detail = reward.goldenCoreMessage ? `；${reward.goldenCoreMessage}` : '';
    showToast(`本次失誤，金丹道心護體抵銷修為下降，修為不減${detail}`);
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
