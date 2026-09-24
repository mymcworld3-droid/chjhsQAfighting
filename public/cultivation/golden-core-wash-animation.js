// 金丹洗髓演出：只有遠端保存成功後才揭曉候選丹相。此模組不負責扣款或改動金丹狀態。
const OVERLAY_ID = 'golden-core-wash-overlay';
const STYLE_HREF = 'cultivation-golden-core-wash.css?v=20260924-1';
const MINIMUM_WASH_MS = 1900;

function ensureWashStyle() {
  if (document.querySelector('link[data-golden-core-wash-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = STYLE_HREF;
  link.dataset.goldenCoreWashStyle = '1';
  document.head.appendChild(link);
}

export function createGoldenCoreWashAnimation(previousCore, previousType) {
  ensureWashStyle();
  document.getElementById(OVERLAY_ID)?.remove();

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'gc-wash-overlay is-washing';
  overlay.innerHTML = [
    '<section class="gc-wash-panel" role="dialog" aria-modal="true" aria-label="本命金丹洗髓" tabindex="-1">',
      '<div class="gc-wash-kicker">INNER ALCHEMY · 洗髓</div>',
      '<h2 class="gc-wash-title">洗髓重塑</h2>',
      '<p class="gc-wash-status" role="status" aria-live="polite">靈氣匯聚，正在重塑本命金丹……</p>',
      '<div class="gc-wash-scene" aria-hidden="true">',
        '<div class="gc-wash-seal seal-outer"></div>',
        '<div class="gc-wash-seal seal-inner"></div>',
        '<div class="gc-wash-orbit orbit-one"></div>',
        '<div class="gc-wash-orbit orbit-two"></div>',
        '<div class="gc-wash-sparks"></div>',
        '<div class="gc-wash-flash"></div>',
        '<div class="gc-wash-core"><span class="gc-wash-core-icon"></span></div>',
        '<div class="gc-wash-core-shadow"></div>',
      '</div>',
      '<div class="gc-wash-result" aria-live="polite">',
        '<span class="gc-wash-result-label">洗髓進行中</span>',
        '<strong class="gc-wash-result-name">丹相尚未揭曉</strong>',
        '<p class="gc-wash-result-note">原本調御中的金丹將持續生效。</p>',
      '</div>',
      '<button class="gc-wash-continue" type="button" hidden>返回修煉</button>',
    '</section>'
  ].join('');

  const panel = overlay.querySelector('.gc-wash-panel');
  const core = overlay.querySelector('.gc-wash-core');
  const icon = overlay.querySelector('.gc-wash-core-icon');
  const status = overlay.querySelector('.gc-wash-status');
  const label = overlay.querySelector('.gc-wash-result-label');
  const name = overlay.querySelector('.gc-wash-result-name');
  const note = overlay.querySelector('.gc-wash-result-note');
  const button = overlay.querySelector('.gc-wash-continue');
  const sparks = overlay.querySelector('.gc-wash-sparks');
  const originalFocus = document.activeElement;
  let finished = false;

  core.classList.add('core-tone-' + previousType.tone);
  icon.textContent = previousType.icon;
  for (let i = 0; i < 20; i += 1) {
    const spark = document.createElement('i');
    spark.style.setProperty('--angle', (i * 18) + 'deg');
    spark.style.setProperty('--delay', ((i % 5) * 0.13) + 's');
    sparks.appendChild(spark);
  }
  document.body.appendChild(overlay);
  panel.focus({ preventScroll: true });

  function close() {
    if (!finished) return;
    document.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();
    // 洗髓完成後金丹頁已重新渲染，應聚焦新的操作鍵而非已移除的舊節點。
    const washButton = document.getElementById('wash-golden-core');
    if (washButton) washButton.focus({ preventScroll: true });
    else if (originalFocus?.isConnected) originalFocus.focus({ preventScroll: true });
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && finished) {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      (finished ? button : panel).focus({ preventScroll: true });
    }
  }

  document.addEventListener('keydown', onKeyDown, true);
  button.addEventListener('click', close);

  function finish(kind, title, detail, message) {
    finished = true;
    overlay.classList.remove('is-washing');
    overlay.classList.add(kind);
    status.textContent = title;
    label.textContent = title;
    name.textContent = detail;
    note.textContent = message;
    button.hidden = false;
    button.focus({ preventScroll: true });
  }

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  const minimumDuration = new Promise((resolve) => {
    setTimeout(resolve, reduceMotion ? 0 : MINIMUM_WASH_MS);
  });

  return {
    minimumDuration,
    reveal(freshCore, freshType) {
      core.classList.remove('core-tone-' + previousType.tone);
      core.classList.add('core-tone-' + freshType.tone);
      icon.textContent = freshType.icon;
      finish('is-revealed', '洗髓完成', freshCore.grade + ' 品 · ' + freshType.name,
        '新丹相已保存，但尚未調御；原本金丹仍持續生效。');
    },
    fail() {
      finish('is-failed', '洗髓未完成', '金丹重塑中斷',
        '本機顯示已還原，請重新整理確認靈石與丹相。');
    }
  };
}
