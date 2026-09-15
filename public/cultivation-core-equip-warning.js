// 低品質金丹裝配提醒：七～九品在真正裝配前再次確認。
(function () {
  'use strict';

  const LOW_QUALITY_MIN_GRADE = 7;
  const BYPASS_ATTR = 'data-core-warning-bypass';

  function currentCoreState() {
    return window.getGoldenCoreState?.() || null;
  }

  function qualityText(grade) {
    if (grade >= 9) return '九品初成，丹力尚淺';
    if (grade === 8) return '八品丹成，品質偏低';
    return '七品金丹，仍有不少洗髓空間';
  }

  function ensureStyle() {
    if (document.getElementById('core-equip-warning-style')) return;
    const style = document.createElement('style');
    style.id = 'core-equip-warning-style';
    style.textContent = `
      .core-equip-warning-backdrop {
        position: fixed;
        inset: 0;
        z-index: 5200;
        display: grid;
        place-items: center;
        padding: 18px;
        background: rgba(0,0,0,.78);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
      }
      .core-equip-warning {
        width: min(100%, 430px);
        padding: 22px;
        border-radius: 26px;
        border: 1px solid rgba(216,177,93,.42);
        background: linear-gradient(150deg, rgba(25,21,13,.98), rgba(8,8,8,.99));
        box-shadow: 0 28px 80px rgba(0,0,0,.58), inset 0 1px rgba(255,255,255,.035);
        text-align: center;
      }
      .core-equip-warning-mark {
        width: 54px;
        height: 54px;
        margin: 0 auto 13px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        border: 1px solid rgba(232,190,92,.55);
        color: #f0c96d;
        background: radial-gradient(circle at 35% 30%, rgba(216,177,93,.22), rgba(20,15,7,.9));
        box-shadow: 0 0 26px rgba(216,177,93,.16);
        font-size: 22px;
        font-weight: 900;
      }
      .core-equip-warning h3 {
        margin: 0 0 8px;
        color: #f5ead4;
        font-size: 20px;
        font-weight: 900;
      }
      .core-equip-warning-grade {
        display: inline-flex;
        margin-bottom: 10px;
        padding: 5px 10px;
        border-radius: 999px;
        border: 1px solid rgba(216,177,93,.28);
        color: #dfbd68;
        background: rgba(216,177,93,.07);
        font-size: 11px;
        font-weight: 900;
      }
      .core-equip-warning p {
        margin: 0;
        color: #b6aa91;
        font-size: 12px;
        line-height: 1.8;
      }
      .core-equip-warning-note {
        margin-top: 10px !important;
        color: #857a67 !important;
        font-size: 10px !important;
      }
      .core-equip-warning-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 9px;
        margin-top: 18px;
      }
      .core-equip-warning-actions button {
        min-height: 44px;
        border-radius: 15px;
        font-size: 12px;
        font-weight: 900;
        transition: .18s ease;
      }
      .core-equip-warning-cancel {
        color: #bcae91;
        border: 1px solid rgba(216,177,93,.18);
        background: #0d0d0d;
      }
      .core-equip-warning-confirm {
        color: #fff2cf;
        border: 1px solid #d8b15d;
        background: linear-gradient(135deg, #a87827, #5e3c0f);
        box-shadow: 0 8px 22px rgba(172,121,33,.14);
      }
      .core-equip-warning-actions button:hover { transform: translateY(-1px); filter: brightness(1.08); }
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.getElementById('core-equip-warning-modal')?.remove();
  }

  function showWarning(button, state) {
    closeModal();
    ensureStyle();

    const grade = Math.min(9, Math.max(1, Number(state?.grade) || 9));
    const modal = document.createElement('div');
    modal.id = 'core-equip-warning-modal';
    modal.className = 'core-equip-warning-backdrop';
    modal.innerHTML = `
      <section class="core-equip-warning" role="dialog" aria-modal="true" aria-label="低品質金丹提醒">
        <div class="core-equip-warning-mark">!</div>
        <h3>確定要裝配這顆金丹？</h3>
        <div class="core-equip-warning-grade">${grade} 品 · ${state?.name || '金丹'}</div>
        <p>${qualityText(grade)}，裝配後特性效果也會依此品質計算。</p>
        <p class="core-equip-warning-note">你仍然可以裝配；若想追求更強效果，也可以先繼續洗髓。</p>
        <div class="core-equip-warning-actions">
          <button type="button" class="core-equip-warning-cancel">先不裝配</button>
          <button type="button" class="core-equip-warning-confirm">仍然裝配</button>
        </div>
      </section>
    `;

    modal.querySelector('.core-equip-warning-cancel')?.addEventListener('click', closeModal);
    modal.querySelector('.core-equip-warning-confirm')?.addEventListener('click', () => {
      closeModal();
      button.setAttribute(BYPASS_ATTR, '1');
      button.click();
    });
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });

    document.body.appendChild(modal);
  }

  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('#equip-current-core');
    if (!button || button.disabled) return;

    if (button.getAttribute(BYPASS_ATTR) === '1') {
      button.removeAttribute(BYPASS_ATTR);
      return;
    }

    const state = currentCoreState();
    const grade = Number(state?.grade);
    if (!Number.isFinite(grade) || grade < LOW_QUALITY_MIN_GRADE) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    showWarning(button, state);
  }, true);
})();
