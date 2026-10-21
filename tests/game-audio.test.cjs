'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAudioManager, SOUNDS } = require('../public/game-audio.js');

function runtime({ saved, remote = {}, supported = true, failed = false, holdDecode = false } = {}) {
  let time = 1000, serial = 0;
  const timers = new Map(), contexts = [], sources = [], requests = [], decodes = [], waiting = [];
  const events = target => ({
    addEventListener(name, fn) { const key = target + ':' + name; const list = listeners.get(key) || []; list.push(fn); listeners.set(key, list); },
    removeEventListener(name, fn) { const key = target + ':' + name; listeners.set(key, (listeners.get(key) || []).filter(f => f !== fn)); }
  });
  const listeners = new Map(), storage = new Map(saved ? [['qa-game-sfx-v1', JSON.stringify(saved)]] : []);
  const parameter = () => ({ value: 0, setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; },
    setTargetAtTime(value) { this.value = value; }, cancelScheduledValues() {} });
  const env = {
    ...events('window'), performance: { now: () => time },
    document: { ...events('document'), hidden: false, readyState: 'complete', getElementById: () => null },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    getCurrentUserData: () => ({ gameSettings: remote }),
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, at: time + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async fetch(url) { requests.push(url); if (failed) throw new Error('offline'); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; }
  };
  class Audio {
    constructor() { this.state = 'suspended'; this.destination = {}; contexts.push(this); }
    get currentTime() { return time / 1000; }
    createGain() { return { gain: parameter(), connect() {}, disconnect() {} }; }
    createDynamicsCompressor() { return { threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter(), connect() {} }; }
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async close() { this.state = 'closed'; }
    decodeAudioData(bytes) {
      decodes.push(bytes);
      return holdDecode ? new Promise(resolve => waiting.push(() => resolve({ duration: 2 }))) : Promise.resolve({ duration: 2 });
    }
    createBufferSource() {
      const source = { playbackRate: { value: 1 }, connect() {}, disconnect() {}, endTimer: null,
        start(at, _offset, length) {
          this.startAt = at; this.naturalEnd = at + length / this.playbackRate.value;
          this.endTimer = env.setTimeout(() => { this.ended = true; this.onended?.(); }, (this.naturalEnd - time / 1000) * 1000);
        },
        stop(at = time / 1000) {
          this.stopAt = at; env.clearTimeout(this.endTimer);
          this.endTimer = env.setTimeout(() => { this.ended = true; this.onended?.(); }, Math.max(0, (at - time / 1000) * 1000));
        }
      };
      sources.push(source); return source;
    }
  }
  if (supported) env.AudioContext = Audio;
  const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
  async function advance(ms) {
    const end = time + ms;
    while (true) {
      const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); time = next[1].at; next[1].fn(); await settle();
    }
    time = end; await settle();
  }
  const manager = createAudioManager(env);
  return { manager, env, contexts, sources, requests, decodes, storage, advance, settle,
    async ready() { await manager.unlock(); await manager.preload(); await settle(); },
    async decode() { holdDecode = false; waiting.splice(0).forEach(resolve => resolve()); await settle(); },
    emit(target, name, detail) { for (const fn of listeners.get(target + ':' + name) || []) fn({ detail }); }
  };
}

test('startup prefetch never creates an audio context or queues playback before a gesture', async () => {
  const r = runtime(); r.manager.install(); await r.manager.preload();
  assert.equal(r.contexts.length, 0); assert.equal(r.requests.length, 8);
  assert.equal(r.manager.play('grand-reveal'), false);
  await r.advance(5000); assert.equal(r.sources.length, 0);
  await r.ready(); assert.equal(r.sources.length, 0, 'unlock cannot replay earlier requests');
});
test('the entire game reuses one context, eight fetches and eight decoded buffers', async () => {
  const r = runtime(); await r.ready();
  for (let i = 0; i < 20; i++) { await r.manager.unlock(); await r.manager.preload(); }
  assert.equal(r.contexts.length, 1); assert.equal(r.requests.length, 8); assert.equal(r.decodes.length, 8);
  assert.equal(r.manager.diagnostics().decoded, Object.keys(SOUNDS).length);
});
test('a single burst of click, answer, reward and breakthrough requests plays only the breakthrough', async () => {
  const r = runtime(); await r.ready();
  for (let i = 0; i < 20; i++) r.manager.play('ui-click');
  r.manager.answer(true, 'a'); r.manager.play('reward-chime'); r.manager.play('grand-reveal'); r.manager.play('ui-click');
  await r.advance(30);
  assert.equal(r.sources.length, 1); assert.equal(r.manager.diagnostics().active, 'grand-reveal');
});
test('rapid clicking is throttled and cannot accumulate a delayed playback queue', async () => {
  const r = runtime(); await r.ready();
  for (let i = 0; i < 20; i++) { r.manager.play('ui-click'); await r.advance(20); }
  assert.ok(r.sources.length <= 5); const count = r.sources.length;
  await r.advance(3000); assert.equal(r.sources.length, count); assert.equal(r.manager.diagnostics().voices, 0);
});
test('important reveals suppress lower-priority attacks and clicks until they finish', async () => {
  const r = runtime(); await r.ready(); r.manager.play('grand-reveal'); await r.advance(30);
  for (let i = 0; i < 6; i++) {
    assert.equal(r.manager.play('combat-impact'), false); assert.equal(r.manager.play('reward-chime'), false);
    await r.advance(200);
  }
  await r.advance(2000); assert.equal(r.sources.length, 1);
  assert.equal(r.manager.play('combat-impact'), true); await r.advance(30); assert.equal(r.sources.length, 2);
});
test('equal-priority hits replace rather than layer; preempted tails end before the next audible start', async () => {
  const r = runtime(); await r.ready();
  for (let i = 0; i < 12; i++) { r.manager.play('combat-impact'); await r.advance(200); }
  assert.equal(r.sources.length, 12); assert.ok(r.manager.diagnostics().peakVoices <= 2);
  for (let i = 1; i < r.sources.length; i++) assert.ok(r.sources[i - 1].stopAt <= r.sources[i].startAt + 1e-8);
});
test('repeated authoritative snapshots cannot replay the same result after its cooldown', async () => {
  const r = runtime(); await r.ready(); r.manager.play('reward-chime', { key: 'room:result:1' }); await r.advance(4000);
  assert.equal(r.manager.play('reward-chime', { key: 'room:result:1' }), false);
  assert.equal(r.manager.play('reward-chime', { key: 'room:result:2' }), true);
  await r.advance(30); assert.equal(r.sources.length, 2);
});
test('correct and wrong answers share a cooldown and cannot fire two outcome sounds together', async () => {
  const r = runtime(); await r.ready(); r.manager.answer(true, 'one'); await r.advance(30);
  assert.equal(r.manager.answer(false, 'two'), false); await r.advance(2000); assert.equal(r.sources.length, 1);
});
test('muting stops both the active voice and a pending request; unmuting never resumes them', async () => {
  const r = runtime(); await r.ready(); r.manager.play('combat-impact'); await r.advance(30);
  r.manager.play('grand-reveal'); r.manager.setPreferences({ enabled: false });
  assert.equal(r.manager.diagnostics().voices, 0); assert.equal(r.manager.diagnostics().pending, null);
  await r.advance(3000); r.manager.setPreferences({ enabled: true }); await r.advance(3000);
  assert.equal(r.sources.length, 1);
});
test('hiding the page stops audio, suspends the context and requires a fresh gesture on return', async () => {
  const r = runtime(); r.manager.install(); await r.ready(); r.manager.play('grand-reveal'); await r.advance(30);
  r.env.document.hidden = true; r.emit('document', 'visibilitychange'); await r.settle();
  assert.equal(r.manager.diagnostics().voices, 0); assert.equal(r.contexts[0].state, 'suspended');
  r.env.document.hidden = false; assert.equal(r.manager.play('reward-chime'), false);
  await r.manager.unlock(); assert.equal(r.manager.play('reward-chime'), true); await r.advance(30);
  assert.equal(r.contexts.length, 1); assert.equal(r.sources.length, 2);
});
test('a slow decode never produces a stale late sound', async () => {
  const r = runtime({ holdDecode: true }); await r.manager.unlock(); await r.settle();
  r.manager.play('grand-reveal'); await r.advance(300); await r.decode();
  assert.equal(r.sources.length, 0); assert.equal(r.manager.diagnostics().pending, null);
});
test('navigation or mute during decoding invalidates every pending playback continuation', async () => {
  const r = runtime({ holdDecode: true }); await r.manager.unlock(); await r.settle();
  r.manager.play('grand-reveal'); await r.advance(30); r.manager.stop(); await r.decode();
  assert.equal(r.sources.length, 0);
  r.manager.play('ui-click'); await r.advance(30); assert.equal(r.sources.length, 1);
});
test('a stale high-priority download cannot block fresh clicks indefinitely', async () => {
  const r = runtime({ holdDecode: true }); await r.manager.unlock(); await r.settle();
  r.manager.play('grand-reveal'); await r.advance(250);
  assert.equal(r.manager.play('ui-click'), true); await r.decode(); await r.advance(30);
  assert.equal(r.sources.length, 1); assert.equal(r.manager.diagnostics().active, 'ui-click');
});
test('missing media, unsupported audio and failed fetches never throw or block game actions', async () => {
  const noAudio = runtime({ supported: false }); assert.equal(await noAudio.manager.unlock(), false);
  assert.equal(noAudio.manager.play('reward-chime'), false);
  const offline = runtime({ failed: true }); await offline.ready(); offline.manager.play('reward-chime'); await offline.advance(30);
  assert.equal(offline.sources.length, 0); assert.equal(offline.manager.diagnostics().failed.length, 8);
  assert.equal(offline.manager.play('unknown'), false);
});
test('saved mute preferences prevent fetching and context creation; volume zero silences immediately', async () => {
  const r = runtime({ saved: { enabled: false, volume: .5 } }); r.manager.install();
  await r.manager.preload(); assert.equal(await r.manager.unlock(), false);
  assert.equal(r.requests.length, 0); assert.equal(r.contexts.length, 0);
  r.manager.setPreferences({ enabled: true }); await r.ready(); r.manager.play('reward-chime'); await r.advance(30);
  r.manager.setPreferences({ volume: 0 }); assert.equal(r.manager.diagnostics().voices, 0);
  assert.equal(JSON.parse(r.storage.get('qa-game-sfx-v1')).volume, 0);
});
test('existing sound-disabled accounts are respected and can explicitly enable this device', async () => {
  const r = runtime({ remote: { soundEnabled: false } });
  assert.equal(await r.manager.unlock(), false); assert.equal(r.requests.length, 0);
  r.manager.setPreferences({ enabled: true }); await r.ready(); assert.equal(r.contexts.length, 1);
});
test('programmatic clicks do not produce sounds and disposal releases the sole context', async () => {
  const r = runtime(); r.manager.install(); await r.ready();
  r.emit('document', 'click'); await r.advance(30); assert.equal(r.sources.length, 0);
  r.manager.play('reward-chime'); await r.advance(30); r.manager.dispose(); await r.settle();
  assert.equal(r.manager.diagnostics().voices, 0); assert.equal(r.contexts[0].state, 'closed');
  assert.equal(r.manager.play('grand-reveal'), false);
});
