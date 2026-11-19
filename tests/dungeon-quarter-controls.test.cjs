'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const source=read('public/cultivation/dungeon-quarter-controls.js');
const {dungeonEnergySegments,dungeonQuarterControlsHTML,energyRingFill}=
  new Function(source.replace(/^export /gm,'')+
    '\nreturn {dungeonEnergySegments,dungeonQuarterControlsHTML,energyRingFill};')();
const viewer=read('public/cultivation/dungeon-map-view.js');
const css=read('public/styles/dungeon-quarter-controls.css');

test('trial-like HUD has exactly two bottom quarter circles and all action slots',()=>{
  const html=dungeonQuarterControlsHTML();
  assert.equal((html.match(/class="dm-quarter dm-quarter-/g)||[]).length,2);
  for(const sel of ['data-dm-quarter-energy','data-dm-wheel',
      'data-dm-charge-slot','data-dm-strike-slot','data-dm-move-slot',
      'data-dm-wheel-skills','data-dm-wheel-move','data-dm-wheel-attack']){
    assert.ok(html.includes(sel),'missing '+sel);
  }
  assert.match(html,/data-dm="wheel-attack" aria-pressed="true"/);
  assert.match(html,/data-dm="wheel-move" aria-pressed="false"/);
});

test('ten nondegenerate stamina arc segments lie within the left quarter',()=>{
  const html=dungeonEnergySegments();
  assert.equal((html.match(/data-dm-energy-segment="/g)||[]).length,10);
  const paths=[...html.matchAll(/data-dm-energy-segment="(\d+)" d="M ([\d.]+) ([\d.]+) A 91 91 0 0 1 ([\d.]+) ([\d.]+)"/g)];
  assert.equal(paths.length,10);
  for(const [i,entry] of paths.entries()){
    assert.equal(Number(entry[1]),i);
    for(const number of entry.slice(2)){
      assert.ok(Number(number)>=0&&Number(number)<=100);
    }
    assert.notDeepEqual([entry[2],entry[3]],[entry[4],entry[5]]);
  }
});

test('stamina ring clamps and is monotone across player energy',()=>{
  assert.deepEqual([-4,0,1,10,11,50,99,100,1000,NaN].map(energyRingFill),
    [0,0,1,1,2,5,10,10,10,0]);
});

test('existing server-authorized quiz, strike and four movement buttons are MOVED, not cloned',()=>{
  assert.match(viewer,/append\(charge\)/);
  assert.match(viewer,/charge\.append\(stamina,label\)/);
  assert.match(viewer,/data-dm-strike-slot[^]*?append\([\s\S]*?data-dm="strike"/);
  assert.match(viewer,/data-dm-move-slot[^]*?append\([\s\S]*?\.dm-dpad/);
  assert.match(viewer,/getDungeonMap\(roomId\)/);
  assert.match(viewer,/moveDungeonMember\(roomId,dx,dy,step\)/);
  assert.match(viewer,/strikeDungeonBeast\(roomId,enemy\.id,seq\)/);
  assert.match(viewer,/castDungeonSkill\(roomId,skillId,target,seq\)/);
});

test('skill controls remain usable without opening the optional loadout popup',()=>{
  assert.match(viewer,/!this\.manualOpen\|\|this\.inspectOpen/);
  assert.match(viewer,/if\(!active\)return;/);
  assert.match(viewer,/\[data-dm-wheel-skills\]/);
  assert.match(viewer,/\[data-dm-skills\] button,\[data-dm-wheel-skills\] button/);
  assert.match(viewer,/if\(name==='wheel-attack'\)/);
  assert.match(viewer,/if\(name==='wheel-move'\)/);
  assert.match(viewer,/if\(name==='loadouts'\)/);
  assert.match(viewer,/this\.wheelSwipeSuppressUntil=Date\.now\(\)\+350/);
});

test('map canvas is full bleed and both quarter wheels fit landscape and portrait',()=>{
  assert.match(css,/\.dm-shell\{\s*width:100%!important;height:100%!important/);
  assert.match(css,/\.dm-world\{\s*position:absolute;inset:0;width:100%;height:100%/);
  assert.match(css,/\.dm-quarter\{[^}]*position:absolute;bottom:0;/);
  assert.match(css,/\.dm-quarter-energy\{[^}]*left:0;border-radius:0 100% 0 0/);
  assert.match(css,/\.dm-quarter-action\{[^}]*right:0;border-radius:100% 0 0 0/);
  assert.match(css,/@media\(orientation:portrait\)/);
  assert.match(css,/@media\(orientation:landscape\) and \(max-height:460px\)/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});
