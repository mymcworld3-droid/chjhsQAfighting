const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createBankCatalog, registerBankApi } = require('../bank-catalog.cjs');
const root = path.join(__dirname, '..');

function fixture(t) {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-catalog-'));
  t.after(() => fs.rmSync(publicDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(publicDir, 'banks'));
  const write = (name, questions) => fs.writeFileSync(path.join(publicDir, 'banks', name), JSON.stringify(questions));
  const question = { id: 'exam-q1', q: '下列何者正確？', correct: '正解', wrong: ['錯一', '錯二', '錯三'], source: { exam: 'exam', question: 1 } };
  return { publicDir, write, question };
}

test('duplicate source questions are returned once; different source question numbers survive', t => {
  const { publicDir, write, question } = fixture(t);
  fs.mkdirSync(path.join(publicDir, 'banks', 'year'));
  write('year/a.json', [question]);
  write('year/b.json', [question, { ...question, source: { exam: 'exam', question: 2 } }]);
  const result = createBankCatalog(publicDir).load('year');
  assert.equal(result.questions.length, 2);
  assert.equal(result.duplicates, 1);
});

test('missing images gate a question until every expected image exists without changing JSON', t => {
  const { publicDir, write, question } = fixture(t);
  const refs = ['/assets/banks/cap-114-math/Q1-question.png', '/assets/banks/cap-114-math/G1-2-context.png'];
  write('exam.json', [{ ...question, requiredImages: refs }]);
  const catalog = createBankCatalog(publicDir);
  assert.equal(catalog.list().banks[0].pendingImages, 1);
  fs.mkdirSync(path.join(publicDir, 'assets/banks/cap-114-math'), { recursive: true });
  for (const ref of refs) fs.writeFileSync(path.join(publicDir, ref.slice(1)), 'image-fixture');
  assert.equal(catalog.load('exam.json').questions.length, 1);
  assert.equal(catalog.list().banks[0].pendingImages, 0);
});

test('unsafe source/image paths, non-array metadata and malformed questions are not playable', t => {
  const { publicDir, write, question } = fixture(t);
  write('metadata.json', { files: [] });
  write('exam.json', [{ ...question, requiredImages: ['/assets/banks/../../secret.png'] }, { ...question, correct: '錯一' }]);
  const catalog = createBankCatalog(publicDir);
  assert.equal(catalog.load('../secret').files.length, 0);
  assert.equal(catalog.load(['exam.json']).files.length, 0);
  assert.equal(catalog.load('exam.json').questions.length, 0);
  assert.equal(catalog.load('metadata.json').total, 0);
});

test('bank-only API reports absent and image-pending sources instead of returning AI questions', t => {
  const { publicDir, write, question } = fixture(t);
  write('exam.json', [{ ...question, requiredImages: ['/assets/banks/exam/Q1-question.png'] }]);
  const handlers = new Map();
  registerBankApi({ get: (route, fn) => handlers.set(route, fn) }, publicDir);
  const response = () => ({ code: 200, set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } });
  let res = response(); handlers.get('/api/bank-questions')({ query: { source: 'exam.json' } }, res);
  assert.equal(res.code, 409); assert.equal(res.body.pendingImages, 1);
  res = response(); handlers.get('/api/bank-questions')({ query: { source: '../../outside' } }, res);
  assert.equal(res.code, 404);
});

test('all imported banks have unique IDs, verified source answers, and resolvable image instructions', () => {
  const { banks } = JSON.parse(fs.readFileSync(path.join(root, 'data/bank-import/catalog.json')));
  const images = JSON.parse(fs.readFileSync(path.join(root, 'data/bank-import/images.json')));
  const paths = new Set(images.map(item => '/' + item.path.replace(/^public\//, '')));
  const ids = new Set();
  assert.equal(banks.length, 66);
  assert.equal(new Set(banks.map(item => item.file)).size, banks.length);
  for (const bank of banks) {
    const questions = JSON.parse(fs.readFileSync(path.join(root, 'public/banks', bank.file)));
    assert.equal(questions.length, bank.questionCount, bank.file);
    for (const q of questions) {
      assert.ok(!ids.has(q.id), q.id); ids.add(q.id);
      assert.ok(['easy', 'medium', 'hard'].includes(q.difficulty), q.id);
      assert.ok(q.source.answerUrl && q.source.url, q.id);
      assert.equal(new Set([q.correct, ...q.wrong]).size, 1 + q.wrong.length, q.id);
      for (const image of q.requiredImages) assert.ok(paths.has(image), image);
      if (!q.requiredImages.length) assert.doesNotMatch(q.q + q.correct + q.wrong.join(''), /[\ue000-\uf8ff\ufffd]/, q.id);
      if (q.passRate != null) assert.equal(q.difficulty, q.passRate > 0.75 ? 'easy' : q.passRate < 0.4 ? 'hard' : 'medium', q.id);
    }
  }
  assert.ok(ids.size > 2500);
});

test('reading subquestions share passages without being mistaken for the same pending bank question', () => {
  const source = fs.readFileSync(path.join(root, 'public/solo-question-cache.js'), 'utf8');
  const ctx = {};
  vm.runInNewContext(source.replaceAll('export const ', 'const ').replaceAll('export function ', 'function ') + '\nglobalThis.create = createSoloQuestionCache;', ctx);
  const cache = ctx.create({ getItem() {}, setItem() {} });
  cache.activate('user', 'bank');
  const quiz = id => ({ bankQuestionId: id, data: { q: '共用文章很長，題目只差空格編號。', opts: ['甲', '乙'], ans: 0, exp: '' }, rank: '', badge: '' });
  assert.equal(cache.append(quiz('reading-q21')), true);
  assert.equal(cache.append(quiz('reading-q22')), true);
  assert.equal(cache.append(quiz('reading-q21')), false);
  cache.takeNext(); cache.consumeActive({ remember: true });
  assert.equal(cache.getHistory()[0].bankQuestionId, 'reading-q21');
  assert.equal(cache.append(quiz('reading-q21')), true);
});

test('bank stems and choices are text JSON with only figure references', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/bank-import/catalog.json')));
  const all = catalog.banks.flatMap(bank => JSON.parse(fs.readFileSync(path.join(root, 'public/banks', bank.file))));
  assert.equal(all.length, 2591);
  for (const q of all) {
    assert.equal(q.contentFormat, 'text-and-figures-v2', q.id);
    assert.ok(!q.reviewRequired, q.id);
    const text = [q.q, q.correct, ...q.wrong].join('\n');
    assert.doesNotMatch(text, /原卷選項|請依下列原卷資料|@@FIG_|-(?:question|context)\.png/, q.id);
    const refs = [...text.matchAll(/!\[[^\]]*\]\((\/assets\/banks\/[^)]+)\)/g)].map(m => m[1]);
    assert.deepEqual([...new Set(refs)].sort(), [...q.requiredImages].sort(), q.id);
    assert.ok(q.q.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim().length > 4, q.id);
  }
  const get = id => all.find(q => q.id === id);
  assert.match(get('cap-109-math-q2').q, /2<sup>3<\/sup>/);
  assert.equal(get('cap-109-math-q3').correct, String.raw`$\frac{2}{5}$`);
  assert.match(get('cap-109-math-q4').q, /\\sqrt\{48\}/);
  assert.match(get('gsat-114-math-a-q2').q, /-\\frac\{4\}\{3\}/);
  assert.equal(get('gsat-111-math-a-q2').source.answer, '1');
  assert.equal(get('gsat-111-math-a-q5').source.answer, '2');
  assert.ok(!get('gsat-111-math-a-q13'));
  assert.ok(!get('gsat-112-math-b-q18'));
  assert.match(get('cap-112-english-q25').q, /Family trip to the South/);
  assert.ok(!get('gsat-112-social-q58').wrong.join('').includes('Q58-option-D'));
  assert.ok(!get('gsat-108-chinese-q4').requiredImages.length);
});

test('PDF columns, custom Chinese glyphs and circled option numbers retain their source meaning', () => {
  const { banks } = JSON.parse(fs.readFileSync(path.join(root, 'data/bank-import/catalog.json')));
  const questions = banks.flatMap(bank => JSON.parse(fs.readFileSync(path.join(root, 'public/banks', bank.file))));
  const get = id => questions.find(q => q.id === id);
  for (const q of questions.filter(q => q.id.startsWith('cap'))) {
    const choices = [q.correct, ...q.wrong].join('\n').replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    assert.doesNotMatch(choices, /[（(][A-D][）)]/, q.id);
    assert.doesNotMatch([q.q, choices].join('\n'), /[\u0400-\u1fff]/, q.id);
  }
  assert.equal(get('cap-114-math-q3').correct, '②和③');
  assert.equal(get('cap-111-chinese-q26').requiredImages.length, 1);
  assert.equal(get('cap-114-math-q11').requiredImages.length, 1);
  assert.equal(get('cap-113-math-q25').requiredImages.length, 0);
  assert.match(get('cap-113-math-q24').q, /100h-158/);
  assert.deepEqual(get('cap-110-science-q28').wrong, ['需有感覺神經元參與', '需有運動神經元參與', '經練習可縮短反應時間']);
  assert.match(get('cap-110-science-q28').q, /\| 時間\(秒\) \| 59 \| 48 \| 30 \| 35 \| 25 \|/);
  assert.doesNotMatch(get('cap-110-social-q33').q, /斯洛伐克|羅馬尼亞|273,710/);
  assert.equal(get('cap-112-social-q15').correct, '臺灣的紡織品出口至越南');
  assert.ok(get('cap-112-social-q15').requiredImages.length > 0);
});
