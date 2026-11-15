'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectQuestionFormat } = require('../question-format.cjs');
const { createAIQuestionBank, scopeCode } = require('../ai-question-bank.cjs');
const { reviewQuestion, validateReport } = require('../question-report-api.cjs').__test;
const { questionQualityIssue } = require('../question-quality.cjs');

const broken = {
  q: '以 $4.0\text{m/s}$ 滑行，已知質量為 2 kg，求停止時摩擦力所做的功。',
  correct: '$-16.0extJ$',
  wrong: ['$-8.0ext{J}$', '$-32.0 ext{J}$', '$16.0extJ$'],
  exp: '摩擦力做功等於動能的變化。'
};

test('trusted damaged units grant a format approval, and new damaged questions are rejected', async () => {
  const input = validateReport({
    question: broken.q, options: [broken.correct, ...broken.wrong], correctIndex: 0,
    explanation: broken.exp, userReason: '選項數值後面出現 ext。'
  });
  assert.equal((await reviewQuestion(input, {
    trusted: true, generate: async () => { throw Error('unexpected model request'); }
  })).status, 'confirmed');
  assert.match(questionQualityIssue(broken), /單位指令受損/);
  const repaired = inspectQuestionFormat(broken).question;
  assert.equal(repaired.q, '以 $4.0\\text{ m/s}$ 滑行，已知質量為 2 kg，求停止時摩擦力所做的功。');
  assert.equal(repaired.correct, '$-16.0\\text{ J}$');
  assert.equal(inspectQuestionFormat(repaired).damaged, false);
  assert.equal(inspectQuestionFormat({ ...broken, wrong: ['$-16.0\\text{J}$', ...broken.wrong.slice(1)] }).question, null);
});

test('bank persists repairs and stops serving questions with ambiguous damaged units', async () => {
  const catalog = { subject:'物理', level:'高中一年級', topic:'功與能', difficulty:'easy' };
  const row = question => ({ status:'approved', reviewCount:1, catalog, question });
  const stored = {
    repair: row(broken),
    quarantine: row({ ...broken, q:'速度 $4.0ext{xxx}$ 的物體停止，求摩擦力所做的功。' })
  };
  const patched = new Map();
  const fetcher = async (url, options = {}) => {
    const result = json => ({ ok:true, json:async () => json });
    if (url.includes('oauth2.googleapis.com')) return result({ access_token:'test' });
    const request = new URL(url);
    const id = request.pathname.split('/').at(-1);
    if (options.method === 'PATCH') {
      patched.set(id, JSON.parse(options.body));
      return { ok:true };
    }
    if (request.searchParams.get('alt') === 'media') return result(stored[id]);
    const query = request.searchParams.get('q');
    return result({ files: query.includes("'application/json'") ? Object.keys(stored).map(id => ({
      id, name:'aiq_' + scopeCode(catalog) + '_' + id + '.json', mimeType:'application/json'
    })) : [] });
  };
  const bank = createAIQuestionBank({ env:{
    AI_QUESTION_BANK_ENABLED:'1', AI_QUESTION_BANK_GOOGLE_CLIENT_ID:'123.apps.googleusercontent.com',
    AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET:'test', AI_QUESTION_BANK_GOOGLE_REFRESH_TOKEN:'test'
  }, fetcher, logger:{ info(){}, warn(){} } });
  const found = await bank.find(catalog);
  assert.equal(found.count, 1);
  assert.equal(found.question.correct, '$-16.0\\text{ J}$');
  assert.equal(patched.get('repair').question.correct, found.question.correct);
  assert.equal(patched.get('quarantine').status, 'quarantined');
});
