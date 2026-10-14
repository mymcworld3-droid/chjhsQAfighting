const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const read = (path) => readFileSync(join(__dirname, '..', 'public', path), 'utf8');
const dongtian = read('cultivation/dongtian.js');
const curriculum = read('cultivation/curriculum-pages.js');
const css = read('styles/curriculum-studio.css');
const studio = read('cultivation/scope-fullscreen.js');
const firstVisit = read('cultivation/first-visit.js');
const tutorial = read('cultivation/newbie-tutorial-v2.js');

test('Dongtian creation keeps text and multiple-image entry without the lengthy AI explanation', () => {
  const start = dongtian.indexOf('<section class="dt-create">');
  const end = dongtian.indexOf('</section>', start);
  assert.ok(start >= 0 && end > start);
  const create = dongtian.slice(start, end);
  assert.match(create, /<h4>開闢新洞天<\/h4>/);
  assert.match(create, /id="dt-source-text"/);
  assert.match(create, /class="dt-upload-row"/);
  assert.doesNotMatch(create, /可同時提供多張圖片與文字|每次都會參考前面已生成的題目/);
});

test('normal scope selection hides STEP numbers and explanatory paragraphs only', () => {
  assert.match(curriculum, /class="cs-stage-title"><small>STEP 0/);
  assert.match(curriculum, /<h4>/);
  assert.match(css, /body:not\(:has\(#newbie-tutorial-layer\)\) #scope-studio:not\(\.fv-scope\) \.cs-stage-title > :is\(small,p\)\{display:none\}/);
  assert.match(studio, /curriculum-studio\.css\?v=20261014-scope-concise1/);
});

test('first-visit and guided newbie tutorial keep the existing scope instructions', () => {
  assert.match(firstVisit, /studio\.classList\.add\('fv-scope'\)/);
  assert.match(firstVisit, /第一步 · 選擇答題範圍/);
  assert.match(tutorial, /layer\.id='newbie-tutorial-layer'/);
  assert.match(tutorial, /kicker: '研修所 · 三步選課'/);
});
