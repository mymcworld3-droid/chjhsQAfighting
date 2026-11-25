const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const legacy = fs.readFileSync(path.join(__dirname, '../public/main-legacy.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

test('the question-error button keeps its player-facing name', () => {
  assert.match(html, /id="btn-report"[\s\S]*?<span>題目有錯<\/span>/);
  assert.doesNotMatch(html, /<span>回報問題<\/span>/);
});

test('report modal shows status and stays accessible above story/tutorial overlays', () => {
  assert.match(html, /id="report-modal" class="hidden fixed inset-0 z-\[17000\]/);
  assert.match(html, /id="report-input-status" role="status" aria-live="polite"/);
  assert.match(html, /id="report-loading-status"[^>]*role="status" aria-live="polite"/);
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
  const ctx = { QAQuestionPresentation:require('../public/cultivation/question-presentation.js'), document: { getElementById: node }, window: { closeReportModal() {} } };
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
  assert.ok(legacy.includes("const paidSolo = !trial && committed && result.goldAdded === 100"));
  assert.ok(legacy.includes("const paidBattle = !!trial && committed && result.goldAdded === 0"));
  assert.ok(legacy.includes('Number.isFinite(Number(result.newGold))'));
  assert.ok(legacy.includes("result.status === 'rejected'"));
  assert.ok(legacy.includes("result.status === 'duplicate'"));
  assert.ok(legacy.includes("title: verifiedUnsettled ? '錯題已確認 · 補償狀態待核實'"));
  assert.ok(legacy.includes('showClose: !limitReached'));
  assert.match(html, /id="report-result-action"/);
  assert.match(html, /id="report-result-close"/);
});

test('PvE zero-gold compensation is approved, and daily limits are distinct from unsettled payouts', async () => {
  const begin=legacy.indexOf("        const retryReport = () => {");
  const end=legacy.indexOf("        return result;",begin);
  assert.ok(begin>0&&end>begin,'report payout decision block exists');
  const code=legacy.slice(begin,end);
  const vm=require('node:vm');
  async function evaluate(result, trial=null) {
    const quiz={mode:'solo',data:{q:'題目'},async onVerifiedError(){}};
    const account={uid:'player'};
    let outcome=null,closed=false,skipped=false;
    const ctx={
      result,trial,quiz,user:account,auth:{currentUser:account},
      currentUserData:{stats:{gold:60,totalScore:40}},
      window:{currentActiveQuiz:quiz,closeReportModal(){closed=true}},
      skipVerifiedQuestion(){skipped=true},
      renderReportOutcome(value){outcome=value},
      updateUIStats(){}
    };
    await vm.runInNewContext("(async function(){\n"+code+"\n})()",ctx);
    return {outcome,ctx,closed:()=>closed,skipped:()=>skipped};
  }
  const battle={id:'room',progress:{stats:{gold:60,totalScore:41}}};
  const confirmed=await evaluate({
    status:'confirmed',valid:true,compensated:true,goldAdded:0,
    cultivationRefund:0,cultivationBonus:1,newGold:60,newTotalScore:41,
    staminaRefunded:3,questionSkipped:false,battle,reason:'獨立審核已確認本題有誤。'
  },{});
  assert.equal(confirmed.outcome.kind,'approved');
  assert.match(confirmed.outcome.message,/修為已入帳/);
  assert.match(confirmed.outcome.message,/補正 3 體力/);
  assert.match(confirmed.outcome.message,/不另發 100 靈石/);
  assert.doesNotMatch(confirmed.outcome.message,/100 靈石已入帳/);
  confirmed.outcome.onAction();
  assert.equal(confirmed.closed(),true);
  assert.equal(confirmed.ctx.currentUserData.stats.totalScore,40,'PvE must not replace battle progress with stale balances');

  const skipped=await evaluate({
    status:'confirmed',valid:true,compensated:true,goldAdded:0,
    cultivationRefund:0,cultivationBonus:1,newGold:60,newTotalScore:41,
    staminaRefunded:4,questionSkipped:true,battle,reason:'已確認'
  },{});
  skipped.outcome.onAction();assert.equal(skipped.skipped(),true);

  const limited=await evaluate({
    status:'limit',valid:true,compensated:false,reason:'已確認有誤，今日已達上限',
    staminaRefunded:2,questionSkipped:true,battle
  },{});
  assert.equal(limited.outcome.kind,'approved');
  assert.match(limited.outcome.title,/補償達上限/);
  assert.match(limited.outcome.message,/不會額外發放/);
  limited.outcome.onAction();assert.equal(limited.skipped(),true);

  const uncertain=await evaluate({
    status:'confirmed',compensated:true,goldAdded:100,reason:'伺服器資料不完整'
  },{});
  assert.equal(uncertain.outcome.kind,'incomplete');
  assert.match(uncertain.outcome.title,/補償狀態待核實/);

  const normal=await evaluate({
    status:'confirmed',compensated:true,goldAdded:100,
    newGold:160,newTotalScore:42,cultivationRefund:1,cultivationBonus:1
  });
  assert.equal(normal.outcome.kind,'approved');
  assert.match(normal.outcome.message,/100 靈石已入帳/);
  assert.equal(normal.ctx.currentUserData.stats.gold,160);
});

test('neutral answers avoid unnecessary stats writes while report persists their audit record', () => {
  assert.match(legacy, /const shouldSaveAnswer = isCorrect \|\| \(learningRules && userIdx >= 0\) \|\| stats\.totalScore !== scoreBeforeAnswer \|\|/);
  assert.match(legacy, /\? persistAnswer\(\)/);
  assert.match(legacy, /quiz\.answerPersistenceDeferred = !shouldSaveAnswer/);
  assert.match(legacy, /if \(quiz\.answerPersistenceDeferred && !quiz\.answerPersistence\)/);
  assert.match(legacy, /'stats\.lastQuizAnswer': currentUserData\.stats\.lastQuizAnswer/);
  assert.ok(legacy.indexOf('quiz.answerPersistence = updateDoc(') < legacy.indexOf("fetch('/api/verify-report'"));
});
