import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// 凡人期新手教學：先用不計修為的範例題教會答題、看題解與回報問題，再介紹後續功能。
(function () {
  'use strict';

  const FIELD = 'newbieTutorialV1';
  const VERSION = 2;
  const FOUNDATION_SCORE = 10;
  let active = false;
  let index = 0;
  let autoStarted = false;
  let resizeHandler = null;
  let exampleInstalled = false;
  let exampleAnswered = false;
  let reportOpened = false;
  let reportCaptureBound = false;
  let navigationCaptureBound = false;
  let dongtianEventsBound = false;
  let dongtianOpen = false;
  let dongtianDemoReady = false;
  let dongtianDemoStarted = false;
  let dongtianDemoCompleted = false;
  let dongtianDemoReturned = false;
  let dongtianDemoDeleted = false;

  const EXAMPLE_QUESTION = '範例：2 + 3 = ?';
  const EXAMPLE_OPTIONS = ['4', '5', '6', '7'];
  const EXAMPLE_ANSWER = 1;

  const steps = [
    {
      page: 'page-home', target: '#xiuxian-panel', kicker: '第一步 · 凡人入門', title: '先學會問道答題',
      body: '凡人期最重要的事情就是學會答題。接下來先做一題<strong>不計修為的範例題</strong>，帶你看懂題目、選答案、查看題解，以及題目有問題時如何回報。',
      note: '範例題只用來教學，不會改變修為、答題紀錄或連勝。'
    },
    {
      page: 'page-quiz', target: '#question-text', demo: true, kicker: '第二步 · 看題目', title: '先讀清楚題目',
      body: '正式問道時，題目會顯示在這裡。上方標籤會告訴你題目類型；這次的範例題是 <strong>2 + 3 = ?</strong>。',
      note: '先理解題意，再往下選答案。這題不計修為。'
    },
    {
      page: 'page-quiz', target: '#options-container', demo: true, requiresAnswer: true, kicker: '第三步 · 選答案', title: '點選你認為正確的答案',
      body: '請直接點下面的選項作答。選錯沒關係，可以再試一次；選對後才會進入下一個教學步驟。',
      note: '試著找出 2 + 3 的答案。'
    },
    {
      page: 'page-quiz', target: '#feedback-section', demo: true, requiresAnswer: true, kicker: '第四步 · 看題解', title: '答完一定要看題解',
      body: '作答後這裡會顯示結果與<strong>題解參悟</strong>。不論答對或答錯，都建議看清楚解析，確認自己是真的理解，而不是只記答案。',
      note: '正式題目答對會增加修為；這題只是教學範例。'
    },
    {
      page: 'page-quiz', target: '#btn-next-step', demo: true, kicker: '第五步 · 下一題', title: '看完解析再進下一題',
      body: '正式答題時，看完題解後按「下一題」即可繼續問道。若想先離開，也可以回到首頁。',
      note: '教學範例不會真的產生下一題。'
    },
    {
      page: 'page-quiz', target: '#btn-report', demo: true, requiresReport: true, kicker: '第六步 · 回報問題', title: '題目有錯就按「回報問題」',
      body: '如果遇到<strong>答案錯誤、題意不清、選項有問題、錯字或解析不合理</strong>，請按下這顆「回報問題」。現在請實際按一次看看。',
      note: '教學期間不會真的送出回報。'
    },
    {
      page: 'page-quiz', target: '#newbie-report-demo', demo: true, requiresReport: true, kicker: '第七步 · 如何回報', title: '說清楚哪裡有問題',
      body: '正式回報時，請描述你看到的問題，例如「正確答案應該是 B」、「題目有兩個答案都合理」或「解析與答案矛盾」。系統會檢查回報內容；不要把正常題目當成錯題亂回報。',
      note: '回報越具體，越容易判斷與修正。'
    },
    {
      page: 'page-home', target: '#btn-home-start', kicker: '第八步 · 正式問道', title: '現在會正式答題了',
      body: '回到首頁後，點「問道試煉」就能開始真正的單人答題。正式題目答對會增加修為，答錯不扣修為。',
      note: '凡人期先靠問道累積修為，一步一步往築基前進。'
    },
    {
      page: 'page-settings', target: '#set-source-mode', settingsSection: 'scope', kicker: '第九步 · 範圍選擇', title: '展開「範圍設定」決定題目從哪裡來',
      body: '洞府現在把出題來源獨立放在可收合的<strong>範圍設定</strong>。展開後可選：<strong>綜合題目</strong>、<strong>指定題庫</strong>或<strong>專注練習</strong>。',
      note: '考前複習建議使用指定題庫或專注練習。'
    },
    {
      page: 'page-settings', target: '#set-difficulty', settingsSection: 'profile', kicker: '第十步 · 難度', title: '展開「個人資料」調整難度',
      body: '洞府的<strong>個人資料</strong>收合區保留程度、強弱科與難度設定。難度可以交給 AI AUTO 自動調整，也可以固定為簡單、中等或困難。',
      note: '剛開始可以先使用 AUTO 或中等。'
    },
    {
      page: 'page-home', target: 'button[onclick*="startBattleMatchmaking"]', kicker: '第十一步 · 築基', title: '10 修為後開放多人玩法',
      body: '達到 <strong>築基初期（10 修為）</strong> 後，才會開放配對鬥法、接受邀請與仙盟等多人功能，同時開放修煉背包。',
      note: '凡人期先把問道與洞天流程學熟。'
    },
    {
      page: 'page-home', target: '#xiuxian-panel', kicker: '完成 · 開始修行', title: '問道基本操作已完成',
      body: '問道記住：<strong>看題目 → 選答案 → 看題解 → 下一題</strong>。達到煉氣五層時，系統會另外帶你完整實作洞天：找到入口、建立私人範例、遊玩並刪除。',
      note: '現在可以正式開始自己的修行；煉氣五層會開啟洞天專屬教學。'
    }
  ];

  function ensureStyle() {
    if (document.getElementById('newbie-tutorial-style')) return;
    const style = document.createElement('style');
    style.id = 'newbie-tutorial-style';
    style.textContent = `
      #newbie-tutorial-layer{position:fixed;inset:0;z-index:12500;pointer-events:none}.newbie-tutorial-dim{position:absolute;inset:0;background:rgba(0,0,0,.74);backdrop-filter:blur(2px);pointer-events:auto}.newbie-tutorial-spotlight{position:fixed;z-index:1;border:2px solid rgba(236,197,103,.95);border-radius:18px;box-shadow:0 0 0 9999px rgba(0,0,0,.76),0 0 0 6px rgba(216,177,93,.10),0 0 36px rgba(216,177,93,.32);transition:all .28s ease;pointer-events:none}.newbie-tutorial-card{position:fixed;z-index:3;left:50%;bottom:22px;transform:translateX(-50%);width:min(calc(100vw - 28px),520px);padding:20px;border-radius:26px;border:1px solid rgba(216,177,93,.42);background:linear-gradient(145deg,rgba(25,21,13,.99),rgba(7,7,7,.995));box-shadow:0 30px 90px rgba(0,0,0,.7);pointer-events:auto}.newbie-tutorial-kicker{color:#9f8246;font-size:8px;font-weight:900;letter-spacing:.18em}.newbie-tutorial-card h3{margin:5px 0 8px;color:#f5ead5;font-size:21px;font-weight:900}.newbie-tutorial-card p{margin:0;color:#b8aa90;font-size:12px;line-height:1.75}.newbie-tutorial-card p strong{color:#e4bf61}.newbie-tutorial-note{margin-top:9px!important;color:#817662!important;font-size:10px!important}.newbie-tutorial-progress{display:flex;gap:5px;margin:14px 0 12px;flex-wrap:wrap}.newbie-tutorial-progress i{width:6px;height:6px;border-radius:999px;background:rgba(216,177,93,.18)}.newbie-tutorial-progress i.active{width:21px;background:#d8b15d}.newbie-tutorial-actions{display:grid;grid-template-columns:auto 1fr auto;gap:8px}.newbie-tutorial-actions button{min-height:40px;border-radius:13px;padding:0 13px;font-size:10px;font-weight:900}.newbie-tutorial-skip,.newbie-tutorial-prev{color:#9b907b;border:1px solid rgba(216,177,93,.14);background:#0c0c0c}.newbie-tutorial-next{color:#fff0c7;border:1px solid #d8b15d;background:linear-gradient(135deg,#a87827,#5e3b0f)}.newbie-tutorial-next:disabled{opacity:.38;cursor:not-allowed}.newbie-tutorial-replay{display:inline-flex;align-items:center;gap:6px;margin:8px 0 14px;min-height:34px;padding:0 11px;border-radius:12px;color:#d9bd76;border:1px solid rgba(216,177,93,.24);background:rgba(216,177,93,.055);font-size:9px;font-weight:900}
      .newbie-example-option{width:100%;display:flex;align-items:center;gap:12px;padding:13px 15px;border-radius:14px;border:1px solid rgba(216,177,93,.18);background:rgba(15,15,15,.92);color:#eee2c7;font-weight:800;text-align:left;transition:.18s}.newbie-example-option:hover{border-color:rgba(216,177,93,.6);transform:translateY(-1px)}.newbie-example-option.wrong{border-color:rgba(239,68,68,.65);background:rgba(127,29,29,.16);color:#fecaca}.newbie-example-option.correct{border-color:rgba(74,222,128,.65);background:rgba(20,83,45,.18);color:#bbf7d0}.newbie-example-option span{width:25px;height:25px;border-radius:999px;display:grid;place-items:center;background:rgba(216,177,93,.12);color:#d8b15d;font-size:10px}.newbie-report-demo{margin-top:12px;padding:14px;border-radius:14px;border:1px solid rgba(216,177,93,.28);background:rgba(216,177,93,.06);color:#cfc2a8;font-size:11px;line-height:1.7}.newbie-report-demo strong{display:block;color:#f2d88e;margin-bottom:5px}.newbie-report-demo ul{margin:0;padding-left:18px}.newbie-report-demo em{display:block;margin-top:7px;color:#8f846f;font-style:normal;font-size:9px}
      @media(max-width:520px){.newbie-tutorial-card{bottom:12px;padding:17px}.newbie-tutorial-card h3{font-size:18px}.newbie-tutorial-actions{grid-template-columns:1fr 1fr}.newbie-tutorial-skip{grid-column:1/-1;grid-row:2}}
    `;
    document.head.appendChild(style);
  }

  function userData(){ return window.getCurrentUserData?.() || null; }
  function marker(){ return userData()?.[FIELD] || null; }
  function visible(el){ if(!el) return false; const s=getComputedStyle(el); return s.display!=='none'&&s.visibility!=='hidden'&&el.getClientRects().length>0; }
  function navigate(page){ if(page&&typeof window.switchToPage==='function') window.switchToPage(page); }
  function target(selector){ const all=Array.from(document.querySelectorAll(selector||'')); return all.find(visible)||all[0]||null; }

  function currentPageId() {
    const pages = Array.from(document.querySelectorAll('.page-section'));
    return pages.find(visible)?.id || '';
  }

  function navRoute(destination, label, targetSelector, body) {
    return {
      routeGate: true,
      destination,
      target: targetSelector,
      kicker: '先找到功能入口',
      title: `先找到「${label}」在哪裡`,
      body,
      note: '請親自點擊金框標示的入口；進入後教學會自動繼續，不會直接把你傳送過去。'
    };
  }

  function routeForStep(step) {
    if (!step?.page) return null;
    const current = currentPageId();
    if (current === step.page) return null;

    // 問道不是底部獨立分頁：先回首頁，再由首頁的「問道試煉」進入。
    if (step.page === 'page-quiz') {
      if (current !== 'page-home') {
        return navRoute(
          'page-home',
          '首頁',
          '[data-target="page-home"]',
          '問道試煉的入口在首頁。請先看底部導覽，找到並點擊「首頁」。'
        );
      }
      return navRoute(
        'page-quiz',
        '問道試煉',
        '#btn-home-start',
        '這顆「問道試煉」就是正式答題的入口。請自己點一次，教學會攔住正式出題並改用不計修為的範例題。'
      );
    }

    if (step.page === 'page-settings') {
      return navRoute(
        'page-settings',
        '洞府',
        '[data-target="page-settings"]',
        '範圍、難度與個人設定都在「洞府」。請看底部導覽，找到並點擊「洞府」。'
      );
    }

    if (step.page === 'page-home') {
      return navRoute(
        'page-home',
        '首頁',
        '[data-target="page-home"]',
        '這個功能位在首頁。請看底部導覽，找到並點擊「首頁」。'
      );
    }

    const genericTarget = `[data-target="${step.page}"]`;
    if (target(genericTarget)) {
      return navRoute(
        step.page,
        '對應功能',
        genericTarget,
        '請先從底部導覽找到這個功能的入口並親自點擊，再繼續教學。'
      );
    }
    return null;
  }

  function displayStep() {
    return routeForStep(steps[index]) || steps[index];
  }

  function setExampleFeedback(correct) {
    const section = document.getElementById('feedback-section');
    const icon = document.getElementById('feedback-icon');
    const title = document.getElementById('feedback-title');
    const text = document.getElementById('feedback-text');
    if (!section || !icon || !title || !text) return;
    section.classList.remove('hidden');
    if (correct) {
      icon.innerHTML = '<i class="fa-solid fa-circle-check text-green-400"></i>';
      title.textContent = '答對了！';
      title.className = 'text-lg font-bold font-sci text-green-400';
      text.innerHTML = '2 + 3 = 5。正式問道時，答完題也要閱讀這裡的解析，確認自己理解原因。';
    } else {
      icon.innerHTML = '<i class="fa-solid fa-circle-xmark text-red-400"></i>';
      title.textContent = '再想一下';
      title.className = 'text-lg font-bold font-sci text-red-400';
      text.innerHTML = '這是教學範例，可以重新選一次。把 2 個東西和 3 個東西合在一起，共有 5 個。';
    }
  }

  function answerExample(choice, button) {
    const buttons = Array.from(document.querySelectorAll('.newbie-example-option'));
    buttons.forEach((item) => item.classList.remove('wrong', 'correct'));
    if (choice !== EXAMPLE_ANSWER) {
      button.classList.add('wrong');
      setExampleFeedback(false);
      updateSpotlight();
      return;
    }
    exampleAnswered = true;
    button.classList.add('correct');
    buttons.forEach((item) => { item.disabled = true; });
    setExampleFeedback(true);
    renderCardOnly();
    setTimeout(updateSpotlight, 80);
  }

  function installExampleQuiz() {
    const container = document.getElementById('quiz-container');
    const loading = document.getElementById('quiz-loading');
    const question = document.getElementById('question-text');
    const badge = document.getElementById('quiz-badge');
    const options = document.getElementById('options-container');
    const feedback = document.getElementById('feedback-section');
    if (!container || !question || !badge || !options || !feedback) return;

    loading?.classList.add('hidden');
    container.classList.remove('hidden');
    document.getElementById('solo-progress-panel')?.classList.add('hidden');
    question.textContent = EXAMPLE_QUESTION;
    badge.textContent = '新手範例 · 不計修為';
    options.innerHTML = EXAMPLE_OPTIONS.map((option, i) => `<button type="button" class="newbie-example-option" data-example-choice="${i}"><span>${String.fromCharCode(65+i)}</span>${option}</button>`).join('');
    options.querySelectorAll('[data-example-choice]').forEach((button) => {
      button.addEventListener('click', () => answerExample(Number(button.dataset.exampleChoice), button));
    });
    if (exampleAnswered) setExampleFeedback(true); else feedback.classList.add('hidden');
    document.getElementById('btn-giveup')?.setAttribute('data-newbie-demo', '1');
    document.getElementById('btn-report')?.setAttribute('data-newbie-demo', '1');
    exampleInstalled = true;
    if (reportOpened) showReportDemo();
  }

  function showReportDemo() {
    reportOpened = true;
    let panel = document.getElementById('newbie-report-demo');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'newbie-report-demo';
      panel.className = 'newbie-report-demo';
      panel.innerHTML = '<strong><i class="fa-solid fa-bug"></i> 回報題目問題</strong><ul><li>答案明顯錯誤</li><li>題目或選項有歧義</li><li>錯字、排版或內容缺漏</li><li>題解與正確答案矛盾</li></ul><em>正式題目按「回報問題」後，依畫面填寫並送出即可。這次範例不會送到伺服器。</em>';
      const reportRow = document.getElementById('btn-report')?.parentElement;
      reportRow?.insertAdjacentElement('afterend', panel);
    }
    renderCardOnly();
    setTimeout(updateSpotlight, 80);
  }

  function cleanupExampleQuiz() {
    if (!exampleInstalled) return;
    document.getElementById('newbie-report-demo')?.remove();
    document.getElementById('btn-giveup')?.removeAttribute('data-newbie-demo');
    document.getElementById('btn-report')?.removeAttribute('data-newbie-demo');
    document.getElementById('options-container')?.replaceChildren();
    document.getElementById('feedback-section')?.classList.add('hidden');
    document.getElementById('quiz-container')?.classList.add('hidden');
    exampleInstalled = false;
  }

  function bindDemoGuards() {
    if (reportCaptureBound) return;
    reportCaptureBound = true;
    document.addEventListener('click', (event) => {
      if (!active || !exampleInstalled) return;
      const report = event.target.closest?.('#btn-report');
      if (report) {
        event.preventDefault();
        event.stopImmediatePropagation();
        showReportDemo();
        if (steps[index]?.requiresReport && index < steps.length - 1) {
          index++;
          render();
        }
        return;
      }
      const giveup = event.target.closest?.('#btn-giveup');
      if (giveup) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      const next = event.target.closest?.('#btn-next-step');
      if (next) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }

  function bindNavigationGuards() {
    if (navigationCaptureBound) return;
    navigationCaptureBound = true;
    document.addEventListener('click', (event) => {
      if (!active) return;
      const route = routeForStep(steps[index]);
      if (!route) return;
      const entrance = event.target.closest?.(route.target);
      if (!entrance) return;

      // 入口一定要由玩家自己點；攔截原本 onclick，避免範例問道真的建立正式答題 session。
      event.preventDefault();
      event.stopImmediatePropagation();
      navigate(route.destination);

      setTimeout(() => {
        if (route.destination === 'page-quiz') installExampleQuiz();
        render();
      }, 60);
    }, true);
  }

  function bindDongtianTutorialEvents() {
    if (dongtianEventsBound) return;
    dongtianEventsBound = true;

    document.addEventListener('click', (event) => {
      if (!active) return;
      const head = event.target.closest?.('#dongtian-card .dongfu-collapse-head');
      if (!head) return;
      setTimeout(() => {
        dongtianOpen = !document.getElementById('dongtian-body')?.hidden;
        renderCardOnly();
        updateSpotlight();
      }, 80);
    }, true);

    window.addEventListener('newbie:dongtian-demo-ready', () => {
      if (!active) return;
      dongtianDemoReady = true;
      renderCardOnly();
      setTimeout(updateSpotlight, 100);
    });
    window.addEventListener('newbie:dongtian-demo-started', () => {
      if (!active) return;
      dongtianDemoStarted = true;
      if (steps[index]?.requiresDongtianStart && index < steps.length - 1) {
        index += 1;
        setTimeout(render, 820);
      } else {
        renderCardOnly();
      }
    });
    window.addEventListener('newbie:dongtian-demo-completed', () => {
      if (!active) return;
      dongtianDemoCompleted = true;
      if (steps[index]?.requiresDongtianComplete && index < steps.length - 1) {
        index += 1;
        setTimeout(render, 80);
      } else {
        renderCardOnly();
      }
    });
    window.addEventListener('newbie:dongtian-demo-returned', () => {
      if (!active) return;
      dongtianDemoReturned = true;
      if (steps[index]?.requiresDongtianReturn && index < steps.length - 1) {
        index += 1;
        setTimeout(render, 180);
      } else {
        renderCardOnly();
      }
    });
    window.addEventListener('newbie:dongtian-demo-deleted', () => {
      if (!active) return;
      dongtianDemoDeleted = true;
      if (steps[index]?.requiresDongtianDelete && index < steps.length - 1) {
        index += 1;
        setTimeout(render, 160);
      } else {
        renderCardOnly();
      }
    });
  }

  function updateSpotlight(){
    const layer=document.getElementById('newbie-tutorial-layer'); const spot=layer?.querySelector('.newbie-tutorial-spotlight'); const dim=layer?.querySelector('.newbie-tutorial-dim');
    if(!layer||!spot||!dim||!active) return; const el=target(displayStep().target);
    if(!el||!visible(el)){ spot.style.display='none'; dim.style.display='block'; return; }
    const r=el.getBoundingClientRect(), p=8; spot.style.display='block'; dim.style.display='none'; spot.style.left=`${Math.max(6,r.left-p)}px`; spot.style.top=`${Math.max(6,r.top-p)}px`; spot.style.width=`${Math.min(innerWidth-12,r.width+p*2)}px`; spot.style.height=`${Math.min(innerHeight-12,r.height+p*2)}px`;
  }

  function nextBlocked(step) {
    if (step.requiresAnswer && !exampleAnswered) return true;
    if (step.requiresReport && !reportOpened) return true;
    if (step.requiresDongtianOpen && !dongtianOpen) return true;
    if (step.requiresDongtianDemoReady && !dongtianDemoReady) return true;
    if (step.requiresDongtianStart && !dongtianDemoStarted) return true;
    if (step.requiresDongtianComplete && !dongtianDemoCompleted) return true;
    if (step.requiresDongtianReturn && !dongtianDemoReturned) return true;
    if (step.requiresDongtianDelete && !dongtianDemoDeleted) return true;
    return false;
  }

  function blockedLabelForStep(step) {
    if (step.requiresAnswer && !exampleAnswered) return '請先作答';
    if (step.requiresReport && !reportOpened) return '請先按回報問題';
    if (step.requiresDongtianOpen && !dongtianOpen) return '請先點開洞天';
    if (step.requiresDongtianDemoReady && !dongtianDemoReady) return '正在準備私有範例';
    if (step.requiresDongtianStart && !dongtianDemoStarted) return '請按「進入範例」';
    if (step.requiresDongtianComplete && !dongtianDemoCompleted) return '請先完成範例洞天';
    if (step.requiresDongtianReturn && !dongtianDemoReturned) return '請按「返回我的洞天」';
    if (step.requiresDongtianDelete && !dongtianDemoDeleted) return '請先刪除教學範例';
    return '';
  }

  function renderCardOnly() {
    if (!active) return;
    const baseStep = steps[index];
    const step = displayStep();
    const card = document.querySelector('#newbie-tutorial-layer .newbie-tutorial-card');
    if (!card) return;
    const blocked = !!step.routeGate || nextBlocked(baseStep);
    const blockedLabel = step.routeGate
      ? '請點亮起的入口'
      : (blocked ? blockedLabelForStep(baseStep) : (index===steps.length-1 ? '完成' : '下一步'));
    card.innerHTML=`<div class="newbie-tutorial-kicker">${step.kicker}</div><h3>${step.title}</h3><p>${step.body}</p><p class="newbie-tutorial-note">${step.note}</p><div class="newbie-tutorial-progress">${steps.map((_,i)=>`<i class="${i===index?'active':''}"></i>`).join('')}</div><div class="newbie-tutorial-actions"><button class="newbie-tutorial-skip">跳過教學</button><button class="newbie-tutorial-prev" ${index===0?'disabled':''}>上一步</button><button class="newbie-tutorial-next" ${blocked?'disabled':''}>${blockedLabel}</button></div>`;
    card.querySelector('.newbie-tutorial-skip').onclick=()=>finish(true);
    card.querySelector('.newbie-tutorial-prev').onclick=()=>{if(index>0){index--;render();}};
    card.querySelector('.newbie-tutorial-next').onclick=()=>{if(blocked)return;if(index===steps.length-1)finish(false);else{index++;render();}};
  }

  function render(){
    if(!active) return;
    const step=steps[index];
    const route=routeForStep(step);
    if (step.requiresDongtianOpen) {
      const dongtianBody = document.getElementById('dongtian-body');
      if (dongtianBody) dongtianOpen = !dongtianBody.hidden;
    }

    // 不直接 navigate(step.page)：跨頁時一定先讓玩家看到並點擊真實入口。
    if (!route && step.settingsSection && typeof window.openDongfuSettingsSection === 'function') {
      window.openDongfuSettingsSection(step.settingsSection, { scroll: false, persist: false });
    }
    if (!route && step.prepareDongtianDemo && !dongtianDemoReady) {
      try {
        window.prepareNewbieDongtianDemo?.();
        dongtianDemoReady = !!window.hasNewbieDongtianDemo?.();
      } catch (error) {
        console.warn('[Newbie tutorial Dongtian demo]', error);
      }
    }
    if (!route && step.demo) installExampleQuiz();
    else if (!route && !step.demo) cleanupExampleQuiz();

    let layer=document.getElementById('newbie-tutorial-layer');
    if(!layer){ layer=document.createElement('div'); layer.id='newbie-tutorial-layer'; layer.innerHTML='<div class="newbie-tutorial-dim"></div><div class="newbie-tutorial-spotlight"></div><section class="newbie-tutorial-card"></section>'; document.body.appendChild(layer); }
    renderCardOnly();
    setTimeout(()=>{ target(displayStep().target)?.scrollIntoView?.({behavior:'smooth',block:'center'}); setTimeout(updateSpotlight,180); },120);
  }

  async function persistFinished(skipped){
    const data=userData(), user=getAuth(getApp()).currentUser; if(!data||!user) return;
    const value={version:VERSION,completed:true,skipped:!!skipped,completedAt:Date.now()}; data[FIELD]=value;
    try{ await updateDoc(doc(getFirestore(getApp()),'users',user.uid),{[FIELD]:value}); }catch(error){ console.warn('Tutorial completion could not be persisted:',error); }
  }

  function finish(skipped){
    if(!active)return;
    active=false;
    cleanupExampleQuiz();
    try { window.deleteNewbieDongtianDemo?.({ silent: true }); } catch (_) {}
    document.getElementById('newbie-tutorial-layer')?.remove();
    if(resizeHandler)window.removeEventListener('resize',resizeHandler);
    resizeHandler=null;
    navigate('page-home');
    persistFinished(skipped);
  }

  function start(){
    ensureStyle();
    bindDemoGuards();
    bindNavigationGuards();
    bindDongtianTutorialEvents();
    try { window.deleteNewbieDongtianDemo?.({ silent: true }); } catch (_) {}
    active=true;
    index=0;
    exampleAnswered=false;
    reportOpened=false;
    dongtianOpen=false;
    dongtianDemoReady=false;
    dongtianDemoStarted=false;
    dongtianDemoCompleted=false;
    dongtianDemoReturned=false;
    dongtianDemoDeleted=false;
    resizeHandler ||= ()=>updateSpotlight();
    window.addEventListener('resize',resizeHandler);
    render();
  }

  function addReplayButton(){
    const page=document.getElementById('page-settings'); if(!page||document.getElementById('newbie-tutorial-replay'))return;
    const button=document.createElement('button'); button.id='newbie-tutorial-replay'; button.type='button'; button.className='newbie-tutorial-replay'; button.innerHTML='<i class="fa-solid fa-circle-question"></i><span>重新查看新手教程</span>'; button.onclick=start;
    const first=page.firstElementChild; if(first)first.insertAdjacentElement('afterend',button); else page.prepend(button);
  }

  function blocking(){ return !!document.querySelector('#progression-v2-modal,.training-v3-modal-backdrop,#realm-breakthrough-feedback,#golden-core-tutorial-layer,#report-modal:not(.hidden)'); }
  function maybeAutoStart(){
    if(autoStarted||active||blocking())return;
    const data=userData(), user=getAuth(getApp()).currentUser;
    if(!data?.stats||!user)return;
    if(Number(marker()?.version)>=VERSION&&marker()?.completed){autoStarted=true;return;}
    if((Number(data.stats.totalScore)||0)>=FOUNDATION_SCORE){autoStarted=true;return;}
    autoStarted=true;
    setTimeout(()=>{if(!blocking())start();else autoStarted=false;},900);
  }

  window.startNewbieTutorial=start;
  function boot(){ ensureStyle(); bindDemoGuards(); bindNavigationGuards(); bindDongtianTutorialEvents(); addReplayButton(); maybeAutoStart(); setInterval(()=>{addReplayButton();maybeAutoStart();if(active)updateSpotlight();},700); new MutationObserver(addReplayButton).observe(document.body,{childList:true,subtree:true}); }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
