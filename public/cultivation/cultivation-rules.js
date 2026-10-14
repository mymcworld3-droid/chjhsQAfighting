// 修為與答題統計由主流程一次儲存，避免另一次讀寫扣回獎勵。
// 築基期以前答對 +1；金丹期起答對 +2。一般問道答錯不扣修為，只中斷連答。
const GOLDEN_CORE_SCORE = 28;
const PRE_GOLDEN_CORE_GAIN = 1;
const GOLDEN_CORE_GAIN = 2;

export function applyCultivationReward(stats, isCorrect, { soulBonusGain: suppliedSoulBonusGain, learningBonusGain = 0, isRecovery = false } = {}) {
  stats.totalScore = Math.max(0, Number(stats.totalScore) || 0);
  const scoreBeforeAnswer = stats.totalScore;
  const isGoldenCoreOrAbove = scoreBeforeAnswer >= GOLDEN_CORE_SCORE;
  // 停用金丹時不使用、也不消耗已凝聚的道心；重新啟用後仍可正常使用。
  const goldenCoreEnabled = typeof window.isGoldenCoreEnabled === 'function'
    ? window.isGoldenCoreEnabled() : true;
  const hadGoldenCoreShield = goldenCoreEnabled && !!stats.goldenCoreShield;

  // 舊版通用「道心護體」已停用。每次結算都移除舊欄位，避免舊帳號殘留狀態生效。
  if (Object.prototype.hasOwnProperty.call(stats, 'cultivationShield')) {
    delete stats.cultivationShield;
  }

  let goldenCoreEffect = { bonusGain: 0, forceShield: false, preserveShield: false, message: '' };
  if (goldenCoreEnabled && typeof window.resolveGoldenCoreCultivationReward === 'function') {
    try {
      goldenCoreEffect = {
        ...goldenCoreEffect,
        ...(window.resolveGoldenCoreCultivationReward({ stats, isCorrect, isRecovery }) || {})
      };
    } catch (error) {
      console.warn('Golden Core reward effect skipped:', error);
    }
  }

  // 額外修為可來自金丹；一般連勝本身不再提供任何修為加成。
  const bonusGain = isCorrect ? Math.max(0, Number(goldenCoreEffect.bonusGain) || 0) : 0;
  const baseGain = isCorrect ? (isGoldenCoreOrAbove ? GOLDEN_CORE_GAIN : PRE_GOLDEN_CORE_GAIN) : 0;
  // 左脈「悟道」以主流程的玩家存檔為準，不依賴技能樹介面的載入或快取。
  // 未提供存檔加成的舊呼叫仍可使用介面 getter；存檔 helper 已驗證金丹啟用狀態。
  const hasSavedSoulBonus = suppliedSoulBonusGain !== undefined;
  const soulBonusGain = isCorrect && (hasSavedSoulBonus || goldenCoreEnabled) && scoreBeforeAnswer >= 68
    ? Math.max(0, Math.min(10, Math.floor(Number(hasSavedSoulBonus
      ? suppliedSoulBonusGain : window.getNascentSoulCultivationBonuses?.()?.solo) || 0)))
    : 0;
  const preArtifactGain = baseGain + bonusGain + soulBonusGain;

  // 法寶倍率作用在「本次實際可獲得的全部修為」上，因此也會包含金丹與元嬰額外修為。
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
  const learningGain = isCorrect ? Math.max(0, Number(learningBonusGain) || 0) : 0;
  const recoveryBonusGain = isCorrect && isRecovery ? Math.max(0, Number(goldenCoreEffect.recoveryBonusGain) || 0) : 0;
  const gain = isCorrect ? Math.max(0, Number(artifactEffect.gain) || preArtifactGain) + learningGain + recoveryBonusGain : 0;
  const artifactBonusGain = isCorrect ? Math.max(0, gain - preArtifactGain - learningGain - recoveryBonusGain) : 0;
  const goldenCoreMindReady = !!goldenCoreEffect.forceShield;

  const shieldBlockedPenalty = false, penalty = 0;
  const streakPreserved = !isCorrect && !!goldenCoreEffect.preserveStreak && Number(stats.currentStreak) > 0;
  if (isCorrect) {
    stats.totalScore += gain;
    if (goldenCoreMindReady) stats.goldenCoreShield = true;
  } else if (streakPreserved) {
    // 凝心丹消耗已凝聚的道心，只保留一次當次連答；戰鬥規則仍由鬥法引擎處理。
    stats.goldenCoreShield = false;
  } else if (goldenCoreMindReady) {
    stats.goldenCoreShield = true;
  } else if (goldenCoreEnabled) {
    stats.goldenCoreShield = !!goldenCoreEffect.preserveShield && !!stats.goldenCoreShield;
  }

  return {
    gain,
    baseGain,
    learningGain, recoveryBonusGain, streakPreserved,
    bonusGain,
    soulBonusGain,
    artifactBonusGain,
    artifactMultiplier: Number(artifactEffect.multiplier) || 1,
    artifactMessage: artifactEffect.message || '',
    penalty,
    isGoldenCoreOrAbove,
    goldenCoreMindReady,
    hadGoldenCoreShield,
    shieldBlockedPenalty,
    goldenCoreShieldConsumed: streakPreserved,
    preservedGoldenCoreMind: !isCorrect && !shieldBlockedPenalty && !goldenCoreMindReady && !!goldenCoreEffect.preserveShield && !!stats.goldenCoreShield,
    goldenCoreMessage: goldenCoreEffect.message || ''
  };
}

function showGoldenCoreTrigger(reward) {
  const message = reward?.goldenCoreMessage ||
    (reward?.streakPreserved ? '凝心道心保留一次連答' : '') ||
    (reward?.goldenCoreMindReady ? '金丹道心護體成形' : '');
  if (!message || typeof window.showGoldenCoreActivation !== 'function') return;
  const core = window.getEquippedGoldenCoreState?.() || {};
  window.showGoldenCoreActivation({
    type: core.type,
    name: core.name || '金丹',
    message,
    kind: reward?.streakPreserved
      ? '道心護體・連答保留'
      : (reward?.bonusGain > 0 ? `修為額外 +${reward.bonusGain}` : '金丹道心效果')
  });
}

export function showCultivationFeedback(reward, isCorrect) {
  showGoldenCoreTrigger(reward);

  if (isCorrect) {
    const extras = [];
    if (reward.soulBonusGain > 0) extras.push(`元嬰悟道 +${reward.soulBonusGain}`);
    if (reward.goldenCoreMindReady) extras.push('金丹道心凝聚');
    if (reward.goldenCoreMessage) extras.push(reward.goldenCoreMessage);
    if (reward.artifactMessage) extras.push(reward.artifactMessage);
    if (reward.learningMessage) extras.push(reward.learningMessage);
    showToast(`悟道成功！修為 +${reward.gain}${extras.length ? `，${extras.join('；')}` : ''}`);
    return;
  }

  if (reward.streakPreserved) {
    showToast('本次失誤，修為不減；凝心道心保留本次連答，護體已消耗。');
    return;
  }

  const lossText = '修為不減，連答已中斷';

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
