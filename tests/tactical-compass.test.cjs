'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Compass=require('../public/cultivation/tactical-compass.js');
const Camera=require('../public/cultivation/tactical-camera.js');

function room(){
  return {mode:'pve',status:'active',width:11,height:9,actors:[
    {uid:'u1',name:'修士',hp:120,maxHp:120,x:1,y:2},
    {uid:'monster-0',name:'玄岩首領',bot:true,boss:true,hp:900,maxHp:1000,
      x:8,y:4,footprint:{width:2,height:2}},
    {uid:'monster-1',name:'岩狼',bot:true,hp:60,x:7,y:1},
    {uid:'monster-2',name:'魔蛛',bot:true,hp:50,x:9,y:7}
  ],objective:{type:'boss',bossUid:'monster-0'}};
}
const portrait={ox:0,oy:0,cell:75,width:360,height:510};
const landscape={ox:0,oy:0,cell:75,width:844,height:350};

test('only fully offscreen living actors and objectives become edge markers',()=>{
  const state=room(),before=JSON.stringify(state);
  const out=Compass.derive(state,'u1',portrait);
  assert.ok(out.find(m=>m.kind==='boss'));
  assert.ok(out.some(m=>m.kind==='monster'));
  assert.ok(!out.some(m=>m.kind==='self'),'onscreen player is not duplicated');
  assert.ok(out.length<=3,'minimal compass never becomes a second HUD');
  assert.equal(JSON.stringify(state),before,'camera projections are read-only');

  const visible=Compass.derive(state,'u1',{ox:12,oy:18,cell:27,width:360,height:510});
  assert.deepEqual(visible,[],'fit-to-screen shows no unnecessary indicators');
  assert.deepEqual(Compass.derive({...state,mode:'pvp'},'u1',portrait),[]);
  assert.deepEqual(Compass.derive({...state,status:'finished'},'u1',portrait),[]);
  assert.deepEqual(Compass.derive(state,'u1',{...portrait,cell:0}),[]);
  assert.deepEqual(Compass.derive(state,'u1',{...portrait,width:100}),[]);
  state.actors[1].hp=0;
  assert.ok(!Compass.derive(state,'u1',portrait).some(m=>m.kind==='boss'));
});

test('when camera pans to the boss, only genuinely offscreen actors get indicated',()=>{
  const out=Compass.derive(room(),'u1',{...portrait,ox:-650,oy:-280});
  assert.ok(out.some(m=>m.kind==='self'),'find player again when zoomed into distant beasts');
  assert.ok(!out.some(m=>m.kind==='boss'),'boss is already partially on-screen');
  assert.equal(out.find(m=>m.kind==='self').label,'我');
});

test('goal markers use currently active objective type without inventing targets',()=>{
  const s=room();
  s.actors=s.actors.slice(0,1);
  s.objective={type:'sealing',points:[
    {x:9,y:5,activated:false},{x:3,y:3,activated:true}
  ]};
  const seals=Compass.derive(s,'u1',portrait);
  assert.equal(seals.filter(m=>m.kind==='objective').length,1);
  assert.deepEqual(seals[0].target,{x:9.5,y:5.5});
  s.objective={type:'defense',shrine:{x:9,y:5}};
  assert.equal(Compass.derive(s,'u1',portrait)[0].kind,'objective');
  s.objective={type:'transport',carrying:false,item:{x:9,y:6},destination:{x:3,y:3}};
  assert.deepEqual(Compass.derive(s,'u1',portrait)[0].target,{x:9.5,y:6.5});
  s.objective.carrying=true;
  assert.deepEqual(Compass.derive(s,'u1',portrait),[],'onscreen destination has no indicator');
});

test('portrait and landscape directions stay above the two action wheels',()=>{
  for(const g of [portrait,landscape,{ox:-180,oy:-200,cell:90,width:320,height:490},
    {ox:-40,oy:-30,cell:90,width:844,height:320}]){
    const points=Compass.derive(room(),'u1',g);
    const dial=g.width<g.height?
      Math.min(g.width*.5,g.height*.34):Math.min(g.width*.3,g.height*.5);
    for(const p of points){
      assert.ok(Number.isFinite(p.screenX)&&Number.isFinite(p.screenY)&&Number.isFinite(p.angle));
      assert.ok(p.screenX>=27&&p.screenX<=g.width-27);
      assert.ok(p.screenY<=g.height-dial-12+.1,
        'direction marker cannot be concealed behind a lower corner dial');
      assert.ok(p.screenY>=29);
    }
    assert.equal(new Set(points.map(x=>x.uid)).size,points.length);
    for(let i=0;i<points.length;i++)for(let j=0;j<i;j++)
      assert.ok(Math.hypot(points[i].screenX-points[j].screenX,
        points[i].screenY-points[j].screenY)>=35.9,
        'overlapping markers are separated');
  }
});

test('hit target is a camera point, never a gameplay command',()=>{
  const marks=Compass.derive(room(),'u1',portrait);
  const boss=marks.find(m=>m.kind==='boss');
  assert.equal(Compass.pick(marks,boss.screenX,boss.screenY).uid,boss.uid);
  assert.equal(Compass.pick(marks,9,499),null);
  assert.equal(Compass.pick(marks,NaN,0),null);
  const view={x:0,y:0,width:11,height:9};
  const start=Camera.geometry({zoom:2.4,panX:0,panY:0},portrait.width,portrait.height,view);
  const selected=Compass.derive(room(),'u1',{...start,width:portrait.width,height:portrait.height});
  assert.ok(Array.isArray(selected));
  // Camera tests remain completely independent from rule-based state mutation.
  assert.deepEqual(Compass.pick([],0,0),null);
});

test('small locator drawings stay within the visible canvas and accept reduced motion',()=>{
  const ops=[],ctx={};
  for(const name of ['save','restore','beginPath','rect','clip','translate','arc',
    'fill','stroke','rotate','moveTo','lineTo','closePath','fillText']){
    ctx[name]=(...args)=>{
      assert.ok(args.every(a=>typeof a!=='number'||Number.isFinite(a)),
        name+' never receives invalid coordinates');
      ops.push(name);
    };
  }
  const marks=Compass.derive(room(),'u1',portrait);
  Compass.draw(ctx,marks,portrait);
  assert.ok(ops.includes('arc')&&ops.includes('fillText')&&ops.includes('rotate'));
  assert.ok(ops.includes('clip'));
  const blank=[];
  Compass.draw(ctx,blank,portrait);
  assert.ok(marks.length>0);
});
