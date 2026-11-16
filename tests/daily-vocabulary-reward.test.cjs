'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../daily-vocabulary-reward-api.cjs').__test;
const { database } = require('./helpers/tactical-db.cjs');
const { setup } = require('./helpers/d1-db.cjs');
const rulesModule = import('../public/cultivation/daily-vocabulary-rules.mjs');
const now = Date.parse('2026-11-15T10:00:00Z');

async function completedLesson({ date = '2026-11-15', sequence = null, level = 0, wrongFirst = false } = {}) {
  const rules = await rulesModule;
  const progress = rules.openLesson({ ...rules.newProgress(), level }, date);
  const lesson = progress.lesson;
  if (sequence !== null) {
    lesson.sequence = sequence;
    lesson.words = rules.legacyWordsForSequence(sequence);
  }
  const questions = rules.questionsFor(lesson);
  const answers = questions.map((question, index) => {
    if (wrongFirst && index === 0) {
      return question.format === 'spelling' ? '' : question.choices.find(choice => choice.id !== question.word.id).id;
    }
    return question.word.id;
  });
  return { date, sequence: lesson.sequence, level, words: lesson.words, answers };
}

test('completion grants a fixed reward once, even across concurrent requests and later retries', async () => {
  const db = database();
  const lesson = await completedLesson({ wrongFirst: true });
  const [first, duplicate] = await Promise.all([
    api.claim(db, 'u1', lesson, now),
    api.claim(db, 'u1', lesson, now),
  ]);
  assert.deepEqual(first.reward, { gold: 100, cultivation: 2 });
  assert.equal(first.score, 14);
  assert.equal(first.alreadyClaimed, false);
  assert.equal(duplicate.alreadyClaimed, true);
  assert.equal(db.records.get('users/u1').stats.gold, 100);
  assert.equal(db.records.get('users/u1').stats.totalScore, 32);
  assert.equal(db.records.get(api.RECEIPTS + '/' + api.receiptId('u1', lesson.date)).score, 14);

  db.records.get('users/u1').stats.gold += 35;
  const late = await api.claim(db, 'u1', lesson, now + 4 * 86_400_000);
  assert.equal(late.alreadyClaimed, true);
  assert.equal(late.gold, 135);
  assert.equal(db.records.get('users/u1').stats.gold, 135);
});

test('reward validates the submitted lesson and answers instead of trusting a client score', async () => {
  const db = database();
  const original = await completedLesson({ level: 1 });
  const invalid = [
    { ...original, answers: original.answers.slice(1) },
    { ...original, words: [...original.words].reverse() },
    { ...original, answers: original.answers.map(() => 'wrong-choice') },
    { ...original, sequence: -1 },
    { ...original, level: 42 },
  ];
  for (const lesson of invalid) await assert.rejects(api.claim(db, 'u1', lesson, now), /單字|答案/);
  assert.equal(db.records.get('users/u1').stats.gold, 0);

  const withForgedScore = { ...original, answers: [...original.answers], score: 99 };
  const rules = await rulesModule;
  const q = rules.questionsFor({ ...original, index: 0 })[0];
  withForgedScore.answers[0] = q.format === 'spelling' ? '' : q.choices.find(choice => choice.id !== q.word.id).id;
  assert.equal((await api.claim(db, 'u1', withForgedScore, now)).score, 14);
});

test('a completed earlier lesson remains claimable, but a future lesson is rejected', async () => {
  const db = database();
  const yesterday = await completedLesson({ date: '2026-11-14' });
  const older = await completedLesson({ date: '2026-11-13' });
  const tomorrow = await completedLesson({ date: '2026-11-16' });
  await assert.rejects(api.claim(db, 'u1', tomorrow, now), error => error.code === 'future-date');
  assert.equal((await api.claim(db, 'u1', older, now)).gold, 100);
  assert.equal((await api.claim(db, 'u1', yesterday, now)).gold, 200);
  assert.equal((await api.claim(db, 'u1', await completedLesson(), now)).gold, 300);
});

test('personal legacy lessons only receive a temporary migration allowance', async () => {
  const db = database();
  const prior = await completedLesson({ date: '2026-11-15', sequence: 9 });
  assert.equal((await api.claim(db, 'u1', prior, now)).alreadyClaimed, false);

  const nextDate = '2026-11-17';
  const later = Date.parse('2026-11-17T10:00:00Z');
  const canonical = await completedLesson({ date: nextDate });
  const tampered = await completedLesson({ date: nextDate, sequence: 9 });
  await assert.rejects(api.claim(db, 'u2', tampered, later), /今日單字資料不符/);
  assert.equal((await api.claim(db, 'u2', canonical, later)).alreadyClaimed, false);
});

test('different accounts keep separate daily receipts', async () => {
  const db = database();
  const lesson = await completedLesson();
  await api.claim(db, 'u1', lesson, now);
  await api.claim(db, 'u2', lesson, now);
  assert.equal(db.records.get('users/u1').stats.gold, 100);
  assert.equal(db.records.get('users/u2').stats.gold, 100);
  assert.notEqual(api.receiptId('u1', lesson.date), api.receiptId('u2', lesson.date));
});

test('D1 transactions settle completion and reward together', async () => {
  const { db, sql } = setup();
  try {
    await db.collection('users').doc('u1').set({ uid: 'u1', stats: { gold: 50, totalScore: 10 } });
    const lesson = await completedLesson();
    const [a, b] = await Promise.all([api.claim(db, 'u1', lesson, now), api.claim(db, 'u1', lesson, now)]);
    assert.deepEqual([a.alreadyClaimed, b.alreadyClaimed].sort(), [false, true]);
    const player = (await db.collection('users').doc('u1').get()).data();
    assert.equal(player.stats.gold, 150);
    assert.equal(player.stats.totalScore, 12);
  } finally {
    sql.close();
  }
});
