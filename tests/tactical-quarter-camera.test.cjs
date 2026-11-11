'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Camera=require('../public/cultivation/tactical-camera.js');
const base=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(base,p),'utf8');
const ui=read('public/cultivation/tactical-combat.js'),renderer=read('public/cultivation/tactical-renderer.js');
const css=read('public/styles/tactical-quarter-controls.css');
const view={x:0,y:0,width:9,height:7};
const size={w:800,h:530};

test('camera starts fitted and screen-to-tile selection follows original integer map',()=>{
  const cam=Camera.create(),g=Camera.geometry(cam,size.w,size.h,view);
  assert.equal(cam.zoom,1);
  assert.ok(g.cell>0);
  assert.deepEqual(Camera.tileAt(cam,g.ox+g.cell*3.5,g.oy+g.cell*2.5,size.w,size.h,view),{x:3,y:2});
});

test('zoom stays bounded, preserves focus and map tile under the pointer',()=>{
  const cam=Camera.create(),g=Camera.geometry(cam,size.w,size.h,view);
  const anchor={x:g.ox+g.cell*4.5,y:g.oy+g.cell*3.5};
  const enlarged=Camera.zoomAt(cam,1.5,anchor.x,anchor.y,size.w,size.h,view);
  const after=Camera.geometry(enlarged,size.w,size.h,view);
  assert.equal(enlarged.zoom,1.5);
  assert.ok(Math.abs((anchor.x-after.ox)/after.cell-4.5)<.01);
  assert.ok(Math.abs((anchor.y-after.oy)/after.cell-3.5)<.01);
  assert.deepEqual(Camera.tileAt(enlarged,anchor.x,anchor.y,size.w,size.h,view),{x:4,y:3});
  assert.equal(Camera.zoomAt(cam,100,200,200,size.w,size.h,view).zoom,Camera.MAX_ZOOM);
  assert.equal(Camera.zoomAt(cam,.01,200,200,size.w,size.h,view).zoom,Camera.MIN_ZOOM);
});

test('drag pans camera but cannot fling an entire map off the playable viewport',()=>{
  const zoomed=Camera.zoomAt(Camera.create(),2,400,250,size.w,size.h,view);
  const panned=Camera.pan(zoomed,150,52,size.w,size.h,view);
  assert.ok(panned.panX>zoomed.panX);
  assert.ok(panned.panY>zoomed.panY);
  const far=Camera.pan(zoomed,100000,-100000,size.w,size.h,view);
  const g=Camera.geometry(far,size.w,size.h,view);
  assert.equal(far.panX,g.limitX);
  assert.equal(far.panY,-g.limitY);
  assert.ok(Number.isFinite(g.ox)&&Number.isFinite(g.oy));
});

test('pan and pinch do not alter game state or server-authoritative tile geometry',()=>{
  const p=Camera.pan(Camera.create(),25,-13,size.w,size.h,view);
  const g=Camera.geometry(p,size.w,size.h,view);
  assert.deepEqual(Camera.tileAt(p,g.ox+2.1*g.cell,g.oy+5.1*g.cell,size.w,size.h,view),{x:2,y:5});
  assert.match(renderer,/canvas.addEventListener\('pointerdown',this.onPointerDown\)/);
  assert.match(renderer,/canvas.addEventListener\('pointermove',this.onPointerMove\)/);
  assert.match(renderer,/canvas.addEventListener\('pointerup',this.onPointerEnd\)/);
  assert.match(renderer,/canvas.addEventListener\('pointercancel',this.onPointerEnd\)/);
  assert.match(renderer,/canvas.addEventListener\('wheel',this.onWheel,\{passive:false\}\)/);
  assert.match(renderer,/this\.suppressClickUntil=Date\.now\(\)\+500/);
  assert.match(renderer,/Date\.now\(\)<this\.suppressClickUntil/);
  assert.match(renderer,/Camera\.tileAt\(/);
  assert.match(renderer,/this\.camera=Camera\.create\(\)/);
  assert.doesNotMatch(ui,/postMessage|window\.location\.reload\(\)/);
});

test('PvE follows the sketch: central map, left energy and right three actions only',()=>{
  for(const marker of [
    "className='tc-quarter tc-quarter-energy'",
    "className='tc-quarter tc-quarter-action'",
    "className='tc-sector tc-sector-attack'",
    "className='tc-sector tc-sector-move'",
    "className='tc-sector tc-sector-end'",
    "attack.innerHTML='<span>攻擊</span>'",
    "move.innerHTML='<span>移動</span>'",
    "data-energy-number","data-energy-tick",
    "querySelector('[data-stamina]')",
    "querySelector('[data-quiz]')"
  ])assert.ok(ui.includes(marker),marker);
  for(const forbidden of ['tc-energy-rule','tc-actions-caption','tc-map-gesture','地圖置中']){
    assert.ok(!ui.includes(forbidden),'no unrequested UI: '+forbidden);
  }
  for(const hidden of ['tc-arena-heading','tc-selection','tc-actors','tc-skill-info',
    'tc-game-footer','tc-turn-buttons','data-execute','data-action="skill"']){
    assert.ok(css.includes(hidden),'the extra interface remains invisible: '+hidden);
  }
  assert.match(css,/\.tc-quarter-energy\{[\s\S]*?border-radius:0 100% 0 0/);
  assert.match(css,/\.tc-quarter-action\{[\s\S]*?border-radius:100% 0 0 0/);
  assert.match(css,/touch-action:none!important/);
  assert.match(css,/\.tc-top\{[\s\S]*?display:flex!important/);
  assert.match(css,/\.tc-top \[data-close\]\{/);
  assert.match(ui,/data-close aria-label="收起戰場">收起<\/button>/);
  assert.match(css,/@media\(orientation:portrait\)/);
});

test('PvE uses tap-to-act, retaining server-authoritative quiz and turn actions',()=>{
  for(const marker of ['data-action="move"','data-action="attack"','data-action="skill"',
    'data-guard','data-end','data-execute','data-quiz']){
    assert.ok(ui.includes(marker),marker);
  }
  for(const marker of [
    "send({type:'guard'})","send({type:'end'})",
    "renderer?.resetView()",'void question()','void execute()',
    "['move','attack'].includes(action)",
    "root.classList.toggle('tc-quarter-layout',state?.mode==='pve')",
    "root.classList.remove('tc-quarter-layout')"
  ])assert.ok(ui.includes(marker),marker);
  assert.doesNotMatch(ui,/LIMITS\.stamina\s*=/);
  assert.match(css,/#tactical-combat\.tc-quarter-layout/);
});
