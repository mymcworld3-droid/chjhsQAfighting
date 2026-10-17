// Keep only rendering diagnostics, never account data. An interrupted entry
// must not keep crashing the renderer each time the player opens the same map.
const KEY = 'qa-training-render-v1';
const RECENT_MS = 60000;
let previous = null;
try { previous = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (_) {}
const recentInterruption = previous?.entering === true && previous?.cleanExit !== true &&
  Date.now() - Number(previous.at) >= 0 && Date.now() - Number(previous.at) < RECENT_MS;
let safe = previous?.safe === true || recentInterruption;
let record = { safe, entering:false, cleanExit:false, at:Date.now() };
function save() { try { sessionStorage.setItem(KEY, JSON.stringify(record)); } catch (_) {} }
export function trainingRenderProfile() { return safe ? 'safe' : 'balanced'; }
export function markTrainingEntry() {
  record = { safe, entering:true, cleanExit:false, at:Date.now() };
  save();
}
export function markTrainingStable() {
  record.entering = false;
  save();
}
export function markTrainingExit() {
  record.entering = false;
  save();
}
window.addEventListener('pagehide', () => { record.cleanExit = true; save(); });
window.getTrainingRenderDiagnostics = () => ({
  profile:trainingRenderProfile(), interruptedEntry:recentInterruption,
  navigationType:performance.getEntriesByType?.('navigation')?.[0]?.type || 'unknown',
  wasDiscarded:document.wasDiscarded === true
});
if (recentInterruption) console.warn('[Training renderer] interrupted entry detected; using fewer image layers', window.getTrainingRenderDiagnostics());
