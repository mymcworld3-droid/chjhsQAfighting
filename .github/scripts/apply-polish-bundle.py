from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing marker: {label}')
    return text.replace(old, new, 1)

# ---------- server + main wiring ----------
server_path = Path('server.js')
server = server_path.read_text()
if "registerIdentityApi" not in server:
    server = replace_once(server, "const registerDongtianApi = require('./dongtian-api');\n", "const registerDongtianApi = require('./dongtian-api');\nconst registerIdentityApi = require('./identity-api');\n", 'server identity require')
    server = replace_once(server, "registerDongtianApi(app);\n", "registerDongtianApi(app);\nregisterIdentityApi(app);\n", 'server identity register')
server_path.write_text(server)

main_path = Path('public/main.js')
main = main_path.read_text()
if "./cultivation/identity-system.js" not in main:
    main = replace_once(main, "  './cultivation/cultivation-theme.js',\n", "  './cultivation/cultivation-theme.js',\n  './cultivation/identity-system.js',\n", 'identity module load')
main_path.write_text(main)

index_path = Path('public/index.html')
index = index_path.read_text()
index = re.sub(r'main\.js\?v=[^\"\']+', 'main.js?v=20260916-polish4', index, count=1)
index_path.write_text(index)

# ---------- legacy top-right name uses saved game identity after Firestore load ----------
legacy_path = Path('public/main-legacy.js')
legacy = legacy_path.read_text()
marker = "            checkAdminRole(currentUserData.isAdmin);\n            updateUIStats();\n"
if "saved game identity wins over Google profile" not in legacy:
    legacy = replace_once(legacy, marker, marker + "            // saved game identity wins over Google profile in every game session\n            if (userInfoEl) {\n                userInfoEl.removeAttribute('data-i18n');\n                userInfoEl.innerHTML = `<i class=\"fa-solid fa-user-astronaut\"></i> ${currentUserData.displayName || user.displayName || '玩家'}`;\n            }\n", 'legacy header identity')
legacy_path.write_text(legacy)

# ---------- Dongtian API: generation double-check + proactive owner repair ----------
api_path = Path('dongtian-api.js')
api = api_path.read_text()
if 'buildDongtianDoubleCheckPrompt' not in api:
    helper = r'''
function buildDongtianDoubleCheckPrompt(dongtian) {
  return `
[任務]
你是第二位獨立的洞天品質審核員。這份洞天已由另一個 AI 生成，請逐題重新檢查，而不是假設它正確。

[洞天 JSON]
${JSON.stringify(dongtian)}

[必查項目]
1. 每一題題幹事實、數學與邏輯是否成立。
2. correct 是否唯一正確，三個 wrong 是否確實錯誤且不重複。
3. exp 是否和正解一致，計算與推理無誤。
4. 題目程度、難度、科目是否合理。
5. 題組是否有明顯重複、互相矛盾，題序是否由基礎到理解／應用。
6. 洞天名稱、主要科目與程度是否和整組題目相符。

[輸出 JSON Only]
{
  "approved": true,
  "confidence": 0.0,
  "summary": "整體審核理由",
  "issues": [
    { "questionId": "DT-001", "issue": "具體錯誤" }
  ]
}`;
}

function normalizeDongtianDoubleCheck(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const issues = Array.isArray(data.issues) ? data.issues.map((item) => ({
    questionId: cleanText(item?.questionId, 40),
    issue: cleanText(item?.issue, 800)
  })).filter((item) => item.issue).slice(0, 30) : [];
  return {
    approved: data.approved === true,
    confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
    summary: cleanText(data.summary, 1200),
    issues
  };
}

async function verifyGeneratedDongtian(dongtian) {
  const run = await aiRouter.generateJSON(buildDongtianDoubleCheckPrompt(dongtian), { timeoutMs: 60000 });
  const review = normalizeDongtianDoubleCheck(run.data);
  review.passed = review.approved && review.confidence >= 0.8 && review.issues.length === 0;
  return { review, provider: run.provider, model: run.model };
}

'''
    api = replace_once(api, "function normalizeQuestionSnapshot(input) {\n", helper + "function normalizeQuestionSnapshot(input) {\n", 'dongtian double check helpers')

if "/api/revise-owned-dongtian-question" not in api:
    owner_route = r'''  app.post('/api/revise-owned-dongtian-question', async (req, res) => {
    try {
      const original = normalizeQuestionSnapshot(req.body?.originalQuestion);
      const hint = cleanText(req.body?.hint, MAX_REVISION_HINT);
      const dongtian = req.body?.dongtian && typeof req.body.dongtian === 'object' ? req.body.dongtian : {};
      if (!original.q || !original.correct || original.wrong.length !== 3 || hint.length < 8) {
        return res.status(400).json({ error: '修改提示詞必須具體指出原題哪裡錯誤、不精確或有歧義' });
      }

      const first = await aiRouter.generateJSON(buildQuestionReviewPrompt(original, hint, dongtian), { timeoutMs: 50000 });
      const review = normalizeQuestionReview(first.data);
      let verification = { confirmError: false, confidence: 0, summary: '' };
      if (review.hasError && review.confidence >= 0.65) {
        const second = await aiRouter.generateJSON(buildQuestionReviewVerificationPrompt(original, hint, review, dongtian), { timeoutMs: 50000 });
        verification = normalizeReviewVerification(second.data);
      }
      const issueConfirmed = review.hasError && review.confidence >= 0.75 && verification.confirmError && verification.confidence >= 0.75;
      if (!issueConfirmed) {
        return res.status(422).json({
          error: 'AI 無法確認提示詞所指出的是原題的實質錯誤；請明確說明錯誤答案、歧義、條件不足、計算或事實問題',
          review,
          verification
        });
      }

      const issue = [review.summary, review.evidence, verification.summary].filter(Boolean).join('；');
      const rewrite = await aiRouter.generateJSON(buildRevisionPrompt(original, hint, issue, dongtian), { timeoutMs: 60000 });
      const revised = normalizeStandaloneQuestion(rewrite.data, original);
      const validationRun = await aiRouter.generateJSON(buildRevisionValidationPrompt(original, revised, issue, hint, dongtian), { timeoutMs: 60000 });
      const validation = normalizeRevisionValidation(validationRun.data);
      if (!validation.accepted) {
        return res.status(422).json({ error: '主動修改未通過最終審核：不得改變原題本質', validation });
      }
      res.json({ revised, review, verification, validation });
    } catch (error) {
      console.error('[Dongtian owner revision]', error);
      res.status(500).json({ error: error?.message || '主人題目修改失敗' });
    }
  });

'''
    api = replace_once(api, "  app.post('/api/revise-dongtian-question', async (req, res) => {\n", owner_route + "  app.post('/api/revise-dongtian-question', async (req, res) => {\n", 'owner proactive revision route')

old_generate = "      const dongtian = normalizeResult(routed.data, creatorLevel);\n      res.json({ dongtian, provider: routed.provider, model: routed.model });"
new_generate = "      const dongtian = normalizeResult(routed.data, creatorLevel);\n      const doubleCheck = await verifyGeneratedDongtian(dongtian);\n      if (!doubleCheck.review.passed) {\n        return res.status(422).json({ error: '洞天第二次 AI 複核未通過，為避免錯題不予建立，請重新生成。', doubleCheck: doubleCheck.review });\n      }\n      res.json({ dongtian, provider: routed.provider, model: routed.model, doubleCheck: doubleCheck.review, doubleCheckProvider: doubleCheck.provider, doubleCheckModel: doubleCheck.model });"
if 'doubleCheckProvider' not in api:
    api = replace_once(api, old_generate, new_generate, 'generation double check')

old_export = "module.exports.__test = { LEVELS, normalizeLevel, normalizeDifficulty, normalizeResult, buildPrompt, validateImages, normalizeQuestionSnapshot, buildQuestionReviewPrompt, normalizeQuestionReview, buildRevisionPrompt, buildRevisionValidationPrompt, normalizeRevisionValidation };"
if old_export in api:
    api = api.replace(old_export, "module.exports.__test = { LEVELS, normalizeLevel, normalizeDifficulty, normalizeResult, buildPrompt, validateImages, normalizeQuestionSnapshot, buildQuestionReviewPrompt, normalizeQuestionReview, buildRevisionPrompt, buildRevisionValidationPrompt, normalizeRevisionValidation, buildDongtianDoubleCheckPrompt, normalizeDongtianDoubleCheck };")
api_path.write_text(api)

# ---------- Dongtian UI ----------
dt_path = Path('public/cultivation/dongtian.js')
dt = dt_path.read_text()

# Owner display uses canonical game identity.
dt = dt.replace("ownerName: user.displayName || auth.currentUser?.displayName || '無名修士',", "ownerName: window.getPlayerDisplayName?.(user, auth.currentUser?.displayName || '無名修士') || user.displayName || auth.currentUser?.displayName || '無名修士',")

# Library buttons: active gets play + manage; suspended repair only.
old_buttons = "${suspended\n              ? `<button type=\"button\" class=\"dt-repair\" data-dt-repair=\"${item.id}\"><i class=\"fa-solid fa-screwdriver-wrench\"></i> 修復題目</button>`\n              : `<button type=\"button\" class=\"dt-play\" data-dt-play=\"${item.id}\"><i class=\"fa-solid fa-play\"></i> 進入</button>`}"
new_buttons = "${suspended\n              ? `<button type=\"button\" class=\"dt-repair\" data-dt-repair=\"${item.id}\"><i class=\"fa-solid fa-screwdriver-wrench\"></i> 修復題目</button>`\n              : `<div style=\"display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end\"><button type=\"button\" class=\"dt-play\" data-dt-play=\"${item.id}\"><i class=\"fa-solid fa-play\"></i> 進入</button><button type=\"button\" class=\"dt-repair\" data-dt-manage=\"${item.id}\"><i class=\"fa-solid fa-pen-ruler\"></i> 題目管理</button></div>`}"
if 'data-dt-manage' not in dt:
    dt = replace_once(dt, old_buttons, new_buttons, 'dongtian manage button')

# Click handler supports manage and repair before play.
old_listener = "    card.querySelector('#dt-list').addEventListener('click', async (event) => {\n      const button = event.target.closest('[data-dt-play]');\n      if (!button) return;\n      const id = button.dataset.dtPlay;"
new_listener = "    card.querySelector('#dt-list').addEventListener('click', async (event) => {\n      const repairButton = event.target.closest('[data-dt-repair]');\n      if (repairButton) { openDongtianRepair(repairButton.dataset.dtRepair).catch((error) => toast(error.message || '無法開啟修復')); return; }\n      const manageButton = event.target.closest('[data-dt-manage]');\n      if (manageButton) { openOwnerQuestionManager(manageButton.dataset.dtManage).catch((error) => toast(error.message || '無法開啟題目管理')); return; }\n      const button = event.target.closest('[data-dt-play]');\n      if (!button) return;\n      const id = button.dataset.dtPlay;"
if 'openOwnerQuestionManager(manageButton.dataset.dtManage)' not in dt:
    dt = replace_once(dt, old_listener, new_listener, 'dongtian library click handling')

# Encounter asks first, and encounter record is consumed even if declined.
old_encounter = "      const found = await findEncounter();\n      if (!found) return false;\n      await enterDongtian(found, { source: 'encounter', encountered: true });\n      return true;"
new_encounter = "      const found = await findEncounter();\n      if (!found) return false;\n      await markEncountered(found);\n      const accepted = await offerDongtianEncounter(found);\n      if (!accepted) return false;\n      await enterDongtian(found, { source: 'encounter', encountered: false, alreadyEncountered: true });\n      return true;"
if 'offerDongtianEncounter(found)' not in dt:
    dt = replace_once(dt, old_encounter, new_encounter, 'dongtian encounter prompt hook')

old_enter_count = "    if (options.encountered) await markEncountered(dongtian);\n    else updateDoc(doc(db, INDEX_COLLECTION, dongtian.id), { playCount: increment(1) }).catch(() => {});"
new_enter_count = "    if (options.encountered) await markEncountered(dongtian);\n    else if (!options.alreadyEncountered) updateDoc(doc(db, INDEX_COLLECTION, dongtian.id), { playCount: increment(1) }).catch(() => {});"
if 'options.alreadyEncountered' not in dt:
    dt = replace_once(dt, old_enter_count, new_enter_count, 'avoid double encounter count')

if 'function offerDongtianEncounter' not in dt:
    offer = r'''
  function offerDongtianEncounter(dongtian) {
    return new Promise((resolve) => {
      const overlay = ensureOverlay();
      const owner = dongtian.ownerName || '無名修士';
      overlay.innerHTML = `<div class="dt-encounter"><div class="dt-portal"></div><div class="dt-encounter-copy"><span>天地異象 · 發現洞天</span><h2>${escapeHtml(dongtian.name)}</h2><p>你感應到其他修士留下的知識秘境。每位修士只會遇見同一座洞天一次，是否現在進入？</p><div style="margin:14px auto;max-width:520px;padding:12px;border:1px solid rgba(205,154,255,.18);border-radius:14px;background:rgba(0,0,0,.2);font-size:9px;line-height:1.8;color:#bca9c4;text-align:left"><strong style="color:#eadcff">洞天主人：</strong>${escapeHtml(owner)}<br><strong>程度：</strong>${escapeHtml(dongtian.level)}　<strong>難度：</strong>${difficultyLabel(dongtian.difficulty)}<br><strong>科目：</strong>${escapeHtml(dongtian.subject)}　<strong>題數：</strong>${dongtian.questions?.length || dongtian.questionCount || 0}</div><div style="display:flex;gap:9px;justify-content:center;flex-wrap:wrap"><button id="dt-decline-encounter" class="dt-back" type="button">略過洞天，繼續一般修行</button><button id="dt-enter-encounter" class="dt-next" style="width:auto;padding:0 20px;margin:0" type="button">進入洞天</button></div></div></div>`;
      document.getElementById('dt-enter-encounter').onclick = () => { overlay.remove(); resolve(true); };
      document.getElementById('dt-decline-encounter').onclick = () => { overlay.remove(); resolve(false); };
    });
  }

'''
    dt = replace_once(dt, "  async function markEncountered(dongtian) {\n", offer + "  async function markEncountered(dongtian) {\n", 'encounter offer UI')

# Add proactive owner question manager before suspended repair function.
if 'async function openOwnerQuestionManager' not in dt:
    manager = r'''
  async function openOwnerQuestionManager(dongtianId) {
    if (!uid() || state.moderationBusy) return;
    const snap = await getDoc(doc(db, DATA_COLLECTION, dongtianId));
    if (!snap.exists()) throw new Error('洞天資料不存在');
    const dongtian = { id: snap.id, ...snap.data() };
    if (dongtian.ownerUid !== uid()) throw new Error('只有洞天主人可以管理題目');
    if (dongtian.status !== 'active') throw new Error('封印中的洞天請使用「修復題目」');
    removeModerationModal();
    const modal = document.createElement('div');
    modal.id = 'dt-moderation-modal';
    modal.className = 'dt-modal';
    modal.innerHTML = `<div class="dt-modal-card"><h3><i class="fa-solid fa-pen-ruler" style="color:#c4b5fd"></i> 主人題目管理</h3><p class="dt-modal-note">可主動修正自己發現的錯題，但不能任意換題。請先選題，再在修改提示詞中具體指出原題哪裡錯誤、不精確、條件不足或有歧義；AI 確認問題存在後才會允許修改。</p><div style="display:grid;gap:7px;max-height:52vh;overflow:auto">${dongtian.questions.map((q, index) => `<button type="button" class="dt-modal-cancel" style="text-align:left;min-height:48px" data-owner-edit-index="${index}"><strong>${index + 1}. ${escapeHtml(q.q)}</strong><br><span style="opacity:.65">${escapeHtml(q.subject || dongtian.subject)} · ${difficultyLabel(q.difficulty)}</span></button>`).join('')}</div><div class="dt-modal-actions"><button type="button" class="dt-modal-cancel" data-close-owner-manager>關閉</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('[data-close-owner-manager]').onclick = removeModerationModal;
    modal.querySelectorAll('[data-owner-edit-index]').forEach((button) => {
      button.onclick = () => openOwnerQuestionRevision(dongtian, Number(button.dataset.ownerEditIndex));
    });
  }

  function openOwnerQuestionRevision(dongtian, questionIndex) {
    const question = dongtian.questions?.[questionIndex];
    if (!question) return;
    removeModerationModal();
    const modal = document.createElement('div');
    modal.id = 'dt-moderation-modal';
    modal.className = 'dt-modal';
    modal.innerHTML = `<div class="dt-modal-card"><h3>主動修正第 ${questionIndex + 1} 題</h3><p class="dt-modal-note">修改提示詞必須先指出這一題具體哪裡不正確。AI 會先審核你的指控是否成立，再保持核心知識點、科目、程度與難度不變進行修正。</p><div class="dt-modal-question"><strong>${escapeHtml(question.q)}</strong><br><br><span style="color:#86efac">正解：${escapeHtml(question.correct)}</span><br><span style="color:#c4b5fd">其他選項：${(question.wrong || []).map((item) => escapeHtml(item)).join(' ／ ')}</span><br><br><span style="color:#aaa">解析：${escapeHtml(question.exp || '')}</span></div><textarea id="dt-owner-revision-hint" maxlength="1600" placeholder="例：這題把速度與速率混為一談，題幹的條件不足，導致 A 和 C 都可能成立。請補上方向條件並保持原本考速度概念。"></textarea><div id="dt-owner-revision-status" class="dt-modal-note">若 AI 無法確認你指出的是實質錯誤，修改會被拒絕。</div><div class="dt-modal-actions"><button type="button" class="dt-modal-cancel">取消</button><button id="dt-owner-revision-submit" type="button" class="dt-modal-submit">AI 審錯後修正</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('.dt-modal-cancel').onclick = removeModerationModal;
    modal.querySelector('#dt-owner-revision-submit').onclick = () => submitOwnerQuestionRevision(modal, dongtian, question, questionIndex);
  }

  async function submitOwnerQuestionRevision(modal, dongtian, originalQuestion, questionIndex) {
    if (state.moderationBusy) return;
    const hint = modal.querySelector('#dt-owner-revision-hint')?.value?.trim() || '';
    if (hint.length < 8) { toast('請具體指出題目錯誤或不正確之處。'); return; }
    const submit = modal.querySelector('#dt-owner-revision-submit');
    const status = modal.querySelector('#dt-owner-revision-status');
    state.moderationBusy = true;
    submit.disabled = true;
    submit.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 審錯＋修正中…';
    try {
      const response = await fetch('/api/revise-owned-dongtian-question', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalQuestion, hint, dongtian: { id: dongtian.id, name: dongtian.name, level: dongtian.level, difficulty: dongtian.difficulty, subject: dongtian.subject } })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.revised) throw new Error(payload.error || `題目修改失敗 (${response.status})`);
      const dataRef = doc(db, DATA_COLLECTION, dongtian.id);
      await runTransaction(db, async (tx) => {
        const liveSnap = await tx.get(dataRef);
        if (!liveSnap.exists()) throw new Error('洞天資料不存在');
        const live = liveSnap.data();
        if (live.ownerUid !== uid()) throw new Error('只有洞天主人可以修改');
        if (live.status !== 'active') throw new Error('洞天狀態已改變，請重新讀取');
        const liveQuestion = live.questions?.[questionIndex];
        if (!liveQuestion || liveQuestion.id !== originalQuestion.id) throw new Error('題目版本已改變，請重新讀取');
        const questions = [...live.questions];
        questions[questionIndex] = { ...payload.revised, id: liveQuestion.id, subject: liveQuestion.subject, difficulty: liveQuestion.difficulty };
        tx.update(dataRef, { questions, revisionCount: increment(1), lastRevisedAt: serverTimestamp(), lastRevisedAtMs: Date.now() });
      });
      removeModerationModal();
      toast('題目已通過「錯誤成立＋本質不變」雙重審核並更新。');
      state.listLoaded = false;
      await loadOwnDongtians(true);
    } catch (error) {
      status.innerHTML = `<span style="color:#fca5a5">${escapeHtml(error.message || '修改失敗')}</span><br>請重新說明題目具體錯誤，不能只要求換題或調整風格。`;
      submit.disabled = false;
      submit.textContent = '重新審錯並修正';
    } finally {
      state.moderationBusy = false;
    }
  }

'''
    dt = replace_once(dt, "  async function openDongtianRepair(dongtianId) {\n", manager + "  async function openDongtianRepair(dongtianId) {\n", 'owner proactive manager functions')

dt_path.write_text(dt)

# ---------- Training: always top, simpler Golden Core detail, expose detail ----------
train_path = Path('public/cultivation/cultivation-training-v4.js')
train = train_path.read_text()
old_nav = "    button.addEventListener('click', () => {\n      window.switchToPage?.('page-training');\n      renderTrainingPage();\n    });"
new_nav = "    button.addEventListener('click', () => {\n      window.switchToPage?.('page-training');\n      window.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });\n      document.documentElement.scrollTop = 0;\n      document.body.scrollTop = 0;\n      const trainingPage = document.getElementById('page-training');\n      if (trainingPage) trainingPage.scrollTop = 0;\n      renderTrainingPage();\n      requestAnimationFrame(() => window.scrollTo?.({ top: 0, left: 0, behavior: 'auto' }));\n    });"
if 'trainingPage.scrollTop = 0' not in train:
    train = replace_once(train, old_nav, new_nav, 'training scroll top')

old_detail = '''      <div class="training-v3-detail-top">${coreVisualMarkup(core, false)}</div>\n      <div class="training-v3-lore">\n        <div><span>本命丹源</span><p>此丹並非外來丹藥，而是修士在自身靈田／丹田中凝聚，並可透過洗髓重塑丹性與品級的本命金丹。</p></div>\n        <div><span>特性效果</span><p>${type.effect(core.grade)}</p></div>\n        <div><span>神通</span><p>${type.ability}</p></div>\n        <div><span>修煉代價</span><p>${type.upkeep}</p></div>\n        <div><span>溫馨提醒</span><p>${type.warning}</p></div>\n        <div><span>備註</span><p>${type.note}</p></div>\n      </div>'''
new_detail = '''      <div class="training-v3-detail-top">${coreVisualMarkup(core, false)}</div>\n      <div class="training-v3-lore training-core-detail-two">\n        <div class="training-core-feature"><span>特性</span><p><strong>效果：</strong>${type.effect(core.grade)}</p><p><strong>神通：</strong>${type.ability}</p><p><strong>修煉：</strong>${type.upkeep}</p><p><strong>提醒：</strong>${type.warning}</p></div>\n        <div class="training-core-story"><span>故事</span><p>${type.note}</p><p>此丹並非外來丹藥，而是修士在自身靈田／丹田中凝聚，並可透過洗髓重塑丹性與品級的本命金丹。</p></div>\n      </div>'''
if 'training-core-detail-two' not in train:
    train = replace_once(train, old_detail, new_detail, 'golden core two-box detail')

if 'window.openGoldenCoreDetails' not in train:
    marker2 = "  function bindCoreActions() {"
    expose = "  window.openGoldenCoreDetails = function (coreLike) {\n    if (!coreLike) return;\n    showCoreDetails({ type: coreLike.type || 'taichu', grade: clampGrade(coreLike.grade) });\n  };\n\n"
    train = replace_once(train, marker2, expose + marker2, 'expose core details')

# make reverse source itself accurately describe multiples
train = train.replace("effect(grade) { return `連續悟道達 ${Math.max(2, grade + 1)} 次的那一次，額外 +3 修為。`; },", "effect(grade) { const n = Math.max(2, grade + 1); return `每逢連續悟道達 ${n} 次的倍數（如 ${n}、${n * 2}、${n * 3}…），額外 +3 修為。`; },")
train = train.replace("return isCorrect && previousStreak + 1 === threshold", "return isCorrect && (previousStreak + 1) % threshold === 0")
train_path.write_text(train)

# ---------- Status tab Golden Core clickable ----------
status_path = Path('public/cultivation/cultivation-status-panel.js')
status = status_path.read_text()
status = status.replace('<div class="status-core-row">', '<div class="status-core-row" data-status-core-detail role="button" tabindex="0" title="查看金丹詳細">', 1)
old_render_end = "    content.innerHTML = statusMarkup(snapshot);\n    content.dataset.statusSnapshot = key;\n    rendering = false;"
new_render_end = "    content.innerHTML = statusMarkup(snapshot);\n    content.dataset.statusSnapshot = key;\n    const coreButton = content.querySelector('[data-status-core-detail]');\n    const openDetail = () => snapshot.core && window.openGoldenCoreDetails?.(snapshot.core);\n    coreButton?.addEventListener('click', openDetail);\n    coreButton?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail(); } });\n    rendering = false;"
if 'const openDetail = () =>' not in status:
    status = replace_once(status, old_render_end, new_render_end, 'status core click')
status_path.write_text(status)

# ---------- Reverse patch no longer tries to rewrite old six-row modal ----------
reverse_path = Path('public/cultivation/reverse-core-multiples.js')
reverse = reverse_path.read_text()
if "querySelector('.training-core-feature')" not in reverse:
    start = reverse.index('  function patchDetailModal() {')
    end = reverse.index('\n\n  const observer = new MutationObserver', start)
    new_func = '''  function patchDetailModal() {\n    const state = window.getGoldenCoreState?.() || null;\n    if (state?.type !== 'reverse') return;\n    const modal = document.getElementById('training-v3-detail-modal');\n    if (!modal || modal.dataset.reverseMultiplesPatched === '1') return;\n    const feature = modal.querySelector('.training-core-feature');\n    if (feature) {\n      const first = feature.querySelector('p');\n      if (first) first.innerHTML = `<strong>效果：</strong>${effectText(state.grade)}`;\n    }\n    modal.dataset.reverseMultiplesPatched = '1';\n  }'''
    reverse = reverse[:start] + new_func + reverse[end:]
reverse_path.write_text(reverse)

# ---------- Tests ----------
test_path = Path('tests/polish-bundle.test.cjs')
test_path.write_text(r'''const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '..');
const server = readFileSync(join(root, 'server.js'), 'utf8');
const main = readFileSync(join(root, 'public/main.js'), 'utf8');
const legacy = readFileSync(join(root, 'public/main-legacy.js'), 'utf8');
const identity = readFileSync(join(root, 'public/cultivation/identity-system.js'), 'utf8');
const identityApi = require('../identity-api.js').__test;
const dongtianApi = readFileSync(join(root, 'dongtian-api.js'), 'utf8');
const dongtian = readFileSync(join(root, 'public/cultivation/dongtian.js'), 'utf8');
const training = readFileSync(join(root, 'public/cultivation/cultivation-training-v4.js'), 'utf8');
const status = readFileSync(join(root, 'public/cultivation/cultivation-status-panel.js'), 'utf8');

test('saved game displayName overrides Google name and identity module loads early', () => {
  assert.match(legacy, /saved game identity wins over Google profile/);
  assert.match(main, /cultivation\/identity-system\.js/);
  assert.match(identity, /window\.getPlayerDisplayName/);
  assert.match(identity, /《九州》/);
});

test('non-admin cannot claim Kyushu and name changes require AI review', () => {
  assert.match(identity, /!isAdmin\(player\) && \/九州\//);
  assert.match(identity, /\/api\/review-player-name/);
  assert.match(server, /registerIdentityApi\(app\)/);
  assert.equal(identityApi.RESERVED.test('九州劍仙'), true);
});

test('Dongtian generation performs a second independent AI correctness check', () => {
  assert.match(dongtianApi, /buildDongtianDoubleCheckPrompt/);
  assert.match(dongtianApi, /verifyGeneratedDongtian/);
  assert.match(dongtianApi, /confidence >= 0\.8/);
  assert.match(dongtianApi, /第二次 AI 複核未通過/);
});

test('Dongtian encounter asks before entry and shows owner metadata', () => {
  assert.match(dongtian, /function offerDongtianEncounter/);
  assert.match(dongtian, /洞天主人/);
  assert.match(dongtian, /是否現在進入/);
  assert.match(dongtian, /await markEncountered\(found\)/);
  assert.match(dongtian, /alreadyEncountered: true/);
});

test('owner proactive Dongtian editing requires an actual identified error and preserves essence', () => {
  assert.match(dongtian, /data-dt-manage/);
  assert.match(dongtian, /api\/revise-owned-dongtian-question/);
  assert.match(dongtianApi, /AI 無法確認提示詞所指出的是原題的實質錯誤/);
  assert.match(dongtianApi, /buildRevisionValidationPrompt/);
});

test('training always scrolls to top and Golden Core detail is two clean boxes', () => {
  assert.match(training, /trainingPage\.scrollTop = 0/);
  assert.match(training, /training-core-feature/);
  assert.match(training, /training-core-story/);
  assert.match(training, /window\.openGoldenCoreDetails/);
});

test('status Golden Core is keyboard and pointer clickable', () => {
  assert.match(status, /data-status-core-detail/);
  assert.match(status, /window\.openGoldenCoreDetails/);
  assert.match(status, /event\.key === 'Enter'/);
});
''')

print('polish bundle applied')
