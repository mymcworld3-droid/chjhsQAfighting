const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../public');
const math = JSON.parse(fs.readFileSync(path.join(root, 'elementary_school_unit_name/math.json'), 'utf8'));
const core = JSON.parse(fs.readFileSync(path.join(root, 'elementary_school_unit_name/core.json'), 'utf8'));
const other = JSON.parse(fs.readFileSync(path.join(root, 'elementary_school_unit_name/other.json'), 'utf8'));
const selector = fs.readFileSync(path.join(root, 'cultivation/curriculum-scope.js'), 'utf8');
const quiz = fs.readFileSync(path.join(root, 'main-legacy.js'), 'utf8');
const grades = ['國小一年級','國小二年級','國小三年級','國小四年級','國小五年級','國小六年級'];
const terms = ['第一學期','第二學期'];
const subjects = { ...math.subjects, ...core.subjects, ...other.subjects };
test('elementary grades and semesters have stage-correct 108 curriculum learning maps', () => {
  const low = ['國語','數學','生活','健康與體育','本土語文'];
  const high = ['國語','英文','數學','自然科學','社會','藝術','綜合活動','健康與體育','本土語文'];
  for (const [index, grade] of grades.entries()) {
    const relevant = index < 2 ? low : high;
    for (const subject of relevant) {
      const data = subjects[subject]?.[grade];
      assert.ok(data, subject + '/' + grade);
      for (const term of terms) {
        const units = data[term]?.['108課綱複習版'];
        assert.ok(Array.isArray(units) && units.length >= 3, subject + '/' + grade + '/' + term);
        for (const u of units) {
          assert.ok(typeof u.unit === 'string' && u.unit.length > 1);
          assert.ok(Array.isArray(u.details) && u.details.length >= 2);
          assert.ok(u.details.every(s => typeof s === 'string' && s.length > 1));
        }
      }
    }
    for (const subject of index < 2 ? ['英文','社會','自然科學','藝術','綜合活動'] : ['生活']) {
      assert.equal(subjects[subject]?.[grade], undefined, subject + '/' + grade + ' must not be core');
    }
  }
});
test('publisher-labelled math offerings are explicitly partial and have sources', () => {
  for (const grade of grades) {
    const data = subjects['數學'][grade];
    const first = data['第一學期'];
    const second = data['第二學期'];
    assert.equal(Object.keys(first).length, 4, grade);
    assert.deepEqual(Object.keys(second), ['108課綱複習版']);
    for (const brand of ['南一','翰林','康軒']) {
      const partial = first['類' + brand + '版（目錄節錄）'];
      assert.equal(partial.length, 3);
      assert.deepEqual(partial.map(x => x.unit.slice(0, 2)), ['第1','第2','第3']);
    }
  }
  assert.ok(math.sources.some(s => s.includes('junyiacademy.org')));
});
test('elementary selector fetches elementary files, keeps actual subject and level in saved scope', () => {
  assert.match(selector, /elementary_school_unit_name/);
  assert.match(selector, /elementarySubjectList/);
  assert.match(selector, /data\.subjects\?\.\[subject\]\?\.\[grade\]/);
  assert.match(selector, /subject==='國語'\?'國文'/);
  assert.match(selector, /grade\.startsWith\('高中'\)\|\|grade\.startsWith\('國小'\)/);
  assert.match(quiz, /chosenGrade\.startsWith\('高中'\) \|\| chosenGrade\.startsWith\('國小'\)/);
  assert.match(quiz, /level: curriculumLevel/);
});
