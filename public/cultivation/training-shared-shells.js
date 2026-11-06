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
  return `<section class="cultivation-refinery refinery-shell" aria-busy="true">
    <div class="refinery-head"><div><h3>法器煉製</h3><p>正在載入法器、碎片與升級石…</p></div></div>
  </section>`;
}
