const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (p) => fs.readFileSync(path.join(__dirname, '../public', p), 'utf8');
const battle = read('cultivation/battle-mode-v2.js');
const css = read('styles/battle-mode-v2.css');

function loadAvatarController() {
  const from = battle.indexOf('  function avatarMarkup(id) {');
  const to = battle.indexOf('  function ensurePage() {', from);
  assert.ok(from >= 0 && to > from);
  const holders = new Map();
  const ctx = {
    document: { getElementById(id) { return holders.get(id) || null; } }
  };
  vm.runInNewContext(battle.slice(from, to) + '\nthis.avatar={avatarMarkup,setPlayerAvatar};', ctx);
  return {
    api: ctx.avatar,
    mount(id) {
      const fallback = { hidden: false };
      const img = {
        dataset: {}, hidden:true, loads:0, _src:'',
        removeAttribute(key) { if(key === 'src') this._src=''; },
        set src(value) { this._src=value; this.loads++; },
        get src() { return this._src; }
      };
      holders.set(id, { querySelector(sel) { return sel === 'img' ? img : sel === '.bv2-avatar-fallback' ? fallback : null; } });
      return {img,fallback};
    }
  };
}

test('room player snapshots carry saved equipped profile avatar, independent of core and combat power', () => {
  assert.match(battle, /avatar: String\(data\.equipped\?\.avatar \|\| ''\)/);
  assert.match(battle, /combatPower:/);
  assert.match(battle, /artifactBattle,/);
});

test('match lobby and versus intro retain independent player avatar slots', () => {
  for (const id of [
    'bv2-match-me-avatar', 'bv2-match-enemy-avatar',
    'bv2-intro-me-avatar', 'bv2-intro-enemy-avatar'
  ]) {
    assert.match(battle, new RegExp("avatarMarkup\\('" + id + "'\\)"));
    assert.match(battle, new RegExp("setPlayerAvatar\\('" + id + "'"));
  }
  assert.match(css, /\.bv2-avatar img\[hidden\]/);
  assert.match(css, /@media\(max-width:700px\)/);
});

test('avatar renderer shows saved image, avoids duplicate loads and falls back on missing or broken images', () => {
  const {api,mount} = loadAvatarController();
  const {img,fallback} = mount('match');
  assert.match(api.avatarMarkup('match'), /class="bv2-avatar"/);
  api.setPlayerAvatar('match', {name:'測試修士',avatar:'assets/avatars/test.png'});
  assert.equal(img.src,'assets/avatars/test.png');
  assert.equal(img.alt,'測試修士的頭像');
  assert.equal(img.hidden,true);
  img.onload();
  assert.equal(img.hidden,false);
  assert.equal(fallback.hidden,true);

  api.setPlayerAvatar('match', {name:'測試修士',avatar:'assets/avatars/test.png'});
  assert.equal(img.loads,1,'room snapshots should not restart an already-loaded avatar');
  img.onerror();
  assert.equal(img.hidden,true);
  assert.equal(fallback.hidden,false);

  api.setPlayerAvatar('match', null);
  assert.equal(img.src,'');
  assert.equal(img.hidden,true);
  assert.equal(fallback.hidden,false);

  api.setPlayerAvatar('match', {avatar:'javascript:alert(1)'});
  assert.equal(img.src,'');
  assert.equal(img.loads,1);
});
