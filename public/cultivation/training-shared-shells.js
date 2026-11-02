// 築基與金丹共用的裝備和煉器預載骨架；正式畫面由裝備及煉器模組接管。
export function equipmentShellMarkup() {
    const slots = [
      ['本命法寶', 'fa-khanda']
    ];
    return `
      <section class="uib-equipment-panel uib-equipment-shell" aria-label="法寶裝配欄" aria-busy="true">
        <div class="uib-equipment-head"><b><i class="fa-solid fa-shield-halved"></i> 本命法器</b><em>0 / 1</em></div>
        <div class="uib-equipment-grid">
          ${slots.map(([slot, icon]) => `<button type="button" class="uib-equip-slot is-empty" disabled>
            <span class="uib-equip-slot-label"><i class="fa-solid ${icon}"></i> ${slot}</span>
            <span class="uib-equip-slot-frame"><i class="fa-solid fa-plus"></i></span>
            <b class="uib-equip-slot-name">空裝備欄</b>
            <small class="uib-equip-slot-hint">載入裝備資料中</small>
          </button>`).join('')}
        </div>
      </section>
    `;
  }

export function refineryShellMarkup() {
    const materialCells = Array.from({ length: 8 }, (_, index) =>
      `<div class="refinery-shell-material" aria-hidden="true"><span class="refinery-shell-icon"></span><span class="refinery-shell-line"></span><small>材料 ${index + 1}</small></div>`
    );
    const materials = materialCells.slice(0, 4).join('');
    const artifacts = materialCells.slice(4).join('');
    const directions = ['乾','坎','艮','震','巽','離','坤','兌'];
    const slots = directions.map((direction, index) =>
      `<button type="button" class="refinery-slot" data-refinery-slot="${index}" disabled aria-label="空陣位 ${direction}"><span class="idx">${index + 1}</span><span class="remove">×</span><span class="direction">${direction}</span><span><span class="icon">＋</span><span class="name"></span></span></button>`
    ).join('');
    return `
      <section class="cultivation-refinery refinery-simple refinery-shell" aria-busy="true">
        <article class="refinery-panel refinery-material-panel">
          <div class="refinery-material-list">
            <section class="refinery-material-roll" data-refinery-material-roll="artifacts">
              <div class="refinery-group-title"><span><b class="refinery-step">1</b> 選本命法器</span><span>載入中</span></div>
              <div class="refinery-shell-material-grid refinery-material-roll-body">${artifacts}</div>
            </section>
            <section class="refinery-material-roll" data-refinery-material-roll="materials">
              <div class="refinery-group-title"><span><b class="refinery-step">2</b> 加入材料</span><span>合計 2～8 件</span></div>
              <div class="refinery-shell-material-grid refinery-material-roll-body">${materials}</div>
            </section>
          </div>
        </article>
        <article class="refinery-panel refinery-forge-panel">
          <div class="refinery-head"><div><h3><b class="refinery-step">3</b> 本命法器精煉</h3><p>點選材料放入，點陣位取回。</p></div></div>
          <div class="refinery-selection-tools refinery-shell-actions"><span class="refinery-badge">0/8 件</span><button type="button" class="refinery-clear" disabled>重新選擇</button></div>
          <div class="refinery-array-wrap">
            <div class="refinery-slots refinery-shell-array" aria-label="八方煉器陣">
              <span class="refinery-array-lines"></span>
              <span class="refinery-array-ring"></span>
              ${slots}
              <div class="refinery-array-center">
                <button type="button" class="refinery-craft" disabled>
                  <i class="fa-solid fa-fire-flame-curved"></i>
                  <span class="craft-main">開始精煉</span>
                  <span class="craft-sub">待選材料</span>
                </button>
              </div>
              <span class="refinery-array-caption">八方聚靈 · 一器成形</span>
            </div>
          </div>
          <div class="refinery-match refinery-shell-match">先選本命法器，再加入材料。</div>
          <details class="refinery-advanced"><summary>更多設定與配方</summary><div class="refinery-advanced-body refinery-shell-summary">載入中</div></details>
        </article>
      </section>
    `;
  }

