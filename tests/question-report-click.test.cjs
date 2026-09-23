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
  assert.match(legacy, /title: '本次審查未完成'/);
  assert.match(legacy, /actionText: '重新送審'/);
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

test('review outcome has a passed, not-passed, or retryable incomplete screen', () => {
  const start = legacy.indexOf('function reportView(');
  const end = legacy.indexOf('window.openReportModal =', start);
  assert.ok(start >= 0 && end > start);
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) {
      const flags = new Set(['hidden']);
      nodes.set(id, {
        textContent: '', innerHTML: '', className: '', style: {},
        classList: {
          toggle(flag, on) { if (on) flags.add(flag); else flags.delete(flag); },
          contains(flag) { return flags.has(flag); }
        }
      });
    }
    return nodes.get(id);
  }
  const ctx = { document: { getElementById: node }, window: { closeReportModal() {} } };
  vm.runInNewContext(legacy.slice(start, end) + String.fromCharCode(10) + 'this.show = renderReportOutcome;', ctx);
  ctx.show({ kind: 'approved', title: '審查通過 ✅', message: '100 靈石已入帳' });
  assert.match(node('report-result-icon').innerHTML, /circle-check/);
  assert.match(node('report-result-msg').textContent, /100 靈石已入帳/);
  assert.equal(node('report-result-view').classList.contains('hidden'), false);
  ctx.show({ kind: 'rejected', title: '審查未通過 ❌', message: '答案沒有錯' });
  assert.match(node('report-result-icon').innerHTML, /circle-xmark/);
  assert.equal(node('report-result-title').textContent, '審查未通過 ❌');
  assert.equal(node('report-result-close').classList.contains('hidden'), true);
  let retried = false;
  ctx.show({ kind: 'incomplete', title: '本次審查未完成', message: 'AI 逾時', actionText: '重新送審', onAction: () => { retried = true; }, showClose: true });
  assert.match(node('report-result-icon').innerHTML, /circle-exclamation/);
  assert.equal(node('report-result-action').textContent, '重新送審');
  assert.equal(node('report-result-close').classList.contains('hidden'), false);
  node('report-result-action').onclick();
  assert.equal(retried, true);
});

test('only an approved and paid review can show rewards; a technical failure is not a rejection', () => {
  assert.ok(legacy.includes("result.status === 'confirmed' && result.compensated === true && result.goldAdded === 100 &&"));
  assert.ok(legacy.includes('Number.isFinite(Number(result.newGold))'));
  assert.ok(legacy.includes("result.status === 'rejected'"));
  assert.ok(legacy.includes("result.status === 'duplicate'"));
  assert.ok(legacy.includes("title: isLimit ? '今日補償已達上限' : '本次審查未完成'"));
  assert.ok(legacy.includes('showClose: !isLimit'));
  assert.match(html, /id="report-result-action"/);
  assert.match(html, /id="report-result-close"/);
});
