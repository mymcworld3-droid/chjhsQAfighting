const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

test('Golden Cores are innate spirit-field cores, not external consumable pills', () => {
  const training = read('public/cultivation/cultivation-training-v4.js');
  const tutorial = read('public/cultivation/golden-core-tutorial.js');

  assert.match(training, /自身靈田／丹田中凝聚的本命金丹/);
  assert.match(training, /training-core-feature/);
  assert.match(training, /training-core-story/);
  assert.match(training, /此丹並非外來丹藥/);
  assert.match(training, /調御此丹相/);
  assert.doesNotMatch(training, /已裝配此金丹/);
  assert.doesNotMatch(training, />裝配此金丹</);

  assert.match(tutorial, /金丹不是外來丹藥/);
  assert.match(tutorial, /洗髓不是換一顆外來丹藥/);
  assert.match(tutorial, /重新洗鍊靈田中的本命金丹/);
  assert.match(tutorial, /調御此丹相/);
});

test('all nine Golden Cores retain distinct humorous notes', () => {
  const training = read('public/cultivation/cultivation-training-v4.js');

  const notes = [
    '水龍頭沒關會產生一種莫名的責任感',
    '無法返還已交出去的作業、已讀的訊息',
    '物理方式突破你的靜音結界',
    '請勿以額頭驗證丹力',
    '對著月亮圖示修煉',
    '再懷疑出題老師',
    '手機沒充到，頭髮倒先充滿了',
    '無法把星期一反轉成星期五',
    '萬劍只是尚未抵達'
  ];

  for (const note of notes) assert.match(training, new RegExp(note));
});

test('Golden Core status and downgrade warning use attunement terminology', () => {
  const status = read('public/cultivation/cultivation-status-panel.js');
  const warning = read('public/cultivation/cultivation-core-equip-warning.js');

  assert.match(status, /目前調御金丹/);
  assert.match(status, /ATTUNED CORE/);
  assert.match(status, /調御中/);
  assert.match(warning, /候選丹相/);
  assert.match(warning, /正在調御的本命金丹/);
  assert.match(warning, /先不調御/);
  assert.match(warning, /仍然調御/);
});
