'use strict';

/**
 * 極簡十題挑戰：只呼叫原有 /api/generate-quiz，不複製或改動出題／審題演算法。
 * 課程範圍直接讀取原有 elementary / middle / high 學習範圍 JSON。
 */
(() => {
  const MAX_QUESTIONS = 10;
  const START_LIVES = 3;
  const GRADE_ORDER = [
    '國小一年級','國小二年級','國小三年級','國小四年級','國小五年級','國小六年級',
    '國中一年級','國中二年級','國中三年級',
    '高中一年級','高中二年級','高中三年級'
  ];
  const $ = id => document.getElementById(id);
  const catalog = new Map();
  const state = {
    status: 'setup', question: null, busy: false, answered: false,
    count: 0, correct: 0, score: 0, lives: START_LIVES,
    history: [], scope: null, controller: null, serial: 0
  };
  const staticSources = [
    '/elementary_school_unit_name/math.json',
    '/elementary_school_unit_name/core.json',
    '/elementary_school_unit_name/other.json',
    '/high_school_unit_name/core.json',
    '/high_school_unit_name/humanities.json'
  ];

  function setMessage(message, error = false) {
    $('scope-message').textContent = message;
    $('scope-message').classList.toggle('error', error);
  }

  function normalizeGrade(raw) {
    const value = String(raw || '');
    const aliases = {
      '七年級':'國中一年級', '八年級':'國中二年級', '九年級':'國中三年級',
      '國中七年級':'國中一年級', '國中八年級':'國中二年級', '國中九年級':'國中三年級'
    };
    if (aliases[value]) return aliases[value];
    return GRADE_ORDER.includes(value) ? value : null;
  }

  function unitList(grade, subject) {
    return catalog.get(grade)?.get(subject) || new Map();
  }

  function addTopic(grade, subject, unit, details = []) {
    const g = normalizeGrade(grade);
    const s = String(subject || '').trim();
    const u = String(unit || '').trim();
    if (!g || !s || !u) return;
    if (!catalog.has(g)) catalog.set(g, new Map());
    const subjects = catalog.get(g);
    if (!subjects.has(s)) subjects.set(s, new Map());
    const topics = subjects.get(s);
    if (!topics.has(u)) topics.set(u, new Set());
    const detailSet = topics.get(u);
    for (const detail of details) {
      const text = typeof detail === 'string' ? detail.trim() : '';
      if (text && text !== u) detailSet.add(text);
    }
  }

  // 相容舊國中教材與新版國小／高中教材中的章節、細項及字串型主題。
  function walkUnits(grade, subject, node, section = '', depth = 0) {
    if (depth > 9 || !node) return;
    if (Array.isArray(node)) {
      for (const item of node) {
        if (typeof item === 'string') addTopic(grade, subject, section || '學習主題', [item]);
        else if (item && typeof item === 'object') {
          if (typeof item.unit === 'string') {
            addTopic(grade, subject, item.unit, Array.isArray(item.details) ? item.details : []);
          } else walkUnits(grade, subject, item, section, depth + 1);
        }
      }
      return;
    }
    if (typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      if (key === 'details' || key === 'sources' || key === 'notes') continue;
      if (Array.isArray(child) && child.every(item => typeof item === 'string')) {
        for (const item of child) addTopic(grade, subject, key, [item]);
      } else walkUnits(grade, subject, child, key, depth + 1);
    }
  }

  function absorbCurriculum(json) {
    if (!json || typeof json !== 'object') return;
    const containers = [];
    if (json.subjects && typeof json.subjects === 'object') containers.push(json.subjects);
    for (const [key, value] of Object.entries(json)) {
      if (/^middle_school_.*_courses$/.test(key) && value && typeof value === 'object') {
        containers.push(value);
      }
    }
    for (const source of containers) {
      for (const [subject, gradeEntries] of Object.entries(source)) {
        if (!gradeEntries || typeof gradeEntries !== 'object') continue;
        for (const [rawGrade, entries] of Object.entries(gradeEntries)) {
          const grade = normalizeGrade(rawGrade);
          if (grade) walkUnits(grade, subject, entries);
        }
      }
    }
  }

  function loadJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(response => {
      if (!response.ok) throw Error('範圍資料 HTTP ' + response.status);
      return response.json();
    });
  }

  async function loadCatalog() {
    $('start-button').disabled = true;
    setMessage('正在載入原專案的課程範圍…');
    const sources = [...staticSources];
    try {
      const info = await loadJSON('/api/units');
      for (const file of Array.isArray(info.files) ? info.files : []) {
        // 僅讀取每科主檔；排除其他出版社／學期的重複素材。
        if (/^[^/]+\/[^/]+\.json$/i.test(file)) {
          sources.push('/middle_school_unit_name/' + file.split('/').map(encodeURIComponent).join('/'));
        }
      }
    } catch (error) {
      console.warn('[Simple quiz] 中學單元列表載入失敗', error);
    }
    const outcomes = await Promise.allSettled([...new Set(sources)].map(loadJSON));
    catalog.clear();
    for (const result of outcomes) if (result.status === 'fulfilled') absorbCurriculum(result.value);
    if (!catalog.size) {
      setMessage('無法取得課程範圍。請確認連線後重試。', true);
      $('reload-scopes').hidden = false;
      return;
    }
    $('reload-scopes').hidden = true;
    fillGrades();
    $('start-button').disabled = false;
    const count = [...catalog.values()].reduce((n, subjects) => n + subjects.size, 0);
    const errors = outcomes.filter(x => x.status === 'rejected').length;
    setMessage('已載入 ' + count + ' 組年級與科目' + (errors ? '；少部分教材暫時無法取得。' : '。'));
  }

  function populate(select, items, previous, emptyLabel) {
    select.replaceChildren();
    if (emptyLabel !== undefined) select.add(new Option(emptyLabel, ''));
    for (const [value, label] of items) select.add(new Option(label, value));
    const available = [...select.options].some(item => item.value === previous);
    select.value = available ? previous : select.options[0]?.value || '';
  }

  function fillGrades() {
    const previous = $('grade').value;
    populate($('grade'), GRADE_ORDER.filter(grade => catalog.has(grade)).map(grade => [grade, grade]), previous || '國中一年級');
    fillSubjects();
  }

  function fillSubjects() {
    const subjects = [...(catalog.get($('grade').value)?.keys() || [])].sort((a,b) => a.localeCompare(b, 'zh-Hant'));
    const old = $('subject').value;
    populate($('subject'), subjects.map(name => [name, name]), old && subjects.includes(old) ? old : (subjects.includes('數學') ? '數學' : subjects[0]));
    fillUnits();
  }

  function fillUnits() {
    const units = unitList($('grade').value, $('subject').value);
    const sorted = [...units.keys()].sort((a,b) => a.localeCompare(b, 'zh-Hant', {numeric:true}));
    const old = $('unit').value;
    populate($('unit'), sorted.map(x => [x,x]), old, '不限章節（隨機主題）');
    fillDetails();
  }

  function fillDetails() {
    const details = [...(unitList($('grade').value, $('subject').value).get($('unit').value) || [])];
    const old = $('detail').value;
    populate($('detail'), details.map(x => [x,x]), old, '整個章節');
    $('detail-wrap').hidden = !$('unit').value || !details.length;
  }

  function currentScope() {
    return {
      level: $('grade').value,
      subject: $('subject').value,
      unit: $('unit').value,
      detail: $('detail').value
    };
  }

  function showScreen(id) {
    for (const screen of document.querySelectorAll('.screen')) {
      screen.hidden = screen.id !== id;
    }
  }

  function scopeLabel(scope) {
    return [scope.level, scope.subject, scope.unit, scope.detail].filter(Boolean).join(' · ');
  }

  function abortPending() {
    state.serial++;
    if (state.controller) state.controller.abort();
    state.controller = null;
    state.busy = false;
  }

  function startGame() {
    const scope = currentScope();
    if (!scope.level || !scope.subject || state.busy) return;
    abortPending();
    Object.assign(state, {
      status:'playing', question:null, busy:false, answered:false,
      count:0, correct:0, score:0, lives:START_LIVES,
      history:[], scope
    });
    $('game-scope').textContent = scopeLabel(scope);
    $('answer-feedback').hidden = true;
    $('retry-button').hidden = true;
    showScreen('game-screen');
    renderStats();
    void loadQuestion();
  }

  function renderStats() {
    $('question-index').textContent = '第 ' + Math.min(MAX_QUESTIONS, state.count + (state.answered ? 0 : 1)) + ' / ' + MAX_QUESTIONS + ' 題';
    $('points').textContent = String(state.score);
    $('lives').textContent = '♥'.repeat(state.lives) + '♡'.repeat(START_LIVES - state.lives);
    $('progress-fill').style.width = (state.count / MAX_QUESTIONS * 100) + '%';
    $('progress-fill').setAttribute('aria-valuenow', String(state.count));
    $('progress-stages').replaceChildren();
    for (let i = 0; i < MAX_QUESTIONS; i++) {
      const node = document.createElement('span');
      node.className = 'stage-dot' + (i < state.count ? ' completed' : i === state.count ? ' current' : '');
      node.setAttribute('aria-label', '第 ' + (i + 1) + ' 題');
      $('progress-stages').append(node);
    }
  }

  function shuffle(array) {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i],copy[j]] = [copy[j],copy[i]];
    }
    return copy;
  }

  async function typeset(element) {
    if (!window.MathJax?.typesetPromise) return;
    try {
      window.MathJax.typesetClear?.([element]);
      await window.MathJax.typesetPromise([element]);
    } catch (err) {
      console.warn('[Simple quiz] 公式排版失敗', err);
    }
  }

  async function loadQuestion() {
    if (state.status !== 'playing' || state.busy) return;
    state.busy = true;
    state.answered = false;
    const serial = ++state.serial;
    const controller = new AbortController();
    state.controller = controller;
    $('question-content').hidden = true;
    $('answer-feedback').hidden = true;
    $('retry-button').hidden = true;
    $('question-loading').hidden = false;
    $('loading-text').textContent = '正在準備下一題，並檢查答案…';
    renderStats();
    const scope = state.scope;
    const specificTopic = [scope.unit,scope.detail].filter(Boolean).join('：');
    try {
      const response = await fetch('/api/generate-quiz', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          subject:scope.subject,
          level:scope.level,
          specificTopic,
          difficulty:'medium',
          quizMode:'solo',
          avoidQuestions:state.history.slice(-30)
        }),
        signal:controller.signal
      });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error || '出題暫時失敗');
      const item = typeof payload.text === 'string' ? JSON.parse(payload.text) : payload;
      if (!item || typeof item.q !== 'string' || typeof item.correct !== 'string' ||
          !Array.isArray(item.wrong) || item.wrong.length !== 3 ||
          !item.wrong.every(x => typeof x === 'string')) {
        throw Error('伺服器題目格式不完整');
      }
      if (serial !== state.serial || state.status !== 'playing') return;
      state.question = item;
      state.history.push(item.q);
      renderQuestion(item);
    } catch (error) {
      if (serial !== state.serial || state.status !== 'playing') return;
      $('loading-text').textContent = error.name === 'AbortError' ? '出題已取消。' : '題目暫時無法取得：' + error.message;
      $('retry-button').hidden = false;
    } finally {
      if (serial === state.serial) {
        state.busy = false;
        state.controller = null;
      }
    }
  }

  function renderQuestion(item) {
    $('question-loading').hidden = true;
    $('question-content').hidden = false;
    $('question-title').textContent = item.q;
    $('question-topic').textContent = state.scope.unit || (item.sub_topic || '綜合測驗');
    $('answer-list').replaceChildren();
    const choices = shuffle([item.correct, ...item.wrong]);
    for (let i = 0; i < choices.length; i++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'answer-option';
      button.dataset.value = choices[i];
      const letter = document.createElement('span');
      letter.className = 'answer-letter';
      letter.textContent = 'ABCD'[i];
      const text = document.createElement('span');
      text.className = 'answer-text';
      text.textContent = choices[i];
      button.append(letter, text);
      button.addEventListener('click', () => chooseAnswer(choices[i]));
      $('answer-list').append(button);
    }
    void typeset($('question-content'));
  }

  function chooseAnswer(choice) {
    if (state.status !== 'playing' || state.busy || state.answered || !state.question) return;
    state.answered = true;
    state.count++;
    const correct = choice === state.question.correct;
    if (correct) {
      state.correct++;
      state.score += 10;
    } else {
      state.lives--;
    }
    for (const button of $('answer-list').querySelectorAll('button')) {
      button.disabled = true;
      const value = button.dataset.value;
      if (value === state.question.correct) button.classList.add('right');
      else if (value === choice) button.classList.add('wrong');
    }
    $('feedback-title').textContent = correct ? '答對了！＋10 分' : '答錯了，失去一顆心';
    $('feedback-title').className = 'feedback-title ' + (correct ? 'good' : 'bad');
    $('correct-answer').textContent = correct ? '' : '正確答案：' + state.question.correct;
    $('explanation').textContent = state.question.exp || '本題沒有附解析。';
    $('answer-feedback').hidden = false;
    const finished = state.count >= MAX_QUESTIONS || state.lives <= 0;
    $('next-button').textContent = finished ? '查看成績' : '下一題';
    renderStats();
    void typeset($('answer-feedback'));
    $('next-button').focus();
  }

  function next() {
    if (state.status !== 'playing' || !state.answered || state.busy) return;
    if (state.count >= MAX_QUESTIONS || state.lives <= 0) return endGame();
    void loadQuestion();
  }

  function endGame() {
    abortPending();
    state.status = 'ended';
    const key = 'simple-quiz:best:' + JSON.stringify([state.scope.level,state.scope.subject,state.scope.unit,state.scope.detail]);
    let best = state.score;
    try {
      best = Math.max(Number(localStorage.getItem(key)) || 0, state.score);
      localStorage.setItem(key, String(best));
    } catch (_) { /* 無痕模式仍可玩 */ }
    $('result-title').textContent = state.count >= MAX_QUESTIONS ? '挑戰完成！' : '挑戰結束';
    $('result-score').textContent = String(state.score);
    $('result-best').textContent = String(best);
    $('result-detail').textContent = '共答 ' + state.count + ' 題，答對 ' + state.correct + ' 題，答錯 ' + (state.count - state.correct) + ' 題';
    $('result-scope').textContent = scopeLabel(state.scope);
    showScreen('result-screen');
  }

  function backToSetup() {
    abortPending();
    state.status = 'setup';
    state.question = null;
    showScreen('setup-screen');
  }

  function keypress(event) {
    if (state.status !== 'playing' || event.altKey || event.ctrlKey || event.metaKey) return;
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const index = ['1','2','3','4','a','b','c','d'].indexOf(event.key.toLowerCase());
    if (!state.answered && index >= 0 && index !== -1 && !state.busy) {
      const mapped = index % 4;
      $('answer-list').querySelectorAll('button')[mapped]?.click();
    } else if (event.key === 'Enter' && state.answered) {
      event.preventDefault();
      next();
    }
  }

  $('grade').addEventListener('change', fillSubjects);
  $('subject').addEventListener('change', fillUnits);
  $('unit').addEventListener('change', fillDetails);
  $('start-button').addEventListener('click', startGame);
  $('retry-button').addEventListener('click', () => { if (!state.busy) void loadQuestion(); });
  $('next-button').addEventListener('click', next);
  $('quit-button').addEventListener('click', backToSetup);
  $('play-again').addEventListener('click', startGame);
  $('choose-again').addEventListener('click', backToSetup);
  $('reload-scopes').addEventListener('click', () => void loadCatalog());
  document.addEventListener('keydown', keypress);

  showScreen('setup-screen');
  void loadCatalog();
})();
