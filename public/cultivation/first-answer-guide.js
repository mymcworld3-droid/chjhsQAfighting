// Three short pointers for newly created accounts; no sample questions or rewards.
(function () {
  'use strict';
  const KEY = 'qingyun:first-answer-guide:v1:';
  const steps = [
    { target: 'btn-home-start', title: '開始答題', text: '從這裡開始答題。', action: '開始答題' },
    { target: 'btn-report', title: '題目有錯', text: '如果題目有問題，可以按下「題目有錯」。', action: '下一個' },
    { target: 'quiz-helper-launcher', title: '問道助手', text: '有問題隨時提問！', action: '開始作答' }
  ];
  const $ = id => document.getElementById(id);
  let account = '', step = 0, timer = null, layer = null, waiting = false, starting = false;
  const sessionDone = new Set();
  function stored(uid) {
    try { return JSON.parse(localStorage.getItem(KEY + uid) || 'null'); } catch (_) { return null; }
  }
  function save(status) {
    try { localStorage.setItem(KEY + account, JSON.stringify({ status, step })); } catch (_) {}
  }
  function hide() { layer?.remove(); layer = null; }
  function cancel() { clearInterval(timer); timer = null; hide(); account = ''; starting = false; }
  function finish() {
    if (account) { save('done'); sessionDone.add(account); }
    cancel();
  }
  function visible(el) { return !!el && el.getClientRects().length > 0 && !el.closest('.hidden,[hidden]'); }
  function blocked() {
    return !!document.querySelector('#first-visit-layer,#game-startup-gate,#startup-cloud-curtain,#scope-studio:not([hidden]),#xiuxian-story-layer,#dongtian-overlay,#opportunity-overlay,#custom-alert-modal:not(.hidden),#report-modal:not(.hidden)');
  }
  function position(target) {
    const rect = target.getBoundingClientRect();
    const width = document.documentElement.clientWidth, height = document.documentElement.clientHeight;
    const left = Math.max(4, rect.left - 5), top = Math.max(4, rect.top - 5);
    const right = Math.min(width - 4, rect.right + 5), bottom = Math.min(height - 4, rect.bottom + 5);
    const hole = layer.querySelector('.fag-highlight');
    Object.assign(hole.style, { left: left + 'px', top: top + 'px', width: Math.max(0, right - left) + 'px', height: Math.max(0, bottom - top) + 'px' });
    const masks = layer.querySelectorAll('.fag-mask');
    const boxes = [[0, 0, width, top], [0, bottom, width, height-bottom], [0, top, left, bottom-top], [right, top, width-right, bottom-top]];
    masks.forEach((mask, i) => {
      const [x, y, w, h] = boxes[i];
      Object.assign(mask.style, { left:x+'px', top:y+'px', width:Math.max(0,w)+'px', height:Math.max(0,h)+'px' });
    });
    const card = layer.querySelector('.fag-card');
    const cardHeight = card.getBoundingClientRect().height;
    const cardTop = top >= cardHeight + 28 ? top - cardHeight - 18 : bottom + cardHeight + 28 <= height ? bottom + 18 : 16;
    card.style.top = Math.max(12, Math.min(height - cardHeight - 12, cardTop)) + 'px';
  }
  function render(target) {
    if (!layer) {
      layer = document.createElement('section'); layer.id = 'first-answer-guide';
      layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-labelledby', 'first-answer-guide-title');
      layer.innerHTML = '<div class="fag-mask"></div>'.repeat(4) + '<div class="fag-highlight"></div><div class="fag-card"><small></small><h2 id="first-answer-guide-title"></h2><p></p><div class="fag-actions"><button type="button" data-guide-skip>略過</button><button type="button" data-guide-next></button></div></div>';
      layer.querySelector('[data-guide-skip]').onclick = finish;
      layer.querySelector('[data-guide-next]').onclick = () => {
        if (step === 0) { if (!starting) $(steps[0].target)?.click(); }
        else if (step === 1) { step = 2; save('pending'); hide(); tick(); }
        else finish();
      };
      document.body.append(layer);
      layer.querySelector('small').textContent = `${step + 1} / 3`;
      layer.querySelector('h2').textContent = steps[step].title;
      layer.querySelector('p').textContent = steps[step].text;
      layer.querySelector('[data-guide-next]').textContent = steps[step].action;
      layer.querySelector('[data-guide-next]').focus({ preventScroll: true });
    }
    position(target);
  }
  function tick() {
    if (!account) return;
    if (window.getCurrentUserData?.()?.uid !== account) { cancel(); return; }
    if (blocked()) { hide(); return; }
    if (waiting) {
      if (visible($('page-quiz')) && visible($('quiz-container'))) {
        waiting = false; starting = false; step = 1; save('pending');
      } else return;
    }
    if (step > 0 && !visible($('page-quiz'))) { hide(); return; }
    if (step === 0 && !visible($('page-home'))) { hide(); return; }
    const target = $(steps[step].target);
    if (!visible(target)) { hide(); return; }
    if (!layer) target.scrollIntoView({ block:'center', inline:'nearest', behavior:'instant' });
    render(target);
  }
  window.scheduleFirstAnswerGuide = (uid, newAccount = false) => {
    if (!uid) return;
    const record = stored(uid);
    if (sessionDone.has(uid) || record?.status === 'done') return;
    if (!newAccount && record?.status !== 'pending') return;
    if (account === uid && timer) return;
    cancel(); account = uid;
    // Resuming after a reload starts at the entry, since the quiz page is not restored yet.
    step = 0; waiting = false; save('pending');
    timer = setInterval(tick, 160);
  };
  window.cancelFirstAnswerGuide = cancel;
  document.addEventListener('click', event => {
    if (!account || !layer) return;
    if (step === 0 && event.target.closest?.('#btn-home-start')) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (starting) return;
      starting = true; waiting = true; hide();
      const uid = account;
      Promise.resolve().then(() => window.startQuizFlow?.()).catch(() => {
        window.showToast?.('題目暫時無法載入，請再試一次。');
      }).finally(() => {
        if (account !== uid || !waiting) return;
        starting = false;
        if (!visible($('page-quiz'))) { waiting = false; step = 0; }
        tick();
      });
    } else if (step === 1 && event.target.closest?.('#btn-report')) {
      step = 2; save('pending'); hide();
    } else if (step === 2 && event.target.closest?.('#quiz-helper-launcher')) finish();
  }, true);
  document.addEventListener('keydown', event => {
    if (layer && event.key === 'Escape') { event.preventDefault(); finish(); }
  });
  window.addEventListener('resize', () => { if (layer) tick(); });
})();
