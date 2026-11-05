// One stage template for ranked duels and the trial tower.
export function portraitMarkup(id) {
  return `<div id="${id}" class="bv2-stage-fighter"><img alt="修士立繪" loading="eager" decoding="async" hidden><span class="bv2-stage-portrait-fallback" aria-hidden="true"><i class="fa-solid fa-user-ninja"></i></span></div>`;
}
export function duelArenaMarkup({prefix='bv2',maxRounds=15}={}) {
  return `<section id="bv2-arena" class="bv2-arena hidden">
          <article id="bv2-enemy-status" class="bv2-status-panel enemy">
            <div class="bv2-fighter-head"><div><span>對手</span><strong id="bv2-enemy-name">—</strong></div><b id="bv2-enemy-hp-text">1000</b></div>
            <div class="bv2-hp"><i id="bv2-enemy-hp"></i></div><small id="bv2-enemy-core">本命金丹：—</small>
          </article>
          <div class="bv2-stage-round"><span>回合</span><b id="bv2-round">1 / ${maxRounds}</b><span id="bv2-cultivation-pool">修為池 0</span></div>
          <div class="bv2-stage" aria-label="雙人鬥法場">
            <div class="bv2-stage-architecture" aria-hidden="true"><i></i><i></i><i></i></div>
            <div class="bv2-stage-aura" aria-hidden="true"><i></i><i></i><i></i></div>
            <div class="bv2-stage-motes" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
            <div class="bv2-stage-platform" aria-hidden="true"></div>
            ${portraitMarkup('bv2-my-fighter')}
            ${portraitMarkup('bv2-enemy-fighter')}
            <div class="bv2-stage-center" aria-hidden="true">鬥</div>
          </div>
          <article id="bv2-my-status" class="bv2-status-panel me">
            <div class="bv2-fighter-head"><div><span>我方</span><strong id="bv2-my-name">—</strong></div><b id="bv2-my-hp-text">1000</b></div>
            <div class="bv2-hp"><i id="bv2-my-hp"></i></div><small id="bv2-my-core">本命金丹：—</small>
          </article>
          <div class="bv2-duel-rule"><i class="fa-solid fa-hourglass-half"></i><span>本題<strong>不限讀題時間</strong>；任一方先答後，另一方才開始 <strong>25 秒</strong> 倒數。</span></div>

          <div id="bv2-duel-cue" class="bv2-duel-cue" aria-live="polite">
            <span id="bv2-cue-kicker">鬥法開始</span>
            <strong id="bv2-cue-count">3</strong>
            <p id="bv2-cue-message">凝神備戰，即將進入題目</p>
          </div>

        </section>`.replaceAll('id="bv2-', 'id="'+prefix+'-');
}
