const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const index = readFileSync(join(__dirname, '../public/index.html'), 'utf8');
const home = index.slice(index.indexOf('<div id="page-home"'), index.indexOf('<div id="page-training"'));
const nav = index.slice(index.indexOf('<nav id="bottom-nav"'), index.indexOf('<div id="toast-container"'));

test('the home practice area owns the original solo and duel entry actions exactly once', () => {
  assert.match(home, /<section class="home-practice" aria-label="今日修行">/);
  assert.match(home, /id="btn-home-start"[^>]*onclick="startQuizFlow\(\)"/);
  assert.match(home, /id="btn-home-pvp"[^>]*onclick="startBattleMatchmaking\(\)"/);
  assert.doesNotMatch(nav, /xiuxian-quick-actions|btn-home-start|btn-home-pvp/);
  for (const id of ['btn-home-start','btn-home-pvp']) assert.equal((index.match(new RegExp(`id="${id}"`,'g'))||[]).length,1);
});

test('secondary records are available through a native collapsed disclosure with their data bindings intact', () => {
  const records = home.match(/<details class="home-records">([\s\S]*?)<\/details>/);
  assert.ok(records);
  assert.match(records[1], /<summary>修行紀錄/);
  for (const id of ['display-score','display-accuracy','display-streak','display-best-streak']) assert.match(records[1],new RegExp(`id="${id}"`));
  for (const id of ['quest-open','story-archive-launcher','xiuxian-meditate','xiuxian-path','sect-raid-entry','quest-spotlight']) assert.match(home,new RegExp(`id="${id}"`));
});

test('the review stylesheet is loaded before app startup and obsolete floating-action geometry is removed', () => {
  const link='styles/interface-cleanup.css?v=20261023-review1';
  assert.ok(index.indexOf(link)>index.indexOf('styles/xianxia-quiet.css'));
  assert.ok(index.indexOf(link)<index.indexOf('main.js?v='));
  assert.doesNotMatch(index, /#bottom-nav>\.xiuxian-quick-actions/);
  assert.match(index, /<body class="xianxia-theme ui-cleanup /);
});
