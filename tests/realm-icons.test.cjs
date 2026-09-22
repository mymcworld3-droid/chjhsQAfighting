const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const read = name => readFileSync(join(__dirname, '../public', name), 'utf8');
const icons = read('cultivation/realm-icons.js');
const css = read('realm-icons.css');
const theme = read('cultivation/cultivation-theme.js');
const live = read('cultivation/xiuxian-live-sync.js');
const breakthrough = read('cultivation/realm-breakthrough-feedback.js');
const legacy = read('main-legacy.js');
const main = read('main.js');
const manifest = JSON.parse(read('module-versions.json'));

const names = ['凡人','煉氣','築基','金丹','元嬰','化神','煉虛','合體','大乘','渡劫','登仙','真仙'];

test('every cultivation realm has a unique safe SVG crest and a color definition', () => {
  const window = {};
  const document = {
    querySelector: () => null,
    createElement: () => ({}),
    head: { appendChild() {} }
  };
  vm.runInNewContext(icons, { window, document });
  const marks = new Set();
  for (const name of names) {
    const svg = window.getRealmIconMarkup(name);
    assert.match(svg, /<svg viewBox="0 0 48 48"/);
    assert.match(svg, /aria-hidden="true"/);
    assert.ok(svg.includes('data-realm="' + name + '"'));
    assert.match(css, new RegExp('realm-icon\\[data-realm="' + name + '"\\]'));
    assert.doesNotMatch(svg, /[\\u{1F300}-\\u{1FAFF}]/u);
    assert.ok(!marks.has(svg), 'realm crests must differ: ' + name);
    marks.add(svg);
  }
  assert.match(window.getRealmIconMarkup('<img src=x>'), /data-realm="凡人"/);
  assert.doesNotMatch(window.getRealmIconMarkup('金丹', '" onclick="bad()'), /onclick/);
});

test('realm UI, breakthrough, chat and matchmaking no longer use realm emoji', () => {
  for (const code of [theme, live, breakthrough, legacy]) {
    const realmRows = code.match(/\\{ name: '(?:凡人|煉氣|築基|金丹|元嬰|化神|煉虛|合體|大乘|渡劫|登仙|真仙)', sub:[^\\n]+/g) || [];
    assert.ok(realmRows.length >= 20);
    for (const row of realmRows) assert.doesNotMatch(row, /emoji:/);
  }
  assert.match(theme, /function openRealmAtlas\\(/);
  assert.match(theme, /updateRankNode\\(rank, realm\\)/);
  assert.match(breakthrough, /realm-breakthrough-icon/);
  assert.match(legacy, /getRankMarkup\\(/);
  assert.doesNotMatch(theme, /alert\\(REALMS/);
});

test('shared icon module loads first and cache manifest contains all new resources', () => {
  assert.ok(main.indexOf("'./cultivation/realm-icons.js'") < main.indexOf("'./cultivation/cultivation-theme.js'"));
  for (const path of ['cultivation/realm-icons.js', 'realm-icons.css',
    'cultivation/cultivation-theme.js', 'cultivation/xiuxian-live-sync.js',
    'cultivation/realm-breakthrough-feedback.js', 'main-legacy.js', 'main.js',
    'realm-breakthrough-feedback.css']) {
    assert.match(manifest.files[path], /^[a-f0-9]{40}$/);
  }
});
