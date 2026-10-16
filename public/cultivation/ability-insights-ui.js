import './ability-insights-core.js';
import { authenticatedMainFetch, getMainUser } from './data/project-repository.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, getDocs, query, where, orderBy, limit } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

(function () {
  'use strict';
  const Core = globalThis.QAAbilityInsights;
  if (!Core) return;
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let currentSubject = null, chart = null, history = [], historyUid = '',
    historyFetchedAt = 0, historyLoading = null, historyError = '',
    latestReport = null, latestTrend = null, latestSkills = [], renderEpoch = 0, aiBusy = false,
    lastRenderedSubject = null, currentView = 'knowledge';
  const ms = 5 * 60 * 1000;
  const description = '保守估計 = (答對數 + 2) / (答題數 + 4)。少量樣本會趨近 50%；這不是 AI 評分、智力測驗或考試成績。';
  const statusClass = value => value === '表現穩定' ? 'good' :
    value === '優先補強' ? 'needs' : value === '持續鞏固' ? 'review' : 'unknown';
  const percent = value => value == null ? '—' : String(value) + '%';
  function canShow() {
    return !!$('knowledgeChart') && $('page-settings')?.classList.contains('active-page') &&
      !document.querySelector('.dongfu-analysis-card.is-collapsed');
  }
  function mount() {
    const canvas = $('knowledgeChart');
    if (!canvas) return null;
    if (!$('ability-insights-style')) {
      const link = document.createElement('link');
      link.id = 'ability-insights-style'; link.rel = 'stylesheet';
      link.href = '/styles/ability-insights.css'; document.head.appendChild(link);
    }
    const frame = canvas.parentElement;
    frame?.classList.add('ai-ability-chart-frame');
    if (frame && !$('ability-chart-empty')) {
      const empty = document.createElement('div');
      empty.id = 'ability-chart-empty';
      empty.className = 'ai-ability-chart-empty';
      empty.hidden = true;
      empty.setAttribute('role', 'status');
      empty.textContent = '尚無可呈現的作答數據；先完成幾題，圖譜就會開始成長。';
      frame.append(empty);
    }
    if (frame && !$('ability-chart-views')) {
      const controls = document.createElement('nav');
      controls.id = 'ability-chart-views';
      controls.className = 'ai-ability-views';
      controls.setAttribute('aria-label', '切換能力圖譜分析面向');
      controls.innerHTML = [
        ['knowledge', '知識掌握'], ['skills', '推理能力'], ['trend', '學習趨勢']
      ].map(([value, label]) => '<button type="button" data-ability-view="' + value +
        '" aria-pressed="false">' + label + '</button>').join('');
      controls.addEventListener('click', event => {
        const button = event.target.closest('[data-ability-view]');
        if (!button) return;
        currentView = button.dataset.abilityView;
        if (latestReport) drawChart(latestReport);
      });
      frame.before(controls);
    }
    if (!$('ability-insights-panel')) {
      const root = document.createElement('section');
      root.id = 'ability-insights-panel'; root.className = 'ai-ability-panel';
      root.innerHTML = `
        <p class="ai-ability-definition">依已記錄的學習表現建立單元診斷；未練習不代表零能力。</p>
        <div id="ai-ability-summary" class="ai-ability-stats" aria-live="polite"></div>
        <div id="ai-ability-priority" class="ai-ability-priority"></div>
        <div class="ai-ability-head"><h4>能力細項</h4><small>點選科目查看各單元</small></div>
        <div id="ai-ability-list" class="ai-ability-list"></div>
        <div class="ai-ability-skills"><div class="ai-ability-head"><h4>推理題型能力</h4>
          <small>依 AI 題目提供的題型標記；無紀錄則留白</small></div>
          <div id="ai-ability-skills-list" class="ai-ability-skill-grid"></div></div>
        <details class="ai-ability-method"><summary>診斷方法與數據限制</summary><p>${escape(description)}</p>
        <p>少於 5 題的單元不判定熟練；8 題以上才有中等證據。圖表以保守估計展示，沒有資料的領域會留白而非 0 分。
        近期趨勢與推理題型僅使用最新最多 160 筆可讀取的單人答題紀錄；題型維度須由題目原本提供標記才會納入，舊題目與其他玩法不一定涵蓋。數據不適合跨玩家公平排名。</p></details>
        <section class="ai-ability-coach"><div class="ai-ability-head"><h4>AI 學習教練</h4><span>主動啟用</span></div>
        <p>根據各單元答題數及正確數提供個人化練習建議。點擊才會將科目與彙總統計傳送至已設定的 AI 供應商，不傳送題目、姓名或完整作答紀錄。</p>
        <button type="button" id="ai-ability-request">讓 AI 制訂補強計畫</button>
        <div id="ai-ability-response" role="status" aria-live="polite"></div></section>`;
      canvas.closest('.relative')?.after(root);
      $('ai-ability-request')?.addEventListener('click', () => void askCoach());
    }
    return canvas;
  }
  function showSummary(report, trend) {
    const target = $('ai-ability-summary');
    if (!target) return;
    const inScope = currentSubject
      ? report.topics.filter(x => x.subject === currentSubject) : report.topics;
    const stats = Core.sum(inScope.filter(x => x.total));
    const coverage = inScope.filter(x => x.total).length;
    const delta = trend?.delta;
    target.innerHTML = `
      <div><small>有紀錄答題</small><strong>${stats.total}</strong><span>${stats.correct} 題答對</span></div>
      <div><small>保守表現估計</small><strong>${percent(stats.estimate)}</strong><span>${stats.total ? '原始正確率 ' + percent(stats.rawAccuracy) : '尚無足夠紀錄'}</span></div>
      <div><small>已練習單元</small><strong>${coverage} / ${inScope.length}</strong><span>未作答的項目不列為弱點</span></div>
      <div><small>近 7 日趨勢</small><strong>${delta == null ? '—' : (delta > 0 ? '+' : '') + delta + 'pp'}</strong>
        <span>${trend ? (trend.recent.count + ' 題，' + (trend.previous.count ? '對比前 7 日' : '前期無資料')) : '最新答題紀錄尚未載入'}</span></div>`;
  }
  function showPriority(report) {
    const node = $('ai-ability-priority');
    if (!node) return;
    const scoped = Core.aiSummary(report, currentSubject).priorities;
    const strong = report.topics.filter(x => x.total >= 5 && x.estimate >= 78 &&
      (!currentSubject || x.subject === currentSubject))
      .sort((a, b) => b.estimate - a.estimate || b.total - a.total);
    const recommendation = scoped[0];
    node.innerHTML = `<div class="ai-ability-priority-heading">
      <span>${recommendation ? '下一步的修煉目標' : '目前診斷'}</span></div>
      <p>${recommendation
        ? escape(recommendation.subject + ' · ' + recommendation.topic) +
          '　' + (recommendation.total < 5 ? '先完成至少 5 題，以建立可靠判斷。' :
            '已練習 ' + recommendation.total + ' 題；建議先複習此單元再練 5 題。')
        : '目前沒有足夠的單元紀錄。先在問道練習數題，即可累積圖譜。'}</p>
      ${strong.length ? '<small>較穩定項目：' + escape(strong.map(x => x.topic).slice(0,2).join('、')) + '</small>' : ''}
      ${recommendation ? '<button type="button" data-ability-copy="' +
        escape(recommendation.subject + '｜' + recommendation.topic) + '">複製此練習單元</button>' : ''}`;
    node.querySelector('[data-ability-copy]')?.addEventListener('click', event => {
      const topic = event.currentTarget.dataset.abilityCopy;
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(topic).then(() => {
          event.currentTarget.textContent = '已複製練習單元';
        }).catch(() => {
          event.currentTarget.textContent = '複製失敗，請手動選取';
        });
      }
    });
  }
  function showDetails(report) {
    const node = $('ai-ability-list');
    if (!node) return;
    const items = (currentSubject ? report.topics.filter(x => x.subject === currentSubject) : report.subjects.map(x => ({
      subject: x.name, topic: x.name, ...x, status: x.total < 5 ? (x.total ? '需要更多題' : '尚未練習') :
        x.estimate < 60 ? '優先補強' : x.estimate < 78 ? '持續鞏固' : '表現穩定'
    }))).slice().sort((a, b) => {
      const priority = x => x.total === 0 ? 3 : x.total < 5 ? 2 : x.estimate < 60 ? 0 : 1;
      return priority(a) - priority(b) || (a.estimate ?? 100) - (b.estimate ?? 100) || a.topic.localeCompare(b.topic, 'zh');
    });
    const markup = item => `<div class="ai-ability-item">
      <div class="ai-ability-item-head"><b>${escape(item.topic)}</b>
        <span class="ai-ability-state is-${statusClass(item.status)}">${item.status}</span></div>
      <div class="ai-ability-meter" ${item.estimate == null ? 'role="img" aria-label="尚無作答資料，不予評分"' :
        'role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
        item.estimate + '" aria-label="' + escape(item.topic) + ' 的保守能力估計"'}>
        ${item.estimate == null ? '<span class="is-unknown"></span>' :
          '<span style="width:' + item.estimate + '%"></span>'}</div>
      <small>${item.total ? escape('答對 ' + item.correct + '/' + item.total + ' · 原始 ' +
        percent(item.rawAccuracy) + ' · 保守估計 ' + percent(item.estimate) +
        ' · 證據 ' + (item.confidence || '不足')) : '尚無作答資料 · 不予評分'}</small>
    </div>`;
    const observed = items.filter(x => x.total);
    const none = items.filter(x => !x.total);
    const first = observed.slice(0, currentSubject ? 12 : 14);
    node.innerHTML = !items.length ? '<p>尚無單元分類，請先開始問道答題。</p>' :
      first.map(markup).join('') +
      ((observed.length > first.length || none.length) ? '<details><summary>查看更多／尚未練習的單元（' +
      (observed.length - first.length + none.length) + '）</summary>' +
      [...observed.slice(first.length), ...none].map(markup).join('') + '</details>' : '');
  }
  function showSkills(records = []) {
    const node = $('ai-ability-skills-list');
    if (!node) return;
    const skills = Core.skillStats(records, currentSubject);
    latestSkills = skills;
    const used = skills.filter(x => x.total > 0);
    if (!used.length) {
      node.innerHTML = '<p class="ai-ability-skill-empty">尚無可辨識題型的作答紀錄。此欄會隨新題目累積，不會以 0 分代替未知能力。</p>';
      return;
    }
    node.innerHTML = skills.map(skill => `<div class="ai-ability-skill">
      <div><b>${escape(skill.topic)}</b>
        <span>${skill.total ? percent(skill.estimate) : '尚無資料'}</span></div>
      <div class="ai-ability-skill-track">${skill.total
        ? '<span style="width:' + skill.estimate + '%"></span>' : ''}</div>
      <small>${skill.total
        ? escape(skill.correct + '/' + skill.total + ' 題 · 證據' + skill.confidence)
        : '未有可分類紀錄'}</small>
      </div>`).join('');
  }
  function initFilters(report) {
    const controls = $('chart-controls'); if (!controls) return;
    const available = report.subjects.filter(x => x.studiedTopics > 0);
    const other = report.subjects.filter(x => !x.studiedTopics);
    const labels = [{ id: null, name: '總覽' }, ...available, ...other]
      .map(x => ({ id: x.id === null ? null : x.name, name: x.name }));
    if (currentSubject && !labels.some(x => x.id === currentSubject)) currentSubject = null;
    controls.replaceChildren();
    for (const item of labels) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = item.name; button.dataset.subj = item.id || 'all';
      button.className = 'ai-ability-filter' + (currentSubject === item.id ? ' is-active' : '');
      button.setAttribute('aria-pressed', String(currentSubject === item.id));
      button.addEventListener('click', () => window.renderKnowledgeGraph(item.id));
      controls.append(button);
    }
  }
  function drawChart(report) {
    const ctx = $('knowledgeChart');
    if (!ctx) return;
    if (chart) { chart.destroy(); chart = null; }
    const empty = $('ability-chart-empty');
    for (const button of document.querySelectorAll('#ability-chart-views [data-ability-view]')) {
      const selected = button.dataset.abilityView === currentView;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    if (!window.Chart) {
      ctx.hidden = true;
      if (empty) { empty.hidden = false; empty.textContent = '圖表元件暫時無法載入；下方的能力細項仍可正常查看。'; }
      return;
    }
    const trend = Core.recentTrend(history, currentSubject);
    const skills = Core.skillStats(history, currentSubject);
    let axes, chartType, title, series;
    if (currentView === 'trend') {
      const last = trend.recent, prev = trend.previous;
      axes = [{ name: '前 7 日', ...prev, total: prev.count, estimate: prev.accuracy },
        { name: '近 7 日', ...last, total: last.count, estimate: last.accuracy }];
      chartType = 'bar';
      title = '最近兩週 · 答題表現';
      series = axes.map(x => x.estimate);
    } else if (currentView === 'skills') {
      axes = skills;
      chartType = axes.filter(x => x.total > 0).length >= 3 ? 'radar' : 'bar';
      title = '八種推理能力 · 樣本校正';
      series = axes.map(x => x.estimate);
    } else {
      const topics = currentSubject ? report.topics.filter(x => x.subject === currentSubject) :
        report.domains.filter(x => x.topicCount > 0 || x.total > 0);
      axes = currentSubject ?
        [...topics.filter(x => x.total), ...topics.filter(x => !x.total)].slice(0, 9) :
        topics.slice(0, 7);
      chartType = axes.filter(x => x.total > 0).length >= 3 ? 'radar' : 'bar';
      title = currentSubject ? currentSubject + ' · 單元掌握' : '綜合能力領域';
      series = axes.map(x => x.estimate);
    }
    const known = axes.filter(x => x.total > 0).length;
    if (!axes.length || !known) {
      ctx.hidden = true;
      if (empty) {
        empty.hidden = false;
        empty.textContent = currentView === 'skills' ?
          '目前尚無標記推理題型的作答紀錄。完成新題目後，八種推理能力會逐步顯示。' :
          currentView === 'trend' ? '目前沒有近期可分類的答題紀錄，無法計算趨勢。' :
          '尚無本領域的作答資料；未練習不是零分。';
      }
      return;
    }
    ctx.hidden = false;
    if (empty) empty.hidden = true;
    const useRadar = chartType === 'radar';
    const labels = axes.map(x => {
      const name = String(x.topic || x.name);
      return name.length > 9 ? name.slice(0, 9) + '…' : name;
    });
    chart = new window.Chart(ctx, {
      type: chartType,
      data: { labels, datasets: [{
        label: '保守估計 (%)',
        data: series,
        spanGaps: false,
        borderColor: '#dfbc79', pointBackgroundColor: '#efd19a', pointBorderColor: '#dfbc79',
        pointRadius: useRadar ? 4 : 0,
        backgroundColor: useRadar ? 'rgba(226,188,121,.18)' :
          axes.map(x => x.total ? 'rgba(226,188,121,.75)' : 'rgba(226,188,121,.12)'),
        borderWidth: 2
      }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260 },
        plugins: {
          legend: { display: false },
          title: { display: true, color: '#f4e6c7', text: title,
            font: { size: 13, family: "'Noto Serif TC',serif" } },
          tooltip: { callbacks: { title: context => {
            return context[0] ? String(axes[context[0].dataIndex].topic || axes[context[0].dataIndex].name) : '';
          }, label: context => {
            const entry = axes[context.dataIndex];
            return entry.total ? ' ' + entry.estimate + '% · ' +
              (entry.correct == null ? entry.total + ' 題' : entry.correct + '/' + entry.total + ' 題') :
              ' 尚無紀錄（不是 0 分）';
          } } }
        },
        scales: useRadar ? {
          r: { min: 0, max: 100, beginAtZero: true,
            angleLines: { color: 'rgba(214,181,124,.18)' }, grid: { color: 'rgba(214,181,124,.16)' },
            pointLabels: { color: '#d8c7a8', font: { size: 10 } },
            ticks: { stepSize: 25, color: '#b19d7c', backdropColor: 'transparent' } }
        } : {
          x: { min: 0, max: 100, ticks: { color: '#d8c7a8' },
            grid: { color: 'rgba(214,181,124,.12)' } },
          y: { ticks: { color: '#d8c7a8', font: { size: 10 } }, grid: { display: false } }
        },
        indexAxis: useRadar ? undefined : 'y'
      }
    });
  }
  async function loadRecent(uid) {
    if (!uid) return;
    if (historyUid === uid && historyFetchedAt && Date.now() - historyFetchedAt < ms) return;
    if (historyLoading && historyUid === uid) return historyLoading;
    historyUid = uid; history = []; historyError = ''; historyFetchedAt = 0;
    const pending = (async () => {
      try {
        const db = getFirestore(getApp());
        const records = await getDocs(query(collection(db, 'exam_logs'),
          where('uid', '==', uid), orderBy('timestamp', 'desc'), limit(160)));
        if (getMainUser()?.uid !== uid) return;
        history = records.docs.map(x => x.data()).filter(x => x.subject);
        historyFetchedAt = Date.now();
      } catch (error) {
        if (getMainUser()?.uid === uid) {
          historyError = '近期趨勢無法載入（圖譜累積統計仍可使用）';
          historyFetchedAt = Date.now();
        }
        console.warn('[Ability analysis] recent logs unavailable:', error?.code || error?.message);
      } finally { if (historyLoading === pending) historyLoading = null; }
    })();
    historyLoading = pending;
    return pending;
  }
  async function askCoach() {
    if (aiBusy || !latestReport || latestReport.total === 0) return;
    const btn = $('ai-ability-request'), replyBox = $('ai-ability-response');
    if (!btn || !replyBox) return;
    const uid = getMainUser()?.uid;
    if (!uid) { replyBox.textContent = '請先登入才能取得 AI 建議。'; return; }
    const subject = currentSubject;
    const summary = Core.aiSummary(latestReport, subject, latestTrend, latestSkills);
    if (!summary.topics.length) { replyBox.textContent = '此科目尚沒有已答題的單元。'; return; }
    aiBusy = true; btn.disabled = true; btn.textContent = '正在整理個人化練習策略…';
    replyBox.textContent = '僅傳送分類彙總，不會傳送題目或個人身分。';
    try {
      const response = await authenticatedMainFetch('/api/learning/ability-coach', {
        method: 'POST', body: JSON.stringify({ summary })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || '無法取得 AI 建議');
      if (uid !== getMainUser()?.uid || subject !== currentSubject) return;
      const advice = payload.advice;
      replyBox.replaceChildren();
      const source = document.createElement('small');
      source.className = 'ai-ability-coach-source';
      source.textContent = payload.source === 'local' ?
        '統計備用建議 · AI 暫時不可用' : 'AI 學習策略 · 依玩家答題統計產生';
      replyBox.append(source);
      const heading = document.createElement('h5'); heading.textContent = advice.headline; replyBox.append(heading);
      const explanation = document.createElement('p'); explanation.textContent = advice.explanation; replyBox.append(explanation);
      const list = document.createElement('ol');
      for (const step of advice.plan || []) {
        const li = document.createElement('li');
        const title = document.createElement('b'); title.textContent = step.topic + ' · 建議 ' + step.questions + ' 題';
        const reason = document.createElement('p'); reason.textContent = step.reason;
        const action = document.createElement('p'); action.textContent = step.action;
        li.append(title, reason, action); list.append(li);
      }
      replyBox.append(list);
      const footer = document.createElement('small'); footer.textContent =
        payload.source === 'local' ? '這是規則式備用方案，不代表 AI 已完成診斷，也不會修改玩家資料。' :
          'AI 建議僅供學習參考，不會修改能力分數或獎勵。';
      replyBox.append(footer);
    } catch (error) {
      replyBox.textContent = (error?.message || 'AI 暫時不可用') +
        '。仍可依上方「下一步修煉目標」進行練習。';
    } finally { aiBusy = false; if (btn) { btn.disabled = false; btn.textContent = '重新生成補強計畫'; } }
  }
  function render({ map = {}, targetSubject = null, onPercentile } = {}) {
    const ctx = mount(); if (!ctx) return;
    currentSubject = targetSubject;
    const uid = getMainUser()?.uid || '';
    if (uid !== historyUid) {
      history = []; historyUid = uid; historyFetchedAt = 0; historyError = '';
    }
    if (currentSubject !== lastRenderedSubject) {
      lastRenderedSubject = currentSubject;
      if ($('ai-ability-response')) $('ai-ability-response').replaceChildren();
      if ($('ai-ability-request') && !aiBusy) $('ai-ability-request').textContent = '讓 AI 制訂補強計畫';
    }
    const report = Core.build(map, window.SUBJECT_SCHEMA_FRONTEND || {});
    latestReport = report;
    initFilters(report);
    // Existing percentile is an explicit opt-in on the old page, not an AI score.
    if (typeof onPercentile === 'function') onPercentile(currentSubject, map);
    const trend = Core.recentTrend(history, currentSubject);
    latestTrend = trend;
    showSummary(report, historyFetchedAt ? trend : null);
    showPriority(report); showDetails(report); showSkills(history); drawChart(report);
    if (historyError && $('ai-ability-summary')) {
      $('ai-ability-summary').setAttribute('title', historyError);
    }
    const button = $('ai-ability-request');
    if (button) button.disabled = aiBusy || !report.topics.some(x => x.total > 0 && (!currentSubject || x.subject === currentSubject));
    const serial = ++renderEpoch;
    if (canShow() && uid && !historyFetchedAt) {
      void loadRecent(uid).then(() => {
        if (serial === renderEpoch && uid === getMainUser()?.uid && canShow()) {
          const updated = Core.recentTrend(history, currentSubject); latestTrend = updated;
          showSummary(latestReport, updated); showSkills(history);
          if (currentView !== 'knowledge') drawChart(latestReport);
        }
      });
    }
  }
  // Existing main-legacy entry point will delegate to the richer module after loading.
  window.QAAbilityGraph = { render };
  document.addEventListener('click', event => {
    if (event.target.closest?.('.dongfu-analysis-card .dongfu-collapse-head')) {
      requestAnimationFrame(() => { if (canShow()) window.renderKnowledgeGraph?.(currentSubject); });
    }
  });
  window.addEventListener('xiuxian:user-ready', () => { historyUid = ''; historyFetchedAt = 0; history = []; });
})();
