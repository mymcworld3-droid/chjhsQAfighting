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
        grid-template-columns:minmax(0,1fr) minmax(280px,360px)!important;
        grid-template-areas:'score score' 'rule rule' 'question log'!important;
        grid-template-rows:auto auto minmax(0,1fr)!important;gap:12px 14px!important;
      }
      #page-battle .bv2-scoreboard{grid-area:score}
      #page-battle .bv2-duel-rule{grid-area:rule}
      #page-battle .bv2-question-card{grid-area:question;min-width:0;min-height:0;padding:clamp(16px,2vw,26px)!important;display:flex;flex-direction:column;justify-content:flex-start;overflow-y:auto;overflow-wrap:anywhere}
      #page-battle .bv2-question-card h3{font-size:clamp(17px,1.65vw,24px)!important;line-height:1.65!important}
      #page-battle .bv2-options{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important}
      #page-battle .bv2-option{min-height:64px!important;font-size:clamp(11px,1vw,14px)!important}
      #page-battle .bv2-log-wrap{grid-area:log;margin:0!important;min-height:0;max-height:none!important;display:flex;flex-direction:column;overflow:hidden}
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
        #page-battle .bv2-arena:not(.hidden){grid-template-columns:minmax(0,1fr)!important;grid-template-areas:'score' 'rule' 'question' 'log'!important;grid-template-rows:auto!important}
        #page-battle .bv2-log-wrap{max-height:250px!important}
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
