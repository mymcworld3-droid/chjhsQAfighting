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
      body:`<div class="bt-dialogue"><div class="bt-speaker">沈清霜</div><p>正式鬥法之前，先讓你知道站上鬥法臺代表什麼。這裡使用靈識投影，投影敗北不會真的死亡。</p></div>
        <div class="bt-rule"><strong>教學戰不計戰績：</strong>不建立正式房間、不消耗道具、不給獎勵，也不會改動你的永久生命值。</div>
        <div class="bt-actions"><button type="button" class="bt-primary" data-bt-action="shen-start">準備好了 · 開始切磋</button></div>`
    }).querySelector('[data-bt-action="shen-start"]')?.addEventListener('click', runShenStrike);
  }

  async function runShenStrike() {
    if (busy) return;
    busy = true;
    stage = 'shen-strike';
    const el = shell({
      opponent:'沈清霜',
      opponentImage:'assets/story/characters/shen-qingshuang.png',
      opponentHp:99999,
      opponentMaxHp:99999,
      badge:'築基鬥法教學 · 第一戰',
      title:'沈清霜 · 示範一擊',
      showLater:false,
      body:`<div class="bt-dialogue"><div class="bt-speaker">沈清霜</div><p>看清楚。</p></div>`
    });
    await delay(260);
    el.querySelector('[data-bt-fighter="enemy"]')?.classList.add('strike');
    el.querySelector('.bt-slash')?.classList.add('go');
    await delay(180);
    el.querySelector('[data-bt-fighter="me"]')?.classList.add('hit');
    const pop = document.createElement('div');
    pop.className = 'bt-damage';
    pop.innerHTML = '-65,000<small>真實傷害 · TRUE DAMAGE</small>';
    el.querySelector('.bt-arena')?.appendChild(pop);
    await delay(380);
    playerHp = 0;
    stage = 'shen-result';
    busy = false;
    renderShenResult();
  }

  // The second duel is gated by this dialogue, never by a timer.
  const SHEN_AFTER_STRIKE = [
    ['旁白', '劍光散去，沈清霜已經收劍。看著瞬間潰散的投影，她難得怔住，低頭看了看自己的劍。'],
    ['沈清霜', '我已經放水了。'],
    ['沈清霜', '……怎麼就倒了？我分明只留了一絲劍意。'],
    ['沈清霜', '你還能說話。先別動，讓我看看……沒有傷到神識就好。'],
    ['沈清霜', '原來築基修士連這一絲也承受不住。是我估量有誤，不是你的錯。'],
    ['沈清霜', '顧長風，你來陪他練基本鬥法。記住，別真的把人打壞。'],
    ['顧長風', '師姐，您說的一絲，對我們來說可能還是太多了。'],
    ['沈清霜', '嗯。那便不由我示範了。顧長風，按你們能承受的程度來，我在旁邊看著。'],
    ['沈清霜', '別怕。鬥法中的生命只屬於這一場，無論輸贏都不會帶出場外。下一場會重新凝聚完整投影。'],
    ['顧長風', '那就站起來。記住，只要答對就能出手；我們都答對，就各出一招。'],
    ['旁白', '沈清霜收劍退到臺邊。顧長風走上鬥法臺，等你重新凝聚投影。']
  ];
  let shenStoryIndex = 0;

  function renderShenResult() {
    stage = 'shen-story';
    shenStoryIndex = 0;
    renderShenStoryLine();
  }

  function renderShenStoryLine() {
    const [speaker, text] = SHEN_AFTER_STRIKE[shenStoryIndex];
    const last = shenStoryIndex === SHEN_AFTER_STRIKE.length - 1;
    const el = shell({
      opponent:'沈清霜',
      opponentImage:'assets/story/characters/shen-qingshuang.png',
      opponentHp:99999,
      opponentMaxHp:99999,
      playerImage:playerPortrait('confused'),
      badge:'築基鬥法教學 · 戰後劇情',
      title:'一劍之後 · 65,000 真實傷害',
      showLater:false,
      body:`<div class="bt-dialogue" aria-live="polite"><div class="bt-speaker">${esc(speaker === 'player' ? playerName() : speaker)}</div><p>${esc(text)}</p></div>
        <div class="bt-actions"><button type="button" class="bt-primary" data-bt-action="story-next">${last ? '劇情結束 · 顧長風入場' : '點擊繼續'}</button></div>`
    });
    // Each render replaces the preceding handler, so a tap advances exactly one line.
    el.onclick = () => {
      if (!active || busy || stage !== 'shen-story') return;
      el.onclick = null;
      if (!last) {
        shenStoryIndex += 1;
        renderShenStoryLine();
        return;
      }
      stage = 'gu-intro';
      playerHp = 1000; guHp = 2000; guRound = 0; guCorrect = 0;
      renderGuIntro();
    };
    const actor = ['player', '沈清霜'].includes(speaker)
      ? el.querySelector(`[data-bt-fighter="${speaker === 'player' ? 'me' : 'enemy'}"]`) : null;
    actor?.classList.add('strike');
    el.querySelector('[data-bt-action="story-next"]')?.focus({ preventScroll:true });
  }

  function renderGuIntro() {
    const el = shell({
      opponent:'顧長風',
      opponentImage:'assets/story/characters/battle-rival.png',
      opponentHp:guHp,
      opponentMaxHp:2000,
      badge:'築基鬥法教學 · 第二戰',
      title:'顧長風 · 正式規則演練',
      body:`<div class="bt-dialogue"><div class="bt-speaker">顧長風</div><p>師姐說你現在太弱，要我先陪你練基本功。放心，我應該沒有六萬五千真傷。</p></div>
        <div class="bt-dialogue" style="margin-top:8px"><div class="bt-speaker">沈清霜</div><p>他沒有。這一場也只是靈識投影；不論勝負，生命都不會帶回仙府。</p></div>
        <div class="bt-rule"><strong>正式規則：</strong>答對才有出手機會；第一位玩家作答後，另一方進入 25 秒應答窗；雙方都答對時，雙方都能出手，傷害同時結算。</div>
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
    const rivalLine = perfect
      ? '……行。至少不是每個人都會被大師姐一刀之後還敢繼續打。'
      : passed
        ? '還行。真正配對不會有人停下來替你解釋。'
        : '規則至少看過一遍了。下次別把錯題當招式。';
    const el = shell({
      opponent:'顧長風',
      opponentImage:'assets/story/characters/battle-rival.png',
      opponentHp:guHp,
      opponentMaxHp:2000,
      badge:'築基鬥法教學 · 第二戰結束',
      title:'顧長風教學戰完成',
      showLater:false,
      body:`<div class="bt-result"><div class="bt-result-mark">${resultMark}</div><h3>${esc(resultTitle)}</h3><p>答對 ${guCorrect} / ${QUESTIONS.length}。這場是本機教學模擬，不會加入正式勝敗紀錄。</p></div>
        <div class="bt-dialogue" style="margin-top:12px"><div class="bt-speaker">顧長風</div><p>${esc(rivalLine)}</p></div>
        <div class="bt-dialogue" style="margin-top:8px"><div class="bt-speaker">沈清霜</div><p>正式鬥法沒有教學保護。先看題，再出手。</p></div>
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
    document.getElementById(LAYER_ID)?.remove();
    window.closeBattleTutorialArena?.();
    if (startedByStory) {
      window.dispatchEvent(new CustomEvent('xiuxian:story-tutorial-finished', {
        detail: { kind: 'battle', replay: previewOnly, skipped: false }
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
    active = false;
    autoStarted = false;
    snoozeUntil = Date.now() + 5 * 60 * 1000;
    document.getElementById(LAYER_ID)?.remove();
    window.closeBattleTutorialArena?.();
    if (startedByStory) {
      window.dispatchEvent(new CustomEvent('xiuxian:story-tutorial-finished', {
        detail: { kind: 'battle', replay: previewOnly, deferred: true }
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
    try { await window.preloadXiuxianStoryImages?.(); } catch (_) {}
    if (active || busy || !window.openBattleTutorialArena?.()) return false;
    previewOnly = adminPreview || options.replay === true;
    startedByStory = options.story === true;
    active = true;
    window.switchToPage?.('page-battle');
    playerHp = 1000; guHp = 2000; guRound = 0; guCorrect = 0; stage = 'intro';
    active = true;
    await persist({ started:true, startedAtMs:marker()?.startedAtMs || Date.now() });
    if (adminPreview && options.scene === 'shen-story') { playerHp = 0; renderShenResult(); }
    else if (adminPreview && options.scene === 'gu-intro') { stage = 'gu-intro'; renderGuIntro(); }
    else if (adminPreview && options.scene === 'gu-result') renderGuResult();
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
