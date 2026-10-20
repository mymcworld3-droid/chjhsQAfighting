'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function screen(story = false) {
  const input = { value: '', focus() { this.focused = true; } };
  const error = { textContent: '' };
  const button = gender => ({ dataset: story ? { storyGender: gender } : { gender }, style: {},
    attrs: {}, disabled: false, setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(_, handler) { this.onclick = handler; } });
  const choices = [button('male'), button('female')], confirm = button('');
  const layer = { removed: false, innerHTML: '', remove() { this.removed = true; },
    querySelectorAll(selector) { return selector === 'button' ? [...choices, confirm] : choices; },
    querySelector(selector) {
      if (selector.includes('confirm')) return confirm;
      if (selector.includes('error')) return error;
      return input;
    } };
  return { input, error, choices, confirm, layer };
}

test('arrival role cards only select; empty names stay on screen until explicit valid confirmation', async () => {
  const ui = screen(), saves = [], errors = [];
  const ctx = vm.createContext({ user: { isAnonymous: false },
    window: { completeFirstVisitSetup: async (...args) => saves.push(args), dispatchEvent() {} },
    panel(title, body, actions) {
      assert.match(body, /id="fv-name"[^>]*required/);
      assert.doesNotMatch(body, /value=/);
      assert.match(actions, /id="fv-confirm">確定/);
      return ui.layer;
    }, portraits: ['male.png', 'female.png'],
    $: id => id === 'fv-name' ? ui.input : null,
    action: async task => { try { await task(); } catch (e) { errors.push(e.message); } },
    error() {}, store() {}, removeLayer() { ui.layer.remove(); }, CustomEvent: class {} });
  const source = read('public/cultivation/first-visit.js');
  vm.runInContext(source.slice(source.indexOf('  function gender()'), source.indexOf('  window.isFirstVisitActive')) + '\ngender();', ctx);
  ui.choices[0].onclick();
  assert.equal(saves.length, 0);
  assert.equal(ui.choices[0].attrs['aria-pressed'], 'true');
  ui.input.value = '   ';
  await ui.confirm.onclick();
  assert.match(errors.at(-1), /輸入/);
  assert.equal(ui.layer.removed, false);
  ui.input.value = ' 清風 ';
  ui.choices[1].onclick();
  assert.equal(saves.length, 0);
  await ui.confirm.onclick();
  assert.deepEqual(saves, [['female', '清風']]);
  assert.equal(ui.layer.removed, true);
});

test('story role selection requires confirmation and a failed name save can be retried', async () => {
  const ui = screen(true), saves = [];
  let fail = true;
  const ctx = vm.createContext({ active: false, LAYER_ID: 'story-layer', autoPermits: 0,
    document: { getElementById: () => null }, layer: () => ui.layer,
    playerPortraitPath: () => '', playerName: () => '青雲修士', escapeHtml: x => x,
    nextEligibleChapter: () => null,
    window: { updatePlayerDisplayName: async name => {
      if (fail) throw Error('請重新輸入名字');
      saves.push(['name', name]); return name;
    } }, persist: async patch => saves.push(['gender', patch.gender]) });
  const source = read('public/cultivation/story/story-engine.js');
  vm.runInContext(source.slice(source.indexOf('  function openGenderChoice('), source.indexOf('\n  function maybeAutoStart')) + '\nopenGenderChoice();', ctx);
  assert.match(ui.layer.innerHTML, /id="story-player-name"[^>]*value=""/);
  ui.choices[0].onclick();
  assert.equal(saves.length, 0);
  await ui.confirm.onclick();
  assert.match(ui.error.textContent, /輸入/);
  ui.input.value = ' 明月 ';
  await ui.confirm.onclick();
  assert.equal(ui.layer.removed, false);
  assert.equal(ui.confirm.disabled, false);
  fail = false;
  ui.choices[1].onclick();
  assert.equal(saves.length, 0);
  await ui.confirm.onclick();
  assert.deepEqual(saves, [['name', '明月'], ['gender', 'female']]);
  assert.equal(ui.layer.removed, true);
});
