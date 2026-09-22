const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.join(__dirname, '../public');
const core = JSON.parse(fs.readFileSync(path.join(base, 'high_school_unit_name/core.json'), 'utf8'));
const humanities = JSON.parse(fs.readFileSync(path.join(base, 'high_school_unit_name/humanities.json'), 'utf8'));
const chooser = fs.readFileSync(path.join(base, 'cultivation/curriculum-scope.js'), 'utf8');
const legacy = fs.readFileSync(path.join(base, 'main-legacy.js'), 'utf8');
const G = ['高中一年級', '高中二年級', '高中三年級'];
const T = ['第一學期', '第二學期'];

test('high-school 108 study maps cover 11 subjects and two semesters across all three grades', () => {
  const all = { ...core.subjects, ...humanities.subjects };
  const required = ['國文', '英文', '數學', '數學A', '數學B', '數學甲', '數學乙',
    '物理', '化學', '生物', '地球科學', '歷史', '地理', '公民', '資訊科技'];
  for (const subject of required) assert.ok(all[subject], 'missing subject ' + subject);
  for (const subject of required) {
    const availableGrades = /^數學(?:A|B)$/.test(subject) ? [G[1]]
      : /^數學[甲乙]$/.test(subject) ? [G[2]]
      : subject === '數學' ? [G[0]] : G;
    assert.deepEqual(Object.keys(all[subject]).sort(), [...availableGrades].sort(), subject + ': grade split');
    for (const grade of availableGrades) for (const term of T) {
      const map = all[subject][grade][term];
      assert.ok(map, subject + '/' + grade + '/' + term);
      assert.ok(map['108課綱複習版']?.length >= 2, subject + '/' + grade + '/' + term);
      for (const unit of map['108課綱複習版']) {
        assert.equal(typeof unit.unit, 'string');
        assert.ok(unit.unit.length > 1);
        assert.ok(Array.isArray(unit.details) && unit.details.length >= 2);
        assert.ok(unit.details.every(x => typeof x === 'string' && x.length > 1));
      }
    }
  }
});

test('only independently sourced high-school math first-book editions are labelled as editions', () => {
  const first = core.subjects['數學'][G[0]][T[0]];
  assert.deepEqual(Object.keys(first).sort(), [
    '108課綱複習版', '三民版（108課綱初版）', '泰宇版（108課綱初版）', '翰林版（108課綱初版）'
  ].sort());
  assert.equal(first['翰林版（108課綱初版）'].length, 4);
  assert.equal(first['泰宇版（108課綱初版）'].length, 3);
  assert.ok(core.sources.some(s => s.includes('108shmath.blogspot.com')));
  assert.equal(humanities.kind, '108課綱複習整理');
});

test('grade-aware selector never uses junior-high unit files for high-school data', () => {
  assert.match(chooser, /sourcePath=\(sub,g\)=>g\.startsWith\('國小'\)/);
  assert.match(chooser, /g\.startsWith\('高中'\)\?'high_school_unit_name/);
  assert.match(chooser, /high_school_unit_name/);
  assert.match(chooser, /data\.subjects\?\.\[subject\]\?\.\[grade\]/);
  assert.match(chooser, /highSubjectList/);
  assert.match(chooser, /canonicalSubject/);
  assert.match(legacy, /const curriculumLevel =/);
  assert.match(legacy, /const studyTrack =/);
  assert.match(legacy, /level: curriculumLevel/);
});
