'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Visuals=require('../public/cultivation/tactical-objective-visuals.js');
const R=require('../public/cultivation/tactical-rules.js');
const renderer=fs.readFileSync(path.join(__dirname,'../public/cultivation/tactical-renderer.js'),'utf8');
const art=fs.readFileSync(path.join(__dirname,'../public/assets/shrines/guardian-atlas.webp'));
function scene(points){
  return {id:'battle-vfx',mode:'pve',revision:1,width:11,height:9,status:'active',
    trial:{stage:8,layoutVersion:4,layoutHash:'fixed'},
    objective:{type:'sealing',points:points.map(p=>({maxHp:2,hp:2,activated:false,...p}))}};
}
const point=(kind,x=3,y=2,rest={})=>({x,y,kind,...rest});
const copy=x=>JSON.parse(JSON.stringify(x));
const ctx=()=>{
  const calls=[];
  return {calls,save(){calls.push('save')},restore(){calls.push('restore')},
    beginPath(){calls.push('begin')},rect(){calls.push('rect')},clip(){calls.push('clip')},
    ellipse(){calls.push('ellipse')},stroke(){calls.push('stroke')},fill(){calls.push('fill')},
    moveTo(){calls.push('move')},lineTo(){calls.push('line')},
    closePath(){calls.push('close')},set globalAlpha(v){calls.push('alpha')},
    set strokeStyle(v){calls.push('strokeStyle')},set fillStyle(v){calls.push('fillStyle')},
    set lineWidth(v){calls.push('lineWidth')}};
};
const view={ox:10,oy:12,cell:44,width:11,height:9};
test('guardian artwork has three genuine transparent WebP frames, 160px each',()=>{
  assert(art.length>16000&&art.length<160000);
  assert.equal(art.toString('ascii',0,4),'RIFF');
  assert.equal(art.toString('ascii',8,12),'WEBP');
  assert.equal(art.toString('ascii',12,16),'VP8X');
  assert.deepEqual([art.readUIntLE(24,3)+1,art.readUIntLE(27,3)+1],[480,160]);
  assert.equal(art[20]&16,16,'guardian shrine artwork needs alpha');
});
test('guardian frame thresholds reflect real HP, including zero',()=>{
  assert.equal(Visuals.guardianFrame({hp:80,maxHp:100}),0);
  assert.equal(Visuals.guardianFrame({hp:50,maxHp:100}),1);
  assert.equal(Visuals.guardianFrame({hp:1,maxHp:100}),1);
  assert.equal(Visuals.guardianFrame({hp:0,maxHp:100}),2);
  assert.equal(Visuals.guardianFrame({hp:0,maxHp:0}),2);
});
test('seal hit and shatter VFX derive from true state deltas',()=>{
  const old=scene([point('shield'),point('hazard',5,4),point('rage',7,3),point('maze',8,6)]);
  const next=copy(old);next.revision=2;
  next.objective.points[0].hp=1;next.objective.points[1].hp=0;next.objective.points[1].activated=true;
  next.objective.points[2].hp=2;next.objective.points[3].hp=1;
  const saved=JSON.stringify(next),v=Visuals.transitions(old,next);
  assert.deepEqual(v.map(x=>x.kind),['shield','hazard','maze']);
  assert.deepEqual(v.map(x=>x.broken),[false,true,false]);
  assert.equal(v[0].duration,480);assert.equal(v[1].duration,760);
  assert.equal(JSON.stringify(next),saved,'VFX never mutates battle state');
  assert.deepEqual(Visuals.transitions(next,next),[]);
  const reverse=copy(old);reverse.revision=2;
  assert.deepEqual(Visuals.transitions(old,reverse),[]);
});
test('defense shrine hits, collapse, stage and room changes are not misidentified',()=>{
  const old=scene([]);old.objective={type:'defense',shrine:{x:5,y:4},hp:100,maxHp:100};
  const damaged=copy(old);damaged.revision=2;damaged.objective.hp=48;
  const effects=Visuals.transitions(old,damaged);
  assert.equal(effects.length,1);assert.equal(effects[0].kind,'guardian');
  assert.equal(effects[0].broken,false);assert.deepEqual([effects[0].x,effects[0].y],[5,4]);
  const broken=copy(damaged);broken.revision=3;broken.objective.hp=0;
  assert.equal(Visuals.transitions(damaged,broken)[0].broken,true);
  const switched=copy(broken);switched.trial.stage=9;switched.revision=4;
  assert.deepEqual(Visuals.transitions(damaged,switched),[]);
  const newRoom=copy(broken);newRoom.id='new-room';
  assert.deepEqual(Visuals.transitions(damaged,newRoom),[]);
  const noV4=copy(broken);noV4.trial.layoutVersion=3;
  assert.deepEqual(Visuals.transitions(damaged,noV4),[]);
  const changedShrine=copy(broken);changedShrine.objective.shrine={x:1,y:2};
  assert.deepEqual(Visuals.transitions(damaged,changedShrine),[]);
});
test('canvas hit FX remain clipped, complete, and respect reduced motion',()=>{
  const g=ctx();const effects=[{x:3,y:2,kind:'rage',broken:true,duration:760,started:null}];
  assert.equal(Visuals.draw(g,effects,1000,view,false),true);
  assert.equal(effects[0].started,1000);
  assert(g.calls.includes('clip')&&g.calls.includes('ellipse')&&g.calls.includes('fill'));
  assert.equal(g.calls.filter(x=>x==='save').length,g.calls.filter(x=>x==='restore').length);
  assert.equal(Visuals.draw(g,effects,1800,view,false),false);
  assert.deepEqual(effects,[]);
  const reduced=[{x:3,y:2,kind:'shield',duration:480,started:null}];
  const before=g.calls.length;
  assert.equal(Visuals.draw(g,reduced,1000,view,true),false);
  assert.equal(g.calls.length,before);assert.deepEqual(reduced,[]);
});
test('renderer loads guardian only in defense mode and keeps it below actors',()=>{
  assert(renderer.includes("const GUARDIAN_ATLAS='/assets/shrines/guardian-atlas.webp'"));
  assert(renderer.includes("const GUARDIAN_FRAME_SIZE=160"));
  assert(renderer.includes("if(objective?.type==='defense'&&s.trial?.layoutVersion===4)this.ensureGuardianAtlas()"));
  assert(renderer.includes('ObjectiveVFX.guardianFrame(objective)'));
  assert(renderer.includes("this.sprite('guardian',frame*GUARDIAN_FRAME_SIZE,0"));
  assert(renderer.includes("c.fillText('守',x,y)"),'readable fallback for asset load failure');
  assert(renderer.includes('this.objectiveCues.push(...changes.map'));
  const draw=renderer.slice(renderer.indexOf('  draw(){'));
  const shrine=draw.indexOf("this.sprite('guardian'");
  const seal=draw.indexOf("this.sprite('seals'");
  const fx=draw.indexOf('ObjectiveVFX.draw(c,this.objectiveCues');
  const actors=draw.indexOf('const positions=actors.filter(R.alive).sort((a,b)=>a.y-b.y);');
  assert(shrine>=0&&seal>shrine&&fx>seal&&actors>fx);
  assert.equal(draw.indexOf("this.sprite('guardian'",actors),-1);
  assert(draw.includes('objectiveFxActive||ambienceActive'));
});
