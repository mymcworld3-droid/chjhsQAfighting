const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const legacy = fs.readFileSync(path.join(__dirname, '../public/main-legacy.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

test('report modal shows status and stays accessible above story/tutorial overlays', () => {
  assert.match(html, /id="report-modal" class="hidden fixed inset-0 z-\[17000\]/);
  assert.match(html, /id="report-input-status" role="status" aria-live="polite"/);
  assert.match(html, /id="report-loading-status" role="status" aria-live="polite"/);
  assert.match(legacy, /if \(reportCloseTimer\) \{ clearTimeout\(reportCloseTimer\); reportCloseTimer = null; \}/);
  assert.match(legacy, /if \(modal\.classList\.contains\('opacity-0'\)\) modal\.classList\.add\('hidden'\)/);
});

test('repeated clicks communicate an ongoing report instead of silently returning', () => {
  assert.match(legacy, /if \(reportSubmitting\) \{\s*reportLoadingStatus\('本次回報仍在處理/);
  assert.match(legacy, /reportLoadingStatus\('正在等待答題資料同步/);
  assert.match(legacy, /reportLoadingStatus\('已送交 AI 審核/);
  assert.match(legacy, /reportStatus\(error\?\.message \|\| '題目審核暫時無法完成，請稍後重試。', true\)/);
});

test('answer persistence has a bounded wait; timing out never submits the report or claims reward', async () => {
  const start = legacy.indexOf('async function waitForReportAnswerSaved(');
  const end = legacy.indexOf('function reportView(', start);
  assert.ok(start >= 0 && end > start);
  const context = { Promise, setTimeout, clearTimeout, Error };
  vm.runInNewContext(legacy.slice(start, end) + '\nthis.wait = waitForReportAnswerSaved;', context);
  await context.wait(Promise.resolve(), 5);
  await assert.rejects(context.wait(new Promise(() => {}), 5), /答題資料仍在同步/);
  assert.match(legacy, /if \(quiz\.answerPersistence\) await waitForReportAnswerSaved\(quiz\.answerPersistence\)/);
  assert.ok(legacy.indexOf('await waitForReportAnswerSaved(quiz.answerPersistence)') < legacy.indexOf("fetch('/api/verify-report'"));
});
