// New-player tactical walkthrough. Advance only after real, server-confirmed actions.
// It is deliberately non-modal: tutorial highlights must not intercept map or quiz input.
(function () {
  'use strict';
  const KEY = 'qingyun:tactical-first-turn:v2:';
  const stages = [
    { target: '#btn-home-start', title: '進入問道試煉', text: '點選「問道試煉」，進入你的第一場戰鬥。' },
    { target: '#tactical-combat [data-quiz]', title: '答題充能', text: '先按左側的「答題充能」，答題可以補充移動與攻擊需要的體力。' },
    { target: '#btn-giveup', title: '選擇學習範圍', text: '按「設定範圍」，選擇適合自己的年級、科目及章節，儲存後會返回這道試煉題目。' },
    { target: '#options-container button:not(:disabled)', title: '完成第一題', text: '閱讀題目並選擇答案。批改後可以先看解析，再按「返回戰場」。' },
    { target: '#tactical-combat [data-wheel-action="move"], #tactical-combat [data-action="move"]', title: '移動角色', text: '在右側選擇「移動」，再點選地圖上的灰色地格。移動一格消耗 1 體力。' },
    { target: '#tactical-combat [data-wheel-action="attack-ring"], #tactical-combat [data-action="attack"]', title: '攻擊靈獸', text: '選擇右側的「攻擊」與招式，再點選有效的攻擊地格。若體力不足，可再次答題充能。' },
    { target: '#tactical-combat [data-end]', title: '結束回合', text: '移動與攻擊完成後，按「結束回合」，讓靈獸行動。之後可繼續答題與戰鬥。' }
  ];
  const events = ['entered', 'question', 'scope-saved', 'answered', 'moved', 'attacked', 'ended'];
  let account = '', step = 0, timer = null, layer = null;
  function read(uid) {
    try { return JSON.parse(localStorage.getItem(KEY + uid) || 'null'); } catch (_) { return null; }
  }
  function persist(status) {
    if (!account) return;
    try { localStorage.setItem(KEY + account, JSON.stringify({ status, step })); } catch (_) {}
  }
  function hide() { layer?.remove(); layer = null; }
  function cancel() { if (timer !== null) clearInterval(timer); timer = null; hide(); account = ''; }
  function finish() {
    if (account) persist('done');
    window.showToast?.('第一回合教學完成，繼續你的問道之旅！');
    cancel();
  }
  function visible(el) {
    return !!el && el.getClientRects().length > 0 && !el.closest?.('.hidden,[hidden]');
  }
  function blocked() {
    return !!document.querySelector(
      '#first-visit-layer,#game-startup-gate,#startup-cloud-curtain,' +
      '#scope-studio:not([hidden]),#xiuxian-story-layer,#dongtian-overlay,' +
      '#opportunity-overlay,#custom-alert-modal:not(.hidden),#report-modal:not(.hidden),' +
      '#tactical-combat [data-modal]:not([hidden])'
    );
  }
  function available() {
    if (blocked()) return false;
    if (step === 0) return visible(document.querySelector('#page-home'));
    if (step === 2 || step === 3)
      return visible(document.querySelector('#page-quiz')) &&
        visible(document.querySelector('#quiz-container'));
    return visible(document.querySelector('#tactical-combat'));
  }
  function position(target) {
    const rect = target.getBoundingClientRect();
    const width = document.documentElement.clientWidth, height = document.documentElement.clientHeight;
    const left = Math.max(4, Math.min(width - 4, rect.left - 5));
    const top = Math.max(4, Math.min(height - 4, rect.top - 5));
    const right = Math.max(left, Math.min(width - 4, rect.right + 5));
    const bottom = Math.max(top, Math.min(height - 4, rect.bottom + 5));
    Object.assign(layer.querySelector('.fag-highlight').style, {
      left: left + 'px', top: top + 'px', width: (right - left) + 'px', height: (bottom - top) + 'px'
    });
    const masks = layer.querySelectorAll('.fag-mask');
    const boxes = [[0, 0, width, top], [0, bottom, width, height - bottom],
      [0, top, left, bottom - top], [right, top, width - right, bottom - top]];
    masks.forEach((mask, i) => {
      const [x, y, w, h] = boxes[i];
      Object.assign(mask.style, { left: x + 'px', top: y + 'px',
        width: Math.max(0, w) + 'px', height: Math.max(0, h) + 'px' });
    });
    const card = layer.querySelector('.fag-card');
    const cardHeight = card.getBoundingClientRect().height;
    const above = top - cardHeight - 18;
    const below = bottom + 18;
    const cardTop = above >= 12 ? above : below + cardHeight <= height - 12 ? below : 12;
    card.style.top = Math.max(12, Math.min(height - cardHeight - 12, cardTop)) + 'px';
  }
  function show(target) {
    if (!layer) {
      layer = document.createElement('section');
      layer.id = 'first-answer-guide';
      layer.setAttribute('role', 'status');
      layer.setAttribute('aria-live', 'polite');
      layer.innerHTML = '<div class="fag-mask"></div>'.repeat(4) +
        '<div class="fag-highlight"></div><div class="fag-card">' +
        '<small></small><h2></h2><p></p><div class="fag-actions">' +
        '<button type="button" data-guide-skip>略過教學</button>' +
        '<span class="fag-prompt">依提示完成操作</span></div></div>';
      layer.querySelector('[data-guide-skip]').onclick = finish;
      document.body.append(layer);
    }
    layer.querySelector('small').textContent = '新手教學 · ' + (step + 1) + ' / ' + stages.length;
    layer.querySelector('h2').textContent = stages[step].title;
    layer.querySelector('p').textContent = stages[step].text;
    position(target);
  }
  function tick() {
    if (!account) return;
    if (window.getCurrentUserData?.()?.uid !== account) { cancel(); return; }
    if (!available()) { hide(); return; }
    const target = document.querySelector(stages[step].target);
    if (!visible(target)) { hide(); return; }
    show(target);
  }
  window.scheduleFirstAnswerGuide = (uid, newAccount = false) => {
    if (!uid || read(uid)?.status === 'done') return;
    if (!newAccount && read(uid)?.status !== 'pending') return;
    if (timer !== null && account === uid) return;
    cancel();
    account = uid;
    // Do not resume mid-combat against a different room after refresh/re-login.
    step = 0;
    persist('pending');
    timer = setInterval(tick, 160);
    tick();
  };
  window.cancelFirstAnswerGuide = cancel;
  window.addEventListener('qingyun:tactical-tutorial', event => {
    const detail = event.detail || {};
    if (!account || detail.uid !== account || detail.kind !== events[step]) return;
    if (step === 2 && detail.origin !== 'page-quiz') return;
    if (step === stages.length - 1) { finish(); return; }
    step += 1;
    persist('pending');
    hide();
    tick();
  });
  document.addEventListener('keydown', event => {
    if (layer && event.key === 'Escape') hide(); // Pauses the hint, never marks it complete.
  });
  window.addEventListener('resize', () => { if (layer) tick(); });
})();