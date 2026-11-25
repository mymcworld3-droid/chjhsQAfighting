import './question-presentation.js';
import './daily-meditation-rewards.js';
import { createVocabularyPronunciation } from './daily-vocabulary-pronunciation.mjs';

const page = document.getElementById('page-daily-vocabulary');
const slot = page.querySelector('[data-dv-view]');
const dayLabel = page.querySelector('[data-dv-date]');
const backButton = page.querySelector('[data-dv-back]');
const saveNote = page.querySelector('[data-dv-save-note]');
const storagePrefix = 'qingyun:daily-vocabulary:v1:';
const parts = { 'v.': '動詞', 'n.': '名詞', 'adj.': '形容詞', 'adv.': '副詞' };
const questionLabels = { meaning: '看英選中', cloze: '語境填空', spelling: '看提示拼寫' };
const pronunciation = createVocabularyPronunciation(window, updatePronunciation);

let rules;
let loadTask;
let key = '';
let progress;
let storageAvailable = true;
let pendingSave = false;
let screen = 'home';
let cards;
let quiz;
let quizLesson;
let rewardTask;
let rewardErrors = {};
let newRewardDate = '';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function isOpen() {
  return page.classList.contains('active-page');
}

function readProgress() {
  if (pendingSave) return null;
  let raw;
  try {
    raw = localStorage.getItem(key);
    storageAvailable = true;
  } catch (_) {
    storageAvailable = false;
    return null;
  }
  try {
    const saved = JSON.parse(raw);
    if (!saved || !rules.STEPS[saved.level] || !Array.isArray(saved.scores) || !saved.review) return null;
    const lesson = saved.lesson;
    if (!lesson || !/^\d{4}-\d{2}-\d{2}$/.test(lesson.date) ||
        !Number.isSafeInteger(lesson.sequence) || lesson.sequence < 0 ||
        !rules.STEPS[lesson.level] || !Array.isArray(lesson.words) ||
        lesson.words.length !== rules.LESSON_SIZE || !lesson.studied ||
        !Array.isArray(lesson.answers) || !Number.isInteger(lesson.index) ||
        lesson.index < 0 || lesson.index >= rules.LESSON_SIZE) return null;
    return saved;
  } catch (_) {
    return null;
  }
}

function saveProgress() {
  try {
    localStorage.setItem(key, JSON.stringify(progress));
    storageAvailable = true;
    pendingSave = false;
  } catch (_) {
    storageAvailable = false;
    pendingSave = true;
  }
  showSaveNote();
}

function showSaveNote() {
  saveNote.textContent = storageAvailable
    ? '進度保存在此瀏覽器，依遊戲帳號分開記錄。'
    : '瀏覽器目前無法儲存進度，重新整理後可能遺失本次紀錄。';
}

function currentQuiz() {
  const lesson = progress.lesson;
  // Recomputing on reload still produces the same word order and answer choices.
  if (quizLesson !== lesson) {
    quiz = rules.questionsFor(lesson);
    quizLesson = lesson;
  }
  return quiz;
}

function queueCompletedReward() {
  const lesson = progress.lesson;
  if (!lesson?.result || lesson.answers.length !== rules.LESSON_SIZE) return false;
  progress.rewardQueue ||= [];
  progress.rewardHistory ||= {};
  if (progress.rewardHistory[lesson.date] || progress.rewardQueue.some(item => item.date === lesson.date)) return false;
  progress.rewardQueue.push({
    date: lesson.date,
    sequence: lesson.sequence,
    level: lesson.level,
    words: [...lesson.words],
    answers: lesson.answers.map(answer => answer.value),
  });
  progress.rewardHistory[lesson.date] = { status: 'pending' };
  return true;
}

function updatePlayerStats(result, uid) {
  if (window.getRealmUserUid?.() !== uid) return;
  const player = window.getCurrentUserData?.();
  if (!player) return;
  player.stats ||= {};
  player.stats.gold = result.gold;
  player.stats.totalScore = result.totalScore;
  window.updateUIStats?.();
  window.refreshCultivationRealmUI?.();
  window.refreshXiuxianLiveSync?.(result.totalScore);
  window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', {
    detail: { source: 'daily-vocabulary', gold: result.gold, totalScore: result.totalScore },
  }));
}

async function flushRewards() {
  if (rewardTask || !progress?.rewardQueue?.length || !key) return;
  const rewardKey = key;
  const uid = window.getRealmUserUid?.();
  const queue = [...progress.rewardQueue];
  rewardTask = (async () => {
    try {
      const { authenticatedMainFetch } = await import('./data/project-repository.js');
      for (const lesson of queue) {
        if (key !== rewardKey || window.getRealmUserUid?.() !== uid) break;
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 20_000);
          let response;
          let result;
          try {
            response = await authenticatedMainFetch('/api/daily-vocabulary/reward', {
              method: 'POST',
              body: JSON.stringify(lesson),
              signal: controller.signal,
            });
            result = await response.json();
          } finally {
            clearTimeout(timeout);
          }
          if (key !== rewardKey || window.getRealmUserUid?.() !== uid) break;
          if (!response.ok || !result.ok) {
            const error = new Error(result.error || '獎勵暫時無法同步，請稍後重試。');
            throw error;
          }
          progress = readProgress() || progress;
          progress.rewardQueue = (progress.rewardQueue || []).filter(item => item.date !== lesson.date);
          progress.rewardHistory ||= {};
          progress.rewardHistory[lesson.date] = { status: 'claimed', reward: result.reward };
          if (!result.alreadyClaimed && isOpen() && progress.lesson.date === lesson.date) {
            newRewardDate = lesson.date;
          }
          delete rewardErrors[lesson.date];
          saveProgress();
          updatePlayerStats(result, uid);
        } catch (error) {
          if (key !== rewardKey || window.getRealmUserUid?.() !== uid) break;
          rewardErrors[lesson.date] = error.name === 'AbortError'
            ? '獎勵同步逾時，請重新領取。'
            : error.message || '獎勵暫時無法同步，請稍後重試。';
        }
      }
    } catch (error) {
      for (const lesson of queue) rewardErrors[lesson.date] = '獎勵暫時無法同步，請稍後重試。';
    }
  })();
  try {
    await rewardTask;
  } finally {
    rewardTask = null;
    if (key === rewardKey && isOpen() && (screen === 'home' || screen === 'result')) render();
    if (key !== rewardKey && isOpen() && progress?.rewardQueue?.length) void flushRewards();
  }
}

function rewardMarkup(lesson) {
  const status = progress.rewardHistory?.[lesson.date]?.status;
  if (status === 'claimed') {
    const reward = progress.rewardHistory[lesson.date].reward;
    return `<div class="dv-reward is-granted" role="status"><strong>今日獎勵已領取</strong>${globalThis.QARewardPresentation.renderStatus('claimed')}
      <div class="dv-reward-amounts">${globalThis.QARewardPresentation.renderList(reward,{variant:'general'})||'<p>本次無額外獎勵。</p>'}</div></div>`;
  }
  const message = rewardErrors[lesson.date] || '正在領取今日獎勵…';
  return `<div class="dv-reward ${rewardErrors[lesson.date] ? 'is-waiting' : 'is-syncing'}" role="status"><strong>今日獎勵</strong>
    ${globalThis.QARewardPresentation.renderList(rules.DAILY_REWARD,{variant:'general',preview:true})}
    <p>${globalThis.QARewardPresentation.renderStatus(rewardErrors[lesson.date]?'unconfirmed':'settling',message)}</p>
    ${rewardErrors[lesson.date] ? button('retry-reward', '重新領取', { style: 'dv-quiet' }) : ''}</div>`;
}

function pendingRewardsMarkup() {
  const queue = progress.rewardQueue || [];
  if (!queue.length) return '';
  const failed = queue.find(item => rewardErrors[item.date]);
  return `<section class="dv-panel dv-reward" role="status">
    <strong>有 ${queue.length} 份單字獎勵待領取</strong>
    <p data-qy-state="${failed?'error':'syncing'}">${failed ? escapeHtml(rewardErrors[failed.date]) : '正在同步獎勵…'}</p>
    ${failed ? button('retry-reward', '重新領取', { style: 'dv-quiet' }) : ''}
  </section>`;
}

function button(action, label, options = {}) {
  const { style = '', extra = '' } = options;
  return `<button type="button" class="dv-button ${style}" data-dv-action="${action}" ${extra}>${label}</button>`;
}

function badge(bandId) {
  const band = rules.BANDS.find(item => item.id === bandId);
  return `<span class="dv-band" data-band="${band.id}">${band.label} · ${band.id}</span>`;
}

function stepLabel(level) {
  return rules.STEPS[level].label;
}

function lead(title, supporting, { back = true } = {}) {
  return `<div class="dv-view-heading">
    <div><h3 tabindex="-1" data-dv-focus>${title}</h3><p>${supporting}</p></div>
    ${back ? button('home', '今日總覽', { style: 'dv-quiet' }) : ''}
  </div>`;
}

function studyNotice(notice) {
  if (!notice) return '';
  return `<p class="dv-study-notice ${notice.familiar ? 'is-familiar' : 'is-review'}" role="status">
    <span aria-hidden="true">${notice.familiar ? '✓' : '↻'}</span> ${escapeHtml(notice.text)}
  </p>`;
}

function homeMarkup(notice) {
  const { lesson, level, scores } = progress;
  const studied = lesson.words.filter(id => lesson.studied[id]).length;
  const due = rules.dueWords(progress).length;
  const cardAction = studied === rules.LESSON_SIZE ? '再看字卡' : studied ? '繼續看字卡' : '開始看字卡';
  const quizAction = lesson.result ? '查看成績' : lesson.answers.length ? '繼續測驗' : '開始測驗';
  const formats = rules.STEPS[level].formats;
  const formatsText = Object.entries(questionLabels)
    .map(([format, label]) => {
      const count = rules.BANDS.length * formats.filter(item => item === format).length;
      return count ? `${label} ${count} 題` : '';
    }).filter(Boolean).join(' · ');

  return `<div class="dv-stack">
    <section class="dv-panel dv-today">
      <div class="dv-today-heading">
        <div><h3 tabindex="-1" data-dv-focus>今日單字</h3><p>讀字卡回想意思，再用測驗檢查記住了多少。</p>
          <p>完成測驗可獲得 ${globalThis.QARewardPresentation.renderStatus('obtainable')}</p>${globalThis.QARewardPresentation.renderList(rules.DAILY_REWARD,{variant:'general',preview:true})}</div>
        <div class="dv-today-score"><strong>${studied}</strong> / ${rules.LESSON_SIZE}<span>已看字卡</span></div>
      </div>
      <div class="dv-progress" aria-hidden="true">
        ${lesson.words.map(id => `<span data-band="${rules.wordFor(id).band}" class="${lesson.studied[id] ? 'is-studied' : ''}"></span>`).join('')}
      </div>
      <ul class="dv-bands">
        ${rules.BANDS.map(({ id, label, exam }) => `<li data-band="${id}"><b>${label} <span>${id}</span></b><small>${exam}程度 · ${rules.WORDS_PER_BAND} 字</small></li>`).join('')}
      </ul>
      ${studyNotice(notice)}
      <div class="dv-actions">
        ${button('cards', cardAction, { style: 'dv-primary' })}
        ${button(lesson.result ? 'result' : 'quiz', quizAction)}
      </div>
    </section>
    ${pendingRewardsMarkup()}
    <section class="dv-panel dv-review-panel">
      <div><h3>到期複習</h3><p>${due ? `有 ${due} 個字該再回想一次` : '今天沒有到期的單字。'} </p></div>
      ${due ? button('due', '開始複習') : ''}
    </section>
    <section class="dv-panel dv-level">
      <h3>測驗難度 · ${stepLabel(level)}</h3>
      <p>${formatsText}</p>
      <p>已累計 ${scores.length} / ${rules.EVALUATION_DAYS} 次正式測驗。</p>
      <details><summary>難度如何調整？</summary>
        <p>每 ${rules.EVALUATION_DAYS} 次每日測驗評估一次。平均達 ${rules.PROMOTE_AT}% 升一級，低於或等於 ${rules.EASE_AT}% 降一級。調整後於下次測驗生效。</p>
        ${progress.lastEvaluation ? `<p>上次平均 ${progress.lastEvaluation.percent}%，目前為「${stepLabel(level)}」。</p>` : ''}
        <p>三組單字仍各 5 個，級別為選材參考。</p>
      </details>
    </section>
    <details class="dv-panel dv-word-list">
      <summary>查看今日單字</summary>
      ${rules.BANDS.map(band => `<div class="dv-word-group">
        ${badge(band.id)}
        <div>${lesson.words.map(rules.wordFor).filter(word => word.band === band.id).map(word =>
          button('word', `<span lang="en">${escapeHtml(word.id)}</span>`,
            { style: 'dv-word', extra: `data-word="${word.id}"` })).join('')}</div>
      </div>`).join('')}
    </details>
  </div>`;
}

function pronunciationButton(word) {
  return button('listen', '<i class="fa-solid fa-volume-high" aria-hidden="true"></i> <span>聽發音</span>', {
    style: 'dv-listen',
    extra: `data-word="${word}" aria-label="播放 ${word} 的發音"`,
  });
}

function updatePronunciation({ word, status, source }) {
  const control = slot.querySelector('[data-dv-action="listen"]');
  const message = slot.querySelector('[data-dv-audio]');
  if (!control || !message) return;
  const current = control.dataset.word === word ? status : 'idle';
  const active = current === 'loading' || current === 'playing';
  const label = control.querySelector('span');
  if (label) label.textContent = active ? '停止發音' : current === 'error' ? '重試發音' : '聽發音';
  control.dataset.state = current;
  control.setAttribute('aria-label', `${label?.textContent || '聽發音'} · ${control.dataset.word}`);
  message.textContent = {
    loading: '正在準備發音…',
    playing: source === 'device' ? '正在播放裝置發音' : '正在播放美式發音',
    error: '發音未能播放，請點一下重試。',
  }[current] || '';
}

function cardsMarkup(notice) {
  const { ids, index, revealed, source } = cards;
  const word = rules.wordFor(ids[index]);
  const title = source === 'daily' ? '今日字卡' : source === 'mistakes' ? '今日錯題' : '到期複習';
  return `${lead(title, `第 ${index + 1} / ${ids.length} 張`)}
    ${studyNotice(notice)}
    <article class="dv-panel dv-card ${revealed ? 'is-revealed' : 'is-front'}">
      <div class="dv-card-meta">${badge(word.band)}${pronunciationButton(word.id)}</div>
      <h4 lang="en" class="dv-english">${escapeHtml(word.id)}</h4>
      <p class="dv-part">${parts[word.part]} <span lang="en">${word.part}</span></p>
      ${revealed ? `<div class="dv-card-answer" tabindex="-1" data-dv-answer>
        <p class="dv-meaning">${escapeHtml(word.meaning)}</p>
        <p lang="en" class="dv-example">${escapeHtml(word.example)}</p>
      </div>
      <div class="dv-actions">
        ${button('unfamiliar', '還不熟')}
        ${button('familiar', '記住了', { style: 'dv-primary' })}
      </div>` : `<div class="dv-card-prompt">
        <p>先回想字義，再翻開字卡。</p>
        ${button('reveal', '翻開字卡', { style: 'dv-primary' })}
      </div>`}
      <p class="dv-audio-message" role="status" data-dv-audio></p>
    </article>
    <div class="dv-card-nav">
      ${button('previous-card', '上一張', { style: 'dv-quiet', extra: index === 0 ? 'disabled' : '' })}
      ${index + 1 < ids.length ? button('next-card', '下一張', { style: 'dv-quiet' })
        : button('home', '返回總覽', { style: 'dv-quiet' })}
    </div>`;
}

function quizSentence(word, fill) {
  const [start, end] = word.cloze.split('{}');
  return `${escapeHtml(start)}<span class="dv-blank">${fill}</span>${escapeHtml(end)}`;
}

function choicesMarkup(question, index, answer) {
  return `<div class="dv-choices">${question.choices.map(choice => {
    let status = '';
    if (answer && choice.id === question.word.id) status = 'is-correct';
    else if (answer?.value === choice.id) status = 'is-incorrect';
    const label = question.format === 'cloze' ? `<span lang="en">${escapeHtml(choice.label)}</span>` : escapeHtml(choice.label);
    const mark = globalThis.QAQuestionPresentation.optionStateMarkup(status==='is-correct'?'correct':status==='is-incorrect'?'wrong':'');
    return button('choose', label + mark, {
      style: 'dv-choice ' + status,
      extra: `data-index="${index}" data-choice="${choice.id}"${answer ? ' disabled' : ''}`,
    });
  }).join('')}</div>`;
}

function quizMarkup() {
  const lesson = progress.lesson;
  const { index } = lesson;
  const question = currentQuiz()[index];
  const { word, format } = question;
  const answer = lesson.answers[index];
  const atEnd = index + 1 === rules.LESSON_SIZE;
  const title = `第 ${index + 1} / ${rules.LESSON_SIZE} 題`;
  let streak = 0;
  for (let i = index; lesson.answers[i]?.correct; i--) streak++;
  const prompt = format === 'meaning'
    ? `<h4 class="dv-english" lang="en">${escapeHtml(word.id)}</h4><p>選出這個單字在字卡中的意思。</p>`
    : `<p lang="en" class="dv-sentence">${quizSentence(word, '____')}</p>
        <p>字義提示　<strong>${escapeHtml(word.meaning)}</strong>${format === 'spelling' ? ` · ${word.id.length} 個字母` : ''}</p>`;

  return `${lead(title, `難度 · ${stepLabel(lesson.level)} · ${questionLabels[format]}`)}
    <div class="dv-quiz-progress" data-qy-progress="segmented" role="progressbar" aria-label="作答進度" aria-valuemin="0"
      aria-valuemax="${rules.LESSON_SIZE}" aria-valuenow="${lesson.answers.length}">
      ${Array.from({ length: rules.LESSON_SIZE }, (_, step) => {
        const completed = lesson.answers[step];
        const mark = completed ? (completed.correct ? 'is-correct' : 'is-incorrect') : step === index ? 'is-current' : '';
        return `<span class="${mark}${step === index ? ' is-current-step' : ''}" aria-hidden="true"></span>`;
      }).join('')}
    </div>
    <section class="dv-panel dv-question ${answer ? 'is-answered' : ''}">
      <div class="dv-question-meta">${badge(word.band)}<span class="dv-part">${parts[word.part]} <span lang="en">${word.part}</span></span></div>
      ${prompt}
      ${format !== 'spelling' ? choicesMarkup(question, index, answer) : answer ? '' :
        `<form class="dv-spelling" data-dv-spelling data-index="${index}">
          <label for="dv-spelling-input">拼出今天學過的單字</label>
          <input id="dv-spelling-input" type="text" lang="en" maxlength="40" required autocomplete="off" autocapitalize="none" spellcheck="false">
          <div class="dv-actions">
            ${button('skip', '略過', { extra: `data-index="${index}"` })}
            <button type="submit" class="dv-button dv-primary">確認答案</button>
          </div>
        </form>`}
      ${answer ? `<div class="dv-feedback ${answer.correct ? 'is-correct' : 'is-incorrect'}" tabindex="-1" data-dv-feedback data-qy-verdict="${answer.correct?'correct':answer.value?'wrong':'unanswered'}">
        <div class="dv-feedback-top">
          <span class="dv-verdict-icon" aria-hidden="true">${answer.correct ? '✓' : '×'}</span>
          <div><strong>${answer.correct ? '答對了' : answer.value ? '答錯了' : '未作答'}</strong>
            ${streak >= 2 ? `<small class="dv-streak">連對 ${streak} 題</small>` : ''}</div>
        </div>
        ${format === 'spelling' && !answer.correct && answer.value ? `<p>你的答案：<span lang="en">${escapeHtml(answer.value)}</span></p>` : ''}
        <p class="dv-feedback-word"><b lang="en">${escapeHtml(word.id)}</b> ${escapeHtml(word.meaning)}</p>
        <p lang="en" class="dv-example">${format === 'meaning' ? escapeHtml(word.example) : quizSentence(word, escapeHtml(word.id))}</p>
        <div class="dv-feedback-audio">${pronunciationButton(word.id)}<p class="dv-audio-message" role="status" data-dv-audio></p></div>
      </div>
      <div class="dv-actions dv-next">${button('next-question', atEnd ? '查看成績' : '下一題',
        { style: 'dv-primary', extra: `data-index="${index}"` })}</div>` : ''}
    </section>`;
}

function resultMarkup() {
  const { lesson } = progress;
  const result = lesson.result;
  const change = result.nextLevel === lesson.level
    ? `下次測驗維持「${stepLabel(result.nextLevel)}」。`
    : `下次測驗從「${stepLabel(lesson.level)}」調整為「${stepLabel(result.nextLevel)}」。`;
  return `${lead('今日測驗成績', change)}
    <section class="dv-panel dv-result">
      <p class="dv-result-score"><strong>${result.score}</strong> / ${rules.LESSON_SIZE} 題答對</p><div class="qy-quiz-metrics">${globalThis.QAQuestionPresentation.metricMarkup('正確率',globalThis.QAQuestionPresentation.accuracyText(result.score,rules.LESSON_SIZE))}</div>
      <ul class="dv-bands">${rules.BANDS.map(band =>
        `<li data-band="${band.id}"><b>${band.label}</b><small>${result.byBand[band.id]} / ${rules.WORDS_PER_BAND} 題</small></li>`).join('')}</ul>
      <p>${result.mistakes.length ? `${result.mistakes.length} 個錯題單字，已排入明天的複習。` : '全部答對。已安排後續複習。'}</p>
      ${rewardMarkup(lesson)}
      ${result.mistakes.length ? button('mistakes', '複習錯題', { style: 'dv-primary' }) : ''}
    </section>`;
}

function updateBackButton(){
  const label=screen==='home'?'回到學習':'回到英文單字';
  const text=backButton?.querySelector?.('[data-dv-back-label]');
  if(text)text.textContent=label;
  backButton?.setAttribute?.('aria-label',label);
  backButton?.setAttribute?.('title',label);
}

function render({ focus = '', resetScroll = false, motion = resetScroll ? 'enter' : '', notice } = {}) {
  updateBackButton();
  const markup = { home: homeMarkup, cards: cardsMarkup, quiz: quizMarkup, result: resultMarkup }[screen];
  const rewardGranted = screen === 'result' && newRewardDate === progress.lesson.date;
  dayLabel.dateTime = progress.lesson.date;
  dayLabel.textContent = progress.lesson.date;
  slot.dataset.dvMotion = motion;
  slot.dataset.dvReward = rewardGranted ? 'granted' : '';
  slot.innerHTML = markup(notice);
  updatePronunciation(pronunciation.state());
  if (rewardGranted) {
    newRewardDate = '';
    const rewardKey=key, date=progress.lesson.date, reward=progress.rewardHistory?.[date]?.reward;
    const presentation=globalThis.QARewardPresentation;
    const options={uid:window.getRealmUserUid?.(),receiptId:'vocabulary:'+date,reward,important:false,isCurrent:()=>key===rewardKey&&isOpen()};
    if(!presentation.animateInline(slot.querySelector('.dv-reward-amounts'),options))presentation.celebrate(options);
  }
  showSaveNote();
  if (resetScroll) page.closest('main').scrollTop = 0;
  if (focus) {
    const target = slot.querySelector('[data-dv-' + focus + ']');
    target?.focus({ preventScroll: true });
    if (focus === 'feedback' || focus === 'answer') target?.scrollIntoView({ block: 'nearest' });
  }
}

function showScreen(name, motion = 'enter', notice) {
  pronunciation.stop();
  screen = name;
  render({ focus: 'focus', resetScroll: true, motion, notice });
}

function refreshDashboard(focus = false, notice) {
  pronunciation.stop();
  const stored = readProgress();
  const previous = stored || progress || rules.newProgress();
  progress = previous;
  const queued = queueCompletedReward();
  progress = rules.openLesson(previous, rules.todayInTaipei());
  if (queued || progress !== previous) saveProgress();
  screen = 'home';
  render({ focus: focus ? 'focus' : '', resetScroll: focus, notice });
  void flushRewards();
}

async function openPage() {
  const uid = window.getRealmUserUid?.();
  if (!uid) {
    slot.innerHTML = '<p class="dv-panel" role="status">登入遊戲後即可開始學習。</p>';
    saveNote.textContent = '';
    dayLabel.textContent = '';
    return;
  }
  if (!loadTask) loadTask = import('./daily-vocabulary-rules.js');
  try {
    rules = await loadTask;
  } catch (error) {
    console.warn('[Daily Vocabulary]', error);
    if (isOpen()) slot.innerHTML = '<div class="dv-panel">'+globalThis.QAQuestionPresentation.learningStatusMarkup('error','字卡載入失敗，請重新整理後再試。')+'</div>';
    return;
  }
  if (!isOpen() || window.getRealmUserUid?.() !== uid) return;
  const nextKey = storagePrefix + uid;
  if (key !== nextKey) {
    key = nextKey;
    progress = null;
    pendingSave = false;
    rewardErrors = {};
    newRewardDate = '';
  }
  refreshDashboard(true);
}

function startCards(ids, source, index = 0) {
  if (!ids.length) return;
  cards = { ids, source, index, revealed: false };
  showScreen('cards');
}

function moveCard(offset, notice) {
  cards.index += offset;
  cards.revealed = false;
  showScreen('cards', offset < 0 ? 'previous' : 'next', notice);
}

function readLatestLesson() {
  if (storagePrefix + window.getRealmUserUid?.() !== key) {
    void openPage();
    return false;
  }
  const stored = readProgress();
  if (stored && stored.lesson.date !== progress.lesson.date) {
    progress = stored;
    refreshDashboard();
    return false;
  }
  if (stored) progress = stored;
  return true;
}

function answer(index, value) {
  if (screen !== 'quiz' || !readLatestLesson()) return;
  if (rules.submitAnswer(progress, currentQuiz(), index, value)) {
    const { correct } = progress.lesson.answers[index];
    window.QAGameAudio?.answer(correct, `vocabulary:${key}:${progress.lesson.date}:${index}`);
    tactile(correct ? 32 : [22, 28, 35]);
    const finished = !!progress.lesson.result;
    if (finished) queueCompletedReward();
    saveProgress();
    render({ focus: 'feedback', motion: 'answer' });
    if (finished) void flushRewards();
  } else if (index !== progress.lesson.index || progress.lesson.answers[index]) {
    render();
  }
}

function tactile(pattern) {
  if (!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
    window.navigator?.vibrate?.(pattern);
  }
}

function listen(target) {
  window.QAGameAudio?.stop();
  pronunciation.play(target.dataset.word);
}

const actions = {
  home: () => refreshDashboard(true),
  cards: () => {
    const { words, studied } = progress.lesson;
    startCards(words, 'daily', Math.max(0, words.findIndex(id => !studied[id])));
  },
  word: target => {
    const { words } = progress.lesson;
    const index = words.indexOf(target.dataset.word);
    if (index >= 0) startCards(words, 'daily', index);
  },
  due: () => startCards(rules.dueWords(progress).slice(0, rules.LESSON_SIZE), 'review'),
  mistakes: () => startCards(progress.lesson.result.mistakes, 'mistakes'),
  quiz: () => showScreen(progress.lesson.result ? 'result' : 'quiz'),
  result: () => showScreen('result'),
  'retry-reward': () => {
    rewardErrors = {};
    render();
    void flushRewards();
  },
  reveal: () => {
    if (!readLatestLesson()) return;
    const id = cards.ids[cards.index];
    if (cards.source === 'daily' && !progress.lesson.studied[id]) {
      progress.lesson.studied[id] = true;
      saveProgress();
    }
    cards.revealed = true;
    window.QAGameAudio?.play('cloud-whoosh', { volume: .45 });
    tactile(16);
    render({ focus: 'answer', motion: 'reveal' });
  },
  'previous-card': () => moveCard(-1),
  'next-card': () => moveCard(1),
  unfamiliar: () => rate(false),
  familiar: () => rate(true),
  listen,
  choose: target => answer(Number(target.dataset.index), target.dataset.choice),
  skip: target => answer(Number(target.dataset.index), ''),
  'next-question': target => {
    if (!readLatestLesson()) return;
    const lesson = progress.lesson;
    if (lesson.result) return showScreen('result');
    if (Number(target.dataset.index) === lesson.index) {
      rules.nextQuestion(lesson);
      saveProgress();
    }
    showScreen('quiz', 'next');
  },
};

function rate(familiar) {
  if (!readLatestLesson()) return;
  rules.rateCard(progress, cards.ids[cards.index], familiar);
  saveProgress();
  if (familiar) window.QAGameAudio?.play('spirit-pulse', { volume: .5 });
  tactile(familiar ? 25 : 16);
  const notice = { familiar, text: familiar ? '已記錄熟悉度' : '已排入明天複習' };
  if (cards.index + 1 < cards.ids.length) moveCard(1, notice);
  else refreshDashboard(true, notice);
}

backButton?.addEventListener?.('click', () => {
  if(screen==='home'||!progress){
    window.switchToPage?.('page-learning');
  }else{
    // Stay inside Daily Vocabulary and keep the current lesson progress.
    actions.home();
  }
});

slot.addEventListener('click', event => {
  const target = event.target.closest('button[data-dv-action]');
  if (target && !target.disabled && progress) actions[target.dataset.dvAction]?.(target);
});

slot.addEventListener('submit', event => {
  const form = event.target.closest('[data-dv-spelling]');
  if (!form) return;
  event.preventDefault();
  const value = form.querySelector('input').value.trim();
  if (value) answer(Number(form.dataset.index), value);
});

let wasOpen = false;
let dayTimer;
function syncPage() {
  const active = isOpen();
  if (active && !wasOpen) {
    void openPage();
    dayTimer = setInterval(() => {
      if (screen === 'home' && progress?.lesson.date < rules.todayInTaipei()) void openPage();
    }, 30_000);
  }
  if (!active && wasOpen) {
    clearInterval(dayTimer);
    pronunciation.stop();
  }
  wasOpen = active;
}

new MutationObserver(syncPage).observe(page, { attributes: true, attributeFilter: ['class'] });
window.addEventListener('xiuxian:user-data-ready', () => {
  if (isOpen() && storagePrefix + window.getRealmUserUid?.() !== key) void openPage();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pronunciation.stop();
  if (!document.hidden && isOpen() && screen === 'home' && progress) void openPage();
});
window.addEventListener('pagehide', () => pronunciation.stop());
window.addEventListener('storage', event => {
  if (event.key === key && isOpen() && screen === 'home') refreshDashboard();
});
syncPage();
