'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const quarter=read('public/cultivation/dungeon-quarter-controls.js');
const {dungeonFocusCharges,dungeonFocusEmpowers,dungeonQuarterControlsHTML}=
  new Function(quarter.replace(/^export /gm,'')+
    '\nreturn {dungeonFocusCharges,dungeonFocusEmpowers,dungeonQuarterControlsHTML};')();
const view=read('public/cultivation/dungeon-map-view.js');
const effectCss=read('public/styles/dungeon-map-view.css');
const wheelCss=read('public/styles/dungeon-quarter-controls.css');
const painterSource=read('public/cultivation/dungeon-map-painter.js');
const camSource=read('public/cultivation/dungeon-map-camera.js');
const camera=new Function(camSource.replace(/^export /gm,'')+
  '\nreturn {initialCamera,geometry,visibleTiles};')();
const painter=new Function('Camera',
  painterSource.replace(/^import .*$/gm,'').replace(/^export /gm,'')+
  '\nreturn {drawWorld};')(camera);

test('focus count uses server snapshot only and clamps six-cast duration',()=>{
  assert.equal(dungeonFocusCharges(null),0);
  assert.equal(dungeonFocusCharges({focusCharges:'6'}),0);
  assert.deepEqual([6,5,4,3,2,1,0,-1,12].map(n=>
    dungeonFocusCharges({focusCharges:n})),[6,5,4,3,2,1,0,0,6]);
});

test('only non-focus body techniques become golden, never sword or focus activation',()=>{
  const body={school:'body',kind:'fist-chain'};
  const prepare={school:'body',kind:'fist-focus'};
  const sword={school:'sword',kind:'line'};
  assert.equal(dungeonFocusEmpowers({focusCharges:6},body),true);
  assert.equal(dungeonFocusEmpowers({focusCharges:1},body),true);
  assert.equal(dungeonFocusEmpowers({focusCharges:0},body),false);
  assert.equal(dungeonFocusEmpowers({focusCharges:6},prepare),false);
  assert.equal(dungeonFocusEmpowers({focusCharges:6},sword),false);
});

test('right action wheel receives actual gold styling, including not-yet-aimed buttons',()=>{
  assert.match(wheelCss,/\.dm-wheel-core button\.is-focus-empowered\{/);
  assert.match(wheelCss,/background:linear-gradient\(115deg,#fff3c1/);
  assert.match(wheelCss,/\.dm-wheel-core button\.is-focus-empowered:disabled\{[^}]*opacity:\.86!important/s);
  assert.match(wheelCss,/@keyframes dmFocusGoldSkill/);
  assert.doesNotMatch(wheelCss,/is-focus-empowered\{\s*color:#ffebb5/);
  assert.match(quarter,/dungeonFocusEmpowers/);
  assert.match(view,/dungeonFocusEmpowers\(member,skill\)/);
  assert.match(view,/\[data-dm-skills\] button,\[data-dm-wheel-skills\] button/);
});

test('a persistent focus badge is wired to room updates and vanishes at zero',()=>{
  assert.match(dungeonQuarterControlsHTML(),/data-dm-focus-indicator hidden/);
  assert.match(view,/badge\.hidden=!active\|\|charges===0/);
  assert.match(view,/badge\.textContent=charges>0\?'✦ 金身蓄勢 '/);
  assert.match(view,/renderDungeonTrialWheel\(wheel/);
});

test('aura is attached to the same camera-aligned per-member layer, not an opaque character mask',()=>{
  assert.match(view,/updateFocusAuras\(geometry\)/);
  assert.match(view,/member\?\.focusCharges/);
  assert.match(view,/if\(!Number\.isSafeInteger\(charges\)\|\|charges<=0\|\|member\.downed/);
  for(const part of ['dm-focus-glow','dm-focus-flames','dm-focus-ring',
      'dm-focus-orbit','dm-spark-a','dm-spark-f','dm-focus-count'])
    assert.ok(view.includes(part),'missing '+part);
  assert.match(view,/if\(!present\.has\(uid\)\)\{aura\.remove\(\)/);
  assert.match(effectCss,/radial-gradient\(circle,\s*transparent 0 30%/);
  assert.match(effectCss,/prefers-reduced-motion:reduce/);
});

function fakeContext(){
  let circles=0;
  const context={
    measureText:t=>({width:String(t).length*9}),
    createRadialGradient:()=>({addColorStop(){}}),
    setLineDash(){},arc(){circles++}
  };
  for(const op of ['save','restore','fillRect','strokeRect','beginPath',
      'moveTo','lineTo','fill','stroke','fillText'])context[op]=()=>{};
  return {ctx:context,circles:()=>circles};
}
test('canvas paints extra surrounding golden rings only for actively focused living players',()=>{
  const map={mode:'dungeon',layoutVersion:1,width:20,height:14,
    tiles:Array(20*14).fill(1),biome:'ruins',
    seed:'golden-hero-test',spawn:{x:1,y:1},spawnPads:[{x:2,y:2}],
    guardianSite:{x:16,y:10},portalSite:{x:17,y:11},
    mainRoute:[],branches:[]};
  const original=JSON.stringify(map);
  const draw=(charges,downed=false)=>{
    const canvas=fakeContext();
    painter.drawWorld(canvas.ctx,map,camera.initialCamera(),720,420,{
      members:[{uid:'a',position:{x:6,y:6},battleHealth:100,focusCharges:charges,downed}],
      selfUid:'a',visualTimeMs:1200
    });
    return canvas.circles();
  };
  const normal=draw(0),focused=draw(6),lastCast=draw(1);
  assert.ok(focused>=normal+5,'active focus has one golden halo plus four sparks');
  assert.equal(lastCast,focused,'remaining charge still glows');
  assert.equal(draw(0),normal,'depleted focus removes the effect');
  assert.equal(draw(6,true),normal,'downed characters do not glow');
  assert.equal(JSON.stringify(map),original,'drawing never edits the server map');
});
