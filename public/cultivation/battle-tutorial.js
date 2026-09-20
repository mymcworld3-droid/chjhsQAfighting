import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// 築基鬥法教學：完全本機模擬，不建立 rooms、不寫正式戰績。
// 第一戰固定由沈清霜以 65,000 真實傷害擊倒演武投影；第二戰再由顧長風教正式鬥法規則。
(function () {
  'use strict';

  const FIELD = 'battleTutorialV1';
  const VERSION = 1;
  const FOUNDATION_SCORE = 10;
  const TRUE_DAMAGE = 65000;
  const SHEN_ANSWER_WINDOW_MS = 25000;
  // 高等微積分：用幾何級數和交錯 ζ(3) 求精確值。師姐先手是第一戰劇情特例。
  const SHEN_QUESTION = Object.freeze({
    q: '設 ζ(3)＝Σ(n＝1 至 ∞) 1/n³。求定積分 ∫₀¹ (ln x)²／(1＋x) dx 的精確值。',
    opts: ['2ζ(3)', '3ζ(3)／2', '7ζ(3)／4', 'π³／16'],
    ans: 1,
    exp: '將 1／(1＋x) 展成交錯幾何級數；逐項積分得 2Σ(n＝1 至 ∞)(−1)⁽ⁿ⁻¹⁾／n³＝2(1−2⁻²)ζ(3)＝3ζ(3)／2。'
  });
  const LAYER_ID = 'battle-tutorial-layer';
  const STYLE_ID = 'battle-tutorial-style';

  const QUESTIONS = Object.freeze([
    Object.freeze({
      q: '鬥法中，你答對題目時最重要的效果是？',
      opts: ['取得出手機會', '立刻回滿生命', '直接結束整場鬥法', '扣除自己的生命'],
      ans: 0,
      exp: '答對就能出手；即使對手比你更早答對，你也能攻擊。'
    }),
    Object.freeze({
      q: '如果你答錯，而顧長風答對，這一回合會怎樣？',
      opts: ['你仍然能造成傷害', '雙方都不會行動', '你不造成傷害，顧長風出手', '自動判定平局'],
      ans: 2,
      exp: '錯答本身不會造成傷害；對手答對時，就可能取得攻擊。'
    }),
    Object.freeze({
      q: '正式鬥法中，第一位玩家作答後，另一方有多久必須回應？',
      opts: ['5 秒', '10 秒', '25 秒', '60 秒'],
      ans: 2,
      exp: '題目原本不倒數；第一位玩家提交答案後，才會啟動另一方的 25 秒應答窗。'
    }),
    Object.freeze({
      q: '如果雙方都答對，這一回合誰能攻擊？',
      opts: ['雙方都能出手', '只有較早答對的一方', '生命較低的一方', '完全隨機'],
      ans: 0,
      exp: '雙方都答對就雙方都出手，無論誰先作答；傷害同時結算，也可能同時倒下。'
    })
  ]);

  let previewOnly = false;
  let startedByStory = false;
  let tutorialPhase = 'shen';
  let shenTimer = null;
  let shenDeadline = 0;
  let shenChoice = null;
  let active = false;
  let busy = false;
  let stage = 'intro';
  let guRound = 0;
  let guCorrect = 0;
  let playerHp = 1000;
  let guHp = 2000;
  let snoozeUntil = 0;
  let autoStarted = false;

  function data() { return window.getCurrentUserData?.() || null; }
  function user() {
    try { return getAuth(getApp()).currentUser; } catch (_) { return null; }
  }
  function score() { return Math.max(0, Number(data()?.stats?.totalScore) || 0); }
  function marker() { return data()?.[FIELD] || {}; }
  function storySeen() { return !!data()?.storyProgressV1?.seen?.['foundation-first-battle']; }
  function gender() { return data()?.storyProgressV1?.gender === 'female' ? 'female' : 'male'; }
  function playerName() {
    const d = data() || {};
    return window.getPlayerDisplayName?.(d, user()?.displayName || '無名修士')
      || d.displayName || user()?.displayName || '無名修士';
  }
  function playerPortrait(expression = 'neutral') {
    const allowed = new Set(['neutral','confused','happy','determined']);
    const e = allowed.has(expression) ? expression : 'neutral';
    return `assets/story/characters/player-${gender()}-${e}.png`;
  }
  function esc(value) {
    return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
      .replaceAll('"','&quot;').replaceAll("'",'&#039;');
  }
  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  function clearShenTimer() {
    if (shenTimer !== null) clearInterval(shenTimer);
    shenTimer = null;
  }
  function closeTutorialArena() {
    document.getElementById('bv2-arena')?.classList.remove('bt-tutorial-active');
    window.closeBattleTutorialArena?.();
  }

  async function persist(patch) {
    if (previewOnly) return;
    const d = data(), u = user();
    if (!d) return;
    const next = { version: VERSION, ...(d[FIELD] || {}), ...patch, updatedAtMs: Date.now() };
    d[FIELD] = next;
    if (!u) return;
    try {
      await updateDoc(doc(getFirestore(getApp()), 'users', u.uid), { [FIELD]: next });
    } catch (error) {
      console.warn('[Battle tutorial] progress persistence failed:', error);
    }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${LAYER_ID}{position:relative;width:100%;color:#e9dfc8}
      #${LAYER_ID} .bt-shell{width:100%;background:transparent}
      #${LAYER_ID} .bt-head{display:flex;align-items:start;justify-content:space-between;gap:12px;padding:17px 19px;border-bottom:1px solid rgba(216,177,93,.12)}
      #${LAYER_ID} .bt-head small{display:block;color:#9b824d;font-size:8px;font-weight:900;letter-spacing:.18em}#${LAYER_ID} .bt-head h2{margin:4px 0 0;color:#f0e2bd;font-size:19px}
      #${LAYER_ID} .bt-later{border:1px solid rgba(255,255,255,.08);border-radius:10px;background:#0b0c0b;color:#817a6d;padding:8px 11px;font-size:8px;font-weight:900}
      #${LAYER_ID} .bt-arena{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 84px minmax(0,1fr);gap:10px;align-items:stretch;padding:16px 18px 8px;overflow:hidden}
      #${LAYER_ID} .bt-arena:before{content:"";position:absolute;inset:10px 20%;background:radial-gradient(circle,rgba(216,177,93,.08),transparent 65%);pointer-events:none}
      #${LAYER_ID} .bt-fighter{position:relative;min-height:255px;overflow:hidden;border:1px solid rgba(216,177,93,.18);border-radius:18px;background:linear-gradient(145deg,rgba(24,22,16,.92),rgba(7,7,6,.96))}
      #${LAYER_ID} .bt-fighter.enemy{border-color:rgba(181,79,62,.28)}
      #${LAYER_ID} .bt-fighter img{position:absolute;inset:38px 0 34px;width:100%;height:calc(100% - 72px);object-fit:contain;object-position:center bottom;filter:drop-shadow(0 12px 25px rgba(0,0,0,.48));pointer-events:none}
      #${LAYER_ID} .bt-fighter-head{position:relative;z-index:3;display:flex;justify-content:space-between;gap:10px;padding:10px 11px 0}.bt-fighter-head span{display:block;color:#756b59;font-size:7px}.bt-fighter-head strong{display:block;color:#eadcbb;font-size:11px}.bt-fighter-head b{color:#d7b968;font-size:9px}
      #${LAYER_ID} .bt-hp{position:absolute;z-index:3;left:10px;right:10px;bottom:10px;height:8px;border:1px solid rgba(255,255,255,.05);border-radius:999px;background:#17130d;overflow:hidden}.bt-hp i{display:block;height:100%;background:linear-gradient(90deg,#826322,#e3bf61);transition:width .45s ease}.bt-fighter.enemy .bt-hp i{background:linear-gradient(90deg,#743629,#cc705c)}
      #${LAYER_ID} .bt-vs{display:grid;place-items:center;align-self:center;height:74px;border:1px solid rgba(216,177,93,.16);border-radius:50%;background:#0b0a07;color:#d5b55f;font-size:18px;font-weight:1000;box-shadow:0 0 35px rgba(216,177,93,.05)}
      #${LAYER_ID} .bt-fighter.strike{animation:btStrike .42s ease-out}#${LAYER_ID} .bt-fighter.hit{animation:btHit .5s ease-out}
      @keyframes btStrike{45%{transform:translateX(12px) scale(1.025)}100%{transform:none}}@keyframes btHit{20%{transform:translateX(-8px);filter:brightness(1.7)}45%{transform:translateX(7px)}70%{transform:translateX(-3px)}100%{transform:none;filter:none}}
      #${LAYER_ID} .bt-slash{position:absolute;z-index:7;left:34%;top:11%;width:4px;height:78%;background:linear-gradient(180deg,transparent,#fff2bd 22%,#d9a849 55%,transparent);transform:rotate(54deg) scaleY(0);filter:drop-shadow(0 0 12px #f2ce78);pointer-events:none}.bt-slash.go{animation:btSlash .44s ease-out}@keyframes btSlash{30%{transform:rotate(54deg) scaleY(1);opacity:1}100%{transform:rotate(54deg) scaleY(1.25);opacity:0}}
      #${LAYER_ID} .bt-damage{position:absolute;z-index:9;left:72%;top:32%;transform:translate(-50%,-50%);text-align:center;color:#ff806d;font-size:32px;font-weight:1000;text-shadow:0 5px 18px #000;pointer-events:none;animation:btDamage 1s ease-out forwards}.bt-damage small{display:block;margin-top:2px;color:#ffc6b9;font-size:9px;letter-spacing:.12em}@keyframes btDamage{0%{opacity:0;transform:translate(-50%,-20%) scale(.65)}22%{opacity:1;transform:translate(-50%,-50%) scale(1.16)}100%{opacity:0;transform:translate(-50%,-105%) scale(1)}}
      #${LAYER_ID} .bt-body{padding:10px 18px 18px}.bt-dialogue{padding:14px;border:1px solid rgba(216,177,93,.13);border-radius:16px;background:rgba(216,177,93,.03)}.bt-speaker{color:#d9b85f;font-size:8px;font-weight:900;letter-spacing:.1em}.bt-dialogue p{margin:7px 0 0;color:#d9ceb4;font-size:12px;line-height:1.75}
      #${LAYER_ID} .bt-rule{margin:10px 0;padding:10px 12px;border-left:2px solid #aa863d;background:rgba(216,177,93,.035);color:#8e836e;font-size:9px;line-height:1.7}.bt-rule strong{color:#d7ba73}
      #${LAYER_ID} .bt-question{margin-top:10px;padding:15px;border:1px solid rgba(216,177,93,.15);border-radius:17px;background:rgba(0,0,0,.22)}.bt-question-meta{display:flex;justify-content:space-between;color:#987d49;font-size:8px;font-weight:900}.bt-question h3{margin:9px 0 12px;color:#eee2c5;font-size:14px;line-height:1.6}.bt-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.bt-option{min-height:49px;padding:9px 11px;border:1px solid rgba(216,177,93,.15);border-radius:12px;background:rgba(255,255,255,.025);color:#d5c5a4;text-align:left;font-size:10px;font-weight:800}.bt-option:hover:not(:disabled){border-color:rgba(216,177,93,.46);background:rgba(216,177,93,.07)}.bt-option.correct{border-color:rgba(94,169,112,.56);background:rgba(57,126,73,.14);color:#bde0bf}.bt-option.wrong{border-color:rgba(194,80,64,.54);background:rgba(142,49,39,.14);color:#e2aaa1}.bt-option:disabled{cursor:default}
      #${LAYER_ID} .bt-explain{margin-top:10px;padding:10px;border-radius:12px;background:rgba(255,255,255,.025);color:#918774;font-size:9px;line-height:1.65}.bt-explain b{color:#d6b766}
      #${LAYER_ID} .bt-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.bt-primary{min-height:40px;padding:0 17px;border:1px solid rgba(216,177,93,.55);border-radius:12px;background:linear-gradient(135deg,#8d6623,#50360e);color:#fff0c5;font-size:9px;font-weight:1000}.bt-primary:disabled{opacity:.48}
      #${LAYER_ID} .bt-result{text-align:center;padding:10px 4px 2px}.bt-result-mark{display:grid;place-items:center;width:72px;height:72px;margin:0 auto 10px;border:1px solid rgba(216,177,93,.25);border-radius:50%;color:#d7b55b;font:900 33px serif}.bt-result h3{margin:0;color:#f0e1bd;font-size:18px}.bt-result p{margin:7px auto 0;max-width:620px;color:#968b76;font-size:10px;line-height:1.7}
      @media(max-width:650px){#${LAYER_ID}{padding:6px}#${LAYER_ID} .bt-head{padding:12px}#${LAYER_ID} .bt-arena{grid-template-columns:1fr 48px 1fr;padding:10px 9px 5px;gap:5px}#${LAYER_ID} .bt-fighter{min-height:205px}#${LAYER_ID} .bt-fighter img{inset:34px 0 30px;height:calc(100% - 64px)}#${LAYER_ID} .bt-fighter-head b{font-size:7px}#${LAYER_ID} .bt-body{padding:8px 9px 12px}.bt-options{grid-template-columns:1fr}.bt-damage{left:68%;font-size:25px}}
      /* 正式鬥法使用兩欄 grid；教學改為橫跨整個演武場，不能被擠進側欄。 */
      #page-battle .bv2-arena.bt-tutorial-active{display:block!important;grid-template-columns:none!important;grid-template-rows:none!important;grid-template-areas:none!important;width:100%!important;min-height:0!important;height:auto!important;max-height:none!important;margin:0!important;padding:0!important;overflow:visible!important}
      #page-battle .bv2-arena.bt-tutorial-active #${LAYER_ID}{display:block;width:100%;min-width:0;max-width:1100px;margin:0 auto}
      #${LAYER_ID} .bt-shell{display:flex;flex-direction:column;gap:clamp(8px,1.2dvh,14px);width:100%;min-width:0;padding-bottom:18px}
      #${LAYER_ID} .bt-head{flex:0 0 auto}
      #${LAYER_ID} .bt-arena{grid-template-columns:minmax(0,1fr) clamp(44px,7vw,75px) minmax(0,1fr);height:clamp(170px,30dvh,290px);min-height:0;padding:5px 2px;gap:clamp(4px,1vw,12px)}
      #page-battle .bv2-arena.bt-tutorial-active .bt-fighter{min-width:0;min-height:0!important;height:100%;padding:0!important}
      #${LAYER_ID} .bt-fighter img{inset:28px 0 19px;width:100%;height:calc(100% - 47px)}
      #${LAYER_ID} .bt-body{flex:1;min-width:0;padding:0 2px 12px}
      #${LAYER_ID} .bt-question{margin:0;padding:clamp(11px,1.5vw,19px);overflow-wrap:anywhere}
      #${LAYER_ID} .bt-question h3{font-size:clamp(13px,1.5vw,19px)}
      #${LAYER_ID} .bt-options{grid-template-columns:repeat(2,minmax(0,1fr))}
      #${LAYER_ID} .bt-option{min-width:0;min-height:clamp(40px,6dvh,56px);font-size:clamp(11px,1vw,14px);overflow-wrap:anywhere}
      #${LAYER_ID} .bt-shen-timer{font-variant-numeric:tabular-nums;font-size:clamp(13px,1.3vw,19px);color:#ffe29a;font-weight:900}
      #${LAYER_ID} .bt-shen-timer.urgent{color:#ff8273}
      #${LAYER_ID} .bt-explain{font-size:clamp(10px,.95vw,13px)}
      #${LAYER_ID} .bt-result{padding:clamp(8px,1.6vw,18px)}
      @media(max-width:650px){
        #${LAYER_ID} .bt-head{padding:9px 5px;gap:6px}
        #${LAYER_ID} .bt-head h2{font-size:clamp(15px,4vw,20px)}
        #${LAYER_ID} .bt-arena{grid-template-columns:minmax(0,1fr) 36px minmax(0,1fr);height:clamp(135px,23dvh,200px);padding:0;gap:3px}
        #${LAYER_ID} .bt-fighter img{inset:27px 0 15px;height:calc(100% - 42px)}
        #${LAYER_ID} .bt-fighter-head{padding:6px 6px 0}
        #${LAYER_ID} .bt-fighter-head strong{font-size:10px}
        #${LAYER_ID} .bt-fighter-head b{font-size:8px}
        #${LAYER_ID} .bt-vs{height:36px;width:36px;font-size:10px}
        #${LAYER_ID} .bt-options{grid-template-columns:1fr}
        #${LAYER_ID} .bt-option{min-height:40px}
        #${LAYER_ID} .bt-question-meta{gap:8px;flex-wrap:wrap}
        #${LAYER_ID} .bt-actions .bt-primary{width:100%}
      }
      @media(max-height:580px) and (orientation:landscape){
        #${LAYER_ID} .bt-arena{height:115px}
        #${LAYER_ID} .bt-fighter img{inset:25px 0 12px;height:calc(100% - 37px)}
        #${LAYER_ID} .bt-question{padding:10px}
      }
      @media(prefers-reduced-motion:reduce){#${LAYER_ID} *{animation:none!important;transition:none!important}}
    `;
    document.head.appendChild(style);
  }

  function blocking() {
    return !!document.querySelector([
      '#xiuxian-story-layer',
      '#newbie-tutorial-layer',
      '#golden-core-tutorial-layer',
      '#progression-v2-modal',
      '.training-v3-modal-backdrop',
      '#realm-breakthrough-feedback',
      '#dongtian-overlay',
      '#five-immortal-challenge',
      '#report-modal:not(.hidden)'
    ].join(','));
  }

  function layer() {
    ensureStyle();
    let el = document.getElementById(LAYER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = LAYER_ID;
      document.getElementById('bv2-arena').appendChild(el);
      document.getElementById('bv2-arena').classList.add('bt-tutorial-active');
    }
    return el;
  }

  function fighterMarkup({ enemy = false, name, hp, maxHp, image, label }) {
    const pct = Math.max(0, Math.min(100, (Number(hp) || 0) / Math.max(1, Number(maxHp) || 1) * 100));
    return `<article class="bv2-fighter bt-fighter ${enemy ? 'enemy' : 'me'}" data-bt-fighter="${enemy ? 'enemy' : 'me'}">
      <div class="bt-fighter-head"><div><span>${esc(label)}</span><strong>${esc(name)}</strong></div><b>${Math.max(0,Math.round(hp))}</b></div>
      <img src="${esc(image)}" alt="${esc(name)}">
      <div class="bt-hp"><i style="width:${pct}%"></i></div>
    </article>`;
  }

  function shell({ opponent, opponentImage, opponentHp, opponentMaxHp, playerImage = playerPortrait('determined'), body, badge, title, showLater = true }) {
    const el = layer();
    el.innerHTML = `<section class="bt-shell">
      <header class="bt-head"><div><small>${esc(badge)}</small><h2>${esc(title)}</h2></div>${showLater ? '<button type="button" class="bt-later">稍後再練</button>' : ''}</header>
      <div class="bt-arena bv2-scoreboard">
        ${fighterMarkup({ enemy:false, name:playerName(), hp:playerHp, maxHp:1000, image:playerImage, label:'我方 · 演武投影' })}
        <div class="bt-vs bv2-round-seal">VS</div>
        ${fighterMarkup({ enemy:true, name:opponent, hp:opponentHp, maxHp:opponentMaxHp, image:opponentImage, label:'對手' })}
        <i class="bt-slash" aria-hidden="true"></i>
      </div>
      <div class="bt-body">${body}</div>
    </section>`;
    el.querySelector('.bt-later')?.addEventListener('click', snooze);
    return el;
  }

  function renderIntro() {
    shell({
      opponent:'沈清霜',
      opponentImage:'assets/story/characters/shen-qingshuang.png',
      opponentHp:99999,
      opponentMaxHp:99999,
      badge:'築基鬥法教學 · 第一戰',
      title:'先和師姐切磋',
      body:`<div class="bt-rule"><strong>教學戰不計戰績：</strong>不建立正式房間、不消耗道具、不給獎勵，也不會改動你的永久生命值。師姐將立刻答題，你有 25 秒回應。</div>
        <div class="bt-actions"><button type="button" class="bt-primary" data-bt-action="shen-start">進入數學試煉</button></div>`
    }).querySelector('[data-bt-action="shen-start"]')?.addEventListener('click', beginShenQuestion);
  }

  function renderShenQuestion(feedback = null) {
    const answered = feedback !== null;
    const choice = feedback?.choice ?? null;
    const remaining = Math.max(0, Math.ceil((shenDeadline - Date.now()) / 1000));
    const opts = SHEN_QUESTION.opts.map((text, index) => {
      const outcome = answered ? (index === SHEN_QUESTION.ans ? ' correct' : (index === choice ? ' wrong' : '')) : '';
      return `<button type="button" class="bt-option${outcome}" data-bt-shen-choice="${index}" ${answered ? 'disabled' : ''}>${String.fromCharCode(65 + index)}. ${esc(text)}</button>`;
    }).join('');
    const explain = answered
      ? `<div class="bt-explain"><b>${choice === null ? '時間到：玩家未作答。' : choice === SHEN_QUESTION.ans ? '你答對了，但師姐早已答對並取得先手。' : '你答錯了，師姐早已答對並取得先手。'}</b><br>正解：${esc(SHEN_QUESTION.opts[SHEN_QUESTION.ans])}。 ${esc(SHEN_QUESTION.exp)}<br>本場為先手秒殺劇情特例，不代表正式配對的雙方答對規則。</div>`
      : '<div class="bt-explain">沈清霜已秒答。你只剩 25 秒；即使答對，師姐的先手劍意也會先命中。</div>';
    const el = shell({
      opponent:'沈清霜',
      opponentImage:'assets/story/characters/shen-qingshuang.png',
      opponentHp:99999,
      opponentMaxHp:99999,
      badge:'築基鬥法教學 · 高難度數學',
      title:'師姐已作答 · 玩家應答窗',
      showLater:!answered,
      body:`<section class="bt-question"><div class="bt-question-meta"><span>沈清霜 · 立即答對</span><span id="bt-shen-timer" class="bt-shen-timer ${remaining <= 5 ? 'urgent' : ''}">剩餘 ${remaining} 秒</span></div>
        <h3>${esc(SHEN_QUESTION.q)}</h3><div class="bt-options">${opts}</div>${explain}</section>`
    });
    if (!answered) el.querySelectorAll('[data-bt-shen-choice]').forEach(button => button.addEventListener('click', () => runShenStrike(Number(button.dataset.btShenChoice))));
    return el;
  }

  function updateShenTimer() {
    if (!active || stage !== 'shen-question' || busy) return;
    const remaining = Math.max(0, Math.ceil((shenDeadline - Date.now()) / 1000));
    const el = document.getElementById('bt-shen-timer');
    if (el) {
      el.textContent = `剩餘 ${remaining} 秒`;
      el.classList.toggle('urgent', remaining <= 5);
    }
    if (Date.now() >= shenDeadline) runShenStrike(null);
  }

  function beginShenQuestion() {
    if (!active || busy || stage !== 'intro' || tutorialPhase !== 'shen') return;
    clearShenTimer();
    stage = 'shen-question';
    shenDeadline = Date.now() + SHEN_ANSWER_WINDOW_MS;
    shenChoice = null;
    renderShenQuestion();
    shenTimer = setInterval(updateShenTimer, 200);
    updateShenTimer();
  }

  async function runShenStrike(choice = null) {
    if (!active || busy || stage !== 'shen-question') return;
    busy = true;
    // 逾時點擊不能繞過 25 秒限制；作答結果僅決定解析，不影響師姐的先手攻擊。
    shenChoice = Date.now() < shenDeadline && Number.isInteger(choice) && choice >= 0 && choice < SHEN_QUESTION.opts.length ? choice : null;
    clearShenTimer();
    stage = 'shen-strike';
    const el = renderShenQuestion({ choice: shenChoice });
    await delay(480);
    if (!active) return;
    el.querySelector('[data-bt-fighter="enemy"]')?.classList.add('strike');
    el.querySelector('.bt-slash')?.classList.add('go');
    await delay(180);
    if (!active) return;
    el.querySelector('[data-bt-fighter="me"]')?.classList.add('hit');
    const pop = document.createElement('div');
    pop.className = 'bt-damage';
    pop.innerHTML = '-65,000<small>真實傷害 · TRUE DAMAGE</small>';
    el.querySelector('.bt-arena')?.appendChild(pop);
    await delay(650);
    if (!active) return;
    playerHp = 0;
    busy = false;
    renderShenResult();
  }

  // 第一戰結束只返回主線劇情；沈清霜親自說話、邀請顧長風後，才有第二次交棒。
  function renderShenResult() {
    stage = 'shen-result';
    const el = shell({
      opponent:'沈清霜',
      opponentImage:'assets/story/characters/shen-qingshuang.png',
      opponentHp:99999,
      opponentMaxHp:99999,
      playerImage:playerPortrait('confused'),
      badge:'築基鬥法教學 · 第一戰結束',
      title:'沈清霜 · 65,000 真實傷害',
      showLater:false,
      body:`<div class="bt-result"><div class="bt-result-mark">敗</div><h3>演武投影已潰散</h3><p>${shenChoice === null ? '25 秒已結束，未能及時作答。' : shenChoice === SHEN_QUESTION.ans ? '你答對了，但師姐先手命中。' : '你答錯了，師姐先手命中。'}投影承受 65,000 真實傷害；教學不計戰績或場外生命。</p></div>
        <div class="bt-explain"><b>正確答案：${esc(SHEN_QUESTION.opts[SHEN_QUESTION.ans])}</b><br>${esc(SHEN_QUESTION.exp)}</div>
        <div class="bt-actions"><button type="button" class="bt-primary" data-bt-action="return-story">返回主線劇情</button></div>`
    });
    el.querySelector('[data-bt-action="return-story"]')?.addEventListener('click', finishShen);
  }

  function finishShen() {
    if (!active || busy || tutorialPhase !== 'shen') return;
    active = false;
    clearShenTimer();
    document.getElementById(LAYER_ID)?.remove();
    closeTutorialArena();
    const resume = startedByStory;
    startedByStory = false;
    if (resume) {
      window.dispatchEvent(new CustomEvent('xiuxian:story-tutorial-finished', {
        detail: { kind: 'battle-shen', replay: previewOnly, skipped: false }
      }));
    }
  }

  function renderGuIntro() {
    const el = shell({
      opponent:'顧長風',
      opponentImage:'assets/story/characters/battle-rival.png',
      opponentHp:guHp,
      opponentMaxHp:2000,
      badge:'築基鬥法教學 · 第二戰',
      title:'顧長風 · 正式規則演練',
      body:`<div class="bt-rule"><strong>顧長風 · 四回合規則訓練：</strong>師姐說你現在太弱，要我先陪你練基本功。這一場同樣不計戰績。答對才有出手機會；第一位玩家作答後，另一方進入 25 秒應答窗；雙方都答對時，雙方都能出手，傷害同時結算。</div>
        <div class="bt-actions"><button type="button" class="bt-primary" data-bt-action="gu-start">開始四回合教學戰</button></div>`
    });
    el.querySelector('[data-bt-action="gu-start"]')?.addEventListener('click', () => {
      stage = 'gu-round'; renderGuRound();
    });
  }

  function renderGuRound(feedback = null) {
    const question = QUESTIONS[guRound];
    if (!question) { renderGuResult(); return; }
    const answered = !!feedback;
    const opts = question.opts.map((opt, index) => {
      const cls = answered ? (index === question.ans ? ' correct' : (index === feedback.choice && !feedback.correct ? ' wrong' : '')) : '';
      return `<button type="button" class="bt-option${cls}" data-bt-choice="${index}" ${answered ? 'disabled' : ''}>${String.fromCharCode(65+index)}. ${esc(opt)}</button>`;
    }).join('');
    const explain = feedback
      ? `<div class="bt-explain"><b>${feedback.correct ? '答對：雙方都答對，雙方都出手（你造成 500，顧長風造成 220）。' : '答錯：本回合你沒有造成傷害，顧長風反擊。'}</b><br>${esc(question.exp)}</div>`
      : '<div class="bt-explain">教學戰沒有時間壓力；正式配對則會在第一人作答後啟動另一方 25 秒倒數。</div>';
    const action = answered
      ? `<div class="bt-actions"><button type="button" class="bt-primary" data-bt-action="next-round">${guRound >= QUESTIONS.length - 1 ? '查看教學結果' : '下一回合'}</button></div>`
      : '';
    const el = shell({
      opponent:'顧長風',
      opponentImage:'assets/story/characters/battle-rival.png',
      opponentHp:guHp,
      opponentMaxHp:2000,
      badge:`築基鬥法教學 · 顧長風 ${guRound+1}/${QUESTIONS.length}`,
      title:'用答題決定誰能出手',
      showLater:!answered,
      body:`<section class="bt-question"><div class="bt-question-meta"><span>ROUND ${guRound+1}</span><span>教學題 · 不計修為</span></div><h3>${esc(question.q)}</h3><div class="bt-options">${opts}</div>${explain}</section>${action}`
    });
    if (!answered) {
      el.querySelectorAll('[data-bt-choice]').forEach((button) => button.addEventListener('click', () => resolveGuAnswer(Number(button.dataset.btChoice))));
    } else {
      el.querySelector('[data-bt-action="next-round"]')?.addEventListener('click', () => {
        if (busy) return;
        guRound += 1;
        if (guRound >= QUESTIONS.length) renderGuResult();
        else renderGuRound();
      });
    }
  }

  async function resolveGuAnswer(choice) {
    if (busy) return;
    const question = QUESTIONS[guRound];
    if (!question) return;
    busy = true;
    const correct = choice === question.ans;
    // Gu answers every practice question correctly, including double-correct rounds.
    if (correct) {
      guCorrect += 1;
      guHp = Math.max(0, guHp - 500);
    }
    playerHp = Math.max(0, playerHp - 220);
    const feedback = { choice, correct };
    renderGuRound(feedback);
    await delay(80);
    const el = document.getElementById(LAYER_ID);
    const attacker = el?.querySelector(`[data-bt-fighter="${correct ? 'me' : 'enemy'}"]`);
    const target = el?.querySelector(`[data-bt-fighter="${correct ? 'enemy' : 'me'}"]`);
    attacker?.classList.add('strike');
    await delay(110);
    target?.classList.add('hit');
    const pop = document.createElement('div');
    pop.className = 'bt-damage';
    pop.style.left = correct ? '72%' : '28%';
    pop.innerHTML = `-${correct ? '500' : '220'}<small>${correct ? '答對 · 攻擊命中' : '錯答 · 對手反擊'}</small>`;
    el?.querySelector('.bt-arena')?.appendChild(pop);
    if (correct) {
      el?.querySelector('[data-bt-fighter="enemy"]')?.classList.add('strike');
      el?.querySelector('[data-bt-fighter="me"]')?.classList.add('hit');
      const counter = document.createElement('div');
      counter.className = 'bt-damage';
      counter.style.left = '28%';
      counter.innerHTML = '-220<small>顧長風也答對 · 攻擊命中</small>';
      el?.querySelector('.bt-arena')?.appendChild(counter);
    }
    busy = false;
  }

  function renderGuResult() {
    stage = 'gu-result';
    const perfect = guCorrect === QUESTIONS.length;
    const passed = guCorrect >= 3;
    const resultMark = perfect ? '勝' : passed ? '合' : '習';
    const resultTitle = perfect ? '四題全對 · 顧長風生命歸零' : passed ? '規則掌握 · 教學合格' : '完成實戰 · 還需要多練';
    const el = shell({
      opponent:'顧長風',
      opponentImage:'assets/story/characters/battle-rival.png',
      opponentHp:guHp,
      opponentMaxHp:2000,
      badge:'築基鬥法教學 · 第二戰結束',
      title:'顧長風教學戰完成',
      showLater:false,
      body:`<div class="bt-result"><div class="bt-result-mark">${resultMark}</div><h3>${esc(resultTitle)}</h3><p>答對 ${guCorrect} / ${QUESTIONS.length}。這場是本機教學模擬，不會加入正式勝敗紀錄。</p></div>
        <div class="bt-actions"><button type="button" class="bt-primary" data-bt-action="finish">完成鬥法教學</button></div>`
    });
    el.querySelector('[data-bt-action="finish"]')?.addEventListener('click', finish);
  }

  async function finish() {
    if (!active || busy) return;
    busy = true;
    await persist({
      completed:true,
      completedAtMs:Date.now(),
      shenTrueDamage:TRUE_DAMAGE,
      guCorrect,
      guTotal:QUESTIONS.length
    });
    active = false;
    busy = false;
    clearShenTimer();
    document.getElementById(LAYER_ID)?.remove();
    closeTutorialArena();
    if (startedByStory) {
      window.dispatchEvent(new CustomEvent('xiuxian:story-tutorial-finished', {
        detail: { kind: 'battle-gu', replay: previewOnly, skipped: false }
      }));
    }
    startedByStory = false;
    if (previewOnly) return;
    window.dispatchEvent(new CustomEvent('xiuxian:battle-tutorial-completed', {
      detail: { correct: guCorrect, total: QUESTIONS.length, trueDamage: TRUE_DAMAGE }
    }));
  }

  function snooze() {
    if (busy) return;
    clearShenTimer();
    active = false;
    autoStarted = false;
    snoozeUntil = Date.now() + 5 * 60 * 1000;
    document.getElementById(LAYER_ID)?.remove();
    closeTutorialArena();
    if (startedByStory) {
      window.dispatchEvent(new CustomEvent('xiuxian:story-tutorial-finished', {
        detail: { kind: tutorialPhase === 'shen' ? 'battle-shen' : 'battle-gu', replay: previewOnly, deferred: true }
      }));
    }
    startedByStory = false;
  }

  async function start(options = {}) {
    const adminPreview = options.adminPreview === true && data()?.isAdmin === true;
    if (options.adminPreview && !adminPreview) return false;
    if (active || busy || (!adminPreview && score() < FOUNDATION_SCORE)) return false;
    if (!options.replay && marker()?.completed) return false;
    if (!storySeen() && !options.replay && !options.story) return false;
    tutorialPhase = options.phase === 'gu' || ['gu-intro', 'gu-result'].includes(options.scene) ? 'gu' : 'shen';
    try { await window.preloadXiuxianStoryImages?.(); } catch (_) {}
    if (active || busy || !window.openBattleTutorialArena?.()) return false;
    previewOnly = adminPreview || options.replay === true;
    startedByStory = options.story === true;
    active = true;
    window.switchToPage?.('page-battle');
    clearShenTimer();
    shenChoice = null;
    shenDeadline = 0;
    playerHp = 1000; guHp = 2000; guRound = 0; guCorrect = 0; stage = 'intro';
    active = true;
    await persist({ started:true, startedAtMs:marker()?.startedAtMs || Date.now() });
    if (adminPreview && options.scene === 'shen-story') { playerHp = 0; renderShenResult(); }
    else if (adminPreview && options.scene === 'gu-result') renderGuResult();
    else if (tutorialPhase === 'gu') { stage = 'gu-intro'; renderGuIntro(); }
    else renderIntro();
    return true;
  }

  function mountReplayButton() {
    if (!marker()?.completed || document.getElementById('battle-tutorial-replay')) return;
    const actions = document.querySelector('#page-battle .bv2-head-actions');
    if (!actions) return;
    const button = document.createElement('button');
    button.id = 'battle-tutorial-replay';
    button.type = 'button';
    button.className = 'bv2-icon-btn';
    button.title = '重看鬥法教學';
    button.setAttribute('aria-label','重看鬥法教學');
    button.innerHTML = '<i class="fa-solid fa-graduation-cap"></i>';
    button.addEventListener('click', () => window.openXiuxianStoryChapter?.('foundation-first-battle'));
    actions.prepend(button);
  }

  window.pauseBattleTutorial = snooze;
  window.startBattleTutorial = (options = {}) => start(options);
  window.getBattleTutorialState = () => ({
    active, stage, completed:!!marker()?.completed, guRound, guCorrect, trueDamage:TRUE_DAMAGE
  });

  function boot() {
    ensureStyle();
    // 鬥法教程屬於第三章，由劇情交棒；重播也先走完整章節。
    setInterval(mountReplayButton, 1100);
    mountReplayButton();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
