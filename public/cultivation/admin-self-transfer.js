import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

(function () {
  'use strict';

  const PANEL_ID = 'admin-self-transfer-panel';
  const DEFAULT_AMOUNT = 1000;
  const MAX_AMOUNT = 10000000;
  let busy = false;

  function currentData() {
    try {
      return window.getCurrentUserData?.() || null;
    } catch (_) {
      return null;
    }
  }

  function isAdmin() {
    return currentData()?.isAdmin === true;
  }

  function toast(message, ok = true) {
    const old = document.getElementById('admin-self-transfer-toast');
    old?.remove();
    const el = document.createElement('div');
    el.id = 'admin-self-transfer-toast';
    el.textContent = message;
    el.style.cssText = `position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:9999;padding:10px 16px;border-radius:999px;background:rgba(8,8,8,.96);border:1px solid ${ok ? 'rgba(216,177,93,.55)' : 'rgba(239,68,68,.6)'};color:${ok ? '#f5dfaa' : '#fecaca'};font-size:12px;font-weight:800;box-shadow:0 12px 32px rgba(0,0,0,.45);pointer-events:none`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function normalizeAmount(value) {
    const amount = Math.floor(Number(value));
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    return Math.min(amount, MAX_AMOUNT);
  }

  async function transferToSelf(amount, button, status) {
    if (busy) return;

    const data = currentData();
    const auth = getAuth(getApp());
    const user = auth.currentUser;
    if (!data || data.isAdmin !== true || !user || !data.stats) {
      toast('僅管理員可使用自助匯款。', false);
      return;
    }

    const value = normalizeAmount(amount);
    if (!value) {
      toast('請輸入大於 0 的靈石數量。', false);
      return;
    }

    busy = true;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = '匯款中…';
    if (status) status.textContent = '';

    try {
      const db = getFirestore(getApp());
      await updateDoc(doc(db, 'users', user.uid), {
        'stats.gold': increment(value)
      });

      data.stats.gold = Math.max(0, Number(data.stats.gold) || 0) + value;
      window.updateUIStats?.();
      window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', {
        detail: { source: 'admin-self-transfer', goldAdded: value }
      }));

      const total = Number(data.stats.gold) || 0;
      if (status) status.textContent = `已匯入 ${value.toLocaleString()} 靈石，目前持有 ${total.toLocaleString()}。`;
      toast(`已給自己匯入 ${value.toLocaleString()} 靈石`);
    } catch (error) {
      console.error('Admin self-transfer failed:', error);
      if (status) status.textContent = '匯款失敗，請查看管理員除錯紀錄。';
      toast('匯款失敗。', false);
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function mount() {
    if (!isAdmin()) return;
    if (document.getElementById(PANEL_ID)) return;

    const page = document.getElementById('page-admin');
    if (!page) return;

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'glass-panel p-4 rounded-xl border border-yellow-500/30 mb-4 relative overflow-hidden';
    panel.innerHTML = `
      <div class="absolute -top-12 -right-12 w-32 h-32 bg-yellow-500/10 rounded-full blur-3xl pointer-events-none"></div>
      <div class="relative z-10">
        <div class="flex items-center justify-between gap-3 mb-3">
          <div>
            <div class="text-[10px] tracking-[.24em] text-yellow-500/80 font-bold">ADMIN TREASURY</div>
            <h3 class="text-base font-bold text-yellow-100 mt-1">給自己匯錢</h3>
          </div>
          <i class="fa-solid fa-coins text-yellow-400 text-xl"></i>
        </div>
        <p class="text-[11px] text-gray-400 mb-3">直接增加目前登入管理員自己的靈石，不會影響其他玩家。</p>
        <div class="flex flex-col sm:flex-row gap-2">
          <input id="admin-self-transfer-amount" type="number" min="1" max="${MAX_AMOUNT}" step="1" value="${DEFAULT_AMOUNT}" class="input-cyber flex-1" placeholder="輸入靈石數量">
          <button id="admin-self-transfer-btn" type="button" class="px-4 py-2 rounded-xl border border-yellow-500/40 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-200 font-bold transition whitespace-nowrap">
            <i class="fa-solid fa-money-bill-transfer mr-2"></i>給自己匯錢
          </button>
        </div>
        <div class="flex flex-wrap gap-2 mt-2" id="admin-self-transfer-presets">
          ${[100, 1000, 10000, 100000].map((v) => `<button type="button" data-amount="${v}" class="text-[10px] px-2 py-1 rounded-lg border border-white/10 text-gray-300 hover:text-yellow-200 hover:border-yellow-500/30 transition">+${v.toLocaleString()}</button>`).join('')}
        </div>
        <p id="admin-self-transfer-status" class="text-[11px] text-yellow-200/80 mt-3 min-h-[1rem]"></p>
      </div>
    `;

    const heading = page.querySelector('h2');
    if (heading?.nextSibling) page.insertBefore(panel, heading.nextSibling);
    else page.prepend(panel);

    const input = panel.querySelector('#admin-self-transfer-amount');
    const button = panel.querySelector('#admin-self-transfer-btn');
    const status = panel.querySelector('#admin-self-transfer-status');

    panel.querySelectorAll('[data-amount]').forEach((preset) => {
      preset.addEventListener('click', () => {
        input.value = preset.dataset.amount || DEFAULT_AMOUNT;
      });
    });

    button.addEventListener('click', () => transferToSelf(input.value, button, status));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') transferToSelf(input.value, button, status);
    });
  }

  function boot() {
    mount();
    const observer = new MutationObserver(mount);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('xiuxian:user-ready', mount);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
