'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const rulesModule = import('../public/cultivation/daily-vocabulary-rules.js');
const wordsModule = import('../public/cultivation/daily-vocabulary-words.js');

function dateFor(n) {
  return new Date(Date.UTC(2026, 10, 15 + n)).toISOString().slice(0, 10);
}

function complete(rules, progress, score) {
  const questions = rules.questionsFor(progress.lesson);
  for (const [index, question] of questions.entries()) {
    const wrong = question.format === 'spelling' ? '' : question.choices.find(choice => choice.id !== question.word.id).id;
    const correct = question.format === 'spelling' ? ' ' + question.word.id.toUpperCase() + ' ' : question.word.id;
    assert.equal(rules.submitAnswer(progress, questions, index, index < score ? correct : wrong), true);
    assert.equal(rules.submitAnswer(progress, questions, index, correct), false);
    rules.nextQuestion(progress.lesson);
  }
  assert.equal(progress.lesson.result.score, score);
  return progress.lesson.result;
}

test('the vocabulary bank supports at least 15 days of five distinct words in each band', async () => {
  const rules = await rulesModule;
  const { WORDS } = await wordsModule;
  assert.equal(new Set(WORDS.map(word => word.id)).size, WORDS.length);
  for (const { id } of rules.BANDS) {
    const bank = WORDS.filter(word => word.band === id);
    assert.ok(bank.length >= 75 && bank.length % 5 === 0, id);
    for (const word of bank) {
      assert.match(word.id, /^[a-z]+$/);
      assert.ok(['n.', 'v.', 'adj.', 'adv.'].includes(word.part), word.id);
      assert.ok(word.meaning && word.example.toLowerCase().includes(word.id), word.id);
      assert.equal(word.cloze.split('{}').length, 2, word.id);
      assert.ok(!word.cloze.toLowerCase().includes(word.id), word.id + ': cloze leaks answer');
    }
  }

  let progress = rules.newProgress();
  const seen = new Set();
  for (let offset = 0; offset < 15; offset++) {
    progress = rules.openLesson(progress, dateFor(offset));
    assert.equal(progress.lesson.words.length, 15);
    for (const { id } of rules.BANDS) {
      assert.equal(progress.lesson.words.filter(word => rules.wordFor(word).band === id).length, 5);
    }
    for (const word of progress.lesson.words) {
      assert.equal(seen.has(word), false, word);
      seen.add(word);
    }
    const reloaded = JSON.parse(JSON.stringify(progress));
    assert.equal(rules.openLesson(reloaded, dateFor(offset)), reloaded);
  }
});

test('the next local day begins at Taiwan midnight', async () => {
  const rules = await rulesModule;
  assert.equal(rules.todayInTaipei(new Date('2026-11-15T15:59:59Z')), '2026-11-15');
  assert.equal(rules.todayInTaipei(new Date('2026-11-15T16:00:00Z')), '2026-11-16');
  const old = rules.openLesson(rules.newProgress(), '2026-11-15');
  old.lesson.studied[old.lesson.words[0]] = true;
  const next = rules.openLesson(old, '2026-11-16');
  assert.deepEqual(next.lesson.studied, {});
  assert.equal(next.lesson.sequence, old.lesson.sequence + 1);
});

test('all players receive the same Taipei-date words regardless of join date or lessons skipped', async () => {
  const rules = await rulesModule;
  const date = '2026-11-16';
  const newPlayer = rules.openLesson(rules.newProgress(), date);
  let veteran = rules.newProgress();
  for (let offset = -10; offset < 0; offset++) {
    veteran = rules.openLesson(veteran, dateFor(offset + 1));
  }
  veteran = rules.openLesson(veteran, date);
  assert.deepEqual(veteran.lesson.words, newPlayer.lesson.words);
  assert.equal(veteran.lesson.sequence, newPlayer.lesson.sequence);
  assert.deepEqual(rules.dailyWordsFor(date), newPlayer.lesson.words);

  const latePlayer = rules.openLesson(rules.newProgress(), dateFor(10));
  const regularPlayer = rules.openLesson(newPlayer, dateFor(10));
  assert.deepEqual(latePlayer.lesson.words, regularPlayer.lesson.words);

  const stale = { ...newPlayer, lesson: { ...newPlayer.lesson,
    sequence: 9, words: rules.legacyWordsForSequence(9), studied: { transit: true }, index: 1,
    answers: [{ value: 'transit', correct: true }] } };
  const migrated = rules.openLesson(stale, date);
  assert.deepEqual(migrated.lesson.words, newPlayer.lesson.words);
  assert.equal(migrated.lesson.sequence, newPlayer.lesson.sequence);
  assert.deepEqual(migrated.lesson.studied, {});
  assert.deepEqual(migrated.lesson.answers, []);
  assert.equal(migrated.lesson.index, 0);

  const preserved = { ...newPlayer, lesson: { ...newPlayer.lesson, sequence: 0,
    studied: { [newPlayer.lesson.words[0]]: true } } };
  assert.deepEqual(rules.openLesson(preserved, date).lesson.studied, preserved.lesson.studied);
  assert.equal(rules.openLesson(preserved, date).lesson.sequence, newPlayer.lesson.sequence);
});

test('a resumed quiz preserves question order, options and completed answers', async () => {
  const rules = await rulesModule;
  const progress = rules.openLesson(rules.newProgress(), dateFor(0));
  const questions = rules.questionsFor(progress.lesson);
  const first = questions[0];
  assert.equal(rules.submitAnswer(progress, questions, 0, 'invalid-option'), false);
  assert.equal(rules.submitAnswer(progress, questions, 0, first.word.id), true);
  rules.nextQuestion(progress.lesson);
  const reloaded = JSON.parse(JSON.stringify(progress));
  assert.deepEqual(rules.questionsFor(reloaded.lesson), questions);
  assert.equal(reloaded.lesson.index, 1);
  assert.equal(reloaded.lesson.answers.length, 1);
  assert.equal(rules.submitAnswer(reloaded, questions, 0, first.word.id), false);

  for (const question of questions) {
    assert.equal(question.choices.length, 4);
    assert.equal(new Set(question.choices.map(choice => choice.label)).size, 4);
    assert.ok(question.choices.some(choice => choice.id === question.word.id));
    for (const choice of question.choices) {
      assert.equal(rules.wordFor(choice.id).part, question.word.part);
    }
  }
});

test('only three completed daily quizzes can move one difficulty level, and the new mix starts next day', async () => {
  const rules = await rulesModule;
  let progress = rules.newProgress();
  for (let i = 0; i < 3; i++) {
    progress = rules.openLesson(progress, dateFor(i));
    assert.equal(progress.lesson.level, 0);
    const result = complete(rules, progress, 12);
    assert.equal(result.nextLevel, i === 2 ? 1 : 0);
  }
  assert.equal(rules.openLesson(progress, dateFor(2)), progress);
  assert.deepEqual(progress.lastEvaluation, { percent: 80, before: 0, after: 1 });
  for (let i = 3; i < 6; i++) {
    progress = rules.openLesson(progress, dateFor(i));
    assert.equal(progress.lesson.level, 1);
    const questions = rules.questionsFor(progress.lesson);
    assert.equal(questions.filter(q => q.format === 'spelling').length, 3);
    complete(rules, progress, 14);
  }
  progress = rules.openLesson(progress, dateFor(6));
  assert.equal(rules.questionsFor(progress.lesson).filter(q => q.format === 'spelling').length, 9);
  for (let i = 6; i < 9; i++) {
    progress = rules.openLesson(progress, dateFor(i));
    complete(rules, progress, 8);
  }
  assert.equal(progress.level, 1);
  assert.deepEqual(progress.lastEvaluation, { percent: 53, before: 2, after: 1 });
});

test('a missed question is due the next day, and success on review lengthens its interval only once', async () => {
  const rules = await rulesModule;
  let progress = rules.openLesson(rules.newProgress(), dateFor(0));
  const questions = rules.questionsFor(progress.lesson);
  const id = questions[0].word.id;
  const wrong = questions[0].choices.find(choice => choice.id !== id).id;
  assert.equal(rules.submitAnswer(progress, questions, 0, wrong), true);
  assert.deepEqual(progress.review[id], { box: 0, due: dateFor(1) });
  assert.deepEqual(progress.scores, []);
  assert.deepEqual(rules.dueWords(progress), []);
  progress = rules.openLesson(progress, dateFor(1));
  assert.deepEqual(rules.dueWords(progress), [id]);
  rules.rateCard(progress, id, true);
  rules.rateCard(progress, id, true);
  assert.deepEqual(progress.review[id], { box: 1, due: dateFor(4) });
  assert.deepEqual(rules.dueWords(progress), []);
  progress = rules.openLesson(progress, dateFor(4));
  assert.deepEqual(rules.dueWords(progress), [id]);
  rules.rateCard(progress, id, false);
  assert.deepEqual(progress.review[id], { box: 0, due: dateFor(5) });
});
