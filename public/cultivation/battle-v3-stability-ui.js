// Battle v3 compatibility + fullscreen presentation layer.
// Keeps the existing Battle v2 protocol/Firestore room format intact while fixing
// quiz API schema compatibility and presenting battle as a true fullscreen mode.
(function () {
  'use strict';

  const STYLE_ID = 'battle-v3-fullscreen-style';
  const ACTIVE_CLASS = 'battle-v3-fullscreen-active';
  const originalFetch = window.fetch?.bind(window);

  function shuffle(values) {
    const items = [...values];
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  function enrichQuestion(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const q = String(raw.q ?? raw.question ?? '').trim();
    if (!q) return raw;

    // Battle v2 already understands opts/options + ans/answer/correctIndex.
    if ((Array.isArray(raw.opts) || Array.isArray(raw.options)) &&
        (raw.ans !== undefined || raw.answer !== undefined || raw.correctIndex !== undefined)) {
      return raw;
    }

    // The shared quiz API returns q + correct + wrong. Preserve those fields for
    // existing consumers, while adding the indexed option schema Battle v2 needs.
    const correct = raw.correct;
    const wrong = Array.isArray(raw.wrong) ? raw.wrong : [];
    if (correct === undefined || wrong.length < 1) return raw;

    const correctText = String(correct);
    const choices = [correctText, ...wrong.map(String)]
      .filter((value, index, array) => value.trim() && array.indexOf(value) === index);
    if (choices.length < 2) return raw;

    const opts = shuffle(choices).slice(0, 6);
    const ans = opts.indexOf(correctText);
    if (ans < 0) return raw;
    return { ...raw, opts, options: opts, ans, correctIndex: ans };
  }

  function enrichPayload(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    if (typeof payload.text === 'string') {
      try {
        const cleaned = payload.text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(cleaned);
        return { ...payload, text: JSON.stringify(enrichQuestion(parsed)) };
      } catch (_) {
        return payload;
      }
    }
    if (Array.isArray(payload.questions)) {
      return { ...payload, questions: payload.questions.map(enrichQuestion) };
    }
    return enrichQuestion(payload);
  }

  function installQuizCompatibility() {
    if (!originalFetch || window.__battleQuizCompatibilityInstalled) return;
    window.__battleQuizCompatibilityInstalled = true;
    window.fetch = async function battleCompatibleFetch(input, init) {
      const response = await originalFetch(input, init);
      try {
        const url = typeof input === 'string' ? input : String(input?.url || '');
        if (!url.includes('/api/generate-quiz') || !response.ok) return response;
        const payload = await response.clone().json();
        const enriched = enrichPayload(payload);
        return new Response(JSON.stringify(enriched), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      } catch (_) {
        return response;
      }
    };
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html.${ACTIVE_CLASS},body.${ACTIVE_CLASS}{overflow:hidden!important;overscroll-behavior:none}
      #page-battle.battle-v2-page{
        position:fixed!important;inset:0!important;z-index:15000!important;
        width:100vw!important;height:100dvh!important;min-height:100dvh!important;
        max-width:none!important;margin:0!important;padding:0!important;
        overflow-x:hidden!important;overflow-y:auto!important;overscroll-behavior:contain!important;
        background:radial-gradient(circle at 50% -12%,rgba(189,143,45,.22),transparent 30%),radial-gradient(circle at 8% 62%,rgba(87,55,18,.16),transparent 28%),linear-gradient(180deg,#090805,#030303 78%)!important;
      }
      #page-battle.battle-v2-page.hidden{display:none!important}
      /* The phase-specific display rules below must NEVER override a hidden phase. */
      #page-battle.battle-v2-page #bv2-lobby.hidden,
      #page-battle.battle-v2-page #bv2-intro.hidden,
      #page-battle.battle-v2-page #bv2-arena.hidden,
      #page-battle.battle-v2-page #bv2-quiz.hidden,
      #page-battle.battle-v2-page #bv2-result.hidden{display:none!important;min-height:0!important;margin:0!important;padding:0!important;visibility:hidden!important}
      #page-battle.battle-v2-page .bv2-shell > section:not(.hidden){visibility:visible!important}
      #page-battle .bv2-shell{box-sizing:border-box;width:min(100%,1440px)!important;height:100%;min-height:0;margin:0 auto!important;padding:max(14px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left))!important;display:flex;flex-direction:column}
      #page-battle .bv2-head{position:sticky;top:0;z-index:20;margin:0 -4px 10px;padding:10px 6px 12px!important;background:linear-gradient(180deg,rgba(5,5,4,.96),rgba(5,5,4,.82),transparent);backdrop-filter:blur(12px)}
      #page-battle .bv2-head h2{font-size:clamp(22px,2.4vw,34px)!important}
      #page-battle .bv2-icon-btn{width:42px!important;height:42px!important}
      #page-battle .bv2-lobby,#page-battle .bv2-intro,#page-battle .bv2-result{flex:1;min-height:0!important;margin-top:0!important;overflow-y:auto;overscroll-behavior:contain}
      #page-battle .bv2-lobby{justify-content:center!important}
      #page-battle .bv2-arena:not(.hidden){
        flex:1;min-height:0;margin-top:0!important;display:grid!important;
        grid-template-columns:minmax(0,1fr)!important;
        grid-template-areas:'score' 'rule' 'cue' 'log'!important;
        grid-template-rows:auto auto minmax(180px,1fr) auto!important;gap:12px!important;
      }
      #page-battle .bv2-scoreboard{grid-area:score}
      #page-battle .bv2-duel-cue{grid-area:cue}
      #page-battle .bv2-quiz:not(.hidden){flex:1;min-height:0;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:clamp(8px,2vh,30px) 0 30px}
      #page-battle .bv2-quiz .bv2-question-card{width:min(100%,980px);min-height:min(72dvh,580px);max-height:none!important;flex:0 0 auto;overflow:visible!important}
      #page-battle .bv2-quiz .bv2-question-card h3{font-size:clamp(19px,2vw,30px)!important;line-height:1.65!important;margin:14px 0 28px}
      #page-battle .bv2-quiz .bv2-option{font-size:clamp(13px,1.4vw,19px)!important;min-height:72px!important}
      #page-battle .bv2-quiz .bv2-option b{font-size:inherit}
      #page-battle #bv2-review-continue{align-self:center;min-height:52px;margin:20px auto 0;padding:12px 24px}
      #page-battle .bv2-duel-rule{grid-area:rule}
      #page-battle .bv2-question-card{grid-area:question;min-width:0;min-height:0;padding:clamp(16px,2vw,26px)!important;display:flex;flex-direction:column;justify-content:flex-start;overflow-y:auto;overflow-wrap:anywhere}
      #page-battle .bv2-question-card h3{font-size:clamp(17px,1.65vw,24px)!important;line-height:1.65!important}
      #page-battle .bv2-options{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important}
      #page-battle .bv2-option{min-height:64px!important;font-size:clamp(11px,1vw,14px)!important}
      #page-battle .bv2-log-wrap{grid-area:log;margin:0!important;min-height:0;max-height:190px!important;display:flex;flex-direction:column;overflow:hidden}
      #page-battle .bv2-log{flex:1;min-height:180px;max-height:none!important;overflow:auto!important}
      #page-battle .bv2-fighter{padding:16px 18px!important}
      #page-battle .bv2-fighter-head strong{font-size:clamp(13px,1.3vw,18px)!important}
      #page-battle .bv2-hp{height:10px!important}
      #page-battle .bv2-result:not(.hidden){display:flex;flex-direction:column;align-items:center;justify-content:center}
      @media(min-width:1200px){
        #page-battle .bv2-shell{padding-left:34px!important;padding-right:34px!important}
        #page-battle .bv2-question-card{min-height:430px}
      }
      @media(max-width:900px){
        #page-battle .bv2-shell{height:auto;min-height:100%;padding:max(10px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left))!important}
        #page-battle .bv2-arena:not(.hidden){grid-template-columns:minmax(0,1fr)!important;grid-template-areas:'score' 'rule' 'cue' 'log'!important;grid-template-rows:auto auto minmax(160px,1fr) auto!important}
        #page-battle .bv2-log-wrap{max-height:170px!important}
        #page-battle .bv2-quiz .bv2-question-card{min-height:calc(100dvh - 150px)}
      }
      @media(max-width:620px){
        #page-battle .bv2-head{padding-top:8px!important}
        #page-battle .bv2-eyebrow{display:none}
        #page-battle .bv2-room-badge{max-width:44vw;overflow:hidden;text-overflow:ellipsis}
        #page-battle .bv2-scoreboard{grid-template-columns:1fr 58px 1fr!important;gap:6px!important}
        #page-battle .bv2-fighter{padding:10px!important}
        #page-battle .bv2-options{grid-template-columns:1fr!important}
        #page-battle .bv2-option{min-height:52px!important}
      }

      /* Viewport-fit battle: six actual scene elements, no obsolete score/log tracks. */
      html.${ACTIVE_CLASS},body.${ACTIVE_CLASS}{overflow:hidden!important}
      #page-battle.battle-v2-page{
        box-sizing:border-box;width:100%!important;height:100dvh!important;min-height:0!important;
        overflow:hidden!important;overscroll-behavior:none!important
      }
      #page-battle .bv2-shell{
        height:100%!important;min-height:0;overflow:hidden;
        padding:max(7px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right))
          max(7px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left))!important
      }
      #page-battle .bv2-head{
        position:relative;flex:0 0 auto;z-index:20;
        margin:0 0 clamp(3px,.7dvh,8px);padding:2px 4px 5px!important;
        background:transparent;backdrop-filter:none
      }
      #page-battle .bv2-head h2{font-size:clamp(17px,2vw,27px)!important;line-height:1.2}
      #page-battle .bv2-icon-btn{width:36px!important;height:36px!important;flex-shrink:0}
      #page-battle .bv2-head-actions{flex-shrink:0;min-width:0}
      #page-battle .bv2-lobby,#page-battle .bv2-intro,#page-battle .bv2-result{
        flex:1;min-height:0!important;margin-top:0!important;overflow-x:hidden;overflow-y:auto
      }
      #page-battle .bv2-intro{min-height:0!important;align-content:center}
      #page-battle .bv2-result:not(.hidden){justify-content:safe center}
      #page-battle .bv2-arena:not(.hidden):not(.bt-tutorial-active){
        flex:1;min-height:0;width:100%;margin-top:0!important;display:grid!important;
        grid-template-columns:minmax(0,1fr)!important;
        grid-template-areas:'enemy' 'round' 'stage' 'mine' 'rule' 'cue'!important;
        grid-template-rows:auto auto minmax(110px,1fr) auto auto auto!important;
        gap:clamp(3px,.65dvh,8px)!important;align-content:stretch;
        overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin
      }
      #page-battle #bv2-enemy-status{grid-area:enemy}
      #page-battle .bv2-stage-round{grid-area:round;line-height:1.2}
      #page-battle .bv2-stage{
        grid-area:stage;box-sizing:border-box;min-width:0;height:100%!important;
        min-height:110px;max-height:none!important;border-radius:clamp(12px,2vw,22px)
      }
      #page-battle #bv2-my-status{grid-area:mine}
      #page-battle .bv2-status-panel{
        box-sizing:border-box;min-width:0;
        padding:clamp(5px,.7dvh,10px) clamp(8px,1.4vw,15px)!important;border-radius:12px
      }
      #page-battle .bv2-status-panel .bv2-fighter-head{
        display:flex!important;align-items:center!important;justify-content:space-between;
        gap:8px;min-width:0
      }
      #page-battle .bv2-status-panel .bv2-fighter-head>div{min-width:0}
      #page-battle .bv2-status-panel .bv2-fighter-head strong{
        font-size:clamp(11px,1.5vw,16px)!important;line-height:1.25;overflow-wrap:anywhere
      }
      #page-battle .bv2-status-panel .bv2-fighter-head b{
        flex:0 0 auto;margin:0!important;font-size:clamp(12px,1.65vw,18px)!important;
        font-variant-numeric:tabular-nums
      }
      #page-battle .bv2-status-panel .bv2-hp{height:clamp(6px,1dvh,10px)!important;margin-top:3px!important}
      #page-battle .bv2-status-panel small{
        margin-top:3px;line-height:1.25;font-size:clamp(8px,1vw,10px);
        white-space:normal;overflow-wrap:anywhere
      }
      #page-battle .bv2-duel-rule{
        grid-area:rule;box-sizing:border-box;min-width:0;padding:4px 8px;line-height:1.3;
        text-align:center;white-space:normal;overflow-wrap:anywhere
      }
      #page-battle .bv2-arena .bv2-duel-cue{
        grid-area:cue;box-sizing:border-box;min-height:clamp(42px,7dvh,62px)!important;
        padding:4px 10px;gap:1px;overflow:hidden
      }
      #page-battle .bv2-arena .bv2-duel-cue span{font-size:9px;line-height:1.2}
      #page-battle .bv2-arena .bv2-duel-cue strong{font-size:clamp(19px,3.5vw,28px);line-height:1.05}
      #page-battle .bv2-arena .bv2-duel-cue p{font-size:10px;line-height:1.2}
      /* Only unusually long questions need an inner scrollbar; never clip an option. */
      #page-battle .bv2-quiz:not(.hidden){
        flex:1;min-height:0;margin:0;display:flex;align-items:safe center;justify-content:center;
        overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;
        padding:clamp(4px,1dvh,10px) 0
      }
      #page-battle .bv2-quiz .bv2-question-card{
        box-sizing:border-box;width:min(100%,980px);min-width:0;min-height:0!important;
        max-height:none!important;flex:0 0 auto;overflow:visible!important;
        padding:clamp(10px,1.7vw,23px)!important
      }
      #page-battle .bv2-quiz .bv2-question-card h3{
        font-size:clamp(16px,1.7vw,23px)!important;line-height:1.5!important;
        margin:8px 0 13px;overflow-wrap:anywhere
      }
      #page-battle .bv2-quiz .bv2-timer-track{margin:5px 0 9px}
      #page-battle .bv2-quiz .bv2-options{
        display:grid;grid-template-columns:repeat(2,minmax(0,1fr))!important;
        gap:clamp(5px,.85dvh,9px)!important
      }
      #page-battle .bv2-quiz .bv2-option{
        box-sizing:border-box;min-width:0;min-height:clamp(44px,6dvh,60px)!important;
        padding:8px 10px;font-size:clamp(12px,1.1vw,15px)!important;overflow-wrap:anywhere
      }
      #page-battle .bv2-quiz .bv2-option b{font-size:inherit}
      #page-battle .bv2-quiz .bv2-explanation{
        padding:10px 12px;line-height:1.5;font-size:clamp(11px,1vw,14px)
      }
      #page-battle .bv2-quiz .bv2-answer-status{
        margin-top:7px;font-size:clamp(10px,1vw,12px);line-height:1.4
      }
      #page-battle #bv2-review-continue{
        align-self:center;min-height:44px;margin:10px auto 0;padding:8px 18px
      }
      #battle-v2-toast{
        z-index:15100!important;bottom:max(10px,env(safe-area-inset-bottom))!important;
        max-width:min(88vw,380px);pointer-events:none
      }
      @media(max-width:620px){
        #page-battle .bv2-shell{
          padding-left:max(7px,env(safe-area-inset-left))!important;
          padding-right:max(7px,env(safe-area-inset-right))!important
        }
        #page-battle .bv2-eyebrow{display:none}
        #page-battle .bv2-room-badge{
          max-width:40vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 7px
        }
        #page-battle .bv2-status-panel .bv2-fighter-head{display:flex!important}
        #page-battle .bv2-duel-rule{font-size:8px;align-items:center}
        #page-battle .bv2-quiz .bv2-options{grid-template-columns:minmax(0,1fr)!important}
        #page-battle .bv2-quiz .bv2-option{min-height:44px!important}
        #page-battle .bv2-quiz #bv2-review-continue{width:100%}
        #page-battle .bv2-result-stats{margin:12px 0;gap:5px}
        #page-battle .bv2-result-emblem{width:58px;height:58px;margin-bottom:9px}
      }
      @media(min-width:440px) and (max-width:620px){
        #page-battle .bv2-quiz .bv2-options{
          grid-template-columns:repeat(2,minmax(0,1fr))!important
        }
      }
      @media(max-height:620px){
        #page-battle .bv2-shell{
          padding-top:max(3px,env(safe-area-inset-top))!important;
          padding-bottom:max(3px,env(safe-area-inset-bottom))!important
        }
        #page-battle .bv2-head{margin-bottom:3px;padding:1px 3px 3px!important}
        #page-battle .bv2-head h2{font-size:18px!important;margin:0}
        #page-battle .bv2-icon-btn{width:32px!important;height:32px!important}
        #page-battle .bv2-arena:not(.hidden):not(.bt-tutorial-active){
          grid-template-rows:auto auto minmax(96px,1fr) auto auto auto!important;gap:3px!important
        }
        #page-battle .bv2-stage{min-height:96px}
        #page-battle .bv2-status-panel{padding:4px 8px!important}
        #page-battle .bv2-status-panel small{font-size:8px}
        #page-battle .bv2-arena .bv2-duel-cue{min-height:40px!important;padding:3px 6px}
        #page-battle .bv2-quiz .bv2-question-card{padding:9px!important}
        #page-battle .bv2-quiz .bv2-question-card h3{margin:5px 0 8px;font-size:16px!important}
      }

      /* Answering remains a real full-viewport scene, not a small centered panel.
         The exit control stays visible; only oversized text scrolls inside the card. */
      #page-battle.bv2-quiz-active .bv2-shell{
        box-sizing:border-box;width:100%!important;max-width:none!important;
        padding:max(3px,env(safe-area-inset-top)) max(5px,env(safe-area-inset-right))
          max(3px,env(safe-area-inset-bottom)) max(5px,env(safe-area-inset-left))!important
      }
      #page-battle.bv2-quiz-active .bv2-head{margin-bottom:2px;padding:2px 7px 5px!important}
      #page-battle .bv2-quiz:not(.hidden){
        box-sizing:border-box;width:100%!important;height:100%;min-height:0!important;flex:1 1 auto;
        margin:0!important;padding:0!important;align-items:stretch!important;
        justify-content:stretch!important;overflow:hidden!important
      }
      #page-battle .bv2-quiz:not(.hidden) > .bv2-question-card{
        box-sizing:border-box;flex:1 1 auto;width:100%!important;min-width:0;
        height:100%!important;min-height:0!important;max-height:none!important;
        margin:0!important;padding:clamp(14px,2.2vw,32px)!important;
        overflow-x:hidden!important;overflow-y:auto!important;overscroll-behavior:contain;
        border-radius:clamp(10px,1.7vw,22px)
      }
      #page-battle .bv2-quiz .bv2-question-card h3{
        font-size:clamp(19px,2.2vw,32px)!important;line-height:1.5!important;
        margin:clamp(12px,2dvh,20px) 0 clamp(14px,2dvh,24px)
      }
      #page-battle .bv2-quiz .bv2-option{
        min-height:clamp(55px,8dvh,80px)!important;
        padding:clamp(9px,1.3dvh,16px) 12px;font-size:clamp(14px,1.4vw,19px)!important
      }
      #page-battle #bv2-quiz:not(.hidden) > #battle-tutorial-layer.bt-quiz-mode{
        box-sizing:border-box;width:100%!important;height:100%!important;
        min-height:0!important;max-width:none!important;margin:0!important
      }
      #page-battle #bv2-quiz:not(.hidden) > #battle-tutorial-layer.bt-quiz-mode .bt-quiz-fullscreen{
        box-sizing:border-box;width:100%;height:100%;min-height:0!important;
        overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain
      }
      /* These are elapsed-time animations: slow, consistent real-time durations.
         Late JS callbacks are fast-forwarded with a negative animation-delay. */
      #page-battle .bv2-stage-fighter.me.strike{
        animation-duration:1450ms!important
      }
      #page-battle .bv2-stage-fighter.enemy.strike{
        animation-duration:1450ms!important
      }
      #page-battle .bv2-stage-fighter.me.hit,
      #page-battle .bv2-stage-fighter.enemy.hit{
        animation-duration:750ms!important
      }
      #page-battle .bv2-stage-fighter.miss{animation-duration:1250ms!important}
      #page-battle .bv2-stage-fighter.guarded{animation-duration:750ms!important}
      #page-battle .bv2-stage-fighter .bv2-damage-pop{animation-duration:800ms!important}
      @media(max-width:620px){
        #page-battle .bv2-quiz:not(.hidden) > .bv2-question-card{
          padding:clamp(10px,2vw,18px)!important
        }
        #page-battle .bv2-quiz .bv2-question-card h3{
          font-size:clamp(17px,4.8vw,23px)!important;margin:10px 0 14px
        }
        #page-battle .bv2-quiz .bv2-option{min-height:52px!important}
      }
      @media(max-height:620px){
        #page-battle .bv2-quiz:not(.hidden) > .bv2-question-card{padding:10px!important}
        #page-battle .bv2-quiz .bv2-question-card h3{margin:6px 0 9px}
        #page-battle .bv2-quiz .bv2-option{min-height:44px!important}
      }

      /* Duel stage: one battlefield, not six stacked information cards. */
      #page-battle .bv2-arena:not(.hidden):not(.bt-tutorial-active){
        position:relative;grid-template-areas:'enemy' 'stage' 'mine'!important;
        grid-template-rows:auto minmax(0,1fr) auto!important;
        gap:clamp(4px,.8dvh,9px)!important;overflow:hidden!important
      }
      #page-battle .bv2-arena:not(.bt-tutorial-active) .bv2-duel-rule{display:none!important}
      #page-battle .bv2-arena:not(.bt-tutorial-active) .bv2-stage-round{
        grid-area:stage;align-self:start;justify-self:center;z-index:7;
        margin-top:clamp(5px,1dvh,12px);padding:4px 14px;
        border:1px solid rgba(238,202,133,.25);border-radius:30px;
        background:rgba(10,13,12,.76);box-shadow:0 3px 18px rgba(0,0,0,.4);
        pointer-events:none;color:#decb9d;font-size:10px
      }
      #page-battle .bv2-arena:not(.bt-tutorial-active) .bv2-stage-round span{font-size:0}
      #page-battle .bv2-arena:not(.bt-tutorial-active) .bv2-stage-round span::after{
        content:'回合';font-size:10px;letter-spacing:.2em
      }
      #page-battle .bv2-arena:not(.bt-tutorial-active) .bv2-duel-cue{
        grid-area:stage;align-self:end;justify-self:center;z-index:8;
        width:min(84%,370px);min-height:0!important;margin-bottom:clamp(5px,1dvh,12px);
        border:1px solid rgba(227,194,122,.27);border-radius:13px;
        padding:5px 13px!important;background:linear-gradient(90deg,rgba(8,11,11,.9),rgba(30,24,14,.9),rgba(8,11,11,.9));
        box-shadow:0 7px 28px rgba(0,0,0,.46);pointer-events:none;gap:0!important
      }
      #page-battle .bv2-arena:not(.bt-tutorial-active) .bv2-duel-cue strong{
        font-size:clamp(21px,3.2dvh,34px)!important;line-height:1.05
      }
      #page-battle .bv2-arena:not(.bt-tutorial-active) .bv2-duel-cue p{
        max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        font-size:clamp(9px,1.35dvh,12px)!important
      }
      #page-battle .bv2-arena:not(.bt-tutorial-active) .bv2-status-panel{
        position:relative;z-index:5;padding:clamp(6px,.9dvh,11px) clamp(10px,1.8vw,21px)!important;
        border-radius:6px 6px 12px 12px;background:linear-gradient(100deg,rgba(12,20,19,.95),rgba(9,12,11,.92))!important;
        box-shadow:inset 3px 0 rgba(211,172,92,.37),0 6px 20px rgba(0,0,0,.22)
      }
      #page-battle .bv2-arena:not(.bt-tutorial-active) .bv2-status-panel.enemy{
        box-shadow:inset -3px 0 rgba(194,93,73,.48),0 6px 20px rgba(0,0,0,.22);
        background:linear-gradient(260deg,rgba(29,13,15,.95),rgba(10,11,12,.92))!important
      }
      #page-battle .bv2-arena:not(.bt-tutorial-active) .bv2-stage{
        position:relative;isolation:isolate;min-height:0!important;
        border-radius:8px 8px 20px 20px!important;
        border:1px solid rgba(207,179,118,.26);
        background:linear-gradient(180deg,rgba(3,10,10,.18),rgba(5,8,8,.22) 62%,rgba(0,0,0,.64)),
          url('assets/immortal-mountains.svg') center 48% / cover no-repeat,#102521!important;
        box-shadow:inset 0 0 70px rgba(0,0,0,.48),0 8px 26px rgba(0,0,0,.28)
      }
      #page-battle .bv2-stage::before{
        content:'';position:absolute;z-index:1;inset:0;pointer-events:none;
        background:radial-gradient(ellipse at 27% 53%,rgba(212,169,99,.13),transparent 30%),
          radial-gradient(ellipse at 73% 53%,rgba(161,91,105,.14),transparent 30%),
          linear-gradient(90deg,rgba(3,9,9,.32),transparent 25%,transparent 75%,rgba(3,9,9,.36))
      }
      #page-battle .bv2-stage::after{
        content:'';position:absolute;z-index:2;inset:auto -3% 0;height:21%;pointer-events:none;
        background:linear-gradient(180deg,transparent,rgba(4,11,10,.71))
      }
      #page-battle .bv2-stage-architecture::before{width:74%;height:72%;top:-49%;border-color:rgba(231,196,130,.14)}
      #page-battle .bv2-stage-platform{
        z-index:2;left:11%;right:11%;bottom:0;height:16%;
        border-color:rgba(235,195,118,.26);
        background:radial-gradient(ellipse,rgba(210,177,110,.09),rgba(7,17,16,.1) 70%,transparent 77%)
      }
      #page-battle .bv2-stage-center{z-index:1;top:49%;color:rgba(236,194,114,.085);font-size:clamp(64px,11vw,154px)}
      #page-battle .bv2-stage-fighter{
        z-index:4;width:46%;height:102%;bottom:-2%;
        filter:drop-shadow(0 10px 15px rgba(0,0,0,.55))
      }
      #page-battle .bv2-stage-fighter.me{left:3%}
      #page-battle .bv2-stage-fighter.enemy{right:3%}
      #page-battle .bv2-stage-fighter img{object-position:center bottom}
      #page-battle .bv2-stage-impact{
        position:absolute;z-index:6;inset:0;pointer-events:none;overflow:hidden
      }
      #page-battle .bv2-stage-impact::before{
        content:'';position:absolute;left:26%;top:18%;height:68%;width:8px;
        border-radius:100%;background:linear-gradient(180deg,transparent,#fff9d5 18%,#f9d489 45%,transparent 90%);
        box-shadow:0 0 16px 5px rgba(250,203,108,.55),0 0 49px rgba(255,243,191,.35);
        transform:rotate(53deg) scaleY(.05);animation:bv2SwordArc .67s ease-out both
      }
      #page-battle .bv2-stage-impact.from-enemy::before{
        left:69%;transform:rotate(-53deg) scaleY(.05);animation-name:bv2SwordArcEnemy;
        background:linear-gradient(180deg,transparent,#ffd9d7 18%,#ed8799 45%,transparent 90%);
        box-shadow:0 0 18px 4px rgba(235,111,124,.5)
      }
      #page-battle .bv2-stage-impact::after{
        content:'';position:absolute;left:72%;top:48%;width:42px;height:42px;border-radius:50%;
        border:3px solid rgba(255,239,179,.88);box-shadow:0 0 30px rgba(246,215,153,.65);
        transform:translate(-50%,-50%) scale(.2);animation:bv2ImpactRing .7s ease-out both
      }
      #page-battle .bv2-stage-impact.from-enemy::after{left:28%;border-color:rgba(255,169,167,.84)}
      @keyframes bv2SwordArc{0%{opacity:0;transform:translate(-70px,20px) rotate(53deg) scaleY(.05)}22%{opacity:1}65%{opacity:1;transform:translate(60px,-8px) rotate(53deg) scaleY(1.2)}100%{opacity:0;transform:translate(100px,-20px) rotate(53deg) scaleY(1.6)}}
      @keyframes bv2SwordArcEnemy{0%{opacity:0;transform:translate(70px,20px) rotate(-53deg) scaleY(.05)}22%{opacity:1}65%{opacity:1;transform:translate(-60px,-8px) rotate(-53deg) scaleY(1.2)}100%{opacity:0;transform:translate(-100px,-20px) rotate(-53deg) scaleY(1.6)}}
      @keyframes bv2ImpactRing{0%{opacity:0;transform:translate(-50%,-50%) scale(.15)}22%{opacity:1}100%{opacity:0;transform:translate(-50%,-50%) scale(3.8)}}
      #page-battle .bv2-stage-fighter .bv2-damage-pop{top:31%;font-size:clamp(19px,3vw,32px)}
      @media(max-width:620px){
        #page-battle .bv2-arena:not(.bt-tutorial-active) .bv2-stage-round{padding:2px 9px}
        #page-battle .bv2-arena:not(.bt-tutorial-active) .bv2-duel-cue{width:min(94%,330px);margin-bottom:4px}
        #page-battle .bv2-arena:not(.bt-tutorial-active) .bv2-duel-cue p{font-size:9px!important}
        #page-battle .bv2-stage-fighter{width:51%;height:98%}
        #page-battle .bv2-stage-fighter.me{left:-3%}
        #page-battle .bv2-stage-fighter.enemy{right:-3%}
      }
      @media(max-height:570px){
        #page-battle .bv2-arena:not(.hidden):not(.bt-tutorial-active){
          grid-template-rows:auto minmax(0,1fr) auto!important
        }
        #page-battle .bv2-arena:not(.bt-tutorial-active) .bv2-status-panel small{display:none}
        #page-battle .bv2-arena:not(.bt-tutorial-active) .bv2-status-panel{padding:3px 8px!important}
      }
      @media(prefers-reduced-motion:reduce){
        #page-battle .bv2-stage-impact::before,#page-battle .bv2-stage-impact::after{animation:none!important;opacity:0}
      }
    `;
    document.head.appendChild(style);
  }

  function syncFullscreenState() {
    const page = document.getElementById('page-battle');
    const active = !!page && !page.classList.contains('hidden');
    document.documentElement.classList.toggle(ACTIVE_CLASS, active);
    document.body?.classList.toggle(ACTIVE_CLASS, active);
  }

  function observeBattlePage() {
    const attach = () => {
      const page = document.getElementById('page-battle');
      if (!page) return false;
      if (page.dataset.battleV3FullscreenObserved === '1') {
        syncFullscreenState();
        return true;
      }
      page.dataset.battleV3FullscreenObserved = '1';
      new MutationObserver(syncFullscreenState).observe(page, { attributes: true, attributeFilter: ['class'] });
      syncFullscreenState();
      return true;
    };
    if (attach()) return;
    const observer = new MutationObserver(() => {
      if (attach()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  installQuizCompatibility();
  ensureStyle();
  observeBattlePage();
  window.addEventListener('pageshow', syncFullscreenState);
  window.addEventListener('popstate', syncFullscreenState);
})();
