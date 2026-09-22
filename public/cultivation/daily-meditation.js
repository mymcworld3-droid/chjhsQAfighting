import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, collection, query, where, orderBy, limit, getDocs, doc, getDoc, runTransaction, increment, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { meditationDateKey, nextMeditationStreak, meditationReward } from './daily-meditation-rules.js';
import { buildMeditationMistakePool, chooseMeditationMistakes } from './daily-meditation-mistakes.js';

(function () {
  'use strict';
  const auth = getAuth(getApp());
  const db = getFirestore(getApp());
  const QUESTION_TOTAL = 3;
  let session = null;
  let busy = false;
  let remoteUid = '';
  let remoteRecord = null;
  // 同一次進入閉關只查詢一次錯題；日期或帳號變更時必須失效。
  let mistakeKey = '';
  let mistakeResult = null;
  let mistakePending = null;

  function invalidateMistakes() {
    mistakeKey = '';
    mistakeResult = null;
    mistakePending = null;
  }
  function prepareMistakes(id, date) {
    const key = id + '|' + date;
    if (mistakeKey !== key) {
      mistakeKey = key;
      mistakeResult = null;
      mistakePending = null;
    }
    if (mistakeResult) return Promise.resolve(mistakeResult);
    if (mistakePending) return mistakePending;
    const pending = loadMistakes(id).then(result => {
      if (mistakeKey === key && uid() === id && today() === date) mistakeResult = result;
      return result;
    }).finally(() => {
      if (mistakePending === pending) mistakePending = null;
    });
    mistakePending = pending;
    return pending;
  }

  function uid() { return auth.currentUser?.uid || ''; }
  function userData() { return window.getCurrentUserData?.() || null; }
  function today() { return meditationDateKey(); }
  function userRef(id) { return doc(db, 'users', id); }
  function node(id) { return document.getElementById(id); }
  function record() {
    const id = uid();
    if (!id) return {};
    return remoteUid === id && remoteRecord ? remoteRecord : (userData()?.dailyMeditation || {});
  }
  function notify(message) {
    const status = node('dm-status');
    if (status) status.textContent = message;
    else {
      const el = document.createElement('div');
      el.className = 'xiuxian-toast';
      el.textContent = message;
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add('show'));
      setTimeout(() => el.remove(), 3000);
    }
  }
  function ensureStyle() {
    if (node('daily-meditation-style')) return;
    const el = document.createElement('style');
    el.id = 'daily-meditation-style';
    el.textContent = [
      '.dm-overlay{position:fixed;inset:0;z-index:12000;display:grid;place-items:center;padding:0;background:rgba(3,4,7,.94);backdrop-filter:blur(15px);color:#f2e9d7}',
      '.dm-card{position:relative;display:flex;flex-direction:column;width:100%;height:100dvh;max-height:100dvh;overflow:hidden;border:1px solid rgba(216,177,93,.32);border-radius:0;background:radial-gradient(ellipse at 50% -20%,rgba(201,154,69,.19),transparent 55%),linear-gradient(165deg,#171810,#090c10 70%);box-shadow:0 25px 85px #000b}',
      '.dm-top{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 20px;border-bottom:1px solid #b9964b30}',
      '.dm-heading{font:700 20px "Noto Serif TC",serif;letter-spacing:.09em;color:#f2d89b}.dm-eyebrow{font-size:10px;letter-spacing:.18em;color:#bbaa8b}',
      '.dm-close{flex:0 0 auto;border:1px solid #cab48255;border-radius:100px;background:#191910;color:#e6d6b5;width:35px;height:35px;font-size:22px;cursor:pointer}',
      '.dm-body{width:min(100%,880px);margin:0 auto;min-height:0;flex:1;overflow-y:auto;overscroll-behavior:contain;padding:20px;display:grid;align-content:start;gap:14px}',
      '.dm-scene{position:relative;min-height:160px;display:grid;place-items:center;overflow:hidden;border-radius:16px;background:radial-gradient(circle at 50% 50%,#c49a4630,transparent 40%),linear-gradient(135deg,#24271c,#090d13);border:1px solid #c9a76835}',
      '.dm-circle{width:116px;height:116px;border:1px solid #d1ad634a;border-radius:50%;display:grid;place-items:center;box-shadow:0 0 45px #c49a4636,inset 0 0 32px #d7ac3925;animation:dm-pulse 4s ease-in-out infinite}',
      '.dm-circle:before{content:"";position:absolute;width:138px;height:138px;border:1px dashed #c8a45c45;border-radius:50%;animation:dm-spin 24s linear infinite}',
      '.dm-monk{font:700 50px "Noto Serif TC",serif;color:#e9ca81;text-shadow:0 0 22px #ebc97960}',
      '.dm-scene-label{position:absolute;bottom:12px;font:12px "Noto Serif TC",serif;color:#d6c49d;letter-spacing:.18em}',
      '.dm-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.dm-summary>div{padding:12px 8px;text-align:center;border-radius:12px;background:#ffffff07;border:1px solid #ffffff13}',
      '.dm-summary small{display:block;color:#9f9b91;font-size:10px}.dm-summary strong{display:block;margin-top:4px;font-size:16px;color:#eacf8a}',
      '.dm-note,.dm-status{font-size:12px;line-height:1.7;color:#beb7a7;white-space:pre-wrap}.dm-status:empty{display:none}',
      '.dm-action{min-height:47px;padding:10px 18px;border-radius:12px;border:1px solid #d7b66e8a;background:linear-gradient(125deg,#8a642f,#4c381c);font-size:14px;font-weight:800;color:#fff1d0;cursor:pointer}',
      '.dm-action:disabled{opacity:.5;cursor:wait}.dm-action-secondary{background:#ffffff0a;border-color:#e5c77c3d}',
      '.dm-progress{height:5px;background:#2e2c25;border-radius:8px;overflow:hidden}.dm-progress span{display:block;height:100%;background:#dcb55c;transition:width .3s}',
      '.dm-question{font-size:17px;font-weight:700;line-height:1.8;color:#f5ead5;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.dm-options{display:grid;gap:9px}.dm-option{display:flex;align-items:flex-start;text-align:left;gap:10px;min-height:47px;padding:12px;border:1px solid #c4a7763b;border-radius:12px;background:#ffffff08;color:#e9e4db;line-height:1.65;cursor:pointer;overflow-wrap:anywhere;white-space:pre-wrap}',
      '.dm-option b{flex:0 0 25px;color:#e6c477}.dm-option:disabled{cursor:default;opacity:.8}.dm-option.dm-correct{border-color:#80bb8e;background:#32583a49}.dm-option.dm-wrong{border-color:#c58181;background:#6c303049}',
      '.dm-result{font:700 27px "Noto Serif TC",serif;color:#e5c77c;text-align:center;letter-spacing:.1em}',
      '@keyframes dm-pulse{50%{box-shadow:0 0 64px #c49a465c,inset 0 0 45px #d7ac3955;transform:scale(1.025)}}@keyframes dm-spin{to{transform:rotate(360deg)}}',
      '@media(max-width:500px){.dm-top{padding:12px 15px}.dm-body{padding:13px}.dm-scene{min-height:125px}.dm-circle{width:88px;height:88px}.dm-circle:before{width:110px;height:110px}.dm-question{font-size:15px}.dm-summary strong{font-size:14px}}'
    ].join('\n');
    document.head.appendChild(el);
  }
  function ensureOverlay() {
    ensureStyle();
    let overlay = node('daily-meditation-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'daily-meditation-overlay';
    overlay.className = 'dm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '每日閉關');
    overlay.innerHTML = '<section class="dm-card"><header class="dm-top"><div><div class="dm-eyebrow">洞府 · 每日修行</div><div class="dm-heading">靜心閉關</div></div><button type="button" class="dm-close" id="dm-close" aria-label="關閉">×</button></header><div class="dm-body"><div class="dm-scene"><div class="dm-circle"><span class="dm-monk">道</span></div><span class="dm-scene-label">凝神 · 內觀 · 運轉周天</span></div><div id="dm-content"></div><p id="dm-status" class="dm-status" role="status" aria-live="polite"></p></div></section>';
    document.body.appendChild(overlay);
    node('dm-close').addEventListener('click', () => {
      if (busy) { notify('正在同步閉關資料，請完成結算後再離開。'); return; }
      overlay.remove();
      session = null;
      invalidateMistakes();
    });
    return overlay;
  }
  function setContent(html) {
    const content = node('dm-content');
    if (content) content.innerHTML = html;
    const status = node('dm-status');
    if (status) status.textContent = '';
  }
  function summary(items) {
    return '<div class="dm-summary">' + items.map(item => '<div><small>' + item[0] + '</small><strong>' + item[1] + '</strong></div>').join('') + '</div>';
  }
  function panelState() {
    const r = record();
    const done = r.lastDate === today();
    return { done, streak: Math.max(0, Number(r.streak) || 0), totalDays: Math.max(0, Number(r.totalDays) || 0) };
  }
  function syncPanel() {
    const el = node('xiuxian-meditate');
    if (!el) return;
    const current = panelState();
    el.textContent = current.done ? '查看今日閉關' : '今日閉關';
    el.disabled = false;
    el.style.opacity = '1';
    const label = node('xiuxian-meditation-streak');
    if (label) label.textContent = '連續閉關 ' + current.streak + ' 日 · 累計 ' + current.totalDays + ' 日';
  }
  function currentPreview() {
    const r = record();
    const streak = nextMeditationStreak(r.lastDate, r.streak, today());
    return meditationReward(userData()?.stats?.totalScore, streak, QUESTION_TOTAL);
  }
  function renderIntro() {
    const r = record();
    if (r.lastDate === today()) {
      const result = r.lastResult || {};
      setContent('<h3 class="dm-result">今日已出關</h3>' +
        summary([['連續閉關', (r.streak || 1) + ' 日'], ['修為收穫', '+' + (result.cultivation || 0)], ['靈石收穫', '+' + (result.gold || 0)]]) +
        '<p class="dm-note">今日已完成閉關，明日再來運轉周天。累計閉關 ' + (r.totalDays || 1) + ' 日。</p>' +
        '<button type="button" class="dm-action dm-action-secondary" id="dm-done">返回仙府</button>');
      node('dm-done').onclick = () => node('daily-meditation-overlay')?.remove();
      syncPanel();
      return;
    }
    const reward = currentPreview();
    setContent(summary([['今日連續', '第 ' + reward.streak + ' 天'], ['全對修為', '+' + reward.cultivation], ['全對靈石', '+' + reward.gold]]) +
      '<p class="dm-note">從你過去問道、洞天及閉關的錯題中抽出 3 道不同題目重新參悟。優先選擇尚未訂正的錯題。<br>全對獲完整獎勵，答對 2 題獲半額基礎獎勵與連續加成；未滿 2 題仍可累積天數並獲得 5 靈石。每日 00:00（台灣時間）重置。</p>' +
      '<button type="button" class="dm-action" id="dm-start">開始閉關</button>');
    node('dm-start').onclick = () => void start();
    syncPanel();
  }
  async function loadRemote() {
    const id = uid();
    if (!id) throw new Error('請先登入再閉關。');
    const snap = await getDoc(userRef(id));
    if (!snap.exists()) throw new Error('玩家資料尚未建立，請重新登入。');
    if (id !== uid()) throw new Error('帳號已切換，請重新開啟閉關。');
    remoteUid = id;
    remoteRecord = snap.data()?.dailyMeditation || {};
    const data = userData();
    if (data) data.dailyMeditation = remoteRecord;
    syncPanel();
  }
  async function open() {
    if (!uid()) { notify('請先登入再閉關。'); return; }
    const id = uid(), date = today();
    ensureOverlay();
    setContent('<p class="dm-note">正在確認今日閉關紀錄…</p>');
    // 畫面顯示前就與玩家紀錄並行預取錯題，而非按「開始」後才開始查 250 筆。
    // 若既有 session 正在作答或今天已完成，則不額外查詢。
    if (record().lastDate !== date && !(session && session.uid === id && session.date === date)) {
      void prepareMistakes(id, date).then(() => {
        if (node('dm-start')) notify('歷史錯題已備妥，可以開始閉關。');
      }).catch(error => {
        console.warn('[Meditation] mistake prefetch failed', error);
        if (node('dm-start')) notify('錯題預載失敗；按開始閉關時會重新嘗試。');
      });
    }
    try {
      await loadRemote();
      if (!node('daily-meditation-overlay') || uid() !== id || today() !== date) return;
      if (session && session.uid === uid() && session.date === today() && record().lastDate !== today()) {
        if (session.answered === QUESTION_TOTAL) {
          setContent('<p class="dm-note">本次三題已答完，但尚未領取獎勵。</p><button type="button" class="dm-action" id="dm-resume-finish">出關結算</button>');
          node('dm-resume-finish').onclick = () => void finish();
        } else if (session.questionAnswered) {
          setContent('<p class="dm-note">已作答的題目不會重複計分，繼續參悟下一題。</p><button type="button" class="dm-action" id="dm-resume-next">繼續參悟</button>');
          node('dm-resume-next').onclick = () => void nextQuestion();
        } else renderQuestion();
      } else {
        session = null;
        renderIntro();
        if (mistakePending && node('dm-start')) notify('正在預先整理歷史錯題，可先閱讀閉關說明。');
      }
    } catch (error) { notify(error.message || '無法讀取閉關紀錄，請檢查網路。'); }
  }
  function typeset() {
    const root = node('dm-content');
    if (!root) return;
    try {
      window.MathJax?.typesetClear?.([root]);
      window.MathJax?.typesetPromise?.([root])?.catch(error => console.warn('[Meditation MathJax]', error));
    } catch (error) { console.warn('[Meditation MathJax]', error); }
  }
  function renderQuestion() {
    if (!session || session.uid !== uid()) { session = null; renderIntro(); return; }
    if (session.date !== today()) {
      session = null;
      setContent('<p class="dm-note">已跨日，請重新開始今日閉關。</p><button type="button" class="dm-action" id="dm-restart">重新確認</button>');
      node('dm-restart').onclick = () => void open();
      return;
    }
    const q = session.question?.data;
    if (!q) { notify('題目尚未備妥。'); return; }
    setContent('<div class="dm-eyebrow">' + (session.question.source || '昔日錯題') + ' · 參悟 ' + (session.answered + 1) + ' / ' + QUESTION_TOTAL + '　·　已答對 ' + session.correct + ' 題</div>' +
      '<div class="dm-progress"><span style="width:' + Math.round(session.answered / QUESTION_TOTAL * 100) + '%"></span></div>' +
      '<h3 class="dm-question" id="dm-question"></h3><div class="dm-options" id="dm-options"></div>' +
      '<p class="dm-note">本次閉關獨立結算，不重複觸發一般答題獎勵。</p>');
    node('dm-question').textContent = String(q.q || '');
    q.opts.forEach((value, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dm-option';
      const mark = document.createElement('b');
      mark.textContent = String.fromCharCode(65 + i);
      button.appendChild(mark);
      const text = document.createElement('span');
      text.textContent = String(value);
      button.appendChild(text);
      button.addEventListener('click', () => answer(i));
      node('dm-options').appendChild(button);
    });
    typeset();
  }
  function answer(choice) {
    if (!session || session.busy || session.questionAnswered || session.date !== today()) return;
    const q = session.question.data;
    session.questionAnswered = true;
    const correct = choice === q.ans;
    session.answered += 1;
    if (correct) session.correct += 1;
    session.answers.push({ q: q.q, options: q.opts.slice(), correctIdx: q.ans, userIdx: choice, isCorrect: correct, exp: q.exp || '', source: session.question.source || '昔日錯題' });
    node('dm-options').querySelectorAll('button').forEach((button, i) => {
      button.disabled = true;
      if (i === q.ans) button.classList.add('dm-correct');
      if (i === choice && !correct) button.classList.add('dm-wrong');
    });
    const feedback = document.createElement('div');
    feedback.className = 'dm-note';
    const title = document.createElement('strong');
    title.textContent = correct ? '參悟成功' : '本次未能參透';
    feedback.appendChild(title);
    const explanation = document.createElement('p');
    explanation.textContent = String(q.exp || '未提供題解。');
    feedback.appendChild(explanation);
    node('dm-content').appendChild(feedback);
    const next = document.createElement('button');
    next.className = 'dm-action';
    next.type = 'button';
    next.textContent = session.answered === QUESTION_TOTAL ? '出關結算' : '繼續參悟';
    next.onclick = () => session.answered === QUESTION_TOTAL ? void finish() : void nextQuestion();
    node('dm-content').appendChild(next);
    typeset();
  }
  async function loadMistakes(id) {
    // 與原有「答題紀錄」相同索引（uid + timestamp），避免全站掃描。
    const history = query(collection(db, 'exam_logs'),
      where('uid', '==', id), orderBy('timestamp', 'desc'), limit(250));
    const snapshot = await getDocs(history);
    if (uid() !== id) throw new Error('帳號已切換，請重新開啟閉關。');
    const pool = buildMeditationMistakePool(snapshot.docs.map(item => item.data()));
    return { selected: chooseMeditationMistakes(pool, QUESTION_TOTAL), available: pool.total };
  }
  async function nextQuestion() {
    if (!session || session.busy || session.answered >= QUESTION_TOTAL) return;
    session.busy = true;
    const question = session.questions[session.answered];
    if (!question) {
      session.busy = false;
      notify('錯題資料不足，無法繼續閉關。');
      return;
    }
    session.question = question;
    session.questionAnswered = false;
    session.busy = false;
    renderQuestion();
  }
  async function start() {
    if (busy) return;
    busy = true;
    try {
      // 點開閉關時已讀取今日記錄；開始答題不再重讀同一份 users 文件。
      // 真正發獎仍由結算交易重新檢查每日領取狀態。
      if (remoteUid !== uid() || !remoteRecord) await loadRemote();
      if (record().lastDate === today()) { renderIntro(); return; }
      const id = uid();
      const date = today();
      setContent('<p class="dm-note">正在從過去的答題紀錄搜尋錯題…</p>');
      const { selected, available } = await prepareMistakes(id, date);
      if (id !== uid() || date !== today()) throw new Error('已跨日或切換帳號，請重新開始閉關。');
      if (selected.length < QUESTION_TOTAL) {
        session = null;
        setContent('<h3 class="dm-result">錯題尚未集齊</h3><p class="dm-note">目前可用的不同錯題共有 ' +
          available + ' 題，還需要 ' + (QUESTION_TOTAL - selected.length) +
          ' 題才能進行每日閉關。請先到「問道」或「洞天」練習；不會以新題冒充舊錯題，也不會扣除今日閉關次數。</p>' +
          '<button type="button" class="dm-action" id="dm-return">返回仙府</button>');
        node('dm-return').onclick = () => node('daily-meditation-overlay')?.remove();
        return;
      }
      session = { uid: id, date, answered: 0, correct: 0, questionAnswered: false,
        questions: selected, answers: [], question: null, busy: false };
      await nextQuestion();
    } catch (error) {
      setContent('<p class="dm-note">目前無法讀取歷史錯題，今日閉關尚未開始。請確認網路連線後重試。</p>' +
        '<button type="button" class="dm-action" id="dm-retry-start">重新查詢錯題</button>');
      node('dm-retry-start').onclick = () => void start();
      notify(error.message || '讀取錯題紀錄失敗。');
    } finally { busy = false; }
  }
  async function finish() {
    if (busy || !session || !session.questionAnswered || session.answered !== QUESTION_TOTAL || session.answers.length !== QUESTION_TOTAL) return;
    const current = session;
    if (current.uid !== uid() || current.date !== today()) {
      notify('已跨日或切換帳號，請重新開始。');
      return;
    }
    busy = true;
    setContent('<p class="dm-note">正在結算修行成果，請勿關閉…</p>');
    try {
      let outcome;
      const logRef = doc(collection(db, 'exam_logs'));
      await runTransaction(db, async tx => {
        const ref = userRef(current.uid);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('找不到玩家資料。');
        const data = snap.data();
        const old = data.dailyMeditation || {};
        if (old.lastDate === current.date) throw new Error('今日已領取閉關獎勵。');
        if (old.lastDate && String(old.lastDate) > current.date) throw new Error('閉關日期異常，請檢查裝置日期。');
        if (today() !== current.date || uid() !== current.uid) throw new Error('已跨日或切換帳號，請重新開始。');
        const streak = nextMeditationStreak(old.lastDate, old.streak, current.date);
        const originalScore = Math.max(0, Number(data.stats?.totalScore) || 0);
        const reward = meditationReward(originalScore, streak, current.correct);
        const newScore = originalScore + reward.cultivation;
        const newRecord = {
          lastDate: current.date, streak, totalDays: Math.max(0, Number(old.totalDays) || 0) + 1,
          bestStreak: Math.max(streak, Number(old.bestStreak) || 0),
          lastResult: { correct: current.correct, total: QUESTION_TOTAL, cultivation: reward.cultivation, gold: reward.gold, realm: reward.realm },
          updatedAt: serverTimestamp()
        };
        const rank = typeof window.getXiuxianRealmIndex === 'function'
          ? window.getXiuxianRealmIndex(newScore) : Math.max(0, Number(data.stats?.rankLevel) || 0);
        tx.update(ref, {
          dailyMeditation: newRecord,
          'stats.totalScore': increment(reward.cultivation),
          'stats.gold': increment(reward.gold),
          'stats.rankLevel': rank
        });
        tx.set(logRef, {
          uid: current.uid, mode: 'daily-meditation', topic: '閉關錯題',
          question: '每日閉關 · ' + current.correct + '/' + QUESTION_TOTAL,
          isCorrect: current.correct === QUESTION_TOTAL,
          correctCount: current.correct, totalCount: QUESTION_TOTAL,
          dailyMeditationAnswers: current.answers.map(answer => ({ ...answer })),
          timestamp: serverTimestamp()
        });
        outcome = { reward, newRecord, newScore, newGold: Math.max(0, Number(data.stats?.gold) || 0) + reward.gold, rank };
      });
      if (uid() !== current.uid) throw new Error('閉關已結算，但帳號已切換，請重新登入查看。');
      remoteUid = current.uid;
      remoteRecord = outcome.newRecord;
      const local = userData();
      if (local?.stats) {
        local.dailyMeditation = outcome.newRecord;
        local.stats.totalScore = outcome.newScore;
        local.stats.gold = outcome.newGold;
        local.stats.rankLevel = outcome.rank;
      }
      session = null;
      invalidateMistakes();
      window.updateUIStats?.();
      window.refreshCultivationRealmUI?.();
      window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', {
        detail: { source: 'daily-meditation', totalScore: outcome.newScore, gold: outcome.newGold, cultivationAdded: outcome.reward.cultivation, goldAdded: outcome.reward.gold }
      }));
      renderIntro();
    } catch (error) {
      setContent('<p class="dm-note">結算未能完成。若已完成領取，重新開啟會顯示今日結果；否則可重新結算。</p><button type="button" class="dm-action" id="dm-retry-finish">重新結算</button><button type="button" class="dm-action dm-action-secondary" id="dm-check">查詢閉關紀錄</button>');
      node('dm-retry-finish').onclick = () => void finish();
      node('dm-check').onclick = () => void open();
      notify(error.message || '儲存失敗，請檢查連線。');
    } finally { busy = false; syncPanel(); }
  }

  window.openDailyMeditation = open;
  window.getDailyMeditationPanelState = panelState;
  window.refreshDailyMeditationPanel = syncPanel;
  window.addEventListener('xiuxian:stats-updated', syncPanel);
  window.addEventListener('xiuxian:user-data-ready', () => {
    remoteUid = '';
    remoteRecord = null;
    session = null;
    invalidateMistakes();
    syncPanel();
  });
  syncPanel();
})();
