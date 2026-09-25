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

test('semester and edition choices are automatic and both semesters feed one chapter list', () => {
  assert.match(script, /const AUTO_TERM='全學年',AUTO_EDITION='自動整合'/);
  assert.match(script, /id="cs-term" hidden aria-hidden="true"/);
  assert.match(script, /id="cs-edition" hidden aria-hidden="true"/);
  assert.match(script, /function mergeYearUnits\(yearData\)/);
  assert.match(script, /\['第一學期','第二學期'/);
  assert.match(script, /semester\['108課綱複習版'\]/);
  assert.match(script, /versions\.includes\('翰林版'\)\?'翰林版':versions\[0\]/);
  assert.doesNotMatch(script, /el\('cs-term'\)\.onchange/);
  assert.doesNotMatch(script, /el\('cs-edition'\)\.onchange/);
  assert.match(script, /termBadge\.textContent=u\.term==='第一學期'\?'上學期'/);
  assert.match(script, /\[canonicalSubject,grade,AUTO_TERM,subject\]\.join\('\/'\)/);
  assert.match(script, /\[subject,year\+'年級全學年'\]\.join\('\/'\)/);
});

test('verified Kang Hsuan first-semester grade-seven math includes 2-4 exponent rules', () => {
  const math = JSON.parse(fs.readFileSync(path.join(root, 'public/middle_school_unit_name/數學/math.json'), 'utf8'));
  const lessons = math.middle_school_math_courses['數學']['七年級']['第一學期']['康軒版'];
  assert.deepEqual(lessons.map(u => u.unit), [
    '第1章：整數的運算', '第2章：分數的運算', '第3章：一元一次方程式'
  ]);
  assert.ok(lessons[1].details.includes('2-4 指數律'));
});
