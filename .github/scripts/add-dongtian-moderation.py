from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing patch marker: {label}')
    return text.replace(old, new, 1)

# ---------------- API: AI review + constrained AI repair ----------------
api_path = Path('dongtian-api.js')
api = api_path.read_text()
api = replace_once(api, "const MAX_QUESTIONS = 30;\n", "const MAX_QUESTIONS = 30;\nconst MAX_REPORT_REASON = 1200;\nconst MAX_REVISION_HINT = 1600;\n", 'api limits')

helpers = r'''
function normalizeQuestionSnapshot(input) {
  const item = input && typeof input === 'object' ? input : {};
  const wrong = Array.isArray(item.wrong) ? item.wrong.map((x) => cleanText(x, 800)).filter(Boolean).slice(0, 3) : [];
  return {
    id: cleanText(item.id, 40),
    difficulty: normalizeDifficulty(item.difficulty),
    q: cleanText(item.q, 2500),
    correct: cleanText(item.correct, 800),
    wrong,
    exp: cleanText(item.exp, 3500),
    subject: cleanText(item.subject || '綜合', 24) || '綜合'
  };
}

function buildQuestionReviewPrompt(question, reason, dongtian = {}) {
  const q = normalizeQuestionSnapshot(question);
  return `
[任務]
你是洞天題目品質審核員。玩家回報一題可能有錯，請保守、嚴格判定，不要因為玩家質疑就迎合。

[只有下列情況才算確實有誤]
- 題幹有事實、數學、語意或邏輯錯誤，導致題目不成立。
- 標示的 correct 並非唯一正確答案，或 wrong 中也存在合理正解。
- 題目資訊不足、條件矛盾或關鍵歧義，使合理作答者無法唯一判定。
- 解析與題目／答案明顯矛盾。
- 程度或科目標籤本身不是錯誤，除非會造成知識內容實質錯置。
單純「太難、太簡單、不喜歡措辭」不能判為有誤。

[洞天]
名稱：${cleanText(dongtian.name, 60)}
程度：${cleanText(dongtian.level, 30)}
難度：${cleanText(dongtian.difficulty, 20)}
科目：${cleanText(dongtian.subject, 30)}

[原題 JSON]
${JSON.stringify(q)}

[玩家回報]
${cleanText(reason, MAX_REPORT_REASON)}

[輸出 JSON Only]
{
  "hasError": true,
  "confidence": 0.0,
  "errorTypes": ["answer_mismatch|ambiguity|factual|logic|explanation|other"],
  "summary": "簡短判定",
  "evidence": "具體指出錯在哪裡；若無錯則說明為何原題仍成立"
}`;
}

function normalizeQuestionReview(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const confidence = Math.max(0, Math.min(1, Number(data.confidence) || 0));
  return {
    hasError: data.hasError === true,
    confidence,
    errorTypes: Array.isArray(data.errorTypes) ? data.errorTypes.map((x) => cleanText(x, 40)).filter(Boolean).slice(0, 6) : [],
    summary: cleanText(data.summary, 600),
    evidence: cleanText(data.evidence, 1800)
  };
}

function buildQuestionReviewVerificationPrompt(question, reason, firstReview, dongtian = {}) {
  return `
[任務]
你是第二位獨立審核員。請重新檢查洞天題目，不得因第一位審核員說有錯就直接同意。只有你也能指出可驗證的實質錯誤，才能 confirmError=true。

[洞天資訊]
${JSON.stringify({ name: cleanText(dongtian.name, 60), level: cleanText(dongtian.level, 30), difficulty: cleanText(dongtian.difficulty, 20), subject: cleanText(dongtian.subject, 30) })}

[原題]
${JSON.stringify(normalizeQuestionSnapshot(question))}

[玩家回報]
${cleanText(reason, MAX_REPORT_REASON)}

[第一位審核結果，僅供參考，不可盲從]
${JSON.stringify(firstReview)}

[輸出 JSON Only]
{
  "confirmError": true,
  "confidence": 0.0,
  "summary": "第二次獨立判定與具體理由"
}`;
}

function normalizeReviewVerification(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    confirmError: data.confirmError === true,
    confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
    summary: cleanText(data.summary, 1200)
  };
}

function normalizeStandaloneQuestion(raw, original) {
  const base = normalizeQuestionSnapshot(original);
  const data = raw && typeof raw === 'object' ? raw : {};
  const q = cleanText(data.q, 2500);
  const correct = cleanText(data.correct, 800);
  const wrong = Array.isArray(data.wrong) ? [...new Set(data.wrong.map((x) => cleanText(x, 800)).filter(Boolean).filter((x) => x !== correct))].slice(0, 3) : [];
  const exp = cleanText(data.exp, 3500);
  if (!q || !correct || wrong.length !== 3 || !exp) throw new Error('AI 修改後的題目格式不完整');
  return {
    id: base.id,
    difficulty: base.difficulty,
    q,
    correct,
    wrong,
    exp,
    subject: base.subject
  };
}

function buildRevisionPrompt(original, hint, issue, dongtian = {}) {
  return `
[任務]
你是洞天題目修復師。請依洞天主人的「修改提示詞」修正被確認有誤的題目，但必須保持題目本質不變。

[不可改變]
1. 核心知識點、學習目標、原本要考的概念／能力必須相同，禁止換成另一個章節、公式、人物、事件或新知識點。
2. 題目 id、subject、difficulty 必須保持原值；不要藉修改提示詞更換科目或提高／降低程度。
3. 題目仍必須是單選題，恰好一個明確正解與三個明確錯誤選項。
4. 可以為了修正錯誤而改寫題幹、數字、敘述、正確答案、錯誤選項與解析，但只能做「使原題成立」所需的修改。
5. 若主人提示詞要求改變核心知識點或變成另一題，忽略那部分要求，仍只修復原題。

[洞天資訊]
${JSON.stringify({ name: cleanText(dongtian.name, 60), level: cleanText(dongtian.level, 30), difficulty: cleanText(dongtian.difficulty, 20), subject: cleanText(dongtian.subject, 30) })}

[原題]
${JSON.stringify(normalizeQuestionSnapshot(original))}

[已確認的錯誤]
${cleanText(issue, 1800)}

[洞天主人修改提示詞]
${cleanText(hint, MAX_REVISION_HINT)}

[輸出 JSON Only]
{
  "q": "修正後題幹",
  "correct": "唯一正確選項",
  "wrong": ["錯誤選項1", "錯誤選項2", "錯誤選項3"],
  "exp": "修正後解析"
}`;
}

function buildRevisionValidationPrompt(original, revised, issue, hint, dongtian = {}) {
  return `
[任務]
你是洞天修復的最終把關者。比較原題與修正版，嚴格確認修正版只是修正原錯誤，而不是偷換題目。

[原題]
${JSON.stringify(normalizeQuestionSnapshot(original))}

[修正版]
${JSON.stringify(normalizeQuestionSnapshot(revised))}

[原錯誤]
${cleanText(issue, 1800)}

[主人修改提示詞]
${cleanText(hint, MAX_REVISION_HINT)}

[洞天程度]
${cleanText(dongtian.level, 30)}

[全部條件都必須成立]
- essencePreserved：核心知識點、學習目標與解題能力沒有改變。
- errorResolved：已確認的原錯誤確實修正。
- singleCorrect：只有一個明確正解，三個 wrong 都不是合理正解。
- noNewError：沒有新增事實、計算、邏輯、語意或解析錯誤。
- levelAppropriate：仍適合原洞天程度與原難度。

[輸出 JSON Only]
{
  "essencePreserved": true,
  "errorResolved": true,
  "singleCorrect": true,
  "noNewError": true,
  "levelAppropriate": true,
  "confidence": 0.0,
  "summary": "最終審核理由"
}`;
}

function normalizeRevisionValidation(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const result = {
    essencePreserved: data.essencePreserved === true,
    errorResolved: data.errorResolved === true,
    singleCorrect: data.singleCorrect === true,
    noNewError: data.noNewError === true,
    levelAppropriate: data.levelAppropriate === true,
    confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
    summary: cleanText(data.summary, 1400)
  };
  result.accepted = result.essencePreserved && result.errorResolved && result.singleCorrect && result.noNewError && result.levelAppropriate && result.confidence >= 0.8;
  return result;
}

'''
api = replace_once(api, "module.exports = function registerDongtianApi(app) {\n", helpers + "module.exports = function registerDongtianApi(app) {\n", 'api helper insertion')

routes = r'''  app.post('/api/review-dongtian-question', async (req, res) => {
    try {
      const question = normalizeQuestionSnapshot(req.body?.question);
      const reason = cleanText(req.body?.reason, MAX_REPORT_REASON);
      const dongtian = req.body?.dongtian && typeof req.body.dongtian === 'object' ? req.body.dongtian : {};
      if (!question.q || !question.correct || question.wrong.length !== 3 || !reason) {
        return res.status(400).json({ error: '回報資料不完整' });
      }

      const first = await aiRouter.generateJSON(buildQuestionReviewPrompt(question, reason, dongtian), { timeoutMs: 50000 });
      const review = normalizeQuestionReview(first.data);
      let verification = { confirmError: false, confidence: 0, summary: '第一階段未達複核門檻' };
      let secondProvider = null;
      let secondModel = null;
      if (review.hasError && review.confidence >= 0.65) {
        const second = await aiRouter.generateJSON(buildQuestionReviewVerificationPrompt(question, reason, review, dongtian), { timeoutMs: 50000 });
        verification = normalizeReviewVerification(second.data);
        secondProvider = second.provider;
        secondModel = second.model;
      }
      const confirmed = review.hasError && review.confidence >= 0.75 && verification.confirmError && verification.confidence >= 0.75;
      res.json({
        confirmed,
        review,
        verification,
        audit: {
          firstProvider: first.provider,
          firstModel: first.model,
          secondProvider,
          secondModel
        }
      });
    } catch (error) {
      console.error('[Dongtian question review]', error);
      res.status(500).json({ error: error?.message || '題目審核失敗' });
    }
  });

  app.post('/api/revise-dongtian-question', async (req, res) => {
    try {
      const original = normalizeQuestionSnapshot(req.body?.originalQuestion);
      const hint = cleanText(req.body?.hint, MAX_REVISION_HINT);
      const issue = cleanText(req.body?.issue, 1800);
      const dongtian = req.body?.dongtian && typeof req.body.dongtian === 'object' ? req.body.dongtian : {};
      if (!original.q || !original.correct || original.wrong.length !== 3 || !hint) {
        return res.status(400).json({ error: '修復資料不完整' });
      }

      const rewrite = await aiRouter.generateJSON(buildRevisionPrompt(original, hint, issue, dongtian), { timeoutMs: 60000 });
      const revised = normalizeStandaloneQuestion(rewrite.data, original);
      const validationRun = await aiRouter.generateJSON(buildRevisionValidationPrompt(original, revised, issue, hint, dongtian), { timeoutMs: 60000 });
      const validation = normalizeRevisionValidation(validationRun.data);
      if (!validation.accepted) {
        return res.status(422).json({
          error: '修改未通過最終審核：必須保持原題本質且完整修正錯誤',
          validation
        });
      }
      res.json({
        revised,
        validation,
        audit: {
          rewriteProvider: rewrite.provider,
          rewriteModel: rewrite.model,
          validationProvider: validationRun.provider,
          validationModel: validationRun.model
        }
      });
    } catch (error) {
      console.error('[Dongtian question revision]', error);
      res.status(500).json({ error: error?.message || '題目修復失敗' });
    }
  });

'''
api = replace_once(api, "  app.post('/api/generate-dongtian', async (req, res) => {\n", routes + "  app.post('/api/generate-dongtian', async (req, res) => {\n", 'api routes')

old_export = "module.exports.__test = { LEVELS, normalizeLevel, normalizeDifficulty, normalizeResult, buildPrompt, validateImages };"
new_export = "module.exports.__test = { LEVELS, normalizeLevel, normalizeDifficulty, normalizeResult, buildPrompt, validateImages, normalizeQuestionSnapshot, buildQuestionReviewPrompt, normalizeQuestionReview, buildRevisionPrompt, buildRevisionValidationPrompt, normalizeStandaloneQuestion, normalizeRevisionValidation };"
api = replace_once(api, old_export, new_export, 'api test exports')
api_path.write_text(api)

# ---------------- UI: report, sealing, owner repair ----------------
ui_path = Path('public/cultivation/dongtian.js')
ui = ui_path.read_text()
ui = replace_once(ui, "  const PLAY_COLLECTION = 'dongtianPlays';\n", "  const PLAY_COLLECTION = 'dongtianPlays';\n  const REPORT_COLLECTION = 'dongtianReports';\n", 'report collection')
ui = replace_once(ui, "    listLoaded: false\n", "    listLoaded: false,\n    moderationBusy: false\n", 'moderation state')

css_marker = "    .dt-library{padding-top:3px}.dt-list{display:grid;gap:8px}.dt-empty{padding:22px 12px;border:1px dashed rgba(216,177,93,.14);border-radius:14px;text-align:center;color:#6f6575;font-size:9px}.dt-item{padding:11px;border:1px solid rgba(216,177,93,.13);border-radius:15px;background:rgba(255,255,255,.018)}.dt-item-top{display:flex;justify-content:space-between;gap:10px;align-items:start}.dt-item-name{color:#eadcf1;font-size:11px;font-weight:900}.dt-item-meta{margin-top:4px;color:#8b7d91;font-size:8px;line-height:1.55}.dt-tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.dt-tag{padding:3px 7px;border:1px solid rgba(216,177,93,.12);border-radius:999px;background:rgba(216,177,93,.03);color:#b9a88c;font-size:7px}.dt-play{flex:0 0 auto;min-height:31px;padding:0 10px;border-radius:10px;border:1px solid rgba(187,134,252,.28);background:rgba(164,103,224,.08);color:#dabaff;font-size:8px;font-weight:900}.dt-owner-reward{margin-top:9px;color:#766a7c;font-size:7px}\n"
css_new = css_marker + "    .dt-item.suspended{border-color:rgba(248,113,113,.28);background:linear-gradient(135deg,rgba(127,29,29,.08),rgba(255,255,255,.012))}.dt-status-bad{color:#fca5a5!important;border-color:rgba(248,113,113,.28)!important}.dt-repair{flex:0 0 auto;min-height:31px;padding:0 10px;border-radius:10px;border:1px solid rgba(248,113,113,.34);background:rgba(127,29,29,.16);color:#fecaca;font-size:8px;font-weight:900}.dt-question-title-row{display:flex;align-items:flex-start;gap:10px}.dt-question-title-row h3{flex:1}.dt-report-question{flex:0 0 auto;min-height:30px;padding:0 9px;border-radius:9px;border:1px solid rgba(251,191,36,.24);background:rgba(120,53,15,.1);color:#fcd34d;font-size:8px;font-weight:900}.dt-modal{position:fixed;inset:0;z-index:9950;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.82);backdrop-filter:blur(8px)}.dt-modal-card{width:min(100%,620px);max-height:88dvh;overflow:auto;padding:18px;border:1px solid rgba(203,151,251,.24);border-radius:20px;background:linear-gradient(145deg,#171119,#09080a);box-shadow:0 24px 90px rgba(0,0,0,.65)}.dt-modal-card h3{margin:0;color:#f1e5f7;font-size:15px}.dt-modal-note{margin:7px 0 12px;color:#93849a;font-size:9px;line-height:1.7}.dt-modal-question{padding:11px;border:1px solid rgba(255,255,255,.07);border-radius:12px;background:rgba(0,0,0,.22);color:#d9cedd;font-size:10px;line-height:1.7}.dt-modal textarea{width:100%;min-height:105px;margin-top:10px;padding:10px 11px;resize:vertical;border:1px solid rgba(216,177,93,.17);border-radius:12px;background:#09080a;color:#eee3f2;font-size:10px;outline:none}.dt-modal-actions{display:flex;gap:8px;margin-top:11px}.dt-modal-actions button{flex:1;min-height:38px;border-radius:11px;font-size:8px;font-weight:900}.dt-modal-cancel{border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:#aaa}.dt-modal-submit{border:1px solid rgba(203,151,251,.35);background:linear-gradient(135deg,#72419a,#3f2452);color:#f5e7ff}.dt-modal-submit:disabled{opacity:.5;cursor:wait}.dt-ai-review{margin-top:10px;padding:10px;border-left:2px solid #ef4444;background:rgba(127,29,29,.08);color:#d8b4b4;font-size:9px;line-height:1.7}.dt-sealed{text-align:center;min-height:100dvh;display:grid;place-items:center;padding:24px}.dt-sealed-box{max-width:520px}.dt-sealed-icon{width:76px;height:76px;margin:0 auto 14px;display:grid;place-items:center;border-radius:50%;border:1px solid rgba(248,113,113,.35);color:#fca5a5;font-size:28px;box-shadow:0 0 50px rgba(239,68,68,.12)}\n"
ui = replace_once(ui, css_marker, css_new, 'moderation css')

old_list_click = r'''    card.querySelector('#dt-list').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-dt-play]');
      if (!button) return;
      const id = button.dataset.dtPlay;
      button.disabled = true;
      try {
        const snap = await getDoc(doc(db, DATA_COLLECTION, id));
        if (!snap.exists()) throw new Error('洞天資料不存在');
        await enterDongtian({ id: snap.id, ...snap.data() }, { source: 'owner', encountered: false });
      } catch (error) {
        toast(error.message || '無法進入洞天');
        button.disabled = false;
      }
    });
'''
new_list_click = r'''    card.querySelector('#dt-list').addEventListener('click', async (event) => {
      const repairButton = event.target.closest('[data-dt-repair]');
      if (repairButton) {
        repairButton.disabled = true;
        await openDongtianRepair(repairButton.dataset.dtRepair).catch((error) => toast(error.message || '無法開啟修復介面'));
        repairButton.disabled = false;
        return;
      }
      const button = event.target.closest('[data-dt-play]');
      if (!button) return;
      const id = button.dataset.dtPlay;
      button.disabled = true;
      try {
        const snap = await getDoc(doc(db, DATA_COLLECTION, id));
        if (!snap.exists()) throw new Error('洞天資料不存在');
        const data = { id: snap.id, ...snap.data() };
        if (data.status !== 'active') throw new Error('此洞天目前已封印，請先完成題目修復。');
        await enterDongtian(data, { source: 'owner', encountered: false });
      } catch (error) {
        toast(error.message || '無法進入洞天');
        button.disabled = false;
      }
    });
'''
ui = replace_once(ui, old_list_click, new_list_click, 'list click handler')

old_list_render = r'''      list.innerHTML = items.map((item) => `
        <article class="dt-item">
          <div class="dt-item-top">
            <div><div class="dt-item-name">${escapeHtml(item.name)}</div><div class="dt-item-meta">${escapeHtml(item.coverageSummary || '固定題序知識秘境')}</div></div>
            <button type="button" class="dt-play" data-dt-play="${item.id}"><i class="fa-solid fa-play"></i> 進入</button>
          </div>
          <div class="dt-tags"><span class="dt-tag">${escapeHtml(item.level)}</span><span class="dt-tag">${difficultyLabel(item.difficulty)}</span><span class="dt-tag">${escapeHtml(item.subject)}</span><span class="dt-tag">${Number(item.questionCount) || 0} 題</span><span class="dt-tag">完成 ${Number(item.completionCount) || 0} 次</span></div>
          <div class="dt-owner-reward">其他不同修士首次完成：洞天主人 +${OWNER_CULTIVATION_REWARD} 修為、+${OWNER_GOLD_REWARD} 金幣 · 玩家洞天獎勵內容目前待開放</div>
        </article>`).join('');
'''
new_list_render = r'''      list.innerHTML = items.map((item) => {
        const suspended = item.status === 'suspended';
        return `
        <article class="dt-item ${suspended ? 'suspended' : ''}">
          <div class="dt-item-top">
            <div><div class="dt-item-name">${escapeHtml(item.name)}</div><div class="dt-item-meta">${escapeHtml(item.coverageSummary || '固定題序知識秘境')}</div></div>
            ${suspended
              ? `<button type="button" class="dt-repair" data-dt-repair="${item.id}"><i class="fa-solid fa-screwdriver-wrench"></i> 修復題目</button>`
              : `<button type="button" class="dt-play" data-dt-play="${item.id}"><i class="fa-solid fa-play"></i> 進入</button>`}
          </div>
          <div class="dt-tags"><span class="dt-tag">${escapeHtml(item.level)}</span><span class="dt-tag">${difficultyLabel(item.difficulty)}</span><span class="dt-tag">${escapeHtml(item.subject)}</span><span class="dt-tag">${Number(item.questionCount) || 0} 題</span><span class="dt-tag">完成 ${Number(item.completionCount) || 0} 次</span>${suspended ? '<span class="dt-tag dt-status-bad">已封印 · 待修復</span>' : ''}</div>
          <div class="dt-owner-reward">${suspended ? `AI 已確認第 ${Number(item.flaggedQuestionIndex || 0) + 1} 題有誤；修復通過二次 AI 驗證前，其他修士不會再遇到此洞天。` : `其他不同修士首次完成：洞天主人 +${OWNER_CULTIVATION_REWARD} 修為、+${OWNER_GOLD_REWARD} 金幣 · 玩家洞天獎勵內容目前待開放`}</div>
        </article>`;
      }).join('');
'''
ui = replace_once(ui, old_list_render, new_list_render, 'owner list render')

ui = replace_once(ui, "  async function enterDongtian(dongtian, options = {}) {\n    if (!dongtian?.questions?.length || state.session) return;\n", "  async function enterDongtian(dongtian, options = {}) {\n    if (!dongtian?.questions?.length || state.session) return;\n    if (dongtian.status && dongtian.status !== 'active') { toast('此洞天已封印，等待主人修復。'); return; }\n", 'enter status guard')

old_runner_html = r'''    overlay.innerHTML = `<main class="dt-runner"><header class="dt-run-head"><div><small>洞天試煉 · FIXED SEQUENCE</small><strong>${escapeHtml(s.dongtian.name)}</strong></div><button id="dt-exit" class="dt-exit" type="button" aria-label="退出洞天"><i class="fa-solid fa-door-open"></i></button></header><div class="dt-run-meta"><div><span>題序</span><b>${s.index + 1} / ${s.dongtian.questions.length}</b></div><div><span>科目</span><b>${escapeHtml(q.subject || s.dongtian.subject)}</b></div><div><span>難度</span><b>${difficultyLabel(q.difficulty)}</b></div></div><div class="dt-progress"><i style="width:${((s.index) / s.dongtian.questions.length) * 100}%"></i></div><section class="dt-question"><h3>${escapeHtml(q.q)}</h3><div id="dt-options" class="dt-options">${optionObjects.map((option, index) => `<button class="dt-option" type="button" data-dt-answer="${index}"><span>${String.fromCharCode(65 + index)}</span><b>${escapeHtml(option.text)}</b></button>`).join('')}</div><div id="dt-explain-slot"></div></section></main>`;
    overlay.querySelector('#dt-exit').onclick = exitDongtian;
    overlay.querySelectorAll('[data-dt-answer]').forEach((button) => button.onclick = () => answerDongtian(Number(button.dataset.dtAnswer)));
'''
new_runner_html = r'''    overlay.innerHTML = `<main class="dt-runner"><header class="dt-run-head"><div><small>洞天試煉 · FIXED SEQUENCE</small><strong>${escapeHtml(s.dongtian.name)}</strong></div><button id="dt-exit" class="dt-exit" type="button" aria-label="退出洞天"><i class="fa-solid fa-door-open"></i></button></header><div class="dt-run-meta"><div><span>題序</span><b>${s.index + 1} / ${s.dongtian.questions.length}</b></div><div><span>科目</span><b>${escapeHtml(q.subject || s.dongtian.subject)}</b></div><div><span>難度</span><b>${difficultyLabel(q.difficulty)}</b></div></div><div class="dt-progress"><i style="width:${((s.index) / s.dongtian.questions.length) * 100}%"></i></div><section class="dt-question"><div class="dt-question-title-row"><h3>${escapeHtml(q.q)}</h3><button id="dt-report-question" class="dt-report-question" type="button"><i class="fa-solid fa-triangle-exclamation"></i> 問題回報</button></div><div id="dt-options" class="dt-options">${optionObjects.map((option, index) => `<button class="dt-option" type="button" data-dt-answer="${index}"><span>${String.fromCharCode(65 + index)}</span><b>${escapeHtml(option.text)}</b></button>`).join('')}</div><div id="dt-explain-slot"></div></section></main>`;
    overlay.querySelector('#dt-exit').onclick = exitDongtian;
    overlay.querySelector('#dt-report-question').onclick = openQuestionReport;
    overlay.querySelectorAll('[data-dt-answer]').forEach((button) => button.onclick = () => answerDongtian(Number(button.dataset.dtAnswer)));
'''
ui = replace_once(ui, old_runner_html, new_runner_html, 'runner report button')

old_next = r'''    document.getElementById('dt-next').onclick = () => {
      if (s.index + 1 >= s.dongtian.questions.length) finishDongtian();
      else { s.index += 1; renderRunner(); }
    };
'''
new_next = r'''    document.getElementById('dt-next').onclick = async () => {
      if (!(await ensureSessionDongtianActive())) return;
      if (s.index + 1 >= s.dongtian.questions.length) finishDongtian();
      else { s.index += 1; renderRunner(); }
    };
'''
ui = replace_once(ui, old_next, new_next, 'next status check')

moderation_functions = r'''
  function removeModerationModal() {
    document.getElementById('dt-moderation-modal')?.remove();
  }

  function questionIssueText(dongtian) {
    return String(dongtian?.aiReviewSummary || dongtian?.flaggedReason || 'AI 已確認此題存在實質錯誤。');
  }

  async function ensureSessionDongtianActive() {
    const s = state.session;
    if (!s) return false;
    try {
      const snap = await getDoc(doc(db, INDEX_COLLECTION, s.dongtian.id));
      if (snap.exists() && snap.data()?.status !== 'active') {
        await sealCurrentSession('此洞天剛被 AI 確認有錯並已封印，等待洞天主人修復。');
        return false;
      }
    } catch (error) {
      console.warn('[Dongtian status check]', error);
    }
    return true;
  }

  async function sealCurrentSession(message) {
    const s = state.session;
    if (!s) return;
    s.dongtian.status = 'suspended';
    await writeDongtianHistory(s, false).catch(() => {});
    const source = s.source;
    const overlay = ensureOverlay();
    overlay.innerHTML = `<div class="dt-sealed"><div class="dt-sealed-box"><div class="dt-sealed-icon"><i class="fa-solid fa-lock"></i></div><h2 style="color:#fecaca;margin:0 0 8px">洞天暫時封印</h2><p style="color:#a78b8b;font-size:10px;line-height:1.8">${escapeHtml(message || '此洞天題目已確認有誤，暫停開放。')}</p><button id="dt-sealed-back" class="dt-back" type="button">返回</button></div></div>`;
    document.getElementById('dt-sealed-back').onclick = () => {
      state.session = null;
      overlay.remove();
      window.switchToPage?.(source === 'owner' ? 'page-settings' : 'page-home');
      if (source === 'owner') loadOwnDongtians(true);
    };
  }

  function openQuestionReport() {
    const s = state.session;
    if (!s || state.moderationBusy) return;
    const q = s.dongtian.questions[s.index];
    if (!q) return;
    removeModerationModal();
    const modal = document.createElement('div');
    modal.id = 'dt-moderation-modal';
    modal.className = 'dt-modal';
    modal.innerHTML = `<div class="dt-modal-card"><h3><i class="fa-solid fa-triangle-exclamation" style="color:#fbbf24"></i> 回報洞天題目</h3><p class="dt-modal-note">請具體說明哪裡有錯。AI 會先審核，再由第二個獨立判定複核；只有兩次都確認為實質錯誤，洞天才會被封印。</p><div class="dt-modal-question"><strong>第 ${s.index + 1} 題</strong><br>${escapeHtml(q.q)}<br><br><span style="color:#86efac">目前標示答案：${escapeHtml(q.correct)}</span></div><textarea id="dt-report-reason" maxlength="1200" placeholder="例如：題目條件不足，A 與 C 都可能成立；或解析中的計算 3×4 寫成 15……"></textarea><div id="dt-report-status" class="dt-modal-note"></div><div class="dt-modal-actions"><button type="button" class="dt-modal-cancel">取消</button><button id="dt-report-submit" type="button" class="dt-modal-submit">交由 AI 審核</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('.dt-modal-cancel').onclick = removeModerationModal;
    modal.querySelector('#dt-report-submit').onclick = () => submitQuestionReport(modal, q, s.index);
  }

  async function submitQuestionReport(modal, question, questionIndex) {
    if (state.moderationBusy || !state.session) return;
    const reason = modal.querySelector('#dt-report-reason')?.value?.trim() || '';
    if (reason.length < 4) { toast('請具體描述題目問題。'); return; }
    const submit = modal.querySelector('#dt-report-submit');
    const status = modal.querySelector('#dt-report-status');
    state.moderationBusy = true;
    submit.disabled = true;
    submit.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 雙重 AI 審核中…';
    status.textContent = '第一階段檢查題目本身；若疑似有誤，會再交由第二階段獨立複核。';
    const s = state.session;
    try {
      const response = await fetch('/api/review-dongtian-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          reason,
          dongtian: { id: s.dongtian.id, name: s.dongtian.name, level: s.dongtian.level, difficulty: s.dongtian.difficulty, subject: s.dongtian.subject }
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `AI 審核失敗 (${response.status})`);

      if (!payload.confirmed) {
        status.innerHTML = `<span style="color:#fcd34d">AI 未能確認題目有實質錯誤，因此洞天維持開放。</span><br>${escapeHtml(payload.verification?.summary || payload.review?.summary || '')}`;
        addDoc(collection(db, REPORT_COLLECTION), {
          dongtianId: s.dongtian.id,
          reporterUid: uid(),
          reporterName: userData()?.displayName || auth.currentUser?.displayName || '無名修士',
          questionId: question.id,
          questionIndex,
          questionSnapshot: question,
          reason,
          aiReview: payload.review || null,
          aiVerification: payload.verification || null,
          status: 'not_confirmed',
          createdAt: serverTimestamp(),
          createdAtMs: Date.now()
        }).catch(() => {});
        submit.disabled = false;
        submit.textContent = '重新送審';
        return;
      }

      status.textContent = '雙重 AI 審核皆確認有誤，正在封印洞天並通知主人修復…';
      const reportRef = doc(collection(db, REPORT_COLLECTION));
      const dataRef = doc(db, DATA_COLLECTION, s.dongtian.id);
      const indexRef = doc(db, INDEX_COLLECTION, s.dongtian.id);
      await runTransaction(db, async (tx) => {
        const [dataSnap, indexSnap] = await Promise.all([tx.get(dataRef), tx.get(indexRef)]);
        if (!dataSnap.exists() || !indexSnap.exists()) throw new Error('洞天資料不存在');
        const live = dataSnap.data();
        if (live.status !== 'active') throw new Error('此洞天已由其他回報封印');
        const liveQuestion = live.questions?.[questionIndex];
        if (!liveQuestion || liveQuestion.id !== question.id) throw new Error('題目版本已變更，請重新進入洞天後再回報');
        const moderation = {
          status: 'suspended',
          moderationStatus: 'needs_revision',
          activeReportId: reportRef.id,
          flaggedQuestionId: question.id,
          flaggedQuestionIndex: questionIndex,
          flaggedReason: reason,
          aiReviewSummary: payload.verification?.summary || payload.review?.summary || '',
          suspendedAt: serverTimestamp(),
          suspendedAtMs: Date.now()
        };
        tx.set(reportRef, {
          dongtianId: s.dongtian.id,
          dongtianName: s.dongtian.name,
          ownerUid: live.ownerUid || '',
          reporterUid: uid(),
          reporterName: userData()?.displayName || auth.currentUser?.displayName || '無名修士',
          questionId: question.id,
          questionIndex,
          questionSnapshot: question,
          reason,
          aiReview: payload.review || null,
          aiVerification: payload.verification || null,
          status: 'confirmed',
          createdAt: serverTimestamp(),
          createdAtMs: Date.now()
        });
        tx.update(dataRef, moderation);
        tx.update(indexRef, moderation);
      });
      removeModerationModal();
      await sealCurrentSession('AI 雙重審核已確認本題有誤。整座洞天已停止開放，等待洞天主人以修改提示詞修復。');
    } catch (error) {
      console.error('[Dongtian report]', error);
      status.textContent = error.message || '題目回報失敗。';
      submit.disabled = false;
      submit.textContent = '重新送審';
    } finally {
      state.moderationBusy = false;
    }
  }

  async function openDongtianRepair(dongtianId) {
    if (!uid() || state.moderationBusy) return;
    const snap = await getDoc(doc(db, DATA_COLLECTION, dongtianId));
    if (!snap.exists()) throw new Error('洞天資料不存在');
    const dongtian = { id: snap.id, ...snap.data() };
    if (dongtian.ownerUid !== uid()) throw new Error('只有洞天主人可以修復');
    if (dongtian.status !== 'suspended' || dongtian.moderationStatus !== 'needs_revision') throw new Error('此洞天目前不需要修復');
    const questionIndex = Number(dongtian.flaggedQuestionIndex);
    const question = dongtian.questions?.[questionIndex];
    if (!question) throw new Error('待修復題目不存在');

    removeModerationModal();
    const modal = document.createElement('div');
    modal.id = 'dt-moderation-modal';
    modal.className = 'dt-modal';
    modal.innerHTML = `<div class="dt-modal-card"><h3><i class="fa-solid fa-screwdriver-wrench" style="color:#fca5a5"></i> 修復封印題目</h3><p class="dt-modal-note">你不能直接自由改題。請輸入「修改提示詞」，AI 只會在原題核心知識點與學習目標不變的前提下修正題幹／選項／答案／解析；生成後還會再經第二次 AI 嚴格驗證，全部通過才重新開放洞天。</p><div class="dt-modal-question"><strong>第 ${questionIndex + 1} 題 · ${escapeHtml(question.subject || dongtian.subject)} · ${difficultyLabel(question.difficulty)}</strong><br>${escapeHtml(question.q)}<br><br><span style="color:#86efac">原標示答案：${escapeHtml(question.correct)}</span></div><div class="dt-ai-review"><strong>封印原因</strong><br>${escapeHtml(questionIssueText(dongtian))}<br><span style="opacity:.75">玩家回報：${escapeHtml(dongtian.flaggedReason || '')}</span></div><textarea id="dt-revision-hint" maxlength="1600" placeholder="例：請補上缺少的條件，讓答案只能是原本要考的那個概念；數字可微調，但不要改變知識點。"></textarea><div id="dt-repair-status" class="dt-modal-note">若提示詞要求換知識點、換章節或把題目改成另一題，AI 會忽略或在驗證階段拒絕。</div><div class="dt-modal-actions"><button type="button" class="dt-modal-cancel">取消</button><button id="dt-repair-submit" type="button" class="dt-modal-submit">AI 修復並驗證</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('.dt-modal-cancel').onclick = removeModerationModal;
    modal.querySelector('#dt-repair-submit').onclick = () => submitDongtianRepair(modal, dongtian, question, questionIndex);
  }

  async function submitDongtianRepair(modal, dongtian, originalQuestion, questionIndex) {
    if (state.moderationBusy) return;
    const hint = modal.querySelector('#dt-revision-hint')?.value?.trim() || '';
    if (hint.length < 4) { toast('請輸入具體的修改提示詞。'); return; }
    const submit = modal.querySelector('#dt-repair-submit');
    const status = modal.querySelector('#dt-repair-status');
    state.moderationBusy = true;
    submit.disabled = true;
    submit.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 修復＋二次驗證中…';
    status.textContent = '第一個 AI 依提示詞修復；第二個 AI 將比較原題與修正版，檢查是否偷換知識點。';
    try {
      const response = await fetch('/api/revise-dongtian-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalQuestion,
          hint,
          issue: questionIssueText(dongtian),
          dongtian: { id: dongtian.id, name: dongtian.name, level: dongtian.level, difficulty: dongtian.difficulty, subject: dongtian.subject }
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.revised) throw new Error(payload.error || `題目修復失敗 (${response.status})`);
      const revised = payload.revised;

      status.textContent = '修正版已通過 AI 本質一致性與正確性驗證，正在重新開放洞天…';
      const dataRef = doc(db, DATA_COLLECTION, dongtian.id);
      const indexRef = doc(db, INDEX_COLLECTION, dongtian.id);
      const reportId = dongtian.activeReportId || '';
      await runTransaction(db, async (tx) => {
        const [dataSnap, indexSnap] = await Promise.all([tx.get(dataRef), tx.get(indexRef)]);
        if (!dataSnap.exists() || !indexSnap.exists()) throw new Error('洞天資料不存在');
        const live = dataSnap.data();
        if (live.ownerUid !== uid()) throw new Error('只有洞天主人可以修復');
        if (live.status !== 'suspended' || live.activeReportId !== reportId) throw new Error('洞天封印狀態已改變，請重新讀取');
        const liveQuestion = live.questions?.[questionIndex];
        if (!liveQuestion || liveQuestion.id !== originalQuestion.id) throw new Error('題目版本已改變，請重新讀取');
        const questions = [...live.questions];
        questions[questionIndex] = { ...revised, id: liveQuestion.id, difficulty: liveQuestion.difficulty, subject: liveQuestion.subject };
        const cleared = {
          status: 'active',
          moderationStatus: 'clear',
          activeReportId: null,
          flaggedQuestionId: null,
          flaggedQuestionIndex: null,
          flaggedReason: null,
          aiReviewSummary: null,
          lastRevisedAt: serverTimestamp(),
          lastRevisedAtMs: Date.now(),
          revisionCount: increment(1)
        };
        tx.update(dataRef, { ...cleared, questions });
        tx.update(indexRef, cleared);
        if (reportId) {
          tx.set(doc(db, REPORT_COLLECTION, reportId), {
            status: 'resolved',
            resolvedAt: serverTimestamp(),
            resolvedAtMs: Date.now(),
            resolutionHint: hint,
            revisedQuestion: questions[questionIndex],
            validation: payload.validation || null,
            resolvedByUid: uid()
          }, { merge: true });
        }
      });
      removeModerationModal();
      toast('題目修復通過嚴格驗證，洞天已重新開放。');
      state.listLoaded = false;
      await loadOwnDongtians(true);
    } catch (error) {
      console.error('[Dongtian repair]', error);
      status.innerHTML = `<span style="color:#fca5a5">${escapeHtml(error.message || '修復失敗')}</span><br>洞天仍維持封印；請調整修改提示詞後再試。`;
      submit.disabled = false;
      submit.textContent = '重新修復並驗證';
    } finally {
      state.moderationBusy = false;
    }
  }

'''
ui = replace_once(ui, "  function rewardTier(accuracy) {\n", moderation_functions + "  function rewardTier(accuracy) {\n", 'moderation functions')

ui = replace_once(ui, "  async function finishDongtian() {\n    const s = state.session;\n    if (!s) return;\n", "  async function finishDongtian() {\n    const s = state.session;\n    if (!s) return;\n    if (!(await ensureSessionDongtianActive())) return;\n", 'finish status check')
ui_path.write_text(ui)

# ---------------- Regression tests ----------------
test_path = Path('tests/dongtian.test.cjs')
test = test_path.read_text()
append = r'''

test('Dongtian question reports require double AI confirmation before sealing the whole cave', () => {
  assert.match(apiSource, /\/api\/review-dongtian-question/);
  assert.match(apiSource, /buildQuestionReviewVerificationPrompt/);
  assert.match(apiSource, /review\.hasError && review\.confidence >= 0\.75/);
  assert.match(apiSource, /verification\.confirmError && verification\.confidence >= 0\.75/);
  assert.match(uiSource, /id=\"dt-report-question\"/);
  assert.match(uiSource, /REPORT_COLLECTION = 'dongtianReports'/);
  assert.match(uiSource, /status: 'suspended'/);
  assert.match(uiSource, /moderationStatus: 'needs_revision'/);
  assert.match(uiSource, /activeReportId: reportRef\.id/);
  assert.match(uiSource, /writeDongtianHistory\(s, false\)/);
});

test('Suspended Dongtians are excluded from encounters and owners receive a repair action', () => {
  assert.match(uiSource, /where\('status', '==', 'active'\)/);
  assert.match(uiSource, /data-dt-repair/);
  assert.match(uiSource, /已封印 · 待修復/);
  assert.match(uiSource, /if \(dongtian\.status && dongtian\.status !== 'active'\)/);
  assert.match(uiSource, /ensureSessionDongtianActive/);
});

test('Owner repair is prompt-only, preserves question identity, and requires a second AI validation', () => {
  assert.match(apiSource, /\/api\/revise-dongtian-question/);
  assert.match(apiSource, /核心知識點、學習目標、原本要考的概念/);
  assert.match(apiSource, /essencePreserved/);
  assert.match(apiSource, /errorResolved/);
  assert.match(apiSource, /singleCorrect/);
  assert.match(apiSource, /noNewError/);
  assert.match(apiSource, /levelAppropriate/);
  assert.match(apiSource, /confidence >= 0\.8/);
  assert.match(uiSource, /id=\"dt-revision-hint\"/);
  assert.match(uiSource, /只有洞天主人可以修復/);
  assert.match(uiSource, /questions\[questionIndex\] = \{ \.\.\.revised, id: liveQuestion\.id, difficulty: liveQuestion\.difficulty, subject: liveQuestion\.subject \}/);
  assert.match(uiSource, /status: 'active'/);
  assert.match(uiSource, /status: 'resolved'/);
});

test('Standalone revision normalization cannot change id, subject, or difficulty', () => {
  const original = { id: 'DT-007', difficulty: 'hard', q: '原題', correct: '甲', wrong: ['乙','丙','丁'], exp: '原解析', subject: '數學' };
  const revised = api.normalizeStandaloneQuestion({
    id: 'HACK', difficulty: 'easy', subject: '歷史', q: '修正題', correct: '1', wrong: ['2','3','4'], exp: '修正解析'
  }, original);
  assert.equal(revised.id, 'DT-007');
  assert.equal(revised.difficulty, 'hard');
  assert.equal(revised.subject, '數學');
  assert.equal(revised.q, '修正題');
});
'''
if "Dongtian question reports require double AI confirmation" not in test:
    test += append
test_path.write_text(test)
