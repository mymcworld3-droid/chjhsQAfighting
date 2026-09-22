import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { settleBattleRound } from './battle-engine-v2.js?v=20260921-turnorder3';

// 築基鬥法教學：完全本機模擬，不建立 rooms、不寫正式戰績。
// 第一戰固定由沈清霜以 65,000 真實傷害擊倒演武投影；第二戰再由顧長風教正式鬥法規則。
(function () {
  'use strict';

  const FIELD = 'battleTutorialV1';
  const VERSION = 1;
  const FOUNDATION_SCORE = 10;
  const TRUE_DAMAGE = 65000;
  const SHEN_ANSWER_WINDOW_MS = 25000;
  const ROUND_COUNTDOWN_MS = 3000;
  const GU_ANSWER_WINDOW_MS = 25000;
  const TURN_ANIMATION_MS = 1850;
  const TUTORIAL_IMPACT_MS = 650;
  const TUTORIAL_VISIBLE_MS = 1450;
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
      exp: '雙方都答對時依作答先後出手；先手造成致命傷害，就不再執行後手。'
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
  let playerCombat = null;
  let guPlayer = null;
  let guOpponent = null;
  let guOpponentAt = 0;
  let guPlayerAt = 0;
  let guDeadline = 0;
  let guChoice = null;
  let guFeedback = null;
  let guOutcome = null;
  let guOpponentTimer = null;
  let guTick = null;
  let roundCountdown = null;
  let sceneToken = 0;
  let shenFeedback = null;
  let tutorialRunKey = 0;

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
  // Waiting is tied to absolute wall-clock deadlines, not accumulated paint delays.
  async function waitUntil(deadlineMs) {
    while (Date.now() < deadlineMs) await delay(Math.max(1, deadlineMs - Date.now()));
  }
  function clearShenTimer() {
    if (shenTimer !== null) clearInterval(shenTimer);
    shenTimer = null;
  }
  function clearTutorialTimers() {
    clearShenTimer();
    if (guOpponentTimer !== null) clearTimeout(guOpponentTimer);
    if (guTick !== null) clearInterval(guTick);
    if (roundCountdown !== null) clearInterval(roundCountdown);
    guOpponentTimer = guTick = roundCountdown = null;
    sceneToken += 1;
  }
  function closeTutorialArena() {
    clearTutorialTimers();
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
      /* 結算獨立成全螢幕視圖，不接在人物與題目下方，也不需要捲到頁尾。 */
      #page-battle .bv2-arena.bt-tutorial-active #${LAYER_ID}.bt-final-mode{
        position:fixed!important;inset:0!important;z-index:90!important;
        box-sizing:border-box;width:100vw!important;max-width:none!important;height:100dvh!important;
        margin:0!important;padding:clamp(16px,3.5vw,48px)!important;
        display:flex!important;align-items:center;justify-content:center;
        overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;
        background:radial-gradient(circle at 50% 15%,rgba(142,95,27,.2),transparent 47%),#070705;
      }
      #${LAYER_ID}.bt-final-mode .bt-final-card{
        box-sizing:border-box;width:min(100%,740px);min-width:0;margin:auto;padding:clamp(20px,4vw,38px);
        border:1px solid rgba(216,177,93,.34);border-radius:22px;
        background:linear-gradient(160deg,rgba(35,28,17,.98),rgba(10,9,7,.99));
        box-shadow:0 26px 85px rgba(0,0,0,.7);text-align:center;
      }
      #${LAYER_ID}.bt-final-mode .bt-final-kicker{display:block;margin-bottom:8px;color:#d8b76d;font-size:clamp(11px,1.1vw,14px);font-weight:900;letter-spacing:.15em}
      #${LAYER_ID}.bt-final-mode .bt-final-title{margin:0 0 14px;color:#f0e2bd;font-size:clamp(19px,2.6vw,29px)}
      #${LAYER_ID}.bt-final-mode .bt-result-mark{width:clamp(78px,11vw,112px);height:clamp(78px,11vw,112px);font-size:clamp(36px,5vw,50px)}
      #${LAYER_ID}.bt-final-mode .bt-result h3{font-size:clamp(18px,2.2vw,25px)}
      #${LAYER_ID}.bt-final-mode .bt-result p{font-size:clamp(12px,1.1vw,15px)}
      #${LAYER_ID}.bt-final-mode .bt-explain{text-align:left;margin-top:20px}
      #${LAYER_ID}.bt-final-mode .bt-actions{justify-content:center;margin-top:clamp(16px,2.4vw,26px)}
      #${LAYER_ID}.bt-final-mode .bt-primary{min-height:46px;font-size:clamp(12px,1.1vw,15px);padding:0 25px}
      @media(max-width:650px){
        #page-battle .bv2-arena.bt-tutorial-active #${LAYER_ID}.bt-final-mode{padding:12px!important}
        #${LAYER_ID}.bt-final-mode .bt-final-card{padding:22px 16px}
      }
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
      #page-battle #bv2-quiz:not(.hidden) > #${LAYER_ID}.bt-quiz-mode{width:100%!important;max-width:1000px;min-height:calc(100dvh - 130px);margin:0 auto;align-self:stretch}
      #${LAYER_ID} .bt-quiz-fullscreen{min-height:100%;padding:clamp(14px,3vw,32px);border:1px solid rgba(216,177,93,.28);border-radius:24px;background:linear-gradient(160deg,#211a10,#080807)}
      #${LAYER_ID}.bt-quiz-mode .bt-head{padding:12px 4px 24px}
      #${LAYER_ID}.bt-quiz-mode .bt-head h2{font-size:clamp(20px,3vw,32px)}
      #${LAYER_ID}.bt-quiz-mode .bt-body{padding:0}
      #${LAYER_ID}.bt-quiz-mode .bt-question{padding:clamp(15px,2vw,28px);margin:0}
      #${LAYER_ID}.bt-quiz-mode .bt-question h3{font-size:clamp(19px,2.2vw,29px);line-height:1.7;margin:18px 0 26px}
      #${LAYER_ID}.bt-quiz-mode .bt-option{min-height:clamp(58px,8dvh,78px);font-size:clamp(13px,1.45vw,18px)}
      #${LAYER_ID}.bt-quiz-mode .bt-explain{font-size:clamp(13px,1.2vw,17px);line-height:1.8;padding:16px}
      #${LAYER_ID} .bt-countdown{height:min(44dvh,380px);display:flex;flex-direction:column;gap:20px;align-items:center;justify-content:center;border:1px solid rgba(216,177,93,.25);border-radius:22px;background:radial-gradient(ellipse,rgba(181,123,35,.16),transparent 65%)}
      #${LAYER_ID} .bt-countdown b{font-size:clamp(64px,11vw,124px);color:#f3d991;text-shadow:0 0 45px rgba(218,173,69,.28)}
      #${LAYER_ID} .bt-countdown p{font-size:clamp(13px,2vw,20px);color:#d8c59b}
      #${LAYER_ID} .bt-combat-cue{min-height:120px;padding:24px;text-align:center;border:1px solid rgba(216,177,93,.2);border-radius:16px;background:rgba(216,177,93,.04);font-size:clamp(16px,2vw,23px);color:#e5cf92}
      #${LAYER_ID} .bt-combat-cue strong{display:block;margin-top:12px;font-size:clamp(26px,5vw,62px)}
      #${LAYER_ID} .bt-damage.miss{color:#d1d0c9}

      /* The training arena shares the fixed viewport without losing long dialogue. */
      #page-battle .bv2-arena.bt-tutorial-active{
        box-sizing:border-box;height:100%!important;min-height:0!important;flex:1;
        overflow-x:hidden!important;overflow-y:auto!important;overscroll-behavior:contain
      }
      #${LAYER_ID} .bt-shell{gap:clamp(4px,.75dvh,10px);padding-bottom:6px}
      #${LAYER_ID} .bt-arena{height:clamp(140px,26dvh,255px)}
      #${LAYER_ID} .bt-body{padding-bottom:6px}
      #${LAYER_ID} .bt-rule{
        margin:5px 0;padding:6px 9px;line-height:1.4;overflow-wrap:anywhere
      }
      #${LAYER_ID} .bt-dialogue{padding:9px 11px}
      #${LAYER_ID} .bt-dialogue p{margin-top:4px;line-height:1.5}
      #${LAYER_ID} .bt-actions{margin-top:7px;flex-wrap:wrap}
      #page-battle #bv2-quiz:not(.hidden) > #${LAYER_ID}.bt-quiz-mode{
        box-sizing:border-box;min-height:0!important;max-width:1000px;margin:auto
      }
      #${LAYER_ID} .bt-quiz-fullscreen{min-height:0;padding:clamp(10px,1.4vw,22px)}
      #${LAYER_ID}.bt-quiz-mode .bt-head{padding:6px 3px 12px}
      #${LAYER_ID}.bt-quiz-mode .bt-head h2{font-size:clamp(17px,2vw,24px)}
      #${LAYER_ID}.bt-quiz-mode .bt-question{padding:clamp(10px,1.4vw,17px)}
      #${LAYER_ID}.bt-quiz-mode .bt-question h3{
        font-size:clamp(16px,1.65vw,23px);line-height:1.5;margin:8px 0 13px
      }
      #${LAYER_ID}.bt-quiz-mode .bt-option{
        min-height:clamp(44px,6dvh,58px);padding:8px 10px;font-size:clamp(12px,1.1vw,15px)
      }
      #${LAYER_ID}.bt-quiz-mode .bt-explain{
        font-size:clamp(11px,1vw,14px);line-height:1.5;padding:10px
      }
      #${LAYER_ID} .bt-countdown{height:clamp(100px,24dvh,235px);gap:8px}
      #${LAYER_ID} .bt-countdown b{font-size:clamp(42px,7vw,90px)}
      #${LAYER_ID} .bt-combat-cue{min-height:70px;padding:10px}
      #${LAYER_ID} .bt-combat-cue strong{margin-top:4px;font-size:clamp(24px,4vw,43px)}
      @media(max-width:650px){
        #${LAYER_ID} .bt-arena{height:clamp(118px,21dvh,180px)}
        #${LAYER_ID} .bt-head{padding:5px 3px}
        #${LAYER_ID} .bt-head h2{font-size:clamp(14px,3.5vw,18px)}
        #${LAYER_ID} .bt-fighter-head strong{overflow-wrap:anywhere}
        #${LAYER_ID} .bt-options,
        #${LAYER_ID}.bt-quiz-mode .bt-options{
          grid-template-columns:repeat(2,minmax(0,1fr))
        }
      }
      @media(max-width:420px){
        #${LAYER_ID} .bt-options,
        #${LAYER_ID}.bt-quiz-mode .bt-options{grid-template-columns:minmax(0,1fr)}
      }
      @media(max-height:620px){
        #${LAYER_ID} .bt-arena{height:clamp(105px,21dvh,155px)}
        #${LAYER_ID} .bt-shell{gap:3px}
        #${LAYER_ID} .bt-body{padding-bottom:3px}
        #${LAYER_ID}.bt-quiz-mode .bt-head{padding-bottom:6px}
      }
      /* Match the wall-clock attack schedule in the formal duel. */
      #${LAYER_ID} .bt-fighter.strike{animation-duration:1450ms!important}
      #${LAYER_ID} .bt-fighter.hit{animation-duration:750ms!important}
      #${LAYER_ID} .bt-slash.go{animation-duration:1450ms!important}
      #${LAYER_ID} .bt-damage{animation-duration:800ms!important}
      /* Shared cinematic arena for Shen and Gu, preserving fullscreen questions. */
      #page-battle .bv2-arena.bt-tutorial-active #${LAYER_ID} .bt-arena{box-sizing:border-box;display:block!important;position:relative;isolation:isolate;width:100%;height:clamp(210px,43dvh,470px)!important;min-height:0!important;padding:0!important;overflow:hidden;border:1px solid rgba(220,184,114,.35);border-radius:9px 9px 20px 20px;background:linear-gradient(180deg,rgba(4,10,10,.22),rgba(3,6,7,.23) 58%,rgba(0,0,0,.68)),url('assets/immortal-mountains.svg') center 46%/cover no-repeat,#102521;box-shadow:inset 0 0 65px rgba(0,0,0,.49),0 9px 25px rgba(0,0,0,.25)}
      #${LAYER_ID} .bt-arena::before{content:'';position:absolute;z-index:1;inset:0;pointer-events:none;background:radial-gradient(ellipse at 28% 55%,rgba(217,170,98,.14),transparent 30%),radial-gradient(ellipse at 72% 55%,rgba(171,82,95,.17),transparent 30%),linear-gradient(90deg,rgba(5,10,9,.3),transparent 27%,transparent 73%,rgba(4,9,10,.31))}
      #${LAYER_ID} .bt-arena::after{content:'';position:absolute;z-index:2;left:10%;right:10%;bottom:-9%;height:22%;border-radius:50%;transform:perspective(180px) rotateX(59deg);pointer-events:none;border:2px solid rgba(219,178,102,.29);box-shadow:0 0 25px rgba(223,181,113,.13),inset 0 0 24px rgba(213,170,95,.1)}
      #page-battle .bv2-arena.bt-tutorial-active #${LAYER_ID} .bt-fighter{position:absolute!important;z-index:4;bottom:-5%;width:46%;height:90%!important;min-width:0;min-height:0!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;overflow:visible;transform-origin:50% 94%;pointer-events:none;filter:drop-shadow(0 11px 12px rgba(0,0,0,.55))}
      #${LAYER_ID} .bt-fighter.me{left:1%;bottom:-6%;width:49%;height:91%!important}#${LAYER_ID} .bt-fighter.enemy{right:4%;bottom:21%;width:42%;height:73%!important}
      #${LAYER_ID} .bt-fighter img{position:absolute;inset:0!important;width:100%!important;height:100%!important;object-fit:contain;object-position:center bottom;filter:drop-shadow(0 13px 11px rgba(0,0,0,.56))}
      #${LAYER_ID} .bt-fighter.enemy img{transform:scaleX(-1)}
      #${LAYER_ID} .bt-fighter-head{position:absolute;z-index:6;top:10px;left:7px;right:7px;align-items:center;padding:5px 9px!important;border:1px solid rgba(223,181,98,.31);border-radius:7px;background:rgba(8,13,12,.8);box-shadow:0 4px 14px rgba(0,0,0,.3)}
      #${LAYER_ID} .bt-fighter.enemy .bt-fighter-head{border-color:rgba(215,110,95,.36)}#${LAYER_ID} .bt-fighter.me .bt-fighter-head{top:auto;bottom:28px}
      #${LAYER_ID} .bt-fighter-head strong{font-size:clamp(10px,1.25vw,16px)!important}#${LAYER_ID} .bt-fighter-head b{font-size:clamp(10px,1.35vw,17px)!important}
      #${LAYER_ID} .bt-hp{z-index:7;left:9px;right:9px;bottom:14px;height:8px;border-radius:7px;background:rgba(2,4,4,.82)}#${LAYER_ID} .bt-fighter.enemy .bt-hp{bottom:auto;top:51px}
      #${LAYER_ID} .bt-vs{position:absolute;z-index:2;left:50%;top:43%;width:auto;height:auto;transform:translate(-50%,-50%);border:0;background:transparent;box-shadow:none;font:900 clamp(49px,8vw,100px) serif;color:rgba(233,195,110,.13);pointer-events:none}
      #${LAYER_ID} .bt-slash{z-index:7}#${LAYER_ID} .bt-damage{z-index:9}
      #${LAYER_ID} .bt-fighter.me.strike{animation:btStageAdvanceMe 1450ms ease-out both!important}#${LAYER_ID} .bt-fighter.enemy.strike{animation:btStageAdvanceEnemy 1450ms ease-out both!important}
      #${LAYER_ID} .bt-fighter.me.hit{animation:btStageRecoilMe 750ms ease-out both!important}#${LAYER_ID} .bt-fighter.enemy.hit{animation:btStageRecoilEnemy 750ms ease-out both!important}
      @keyframes btStageAdvanceMe{0%,100%{transform:translateX(0) scale(1)}18%{transform:translateX(-9px) scale(.98)}45%,66%{transform:translate(clamp(30px,8vw,108px),-12px) scale(1.07)}}
      @keyframes btStageAdvanceEnemy{0%,100%{transform:translateX(0) scale(1)}18%{transform:translateX(9px) scale(.98)}45%,66%{transform:translate(clamp(-108px,-8vw,-30px),12px) scale(1.07)}}
      @keyframes btStageRecoilMe{0%,100%{transform:translateX(0);filter:brightness(1)}24%{transform:translateX(-16px);filter:brightness(1.9)}50%{transform:translateX(8px);filter:brightness(.9)}}
      @keyframes btStageRecoilEnemy{0%,100%{transform:translateX(0);filter:brightness(1)}24%{transform:translateX(16px);filter:brightness(1.9)}50%{transform:translateX(-8px);filter:brightness(.9)}}
      @media(max-width:620px){#page-battle .bv2-arena.bt-tutorial-active #${LAYER_ID} .bt-arena{height:clamp(175px,35dvh,340px)!important}#${LAYER_ID} .bt-fighter.me{left:-4%;bottom:-6%;width:54%!important;height:84%!important}#${LAYER_ID} .bt-fighter.enemy{right:-1%;bottom:23%;width:46%!important;height:67%!important}#${LAYER_ID} .bt-fighter-head{left:5px;right:5px;padding:3px 5px!important}#${LAYER_ID} .bt-fighter.enemy .bt-hp{top:44px}#${LAYER_ID} .bt-fighter.me .bt-fighter-head{bottom:25px}#${LAYER_ID} .bt-hp{bottom:12px;height:7px}}
      @media(max-height:540px){#page-battle .bv2-arena.bt-tutorial-active #${LAYER_ID} .bt-arena{height:clamp(115px,36dvh,210px)!important}#${LAYER_ID} .bt-fighter-head span{display:none}#${LAYER_ID} .bt-fighter.enemy .bt-hp{top:31px}#${LAYER_ID} .bt-fighter.me .bt-fighter-head{bottom:23px}}
      @media(prefers-reduced-motion:reduce){#${LAYER_ID} .bt-fighter.me.strike,#${LAYER_ID} .bt-fighter.enemy.strike,#${LAYER_ID} .bt-fighter.me.hit,#${LAYER_ID} .bt-fighter.enemy.hit{animation:none!important}}
      /* Story finale: preserve the local outcome while making it a distinct duel moment. */
      #${LAYER_ID}.bt-final-mode .bt-final-card{--final-ink:#d1d9cc;--final-glow:rgba(147,188,170,.32);position:relative;isolation:isolate;overflow:hidden;box-sizing:border-box;width:min(100%,860px);min-height:min(76dvh,650px);padding:clamp(15px,3vw,34px)!important;border:1px solid rgba(185,194,173,.38);border-radius:14px;background:linear-gradient(180deg,rgba(5,14,14,.73),rgba(5,10,10,.79) 65%,rgba(4,7,7,.95)),url('assets/immortal-mountains.svg') center/cover no-repeat,#11231f;box-shadow:0 16px 75px rgba(0,0,0,.72),inset 0 0 75px rgba(0,0,0,.54);display:flex;align-items:center;justify-content:center}
      #${LAYER_ID}.bt-final-mode .bt-final-card.bt-finale-win{--final-ink:#f0c976;--final-glow:rgba(228,181,84,.45);border-color:rgba(234,185,95,.48)}
      #${LAYER_ID}.bt-final-mode .bt-final-card.bt-finale-defeat{--final-ink:#e0a1a3;--final-glow:rgba(177,73,87,.42);border-color:rgba(177,79,89,.45)}
      #${LAYER_ID}.bt-final-mode .bt-finale-backdrop{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:0;background:radial-gradient(ellipse at 50% 31%,var(--final-glow),transparent 64%)}
      #${LAYER_ID}.bt-final-mode .bt-finale-aura{position:absolute;left:50%;top:-10%;width:42%;height:100%;transform:translateX(-50%) rotate(-12deg);background:linear-gradient(90deg,transparent,var(--final-glow),transparent);filter:blur(22px);animation:btFinaleAura 1.5s ease-out both}
      #${LAYER_ID}.bt-final-mode .bt-finale-seal{position:absolute;left:50%;top:32%;width:clamp(150px,33dvh,270px);aspect-ratio:1;transform:translate(-50%,-50%);border:1px solid var(--final-ink);border-radius:50%;box-shadow:inset 0 0 55px var(--final-glow),0 0 40px var(--final-glow);opacity:.5;animation:btFinaleSeal 1.3s ease-out both}
      #${LAYER_ID}.bt-final-mode .bt-finale-seal::after{content:'';position:absolute;inset:12%;border:1px dashed var(--final-glow);border-radius:50%;animation:btFinaleSpin 22s linear infinite}
      #${LAYER_ID}.bt-final-mode .bt-finale-portrait{position:absolute;bottom:-5%;height:87%;width:38%;object-fit:contain;object-position:center bottom;opacity:.43;filter:brightness(.8) drop-shadow(0 10px 16px rgba(0,0,0,.6));mask-image:linear-gradient(0deg,transparent,#000 19%,#000 91%,transparent)}
      #${LAYER_ID}.bt-final-mode .bt-finale-portrait.own{left:-4%;animation:btFinaleOwn 1s cubic-bezier(.2,.8,.2,1) both}
      #${LAYER_ID}.bt-final-mode .bt-finale-portrait.opponent{right:-4%;transform:scaleX(-1);animation:btFinaleEnemy 1s cubic-bezier(.2,.8,.2,1) both}
      #${LAYER_ID}.bt-final-mode .bt-finale-defeat .bt-finale-portrait.opponent,#${LAYER_ID}.bt-final-mode .bt-finale-win .bt-finale-portrait.own{filter:brightness(.94) drop-shadow(0 10px 18px var(--final-glow))}
      #${LAYER_ID}.bt-final-mode .bt-finale-sparks{position:absolute;left:50%;top:32%;width:0;height:0}
      #${LAYER_ID}.bt-final-mode .bt-finale-sparks i{position:absolute;width:3px;height:13px;background:var(--final-ink);border-radius:5px;box-shadow:0 0 10px var(--final-glow);animation:btFinaleSpark 1.25s .15s ease-out both}
      #${LAYER_ID}.bt-final-mode .bt-finale-content{position:relative;z-index:3;width:min(100%,660px);margin:auto;display:flex;flex-direction:column;align-items:center;text-shadow:0 2px 13px rgba(0,0,0,.85)}
      #${LAYER_ID}.bt-final-mode .bt-final-kicker{color:var(--final-ink);font-size:clamp(10px,1.2dvh,14px);letter-spacing:.25em;animation:btFinaleRise .7s .12s both}
      #${LAYER_ID}.bt-final-mode .bt-final-title{font-size:clamp(22px,4.1dvh,36px);color:#f6e9d1;margin:4px 0 8px;animation:btFinaleRise .65s .46s both}
      #${LAYER_ID}.bt-final-mode .bt-final-content{width:100%;animation:btFinaleRise .7s .65s both}
      #${LAYER_ID}.bt-final-mode .bt-result-mark{width:clamp(88px,17dvh,145px);height:clamp(88px,17dvh,145px);font-size:clamp(47px,9dvh,80px);margin:0 auto clamp(7px,1.1dvh,14px);border:2px solid var(--final-ink);color:var(--final-ink);background:radial-gradient(circle,var(--final-glow),rgba(6,12,11,.92) 72%);box-shadow:inset 0 0 18px var(--final-glow),0 0 30px var(--final-glow);animation:btFinaleMark .95s .16s cubic-bezier(.2,.8,.2,1.1) both}
      #${LAYER_ID}.bt-final-mode .bt-result h3{font-size:clamp(19px,3dvh,27px);color:#f7e9d4}
      #${LAYER_ID}.bt-final-mode .bt-result p{font-size:clamp(11px,1.65dvh,15px);max-width:550px;color:#e2d3b7;line-height:1.55}
      #${LAYER_ID}.bt-final-mode .bt-explain{width:min(100%,620px);max-height:min(18dvh,150px);overflow:auto;margin:clamp(8px,1.5dvh,16px) auto 0;padding:clamp(8px,1.4dvh,14px);border:1px solid rgba(211,191,142,.27);border-left:2px solid var(--final-ink);border-radius:8px;background:rgba(5,11,10,.84);color:#e3d6b8;font-size:clamp(10px,1.5dvh,14px)}
      #${LAYER_ID}.bt-final-mode .bt-actions{margin-top:clamp(10px,1.8dvh,22px);justify-content:center}
      #${LAYER_ID}.bt-final-mode .bt-primary{border-radius:8px;min-height:clamp(41px,5.5dvh,52px);font-size:clamp(12px,1.6dvh,15px);box-shadow:0 0 21px var(--final-glow)}
      @keyframes btFinaleAura{from{opacity:0;transform:translateX(-50%) rotate(-12deg) scale(.35)}to{opacity:.9;transform:translateX(-50%) rotate(-12deg) scale(1)}}
      @keyframes btFinaleSeal{from{opacity:0;transform:translate(-50%,-50%) scale(.55) rotate(-30deg)}to{opacity:.5;transform:translate(-50%,-50%) scale(1) rotate(0)}}
      @keyframes btFinaleSpin{to{transform:rotate(360deg)}}
      @keyframes btFinaleOwn{from{opacity:0;transform:translateX(-50px)}to{opacity:.51;transform:translateX(0)}}
      @keyframes btFinaleEnemy{from{opacity:0;transform:scaleX(-1) translateX(-50px)}to{opacity:.51;transform:scaleX(-1) translateX(0)}}
      @keyframes btFinaleSpark{0%{opacity:0;transform:rotate(var(--angle)) translateY(0) scale(.2)}30%{opacity:.9}100%{opacity:0;transform:rotate(var(--angle)) translateY(calc(-1 * var(--radius))) scale(.2)}}
      @keyframes btFinaleRise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
      @keyframes btFinaleMark{0%{opacity:0;transform:scale(2);filter:brightness(2)}55%{opacity:1;transform:scale(.92)}100%{opacity:1;transform:scale(1);filter:brightness(1)}}
      @media(max-width:650px){#${LAYER_ID}.bt-final-mode .bt-final-card{min-height:min(78dvh,620px);padding:14px 9px!important}#${LAYER_ID}.bt-final-mode .bt-finale-portrait{width:52%;height:68%;bottom:12%;opacity:.26!important}#${LAYER_ID}.bt-final-mode .bt-final-title{font-size:clamp(19px,4.3vw,28px)}#${LAYER_ID}.bt-final-mode .bt-explain{max-height:15dvh}}
      @media(max-height:590px){#${LAYER_ID}.bt-final-mode .bt-final-card{min-height:0;padding:7px!important}#${LAYER_ID}.bt-final-mode .bt-result-mark{width:clamp(62px,15dvh,100px);height:clamp(62px,15dvh,100px);font-size:clamp(30px,8dvh,55px);margin:0 auto 3px}#${LAYER_ID}.bt-final-mode .bt-final-title{font-size:21px;margin:2px}#${LAYER_ID}.bt-final-mode .bt-explain{max-height:12dvh;margin-top:4px}#${LAYER_ID}.bt-final-mode .bt-actions{margin-top:5px}}
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

  function shell({ opponent, opponentImage, opponentHp, opponentMaxHp, playerImage = playerPortrait('determined'), body, badge, title, showLater = true, result = false, resultKind = 'practice', quiz = false }) {
    const el = layer();
    el.classList.toggle('bt-final-mode', result);
    window.setBattleTutorialScene?.(quiz ? 'quiz' : 'arena');
    const parent = document.getElementById(quiz ? 'bv2-quiz' : 'bv2-arena');
    if (parent && el.parentElement !== parent) parent.appendChild(el);
    el.classList.toggle('bt-quiz-mode', quiz);
    if (quiz) {
      el.innerHTML = `<section class="bt-quiz-fullscreen" role="region" aria-label="${esc(title)}">
        <header class="bt-head"><div><small>${esc(badge)}</small><h2>${esc(title)}</h2></div></header>
        <div class="bt-body">${body}</div>
      </section>`;
      return el;
    }
    if (result) {
      const finale = resultKind === 'win' ? 'win' : resultKind === 'defeat' ? 'defeat' : 'practice';
      el.innerHTML = `<section class="bt-final-card bt-finale-${finale}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="bt-finale-backdrop" aria-hidden="true">
          <i class="bt-finale-aura"></i><i class="bt-finale-seal"></i>
          <img class="bt-finale-portrait own" src="${esc(playerImage || '')}" alt="">
          <img class="bt-finale-portrait opponent" src="${esc(opponentImage || '')}" alt="">
          <div class="bt-finale-sparks">${Array.from({length:12},(_,i)=>`<i style="--angle:${i*137.5}deg;--radius:${95+i%4*23}px"></i>`).join('')}</div>
        </div>
        <div class="bt-finale-content">
          <small class="bt-final-kicker">${esc(badge)}</small>
          <h2 class="bt-final-title">${esc(title)}</h2>
          <div class="bt-final-content">${body}</div>
        </div>
      </section>`;
      // 結算重新置中；不要保留玩家上一題捲到下方的位置。
      el.scrollTop = 0;
      return el;
    }
    el.innerHTML = `<section class="bt-shell">
      <header class="bt-head"><div><small>${esc(badge)}</small><h2>${esc(title)}</h2></div>${showLater ? '<button type="button" class="bt-later">稍後再練</button>' : ''}</header>
      <div class="bt-arena bv2-scoreboard">
        ${fighterMarkup({ enemy:false, name:playerName(), hp:playerHp, maxHp:playerCombat?.maxHp || 1000, image:playerImage, label:'我方 · 演武投影' })}
        <div class="bt-vs bv2-round-seal">VS</div>
        ${fighterMarkup({ enemy:true, name:opponent, hp:opponentHp, maxHp:opponentMaxHp, image:opponentImage, label:'對手' })}
        <i class="bt-slash" aria-hidden="true"></i>
      </div>
      <div class="bt-body">${body}</div>
    </section>`;
    el.querySelector('.bt-later')?.addEventListener('click', snooze);
    return el;
  }


  // Take exactly the same equipped/stat snapshot as formal battle.
  // These projected HP / shields / equipment flags are local to the story and never persisted.
  function capturePlayerCombat() {
    const d = data() || {};
    const stats = window.getCombatStats?.() || window.getCombatStatDefaults?.() || { attack: 200, maxHp: 1000 };
    const maxHp = Math.max(1, Math.round(Number(stats.maxHp) || 1000));
    const goldenCore = window.getEquippedGoldenCoreBattleSnapshot?.() || null;
    const artifactBattle = window.getArtifactBattleSnapshot?.() || { version: 1, effects: [], openingShield: 0 };
    return {
      uid: user()?.uid || 'story-player', name: playerName(),
      hp: maxHp, maxHp, atk: Math.max(1, Math.round(Number.isFinite(Number(stats.attack)) ? Number(stats.attack) : 200)),
      totalScore: score(), goldenCore, coreShield: !!goldenCore && d.stats?.goldenCoreShield === true,
      combatPower: Math.max(0, Math.round(Number(window.getCombatPower?.().total) || 0)),
      coreCorrectStreak: 0, artifactBattle,
      artifactShield: Math.max(0, Math.round(Number(window.getArtifactBattleOpeningShield?.(artifactBattle) ?? artifactBattle.openingShield) || 0)),
      artifactFirstHitUsed: false, artifactCheatDeathUsed: false
    };
  }

  function combatSummary() {
    const core = playerCombat?.goldenCore?.name || '未調御金丹';
    const effects = playerCombat?.artifactBattle?.effects || [];
    const names = [...new Set(effects.map((x) => x.artifactName).filter(Boolean))];
    const equipment = names.length ? names.join('、') : '目前無附加鬥法效果的裝備';
    const coreShield = guPlayer?.coreShield ? '已啟動' : '未啟動';
    const artifactShield = guPlayer?.artifactShield || 0;
    return `戰力 ${(playerCombat?.combatPower || 0).toLocaleString('zh-TW')} ／ 實際攻擊 ${playerCombat?.atk || 200} ／ 最大生命 ${playerCombat?.maxHp || 1000} ／ 金丹：${esc(core)} ／ 道心護體：${coreShield} ／ 法寶護盾：${artifactShield} ／ 裝備：${esc(equipment)}`;
  }

  function startCountdown(opponent, done) {
    stage = tutorialPhase === 'shen' ? 'shen-countdown' : 'gu-countdown';
    const myToken = ++sceneToken;
    const enemy = opponent === 'shen';
    const name = enemy ? '沈清霜' : '顧長風';
    const image = enemy ? 'assets/story/characters/shen-qingshuang.png' : 'assets/story/characters/battle-rival.png';
    const maxHp = enemy ? 99999 : guOpponent.maxHp;
    const hp = enemy ? 99999 : guOpponent.hp;
    let left = 3;
    const render = () => shell({
      opponent: name, opponentImage: image, opponentHp: hp, opponentMaxHp: maxHp,
      badge: '築基鬥法教學 · 演武場', title: '鬥法準備',
      showLater: false,
      body: `<div class="bt-countdown"><b>${left}</b><p>凝神備戰，即將進入全畫面題目</p></div>`
    });
    render();
    if (roundCountdown !== null) clearInterval(roundCountdown);
    roundCountdown = setInterval(() => {
      if (!active || myToken !== sceneToken) { clearInterval(roundCountdown); roundCountdown = null; return; }
      left -= 1;
      if (left > 0) { render(); return; }
      clearInterval(roundCountdown); roundCountdown = null;
      done();
    }, 1000);
  }

  function renderIntro() {
    shell({
      opponent:'沈清霜',
      opponentImage:'assets/story/characters/shen-qingshuang.png',
      opponentHp:99999,
      opponentMaxHp:99999,
      badge:'築基鬥法教學 · 第一戰',
      title:'先和師姐切磋',
      body:`<div class="bt-rule"><strong>沈清霜：</strong>「先接我一劍。放心，這是演武投影，不會傷到你的真身。」<br><small>切磋不計戰績；主動使用的答題法寶仍會正常消耗。</small></div>
        
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
      ? `<div class="bt-explain"><b>${choice === null ? '時間到：玩家未作答。' : choice === SHEN_QUESTION.ans ? '你答對了，但師姐已取得先手。' : '你答錯了，師姐已取得先手。'}</b><br>正解：${esc(SHEN_QUESTION.opts[SHEN_QUESTION.ans])}。 ${esc(SHEN_QUESTION.exp)}</div>
         <div class="bt-actions"><button type="button" class="bt-primary" data-bt-action="shen-return-arena">看完解析 · 返回戰場</button></div>`
      : '<div class="bt-explain">沈清霜 · 立即答對。你剩餘 25 秒；作答後先閱讀解析，再返回戰場看先手劍意。</div>';
    const el = shell({
      opponent:'沈清霜', badge:'築基鬥法教學 · 全畫面答題',
      title:'師姐已作答 · 玩家應答窗', showLater:!answered, quiz:true,
      body:`<section class="bt-question"><div class="bt-question-meta"><span>沈清霜 · 立即答對</span><span id="bt-shen-timer" class="bt-shen-timer ${remaining <= 5 ? 'urgent' : ''}">剩餘 ${remaining} 秒</span></div>
        <h3>${esc(SHEN_QUESTION.q)}</h3><div class="bt-options">${opts}</div>${explain}</section>`
    });
    if (!answered) el.querySelectorAll('[data-bt-shen-choice]').forEach(button => button.addEventListener('click', () => runShenStrike(Number(button.dataset.btShenChoice))));
    else el.querySelector('[data-bt-action="shen-return-arena"]')?.addEventListener('click', playShenStrike);
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
    clearTutorialTimers();
    startCountdown('shen', () => {
      stage = 'shen-question';
      shenDeadline = Date.now() + SHEN_ANSWER_WINDOW_MS;
      shenChoice = null;
      renderShenQuestion();
      shenTimer = setInterval(updateShenTimer, 200);
      updateShenTimer();
    });
  }

  async function runShenStrike(choice = null) {
    if (!active || busy || stage !== 'shen-question') return;
    busy = true;
    shenChoice = Date.now() < shenDeadline && Number.isInteger(choice) && choice >= 0 && choice < SHEN_QUESTION.opts.length ? choice : null;
    clearShenTimer();
    stage = 'shen-review';
    shenFeedback = { choice: shenChoice, correct: shenChoice === SHEN_QUESTION.ans };
    renderShenQuestion(shenFeedback);
    busy = false;
  }

  async function playShenStrike() {
    if (!active || busy || stage !== 'shen-review') return;
    busy = true;
    stage = 'shen-strike';
    const myToken = ++sceneToken;
    const el = shell({
      opponent:'沈清霜',
      opponentImage:'assets/story/characters/shen-qingshuang.png',
      opponentHp:99999, opponentMaxHp:99999,
      badge:'築基鬥法教學 · 演武場', title:'師姐先手 · 劍意降臨', showLater:false,
      body:`<div class="bt-combat-cue">沈清霜的劍光已至！</div>`
    });
    const strikeAtMs = Date.now() + 280;
    const impactAtMs = strikeAtMs + TUTORIAL_IMPACT_MS;
    const clearAtMs = strikeAtMs + TUTORIAL_VISIBLE_MS;
    await waitUntil(strikeAtMs);
    if (!active || myToken !== sceneToken) return;
    const attacker = el.querySelector('[data-bt-fighter="enemy"]');
    const defender = el.querySelector('[data-bt-fighter="me"]');
    if (Date.now() < clearAtMs) {
      attacker?.classList.add('strike');
      el.querySelector('.bt-slash')?.classList.add('go');
    }
    await waitUntil(impactAtMs);
    if (!active || myToken !== sceneToken) return;
    if (Date.now() < clearAtMs) {
      defender?.classList.add('hit');
      const pop = document.createElement('div');
      pop.className = 'bt-damage';
      pop.textContent = '破！';
      pop.style.left = '28%';
      el.querySelector('.bt-arena')?.appendChild(pop);
    }
    refreshTutorialFighter(el, 'me', 0, playerCombat?.maxHp || 1000);
    await waitUntil(clearAtMs);
    if (!active || myToken !== sceneToken) return;
    // The story deliberately dissipates the projection regardless of the player's persistent HP.
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
      title:'一劍定勝負',
      showLater:false,
      result:true, resultKind:'defeat',
      body:`<div class="bt-result"><div class="bt-result-mark">敗</div><h3>演武投影已潰散</h3><p>${shenChoice === null ? '25 秒已結束，未能及時作答。' : shenChoice === SHEN_QUESTION.ans ? '你答對了，但師姐先手命中。' : '你答錯了，師姐先手命中。'}演武投影應聲潰散。這一戰不計入戰績。</p></div>
        <div class="bt-explain"><b>正確答案：${esc(SHEN_QUESTION.opts[SHEN_QUESTION.ans])}</b><br>${esc(SHEN_QUESTION.exp)}</div>
        <div class="bt-actions"><button type="button" class="bt-primary" data-bt-action="return-story">返回主線劇情</button></div>`
    });
    el.querySelector('[data-bt-action="return-story"]')?.addEventListener('click', finishShen);
  }

  function finishShen() {
    if (!active || busy || tutorialPhase !== 'shen') return;
    active = false;
    clearTutorialTimers();
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
      opponentMaxHp:guOpponent?.maxHp || 2000,
      badge:'築基鬥法教學 · 第二戰',
      title:'顧長風 · 正式規則演練',
      body:`<div class="bt-rule"><strong>顧長風：</strong>「師姐的劍太快了吧？來，我陪你拆幾招。答對便能出手，誰先答對誰先攻；留意倒數，別讓我等太久。」<br><small>演武四回合，不計戰績。</small></div>
        
        <div class="bt-actions"><button type="button" class="bt-primary" data-bt-action="gu-start">開始四回合教學戰</button></div>`
    });
    el.querySelector('[data-bt-action="gu-start"]')?.addEventListener('click', beginGuRound);
  }

  function clearGuRoundTimers() {
    if (guOpponentTimer !== null) clearTimeout(guOpponentTimer);
    if (guTick !== null) clearInterval(guTick);
    guOpponentTimer = guTick = null;
  }

  function beginGuRound() {
    if (!active || busy || guRound >= QUESTIONS.length || playerHp <= 0 || guHp <= 0) {
      if (active && !busy) renderGuResult();
      return;
    }
    clearGuRoundTimers();
    guChoice = null;
    guPlayerAt = guOpponentAt = guDeadline = 0;
    guFeedback = guOutcome = null;
    startCountdown('gu', () => {
      stage = 'gu-question';
      renderGuRound();
      const token = sceneToken;
      // The NPC answers after a short deterministic delay. The player may answer before or after.
      guOpponentTimer = setTimeout(() => {
        if (!active || stage !== 'gu-question' || token !== sceneToken) return;
        guOpponentAt = Date.now();
        if (!guPlayerAt) guDeadline = guOpponentAt + GU_ANSWER_WINDOW_MS;
        if (guPlayerAt) completeGuAnswer();
        else {
          // Preserve any already-used option-removal artifact; only update the timer label.
          const label = document.getElementById('bt-gu-timer');
          if (label) label.textContent = '剩餘 25 秒';
        }
      }, guRound % 2 === 0 ? 4200 : 6200);
      guTick = setInterval(updateGuTimer, 200);
    });
  }

  function renderGuRound(feedback = null) {
    const question = QUESTIONS[guRound];
    if (!question) { renderGuResult(); return; }
    const answered = !!feedback;
    const playerAnswered = guPlayerAt > 0;
    const opts = question.opts.map((opt, index) => {
      const cls = answered ? (index === question.ans ? ' correct' : (index === feedback.choice && !feedback.correct ? ' wrong' : '')) : '';
      return `<button type="button" class="bt-option${cls}" data-bt-choice="${index}" ${answered || playerAnswered ? 'disabled' : ''}>${String.fromCharCode(65+index)}. ${esc(opt)}</button>`;
    }).join('');
    const seconds = guDeadline ? Math.max(0, Math.ceil((guDeadline - Date.now()) / 1000)) : 25;
    const status = answered ? '雙方已答 · 請閱讀解析' :
      guOpponentAt && !playerAnswered ? '顧長風已答 · 你的應答倒數' :
      playerAnswered ? '答案已送出 · 等待顧長風作答' : '雙方尚未出手 · 任一方先答後啟動 25 秒倒數';
    const explain = answered
      ? `<div class="bt-explain"><b>${feedback.correct ? '答對：取得出手機會。' : feedback.choice === null ? '逾時：本回合 MISS。' : '答錯：本回合 MISS。'}</b><br>${esc(question.exp)}<br>先手依作答時間決定，返回戰場後逐次執行攻擊、護體或 MISS。</div>
         <div class="bt-actions"><button type="button" class="bt-primary" data-bt-action="gu-return-arena">看完解析 · 返回戰場</button></div>`
      : `<div class="bt-explain">${status}。${playerAnswered ? ' 正在等待另一方完成作答。' : ''}</div>`;
    const el = shell({
      opponent:'顧長風', badge:`築基鬥法教學 · 全畫面題目 ${guRound+1}/${QUESTIONS.length}`,
      title:'以答題決定誰能出手', showLater:!answered, quiz:true,
      body:`<section class="bt-question"><div class="bt-question-meta"><span>ROUND ${guRound+1}</span><span id="bt-gu-timer" class="bt-shen-timer">${guDeadline ? '剩餘 ' + seconds + ' 秒' : '等待首答'}</span></div><h3>${esc(question.q)}</h3><div class="bt-options">${opts}</div>${explain}</section>`
    });
    if (!answered) el.querySelectorAll('[data-bt-choice]').forEach((button) => button.addEventListener('click', () => resolveGuAnswer(Number(button.dataset.btChoice))));
    else el.querySelector('[data-bt-action="gu-return-arena"]')?.addEventListener('click', playGuStrike);
  }

  function updateGuTimer() {
    if (!active || stage !== 'gu-question' || busy) return;
    const left = guDeadline ? Math.max(0, Math.ceil((guDeadline - Date.now()) / 1000)) : 25;
    const label = document.getElementById('bt-gu-timer');
    if (label) {
      label.textContent = guDeadline ? '剩餘 ' + left + ' 秒' : '等待首答';
      label.classList.toggle('urgent', !!guDeadline && left <= 5);
    }
    if (guDeadline && left <= 0 && !guPlayerAt) resolveGuAnswer(null);
    // A hung opponent callback cannot deadlock this local exercise.
    if (guDeadline && left <= 0 && guPlayerAt && !guOpponentAt) {
      guOpponentAt = Date.now();
      completeGuAnswer();
    }
  }

  function resolveGuAnswer(choice) {
    if (!active || busy || stage !== 'gu-question' || guPlayerAt) return;
    const question = QUESTIONS[guRound];
    if (!question) return;
    guChoice = Date.now() <= (guDeadline || Number.POSITIVE_INFINITY) && Number.isInteger(choice) &&
      choice >= 0 && choice < question.opts.length ? choice : null;
    guPlayerAt = Date.now();
    if (!guOpponentAt) guDeadline = guPlayerAt + GU_ANSWER_WINDOW_MS;
    if (guOpponentAt) completeGuAnswer();
    else renderGuRound();
  }

  // Use the same artifact resolver and seeded rolls as formal matchmaking.
  function resolveTutorialEquipmentHit(args) {
    return window.resolveArtifactBattleHit?.(args) || null;
  }

  function completeGuAnswer() {
    if (!active || stage !== 'gu-question' || !guPlayerAt || !guOpponentAt || guOutcome) return;
    clearGuRoundTimers();
    const question = QUESTIONS[guRound];
    const correct = guChoice === question.ans;
    if (correct) guCorrect += 1;
    const host = { ...guPlayer, hp: playerHp, answer: { correct, atMs: guPlayerAt } };
    const guest = { ...guOpponent, hp: guHp, answer: { correct: true, atMs: guOpponentAt } };
    guOutcome = settleBattleRound({
      roomId: 'story-gu-' + (user()?.uid || 'preview'), round: guRound + 1,
      host, guest, maxRounds: QUESTIONS.length,
      resolveEquipmentHit: resolveTutorialEquipmentHit
    });
    guFeedback = { choice: guChoice, correct };
    stage = 'gu-review';
    renderGuRound(guFeedback);
  }

  function refreshTutorialFighter(el, who, hp, maxHp) {
    const fighter = el.querySelector('[data-bt-fighter="' + who + '"]');
    if (!fighter) return;
    const remaining = Math.max(0, Math.round(Number(hp) || 0));
    const number = fighter.querySelector('.bt-fighter-head b');
    if (number) number.textContent = String(remaining);
    const bar = fighter.querySelector('.bt-hp i');
    if (bar) bar.style.width = Math.max(0, Math.min(100, 100 * remaining / Math.max(1, maxHp))) + '%';
  }

  async function playGuStrike() {
    if (!active || busy || stage !== 'gu-review' || !guOutcome) return;
    stage = 'gu-strike';
    busy = true;
    const token = ++sceneToken;
    const outcome = guOutcome;
    outcome.activations.filter((activation) => activation.ownerUid === guPlayer.uid && activation.type && activation.type !== 'artifact')
      .forEach((activation) => window.showGoldenCoreActivation?.({
        type:activation.type, name:activation.name || '金丹', message:activation.message || activation.skill,
        kind:activation.kind || '教學鬥法金丹效果'
      }));
    const el = shell({
      opponent:'顧長風', opponentImage:'assets/story/characters/battle-rival.png',
      opponentHp:guHp, opponentMaxHp:guOpponent.maxHp,
      badge:`築基鬥法教學 · 第 ${guRound+1} 回合`,
      title:'正式鬥法 · 回到演武場', showLater:false,
      body:`<div id="bt-combat-cue" class="bt-combat-cue">回合結算中<strong>⚔</strong></div>
        `
    });
    const steps = Array.isArray(outcome.steps) ? outcome.steps : [];
    const startAtMs = Date.now();
    for (let index = 0; index < steps.length; index += 1) {
      const strikeAtMs = startAtMs + 280 + index * TURN_ANIMATION_MS;
      const impactAtMs = strikeAtMs + TUTORIAL_IMPACT_MS;
      const clearAtMs = strikeAtMs + TUTORIAL_VISIBLE_MS;
      await waitUntil(strikeAtMs);
      if (!active || token !== sceneToken) return;
      const step = steps[index];
      const meAttacking = step.actorRole === 'host';
      const actor = el.querySelector('[data-bt-fighter="' + (meAttacking ? 'me' : 'enemy') + '"]');
      const target = el.querySelector('[data-bt-fighter="' + (meAttacking ? 'enemy' : 'me') + '"]');
      const missed = step.type === 'miss';
      const blocked = !!step.guarded;
      const damage = Math.max(0, Number(step.damage) || 0);
      const label = missed ? 'MISS' : blocked ? '護體' : '-' + damage;
      const cue = el.querySelector('#bt-combat-cue');
      if (cue) cue.innerHTML = (index === 0 ? '先手' : step.type === 'counter' ? '雷光反擊' : '後手') +
        ' · ' + (meAttacking ? '我方' : '顧長風') + '<strong>' + esc(label) + '</strong>';
      if (Date.now() < clearAtMs) {
        if (actor) {
          actor.style.animationDelay = '-' + Math.max(0, Date.now() - strikeAtMs) + 'ms';
          actor.classList.add(missed ? 'miss' : 'strike');
        }
      }
      await waitUntil(impactAtMs);
      if (!active || token !== sceneToken) return;
      let pop = null;
      if (Date.now() < clearAtMs) {
        if (target && !missed && !blocked) {
          target.style.animationDelay = '-' + Math.max(0, Date.now() - impactAtMs) + 'ms';
          target.classList.add('hit');
        }
        pop = document.createElement('div');
        pop.className = 'bt-damage' + (missed ? ' miss' : '');
        pop.style.left = (missed ? (meAttacking ? '28%' : '72%') : (meAttacking ? '72%' : '28%'));
        pop.style.animationDelay = '-' + Math.max(0, Date.now() - impactAtMs) + 'ms';
        pop.innerHTML = esc(label) + '<small>' +
          (missed ? '答題未命中' : blocked ? '道心護體' : step.type === 'counter' ? '反擊' : '攻擊命中') + '</small>';
        el.querySelector('.bt-arena')?.appendChild(pop);
      }
      // Preserve the settled engine's step-by-step HP regardless of tab throttling.
      refreshTutorialFighter(el, 'me', step.hostHp, guPlayer.maxHp);
      refreshTutorialFighter(el, 'enemy', step.guestHp, guOpponent.maxHp);
      await waitUntil(clearAtMs);
      if (!active || token !== sceneToken) return;
      actor?.classList.remove('miss', 'strike');
      target?.classList.remove('hit');
      if (actor) actor.style.animationDelay = '';
      if (target) target.style.animationDelay = '';
      pop?.remove();
      // The shared engine emits no further steps after a lethal hit or reflection.
    }
    if (!active || token !== sceneToken) return;
    playerHp = outcome.hostHp;
    guHp = outcome.guestHp;
    guPlayer = {
      ...guPlayer, hp: playerHp, coreShield: outcome.hostCoreShield,
      coreCorrectStreak: outcome.hostCoreStreak, ...outcome.hostArtifactState
    };
    guOpponent = {
      ...guOpponent, hp: guHp, coreShield: outcome.guestCoreShield,
      coreCorrectStreak: outcome.guestCoreStreak, ...outcome.guestArtifactState
    };
    busy = false;
    if (outcome.finished || playerHp <= 0 || guHp <= 0 || guRound >= QUESTIONS.length - 1) {
      renderGuResult();
    } else {
      stage = 'gu-between';
      const cue = el.querySelector('#bt-combat-cue');
      if (cue) cue.innerHTML = '本回合結束<strong>雙方仍可再戰</strong>';
      const body = el.querySelector('.bt-body');
      if (body) {
        const div = document.createElement('div');
        div.className = 'bt-actions';
        div.innerHTML = '<button type="button" class="bt-primary" data-bt-action="next-round">下一回合</button>';
        body.appendChild(div);
        div.querySelector('button')?.addEventListener('click', () => {
          if (busy || stage !== 'gu-between') return;
          guRound += 1;
          beginGuRound();
        });
      }
    }
  }

  function renderGuResult() {
    stage = 'gu-result';
    const won = guHp <= 0 && playerHp > 0;
    const lost = playerHp <= 0 && guHp > 0;
    const resultMark = won ? '勝' : lost ? '敗' : '習';
    const resultTitle = won ? '顧長風生命歸零' : lost ? '演武投影力竭' : '四回合演練完成';
    const el = shell({
      opponent:'顧長風',
      opponentImage:'assets/story/characters/battle-rival.png',
      opponentHp:guHp, opponentMaxHp:guOpponent?.maxHp || 2000,
      badge:'築基鬥法教學 · 第二戰結束',
      title:'顧長風教學戰完成',
      showLater:false, result:true, resultKind:won ? 'win' : lost ? 'defeat' : 'practice',
      body:`<div class="bt-result"><div class="bt-result-mark">${resultMark}</div><h3>${esc(resultTitle)}</h3><p>答對 ${guCorrect} / ${Math.min(QUESTIONS.length, guRound + 1)}。這場切磋到此為止，不計入正式戰績。</p></div>
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
    clearTutorialTimers();
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
    await window.ensureCombatStats?.();
    if (active || busy || !window.openBattleTutorialArena?.()) return false;
    previewOnly = adminPreview || options.replay === true;
    startedByStory = options.story === true;
    active = true;
    window.switchToPage?.('page-battle');
    clearTutorialTimers();
    shenChoice = null;
    shenFeedback = null;
    shenDeadline = 0;
    playerCombat = capturePlayerCombat();
    playerHp = playerCombat.maxHp;
    guPlayer = { ...playerCombat };
    guOpponent = {
      uid:'story-gu-changfeng', name:'顧長風', hp:2000, maxHp:2000, atk:220,
      totalScore:10, goldenCore:null, coreShield:false, coreCorrectStreak:0,
      artifactBattle:{ version:1, effects:[], openingShield:0 }, artifactShield:0,
      artifactFirstHitUsed:false, artifactCheatDeathUsed:false
    };
    guHp = guOpponent.hp;
    guRound = 0; guCorrect = 0; stage = 'intro';
    tutorialRunKey += 1;
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

  // Shared item "remove wrong option" tool can work in the story's full-screen question.
  window.getBattleTutorialQuestionContext = () => {
    if (!active || !['shen-question', 'gu-question'].includes(stage)) return null;
    const shen = stage === 'shen-question';
    const correctIndex = shen ? SHEN_QUESTION.ans : QUESTIONS[guRound]?.ans;
    const answered = shen ? !!shenFeedback : !!guPlayerAt;
    return {
      context:'battle',
      key:'battle-tutorial:' + tutorialRunKey + ':' + tutorialPhase + ':' + guRound + ':' + (shen ? SHEN_QUESTION.q : QUESTIONS[guRound]?.q),
      correctIndex:Number(correctIndex),
      answered,
      buttonsSelector: shen ? '#battle-tutorial-layer [data-bt-shen-choice]' : '#battle-tutorial-layer [data-bt-choice]',
      containerSelector:'#battle-tutorial-layer .bt-options'
    };
  };

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
