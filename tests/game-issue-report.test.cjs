'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { setup } = require('./helpers/d1-db.cjs');
const { compileQuery } = require('../d1-store.cjs');
const api = require('../game-issue-api.cjs').__test;
const body = (requestId = 'issue-request-001') => ({ requestId, category: '功能異常', description: '展開機緣後畫面直接消失', context: { page: 'page-quiz', diagnostics: 'trace-123' } });
const now = 1800000000000;
async function fixture() { const fixture = setup(); await fixture.db.doc('users/u1').set({ displayName: '玩家甲' }); return fixture; }
const response = () => ({ code: 200, set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
test('simultaneous report retries store one record and charge the quota once', async () => {
  const { db } = await fixture();
  const results = await Promise.all(Array.from({ length: 4 }, () => api.submit(db, 'u1', body(), now)));
  assert.equal(new Set(results.map(r => r.reportId)).size, 1);
  assert.equal(results.filter(r => !r.duplicate).length, 1);
  assert.equal((await db.collection('gameIssueReports').get()).size, 1);
  assert.equal((await db.doc('gameIssueLimits/u1').get()).data().sent.length, 1);
  const report = (await db.collection('gameIssueReports').get()).docs[0].data();
  assert.equal(report.reporterName, '玩家甲'); assert.equal(report.status, 'open');
});
test('report validation bounds fields, strips secrets, and ignores forged identity or admin state', async () => {
  const { db } = await fixture(); const payload = { ...body(), isAdmin: true, status: 'resolved', reporterUid: 'other', reporterName: 'forged',
    context: { diagnostics: 'Bearer sensitive-token {"api_key":"secret-json","password":"private-pass"} https://a.test?key=secret-url', browser: 'x'.repeat(1000), token: 'never-store' } };
  const { reportId } = await api.submit(db, 'u1', payload, now);
  const report = (await db.doc('gameIssueReports/' + reportId).get()).data(), serialized = JSON.stringify(report);
  for (const secret of ['sensitive-token', 'secret-json', 'private-pass', 'secret-url', 'never-store', 'forged']) assert.ok(!serialized.includes(secret));
  assert.equal(report.reporterUid, 'u1'); assert.equal(report.status, 'open'); assert.equal(report.context.browser.length, 400);
  await assert.rejects(api.submit(db, 'u1', { ...body(), description: '短' }, now), /五個字/);
  await assert.rejects(api.submit(db, 'u1', { ...body(), requestId: '../invalid' }, now), /識別碼/);
  await assert.rejects(api.submit(db, 'u1', null, now), /格式/);
  await assert.rejects(api.submit(db, 'missing', body(), now), error => error.status === 404);
});
test('per-player submission limits persist across processes and leave no extra report when exhausted', async () => {
  const { db } = await fixture();
  for (let i = 0; i < 5; i++) await api.submit(db, 'u1', body('hourly-request-' + i), now);
  await assert.rejects(api.submit(db, 'u1', body('hourly-request-6'), now), error => error.status === 429);
  assert.equal((await db.collection('gameIssueReports').get()).size, 5);
  await api.submit(db, 'u1', body('next-hour-request'), now + 3600001);
  await db.doc('gameIssueLimits/u1').set({ sent: Array.from({ length: 20 }, (_, i) => now - 7200000 - i) });
  await assert.rejects(api.submit(db, 'u1', body('daily-request-21'), now), error => error.status === 429);
  await api.submit(db, 'u1', body('new-day-request'), now + 86400001);
});
test('admin pagination is stable for tied timestamps and the D1 query uses its bounded ordered index', async () => {
  const { db, sql } = await fixture();
  for (let i = 0; i < 25; i++) await db.doc('gameIssueReports/' + i.toString(16).padStart(40, '0')).set({ createdAtMs: now, status: 'open', description: '問題說明' });
  const first = await api.list(db), second = await api.list(db, { cursor: first.nextCursor });
  assert.equal(first.entries.length, 20); assert.equal(second.entries.length, 5); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.entries, ...second.entries].map(r => r.id)).size, 25);
  const query = compileQuery(db.collection('gameIssueReports').orderBy('createdAtMs', 'desc').orderBy('__name__', 'desc').limit(21));
  const plan = sql.prepare('EXPLAIN QUERY PLAN ' + query.sql).all(...query.params).map(r => r.detail).join('\n');
  assert.match(plan, /game_issue_time/); assert.doesNotMatch(plan, /SCAN documents|TEMP B-TREE/);
  await assert.rejects(api.list(db, { cursor: { at: now, id: '../bad' } }), /游標/);
});
test('only a server-verified administrator may view or update reports', async () => {
  const { db } = await fixture(); const { reportId } = await api.submit(db, 'u1', body(), now);
  let identity = 'u1', aud = 'question-learning';
  const handlers = api.createHandlers({ resolveA: () => ({ db, auth: { verifyIdToken: async () => ({ uid: identity, aud, iss: 'https://securetoken.google.com/' + aud }) } }), now: () => now + 1, logger: { warn() {} } });
  const req = data => ({ body: data, get: () => 'Bearer valid-token' });
  const denied = response(); await handlers.admin(req({ action: 'list', isAdmin: true }), denied); assert.equal(denied.code, 403); assert.ok(!denied.body.entries);
  const guest = response(); await handlers.submit({ body: body(), get: () => '' }, guest); assert.equal(guest.code, 401);
  aud = 'other-project'; const wrong = response(); await handlers.admin(req({ action: 'list' }), wrong); assert.equal(wrong.code, 401);
  aud = 'question-learning'; identity = 'admin'; await db.doc('users/admin').set({ isAdmin: true });
  const listed = response(); await handlers.admin(req({ action: 'list' }), listed); assert.equal(listed.body.entries.length, 1);
  const updated = response(); await handlers.admin(req({ action: 'update', reportId, status: 'resolved', adminNote: '已修正流程' }), updated);
  assert.equal(updated.body.entry.status, 'resolved'); assert.equal(updated.body.entry.handledBy, 'admin');
  assert.equal((await db.doc('gameIssueReports/' + reportId).get()).data().adminNote, '已修正流程');
  const { mayRead } = require('../d1-browser-api.cjs');
  for (const collection of ['gameIssueReports', 'gameIssueLimits']) assert.equal(mayRead({ role: 'A', path: collection + '/' + reportId, data: { reporterUid: 'u1' }, uid: 'u1', admin: false }), false, 'the browser API cannot bypass the report endpoint');
});
