'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const registerVocabularyAudio = require('../vocabulary-audio-api.cjs');

async function pronunciationHarness() {
  const { createVocabularyPronunciation } = await import('../public/cultivation/daily-vocabulary-pronunciation.mjs');
  const localVoice = { lang: 'en-US', localService: true };
  const clips = [];
  const spoken = [];
  const timers = new Map();
  let nextTimer = 0;
  const env = {
    Audio: class {
      constructor() { clips.push(this); }
      play() { this.playRequested = true; return Promise.resolve(); }
      pause() { this.paused = true; }
      removeAttribute() { this.src = ''; }
      load() {}
    },
    SpeechSynthesisUtterance: class {
      constructor(word) { this.text = word; }
    },
    speechSynthesis: {
      getVoices: () => [{ lang: 'zh-TW' }, { lang: 'en-US' }, localVoice],
      speak: utterance => spoken.push(utterance),
      cancel() {},
    },
    setTimeout(callback) {
      timers.set(++nextTimer, callback);
      return nextTimer;
    },
    clearTimeout(timer) { timers.delete(timer); },
  };
  const changes = [];
  const player = createVocabularyPronunciation(env, change => changes.push(change));
  return { player, clips, spoken, timers, localVoice, changes };
}

test('word audio requests playback on tap and discards callbacks after a card changes', async () => {
  const { player, clips, timers, changes } = await pronunciationHarness();
  player.play('afford');
  assert.equal(clips[0].src, 'assets/audio/vocabulary/afford.mp3');
  assert.ok(clips[0].playRequested);
  assert.equal(player.state().status, 'loading');
  clips[0].onplaying();
  assert.equal(player.state().status, 'playing');

  const previousEnd = clips[0].onended;
  player.play('achieve');
  assert.ok(clips[0].paused);
  previousEnd();
  assert.deepEqual(player.state(), { word: 'achieve', status: 'loading', source: 'clip' });
  player.play('achieve');
  assert.ok(clips[1].paused);
  assert.equal(player.state().status, 'idle');
  assert.equal(timers.size, 0);
  assert.deepEqual(changes.map(change => change.status), ['loading', 'playing', 'idle', 'loading', 'idle']);
});

test('word audio times out and retries in English with a new explicit tap', async () => {
  const { player, clips, spoken, timers, localVoice } = await pronunciationHarness();
  player.play('conduct');
  timers.values().next().value();
  assert.equal(player.state().status, 'error');
  assert.ok(clips[0].paused);
  assert.equal(spoken.length, 0);

  player.play('conduct');
  assert.equal(spoken[0].text, 'conduct');
  assert.equal(spoken[0].voice, localVoice);
  spoken[0].onstart();
  assert.deepEqual(player.state(), { word: 'conduct', status: 'playing', source: 'device' });
  spoken[0].onend();
  assert.equal(player.state().status, 'idle');
  assert.equal(timers.size, 0);
  player.play('conduct');
  assert.ok(clips[1].playRequested);
});

test('every vocabulary word has a native MP3 and a byte-range response', async t => {
  const { WORDS } = await import('../public/cultivation/daily-vocabulary-words.mjs');
  const app = express();
  registerVocabularyAudio(app);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => { server.close(); server.closeAllConnections?.(); });
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port + '/assets/audio/vocabulary/';

  for (const { id } of WORDS) {
    const clip = await fetch(url + id + '.mp3', { headers: { Range: 'bytes=0-2' } });
    assert.equal(clip.status, 206, id);
    assert.equal(clip.headers.get('content-type'), 'audio/mpeg');
    assert.equal(clip.headers.get('accept-ranges'), 'bytes');
    assert.match(clip.headers.get('content-range'), /^bytes 0-2\/\d+$/);
    assert.equal(Buffer.from(await clip.arrayBuffer()).toString('ascii'), 'ID3');
  }

  const path = url + WORDS[0].id + '.mp3';
  const full = await fetch(path);
  const etag = full.headers.get('etag');
  const data = Buffer.from(await full.arrayBuffer());
  const tail = await fetch(path, { headers: { Range: 'bytes=-16', 'If-Range': etag } });
  assert.equal(tail.status, 206);
  assert.deepEqual(Buffer.from(await tail.arrayBuffer()), data.subarray(-16));
  const unchanged = await fetch(path, { cache: 'force-cache', headers: { 'If-None-Match': etag } });
  assert.equal(unchanged.status, 304);
  assert.equal((await fetch(path, { headers: { Range: 'bytes=100000-' } })).status, 416);
  assert.equal((await fetch(url + 'missingword.mp3')).status, 404);
});
