const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
const source = read('cultivation/battle-mode-v2.js');
const styles = read('styles/battle-mode-v2.css');

function stageController() {
  const from = source.indexOf('  function portraitMarkup(id) {');
  const to = source.indexOf('  function ensurePage() {', from);
  assert.ok(from >= 0 && to > from);
  const nodes = new Map();
  const classes = new Map();
  const context = {
    document: { getElementById: id => nodes.get(id) || null },
    userData: () => ({ storyProgressV1: { gender: 'female' } })
  };
  vm.runInNewContext(source.slice(from, to) + '\nthis.stage={portraitMarkup,setPlayerPortrait}', context);
  function mount(id) {
    const img = { dataset: {}, hidden: true, loads: 0, _src: '',
      set src(s) { this._src = s; this.loads++; },
      get src() { return this._src; }
    };
    const fallback = { hidden: false };
    const cls = new Map();
    classes.set(id,cls);
    nodes.set(id, {
      classList: { toggle(name, on) { cls.set(name, on); } },
      querySelector(query) {
        if (query === 'img') return img;
        if (query === '.bv2-stage-portrait-fallback') return fallback;
        return null;
      }
    });
    return { img, fallback, cls };
  }
  return { mount, stage: context.stage };
}

test('formal arena shows enemy HP above center portraits and own HP below; no visible attack log', () => {
  const scene = source.slice(source.indexOf('<section id="bv2-arena"'), source.indexOf('<section id="bv2-quiz"'));
  const upper = scene.indexOf('id="bv2-enemy-hp"');
  const stage = scene.indexOf('class="bv2-stage"');
  const mine = scene.indexOf('id="bv2-my-hp"');
  assert.ok(upper > 0 && stage > upper && mine > stage);
  assert.match(scene, /portraitMarkup\('bv2-my-fighter'\)/);
  assert.match(scene, /portraitMarkup\('bv2-enemy-fighter'\)/);
  assert.doesNotMatch(scene, /bv2-scoreboard|bv2-log-wrap|bv2-log|bv2-arena-me-avatar/);
  assert.doesNotMatch(source, /function renderLogs|renderLogs\(room\)/);
  assert.match(styles, /\.bv2-stage-fighter\.me\{left:3%\}/);
  assert.match(styles, /\.bv2-stage-fighter\.enemy\{right:3%\}/);
  assert.match(styles, /\.bv2-stage-fighter\.me\.strike/);
  assert.match(styles, /\.bv2-stage-fighter\.enemy\.hit/);
  assert.match(styles, /\.bv2-status-panel\.enemy/);
  assert.match(styles, /@media\(max-width:620px\)/);
  assert.match(styles, /prefers-reduced-motion/);
});

test('player snapshots include chosen gender so remote user gets their own portrait, not local gender', () => {
  assert.match(source, /gender: data\.storyProgressV1\?\.gender === 'female' \? 'female' : 'male'/);
  assert.match(source, /setPlayerPortrait\('bv2-my-fighter', mine, true\)/);
  assert.match(source, /setPlayerPortrait\('bv2-enemy-fighter', enemy\)/);
  const {stage,mount} = stageController();
  const mine = mount('my');
  const enemy = mount('enemy');
  assert.match(stage.portraitMarkup('my'), /loading="eager"/);
  stage.setPlayerPortrait('my', {gender:'male',name:'甲'}, true);
  stage.setPlayerPortrait('enemy', {gender:'female',name:'乙'});
  assert.equal(mine.img.src,'assets/story/characters/player-male-determined.png');
  assert.equal(enemy.img.src,'assets/story/characters/player-female-determined.png');
  assert.equal(mine.cls.get('me'),true);
  assert.equal(enemy.cls.get('enemy'),true);
  assert.equal(mine.img.hidden,true);
  mine.img.onload();
  assert.equal(mine.img.hidden,false);
  assert.equal(mine.fallback.hidden,true);
  stage.setPlayerPortrait('my', {gender:'male',name:'甲'}, true);
  assert.equal(mine.img.loads,1);
  enemy.img.onerror();
  assert.equal(enemy.fallback.hidden,false);
  assert.equal(enemy.img.hidden,true);
});

test('old rooms without gender render local chosen portrait and a stable enemy fallback', () => {
  const {stage,mount} = stageController();
  const mine = mount('my');
  const enemy = mount('enemy');
  stage.setPlayerPortrait('my', {}, true);
  stage.setPlayerPortrait('enemy', {});
  assert.equal(mine.img.src, 'assets/story/characters/player-female-determined.png');
  assert.equal(enemy.img.src, 'assets/story/characters/battle-rival.png');
});

test('hit point numbers update after impact, retaining server-side step order and settlement gates', () => {
  const animate = source.slice(source.indexOf('  function animateSettlement(room) {'), source.indexOf('  async function confirmReview() {'));
  assert.match(animate, /index \* ANIMATION_STEP_MS/);
  assert.match(animate, /if \(!state\.roomId \|\| state\.seenSettlementKey !== key/);
  assert.match(animate, /target\?\.classList\.add\('hit'\)/);
  assert.match(animate, /setHp\('my'[\s\S]*setHp\('enemy'/);
  assert.match(animate, /\}, 190\)\)/);
  assert.match(animate, /state\.animationFinishedKey = key/);
  assert.match(styles, /@keyframes bv2StageAttackMe/);
  assert.match(styles, /@keyframes bv2StageAttackEnemy/);
  assert.match(styles, /@keyframes bv2StageHitMe/);
  assert.match(styles, /@keyframes bv2StageHitEnemy/);
});
