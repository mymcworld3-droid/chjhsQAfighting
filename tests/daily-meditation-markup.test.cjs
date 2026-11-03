'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Icons = require('../public/cultivation/item-icons.js');
const source = fs.readFileSync(require.resolve('../public/cultivation/daily-meditation.js'), 'utf8').replace(/^import .*;\n/gm, '');

function dashboard(state, busy = false, icons = Icons) {
  const content = { innerHTML: '', closest: () => null, querySelectorAll: () => [] };
  const status = { textContent: '' };
  const window = { getCurrentUserData: () => null, addEventListener() {} };
  const context = {
    window, QAItemIcons: icons, QADailyMeditationRules: {}, getMainUser: () => ({ uid: 'fixture' }),
    document: { getElementById: id => id === 'dm-content' ? content : id === 'dm-status' ? status : null, addEventListener() {} },
    setInterval() {},
    auditState: state, auditBusy: busy
  };
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'state=auditState;busy=auditBusy;renderDashboard();\n})();'), context);
  return content.innerHTML;
}

function fixture(completed = false) {
  return {
    completed, personalStars: completed ? 3 : 0, stars: completed ? 15 : 0,
    record: { streak: 1 }, drawTickets: 18, rankings: [],
    milestones: [
      { stars: 3, reward: { gold: 200 } },
      { stars: 6, reward: { gold: 200, fragments: 1 } },
      { stars: 9, reward: { gold: 400 } },
      { stars: 12, reward: { gold: 200, fragments: 2 } },
      { stars: 15, reward: { gold: 200, raidTickets: 1, drawTickets: 1 } }
    ].map(step => ({ ...step, claimable: completed, claimed: false }))
  };
}

function checkpoints(html) {
  return [...html.matchAll(/<button\b[^>]*class="dm-checkpoint"[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]);
}

test('icon rewards keep plain descriptions in checkpoint attributes and images in reward content', () => {
  const html = dashboard(fixture());
  const buttons = checkpoints(html);
  assert.equal(buttons.length, 5);
  assert.match(buttons[0], /aria-label="3 星，差 3 星，200 靈石"/);
  assert.match(buttons[4], /title="15 星，差 15 星，200 靈石、團本入場券 ×1、本命法器抽獎券 ×1"/);
  for (const button of buttons) {
    assert.doesNotMatch(button, /<img|<br>|loading=|src=/, 'reward markup cannot enter a button attribute');
    assert.match(button, / disabled>/);
  }
  assert.equal((html.match(/<img /g) || []).length, 9, 'each visible reward still has its item icon');
  assert.match(html, /<p><img [^>]+>200 靈石<br><img [^>]+>團本券 ×1<br><img [^>]+>抽獎券 ×1<\/p>/);
});

test('ready, claimed, pending-personal and busy checkpoints retain their claim gates', () => {
  const ready = fixture(true);
  assert.ok(checkpoints(dashboard(ready)).every(button => !/ disabled>/.test(button)));
  assert.match(checkpoints(dashboard(ready))[0], /3 星，點擊領取，200 靈石/);
  assert.ok(checkpoints(dashboard(ready, true)).every(button => / disabled>/.test(button)));
  ready.milestones[0] = { ...ready.milestones[0], claimed: true, claimable: false };
  assert.match(checkpoints(dashboard(ready))[0], /3 星，已領取，200 靈石/);
  assert.match(checkpoints(dashboard(ready))[0], / disabled>/);
  const pending = fixture(); pending.stars = 6;
  assert.match(checkpoints(dashboard(pending))[1], /6 星，待出關，200 靈石、元嬰碎精 ×1/);
});

test('reward descriptions escape quoted values and still work without the icon module', () => {
  const state = fixture(); state.milestones[0].reward.gold = '200 "加成" & <額外>';
  const button = checkpoints(dashboard(state))[0];
  assert.match(button, /aria-label="3 星，差 3 星，200 &quot;加成&quot; &amp; &lt;額外&gt; 靈石"/);
  const plain = dashboard(fixture(), false, null);
  assert.doesNotMatch(plain, /<img /);
  assert.equal(checkpoints(plain).length, 5);
  assert.match(checkpoints(plain)[4], /200 靈石、團本入場券 ×1、本命法器抽獎券 ×1/);
});
