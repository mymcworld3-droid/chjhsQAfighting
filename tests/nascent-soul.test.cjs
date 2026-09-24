const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const read = name => readFileSync(join(__dirname, '..', name), 'utf8');
const source = read('public/cultivation/nascent-soul-rules.js');
const rules = vm.runInNewContext(source.replace(/^export /gm, '') +
  '\n({ NASCENT_SOUL_TYPES, nascentSoulForCore, nascentSoulStage, nascentSoulSpiritReward })');
const { NASCENT_SOUL_TYPES, nascentSoulForCore, nascentSoulStage, nascentSoulSpiritReward } = rules;

test('all nine golden cores map to separate nascent souls with a talent', () => {
  const ids = ['ocean','taichu','ningxin','pojing','xingchen','wugou','thunder','reverse','sword'];
  assert.deepEqual(Object.keys(NASCENT_SOUL_TYPES).sort(), ids.sort());
  assert.equal(new Set(ids.map(id => nascentSoulForCore(id).name)).size, 9);
  for (const id of ids) {
    assert.ok(nascentSoulForCore(id).trait);
    assert.ok(nascentSoulForCore(id).description);
  }
});

test('spirit increases only for eligible correct solo answers and full daily meditation', () => {
  const gain = nascentSoulSpiritReward;
  assert.equal(gain({source:'solo',score:67,isCorrect:true}),0);
  assert.equal(gain({source:'solo',score:68,isCorrect:true}),1);
  assert.equal(gain({source:'solo',score:128,isCorrect:false}),0);
  assert.equal(gain({source:'daily-meditation',score:68,correct:3,total:3}),3);
  assert.equal(gain({source:'daily-meditation',score:68,correct:2,total:3}),0);
  assert.equal(gain({source:'daily-meditation',score:28,correct:3,total:3}),0);
});

test('each cave completion awards number of correct answers; stage thresholds are monotone', () => {
  const gain = nascentSoulSpiritReward;
  assert.equal(gain({source:'dongtian',score:68,correct:7,total:10}),7);
  assert.equal(gain({source:'dongtian',score:68,correct:999,total:10}),10);
  assert.equal(gain({source:'dongtian',score:67,correct:7,total:10}),0);
  assert.equal(nascentSoulStage(29).name,'初生');
  assert.equal(nascentSoulStage(30).name,'凝神');
  assert.equal(nascentSoulStage(250).name,'圓滿');
});

test('rewards persist through existing settlement, and cave replay is idempotent by runId', () => {
  const solo = read('public/main-legacy.js');
  const daily = read('public/cultivation/daily-meditation.js');
  const cave = read('public/cultivation/dongtian.js');
  const training = read('public/cultivation/cultivation-training-v4.js');
  assert.match(solo,/stats\.nascentSoulSpirit = normalizeSpirit\(stats\.nascentSoulSpirit\) \+ spiritAdded/);
  assert.match(daily,/lastDate === current\.date[\s\S]*'stats\.nascentSoulSpirit': increment\(spiritAdded\)/);
  assert.match(cave,/lastSpiritRunId === s\.runId/);
  assert.match(cave,/lastSpiritRunId: s\.runId/);
  assert.match(cave,/if \(spiritAdded\) tx\.update\(playerRef, \{ 'stats\.nascentSoulSpirit': increment\(spiritAdded\) \}\)/);
  assert.match(training,/activeTab === 'nascent-soul' \? nascentSoulTabMarkup\(\)/);
});
