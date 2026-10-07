const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../public/cultivation/curriculum-range-rules.js');
const item = (detail, path = '物理/高中二年級/自訂/物理', sub_topics = []) => ({ path, detail, sub_topics });

test('chapter lists split by common punctuation, newlines and chapter slashes', () => {
  for (const delimiter of ['、', ',', '，', ';', '；', '\n', '\r\n', '|', '｜', '。', '/', ' ／ ']) {
    assert.deepEqual(rules.parseChapters('功與動能' + delimiter + '角動量').details, ['功與動能', '角動量'], delimiter);
  }
  assert.deepEqual(rules.parseChapters(' 功與動能、、角動量；功與動能， ').details, ['功與動能', '角動量']);
});

test('math, decimal chapter numbers, quotes and parenthetical explanations retain internal punctuation', () => {
  assert.deepEqual(rules.parseChapters('動能（功、速率）、角動量').details, ['動能（功、速率）', '角動量']);
  assert.deepEqual(rules.parseChapters('「功與動能、角動量」；運動').details, ['「功與動能、角動量」', '運動']);
  assert.deepEqual(rules.parseChapters('2.1 功與動能、1/2 mv^2、比值 1:2').details, ['2.1 功與動能','1/2 mv^2','比值 1:2']);
  assert.deepEqual(rules.parseChapters('$f(x,y)=x/y$、$$L(x,y)$$；座標 (x,y)').details, ['$f(x,y)=x/y$','$$L(x,y)$$','座標 (x,y)']);
  assert.deepEqual(rules.parseChapters('\\(x,y\\)、\\[a,b\\]、集合 \\{x,y\\}').details, ['\\(x,y\\)','\\[a,b\\]','集合 \\{x,y\\}']);
  assert.deepEqual(rules.parseChapters('sin(x)/cos(x)、正/負數').details, ['sin(x)/cos(x)','正/負數']);
});

test('each chapter has its own length limit and delimiter-only input is rejected', () => {
  for (const value of ['', ' \n ', '、，；||', '字'.repeat(91), '字'.repeat(2401)]) assert.equal(rules.parseChapters(value).ok, false);
  const longBatch = Array.from({ length:24 }, (_,i) => i + '字'.repeat(80)).join('、');
  assert.equal(rules.parseChapters(longBatch).details.length, 24);
});

test('organize splits only custom items, keeps subject, grade and topic metadata, and deduplicates', () => {
  const catalog = item('功與動能、角動量', '物理/高中二年級/全學年/物理', ['功', '動能']);
  const custom = item(' 功與動能、角動量 ', undefined, ['共同考點']);
  const original = [catalog, custom, item('角動量', undefined, ['共同考點'])];
  const before = structuredClone(original), result = rules.organizeSelection(original);
  assert.equal(result.ok, true); assert.equal(result.split, 1); assert.equal(result.duplicates, 1);
  assert.deepEqual(result.units, [catalog, item('功與動能', undefined, ['共同考點']), item('角動量', undefined, ['共同考點'])]);
  assert.deepEqual(original, before, 'the original array and all entries remain untouched');
  assert.equal(rules.organizeSelection(result.units).changed, false, 'repeated organizing is stable');
});

test('chapter topic selections remain distinct from a full chapter', () => {
  const chapter = item('功與動能', '物理/高中二年級/全學年/物理', ['作功','動能']);
  const result = rules.mergeSelection([chapter], [chapter, item('功與動能', chapter.path, ['動能'])]);
  assert.equal(result.added, 1); assert.equal(result.units.length, 2);
});

test('capacity overflow never truncates a batch or loses a preexisting range', () => {
  const original = Array.from({length:23}, (_,i) => item('原章節'+i));
  const result = rules.mergeSelection(original, [item('功與動能'),item('角動量')]);
  assert.equal(result.ok,false); assert.equal(result.required,25); assert.equal(original.length,23);
  const combined = [...original,item('功與動能、角動量')], before = structuredClone(combined);
  assert.equal(rules.organizeSelection(combined).ok,false); assert.deepEqual(combined,before);
  assert.equal(rules.mergeSelection([...original,item('功與動能')],[item('功與動能')]).ok,true, 'duplicates do not consume capacity');
});

test('a mixed-grade share round-trips all chapter and topic data with no account information', () => {
  const selected = [item('功與動能'), item('一次函數 $f(x)={ax+b}$','數學/國中二年級/全學年/數學',['斜率','截距'])];
  selected[0].uid='private-uid'; selected[0].email='private@example.com';
  const shared = rules.shareSelection(selected);
  assert.equal(shared.ok,true); assert.match(shared.text,/功與動能/);
  assert.doesNotMatch(shared.text,/private|email|uid/);
  const expected = selected.map(({path,detail,sub_topics}) => ({path,detail,sub_topics}));
  assert.deepEqual(rules.readSharedSelection(shared.code).units,expected);
  assert.deepEqual(rules.readSharedSelection(shared.text).units,expected);
  assert.deepEqual(rules.readSharedSelection(shared.text.replace(/\n/g,'\r\n')).units,expected);
  assert.deepEqual(rules.mergeSelection(expected,rules.readSharedSelection(shared.text).units).units,expected);
});

test('organizing counts duplicate chapter names within a single old custom item', () => {
  const result=rules.organizeSelection([item('功與動能、功與動能')]);
  assert.equal(result.split,1); assert.equal(result.duplicates,1); assert.deepEqual(result.units,[item('功與動能')]);
});

test('import organizes old custom chapters and does not alter its shared payload', () => {
  const shared = rules.shareSelection([item('功與動能、角動量')]);
  const restored = rules.readSharedSelection(shared.text);
  assert.equal(restored.ok,true); assert.deepEqual(restored.units,[item('功與動能'),item('角動量')]);
  assert.equal(JSON.parse(shared.code).units[0].detail,'功與動能、角動量');
});

test('invalid, oversized, future and malformed imported lists are rejected before merging', () => {
  const encode = units => JSON.stringify({ schema:'qingyun-study-scopes', version:1, units });
  const valid = JSON.parse(rules.shareSelection([item('功')]).code);
  for (const value of ['', '{', '[]', '{}', JSON.stringify({...valid,version:2}), encode([]),
    encode(Array.from({length:25},()=>item('功'))), encode([null]), encode([item('功','未知科目/年級')]),
    encode([{...item('功'),detail:{unsafe:true}}]), encode([{...item('功'),sub_topics:['字'.repeat(201)]}]), 'x'.repeat(64001)]) {
    assert.equal(rules.readSharedSelection(value).ok,false,value.slice(0,100));
  }
  assert.equal(rules.shareSelection([]).ok,false);
});

test('scope text remains plain data, even when it contains HTML or prototype-like keys', () => {
  const shared = rules.shareSelection([item('<img src=x onerror=alert(1)>')]);
  const data = JSON.parse(shared.code); data.__proto__ = { hacked:true };
  const result = rules.readSharedSelection(JSON.stringify(data));
  assert.equal(result.ok,true); assert.equal(result.units[0].detail,'<img src=x onerror=alert(1)>');
  assert.equal({}.hacked,undefined);
});
