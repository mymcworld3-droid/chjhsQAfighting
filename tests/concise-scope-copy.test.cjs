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

test('normal scope selection uses a short direct instruction without numbered pages', () => {
  assert.doesNotMatch(curriculum, /STEP 0|cs-next|cs-prev/);
  assert.match(curriculum, /選好年級、科目，點選章節，再按下方儲存/);
  assert.match(curriculum, /<details id="cs-custom-range"/);
  assert.match(css, /\.cs-simple-heading p/);
  assert.match(studio, /curriculum-studio\.css\?v=20261102-scope-simple1/);
});
