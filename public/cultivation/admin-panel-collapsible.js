// 管理員頁通用收合器：既有區塊與之後動態插入的管理功能都可縮成一行。
(function () {
  'use strict';

  const STORAGE_KEY = 'adminPanelCollapseV1';
  const wrapped = new WeakSet();

  function isAdmin() {
    try { return window.getCurrentUserData?.()?.isAdmin === true; } catch (_) { return false; }
  }

  function ensureStyle() {
    if (document.getElementById('admin-panel-collapsible-style')) return;
    const style = document.createElement('style');
    style.id = 'admin-panel-collapsible-style';
    style.textContent = `
      #page-admin{padding-bottom:110px}
      .admin-collapse-card{margin-bottom:10px;border:1px solid rgba(216,177,93,.14);border-radius:16px;overflow:hidden;background:linear-gradient(145deg,rgba(15,14,12,.94),rgba(7,7,7,.97))}
      .admin-collapse-head{width:100%;min-height:52px;display:grid;grid-template-columns:32px minmax(0,1fr) 24px;align-items:center;gap:9px;padding:9px 12px;border:0;background:linear-gradient(90deg,rgba(216,177,93,.055),rgba(255,255,255,.012));color:inherit;text-align:left;cursor:pointer}.admin-collapse-head:hover{background:linear-gradient(90deg,rgba(216,177,93,.09),rgba(255,255,255,.018))}.admin-collapse-icon{width:30px;height:30px;display:grid;place-items:center;border-radius:10px;border:1px solid rgba(216,177,93,.18);background:rgba(216,177,93,.055);color:#d8b15d;font-size:12px}.admin-collapse-copy{min-width:0}.admin-collapse-title{display:block;color:#eee1c6;font-size:11px;font-weight:900}.admin-collapse-summary{display:block;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#796f5e;font-size:7px}.admin-collapse-chevron{color:#8e8066;font-size:9px;transition:transform .18s}.admin-collapse-head[aria-expanded="true"] .admin-collapse-chevron{transform:rotate(180deg);color:#d8b15d}.admin-collapse-body{padding:10px}.admin-collapse-body[hidden]{display:none!important}.admin-collapse-body>.glass-panel,.admin-collapse-body>#admin-artifact-manager{margin:0!important}.admin-collapse-body>#admin-product-list{margin-top:10px!important}
      @media(max-width:560px){.admin-collapse-head{grid-template-columns:29px minmax(0,1fr) 22px;padding:8px 10px;min-height:49px}.admin-collapse-icon{width:28px;height:28px}.admin-collapse-body{padding:8px}}
    `;
    document.head.appendChild(style);
  }

  function readSaved() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function saveState() {
    const result = {};
    document.querySelectorAll('#page-admin .admin-collapse-card').forEach((card) => {
      result[card.dataset.adminCollapseKey] = !!card.querySelector('.admin-collapse-body')?.hidden;
    });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(result)); } catch (_) {}
  }
  function metaFor(node) {
    if (node.id === 'admin-artifact-manager') return { key: 'artifacts', title: '法寶管理', summary: '查看、新增與編輯全站法寶', icon: 'fa-hammer' };
    if (node.id === 'admin-self-transfer-panel') return { key: 'treasury', title: '管理員靈石', summary: '自助增加目前管理員靈石', icon: 'fa-coins' };
    if (node.querySelector?.('#admin-stat-total-users')) return { key: 'statistics', title: '數據統計', summary: '註冊、活躍、答題量與正確率', icon: 'fa-chart-line' };
    if (node.querySelector?.('[onclick*="recalculateAllUserRanks"]') || node.querySelector?.('[onclick*="triggerGlobalReload"]')) return { key: 'system', title: '系統管理', summary: '排名重算與全站重新載入', icon: 'fa-gears' };
    if (node.querySelector?.('#admin-form-title')) return { key: 'products', title: '商城商品', summary: '新增、編輯與管理商城商品', icon: 'fa-store' };
    if (node.id === 'admin-product-list') return { key: 'products-list', title: '商品清單', summary: '目前商城商品列表', icon: 'fa-list' };
    const customTitle = node.dataset?.adminSectionTitle;
    return {
      key: node.id ? `section-${node.id}` : `section-${Math.random().toString(36).slice(2, 9)}`,
      title: customTitle || node.querySelector?.('h3')?.textContent?.trim()?.slice(0, 40) || '管理功能',
      summary: node.dataset?.adminSectionSummary || '點擊展開管理內容',
      icon: node.dataset?.adminSectionIcon || 'fa-sliders'
    };
  }

  function setCollapsed(card, collapsed, persist = true) {
    const body = card.querySelector('.admin-collapse-body');
    const button = card.querySelector('.admin-collapse-head');
    if (!body || !button) return;
    body.hidden = !!collapsed;
    card.classList.toggle('is-collapsed', !!collapsed);
    button.setAttribute('aria-expanded', String(!collapsed));
    if (persist) saveState();
  }

  function wrapNode(node, forcedMeta = null) {
    if (!node || wrapped.has(node) || node.closest?.('.admin-collapse-card') || node.classList?.contains('admin-collapse-card')) return null;
    const page = document.getElementById('page-admin');
    if (!page || node.parentElement !== page) return null;
    const meta = forcedMeta || metaFor(node);
    const saved = readSaved();
    const card = document.createElement('section');
    card.className = 'admin-collapse-card';
    card.dataset.adminCollapseKey = meta.key;
    card.innerHTML = `<button type="button" class="admin-collapse-head" aria-expanded="false"><span class="admin-collapse-icon"><i class="fa-solid ${meta.icon}"></i></span><span class="admin-collapse-copy"><span class="admin-collapse-title">${meta.title}</span><span class="admin-collapse-summary">${meta.summary}</span></span><span class="admin-collapse-chevron"><i class="fa-solid fa-chevron-down"></i></span></button><div class="admin-collapse-body" hidden></div>`;
    page.insertBefore(card, node);
    card.querySelector('.admin-collapse-body').appendChild(node);
    wrapped.add(node);
    const collapsed = saved[meta.key] !== undefined ? !!saved[meta.key] : true;
    setCollapsed(card, collapsed, false);
    card.querySelector('.admin-collapse-head').onclick = () => setCollapsed(card, !card.querySelector('.admin-collapse-body').hidden, true);
    return card;
  }

  function groupProducts(page) {
    const form = [...page.children].find((node) => !node.classList?.contains('admin-collapse-card') && node.querySelector?.('#admin-form-title'));
    const list = [...page.children].find((node) => node.id === 'admin-product-list');
    if (!form) return false;
    const card = wrapNode(form, { key: 'products', title: '商城商品', summary: '新增、編輯與管理商城商品', icon: 'fa-store' });
    if (card && list && list.parentElement === page) {
      card.querySelector('.admin-collapse-body').appendChild(list);
      wrapped.add(list);
    }
    return !!card;
  }

  function mount() {
    if (!isAdmin()) return;
    ensureStyle();
    const page = document.getElementById('page-admin');
    if (!page) return;
    groupProducts(page);
    [...page.children].forEach((node) => {
      if (node.tagName === 'H2' || node.classList?.contains('admin-collapse-card')) return;
      if (node.id === 'admin-product-list' && node.closest('.admin-collapse-card')) return;
      wrapNode(node);
    });
  }

  function boot() {
    mount();
    window.addEventListener('xiuxian:user-ready', mount);
    window.addEventListener('artifact-catalog-updated', mount);
    const observer = new MutationObserver(() => mount());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
