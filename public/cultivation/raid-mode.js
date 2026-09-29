import { RAID_MVP, shenPhaseForHp, shenIntentForRound, bossClockState } from './raid-engine.js';
import { snapshotBattleKnowledge, resolveBattleKnowledge } from './battle-question-scope.js';
import { generateRaidQuestion } from './raid-question.js';
import {
  ensureRaidRoomAuth, createRaidRoom, findOrCreateRaidRoom, joinRaidRoomByCode, reconnectRaidRoom,
  setRaidReady, startRaidRoom, subscribeRaidRoom, heartbeatRaidRoom, commitRaidPlayerAction,
  commitRaidBossDefense, advanceRaidBossAction, leaveRaidRoom, raidRoomMembers, raidMemberOnline
} from './raid-room.js';
import { playerRepository } from './data/player-repository.js';
import { rewardRepository } from './data/reward-repository.js';

(function () {
  'use strict';

  const PAGE_ID = 'page-raid';
  const STYLE_HREF = 'styles/raid-mode.css?v=20260929-qa-compact1';
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
    pendingFinishRoom: null,
    reconnectTried: false,
    invitedRoomId: '',
    inviteCooldownUntil: 0,
    rewardClaiming: false,
    rewardClaimedRoomId: ''
  };

  function now() { return Date.now(); }
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
    const combatFocus = document.body.classList.contains('raid-combat-focus');

    // During the 1.15 s attack cut-in, bind the whole raid surface to the actual
    // visual viewport. Mobile browser chrome can otherwise shrink the visible area
    // between the quiz and arena renders and clip the battlefield.
    if (combatFocus) {
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
      return;
    }

    // Remove attack-only inline geometry so the normal centered raid layout takes over.
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
    if (active) {
      syncRaidBottomClearance();
      // The raid is a viewport surface, not part of the document's scroll flow.
      // Reset any inherited page offset so fixed header/navigation never move with raid content.
      try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); }
      catch (_) { window.scrollTo?.(0, 0); }
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
  function show(name) {
    const page = ensurePage();
    ['hub', 'lobby', 'arena', 'question', 'result'].forEach(function (id) {
      page.querySelector('#raid-' + id)?.classList.toggle('hidden', id !== name);
    });
    page.dataset.raidView = name;
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
      '<span class="raid-home-copy"><small>秘境集結 ／ RAID</small><strong>秘境討伐</strong><em>1–4 人挑戰大師姐・沈清霜</em></span>' +
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
      (state.roomId ? '秘境隊伍進行中' : '1–4 人挑戰大師姐・沈清霜');
  }

  function renderHub() {
    state.status = state.roomId ? state.status : 'hub';
    document.body.classList.remove('raid-session-active');
    show('hub');
    const locked = score() < RAID_MVP.minimumScore;
    const hub = document.getElementById('raid-hub');
    hub.innerHTML =
      '<header class="raid-heading"><button class="raid-back" type="button" data-home><i class="fa-solid fa-arrow-left"></i></button>' +
      '<div><small>SECRET REALM ／ 秘境集結</small><h2>秘境討伐</h2><p>1–4 人共用 Boss；每位玩家各自作答，不互相等待。</p></div><span class="raid-seal">團</span></header>' +
      '<article class="raid-boss-card ' + (locked ? 'locked' : '') + '">' +
      '<div class="raid-boss-art"><img src="' + RAID_MVP.bossImage + '" alt="沈清霜"><span>多人 Boss</span></div>' +
      '<div class="raid-boss-info"><div class="raid-badges"><span>1–4 人</span></div>' +
      '<small>青雲山・演武秘境</small><h3>' + RAID_MVP.bossTitle + '</h3>' +
      '<p>與隊友一同迎戰大師姐。答對即可出手，Boss 出招時會切回戰場呈現攻防結果。</p>' +
      '<div class="raid-join-grid"><button class="raid-primary" type="button" data-quick ' + (locked ? 'disabled' : '') + '>快速加入／建立隊伍</button>' +
      '<button class="raid-ghost" type="button" data-create ' + (locked ? 'disabled' : '') + '>建立私人隊伍</button></div>' +
      '<div class="raid-code-join"><input id="raid-room-code-input" maxlength="6" placeholder="輸入 6 碼隊伍代碼"><button class="raid-ghost" type="button" data-code ' + (locked ? 'disabled' : '') + '>加入隊伍</button></div>' +
      '</div></article>';
    scheduleRaidHubFit();
    setTimeout(scheduleRaidHubFit, 120);
    setTimeout(scheduleRaidHubFit, 360);
    hub.querySelector('[data-home]')?.addEventListener('click', function () {
      window.switchToPage?.('page-home');
      syncRaidViewportLock();
    });
    hub.querySelector('[data-quick]')?.addEventListener('click', function () { void enterRoom('quick'); });
    hub.querySelector('[data-create]')?.addEventListener('click', function () { void enterRoom('create'); });
    hub.querySelector('[data-code]')?.addEventListener('click', function () {
      void enterRoom('code', document.getElementById('raid-room-code-input')?.value || '');
    });
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
          hostAvatar: data()?.equipped?.avatar || '',
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
  function partyMarkup(alive, recent) {
    const members = raidRoomMembers(state.room);
    const count = Math.max(1, Math.min(4, members.length));
    const cards = members.map(member => {
      const pct = hpPct(member.hp, member.maxHp);
      const isMe = String(member.uid || '') === String(state.player?.uid || '');
      const hpId = isMe ? ' id="raid-player-hp-text"' : '';
      const barId = isMe ? ' id="raid-player-hp-bar"' : '';
      return '<article class="raid-stage-player ' + (isMe ? 'me ' : '') + (member.alive === false ? 'down' : '') + '">' +
        '<div class="raid-stage-player-art"><img src="' + escapeHtml(member.portrait || state.player?.portrait || '') + '" alt="' + escapeHtml(member.name || '玩家') + '"></div>' +
        '<div class="raid-stage-player-info"><strong>' + escapeHtml(member.name || '無名修士') + (isMe ? '<em>你</em>' : '') + '</strong>' +
        '<small' + hpId + '>' + Math.max(0, Number(member.hp) || 0).toLocaleString() + ' HP</small>' +
        '<div class="raid-stage-player-hp"><i' + barId + ' style="width:' + pct + '%"></i></div>' +
        '<span>輸出 ' + Math.max(0, Number(member.damage) || 0).toLocaleString() + '</span></div></article>';
    }).join('');
    return '<section class="raid-party-floor"><div class="raid-player-lineup" style="grid-template-columns:repeat(' + count + ',minmax(0,1fr))">' +
      cards + '</div><div class="raid-party-controls"><div class="raid-current-status"><span>' +
      escapeHtml(alive ? recent : '你已倒下，等待隊友完成本次試煉。') + '</span><small>個人題號 ' + (state.playerActionCount + 1) +
      '・法寶護盾 ' + Math.round(state.player.artifactShield || 0).toLocaleString() +
      '・' + (state.player.coreShield ? '道心護體已凝聚' : '道心護體未凝聚') + '</small></div>' +
      '<button class="raid-primary raid-fight" type="button" data-question ' + (!alive ? 'disabled' : '') + '>' +
      (!alive ? '觀戰中' : state.question ? '繼續作答' : state.questionLoading ? '題目準備中…' : '準備下一題') +
      '</button></div></section>';
  }

  function renderArena() {
    if (!state.player || !state.boss || !state.room) return renderHub();
    document.body.classList.add('raid-session-active');
    show('arena');
    syncRaidBottomClearance();
    const clock = currentBossClock();
    const intent = currentIntent();
    const arena = document.getElementById('raid-arena');
    const recent = state.lastPlayerAction?.correct ? '你剛才命中 ' + state.lastPlayerAction.damage.toLocaleString() + ' 傷害。' :
      state.lastPlayerAction ? '上一題沒有形成有效攻勢。' : '大師姐已拔劍。';
    const alive = state.player.hp > 0 && myRoomMember()?.alive !== false;
    arena.innerHTML =
      '<header class="raid-battle-head"><button class="raid-back" type="button" data-leave><i class="fa-solid fa-door-open"></i></button>' +
      '<div><small>清霜試煉・' + raidRoomMembers(state.room).length + ' 人隊伍</small><strong>Boss 已出招 ' + state.bossActionCount + ' 次</strong></div>' +
      '<span>階段 ' + state.boss.phase + '・' + phaseName(state.boss.phase) + '</span></header>' +
      '<div class="raid-stage"><section class="raid-boss-side"><div class="raid-name-row"><div><small>BOSS</small><h3>' + state.boss.name + '</h3></div>' +
      '<b id="raid-boss-hp-text">' + Math.round(state.boss.hp).toLocaleString() + ' / ' + Math.round(state.boss.maxHp).toLocaleString() + '</b></div>' +
      '<div class="raid-hp boss"><i id="raid-boss-hp-bar" style="width:' + hpPct(state.boss.hp, state.boss.maxHp) + '%"></i></div>' +
      '<div class="raid-boss-portrait"><div class="raid-boss-aura"></div><img src="' + state.boss.image + '" alt="沈清霜"><span>「' + escapeHtml(intent.name) + '」</span></div>' +
      '<div class="raid-intent ' + intent.kind + '"><i class="fa-solid fa-khanda"></i><div><b>' + escapeHtml(intent.name) + '</b><span>' + escapeHtml(intent.cue) + '</span></div>' +
      '<em id="raid-boss-clock">' + (clock ? (clock.remainingMs / 1000).toFixed(1) : '18.0') + ' 秒</em></div></section>' +
      partyMarkup(alive, recent) + '</div>';
    arena.querySelector('[data-leave]')?.addEventListener('click', leaveRaid);
    arena.querySelector('[data-question]')?.addEventListener('click', function () { void openNextQuestion(); });
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
    const returnStatus = state.status;
    const returnToQuestion = !!state.question && ['question', 'review'].includes(returnStatus);
    const token = ++state.battleSceneToken;
    state.battleScenePlaying = true;
    setRaidCombatFocus(true);
    renderArena();

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
    if (token !== state.battleSceneToken) return;

    notice.remove();
    stage?.classList.remove('raid-player-strike', 'raid-boss-strike');
    state.battleScenePlaying = false;
    setRaidCombatFocus(false);

    if (state.pendingFinishRoom) {
      const terminal = state.pendingFinishRoom;
      state.pendingFinishRoom = null;
      state.room = terminal;
      finishRaid(terminal.status === 'won', terminal.status === 'won' ? 'boss-defeated' : 'team-defeated');
      return;
    }

    if (state.room?.status === 'active' && returnToQuestion && state.question) {
      state.status = returnStatus;
      renderQuestion(returnStatus === 'review');
    }
  }

  async function prefetchQuestion() {
    if (state.questionLoading || state.pendingQuestion || !state.scope || state.room?.status !== 'active') return;
    state.questionLoading = true;
    try {
      const targetAction = state.playerActionCount + (state.status === 'question' ? 2 : 1);
      const generated = await generateRaidQuestion({
        scope: state.scope,
        round: targetAction,
        rank: state.player.rankLevel,
        history: state.history,
        roomId: state.roomId
      });
      if (state.room?.status === 'active') state.pendingQuestion = generated;
    } catch (error) {
      console.warn('[Raid] question generation failed:', error);
      toast('題目生成失敗，請再試一次。');
    } finally {
      state.questionLoading = false;
    }
  }

  async function openNextQuestion() {
    if (state.room?.status !== 'active' || state.player?.hp <= 0 || state.status === 'question') return;
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
    document.body.classList.add('raid-session-active');
    show('question');
    syncRaidBottomClearance();
    const view = document.getElementById('raid-question');
    const opts = q.opts.map(function (option, i) {
      let cls = '';
      if (review && i === q.ans) cls = ' correct';
      else if (review && i === state.selectedChoice && i !== q.ans) cls = ' wrong';
      return '<button class="raid-option' + cls + '" type="button" data-choice="' + i + '" ' + (review ? 'disabled' : '') + '><span>' +
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
      (state.playerActionCount + (review ? 0 : 1)) + '</strong></div><span id="raid-question-timer">不限時</span></header>' +
      '<div class="raid-question-boss"><img src="' + RAID_MVP.bossImage + '" alt="沈清霜"><span id="raid-question-boss-clock">Boss 行動倒數</span></div>' +
      '<h2>' + rich(q.q) + '</h2><div class="raid-options">' + opts + '</div>' + explain + '</div>';
    typeset(view);
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

    // Freeze the question while the server verifies the encrypted answer ticket and resolves combat.
    state.selectedChoice = selectedChoice;
    state.status = 'submitting';
    renderQuestion(false);
    try {
      const result = await commitRaidPlayerAction({
        roomId: state.roomId,
        actionId,
        questionId: question.id,
        choice: selectedChoice,
        ticket: question.ticket
      });
      const resolution = result?.resolution;
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
        showCorrectAnswerFeedback(dealt > 0 ? '攻勢命中・' + dealt.toLocaleString() + ' 傷害' : '攻勢已凝聚');
      }

      if (state.answerCorrect && state.lastPlayerAction.damage > 0) {
        await playBattleScene({
          attacker: 'player',
          actionName: '破勢一擊',
          damage: state.lastPlayerAction.damage,
          healed: state.lastPlayerAction.healed
        });
      } else if (state.pendingFinishRoom) {
        const terminal = state.pendingFinishRoom;
        state.pendingFinishRoom = null;
        finishRaid(terminal.status === 'won', terminal.status === 'won' ? 'boss-defeated' : 'team-defeated');
      } else {
        renderQuestion(true);
      }
    } catch (error) {
      console.error('[Raid] authoritative action failed:', error);
      state.selectedChoice = null;
      state.answerCorrect = null;
      state.status = 'question';
      toast(error.message || '出手結算失敗，請再作答一次。');
      renderQuestion(false);
    }
    updateHomeEntry();
  }

  async function applyRemoteBossAction(action) {
    if (!action || state.applyingBossAction || Number(action.id) <= state.lastBossActionSeen ||
        !state.player || state.player.hp <= 0) return;
    state.applyingBossAction = true;
    try {
      // The browser reports only which server-issued Boss action it is acknowledging.
      // HP, mitigation, shields and reflection are all resolved from the trusted room snapshot.
      const result = await commitRaidBossDefense({
        roomId: state.roomId,
        bossActionSeen: Number(action.id)
      });
      const resolution = result?.resolution;
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
        defenseSkill: ''
      });
    } catch (error) {
      console.error('[Raid] authoritative boss action failed:', error);
    } finally {
      state.applyingBossAction = false;
    }
  }

  async function maybeAdvanceBoss() {
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
    if (state.room?.status !== 'active') return;
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
  }

  function startTick() {
    stopTick();
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
      // Boss HP and attack are scaled from the server-trusted member snapshots.
      await startRaidRoom(state.roomId);
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
      state.lastBossActionSeen = Math.max(state.lastBossActionSeen, Number(mine.lastBossActionSeen) || 0);
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

  function handleRoomSnapshot(room) {
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
    if (mine && state.player) {
      Object.assign(state.player, mine);
      state.playerActionCount = Math.max(state.playerActionCount, Number(mine.lastActionId) || 0);
      state.lastBossActionSeen = Math.max(state.lastBossActionSeen, Number(mine.lastBossActionSeen) || 0);
    }
    if (room.status === 'waiting') {
      stopTick();
      renderLobby();
      return;
    }
    if (room.status === 'active') {
      void beginActiveRaid(room);
      if (room.lastBossAction && Number(room.lastBossAction.id) > state.lastBossActionSeen) void applyRemoteBossAction(room.lastBossAction);
      updateLiveLabels();
      return;
    }
    if (room.status === 'won' || room.status === 'lost') {
      if (state.battleScenePlaying) {
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
    state.rewardClaiming = true;
    const status = document.getElementById('raid-reward-status');
    if (status) status.textContent = '正在由伺服器核對團本紀錄…';
    try {
      const payload = await rewardRepository.claimRaid(state.roomId);

      state.rewardClaimedRoomId = state.roomId;
      const local = data();
      if (local) {
        local.materialSystem = local.materialSystem && typeof local.materialSystem === 'object'
          ? local.materialSystem : { inventory:{} };
        local.materialSystem.inventory = local.materialSystem.inventory && typeof local.materialSystem.inventory === 'object'
          ? local.materialSystem.inventory : {};
        Object.entries(payload.inventory || {}).forEach(([id, quantity]) => {
          local.materialSystem.inventory[id] = Math.max(0, Math.floor(Number(quantity) || 0));
        });
      }
      window.dispatchEvent(new CustomEvent('material-system-updated', {
        detail: { ...(local?.materialSystem || {}), raidReward:true }
      }));
      const second = Number(payload.rewards?.['raid-refine-key-ii']) || 0;
      const third = Number(payload.rewards?.['raid-refine-key-iii']) || 0;
      if (status) status.innerHTML = payload.awarded
        ? '<b>團本獎勵已入帳</b><small>淬靈玄印 ×' + second + '・玄天道印 ×' + third + '</small>'
        : '<b>本場獎勵已領取</b><small>伺服器已阻止重複發放。</small>';
    } catch (error) {
      console.error('[Raid] trusted reward claim failed:', error);
      if (status) status.innerHTML = '<b>獎勵尚未入帳</b><small>' + escapeHtml(error?.message || '請稍後再試') + '</small>' +
        '<button type="button" class="raid-ghost" data-retry-reward>重新領取</button>';
      document.querySelector('[data-retry-reward]')?.addEventListener('click', function () {
        state.rewardClaiming = false;
        void claimRaidReward();
      }, { once:true });
    } finally {
      state.rewardClaiming = false;
    }
  }

  function finishRaid(won, reason) {
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
        Math.max(0, Number(member.correct) || 0) + ' / ' + Math.max(0, Number(member.attempts) || 0) + ' 答對</small></div>').join('') + '</div>' +
      '<div class="raid-prototype-note"><i class="fa-solid fa-gem"></i><span id="raid-reward-status"><b>' + (won ? '可信任獎勵結算' : '本場無勝利獎勵') + '</b><small>' + (won ? 'Render 正在核對 C 專案團本紀錄，通過後才會把二煉／三煉關鍵道具寫入 A 專案。' : '擊敗 Boss 後才會由伺服器發放關鍵道具。') + '</small></span></div>' +
      '<div class="raid-result-actions"><button class="raid-ghost" type="button" data-home>返回仙府</button><button class="raid-primary" type="button" data-again>重新組隊</button></div></div>';
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
      battleSceneToken: state.battleSceneToken + 1, battleScenePlaying: false, pendingFinishRoom: null, invitedRoomId: '',
      rewardClaiming: false, rewardClaimedRoomId: ''
    });
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
      multiplayer: true
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
    window.addEventListener('xiuxian:user-ready', function () {
      mountHomeEntry();
      updateHomeEntry();
      void tryReconnect();
    });
    window.addEventListener('xiuxian:stats-updated', updateHomeEntry);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
