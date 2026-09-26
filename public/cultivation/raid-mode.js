import { RAID_MVP, createScaledShenBoss, shenPhaseForHp, shenIntentForRound, bossClockState, raidQuestionDeadline, nextPersonalQuestionAt } from './raid-engine.js';
import { snapshotBattleKnowledge, resolveBattleKnowledge } from './battle-question-scope.js';
import { generateRaidQuestion } from './raid-question.js';
import { resolveShenPlayerAction, resolveShenBossAction } from './raid-combat.js';

(function () {
  'use strict';

  const PAGE_ID = 'page-raid';
  const STYLE_HREF = 'styles/raid-mode.css';
  const MALE = 'assets/story/characters/player-male-determined.png';
  const FEMALE = 'assets/story/characters/player-female-determined.png';

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
    questionDeadlineMs: 0,
    nextQuestionAtMs: 0,
    selectedChoice: null,
    answerCorrect: null,
    playerActionCount: 0,
    bossStartedAtMs: 0,
    bossActionCount: 0,
    lastBossAction: null,
    lastPlayerAction: null,
    tickTimer: null,
    questionLoading: false
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
  function storyOpen() {
    return !!document.querySelector('#xiuxian-story-layer,#newbie-tutorial-layer,#battle-tutorial-layer,#golden-core-tutorial-layer,#dongtian-overlay');
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
    if (!page.dataset.raidMvp) {
      page.dataset.raidMvp = '1';
      page.innerHTML = '<section id="raid-hub" class="raid-view"></section>' +
        '<section id="raid-arena" class="raid-view hidden"></section>' +
        '<section id="raid-question" class="raid-view raid-question-view hidden"></section>' +
        '<section id="raid-result" class="raid-view hidden"></section>';
    }
    return page;
  }
  function show(name) {
    const page = ensurePage();
    ['hub', 'arena', 'question', 'result'].forEach(function (id) {
      page.querySelector('#raid-' + id)?.classList.toggle('hidden', id !== name);
    });
    page.dataset.raidView = name;
  }
  function portrait() { return data().storyProgressV1?.gender === 'female' ? FEMALE : MALE; }
  function hpPct(hp, maxHp) {
    return Math.max(0, Math.min(100, (Math.max(0, Number(hp) || 0) / Math.max(1, Number(maxHp) || 1)) * 100));
  }
  function phaseName(phase) { return phase === 1 ? '試劍' : phase === 2 ? '霜意漸盛' : '清霜無聲'; }

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
      name: row.displayName || '無名修士',
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
      '<span class="raid-home-copy"><small>秘境集結 ／ RAID</small><strong>秘境討伐</strong><em>先行試煉：挑戰大師姐・沈清霜</em></span>' +
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
      (isActive() ? '大師姐試煉進行中' : '先行試煉：挑戰大師姐・沈清霜');
  }
  function isActive() {
    return !!state.player && !!state.boss && !['hub', 'finished'].includes(state.status);
  }

  function renderHub() {
    show('hub');
    document.body.classList.remove('raid-session-active');
    const locked = score() < RAID_MVP.minimumScore;
    const hub = document.getElementById('raid-hub');
    hub.innerHTML =
      '<header class="raid-heading"><button class="raid-back" type="button" data-home><i class="fa-solid fa-arrow-left"></i></button>' +
      '<div><small>SECRET REALM ／ 秘境集結</small><h2>秘境討伐</h2><p>玩家各自作答，Boss 依自己的時間軸出招。</p></div><span class="raid-seal">團</span></header>' +
      '<article class="raid-boss-card ' + (locked ? 'locked' : '') + '">' +
      '<div class="raid-boss-art"><img src="' + RAID_MVP.bossImage + '" alt="沈清霜"><span>先行 Boss</span></div>' +
      '<div class="raid-boss-info"><div class="raid-badges"><span>個人題目不同步</span><span>每題 30 秒</span><span>Boss 每 18 秒行動</span></div>' +
      '<small>青雲山・演武秘境</small><h3>' + RAID_MVP.bossTitle + '</h3>' +
      '<p>答題與隊友完全獨立。答對立即形成攻勢；答錯或超時只失去這次攻擊，不會額外吃一次傷害。Boss 不等任何人，每次出招前 5 秒會預告。</p>' +
      '<div class="raid-rule-grid"><div><span>玩家節奏</span><b>獨立題目・獨立倒數</b></div><div><span>最快題目週期</span><b>6 秒，避免連點刷傷害</b></div>' +
      '<div><span>Boss 節奏</span><b>18 秒一式・5 秒預告</b></div><div><span>原型獎勵</span><b>暫不發放永久掉落</b></div></div>' +
      '<div class="raid-future-drop"><i class="fa-solid fa-gem"></i><span><b>正式版掉落預留</b><small>二煉、三煉關鍵道具會在多人房間與可信任後端結算完成後加入。</small></span></div>' +
      '<button class="raid-primary" type="button" data-start ' + (locked ? 'disabled' : '') + '>' +
      (locked ? '需築基初期（' + RAID_MVP.minimumScore + ' 修為）' : isActive() ? '繼續試煉' : '挑戰大師姐') + '</button></div></article>';
    hub.querySelector('[data-home]')?.addEventListener('click', function () { window.switchToPage?.('page-home'); });
    hub.querySelector('[data-start]')?.addEventListener('click', function () {
      if (isActive()) { document.body.classList.add('raid-session-active'); window.switchToPage?.(PAGE_ID); renderArena(); return; }
      void startRaid();
    });
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

  function renderArena() {
    if (!state.player || !state.boss) return renderHub();
    show('arena');
    const clock = currentBossClock();
    const intent = currentIntent();
    const arena = document.getElementById('raid-arena');
    const recent = state.lastPlayerAction?.correct ? '你剛才命中 ' + state.lastPlayerAction.damage.toLocaleString() + ' 傷害。' :
      state.lastPlayerAction ? '上一題沒有形成有效攻勢。' : '大師姐已拔劍。';
    arena.innerHTML =
      '<header class="raid-battle-head"><button class="raid-back" type="button" data-leave><i class="fa-solid fa-door-open"></i></button>' +
      '<div><small>清霜試煉</small><strong>Boss 行動 ' + state.bossActionCount + ' / ' + RAID_MVP.maxBossActions + '</strong></div>' +
      '<span>階段 ' + state.boss.phase + '・' + phaseName(state.boss.phase) + '</span></header>' +
      '<div class="raid-stage"><section class="raid-boss-side"><div class="raid-name-row"><div><small>BOSS</small><h3>' + state.boss.name + '</h3></div>' +
      '<b id="raid-boss-hp-text">' + Math.round(state.boss.hp).toLocaleString() + ' / ' + Math.round(state.boss.maxHp).toLocaleString() + '</b></div>' +
      '<div class="raid-hp boss"><i id="raid-boss-hp-bar" style="width:' + hpPct(state.boss.hp, state.boss.maxHp) + '%"></i></div>' +
      '<div class="raid-boss-portrait"><div class="raid-boss-aura"></div><img src="' + state.boss.image + '" alt="沈清霜"><span>「' + escapeHtml(intent.name) + '」</span></div>' +
      '<div class="raid-intent ' + intent.kind + '"><i class="fa-solid fa-khanda"></i><div><b>' + escapeHtml(intent.name) + '</b><span>' + escapeHtml(intent.cue) + '</span></div>' +
      '<em id="raid-boss-clock">' + (clock ? (clock.remainingMs / 1000).toFixed(1) : '18.0') + ' 秒</em></div></section>' +
      '<section class="raid-player-side"><div class="raid-player-card"><img src="' + state.player.portrait + '" alt="玩家角色"><div><small>挑戰者</small><h3>' + escapeHtml(state.player.name) + '</h3>' +
      '<span>戰力 ' + state.player.combatPower.toLocaleString() + '・攻擊 ' + state.player.atk.toLocaleString() + '</span></div><b id="raid-player-hp-text">' + Math.round(state.player.hp).toLocaleString() + ' HP</b></div>' +
      '<div class="raid-hp player"><i id="raid-player-hp-bar" style="width:' + hpPct(state.player.hp, state.player.maxHp) + '%"></i></div>' +
      '<div class="raid-status-row"><span>個人題號 ' + (state.playerActionCount + 1) + '</span><span>法寶護盾 ' + Math.round(state.player.artifactShield || 0).toLocaleString() + '</span>' +
      '<span>' + (state.player.coreShield ? '道心護體・已凝聚' : '道心護體・未凝聚') + '</span></div><div class="raid-round-summary">' + escapeHtml(recent) + '</div>' +
      '<button class="raid-primary raid-fight" type="button" data-question>' + (state.question ? '繼續作答' : state.questionLoading ? '題目準備中…' : '準備下一題') + '</button></section></div>';
    arena.querySelector('[data-leave]')?.addEventListener('click', leaveRaid);
    arena.querySelector('[data-question]')?.addEventListener('click', function () { void openNextQuestion(); });
  }

  async function prefetchQuestion() {
    if (state.questionLoading || state.pendingQuestion || !state.scope || state.status === 'finished') return;
    state.questionLoading = true;
    try {
      state.pendingQuestion = await generateRaidQuestion({
        scope: state.scope,
        round: state.playerActionCount + 1,
        rank: state.player.rankLevel,
        history: state.history
      });
    } catch (error) {
      console.warn('[Raid] question generation failed:', error);
      toast('題目生成失敗，保留原學習範圍，請再試一次。');
    } finally {
      state.questionLoading = false;
    }
  }

  async function openNextQuestion() {
    if (!isActive() || state.status === 'question') return;
    const wait = Math.max(0, state.nextQuestionAtMs - now());
    if (wait > 0) {
      toast('下一次出手尚需 ' + (wait / 1000).toFixed(1) + ' 秒。');
      return;
    }
    if (!state.pendingQuestion) {
      await prefetchQuestion();
      if (!state.pendingQuestion) return renderArena();
    }
    state.question = state.pendingQuestion;
    state.pendingQuestion = null;
    state.selectedChoice = null;
    state.answerCorrect = null;
    state.questionIssuedAtMs = now();
    state.questionDeadlineMs = raidQuestionDeadline(state.questionIssuedAtMs);
    state.status = 'question';
    renderQuestion(false);
  }

  function renderQuestion(review) {
    const q = state.question;
    if (!q) return renderArena();
    show('question');
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
      const label = state.answerCorrect ? '答對・立即出手' : state.selectedChoice === null ? '時間到・本次失去攻擊' : '答錯・本次失去攻擊';
      explain = '<div class="raid-explain ' + (state.answerCorrect ? 'correct' : 'wrong') + '"><b>' + label + '</b><p>' + rich(q.exp) + '</p>' +
        '<button class="raid-primary" type="button" data-next>下一題</button><button class="raid-ghost" type="button" data-arena>先看戰場</button></div>';
    }
    view.innerHTML = '<div class="raid-question-shell"><header><div><small>' + escapeHtml(q.subject) + '・' + escapeHtml(q.level) + '</small><strong>個人題號 ' +
      (state.playerActionCount + (review ? 0 : 1)) + '</strong></div><span id="raid-question-timer">30.0</span></header>' +
      '<div class="raid-question-boss"><img src="' + RAID_MVP.bossImage + '" alt="沈清霜"><span id="raid-question-boss-clock">Boss 行動倒數</span></div>' +
      '<h2>' + rich(q.q) + '</h2><div class="raid-options">' + opts + '</div>' + explain + '</div>';
    typeset(view);
    if (!review) {
      view.querySelectorAll('[data-choice]').forEach(function (button) {
        button.addEventListener('click', function () { answer(Number(button.dataset.choice)); });
      });
    } else {
      view.querySelector('[data-next]')?.addEventListener('click', function () { void openNextQuestion(); });
      view.querySelector('[data-arena]')?.addEventListener('click', renderArena);
    }
    updateLiveLabels();
  }

  function answer(choice) {
    if (state.status !== 'question' || !state.question) return;
    state.selectedChoice = Number.isInteger(choice) ? choice : null;
    state.answerCorrect = state.selectedChoice !== null && state.selectedChoice === Number(state.question.ans);
    state.questionResolvedAtMs = now();
    state.nextQuestionAtMs = nextPersonalQuestionAt({
      issuedAtMs: state.questionIssuedAtMs,
      resolvedAtMs: state.questionResolvedAtMs
    });
    const action = resolveShenPlayerAction({
      runId: state.runId,
      actionId: state.playerActionCount + 1,
      player: state.player,
      boss: state.boss,
      correct: state.answerCorrect
    });
    state.playerActionCount += 1;
    state.lastPlayerAction = action;
    state.history.push(state.question);
    state.status = 'review';
    state.boss.phase = shenPhaseForHp(state.boss.hp, state.boss.maxHp);
    if (action.bossDefeated) return finishRaid(true, 'boss-defeated');
    void prefetchQuestion();
    renderQuestion(true);
    updateHomeEntry();
  }

  function bossAttack() {
    if (!isActive() || !state.bossStartedAtMs) return;
    const intent = currentIntent();
    state.bossActionCount += 1;
    const result = resolveShenBossAction({
      runId: state.runId,
      actionCount: state.bossActionCount,
      player: state.player,
      boss: state.boss,
      intent
    });
    state.lastBossAction = { intent, result };
    state.boss.phase = shenPhaseForHp(state.boss.hp, state.boss.maxHp);
    if (result.bossDefeated) return finishRaid(true, 'reflect');
    if (result.playerDefeated) return finishRaid(false, 'player-defeated');
    if (state.bossActionCount >= RAID_MVP.maxBossActions) return finishRaid(false, 'enrage');
    toast(result.guarded ? '道心護體擋下「' + intent.name + '」' : '大師姐「' + intent.name + '」造成 ' + result.damage.toLocaleString() + ' 傷害');
    updateLiveLabels();
  }

  function updateLiveLabels() {
    if (!isActive()) return;
    const clock = currentBossClock();
    if (clock?.due) bossAttack();
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
    if (qTimer) {
      if (state.status === 'question') {
        const remain = Math.max(0, state.questionDeadlineMs - now());
        qTimer.textContent = (remain / 1000).toFixed(1);
        qTimer.classList.toggle('urgent', remain <= 6000);
        if (remain <= 0) answer(null);
      } else if (state.status === 'review') {
        const wait = Math.max(0, state.nextQuestionAtMs - now());
        qTimer.textContent = wait > 0 ? '冷卻 ' + (wait / 1000).toFixed(1) : '可續';
      }
    }
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

  async function startRaid() {
    if (score() < RAID_MVP.minimumScore) return toast('需達築基初期（' + RAID_MVP.minimumScore + ' 修為）才可進入秘境。');
    if (storyOpen()) return toast('目前有劇情或教學進行中。');
    state.status = 'loading';
    document.body.classList.add('raid-session-active');
    window.switchToPage?.(PAGE_ID);
    show('question');
    document.getElementById('raid-question').innerHTML = '<div class="raid-question-shell raid-loading"><i class="fa-solid fa-circle-notch fa-spin"></i><h3>正在建立清霜試煉</h3><p>先準備你的第一題；Boss 計時會在題目就緒後才開始。</p></div>';
    try {
      await window.ensureCombatStats?.();
      state.runId = randomId();
      state.player = snapshotPlayer();
      state.boss = createScaledShenBoss({ playerAttack: state.player.atk, playerMaxHp: state.player.maxHp });
      state.scope = resolveBattleKnowledge(state.player.knowledge, state.player.knowledge);
      state.history = [];
      state.playerActionCount = 0;
      state.bossActionCount = 0;
      state.lastBossAction = null;
      state.lastPlayerAction = null;
      state.nextQuestionAtMs = 0;
      await prefetchQuestion();
      if (!state.pendingQuestion) throw new Error('first question unavailable');
      state.bossStartedAtMs = now();
      state.status = 'active';
      startTick();
      await openNextQuestion();
      updateHomeEntry();
    } catch (error) {
      console.error('[Raid] start failed:', error);
      toast('秘境初始化失敗，請重新整理後再試。');
      resetRaid();
      renderHub();
    }
  }

  function finishRaid(won, reason) {
    stopTick();
    state.status = 'finished';
    document.body.classList.remove('raid-session-active');
    show('result');
    const result = document.getElementById('raid-result');
    const title = won ? '試煉突破' : reason === 'enrage' ? '大師姐收劍' : '試煉中止';
    const quote = won ? '「還行。多人時別拖隊友後腿。」' : reason === 'enrage' ? '「十二式已過。下次快一點。」' : '「先把剛才的題目弄懂。」';
    result.innerHTML = '<div class="raid-result-card ' + (won ? 'win' : 'loss') + '"><span class="raid-result-seal">' + (won ? '破' : '止') + '</span>' +
      '<small>SHEN QINGSHUANG TRIAL</small><h2>' + title + '</h2><p>' + quote + '</p><img src="' + RAID_MVP.bossImage + '" alt="沈清霜">' +
      '<div class="raid-result-grid"><div><span>個人作答</span><b>' + state.playerActionCount + ' 題</b></div><div><span>Boss 已出招</span><b>' + state.bossActionCount + ' 次</b></div>' +
      '<div><span>Boss 剩餘生命</span><b>' + Math.round(state.boss?.hp || 0).toLocaleString() + '</b></div><div><span>正式獎勵</span><b>原型版不發放</b></div></div>' +
      '<div class="raid-prototype-note"><i class="fa-solid fa-clock"></i><span><b>不同步規則已啟用</b><small>題目計時屬於玩家本人；Boss 行動時鐘獨立運作。正式多人版只需要將每位隊員各自的 question state 分開同步。</small></span></div>' +
      '<div class="raid-result-actions"><button class="raid-ghost" type="button" data-home>返回仙府</button><button class="raid-primary" type="button" data-again>再次挑戰</button></div></div>';
    result.querySelector('[data-home]')?.addEventListener('click', function () { resetRaid(); window.switchToPage?.('page-home'); });
    result.querySelector('[data-again]')?.addEventListener('click', function () { resetRaid(); void startRaid(); });
    updateHomeEntry();
  }

  function resetRaid() {
    stopTick();
    Object.assign(state, {
      status: 'hub', runId: '', player: null, boss: null, scope: null, question: null, pendingQuestion: null,
      history: [], questionIssuedAtMs: 0, questionResolvedAtMs: 0, questionDeadlineMs: 0, nextQuestionAtMs: 0,
      selectedChoice: null, answerCorrect: null, playerActionCount: 0, bossStartedAtMs: 0, bossActionCount: 0,
      lastBossAction: null, lastPlayerAction: null, questionLoading: false
    });
    document.body.classList.remove('raid-session-active');
    updateHomeEntry();
  }

  function leaveRaid() {
    if (!window.confirm('退出會直接結束本次大師姐試煉，確定離開？')) return;
    resetRaid();
    renderHub();
  }

  function openHub() {
    ensurePage();
    window.switchToPage?.(PAGE_ID);
    if (isActive()) {
      document.body.classList.add('raid-session-active');
      renderArena();
    } else renderHub();
  }

  window.openRaidHub = openHub;
  window.startShenRaid = startRaid;
  window.getRaidMvpState = function () {
    return {
      modeVersion: RAID_MVP.modeVersion,
      status: state.status,
      bossId: state.boss?.id || RAID_MVP.bossId,
      bossHp: state.boss?.hp ?? null,
      playerHp: state.player?.hp ?? null,
      playerActionCount: state.playerActionCount,
      bossActionCount: state.bossActionCount,
      asynchronousQuestions: true,
      prototype: true
    };
  };

  function boot() {
    ensureStyle();
    ensurePage();
    mountHomeEntry();
    renderHub();
    window.addEventListener('xiuxian:user-ready', function () { mountHomeEntry(); updateHomeEntry(); });
    window.addEventListener('xiuxian:stats-updated', updateHomeEntry);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
