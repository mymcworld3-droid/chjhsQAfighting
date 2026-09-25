import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  ARTIFACT_CATALOG,
  replaceArtifactCatalog
} from './artifact-catalog.js';
import {
  MATERIAL_CATALOG,
  replaceMaterialCatalog
} from './material-catalog.js';

(function () {
  'use strict';

  const PANEL_ID = 'admin-item-image-manager';
  let busy = false;
  let stopRequested = false;

  function data() { return window.getCurrentUserData?.() || null; }
  function isAdmin() { return data()?.isAdmin === true; }
  function esc(value) {
    return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;')
      .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  }

  function toast(message, ok = true) {
    document.getElementById('aiim-toast')?.remove();
    const node = document.createElement('div');
    node.id = 'aiim-toast';
    node.textContent = message;
    node.style.cssText = `position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:12400;padding:10px 15px;border-radius:999px;background:#090909f5;border:1px solid ${ok ? '#d8b15d88' : '#ef777788'};color:${ok ? '#f1ddaa' : '#ffd0d0'};font-size:10px;font-weight:900;box-shadow:0 16px 45px #0009`;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 3200);
  }

  function updateLocal(kind, item) {
    if (!item?.id) return;
    if (kind === 'artifact') {
      const next = ARTIFACT_CATALOG.map((row) => row.id === item.id ? { ...row, ...item } : row);
      replaceArtifactCatalog(next, 'item-image-api');
    } else {
      const next = MATERIAL_CATALOG.map((row) => row.id === item.id ? { ...row, ...item } : row);
      replaceMaterialCatalog(next, 'item-image-api');
    }
  }

  async function requestItemImage(kind, id, { overwrite = false } = {}) {
    const user = getAuth(getApp()).currentUser;
    if (!user) throw new Error('尚未登入');
    if (!isAdmin()) throw new Error('只有管理員可以補圖');
    const token = await user.getIdToken();
    const response = await fetch('/api/admin/item-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify({ kind, id, overwrite })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) {
      const error = new Error(payload?.error || ('圖片生成失敗 (' + response.status + ')'));
      error.status = response.status;
      throw error;
    }
    if (payload.item) updateLocal(kind, payload.item);
    return payload;
  }

  window.ensureAdminItemImage = requestItemImage;

  function missingQueue() {
    const artifactRows = ARTIFACT_CATALOG
      .filter((item) => !String(item?.imageUrl || '').trim())
      .map((item) => ({ kind: 'artifact', id: item.id, name: item.name || item.id }));
    const materialRows = MATERIAL_CATALOG
      .filter((item) => !String(item?.imageUrl || '').trim())
      .map((item) => ({ kind: 'material', id: item.id, name: item.name || item.id }));
    return [...artifactRows, ...materialRows];
  }

  function counts() {
    const artifactsReady = ARTIFACT_CATALOG.filter((item) => item.imageUrl).length;
    const materialsReady = MATERIAL_CATALOG.filter((item) => item.imageUrl).length;
    return {
      artifactsReady,
      artifactsTotal: ARTIFACT_CATALOG.length,
      materialsReady,
      materialsTotal: MATERIAL_CATALOG.length
    };
  }

  function ensureStyle() {
    if (document.getElementById('admin-item-image-style')) return;
    const style = document.createElement('style');
    style.id = 'admin-item-image-style';
    style.textContent = `
      #${PANEL_ID}{padding:13px;border:1px solid rgba(216,177,93,.16);border-radius:16px;background:linear-gradient(145deg,rgba(18,15,10,.95),rgba(7,7,7,.98));margin-bottom:10px}
      .aiim-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.aiim-head h3{margin:0;color:#f0dfb7;font-size:11px}.aiim-head p{margin:4px 0 0;color:#82755f;font-size:7px;line-height:1.5}
      .aiim-actions{display:flex;gap:7px;flex-wrap:wrap}.aiim-btn{min-height:34px;padding:0 12px;border:1px solid rgba(216,177,93,.30);border-radius:10px;background:rgba(216,177,93,.07);color:#f0d99a;font-size:8px;font-weight:900}.aiim-btn:hover{border-color:#d8b15d99;background:rgba(216,177,93,.12)}.aiim-btn:disabled{opacity:.4;cursor:not-allowed}.aiim-stop{border-color:#ef777755;color:#f3b6b6}
      .aiim-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:10px}.aiim-stat{padding:8px 9px;border:1px solid rgba(255,255,255,.05);border-radius:10px;background:rgba(255,255,255,.018)}.aiim-stat span{display:block;color:#81745f;font-size:6px}.aiim-stat b{display:block;margin-top:3px;color:#e9d8af;font-size:10px}
      .aiim-status{margin-top:9px;min-height:18px;color:#b8a67c;font-size:7px;line-height:1.6}.aiim-progress{height:4px;margin-top:6px;border-radius:999px;background:#ffffff0b;overflow:hidden}.aiim-progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,#8b7134,#e2c16c);transition:width .2s ease}
      @media(max-width:620px){.aiim-head{align-items:flex-start;flex-direction:column}.aiim-actions{width:100%}.aiim-btn{flex:1}.aiim-stats{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function render() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const c = counts();
    panel.innerHTML = `
      <div class="aiim-head">
        <div><h3><i class="fa-solid fa-images"></i> 法寶／素材圖片</h3><p>使用 Cloudflare FLUX.1 Schnell。補圖只處理目前沒有圖片的項目；新建法寶與素材會自動生圖。</p></div>
        <div class="aiim-actions">
          <button type="button" class="aiim-btn" id="aiim-backfill" ${busy ? 'disabled' : ''}><i class="fa-solid fa-wand-magic-sparkles"></i> 補圖</button>
          <button type="button" class="aiim-btn aiim-stop" id="aiim-stop" ${busy ? '' : 'disabled'}><i class="fa-solid fa-stop"></i> 停止</button>
        </div>
      </div>
      <div class="aiim-stats">
        <div class="aiim-stat"><span>法寶圖片</span><b>${c.artifactsReady} / ${c.artifactsTotal}</b></div>
        <div class="aiim-stat"><span>素材圖片</span><b>${c.materialsReady} / ${c.materialsTotal}</b></div>
      </div>
      <div id="aiim-status" class="aiim-status">${busy ? '補圖進行中…' : (missingQueue().length ? `尚有 ${missingQueue().length} 個項目沒有圖片。` : '所有法寶與素材都已有圖片。')}</div>
      <div class="aiim-progress"><i id="aiim-progress-bar"></i></div>
    `;
    panel.querySelector('#aiim-backfill')?.addEventListener('click', backfill);
    panel.querySelector('#aiim-stop')?.addEventListener('click', () => {
      stopRequested = true;
      const status = panel.querySelector('#aiim-status');
      if (status) status.textContent = '會在目前這張圖片完成後停止。';
    });
  }

  async function backfill() {
    if (busy || !isAdmin()) return;
    const queue = missingQueue();
    if (!queue.length) {
      toast('目前沒有需要補圖的法寶或素材');
      render();
      return;
    }
    busy = true;
    stopRequested = false;
    render();
    const panel = document.getElementById(PANEL_ID);
    const status = panel?.querySelector('#aiim-status');
    const bar = panel?.querySelector('#aiim-progress-bar');
    let completed = 0;
    let failed = 0;

    for (let index = 0; index < queue.length; index += 1) {
      if (stopRequested) break;
      const row = queue[index];
      if (status) status.textContent = `正在生成 ${index + 1} / ${queue.length}：${row.kind === 'artifact' ? '法寶' : '素材'}「${row.name}」`;
      if (bar) bar.style.width = Math.round(index / queue.length * 100) + '%';
      try {
        await requestItemImage(row.kind, row.id);
        completed += 1;
      } catch (error) {
        failed += 1;
        console.warn('[Admin item image backfill]', row, error);
        if (error?.status === 429 || error?.status === 503 || error?.status === 504) {
          if (status) status.textContent = error.message + '；已停止本次補圖。';
          break;
        }
      }
    }

    if (bar) bar.style.width = '100%';
    busy = false;
    const stopped = stopRequested;
    stopRequested = false;
    render();
    toast(stopped
      ? `已停止補圖，本次完成 ${completed} 張`
      : `補圖完成：成功 ${completed} 張${failed ? `，失敗 ${failed} 張` : ''}`, failed === 0);
  }

  function mount() {
    if (!isAdmin()) return;
    ensureStyle();
    const page = document.getElementById('page-admin');
    if (!page) return;
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('section');
      panel.id = PANEL_ID;
      panel.dataset.adminSectionTitle = '物品補圖';
      panel.dataset.adminSectionIcon = 'fa-images';
      const materialPanel = document.getElementById('admin-material-manager');
      const artifactPanel = document.getElementById('admin-artifact-manager');
      if (materialPanel) materialPanel.after(panel);
      else if (artifactPanel) artifactPanel.after(panel);
      else page.prepend(panel);
    }
    render();
  }

  window.addEventListener('artifact-catalog-updated', () => { if (!busy) render(); });
  window.addEventListener('material-catalog-updated', () => { if (!busy) render(); });
  window.addEventListener('xiuxian:user-ready', mount);
  window.addEventListener('xiuxian:features-ready', mount);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
