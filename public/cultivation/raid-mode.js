import { RAID_MVP, shenIntentForRound } from './raid-engine.js';
import { snapshotBattleKnowledge, resolveBattleKnowledge, pickBattleKnowledge } from './battle-question-scope.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getFirestore, collection, addDoc, getDoc, doc, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

(function () {
  'use strict';

  const PAGE_ID = 'page-raid';
  const STYLE_HREF = 'styles/raid-mode.css';
  const ROOM_STORAGE_KEY = 'xiuxianRaidRoomV2';
  const POLL_MS = 1500;
  const HEARTBEAT_MS = 8000;
  const ONLINE_MS = 22000;
  const MALE = 'assets/story/characters/player-male-determined.png';
  const FEMALE = 'assets/story/characters/player-female-determined.png';
  const SECOND_KEY_NAME = '清霜煉印';
  const THIRD_KEY_NAME = '玄霜真印';

  const state = {
    roomId: '',
    room: null,
    scope: null,
    question: null,
    review: null,
    pollTimer: null,
    heartbeatTimer: null,
    liveTimer: null,
    tickBusy: false,
    requestBusy: false,
    actionBusy: false,
    rewardBusy: false,
    reward: null,
    inviteUnsub: null,
    inviteBootAtMs: Date.now(),
    invitedRoomId: ''
  };

  function now() { return Date.now(); }
  function data() { return window.getCurrentUserData?.() || {}; }
  function authUser() { try { return getAuth(getApp()).currentUser; } catch (_) { return null; } }
  function database() { return getFirestore(getApp()); }
  function uid() { return authUser()?.uid || ''; }
  function score() { return Math.max(0, Number(data()?.stats?.totalScore) || 0); }
  function portrait() { return data().storyProgressV1?.gender === 'female' ? FEMALE : MALE; }
  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function rich(value) { return (window.quizMathRichText || escapeHtml)(String(value ?? '')); }
  function typeset(el) { window.quizMathTypeset?.(el); }
  function hpPct(hp, maxHp) {
    return Math.max(0, Math.min(100, Math.max(0, Number(hp) || 0) / Math.max(1, Number(maxHp) || 1) * 100));
  }
  function phaseName(phase) { return phase === 1 ? '試劍' : phase === 2 ? '霜意漸盛' : '清霜無聲'; }
  function me(room = state.room) { return room?.members?.[uid()] || null; }
  function members(room = state.room) { return Object.values(room?.members || {}).filter(Boolean); }
  function activeMembers(room = state.room) { return members(room).filter(row => row.left !== true); }
  function isLeader(room = state.room) { return room?.leaderUid === uid(); }
  function isActive() { return state.room?.status === 'active'; }
  function storyOpen() {
    return !!document.querySelector('#xiuxian-story-layer,#newbie-tutorial-layer,#battle-tutorial-layer,#golden-core-tutorial-layer,#dongtian-overlay');
  }

  function toast(message) {
    document.getElementById('raid-toast')?.remove();
    const el = document.createElement('div');
    el.id = 'raid-toast';
    el.className = 'raid-toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  async function api(path, { method = 'POST', body = null } = {}) {
    const user = authUser();
    if (!user) throw new Error('請先登入。');
    const token = await user.getIdToken();
    const init = {
      method,
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + token }
    };
    if (body !== null) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const response = await fetch(path, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.error || '團本服務暫時無法使用。');
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function ensureStyle() {
    if (document.querySelector('link[href="' + STYLE_HREF + '"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = STYLE_HREF;
    document.head.appendChild(link);
  }

  function ensurePage() {
    let page = document.getElementById(PAGE_ID);
    if (!page) {
      page = document.createElement('div');
      page.id = PAGE_ID;
      page.className = 'page-section hidden raid-page';
      document.querySelector('main')?.appendChild(page);
    }
    if (page.dataset.raidV2 !== '1') {
      page.dataset.raidV2 = '1';
      page.innerHTML =
        '<section id="raid-hub" class="raid-view"></section>' +
        '<section id="raid-lobby" class="raid-view hidden"></section>' +
        '<section id="raid-arena" class="raid-view hidden"></section>' +
        '<section id="raid-question" class="raid-view raid-question-view hidden"></section>' +
        '<section id="raid-result" class="raid-view hidden"></section>';
    }
    return page;
  }

  function show(name) {
    const page = ensurePage();
    ['hub', 'lobby', 'arena', 'question', 'result'].forEach((id) => {
      page.querySelector('#raid-' + id)?.classList.toggle('hidden', id !== name);
    });
    page.dataset.raidView = name;
  }

  function persistRoom(roomId = '') {
    state.roomId = roomId || '';
    try {
      if (state.roomId) localStorage.setItem(ROOM_STORAGE_KEY, state.roomId);
      else localStorage.removeItem(ROOM_STORAGE_KEY);
    } catch (_) {}
  }

  function savedRoom() {
    try { return String(localStorage.getItem(ROOM_STORAGE_KEY) || '').trim().toUpperCase(); }
    catch (_) { return ''; }
  }

  function updateBusyClass() {
    document.body.classList.toggle('raid-session-active', !!state.room && ['waiting', 'active'].includes(state.room.status));
  }
  window.isXiuxianRaidBusy = () => !!state.room && ['waiting', 'active'].includes(state.room.status);

  function mountHomeEntry() {
    if (document.getElementById('raid-home-entry')) return;
    const anchor = document.querySelector('#page-home .home-stats');
    if (!anchor) return;
    const button = document.createElement('button');
    button.id = 'raid-home-entry';
    button.type = 'button';
    button.className = 'raid-home-entry';
    button.innerHTML =
      '<span class="raid-home-emblem"><i class="fa-solid fa-users-rays"></i></span>' +
      '<span class="raid-home-copy"><small>秘境集結 ／ RAID</small><strong>秘境討伐</strong>' +
      '<em>1～4 人共鬥・題目不限時</em></span>' +
      '<span class="raid-home-arrow"><i class="fa-solid fa-chevron-right"></i></span>';
    button.addEventListener('click', openHub);
    anchor.insertAdjacentElement('afterend', button);
    updateHomeEntry();
  }

  function updateHomeEntry() {
    const button = document.getElementById('raid-home-entry');
    if (!button) return;
    const locked = score() < RAID_MVP.minimumScore;
    button.classList.toggle('locked', locked);
    const hint = button.querySelector('em');
    if (!hint) return;
    if (locked) hint.textContent = '築基初期（' + RAID_MVP.minimumScore + ' 修為）開放';
    else if (state.room?.status === 'active') hint.textContent = '清霜試煉進行中・點擊返回';
    else if (state.room?.status === 'waiting') hint.textContent = '團本房間 ' + state.roomId + ' 等待中';
    else hint.textContent = '1～4 人共鬥・題目不限時';
  }

  function renderHub() {
    stopRoomTimers();
    state.room = null;
    state.question = null;
    state.review = null;
    updateBusyClass();
    show('hub');
    const locked = score() < RAID_MVP.minimumScore;
    const resume = savedRoom();
    const hub = document.getElementById('raid-hub');
    hub.innerHTML =
      '<header class="raid-heading"><button class="raid-back" type="button" data-home><i class="fa-solid fa-arrow-left"></i></button>' +
      '<div><small>SECRET REALM ／ 秘境集結</small><h2>秘境討伐</h2><p>1～4 人共用 Boss；每位玩家各自出題，不互相等待。</p></div><span class="raid-seal">團</span></header>' +
      '<article class="raid-boss-card ' + (locked ? 'locked' : '') + '">' +
      '<div class="raid-boss-art"><img src="' + RAID_MVP.bossImage + '" alt="沈清霜"><span>首領試煉</span></div>' +
      '<div class="raid-boss-info"><div class="raid-badges"><span>1～4 人</span><span>題目不限時</span><span>Boss 每 18 秒行動</span></div>' +
      '<small>青雲山・演武秘境</small><h3>' + RAID_MVP.bossTitle + '</h3>' +
      '<p>沒有題目倒數。你可以一直思考；真正的時間壓力來自大師姐自己的攻擊時鐘。答對才形成攻勢，答錯只失去這次攻擊。隊友可在不同題號、不同進度同時戰鬥。</p>' +
      '<div class="raid-rule-grid"><div><span>題目</span><b>每人獨立・不限作答時間</b></div><div><span>Boss</span><b>18 秒一式・提前 5 秒預告</b></div>' +
      '<div><span>隊伍</span><b>共用 Boss HP・各自生命</b></div><div><span>掉落</span><b>清霜煉印必得・玄霜真印稀有掉落</b></div></div>' +
      '<div class="raid-room-actions"><button class="raid-primary" type="button" data-create ' + (locked ? 'disabled' : '') + '>' +
      (locked ? '需築基初期（10 修為）' : '建立團本') + '</button>' +
      '<div class="raid-join-row"><input id="raid-room-code-input" maxlength="6" autocomplete="off" placeholder="輸入 6 碼房號" ' + (locked ? 'disabled' : '') + '>' +
      '<button class="raid-ghost" type="button" data-join ' + (locked ? 'disabled' : '') + '>加入</button></div>' +
      (resume ? '<button class="raid-resume" type="button" data-resume><i class="fa-solid fa-rotate"></i> 重新連線房間 ' + escapeHtml(resume) + '</button>' : '') +
      '</div></div></article>';
    hub.querySelector('[data-home]')?.addEventListener('click', () => window.switchToPage?.('page-home'));
    hub.querySelector('[data-create]')?.addEventListener('click', createRoom);
    hub.querySelector('[data-join]')?.addEventListener('click', () => {
      const code = document.getElementById('raid-room-code-input')?.value || '';
      void joinRoom(code);
    });
    hub.querySelector('#raid-room-code-input')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void joinRoom(event.currentTarget.value);
    });
    hub.querySelector('[data-resume]')?.addEventListener('click', () => resumeRoom(resume));
    updateHomeEntry();
  }

  async function createRoom() {
    if (state.actionBusy || score() < RAID_MVP.minimumScore) return;
    if (storyOpen()) return toast('目前有劇情或教學進行中。');
    state.actionBusy = true;
    try {
      const payload = await api('/api/raid/create');
      enterRoom(payload.room);
    } catch (error) {
      console.error('[Raid] create room failed:', error);
      toast(error.message);
    } finally { state.actionBusy = false; }
  }

  async function joinRoom(code) {
    if (state.actionBusy || score() < RAID_MVP.minimumScore) return;
    const roomId = String(code || '').trim().toUpperCase().replace(/[^A-Z2-9]/g, '');
    if (!roomId) return toast('請輸入團本房號。');
    state.actionBusy = true;
    try {
      const payload = await api('/api/raid/join', { body: { roomId } });
      enterRoom(payload.room);
    } catch (error) {
      console.error('[Raid] join room failed:', error);
      toast(error.message);
    } finally { state.actionBusy = false; }
  }

  async function resumeRoom(code = savedRoom()) {
    const roomId = String(code || '').trim().toUpperCase();
    if (!roomId || state.actionBusy) return;
    state.actionBusy = true;
    try {
      const payload = await api('/api/raid/state?roomId=' + encodeURIComponent(roomId), { method: 'GET' });
      enterRoom(payload.room);
      if (payload.room?.status === 'active' && payload.room?.members?.[uid()]?.activeQuestionId) {
        void requestQuestion();
      }
    } catch (error) {
      persistRoom('');
      toast('先前的團本已結束或無法重新連線。');
      renderHub();
    } finally { state.actionBusy = false; }
  }

  function enterRoom(room) {
    if (!room?.id) return;
    state.room = room;
    persistRoom(room.id);
    state.scope = resolveBattleKnowledge(snapshotBattleKnowledge(data()), snapshotBattleKnowledge(data()));
    updateBusyClass();
    startRoomTimers();
    routeRoom();
    updateHomeEntry();
  }

  function routeRoom() {
    const room = state.room;
    if (!room) return renderHub();
    if (room.status === 'waiting') return renderLobby();
    if (room.status === 'active') {
      if (state.question) {
        updateLiveLabels();
        return;
      }
      renderArena();
      if (me()?.activeQuestionId) void requestQuestion();
      return;
    }
    if (room.status === 'won' || room.status === 'lost') return renderResult();
    renderHub();
  }

  function renderLobby() {
    show('lobby');
    updateBusyClass();
    const room = state.room;
    const mine = me();
    const team = activeMembers();
    const allReady = team.length > 0 && team.every(row => row.ready === true);
    const lobby = document.getElementById('raid-lobby');
    lobby.innerHTML =
      '<header class="raid-heading"><button class="raid-back" type="button" data-leave><i class="fa-solid fa-arrow-left"></i></button>' +
      '<div><small>RAID LOBBY ／ 集結</small><h2>清霜試煉隊伍</h2><p>房號 <b>' + escapeHtml(room.id) + '</b>・' + team.length + ' / 4 人</p></div><span class="raid-seal">集</span></header>' +
      '<div class="raid-lobby-shell"><section class="raid-room-code"><span>團本房號</span><strong>' + escapeHtml(room.id) + '</strong>' +
      '<div><button class="raid-ghost" type="button" data-copy>複製房號</button><button class="raid-ghost" type="button" data-invite>邀請線上好友</button></div></section>' +
      '<section class="raid-party-grid">' + team.map((row) => memberCard(row, room.leaderUid)).join('') +
      Array.from({ length: Math.max(0, 4 - team.length) }, () => '<article class="raid-member-card empty"><i class="fa-solid fa-user-plus"></i><span>等待修士加入</span></article>').join('') +
      '</section><section class="raid-lobby-note"><i class="fa-solid fa-infinity"></i><div><b>題目沒有倒數</b><span>所有人可用自己的速度作答；開戰後 Boss 仍固定每 18 秒攻擊全隊。</span></div></section>' +
      '<div class="raid-lobby-actions"><button class="' + (mine?.ready ? 'raid-ghost' : 'raid-primary') + '" type="button" data-ready>' +
      (mine?.ready ? '取消準備' : '準備完成') + '</button>' +
      (isLeader() ? '<button class="raid-primary" type="button" data-start ' + (allReady ? '' : 'disabled') + '>開始討伐</button>' : '<span>等待隊長開始</span>') +
      '</div></div>';
    lobby.querySelector('[data-leave]')?.addEventListener('click', leaveRoom);
    lobby.querySelector('[data-copy]')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(room.id); toast('已複製團本房號 ' + room.id); }
      catch (_) { toast('團本房號：' + room.id); }
    });
    lobby.querySelector('[data-invite]')?.addEventListener('click', inviteOnlineFriends);
    lobby.querySelector('[data-ready]')?.addEventListener('click', () => setReady(!mine?.ready));
    lobby.querySelector('[data-start]')?.addEventListener('click', startBattle);
  }

  function memberCard(row, leaderUid) {
    const online = now() - Number(row.lastSeenAtMs || 0) < ONLINE_MS;
    const image = row.uid === uid() ? portrait() : (row.avatar || '');
    return '<article class="raid-member-card ' + (row.ready ? 'ready' : '') + '">' +
      '<div class="raid-member-avatar">' + (image ? '<img src="' + escapeHtml(image) + '" alt="">' : '<i class="fa-solid fa-user-ninja"></i>') + '</div>' +
      '<div><small>' + (row.uid === leaderUid ? '隊長' : '隊員') + '・' + (online ? '在線' : '連線中斷') + '</small>' +
      '<strong>' + escapeHtml(row.name) + '</strong><span>HP ' + Math.round(row.maxHp).toLocaleString() + '・攻擊 ' + Math.round(row.atk).toLocaleString() + '</span></div>' +
      '<b>' + (row.ready ? '已準備' : '未準備') + '</b></article>';
  }

  async function setReady(ready) {
    if (state.actionBusy || !state.roomId) return;
    state.actionBusy = true;
    try {
      const payload = await api('/api/raid/ready', { body: { roomId: state.roomId, ready } });
      state.room = payload.room;
      renderLobby();
    } catch (error) { toast(error.message); }
    finally { state.actionBusy = false; }
  }

  async function startBattle() {
    if (state.actionBusy || !state.roomId || !isLeader()) return;
    state.actionBusy = true;
    try {
      const payload = await api('/api/raid/start', { body: { roomId: state.roomId } });
      state.room = payload.room;
      state.question = null;
      state.review = null;
      renderArena();
      void requestQuestion();
    } catch (error) { toast(error.message); }
    finally { state.actionBusy = false; }
  }

  function battleIntent(room = state.room) {
    const boss = room?.boss;
    if (!boss) return null;
    return shenIntentForRound({
      round: Number(boss.actionCount || 0) + 1,
      bossHp: boss.hp,
      bossMaxHp: boss.maxHp,
      baseAttack: Math.max(70, Math.round(Number(me(room)?.maxHp || 1000) * .105))
    });
  }

  function renderArena() {
    if (!state.room?.boss) return routeRoom();
    show('arena');
    const room = state.room;
    const boss = room.boss;
    const mine = me();
    const intent = battleIntent(room);
    const arena = document.getElementById('raid-arena');
    arena.innerHTML =
      '<header class="raid-battle-head"><button class="raid-back" type="button" data-leave><i class="fa-solid fa-door-open"></i></button>' +
      '<div><small>清霜試煉・房號 ' + escapeHtml(room.id) + '</small><strong>Boss 行動 ' + boss.actionCount + ' / ' + room.maxBossActions + '</strong></div>' +
      '<span>階段 ' + boss.phase + '・' + phaseName(boss.phase) + '</span></header>' +
      '<div class="raid-stage"><section class="raid-boss-side"><div class="raid-name-row"><div><small>BOSS</small><h3>' + escapeHtml(boss.name) + '</h3></div>' +
      '<b id="raid-boss-hp-text">' + Math.round(boss.hp).toLocaleString() + ' / ' + Math.round(boss.maxHp).toLocaleString() + '</b></div>' +
      '<div class="raid-hp boss"><i id="raid-boss-hp-bar" style="width:' + hpPct(boss.hp, boss.maxHp) + '%"></i></div>' +
      '<div class="raid-boss-portrait"><div class="raid-boss-aura"></div><img src="' + escapeHtml(boss.image) + '" alt="沈清霜"><span>「' + escapeHtml(intent?.name || '試劍') + '」</span></div>' +
      '<div class="raid-intent ' + escapeHtml(intent?.kind || 'normal') + '"><i class="fa-solid fa-khanda"></i><div><b>' + escapeHtml(intent?.name || '試劍') +
      '</b><span>全隊注意：大師姐依固定時鐘出招，不會等待任何人。</span></div><em id="raid-boss-clock">--</em></div></section>' +
      '<section class="raid-player-side"><div class="raid-player-card"><img src="' + portrait() + '" alt="玩家角色"><div><small>你的狀態</small><h3>' +
      escapeHtml(mine?.name || '修士') + '</h3><span>個人輸出 ' + Math.round(mine?.damage || 0).toLocaleString() + '・答對 ' + Math.round(mine?.correct || 0) + ' 題</span></div>' +
      '<b id="raid-player-hp-text">' + Math.round(mine?.hp || 0).toLocaleString() + ' HP</b></div>' +
      '<div class="raid-hp player"><i id="raid-player-hp-bar" style="width:' + hpPct(mine?.hp, mine?.maxHp) + '%"></i></div>' +
      '<div id="raid-team-list" class="raid-team-list">' + teamRows(room) + '</div>' +
      '<button class="raid-primary raid-fight" type="button" data-question ' + (mine?.alive === false ? 'disabled' : '') + '>' +
      (mine?.alive === false ? '已倒下・觀戰中' : mine?.activeQuestionId ? '返回目前題目' : '開始作答') + '</button></section></div>';
    arena.querySelector('[data-leave]')?.addEventListener('click', leaveRoom);
    arena.querySelector('[data-question]')?.addEventListener('click', requestQuestion);
    updateLiveLabels();
  }

  function teamRows(room = state.room) {
    const rows = activeMembers(room).sort((a, b) => Number(b.damage || 0) - Number(a.damage || 0));
    return rows.map((row) =>
      '<div class="raid-team-row ' + (row.alive === false ? 'down' : '') + '">' +
      '<span><i class="fa-solid ' + (row.alive === false ? 'fa-skull' : 'fa-user-shield') + '"></i>' + escapeHtml(row.name) + '</span>' +
      '<b>' + Math.round(row.hp || 0).toLocaleString() + ' HP</b><em>' + Math.round(row.damage || 0).toLocaleString() + ' DMG</em></div>'
    ).join('');
  }

  async function requestQuestion() {
    if (state.requestBusy || !isActive() || me()?.alive === false) return;
    state.requestBusy = true;
    try {
      if (!state.scope) state.scope = resolveBattleKnowledge(snapshotBattleKnowledge(data()), snapshotBattleKnowledge(data()));
      const round = Math.max(1, Number(me()?.answered || 0) + 1);
      const selected = pickBattleKnowledge(state.scope, round);
      const payload = await api('/api/raid/question', {
        body: {
          roomId: state.roomId,
          request: {
            subject: selected.subject,
            level: selected.level,
            specificTopic: selected.specificTopic || selected.topic,
            difficulty: selected.difficulty || 'medium'
          }
        }
      });
      state.question = payload.question;
      state.review = null;
      renderQuestion();
    } catch (error) {
      if (error.status === 429) toast('招式尚在收束，讀完解析後再出下一題。');
      else toast(error.message);
      if (!state.question) renderArena();
    } finally { state.requestBusy = false; }
  }

  function renderQuestion() {
    const q = state.question;
    if (!q) return renderArena();
    show('question');
    const review = state.review;
    const view = document.getElementById('raid-question');
    const opts = q.opts.map((option, i) => {
      let cls = '';
      if (review && i === review.correctIndex) cls = ' correct';
      else if (review && i === review.selectedChoice && !review.correct) cls = ' wrong';
      return '<button class="raid-option' + cls + '" type="button" data-choice="' + i + '" ' + (review ? 'disabled' : '') + '><span>' +
        String.fromCharCode(65 + i) + '</span><b>' + rich(option) + '</b></button>';
    }).join('');
    const explanation = review ?
      '<div class="raid-explain ' + (review.correct ? 'correct' : 'wrong') + '"><b>' +
      (review.correct ? '答對・造成 ' + Math.round(review.damage || 0).toLocaleString() + ' 傷害' : '答錯・本次沒有形成攻勢') +
      '</b><p>' + rich(review.explanation || '') + '</p><button class="raid-primary" type="button" data-next>下一題</button>' +
      '<button class="raid-ghost" type="button" data-arena>先看戰場</button></div>' : '';
    view.innerHTML =
      '<div class="raid-question-shell"><header><div><small>' + escapeHtml(q.subject || '') + '・' + escapeHtml(q.level || '') +
      '</small><strong>' + escapeHtml(q.topic || '團本題目') + '</strong></div><span class="raid-no-timer"><i class="fa-solid fa-infinity"></i> 不限時</span></header>' +
      '<div class="raid-question-boss"><img src="' + RAID_MVP.bossImage + '" alt="沈清霜"><span id="raid-question-boss-clock">Boss 行動倒數</span></div>' +
      '<h2>' + rich(q.q) + '</h2><div class="raid-options">' + opts + '</div>' + explanation + '</div>';
    typeset(view);
    if (!review) {
      view.querySelectorAll('[data-choice]').forEach((button) => {
        button.addEventListener('click', () => answerQuestion(Number(button.dataset.choice)));
      });
    } else {
      view.querySelector('[data-next]')?.addEventListener('click', () => {
        state.question = null;
        state.review = null;
        void requestQuestion();
      });
      view.querySelector('[data-arena]')?.addEventListener('click', () => {
        state.question = null;
        state.review = null;
        renderArena();
      });
    }
    updateLiveLabels();
  }

  async function answerQuestion(selectedChoice) {
    if (state.actionBusy || !state.question || state.review) return;
    state.actionBusy = true;
    try {
      const payload = await api('/api/raid/answer', {
        body: { roomId: state.roomId, questionId: state.question.id, selectedChoice }
      });
      state.room = payload.room;
      state.review = {
        selectedChoice,
        correct: payload.correct === true,
        correctIndex: payload.correctIndex,
        explanation: payload.explanation,
        damage: payload.damage
      };
      if (state.room.status === 'won' || state.room.status === 'lost') {
        state.question = null;
        state.review = null;
        return renderResult();
      }
      renderQuestion();
    } catch (error) {
      toast(error.message);
    } finally { state.actionBusy = false; }
  }

  function updateLiveLabels() {
    const room = state.room;
    if (!room?.boss) return;
    const boss = room.boss;
    const mine = me(room);
    const remaining = Math.max(0, Number(boss.nextActionAtMs || 0) - now());
    const telegraph = remaining <= Number(room.bossTelegraphMs || 5000);
    const bossClock = document.getElementById('raid-boss-clock');
    const questionBossClock = document.getElementById('raid-question-boss-clock');
    if (bossClock) {
      bossClock.textContent = (remaining / 1000).toFixed(1) + ' 秒';
      bossClock.closest('.raid-intent')?.classList.toggle('danger', telegraph);
    }
    if (questionBossClock) {
      questionBossClock.textContent = telegraph ?
        '警告：Boss ' + (remaining / 1000).toFixed(1) + ' 秒後出招' :
        'Boss ' + (remaining / 1000).toFixed(1) + ' 秒後行動・題目本身不限時';
    }
    const bossHp = document.getElementById('raid-boss-hp-text');
    const bossBar = document.getElementById('raid-boss-hp-bar');
    const playerHp = document.getElementById('raid-player-hp-text');
    const playerBar = document.getElementById('raid-player-hp-bar');
    if (bossHp) bossHp.textContent = Math.round(boss.hp).toLocaleString() + ' / ' + Math.round(boss.maxHp).toLocaleString();
    if (bossBar) bossBar.style.width = hpPct(boss.hp, boss.maxHp) + '%';
    if (playerHp) playerHp.textContent = Math.round(mine?.hp || 0).toLocaleString() + ' HP';
    if (playerBar) playerBar.style.width = hpPct(mine?.hp, mine?.maxHp) + '%';
    const team = document.getElementById('raid-team-list');
    if (team) team.innerHTML = teamRows(room);
    if (isActive() && remaining <= 0) void tickBoss();
  }

  async function tickBoss() {
    if (state.tickBusy || !state.roomId || !isActive()) return;
    state.tickBusy = true;
    try {
      const payload = await api('/api/raid/tick', { body: { roomId: state.roomId } });
      state.room = payload.room;
      if (payload.actions?.length) {
        const last = payload.actions[payload.actions.length - 1];
        const hit = last?.hit?.[uid()];
        if (hit?.guarded) toast('道心護體擋下「' + last.name + '」');
        else if (hit) toast('大師姐「' + last.name + '」造成 ' + Math.round(hit.damage || 0).toLocaleString() + ' 傷害');
      }
      if (state.room?.status === 'won' || state.room?.status === 'lost') {
        state.question = null;
        state.review = null;
        renderResult();
      } else updateLiveLabels();
    } catch (error) {
      console.warn('[Raid] boss tick delayed:', error?.message || error);
    } finally { state.tickBusy = false; }
  }

  async function pollRoom() {
    if (!state.roomId) return;
    try {
      const payload = await api('/api/raid/state?roomId=' + encodeURIComponent(state.roomId), { method: 'GET' });
      const previousStatus = state.room?.status;
      state.room = payload.room;
      updateBusyClass();
      if (state.room.status !== previousStatus || state.room.status === 'waiting') routeRoom();
      else if (state.room.status === 'active') {
        if (me()?.alive === false && state.question) {
          state.question = null;
          state.review = null;
          renderArena();
        } else updateLiveLabels();
      } else routeRoom();
    } catch (error) {
      if (error.status === 404 || error.status === 403) {
        stopRoomTimers();
        persistRoom('');
        state.room = null;
        toast('團本房間已結束。');
        renderHub();
      }
    }
  }

  async function heartbeat() {
    if (!state.roomId || !state.room || !['waiting', 'active'].includes(state.room.status)) return;
    try {
      const payload = await api('/api/raid/heartbeat', { body: { roomId: state.roomId } });
      state.room = payload.room;
    } catch (_) {}
  }

  function startRoomTimers() {
    stopRoomTimers();
    state.pollTimer = setInterval(pollRoom, POLL_MS);
    state.heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
    state.liveTimer = setInterval(updateLiveLabels, 100);
  }

  function stopRoomTimers() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    if (state.liveTimer) clearInterval(state.liveTimer);
    state.pollTimer = state.heartbeatTimer = state.liveTimer = null;
  }

  async function leaveRoom() {
    if (!state.roomId || state.actionBusy) return;
    if (state.room?.status === 'active' && !window.confirm('離開後本場會視為倒下，確定退出團本？')) return;
    state.actionBusy = true;
    try { await api('/api/raid/leave', { body: { roomId: state.roomId } }); }
    catch (error) { console.warn('[Raid] leave:', error?.message || error); }
    finally {
      stopRoomTimers();
      persistRoom('');
      state.room = null;
      state.question = null;
      state.review = null;
      state.reward = null;
      state.actionBusy = false;
      renderHub();
    }
  }

  function renderResult() {
    stopRoomTimers();
    updateBusyClass();
    show('result');
    const room = state.room;
    const won = room?.status === 'won';
    const rows = activeMembers(room).sort((a, b) => Number(b.damage || 0) - Number(a.damage || 0));
    const result = document.getElementById('raid-result');
    result.innerHTML =
      '<div class="raid-result-card ' + (won ? 'win' : 'loss') + '"><span class="raid-result-seal">' + (won ? '破' : '止') + '</span>' +
      '<small>SHEN QINGSHUANG RAID</small><h2>' + (won ? '試煉突破' : '討伐失敗') + '</h2><p>' +
      (won ? '「配合得還行。下次試著更俐落一點。」' : '「十二式之前沒能破陣。整隊再來。」') + '</p>' +
      '<img src="' + RAID_MVP.bossImage + '" alt="沈清霜"><div class="raid-result-board">' +
      rows.map((row, index) => '<div><span>#' + (index + 1) + ' ' + escapeHtml(row.name) + '</span><b>' +
        Math.round(row.damage || 0).toLocaleString() + ' 傷害</b><em>' + Math.round(row.correct || 0) + ' / ' + Math.round(row.answered || 0) + ' 題</em></div>').join('') +
      '</div>' +
      (won ? '<div class="raid-reward-box"><i class="fa-solid fa-gem"></i><div><b>團本專屬煉器素材</b><span>' +
        SECOND_KEY_NAME + '必定 ×1；' + THIRD_KEY_NAME + '有 25% 機率 ×1。每位參戰者各自結算且每房僅能領一次。</span></div></div>' : '') +
      '<div id="raid-reward-result"></div><div class="raid-result-actions"><button class="raid-ghost" type="button" data-home>返回仙府</button>' +
      (won ? '<button class="raid-primary" type="button" data-claim>' + (state.reward ? '獎勵已領取' : '領取團本獎勵') + '</button>' : '') +
      '<button class="raid-primary" type="button" data-again>再次集結</button></div></div>';
    result.querySelector('[data-home]')?.addEventListener('click', () => {
      persistRoom('');
      state.room = null;
      state.reward = null;
      window.switchToPage?.('page-home');
      updateHomeEntry();
    });
    result.querySelector('[data-claim]')?.addEventListener('click', claimReward);
    result.querySelector('[data-again]')?.addEventListener('click', () => {
      persistRoom('');
      state.room = null;
      state.reward = null;
      renderHub();
    });
    renderRewardMessage();
  }

  function renderRewardMessage() {
    const node = document.getElementById('raid-reward-result');
    if (!node || !state.reward) return;
    const second = Number(state.reward['raid-refine-key-2'] || 0);
    const third = Number(state.reward['raid-refine-key-3'] || 0);
    node.innerHTML = '<div class="raid-reward-received"><b>已收入背包</b><span>' + SECOND_KEY_NAME + ' ×' + second +
      (third ? '・' + THIRD_KEY_NAME + ' ×' + third : '・本次未取得 ' + THIRD_KEY_NAME) + '</span></div>';
  }

  async function claimReward() {
    if (state.rewardBusy || !state.roomId || state.room?.status !== 'won') return;
    state.rewardBusy = true;
    try {
      const payload = await api('/api/raid/claim', { body: { roomId: state.roomId } });
      state.reward = payload.reward || {};
      if (payload.materialSystem) {
        const local = data();
        local.materialSystem = payload.materialSystem;
        window.dispatchEvent(new CustomEvent('material-system-updated', { detail: payload.materialSystem }));
        window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', { detail: { raidRewardClaimed: true } }));
      }
      renderRewardMessage();
      const button = document.querySelector('#raid-result [data-claim]');
      if (button) { button.textContent = '獎勵已領取'; button.disabled = true; }
    } catch (error) { toast(error.message); }
    finally { state.rewardBusy = false; }
  }

  async function inviteOnlineFriends() {
    if (!state.roomId || !isLeader() || state.room?.status !== 'waiting') return;
    if (state.invitedRoomId === state.roomId) return toast('本房間已送出一輪好友邀請。');
    const user = authUser();
    const friendIds = [...new Set((data()?.friends || []).filter((id) => typeof id === 'string' && id !== user?.uid))].slice(0, 30);
    if (!user || !friendIds.length) return toast('目前沒有可邀請的好友。');
    state.invitedRoomId = state.roomId;
    try {
      const records = await Promise.all(friendIds.map((id) => getDoc(doc(database(), 'users', id)).catch(() => null)));
      const cutoff = now() - 5 * 60 * 1000;
      const online = records.filter((snap) => snap?.exists() && (() => {
        const value = snap.data()?.lastActive;
        const ms = value && typeof value.toMillis === 'function' ? value.toMillis() : Number(value) || 0;
        return ms > cutoff;
      })());
      if (!online.length) return toast('目前沒有在線好友。');
      await Promise.all(online.map((snap) => addDoc(collection(database(), 'users', snap.id, 'raidInvitations'), {
        kind: 'raid',
        roomId: state.roomId,
        bossId: 'shen-qingshuang',
        hostUid: user.uid,
        hostName: data()?.displayName || user.displayName || '修士',
        timestamp: serverTimestamp()
      }).catch((error) => console.warn('[Raid] invite skipped:', snap.id, error))));
      toast('已邀請 ' + online.length + ' 位在線好友。');
    } catch (error) {
      state.invitedRoomId = '';
      toast('好友邀請暫時無法送出。');
    }
  }

  function listenRaidInvitations() {
    if (state.inviteUnsub || !uid()) return;
    try {
      state.inviteUnsub = onSnapshot(collection(database(), 'users', uid(), 'raidInvitations'), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type !== 'added') return;
          const invite = change.doc.data() || {};
          const stamp = invite.timestamp;
          const ms = stamp && typeof stamp.toMillis === 'function' ? stamp.toMillis() : 0;
          if (invite.kind !== 'raid' || !invite.roomId || (ms && ms < state.inviteBootAtMs - 30000)) return;
          showRaidInvite(invite, change.doc.id);
        });
      }, (error) => console.warn('[Raid] invite listener unavailable:', error?.message || error));
    } catch (error) {
      console.warn('[Raid] invite listener setup failed:', error?.message || error);
    }
  }

  function showRaidInvite(invite, inviteId) {
    if (document.querySelector('[data-raid-invite="' + CSS.escape(inviteId) + '"]')) return;
    const container = document.getElementById('toast-container') || document.body;
    const card = document.createElement('div');
    card.className = 'raid-invite-toast';
    card.dataset.raidInvite = inviteId;
    card.innerHTML = '<i class="fa-solid fa-users-rays"></i><div><small>秘境集結</small><b>' +
      escapeHtml(invite.hostName || '好友') + ' 邀請你挑戰大師姐</b><span>房號 ' + escapeHtml(invite.roomId) + '</span></div>' +
      '<button type="button" data-accept>加入</button><button type="button" data-close>×</button>';
    container.appendChild(card);
    card.querySelector('[data-accept]')?.addEventListener('click', () => {
      card.remove();
      window.switchToPage?.(PAGE_ID);
      void joinRoom(invite.roomId);
    });
    card.querySelector('[data-close]')?.addEventListener('click', () => card.remove());
    setTimeout(() => card.remove(), 30000);
  }

  function openHub() {
    ensurePage();
    window.switchToPage?.(PAGE_ID);
    if (state.room) return routeRoom();
    const saved = savedRoom();
    if (saved) return void resumeRoom(saved);
    renderHub();
  }

  window.openRaidHub = openHub;
  window.startShenRaid = createRoom;
  window.getRaidMvpState = function () {
    return {
      modeVersion: 2,
      status: state.room?.status || 'hub',
      roomId: state.roomId || null,
      bossId: state.room?.boss?.id || RAID_MVP.bossId,
      bossHp: state.room?.boss?.hp ?? null,
      playerHp: me()?.hp ?? null,
      playerActionCount: me()?.answered || 0,
      bossActionCount: state.room?.boss?.actionCount || 0,
      asynchronousQuestions: true,
      noQuestionTimer: true,
      multiplayer: true,
      prototype: false
    };
  };

  function boot() {
    ensureStyle();
    ensurePage();
    mountHomeEntry();
    renderHub();
    listenRaidInvitations();
    window.addEventListener('xiuxian:user-ready', () => {
      mountHomeEntry();
      updateHomeEntry();
      listenRaidInvitations();
    });
    window.addEventListener('xiuxian:stats-updated', updateHomeEntry);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
