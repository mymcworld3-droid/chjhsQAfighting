import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getFirestore, doc, collection, query, where, limit, getDocs,
  addDoc, updateDoc, onSnapshot, runTransaction, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { BATTLE_V2, settleBattleRound } from './battle-engine-v2.js?v=20260920-corebattle1';

// Battle v2 — 修仙配對鬥法。
// 核心原則：配對、首答倒數、回合結算、離場判定皆寫入 Firestore；任何單一 client 都不能私自決定勝負。
(function () {
  'use strict';

  const FOUNDATION_SCORE = 10;
  const ROOM_COLLECTION = 'rooms';
  const HEARTBEAT_MS = 8000;
  const PREPARE_LEASE_MS = 7000;
  const MATCH_RECONCILE_MS = 1100;
  const MATCH_SCAN_LIMIT = 80;
  const INTRO_DURATION_MS = 4800;
  const ANSWER_WINDOW_MS = 25000;

  const state = {
    roomId: null,
    role: null,
    room: null,
    unsub: null,
    tick: null,
    heartbeat: null,
    reconcile: null,
    starting: false,
    leaving: false,
    settlingRound: null,
    timeoutRound: null,
    preparingRound: null,
    advancingRound: null,
    introAdvancing: false,
    disconnectClaimRound: null,
    renderedQuestionId: null,
    pendingAnswer: null,
    seenActivationKeys: new Set(),
    seenSettlementKey: null,
    resultRecordedRoom: null
  };

  function auth() { return getAuth(getApp()); }
  function db() { return getFirestore(getApp()); }
  function me() { return auth().currentUser; }
  function userData() { return window.getCurrentUserData?.() || null; }
  function score() { return Math.max(0, Number(userData()?.stats?.totalScore) || 0); }
  function nowMs() { return Date.now(); }

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function timestampMs(value, fallback = 0) {
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function randomId(prefix = 'q') {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function ensureStyle() {
    const href = 'styles/battle-mode-v2.css';
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  function toast(message) {
    document.getElementById('battle-v2-toast')?.remove();
    const el = document.createElement('div');
    el.id = 'battle-v2-toast';
    el.className = 'battle-v2-toast';
    el.textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => el.remove(), 2600);
  }

  function ensurePage() {
    ensureStyle();
    const page = document.getElementById('page-battle');
    if (!page) return null;
    if (page.dataset.battleV2 === '2') return page;

    page.dataset.battleV2 = '2';
    page.className = 'page-section hidden battle-v2-page';
    page.innerHTML = `
      <div class="bv2-ambient" aria-hidden="true"><i></i><i></i><i></i><b>鬥</b></div>
      <div class="bv2-shell">
        <header class="bv2-head">
          <div><span class="bv2-eyebrow">青雲鬥法臺 ／ MATCHMAKING</span><h2>論道鬥法</h2></div>
          <div class="bv2-head-actions">
            <span id="bv2-room-badge" class="bv2-room-badge">尚未配對</span>
            <button id="bv2-leave-top" type="button" class="bv2-icon-btn" aria-label="離開鬥法"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </header>

        <section id="bv2-lobby" class="bv2-panel bv2-lobby">
          <div class="bv2-radar"><span></span><b>尋</b></div>
          <div class="bv2-lobby-copy"><span class="bv2-kicker">靈識尋蹤</span><h3 id="bv2-lobby-title">正在搜尋對手</h3><p id="bv2-lobby-status">尋找修為相近的道友…</p></div>
          <div class="bv2-match-pair">
            <div class="bv2-match-card"><span>我方修士</span><strong id="bv2-match-me">修士</strong><small id="bv2-match-me-core">本命金丹：—</small></div>
            <div class="bv2-vs"><i></i><b>VS</b><i></i></div>
            <div class="bv2-match-card enemy"><span>對手修士</span><strong id="bv2-match-enemy">搜尋中…</strong><small id="bv2-match-enemy-core">等待道友入場</small></div>
          </div>
          <button id="bv2-cancel" class="bv2-btn ghost" type="button">收回靈識 · 取消配對</button>
        </section>

        <section id="bv2-intro" class="bv2-intro hidden">
          <div class="bv2-intro-runes" aria-hidden="true"><i></i><i></i><i></i></div>
          <div class="bv2-intro-player left"><span>我方</span><strong id="bv2-intro-me">—</strong><small id="bv2-intro-me-core">未調御金丹</small></div>
          <div class="bv2-intro-center">
            <span id="bv2-intro-kicker">靈識鎖定</span>
            <b id="bv2-intro-count">鬥</b>
            <strong id="bv2-intro-title">道友相逢 · 以學論道</strong>
          </div>
          <div class="bv2-intro-player right"><span>對手</span><strong id="bv2-intro-enemy">—</strong><small id="bv2-intro-enemy-core">未調御金丹</small></div>
          <div class="bv2-intro-slash" aria-hidden="true"></div>
        </section>

        <section id="bv2-arena" class="bv2-arena hidden">
          <div class="bv2-scoreboard">
            <article id="bv2-enemy-fighter" class="bv2-fighter enemy">
              <div class="bv2-fighter-head"><div><span>對手</span><strong id="bv2-enemy-name">—</strong></div><b id="bv2-enemy-hp-text">1000</b></div>
              <div class="bv2-hp"><i id="bv2-enemy-hp"></i></div><small id="bv2-enemy-core">本命金丹：—</small>
            </article>
            <div class="bv2-round-seal"><span>ROUND</span><b id="bv2-round">1 / ${BATTLE_V2.maxRounds}</b><em>問</em></div>
            <article id="bv2-my-fighter" class="bv2-fighter me">
              <div class="bv2-fighter-head"><div><span>我方</span><strong id="bv2-my-name">—</strong></div><b id="bv2-my-hp-text">1000</b></div>
              <div class="bv2-hp"><i id="bv2-my-hp"></i></div><small id="bv2-my-core">本命金丹：—</small>
            </article>
          </div>

          <div class="bv2-duel-rule"><i class="fa-solid fa-hourglass-half"></i><span>本題<strong>不限讀題時間</strong>；任一方先答後，另一方才開始 <strong>25 秒</strong> 倒數。</span></div>

          <div class="bv2-question-card">
            <div class="bv2-question-meta"><span id="bv2-phase">靜觀題意</span><span id="bv2-timer" class="idle">等待首答</span></div>
            <div class="bv2-timer-track idle" id="bv2-timer-track"><i id="bv2-timer-bar"></i></div>
            <h3 id="bv2-question">正在凝聚題目…</h3>
            <div id="bv2-options" class="bv2-options"></div>
            <div id="bv2-explanation" class="bv2-explanation hidden"></div>
            <p id="bv2-answer-status" class="bv2-answer-status">先看清題意；第一位作答者會啟動對手的 25 秒限時。</p>
          </div>

          <div class="bv2-log-wrap"><div class="bv2-log-title"><span>鬥法紀錄</span><small>天道公證 · SERVER SYNCED</small></div><div id="bv2-log" class="bv2-log"><p>尚無攻防紀錄。</p></div></div>
        </section>

        <section id="bv2-result" class="bv2-result hidden">
          <div id="bv2-result-emblem" class="bv2-result-emblem">道</div><span class="bv2-kicker">鬥法終了</span><h3 id="bv2-result-title">勝負已分</h3><p id="bv2-result-msg">正在寫入戰績…</p>
          <div id="bv2-result-stats" class="bv2-result-stats"></div>
          <div class="bv2-result-actions"><button id="bv2-home" class="bv2-btn ghost" type="button">返回仙府</button><button id="bv2-rematch" class="bv2-btn primary" type="button">再尋道友</button></div>
        </section>
      </div>`;

    page.querySelector('#bv2-cancel')?.addEventListener('click', () => exitBattle({ navigate: true, forfeit: true }));
    page.querySelector('#bv2-leave-top')?.addEventListener('click', () => exitBattle({ navigate: true, forfeit: true }));
    page.querySelector('#bv2-home')?.addEventListener('click', () => exitBattle({ navigate: true, forfeit: false }));
    page.querySelector('#bv2-rematch')?.addEventListener('click', async () => {
      await exitBattle({ navigate: false, forfeit: false });
      startMatchmaking();
    });
    return page;
  }

  function showSection(name) {
    const page = ensurePage();
    if (!page) return;
    page.dataset.bv2Phase = name;
    ['lobby', 'intro', 'arena', 'result'].forEach((key) => page.querySelector(`#bv2-${key}`)?.classList.toggle('hidden', key !== name));
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value ?? '');
  }

  function playerCoreLabel(player) {
    return player?.goldenCore?.name ? `${player.goldenCore.name} · ${player.goldenCore.grade}品` : '未調御金丹';
  }

  function combatSnapshot() {
    const stats = window.getCombatStats?.() || window.getCombatStatDefaults?.() || { attack: 200, hp: 1000, maxHp: 1000 };
    const maxHp = Math.max(1, Math.round(finite(stats.maxHp, 1000)));
    return { attack: Math.max(1, Math.round(finite(stats.attack, 200))), hp: maxHp, maxHp };
  }

  function playerSnapshot() {
    const user = me();
    const data = userData() || {};
    const combat = combatSnapshot();
    return {
      uid: user.uid,
      name: data.displayName || user.displayName || '無名修士',
      rankLevel: Math.max(0, Number(data.stats?.rankLevel) || 0),
      totalScore: Math.max(0, Number(data.stats?.totalScore) || 0),
      atk: combat.attack,
      hp: combat.maxHp,
      maxHp: combat.maxHp,
      goldenCore: window.getEquippedGoldenCoreBattleSnapshot?.() || null,
      // 金丹道心在配對時複製成「本場一次性防護」，不消耗一般悟道持有的道心。
      coreShield: !!window.getEquippedGoldenCoreBattleSnapshot?.() && data.stats?.goldenCoreShield === true,
      coreCorrectStreak: 0,
      answerChoice: null, answerCorrect: null, answerAt: null, answerRound: null, timedOut: false,
      lastSeenAtMs: nowMs()
    };
  }

  function normalizeQuestion(raw) {
    const source = Array.isArray(raw) ? raw[0] : (raw?.questions?.[0] || raw || {});
    const q = String(source.q ?? source.question ?? '').trim();
    const opts = Array.isArray(source.opts) ? source.opts : (Array.isArray(source.options) ? source.options : []);
    let ans = source.ans ?? source.answer ?? source.correctIndex;
    if (typeof ans === 'string' && /^[A-Da-d]$/.test(ans.trim())) ans = ans.trim().toUpperCase().charCodeAt(0) - 65;
    if (!Number.isInteger(Number(ans)) && typeof ans === 'string') ans = opts.findIndex((item) => String(item) === ans);
    ans = Number(ans);
    if (!q || opts.length < 2 || !Number.isInteger(ans) || ans < 0 || ans >= opts.length) throw new Error('invalid quiz payload');
    return { id: randomId('bv2q'), q, opts: opts.slice(0, 6).map(String), ans, exp: String(source.exp ?? source.explanation ?? '此題暫無解析。'), subject: String(source.subject ?? source.topic ?? '綜合') };
  }

  function fallbackQuestion() {
    const a = Math.floor(Math.random() * 20) + 2;
    const b = Math.floor(Math.random() * 9) + 1;
    const answer = a + b;
    const opts = [answer, answer + 1, Math.max(0, answer - 1), answer + 2].sort(() => Math.random() - 0.5);
    return { id: randomId('fallback'), q: `備援題：${a} + ${b} = ?`, opts: opts.map(String), ans: opts.indexOf(answer), exp: `${a} + ${b} = ${answer}。`, subject: '基礎數學' };
  }

  async function generateQuestion() {
    const data = userData() || {};
    const settings = data.settings || {};
    const weak = Array.isArray(settings.weakSubjects) ? settings.weakSubjects[0] : (settings.weak || data.weakSubjects?.[0]);
    try {
      const response = await fetch('/api/generate-quiz', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: weak || '綜合', level: settings.level || data.level || data.educationLevel || '國中', rank: data.stats?.rankLevel || 0, difficulty: settings.difficulty || data.difficulty || 'medium' })
      });
      if (!response.ok) throw new Error(`quiz api ${response.status}`);
      const body = await response.json();
      let raw = body?.text ?? body;
      if (typeof raw === 'string') raw = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim());
      return normalizeQuestion(raw);
    } catch (error) {
      console.warn('[Battle v2] quiz API unavailable; using fallback:', error);
      toast('AI 出題暫時失敗，已切換備援題，鬥法不中斷。');
      return fallbackQuestion();
    }
  }

  function roomRef(roomId = state.roomId) { return roomId ? doc(db(), ROOM_COLLECTION, roomId) : null; }
  function playerForRole(room, role) { return role === 'host' ? room?.host : room?.guest; }
  function otherRole(role) { return role === 'host' ? 'guest' : 'host'; }

  function isRoomStale(room) {
    const created = timestampMs(room?.createdAt, Number(room?.createdAtMs) || 0);
    return created > 0 && nowMs() - created > BATTLE_V2.waitingRoomTtlMs;
  }

  function hasSubmittedAnswer(player, round) {
    return !!player && Number(player.answerRound) === Number(round) && typeof player.answerCorrect === 'boolean';
  }

  function answerObject(player, round) {
    if (!hasSubmittedAnswer(player, round)) return null;
    // 作答時間採 Firestore serverTimestamp；answerClientAt 僅供除錯。答對即可出手，時間不決定攻擊資格。
    const atMs = timestampMs(player.answerAt, 0);
    if (!atMs) return null;
    return { correct: player.answerCorrect, atMs, choice: player.answerChoice, timedOut: !!player.timedOut };
  }

  function battlePlayer(player, round) { return { ...player, answer: answerObject(player, round) }; }

  async function claimWaitingRoom(targetRef, myData) {
    let claimed = false;
    await runTransaction(db(), async (tx) => {
      const snap = await tx.get(targetRef);
      if (!snap.exists()) return;
      const room = snap.data();
      if (Number(room.modeVersion) !== BATTLE_V2.modeVersion || room.status !== 'waiting' || room.guest || room.host?.uid === myData.uid || isRoomStale(room)) return;
      tx.update(targetRef, {
        guest: myData,
        status: 'intro',
        matchedAt: serverTimestamp(), matchedAtMs: nowMs(),
        introUntilMs: nowMs() + INTRO_DURATION_MS,
        answerWindowStartedAt: null, answerWindowStartedAtMs: null, firstAnswerUid: null,
        updatedAt: serverTimestamp()
      });
      claimed = true;
    });
    return claimed;
  }

  async function findAndClaimRoom(myData, onlyRoomId = null) {
    if (onlyRoomId) return await claimWaitingRoom(roomRef(onlyRoomId), myData) ? onlyRoomId : null;
    const snap = await getDocs(query(collection(db(), ROOM_COLLECTION), where('status', '==', 'waiting'), limit(MATCH_SCAN_LIMIT)));
    const candidates = snap.docs.filter((entry) => {
      const room = entry.data();
      return Number(room.modeVersion) === BATTLE_V2.modeVersion && room.host?.uid !== myData.uid && !room.guest && !isRoomStale(room);
    }).sort((a, b) => {
      const aGap = Math.abs((Number(a.data().host?.totalScore) || 0) - myData.totalScore);
      const bGap = Math.abs((Number(b.data().host?.totalScore) || 0) - myData.totalScore);
      return aGap - bGap || Number(a.data().createdAtMs || 0) - Number(b.data().createdAtMs || 0) || a.id.localeCompare(b.id);
    });
    for (const candidate of candidates) {
      try { if (await claimWaitingRoom(candidate.ref, myData)) return candidate.id; } catch (_) {}
    }
    return null;
  }

  async function createWaitingRoom(myData) {
    const question = await generateQuestion();
    const ref = await addDoc(collection(db(), ROOM_COLLECTION), {
      modeVersion: BATTLE_V2.modeVersion, mode: 'matchmaking', host: myData, guest: null, status: 'waiting',
      round: 1, maxRounds: BATTLE_V2.maxRounds, responseWindowMs: ANSWER_WINDOW_MS,
      currentQuestion: question, settledRound: 0, battleLog: [], battleLogId: '', winner: null, finishReason: '',
      hostResultRecorded: false, guestResultRecorded: false,
      answerWindowStartedAt: null, answerWindowStartedAtMs: null, firstAnswerUid: null,
      createdAt: serverTimestamp(), createdAtMs: nowMs(), updatedAt: serverTimestamp()
    });
    return ref.id;
  }

  function scheduleReconcile(delay = MATCH_RECONCILE_MS) {
    if (state.reconcile || state.role !== 'host' || !state.roomId) return;
    state.reconcile = setTimeout(async () => {
      state.reconcile = null;
      await reconcileOwnWaitingRoom();
      // 只要仍在自己的等待房，就持續尋找另一個同時建立的等待房。
      // 修正兩名玩家同時按配對、各自成為房主後永久互相等不到的情況。
      if (state.roomId && state.role === 'host' && state.room?.status === 'waiting') scheduleReconcile();
    }, delay);
  }

  async function reconcileOwnWaitingRoom() {
    const ownId = state.roomId;
    if (!ownId || state.role !== 'host' || state.room?.status !== 'waiting') return;
    const myData = playerSnapshot();
    try {
      const snap = await getDocs(query(collection(db(), ROOM_COLLECTION), where('status', '==', 'waiting'), limit(MATCH_SCAN_LIMIT)));
      const target = snap.docs.filter((entry) => {
        const room = entry.data();
        return entry.id < ownId && Number(room.modeVersion) === BATTLE_V2.modeVersion && room.host?.uid !== myData.uid && !room.guest && !isRoomStale(room);
      }).sort((a, b) => a.id.localeCompare(b.id))[0];
      if (!target) return;

      let merged = false;
      await runTransaction(db(), async (tx) => {
        const ownRef = roomRef(ownId);
        const ownSnap = await tx.get(ownRef);
        const targetSnap = await tx.get(target.ref);
        if (!ownSnap.exists() || !targetSnap.exists()) return;
        const own = ownSnap.data();
        const other = targetSnap.data();
        if (own.status !== 'waiting' || own.guest || own.host?.uid !== myData.uid) return;
        if (other.status !== 'waiting' || other.guest || other.host?.uid === myData.uid || Number(other.modeVersion) !== BATTLE_V2.modeVersion || isRoomStale(other)) return;
        tx.update(target.ref, { guest: myData, status: 'intro', matchedAt: serverTimestamp(), matchedAtMs: nowMs(), introUntilMs: nowMs() + INTRO_DURATION_MS, answerWindowStartedAt: null, answerWindowStartedAtMs: null, firstAnswerUid: null, updatedAt: serverTimestamp() });
        tx.delete(ownRef);
        merged = true;
      });
      if (!merged) return;
      detachRoomListener();
      state.roomId = target.id;
      state.role = 'guest';
      subscribeRoom(target.id);
    } catch (error) { console.warn('[Battle v2] simultaneous room merge skipped:', error); }
  }

  function detachRoomListener() {
    if (state.unsub) { try { state.unsub(); } catch (_) {} state.unsub = null; }
  }

  function stopTimers() {
    if (state.tick) clearInterval(state.tick);
    if (state.heartbeat) clearInterval(state.heartbeat);
    if (state.reconcile) clearTimeout(state.reconcile);
    state.tick = state.heartbeat = state.reconcile = null;
  }

  function resetRuntime() {
    detachRoomListener(); stopTimers();
    state.roomId = null; state.role = null; state.room = null; state.starting = false; state.leaving = false;
    state.settlingRound = state.timeoutRound = state.preparingRound = state.advancingRound = state.disconnectClaimRound = null;
    state.introAdvancing = false; state.renderedQuestionId = null; state.pendingAnswer = null;
    state.seenActivationKeys.clear(); state.seenSettlementKey = null; state.resultRecordedRoom = null;
  }

  function renderLobby(room) {
    showSection('lobby');
    const mine = state.role ? playerForRole(room, state.role) : playerSnapshot();
    const opp = state.role ? playerForRole(room, otherRole(state.role)) : null;
    setText('bv2-match-me', mine?.name || '修士'); setText('bv2-match-me-core', `本命金丹：${playerCoreLabel(mine)}`);
    setText('bv2-room-badge', state.roomId ? `ROOM ${state.roomId.slice(0, 6).toUpperCase()}` : 'SEARCHING');
    setText('bv2-lobby-title', opp ? '已尋得對手' : '正在搜尋對手');
    setText('bv2-lobby-status', opp ? '雙方靈識已鎖定，即將登上鬥法臺。' : '優先尋找修為相近、等待較久的道友。');
    setText('bv2-match-enemy', opp?.name || '搜尋中…'); setText('bv2-match-enemy-core', opp ? playerCoreLabel(opp) : '等待道友入場');
  }

  function renderIntro(room) {
    showSection('intro');
    const mine = playerForRole(room, state.role); const enemy = playerForRole(room, otherRole(state.role));
    setText('bv2-intro-me', mine?.name || '我方修士'); setText('bv2-intro-enemy', enemy?.name || '對手修士');
    setText('bv2-intro-me-core', playerCoreLabel(mine)); setText('bv2-intro-enemy-core', playerCoreLabel(enemy));
    setText('bv2-room-badge', `ROOM ${state.roomId.slice(0, 6).toUpperCase()}`);
    updateIntroText(room);
  }

  function updateIntroText(room) {
    const left = Math.max(0, Number(room.introUntilMs || 0) - nowMs());
    if (left > 3600) { setText('bv2-intro-kicker', '靈識鎖定'); setText('bv2-intro-count', '鬥'); setText('bv2-intro-title', '道友相逢 · 以學論道'); }
    else if (left > 2700) { setText('bv2-intro-kicker', '凝神'); setText('bv2-intro-count', '3'); setText('bv2-intro-title', '收斂心神'); }
    else if (left > 1800) { setText('bv2-intro-kicker', '運氣'); setText('bv2-intro-count', '2'); setText('bv2-intro-title', '靈臺清明'); }
    else if (left > 900) { setText('bv2-intro-kicker', '問道'); setText('bv2-intro-count', '1'); setText('bv2-intro-title', '勝負由學識而定'); }
    else { setText('bv2-intro-kicker', '青雲鬥法臺'); setText('bv2-intro-count', '戰'); setText('bv2-intro-title', '鬥法開始'); }
  }

  function setHp(prefix, player) {
    const hp = Math.max(0, Number(player?.hp) || 0); const maxHp = Math.max(1, Number(player?.maxHp) || 1000);
    // 血條顯示比例；數字只顯示此刻剩餘生命，避免被誤解成場外永久血條。
    setText(`bv2-${prefix}-hp-text`, Math.round(hp));
    const bar = document.getElementById(`bv2-${prefix}-hp`); if (bar) bar.style.width = `${Math.max(0, Math.min(100, hp / maxHp * 100))}%`;
    document.getElementById(`bv2-${prefix === 'my' ? 'my' : 'enemy'}-fighter`)?.classList.toggle('low-hp', hp / maxHp <= .3);
  }

  function renderLogs(room) {
    const el = document.getElementById('bv2-log'); if (!el) return;
    const logs = Array.isArray(room?.battleLog) ? room.battleLog.slice(-8).reverse() : [];
    if (!logs.length) { el.innerHTML = '<p>尚無攻防紀錄。</p>'; return; }
    el.innerHTML = logs.map((entry) => {
      const actor = entry.actorName || (entry.actorUid === me()?.uid ? '你' : '對手');
      if (entry.type === 'attack') return `<p><b>${escapeHtml(actor)}</b> 出手造成 <strong>${Number(entry.damage) || 0}</strong> 傷害${entry.skill ? ` · ${escapeHtml(entry.skill)}` : ''}</p>`;
      if (entry.type === 'counter') return `<p class="counter"><b>${escapeHtml(actor)}</b> 雷光反擊 <strong>${Number(entry.damage) || 0}</strong> 傷害${entry.skill ? ` · ${escapeHtml(entry.skill)}` : ''}</p>`;
      if (entry.type === 'guard') return `<p class="counter"><b>${escapeHtml(actor)}</b> <strong>金丹道心護體</strong>，抵銷本次攻擊</p>`;
      if (entry.type === 'heal') return `<p class="counter"><b>${escapeHtml(actor)}</b> 回元，恢復 <strong>${Number(entry.amount) || 0}</strong> 生命</p>`;
      return `<p>${escapeHtml(entry.message || '回合結算')}</p>`;
    }).join('');
  }

  function announceActivations(room) {
    const batch = room?.lastSettlement?.activations; if (!Array.isArray(batch)) return;
    batch.forEach((activation, index) => {
      const key = `${room.battleLogId}:${index}:${activation.ownerUid}:${activation.skill}`;
      if (state.seenActivationKeys.has(key)) return; state.seenActivationKeys.add(key);
      if (activation.ownerUid === me()?.uid) window.showGoldenCoreActivation?.({ type: activation.type, name: activation.name || '金丹', message: activation.message || activation.skill, kind: activation.kind || '鬥法金丹效果' });
    });
  }

  function animateSettlement(room) {
    const settlement = room?.lastSettlement; if (!settlement || Number(settlement.round) !== Number(room.round)) return;
    const key = room.battleLogId || `${room.round}:${settlement.settledAtMs}`;
    if (state.seenSettlementKey === key) return; state.seenSettlementKey = key;
    const logs = Array.isArray(room.battleLog) ? room.battleLog.filter((x) => Number(x.round) === Number(room.round)) : [];
    logs.filter((entry) => entry.type === 'attack' || entry.type === 'counter').forEach((entry, index) => setTimeout(() => {
      const mineAttacks = entry.actorUid === me()?.uid;
      const actor = document.getElementById(mineAttacks ? 'bv2-my-fighter' : 'bv2-enemy-fighter');
      const target = document.getElementById(mineAttacks ? 'bv2-enemy-fighter' : 'bv2-my-fighter');
      actor?.classList.add('strike'); target?.classList.add('hit');
      if (target) {
        const pop = document.createElement('b'); pop.className = 'bv2-damage-pop'; pop.textContent = `-${Number(entry.damage) || 0}`; target.appendChild(pop); setTimeout(() => pop.remove(), 900);
      }
      setTimeout(() => { actor?.classList.remove('strike'); target?.classList.remove('hit'); }, 520);
    }, index * 420));
  }

  function renderQuestion(room, mine) {
    const qEl = document.getElementById('bv2-question'); const optionsEl = document.getElementById('bv2-options'); const expEl = document.getElementById('bv2-explanation');
    if (!qEl || !optionsEl || !expEl) return;
    const question = room.currentQuestion;
    if (!question) {
      qEl.textContent = room.status === 'preparing' ? '下一題凝聚中…' : '等待題目同步…'; optionsEl.innerHTML = ''; expEl.classList.add('hidden');
      setText('bv2-answer-status', '題目正在由鬥法臺同步。'); return;
    }
    if (state.renderedQuestionId !== question.id) {
      state.renderedQuestionId = question.id; state.pendingAnswer = null; qEl.textContent = question.q; optionsEl.innerHTML = '';
      question.opts.forEach((option, index) => {
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'bv2-option'; btn.dataset.index = String(index);
        btn.innerHTML = `<span>${String.fromCharCode(65 + index)}</span><b>${escapeHtml(option)}</b>`; btn.addEventListener('click', () => submitAnswer(index)); optionsEl.appendChild(btn);
      });
      expEl.classList.add('hidden'); expEl.textContent = ''; try { window.MathJax?.typesetPromise?.([qEl, optionsEl]); } catch (_) {}
    }
    const answered = answerObject(mine, room.round); if (answered) state.pendingAnswer = null;
    const pending = state.pendingAnswer?.round === Number(room.round) ? state.pendingAnswer : null;
    const settled = room.status === 'settled' || room.status === 'finished';
    [...optionsEl.querySelectorAll('.bv2-option')].forEach((btn) => {
      const idx = Number(btn.dataset.index); btn.disabled = !!answered || !!pending || settled || room.status !== 'playing';
      btn.classList.toggle('selected', answered?.choice === idx || pending?.choice === idx);
      btn.classList.toggle('correct', settled && idx === Number(question.ans)); btn.classList.toggle('wrong', settled && answered?.choice === idx && idx !== Number(question.ans));
    });
    if (settled) { expEl.textContent = `解析：${question.exp || '此題暫無解析。'}`; expEl.classList.remove('hidden'); setText('bv2-answer-status', '本回合已結算，稍後進入下一題。'); }
    else if (answered || pending) setText('bv2-answer-status', answered?.timedOut ? '本題逾時，等待回合結算。' : '你已出手；對手現在只有 25 秒可以回應。');
    else if (room.answerWindowStartedAt || room.answerWindowStartedAtMs) setText('bv2-answer-status', '對手已先作答！你的 25 秒倒數已開始。');
    else setText('bv2-answer-status', '不限讀題時間；第一位作答者會啟動另一方的 25 秒倒數。');
  }

  function renderArena(room) {
    showSection('arena');
    const mine = playerForRole(room, state.role); const enemy = playerForRole(room, otherRole(state.role)); if (!mine || !enemy) return;
    setText('bv2-room-badge', `ROOM ${state.roomId.slice(0, 6).toUpperCase()}`); setText('bv2-round', `${room.round} / ${room.maxRounds || BATTLE_V2.maxRounds}`);
    setText('bv2-my-name', mine.name || '我方'); setText('bv2-enemy-name', enemy.name || '對手');
    setText('bv2-my-core', `本命金丹：${playerCoreLabel(mine)}${mine.coreShield ? ' · 道心護體' : ''}`);
    setText('bv2-enemy-core', `本命金丹：${playerCoreLabel(enemy)}${enemy.coreShield ? ' · 道心護體' : ''}`);
    setHp('my', mine); setHp('enemy', enemy); renderQuestion(room, mine); renderLogs(room); announceActivations(room); animateSettlement(room);
    const myAnswer = answerObject(mine, room.round); const enemyAnswer = answerObject(enemy, room.round);
    const phase = room.status === 'playing' ? (!myAnswer && !enemyAnswer ? '靜觀題意' : myAnswer && !enemyAnswer ? '等待對手' : !myAnswer && enemyAnswer ? '限時應答' : '雙方已答') : room.status === 'settled' ? '道法交鋒' : '凝聚下一題';
    setText('bv2-phase', phase);
  }

  function renderResult(room) {
    showSection('result'); const uid = me()?.uid; const isDraw = room.winner === 'draw' || !room.winner; const won = room.winner === uid;
    setText('bv2-result-title', isDraw ? '道法相當 · 平局' : won ? '問道得勝' : '此局惜敗'); setText('bv2-result-emblem', isDraw ? '和' : won ? '勝' : '敗');
    setText('bv2-result-msg', room.finishReason === 'forfeit' ? '對手主動收法離場。' : room.finishReason === 'disconnect' ? '對手靈識中斷，判定離場。' : room.finishReason === 'round-limit' ? `已達 ${room.maxRounds || BATTLE_V2.maxRounds} 回合上限，以剩餘生命判定。` : room.finishReason === 'double-ko' ? '雙方同時力竭。' : '一方生命歸零，勝負已分。');
    const mine = playerForRole(room, state.role); const enemy = playerForRole(room, otherRole(state.role)); const stats = document.getElementById('bv2-result-stats');
    if (stats) stats.innerHTML = `<div><span>你的生命</span><b>${Math.max(0, Number(mine?.hp) || 0)}</b></div><div><span>對手生命</span><b>${Math.max(0, Number(enemy?.hp) || 0)}</b></div><div><span>總回合</span><b>${room.round}</b></div><div><span>結果</span><b>${isDraw ? '平局' : won ? '勝' : '敗'}</b></div>`;
    recordBattleResult(room).catch((error) => console.warn('[Battle v2] result record skipped:', error));
  }

  async function submitAnswer(choice) {
    if (!state.roomId || !state.role || state.room?.status !== 'playing') return;
    const round = Number(state.room.round);
    const mine = playerForRole(state.room, state.role);
    if (hasSubmittedAnswer(mine, round) || state.pendingAnswer?.round === round) return;
    const questionId = state.room.currentQuestion?.id;
    if (!questionId) return;

    state.pendingAnswer = { round, choice };
    renderQuestion(state.room, mine);
    try {
      const submitted = await runTransaction(db(), async (tx) => {
        const ref = roomRef();
        const snap = await tx.get(ref);
        if (!snap.exists()) return false;
        const room = snap.data();
        if (room.status !== 'playing' || Number(room.round) !== round || room.currentQuestion?.id !== questionId) return false;
        const player = playerForRole(room, state.role);
        if (hasSubmittedAnswer(player, round)) return false;

        const other = playerForRole(room, otherRole(state.role));
        const otherAnswered = hasSubmittedAnswer(other, round);
        const patch = {
          [`${state.role}.answerChoice`]: choice,
          [`${state.role}.answerCorrect`]: Number(choice) === Number(room.currentQuestion.ans),
          [`${state.role}.answerAt`]: serverTimestamp(),
          [`${state.role}.answerClientAt`]: nowMs(),
          [`${state.role}.answerRound`]: round,
          [`${state.role}.timedOut`]: false,
          [`${state.role}.lastSeenAtMs`]: nowMs(),
          updatedAt: serverTimestamp()
        };
        // 關鍵規則：題目本身不倒數；第一位玩家提交答案後，才建立 25 秒應答窗。
        if (!otherAnswered && !room.answerWindowStartedAt && !room.answerWindowStartedAtMs) {
          patch.answerWindowStartedAt = serverTimestamp();
          patch.answerWindowStartedAtMs = nowMs();
          patch.firstAnswerUid = me().uid;
        }
        tx.update(ref, patch);
        return true;
      });

      // transaction 無動作時解除本機鎖定，避免答案按鈕永久卡住。
      if (!submitted) {
        state.pendingAnswer = null;
        if (state.room) renderQuestion(state.room, playerForRole(state.room, state.role));
      }
    } catch (error) {
      state.pendingAnswer = null;
      if (state.room) renderQuestion(state.room, playerForRole(state.room, state.role));
      console.error('[Battle v2] answer submit failed:', error);
      toast('答案送出失敗，請再點一次。');
    }
  }

  async function timeoutMissingAnswer(room) {
    const round = Number(room.round); if (state.timeoutRound === round || room.status !== 'playing') return;
    const hostAnswered = hasSubmittedAnswer(room.host, round); const guestAnswered = hasSubmittedAnswer(room.guest, round);
    if (hostAnswered === guestAnswered) return;
    state.timeoutRound = round;
    try {
      await runTransaction(db(), async (tx) => {
        const ref = roomRef(); const snap = await tx.get(ref); if (!snap.exists()) return; const fresh = snap.data();
        if (fresh.status !== 'playing' || Number(fresh.round) !== round) return;
        const h = hasSubmittedAnswer(fresh.host, round); const g = hasSubmittedAnswer(fresh.guest, round); if (h === g) return;
        const role = h ? 'guest' : 'host';
        tx.update(ref, { [`${role}.answerChoice`]: null, [`${role}.answerCorrect`]: false, [`${role}.answerAt`]: serverTimestamp(), [`${role}.answerClientAt`]: nowMs(), [`${role}.answerRound`]: round, [`${role}.timedOut`]: true, updatedAt: serverTimestamp() });
      });
    } catch (error) { console.warn('[Battle v2] answer-window timeout raced:', error); }
    finally { setTimeout(() => { if (state.timeoutRound === round) state.timeoutRound = null; }, 1200); }
  }

  async function settleRound(room) {
    const round = Number(room.round); if (state.settlingRound === round || room.status !== 'playing') return;
    const hostAnswer = answerObject(room.host, round); const guestAnswer = answerObject(room.guest, round); if (!hostAnswer || !guestAnswer) return;
    state.settlingRound = round;
    try {
      await runTransaction(db(), async (tx) => {
        const ref = roomRef(); const snap = await tx.get(ref); if (!snap.exists()) return; const fresh = snap.data();
        if (fresh.status !== 'playing' || Number(fresh.round) !== round || Number(fresh.settledRound) >= round) return;
        if (!answerObject(fresh.host, round) || !answerObject(fresh.guest, round)) return;
        const outcome = settleBattleRound({ roomId: state.roomId, round, host: battlePlayer(fresh.host, round), guest: battlePlayer(fresh.guest, round), tieWindowMs: BATTLE_V2.tieWindowMs, maxRounds: fresh.maxRounds || BATTLE_V2.maxRounds });
        const names = { host: fresh.host?.name || '我方', guest: fresh.guest?.name || '對手' };
        const roundLogs = outcome.logs.map((entry) => ({ ...entry, actorName: names[entry.actorRole] || '修士', round, id: randomId(`log-${round}`) }));
        if (!roundLogs.length) roundLogs.push({ type: 'round', round, id: randomId(`log-${round}`), message: '雙方此回合皆未形成有效攻勢。' });
        const common = {
          'host.hp': outcome.hostHp, 'guest.hp': outcome.guestHp, 'host.isDead': outcome.hostHp <= 0, 'guest.isDead': outcome.guestHp <= 0,
          'host.coreShield': outcome.hostCoreShield, 'guest.coreShield': outcome.guestCoreShield,
          'host.coreCorrectStreak': outcome.hostCoreStreak, 'guest.coreCorrectStreak': outcome.guestCoreStreak,
          settledRound: round, battleLog: [...(Array.isArray(fresh.battleLog) ? fresh.battleLog : []), ...roundLogs].slice(-20), battleLogId: `${round}-${nowMs()}`,
          lastSettlement: { round, attackers: outcome.attackers, activations: outcome.activations, hostHp: outcome.hostHp, guestHp: outcome.guestHp, settledAtMs: nowMs() }, updatedAt: serverTimestamp()
        };
        if (outcome.finished) tx.update(ref, { ...common, status: 'finished', winner: outcome.winnerUid, finishReason: outcome.finishReason, finishedAt: serverTimestamp() });
        else tx.update(ref, { ...common, status: 'settled', nextRoundAtMs: nowMs() + BATTLE_V2.nextRoundDelayMs });
      });
    } catch (error) { console.warn('[Battle v2] settlement raced:', error); }
    finally { setTimeout(() => { if (state.settlingRound === round) state.settlingRound = null; }, 800); }
  }

  async function advanceFromSettled(room) {
    const round = Number(room.round); if (state.advancingRound === round || room.status !== 'settled' || nowMs() < Number(room.nextRoundAtMs || 0)) return;
    state.advancingRound = round;
    try {
      await runTransaction(db(), async (tx) => {
        const ref = roomRef(); const snap = await tx.get(ref); if (!snap.exists()) return; const fresh = snap.data();
        if (fresh.status !== 'settled' || Number(fresh.round) !== round || nowMs() < Number(fresh.nextRoundAtMs || 0)) return;
        tx.update(ref, {
          status: 'preparing', round: round + 1, currentQuestion: null, questionOwnerUid: me().uid, questionClaimedAtMs: nowMs(),
          answerWindowStartedAt: null, answerWindowStartedAtMs: null, firstAnswerUid: null,
          'host.answerChoice': null, 'host.answerCorrect': null, 'host.answerAt': null, 'host.answerClientAt': null, 'host.answerRound': null, 'host.timedOut': false,
          'guest.answerChoice': null, 'guest.answerCorrect': null, 'guest.answerAt': null, 'guest.answerClientAt': null, 'guest.answerRound': null, 'guest.timedOut': false, updatedAt: serverTimestamp()
        });
      });
    } catch (_) {} finally { setTimeout(() => { if (state.advancingRound === round) state.advancingRound = null; }, 800); }
  }

  async function prepareRound(room) {
    const round = Number(room.round); if (state.preparingRound === round || room.status !== 'preparing' || room.currentQuestion || room.questionOwnerUid !== me()?.uid) return;
    state.preparingRound = round;
    try {
      const question = await generateQuestion();
      await runTransaction(db(), async (tx) => {
        const ref = roomRef(); const snap = await tx.get(ref); if (!snap.exists()) return; const fresh = snap.data();
        if (fresh.status !== 'preparing' || Number(fresh.round) !== round || fresh.currentQuestion || fresh.questionOwnerUid !== me().uid) return;
        tx.update(ref, { status: 'playing', currentQuestion: question, questionOwnerUid: null, questionClaimedAtMs: null, answerWindowStartedAt: null, answerWindowStartedAtMs: null, firstAnswerUid: null, updatedAt: serverTimestamp() });
      });
    } catch (error) { console.error('[Battle v2] next question failed:', error); }
    finally { state.preparingRound = null; }
  }

  async function takeoverQuestionLease(room) {
    if (room.status !== 'preparing' || room.currentQuestion || room.questionOwnerUid === me()?.uid || nowMs() - Number(room.questionClaimedAtMs || 0) < PREPARE_LEASE_MS) return;
    try {
      await runTransaction(db(), async (tx) => {
        const ref = roomRef(); const snap = await tx.get(ref); if (!snap.exists()) return; const fresh = snap.data();
        if (fresh.status !== 'preparing' || fresh.currentQuestion || nowMs() - Number(fresh.questionClaimedAtMs || 0) < PREPARE_LEASE_MS) return;
        tx.update(ref, { questionOwnerUid: me().uid, questionClaimedAtMs: nowMs(), updatedAt: serverTimestamp() });
      });
    } catch (_) {}
  }

  async function advanceIntro(room) {
    if (state.introAdvancing || room.status !== 'intro' || nowMs() < Number(room.introUntilMs || 0)) return;
    state.introAdvancing = true;
    try {
      await runTransaction(db(), async (tx) => {
        const ref = roomRef(); const snap = await tx.get(ref); if (!snap.exists()) return; const fresh = snap.data();
        if (fresh.status !== 'intro' || nowMs() < Number(fresh.introUntilMs || 0)) return;
        tx.update(ref, { status: 'playing', battleStartedAt: serverTimestamp(), answerWindowStartedAt: null, answerWindowStartedAtMs: null, firstAnswerUid: null, updatedAt: serverTimestamp() });
      });
    } catch (_) {} finally { setTimeout(() => { state.introAdvancing = false; }, 600); }
  }

  async function heartbeat() {
    if (!state.roomId || !state.role || !state.room || !['waiting', 'intro', 'playing', 'settled', 'preparing'].includes(state.room.status)) return;
    try { await updateDoc(roomRef(), { [`${state.role}.lastSeenAtMs`]: nowMs(), updatedAt: serverTimestamp() }); } catch (_) {}
  }

  async function claimDisconnectedOpponent(room) {
    if (!state.role || !['intro', 'playing', 'settled', 'preparing'].includes(room.status)) return;
    const enemyRole = otherRole(state.role); const enemy = playerForRole(room, enemyRole);
    if (!enemy?.uid || nowMs() - Number(enemy.lastSeenAtMs || 0) <= BATTLE_V2.disconnectTtlMs) return;
    const round = Number(room.round); if (state.disconnectClaimRound === round) return; state.disconnectClaimRound = round;
    try {
      await runTransaction(db(), async (tx) => {
        const ref = roomRef(); const snap = await tx.get(ref); if (!snap.exists()) return; const fresh = snap.data();
        if (!['intro', 'playing', 'settled', 'preparing'].includes(fresh.status)) return;
        const opp = playerForRole(fresh, enemyRole); if (!opp?.uid || nowMs() - Number(opp.lastSeenAtMs || 0) <= BATTLE_V2.disconnectTtlMs) return;
        tx.update(ref, { status: 'finished', winner: me().uid, finishReason: 'disconnect', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      });
    } catch (_) {} finally { setTimeout(() => { if (state.disconnectClaimRound === round) state.disconnectClaimRound = null; }, 3000); }
  }

  function tickRoom() {
    const room = state.room; if (!room || !state.roomId) return;
    const timerEl = document.getElementById('bv2-timer'); const barEl = document.getElementById('bv2-timer-bar'); const trackEl = document.getElementById('bv2-timer-track');

    if (room.status === 'intro') { updateIntroText(room); advanceIntro(room); }
    else if (room.status === 'playing' && room.currentQuestion) {
      const hostSubmitted = hasSubmittedAnswer(room.host, room.round);
      const guestSubmitted = hasSubmittedAnswer(room.guest, room.round);
      const hostAnswer = answerObject(room.host, room.round);
      const guestAnswer = answerObject(room.guest, room.round);
      if (hostSubmitted && guestSubmitted) {
        // 等 Firestore serverTimestamp 落地後再用伺服器時間判定速度。
        if (hostAnswer && guestAnswer) settleRound(room);
      } else if (hostSubmitted || guestSubmitted) {
        const started = timestampMs(room.answerWindowStartedAt, Number(room.answerWindowStartedAtMs) || 0);
        const duration = Math.max(5000, Number(room.responseWindowMs) || ANSWER_WINDOW_MS);
        const left = started ? Math.max(0, duration - (nowMs() - started)) : duration;
        if (timerEl) { timerEl.textContent = `${(left / 1000).toFixed(1)}s`; timerEl.classList.remove('idle'); }
        if (trackEl) trackEl.classList.remove('idle'); if (barEl) barEl.style.width = `${Math.max(0, Math.min(100, left / duration * 100))}%`;
        if (started && left <= 0) timeoutMissingAnswer(room);
      } else {
        if (timerEl) { timerEl.textContent = '等待首答'; timerEl.classList.add('idle'); }
        if (trackEl) trackEl.classList.add('idle'); if (barEl) barEl.style.width = '100%';
      }
    } else if (room.status === 'settled') {
      const left = Math.max(0, Number(room.nextRoundAtMs || 0) - nowMs());
      if (timerEl) { timerEl.textContent = `${(left / 1000).toFixed(1)}s`; timerEl.classList.remove('idle'); }
      if (trackEl) trackEl.classList.remove('idle'); if (barEl) barEl.style.width = `${Math.max(0, Math.min(100, left / BATTLE_V2.nextRoundDelayMs * 100))}%`;
      if (left <= 0) advanceFromSettled(room);
    } else if (room.status === 'preparing') {
      if (timerEl) timerEl.textContent = '凝聚題目'; if (barEl) barEl.style.width = '100%';
      if (room.questionOwnerUid === me()?.uid) prepareRound(room); else takeoverQuestionLease(room);
    }
    claimDisconnectedOpponent(room);
  }

  async function recordBattleResult(room) {
    if (!state.roomId || state.resultRecordedRoom === state.roomId || !state.role) return; state.resultRecordedRoom = state.roomId;
    const userRef = doc(db(), 'users', me().uid); const ref = roomRef();
    try {
      await runTransaction(db(), async (tx) => {
        const roomSnap = await tx.get(ref); const userSnap = await tx.get(userRef); if (!roomSnap.exists() || !userSnap.exists()) return;
        const fresh = roomSnap.data(); if (fresh.status !== 'finished') return; const marker = state.role === 'host' ? 'hostResultRecorded' : 'guestResultRecorded'; if (fresh[marker]) return;
        const stats = userSnap.data().stats || {}; const draw = fresh.winner === 'draw' || !fresh.winner; const won = fresh.winner === me().uid;
        const userPatch = { 'stats.battleMatches': Math.max(0, Number(stats.battleMatches) || 0) + 1 };
        if (draw) userPatch['stats.battleDraws'] = Math.max(0, Number(stats.battleDraws) || 0) + 1; else if (won) userPatch['stats.battleWins'] = Math.max(0, Number(stats.battleWins) || 0) + 1; else userPatch['stats.battleLosses'] = Math.max(0, Number(stats.battleLosses) || 0) + 1;
        tx.update(userRef, userPatch); tx.update(ref, { [marker]: true, updatedAt: serverTimestamp() });
      });
    } catch (error) { state.resultRecordedRoom = null; throw error; }
  }

  function onRoomSnapshot(snap) {
    if (!snap.exists()) { toast('鬥法房間已不存在。'); resetRuntime(); window.switchToPage?.('page-home'); return; }
    const room = snap.data(); if (Number(room.modeVersion) !== BATTLE_V2.modeVersion) return; state.room = room;
    const uid = me()?.uid; if (room.host?.uid === uid) state.role = 'host'; else if (room.guest?.uid === uid) state.role = 'guest'; else return;
    if (room.status === 'waiting') { renderLobby(room); if (state.role === 'host') scheduleReconcile(); } else if (room.status === 'intro') renderIntro(room); else if (['playing', 'settled', 'preparing'].includes(room.status)) renderArena(room); else if (room.status === 'finished') renderResult(room);
    if (room.status === 'playing' && answerObject(room.host, room.round) && answerObject(room.guest, room.round)) settleRound(room);
  }

  function subscribeRoom(roomId) {
    detachRoomListener(); state.roomId = roomId;
    state.unsub = onSnapshot(roomRef(roomId), onRoomSnapshot, (error) => { console.error('[Battle v2] listener failed:', error); toast('鬥法同步暫時中斷，房間仍會保留。'); });
    if (!state.tick) state.tick = setInterval(tickRoom, 200); if (!state.heartbeat) state.heartbeat = setInterval(heartbeat, HEARTBEAT_MS); heartbeat();
  }

  function storyOrTutorialOpen() {
    return !!document.querySelector('#xiuxian-story-layer,#newbie-tutorial-layer,#battle-tutorial-layer,#golden-core-tutorial-layer,#dongtian-overlay');
  }

  async function startMatchmaking() {
    if (window.getBattleTutorialState?.().active || state.starting) return; if (score() < FOUNDATION_SCORE) { toast(`需達築基初期（${FOUNDATION_SCORE} 修為）才可配對鬥法。`); return; } if (!me()) { alert('請先登入！'); return; }
    if (state.roomId && state.room && state.room.status !== 'finished') { window.switchToPage?.('page-battle'); return; }
    // 境界是唯一的遊玩進度門檻；正在顯示的劇情或教學畫面仍不能與配對重疊。
    if (storyOrTutorialOpen()) {
      toast('請先關閉目前的劇情或教學畫面，再進入鬥法。');
      return;
    }
    resetRuntime(); state.starting = true; ensurePage(); window.switchToPage?.('page-battle'); showSection('lobby'); renderLobby(null);
    try {
      await window.ensureCombatStats?.(); const myData = playerSnapshot(); setText('bv2-match-me', myData.name); setText('bv2-match-me-core', `本命金丹：${playerCoreLabel(myData)}`);
      const joined = await findAndClaimRoom(myData); if (joined) { state.role = 'guest'; subscribeRoom(joined); return; }
      setText('bv2-lobby-status', '目前沒有可加入的道友，正在開啟鬥法臺…'); const created = await createWaitingRoom(myData); state.role = 'host'; subscribeRoom(created); scheduleReconcile();
    } catch (error) { console.error('[Battle v2] matchmaking failed:', error); toast('配對失敗，請稍後再試。'); resetRuntime(); window.switchToPage?.('page-home'); }
    finally { state.starting = false; }
  }

  async function forfeitCurrentRoom() {
    if (!state.roomId || !state.role) return; const ref = roomRef();
    try {
      await runTransaction(db(), async (tx) => {
        const snap = await tx.get(ref); if (!snap.exists()) return; const fresh = snap.data();
        if (fresh.status === 'waiting' && state.role === 'host' && !fresh.guest) { tx.delete(ref); return; }
        if (!['intro', 'playing', 'settled', 'preparing'].includes(fresh.status)) return;
        const actualRole = fresh.host?.uid === me()?.uid ? 'host' : fresh.guest?.uid === me()?.uid ? 'guest' : state.role;
        const opponent = playerForRole(fresh, otherRole(actualRole));
        tx.update(ref, { status: 'finished', winner: opponent?.uid || 'draw', finishReason: 'forfeit', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      });
    } catch (error) { console.warn('[Battle v2] leave update skipped:', error); }
  }

  async function exitBattle({ navigate = true, forfeit = true } = {}) {
    if (state.leaving) return; state.leaving = true; try { if (forfeit) await forfeitCurrentRoom(); } finally { resetRuntime(); if (navigate) window.switchToPage?.('page-home'); }
  }

  async function joinSpecificRoom(roomId) {
    if (score() < FOUNDATION_SCORE || !me() || !roomId || storyOrTutorialOpen()) return false; const myData = playerSnapshot();
    try { const joined = await findAndClaimRoom(myData, roomId); if (!joined) return false; resetRuntime(); state.role = 'guest'; ensurePage(); window.switchToPage?.('page-battle'); subscribeRoom(joined); return true; } catch (_) { return false; }
  }

  async function recoverBattleSession() {
    if (window.getBattleTutorialState?.().active || state.roomId || !me() || score() < FOUNDATION_SCORE || storyOrTutorialOpen()) return; const uid = me().uid;
    try {
      const [hostRooms, guestRooms] = await Promise.all([
        getDocs(query(collection(db(), ROOM_COLLECTION), where('host.uid', '==', uid), limit(5))),
        getDocs(query(collection(db(), ROOM_COLLECTION), where('guest.uid', '==', uid), limit(5)))
      ]);
      const active = [...hostRooms.docs, ...guestRooms.docs].filter((entry, index, arr) => arr.findIndex((item) => item.id === entry.id) === index).filter((entry) => {
        const room = entry.data(); return Number(room.modeVersion) === BATTLE_V2.modeVersion && ['waiting', 'intro', 'playing', 'settled', 'preparing'].includes(room.status) && !(room.status === 'waiting' && isRoomStale(room));
      }).sort((a, b) => timestampMs(b.data().updatedAt, b.data().createdAtMs) - timestampMs(a.data().updatedAt, a.data().createdAtMs))[0];
      if (!active) return; const room = active.data(); state.role = room.host?.uid === uid ? 'host' : 'guest'; ensurePage(); window.switchToPage?.('page-battle'); subscribeRoom(active.id); toast('已恢復上次尚未結束的鬥法。');
    } catch (error) { console.warn('[Battle v2] session recovery skipped:', error); }
  }

  // 法寶通用引擎只需要這個唯讀橋接，不必知道 Battle v2 的內部 state 結構。
  window.getBattleArtifactQuestionContext = function () {
    const room = state.room;
    const question = room?.currentQuestion;
    if (!room || !question || !state.roomId || !state.role) return null;
    const mine = playerForRole(room, state.role);
    const round = Number(room.round);
    const answered = hasSubmittedAnswer(mine, round) || state.pendingAnswer?.round === round || room.status !== 'playing';
    return {
      context: 'battle',
      key: `battle:${state.roomId}:${round}:${question.id}`,
      correctIndex: Number(question.ans),
      answered,
      buttonsSelector: '#bv2-options .bv2-option',
      containerSelector: '#bv2-options'
    };
  };

  // Local tutorials use the real arena, but never attach a matchmaking room.
  let tutorialArenaBackup = null;
  window.openBattleTutorialArena = () => {
    if (state.starting || state.roomId) return null;
    ensurePage();
    showSection('arena');
    const arena = document.getElementById('bv2-arena');
    if (tutorialArenaBackup === null) tutorialArenaBackup = arena.innerHTML;
    arena.innerHTML = '';
    setText('bv2-room-badge', '鬥法教學 · 不計戰績');
    return arena;
  };
  window.closeBattleTutorialArena = () => {
    if (tutorialArenaBackup === null) return;
    document.getElementById('bv2-arena').innerHTML = tutorialArenaBackup;
    tutorialArenaBackup = null;
    setText('bv2-room-badge', '尚未配對');
    window.switchToPage?.('page-home');
  };
  document.addEventListener('click', (event) => {
    if (tutorialArenaBackup !== null && event.target.closest?.('#bv2-leave-top')) {
      event.preventDefault(); event.stopImmediatePropagation();
      window.pauseBattleTutorial?.();
    }
  }, true);

  window.startBattleMatchmaking = startMatchmaking;
  window.leaveBattle = () => exitBattle({ navigate: true, forfeit: true });
  window.joinBattleRoomV2 = joinSpecificRoom;
  window.getBattleV2State = () => ({ roomId: state.roomId, role: state.role, status: state.room?.status || 'idle', round: state.room?.round || 0, modeVersion: BATTLE_V2.modeVersion });

  function boot() { ensurePage(); setTimeout(recoverBattleSession, 700); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
