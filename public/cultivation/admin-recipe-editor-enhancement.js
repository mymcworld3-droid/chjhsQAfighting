// 管理員法寶配方編輯器：與玩家 8 格煉器陣保持一致。
(function () {
  'use strict';

  const MODAL_ID = 'admin-artifact-recipe-modal';
  const SLOT_MIN = 2;
  const SLOT_LIMIT = 8;
  let observer = null;

  function enhance(modal) {
    if (!modal || modal.dataset.recipeEnhancementReady === '1') return;
    modal.dataset.recipeEnhancementReady = '1';

    const card = modal.querySelector('.amm-card');
    const note = modal.querySelector('.amm-note');
    const status = modal.querySelector('#amm-recipe-status');
    const save = modal.querySelector('.amm-save');
    const inputs = [...modal.querySelectorAll('[data-recipe-material],[data-recipe-artifact]')];
    if (!card || !save || !inputs.length) return;

    if (note) {
      note.textContent = '設定各材料與法寶素材需要的數量。玩家煉器時只比較種類與數量，不看 8 格排列；總素材至少 2 個、最多 8 個。法寶可二次煉製，但套娃最多 2 層。';
    }

    inputs.forEach((input) => {
      input.min = '0';
      input.max = String(SLOT_LIMIT);
      input.step = '1';
      input.inputMode = 'numeric';
    });

    const meter = document.createElement('div');
    meter.className = 'amm-recipe-slot-meter';
    meter.style.cssText = 'margin:0 0 10px;padding:8px 10px;border:1px solid rgba(216,177,93,.18);border-radius:10px;background:rgba(216,177,93,.04);color:#bda66e;font-size:8px;font-weight:900;display:flex;justify-content:space-between;gap:8px';
    meter.innerHTML = '<span>煉器陣素材格</span><b data-recipe-slot-count>0 / 8</b>';
    const list = modal.querySelector('.amm-recipe-list');
    if (list) list.before(meter);

    function update() {
      let total = 0;
      inputs.forEach((input) => {
        let value = Math.floor(Number(input.value) || 0);
        value = Math.max(0, Math.min(SLOT_LIMIT, value));
        if (String(value) !== input.value && document.activeElement !== input) input.value = String(value);
        total += value;
      });
      const count = meter.querySelector('[data-recipe-slot-count]');
      if (count) {
        count.textContent = `${total} / ${SLOT_LIMIT}`;
        count.style.color = total > SLOT_LIMIT ? '#fca5a5' : (total === SLOT_LIMIT ? '#86efac' : '#d8b15d');
      }
      const invalid = total < SLOT_MIN || total > SLOT_LIMIT;
      save.disabled = invalid;
      save.dataset.recipeLimitDisabled = invalid ? '1' : '0';
      if (status) {
        if (total > SLOT_LIMIT) status.textContent = `目前共 ${total} 個素材，超過 8 格上限，請減少 ${total - SLOT_LIMIT} 個。`;
        else if (total < SLOT_MIN) status.textContent = `每個法寶配方至少需要 ${SLOT_MIN} 個材料或法寶素材，目前只有 ${total} 個。`;
        else if (status.textContent?.includes('超過 8 格') || status.textContent?.includes('每個法寶配方至少需要')) status.textContent = '';
      }
    }

    inputs.forEach((input) => input.addEventListener('input', update));
    update();
  }

  function scan() {
    enhance(document.getElementById(MODAL_ID));
  }

  function boot() {
    scan();
    if (!document.body || observer) return;
    observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
