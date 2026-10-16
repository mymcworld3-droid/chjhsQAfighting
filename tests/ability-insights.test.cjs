'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../public/cultivation/ability-insights-core.js');
const abilityApi = require('../ability-coach-api.cjs');

test('a missing subject is not a zero score; single lucky answer is not mastery', () => {
  const output = Core.build({ 數學: { '函數': { correct: 1, total: 1 }, '微積分': { correct: 1, total: 9 } } },
    { 數學: ['函數', '微積分', '線性代數'], 英文: ['閱讀'] });
  const lucky = output.topics.find(x => x.topic === '函數');
  assert.equal(lucky.estimate, 60);
  assert.equal(lucky.status, '需要更多題');
  assert.equal(lucky.confidence, '不足');
  const notTried = output.topics.find(x => x.topic === '線性代數');
  assert.equal(notTried.estimate, null);
  assert.equal(notTried.rawAccuracy, null);
  assert.equal(notTried.status, '尚未練習');
  const unstudiedEnglish = output.domains.find(x => x.name === '語文');
  assert.equal(unstudiedEnglish.estimate, null);
  assert.equal(output.studiedTopics, 2);
});

test('recommendation chooses verified weaknesses before unmeasured topics', () => {
  const report = Core.build({ 數學: {
    '因式分解': { total: 12, correct: 2 },
    '數列': { total: 7, correct: 7 },
    '未試過': { total: 0, correct: 0 }
  } });
  assert.equal(report.priorities[0].topic, '因式分解');
  assert.equal(report.weaknesses[0].status, '優先補強');
  assert.equal(report.strengths.length, 1);
  assert.equal(report.strengths[0].topic, '數列');
});

test('recent trend requires at least five samples in both windows', () => {
  const now = new Date('2026-10-16T10:00:00Z').getTime();
  const records = [
    ...Array.from({ length: 5 }, (_, i) => ({ timestamp: new Date(now - (i + 1) * 86400000), subject: '數學', isCorrect: true })),
    ...Array.from({ length: 6 }, (_, i) => ({ timestamp: { seconds: Math.floor((now - (i + 8) * 86400000) / 1000) },
      subject: '數學', isCorrect: i < 3 })),
    { timestamp: new Date(now - 1 * 86400000), subject: '英文', isCorrect: false }
  ];
  const trend = Core.recentTrend(records, '數學', now);
  assert.deepEqual(trend, { recent: { count: 5, accuracy: 100 }, previous: { count: 6, accuracy: 50 }, delta: 50 });
  assert.equal(Core.recentTrend(records.slice(0, 4), null, now).delta, null);
});

test('AI summary excludes question bodies and personal identifiers', () => {
  const report = Core.build({ 數學: { '函數': { total: 10, correct: 4 } } });
  const summary = Core.aiSummary(report, '數學');
  assert.equal(summary.topics.length, 1);
  assert.equal(summary.topics[0].topic, '函數');
  assert.equal(summary.total, 10);
  assert.equal(summary.correct, 4);
  assert.doesNotMatch(JSON.stringify(summary), /email|uid|question|option|explanation/i);
  const mixed = Core.build({ 數學: { '函數': { total: 10, correct: 4 } },
    英文: { '閱讀': { total: 30, correct: 25 } } });
  assert.equal(Core.aiSummary(mixed, '數學').total, 10, 'subject-specific summaries do not include other subjects');
});

test('AI request sanitizes aggregates, validates response and rate-limits per uid', async () => {
  assert.equal(abilityApi.normalizeInput({ topics: [] }), null);
  const normalized = abilityApi.normalizeInput({ subject: '數學', topics: [
    { subject: '數學', topic: '機率', total: 8, correct: 19, secret: 'email@foo.com' }
  ] });
  assert.equal(normalized.topics[0].correct, 8);
  assert.doesNotMatch(JSON.stringify(normalized), /secret|foo.com/);
  assert.deepEqual(abilityApi.normalizeAdvice({ headline: '試試這樣做', plan: [
    { topic: '機率', action: '每天五題', questions: 999 }
  ] }).plan[0].questions, 10);
  assert.throws(() => abilityApi.normalizeAdvice({
    headline: '其他學科', plan: [{ topic: '不存在單元', action: '學習', questions: 3 }]
  }, normalized), /結構不完整/, 'AI cannot invent learning topics');
  let handler, modelCalls = 0;
  const app = { post(path, fn) { assert.equal(path, '/api/learning/ability-coach'); handler = fn; } };
  const fakeRouter = { async generateJSON() { modelCalls++; return {
    data: { headline: '循序補強', explanation: '資料有其限制', plan: [
      { topic: '機率', reason: '8 題', action: '先複習再練習', questions: 5 }
    ] }, provider: 'mock', model: 'mock'
  }; } };
  const time = new Date('2026-10-16T00:00:00Z').getTime();
  abilityApi(app, { verifyIdentity: async request => {
    if (request.noAuth) throw Object.assign(new Error('需要登入'), { status: 401 });
    return 'test-user-' + request.key;
  }, router: fakeRouter, now: () => time });
  async function invoke(req) {
    const result = {};
    const response = { status(n) { result.status = n; return this; },
      json(value) { result.json = value; return this; } };
    await handler(req, response); return result;
  }
  const noAuth = await invoke({ noAuth: true, body: { summary: normalized } });
  assert.equal(noAuth.status, 401); assert.equal(modelCalls, 0);
  const good = await invoke({ key: 'A', body: { summary: normalized } });
  assert.equal(good.json.ok, true); assert.equal(modelCalls, 1);
  const repeat = await invoke({ key: 'A', body: { summary: normalized } });
  assert.equal(repeat.status, 429); assert.equal(modelCalls, 1);
  const other = await invoke({ key: 'B', body: { summary: normalized } });
  assert.equal(other.json.ok, true);
});

test('legacy graph delegates to enhanced module and recent logs include subject metadata', () => {
  const legacy = fs.readFileSync(path.join(__dirname, '../public/main-legacy.js'), 'utf8');
  const entry = fs.readFileSync(path.join(__dirname, '../public/main.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(legacy, /window\.QAAbilityGraph\?\.render/);
  assert.match(legacy, /subTopic: String\(window\.currentActiveQuiz/);
  assert.match(entry, /cultivation\/ability-insights-ui\.js/);
  assert.match(server, /registerAbilityCoachApi\(app\)/);
});
