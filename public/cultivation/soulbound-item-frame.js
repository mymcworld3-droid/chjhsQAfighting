// A normal rounded artifact frame with one small point on each side.
// Its 0–100 body keeps the ordinary icon size; the four points extend 8%.
const OUTLINE = 'M24 0H42L50 -8L58 0H76Q100 0 100 24V42L108 50L100 58V76Q100 100 76 100H58L50 108L42 100H24Q0 100 0 76V58L-8 50L0 42V24Q0 0 24 0Z';

export function soulboundItemFrameMarkup() {
  return `<svg class="soulbound-item-frame" viewBox="-8 -8 116 116" aria-hidden="true" focusable="false" style="position:absolute;inset:-8%;width:116%;height:116%;overflow:visible;pointer-events:none;z-index:-1;filter:drop-shadow(0 0 8px var(--soulbound-frame-glow,transparent))"><path d="${OUTLINE}" fill="var(--soulbound-frame-fill)" stroke="var(--soulbound-frame-stroke)" stroke-width="1" vector-effect="non-scaling-stroke"/><path d="${OUTLINE}" transform="translate(3 3) scale(.94)" fill="none" stroke="var(--soulbound-frame-inset,transparent)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}
