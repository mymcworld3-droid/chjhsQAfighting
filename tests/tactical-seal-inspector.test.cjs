'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const R=require('../public/cultivation/tactical-rules.js');
const src=fs.readFileSync(path.join(__dirname,'../public/cultivation/tactical-seal-inspector.js'),'utf8');
const combat=fs.readFileSync(path.join(__dirname,'../public/cultivation/tactical-combat.js'),'utf8');
const style=fs.readFileSync(path.join(__dirname,'../public/styles/tactical-seal-inspector.css'),'utf8');
const quarter=fs.readFileSync(path.join(__dirname,'../public/styles/tactical-quarter-controls.css'),'utf8');

class Node{
  constructor(name='div'){this.name=name;this.hidden=false;this.dataset={};this.attrs={};
    this.innerHTML='';this.scrollTop=0;this.inert=false;this.isConnected=true;this.children=[];}
  setAttribute(k,v){this.attrs[k]=String(v);}
  getAttribute(k){return this.attrs[k]??null;}
  hasAttribute(k){return Object.hasOwn(this.attrs,k);}
  append(...nodes){this.children.push(...nodes);}
  insertBefore(child){this.children.push(child);}
  focus(){fakeDoc.activeElement=this;}
  contains(){return false;}
  querySelector(sel){
    if(sel==='[data-seal-inspector-count]')return this.count||(this.count=new Node('span'));
    if(sel==='[data-seal-inspector-close]'||sel==='[data-seal-inspector-select]')
      return new Node('button');
    if(this.map)return this.map[sel]||null;
    return null;
  }
  querySelectorAll(){return [];}
}
const fakeDoc={activeElement:new Node('body'),body:new Node('body'),
  createElement:tag=>new Node(tag)};
const {SealInspector,sealArtwork,sealAreaText,sealBreakText}=new Function('document',
  src.replace(/export (class|function) /g,'$1 ')+
  '\nreturn {SealInspector,sealArtwork,sealAreaText,sealBreakText};')(fakeDoc);

function scene(points){
  return {mode:'pve',trial:{layoutVersion:4},width:11,height:9,blocks:[],
    objective:{type:'sealing',hazards:[],points:points.map(x=>({
      maxHp:2,hp:2,activated:false,...x}))},actors:[],status:'active'};
}
const point=(kind,x=3,y=2,extras={})=>({kind,x,y,...extras});
function mount(state,Inspector=SealInspector){
  let otherOpen=false;
  const root=new Node('root'),top=new Node('top'),loadout=new Node('loadout'),
    canvas=new Node('canvas'),main=new Node('main'),modal=new Node('modal');
  modal.hidden=true;
  const renderer={canvas,sealTargetPlan:{seals:[]},focusCameraOn(){return true;}};
  root.map={'.tc-top-right':top,'[data-loadout-toggle]':loadout,
    '.tc-main.tc-game canvas':canvas,'[data-modal]':modal,
    '[data-main]':main,'.tc-main canvas':canvas};
  let focused=null,located=null,closedOther=0;
  const inspector=new Inspector(root,{getState:()=>state,getRenderer:()=>renderer,rules:R,
    closeOther:()=>{closedOther++;},isOtherOpen:()=>otherOpen,onFocusRange:s=>{focused=s;},
    onNavigate:s=>{located=s;}});
  return {inspector,root,main,modal,renderer,setOtherOpen:v=>{otherOpen=v;},get focused(){return focused;},
    get located(){return located;},get closedOther(){return closedOther;}};
}
test('artwork uses the original four-column three-state WebP atlas',()=>{
  const kinds=R.SEAL_KINDS;
  assert.deepEqual(kinds,['shield','hazard','rage','maze']);
  for(let i=0;i<kinds.length;i++){
    assert.deepEqual(sealArtwork({kind:kinds[i],hp:2,maxHp:2,broken:false},R),
      {x:i/3*100,y:0});
    assert.deepEqual(sealArtwork({kind:kinds[i],hp:1,maxHp:2,broken:false},R),
      {x:i/3*100,y:50});
    assert.deepEqual(sealArtwork({kind:kinds[i],hp:0,maxHp:2,broken:true},R),
      {x:i/3*100,y:100});
  }
});
test('effect description uses genuine aura, warning and gate mechanics',()=>{
  const s=scene([point('shield'),point('hazard',4,2),point('maze',6,3,{gate:{x:7,y:3}})]);
  const info=R.sealInfos(s);
  assert.match(sealAreaText(info[0],s),/菱形/);
  assert.match(sealAreaText(info[0],s),/石障不會阻擋/);
  assert.match(sealAreaText(info[1],s),/沒有危險格預告/);
  s.objective.hazards=[{x:2,y:4}];
  assert.match(sealAreaText(info[1],s),/1 格危險區域/);
  assert.match(sealAreaText(info[2],s),/沒有尚存/);
  s.blocks=[{x:7,y:3,kind:'rock'}];
  assert.match(sealAreaText(info[2],s),/第 8 欄、第 4 列/);
  s.objective.points[0].activated=true;
  assert.match(sealAreaText(R.sealInfos(s)[0],s),/不再生效/);
});
test('broken hazard text respects other active sources',()=>{
  const s=scene([point('hazard'),point('hazard',5,2)]);
  s.objective.points[0].activated=true;
  const broken=R.sealInfos(s)[0];
  assert.match(sealBreakText(broken,s),/其他妖煞陣眼/);
  s.objective.points[1].activated=true;
  assert.match(sealBreakText(broken,s),/最後一座妖煞陣眼/);
});
test('roster and panel read current authoritative state, with no state mutations',()=>{
  const s=scene([point('shield'),point('rage',6,4,{hp:1}),point('maze',8,3,{activated:true,hp:0})]);
  const before=JSON.stringify(s),m=mount(s),a=m.inspector;
  a.refresh();assert.equal(a.toggle.hidden,false);
  assert.equal(a.toggle.querySelector('[data-seal-inspector-count]').textContent,'2/3');
  a.toggleRoster();
  assert.equal(a.rosterOpen,true);assert.equal(m.main.inert,true);
  assert.match(a.roster.innerHTML,/護靈陣眼/);
  assert.match(a.roster.innerHTML,/御獸陣眼/);
  assert.match(a.roster.innerHTML,/迷蹤陣眼/);
  assert.match(a.roster.innerHTML,/已破除/);
  assert.equal(a.inspect({x:6,y:4}),true);
  assert.match(a.panel.innerHTML,/耐久/);
  assert.match(a.panel.innerHTML,/1 \/ 2/);
  assert.match(a.panel.innerHTML,/25%/);
  assert.match(a.panel.innerHTML,/定位陣眼/);
  assert.match(a.panel.innerHTML,/查看範圍/);
  s.objective.points[1].activated=true;s.objective.points[1].hp=0;
  a.refresh();assert.equal(a.pinnedId,'6,4');
  assert.match(a.panel.innerHTML,/已破除/);
  assert.match(a.panel.innerHTML,/disabled title=/);
  assert.equal(JSON.stringify(s),JSON.stringify({...JSON.parse(before),
    objective:{...JSON.parse(before).objective,points:s.objective.points}}));
});
test('view range and locate are UI-only; dismiss restores combat canvas',()=>{
  const s=scene([point('shield')]);const m=mount(s);const a=m.inspector;
  a.refresh();a.inspect({x:3,y:2});
  assert.equal(m.closedOther,1);assert.equal(m.main.inert,true);
  a.handleButton({hasAttribute:k=>k==='data-seal-inspector-range'});
  assert.equal(m.focused.id,'3,2');
  assert.equal(a.isOpen(),false);assert.equal(m.main.inert,false);
  assert.equal(fakeDoc.activeElement,m.renderer.canvas);
  a.inspect({x:3,y:2});
  a.handleButton({hasAttribute:k=>k==='data-seal-inspector-locate'});
  assert.equal(m.located.id,'3,2');
  assert.equal(a.isOpen(),false);
});
test('old v3, other game modes and blocking modal hide information cleanly',()=>{
  const s=scene([point('shield')]),m=mount(s);
  m.inspector.refresh();
  m.modal.hidden=false;m.inspector.refresh();
  assert.equal(m.inspector.toggle.hidden,true);
  m.modal.hidden=true;s.trial.layoutVersion=3;m.inspector.refresh();
  assert.equal(m.inspector.toggle.hidden,true);
  s.trial.layoutVersion=4;s.mode='pvp';m.inspector.refresh();
  assert.equal(m.inspector.toggle.hidden,true);
  assert.equal(m.inspector.inspect({x:3,y:2}),false);
});
test('client integration uses exclusive inspector ownership and respects attack taps',()=>{
  assert(combat.includes('new SealInspector(root,{'));
  assert(combat.includes("if((action==='move'||action==='sword-move')&&R.sealInfo(state,p)?.active&&sealInspector?.inspect(p))return;"));
  assert(combat.includes('sealInspector?.dismiss();'));
  assert(combat.includes('sealInspector?.refresh();'));
  assert(combat.includes('onFocusRange:seal=>{'));
  assert(combat.includes("sealRangeMode='focus';sealRangeFocusId=seal.id;"));
  assert(combat.includes('sealInspector?.dialogElement()'));
  assert(combat.includes('if(sealInspector?.isOpen())'));
  assert(style.includes("background-size:400% 300%"));
  assert(style.includes("data-seal-inspector-range"));
  assert(quarter.includes('--tc-dial'));
});

test('inspector cannot unlock the map while the beast dialog is still open',()=>{
  const s=scene([point('shield')]),m=mount(s);
  m.setOtherOpen(true);m.inspector.refresh();
  assert.equal(m.main.inert,true,'beast inspector still owns the map');
  m.inspector.dismiss();
  assert.equal(m.main.inert,true,'dismiss must preserve the other dialog lock');
  m.setOtherOpen(false);m.inspector.refresh();
  assert.equal(m.main.inert,false);
  m.modal.hidden=false;m.inspector.refresh();
  assert.equal(m.main.inert,true,'quiz/dialog modal still locks the map');
  assert.equal(m.inspector.toggle.hidden,true);
});

test('inspector shows legible fallback while artwork loads, then swaps to the atlas',()=>{
  let imageCount=0;
  class FakeImage{
    constructor(){imageCount++;this.naturalWidth=512;this.naturalHeight=384;this.onload=null;this.onerror=null;}
    set src(v){this.url=v;}
  }
  const {SealInspector:WithImage}=new Function('document','Image',
    src.replace(/export (class|function) /g,'$1 ')+
    '\nreturn {SealInspector};')(fakeDoc,FakeImage);
  const s=scene([point('shield'),point('hazard',5,2),point('rage',6,3),point('maze',8,4)]);
  const m=mount(s,WithImage),a=m.inspector;
  a.refresh();
  assert.equal(imageCount,1,'lazy atlas should be fetched only once');
  assert.equal(a.artworkStatus,'loading');
  a.toggleRoster();
  assert.match(a.roster.innerHTML,/tc-seal-inspector-art-fallback/);
  assert.match(a.roster.innerHTML,/護/);
  assert.match(a.roster.innerHTML,/煞/);
  assert.match(a.roster.innerHTML,/獸/);
  assert.match(a.roster.innerHTML,/迷/);
  const before=JSON.stringify(s);
  a.artworkImage.onload();
  assert.equal(a.artworkStatus,'ready');
  assert.match(a.roster.innerHTML,/tc-seal-inspector-art is-ready/);
  assert.doesNotMatch(a.roster.innerHTML,/tc-seal-inspector-art-fallback/);
  a.refresh();assert.equal(imageCount,1);
  assert.equal(JSON.stringify(s),before,'loading decorative images must not edit game state');
  assert(style.includes('.tc-seal-inspector-art.is-ready'));
  assert(style.includes('.tc-seal-inspector-art:not(.is-ready)'));
});
test('inspector stays readable after missing or malformed WebP and does not retry forever',()=>{
  let images=0;
  class BrokenImage{
    constructor(){images++;this.naturalWidth=0;this.naturalHeight=0;}
    set src(v){this.url=v;}
  }
  const {SealInspector:BrokenInspector}=new Function('document','Image',
    src.replace(/export (class|function) /g,'$1 ')+
    '\nreturn {SealInspector};')(fakeDoc,BrokenImage);
  for(const kind of ['shield','hazard','rage','maze']){
    const m=mount(scene([point(kind)]),BrokenInspector),a=m.inspector;
    a.refresh();a.inspect({x:3,y:2});
    assert.match(a.panel.innerHTML,/tc-seal-inspector-art-fallback/);
    a.artworkImage.onerror();
    assert.equal(a.artworkStatus,'unavailable');
    assert.match(a.panel.innerHTML,/tc-seal-inspector-art-fallback/);
    a.refresh();
  }
  assert.equal(images,4,'one failed request per inspector instance, never on each refresh');
  const malformed=mount(scene([point('shield')]),BrokenInspector);
  malformed.inspector.refresh();
  malformed.inspector.artworkImage.onload();
  assert.equal(malformed.inspector.artworkStatus,'unavailable','malformed image cannot pass the dimensions check');
});
