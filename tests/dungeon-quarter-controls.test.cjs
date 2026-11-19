'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const code=read('public/cultivation/dungeon-quarter-controls.js');
const {dungeonEnergySegments,energyRingFill}=new Function(
  code.replace(/^export /gm,'')+
  '\nreturn {dungeonEnergySegments,energyRingFill};')();
const wheel=read('public/cultivation/dungeon-trial-wheel.js');
const {dungeonTrialWheelHTML}=new Function('dungeonEnergySegments',
  wheel.replace(/^import .*$/gm,'').replace(/^export /gm,'')+
  '\nreturn {dungeonTrialWheelHTML};')(dungeonEnergySegments);
const view=read('public/cultivation/dungeon-map-view.js');
const css=read('public/styles/dungeon-trial-wheel.css');

test('only the two trial quarter circles are mounted; legacy wheel is not mounted',()=>{
  const html=dungeonTrialWheelHTML();
  assert.equal((html.match(/class="tc-quarter tc-quarter-/g)||[]).length,2);
  assert.match(html,/tc-quarter-energy/);
  assert.match(html,/tc-quarter-action/);
  assert.match(html,/tc-wheel-slider-action/);
  assert.match(html,/tc-wheel-slider-detail/);
  assert.doesNotMatch(html,/class="dm-quarter dm-quarter-/);
  assert.match(view,/insertAdjacentHTML\('beforeend',dungeonTrialWheelHTML\(\)\)/);
  assert.doesNotMatch(view,/dungeonQuarterControlsHTML\(/);
  assert.doesNotMatch(view,/dungeon-quarter-controls\.css/);
});
test('ten stamina segments exactly match original trial curvature',()=>{
  const html=dungeonEnergySegments();
  const arcs=[...html.matchAll(/data-dm-energy-segment="(\d+)" d="M ([\d.]+) ([\d.]+) A 90 90 0 0 1 ([\d.]+) ([\d.]+)"/g)];
  assert.equal(arcs.length,10);
  for(let i=0;i<10;i++)assert.equal(Number(arcs[i][1]),i);
  assert.deepEqual([-4,0,1,5,9,10,11,50,100,NaN].map(energyRingFill),
    [0,0,1,5,9,10,10,10,10,0]);
});
test('old onscreen panels, D-pad, map tools and legacy HUD are not in mounted HTML',()=>{
  const html=view.match(/root\.innerHTML=`([\s\S]*?)`;/)?.[1];
  assert.ok(html,'single battle template must exist');
  for(const old of ['dm-dpad','dm-controls','dm-overview','dm-legend',
      'dm-foot','dm-biome','dm-energy','dm-health','dm-team-status-bar',
      'data-dm="plus"','data-dm="minus"','data-dm="route"','data-dm="fit"']){
    assert.ok(!html.includes(old),'old UI remains: '+old);
  }
  assert.match(html,/dm-tactical-actions/);
  assert.match(html,/tc-boss-hud/);
  assert.match(html,/dm-tactical-loadout/);
  assert.match(html,/data-dm-health/); // only hidden live-announcement node
  assert.match(html,/dm-hidden-contract/);
  assert.match(view,/charge\.append\(stamina,label\)/);
  assert.doesNotMatch(view,/drawMinimap\(/);
});
test('the trial wheel is still operational without duplicate cast or quiz controls',()=>{
  assert.match(view,/data-dm-strike-slot[^]*?append\([\s\S]*?data-dm="strike"/);
  assert.match(view,/getDungeonMap\(roomId\)/);
  assert.match(view,/moveDungeonMember\(roomId,dx,dy,step\)/);
  assert.match(view,/strikeDungeonBeast\(roomId,enemy\.id,seq\)/);
  assert.match(view,/castDungeonSkill\(roomId,skillId,target,seq\)/);
  assert.match(view,/bindDungeonTrialWheel\(wheel/);
  assert.match(view,/if\(name==='loadouts'\)/);
});
test('visible shell, energy circle and attack selector mirror original trial styles',()=>{
  const tactical=read('public/styles/tactical-quarter-controls.css');
  const mirrored=tactical.replaceAll('#tactical-combat.tc-quarter-layout',
    '#dungeon-map-view.tc-quarter-layout')
    .replaceAll('#tactical-combat','#dungeon-map-view');
  assert.ok(css.includes(mirrored));
  assert.match(css,/\.dm-shell\{[\s\S]*?width:100%!important;height:100%!important/);
  assert.match(css,/\.dm-world[\s\S]*?cursor:crosshair!important/);
  assert.match(css,/@media\(orientation:portrait\)/);
});
