// Keep only rendering diagnostics, never account data. An interrupted entry
// must not keep crashing the renderer each time the player opens the same map.
const KEY = 'qa-training-render-v1';
const RECENT_MS = 60000;
let previous = null;
try { previous = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (_) {}
const recentInterruption = previous?.entering === true && previous?.cleanExit !== true &&
  Date.now() - Number(previous.at) >= 0 && Date.now() - Number(previous.at) < RECENT_MS;
// Recover from the actual interrupted entry for this launch only. Older safe
// flags must not permanently prevent the next launch from testing high rendering.
const recoverySafe = recentInterruption;
let safe = true;
let assessment = { status:'testing', reason:'startup', samples:0 };
let record = { safe:recoverySafe, entering:false, cleanExit:false, at:Date.now() };
function save() { try { sessionStorage.setItem(KEY, JSON.stringify(record)); } catch (_) {} }
export function trainingRenderProfile() { return safe ? 'safe' : 'balanced'; }
export function markTrainingEntry() {
  record = { safe:recoverySafe, entering:true, cleanExit:false, at:Date.now() };
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
  navigationType:window.performance?.getEntriesByType?.('navigation')?.[0]?.type || 'unknown',
  wasDiscarded:document.wasDiscarded === true,
  ...assessment
});
if (recentInterruption) console.warn('[Training renderer] interrupted entry detected; using fewer image layers', window.getTrainingRenderDiagnostics());

function testStartupRendering() {
  return new Promise(resolve => {
    let frame = 0, deadline = 0, finished = false, canvas, texture;
    const intervals = [], drawTimes = [];
    const clock = window.performance;
    function finish(reason, high = false, metrics = {}) {
      if (finished) return;
      finished = true;
      window.cancelAnimationFrame?.(frame);
      window.clearTimeout?.(deadline);
      document.removeEventListener?.('visibilitychange', onVisibility);
      // Release the two tiny probe surfaces immediately, including on failure.
      if (canvas) canvas.width = canvas.height = 1;
      if (texture) texture.width = texture.height = 1;
      safe = recoverySafe || !high;
      assessment = { status:'ready', reason, samples:intervals.length, ...metrics };
      resolve(trainingRenderProfile());
    }
    function onVisibility() { if (document.hidden) finish('background'); }
    if (recoverySafe) { finish('crash-recovery'); return; }
    if (document.hidden) { finish('background'); return; }
    if (!window.requestAnimationFrame || !clock?.now || !document.createElement) {
      finish('unsupported'); return;
    }
    try {
      // No game images, WebGL contexts or full-screen surfaces are allocated.
      // Small composited draws plus a one-pixel readback exercise real drawing,
      // while frame spacing also catches main-thread pressure during startup.
      canvas = document.createElement('canvas');
      texture = document.createElement('canvas');
      canvas.width = 320; canvas.height = 180;
      texture.width = texture.height = 128;
      const context = canvas.getContext('2d');
      const paint = texture.getContext('2d');
      if (!context || !paint) { finish('unsupported'); return; }
      const gradient = paint.createLinearGradient(0, 0, 128, 128);
      gradient.addColorStop(0, '#244c62');
      gradient.addColorStop(1, '#e2c482');
      paint.fillStyle = gradient;
      paint.fillRect(0, 0, 128, 128);
      let previousFrame = null, warmup = 2;
      const percentile90 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .9) - 1];
      function sample(timestamp) {
        if (finished) return;
        if (document.hidden) { finish('background'); return; }
        try {
          const started = clock.now();
          context.globalAlpha = 1;
          context.clearRect(0, 0, 320, 180);
          context.globalAlpha = .35;
          for (let layer = 0; layer < 8; layer++) {
            context.drawImage(texture, (layer + intervals.length) % 12 - 6, layer - 4, 320, 180);
          }
          context.getImageData(0, 0, 1, 1);
          const drawMs = clock.now() - started;
          if (!Number.isFinite(timestamp) || !Number.isFinite(drawMs) || drawMs < 0) {
            finish('unsupported'); return;
          }
          if (previousFrame !== null) {
            const interval = timestamp - previousFrame;
            if (interval <= 0) { finish('unsupported'); return; }
            if (warmup > 0) warmup--;
            else {
              intervals.push(interval); drawTimes.push(drawMs);
              if (interval >= 150 || drawMs >= 50) { finish('slow-rendering'); return; }
            }
          }
          previousFrame = timestamp;
          if (intervals.length >= 24) {
            const frameP90Ms = percentile90(intervals);
            const drawP90Ms = percentile90(drawTimes);
            const slowFrames = intervals.filter(ms => ms > 34).length;
            const smooth = frameP90Ms <= 24 && drawP90Ms <= 8 && slowFrames <= 2;
            // Let every device try the layered scene when measured drawing is
            // smooth; user-agent and hardware hints alone cannot veto it.
            finish(smooth ? 'performance-ok' : 'slow-rendering', smooth, {
              frameP90Ms:Math.round(frameP90Ms * 10) / 10,
              drawP90Ms:Math.round(drawP90Ms * 10) / 10
            });
            return;
          }
          frame = window.requestAnimationFrame(sample);
        } catch (_) { finish('probe-failed'); }
      }
      document.addEventListener('visibilitychange', onVisibility);
      // Hidden/throttled frames or a failed browser API cannot trap startup.
      deadline = window.setTimeout(() => finish('timeout'), 1500);
      frame = window.requestAnimationFrame(sample);
    } catch (_) { finish('probe-failed'); }
  });
}

// Start once as soon as the game shell opens. The map awaits this same promise
// before allocating any scenery, so a low result never loads the high layers.
export const trainingRenderReady = testStartupRendering();
