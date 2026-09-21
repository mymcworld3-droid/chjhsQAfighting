import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { ARTIFACT_EQUIP_SLOTS, getArtifactById, realmForScore } from './artifact-catalog.js';

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

  const PERCENT_EFFECTS = new Set([
    'equip_attack_percent', 'equip_hp_percent', 'equip_damage_percent',
    'equip_damage_reduction_percent', 'equip_crit_chance', 'equip_crit_damage_percent',
    'equip_combo_chance', 'equip_lifesteal_percent', 'equip_reflect_percent',
    'equip_low_hp_damage_percent', 'equip_low_hp_reduction_percent',
    'equip_first_hit_reduction_percent', 'equip_damage_cap_percent'
  ]);
  const EFFECT_NAMES = Object.freeze({
    equip_attack_flat:'攻擊', equip_attack_percent:'攻擊',
    equip_hp_flat:'生命', equip_hp_percent:'生命',
    equip_damage_percent:'增傷', equip_damage_reduction_flat:'固定減傷',
    equip_damage_reduction_percent:'減傷', equip_crit_chance:'暴擊率',
    equip_crit_damage_percent:'暴傷', equip_combo_chance:'連擊率',
    equip_lifesteal_percent:'吸血', equip_reflect_percent:'反傷',
    equip_shield_flat:'護盾', equip_true_damage_flat:'真實傷害',
    equip_low_hp_damage_percent:'低血量增傷', equip_low_hp_reduction_percent:'低血量減傷',
    equip_first_hit_reduction_percent:'首次受傷減傷',
    equip_damage_cap_percent:'單次傷害上限',
    equip_on_correct_shield_flat:'答對護盾',
    equip_cheat_death:'免死一次', equip_copy_enemy_artifact:'複製敵方法寶'
  });

  function equippedCore(data, self) {
    const runtime = self ? window.getEquippedGoldenCoreState?.() : null;
    const remote = data?.cultivationTraining || {};
    const raw = runtime || remote.equippedCore ||
      (remote.equipped === true ? remote.core : null);
    if (number(data?.stats?.totalScore) < 28 || !raw?.type) return null;
    return window.getGoldenCorePublicDetails?.(raw) ||
      { type: raw.type, name: '本命金丹', grade: Math.min(9, Math.max(1, number(raw.grade) || 9)), effect: '' };
  }

  function equippedArtifact(data, slot) {
    const id = String(data?.artifactSystem?.equipped?.[slot] || '');
    if (!id || number(data?.artifactSystem?.inventory?.[id]) < 1) return null;
    const item = getArtifactById(id);
    if (!item || !Array.isArray(item.effects) || !item.effects.some((effect) => String(effect?.type || '').startsWith('equip_'))) return null;
    const assigned = ARTIFACT_EQUIP_SLOTS.includes(item.equipSlot) ? item.equipSlot : '輔助法寶';
    if (assigned !== slot) return null;
    return item;
  }

  function effectLabel(effect) {
    const type = String(effect?.type || '');
    const name = EFFECT_NAMES[type];
    if (!name) return '';
    if (type === 'equip_cheat_death' || type === 'equip_copy_enemy_artifact') return name;
    const value = number(effect.value);
    return name + ' ' + (type === 'equip_damage_cap_percent' ? '' : '+') +
      (PERCENT_EFFECTS.has(type) ? (value * 100).toLocaleString('zh-TW', { maximumFractionDigits: 1 }) + '%' : fmt(value));
  }

  // Exposed pure projection for regression tests and other public profile entry points.
  function projectProfile(uid, data, self = false) {
    const stats = data?.stats || {};
    const score = number(stats.totalScore);
    const core = equippedCore(data, self);
    const power = window.calculateCombatPower?.({
      stats: { attack: stats.attack ?? 200, maxHp: stats.maxHp ?? 1000 },
      core, equipped: data?.artifactSystem?.equipped || {},
      inventory: data?.artifactSystem?.inventory || {}
    }) || { total: 0, base: 0, core: 0, equipment: 0, items: [] };
    const answered = number(stats.totalAnswered);
    const correct = Math.min(answered, number(stats.totalCorrect));
    const realm = realmForScore(score)?.name || '凡人';
    const slots = ARTIFACT_EQUIP_SLOTS.map(slot => ({ slot, item: equippedArtifact(data, slot) }));
    return {
      uid, name: String(data?.displayName || '無名修士'), avatar: safeImage(data?.equipped?.avatar),
      // A high enough score alone does not award the top-five True Immortal title.
      realm: realm === '真仙' ? '登仙' : realm, score, power, core, slots,
      answered, correct, accuracy: answered ? (correct / answered * 100).toFixed(1) + '%' : '尚無紀錄'
    };
  }

  function profileMarkup(profile) {
    const core = profile.core;
    const slots = profile.slots.map(({slot,item}) => {
      const power = item ? Math.max(0, Number(window.calculateArtifactPower?.(item)) || 0) : 0;
      const effects = item?.effects?.map(effectLabel).filter(Boolean).slice(0, 5) || [];
      return '<article class="xpp-equip"><span>' + esc(slot) + '</span>' +
        (item ? '<strong>' + esc(item.name) + '</strong><small>' + esc(item.realm) +
          ' · 戰力 +' + fmt(power) + '</small>' +
          (effects.length ? '<p>' + effects.map(esc).join(' · ') + '</p>' : '') :
          '<strong class="xpp-empty">尚未裝備</strong>') + '</article>';
    }).join('');
    return '<div class="xpp-hero">' +
      '<div class="xpp-avatar"><img data-xpp-avatar alt="玩家頭像" hidden><i class="fa-solid fa-user"></i></div>' +
      '<div class="xpp-identity"><span>修士資料 · PLAYER PROFILE</span><h2>' + esc(profile.name) +
      '</h2><p>' + esc(profile.realm) + ' · 修為 ' + fmt(profile.score) + '</p></div></div>' +
      '<div class="xpp-power"><span>綜合戰力</span><strong>' + fmt(profile.power.total) +
      '</strong><small>基礎 ' + fmt(profile.power.base) + ' ／ 金丹 ' + fmt(profile.power.core) +
      ' ／ 裝備 ' + fmt(profile.power.equipment) + '</small></div>' +
      '<div class="xpp-stats"><div><span>答對率</span><b>' + esc(profile.accuracy) +
      '</b></div><div><span>累計答對</span><b>' + fmt(profile.correct) +
      '</b></div><div><span>累計答題</span><b>' + fmt(profile.answered) + '</b></div></div>' +
      '<section class="xpp-section"><h3>本命金丹</h3>' +
      (core ? '<div class="xpp-core"><div><strong>' + esc(core.name) + '</strong><b>' +
        fmt(core.grade) + ' 品 · 戰力 +' + fmt(profile.power.core) + '</b></div>' +
        (core.effect ? '<p>' + esc(core.effect) + '</p>' : '') + '</div>' :
        '<p class="xpp-note">目前沒有調御中的本命金丹。</p>') + '</section>' +
      '<section class="xpp-section"><h3>已裝備法寶</h3><div class="xpp-equipment">' +
      slots + '</div></section>' +
      '<p class="xpp-footnote">顯示該修士已保存的公開戰鬥資料；戰力為綜合評分，不直接增加鬥法傷害。</p>';
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
