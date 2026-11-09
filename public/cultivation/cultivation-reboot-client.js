import './training-access-rules.js';
import './cultivation-path-nodes.js?v=20261109-path-v2';
import './cultivation-reboot-rules.js?v=20261109-path-v2';
import { authenticatedMainFetch, getMainUser } from './data/project-repository.js';

const Rules = globalThis.QACultivationRebootRules;
let view = null;
let activeUid = '';

export function clearCultivationReboot() {
  activeUid = '';
  view = null;
  window.dispatchEvent(new CustomEvent('xiuxian:cultivation-path-updated'));
}

export async function cultivationRequest(action, payload = {}) {
  const uid = getMainUser()?.uid;
  if (!uid) throw new Error('請先登入再修行。');
  const response = await authenticatedMainFetch('/api/cultivation-reboot', {
    method: 'POST',
    body: JSON.stringify({ ...payload, action, revision: view?.state.revision }),
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.state?.version !== 1) {
    throw Object.assign(new Error(result?.error || '修行資料暫時無法同步，請重試。'), { status: response.status });
  }
  if (getMainUser()?.uid !== uid || activeUid !== uid) return null;
  if (!view || result.state.revision >= view.state.revision) {
    const previous = view?.state;
    result.state.peakScore = Math.max(previous?.peakScore || 0, result.state.peakScore);
    view = result;
    if (!previous || previous.revision !== result.state.revision || previous.peakScore !== result.state.peakScore)
      window.dispatchEvent(new CustomEvent('xiuxian:cultivation-path-updated'));
  }
  return view;
}

export async function initializeCultivationReboot(uid) {
  if (activeUid !== uid) view = null;
  activeUid = uid;
  return cultivationRequest('sync');
}

export function cultivationView() {
  return getMainUser()?.uid === activeUid ? view : null;
}

function stateFor(player) {
  if (player?.uid && player.uid !== activeUid) return null;
  return cultivationView()?.state || null;
}

window.QACultivationRebootClient = Object.freeze({
  realmScore(score, player = window.getCurrentUserData?.()) {
    return Rules.realmScore(score, stateFor(player));
  },
  bonuses(player, core) {
    return Rules.bonuses(stateFor(player), core);
  },
  battleSnapshot(player, core) {
    return Rules.battleSnapshot(stateFor(player), core);
  }
});

// Existing battle/status callers consume this shared effect slot. The source
// is the current path and equipped core, never the retired inventory.
window.getArtifactBattleSnapshot = () => window.QACultivationRebootClient.battleSnapshot(
  window.getCurrentUserData?.(), window.getEquippedGoldenCoreBattleSnapshot?.()
);
