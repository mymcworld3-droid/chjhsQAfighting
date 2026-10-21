// One audio context, one foreground cue, no playback backlog.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (!root.QAGameAudio) {
    root.QAGameAudio = api.createAudioManager(root);
    root.QAGameAudio.install();
  }
})(globalThis, function () {
  'use strict';
  const SOUNDS = Object.freeze({
    'ui-click': { priority: 10, group: 'ui', cooldown: 90, max: .20, gain: .50 },
    'cloud-whoosh': { priority: 25, group: 'transition', cooldown: 450, max: .8, gain: .45 },
    'answer-correct': { priority: 65, group: 'answer', cooldown: 350, max: .7, gain: .65 },
    'answer-wrong': { priority: 65, group: 'answer', cooldown: 350, max: .5, gain: .60 },
    'combat-impact': { priority: 40, group: 'combat', cooldown: 180, max: .5, gain: .70 },
    'spirit-pulse': { priority: 50, group: 'spirit', cooldown: 650, max: 1, gain: .60 },
    'reward-chime': { priority: 80, group: 'reward', cooldown: 900, max: .9, gain: .65 },
    'grand-reveal': { priority: 100, group: 'reveal', cooldown: 2000, max: 1.8, gain: .70 }
  });
  const SETTINGS_KEY = 'qa-game-sfx-v1';
  const FRESH_MS = 200;
  const FADE_SECONDS = .018;
  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value))
    ? Math.min(max, Math.max(min, Number(value))) : fallback;

  function createAudioManager(env) {
    const doc = env.document;
    const now = () => env.performance?.now?.() ?? Date.now();
    const later = (fn, ms) => env.setTimeout(fn, ms);
    const cancel = timer => env.clearTimeout(timer);
    const raw = new Map(), buffers = new Map(), decoding = new Map(), failedAt = new Map();
    const lastPlayed = new Map(), groups = new Map(), seen = new Map(), voices = new Set();
    const listeners = [];
    let context = null, master = null, compressor = null, unlocked = false;
    let current = null, fading = null, pending = null, flushTimer = null, epoch = 0;
    let installed = false, disposed = false, localPreference = false;
    let settings = { enabled: true, volume: .35 };
    const counts = { played: 0, dropped: 0, peakVoices: 0 };
    try {
      const saved = JSON.parse(env.localStorage?.getItem(SETTINGS_KEY) || 'null');
      if (saved && typeof saved.enabled === 'boolean') {
        settings = { enabled: saved.enabled, volume: clamp(saved.volume, 0, 1, .35) };
        localPreference = true;
      }
    } catch (_) {}
    function preferences() {
      const remote = env.getCurrentUserData?.()?.gameSettings;
      return { enabled: localPreference ? settings.enabled : remote?.soundEnabled !== false,
        volume: settings.volume };
    }
    const allowed = () => !disposed && !doc?.hidden && preferences().enabled && settings.volume > 0;
    const drop = () => { counts.dropped++; return false; };
    function release(voice) {
      if (!voice || !voices.has(voice)) return;
      voices.delete(voice); cancel(voice.timer);
      try { voice.source.disconnect(); voice.gain.disconnect(); } catch (_) {}
      if (current === voice) current = null;
      if (fading === voice) fading = null;
    }
    function halt(voice) {
      if (!voice) return;
      try { voice.source.stop(); } catch (_) {}
      release(voice);
    }
    function stop() {
      epoch++; pending = null; cancel(flushTimer); flushTimer = null;
      [...voices].forEach(halt); current = fading = null;
    }
    function ensureContext() {
      if (context) return context;
      const Audio = env.AudioContext || env.webkitAudioContext;
      if (!Audio) return null;
      try {
        context = new Audio();
        master = context.createGain(); master.gain.value = settings.volume;
        if (context.createDynamicsCompressor) {
          compressor = context.createDynamicsCompressor();
          compressor.threshold.value = -12; compressor.knee.value = 18;
          compressor.ratio.value = 6; compressor.attack.value = .003; compressor.release.value = .12;
          master.connect(compressor); compressor.connect(context.destination);
        } else master.connect(context.destination);
        return context;
      } catch (_) { return null; }
    }
    async function loadRaw(id) {
      if (raw.has(id)) return raw.get(id);
      if (failedAt.has(id) && now() - failedAt.get(id) < 30000) return null;
      const promise = (async () => {
        let timeout, controller;
        try {
          if (env.AbortController) {
            controller = new env.AbortController(); timeout = later(() => controller.abort(), 10000);
          }
          const response = await env.fetch('assets/audio/' + id + '.mp3',
            controller ? { signal: controller.signal } : {});
          if (!response.ok) throw new Error('Unavailable sound');
          const bytes = await response.arrayBuffer(); failedAt.delete(id); return bytes;
        } catch (_) { failedAt.set(id, now()); raw.delete(id); return null; }
        finally { if (timeout) cancel(timeout); }
      })();
      raw.set(id, promise); return promise;
    }
    async function loadBuffer(id) {
      if (buffers.has(id)) return buffers.get(id);
      if (!context) return null;
      if (!decoding.has(id)) {
        const promise = (async () => {
          try {
            const bytes = await loadRaw(id);
            if (!bytes || disposed) return null;
            const buffer = await context.decodeAudioData(bytes.slice(0));
            buffers.set(id, buffer); return buffer;
          } catch (_) { failedAt.set(id, now()); return null; }
          finally { decoding.delete(id); }
        })();
        decoding.set(id, promise);
      }
      return decoding.get(id);
    }
    function preload() {
      if (disposed || !preferences().enabled || !env.fetch) return Promise.resolve([]);
      return Promise.allSettled(Object.keys(SOUNDS).map(id => context ? loadBuffer(id) : loadRaw(id)));
    }
    async function unlock() {
      if (!allowed() || !ensureContext()) return false;
      try {
        if (context.state !== 'running') await context.resume();
        unlocked = context.state === 'running';
        if (unlocked) void preload();
        return unlocked;
      } catch (_) { unlocked = false; return false; }
    }
    function admissible(cue) {
      if (!allowed() || !unlocked || context?.state !== 'running') return false;
      if (cue.key && seen.has(cue.key)) return false;
      if (now() - (lastPlayed.get(cue.id) ?? -Infinity) < cue.definition.cooldown ||
          now() - (groups.get(cue.definition.group) ?? -Infinity) < cue.definition.cooldown) return false;
      return !current || cue.priority >= current.priority;
    }
    function start(cue, buffer) {
      if (!admissible(cue) || cue.epoch !== epoch || now() - cue.at > FRESH_MS) return drop();
      let voice;
      try {
        // A preemption finishes its 18 ms fade before the new voice becomes audible.
        // At most one outgoing source may exist, even during rapid equal-priority hits.
        halt(fading);
        const time = context.currentTime;
        let startAt = time;
        if (current) {
          const old = current; current = null; fading = old;
          old.gain.gain.cancelScheduledValues(time);
          old.gain.gain.setValueAtTime(old.gain.gain.value, time);
          old.gain.gain.linearRampToValueAtTime(0, time + FADE_SECONDS);
          old.source.stop(time + FADE_SECONDS); startAt += FADE_SECONDS;
        }
        const source = context.createBufferSource(), gain = context.createGain();
        const rate = clamp(cue.rate, .7, 1.4, 1);
        const length = Math.min(buffer.duration, cue.definition.max);
        source.buffer = buffer; source.playbackRate.value = rate;
        gain.gain.setValueAtTime(0, startAt);
        gain.gain.linearRampToValueAtTime(cue.definition.gain * clamp(cue.volume, 0, 1, 1), startAt + .005);
        const endAt = startAt + length / rate;
        gain.gain.setValueAtTime(cue.definition.gain * clamp(cue.volume, 0, 1, 1), Math.max(startAt + .005, endAt - .025));
        gain.gain.linearRampToValueAtTime(0, endAt);
        source.connect(gain); gain.connect(master);
        voice = { source, gain, priority: cue.priority, id: cue.id, timer: null };
        voices.add(voice); current = voice;
        source.onended = () => release(voice);
        source.start(startAt, 0, length);
        voice.timer = later(() => halt(voice), (length / rate + FADE_SECONDS + .1) * 1000);
        lastPlayed.set(cue.id, now()); groups.set(cue.definition.group, now());
        if (cue.key) { seen.set(cue.key, now()); if (seen.size > 512) seen.delete(seen.keys().next().value); }
        counts.played++; counts.peakVoices = Math.max(counts.peakVoices, voices.size); return true;
      } catch (_) { halt(voice); return drop(); }
    }
    async function flush(cue) {
      const buffer = await loadBuffer(cue.id);
      if (pending !== cue) return;
      pending = null; flushTimer = null;
      if (!buffer) { drop(); return; }
      start(cue, buffer);
    }
    function play(id, options = {}) {
      const definition = SOUNDS[id];
      if (!definition) return drop();
      const cue = { ...options, id, definition, epoch, at: now(),
        priority: clamp(options.priority, 0, definition.priority, definition.priority) };
      if (pending && now() - pending.at > FRESH_MS) pending = null;
      if (!admissible(cue) || pending && pending.priority > cue.priority) return drop();
      // One short coalescing slot, never a queue. A result supersedes its click.
      pending = cue; cancel(flushTimer);
      flushTimer = later(() => { void flush(cue); }, 18);
      return true;
    }
    function answer(correct, key) { return play(correct ? 'answer-correct' : 'answer-wrong', { key }); }
    function transition() { stop(); return play('cloud-whoosh'); }
    function syncControls() {
      const panel = doc?.getElementById('game-audio-settings'); if (!panel) return;
      const p = preferences(), toggle = panel.querySelector('[data-sfx-toggle]');
      toggle.setAttribute('aria-checked', String(p.enabled)); toggle.textContent = p.enabled ? '開啟' : '關閉';
      panel.querySelector('input').value = String(Math.round(settings.volume * 100));
      panel.querySelector('output').textContent = Math.round(settings.volume * 100) + '%';
      panel.querySelector('[data-sfx-preview]').disabled = !p.enabled || settings.volume === 0;
    }
    function setPreferences(next = {}) {
      settings = { enabled: typeof next.enabled === 'boolean' ? next.enabled : preferences().enabled,
        volume: clamp(next.volume ?? settings.volume, 0, 1, settings.volume) };
      localPreference = true;
      try { env.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
      if (!settings.enabled || settings.volume === 0) stop();
      if (master) master.gain.setTargetAtTime(settings.volume, context.currentTime, .01);
      syncControls(); return preferences();
    }
    function listen(target, name, fn, options) {
      target?.addEventListener?.(name, fn, options);
      listeners.push(() => target?.removeEventListener?.(name, fn, options));
    }
    function mount() {
      const page = doc?.getElementById('page-settings');
      if (!page || doc.getElementById('game-audio-settings')) return;
      const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = 'styles/game-audio.css'; doc.head.appendChild(link);
      const panel = doc.createElement('section'); panel.id = 'game-audio-settings'; panel.className = 'glass-panel game-audio-settings';
      panel.setAttribute('aria-label', '音效設定');
      panel.innerHTML = '<div><h3>音效</h3><p>答題、戰鬥與獎勵提示音</p></div><button type="button" role="switch" aria-label="遊戲音效" data-sfx-toggle></button><label for="game-sfx-volume">音量 <output for="game-sfx-volume"></output><input id="game-sfx-volume" type="range" min="0" max="100" step="1"></label><button type="button" data-sfx-preview>試聽</button>';
      page.querySelector('h2')?.after(panel);
      panel.querySelector('[data-sfx-toggle]').addEventListener('click', () => {
        setPreferences({ enabled: !preferences().enabled }); void unlock();
      });
      panel.querySelector('input').addEventListener('input', event => setPreferences({ volume: Number(event.target.value) / 100 }));
      panel.querySelector('[data-sfx-preview]').addEventListener('click', () => {
        void unlock().then(ok => { if (ok) play('reward-chime', { priority: 35 }); });
      });
      syncControls();
    }
    function install() {
      if (installed || !doc) return; installed = true;
      listen(doc, 'pointerdown', event => { if (event.isTrusted && event.button === 0) void unlock(); }, { capture: true, passive: true });
      listen(doc, 'keydown', event => { if (event.isTrusted && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) void unlock(); }, true);
      listen(doc, 'click', event => {
        if (!event.isTrusted || event.defaultPrevented) return;
        const button = event.target.closest?.('button,a[href],[role="button"]');
        if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true' || button.closest('#game-audio-settings')) return;
        play('ui-click');
      }, true);
      listen(doc, 'visibilitychange', () => {
        if (!doc.hidden) return;
        stop(); unlocked = false;
        try { void context?.suspend?.()?.catch(() => {}); } catch (_) {}
      });
      listen(env, 'pagehide', () => { stop(); unlocked = false; });
      listen(env, 'xiuxian:user-data-ready', () => { stop(); seen.clear(); lastPlayed.clear(); groups.clear(); syncControls(); });
      listen(env, 'xiuxian:friend-request', () => play('reward-chime', { priority: 30, volume: .6 }));
      listen(env, 'xiuxian:features-ready', mount);
      if (doc.readyState === 'loading') listen(doc, 'DOMContentLoaded', mount, { once: true }); else mount();
      void preload();
    }
    function diagnostics() {
      return { ...counts, contextState: context?.state || 'locked', active: current?.id || null,
        voices: voices.size, pending: pending?.id || null, decoded: buffers.size, failed: [...failedAt.keys()],
        settings: preferences(), unlocked };
    }
    function dispose() {
      stop(); disposed = true; listeners.splice(0).forEach(remove => remove());
      try { void context?.close?.()?.catch(() => {}); } catch (_) {}
    }
    return Object.freeze({ play, answer, transition, stop, unlock, preload, preferences, setPreferences, diagnostics, install, dispose });
  }
  return Object.freeze({ SOUNDS, createAudioManager });
});
