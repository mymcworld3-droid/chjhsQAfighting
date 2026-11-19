'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,
  '../public/cultivation/dungeon-map-view.js'),'utf8')
  .replace(/^import .*$/gm,'').replace(/^export /gm,'');
const Viewer=new Function('Camera','getMainUser',
  source+'\nreturn DungeonMapView;')(
  {initialCamera:()=>({zoom:1,panX:0,panY:0})},()=>({uid:'a'}));
const makeButton=()=>({dataset:{},title:'',textContent:'',disabled:false});
function setup(){
  const children=[],box={hidden:true,children,
    replaceChildren(){children.splice(0);},
    append(b){children.push(b);}
  };
  const own={uid:'a',name:'修士甲',position:{x:11,y:10},
    battleHealth:100,downed:false,explorationStamina:50,
    rescueSeq:0,selfRescueCount:0,allyReviveCount:0};
  const ally={uid:'b',name:'修士乙',position:{x:11,y:9},
    battleHealth:0,downed:true,explorationStamina:40,
    rescueSeq:0,selfRescueCount:0,allyReviveCount:0};
  const view=new Viewer();
  view.uid='a';view.map={arena:'boss'};view.room={
    status:'assembled',dungeonArena:'boss',bossEncounter:{status:'fighting'},
    members:{a:own,b:ally}};
  view.$=selector=>selector==='[data-dm-rescues]'?box:null;
  return {view,box,own,ally};
}
test('living teammate sees visible targeted rescue button with actual price',()=>{
  const prev=global.document;
  global.document={createElement:()=>makeButton()};
  try{
    const {view,box}=setup();
    view.updateRescueHUD();
    assert.equal(box.hidden,false);
    assert.equal(box.children.length,1);
    assert.equal(box.children[0].dataset.dm,'rescue');
    assert.equal(box.children[0].dataset.targetUid,'b');
    assert.equal(box.children[0].disabled,false);
    assert.match(box.children[0].textContent,/8 體力/);
  }finally{global.document=prev;}
});
test('downed member sees only one self-revive button, and cannot use it twice',()=>{
  const prev=global.document;
  global.document={createElement:()=>makeButton()};
  try{
    const {view,box}=setup();
    view.room.members.a={...view.room.members.a,
      battleHealth:0,downed:true,explorationStamina:25};
    view.updateRescueHUD();
    assert.equal(box.hidden,false);
    assert.equal(box.children.length,1);
    assert.equal(box.children[0].dataset.targetUid,'a');
    assert.match(box.children[0].textContent,/凝神復起/);
    assert.equal(box.children[0].disabled,false);
    view.room.members.a.selfRescueCount=1;
    view.updateRescueHUD();
    assert.equal(box.children[0].disabled,true);
    view.room.bossEncounter.status='defeated';
    view.updateRescueHUD();
    assert.equal(box.hidden,true);
  }finally{global.document=prev;}
});
