'use strict';

const crypto = require('node:crypto');
const { playerRepository } = require('./server-repositories.cjs');
const { verifyMainIdentity } = require('./raid-question-ticket.cjs');

const RECEIPTS = 'dailyVocabularyRewards';
const fail = (message, status = 400, code = 'invalid-argument') =>
  Object.assign(new Error(message), { status, code });
const amount = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
const receiptId = (uid, date) => crypto.createHash('sha256').update(uid + ':' + date).digest('hex');
const modules = () => import('./public/cultivation/daily-vocabulary-rules.mjs');

function validateLesson(input, rules) {
  const { date, sequence, level, words, answers } = input || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) ||
      !Number.isSafeInteger(sequence) || sequence < 0 || sequence > 1_000_000 ||
      !Number.isInteger(level) || !rules.STEPS[level] ||
      !Array.isArray(words) || words.length !== rules.LESSON_SIZE ||
      !Array.isArray(answers) || answers.length !== rules.LESSON_SIZE ||
      answers.some(answer => typeof answer !== 'string' || answer.length > 40)) {
    throw fail('單字測驗紀錄不完整，請重新確認。');
  }
  const dateTime = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(dateTime) || new Date(dateTime).toISOString().slice(0, 10) !== date) {
    throw fail('單字測驗日期無效。');
  }

  const progress = rules.openLesson({ ...rules.newProgress(), level }, date);
  const sameWords = expected => expected.length === words.length &&
    expected.every((word, index) => word === words[index]);
  if (sequence !== progress.lesson.sequence || !sameWords(progress.lesson.words)) {
    // Already-completed lessons from before the migration must remain claimable.
    // New dates never accept player-selected sequences or word sets.
    if (date > '2026-11-16' || !sameWords(rules.legacyWordsForSequence(sequence))) {
      throw fail('今日單字資料不符，請重新整理。');
    }
    progress.lesson = { ...progress.lesson, sequence, words };
  }
  const questions = rules.questionsFor(progress.lesson);
  for (let index = 0; index < answers.length; index++) {
    if (!rules.submitAnswer(progress, questions, index, answers[index])) {
      throw fail('單字測驗答案不完整，請重新確認。');
    }
    rules.nextQuestion(progress.lesson);
  }
  return { date, score: progress.lesson.result.score };
}

async function claim(db, uid, input, now = Date.now()) {
  const rules = await modules();
  const completed = validateLesson(input, rules);
  const today = rules.todayInTaipei(new Date(now));
  const userRef = db.collection('users').doc(uid);
  const receiptRef = db.collection(RECEIPTS).doc(receiptId(uid, completed.date));

  return db.runTransaction(async tx => {
    const [userSnap, receiptSnap] = await Promise.all([tx.get(userRef), tx.get(receiptRef)]);
    if (!userSnap.exists) throw fail('玩家資料不存在', 404, 'not-found');
    const user = userSnap.data();
    if (user.uid && user.uid !== uid) throw fail('玩家資料不符', 403, 'permission-denied');

    // Even a late retry returns the original receipt without awarding it twice.
    if (receiptSnap.exists) {
      const receipt = receiptSnap.data();
      return {
        date: receipt.date,
        reward: receipt.reward,
        score: receipt.score,
        alreadyClaimed: true,
        gold: amount(user.stats?.gold),
        totalScore: amount(user.stats?.totalScore),
      };
    }
    if (completed.date > today) {
      throw fail('單字測驗日期尚未到，請檢查裝置日期。', 409, 'future-date');
    }
    const gold = amount(user.stats?.gold) + rules.DAILY_REWARD.gold;
    const totalScore = amount(user.stats?.totalScore) + rules.DAILY_REWARD.cultivation;
    const receipt = {
      uid,
      date: completed.date,
      score: completed.score,
      reward: rules.DAILY_REWARD,
      claimedAtMs: now,
    };
    tx.set(receiptRef, receipt);
    tx.update(userRef, { 'stats.gold': gold, 'stats.totalScore': totalScore });
    return { ...receipt, gold, totalScore, alreadyClaimed: false };
  });
}

function register(app, { resolve = () => playerRepository.resolve(), verify = verifyMainIdentity, logger = console } = {}) {
  app.post('/api/daily-vocabulary/reward', async (req, res) => {
    res.set?.('Cache-Control', 'private, no-store');
    try {
      const uid = await verify(req);
      const result = await claim(resolve().db, uid, req.body);
      return res.json({ ok: true, ...result });
    } catch (error) {
      if (!error.status) logger.error('[Daily vocabulary reward]', error.message);
      return res.status(error.status || 503).json({
        ok: false,
        code: error.code || 'unavailable',
        error: error.status === 401 ? '登入已失效，請重新登入。'
          : error.status ? error.message : '獎勵暫時無法同步，請稍後重試。',
      });
    }
  });
}

module.exports = register;
module.exports.__test = { claim, validateLesson, receiptId, RECEIPTS };
