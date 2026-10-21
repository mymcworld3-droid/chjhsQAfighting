'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Codec = require('../public/d1-codec.js');
const source = fs.readFileSync(require.resolve('../public/main-legacy.js'), 'utf8');
const section = source.slice(source.indexOf('function readTimestampDate('), source.indexOf('window.switchAdminChart ='));
function runtime(users = [], logs = []) {
  const elements = new Map();
  const chart = { registrations: {}, active: {}, questions: {}, accuracy: {} };
  const errors = [], alerts = [], reads = [];
  let rendered = 0;
  const context = {
    Date, Number, String, currentUserData: { isAdmin: true }, window: {},
    document: { querySelector: () => null, getElementById: id => { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); } },
    console: { error: (...args) => errors.push(args) }, alert: message => alerts.push(message),
    adminChartData: chart, currentAdminChartType: 'accuracy', switchAdminChart: () => rendered++, db: {},
    collection: (_db, name) => name, query: ref => ref, orderBy() {}, limit() {},
    getDocs: async ref => { reads.push(ref); const records = ref === 'users' ? users : logs;
      return { size: records.length, forEach: visit => records.forEach(data => visit({ data: () => data })) }; }
  };
  vm.runInNewContext(section + '\nthis.api = { readTimestampDate, formatDateKey };', context);
  return { ...context.api, load: context.window.loadAdminStatistics, chart, elements, errors, alerts, reads, rendered: () => rendered };
}
test('statistics normalize Firebase, D1, migrated timestamps, Date, ISO strings and millisecond values', () => {
  const app = runtime(), millis = new Date(2026, 9, 21, 12, 30).getTime();
  const seconds = Math.floor(millis / 1000), nanoseconds = (millis % 1000) * 1e6;
  for (const value of [new Date(millis), { toDate: () => new Date(millis) }, { toMillis: () => millis },
    Codec.Timestamp.fromMillis(millis), { seconds, nanoseconds }, { _seconds: seconds, _nanoseconds: nanoseconds },
    { __d1type: 'timestamp', seconds, nanoseconds }, { __d1type: 'date', value: new Date(millis).toISOString() },
    new Date(millis).toISOString(), millis]) {
    assert.equal(app.readTimestampDate(value).getTime(), millis);
    assert.equal(app.formatDateKey(value), '2026-10-21');
  }
  assert.equal(app.readTimestampDate({ seconds: 0, nanoseconds: 123000000 }).getTime(), 123);
  assert.equal(app.readTimestampDate(0).getTime(), 0);
});
test('invalid or missing dates are skipped instead of crashing or producing a false epoch bucket', () => {
  const app = runtime();
  for (const value of [null, undefined, true, false, '', 'bad-date', NaN, Infinity, [], {},
    new Date(NaN), { seconds: NaN }, { seconds: 1, nanoseconds: NaN },
    { toDate: () => null }, { toDate: () => { throw Error('bad timestamp'); } },
    { toMillis: () => null }, { toMillis: () => Infinity }, { toDate: 'not a method' }]) {
    assert.equal(app.readTimestampDate(value), null);
    assert.equal(app.formatDateKey(value), null);
  }
});
test('mixed historical records do not abort admin statistics or add null-date chart entries', async () => {
  const now = new Date(), seconds = Math.floor(now.getTime() / 1000);
  const app = runtime([
    { createdAt: { seconds }, lastActive: { _seconds: seconds }, stats: { totalAnswered: 3, totalCorrect: 2 } },
    { createdAt: 'bad-date', lastActive: now.toISOString(), stats: { totalAnswered: 2, totalCorrect: 1 } },
    { createdAt: {}, lastActive: {}, stats: {} }
  ], [{ timestamp: { _seconds: seconds } }, { timestamp: now.toISOString() }, { timestamp: { seconds: NaN } }, {}]);
  await app.load();
  const key = app.formatDateKey(now);
  assert.equal(app.chart.registrations[key], 2);
  assert.equal(app.chart.active[key], 2); assert.equal(app.chart.questions[key], 2);
  for (const map of [app.chart.registrations, app.chart.active, app.chart.questions]) assert.deepEqual(Object.keys(map), [key]);
  assert.equal(app.elements.get('admin-stat-total-users').innerText, 3);
  assert.equal(app.elements.get('admin-stat-active-users').innerText, 2);
  assert.equal(app.elements.get('admin-stat-total-q').innerText, 5);
  assert.equal(app.elements.get('admin-stat-accuracy').innerText, '60.0%');
  assert.equal(app.rendered(), 1); assert.equal(app.errors.length, 0); assert.equal(app.alerts.length, 0);
  assert.deepEqual(app.reads, ['users', 'exam_logs']);
});
