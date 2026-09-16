// 金丹品質下降提醒：若洗髓後候選丹相品質比上一次調御的金丹差，切換丹相前再次確認。
(function () {
  'use strict';

  const BASELINE_KEY = 'xiuxian_core_equipped_grade_before_wash_v1';
  const BYPASS_ATTR = 'data-core-warning-bypass';

  function currentCoreState() {
    return window.getGoldenCoreState?.() || null;
  }

  function clampGrade(value) {
    return Math.min(9, Math.max(1, Number(value) || 9));
  }

  function readBaseline() {
    const grade = Number(localStorage.getItem(BASELINE_KEY));
    return Number.isFinite(grade) && grade >= 1 && grade <= 9 ? grade : null;
  }

  function writeBaseline(grade) {
    localStorage.setItem(BASELINE_KEY, String(clampGrade(grade)));
  }

  function clearBaseline() {
    localStorage.removeItem(BASELINE_KEY);
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
        background: rgba(0,0,0,.80);
        backdrop-filter: blur(11px);
        -webkit-backdrop-filter: blur(11px);
      }
      .core-equip-warning {
        width: min(100%, 440px);
        padding: 23px;
        border-radius: 27px;
        border: 1px solid rgba(216,177,93,.45);
        background: linear-gradient(150deg, rgba(27,22,13,.99), rgba(8,8,8,.99));
        box-shadow: 0 30px 86px rgba(0,0,0,.62), inset 0 1px rgba(255,255,255,.04);
        text-align: center;
      }
      .core-equip-warning-mark {
        width: 58px;
        height: 58px;
        margin: 0 auto 13px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        border: 1px solid rgba(232,190,92,.62);
        color: #f3cd72;
        background: radial-gradient(circle at 35% 30%, rgba(216,177,93,.24), rgba(20,15,7,.92));
        box-shadow: 0 0 30px rgba(216,177,93,.20);
        font-size: 24px;
        font-weight: 900;
      }
      .core-equip-warning h3 {
        margin: 0 0 8px;
        color: #f6ecd7;
        font-size: 20px;
        font-weight: 900;
      }
      .core-equip-warning-compare {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 9px;
        margin: 13px 0;
      }
      .core-equip-warning-grade {
        min-width: 82px;
        padding: 7px 11px;
        border-radius: 999px;
        border: 1px solid rgba(216,177,93,.28);
        background: rgba(216,177,93,.07);
        font-size: 12px;
        font-weight: 900;
      }
      .core-equip-warning-grade.old { color: #ead18c; }
      .core-equip-warning-grade.new {
        color: #f0b870;
        border-color: rgba(226,155,76,.42);
        background: rgba(168,93,31,.10);
      }
      .core-equip-warning-arrow { color: #8f8168; font-size: 13px; }
      .core-equip-warning p {
        margin: 0;
        color: #b7ab92;
        font-size: 12px;
        line-height: 1.8;
      }
      .core-equip-warning-note {
        margin-top: 9px !important;
        color: #877b66 !important;
        font-size: 10px !important;
      }
      .core-equip-warning-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 9px;
        margin-top: 18px;
      }
      .core-equip-warning-actions button {
        min-height: 45px;
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
      .core-equip-warning-actions button:hover {
        transform: translateY(-1px);
        filter: brightness(1.08);
      }
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.getElementById('core-equip-warning-modal')?.remove();
  }

  function showWarning(button, oldGrade, newGrade, state) {
    closeModal();
    ensureStyle();

    const modal = document.createElement('div');
    modal.id = 'core-equip-warning-modal';
    modal.className = 'core-equip-warning-backdrop';
    modal.innerHTML = `
      <section class="core-equip-warning" role="dialog" aria-modal="true" aria-label="金丹品質下降提醒">
        <div class="core-equip-warning-mark">!</div>
        <h3>金丹品質下降</h3>
        <div class="core-equip-warning-compare">
          <span class="core-equip-warning-grade old">原本 ${oldGrade} 品</span>
          <i class="fa-solid fa-arrow-right core-equip-warning-arrow"></i>
          <span class="core-equip-warning-grade new">現在 ${newGrade} 品</span>
        </div>
        <p>目前候選丹相「${state?.name || '金丹'}」的品質比正在調御的本命金丹低，特性效果也可能較弱。</p>
        <p class="core-equip-warning-note">一品最佳、九品最低。若仍要改換丹相，可以繼續調御。</p>
        <div class="core-equip-warning-actions">
          <button type="button" class="core-equip-warning-cancel">先不調御</button>
          <button type="button" class="core-equip-warning-confirm">仍然調御</button>
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
    const washButton = event.target?.closest?.('#wash-golden-core');
    if (washButton && !washButton.disabled) {
      const state = currentCoreState();
      // 只在開始洗髓「目前調御」的本命金丹時建立比較基準。
      // 若連續洗髓但尚未調御新丹相，仍保留原本調御金丹的品質作比較。
      if (state?.equipped && Number.isFinite(Number(state.grade))) {
        writeBaseline(state.grade);
      } else if (readBaseline() == null && Number.isFinite(Number(state?.grade))) {
        writeBaseline(state.grade);
      }
      return;
    }

    const button = event.target?.closest?.('#equip-current-core');
    if (!button || button.disabled) return;

    if (button.getAttribute(BYPASS_ATTR) === '1') {
      button.removeAttribute(BYPASS_ATTR);
      return;
    }

    const state = currentCoreState();
    const newGrade = Number(state?.grade);
    const oldGrade = readBaseline();
    if (!Number.isFinite(newGrade) || oldGrade == null) return;

    // 品階數字越大代表品質越差：例如三品 -> 五品就是降級。
    if (newGrade <= oldGrade) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    showWarning(button, oldGrade, clampGrade(newGrade), state);
  }, true);

  // 若載入時已經是正常調御狀態，舊的比較基準可以清掉；
  // 下一次洗髓時會重新記錄當下調御金丹的品質。
  const initial = currentCoreState();
  if (initial?.equipped) clearBaseline();
})();
