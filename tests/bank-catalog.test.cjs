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
