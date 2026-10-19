import './first-visit-rules.js';
import './first-answer-guide.js';

// Welcome and account invitations load with the auth core, before optional modules.
(function () {
  'use strict';
  const KEY = 'qingyun:first-visit:v1';
  const QA = new URLSearchParams(location.search).get('qa') === '1';
  const Rules = window.QingyunFirstVisitRules;
  const $ = id => document.getElementById(id);
  let state;
  try { state = Rules.normalize(JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch (_) { state = Rules.normalize(); }
  let user = null, busy = false;
  const portraits = ['male', 'female'].map(g => `assets/story/characters/player-${g}-neutral.png`);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  function store(patch = {}) {
    state = Rules.normalize({ ...state, ...patch });
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
    document.body.classList.toggle('first-visit-active', state.stage === 'gender');
    document.body.dataset.firstVisitStage = state.stage;
  }
  function removeLayer() { $('first-visit-layer')?.remove(); }
  function panel(title, body, actions, { welcome = false } = {}) {
    removeLayer();
    const layer = document.createElement('section');
    layer.id = 'first-visit-layer';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-labelledby', 'first-visit-title');
    layer.className = welcome ? 'first-visit-welcome' : '';
    const card = `<small>青雲問道 · ${welcome ? '初入仙途' : '你的修行旅程'}</small><h2 id="first-visit-title">${title}</h2><div class="fv-copy">${body}</div><p class="fv-error" role="alert"></p><div class="fv-actions">${actions}</div>`;
    layer.innerHTML = `${welcome ? `<div class="fv-portraits" aria-label="兩位主角立繪">${portraits.map((src,i) => `<img src="${src}" alt="${i ? '女修主角' : '男修主角'}">`).join('')}</div>` : ''}<div class="fv-card">${card}</div>`;
    document.body.append(layer);
    requestAnimationFrame(() => layer.classList.add('is-visible'));
    layer.querySelector('button:not(:disabled),input')?.focus({ preventScroll: true });
    layer.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...layer.querySelectorAll('button:not(:disabled),input:not(:disabled)')];
      const first = controls[0], last = controls.at(-1);
      if (!first) return;
      if (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    });
    return layer;
  }
  function error(message) { const node = $('first-visit-layer')?.querySelector('.fv-error'); if (node) node.textContent = message; }
  async function action(task) {
    if (busy) return;
    busy = true;
    $('first-visit-layer')?.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try { await task(); }
    catch (e) { error(e?.message || '連線未完成，請再試一次。'); }
    finally {
      busy = false;
      $('first-visit-layer')?.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
  }
  function welcome() {
    const layer = panel('歡迎來到青雲問道！', '<p>歡迎踏上你的修行旅程。</p>',
      '<button type="button" id="fv-start">免註冊，開始答題</button><button type="button" id="fv-login" class="fv-secondary">已有帳號？直接登入</button>', { welcome: true });
    layer.querySelector('#fv-start').onclick = () => action(async () => {
      store({ stage: 'welcome', joining: false });
      try { await window.startFirstVisitGuest(); if ($('first-visit-layer') === layer) removeLayer(); }
      catch (e) { store({ stage: 'welcome' }); throw new Error('暫時無法開始免註冊答題，請再試一次。'); }
    });
    layer.querySelector('#fv-login').onclick = () => action(async () => {
      if (user?.isAnonymous) store({ joining: true });
      try { await window.googleLogin(); }
      catch (e) { store({ joining: false }); throw new Error('登入尚未完成，請再試一次。'); }
    });
  }
  function invite() {
    const layer = panel('保存你的修行', '<p>綁定 Google 帳號保存修行進度，或登入你的既有帳號。</p>', '<button type="button" id="fv-bind">綁定 Google 帳號／登入</button><button type="button" id="fv-cancel" class="fv-secondary">稍後再說</button>');
    layer.querySelector('#fv-cancel').onclick = () => { store({ stage: 'done', completed: true, joining: false }); removeLayer(); };
    layer.querySelector('#fv-bind').onclick = () => action(async () => {
      store({ joining: true });
      try { await window.googleLogin(); }
      catch (e) { store({ joining: false }); throw new Error('尚未完成登入；你的免註冊修行仍保留，請再試一次。'); }
    });
  }
  function gender() {
    const data = window.getCurrentUserData?.();
    const layer = panel('選擇性別', `<label class="fv-name">道號<input id="fv-name" maxlength="24" autocomplete="nickname" value="${escape(data?.displayName || '')}" placeholder="輸入你的道號"></label><div class="fv-genders">${['male','female'].map((g,i) => `<button type="button" class="fv-gender" data-gender="${g}"><img src="${portraits[i]}" alt="${i?'女修':'男修'}"><strong>${i?'女修 · 師妹':'男修 · 師弟'}</strong></button>`).join('')}</div><p>進入宗門後，可從仙道任務開啟「第一章 · 問道靈根」。</p>`, '');
    layer.querySelectorAll('[data-gender]').forEach(button => {
      button.onclick = () => action(() => finish(button.dataset.gender, $('fv-name').value.trim()));
    });
  }
  async function finish(selected = '', name = '') {
    if (!user || user.isAnonymous) throw new Error('請先完成帳號綁定或登入。');
    if (selected && !name) throw new Error('請先輸入你的道號。');
    await window.completeFirstVisitSetup?.(selected, name);
    store({ stage: 'done', completed: true, joining: false });
    removeLayer();
    window.switchToPage?.('page-home');
    $('bottom-nav')?.classList.remove('hidden');
    window.dispatchEvent(new CustomEvent('xiuxian:arrival-completed'));
  }
  window.isFirstVisitActive = () => !QA && state.stage === 'gender';
  window.getFirstVisitState = () => ({ ...state });
  window.handleFirstVisitSignedOut = () => {
    user = null;
    window.cancelFirstAnswerGuide?.();
    removeLayer();
    document.body.classList.remove('first-visit-active');
    if (state.completed || QA) return false;
    store({ stage: 'welcome', joining: false }); welcome(); return true;
  };
  window.handleFirstVisitReady = async (person, data, firstLogin = false) => {
    user = person;
    removeLayer();
    const next = Rules.readyStage(state, person, data, firstLogin);
    store({ stage: next, completed: next === 'done', joining: false });
    window.scheduleFirstAnswerGuide?.(person.uid, firstLogin);
    if (next === 'gender') { gender(); return true; }
    $('bottom-nav')?.classList.remove('hidden');
    return false;
  };
  window.openFirstVisitAccountBinding = () => {
    if (!user?.isAnonymous) return false;
    store({ stage: 'invite', completed: true }); invite(); return true;
  };
})();
