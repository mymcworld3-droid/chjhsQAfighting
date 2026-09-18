import { getArtifactById, realmOrderByName } from './artifact-catalog.js';
import { getMaterialById, materialRealmOrderByName } from './material-catalog.js';

(function () {
  'use strict';
  let queued = false;

  function reorder(container, idOf, rankOf, nameOf, compareExtra = null) {
    if (!container) return;
    const nodes = [...container.children].filter((node) => idOf(node));
    if (nodes.length < 2) return;
    const sorted = nodes.slice().sort((a, b) => {
      if (compareExtra) {
        const extra = compareExtra(idOf(a), idOf(b));
        if (extra !== 0) return extra;
      }
      const ra = rankOf(idOf(a));
      const rb = rankOf(idOf(b));
      if (ra !== rb) return ra - rb;
      return String(nameOf(idOf(a)) || '').localeCompare(String(nameOf(idOf(b)) || ''), 'zh-Hant');
    });
    if (sorted.every((node, index) => node === nodes[index])) return;
    sorted.forEach((node) => container.appendChild(node));
  }

  function sortAll() {
    queued = false;
    reorder(
      document.getElementById('admin-artifact-list'),
      (node) => node.querySelector('[data-admin-artifact-edit]')?.dataset.adminArtifactEdit || '',
      (id) => realmOrderByName(getArtifactById(id)?.realm || '凡人'),
      (id) => getArtifactById(id)?.name || id,
      (aId, bId) => {
        const a = getArtifactById(aId);
        const b = getArtifactById(bId);
        const aPending = a?.reviewStatus === 'pending';
        const bPending = b?.reviewStatus === 'pending';
        if (aPending !== bPending) return aPending ? -1 : 1;
        if (aPending && bPending) {
          const timeDiff = (Number(b?.generatedAtMs) || 0) - (Number(a?.generatedAtMs) || 0);
          if (timeDiff !== 0) return timeDiff;
        }
        return 0;
      }
    );
    reorder(
      document.getElementById('admin-material-list'),
      (node) => node.querySelector('[data-material-edit]')?.dataset.materialEdit || '',
      (id) => materialRealmOrderByName(getMaterialById(id)?.realm || '凡人'),
      (id) => getMaterialById(id)?.name || id
    );
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sortAll);
  }

  function boot() {
    schedule();
    ['artifact-catalog-updated', 'material-catalog-updated', 'xiuxian:features-ready'].forEach((name) => window.addEventListener(name, schedule));
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
