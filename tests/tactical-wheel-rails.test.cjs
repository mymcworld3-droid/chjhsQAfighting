'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/tactical-wheel-rails.js'),'utf8');
const {weaponRailOptions,railAngle,railIndex,railSlicePath,syncRail,installWheelRails}=new Function(
  source.replace(/^export /gm,'')+';return {weaponRailOptions,railAngle,railIndex,railSlicePath,syncRail,installWheelRails};')();

function fixture(){
  const events={},chosen=[];
  const classes=()=>{const values=new Set();return {add:x=>values.add(x),remove:x=>values.delete(x),contains:x=>values.has(x)};};
  const outer={classList:{contains:x=>x==='tc-rw-outer'},querySelectorAll:()=>buttons};
  const buttons=[0,1,2].map(index=>({disabled:false,isConnected:true,
    dataset:index===0?{wheelAction:'move-menu'}:{weaponChoice:String(index-1)},
    closest:()=>outer,focus(){this.focused=true;}}));
  const slider={classList:classes(),querySelector:()=>({style:{}})};
  let locked=false,restored=0,suppressed=0,clickSuppressed=false;
  const wheel={classList:classes(),addEventListener:(type,fn)=>events[type]=fn,
    querySelector:()=>slider,getBoundingClientRect:()=>({right:200,bottom:200}),
    setPointerCapture(){},hasPointerCapture:()=>false};
  installWheelRails(wheel,{select:value=>chosen.push(value),restore:()=>restored++,
    isLocked:()=>locked,suppressClick:()=>{suppressed++;clickSuppressed=true;},allowClick:()=>{clickSuppressed=false;}});
  const fire=(type,{index=0,angle=-165,pointerId=1,...extra}={})=>{
    const r=175,rad=angle*Math.PI/180;
    const event={pointerId,button:0,isPrimary:true,target:{closest:()=>buttons[index]},
      clientX:200+r*Math.cos(rad),clientY:200+r*Math.sin(rad),
      preventDefault(){this.prevented=true},stopPropagation(){this.stopped=true},...extra};
    events[type](event);return event;
  };
  return {fire,buttons,chosen,slider,wheel,setLocked:value=>locked=value,
    isClickSuppressed:()=>clickSuppressed,
    counts:()=>({restored,suppressed})};
}

test('stations run bottom to top; index mapping stays bounded at both rail ends',()=>{
  for(const count of [1,2,3]){
    for(let i=0;i<count;i++)assert.equal(railIndex(railAngle(i,count),count),i);
    assert.equal(railIndex(-250,count),0);assert.equal(railIndex(-20,count),count-1);
  }
  assert.equal(railAngle(0,3),-165);assert.equal(railAngle(2,3),-105);
  for(const kind of ['inner','outer'])assert.doesNotMatch(railSlicePath(kind,3),/NaN|Infinity/);
});
test('drag selects exactly once on release and suppresses the following synthetic click',()=>{
  const f=fixture();f.fire('pointerdown');f.fire('pointermove',{angle:-105});
  assert.deepEqual(f.chosen,[]);assert(f.slider.classList.contains('is-dragging'));
  f.fire('pointerup',{angle:-105});f.fire('lostpointercapture');
  assert.deepEqual(f.chosen,['weapon:1']);assert.deepEqual(f.counts(),{restored:1,suppressed:1});
  assert(!f.slider.classList.contains('is-dragging'));
});
test('SVG thumbs use a real hidden attribute when a weapon or movement option is absent',()=>{
  const rotor={style:{}},attrs=new Map(),shape={setAttribute:(key,value)=>attrs.set(key,value)};
  const slider={dataset:{rail:'inner'},classList:{contains:()=>false},
    toggleAttribute:(key,value)=>value?attrs.set(key,''):attrs.delete(key),
    querySelector:key=>key==='g'?rotor:shape};
  syncRail(slider,-1,0);assert(attrs.has('hidden'));
  syncRail(slider,0,3);assert(!attrs.has('hidden'));assert.equal(rotor.style.transform,'rotate(-30deg)');
  slider.classList.contains=()=>true;syncRail(slider,2,3);
  assert.equal(rotor.style.transform,'rotate(-30deg)','a sync during drag must not pull the thumb away from the finger');
});
test('a tap remains delegated to the normal button click handler',()=>{
  const f=fixture();f.fire('pointerdown');f.fire('pointerup');
  assert.deepEqual(f.chosen,[]);assert.equal(f.counts().suppressed,0);
});
test('a new tap after a drag clears suppression without replaying the previous selection',()=>{
  const f=fixture();f.fire('pointerdown');f.fire('pointermove',{angle:-105});f.fire('pointerup');
  assert(f.isClickSuppressed());assert.deepEqual(f.chosen,['weapon:1']);
  f.fire('pointerdown',{index:1});assert.equal(f.isClickSuppressed(),false);
  f.fire('pointerup',{index:1});assert.deepEqual(f.chosen,['weapon:1']);
});
test('cancelled drag and lost capture restore the committed selection',()=>{
  for(const type of ['pointercancel','lostpointercapture']){
    const f=fixture();f.fire('pointerdown');f.fire('pointermove',{angle:-105});f.fire(type);
    assert.deepEqual(f.chosen,[]);assert.equal(f.counts().restored,1);
    assert(!f.slider.classList.contains('is-dragging'));
  }
});
test('turn lock, disabled destination and replaced options cannot commit a stale gesture',()=>{
  for(const change of [f=>f.setLocked(true),f=>f.buttons[2].disabled=true,f=>f.buttons[0].isConnected=false]){
    const f=fixture();f.fire('pointerdown');f.fire('pointermove',{angle:-105});change(f);f.fire('pointerup');
    assert.deepEqual(f.chosen,[]);assert.equal(f.counts().restored,1);
  }
});
test('secondary pointers and right mouse clicks cannot take over a rail gesture',()=>{
  const f=fixture();f.fire('pointerdown',{isPrimary:false});f.fire('pointermove',{angle:-105});f.fire('pointerup');
  f.fire('pointerdown',{button:2});f.fire('pointermove',{angle:-105});f.fire('pointerup');
  assert.deepEqual(f.chosen,[]);assert.equal(f.counts().suppressed,0);
  f.fire('pointerdown');f.fire('pointermove',{pointerId:2,angle:-105});f.fire('pointerup',{pointerId:2});
  f.fire('pointerup');assert.deepEqual(f.chosen,[]);
});
test('keyboard selects bottom-to-top stations, skips locked skills and supports Home/End',()=>{
  const f=fixture();f.buttons[1].disabled=true;
  const e=f.fire('keydown',{key:'ArrowUp'});
  assert(e.prevented&&e.stopped);assert.deepEqual(f.chosen,['weapon:1']);assert(f.buttons[2].focused);
  f.fire('keydown',{index:2,key:'Home'});assert.equal(f.chosen.at(-1),'move-menu');
  f.fire('keydown',{key:'End'});assert.equal(f.chosen.at(-1),'weapon:1');
  f.setLocked(true);f.fire('keydown',{key:'ArrowUp'});assert.equal(f.chosen.length,3);
});


test('weapon rail hides empty slots, keeps slot identities and offers one fallback attack',()=>{
  const books={a:{name:'青雲劍'},b:{name:'玄岩拳'}};
  for(const [ids,values,names]of [
    [[null,null],['move','attack'],['移動','攻擊']],
    [['a',null],['move','weapon:0'],['移動','青雲劍']],
    [[null,'b'],['move','weapon:1'],['移動','玄岩拳']],
    [['a','b'],['move','weapon:0','weapon:1'],['移動','青雲劍','玄岩拳']]
  ]){
    const options=weaponRailOptions(ids,books);
    assert.deepEqual(options.map(x=>x.value),values);
    assert.deepEqual(options.map(x=>x.name),names);
    for(let i=0;i<options.length;i++)
      assert.equal(railIndex(railAngle(i,options.length),options.length),i);
  }
});


test('trial fallback attack selects basic combat and rejects hidden empty weapon slots',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../public/cultivation/tactical-combat.js'),'utf8');
  const start=src.indexOf('function selectWheel('),end=src.indexOf('function sealGuideKey(',start);
  const run=new Function('ids',`
    let state={},busy=false,renderer=null,selectedWeaponSlot=-1,selectedWeaponId='',
      action='move',selectedManualSkill='',attackChoice='attack',selection=null,sealPeekPosition=null;
    const hero={manualWeaponMode:true},myActor=()=>hero,myAction=()=>true,
      currentWeaponIds=()=>ids,modernPveWheel=()=>true,syncEquippedAttack=()=>{},
      equippedTechniques=()=>[],tutorialStep=()=>0,updateControls=()=>{},
      R={basicFor:()=>({range:1})};
    ${src.slice(start,end)}
    selectWheel('weapon:0');
    const emptySlot=selectedWeaponSlot;
    selectWheel('attack-ring');
    return {emptySlot,action,selectedWeaponSlot};
  `);
  assert.deepEqual(run([null,null]),{emptySlot:-1,action:'attack',selectedWeaponSlot:-1});
});
