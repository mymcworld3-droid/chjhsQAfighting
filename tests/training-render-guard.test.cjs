const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/cultivation/training-render-guard.js'), 'utf8')
  .replace(/^export /gm, '');

function runtime(options = {}) {
  let record = options.saved, time = 0, clock = 0, nextId = 0, draws = 0;
  const handlers = new Map(), frames = new Map(), timers = new Map(), canvases = [];
  const on = (type, fn) => handlers.set(type, fn);
  const context = {
    Date: { now: () => options.now ?? 100000 }, console: { warn() {} },
    sessionStorage: {
      getItem() { if (options.blockedStorage) throw Error('blocked'); return record; },
      setItem(_, value) { if (options.blockedStorage) throw Error('blocked'); record = value; }
    },
    document: {
      hidden: options.hidden === true, wasDiscarded: false,
      addEventListener: on, removeEventListener: type => handlers.delete(type),
      createElement(tag) {
        assert.equal(tag, 'canvas', 'the assessment allocates no game images');
        const canvas = { width: 0, height: 0,
          getContext() {
            if (options.noCanvas) return null;
            return {
              createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}, clearRect() {}, drawImage() {},
              getImageData() {
                if (options.drawFailure) throw Error('context lost');
                draws++;
                clock += typeof options.drawMs === 'function' ? options.drawMs(draws) : (options.drawMs ?? 1);
              }
            };
          }
        };
        canvases.push(canvas);
        return canvas;
      }
    },
    window: {
      navigator: options.navigator || {},
      performance: { now: () => clock, getEntriesByType: () => [{ type: 'reload' }] },
      addEventListener: on,
      requestAnimationFrame(fn) { frames.set(++nextId, fn); return nextId; },
      cancelAnimationFrame(id) { frames.delete(id); },
      setTimeout(fn, ms) { timers.set(++nextId, { fn, ms }); return nextId; },
      clearTimeout(id) { timers.delete(id); }
    }
  };
  if (options.noAnimationFrame) delete context.window.requestAnimationFrame;
  vm.runInNewContext(source + '\nthis.api={trainingRenderReady,trainingRenderProfile,markTrainingEntry,markTrainingStable,markTrainingExit};', context);
  return {
    api: context.api, handlers, frames, timers, canvases, context,
    record: () => record, draws: () => draws, diagnostics: context.window.getTrainingRenderDiagnostics,
    async complete() {
      for (let count = 0; frames.size && count < 80; count++) {
        const [id, fn] = frames.entries().next().value;
        frames.delete(id);
        time += typeof options.frameMs === 'function' ? options.frameMs(count) : (options.frameMs ?? 1000 / 60);
        clock = time;
        fn(time);
      }
      assert.equal(frames.size, 0, 'the benchmark must finish with a bounded number of frames');
      return context.api.trainingRenderReady;
    }
  };
}

test('startup defaults to low rendering until the bounded drawing and frame test completes', async () => {
  const f = runtime();
  assert.equal(f.api.trainingRenderProfile(), 'safe');
  assert.equal(f.diagnostics().status, 'testing');
  assert.equal(await f.complete(), 'balanced');
  assert.equal(f.diagnostics().reason, 'performance-ok');
  assert.equal(f.diagnostics().samples, 24);
  assert.equal(f.diagnostics().frameP90Ms, 16.7);
  assert.equal(f.diagnostics().drawP90Ms, 1);
  assert.equal(f.draws(), 27, 'only two warm-up intervals and 24 measured intervals');
  assert.equal(f.timers.size, 0);
  assert.equal(f.handlers.has('visibilitychange'), false);
  assert.ok(f.canvases.every(canvas => canvas.width === 1 && canvas.height === 1), 'release both probe surfaces');
});

test('fast frames choose high rendering; dropped frames and slow draws choose low rendering', async () => {
  assert.equal(await runtime({ frameMs: 1000 / 120 }).complete(), 'balanced');
  for (const options of [{ frameMs: 1000 / 30 }, { drawMs: 10 }, { frameMs: 200 }, { drawMs: 60 }]) {
    const f = runtime(options);
    assert.equal(await f.complete(), 'safe');
    assert.equal(f.diagnostics().reason, 'slow-rendering');
    assert.equal(f.timers.size, 0);
  }
});

test('cold graphics initialization during warm-up does not misclassify an otherwise smooth launch', async () => {
  const f = runtime({ frameMs: index => index < 3 ? 170 : 1000 / 60,
    drawMs: count => count <= 3 ? 60 : 1 });
  assert.equal(await f.complete(), 'balanced');
  assert.equal(f.diagnostics().samples, 24);
  assert.equal(f.diagnostics().drawP90Ms, 1);
});

test('iPhone/iPad and constrained hardware retain low rendering even with smooth probe frames', async () => {
  for (const [navigator, reason] of [
    [{ userAgent: 'Mozilla/5.0 (iPhone) CriOS/140 Mobile' }, 'ios-memory-budget'],
    [{ userAgent: 'Mozilla/5.0 (iPad)' }, 'ios-memory-budget'],
    [{ platform: 'MacIntel', maxTouchPoints: 5 }, 'ios-memory-budget'],
    [{ deviceMemory: 4, hardwareConcurrency: 8 }, 'device-memory'],
    [{ hardwareConcurrency: 2 }, 'device-cpu']
  ]) {
    const f = runtime({ navigator });
    assert.equal(await f.complete(), 'safe');
    assert.equal(f.diagnostics().samples, 24, 'still assess frame and drawing performance on launch');
    assert.equal(f.diagnostics().reason, reason);
  }
  assert.equal(await runtime({ navigator: { deviceMemory: 8, hardwareConcurrency: 8 } }).complete(), 'balanced');
});

test('normal reloads, stable maps and ordinary exits do not trigger crash recovery', async () => {
  const f = runtime();
  await f.complete(); f.api.markTrainingEntry(); f.handlers.get('pagehide')();
  assert.equal(await runtime({ saved: f.record() }).complete(), 'balanced', 'normal reload fires pagehide');
  f.api.markTrainingStable();
  assert.equal(await runtime({ saved: f.record() }).complete(), 'balanced');
  f.api.markTrainingEntry(); f.api.markTrainingExit();
  assert.equal(await runtime({ saved: f.record() }).complete(), 'balanced');
});

test('an interrupted entry locks the lighter renderer for this tab without another rendering probe', async () => {
  const first = runtime();
  await first.complete(); first.api.markTrainingEntry();
  const recovered = runtime({ saved: first.record() });
  assert.equal(await recovered.api.trainingRenderReady, 'safe');
  assert.equal(recovered.diagnostics().interruptedEntry, true);
  assert.equal(recovered.diagnostics().reason, 'crash-recovery');
  assert.equal(recovered.canvases.length, 0);
  recovered.api.markTrainingEntry(); recovered.api.markTrainingStable();
  assert.equal(await runtime({ saved: recovered.record() }).api.trainingRenderReady, 'safe');
  assert.deepEqual(Object.keys(JSON.parse(recovered.record())).sort(), ['at', 'cleanExit', 'entering', 'safe']);
});

test('performance-based low rendering is tested again on the next opening instead of becoming a permanent lock', async () => {
  const slow = runtime({ frameMs: 40 });
  await slow.complete(); slow.api.markTrainingEntry(); slow.api.markTrainingStable();
  assert.equal(JSON.parse(slow.record()).safe, false, 'the stored flag only locks crash recovery');
  assert.equal(await runtime({ saved: slow.record() }).complete(), 'balanced');
  const first = runtime(); first.api.markTrainingEntry();
  assert.equal(await runtime({ saved: first.record(), now: 200000 }).complete(), 'balanced', 'old interruptions expire');
});

test('hidden tabs, unsupported APIs, denied storage and drawing failures cannot block game startup', async () => {
  for (const [options, reason] of [
    [{ hidden: true }, 'background'], [{ noCanvas: true }, 'unsupported'],
    [{ noAnimationFrame: true }, 'unsupported'], [{ drawFailure: true }, 'probe-failed']
  ]) {
    const f = runtime(options);
    assert.equal(await f.complete(), 'safe');
    assert.equal(f.diagnostics().reason, reason);
    assert.equal(f.timers.size, 0);
  }
  const blocked = runtime({ blockedStorage: true });
  assert.equal(await blocked.complete(), 'balanced');
  blocked.api.markTrainingEntry(); blocked.api.markTrainingStable(); blocked.api.markTrainingExit();
});

test('a missing animation callback times out and backgrounding cancels a running probe', async () => {
  const stalled = runtime();
  const deadline = [...stalled.timers.values()][0];
  assert.equal(deadline.ms, 1500);
  deadline.fn();
  assert.equal(await stalled.api.trainingRenderReady, 'safe');
  assert.equal(stalled.diagnostics().reason, 'timeout');
  assert.equal(stalled.frames.size, 0);
  const hidden = runtime();
  hidden.context.document.hidden = true;
  hidden.handlers.get('visibilitychange')();
  assert.equal(await hidden.api.trainingRenderReady, 'safe');
  assert.equal(hidden.frames.size, 0);
  assert.equal(hidden.timers.size, 0);
  assert.ok(hidden.canvases.every(canvas => canvas.width === 1 && canvas.height === 1));
});

test('the map waits for the startup decision before creating its scenery and exposing its entry point', async () => {
  const map = fs.readFileSync(path.join(__dirname, '../public/cultivation/training-scene-map.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../public/main.js'), 'utf8');
  let resolve, boots = 0;
  const context = { trainingRenderReady: new Promise(done => { resolve = done; }),
    window: {}, document: { readyState: 'complete' }, showMap() {}, boot() { boots++; } };
  vm.runInNewContext(map.slice(map.indexOf('export const featureReady =')).replace('export ', '') + '\nthis.ready=featureReady;', context);
  assert.equal(boots, 0);
  assert.equal(context.window.openTrainingSceneMap, undefined);
  resolve('safe'); await context.ready;
  assert.equal(boots, 1);
  assert.equal(context.window.openTrainingSceneMap, context.showMap);
  assert.match(main, /void import\('\.\/cultivation\/training-render-guard\.js'\)/, 'start testing before sign-in');
});
