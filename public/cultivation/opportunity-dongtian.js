import './opportunity-rules.js';
import { authenticatedMainFetch, getMainUser } from './data/project-repository.js';
import { playerRepository } from './data/player-repository.js';

(function () {
  'use strict';
  const rules = window.OpportunityRules, CHANCE_KEY = 'qingyunOpportunityChanceV1';
  const rolled = new WeakSet();
  let run = null, index = 0, owner = '', busy = false, inflight = false, serial = 0, restoring = false, restoredAccount = '';
  let previousFocus = null, escapeHandler = null;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Render through the established math sanitizer, with escaped text as fallback.
  const rich = v => (window.quizMathRichText || esc)(v);
  const data = () => window.getCurrentUserData?.();
  const uid = () => getMainUser()?.uid || '';
  const validOwner = () => !!owner && owner === uid();
  const toast = message => window.showToast?.(message);

  async function request(action, body, timeout = 18000) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await authenticatedMainFetch('/api/opportunity/' + action, {
        ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) throw Object.assign(new Error(result.error || '機緣洞天尚未連線完成'), { status: response.status });
      return result;
    } catch (e) { if (e.name === 'AbortError') throw new Error('機緣洞天連線逾時'); throw e; }
    finally { clearTimeout(timer); }
  }
  function ensureStyle() {
    if ($('opportunity-style')) return;
    const link = document.createElement('link');
    link.id = 'opportunity-style'; link.rel = 'stylesheet'; link.href = '/cultivation/opportunity-dongtian.css';
    document.head.appendChild(link);
  }
  function overlay() {
    ensureStyle();
    let el = $('opportunity-overlay');
    if (!el) {
      previousFocus = document.activeElement;
      el = document.createElement('section'); el.id = 'opportunity-overlay';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', '機緣洞天');
      document.body.appendChild(el); document.body.classList.add('opportunity-open');
      escapeHandler = event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          const dialog = $('op-confirm-exit');
          if (dialog || $('op-report-panel')) { (dialog || $('op-report-panel')).remove(); $('op-leave')?.focus(); }
          else $('op-leave')?.click();
        }
        if (event.key === 'Tab') {
          const focusRoot = $('op-confirm-exit') || $('op-report-panel') || el;
          const buttons = [...focusRoot.querySelectorAll('button:not([disabled]), textarea, summary, [tabindex="0"]')].filter(b => b.getClientRects().length);
          if (!buttons.length) return;
          const first = buttons[0], last = buttons[buttons.length - 1];
          if (event.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      };
      document.addEventListener('keydown', escapeHandler);
    }
    return el;
  }
  function focusTitle() { $('op-title')?.focus({ preventScroll: true }); }
  function close(resume = true) {
    const canResume = validOwner();
    serial++; run = null; busy = false;
    const el = $('opportunity-overlay');
    const finish = window.beginSceneTransition?.(el, document.querySelector('.active-page'), 'cloud', 'opportunity-close');
    el?.remove(); document.body.classList.remove('opportunity-open');
    if (escapeHandler) document.removeEventListener('keydown', escapeHandler);
    escapeHandler = null; previousFocus?.focus?.({ preventScroll: true }); finish?.();
    if (resume && canResume) {
      window.currentActiveQuiz = null;
      // Resume the unanswered solo queue without drawing another encounter on the return trip.
      void window.startQuizFlow?.(false, { skipEncounter: true });
    }
  }
  function chanceRecord(account, scope) {
    try {
      const record = JSON.parse(localStorage.getItem(CHANCE_KEY) || 'null');
      if (record?.uid === account && record.scope === scope) return Math.min(12, Math.max(0, Number(record.misses) || 0));
    } catch (_) {}
    return 0;
  }
  function saveMisses(account, scope, misses) {
    try { localStorage.setItem(CHANCE_KEY, JSON.stringify({ uid: account, scope, misses: Math.min(12, misses) })); } catch (_) {}
  }
  function header(subtitle, title = '機緣洞天') {
    return `<header class="op-head"><div><small>${esc(subtitle)}</small><h2 id="op-title" tabindex="-1">${esc(title)}</h2></div><button id="op-leave" type="button" aria-label="返回問道">返回問道</button></header>`;
  }
  function describeTarget(target) {
    return [target.level, target.subject, target.detail || target.path].filter(Boolean).join(' ／ ');
  }
  function renderOffer() {
    const el = overlay(), target = run.target;
    el.innerHTML = `${header('靈光乍現 · 閱讀機緣')}<div class="op-offer"><span class="op-seal" aria-hidden="true">緣</span><p class="op-kicker">一卷長文 · 五重參悟</p><h3>${esc(run.title)}</h3><p>山間浮現一卷與你修習範圍相應的手札。讀懂其中線索，便可走入五重試煉。</p><div class="op-scope">${esc(describeTarget(target))}</div><ol class="op-skills">${rules.SKILLS.map(s => `<li>${rules.LABELS[s]}</li>`).join('')}</ol><p>五題共用同一篇文章，不限時；完成後依答對題數獲得修為與靈石。</p><button id="op-enter" class="op-primary" type="button">展卷入境</button><button id="op-skip" class="op-secondary" type="button">留待他日，繼續問道</button><p class="op-note" id="op-status" role="status"></p></div>`;
    $('op-enter').onclick = () => { index = 0; renderQuestion(); };
    $('op-skip').onclick = () => { void abandon(false); };
    $('op-leave').onclick = () => { void abandon(false); };
    focusTitle();
  }
  function passageHtml() {
    return `<article id="op-passage" class="op-passage" aria-label="五題共用閱讀文本"><h3>${esc(run.title)}</h3><p class="op-reading-note">這篇文章會保留至五題結束；解析可定位原文依據。</p>${run.paragraphs.map(p => `<section id="op-paragraph-${esc(p.id)}" tabindex="-1"><span class="op-paragraph-label">${esc(p.id)}</span><p>${rich(p.text)}</p></section>`).join('')}</article>`;
  }
  function renderQuestion() {
    if (!validOwner() || !run) return;
    const q = run.questions[index], el = overlay();
    const previousScroll = $('op-passage')?.scrollTop || 0;
    el.innerHTML = `${header('同卷五題 · 不限時')}<div class="op-progress"><span>第 ${index + 1} / 5 題 · ${esc(rules.LABELS[q.skill])}</span><b>${esc(run.target.subject)}</b><progress max="5" value="${run.answered}" aria-label="已完成題數"></progress><div class="op-reading-switch"><button id="op-jump-text" type="button">查看本文</button><button id="op-jump-question" type="button">返回題目</button></div></div><div class="op-workspace">${passageHtml()}<section class="op-question" aria-label="第 ${index + 1} 題"><div class="op-scope">${esc(run.target.detail || run.target.path)}</div><h3>${rich(q.q)}</h3><div class="op-options">${q.options.map((v, i) => `<button type="button" data-op-answer="${i}" class="op-option"><span>${String.fromCharCode(65 + i)}</span><b>${rich(v)}</b></button>`).join('')}</div><div id="op-feedback" aria-live="polite"></div><p id="op-status" class="op-note" role="status"></p></section></div>`;
    $('op-passage').scrollTop = previousScroll;
    $('op-leave').onclick = () => { void abandon(true); };
    el.querySelectorAll('[data-op-answer]').forEach(button => button.onclick = () => { void answer(Number(button.dataset.opAnswer)); });
    $('op-jump-text').onclick = () => $('op-passage').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('op-jump-question').onclick = () => el.querySelector('.op-question').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (q.feedback) renderFeedback(q.feedback);
    void window.quizMathTypeset?.(el); focusTitle();
    if (window.matchMedia('(max-width:760px)').matches && (index > 0 || q.feedback)) {
      const style = $('opportunity-style'), expectedId = run.id, expectedIndex = index;
      const styled = style.sheet ? Promise.resolve() : new Promise(resolve => {
        style.addEventListener('load', resolve, { once: true });
        style.addEventListener('error', resolve, { once: true });
      });
      // On reload the stylesheet and fonts can finish after the saved answer is rendered.
      void Promise.all([styled, document.fonts?.ready || Promise.resolve()]).then(() => {
        requestAnimationFrame(() => {
          if (validOwner() && run?.id === expectedId && index === expectedIndex) {
            el.querySelector('.op-question')?.scrollIntoView({ behavior: 'instant', block: 'start' });
          }
        });
      });
    }
  }
  function renderFeedback(f) {
    const q = run.questions[index];
    document.querySelectorAll('#opportunity-overlay [data-op-answer]').forEach(button => {
      button.disabled = true;
      if (Number(button.dataset.opAnswer) === f.correct) button.classList.add('op-correct');
      if (Number(button.dataset.opAnswer) === f.selected && !f.isCorrect) button.classList.add('op-wrong');
    });
    $('op-feedback').innerHTML = `<div class="op-explanation"><strong class="${f.isCorrect ? 'op-success' : 'op-error'}">${f.isCorrect ? '參悟正確' : '再讀原文，參悟解析'}</strong><p>正解：${rich(q.options[f.correct])}</p><p>${rich(f.exp)}</p><h4>原文依據</h4>${f.evidence.map(e => `<button class="op-evidence" type="button" data-op-paragraph="${esc(e.paragraph)}"><b>${esc(e.paragraph)}</b> ${esc(e.quote)}</button>`).join('')}</div><button class="op-secondary" id="op-report" type="button">回報題目問題</button><button class="op-primary" id="op-next" type="button">${index === 4 ? '完成五題，收取機緣' : '下一題'}</button>`;
    document.querySelectorAll('#opportunity-overlay [data-op-paragraph]').forEach(button => button.onclick = () => {
      document.querySelectorAll('#op-passage .op-highlight').forEach(p => p.classList.remove('op-highlight'));
      const p = $('op-paragraph-' + button.dataset.opParagraph);
      p?.classList.add('op-highlight'); p?.scrollIntoView({ behavior: 'smooth', block: 'center' }); p?.focus({ preventScroll: true });
    });
    $('op-report').onclick = reportQuestion;
    $('op-next').onclick = () => {
      if (busy) return;
      if (index === 4) void settle();
      else { index++; renderQuestion(); }
    };
    void window.quizMathTypeset?.($('op-feedback'));
  }
  async function answer(selected) {
    if (busy || !validOwner() || run.questions[index]?.feedback) return;
    busy = true;
    const expectedRun = run.id, expectedIndex = index;
    document.querySelectorAll('#opportunity-overlay [data-op-answer]').forEach(b => { b.disabled = true; });
    $('op-status').textContent = '正在確認作答…';
    try {
      const result = await request('answer', { runId: expectedRun, index, selected });
      if (!validOwner() || run?.id !== expectedRun || index !== expectedIndex) return;
      run = result.run; $('op-status').textContent = ''; renderFeedback(result.feedback);
    } catch (e) {
      if (run?.id !== expectedRun || !validOwner()) return;
      $('op-status').textContent = `${e.message}。可再點選剛才的答案；已送達的作答不會重複計算。`;
      document.querySelectorAll('#opportunity-overlay [data-op-answer]').forEach(b => { b.disabled = false; });
    } finally { if (run?.id === expectedRun) busy = false; }
  }
  function reportQuestion() {
    if (busy || !validOwner() || !run || $('op-report-panel')) return;
    const id = run.id, questionIndex = index, panel = document.createElement('div');
    panel.id = 'op-report-panel'; panel.className = 'op-confirm';
    panel.innerHTML = '<div role="dialog" aria-label="回報機緣題目"><h3>回報題目問題</h3><p>請指出條件、答案、解析或原文依據的問題。會一併保存本文與題目供檢查。</p><textarea id="op-report-reason" maxlength="1200" placeholder="請具體說明問題，至少五個字"></textarea><p id="op-report-status" role="status"></p><button id="op-report-send" type="button">送出回報</button><button id="op-report-close" type="button">返回題目</button></div>';
    overlay().appendChild(panel);
    $('op-report-close').onclick = () => { panel.remove(); $('op-report')?.focus(); };
    $('op-report-send').onclick = async () => {
      const reason = $('op-report-reason').value.trim();
      if (reason.length < 5) { $('op-report-status').textContent = '請至少用五個字說明問題。'; return; }
      const button = $('op-report-send'); button.disabled = true;
      try {
        await request('report', { runId: id, index: questionIndex, reason });
        if (validOwner() && run?.id === id && panel.isConnected) { $('op-report-status').textContent = '已保存回報與文本依據，供題組檢查。'; button.textContent = '回報已送出'; }
      } catch (e) { if (panel.isConnected) { $('op-report-status').textContent = e.message; button.disabled = false; } }
    };
    $('op-report-reason').focus();
  }
  async function abandon(confirmExit) {
    if (busy || !validOwner() || !run) return;
    const el = overlay();
    if (confirmExit) {
      if ($('op-confirm-exit')) return;
      const panel = document.createElement('div'); panel.id = 'op-confirm-exit'; panel.className = 'op-confirm';
      panel.innerHTML = '<div role="alertdialog" aria-label="離開機緣洞天"><h3>暫離，或結束本次機緣？</h3><p>暫離可保留進度，下次遇見機緣或重新整理時接續。結束後本篇不會再次抽到。</p><button id="op-stay" type="button">繼續參悟</button><button id="op-pause" type="button">保留進度，返回問道</button><button id="op-end" type="button">結束本次機緣</button></div>';
      el.appendChild(panel);
      $('op-stay').onclick = () => { panel.remove(); $('op-leave')?.focus(); };
      $('op-pause').onclick = () => close();
      $('op-end').onclick = () => { panel.remove(); void abandon(false); };
      $('op-stay').focus(); return;
    }
    busy = true; const id = run.id;
    try {
      await request('abandon', { runId: id });
      if (validOwner() && run?.id === id) close();
    } catch (e) { if (validOwner() && run?.id === id) { if ($('op-status')) $('op-status').textContent = `${e.message}，請重試。`; toast(e.message); } }
    finally { if (run?.id === id) busy = false; }
  }
  function applyReward(result) {
    const stats = data()?.stats, reward = result.run.reward;
    if (stats && reward?.balances) Object.assign(stats, reward.balances);
    window.updateUIStats?.(); window.refreshCultivationRealmUI?.();
    window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', { detail: { source: 'opportunity-completion', ...reward } }));
  }
  async function settle() {
    if (busy || !validOwner() || !run) return;
    busy = true; const id = run.id;
    if ($('op-next')) { $('op-next').disabled = true; $('op-next').textContent = '正在結算機緣…'; }
    try {
      const result = await request('settle', { runId: id });
      if (!validOwner() || run?.id !== id) return;
      run = result.run; applyReward(result); renderResult();
      // History is secondary to the already committed, idempotent server settlement.
      if (result.applied) void playerRepository.addExamLog({ uid: owner, mode: 'opportunity', topic: '機緣洞天',
        question: `${run.title} · ${run.reward.correct}/5`, isCorrect: run.reward.correct === 5,
        correctCount: run.reward.correct, totalCount: 5, explanation: '共用長文五題素養閱讀', timestamp: new Date(), opportunityRunId: id,
        subject: run.target.subject, opportunityTitle: run.title }).catch(e => console.warn('[Opportunity history]', e));
    } catch (e) {
      if (validOwner() && run?.id === id) {
        $('op-status').textContent = `${e.message}。可重試結算，獎勵只會入帳一次。`;
        if ($('op-next')) { $('op-next').disabled = false; $('op-next').textContent = '重新確認機緣獎勵'; }
      }
    } finally { if (run?.id === id) busy = false; }
  }
  function renderResult() {
    const reward = run.reward;
    overlay().innerHTML = `${header('五重參悟 · 機緣結算')}<div class="op-result"><span class="op-seal" aria-hidden="true">悟</span><h3>${esc(run.title)}</h3><p>已完成同卷五題，答對 ${reward.correct} / 5 題。</p><div class="op-rewards"><span>靈石 <b>+${reward.goldAdded}</b></span><span>修為 <b>+${reward.cultivationAdded}</b></span>${reward.spiritAdded ? `<span>神識 <b>+${reward.spiritAdded}</b></span>` : ''}</div>${reward.soulCultivationAdded ? `<p>修為含元嬰洞天加成 +${reward.soulCultivationAdded}。</p>` : ''}<button class="op-primary" id="op-review" type="button">回顧本文與五題解析</button><button class="op-secondary" id="op-return" type="button">繼續問道</button></div>`;
    $('op-leave').onclick = () => close(); $('op-return').onclick = () => close();
    $('op-review').onclick = () => {
      const el = overlay();
      el.innerHTML = `${header('本文與解析回顧')}<div class="op-workspace">${passageHtml()}<div class="op-review-list">${run.questions.map((q, i) => `<section><h3>${i + 1}. ${rich(q.q)}</h3><p class="op-success">正解：${rich(q.options[q.feedback.correct])}</p><p>${rich(q.feedback.exp)}</p><p>${q.feedback.evidence.map(e => `${esc(e.paragraph)}：${esc(e.quote)}`).join('<br>')}</p></section>`).join('')}<button type="button" id="op-return" class="op-primary">繼續問道</button></div></div>`;
      $('op-leave').onclick = () => close(); $('op-return').onclick = () => close(); void window.quizMathTypeset?.(el); focusTitle();
    };
    focusTitle();
  }
  function openRun(next, account, offer = true) {
    owner = account; run = next; index = Math.max(0, Math.min(4, next.answered - 1));
    if (next.status === 'completed') renderResult();
    else if (next.answered) renderQuestion();
    else if (offer) renderOffer(); else { index = 0; renderQuestion(); }
  }

  window.isOpportunityActive = () => !!$('opportunity-overlay');
  window.maybeEncounterOpportunity = async ({ quiz } = {}) => {
    if (!quiz || rolled.has(quiz) || inflight || restoring || !uid() || !data() || window.isOpportunityActive() ||
        window.isExtendedPracticeActive?.() || $('newbie-tutorial-layer') || $('five-immortal-challenge') || $('dongtian-overlay')) return false;
    // Only called by the completed solo-question next action, never by opening a page.
    rolled.add(quiz);
    const account = uid(), scope = rules.scopeKey(data()), misses = chanceRecord(account, scope);
    if (Math.random() >= rules.chance(misses)) { saveMisses(account, scope, misses + 1); return false; }
    owner = account; inflight = true; const operation = ++serial;
    const requestId = crypto.randomUUID().replace(/-/g, '');
    const el = overlay();
    el.innerHTML = `${header('靈光正在凝成')}<div class="op-offer"><span class="op-seal op-loading" aria-hidden="true">緣</span><h3>一卷新篇，正在展開</h3><p role="status">正在為你選定的修習範圍凝成長文與五題，並核對文本依據。</p><button class="op-secondary" id="op-cancel-load" type="button">先繼續問道</button></div>`;
    focusTitle();
    return new Promise(resolve => {
      let released = false;
      const release = () => { if (!released) { released = true; resolve(true); } };
      const skip = () => { close(); release(); };
      $('op-cancel-load').onclick = skip; $('op-leave').onclick = skip;
      void request('start', { requestId, scope }, 90000).then(result => {
        if (operation !== serial || uid() !== account || rules.scopeKey(data() || {}) !== scope || result.run.scope !== scope) {
          if (uid() === account) void request('abandon', { runId: result.run.id }).catch(() => {});
          if (operation === serial) close();
          release(); return;
        }
        saveMisses(account, scope, 0); openRun(result.run, account); release();
      }).catch(e => {
        if (operation === serial && uid() === account) { toast(`${e.message}，先繼續問道。`); close(); }
        release();
      }).finally(() => { inflight = false; });
    });
  };
  async function restore() {
    const account = uid();
    if (!account || !data() || restoring || inflight || restoredAccount === account || window.isOpportunityActive() ||
        window.isExtendedPracticeActive?.() || $('dongtian-overlay') || $('newbie-tutorial-layer') || $('five-immortal-challenge')) return;
    restoring = true; const operation = serial;
    try {
      const result = await request('current');
      if (uid() !== account || operation !== serial) return;
      if (window.isExtendedPracticeActive?.() || $('dongtian-overlay') || $('newbie-tutorial-layer') || $('five-immortal-challenge')) return;
      restoredAccount = account;
      if (result.run && rules.scopeKey(data()) === result.run.scope) openRun(result.run, account);
      else if (result.run) await request('abandon', { runId: result.run.id });
    } catch (e) { console.warn('[Opportunity restore]', e.message); }
    finally { restoring = false; }
  }
  function reconcile() {
    if (owner && uid() !== owner) { close(false); owner = ''; restoredAccount = ''; }
    void restore();
  }
  window.addEventListener('xiuxian:user-ready', reconcile);
  window.addEventListener('xiuxian:stats-updated', () => { if (owner && uid() !== owner) reconcile(); });
  window.addEventListener('pagehide', () => { if (escapeHandler) document.removeEventListener('keydown', escapeHandler); });
  setTimeout(reconcile, 500);
})();
