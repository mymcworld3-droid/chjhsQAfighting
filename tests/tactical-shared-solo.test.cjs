'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { database } = require('./helpers/tactical-db.cjs');
const { __test: battle } = require('../tactical-combat-api.cjs');
const receipt = require('../solo-question-receipt.cjs');
const catalog = require('../bank-catalog.cjs').createBankCatalog(path.join(__dirname, '../public'));

const key = Buffer.alloc(32, 42);
const read = (uid, input) => receipt.read(uid, input, key);
const parsed = { q: '二加三的結果為何？', correct: '5', wrong: ['3', '6', '4'], exp: '二加三等於五。', subject: '數學' };
const uid = 'u1';

function aiAnswer(room, { question = parsed, choice = 2, recoveryOrigin } = {}) {
  const proof = receipt.issue(uid, question, { difficulty: 'hard', recoveryOrigin }, key);
  return {
    roomId: room.id, turn: room.turn, questionId: 'solo-' + proof.split('.')[1], choice,
    soloQuestion: { proof, question: question.q, options: [...question.wrong.slice(0, 2), question.correct, question.wrong[2]] }
  };
}

test('the ordinary queued question can be graded without reserving a battle slot and concurrent retries settle it once', async () => {
  const db = database();
  const room = await battle.start(db, uid, { mode: 'pve' });
  const input = aiAnswer(room);
  const submit = () => battle.answer(db, uid, input, Date.now(), read);
  const results = await Promise.all([submit(), submit()]);
  for (const state of results) {
    assert.equal(state.review.correct, true);
    assert.equal(state.review.gain, 4);
    assert.equal(state.actors[0].answered, 1);
    assert.equal(state.progress.stats.totalAnswered, 1);
  }
  assert.equal([...db.records.keys()].filter(key => key.startsWith('exam_logs/')).length, 1);
  assert.equal(db.records.get(battle.ROOMS + '/' + room.id).pending[uid], undefined);
});

test('the server accepts the queued option order and rejects altered text, choices and another account’s receipt', async () => {
  const db = database();
  const room = await battle.start(db, uid, { mode: 'pve' });
  const input = aiAnswer(room);
  for (const altered of [{ question: '改寫題目' }, { options: ['1', '2', '3', '4'] }]) {
    await assert.rejects(
      battle.answer(db, uid, { ...input, soloQuestion: { ...input.soloQuestion, ...altered } }, Date.now(), read),
      /驗證失敗/
    );
  }
  assert.equal(read('u2', input.soloQuestion), null);
  await assert.rejects(battle.answer(db, uid, { ...input, turn: room.turn + 1 }, Date.now(), read), /回合已更新/);
  const options = [...input.soloQuestion.options].reverse();
  const answered = await battle.answer(db, uid, { ...input, choice: 1, soloQuestion: { ...input.soloQuestion, options } }, Date.now(), read);
  assert.equal(answered.review.correct, true);
  assert.deepEqual(answered.review.opts, options);
});

test('an approved file-bank question with more than four options uses the original catalog answer', async () => {
  const db = database();
  const source = '高中';
  const question = catalog.load(source).questions.find(item => item.wrong.length >= 4);
  assert.ok(question);
  db.records.get('users/' + uid).gameSettings = { sourceMode: 'bank', source };
  const room = await battle.start(db, uid, { mode: 'pve' });
  const options = [...question.wrong, question.correct];
  const drawId = 'bank-test-draw';
  const input = {
    roomId: room.id, turn: room.turn, questionId: 'bank-' + drawId, choice: options.length - 1,
    soloQuestion: { question: question.q, options, bankId: question.id, drawId }
  };
  const answered = await battle.answer(db, uid, input);
  assert.equal(answered.review.correct, true);
  assert.deepEqual(answered.review.opts, options);
});

test('a verified correction keeps the original mistake reference and awards recovery only once', async () => {
  const db = database();
  const room = await battle.start(db, uid, { mode: 'pve' });
  await battle.answer(db, uid, aiAnswer(room, { choice: 0 }), Date.now(), read);
  const correction = { ...parsed, q: '三加三的結果為何？', correct: '6', wrong: ['3', '5', '4'] };
  const next = await battle.answer(db, uid, aiAnswer(room, { question: correction, recoveryOrigin: parsed.q }), Date.now(), read);
  assert.equal(next.review.correct, true);
  assert.match(next.review.reward.learning, /訂正成功/);
  assert.equal(next.progress.stats.soloLearningV1.mistakes['q:' + parsed.q].recovered, true);
});

test('an independently confirmed unanswered question is skipped once and cannot later be graded', async () => {
  const db = database();
  const room = await battle.start(db, uid, { mode: 'pve' });
  const input = aiAnswer(room);
  const report = await battle.reportQuestion(db, uid, { ...input, reason: '題目的條件明顯缺失' }, {
    readReceipt: read,
    review: async () => ({ status: 'confirmed', reason: '題目缺少關鍵條件。', issueType: 'question' }),
    award: async () => ({ compensated: false, status: 'limit', reason: '今日達到補償上限。' })
  });
  assert.equal(report.questionSkipped, true);
  assert.equal(report.staminaRefunded, 4);
  await assert.rejects(battle.answer(db, uid, input, Date.now(), read), /已結算/);
});
