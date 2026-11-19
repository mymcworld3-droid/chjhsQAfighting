'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const source=read('public/cultivation/dungeon-threat-plan.js');
const {dungeonThreatPlan}=new Function(source.replace(/^export /gm,'')+
  '\nreturn {dungeonThreatPlan};')();
const map={width:9,height:9,tiles:Array(81).fill(1)};
const attack=(id,kind,cells,position={x:4,y:2})=>({
  id,kind,position,attack:{from:{...position},cells,resolvesAtTick:3}
});
const members=[{uid:'a',position:{x:4,y:4},battleHealth:2000,
  battleMaxHealth:2000}];
test('shared trial warning plan combines adjacent enemy telegraphs into one outline',()=>{
  const a=attack('beast-1','wolf',[{x:4,y:4},{x:4,y:5}]);
  const b=attack('guardian-1','guardian',[{x:4,y:4},{x:5,y:4}]);
  const plan=dungeonThreatPlan(map,[a,b],members,'a',
    [{x:3,y:4},{x:6,y:4},{x:4,y:5},{x:4,y:4}],'move');
  assert.equal(plan.cells.length,3);
  assert.equal(plan.attackers,2);
  assert.equal(plan.playerThreatened,true);
  assert.deepEqual(plan.byKey['4,4'].attackers,['beast-1','guardian-1']);
  assert.equal(plan.byKey['4,4'].boss,true);
  assert.ok(plan.landingHints.length>=1);
  assert.ok(plan.landingHints.every(p=>!plan.byKey[p.x+','+p.y]));
});
test('stale locked-origin warning cannot linger after an enemy is pushed',()=>{
  const moved=attack('beast-1','wolf',[{x:4,y:4}],{x:3,y:3});
  moved.attack.from={x:3,y:2};
  const plan=dungeonThreatPlan(map,[moved],members,'a');
  assert.equal(plan.cells.length,0);
  assert.equal(plan.playerThreatened,false);
  assert.equal(plan.landingHints.length,0);
});
test('server polygons never mark walls, off-map cells, or client-made damage',()=>{
  const blocked={...map,tiles:map.tiles.slice()};
  blocked.tiles[4*map.width+4]=0;
  const plan=dungeonThreatPlan(blocked,[
    attack('beast-1','wolf',[{x:4,y:4},{x:-1,y:1},{x:5,y:4}])
  ],members,'a');
  assert.equal(plan.cells.length,1);
  assert.equal(plan.byKey['5,4'].attackers.length,1);
  assert.equal(plan.playerThreatened,false);
  assert.equal('damage' in plan.cells[0],false);
});
test('dungeon uses the actual trial ambience and contour painters',()=>{
  const view=read('public/cultivation/dungeon-map-view.js');
  const painter=read('public/cultivation/dungeon-map-painter.js');
  assert.match(view,/import '\.\/tactical-ambience\.js'/);
  assert.match(view,/import '\.\/tactical-threat-visuals\.js'/);
  assert.match(view,/dungeonThreatPlan\(m,this\.creatures\(\)/);
  assert.match(painter,/threats\.drawGround\(ctx,dangerPlan,viewport\)/);
  assert.match(painter,/threats\.drawContours\(ctx,dangerPlan,viewport\)/);
  assert.match(painter,/ambience\.drawAtmosphere\(ctx,ambiencePlan/);
  assert.match(view,/this\.ambientTimer=setTimeout\(/);
  assert.match(view,/!document\.hidden/);
});

test('the running dungeon canvas passes the defined reduced-motion flag',()=>{
  const view=read('public/cultivation/dungeon-map-view.js');
  assert.match(view,/const reduceMotion=typeof window/);
  assert.match(view,/reducedMotion:reduceMotion/);
  assert.doesNotMatch(view,/\n\s*reducedMotion,\s*\n/,
    'an undefined shorthand aborts every animation frame');
});
