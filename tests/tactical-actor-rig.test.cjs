'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Rig=require('../public/cultivation/tactical-actor-rig.js');
const Manuals=require('../public/cultivation/manual-rules.js');

function canvas(){
  const calls=[],stack=[];const target={calls,globalAlpha:1};
  return new Proxy(target,{
    get(o,key){
      if(key in o)return o[key];
      return (...args)=>{
        assert(args.every(v=>typeof v!=='number'||Number.isFinite(v)),String(key));
        if(key==='save')stack.push(o.globalAlpha);
        if(key==='restore'){assert(stack.length,'unbalanced canvas state');o.globalAlpha=stack.pop();}
        calls.push([key,...args]);
      };
    },
    set(o,key,value){if(typeof value==='number')assert(Number.isFinite(value),String(key));o[key]=value;return true;}
  });
}

test('every unlocked manual has a time-varying articulated pose, including shared techniques',()=>{
  const shapes=new Map();
  for(const book of Manuals.BOOKS)for(const skill of book.skills){
    const scene={kind:'cast',actor:'hero',skill:skill.id,step:1};
    const early=Rig.poseFor(scene,.2),middle=Rig.poseFor(scene,.5),late=Rig.poseFor(scene,.8);
    assert(early&&middle&&late,skill.id);
    assert.notDeepEqual(early,middle,skill.id);assert.notDeepEqual(middle,late,skill.id);
    for(const value of [early.leftArm,early.rightArm,early.leftLeg,early.rightLeg,early.torso])assert(Number.isFinite(value),skill.id);
    const signature=JSON.stringify([early,middle,late]);
    if(shapes.has(skill.moveId))assert.equal(signature,shapes.get(skill.moveId),skill.id);
    else shapes.set(skill.moveId,signature);
  }
  assert.equal(shapes.size,13);assert.equal(new Set(shapes.values()).size,13);
  assert(Rig.poseFor({kind:'cast',skill:'attack'},.5));
  assert.equal(Rig.poseFor({kind:'cast',skill:'unknown'},.5),null);
});

test('both avatars can bend their separate arms and legs in every facing direction',()=>{
  const image={complete:true,naturalWidth:448},atlas={complete:true,naturalWidth:1254,naturalHeight:1254};
  for(const gender of ['male','female'])for(const [dx,dy,row] of [[1,0,1],[-1,0,2],[0,1,0],[0,-1,3]]){
    const actor={uid:'hero',gender,x:4,y:4},scene={kind:'cast',actor:'hero',skill:'rock-break',
      origin:{x:4,y:4},target:{x:4+dx,y:4+dy},moves:[]};
    const c=canvas(),before=JSON.stringify([actor,scene]);
    assert.equal(Rig.facing(scene,actor),row);
    assert(Rig.draw(c,image,actor,scene,.5,{x:0,y:0,width:112,height:112},atlas));
    assert(c.calls.filter(call=>call[0]==='rotate').length>=5);
    const pieces=c.calls.filter(call=>call[0]==='drawImage'&&call[1]===atlas);
    assert.equal(pieces.length,7,'core, two legs, and two articulated arms');
    assert.equal(new Set(pieces.map(call=>call.slice(2,6).join(','))).size,6,'both arms have separate painted sprites');
    assert(c.calls.some(call=>call[0]==='drawImage'));
    assert.equal(c.calls.filter(call=>call[0]==='save').length,c.calls.filter(call=>call[0]==='restore').length);
    assert.equal(JSON.stringify([actor,scene]),before);
  }
});

test('poses preserve alternate punches, summon facing, and missing-atlas fallback',()=>{
  const a=Rig.poseFor({kind:'cast',skill:'dragon-guard',step:1},.42);
  const b=Rig.poseFor({kind:'cast',skill:'dragon-guard',step:2},.42);
  assert.notEqual(a.leftArm,b.leftArm);assert.notEqual(a.rightArm,b.rightArm);
  const hero={uid:'hero',x:2,y:2},scene={kind:'cast',actor:'hero',skill:'flight-summon',
    before:[hero],origin:{x:8,y:2},target:{x:4,y:2},moves:[]};
  assert.equal(Rig.facing(scene,hero),1,'summoning faces the target from the caster');
  assert.equal(Rig.draw(canvas(),{complete:true,naturalWidth:448},{...hero,uid:'other'},scene,.5,{x:0,y:0,width:112,height:112}),false);
  assert.equal(Rig.draw(canvas(),{complete:false,naturalWidth:0},hero,scene,.5,{x:0,y:0,width:112,height:112}),false);
});


test('chain punches recover to a connected guard pose between all four steps',()=>{
  for(let step=1;step<4;step++){
    const a=Rig.poseFor({kind:'cast',skill:'dragon-guard',step},1);
    const b=Rig.poseFor({kind:'cast',skill:'dragon-guard',step:step+1},0);
    for(const key of ['leftArm','rightArm','leftLeg','rightLeg','torso'])assert(Math.abs(a[key]-b[key])<1e-9,key);
  }
  const punch=Rig.poseFor({kind:'cast',skill:'dragon-guard',step:1},.25);
  assert(punch.rightArm < -1.5,'the fist extends at the impact beat');
});

test('painted core stays consistent at rest, walking, and during another actor turn',()=>{
  const atlas={complete:true,naturalWidth:1254,naturalHeight:1254},hero={uid:'hero',gender:'female',x:4,y:4};
  const box={x:0,y:0,width:112,height:112};
  for(const scene of [null,{kind:'cast',actor:'enemy',skill:'rock-fist'},{kind:'move',actor:'hero',moves:[{uid:'hero',path:[{x:4,y:4},{x:5,y:4}]}]}]){
    const c=canvas();assert(Rig.draw(c,null,hero,scene,.3,box,atlas));
    assert.equal(c.calls.filter(call=>call[0]==='drawImage'&&call[1]===atlas).length,7);
  }
  assert.equal(Rig.draw(canvas(),null,{...hero,bot:true},null,0,box,atlas),false);
  assert.equal(Rig.draw(canvas(),null,hero,null,0,box,{complete:true,naturalWidth:0,naturalHeight:0}),false);
});
