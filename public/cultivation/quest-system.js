import './quest-rules.js';
import { authenticatedMainFetch, getMainUser } from './data/project-repository.js';

(function () {
  'use strict';
  let snapshot = null, account = '', tab = 'path', busy = false, dirty = true, timer = null, revision = 0, applyingReward = false;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const visible = () => $('page-home')?.classList.contains('active-page');
  const materialNames = { 'raid-refine-key-ii': '淬靈玄印', 'raid-refine-key-iii': '玄天道印' };
  function rewardText(reward) {
    const parts = [`${reward.gold} 靈石`];
    if (reward.cultivation) parts.push(`${reward.cultivation} 修為`);
    Object.entries(reward.materials || {}).forEach(([id, count]) => parts.push(`${materialNames[id] || id} ×${count}`));
    return parts.join(' · ');
  }
  function status(message) { if ($('quest-status')) $('quest-status').textContent = message; }
  function card(q, kind) {
    const label = q.claimed ? '已領取' : q.locked ? '尚未解鎖' : q.claimable ? '領取獎勵' : q.metric === 'story' ? '觀看劇情' : q.metric === 'dongtian-tutorial' ? '開始洞天教程' : '前往修行';
    return `<article class="quest-card ${kind === 'path' ? 'quest-path-card' : ''} ${q.claimable ? 'quest-ready' : ''} ${q.claimed ? 'quest-claimed' : ''}">
      <div class="quest-card-heading"><h4>${esc(q.title)}</h4><span>${q.claimed ? '已完成' : q.claimable ? '待領獎' : '進行中'}</span></div>
      <p>${esc(q.description)}</p>
      <div class="quest-progress-label"><span>${q.locked ? `需 ${q.minScore} 修為 · 先繼續問道修行` : '任務進度'}</span><b>${q.current} / ${q.target}</b></div>
      <div class="quest-progress" role="progressbar" aria-label="${esc(q.title)}" aria-valuemin="0" aria-valuemax="${q.target}" aria-valuenow="${q.current}"><i style="width:${Math.round(q.current / q.target * 100)}%"></i></div>
      <div class="quest-reward"><i class="fa-solid fa-gift" aria-hidden="true"></i> ${esc(rewardText(q.reward))}</div>
      <button type="button" data-quest-id="${esc(q.id)}" data-quest-kind="${kind}" ${busy || q.claimed || q.locked ? 'disabled' : ''} class="quest-action ${q.claimable ? 'quest-claim' : ''}">${busy ? '正在同步…' : label}</button>
    </article>`;
  }
  function render() {
    if (!$('quest-content')) return;
    ['path', 'daily'].forEach(key => {
      const button = $('quest-tab-' + key);
      button.setAttribute('aria-selected', String(tab === key));
      button.tabIndex = tab === key ? 0 : -1;
    });
    $('quest-content').setAttribute('aria-labelledby', 'quest-tab-' + tab);
    $('quest-refresh').disabled = busy;
    if (!snapshot) {
      $('quest-content').innerHTML = '<p class="quest-empty">正在讀取修行任務…</p>';
      return;
    }
    $('quest-path-count').textContent = `${snapshot.pathCompleted ?? snapshot.pathIndex} / ${snapshot.pathTotal}`;
    const available = snapshot.daily.filter(q => q.claimable).length;
    $('quest-daily-count').textContent = available ? `${available} 項待領獎` : `${snapshot.daily.filter(q => q.claimed).length} / ${snapshot.daily.length}`;
    $('quest-note').textContent = tab === 'path'
      ? '仙道任務依序開啟，領獎後接續下一項。觀看劇情請親自點擊，完整看完並儲存後即可領獎；已有紀錄也計入。'
      : `今日 ${snapshot.date} · 台灣時間每日 00:00 重置，請在當日領取獎勵。`;
    const content = $('quest-content');
    content.classList.toggle('quest-daily-grid', tab === 'daily');
    content.innerHTML = tab === 'daily' ? snapshot.daily.map(q => card(q, 'daily')).join('')
      : snapshot.path ? card(snapshot.path, 'path') : '<p class="quest-empty">仙道任務已全部完成。仙途無盡，日常修行仍可繼續。</p>';
  }
  async function request(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await authenticatedMainFetch(path, { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) throw new Error(payload.error || '任務服務暫時無法使用');
      return payload;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('任務同步逾時');
      throw e;
    } finally { clearTimeout(timeout); }
  }
  function reconcileAccount() {
    const uid = getMainUser()?.uid || '';
    if (uid !== account) { account = uid; snapshot = null; dirty = true; status(''); render(); }
    return uid;
  }
  async function refresh(force = false) {
    const uid = reconcileAccount();
    if (!uid || busy || (!force && (!dirty || !visible()))) return;
    const startedRevision = revision;
    busy = true; dirty = false; render();
    try {
      const result = await request('/api/quests');
      if (getMainUser()?.uid !== uid) return;
      snapshot = result.quests;
      status('');
    } catch (e) {
      dirty = true;
      if (getMainUser()?.uid === uid) status(`${e.message}，可按「重新同步」重試。`);
    } finally {
      busy = false; reconcileAccount(); render();
      if ((revision !== startedRevision || getMainUser()?.uid !== uid) && visible()) invalidate();
    }
  }
  function invalidate() {
    revision += 1; dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => { void refresh(); }, 350);
  }
  async function claim(q, kind) {
    if (busy) return;
    const uid = reconcileAccount();
    if (!uid) return;
    busy = true; render(); status('正在領取獎勵…');
    try {
      const result = await request('/api/quests/claim', { kind, id: q.id, date: snapshot.date });
      if (getMainUser()?.uid !== uid) return;
      snapshot = result.quests;
      const data = window.getCurrentUserData?.();
      if (data?.stats) {
        Object.assign(data.stats, result.balances);
        const rank = window.getXiuxianRealmIndex?.(data.stats.totalScore);
        if (Number.isFinite(rank)) data.stats.rankLevel = rank;
        data.materialSystem = { ...(data.materialSystem || {}), inventory: { ...(data.materialSystem?.inventory || {}), ...result.materials } };
        window.dispatchEvent(new CustomEvent('material-system-updated', { detail: { ...data.materialSystem, questReward: true } }));
        applyingReward = true;
        try {
          window.updateUIStats?.();
          window.refreshCultivationRealmUI?.();
        } finally { applyingReward = false; }
        window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', { detail: { source: 'quest-reward', ...result.balances } }));
      }
      status(result.awarded ? `已獲得 ${rewardText(result.reward)}${kind === 'path' && snapshot.path ? '，下一個仙道任務已開啟。' : '。'}` : '此任務已領取過，進度已同步。');
    } catch (e) {
      if (getMainUser()?.uid === uid) { status(`${e.message}，請重新同步後重試。`); dirty = true; }
    } finally {
      busy = false; reconcileAccount(); render();
      if (getMainUser()?.uid !== uid && visible()) invalidate();
    }
  }
  function go(destination, q = {}) {
    const actions = {
      scope: () => { window.switchToPage?.('page-settings'); window.openCurriculumStudio?.(); },
      solo: () => { void window.startQuizFlow?.(true); },
      meditation: () => { void window.openDailyMeditation?.(); },
      battle: () => { void window.startBattleMatchmaking?.(); },
      raid: () => { void window.openRaidHub?.(); },
      dongtian: () => { window.openDongtianPanel?.(); },
      'dongtian-tutorial': () => {
        const opened = window.startDongtianTutorial?.();
        if (!opened) status('洞天教程暫時無法開啟，請先結束目前的戰鬥、劇情或教學，再按「開始洞天教程」。');
      },
      story: () => {
        const opened = window.openXiuxianStoryChapter?.(q.chapterId);
        if (!opened) status('劇情暫時無法開啟，請先結束目前的戰鬥或教學，再按「觀看劇情」。');
      }
    };
    actions[destination]?.();
  }
  function mount() {
    if ($('quest-panel')) return;
    const anchor = $('xiuxian-panel');
    if (!anchor) return;
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/styles/quest-system.css'; document.head.append(link);
    const panel = document.createElement('section'); panel.id = 'quest-panel'; panel.className = 'quest-panel'; panel.setAttribute('aria-label', '修行任務');
    panel.innerHTML = `<header class="quest-heading"><div><small>宗門手札</small><h3>修行任務</h3></div><button type="button" id="quest-refresh" aria-label="重新同步任務">重新同步</button></header>
      <div class="quest-tabs" role="tablist" aria-label="任務類別"><button id="quest-tab-path" type="button" role="tab" aria-controls="quest-content" aria-selected="true">仙道 <span id="quest-path-count"></span></button><button id="quest-tab-daily" type="button" role="tab" aria-controls="quest-content" aria-selected="false" tabindex="-1">日常 <span id="quest-daily-count"></span></button></div>
      <p id="quest-note" class="quest-note"></p><div id="quest-content" role="tabpanel" aria-labelledby="quest-tab-path"></div><p id="quest-status" role="status" aria-live="polite"></p>`;
    anchor.after(panel);
    ['path', 'daily'].forEach(key => $('quest-tab-' + key).addEventListener('click', () => { tab = key; render(); void refresh(); }));
    panel.querySelector('.quest-tabs').addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); tab = e.key === 'Home' ? 'path' : e.key === 'End' ? 'daily' : tab === 'path' ? 'daily' : 'path';
      render(); $('quest-tab-' + tab).focus();
    });
    $('quest-refresh').addEventListener('click', () => { void refresh(true); });
    $('quest-content').addEventListener('click', e => {
      const b = e.target.closest('[data-quest-id]');
      if (!b || b.disabled || busy || !snapshot) return;
      const kind = b.dataset.questKind;
      const q = kind === 'path' ? snapshot.path : snapshot.daily.find(q => q.id === b.dataset.questId);
      if (!q || q.id !== b.dataset.questId || q.claimed || q.locked) return;
      if (q.claimable) void claim(q, kind); else go(q.destination, q);
    });
    new MutationObserver(() => { if (visible()) { reconcileAccount(); void refresh(); } }).observe($('page-home'), { attributes: true, attributeFilter: ['class'] });
    render();
  }
  mount();
  ['xiuxian:user-ready', 'xiuxian:quest-progress-updated', 'xiuxian:story-chapter-completed', 'xiuxian:dongtian-tutorial-completed'].forEach(name => window.addEventListener(name, invalidate));
  window.addEventListener('material-system-updated', e => { if (!e.detail?.questReward) invalidate(); });
  window.addEventListener('xiuxian:stats-updated', e => { if (!applyingReward && e.detail?.source !== 'quest-reward') invalidate(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) invalidate(); });
  // Only invalidate at a date change, without periodic API polling.
  setInterval(() => { if (snapshot && snapshot.date !== window.XianxiaQuestRules.dateKey()) invalidate(); }, 60000);
  window.refreshCultivationQuests = () => refresh(true);
  void refresh();
})();
