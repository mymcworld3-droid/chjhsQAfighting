'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const scripts = read('public/cultivation/story/story-scripts.js');
const engine = read('public/cultivation/story/story-engine.js');
const { STORY_CHAPTERS, storyChapterById } = vm.runInNewContext(scripts.replace(/^export /gm, '') + '\n({ STORY_CHAPTERS, storyChapterById });');
const rules = require('../public/cultivation/first-visit-rules.js');
const quests = require('../public/cultivation/quest-rules.js');

test('only the complete first and second chapters remain accessible, including administrator lookups', () => {
  assert.deepEqual(Array.from(STORY_CHAPTERS, chapter => chapter.id), ['prologue-enter-sect', 'qi-five-dongtian']);
  assert.deepEqual(Array.from(STORY_CHAPTERS, chapter => chapter.minScore), [0, 5]);
  assert.ok(STORY_CHAPTERS.every(chapter => chapter.lines.length >= 20));
  for (const id of ['qi-one-ask-dao', 'foundation-first-battle', 'golden-core-truth', 'true-immortal-epilogue']) {
    assert.equal(storyChapterById(id), null);
  }
});

test('both retained chapters advance from the first line through completion without any tutorial handoff', () => {
  const next = engine.slice(engine.indexOf('  function nextLine()'), engine.indexOf('  async function finishChapter()'));
  for (const chapter of STORY_CHAPTERS) for (const replay of [false, true]) {
    const rendered = [], finished = [];
    const context = vm.createContext({ active: true, currentChapter: chapter, replayMode: replay, lineIndex: 0,
      renderLine() { rendered.push(context.lineIndex); }, finishChapter() { finished.push(chapter.id); } });
    vm.runInContext(next, context);
    for (let i = 0; i < chapter.lines.length; i++) context.nextLine();
    assert.equal(rendered.length, chapter.lines.length - 1);
    assert.equal(context.lineIndex, chapter.lines.length - 1);
    assert.deepEqual(finished, [chapter.id]);
  }
});

test('guests resume ordinary gameplay from every old tour stage without waiting for a first answer', () => {
  for (const stage of ['scope', 'features', 'question', 'invite', 'background', 'gender']) {
    for (const score of [0, 1, 28]) {
      const state = rules.normalize({ version: 1, stage, joining: true, guestUid: 'guest' });
      assert.equal(rules.readyStage(state, { uid: 'guest', isAnonymous: true }, { stats: { totalScore: score } }), 'done');
    }
  }
});

test('account creation and interrupted world introductions go directly to character setup, preserving chosen characters', () => {
  const account = { uid: 'player', isAnonymous: false };
  assert.equal(rules.readyStage({}, account, {}, true), 'gender');
  const interrupted = rules.normalize({ version: 1, stage: 'background' });
  assert.equal(rules.readyStage(interrupted, account, {}), 'gender');
  const profile = { storyProgressV1: { gender: 'female' }, stats: { totalScore: 188 } };
  for (const state of [{}, interrupted, { version: 1, joining: true }]) {
    assert.equal(rules.readyStage(state, account, profile, true), 'done');
  }
  assert.equal(rules.readyStage({}, account, {}, false), 'done', 'returning accounts can choose a character when opening chapter one');
});

test('quest migration removes retired lessons and chapters while preserving current claims, ticket amounts and progress', () => {
  const date = '2026-10-19';
  const raw = { version: 2,
    pathClaimed: ['path-story-prologue-enter-sect', 'path-qi-five', 'path-story-qi-one-ask-dao', 'path-dongtian-tutorial', 'path-story-foundation-first-battle'],
    pathTicketAmounts: { 'path-qi-five': 1, 'path-dongtian-tutorial': 1 } };
  const migrated = quests.normalizeState(raw, date);
  assert.deepEqual(migrated.pathClaimed, ['path-story-prologue-enter-sect', 'path-qi-five']);
  assert.equal(migrated.pathTicketAmounts['path-qi-five'], 1);
  const chapterQuests = quests.PATH.filter(q => q.metric === 'story');
  assert.deepEqual(chapterQuests.map(q => q.chapterId), ['prologue-enter-sect', 'qi-five-dongtian']);
  assert.ok(quests.PATH.every(q => q.metric !== 'dongtian-tutorial'));
  const claimed = quests.PATH.slice(0, quests.PATH.findIndex(q => q.chapterId === 'qi-five-dongtian')).map(q => q.id);
  claimed.push('path-dongtian-tutorial');
  const player = { stats: { totalScore: 6 }, storyProgressV1: { seen: { 'qi-five-dongtian': true } } };
  let view = quests.view(player, { pathClaimed: claimed }, date);
  assert.equal(view.path.chapterId, 'qi-five-dongtian'); assert.equal(view.path.claimable, true);
  view = quests.view(player, { pathClaimed: [...claimed, view.path.id] }, date);
  assert.equal(view.path.id, 'path-meditation', 'no removed lesson can block subsequent gameplay tasks');
});
