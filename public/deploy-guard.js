/* Branch-aware live deployment indicator. No game state is modified. */
(() => {
  'use strict';
  // The main game's outer frame is responsible for displaying status.
  if (window.self !== window.top) return;

  let firstRevision = '';
  let latestRevision = '';
  let checking = false;
  let warned = false;
  let element;
  let button;

  function createStatus() {
    element = document.createElement('aside');
    element.id = 'deploy-version-status';
    element.setAttribute('aria-label', '目前部署版本');
    element.style.cssText =
      'position:fixed;bottom:calc(10px + env(safe-area-inset-bottom,0px));' +
      'left:calc(10px + env(safe-area-inset-left,0px));z-index:2147483000;' +
      'max-width:calc(100vw - 20px);font:600 11px/1.4 system-ui,sans-serif;' +
      'color:#333;background:rgba(255,255,255,.96);border:1px solid #ced3de;' +
      'border-radius:9px;box-shadow:0 2px 12px #0002;padding:5px 8px;' +
      'opacity:.84;pointer-events:auto;';
    button = document.createElement('button');
    button.type = 'button';
    button.style.cssText = 'font:inherit;color:inherit;background:none;border:0;padding:0;cursor:default;';
    button.textContent = '讀取部署版本…';
    element.appendChild(button);
    document.body.appendChild(element);
  }

  function display(info) {
    const branch = String(info.branch || 'unknown');
    const commit = String(info.commit || info.revision || 'unknown');
    const label = branch + ' · ' + commit.slice(0, 8);
    element.title = '目前線上部署分支：' + branch + '\nCommit／版本：' + commit;
    if (info.branchMatchesExpected === false) {
      warned = true;
      button.textContent = '⚠ 部署分支錯誤：' + branch;
      element.style.color = '#9e2b31';
      element.style.borderColor = '#ef949c';
      element.style.opacity = '1';
      button.title = 'Render 預期分支：' + info.expectedBranch + '。請檢查 Render 的 Branch 設定。';
      return;
    }
    if (firstRevision && info.revision !== firstRevision) {
      latestRevision = info.revision;
      button.textContent = '● 有新版本，點擊更新（' + label + '）';
      button.title = '已部署更新：點擊更新畫面，不會自動中斷作答。';
      button.style.cursor = 'pointer';
      element.style.color = '#126f58';
      element.style.borderColor = '#77c4af';
      element.style.opacity = '1';
      return;
    }
    if (!firstRevision) firstRevision = info.revision;
    if (!warned) button.textContent = '版本 ' + label;
  }

  async function clearLegacyCache() {
    if ('serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.filter(reg => reg.scope.startsWith(location.origin + '/'))
          .map(reg => reg.unregister()));
      } catch (err) { console.warn('[Deployment] SW cleanup unavailable:', err); }
    }
    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.filter(name => name.startsWith('xiuxian-')).map(name => caches.delete(name)));
      } catch (err) { console.warn('[Deployment] Cache cleanup unavailable:', err); }
    }
  }

  async function check() {
    if (checking || document.hidden) return;
    checking = true;
    try {
      const res = await fetch('/api/deploy-info?t=' + Date.now(), {
        cache: 'no-store',
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) throw Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data || typeof data.revision !== 'string') throw Error('Invalid version metadata');
      display(data);
    } catch (error) {
      if (!firstRevision) button.textContent = '無法確認部署版本';
      console.warn('[Deployment] Version check unavailable:', error);
    } finally {
      checking = false;
    }
  }

  function activate() {
    createStatus();
    button.addEventListener('click', () => {
      if (warned) return;
      if (!latestRevision || latestRevision === firstRevision) return;
      button.disabled = true;
      button.textContent = '正在更新…';
      void clearLegacyCache().finally(() => location.reload());
    });
    void check();
    // Check when the player returns, without interrupting an ongoing question.
    window.addEventListener('focus', () => void check());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void check();
    });
    setInterval(() => void check(), 60_000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', activate, { once: true });
  } else activate();
})();
