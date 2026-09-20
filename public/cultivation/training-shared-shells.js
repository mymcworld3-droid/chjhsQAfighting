// 築基與金丹共用的裝備和煉器預載骨架；正式畫面由裝備及煉器模組接管。
export function equipmentShellMarkup() {
    const slots = [
      ['本命法寶', 'fa-khanda'],
      ['護身法寶', 'fa-shield-halved'],
      ['佩飾法寶', 'fa-gem'],
      ['輔助法寶', 'fa-wand-magic-sparkles']
    ];
    return `
      <section class="uib-equipment-panel uib-equipment-shell" aria-label="法寶裝配欄" aria-busy="true">
        <div class="uib-equipment-head"><b><i class="fa-solid fa-shield-halved"></i> 法寶裝配</b><em>0 / 4</em></div>
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
      <section class="cultivation-refinery refinery-shell" aria-busy="true">
        <article class="refinery-panel refinery-material-panel">
          <div class="refinery-material-list">
            <section class="refinery-material-roll">
              <div class="refinery-group-title"><span><i class="fa-solid fa-gem"></i> 持有煉器素材 · 一般素材</span><span>載入中</span></div>
              <div class="refinery-shell-material-grid refinery-material-roll-body">${materials}</div>
            </section>
            <section class="refinery-material-roll">
              <div class="refinery-group-title"><span><i class="fa-solid fa-recycle"></i> 二次煉製</span><span>載入中</span></div>
              <div class="refinery-shell-material-grid refinery-material-roll-body">${artifacts}</div>
            </section>
          </div>
        </article>
        <article class="refinery-panel refinery-forge-panel">
          <div class="refinery-head"><div><h3><i class="fa-solid fa-fire-burner"></i> 八方煉器陣</h3><p>八方歸位，陣心煉器；法陣已預先建立。</p></div><span class="refinery-badge">0/8</span></div>
          <div class="refinery-array-wrap">
            <div class="refinery-slots refinery-shell-array" aria-label="八方煉器陣">
              <span class="refinery-array-lines"></span>
              <span class="refinery-array-ring"></span>
              ${slots}
              <div class="refinery-array-center">
                <button type="button" class="refinery-craft" disabled>
                  <i class="fa-solid fa-fire-flame-curved"></i>
                  <span class="craft-main">煉製</span>
                  <span class="craft-sub">REFINE</span>
                </button>
              </div>
              <span class="refinery-array-caption">八方聚靈 · 一器成形</span>
            </div>
          </div>
          <div class="refinery-shell-summary">投入：尚未投入材料</div>
          <div class="refinery-shell-match">放入材料後，依材料數量自動辨識法寶配方。</div>
          <div class="refinery-shell-actions"><button type="button" disabled><i class="fa-solid fa-rotate-left"></i> 清空陣位</button></div>
        </article>
      </section>
    `;
  }

