const LOAD_TIMEOUT = 8_000;
const PLAY_TIMEOUT = 6_000;

export function createVocabularyPronunciation(env, onChange) {
  let active = null;
  let state = { word: '', status: 'idle' };
  const failedClips = new Set();

  function publish(word, status, source) {
    state = { word, status, source };
    onChange(state);
  }

  function finish(session, failed = false) {
    if (active !== session) return;
    active = null;
    env.clearTimeout(session.timer);
    try { session.cleanup?.(); } catch (_) {}
    if (failed && session.source === 'clip') failedClips.add(session.word);
    publish(session.word, failed ? 'error' : 'idle', session.source);
  }

  function watchdog(session, timeout) {
    env.clearTimeout(session.timer);
    session.timer = env.setTimeout(() => finish(session, true), timeout);
  }

  function started(session) {
    if (session !== active) return;
    if (session.source === 'clip') failedClips.delete(session.word);
    publish(session.word, 'playing', session.source);
    watchdog(session, PLAY_TIMEOUT);
  }

  function clip(session) {
    const audio = new env.Audio();
    session.cleanup = () => {
      audio.onplaying = audio.onended = audio.onerror = audio.onpause = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
    audio.onplaying = () => started(session);
    audio.onended = () => finish(session);
    audio.onerror = () => finish(session, true);
    audio.onpause = () => finish(session);
    audio.src = 'assets/audio/vocabulary/' + session.word + '.mp3';
    // iOS can require play() to be called directly inside the user's tap.
    audio.play()?.catch(() => finish(session, true));
  }

  function deviceVoice(session) {
    const speech = env.speechSynthesis;
    const utterance = new env.SpeechSynthesisUtterance(session.word);
    const voices = speech.getVoices().filter(voice => /^en(?:[-_]|$)/i.test(voice.lang));
    const isAmerican = voice => /^en[-_]us$/i.test(voice.lang);
    const voice = voices.find(voice => isAmerican(voice) && voice.localService)
      || voices.find(isAmerican) || voices.find(voice => voice.localService) || voices[0];
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || 'en-US';
    utterance.rate = .88;
    utterance.onstart = () => started(session);
    utterance.onend = () => finish(session);
    utterance.onerror = () => finish(session, true);
    session.cleanup = () => {
      utterance.onstart = utterance.onend = utterance.onerror = null;
      speech.cancel();
    };
    if (speech.paused) speech.resume();
    speech.speak(utterance);
  }

  function play(word) {
    if (!/^[a-z]+$/.test(word)) return;
    if (active?.word === word) {
      finish(active);
      return;
    }
    if (active) finish(active);
    const canPlayClip = typeof env.Audio === 'function';
    const canSpeak = typeof env.SpeechSynthesisUtterance === 'function' && !!env.speechSynthesis;
    const retryWithDevice = failedClips.has(word) && canSpeak;
    const source = !canPlayClip || retryWithDevice ? 'device' : 'clip';
    if (retryWithDevice) failedClips.delete(word);
    const session = { word, source };
    active = session;
    publish(word, 'loading', source);
    watchdog(session, LOAD_TIMEOUT);
    try {
      if (source === 'clip') clip(session);
      else if (canSpeak) deviceVoice(session);
      else finish(session, true);
    } catch (_) {
      finish(session, true);
    }
  }

  return {
    play,
    stop() { if (active) finish(active); },
    state() { return state; },
  };
}
