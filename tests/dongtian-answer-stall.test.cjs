'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/cultivation/dongtian.js'), 'utf8');

test('next question waits at most one bounded status check and ignores double clicks', () => {
  const next = source.slice(source.indexOf("document.getElementById('dt-next').onclick"), source.indexOf('function removeModerationModal'));
  assert.match(next, /state\.session !== s \|\| s\.advancing \|\| s\.settling/);
  assert.match(next, /s\.advancing = true/);
  assert.match(next, /next\.disabled = true/);
  assert.match(next, /next\.textContent = '正在確認洞天狀態…'/);
  assert.match(next, /s\.index !== currentIndex/);
  assert.match(next, /s\.advancing = false/);
  assert.match(next, /next\.disabled = false/);
  assert.match(source, /const STATUS_CHECK_TIMEOUT_MS = 4500/);
  assert.match(source, /return await Promise\.race\(\[/);
  assert.match(source, /clearTimeout\(timer\)/);
});

test('status timeout, network error and sealed state do not bypass the final reward transaction', () => {
  const check = source.slice(source.indexOf('async function readSessionDongtianStatus'), source.indexOf('function openQuestionReport'));
  const settlement = source.slice(source.indexOf('async function completeProgress'), source.indexOf('async function writeDongtianHistory'));
  assert.match(check, /result\.snapshot\?\.exists\(\) && result\.snapshot\.data\(\)\?\.status !== 'active'/);
  assert.match(check, /sealCurrentSession\(/);
  assert.match(check, /result\.error \|\| result\.timedOut/);
  assert.match(check, /state\.session !== s/);
  assert.match(settlement, /indexSnap\.data\(\)\?\.status !== 'active'/);
  assert.match(settlement, /const alreadyCompleted = playSnap\.exists\(\) && !!playSnap\.data\(\)\?\.completed/);
});

test('status read settles even when Firestore hangs; a late rejection is handled', async () => {
  const fn = source.slice(source.indexOf('async function readSessionDongtianStatus'), source.indexOf('async function ensureSessionDongtianActive'));
  const context = vm.createContext({
    STATUS_CHECK_TIMEOUT_MS: 15, db: {}, INDEX_COLLECTION: 'dongtianIndex',
    doc: (_db, collection, id) => ({ collection, id }),
    getDoc: async () => new Promise(() => {}),
    Promise, setTimeout, clearTimeout
  });
  vm.runInContext(fn, context);
  const start = Date.now();
  const timedOut = await context.readSessionDongtianStatus('test-cave');
  assert.equal(timedOut.timedOut, true);
  assert.ok(Date.now() - start < 1000, 'the status read must not hang');
  context.getDoc = async () => ({ exists: () => true, data: () => ({ status: 'active' }) });
  const active = await context.readSessionDongtianStatus('test-cave');
  assert.equal(active.snapshot.data().status, 'active');
  context.getDoc = async () => { throw Error('offline'); };
  const failed = await context.readSessionDongtianStatus('test-cave');
  assert.equal(failed.error.message, 'offline');
});

test('settlement shows progress and a safe retry instead of claiming rewards after failure', () => {
  const finish = source.slice(source.indexOf('async function finishDongtian'), source.indexOf('async function completeProgress'));
  assert.match(finish, /if \(!s \|\| s\.settling\) return/);
  assert.match(finish, /s\.settling = true/);
  assert.match(finish, /正在結算/);
  assert.match(finish, /id="dt-settle-back"/);
  assert.match(finish, /firstCompletion = await completeProgress/);
  assert.match(finish, /洞天結算尚未完成/);
  assert.match(finish, /id="dt-retry-settlement"/);
  assert.match(finish, /s\.settling = false/);
  assert.match(finish, /if \(state\.session !== s\) return/);
  assert.match(finish, /void writeDongtianHistory\(s, true/);
  assert.doesNotMatch(finish, /await writeDongtianHistory\(/);
  const exit = source.slice(source.indexOf('async function exitDongtian'), source.indexOf('function closeAfterSession'));
  assert.match(exit, /void writeDongtianHistory\(s, false\)/);
  assert.doesNotMatch(exit, /await writeDongtianHistory/);
});
