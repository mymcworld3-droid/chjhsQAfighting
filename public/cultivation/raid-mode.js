import { RAID_MVP, shenPhaseForHp, shenIntentForRound, bossClockState } from './raid-engine.js';
import { resolvePlayerAvatar } from './profile-avatar.js';
import { snapshotBattleKnowledge, resolveBattleKnowledge } from './battle-question-scope.js';
import { generateRaidQuestion } from './raid-question.js';
import {
  ensureRaidRoomAuth, getRaidTicketState, createRaidRoom, findOrCreateRaidRoom, joinRaidRoomByCode, reconnectRaidRoom,
  setRaidReady, startRaidRoom, subscribeRaidRoom, heartbeatRaidRoom, commitRaidPlayerAction,
  commitRaidBossDefense, advanceRaidBossAction, leaveRaidRoom, raidRoomMembers, raidMemberOnline
} from './raid-room.js';
import { playerRepository } from './data/player-repository.js';
import { renderRaidLoot, renderRaidLearning } from './raid-loot-view.js';
import { rewardRepository } from './data/reward-repository.js';
import { RAID_TRIALS, raidTrialById } from './raid-catalog.js';

(function () {
  'use strict';

  const PAGE_ID = 'page-raid';
  const STYLE_HREF = 'styles/raid-mode.css?v=20261003-stable-session1';
  const MALE = 'assets/story/characters/player-male-determined.png';
  const FEMALE = 'assets/story/characters/player-female-determined.png';
  const HEARTBEAT_MS = 8000;

  const state = {
    status: 'hub',
    runId: '',
    player: null,
    boss: null,
    scope: null,
    question: null,
    pendingQuestion: null,
    history: [],
    questionIssuedAtMs: 0,
    questionResolvedAtMs: 0,
    nextQuestionAtMs: 0,
    selectedChoice: null,
    answerCorrect: null,
    playerActionCount: 0,
    bossStartedAtMs: 0,
    bossActionCount: 0,
    lastBossAction: null,
    lastPlayerAction: null,
    tickTimer: null,
    questionLoading: false,
    roomId: '',
    room: null,
    roomUnsub: null,
    heartbeatTimer: null,
    lastBossActionSeen: 0,
    applyingBossAction: false,
    advancingBossAction: false,
    battleSceneToken: 0,
    battleScenePlaying: false,
    battleSceneTail: null,
    pendingFinishRoom: null,
    reconnectTried: false,
    invitedRoomId: '',
    inviteCooldownUntil: 0,
    rewardClaiming: false,
    rewardClaimedRoomId: '',
    learningOutcome: null,
    selectedRaidId: RAID_MVP.bossId,
    ticketState: { count:null, dailyGrant:3, cap:10, lastGrantDate:'' },
    ticketLoading: false
  };

  function now() { return Date.now(); }
  async function refreshRaidTickets({ rerender = true } = {}) {
    if (state.ticketLoading) return state.ticketState;
    state.ticketLoading = true;
    try {
      const next = await getRaidTicketState();
      if (next) state.ticketState = {
        count: Math.max(0, Number(next.count) || 0),
        dailyGrant: Math.max(0, Number(next.dailyGrant) || 3),
        cap: Math.max(1, Number(next.cap) || 10),
        lastGrantDate: String(next.lastGrantDate || '')
      };
      if (rerender && state.status === 'hub' && !state.roomId) renderHub();
    } catch (error) {
      console.warn('[Raid] ticket status unavailable:', error);
    } finally {
      state.ticketLoading = false;
    }
    return state.ticketState;
  }
  function data() { return window.getCurrentUserData?.() || {}; }
  function score() { return Math.max(0, Number(data()?.stats?.totalScore) || 0); }
  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function rich(value) { return (window.quizMathRichText || escapeHtml)(String(value ?? '')); }
  function typeset(el) { window.quizMathTypeset?.(el); }
  function randomId() {
    if (globalThis.crypto?.randomUUID) return 'shen-raid-' + crypto.randomUUID();
    return 'shen-raid-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  }
  function toast(message) {
    document.getElementById('raid-toast')?.remove();
    const el = document.createElement('div');
    el.id = 'raid-toast';
    el.className = 'raid-toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2800);
  }
  function showCorrectAnswerFeedback(detail = '攻勢命中') {
    document.getElementById('raid-correct-feedback')?.remove();
    const el = document.createElement('div');
    el.id = 'raid-correct-feedback';
    el.className = 'raid-correct-feedback';
    el.innerHTML = '<span aria-hidden="true">✓</span><div><strong>答對</strong><small>' +
      escapeHtml(detail) + '</small></div>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    window.setTimeout(function () {
      el.classList.remove('show');
      window.setTimeout(function () { el.remove(); }, 220);
    }, 1350);
  }
  function storyOpen() {
    return !!document.querySelector('#xiuxian-story-layer,#newbie-tutorial-layer,#battle-tutorial-layer,#golden-core-tutorial-layer,#dongtian-overlay');
  }
  function ensureStyle() {
    const existing = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .find(link => String(link.getAttribute('href') || '').includes('styles/raid-mode.css'));
    if (existing?.getAttribute('href') === STYLE_HREF) return;
    existing?.remove();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = STYLE_HREF;
    document.head.appendChild(link);
  }
  let raidHubFitFrame = 0;

  function fitRaidHubToNavigation() {
    const hub = document.getElementById('raid-hub');
    const card = hub?.querySelector?.('.raid-boss-card');
    const nav = document.getElementById('bottom-nav');
    if (!hub || hub.classList.contains('hidden') || !card || !nav) return;
    const navRect = nav.getBoundingClientRect?.();
    const cardRect = card.getBoundingClientRect?.();
    const navTop = Number(navRect?.top) || 0;
    const cardTop = Number(cardRect?.top) || 0;
    if (!(navTop > cardTop && cardTop > 0)) return;
    const targetHeight = Math.max(180, Math.floor(navTop - cardTop - 8));
    card.style.setProperty('height', targetHeight + 'px', 'important');
    card.style.setProperty('max-height', targetHeight + 'px', 'important');
  }

  function scheduleRaidHubFit() {
    cancelAnimationFrame(raidHubFitFrame);
    raidHubFitFrame = requestAnimationFrame(() => {
      raidHubFitFrame = requestAnimationFrame(() => {
        syncRaidBottomClearance();
        fitRaidHubToNavigation();
      });
    });
  }

  function syncRaidBottomClearance() {
    const page = document.getElementById(PAGE_ID);
    const nav = document.getElementById('bottom-nav');
    if (!page) return;
    const vv = window.visualViewport;
    const visualHeight = Math.max(1, Number(vv?.height) || Number(window.innerHeight) || document.documentElement.clientHeight || 1);
    const visualWidth = Math.max(1, Number(vv?.width) || Number(window.innerWidth) || document.documentElement.clientWidth || 1);
    const visualTop = Math.max(0, Number(vv?.offsetTop) || 0);
    const visualLeft = Math.max(0, Number(vv?.offsetLeft) || 0);
    const sessionFullscreen = page.classList.contains('active-page') && !page.classList.contains('hidden') &&
      ['arena', 'question'].includes(page.dataset.raidView);

    // Questions and combat share one viewport throughout the session. Switching
    // to an attack changes content, never the page's size or position.
    if (sessionFullscreen) {
      page.style.setProperty('--raid-header-height', '0px');
      page.style.setProperty('--raid-bottom-clearance', '0px');
      page.style.setProperty('--raid-page-height', Math.floor(visualHeight) + 'px');
      page.style.setProperty('top', visualTop + 'px', 'important');
      page.style.setProperty('left', visualLeft + 'px', 'important');
      page.style.setProperty('width', Math.floor(visualWidth) + 'px', 'important');
      page.style.setProperty('max-width', Math.floor(visualWidth) + 'px', 'important');
      page.style.setProperty('height', Math.floor(visualHeight) + 'px', 'important');
      page.style.setProperty('max-height', Math.floor(visualHeight) + 'px', 'important');
      page.style.setProperty('bottom', 'auto', 'important');
      page.style.setProperty('transform', 'none', 'important');
      document.body.classList.add('raid-fullscreen');
      return;
    }
    document.body.classList.remove('raid-fullscreen');

    // Hub, lobby and results retain the centered layout below the app header.
    page.style.removeProperty('left');
    page.style.removeProperty('width');
    page.style.removeProperty('max-width');
    page.style.removeProperty('transform');

    const appHeader = document.querySelector('body > header');
    const headerRect = appHeader?.getBoundingClientRect?.();
    const headerBottom = Math.max(0, Math.ceil(Number(headerRect?.bottom) || Number(headerRect?.height) || 72));
    const sessionActive = document.body.classList.contains('raid-session-active');

    const navTop = Math.max(0, Number(nav?.getBoundingClientRect?.().top) || 0);
    const clearance = navTop > 0 && visualHeight > navTop
      ? Math.ceil(visualHeight - navTop + 8)
      : 116;
    const pageHeight = Math.max(180, Math.floor(
      visualHeight - headerBottom - (sessionActive ? 0 : clearance)
    ));

    page.style.setProperty('--raid-header-height', headerBottom + 'px');
    page.style.setProperty('--raid-bottom-clearance', clearance + 'px');
    page.style.setProperty('--raid-page-height', pageHeight + 'px');
    page.style.setProperty('top', headerBottom + 'px', 'important');
    page.style.setProperty('height', pageHeight + 'px', 'important');
    page.style.setProperty('max-height', pageHeight + 'px', 'important');
    page.style.setProperty('bottom', 'auto', 'important');
  }

  function setRaidCombatFocus(active) {
    document.documentElement.classList.toggle('raid-combat-focus', !!active);
    document.body.classList.toggle('raid-combat-focus', !!active);
    syncRaidBottomClearance();
    if (active) {
      requestAnimationFrame(syncRaidBottomClearance);
    }
  }

  function syncRaidViewportLock() {
    const page = document.getElementById(PAGE_ID);
    const active = !!page?.classList.contains('active-page') && !page.classList.contains('hidden');
    document.documentElement.classList.toggle('raid-page-open', active);
    document.body.classList.toggle('raid-page-open', active);
    if (!active) document.body.classList.remove('raid-fullscreen');
    const entered = active && !page.dataset.raidViewportActive;
    if (page) page.dataset.raidViewportActive = active ? '1' : '';
    if (active) {
      syncRaidBottomClearance();
      // The raid is a viewport surface, not part of the document's scroll flow.
      // Reset any inherited page offset so fixed header/navigation never move with raid content.
      if (entered) {
        try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); }
        catch (_) { window.scrollTo?.(0, 0); }
      }
    }
  }

  function ensurePage() {
    let page = document.getElementById(PAGE_ID);
    if (!page) {
      page = document.createElement('div');
      page.id = PAGE_ID;
      page.className = 'page-section hidden raid-page';
      document.querySelector('main')?.appendChild(page);
    }
    if (!page.dataset.raidMvp) {
      page.dataset.raidMvp = '2';
      page.innerHTML = '<section id="raid-hub" class="raid-view"></section>' +
        '<section id="raid-lobby" class="raid-view hidden"></section>' +
        '<section id="raid-arena" class="raid-view hidden"></section>' +
        '<section id="raid-question" class="raid-view raid-question-view hidden"></section>' +
        '<section id="raid-result" class="raid-view hidden"></section>';
    }
    if (!page.dataset.raidViewportObserver) {
      page.dataset.raidViewportObserver = '1';
      new MutationObserver(syncRaidViewportLock).observe(page, {
        attributes: true,
        attributeFilter: ['class']
      });
    }
    syncRaidViewportLock();
    return page;
  }
  function show(name, { transition = true } = {}) {
    const page = ensurePage();
    const previous = page.querySelector('#raid-' + page.dataset.raidView);
    const next = page.querySelector('#raid-' + name);
    const theme = name === 'result' ? 'raidResult' : name === 'question' ? 'scroll' : 'raid';
    const finishTransition = transition && previous !== next ? window.beginSceneTransition?.(previous, next, theme, 'raid-phase') : null;
    ['hub', 'lobby', 'arena', 'question', 'result'].forEach(function (id) {
      page.querySelector('#raid-' + id)?.classList.toggle('hidden', id !== name);
    });
    page.dataset.raidView = name;
    syncRaidBottomClearance();
    finishTransition?.();
  }
  function portrait() { return data().storyProgressV1?.gender === 'female' ? FEMALE : MALE; }
  function hpPct(hp, maxHp) {
    return Math.max(0, Math.min(100, (Math.max(0, Number(hp) || 0) / Math.max(1, Number(maxHp) || 1)) * 100));
  }
  function phaseName(phase) { return phase === 1 ? '試劍' : phase === 2 ? '霜意漸盛' : '清霜無聲'; }
  function myRoomMember() { return state.room?.members?.[state.player?.uid] || null; }
  function isHost() { return state.room?.hostUid && state.room.hostUid === state.player?.uid; }

  function snapshotPlayer() {
    const row = data();
    const combat = window.getCombatStats?.() || window.getCombatStatDefaults?.() || { attack: 200, maxHp: 1000 };
    const maxHp = Math.max(1, Math.round(Number(combat.maxHp) || 1000));
    const core = window.getEquippedGoldenCoreBattleSnapshot?.() || null;
    const soul = window.getNascentSoulBattleSnapshot?.() || null;
    const artifact = window.getArtifactBattleSnapshot?.() || { version: 1, effects: [], openingShield: 0 };
    const openingShield = window.getArtifactBattleOpeningShield?.(artifact) ?? artifact.openingShield ?? 0;
    return {
      uid: String(row.uid || 'raid-player'),
      name: row.displayName || row.profile?.displayName || '無名修士',
      totalScore: Math.max(0, Number(row.stats?.totalScore) || 0),
      rankLevel: Math.max(0, Number(row.stats?.rankLevel) || 0),
      combatPower: Math.max(0, Math.round(Number(window.getCombatPower?.().total) || 0)),
      atk: Math.max(1, Math.round(Number(combat.attack) || 200)),
      hp: maxHp,
      maxHp,
      portrait: portrait(),
      goldenCore: core,
      nascentSoul: soul ? {
        talent: soul.talent || null,
        type: soul.type,
        bonusDamage: Math.max(0, Math.min(1000, Math.round(Number(soul.bonusDamage) || 0))),
        reductionFlat: Math.max(0, Math.min(1000, Math.round(Number(soul.reductionFlat) || 0))),
        coreHeal: Math.max(0, Math.min(1000, Math.round(Number(soul.coreHeal) || 0)))
      } : null,
      coreShield: !!core && row.stats?.goldenCoreShield === true,
      coreCorrectStreak: 0,
      artifactBattle: artifact,
      artifactShield: Math.max(0, Math.round(Number(openingShield) || 0)),
      artifactFirstHitUsed: false,
      artifactCheatDeathUsed: false,
      knowledge: snapshotBattleKnowledge(row)
    };
  }

  function mountHomeEntry() {
    if (document.getElementById('raid-home-entry')) return;
    const anchor = document.querySelector('#page-home .home-stats');
    if (!anchor) return;
    const button = document.createElement('button');
    button.id = 'raid-home-entry';
    button.type = 'button';
    button.className = 'raid-home-entry';
    button.innerHTML = '<span class="raid-home-emblem"><i class="fa-solid fa-users-rays"></i></span>' +
      '<span class="raid-home-copy"><small>秘境集結 ／ RAID</small><strong>秘境試煉</strong><em>選擇團本・建議 3 人同行</em></span>' +
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
    if (hint) hint.textContent = locked ? '築基初期（' + RAID_MVP.minimumScore + ' 修為）開放' :
      (state.roomId ? '秘境隊伍進行中' : '選擇團本・建議 3 人同行');
  }

  function renderHub() {
    state.status = state.roomId ? state.status : 'hub';
    document.body.classList.remove('raid-session-active');
    show('hub');
    const selected = raidTrialById(state.selectedRaidId);
    const noTickets = Number(state.ticketState?.count) === 0;
    const selectedLocked = selected.status !== 'open' || score() < selected.minimumScore || noTickets;
    const hub = document.getElementById('raid-hub');
    const trialCards = RAID_TRIALS.map(function (trial) {
      const active = trial.id === selected.id;
      const lockedByRealm = score() < trial.minimumScore;
      const sealed = trial.status !== 'open';
      return '<button type="button" class="raid-trial-card ' + (active ? 'active ' : '') + (sealed ? 'sealed ' : '') +
        '" data-raid-trial="' + escapeHtml(trial.id) + '">' +
        '<span class="raid-trial-icon">' + (trial.bossImage ? '<img src="' + escapeHtml(trial.bossImage) + '" alt="">' :
          '<i class="fa-solid fa-lock"></i>') + '</span><span class="raid-trial-copy"><small>' +
        escapeHtml(sealed ? '封印中' : (lockedByRealm ? '境界未達' : '可挑戰')) + '</small><strong>' +
        escapeHtml(trial.title) + '</strong><em>' + escapeHtml(trial.recommended) + '</em></span></button>';
    }).join('');

    let detail = '';
    if (selected.status !== 'open') {
      detail = '<article class="raid-boss-card locked raid-future-card"><div class="raid-boss-art raid-future-art"><div class="raid-future-seal"><i class="fa-solid fa-lock"></i></div><span>未開放</span></div>' +
        '<div class="raid-boss-info"><div class="raid-badges"><span>' + escapeHtml(selected.party) + '</span><span>' +
        escapeHtml(selected.mechanic) + '</span></div><small>' + escapeHtml(selected.location) + '</small><h3>' +
        escapeHtml(selected.bossTitle) + '</h3><p>' + escapeHtml(selected.description) + '</p>' +
        '<div class="raid-future-drop"><i class="fa-solid fa-gem"></i><span><b>預定獎勵方向</b><small>' +
        selected.rewards.map(escapeHtml).join('・') + '</small></span></div>' +
        '<div class="raid-prototype-note"><i class="fa-solid fa-scroll"></i><span><b>團本列表骨架已完成</b><small>之後新增 Boss 時可直接加入目錄並接上各自的房間、機制與獎勵 adapter。</small></span></div></div></article>';
    } else {
      detail = '<article class="raid-boss-card ' + (selectedLocked ? 'locked' : '') + '">' +
        '<div class="raid-boss-art"><img src="' + escapeHtml(selected.bossImage || RAID_MVP.bossImage) + '" alt="沈清霜"><span>正式試煉・第一境</span></div>' +
        '<div class="raid-boss-info"><div class="raid-badges"><span>' + escapeHtml(selected.party) + '</span><span>' +
        escapeHtml(selected.recommended) + '</span><span>' + escapeHtml(selected.mechanic) + '</span></div>' +
        (data().raidProgress?.['shen-qingshuang']?.memento ? '<small>通關紀念・' + escapeHtml(data().raidProgress['shen-qingshuang'].memento.name) + '</small>' : '') +
        '<small>' + escapeHtml(selected.location) + '</small><h3>' + escapeHtml(selected.bossTitle) + '</h3>' +
        '<p>' + escapeHtml(selected.description) + '</p>' +
        '<div class="raid-reward-preview"><b>主要戰利品</b><span>' + selected.rewards.map(escapeHtml).join('・') + '</span></div>' +
        '<div class="raid-join-grid"><button class="raid-primary" type="button" data-quick ' + (selectedLocked ? 'disabled' : '') + '>快速加入／建立隊伍</button>' +
        '<button class="raid-ghost" type="button" data-create ' + (selectedLocked ? 'disabled' : '') + '>建立私人隊伍</button></div>' +
        '<div class="raid-code-join"><input id="raid-room-code-input" maxlength="6" placeholder="輸入 6 碼隊伍代碼"><button class="raid-ghost" type="button" data-code ' +
        (selectedLocked ? 'disabled' : '') + '>加入隊伍</button></div></div></article>';
    }

    hub.innerHTML = '<header class="raid-heading raid-hub-heading"><button class="raid-back" type="button" data-home><i class="fa-solid fa-arrow-left"></i></button>' +
      '<div class="raid-heading-copy"><small>SECRET REALM ／ 秘境集結</small><h2>秘境試煉</h2><p>選擇試煉後再組隊；每個團本可有獨立 Boss、合作規則與專屬掉落。</p>' +
      '<div class="raid-ticket-status raid-global-ticket"><i class="fa-solid fa-ticket"></i><span><b>團本入場券 ' +
        (state.ticketState?.count == null ? '讀取中' : escapeHtml(state.ticketState.count + ' / ' + state.ticketState.cap)) +
        '</b><small>全團本共用・每日 +3・最多 10 張</small></span></div></div><span class="raid-seal">團</span></header>' +
      '<div class="raid-trial-list" role="list">' + trialCards + '</div>' + detail;

    scheduleRaidHubFit();
    setTimeout(scheduleRaidHubFit, 120);
    setTimeout(scheduleRaidHubFit, 360);
    hub.querySelector('[data-home]')?.addEventListener('click', function () {
      window.switchToPage?.('page-home');
      syncRaidViewportLock();
    });
    hub.querySelectorAll('[data-raid-trial]').forEach(function (button) {
      button.addEventListener('click', function () {
        state.selectedRaidId = button.dataset.raidTrial || RAID_MVP.bossId;
        renderHub();
      });
    });
    if (selected.status === 'open') {
      hub.querySelector('[data-quick]')?.addEventListener('click', function () { void enterRoom('quick'); });
      hub.querySelector('[data-create]')?.addEventListener('click', function () { void enterRoom('create'); });
      hub.querySelector('[data-code]')?.addEventListener('click', function () {
        void enterRoom('code', document.getElementById('raid-room-code-input')?.value || '');
      });
    }
  }

  async function inviteOnlineFriends({ force = false } = {}) {
    if (!state.roomId || !state.room || !isHost() || state.room.status !== 'waiting') return { sent: 0, skipped: true };
    if (!force && state.invitedRoomId === state.roomId) return { sent: 0, skipped: true };
    if (force && now() < state.inviteCooldownUntil) {
      return { sent: 0, cooldownMs: state.inviteCooldownUntil - now() };
    }

    const user = playerRepository.currentUser();
    const friends = [...new Set((data()?.friends || []).filter(uid => typeof uid === 'string' && uid !== user?.uid))].slice(0, 30);
    if (!user || !friends.length) {
      if (force) toast('目前沒有可邀請的好友');
      return { sent: 0 };
    }

    if (!force) state.invitedRoomId = state.roomId;
    if (force) state.inviteCooldownUntil = now() + 15000;

    try {
      const sentTo = await playerRepository.sendRaidInvitations({
        friendUids: friends,
        invitation: {
          raidVersion: 2,
          raidCode: state.room.code,
          raidRoomId: state.roomId,
          hostUid: user.uid,
          hostName: state.player?.name || data()?.displayName || '修士',
          hostAvatar: resolvePlayerAvatar(data(), user),
          hostFrame: data()?.equipped?.frame || ''
        }
      });
      const sent = Array.isArray(sentTo) ? sentTo.length : 0;
      if (force) toast(sent ? '已邀請 ' + sent + ' 位在線好友' : '目前沒有在線好友可邀請');
      return { sent };
    } catch (error) {
      if (force) state.inviteCooldownUntil = 0;
      console.warn('[Raid] friend invitations unavailable:', error);
      if (force) toast(error?.message || '好友邀請發送失敗');
      return { sent: 0, error };
    }
  }
  function renderLobby() {
    if (!state.room || !state.player) return renderHub();
    state.status = 'lobby';
    document.body.classList.add('raid-session-active');
    show('lobby');
    const members = raidRoomMembers(state.room);
    const me = myRoomMember();
    void inviteOnlineFriends();
    const allReady = members.length > 0 && members.every(member => member.ready && raidMemberOnline(member));
    const lobby = document.getElementById('raid-lobby');
    lobby.dataset.partySize = String(members.length);
    lobby.innerHTML =
      '<header class="raid-heading"><button class="raid-back" type="button" data-leave><i class="fa-solid fa-arrow-left"></i></button>' +
      '<div><small>RAID PARTY ／ 秘境隊伍</small><h2>清霜試煉隊伍</h2><p>隊伍代碼 <b class="raid-room-code">' + escapeHtml(state.room.code || '------') + '</b></p></div><span class="raid-seal">' + members.length + '/4</span></header>' +
      '<div class="raid-party-list" data-party-count="' + members.length + '">' + members.map(member => {
        const hp = Math.max(1, Number(member.maxHp) || 1);
        return '<article class="raid-party-member ' + (member.uid === state.player.uid ? 'me' : '') + '">' +
          '<img src="' + escapeHtml(member.portrait || MALE) + '" alt="隊員">' +
          '<div><small>' + (member.host ? '隊長' : '隊員') + (raidMemberOnline(member) ? '・在線' : '・離線') + '</small><strong>' + escapeHtml(member.name) + '</strong>' +
          '<span>戰力 ' + Math.max(0, Number(member.combatPower) || 0).toLocaleString() + '・HP ' + hp.toLocaleString() + '</span></div>' +
          '<b class="' + (member.ready ? 'ready' : '') + '">' + (member.ready ? '已準備' : '未準備') + '</b></article>';
      }).join('') + '</div>' +
      '<div class="raid-lobby-actions"><button class="raid-ghost" type="button" data-copy>複製隊伍代碼</button>' +
      (isHost() ? '<button class="raid-ghost" type="button" data-invite><i class="fa-solid fa-user-plus"></i> 邀請好友</button>' : '') +
      '<button class="raid-primary" type="button" data-ready>' + (me?.ready ? '取消準備' : '準備') + '</button>' +
      (isHost() ? '<button class="raid-primary" type="button" data-start ' + (allReady ? '' : 'disabled') + '>開始團本</button>' : '<span class="raid-wait-host">等待隊長開始</span>') + '</div>';
    lobby.querySelector('[data-leave]')?.addEventListener('click', leaveRaid);
    lobby.querySelector('[data-copy]')?.addEventListener('click', async function () {
      try { await navigator.clipboard.writeText(String(state.room.code || '')); toast('隊伍代碼已複製'); }
      catch (_) { toast('隊伍代碼：' + String(state.room.code || '')); }
    });
    lobby.querySelector('[data-invite]')?.addEventListener('click', async function (event) {
      const button = event.currentTarget;
      if (!button || button.disabled) return;
      const remaining = Math.max(0, state.inviteCooldownUntil - now());
      if (remaining > 0) {
        toast('請等待 ' + Math.ceil(remaining / 1000) + ' 秒後再邀請');
        return;
      }
      button.disabled = true;
      const original = button.innerHTML;
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 邀請中';
      await inviteOnlineFriends({ force: true });
      button.innerHTML = original;
      window.setTimeout(() => {
        if (button.isConnected) button.disabled = false;
      }, Math.max(0, state.inviteCooldownUntil - now()));
    });
    lobby.querySelector('[data-ready]')?.addEventListener('click', function () {
      void setRaidReady(state.roomId, !me?.ready).catch(error => toast(error.message || '準備狀態更新失敗'));
    });
    lobby.querySelector('[data-start]')?.addEventListener('click', function () { void hostStartRaid(); });
    syncRaidBottomClearance();
  }

  function currentBossClock() {
    if (!state.bossStartedAtMs) return null;
    return bossClockState({ startedAtMs: state.bossStartedAtMs, nowMs: now(), actionCount: state.bossActionCount });
  }
  function currentIntent() {
    return shenIntentForRound({
      round: state.bossActionCount + 1,
      bossHp: state.boss?.hp || 1,
      bossMaxHp: state.boss?.maxHp || 1,
      baseAttack: state.boss?.baseAttack || 100
    });
  }
  function teamworkState() {
    const ids = [...new Set(Array.isArray(state.room?.teamCorrectUids) ? state.room.teamCorrectUids : [])];
    return {
      contributors: ids.length,
      guardReady: state.room?.teamGuardReady === true,
      burstTriggered: state.room?.teamBurstTriggered === true
    };
  }

  function teamworkMarkup(compact = false) {
    const team = teamworkState();
    const guardProgress = Math.min(2, team.contributors);
    const burstProgress = Math.min(3, team.contributors);
    return '<div class="raid-teamwork ' + (compact ? 'compact ' : '') + (team.guardReady ? 'guard-ready ' : '') +
      (team.burstTriggered ? 'burst-ready' : '') + '">' +
      '<div><i class="fa-solid fa-shield-halved"></i><span><b>同心破陣 ' + guardProgress + '/2</b><small>' +
      (team.guardReady ? '已完成：Boss 下一式傷害降低 45%' : '需要 2 名不同隊員在本輪答對') +
      '</small></span></div><div><i class="fa-solid fa-khanda"></i><span><b>三才合擊 ' + burstProgress + '/3</b><small>' +
      (team.burstTriggered ? '本輪已觸發 240 團隊傷害' : '3 名不同隊員答對時追加 240 團隊傷害') +
      '</small></span></div></div>';
  }

  function partyCardsMarkup(members) {
    return members.map(member => {
      const pct = hpPct(member.hp, member.maxHp);
      const isMe = String(member.uid || '') === String(state.player?.uid || '');
      const hpId = isMe ? ' id="raid-player-hp-text"' : '';
      const barId = isMe ? ' id="raid-player-hp-bar"' : '';
      return '<article data-raid-member="' + escapeHtml(member.uid) + '" class="raid-stage-player ' + (isMe ? 'me ' : '') + (member.alive === false ? 'down' : '') + '">' +
        '<div class="raid-stage-player-art"><img src="' + escapeHtml(member.portrait || state.player?.portrait || '') + '" alt="' + escapeHtml(member.name || '玩家') + '"></div>' +
        '<div class="raid-stage-player-info"><strong>' + escapeHtml(member.name || '無名修士') + (isMe ? '<em>你</em>' : '') + '</strong>' +
        '<small' + hpId + '>' + Math.max(0, Number(member.hp) || 0).toLocaleString() + ' HP</small>' +
        '<div class="raid-stage-player-hp"><i' + barId + ' style="width:' + pct + '%"></i></div>' +
        '<span data-member-damage>輸出 ' + Math.max(0, Number(member.damage) || 0).toLocaleString() + '</span></div></article>';
    }).join('');
  }

  function partyMarkup(alive, recent) {
    const members = raidRoomMembers(state.room);
    const count = Math.max(1, Math.min(4, members.length));
    const cards = partyCardsMarkup(members);
    return '<section class="raid-party-floor"><div class="raid-player-lineup" style="grid-template-columns:repeat(' + count + ',minmax(0,1fr))">' +
      cards + '</div><div class="raid-party-controls"><div class="raid-current-status"><span>' +
      escapeHtml(alive ? recent : '你已倒下，等待隊友完成本次試煉。') + '</span><small>個人題號 ' + (state.playerActionCount + 1) +
      '・法寶護盾 ' + Math.round(state.player.artifactShield || 0).toLocaleString() +
      '・' + (state.player.coreShield ? '道心護體已凝聚' : '道心護體未凝聚') + '</small></div>' +
      '<button class="raid-primary raid-fight" type="button" data-question ' + (!alive ? 'disabled' : '') + '>' +
      (!alive ? '觀戰中' : state.question ? '繼續作答' : state.questionLoading ? '題目準備中…' : '準備下一題') +
      '</button></div></section>';
  }

  function renderArena({ transition = true } = {}) {
    if (!state.player || !state.boss || !state.room) return renderHub();
    document.body.classList.add('raid-session-active');
    show('arena', { transition });
    syncRaidBottomClearance();
    const clock = currentBossClock();
    const intent = currentIntent();
    const arena = document.getElementById('raid-arena');
    if (arena.querySelector('.raid-stage')) {
      updateLiveLabels();
      return;
    }
    const recent = state.lastPlayerAction?.correct ? '你剛才命中 ' + state.lastPlayerAction.damage.toLocaleString() + ' 傷害。' :
      state.lastPlayerAction ? '上一題沒有形成有效攻勢。' : '大師姐已拔劍。';
    const alive = state.player.hp > 0 && myRoomMember()?.alive !== false;
    arena.innerHTML =
      '<header class="raid-battle-head"><button class="raid-back" type="button" data-leave><i class="fa-solid fa-door-open"></i></button>' +
      '<div><small data-party-size>清霜試煉・' + raidRoomMembers(state.room).length + ' 人隊伍</small><strong data-boss-actions>Boss 已出招 ' + state.bossActionCount + ' 次</strong></div>' +
      '<span data-boss-phase>階段 ' + state.boss.phase + '・' + phaseName(state.boss.phase) + '</span></header>' +
      '<div class="raid-stage"><section class="raid-boss-side"><div class="raid-name-row"><div><small>BOSS</small><h3>' + state.boss.name + '</h3></div>' +
      '<b id="raid-boss-hp-text">' + Math.round(state.boss.hp).toLocaleString() + ' / ' + Math.round(state.boss.maxHp).toLocaleString() + '</b></div>' +
      '<div class="raid-hp boss"><i id="raid-boss-hp-bar" style="width:' + hpPct(state.boss.hp, state.boss.maxHp) + '%"></i></div>' +
      teamworkMarkup(false) +
      '<div class="raid-boss-portrait"><div class="raid-boss-aura"></div><img src="' + state.boss.image + '" alt="沈清霜"><span>「' + escapeHtml(intent.name) + '」</span></div>' +
      '<div class="raid-intent ' + intent.kind + '"><i class="fa-solid fa-khanda"></i><div><b>' + escapeHtml(intent.name) + '</b><span>' + escapeHtml(intent.cue) + '</span></div>' +
      '<em id="raid-boss-clock">' + (clock ? (clock.remainingMs / 1000).toFixed(1) : '18.0') + ' 秒</em></div></section>' +
      partyMarkup(alive, recent) + '</div>';
    arena.querySelector('[data-leave]')?.addEventListener('click', leaveRaid);
    arena.querySelector('[data-question]')?.addEventListener('click', function () { void openNextQuestion(); });
    updateLiveLabels();
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function playBattleScene({
    attacker = 'boss',
    actionName = '',
    damage = 0,
    reflectedDamage = 0,
    guarded = false,
    defenseSkill = '',
    healed = 0
  } = {}) {
    // Boss and answer settlements may arrive together. Serialize their visual
    // feedback without changing the authoritative combat or answer state.
    const token = state.battleSceneToken;
    const previous = state.battleSceneTail || Promise.resolve();
    let release;
    const tail = new Promise(resolve => { release = resolve; });
    state.battleSceneTail = tail;
    await previous;
    if (token !== state.battleSceneToken) { release(); return; }
    state.battleScenePlaying = true;
    setRaidCombatFocus(true);
    renderArena({ transition: false });

    const arena = document.getElementById('raid-arena');
    const stage = arena?.querySelector('.raid-stage');
    if (stage) stage.classList.add(attacker === 'player' ? 'raid-player-strike' : 'raid-boss-strike');
    const actionCaption = arena?.querySelector('.raid-boss-portrait > span');
    if (actionCaption && actionName) actionCaption.textContent = '「' + actionName + '」';

    const notice = document.createElement('div');
    notice.className = 'raid-combat-event ' + (attacker === 'player' ? 'player' : 'boss');
    const details = [];
    if (guarded) details.push('道心護體・完全抵擋');
    if (defenseSkill) details.push(defenseSkill);
    if (reflectedDamage > 0) details.push('反擊 ' + Math.round(reflectedDamage).toLocaleString());
    if (healed > 0) details.push('回復 ' + Math.round(healed).toLocaleString() + ' HP');
    notice.innerHTML =
      '<small>' + (attacker === 'player' ? '你的攻勢' : '大師姐出招') + '</small>' +
      '<strong>' + escapeHtml(actionName || (attacker === 'player' ? '攻擊' : '劍招')) + '</strong>' +
      '<b>' + (guarded ? '0' : Math.max(0, Math.round(Number(damage) || 0)).toLocaleString()) + ' 傷害</b>' +
      (details.length ? '<span>' + details.map(escapeHtml).join('・') + '</span>' : '');
    arena?.appendChild(notice);

    await wait(1150);
    notice.remove();
    stage?.classList.remove('raid-player-strike', 'raid-boss-strike');
    if (token !== state.battleSceneToken) { release(); return; }
    if (state.battleSceneTail !== tail) { release(); return; }
    state.battleSceneTail = null;
    state.battleScenePlaying = false;
    setRaidCombatFocus(false);
    release();

    if (state.pendingFinishRoom) {
      const terminal = state.pendingFinishRoom;
      state.pendingFinishRoom = null;
      state.room = terminal;
      finishRaid(terminal.status === 'won', terminal.status === 'won' ? 'boss-defeated' : 'team-defeated');
      return;
    }

    if (state.player.hp <= 0 && state.status !== 'submitting') {
      state.status = 'spectating';
      updateLiveLabels();
    } else if (state.room?.status === 'active' && state.question && ['question', 'submitting', 'review'].includes(state.status)) {
      renderQuestion(state.status === 'review');
    }
  }

  async function prefetchQuestion() {
    if (state.questionLoading || state.pendingQuestion || !state.scope || state.room?.status !== 'active') return;
    state.questionLoading = true;
    const roomId = state.roomId;
    const token = state.battleSceneToken;
    try {
      const targetAction = state.playerActionCount + (state.status === 'question' ? 2 : 1);
      const generated = await generateRaidQuestion({
        scope: state.scope,
        round: targetAction,
        rank: state.player.rankLevel,
        history: state.history,
        roomId: state.roomId
      });
      if (state.room?.status === 'active' && state.roomId === roomId && token === state.battleSceneToken) state.pendingQuestion = generated;
    } catch (error) {
      if (token !== state.battleSceneToken || state.roomId !== roomId) return;
      console.warn('[Raid] question generation failed:', error);
      toast('題目生成失敗，請再試一次。');
    } finally {
      if (token === state.battleSceneToken) state.questionLoading = false;
    }
  }

  async function openNextQuestion() {
    if (state.room?.status !== 'active' || state.player?.hp <= 0 || state.status === 'submitting' || state.battleScenePlaying) return;
    if (state.status === 'question' && state.question) return renderQuestion(false);
    if (!state.pendingQuestion) {
      await prefetchQuestion();
      if (!state.pendingQuestion) return renderArena();
    }
    state.question = state.pendingQuestion;
    state.pendingQuestion = null;
    state.history.push(state.question);
    state.selectedChoice = null;
    state.answerCorrect = null;
    state.questionIssuedAtMs = now();
    state.status = 'question';
    renderQuestion(false);
    void prefetchQuestion();
  }

  function renderQuestion(review) {
    const q = state.question;
    if (!q) return renderArena();
    const questionView = document.getElementById('raid-question');
    const sameQuestion = questionView?.raidQuestion === q && questionView.dataset.review === String(!!review);
    document.body.classList.add('raid-session-active');
    if (!state.battleScenePlaying) show('question', { transition: false });
    syncRaidBottomClearance();
    const view = document.getElementById('raid-question');
    if (sameQuestion) {
      view.querySelectorAll('[data-choice]').forEach(button => { button.disabled = review || state.status === 'submitting' || state.player.hp <= 0; });
      updateLiveLabels();
      return;
    }
    view.raidQuestion = q;
    view.dataset.review = String(!!review);
    const opts = q.opts.map(function (option, i) {
      let cls = '';
      if (review && i === q.ans) cls = ' correct';
      else if (review && i === state.selectedChoice && i !== q.ans) cls = ' wrong';
      return '<button class="raid-option' + cls + '" type="button" data-choice="' + i + '" ' + (review || state.status === 'submitting' || state.player.hp <= 0 ? 'disabled' : '') + '><span>' +
        String.fromCharCode(65 + i) + '</span><b>' + rich(option) + '</b></button>';
    }).join('');
    let explain = '';
    if (review) {
      const dealt = Math.max(0, Number(state.lastPlayerAction?.damage) || 0);
      const label = state.answerCorrect
        ? ('答對・' + (dealt > 0 ? '造成 ' + dealt.toLocaleString() + ' 傷害' : '攻勢已凝聚'))
        : '答錯・本次失去攻擊';
      explain = '<div class="raid-explain ' + (state.answerCorrect ? 'correct' : 'wrong') + '"><b>' + label + '</b><p>' + rich(q.exp) + '</p>' +
        '<button class="raid-primary" type="button" data-next>下一題</button><button class="raid-ghost" type="button" data-arena>先看戰場</button></div>';
    }
    view.innerHTML = '<div class="raid-question-shell"><header><div><small>' + escapeHtml(q.subject) + '・' + escapeHtml(q.level) + '</small><strong>個人題號 ' +
      (state.playerActionCount + (review ? 0 : 1)) + '</strong></div><span id="raid-question-timer">不限時</span><button class="raid-ghost" type="button" data-question-arena>戰場</button></header>' +
      '<div class="raid-question-boss"><img src="' + RAID_MVP.bossImage + '" alt="沈清霜"><span id="raid-question-boss-clock">Boss 行動倒數</span></div>' +
      teamworkMarkup(true) +
      '<h2>' + rich(q.q) + '</h2><div class="raid-options">' + opts + '</div>' + explain + '</div>';
    typeset(view);
    view.querySelector('[data-question-arena]')?.addEventListener('click', () => renderArena());
    if (!review) {
      view.querySelectorAll('[data-choice]').forEach(function (button) {
        button.addEventListener('click', function () { void answer(Number(button.dataset.choice)); });
      });
    } else {
      view.querySelector('[data-next]')?.addEventListener('click', function () { void openNextQuestion(); });
      view.querySelector('[data-arena]')?.addEventListener('click', renderArena);
    }
    updateLiveLabels();
  }

  async function answer(choice) {
    if (state.status !== 'question' || !state.question || state.room?.status !== 'active') return;
    const selectedChoice = Number.isInteger(choice) ? choice : null;
    if (selectedChoice === null || selectedChoice < 0 || selectedChoice > 3) return;
    const actionId = state.playerActionCount + 1;
    const question = state.question;
    const roomId = state.roomId;
    const token = state.battleSceneToken;

    // Freeze the question while the server verifies the encrypted answer ticket and resolves combat.
    state.selectedChoice = selectedChoice;
    state.status = 'submitting';
    renderQuestion(false);
    try {
      const result = await commitRaidPlayerAction({
        roomId,
        actionId,
        questionId: question.id,
        choice: selectedChoice,
        ticket: question.ticket
      });
      if (state.roomId !== roomId || token !== state.battleSceneToken) return;
      const resolution = result?.resolution;
      if (result.spiritReward) state.learningOutcome = result.spiritReward;
      if (!resolution) throw new Error('伺服器尚未完成本次出手結算');

      state.room = result.room || state.room;
      state.playerActionCount = actionId;
      state.answerCorrect = resolution.correct === true;
      state.questionResolvedAtMs = now();
      state.nextQuestionAtMs = 0;
      question.ans = Number(resolution.correctIndex);
      question.exp = String(resolution.explanation || '此題暫無解析。');
      state.lastPlayerAction = {
        correct: state.answerCorrect,
        damage: Math.max(0, Number(resolution.damage) || 0),
        personalDamage: Math.max(0, Number(resolution.personalDamage) || 0),
        teamBurstDamage: Math.max(0, Number(resolution.teamBurstDamage) || 0),
        teamGuardReady: resolution.teamGuardReady === true,
        teamContributors: Math.max(0, Number(resolution.teamContributors) || 0),
        healed: Math.max(0, Number(resolution.healed) || 0)
      };

      const mine = state.room?.members?.[state.player?.uid];
      if (mine && state.player) Object.assign(state.player, mine);
      if (state.boss) {
        state.boss.hp = Math.max(0, Number(state.room?.bossHp ?? resolution.bossHp) || 0);
        state.boss.phase = shenPhaseForHp(state.boss.hp, state.boss.maxHp);
      }
      state.status = 'review';

      if (state.room?.status === 'won' || state.room?.status === 'lost') {
        state.pendingFinishRoom = state.room;
      }
      void prefetchQuestion();

      if (state.answerCorrect) {
        const dealt = Math.max(0, Number(state.lastPlayerAction.damage) || 0);
        const spiritText = Number(resolution.spiritGain) > 0
          ? (result.spiritReward?.status === 'pending' ? '・神識待入帳' : '・神識 +1') : '';
        const learningText = Number(resolution.cultivationGain) > 0
          ? '・修為 +1・靈石 +20' + (result.spiritReward?.status === 'pending' ? '（待入帳）' : '') : '';
        const teamText = Number(resolution.teamBurstDamage) > 0 ? '・三才合擊 +' + Number(resolution.teamBurstDamage).toLocaleString() :
          (resolution.teamGuardReady === true ? '・同心破陣已成' : '');
        showCorrectAnswerFeedback((dealt > 0 ? '攻勢命中・' + dealt.toLocaleString() + ' 傷害' : '攻勢已凝聚') + teamText + learningText + spiritText);
      }

      if (state.answerCorrect && state.lastPlayerAction.damage > 0) {
        await playBattleScene({
          attacker: 'player',
          actionName: state.lastPlayerAction.teamBurstDamage > 0 ? '三才合擊' : '破勢一擊',
          damage: state.lastPlayerAction.damage,
          healed: state.lastPlayerAction.healed
        });
      } else if (state.pendingFinishRoom && !state.battleSceneTail) {
        const terminal = state.pendingFinishRoom;
        state.pendingFinishRoom = null;
        finishRaid(terminal.status === 'won', terminal.status === 'won' ? 'boss-defeated' : 'team-defeated');
      } else {
        renderQuestion(true);
      }
    } catch (error) {
      if (state.roomId !== roomId || token !== state.battleSceneToken) return;
      console.error('[Raid] authoritative action failed:', error);
      state.selectedChoice = null;
      state.answerCorrect = null;
      state.status = 'question';
      if (state.pendingFinishRoom && !state.battleSceneTail) {
        const terminal = state.pendingFinishRoom;
        state.pendingFinishRoom = null;
        finishRaid(terminal.status === 'won', terminal.status === 'won' ? 'boss-defeated' : 'team-defeated');
        return;
      }
      toast(error.message || '出手結算失敗，請再作答一次。');
      renderQuestion(false);
    }
    updateHomeEntry();
  }

  async function applyRemoteBossAction(action) {
    if (!action || state.applyingBossAction || Number(action.id) <= state.lastBossActionSeen ||
        !state.player) return;
    state.applyingBossAction = true;
    const roomId = state.roomId;
    const token = state.battleSceneToken;
    try {
      // The browser reports only which server-issued Boss action it is acknowledging.
      // HP, mitigation, shields and reflection are all resolved from the trusted room snapshot.
      const settled = state.room?.members?.[state.player.uid]?.lastBossResolution;
      const result = state.room?.serverDrivenBoss && Number(settled?.bossActionSeen) === Number(action.id)
        ? { room: state.room, resolution: settled }
        : await commitRaidBossDefense({
        roomId: state.roomId,
        bossActionSeen: Number(action.id)
      });
      const resolution = result?.resolution;
      if (state.roomId !== roomId || token !== state.battleSceneToken) return;
      if (!resolution) {
        const duplicate = result?.room?.members?.[state.player.uid];
        if (duplicate) {
          state.room = result.room;
          Object.assign(state.player, duplicate);
          state.lastBossActionSeen = Math.max(state.lastBossActionSeen, Number(duplicate.lastBossActionSeen) || 0);
        }
        return;
      }

      state.room = result.room || state.room;
      state.lastBossActionSeen = Math.max(state.lastBossActionSeen, Number(resolution.bossActionSeen) || Number(action.id));
      state.lastBossAction = { intent: action, result: resolution };
      const mine = state.room?.members?.[state.player.uid];
      if (mine) Object.assign(state.player, mine);
      if (state.boss) {
        state.boss.hp = Math.max(0, Number(state.room?.bossHp ?? resolution.bossHp) || 0);
        state.boss.phase = shenPhaseForHp(state.boss.hp, state.boss.maxHp);
      }

      const bossHint = [
        resolution.teamGuarded ? '同心破陣・Boss 傷害降低 45%' : '',
        resolution.guarded ? '道心護體擋下攻擊' : ('受到 ' + Math.max(0, Number(resolution.damage) || 0).toLocaleString() + ' 傷害'),
        Number(resolution.reflectedDamage) > 0 ? ('反擊 ' + Number(resolution.reflectedDamage).toLocaleString()) : ''
      ].filter(Boolean).join('・');
      toast(bossHint);

      if (state.room?.status === 'won' || state.room?.status === 'lost') {
        state.pendingFinishRoom = state.room;
      }
      await playBattleScene({
        attacker: 'boss',
        actionName: action.name,
        damage: Math.max(0, Number(resolution.damage) || 0),
        reflectedDamage: Math.max(0, Number(resolution.reflectedDamage) || 0),
        guarded: resolution.guarded === true,
        defenseSkill: resolution.teamGuarded ? '同心破陣・傷害降低 45%' : ''
      });
    } catch (error) {
      console.error('[Raid] authoritative boss action failed:', error);
    } finally {
      if (token === state.battleSceneToken) state.applyingBossAction = false;
    }
  }

  async function maybeAdvanceBoss() {
    if (state.room?.serverDrivenBoss) return;
    if (!isHost() || state.room?.status !== 'active' || !state.bossStartedAtMs || state.advancingBossAction) return;
    const clock = currentBossClock();
    if (!clock?.due) return;
    state.advancingBossAction = true;
    try {
      const room = await advanceRaidBossAction({ roomId: state.roomId });
      if (room) {
        state.room = room;
        state.bossActionCount = Math.max(state.bossActionCount, Number(room.bossActionCount) || 0);
        if (room.lastBossAction && Number(room.lastBossAction.id) > state.lastBossActionSeen) {
          void applyRemoteBossAction(room.lastBossAction);
        }
      }
    } catch (error) {
      console.warn('[Raid] boss timeline sync failed:', error);
    } finally {
      state.advancingBossAction = false;
    }
  }

  function updateLiveLabels() {
    if (state.room?.status !== 'active' || !state.boss || !state.player) return;
    void maybeAdvanceBoss();
    const current = currentBossClock();
    const bossClock = document.getElementById('raid-boss-clock');
    const questionBossClock = document.getElementById('raid-question-boss-clock');
    if (bossClock && current) {
      bossClock.textContent = (current.remainingMs / 1000).toFixed(1) + ' 秒';
      bossClock.closest('.raid-intent')?.classList.toggle('danger', current.telegraphing);
    }
    if (questionBossClock && current) {
      questionBossClock.textContent = current.telegraphing ?
        '警告：Boss ' + (current.remainingMs / 1000).toFixed(1) + ' 秒後出招' :
        'Boss ' + (current.remainingMs / 1000).toFixed(1) + ' 秒後行動';
    }
    const qTimer = document.getElementById('raid-question-timer');
    if (qTimer) qTimer.textContent = state.status === 'review' ? '可續' : '不限時';
    const bossHp = document.getElementById('raid-boss-hp-text');
    const bossBar = document.getElementById('raid-boss-hp-bar');
    const playerHp = document.getElementById('raid-player-hp-text');
    const playerBar = document.getElementById('raid-player-hp-bar');
    if (bossHp) bossHp.textContent = Math.round(state.boss.hp).toLocaleString() + ' / ' + Math.round(state.boss.maxHp).toLocaleString();
    if (bossBar) bossBar.style.width = hpPct(state.boss.hp, state.boss.maxHp) + '%';
    if (playerHp) playerHp.textContent = Math.round(state.player.hp).toLocaleString() + ' HP';
    if (playerBar) playerBar.style.width = hpPct(state.player.hp, state.player.maxHp) + '%';
    const arena = document.getElementById('raid-arena');
    const members = raidRoomMembers(state.room);
    const lineup = arena?.querySelector('.raid-player-lineup');
    if (lineup) {
      const key = JSON.stringify(members.map(member => [member.uid, member.name, member.portrait]));
      if (lineup.dataset.members !== key) {
        // Membership changes replace the party row only, leaving the stage and
        // Boss image alive. Heartbeats and HP changes never rebuild portraits.
        const ids = [...lineup.querySelectorAll('[data-raid-member]')].map(el => el.dataset.raidMember);
        if (lineup.dataset.members || JSON.stringify(ids) !== JSON.stringify(members.map(member => member.uid))) lineup.innerHTML = partyCardsMarkup(members);
        lineup.dataset.members = key;
        lineup.style.gridTemplateColumns = 'repeat(' + Math.max(1, members.length) + ',minmax(0,1fr))';
      }
      lineup.querySelectorAll('[data-raid-member]').forEach(card => {
        const member = members.find(row => row.uid === card.dataset.raidMember);
        if (!member) return;
        card.classList.toggle('down', member.alive === false || member.hp <= 0);
        card.querySelector('small').textContent = Math.max(0, Number(member.hp) || 0).toLocaleString() + ' HP';
        card.querySelector('.raid-stage-player-hp i').style.width = hpPct(member.hp, member.maxHp) + '%';
        card.querySelector('[data-member-damage]').textContent = '輸出 ' + Math.max(0, Number(member.damage) || 0).toLocaleString();
      });
    }
    const setText = (selector, value) => {
      const node = arena?.querySelector(selector);
      if (node && node.textContent !== value) node.textContent = value;
    };
    const intent = currentIntent();
    setText('[data-party-size]', '清霜試煉・' + members.length + ' 人隊伍');
    setText('[data-boss-actions]', 'Boss 已出招 ' + state.bossActionCount + ' 次');
    setText('[data-boss-phase]', '階段 ' + state.boss.phase + '・' + phaseName(state.boss.phase));
    setText('.raid-intent b', intent.name);
    setText('.raid-intent span', intent.cue);
    if (!state.battleScenePlaying) setText('.raid-boss-portrait > span', '「' + intent.name + '」');
    const alive = state.player.hp > 0 && myRoomMember()?.alive !== false;
    const fight = arena?.querySelector('[data-question]');
    if (fight) {
      fight.disabled = !alive || state.battleScenePlaying || state.status === 'submitting';
      const label = !alive ? '觀戰中' : state.question ? '繼續作答' : state.questionLoading ? '題目準備中…' : '準備下一題';
      if (fight.textContent !== label) fight.textContent = label;
    }
    const recent = state.lastPlayerAction?.correct ? '你剛才命中 ' + state.lastPlayerAction.damage.toLocaleString() + ' 傷害。' :
      state.lastPlayerAction ? '上一題沒有形成有效攻勢。' : '大師姐已拔劍。';
    setText('.raid-current-status > span', alive ? recent : '你已倒下，等待隊友完成本次試煉。');
    setText('.raid-current-status > small', '個人題號 ' + (state.playerActionCount + 1) + '・法寶護盾 ' +
      Math.round(state.player.artifactShield || 0).toLocaleString() + '・' + (state.player.coreShield ? '道心護體已凝聚' : '道心護體未凝聚'));
    for (const view of [arena, document.getElementById('raid-question')]) {
      const team = view?.querySelector('.raid-teamwork');
      if (!team) continue;
      const markup = teamworkMarkup(view.id === 'raid-question');
      if (team.dataset.markup !== markup) {
        // Teamwork changes infrequently; clock ticks retain its DOM as well.
        const holder = document.createElement('div');
        holder.innerHTML = markup;
        const next = holder.firstElementChild;
        next.dataset.markup = markup;
        team.replaceWith(next);
      }
    }
  }

  function startTick() {
    if (state.tickTimer) return;
    state.tickTimer = setInterval(updateLiveLabels, 100);
  }
  function stopTick() {
    if (state.tickTimer) clearInterval(state.tickTimer);
    state.tickTimer = null;
  }
  function startHeartbeat() {
    stopHeartbeat();
    if (!state.roomId) return;
    state.heartbeatTimer = setInterval(function () {
      void heartbeatRaidRoom(state.roomId).catch(() => {});
    }, HEARTBEAT_MS);
  }
  function stopHeartbeat() {
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }

  async function ensureLocalPlayer() {
    if (state.player) return state.player;
    await window.ensureCombatStats?.();
    state.player = snapshotPlayer();
    const auth = await ensureRaidRoomAuth();
    if (!auth.uid) throw new Error('團本身分建立失敗');
    state.player.uid = auth.uid;
    state.scope = resolveBattleKnowledge(state.player.knowledge, state.player.knowledge);
    return state.player;
  }

  function attachRoom(roomId) {
    state.roomUnsub?.();
    state.roomId = roomId;
    state.roomUnsub = subscribeRaidRoom(roomId, handleRoomSnapshot, error => {
      console.error('[Raid] room listener failed:', error);
      toast('團本連線中斷，正在嘗試保留房間。');
    });
    startHeartbeat();
    updateHomeEntry();
  }

  async function enterRoom(mode, roomCode = '') {
    if (score() < RAID_MVP.minimumScore) return toast('需達築基初期（' + RAID_MVP.minimumScore + ' 修為）才可進入秘境。');
    if (storyOpen()) return toast('目前有劇情或教學進行中。');
    if (state.roomId && ['won', 'lost', 'closed'].includes(state.room?.status)) resetRaid(false);
    state.status = 'loading';
    document.body.classList.add('raid-session-active');
    window.switchToPage?.(PAGE_ID);
    show('question');
    document.getElementById('raid-question').innerHTML = '<div class="raid-question-shell raid-loading"><i class="fa-solid fa-circle-notch fa-spin"></i><h3>正在連結秘境隊伍</h3><p>題目不設倒數；Boss 會在正式開戰後才開始計時。</p></div>';
    try {
      await ensureLocalPlayer();
      // The server rebuilds the combat snapshot from Firebase A; no client combat stats are submitted.
      const roomId = mode === 'create' ? await createRaidRoom() :
        mode === 'code' ? await joinRaidRoomByCode(roomCode) :
        await findOrCreateRaidRoom();
      attachRoom(roomId);
    } catch (error) {
      console.error('[Raid] enter room failed:', error);
      toast(error.message || '秘境隊伍建立失敗');
      resetRaid(false);
      renderHub();
    }
  }

  async function hostStartRaid() {
    if (!state.room || !isHost()) return;
    try {
      // Boss HP and attack use the same fixed difficulty for every party.
      const result = await startRaidRoom(state.roomId);
      if (result?.ticketState) state.ticketState = { ...state.ticketState, ...result.ticketState };
    } catch (error) {
      toast(error.message || '目前無法開始團本');
    }
  }

  async function beginActiveRaid(room) {
    if (!state.player) await ensureLocalPlayer();
    state.runId = state.runId || randomId();
    state.room = room;
    state.boss = {
      id: RAID_MVP.bossId,
      name: RAID_MVP.bossName,
      title: RAID_MVP.bossTitle,
      image: RAID_MVP.bossImage,
      hp: Math.max(0, Number(room.bossHp) || 0),
      maxHp: Math.max(1, Number(room.bossMaxHp) || 1),
      baseAttack: Math.max(1, Number(room.bossBaseAttack) || 100),
      phase: Number(room.bossPhase) || shenPhaseForHp(room.bossHp, room.bossMaxHp)
    };
    const mine = myRoomMember();
    if (mine) {
      // Mirror the authoritative C-room projection for UI only; local A values never settle combat.
      Object.assign(state.player, mine);
      if (!room.serverDrivenBoss) state.lastBossActionSeen = Math.max(state.lastBossActionSeen, Number(mine.lastBossActionSeen) || 0);
      state.playerActionCount = Math.max(state.playerActionCount, Number(mine.lastActionId) || 0);
    }
    state.bossStartedAtMs = Number(room.startedAtMs) || now();
    state.bossActionCount = Math.max(0, Number(room.bossActionCount) || 0);
    const wasQuestion = state.status === 'question';
    const wasReview = state.status === 'review';
    state.status = state.player.hp > 0 ? (wasQuestion ? 'question' : wasReview ? 'review' : 'active') : 'spectating';
    startTick();
    if (room.lastBossAction && Number(room.lastBossAction.id) > state.lastBossActionSeen) void applyRemoteBossAction(room.lastBossAction);
    if (state.player.hp > 0 && !state.question && !state.pendingQuestion) {
      await prefetchQuestion();
      if (state.pendingQuestion) await openNextQuestion();
      else renderArena();
    } else if (!['question', 'review'].includes(state.status)) {
      renderArena();
    }
  }

  function handleRoomSnapshot(room, learningOutcome) {
    if (learningOutcome) state.learningOutcome = learningOutcome;
    if (!room) {
      toast('團本房間已關閉');
      resetRaid(false);
      renderHub();
      return;
    }
    state.room = room;
    if (state.boss) {
      state.boss.hp = Math.max(0, Number(room.bossHp) || 0);
      state.boss.maxHp = Math.max(1, Number(room.bossMaxHp) || state.boss.maxHp || 1);
      state.boss.baseAttack = Math.max(1, Number(room.bossBaseAttack) || state.boss.baseAttack || 100);
      state.boss.phase = shenPhaseForHp(state.boss.hp, state.boss.maxHp);
    }
    state.bossActionCount = Math.max(0, Number(room.bossActionCount) || 0);
    const mine = myRoomMember();
    const learningStatus = document.getElementById('raid-learning-status');
    if (learningStatus && state.status === 'finished') learningStatus.innerHTML = renderRaidLearning(mine, state.learningOutcome);
    if (mine && state.player) {
      Object.assign(state.player, mine);
      state.playerActionCount = Math.max(state.playerActionCount, Number(mine.lastActionId) || 0);
      if (!room.serverDrivenBoss) state.lastBossActionSeen = Math.max(state.lastBossActionSeen, Number(mine.lastBossActionSeen) || 0);
    }
    if (room.status === 'waiting') {
      stopTick();
      renderLobby();
      return;
    }
    if (room.status === 'active') {
      if (!state.bossStartedAtMs) void beginActiveRaid(room);
      else if (!state.battleScenePlaying && state.status !== 'submitting') {
        if (state.player?.hp <= 0 && state.status !== 'spectating') {
          state.status = 'spectating';
          renderArena({ transition: false });
        }
      }
      if (room.lastBossAction && Number(room.lastBossAction.id) > state.lastBossActionSeen) void applyRemoteBossAction(room.lastBossAction);
      updateLiveLabels();
      return;
    }
    if (room.status === 'won' || room.status === 'lost') {
      // Play the final server-settled hit even if it killed this player or the
      // Boss. No acknowledgement is required to establish the terminal state.
      if (room.serverDrivenBoss && room.lastBossAction && state.player &&
          Number(room.lastBossAction.id) > state.lastBossActionSeen &&
          Number(mine?.lastBossResolution?.bossActionSeen) === Number(room.lastBossAction.id)) {
        state.pendingFinishRoom = room;
        if (!state.applyingBossAction) void applyRemoteBossAction(room.lastBossAction);
        return;
      }
      if (state.battleSceneTail || state.battleScenePlaying || state.status === 'submitting') {
        state.pendingFinishRoom = room;
        return;
      }
      finishRaid(room.status === 'won', room.status === 'won' ? 'boss-defeated' : 'team-defeated');
      return;
    }
    if (room.status === 'closed') {
      toast('隊伍已解散');
      resetRaid(false);
      renderHub();
    }
  }

  async function claimRaidReward() {
    if (!state.roomId || state.room?.status !== 'won' || state.rewardClaiming ||
        state.rewardClaimedRoomId === state.roomId) return;
    const roomId = state.roomId;
    const local = data();
    const uid = playerRepository.currentUser()?.uid;
    state.rewardClaiming = true;
    const status = document.getElementById('raid-reward-status');
    if (status) status.textContent = '正在確認本次試煉獎勵…';
    let confirmed = false;
    try {
      const payload = await rewardRepository.claimRaid(roomId);
      confirmed = true;
      if (state.roomId !== roomId || local !== data() || playerRepository.currentUser()?.uid !== uid) return;
      state.rewardClaimedRoomId = roomId;

      // 團本 API 回傳本場素材與印記的權威庫存值；直接合併到本地玩家狀態，
      // 不再為素材額外從瀏覽器讀取 Firebase users 文件。
      local.materialSystem = local.materialSystem && typeof local.materialSystem === 'object'
        ? local.materialSystem : {inventory:{}};
      local.materialSystem.inventory = { ...(local.materialSystem.inventory || {}) };
      Object.entries(payload.inventory || {}).forEach(([materialId, amount]) => {
        const count = Math.max(0, Math.floor(Number(amount) || 0));
        if (count > 0) local.materialSystem.inventory[materialId] = count;
        else delete local.materialSystem.inventory[materialId];
      });
      if (payload.firstVictory && payload.memento) {
        local.raidProgress = { ...(local.raidProgress || {}) };
        local.raidProgress[RAID_MVP.bossId] = {
          ...(local.raidProgress[RAID_MVP.bossId] || {}),
          memento: payload.memento,
          firstVictoryRoomId: roomId
        };
      }
      window.dispatchEvent(new CustomEvent('material-system-updated', {
        detail: { ...local.materialSystem, raidReward:true }
      }));
      if (status) status.innerHTML = renderRaidLoot(payload);
    } catch (error) {
      if (state.roomId !== roomId || local !== data()) return;
      console.error('[Raid] trusted reward claim failed:', error);
      if (status) status.innerHTML = '<b>' + (confirmed ? '獎勵已入帳，背包待同步' : '獎勵尚未確認') + '</b><small>' +
        escapeHtml(error?.message || '請稍後再試') + '</small><button type="button" class="raid-ghost" data-retry-reward>重試同步／領取</button>';
      status?.querySelector('[data-retry-reward]')?.addEventListener('click', function () {
        state.rewardClaiming = false;
        void claimRaidReward();
      }, { once:true });
    } finally {
      if (state.roomId === roomId) state.rewardClaiming = false;
    }
  }

  function finishRaid(won, reason) {
    // Terminal room snapshots may repeat (for example on a heartbeat). Keep the
    // existing result DOM so an asynchronous reward response is not overwritten.
    if (state.status === 'finished') return;
    stopTick();
    state.status = 'finished';
    document.body.classList.remove('raid-session-active');
    setRaidCombatFocus(false);
    show('result');
    const result = document.getElementById('raid-result');
    const members = raidRoomMembers(state.room);
    const title = won ? '試煉突破' : '試煉中止';
    const quote = won ? '「配合得還行。下次帶更難的題來。」' : '「先整隊，再來。」';
    result.innerHTML = '<div class="raid-result-card ' + (won ? 'win' : 'loss') + '"><span class="raid-result-seal">' + (won ? '破' : '止') + '</span>' +
      '<small>SHEN QINGSHUANG RAID</small><h2>' + title + '</h2><p>' + quote + '</p><img src="' + RAID_MVP.bossImage + '" alt="沈清霜">' +
      '<div class="raid-result-grid"><div><span>隊伍人數</span><b>' + members.length + ' 人</b></div><div><span>Boss 已出招</span><b>' + state.bossActionCount + ' 次</b></div>' +
      '<div><span>Boss 剩餘生命</span><b>' + Math.round(state.room?.bossHp || 0).toLocaleString() + '</b></div><div><span>題目時間</span><b>不限時</b></div></div>' +
      '<div class="raid-result-team">' + members.map(member => '<div><span>' + escapeHtml(member.name) + '</span><b>' + Math.max(0, Number(member.damage) || 0).toLocaleString() + ' 傷害</b><small>' +
        Math.max(0, Number(member.correct) || 0) + ' / ' + Math.max(0, Number(member.attempts) || 0) + ' 答對' +
        (Number(member.spiritCorrect) > 0 ? '・神識 +' + Math.floor(member.spiritCorrect) + '（勝敗皆保留）' : '') + '</small></div>').join('') + '</div>' +
      '<div id="raid-learning-status" class="raid-learning-summary">' + renderRaidLearning(myRoomMember(), state.learningOutcome) + '</div>' +
      '<div class="raid-prototype-note raid-loot-summary"><i class="fa-solid fa-gem"></i><span id="raid-reward-status"><b>' + (won ? '通關戰利品' : '再接再厲') + '</b><small>' + (won ? '正在確認玄髓、劍魄、煉製印記與首勝獎勵…' : '答題收益保留；擊敗大師姐另獲團本素材與煉製印記。') + '</small></span></div>' +
      '<div class="raid-result-actions"><button class="raid-ghost" type="button" data-home>返回仙府</button><button class="raid-ghost" type="button" data-refinery>前往煉器</button><button class="raid-primary" type="button" data-again>重新組隊</button></div></div>';
    result.querySelector('[data-home]')?.addEventListener('click', async function () {
      await leaveRaidRoom(state.roomId).catch(() => {});
      resetRaid(false);
      window.switchToPage?.('page-home');
      syncRaidViewportLock();
    });
    result.querySelector('[data-again]')?.addEventListener('click', async function () {
      await leaveRaidRoom(state.roomId).catch(() => {});
      resetRaid(false);
      renderHub();
    });
    result.querySelector('[data-refinery]')?.addEventListener('click', async function () {
      await leaveRaidRoom(state.roomId).catch(() => {});
      resetRaid(false);
      window.switchToPage?.('page-training');
      window.dispatchEvent(new CustomEvent('xiuxian:refinery-open-request'));
      syncRaidViewportLock();
    });
    updateHomeEntry();
    if (won) void claimRaidReward();
  }

  function resetRaid(clearRoom = true) {
    stopTick();
    stopHeartbeat();
    state.roomUnsub?.();
    state.roomUnsub = null;
    if (clearRoom && state.roomId) void leaveRaidRoom(state.roomId).catch(() => {});
    Object.assign(state, {
      status: 'hub', runId: '', player: null, boss: null, scope: null, question: null, pendingQuestion: null,
      history: [], questionIssuedAtMs: 0, questionResolvedAtMs: 0, nextQuestionAtMs: 0,
      selectedChoice: null, answerCorrect: null, playerActionCount: 0, bossStartedAtMs: 0, bossActionCount: 0,
      lastBossAction: null, lastPlayerAction: null, questionLoading: false, roomId: '', room: null,
      lastBossActionSeen: 0, applyingBossAction: false, advancingBossAction: false,
      battleSceneToken: state.battleSceneToken + 1, battleScenePlaying: false, battleSceneTail: null, pendingFinishRoom: null, invitedRoomId: '',
      rewardClaiming: false, rewardClaimedRoomId: '',
      learningOutcome: null
    });
    document.getElementById('raid-arena')?.replaceChildren();
    document.body.classList.remove('raid-session-active');
    setRaidCombatFocus(false);
    updateHomeEntry();
  }

  async function leaveRaid() {
    if (typeof window.openConfirm !== 'function') {
      toast('確認視窗尚未載入，請稍後再試');
      return;
    }
    const confirmed = await window.openConfirm('退出隊伍會離開本次團本，確定離開？');
    if (confirmed !== true) return;
    const roomId = state.roomId;
    resetRaid(false);
    if (roomId) await leaveRaidRoom(roomId).catch(() => {});
    renderHub();
  }

  async function tryReconnect() {
    if (state.reconnectTried || state.roomId || score() < RAID_MVP.minimumScore) return;
    state.reconnectTried = true;
    try {
      const player = await ensureLocalPlayer();
      const roomId = await reconnectRaidRoom(player);
      if (roomId) attachRoom(roomId);
    } catch (_) {}
  }

  function openHub() {
    ensurePage();
    window.switchToPage?.(PAGE_ID);
    syncRaidViewportLock();
    if (state.roomId && state.room?.status === 'waiting') renderLobby();
    else if (state.roomId && state.room?.status === 'active') {
      document.body.classList.add('raid-session-active');
      renderArena();
    } else if (state.status === 'finished') show('result');
    else renderHub();
    void refreshRaidTickets();
    void tryReconnect();
  }

  window.openRaidHub = openHub;
  window.joinRaidRoomInvite = async function (roomCode) {
    if (state.roomId && state.room?.status && !['won', 'lost', 'closed'].includes(state.room.status)) return false;
    await enterRoom('code', roomCode);
    return !!state.roomId;
  };
  window.startShenRaid = function () { return enterRoom('quick'); };
  window.getRaidMvpState = function () {
    return {
      modeVersion: 2,
      status: state.status,
      roomId: state.roomId || null,
      roomCode: state.room?.code || null,
      partySize: raidRoomMembers(state.room).length,
      bossId: state.boss?.id || RAID_MVP.bossId,
      bossHp: state.boss?.hp ?? state.room?.bossHp ?? null,
      playerHp: state.player?.hp ?? null,
      playerActionCount: state.playerActionCount,
      bossActionCount: state.bossActionCount,
      asynchronousQuestions: true,
      questionTimeLimit: null,
      multiplayer: true,
      raidTickets: state.ticketState?.count ?? null,
      raidTicketCap: state.ticketState?.cap ?? 10
    };
  };

  function boot() {
    ensureStyle();
    ensurePage();
    const nav = document.getElementById('bottom-nav');
    window.addEventListener('resize', scheduleRaidHubFit, { passive: true });
    window.visualViewport?.addEventListener?.('resize', scheduleRaidHubFit, { passive: true });
    window.visualViewport?.addEventListener?.('scroll', scheduleRaidHubFit, { passive: true });
    window.addEventListener('app:visual-viewport', scheduleRaidHubFit, { passive: true });
    if (nav && globalThis.ResizeObserver) new ResizeObserver(scheduleRaidHubFit).observe(nav);
    if (nav) new MutationObserver(scheduleRaidHubFit).observe(nav, {
      attributes: true,
      attributeFilter: ['class', 'style'],
      childList: true,
      subtree: true
    });
    mountHomeEntry();
    renderHub();
    void refreshRaidTickets();
    window.addEventListener('xiuxian:user-ready', function () {
      mountHomeEntry();
      updateHomeEntry();
      void refreshRaidTickets();
      void tryReconnect();
    });
    window.addEventListener('xiuxian:stats-updated', updateHomeEntry);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
