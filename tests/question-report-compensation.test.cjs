const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const api = require('../question-report-api.cjs').__test;
const legacy = readFileSync(join(__dirname, '../public/main-legacy.js'), 'utf8');
const server = readFileSync(join(__dirname, '../server.js'), 'utf8');
const input = {
  question: '以下哪一個數是質數？',
  options: ['四', '六', '八', '十一'],
  correctIndex: 3,
  explanation: '十一只有一和十一兩個正因數。',
  userReason: '此題標示答案有誤，請檢查。'
};

test('report input validation and repeat key per player and question', () => {
  assert.equal(api.validateReport(input).question, input.question);
  assert.match(api.validateReport({ ...input, userReason: '錯了' }).error, /6/);
  assert.ok(api.validateReport({ ...input, correctIndex: 9 }).error);
  assert.equal(api.reportKey('uid-1', input.question), api.reportKey('uid-1', input.question));
  assert.notEqual(api.reportKey('uid-1', input.question), api.reportKey('uid-2', input.question));
  assert.equal(api.dateInTaiwan(new Date('2026-09-22T16:00:00Z')), '2026-09-23');
});

test('cultivation refund derives only from the actual recorded wrong-answer loss', () => {
  const base = { question: input.question, isCorrect: false, scoreBefore: 29, scoreAfter: 28, penalty: 1 };
  assert.equal(api.REWARD_GOLD, 100);
  assert.equal(api.BONUS_CULTIVATION, 1);
  assert.equal(api.actualCultivationRefund({ lastQuizAnswer: base }, input.question), 1);
  assert.equal(api.actualCultivationRefund({ lastQuizAnswer: { ...base, penalty: 0 } }, input.question), 0);
  assert.equal(api.actualCultivationRefund({ lastQuizAnswer: { ...base, scoreBefore: 28, scoreAfter: 28 } }, input.question), 0);
  assert.equal(api.actualCultivationRefund({ lastQuizAnswer: { ...base, isCorrect: true } }, input.question), 0);
  assert.equal(api.actualCultivationRefund({ lastQuizAnswer: { ...base, question: '另一道題' } }, input.question), 0);
  assert.equal(api.actualCultivationRefund({ lastQuizAnswer: { ...base, penalty: 100, scoreBefore: 150, scoreAfter: 50 } }, input.question), 1);
  assert.equal(api.actualCultivationRefund({}, input.question), 0);
});

test('two explicit AI confirmations are required; invalid output must not be a rejection', async () => {
  const approved = { determinate: true, hasError: true, confidence: 0.95, issueType: 'answer', reason: '解答不正確' };
  let calls = 0;
  const review = await api.reviewQuestion(input, {
    generate: async () => { calls++; return { data: approved }; }
  });
  assert.equal(review.status, 'confirmed');
  assert.equal(calls, 2);
  calls = 0;
  const refused = await api.reviewQuestion(input, {
    generate: async () => { calls++; return { data: { ...approved, hasError: false, issueType: 'none' } }; }
  });
  assert.equal(refused.status, 'rejected');
  assert.equal(calls, 1);
  calls = 0;
  const disagreement = await api.reviewQuestion(input, {
    generate: async () => {
      calls++;
      return { data: calls === 1 ? approved : { ...approved, confidence: 0.4 } };
    }
  });
  assert.equal(disagreement.status, 'rejected');
  assert.equal(calls, 2);
  const unknown = await api.reviewQuestion(input, { generate: async () => ({ data: { valid: true } }) });
  assert.equal(unknown.status, 'unavailable');
});

function fakeDatabase(gold = 100, score = 28, lastQuizAnswer = null) {
  const user = { uid: 'tester', stats: { gold, totalScore: score, lastQuizAnswer }, questionReportDaily: {} };
  const claims = new Map();
  let locked = Promise.resolve();
  const ref = (collection, id) => ({ collection, id, async get() { return { exists: claims.has(id), data: () => claims.get(id) }; } });
  const db = {
    collection(name) { return { doc(id) { return ref(name, id); } }; },
    async runTransaction(fn) {
      const execute = async () => {
        const creates = [], updates = [];
        const tx = {
          async get(target) {
            if (target.collection === 'users') return { exists: true, data: () => structuredClone(user) };
            return { exists: claims.has(target.id), data: () => claims.get(target.id) };
          },
          create(target, data) { creates.push([target, data]); },
          update(target, data) { updates.push([target, data]); }
        };
        const result = await fn(tx);
        for (const [target, data] of creates) {
          if (claims.has(target.id)) throw Error('duplicate create');
          claims.set(target.id, data);
        }
        for (const [, data] of updates) {
          if (data['stats.gold']) user.stats.gold += data['stats.gold'].amount;
          if (data['stats.totalScore']) user.stats.totalScore += data['stats.totalScore'].amount;
          user.questionReportDaily = data.questionReportDaily;
        }
        return result;
      };
      const task = locked.then(execute);
      locked = task.catch(() => {});
      return task;
    }
  };
  return { db, user, claims };
}

const fieldValue = {
  increment(amount) { return { amount }; },
  serverTimestamp() { return { timestamp: true }; }
};

test('Firestore transaction awards once even for parallel retries and preserves other stats', async () => {
  const { db, user, claims } = fakeDatabase(100, 28, {
    question: input.question, isCorrect: false, scoreBefore: 29, scoreAfter: 28, penalty: 1
  });
  const options = { today: () => '2026-09-23', fieldValue };
  const result = { reason: '雙重審核確認', issueType: 'answer' };
  const [a, b] = await Promise.all([
    api.awardOnce(db, 'tester', input, result, options),
    api.awardOnce(db, 'tester', { ...input, reason: '換理由' }, result, options)
  ]);
  assert.deepEqual(new Set([a.status, b.status]), new Set(['confirmed', 'duplicate']));
  assert.equal(user.stats.gold, 200);
  assert.equal(user.stats.totalScore, 30, 'refund one lost cultivation and add one bonus');
  assert.equal(a.cultivationAdded + b.cultivationAdded, 2);
  assert.equal(claims.size, 1);
  assert.equal(user.questionReportDaily.count, 1);
});

test('five daily claims cap is deterministic in Taiwan time and never reserves denied claims', async () => {
  const { db, user, claims } = fakeDatabase();
  const options = { today: () => '2026-09-23', fieldValue };
  for (let i = 0; i < api.DAILY_LIMIT; i++) {
    const award = await api.awardOnce(db, 'tester', { ...input, question: input.question + i }, { reason: '確認有誤' }, options);
    assert.equal(award.status, 'confirmed');
  }
  const denied = await api.awardOnce(db, 'tester', { ...input, question: input.question + 'extra' }, { reason: '確認有誤' }, options);
  assert.equal(denied.status, 'limit');
  assert.equal(claims.size, 5);
  assert.equal(user.stats.gold, 600);
  assert.equal(user.stats.totalScore, 33, 'five zero-refund claims each grant one cultivation');
  const duplicate = await api.awardOnce(db, 'tester', { ...input, question: input.question + '0' }, { reason: '重複' }, options);
  assert.equal(duplicate.status, 'duplicate');
});

function response() {
  return {
    code: 200,
    status(n) { this.code = n; return this; },
    set() { return this; },
    json(data) { this.body = data; return this; }
  };
}

test('endpoint rejects missing authentication before AI or any reward', async () => {
  const res = response();
  let calls = 0;
  const handler = api.createHandler({
    resolve: () => { calls++; throw Error('must never load DB'); },
    review: () => { calls++; throw Error('must never ask AI'); }
  });
  await handler({ body: input, get: () => '' }, res);
  assert.equal(res.code, 401);
  assert.equal(calls, 0);
  assert.equal(res.body.valid, null);
});

test('endpoint distinguishes review-unavailable and completed repeat claim from confirmed rewards', async () => {
  const verifyIdToken = async () => ({ uid: 'tester', aud: 'question-learning', iss: 'https://securetoken.google.com/question-learning' });
  const { db, claims } = fakeDatabase();
  const resolve = () => ({ auth: { verifyIdToken }, db });
  const request = { body: input, get: () => 'Bearer valid.token' };
  const log = { warn() {}, error() {} };
  const unavailable = api.createHandler({ resolve, review: async () => ({ status: 'unavailable', reason: 'AI 尚未完成' }), logger: log });
  const res = response();
  await unavailable(request, res);
  assert.equal(res.code, 503);
  assert.equal(res.body.compensated, false);
  assert.equal(claims.size, 0);
  const confirmed = api.createHandler({
    resolve,
    review: async () => ({ status: 'confirmed', reason: '兩次確認', issueType: 'answer' }),
    award: (database, uid, report, result) => api.awardOnce(database, uid, report, result, { today: () => '2026-09-23', fieldValue }),
    logger: log
  });
  const paid = response(), repeated = response();
  await confirmed(request, paid);
  await confirmed(request, repeated);
  assert.equal(paid.body.status, 'confirmed');
  assert.equal(paid.body.goldAdded, 100);
  assert.equal(paid.body.cultivationAdded, 1);
  assert.equal(repeated.body.status, 'duplicate');
  assert.equal(repeated.body.goldAdded, 0);
});

test('report API distinguishes AI timeout from compensation write failure', async () => {
  const verifyIdToken = async () => ({ uid: 'tester', aud: 'question-learning', iss: 'https://securetoken.google.com/question-learning' });
  const { db, claims } = fakeDatabase();
  const resolve = () => ({ auth: { verifyIdToken }, db });
  const request = { body: input, get: () => 'Bearer valid.token' };
  const logger = { warn() {}, error() {} };

  const timeout = response();
  await api.createHandler({
    resolve, logger, review: async () => { throw new Error('review deadline exceeded'); }
  })(request, timeout);
  assert.equal(timeout.code, 503);
  assert.equal(timeout.body.phase, 'ai-review');
  assert.match(timeout.body.reason, /逾時/);
  assert.equal(timeout.body.compensated, false);
  assert.equal(claims.size, 0);

  const failedAward = response();
  await api.createHandler({
    resolve, logger,
    review: async () => ({ status: 'confirmed', reason: '確認有誤', issueType: 'answer' }),
    award: async () => { throw new Error('Firestore write unavailable'); }
  })(request, failedAward);
  assert.equal(failedAward.code, 503);
  assert.equal(failedAward.body.phase, 'compensation');
  assert.match(failedAward.body.reason, /補償入帳/);
  assert.equal(failedAward.body.compensated, false);
  assert.equal(claims.size, 0);
});

test('solo UI does not award gold locally or skip on unavailable result', () => {
  assert.match(server, /registerQuestionReportApi\(app\)/);
  assert.doesNotMatch(server, /app\.post\('\/api\/verify-report'/);
  assert.match(legacy, /Authorization: 'Bearer ' \+ token/);
  assert.match(legacy, /reportSubmitting = true/);
  assert.match(legacy, /if \(result\.status === 'confirmed' && result\.compensated === true && result\.goldAdded === 100 &&/);
  assert.match(legacy, /stats\.lastQuizAnswer = \{/);
  assert.match(legacy, /if \(quiz\.answerPersistence\) await waitForReportAnswerSaved\(quiz\.answerPersistence\)/);
  assert.match(legacy, /quiz\.answerPersistence = p1;/);
  assert.match(legacy, /quiz\.answerPersistenceDeferred = !shouldSaveAnswer;/);
  assert.match(legacy, /if \(quiz\.answerPersistenceDeferred && !quiz\.answerPersistence\)/);
  assert.match(legacy, /void addDoc\(collection\(db, "exam_logs"\)/);
  assert.match(legacy, /console\.warn\('\[Quiz exam log\]'/);
  assert.match(legacy, /phase: error\?\.phase \|\| reportStage/);
  assert.doesNotMatch(legacy, /Promise\.all\(\[p1, p2\]\)/);
  assert.match(legacy, /currentUserData\.stats\.totalScore = Number\(result\.newTotalScore\)/);
  assert.match(legacy, /if \(result\.status === 'duplicate'\)/);
  assert.match(legacy, /if \(window\.currentActiveQuiz !== quiz\) return/);
  assert.doesNotMatch(legacy, /currentUserData\.stats\.gold = \(currentUserData\.stats\.gold \|\| 0\) \+ 20/);
});

test('report authentication separates missing Admin credentials, bad login, and temporary verification outages', async () => {
  const request = { body: input, get: () => 'Bearer valid.token' };
  const logger = { warn() {}, error() {} };
  const noCredentials = response();
  await api.createHandler({
    resolve: () => { throw new Error('Missing server credential for Firebase A'); },
    review: () => { throw Error('must not reach AI'); }, logger
  })(request, noCredentials);
  assert.equal(noCredentials.code, 503);
  assert.equal(noCredentials.body.phase, 'authentication-config');
  assert.equal(noCredentials.body.compensated, false);
  assert.match(noCredentials.body.reason, /Firebase A/);

  const fake = fakeDatabase();
  const wrongIdentity = response();
  await api.createHandler({
    resolve: () => ({ db: fake.db, auth: { verifyIdToken: async () => ({ uid: 'other', aud: 'wrong-project', iss: 'wrong' }) } }),
    review: () => { throw Error('must not reach AI'); }, logger
  })(request, wrongIdentity);
  assert.equal(wrongIdentity.code, 401);
  assert.equal(wrongIdentity.body.status, 'unauthorized');

  const expired = response();
  await api.createHandler({
    resolve: () => ({ db: fake.db, auth: { verifyIdToken: async () => { const e = Error('expired'); e.code = 'auth/id-token-expired'; throw e; } } }),
    review: () => { throw Error('must not reach AI'); }, logger
  })(request, expired);
  assert.equal(expired.code, 401);
  assert.equal(expired.body.phase, 'authentication');

  const outage = response();
  await api.createHandler({
    resolve: () => ({ db: fake.db, auth: { verifyIdToken: async () => { throw Error('service unreachable'); } } }),
    review: () => { throw Error('must not reach AI'); }, logger
  })(request, outage);
  assert.equal(outage.code, 503);
  assert.equal(outage.body.phase, 'authentication');
  assert.equal(fake.claims.size, 0);
});
