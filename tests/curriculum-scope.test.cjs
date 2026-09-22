const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'public/cultivation/curriculum-scope.js'), 'utf8');
const boot = fs.readFileSync(path.join(root, 'public/main.js'), 'utf8');
const legacy = fs.readFileSync(path.join(root, 'public/main-legacy.js'), 'utf8');

test('curriculum selector parses and loads before Dongfu', () => {
  execFileSync(process.execPath, ['--check', path.join(root, 'public/cultivation/curriculum-scope.js')]);
  assert.ok(boot.indexOf("'./cultivation/curriculum-scope.js'") < boot.indexOf("'./cultivation/dongfu-settings-collapsible.js'"));
  assert.match(script, /window\.renderSoloUnitSelectors=/);
  assert.match(script, /window\.renderSelectedUnitsList=/);
  assert.match(script, /window\.addCurrentUnitToSelection=/);
});

test('selected chapters and points use the existing focusedUnits contract', () => {
  assert.match(script, /sub_topics/);
  assert.match(script, /path,detail/);
  assert.match(legacy, /focusedUnits: \[\.\.\.\(window\.soloSelectedUnits \|\| \[\]\)\]/);
  assert.match(legacy, /const randomUnit = settings\.focusedUnits/);
});

test('all structured junior-high course data is valid JSON with subject, grade and edition layers', () => {
  for (const relative of [
    '國文/chinese.json', '英文/english.json', '數學/math.json',
    '生物理化/science.json', '歷史/history.json', '地理/geogrophy.json',
    '公民/civics.json'
  ]) {
    const data = JSON.parse(fs.readFileSync(path.join(root, 'public/middle_school_unit_name', relative), 'utf8'));
    const rootKey = Object.keys(data)[0];
    assert.ok(rootKey, relative);
    assert.ok(Object.values(data[rootKey]).some(value => value && typeof value === 'object'), relative);
  }
});

test('verified Kang Hsuan first-semester grade-seven math includes 2-4 exponent rules', () => {
  const math = JSON.parse(fs.readFileSync(path.join(root, 'public/middle_school_unit_name/數學/math.json'), 'utf8'));
  const lessons = math.middle_school_math_courses['數學']['七年級']['第一學期']['康軒版'];
  assert.deepEqual(lessons.map(u => u.unit), [
    '第1章：整數的運算', '第2章：分數的運算', '第3章：一元一次方程式'
  ]);
  assert.ok(lessons[1].details.includes('2-4 指數律'));
});
