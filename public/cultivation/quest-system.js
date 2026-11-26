import './weapon-presentation.js';
import './community-presentation.js';
import './daily-meditation-rewards.js';
import './quest-rules.js';
import './quest-path-journey.js';
import './realm-icons.js';
import { authenticatedMainFetch, getMainUser } from './data/project-repository.js';

(function () {
  'use strict';
  let snapshot = null, account = '', tab = 'daily', busy = false, dirty = true, timer = null, revision = 0, applyingReward = false, loadError = '';
  let selectedStage = null, previousActiveStage = null;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pathVisible = () => !!$('page-path')?.classList.contains('active-page');
  const visible = () => $('page-home')?.classList.contains('active-page') || pathVisible();
  const materialNames = { 'raid-refine-key-ii': '淬靈玄印', 'raid-refine-key-iii': '玄天道印' };
  function rewardText(reward) {
    const parts = [];
    if (reward.gold) parts.push(`${reward.gold} 靈石`);
    if (reward.cultivation) parts.push(`${reward.cultivation} 修為`);
    if (reward.drawTickets) parts.push(`本命法器抽獎券 ×${reward.drawTickets}`);
    Object.entries(reward.materials || {}).forEach(([id, count]) => parts.push(`${materialNames[id] || id} ×${count}`));
    return parts.join(' · ');
  }
  function rewardMarkup(reward) {
    return globalThis.QARewardPresentation.renderList(reward,{variant:'general',preview:true});
  }
  function status(message, reward=null, suffix='', rewardState='') {
    for (const id of ['quest-status', 'quest-spotlight-status']) if ($(id)) $(id).textContent = message;
    const receipt=$('quest-reward-receipt');
    if(receipt){
      receipt.innerHTML=(rewardState?globalThis.QARewardPresentation.renderStatus(rewardState):'')+(reward?globalThis.QARewardPresentation.renderList(reward,{variant:'general'}):'');
      receipt.hidden=!receipt.innerHTML;
    }
    // A home claim stays on the home screen: inline receipt, no extra dialog.
    const home=$('quest-spotlight-status');
    if(home&&reward){
      const cards=globalThis.QARewardPresentation.renderFeedback(reward);
      if(cards)home.innerHTML='已獲得 '+cards+esc(suffix||'。');
    }
  }
  // Reuse the existing snapshot. Rendering the home card never requests data.
  function recommendedQuest() {
    if (!snapshot || account !== getMainUser()?.uid) return null;
    const candidates = [];
    const add = (quests, kind) => (quests || []).forEach(q => {
      if (q && !q.claimed && !q.locked) candidates.push({ q, kind });
    });
    add([snapshot.path, ...(snapshot.pathTicketRewards || [])], 'path');
    if (snapshot.date === window.XianxiaQuestRules.dateKey()) {
      add(snapshot.daily, 'daily'); add(snapshot.commissions, 'commission');
    }
    if (snapshot.weeklyKey === window.XianxiaQuestRules.weekKey()) add(snapshot.weekly, 'weekly');
    const ready = candidates.find(({ q }) => q.claimable);
    if (ready) return ready;
    const ratio = q => Math.min(1, Math.max(0, Number(q.current) || 0) / Math.max(1, Number(q.target) || 1));
    return candidates.sort((a, b) => ratio(b.q) - ratio(a.q))[0] || null;
  }
  // 主頁左側只呈現今日實際任務；仙道由獨立入口開啟。
  function recommendedDailyQuest() {
    if (!snapshot || account !== getMainUser()?.uid ||
        snapshot.date !== window.XianxiaQuestRules.dateKey()) return null;
    const rows = [
      ...(snapshot.daily || []).map(q => ({ q, kind: 'daily' })),
      ...(snapshot.commissions || []).map(q => ({ q, kind: 'commission' }))
    ];
    const available = rows.filter(({q}) => q && !q.claimed && !q.locked);
    return available.find(({q}) => q.claimable) ||
      available.sort((a,b) => Math.min(1,Number(b.q.current||0)/Math.max(1,Number(b.q.target||1))) -
                              Math.min(1,Number(a.q.current||0)/Math.max(1,Number(a.q.target||1))))[0] || null;
  }
  function renderSpotlight() {
    const slot = $('quest-spotlight-slot'), button = $('quest-spotlight');
    if (!slot || !button) return;
    slot.hidden = !getMainUser()?.uid;
    const item = recommendedDailyQuest(), q = item?.q;
    const current = account === getMainUser()?.uid ? snapshot : null;
    const ready = !!q?.claimable;
    const labels = { scope: '設定範圍', solo: '繼續問道', meditation: '開始閉關',
      enlightenment: '悟道試煉', battle: '前往鬥法', dongtian: '前往洞天',
      story: '觀看劇情' };
    const action = ready ? (q.supplemental ? '補領抽獎券' : '領取獎勵') : labels[q?.destination] || '查看任務';
    const title = q?.title || (current?.date === window.XianxiaQuestRules.dateKey() ? '今日任務皆已完成' : busy ? '正在同步今日任務…' : '查看今日任務');
    const reward = q ? [q.reward.drawTickets ? `抽獎券 ×${q.reward.drawTickets}` : '',
      rewardText({ ...q.reward, drawTickets: 0 })].filter(Boolean).join(' · ') : '查看完整任務與獎勵';
    const progressLabel = { solo: '答對', score: '修為', battle: '鬥法', raid: '通關',
      meditation: '閉關', dongtian: '洞天', correction: '訂正', activity: '活動' }[q?.metric] || '進度';
    $('quest-spotlight-kind').textContent = ready ? '獎勵可領' : ({ path: '仙道任務', daily: '日常任務', commission: '宗門委託', weekly: '每週任務' }[item?.kind] || '修行任務');
    $('quest-spotlight-title').textContent = title;
    $('quest-spotlight-progress').textContent = q ? (ready ? '✓ 已完成' : `${progressLabel} ${q.current}／${q.target}`) : '';
    $('quest-spotlight-reward').textContent = reward;
    $('quest-spotlight-reward').title = reward;
    $('quest-spotlight-action').textContent = busy ? '同步中…' : `${action} →`;
    button.disabled = busy;
    button.classList.toggle('quest-spotlight-ready', ready);
    button.setAttribute('aria-label', `${title}${q ? `，進度 ${q.current}／${q.target}` : ''}，${reward}，${action}`);
  }
  function syncQuestIndicator() {
    const ready = q => q?.claimable && !q.claimed && !q.locked;
    const current = account === getMainUser()?.uid ? snapshot : null;
    const pathReady = !!current && (!!ready(current.path) || !!current.pathTicketRewards?.some(ready));
    const dailyReady = !!current && current.date === window.XianxiaQuestRules.dateKey() &&
      [...current.daily,...(current.commissions||[])].some(ready);
    const weeklyReady = !!current && current.weeklyKey === window.XianxiaQuestRules.weekKey()
      && (current.weekly||[]).some(ready);
    const available = dailyReady || weeklyReady;
    if ($('quest-ready-dot')) $('quest-ready-dot').hidden = !available;
    if ($('home-path-ready-dot')) $('home-path-ready-dot').hidden = !pathReady;
    document.querySelector?.('[data-home-action="path"]')?.setAttribute('aria-label', pathReady ? '仙道，有獎勵可領取' : '仙道');
    document.querySelector?.('[data-home-action="quest"]')?.setAttribute('aria-label', available ? '任務，有獎勵可領取' : '任務');
    for (const [key, pending] of [['path', pathReady], ['daily', dailyReady], ['weekly', weeklyReady]]) {
      if ($('quest-' + key + '-dot')) $('quest-' + key + '-dot').hidden = !pending;
      const button = $('quest-tab-' + key);
      if (pending) button?.setAttribute('aria-description', '有任務獎勵可領取');
      else button?.removeAttribute('aria-description');
    }
    $('quest-open')?.setAttribute('aria-label', available ? '任務，有獎勵可領取' : '任務');
  }
  function card(q, kind) {
    const label = q.claimed ? '已領取' : q.locked ? '尚未解鎖' : q.supplemental ? '補領抽獎券' : q.claimable ? '領取獎勵' : q.metric === 'story' ? '觀看劇情' : '前往修行';
    return `<article class="quest-card ${kind === 'path' ? 'quest-path-card' : ''} ${q.claimable ? 'quest-ready' : ''} ${q.claimed ? 'quest-claimed' : ''}">
      <div class="quest-card-heading"><h4>${esc(q.title)}</h4>${globalThis.QACommunityPresentation.statusMarkup(q.claimed?'complete':q.claimable?'pending':'active',q.claimed?'已完成':q.claimable?'待領獎':'進行中')}</div>
      <p>${esc(q.description)}</p>
      <div class="quest-progress-label"><span>${q.locked ? `需 ${q.minScore} 修為 · 先繼續問道修行` : '任務進度'}</span><b>${q.current} / ${q.target}</b></div>
      <div class="quest-progress" data-qy-progress="linear" role="progressbar" aria-label="${esc(q.title)}" aria-valuemin="0" aria-valuemax="${q.target}" aria-valuenow="${q.current}"><i style="width:${Math.round(q.current / q.target * 100)}%"></i></div>
      <div class="quest-reward"><i class="fa-solid fa-gift" aria-hidden="true"></i> ${globalThis.QARewardPresentation.renderStatus(q.claimed?'claimed':q.claimable?'pending':'obtainable')} ${rewardMarkup(q.reward)}</div>
      <button type="button" data-quest-id="${esc(q.id)}" data-quest-kind="${kind}" ${busy || q.claimed || q.locked ? 'disabled' : ''} class="quest-action ${q.claimable ? 'quest-claim' : ''}">${busy ? '正在同步…' : label}</button>
    </article>`;
  }
  function pathMarkup(s) {
    const {groups,activeId}=globalThis.QAPathJourney.journey(s,window.XianxiaQuestRules.PATH);
    if(!groups.some(g=>g.id===selectedStage)||selectedStage===previousActiveStage) selectedStage=activeId;
    previousActiveStage=activeId;
    const group=groups.find(g=>g.id===selectedStage);
    const badge=(g,large=false)=>`<span class="path-emblem${large?' path-emblem-large':''}" aria-hidden="true">${window.getRealmIconMarkup(g.realmIcon)}</span>`;
    const supplemental=(s.pathTicketRewards||[]).map(q=>card(q,'path')).join('');
    if(!group)return '<p class="quest-empty">仙道任務已全部完成。</p>'+supplemental;
    const state=g=>g.done?'done':g.id===activeId?'current':'future';
    const player=window.getCurrentUserData?.();
    const score=Number(player?.stats?.totalScore)||0;
    const accessScore=window.getTrainingAccessScore?.()??score;
    const modes=globalThis.QAPathJourney.unlocks(group.id,{score,accessScore});
    const unlockMarkup=modes.length?modes.map(m=>`<div class="path-unlock-item${m.unlocked?' is-unlocked':' is-locked'}"><i class="fa-solid fa-${m.icon}" aria-hidden="true"></i><span>${esc(m.name)}</span><small>${m.unlocked?'已開放':'未解鎖'}</small></div>`).join(''):'<p class="path-unlock-empty">此境界暫無新增玩法</p>';
    const rail=[...groups].reverse().map(g=>`<button type="button" class="path-stage-node is-${state(g)}" data-path-stage="${esc(g.id)}" aria-pressed="${g.id===selectedStage}" aria-label="${esc(g.name)}，${g.claimed}/${g.rows.length} 項已領取">${badge(g)}<span>${esc(g.name)}</span></button>`).join('');
    const rows=group.rows.map(q=>{
      const locked=q.locked||q.sequenceLocked;
      const label=q.claimed?'已領取':locked?'尚未開啟':q.claimable?'領取獎勵':q.metric==='story'?'觀看劇情':'前往修行';
      const progress=Math.min(100,Math.max(0,Math.round(Number(q.current)/Math.max(1,Number(q.target))*100)));
      return `<article class="path-task${q.claimed?' is-done':q.claimable?' is-ready':locked?' is-locked':''}">
        <div class="path-task-copy"><h4>${esc(q.title)}</h4><p>${esc(q.description)}</p>
        <div class="path-task-progress"><span class="path-task-track" role="progressbar" aria-label="${esc(q.title)}" aria-valuemin="0" aria-valuemax="${q.target}" aria-valuenow="${q.current}"><i style="width:${progress}%"></i></span><small>${q.current} / ${q.target}</small></div>
        <div class="path-task-rewards">${rewardMarkup(q.reward)}</div></div>
        <button class="path-task-action${q.claimable?' is-claim':''}" type="button" data-quest-kind="path" data-quest-id="${esc(q.id)}" ${busy||q.claimed||locked?'disabled':''}>${q.claimed?'<i class="fa-solid fa-check" aria-hidden="true"></i> ':locked?'<i class="fa-solid fa-lock" aria-hidden="true"></i> ':''}${label}</button></article>`;
    }).join('');
    return `<div class="path-journey"><nav class="path-stage-rail" aria-label="仙道境界進程">${rail}</nav>
      <div class="path-stage-detail">
      <section class="path-stage-summary" aria-label="${esc(group.name)}階段">
        <div class="path-stage-aura" aria-hidden="true"></div>${badge(group,true)}
        <h2>${esc(group.name)}</h2><span class="path-stage-status is-${state(group)}">${group.done?'此階段已完成':group.id===activeId?'當前仙道階段':'後續仙道階段'}</span>
        <div class="path-unlocks"><h3>此境界解鎖玩法</h3><div class="path-unlock-grid">${unlockMarkup}</div></div>
      </section>
      <section class="path-stage-tasks" aria-label="階段任務"><header><h3>${esc(group.name)} · 修行任務</h3><small>${s.pathCompleted??s.pathIndex} / ${s.pathTotal} 全程進度</small></header>${rows}
        ${supplemental?'<h3 class="path-supplement-heading">可補領獎勵</h3>'+supplemental:''}
      </section></div></div>`;
  }
  function render() {
    syncQuestIndicator();
    renderSpotlight();
    if (!$('quest-content')) return;
    ['path', 'daily', 'weekly'].forEach(key => {
      const button = $('quest-tab-' + key);
      button.setAttribute('aria-selected', String(tab === key));
      button.tabIndex = tab === key ? 0 : -1;
    });
    $('quest-content').setAttribute('aria-labelledby', 'quest-tab-' + tab);
    $('quest-refresh').disabled = busy;
    $('quest-content').classList.toggle('quest-path-layout',tab === 'path');
    if (!snapshot) {
      $('quest-content').innerHTML = '<p class="quest-empty" data-qy-state="'+(busy?'loading':loadError?'error':'empty')+'">'+(busy?'正在讀取修行任務…':loadError?'任務同步未完成，請按「重新同步」重試。':'尚未同步修行任務，請按「重新同步」。')+'</p>';
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
      ? '仙道任務依序開啟，領獎後接續下一項。'
      : tab === 'weekly'
        ? `本週 ${snapshot.weeklyKey} 起（台灣時間週一 00:00 重置）· 7 天累積，不需要天天登入。請於週末前領取已完成獎勵。`
        : `今日 ${snapshot.date} · 原有日常任務與隨機宗門委託；台灣時間每日 00:00 重置。`;
    const content = $('quest-content');
    content.classList.toggle('quest-daily-grid', tab === 'daily' || tab === 'weekly');
    const oldRail=content.querySelector('.path-stage-rail'),oldTasks=content.querySelector('.path-stage-tasks');
    const oldJourney=content.querySelector('.path-journey');
    const sharedScroll=oldJourney?.scrollTop;
    const oldSelected=oldJourney?.querySelector('[data-path-stage][aria-pressed="true"]')?.dataset.pathStage;
    const railScroll=oldRail?.scrollTop,taskScroll=oldTasks?.scrollTop;
    content.innerHTML = tab === 'path' ? pathMarkup(snapshot) : tab === 'daily' ?
      '<div class="quest-commission-heading"><i class="fa-solid fa-scroll"></i><b>今日宗門委託</b><small>每日隨機兩項 · 額外獎勵 · 不影響原日常</small></div>' +
      (snapshot.commissions||[]).map(q => card(q,'commission')).join('') +
      '<div class="quest-commission-heading"><i class="fa-solid fa-calendar-check"></i><b>原有日常任務</b></div>' +
      snapshot.daily.map(q => card(q, 'daily')).join('')
      : tab === 'weekly' ? (snapshot.weekly||[]).map(q => card(q,'weekly')).join('')
      : '';
    if(tab==='path'){
      const rail=content.querySelector('.path-stage-rail'),tasks=content.querySelector('.path-stage-tasks');
      const journey=content.querySelector('.path-journey');
      if(journey&&getComputedStyle(journey).overflowY==='auto'){
        const detail=journey.querySelector('.path-stage-detail');
        const node=rail?.querySelector('[aria-pressed="true"]');
        if(oldSelected===selectedStage&&sharedScroll!=null)journey.scrollTop=sharedScroll;
        else if(node&&detail&&detail.offsetHeight<=journey.clientHeight){
          journey.scrollTop=node.getBoundingClientRect().top-journey.getBoundingClientRect().top+journey.scrollTop-(journey.clientHeight-node.offsetHeight)/2;
        }else journey.scrollTop=0;
      }else if(rail){
        if(railScroll!=null&&oldSelected===selectedStage)rail.scrollTop=railScroll;
        else {const node=rail.querySelector('[aria-pressed="true"]');if(node)rail.scrollTop=node.offsetTop-rail.offsetTop-(rail.clientHeight-node.offsetHeight)/2;}
      }
      if(tasks&&oldSelected===selectedStage&&taskScroll!=null)tasks.scrollTop=taskScroll;
    }
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
    if (uid !== account) { account = uid; snapshot = null; selectedStage=null; previousActiveStage=null; loadError = ''; dirty = true; status(''); render(); }
    return uid;
  }
  async function refresh(force = false) {
    const uid = reconcileAccount();
    if (!uid || busy || (!force && (!dirty || !visible()))) return;
    const startedRevision = revision;
    busy = true; loadError = ''; dirty = false; render();
    try {
      const result = await request('/api/quests');
      if (getMainUser()?.uid !== uid) return;
      snapshot = result.quests;
      status('');
    } catch (e) {
      dirty = true;
      if (getMainUser()?.uid === uid) { loadError = e.message || '同步失敗'; status(`${e.message}，可按「重新同步」重試。`); }
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
    busy = true; render(); status('正在領取獎勵…',null,'','settling');
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
      const suffix=kind === 'path' && !q.supplemental && snapshot.path ? '，下一個仙道任務已開啟。' : '。';
      status(result.awarded ? '已獲得 '+rewardText(result.reward)+suffix : '此任務已領取過，進度已同步。',
        result.awarded?result.reward:null,suffix,'claimed');
      if (result.awarded) {
        const period=kind==='weekly'?snapshot.weeklyKey:kind==='path'?'path':snapshot.date;
        const presentation=globalThis.QARewardPresentation;
        const options={uid,receiptId:JSON.stringify(['quest',kind,q.id,period,!!q.supplemental]),reward:result.reward,important:false,isCurrent:()=>getMainUser()?.uid===uid};
        const host=($('quest-dialog')?.open||pathVisible())?$('quest-reward-receipt'):null;
        if(!presentation.animateInline(host,options))presentation.celebrate(options);
      }
    } catch (e) {
      if (getMainUser()?.uid === uid) { status(`${e.message}，請重新同步後重試。`,null,'','unconfirmed'); dirty = true; }
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
      dongtian: () => { window.openDongtianPanel?.(); },
      story: () => {
        const opened = window.openXiuxianStoryChapter?.(q.chapterId);
        if (!opened) status('劇情暫時無法開啟，請先結束目前的戰鬥或其他彈窗，再按「觀看劇情」。');
      }
    };
    actions[destination]?.();
  }
  function mount() {
    if ($('quest-panel')) return;
    const entry = $('quest-open');
    if (!entry) return;
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/styles/quest-system.css?v=20261126-path-shared-scroll'; document.head.append(link);
    const dialog = document.createElement('dialog'); dialog.id = 'quest-dialog'; dialog.className = 'quest-dialog'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'quest-title');
    const panel = document.createElement('section'); panel.id = 'quest-panel'; panel.className = 'quest-panel'; panel.setAttribute('aria-label', '修行任務');
    panel.innerHTML = `<header class="quest-heading"><div><small id="quest-heading-kicker">宗門手札</small><h3 id="quest-title">修行任務</h3></div><div class="quest-heading-actions"><button type="button" id="quest-refresh" aria-label="重新同步任務">重新同步</button><button type="button" id="quest-close" aria-label="關閉任務">✕</button></div></header>
      <div class="quest-tabs" role="tablist" aria-label="任務類別"><button id="quest-tab-path" type="button" role="tab" aria-controls="quest-content" aria-selected="false" tabindex="-1" hidden>仙道 <span id="quest-path-count"></span><span id="quest-path-dot" class="quest-tab-dot" hidden aria-hidden="true"></span></button><button id="quest-tab-daily" type="button" role="tab" aria-controls="quest-content" aria-selected="true">日常 <span id="quest-daily-count"></span><span id="quest-daily-dot" class="quest-tab-dot" hidden aria-hidden="true"></span></button><button id="quest-tab-weekly" type="button" role="tab" aria-controls="quest-content" aria-selected="false" tabindex="-1">每週 <span id="quest-weekly-count"></span><span id="quest-weekly-dot" class="quest-tab-dot" hidden aria-hidden="true"></span></button></div>
      <div class="quest-scroll" tabindex="0" role="region" aria-label="任務清單，可捲動"><button type="button" id="quest-atlas-open" class="quest-atlas-open" hidden><i class="fa-solid fa-book-open" aria-hidden="true"></i> 境界圖錄</button><p id="quest-note" class="quest-note"></p><div id="quest-content" role="tabpanel" aria-labelledby="quest-tab-daily"></div><p id="quest-status" role="status" aria-live="polite"></p><div id="quest-reward-receipt" hidden></div></div>`;
    dialog.append(panel); document.body.append(dialog);
    const pathEntry = document.querySelector('[data-home-action="path"]');
    const taskEntry = document.querySelector('[data-home-action="quest"]');
    const pathPage = $('page-path');
    let pathMode = false;
    function updateExpanded() {
      entry.setAttribute('aria-expanded', String(dialog.open && !pathMode));
      taskEntry?.setAttribute('aria-expanded', String(dialog.open && !pathMode));
      pathEntry?.setAttribute('aria-current', pathVisible() ? 'page' : 'false');
    }
    function openView(mode) {
      pathMode = mode === 'path';
      tab = pathMode ? 'path' : 'daily';
      if(pathMode){
        if(dialog.open)dialog.close();
        pathPage?.append(panel);
        window.switchToPage?.('page-path');
      }else{
        dialog.append(panel);
      }
      selectedStage=null;previousActiveStage=null;
      $('quest-title').textContent = pathMode ? '仙道' : '修行任務';
      $('quest-heading-kicker').textContent = pathMode ? '仙途修行' : '宗門手札';
      panel.setAttribute('aria-label', pathMode ? '仙道任務' : '修行任務');
      $('quest-tab-path').hidden = !pathMode;
      $('quest-tab-daily').hidden = pathMode;
      $('quest-tab-weekly').hidden = pathMode;
      $('quest-atlas-open').hidden = !pathMode;
      if (!pathMode && !dialog.open) dialog.showModal();
      updateExpanded();
      panel.querySelector('.quest-scroll').scrollTop = 0;
      reconcileAccount(); render(); void refresh(true);
    }
    entry.addEventListener('click', () => openView('tasks'));
    window.openCultivationPathQuests = () => openView('path');
    function exitView(){
      if(pathVisible())window.switchToPage?.('page-home');
      else if(dialog.open)dialog.close();
    }
    $('quest-atlas-open').addEventListener('click', () => {
      exitView();
      $('xiuxian-path')?.click();
    });
    $('quest-spotlight')?.addEventListener('click', () => {
      if (busy || !reconcileAccount()) return;
      const item = recommendedDailyQuest();
      if (!item) { entry.click(); return; }
      status('');
      if (item.q.claimable) void claim(item.q, item.kind);
      else go(item.q.destination, item.q);
    });
    $('quest-close').addEventListener('click', exitView);
    dialog.addEventListener('close', updateExpanded);
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    const selectTab = key => {
      if (pathMode ? key !== 'path' : key === 'path') return;
      tab = key; render(); panel.querySelector('.quest-scroll').scrollTop = 0; void refresh();
    };
    ['path', 'daily', 'weekly'].forEach(key => $('quest-tab-' + key).addEventListener('click', () => selectTab(key)));
    panel.querySelector('.quest-tabs').addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const tabs=pathMode?['path']:['daily','weekly'],index=tabs.indexOf(tab);
      e.preventDefault(); selectTab(e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs.at(-1)
        : tabs[(index+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length]);
      $('quest-tab-' + tab).focus();
    });
    $('quest-refresh').addEventListener('click', () => { void refresh(true); });
    $('quest-content').addEventListener('click', e => {
      const stage=e.target.closest('[data-path-stage]');
      if(stage&&tab==='path'&&snapshot){selectedStage=stage.dataset.pathStage;render();$('quest-content').querySelector('[data-path-stage][aria-pressed="true"]')?.focus({preventScroll:true});return;}
      const b = e.target.closest('[data-quest-id]');
      if (!b || b.disabled || busy || !snapshot) return;
      const kind = b.dataset.questKind;
      const q = kind === 'path' ? [snapshot.path, ...(snapshot.pathTicketRewards || [])].find(q => q?.id === b.dataset.questId)
        : kind === 'commission' ? (snapshot.commissions||[]).find(q=>q.id===b.dataset.questId)
        : kind === 'weekly' ? (snapshot.weekly||[]).find(q=>q.id===b.dataset.questId)
        : snapshot.daily.find(q => q.id === b.dataset.questId);
      if (!q || q.id !== b.dataset.questId || q.claimed || q.locked) return;
      if (q.claimable) void claim(q, kind); else { exitView(); go(q.destination, q); }
    });
    const navigationObserver = new MutationObserver(() => {
      updateExpanded();
      if (visible()) { reconcileAccount(); void refresh(); }
      if (!$('page-home')?.classList.contains('active-page') && dialog.open) dialog.close();
    });
    for(const page of [$('page-home'),pathPage])if(page)navigationObserver.observe(page,{attributes:true,attributeFilter:['class']});
    render();
  }
  mount();
  ['xiuxian:user-data-ready', 'xiuxian:user-ready', 'xiuxian:quest-progress-updated', 'xiuxian:enlightenment-updated', 'xiuxian:story-chapter-completed'].forEach(name => window.addEventListener(name, invalidate));
  window.addEventListener('material-system-updated', e => { if (!e.detail?.questReward) invalidate(); });
  window.addEventListener('xiuxian:stats-updated', e => { if (!applyingReward && e.detail?.source !== 'quest-reward') invalidate(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) invalidate(); });
  // Only invalidate at a date change, without periodic API polling.
  setInterval(() => { if (snapshot && (snapshot.date !== window.XianxiaQuestRules.dateKey() ||
      snapshot.weeklyKey !== window.XianxiaQuestRules.weekKey())) invalidate(); }, 60000);
  window.refreshCultivationQuests = () => refresh(true);
  void refresh();
})();
