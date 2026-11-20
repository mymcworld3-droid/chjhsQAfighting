// New-player tactical walkthrough. Advance only after real, server-confirmed actions.
// It is deliberately non-modal: tutorial highlights must not intercept map or quiz input.
(function () {
  'use strict';
  const KEY = 'qingyun:tactical-first-turn:v2:';
  const stages = [
    { target: '#btn-home-start', title: '進入問道試煉', text: '點選「問道試煉」，進入你的第一場戰鬥。' },
    { target: '#tactical-combat [data-quiz]', title: '答題充能', text: '先按左側的「答題充能」，答題可以補充移動與攻擊需要的體力。' },
    { target: '#btn-giveup', title: '選擇學習範圍', text: '按「設定範圍」，選擇適合自己的年級、科目及章節，儲存後會返回這道試煉題目。' },
    { target: '#option-btn-0', title: '完成第一題 · 答案 A', text: '教學首題的正確答案固定在 A。請選擇 A，查看解析後按「返回戰場」。' },
    { target: '#tactical-combat [data-wheel-action="attack-ring"], #tactical-combat [data-action="attack"]', title: '先認識攻擊按鈕', text: '右側行動指示已切至「攻擊」。請親自按一下「攻擊」按鈕，了解如何切換攻擊模式。' },
    { target: '#tactical-combat canvas', title: '向右移動一格', text: '已切回移動模式。靈狼在你右方三格；請點選角色正右方的第一格，只移動一格，靠近靈狼。' },
    { target: '#tactical-combat [data-wheel-action="attack-ring"], #tactical-combat [data-action="attack"]', title: '再次選擇攻擊', text: '移動完成！請再按一次右側的「攻擊」按鈕，準備朝靈狼出招。' },
    { target: '#tactical-combat canvas', title: '完成第一關', text: '已學會基本攻擊！接下來自由作戰，擊敗靈狼並完成第一關，再學習如何裝備技能。' },
    { target: '#tactical-combat [data-tutorial-collapse]', title: '收起戰場', text: '第一關通關了！請按結算畫面的「收起戰場」，回到宗門。' },
    { target: '#nav-training', title: '前往修煉', text: '點選下方的「修煉」，進入功法閣，準備裝備第一招。' },
    { target: '#manual-training-root [data-manual-pick-slot="0"]', title: '選擇技能槽', text: '點選第一個技能槽，開啟已領悟招式的選擇清單。' },
    { target: '#manual-training-root [data-manual-pick-skill], #manual-training-root [data-manual-guide-finish]', title: '裝備第一招', text: '選擇一招已領悟的技能並等候儲存成功。若已自動裝備，可按「確認已裝備」完成。' }
  ];
  const events = ['entered', 'question', 'scope-saved', 'answered', 'attack-selected', 'moved', 'attack-selected', 'attacked', 'stage-cleared', 'battle-closed', 'training-opened', 'slot-opened', 'skill-equipped'];
  let account = '', roomId = '', step = 0, timer = null, layer = null;
  const tutorialMove={x:2,y:3},tutorialEnemy={x:4,y:3};
  function read(uid) {
    try { return JSON.parse(localStorage.getItem(KEY + uid) || 'null'); } catch (_) { return null; }
  }
  function persist(status) {
    if (!account) return;
    try { localStorage.setItem(KEY + account, JSON.stringify({ status, step, roomId })); } catch (_) {}
  }
  function hide() { layer?.remove(); layer = null; }
  function cancel() { if (timer !== null) clearInterval(timer); timer = null; hide(); account = ''; roomId = ''; }
  function finish() {
    if (account) persist('done');
    window.showToast?.('好了，接下來開始盡情修煉吧！');
    cancel();
  }
  function visible(el) {
    return !!el && el.getClientRects().length > 0 && !el.closest?.('.hidden,[hidden]');
  }
  function blocked() {
    return !!document.querySelector(
      '#first-visit-layer,#game-startup-gate,#startup-cloud-curtain,' +
      '#scope-studio:not([hidden]),#xiuxian-story-layer,#dongtian-overlay,' +
      '#opportunity-overlay,#custom-alert-modal:not(.hidden),#report-modal:not(.hidden)' +
      (step === 9 ? '' : ',#tactical-combat [data-modal]:not([hidden])')
    );
  }
  function available() {
    if (blocked()) return false;
    if (step === 0) return visible(document.querySelector('#page-home'));
    if (step === 2 || step === 3)
      return visible(document.querySelector('#page-quiz')) &&
        visible(document.querySelector('#quiz-container'));
    if (step === 10) return visible(document.querySelector('#nav-training'));
    if (step >= 11) return visible(document.querySelector('#page-training'));
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
    const previous=read(uid);
    if (!uid || previous?.status === 'done') return;
    if (!newAccount && previous?.status !== 'pending') return;
    if (timer !== null && account === uid) return;
    cancel();
    account = uid;
    // Preserve post-combat navigation after refresh, while old unfinished
    // battle actions restart so they cannot target a different battlefield.
    const resume=previous?.status==='pending'&&Number.isInteger(previous.step)&&
      previous.step>=8&&previous.step<stages.length;
    step=resume?previous.step:0;
    roomId=resume?String(previous.roomId||''):'';
    persist('pending');
    timer = setInterval(tick, 160);
    tick();
  };
  window.cancelFirstAnswerGuide = cancel;
  window.firstAnswerGuideStep = uid => uid && uid === account ? step : -1;
  // A solo receipt authenticates the option multiset, not presentation order.
  // Move the signed correct choice to A without changing grading or question.
  window.arrangeFirstGuideAnswerA = (uid,quiz) => {
    if(uid !== account || step < 1 || step > 3 || !quiz?.data)return false;
    const data=quiz.data,answer=Number(data.ans);
    if(!Array.isArray(data.opts)||data.opts.length<2||
       !Number.isInteger(answer)||answer<0||answer>=data.opts.length)return false;
    if(answer!==0){
      [data.opts[0],data.opts[answer]]=[data.opts[answer],data.opts[0]];
      data.ans=0;
    }
    return true;
  };
  window.addEventListener('qingyun:tactical-tutorial', event => {
    const detail = event.detail || {};
    if (!account || detail.uid !== account || detail.kind !== events[step]) return;
    if (step===0) {
      if(detail.stage!==1 || !detail.roomId)return;
      roomId=detail.roomId;
    } else if(step<=9 && detail.roomId && roomId && detail.roomId!==roomId)return;
    if (step===2 && detail.origin!=='page-quiz')return;
    if (step>=4 && step<=9 && detail.stage!==1)return;
    if (step===5 && (detail.x!==tutorialMove.x || detail.y!==tutorialMove.y))return;
    if (step===7 && (detail.x!==tutorialEnemy.x || detail.y!==tutorialEnemy.y))return;
    if (step===8 && detail.won!==true)return;
    if (step===12 && detail.verified!==true)return;
    if (step===stages.length-1){finish();return;}
    step+=1;
    persist('pending');
    hide();
    tick();
  });
  document.addEventListener('keydown', event => {
    if (layer && event.key === 'Escape') hide(); // Pauses the hint, never marks it complete.
  });
  window.addEventListener('resize', () => { if (layer) tick(); });
})();