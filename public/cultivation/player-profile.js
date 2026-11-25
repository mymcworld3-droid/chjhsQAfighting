import './community-presentation.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, getDoc } from '../data-store.js';
import { realmForScore } from './artifact-catalog.js';
import './training-access-rules.js';
import { resolvePlayerAvatar } from './profile-avatar.js';

// Shared public-facing player card for ranking, friends and global chat.
// Fetch only the selected users/{uid} document; never render email, friend code,
// private profile fields, recipe knowledge or account controls.
(function () {
  'use strict';
  const MODAL_ID = 'xiuxian-player-profile';
  let requestToken = 0;
  let previousFocus = null;

  function esc(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  const number = (value) => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
  const fmt = (value) => Math.round(number(value)).toLocaleString('zh-TW');

  function safeImage(raw) {
    const url = typeof raw === 'string' ? raw.trim().slice(0, 2048) : '';
    if (/^https?:\/\/[^\s"'<>]+$/i.test(url)) return url;
    if (/^(?:assets\/|images\/|img\/)[a-z0-9/_\-.%]+$/i.test(url)) return url;
    return '';
  }

  // Public player cards expose only current character and learning data.
  // Old core/soul/artifact inventories are deliberately not projected.
  function projectProfile(uid, data, self = false) {
    const stats = data?.stats || {};
    const score = number(stats.totalScore);
    const answered = number(stats.totalAnswered);
    const correct = Math.min(answered, number(stats.totalCorrect));
    const realm = realmForScore(score)?.name || '凡人';
    const live = self ? window.getCombatStats?.() : null;
    const attack = number(live?.attack ?? stats.attack ?? 200);
    const maxHp = Math.max(1, number(live?.maxHp ?? (
      (Number(stats.maxHp) || 1000) + (window.QATrainingAccessRules?.hpBonus(data) || 0)
    )));
    return {
      uid, name: String(data?.displayName || '無名修士'),
      avatar: safeImage(resolvePlayerAvatar(data)),
      realm: realm === '真仙' ? '半仙' : realm,
      score, combat: { attack, maxHp },
      answered, correct,
      accuracy: answered ? (correct / answered * 100).toFixed(1) + '%' : '尚無紀錄'
    };
  }

  function profileMarkup(profile) {
    return '<div class="xpp-hero">' +
      '<div class="xpp-avatar"><img data-xpp-avatar alt="玩家頭像" hidden><i class="fa-solid fa-user"></i></div>' +
      '<div class="xpp-identity" data-qy-player><h2>' + globalThis.QACommunityPresentation.identityMarkup({name:profile.name}) +
      '</h2><p><span class="qy-realm-badge" data-qy-realm-kind="character">' + esc(profile.realm) + '</span> · 修為 ' + fmt(profile.score) + '</p></div></div>' +
      '<div class="xpp-stats"><div><span>答對率</span><b>' + esc(profile.accuracy) +
      '</b></div><div><span>累計答對</span><b>' + fmt(profile.correct) +
      '</b></div><div><span>累計答題</span><b>' + fmt(profile.answered) + '</b></div></div>' +
      '<section class="xpp-section"><h3>角色戰鬥數值</h3><div class="xpp-stats">' +
      '<div><span>攻擊力</span><b>' + fmt(profile.combat.attack) + '</b></div>' +
      '<div><span>生命上限</span><b>' + fmt(profile.combat.maxHp) + '</b></div>' +
      '</div></section>';
  }

  function close() {
    requestToken++;
    document.getElementById(MODAL_ID)?.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
  }

  function overlay() {
    document.getElementById(MODAL_ID)?.remove();
    const root = document.createElement('div');
    root.id = MODAL_ID;
    root.className = 'xpp-backdrop';
    root.innerHTML = '<div class="xpp-dialog" role="dialog" aria-modal="true" aria-label="修士資料">' +
      '<div class="xpp-header"><span>道友名錄 · 修士資料</span><button type="button" class="xpp-close" aria-label="關閉修士資料"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="xpp-body" aria-live="polite"><p class="xpp-loading">正在讀取修士資料…</p></div></div>';
    root.querySelector('.xpp-close').addEventListener('click', close);
    root.addEventListener('click', (event) => { if (event.target === root) close(); });
    document.body.appendChild(root);
    root.querySelector('.xpp-close')?.focus();
    return root;
  }

  async function openPlayerProfileByUid(uid) {
    // Firestore doc IDs cannot contain a slash; reject unknown/invalid identifiers.
    if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.includes('/')) return;
    previousFocus = document.activeElement?.closest?.('[data-xiuxian-profile]') || null;
    const token = ++requestToken;
    const root = overlay();
    const body = root.querySelector('.xpp-body');
    try {
      const user = getAuth(getApp()).currentUser;
      if (!user) throw new Error('請先登入才能查看修士資料。');
      const self = user.uid === uid;
      const snap = await getDoc(doc(getFirestore(getApp()), 'users', uid));
      if (token !== requestToken) return;
      if (!snap.exists()) { body.innerHTML = '<p class="xpp-loading">查無此修士或帳號已刪除。</p>'; return; }
      const profile = projectProfile(uid, snap.data(), self);
      body.innerHTML = profileMarkup(profile);
      if (!self) {
        const add = document.createElement('button');
        add.type = 'button'; add.className = 'friend-request-action';
        const alreadyFriend = window.getCurrentUserData?.()?.friends?.includes(uid);
        add.textContent = alreadyFriend ? '已是好友' : '邀請成為好友';
        add.disabled = Boolean(alreadyFriend);
        add.addEventListener('click', async () => {
          add.disabled = true;
          try {
            if (!window.QAFriendRequests) { add.textContent = '功能載入中，請稍後重試'; return; }
            if (await window.QAFriendRequests.send(uid)) add.textContent = '已發送好友邀請';
          } finally { add.disabled = false; }
        });
        body.appendChild(add);
      }
      const image = body.querySelector('[data-xpp-avatar]');
      if (image && profile.avatar) {
        image.onload = () => { image.hidden = false; image.nextElementSibling.hidden = true; };
        image.onerror = () => { image.hidden = true; image.nextElementSibling.hidden = false; };
        image.src = profile.avatar;
      }
    } catch (error) {
      if (token !== requestToken) return;
      console.warn('[Player profile] fetch failed:', error);
      body.innerHTML = '<p class="xpp-loading">無法讀取修士資料，請檢查網路或存取權限後重試。</p>';
    }
  }

  window.openPlayerProfileByUid = openPlayerProfileByUid;
  window.projectXiuxianPublicProfile = projectProfile;

  function boot() {
    if (!document.getElementById('xiuxian-player-profile-style')) {
      const link = document.createElement('link');
      link.id = 'xiuxian-player-profile-style';
      link.rel = 'stylesheet';
      link.href = 'styles/player-profile.css?v=20260921-profile1';
      document.head.appendChild(link);
    }
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-xiuxian-profile]');
      if (!button) return;
      event.preventDefault();
      void openPlayerProfileByUid(button.dataset.xiuxianProfile || '');
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && document.getElementById(MODAL_ID)) close();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
