const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/cultivation/quest-system.js'), 'utf8');
function fixture() {
  let user = { uid: 'u1' }, day = '2026-10-17', week = '2026-10-12';
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { textContent: '', hidden: false,
      classes: new Set(), attributes: {}, classList: { toggle(name, value) {
        if (value) elements.get(id).classes.add(name); else elements.get(id).classes.delete(name);
      } }, setAttribute(name, value) { this.attributes[name] = value; } });
    return elements.get(id);
  } };
  const ctx = vm.createContext({ document, getMainUser: () => user,
    window: { XianxiaQuestRules: { dateKey: () => day, weekKey: () => week } },
    authenticatedMainFetch() { throw Error('rendering must never fetch'); } });
  vm.runInContext(source.slice(source.indexOf('  let snapshot'), source.indexOf('  function mount()')) + `
    this.load = value => { snapshot = value; account = 'u1'; };
    this.setBusy = value => { busy = value; };
  `, ctx);
  const data = { date: day, weeklyKey: week, path: null, daily: [], commissions: [], weekly: [], pathTicketRewards: [] };
  ctx.load(data);
  return { ctx, data, elements, user: value => { user = value; },
    rollover: () => { day = '2026-10-19'; week = '2026-10-19'; } };
}
const quest = (id, current, target = 10, extra = {}) => ({ id, title: id, current, target,
  metric: 'solo', destination: 'solo', reward: { gold: 120, drawTickets: 1 }, ...extra });

test('home recommendation offers ready rewards across categories before unfinished objectives', () => {
  const { ctx, data } = fixture();
  data.path = quest('path', 9);
  data.daily = [quest('daily', 10, 10, { claimable: true })];
  assert.equal(ctx.recommendedQuest().q.id, 'daily');
  assert.equal(ctx.recommendedQuest().kind, 'daily');
  data.pathTicketRewards.push(quest('supplement', 1, 1, { claimable: true, supplemental: true }));
  assert.equal(ctx.recommendedQuest().q.id, 'supplement');
});

test('nearest available objective wins without suggesting locked or already claimed quests', () => {
  const { ctx, data } = fixture();
  data.path = quest('path', 8);
  data.daily = [quest('locked', 10, 10, { claimable: true, locked: true }),
    quest('paid', 10, 10, { claimable: true, claimed: true }), quest('daily', 1, 3)];
  data.weekly = [quest('weekly', 45, 50)];
  assert.equal(ctx.recommendedQuest().q.id, 'weekly');
  data.weekly[0].claimed = true;
  assert.equal(ctx.recommendedQuest().q.id, 'path');
});

test('rollover and account changes cannot expose expired rewards or another player snapshot', () => {
  const { ctx, data, rollover, user, elements } = fixture();
  data.path = quest('path', 2);
  data.daily = [quest('daily', 10, 10, { claimable: true })];
  data.weekly = [quest('weekly', 10, 10, { claimable: true })];
  rollover();
  assert.equal(ctx.recommendedQuest().q.id, 'path');
  user({ uid: 'u2' });
  assert.equal(ctx.recommendedQuest(), null);
  ctx.renderSpotlight();
  assert.equal(elements.get('quest-spotlight-title').textContent, '查看修行任務');
  user(null); ctx.renderSpotlight();
  assert.equal(elements.get('quest-spotlight-slot').hidden, true);
});

test('home rendering reuses data, shows tickets first and disables claims while existing requests run', () => {
  const { ctx, data, elements } = fixture();
  data.path = quest('<任務>', 8);
  ctx.renderSpotlight();
  assert.equal(elements.get('quest-spotlight-title').textContent, '<任務>');
  assert.equal(elements.get('quest-spotlight-progress').textContent, '答對 8／10');
  assert.equal(elements.get('quest-spotlight-reward').textContent, '抽獎券 ×1 · 120 靈石');
  assert.equal(elements.get('quest-spotlight-action').textContent, '繼續問道 →');
  data.path.claimable = true; data.path.current = 10;
  ctx.renderSpotlight();
  assert.equal(elements.get('quest-spotlight-action').textContent, '領取獎勵 →');
  assert.ok(elements.get('quest-spotlight').classes.has('quest-spotlight-ready'));
  ctx.setBusy(true); ctx.renderSpotlight();
  assert.equal(elements.get('quest-spotlight').disabled, true);
  ctx.status('獎勵已領取');
  assert.equal(elements.get('quest-spotlight-status').textContent, '獎勵已領取');
});
