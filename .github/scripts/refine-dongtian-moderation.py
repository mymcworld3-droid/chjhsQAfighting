from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing refinement marker: {label}')
    return text.replace(old, new, 1)

ui_path = Path('public/cultivation/dongtian.js')
ui = ui_path.read_text()
if 'dt-answer-actions' in ui and "const [playSnap, indexSnap]" in ui:
    print('Dongtian moderation refinements already applied.')
    raise SystemExit(0)

ui = replace_once(
    ui,
    ".dt-question-title-row{display:flex;align-items:flex-start;gap:10px}.dt-question-title-row h3{flex:1}.dt-report-question{flex:0 0 auto;min-height:30px;padding:0 9px;border-radius:9px;border:1px solid rgba(251,191,36,.24);background:rgba(120,53,15,.1);color:#fcd34d;font-size:8px;font-weight:900}",
    ".dt-question-title-row{display:flex;align-items:flex-start;gap:10px}.dt-question-title-row h3{flex:1}.dt-answer-actions{display:grid;grid-template-columns:minmax(105px,.34fr) minmax(0,1fr);gap:8px;margin-top:12px}.dt-report-question{min-height:42px;padding:0 9px;border-radius:13px;border:1px solid rgba(251,191,36,.24);background:rgba(120,53,15,.1);color:#fcd34d;font-size:8px;font-weight:900}.dt-answer-actions .dt-next{margin-top:0}",
    'answer action css'
)

old_runner = r'''    overlay.innerHTML = `<main class="dt-runner"><header class="dt-run-head"><div><small>洞天試煉 · FIXED SEQUENCE</small><strong>${escapeHtml(s.dongtian.name)}</strong></div><button id="dt-exit" class="dt-exit" type="button" aria-label="退出洞天"><i class="fa-solid fa-door-open"></i></button></header><div class="dt-run-meta"><div><span>題序</span><b>${s.index + 1} / ${s.dongtian.questions.length}</b></div><div><span>科目</span><b>${escapeHtml(q.subject || s.dongtian.subject)}</b></div><div><span>難度</span><b>${difficultyLabel(q.difficulty)}</b></div></div><div class="dt-progress"><i style="width:${((s.index) / s.dongtian.questions.length) * 100}%"></i></div><section class="dt-question"><div class="dt-question-title-row"><h3>${escapeHtml(q.q)}</h3><button id="dt-report-question" class="dt-report-question" type="button"><i class="fa-solid fa-triangle-exclamation"></i> 問題回報</button></div><div id="dt-options" class="dt-options">${optionObjects.map((option, index) => `<button class="dt-option" type="button" data-dt-answer="${index}"><span>${String.fromCharCode(65 + index)}</span><b>${escapeHtml(option.text)}</b></button>`).join('')}</div><div id="dt-explain-slot"></div></section></main>`;
    overlay.querySelector('#dt-exit').onclick = exitDongtian;
    overlay.querySelector('#dt-report-question').onclick = openQuestionReport;
    overlay.querySelectorAll('[data-dt-answer]').forEach((button) => button.onclick = () => answerDongtian(Number(button.dataset.dtAnswer)));
'''
new_runner = r'''    overlay.innerHTML = `<main class="dt-runner"><header class="dt-run-head"><div><small>洞天試煉 · FIXED SEQUENCE</small><strong>${escapeHtml(s.dongtian.name)}</strong></div><button id="dt-exit" class="dt-exit" type="button" aria-label="退出洞天"><i class="fa-solid fa-door-open"></i></button></header><div class="dt-run-meta"><div><span>題序</span><b>${s.index + 1} / ${s.dongtian.questions.length}</b></div><div><span>科目</span><b>${escapeHtml(q.subject || s.dongtian.subject)}</b></div><div><span>難度</span><b>${difficultyLabel(q.difficulty)}</b></div></div><div class="dt-progress"><i style="width:${((s.index) / s.dongtian.questions.length) * 100}%"></i></div><section class="dt-question"><div class="dt-question-title-row"><h3>${escapeHtml(q.q)}</h3></div><div id="dt-options" class="dt-options">${optionObjects.map((option, index) => `<button class="dt-option" type="button" data-dt-answer="${index}"><span>${String.fromCharCode(65 + index)}</span><b>${escapeHtml(option.text)}</b></button>`).join('')}</div><div id="dt-explain-slot"></div></section></main>`;
    overlay.querySelector('#dt-exit').onclick = exitDongtian;
    overlay.querySelectorAll('[data-dt-answer]').forEach((button) => button.onclick = () => answerDongtian(Number(button.dataset.dtAnswer)));
'''
ui = replace_once(ui, old_runner, new_runner, 'hide report until answered')

old_explain = r'''    slot.innerHTML = `<div class="dt-explain"><strong style="color:${isCorrect ? '#86efac' : '#fca5a5'}">${isCorrect ? '答對 · 靈機相合' : '答錯 · 參悟解析'}</strong><br>${escapeHtml(q.exp)}</div><button id="dt-next" type="button" class="dt-next">${s.index + 1 >= s.dongtian.questions.length ? '完成洞天' : '前往下一境'}</button>`;
    document.getElementById('dt-next').onclick = async () => {
'''
new_explain = r'''    slot.innerHTML = `<div class="dt-explain"><strong style="color:${isCorrect ? '#86efac' : '#fca5a5'}">${isCorrect ? '答對 · 靈機相合' : '答錯 · 參悟解析'}</strong><br>${escapeHtml(q.exp)}</div><div class="dt-answer-actions"><button id="dt-report-question" class="dt-report-question" type="button"><i class="fa-solid fa-triangle-exclamation"></i> 問題回報</button><button id="dt-next" type="button" class="dt-next">${s.index + 1 >= s.dongtian.questions.length ? '完成洞天' : '前往下一境'}</button></div>`;
    document.getElementById('dt-report-question').onclick = openQuestionReport;
    document.getElementById('dt-next').onclick = async () => {
'''
ui = replace_once(ui, old_explain, new_explain, 'post-answer report button')

old_repair_question = "<div class=\"dt-modal-question\"><strong>第 ${questionIndex + 1} 題 · ${escapeHtml(question.subject || dongtian.subject)} · ${difficultyLabel(question.difficulty)}</strong><br>${escapeHtml(question.q)}<br><br><span style=\"color:#86efac\">原標示答案：${escapeHtml(question.correct)}</span></div>"
new_repair_question = "<div class=\"dt-modal-question\"><strong>第 ${questionIndex + 1} 題 · ${escapeHtml(question.subject || dongtian.subject)} · ${difficultyLabel(question.difficulty)}</strong><br>${escapeHtml(question.q)}<br><br><span style=\"color:#86efac\">正解：${escapeHtml(question.correct)}</span><br><span style=\"color:#c4b5fd\">其他選項：${(question.wrong || []).map((item) => escapeHtml(item)).join(' ／ ')}</span><br><br><span style=\"color:#aaa\">原解析：${escapeHtml(question.exp || '')}</span></div>"
ui = replace_once(ui, old_repair_question, new_repair_question, 'full repair context')

old_progress = r'''    await runTransaction(db, async (tx) => {
      const playSnap = await tx.get(playRef);
      const alreadyCompleted = playSnap.exists() && !!playSnap.data()?.completed;
      first = !alreadyCompleted;
      tx.set(playRef, {
'''
new_progress = r'''    await runTransaction(db, async (tx) => {
      const [playSnap, indexSnap] = await Promise.all([tx.get(playRef), tx.get(indexRef)]);
      if (!indexSnap.exists() || indexSnap.data()?.status !== 'active') throw new Error('洞天已封印，本次不進行通關結算');
      const alreadyCompleted = playSnap.exists() && !!playSnap.data()?.completed;
      first = !alreadyCompleted;
      tx.set(playRef, {
'''
ui = replace_once(ui, old_progress, new_progress, 'atomic completion status guard')
ui_path.write_text(ui)

# Strengthen regression tests for the two race/cheat issues.
test_path = Path('tests/dongtian.test.cjs')
test = test_path.read_text()
extra = r'''

test('Question report only appears after answering, so it cannot reveal the answer early', () => {
  const runner = uiSource.slice(uiSource.indexOf('function renderRunner'), uiSource.indexOf('function answerDongtian'));
  const answer = uiSource.slice(uiSource.indexOf('function answerDongtian'), uiSource.indexOf('function removeModerationModal'));
  assert.doesNotMatch(runner, /dt-report-question/);
  assert.match(answer, /dt-report-question/);
  assert.match(answer, /document\.getElementById\('dt-report-question'\)\.onclick = openQuestionReport/);
});

test('Completion reward transaction rechecks active status to prevent seal/reward races', () => {
  const completion = uiSource.slice(uiSource.indexOf('async function completeProgress'), uiSource.indexOf('async function writeDongtianHistory'));
  assert.match(completion, /const \[playSnap, indexSnap\] = await Promise\.all/);
  assert.match(completion, /indexSnap\.data\(\)\?\.status !== 'active'/);
  assert.match(completion, /洞天已封印，本次不進行通關結算/);
});
'''
if 'Question report only appears after answering' not in test:
    test += extra
test_path.write_text(test)
