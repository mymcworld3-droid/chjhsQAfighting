'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { database } = require('./helpers/tactical-db.cjs');
const rewardApi = require('../daily-vocabulary-reward-api.cjs').__test;

const stoneCode=readFileSync(join(__dirname,'../public/cultivation/spirit-stone-ui.js'),'utf8');
const {stoneCostMarkup,cultivationMarkup}=vm.runInNewContext(stoneCode.replace(/^export /gm,'')+'\n({stoneCostMarkup,cultivationMarkup});');
const QARewardPresentation=require('../public/cultivation/daily-meditation-rewards.js');
const source = readFileSync(join(__dirname, '../public/cultivation/daily-vocabulary-page.js'), 'utf8')
  .replace("import './daily-meditation-rewards.js';", '')
  .replace("import { createVocabularyPronunciation } from './daily-vocabulary-pronunciation.mjs';", '')
  .replace("import('./daily-vocabulary-rules.js')", 'Promise.resolve(testRules)')
  .replace("import('./data/project-repository.js')", 'Promise.resolve(testRepository)');

const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(rules, db, storage) {
  const handlers = {};
  let uid = 'u1';
  let now = Date.parse('2026-11-15T10:00:00Z');
  let failAfterCommit = true;
  const local = { uid, stats: { gold: 0, totalScore: 30 } };
  const root = { classList: { contains: () => true }, closest: () => ({ scrollTop: 0 }) };
  const backLabel = { textContent: '' };
  const backButton = {
    attributes: {},
    querySelector: selector => selector==='[data-dv-back-label]'?backLabel:null,
    setAttribute(name,value){this.attributes[name]=value;},
    addEventListener(type,fn){handlers['back-'+type]=fn;}
  };
  let destination = '';
  const slot = {
    innerHTML: '', dataset: {},
    querySelector: () => null,
    addEventListener: (event, fn) => { handlers[event] = fn; },
  };
  const day = {};
  const note = {};
  root.querySelector = selector =>
    selector === '[data-dv-view]' ? slot
      : selector === '[data-dv-date]' ? day
      : selector === '[data-dv-back]' ? backButton : note;

  const repository = {
    async authenticatedMainFetch(_url, options) {
      const requestUid = uid;
      const result = await rewardApi.claim(db, requestUid, JSON.parse(options.body), now);
      if (failAfterCommit) {
        failAfterCommit = false;
        throw new Error('網路中斷');
      }
      return { ok: true, json: async () => ({ ok: true, ...result }) };
    },
  };
  const window = {
    getRealmUserUid: () => uid,
    getCurrentUserData: () => local,
    addEventListener: (event, fn) => { handlers[event] = fn; },
    dispatchEvent() {},
    switchToPage: name => { destination=name; },
  };
  const context = {
    console, window, stoneCostMarkup, cultivationMarkup, QARewardPresentation, AbortController, setTimeout, clearTimeout,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    document: { getElementById: () => root, addEventListener() {} },
    MutationObserver: class { observe() {} },
    setInterval: () => 1, clearInterval() {},
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    testRules: { ...rules, todayInTaipei: () => rules.todayInTaipei(new Date(now)) },
    testRepository: repository,
    createVocabularyPronunciation: () => ({ state: () => ({ status: 'idle' }), stop() {} }),
  };
  vm.runInNewContext(source, context, { filename: 'daily-vocabulary-page.js' });
  return {
    slot, local, backLabel, backButton,
    getDestination:()=>destination,
    clickBack:()=>handlers['back-click']?.(),
    saved: () => JSON.parse(storage.get('qingyun:daily-vocabulary:v1:' + uid)),
    setDay: date => { now = Date.parse(date); },
    click(action, data = {}) {
      assert.ok(slot.innerHTML.includes('data-dv-action="' + action + '"'), action);
      handlers.click({
        target: { closest: () => ({ dataset: { dvAction: action, ...data }, disabled: false }) },
      });
    },
    submitSpelling(value, index) {
      handlers.submit({
        preventDefault() {},
        target: { closest: () => ({ dataset: { index }, querySelector: () => ({ value }) }) },
      });
    },
  };
}

async function finishLesson(view, rules) {
  const lesson = view.saved().lesson;
  const questions = rules.questionsFor(lesson);
  for (let index = lesson.index; index < questions.length; index++) {
    const question = questions[index];
    if (question.format === 'spelling') view.submitSpelling(question.word.id, index);
    else view.click('choose', { index, choice: question.word.id });
    assert.match(view.slot.innerHTML, /答對了/);
    if (index < questions.length - 1) view.click('next-question', { index });
  }
}

test('a lost response leaves the reward retryable without granting it twice', async () => {
  const rules = await import('../public/cultivation/daily-vocabulary-rules.mjs');
  const db = database();
  const storage = new Map();
  const view = harness(rules, db, storage);
  await tick();

  assert.match(view.slot.innerHTML, /完成測驗可獲得/);
  assert.match(view.slot.innerHTML, /mr-reward-list--general.*可獲得的獎勵/);
  assert.match(view.slot.innerHTML, />100<\/strong>/);
  assert.match(view.slot.innerHTML, />2<\/strong>/);
  view.click('cards');
  assert.match(view.slot.innerHTML, /dv-card is-front/);
  view.click('reveal');
  assert.match(view.slot.innerHTML, /dv-card is-revealed/);
  assert.match(view.slot.innerHTML, /負擔得起/);
  view.click('familiar');
  view.click('home');
  view.click('quiz');
  await finishLesson(view, rules);
  await tick();
  assert.equal(db.records.get('users/u1').stats.gold, 100);
  assert.equal(view.saved().rewardQueue.length, 1);

  view.click('next-question', { index: 14 });
  assert.match(view.slot.innerHTML, /網路中斷/);
  view.click('retry-reward');
  await tick();
  assert.equal(db.records.get('users/u1').stats.gold, 100);
  assert.equal(db.records.get('users/u1').stats.totalScore, 32);
  assert.equal(view.local.stats.gold, 100);
  assert.equal(view.saved().rewardQueue.length, 0);
  assert.match(view.slot.innerHTML, /今日獎勵已領取/);
  assert.match(view.slot.innerHTML, /mr-reward-list--general/);
  assert.match(view.slot.innerHTML, />\+100<\/strong>/);

  const reopened = harness(rules, db, storage);
  await tick();
  reopened.click('result');
  assert.match(reopened.slot.innerHTML, /今日獎勵已領取/);
  assert.equal(db.records.get('users/u1').stats.gold, 100);
});

test('a completed previous-day quiz stays queued when opening the next day', async () => {
  const rules = await import('../public/cultivation/daily-vocabulary-rules.mjs');
  const db = database();
  const storage = new Map();
  const view = harness(rules, db, storage);
  await tick();
  view.click('quiz');
  await finishLesson(view, rules);
  await tick();
  assert.equal(view.saved().rewardQueue.length, 1);

  view.setDay('2026-11-16T10:00:00Z');
  view.click('home');
  await tick();
  assert.equal(view.saved().lesson.date, '2026-11-16');
  assert.equal(view.saved().rewardQueue.length, 0);
  assert.equal(db.records.get('users/u1').stats.gold, 100);
  assert.equal(view.saved().rewardHistory['2026-11-15'].status, 'claimed');
});

test('back from a flashcard returns to English vocabulary overview instead of leaving learning', async()=>{
  const rules=await import('../public/cultivation/daily-vocabulary-rules.mjs');
  const view=harness(rules,database(),new Map());
  await tick();
  assert.equal(view.backLabel.textContent,'回到學習');
  view.click('cards');
  assert.equal(view.backLabel.textContent,'回到英文單字');
  assert.equal(view.backButton.attributes['aria-label'],'回到英文單字');
  view.clickBack();
  assert.match(view.slot.innerHTML,/今日單字/);
  assert.equal(view.backLabel.textContent,'回到學習');
  assert.equal(view.getDestination(),'');
  view.clickBack();
  assert.equal(view.getDestination(),'page-learning');
});
