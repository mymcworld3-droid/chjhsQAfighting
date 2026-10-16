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
    const parts = [];
    if (reward.gold) parts.push(`${reward.gold} 靈石`);
    if (reward.cultivation) parts.push(`${reward.cultivation} 修為`);
    if (reward.drawTickets) parts.push(`本命法器抽獎券 ×${reward.drawTickets}`);
    Object.entries(reward.materials || {}).forEach(([id, count]) => parts.push(`${materialNames[id] || id} ×${count}`));
    return parts.join(' · ');
  }
  function status(message) { if ($('quest-status')) $('quest-status').textContent = message; }
  function syncQuestIndicator() {
    const ready = q => q?.claimable && !q.claimed && !q.locked;
    const current = account === getMainUser()?.uid ? snapshot : null;
    const pathReady = !!current && (!!ready(current.path) || !!current.pathTicketRewards?.some(ready));
    const dailyReady = !!current && current.date === window.XianxiaQuestRules.dateKey() &&
      [...current.daily,...(current.commissions||[])].some(ready);
    const weeklyReady = !!current && current.weeklyKey === window.XianxiaQuestRules.weekKey()
      && (current.weekly||[]).some(ready);
    const available = pathReady || dailyReady || weeklyReady;
    if ($('quest-ready-dot')) $('quest-ready-dot').hidden = !available;
    for (const [key, pending] of [['path', pathReady], ['daily', dailyReady], ['weekly', weeklyReady]]) {
      if ($('quest-' + key + '-dot')) $('quest-' + key + '-dot').hidden = !pending;
      const button = $('quest-tab-' + key);
      if (pending) button?.setAttribute('aria-description', '有任務獎勵可領取');
      else button?.removeAttribute('aria-description');
    }
    $('quest-open')?.setAttribute('aria-label', available ? '任務，有獎勵可領取' : '任務');
  }
  function card(q, kind) {
    const label = q.claimed ? '已領取' : q.locked ? '尚未解鎖' : q.supplemental ? '補領抽獎券' : q.claimable ? '領取獎勵' : q.metric === 'story' ? '觀看劇情' : q.metric === 'dongtian-tutorial' ? '開始洞天教程' : '前往修行';
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
    syncQuestIndicator();
    if (!$('quest-content')) return;
    ['path', 'daily', 'weekly'].forEach(key => {
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
    const available = [...snapshot.daily,...(snapshot.commissions||[])].filter(q => q.claimable).length;
    $('quest-daily-count').textContent = available ? `${available} 項待領獎` : `${[...snapshot.daily,...(snapshot.commissions||[])].filter(q => q.claimed).length} / ${snapshot.daily.length+(snapshot.commissions||[]).length}`;
    const weekly = snapshot.weekly || [];
    const weeklyReadyCount = weekly.filter(q=>q.claimable).length;
    $('quest-weekly-count').textContent = weeklyReadyCount ? `${weeklyReadyCount} 項待領`
      : `${weekly.filter(q=>q.claimed).length} / ${weekly.length}`;
    $('quest-note').textContent = tab === 'path'
      ? '仙道任務依序開啟，領獎後接續下一項。觀看劇情請親自點擊，完整看完並儲存後即可領獎；已有紀錄也計入。'
      : tab === 'weekly'
        ? `本週 ${snapshot.weeklyKey} 起（台灣時間週一 00:00 重置）· 7 天累積，不需要天天登入。請於週末前領取已完成獎勵。`
        : `今日 ${snapshot.date} · 原有日常任務與隨機宗門委託；台灣時間每日 00:00 重置。`;
    const content = $('quest-content');
    content.classList.toggle('quest-daily-grid', tab === 'daily' || tab === 'weekly');
    content.innerHTML = tab === 'daily' ?
      '<div class="quest-commission-heading"><i class="fa-solid fa-scroll"></i><b>今日宗門委託</b><small>每日隨機兩項 · 額外獎勵 · 不影響原日常</small></div>' +
      (snapshot.commissions||[]).map(q => card(q,'commission')).join('') +
      '<div class="quest-commission-heading"><i class="fa-solid fa-calendar-check"></i><b>原有日常任務</b></div>' +
      snapshot.daily.map(q => card(q, 'daily')).join('')
      : tab === 'weekly' ? (snapshot.weekly||[]).map(q => card(q,'weekly')).join('')
      : snapshot.path ? card(snapshot.path, 'path') : '<p class="quest-empty">仙道任務已全部完成。仙途無盡，日常修行仍可繼續。</p>';
    if (tab === 'path') content.innerHTML += (snapshot.pathTicketRewards || []).map(q => card(q, 'path')).join('');
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
    reconcileAccount(); syncQuestIndicator();
    clearTimeout(timer);
    timer = setTimeout(() => { void refresh(); }, 350);
  }
  async function claim(q, kind) {
    if (busy) return;
    const uid = reconcileAccount();
    if (!uid) return;
    busy = true; render(); status('正在領取獎勵…');
    try {
      const result = await request('/api/quests/claim', { kind, id: q.id,
        date: snapshot.date, weeklyKey:snapshot.weeklyKey });
      if (getMainUser()?.uid !== uid) return;
      snapshot = result.quests;
      const data = window.getCurrentUserData?.();
      if (data && result.drawTickets !== undefined) data.soulboundDrawTickets = result.drawTickets;
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
      status(result.awarded ? `已獲得 ${rewardText(result.reward)}${kind === 'path' && !q.supplemental && snapshot.path ? '，下一個仙道任務已開啟。' : '。'}` : '此任務已領取過，進度已同步。');
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
      enlightenment: () => { window.dispatchEvent(new CustomEvent('xiuxian:enlightenment-open')); },
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
    const entry = $('quest-open');
    if (!entry) return;
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/styles/quest-system.css'; document.head.append(link);
    const dialog = document.createElement('dialog'); dialog.id = 'quest-dialog'; dialog.className = 'quest-dialog'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'quest-title');
    const panel = document.createElement('section'); panel.id = 'quest-panel'; panel.className = 'quest-panel'; panel.setAttribute('aria-label', '修行任務');
    panel.innerHTML = `<header class="quest-heading"><div><small>宗門手札</small><h3 id="quest-title">修行任務</h3></div><div class="quest-heading-actions"><button type="button" id="quest-refresh" aria-label="重新同步任務">重新同步</button><button type="button" id="quest-close" aria-label="關閉任務">✕</button></div></header>
      <div class="quest-tabs" role="tablist" aria-label="任務類別"><button id="quest-tab-path" type="button" role="tab" aria-controls="quest-content" aria-selected="true">仙道 <span id="quest-path-count"></span><span id="quest-path-dot" class="quest-tab-dot" hidden aria-hidden="true"></span></button><button id="quest-tab-daily" type="button" role="tab" aria-controls="quest-content" aria-selected="false" tabindex="-1">日常 <span id="quest-daily-count"></span><span id="quest-daily-dot" class="quest-tab-dot" hidden aria-hidden="true"></span></button><button id="quest-tab-weekly" type="button" role="tab" aria-controls="quest-content" aria-selected="false" tabindex="-1">每週 <span id="quest-weekly-count"></span><span id="quest-weekly-dot" class="quest-tab-dot" hidden aria-hidden="true"></span></button></div>
      <div class="quest-scroll" tabindex="0" role="region" aria-label="任務清單，可捲動"><p id="quest-note" class="quest-note"></p><div id="quest-content" role="tabpanel" aria-labelledby="quest-tab-path"></div><p id="quest-status" role="status" aria-live="polite"></p></div>`;
    dialog.append(panel); document.body.append(dialog);
    entry.addEventListener('click', () => {
      if (!dialog.open) dialog.showModal();
      entry.setAttribute('aria-expanded', 'true');
      reconcileAccount(); void refresh();
    });
    $('quest-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => entry.setAttribute('aria-expanded', String(dialog.open)));
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    const selectTab = key => {
      tab = key; render(); panel.querySelector('.quest-scroll').scrollTop = 0; void refresh();
    };
    ['path', 'daily', 'weekly'].forEach(key => $('quest-tab-' + key).addEventListener('click', () => selectTab(key)));
    panel.querySelector('.quest-tabs').addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const tabs=['path','daily','weekly'],index=tabs.indexOf(tab);
      e.preventDefault(); selectTab(e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs.at(-1)
        : tabs[(index+(e.key==='ArrowRight'?1:2))%3]);
      $('quest-tab-' + tab).focus();
    });
    $('quest-refresh').addEventListener('click', () => { void refresh(true); });
    $('quest-content').addEventListener('click', e => {
      const b = e.target.closest('[data-quest-id]');
      if (!b || b.disabled || busy || !snapshot) return;
      const kind = b.dataset.questKind;
      const q = kind === 'path' ? [snapshot.path, ...(snapshot.pathTicketRewards || [])].find(q => q?.id === b.dataset.questId)
        : kind === 'commission' ? (snapshot.commissions||[]).find(q=>q.id===b.dataset.questId)
        : kind === 'weekly' ? (snapshot.weekly||[]).find(q=>q.id===b.dataset.questId)
        : snapshot.daily.find(q => q.id === b.dataset.questId);
      if (!q || q.id !== b.dataset.questId || q.claimed || q.locked) return;
      if (q.claimable) void claim(q, kind); else { dialog.close(); go(q.destination, q); }
    });
    new MutationObserver(() => {
      if (visible()) { reconcileAccount(); void refresh(); }
      else if (dialog.open) dialog.close();
    }).observe($('page-home'), { attributes: true, attributeFilter: ['class'] });
    render();
  }
  mount();
  ['xiuxian:user-data-ready', 'xiuxian:user-ready', 'xiuxian:quest-progress-updated', 'xiuxian:enlightenment-updated', 'xiuxian:story-chapter-completed', 'xiuxian:dongtian-tutorial-completed'].forEach(name => window.addEventListener(name, invalidate));
  window.addEventListener('material-system-updated', e => { if (!e.detail?.questReward) invalidate(); });
  window.addEventListener('xiuxian:stats-updated', e => { if (!applyingReward && e.detail?.source !== 'quest-reward') invalidate(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) invalidate(); });
  // Only invalidate at a date change, without periodic API polling.
  setInterval(() => { if (snapshot && (snapshot.date !== window.XianxiaQuestRules.dateKey() ||
      snapshot.weeklyKey !== window.XianxiaQuestRules.weekKey())) invalidate(); }, 60000);
  window.refreshCultivationQuests = () => refresh(true);
  void refresh();
})();
