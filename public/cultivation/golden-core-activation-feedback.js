// 金丹功能真正發動時的統一視覺提示。
(function () {
  'use strict';

  const ICONS = {
    ocean: '🌊',
    taichu: '☀️',
    ningxin: '◈',
    pojing: '✦',
    xingchen: '✧',
    wugou: '◇',
    thunder: '⚡',
    reverse: '↺',
    sword: '⚔️'
  };

  const queue = [];
  const recent = new Map();
  let showing = false;

  function ensureStyle() {
    if (document.getElementById('golden-core-activation-style')) return;
    const style = document.createElement('style');
    style.id = 'golden-core-activation-style';
    style.textContent = `
      #golden-core-activation-banner{
        position:fixed;left:50%;top:78px;z-index:7800;
        width:min(calc(100vw - 28px),430px);
        transform:translate(-50%,-18px) scale(.96);
        opacity:0;pointer-events:none;
        transition:opacity .2s ease,transform .24s ease;
      }
      #golden-core-activation-banner.show{opacity:1;transform:translate(-50%,0) scale(1)}
      .golden-core-activation-card{
        display:grid;grid-template-columns:52px 1fr;gap:13px;align-items:center;
        padding:14px 16px;border-radius:20px;
        border:1px solid rgba(229,190,92,.72);
        background:linear-gradient(145deg,rgba(27,21,10,.985),rgba(5,5,5,.99));
        box-shadow:0 18px 55px rgba(0,0,0,.62),0 0 28px rgba(216,177,93,.16),inset 0 1px rgba(255,255,255,.05);
        overflow:hidden;position:relative;
      }
      .golden-core-activation-card::before{
        content:'';position:absolute;inset:-70% -20%;pointer-events:none;
        background:linear-gradient(110deg,transparent 35%,rgba(255,226,146,.13) 48%,transparent 61%);
        animation:goldenCoreActivationSweep 1.25s ease-out;
      }
      @keyframes goldenCoreActivationSweep{from{transform:translateX(-45%)}to{transform:translateX(45%)}}
      .golden-core-activation-icon{
        width:52px;height:52px;border-radius:50%;display:grid;place-items:center;
        font-size:25px;color:#f3d47d;border:1px solid rgba(229,190,92,.55);
        background:radial-gradient(circle at 35% 30%,rgba(246,211,121,.24),rgba(38,24,5,.9));
        box-shadow:0 0 24px rgba(216,177,93,.23);
      }
      .golden-core-activation-kicker{font-size:9px;font-weight:900;letter-spacing:.18em;color:#a98a49;margin-bottom:2px}
      .golden-core-activation-name{font-size:15px;font-weight:900;color:#fff0c9;line-height:1.25}
      .golden-core-activation-message{margin-top:4px;font-size:11px;line-height:1.5;color:#c9b992}
      .golden-core-activation-kind{color:#8f7d59;font-size:9px;margin-top:3px}
      @media(max-width:520px){#golden-core-activation-banner{top:64px}.golden-core-activation-card{grid-template-columns:44px 1fr;padding:12px 13px}.golden-core-activation-icon{width:44px;height:44px;font-size:21px}}
    `;
    document.head.appendChild(style);
  }

  function normalize(input) {
    const data = typeof input === 'string' ? { message: input } : (input || {});
    const equipped = window.getEquippedGoldenCoreState?.() || null;
    const type = data.type || equipped?.type || '';
    return {
      type,
      icon: data.icon || ICONS[type] || '◆',
      name: data.name || equipped?.name || '金丹',
      message: data.message || '金丹神通發動',
      kind: data.kind || ''
    };
  }

  function drain() {
    if (showing || !queue.length) return;
    showing = true;
    ensureStyle();
    const data = queue.shift();

    document.getElementById('golden-core-activation-banner')?.remove();
    const el = document.createElement('div');
    el.id = 'golden-core-activation-banner';
    el.innerHTML = `
      <div class="golden-core-activation-card">
        <div class="golden-core-activation-icon">${data.icon}</div>
        <div>
          <div class="golden-core-activation-kicker">金丹神通發動</div>
          <div class="golden-core-activation-name">${data.name}</div>
          <div class="golden-core-activation-message">${data.message}</div>
          ${data.kind ? `<div class="golden-core-activation-kind">${data.kind}</div>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));

    setTimeout(() => el.classList.remove('show'), 1900);
    setTimeout(() => {
      el.remove();
      showing = false;
      drain();
    }, 2180);
  }

  window.showGoldenCoreActivation = function (input) {
    const data = normalize(input);
    const key = `${data.type}|${data.name}|${data.message}`;
    const now = Date.now();
    const previous = recent.get(key) || 0;
    if (now - previous < 1000) return;
    recent.set(key, now);
    if (recent.size > 30) {
      for (const [item, time] of recent) if (now - time > 10000) recent.delete(item);
    }
    queue.push(data);
    drain();
  };

  window.addEventListener('golden-core:activated', (event) => {
    window.showGoldenCoreActivation(event.detail || {});
  });
})();
