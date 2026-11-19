'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const R=require('../public/cultivation/tactical-rules.js');
const Overlays=require('../public/cultivation/tactical-seal-ranges.js');
const renderer=fs.readFileSync(path.join(__dirname,'../public/cultivation/tactical-renderer.js'),'utf8');
const combat=fs.readFileSync(path.join(__dirname,'../public/cultivation/tactical-combat.js'),'utf8');
function battle(seals,more={}){
  return {mode:'pve',trial:{layoutVersion:4},status:'active',
    width:11,height:9,blocks:[],actors:[],objective:{type:'sealing',
      points:seals.map(x=>({maxHp:2,hp:2,activated:false,...x})),hazards:[]},...more};
}
function point(x,y,kind,extra={}){return {x,y,kind,...extra};}
test('source-of-truth range plan uses v4 only and does not mutate battle',()=>{
 const s=battle([point(3,3,'shield'),point(4,5,'rage'),point(6,2,'hazard'),point(8,6,'maze',{gate:{x:7,y:6}})]);
 s.blocks=[{x:7,y:6}];s.objective.hazards=[{x:1,y:1}];
 const before=JSON.stringify(s),plan=Overlays.derive(s,R);
 assert.equal(plan.seals.length,4);
 assert.deepEqual(plan.seals.map(x=>x.range.kind),['manhattan','manhattan','warning','linked-block']);
 assert.deepEqual(plan.seals[0].cells.length,25);
 assert.deepEqual(plan.seals[1].cells.length,25);
 assert.deepEqual(plan.seals[2].cells,[{x:1,y:1}]);
 assert.deepEqual(plan.seals[3].cells,[]);
 assert.deepEqual(plan.seals[3].gate,{x:7,y:6});
 assert.equal(JSON.stringify(s),before);
 assert.deepEqual(Overlays.derive({...s,trial:{layoutVersion:3}},R).seals,[]);
 assert.deepEqual(Overlays.derive({...s,mode:'pvp'},R).seals,[]);
});
test('no invented radii for hazard or maze, no phantom gate',()=>{
 const s=battle([point(3,3,'hazard'),point(4,4,'maze',{gate:{x:2,y:2}})]);
 const p=Overlays.derive(s,R);
 assert.deepEqual(p.seals[0].cells,[]);assert.deepEqual(p.seals[1].cells,[]);
 assert.equal(p.seals[1].gate,null);
 s.objective.hazards=[{x:3,y:7}];s.blocks=[{x:2,y:2}];
 const live=Overlays.derive(s,R);
 assert.deepEqual(live.seals[0].cells,[{x:3,y:7}]);
 assert.deepEqual(live.seals[1].gate,{x:2,y:2});
 s.objective.points[0].activated=true;
 assert.equal(Overlays.derive(s,R).seals.some(x=>x.kind==='hazard'),false);
});
test('same-kind overlapping auras merge rather than falsely stack',()=>{
 const s=battle([point(4,4,'shield'),point(5,4,'shield'),point(7,4,'rage')]);
 const p=Overlays.derive(s,R);
 assert.equal(Overlays.groups(p,'all').length,2);
 const merged=Overlays.groups(p,'all').find(x=>x.kind==='shield');
 assert(merged.cells.size>25&&merged.cells.size<50);
 assert.equal(Overlays.groups(p,'focus',p.seals[0].id)[0].cells.size,25);
 assert.equal(Overlays.groups(p,'off').length,0);
 assert.equal(Overlays.visible(p,'focus',p.seals[1].id)[0].id,p.seals[1].id);
 assert.equal(Overlays.focused(p,'missing').id,p.seals[0].id);
});
test('Canvas drawing clips to map and is a no-op for off or empty',()=>{
 const calls=[];const ctx={save(){calls.push('save')},restore(){calls.push('restore')},
 beginPath(){calls.push('begin')},rect(){calls.push('rect')},clip(){calls.push('clip')},
 fillRect(){calls.push('fillRect')},strokeRect(){calls.push('strokeRect')},
 moveTo(){calls.push('move')},lineTo(){calls.push('line')},
 stroke(){calls.push('stroke')},setLineDash(){calls.push('dash')}};
 const s=battle([point(2,2,'shield'),point(4,4,'hazard'),point(6,6,'maze',{gate:{x:5,y:6}})]);
 s.blocks=[{x:5,y:6}];s.objective.hazards=[{x:1,y:3}];
 const plan=Overlays.derive(s,R),view={ox:8,oy:9,cell:22,width:11,height:9};
 Overlays.ground(ctx,plan,view,'off');Overlays.details(ctx,plan,view,'off');
 assert.equal(calls.length,0);
 Overlays.ground(ctx,plan,view,'all');Overlays.details(ctx,plan,view,'all');
 assert(calls.includes('clip')&&calls.includes('fillRect')&&calls.includes('strokeRect'));
 assert.equal(calls.filter(x=>x==='save').length,calls.filter(x=>x==='restore').length);
});
test('renderer range overlay paints below attack warnings, beasts and HP text',()=>{
 const draw=renderer.slice(renderer.indexOf('  draw(){'));
 const ground=draw.indexOf('SealRanges.ground(c,this.sealRangePlan');
 const hazard=draw.indexOf("for(const p of objective?.hazards||[])fill(p");
 const aim=draw.indexOf('for(const p of this.range)fill(p');
 const props=draw.indexOf('for(const p of s.blocks){');
 const detail=draw.indexOf('SealRanges.details(c,this.sealRangePlan');
 const threat=draw.indexOf('Threats.drawContours(c,this.threatPlan,viewport);');
 const actors=draw.indexOf('const actors=scene?A.sample(scene,progress):s.actors;');
 assert(ground>=0&&hazard>ground&&aim>ground&&props>aim);
 assert(detail>props&&detail<threat&&threat<actors);
 assert.equal(draw.indexOf('SealRanges.details(c,this.sealRangePlan',actors),-1);
});
test('range toolbar is only for v4 sealing and never uses combat actions',()=>{
 assert(combat.includes('data-seal-range-toggle'));
 assert(combat.includes('data-seal-range-next'));
 assert(combat.includes("const sealRanges=R.sealInfos(state).filter(p=>p.active)"));
 assert(combat.includes("renderer?.setSealRangeMode(sealRangeMode,sealRangeFocusId)"));
 assert(combat.includes("if(b.hasAttribute('data-seal-range-toggle'))"));
 assert(combat.includes("else if(b.hasAttribute('data-seal-range-next'))"));
});
