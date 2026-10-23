const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');
const rules = require('../public/game-stage-rules.js');
const register = require('../game-stage.cjs');
const read = name => fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-8,`${a} vs ${b}`);

test('landscape and portrait canvases fit and center inside every viewport without distortion or cropping',()=>{
  for(const [width,height] of [[1920,1080],[1440,900],[2560,1080],[1024,768],[800,800],
    [390,844],[320,568],[768,1024],[1080,1920],[3840,2160],[300,1200],[1,1]]){
    const result=rules.fit({width,height,left:12,top:24});
    close(result.width/result.height,width>=height?16/9:9/16);
    assert.ok(result.width<=width+.00001&&result.height<=height+.00001);
    close(result.left-12,(width-result.width)/2);close(result.top-24,(height-result.height)/2);
  }
});

test('doubling screen pixels doubles every displayed dimension while logical layout remains unchanged',()=>{
  for(const [width,height] of [[390,844],[1440,900]]){
    const first=rules.fit({width,height}),second=rules.fit({width:width*2,height:height*2});
    assert.equal(first.designWidth,second.designWidth);assert.equal(first.designHeight,second.designHeight);
    for(const key of ['scale','width','height','left','top'])close(second[key],first[key]*2);
  }
  const keyboard=rules.fit({width:390,height:300,mode:'portrait'});
  close(keyboard.width/keyboard.height,9/16);
});

function stageRuntime() {
  const props=new Map(),handlers={},stageHandlers={},frames=[];
  const root={clientWidth:390,clientHeight:844};
  const bounds={width:390,height:844},safeArea={getBoundingClientRect:()=>bounds};
  let loads=0,observerCallback;
  const observed=[];
  const frame={set src(value){loads++;this.url=value;}};
  const stage={scrollTop:0,scrollLeft:0,dataset:{},
    style:{getPropertyValue:key=>props.get(key),setProperty:(key,value)=>props.set(key,value)},
    addEventListener:(type,callback)=>stageHandlers[type]=callback};
  class ResizeObserver {
    constructor(callback){observerCallback=callback;}
    observe(node){observed.push(node);}
  }
  let visualListeners=0;
  const window={innerWidth:1000,innerHeight:700,QAGameStageRules:rules,ResizeObserver,scrollX:0,scrollY:0,
    scrollTo(x,y){this.scrollX=x;this.scrollY=y;},
    visualViewport:{width:300,height:200,offsetLeft:40,offsetTop:80,addEventListener(){visualListeners++;}},
    addEventListener:(type,callback)=>handlers[type]=callback};
  vm.runInNewContext(read('public/game-stage.js'),{window,document:{documentElement:root,
    getElementById:id=>id==='game-stage'?stage:id==='game-frame'?frame:safeArea,addEventListener(){}},
    getComputedStyle:()=>({paddingLeft:'4px',paddingRight:'6px',paddingTop:'20px',paddingBottom:'24px'}),
    ResizeObserver,requestAnimationFrame:callback=>{frames.push(callback);return frames.length;},URL,
    location:{href:'https://example.test/stage.html?qa=1',search:'?qa=1',hash:''}});
  return {window,root,stage,safeArea,bounds,handlers,stageHandlers,observed,
    loads:()=>loads,visualListeners:()=>visualListeners,
    resizeProbe:()=>observerCallback(),flush:()=>{while(frames.length)frames.shift()();}};
}

test('outer stage fits the dynamic CSS viewport and safe areas without reacting to keyboard panning',()=>{
  const h=stageRuntime(),first=h.window.QAGameStage.getState();
  const expected=rules.fit({width:380,height:800,left:4,top:20,mode:'portrait'});
  for(const key of ['width','height','left','top','scale'])close(first[key],expected[key]);
  assert.equal(first.mode,'portrait');
  assert.ok(h.observed.includes(h.root));assert.ok(h.observed.includes(h.safeArea));
  assert.equal(h.visualListeners(),0);
  h.window.visualViewport.height=100;h.window.visualViewport.offsetTop=250;h.window.QAGameStage.sync();
  assert.deepEqual(h.window.QAGameStage.getState(),first);
  Object.assign(h.bounds,{width:1280,height:720});
  h.handlers.resize();h.flush();
  assert.equal(h.window.QAGameStage.getState().mode,'landscape');
  assert.equal(h.loads(),1,'resizing never reloads the authenticated game document');
});

test('Safari browser bar height changes refit the shell even when root clientHeight stays unchanged',()=>{
  const h=stageRuntime();
  Object.assign(h.root,{clientWidth:1024,clientHeight:768});
  Object.assign(h.bounds,{width:1024,height:620});h.resizeProbe();h.flush();
  const expected=rules.fit({width:1014,height:576,left:4,top:20,mode:'landscape'});
  const result=h.window.QAGameStage.getState();
  for(const key of ['width','height','left','top','scale'])close(result[key],expected[key]);
  assert.ok(result.top+result.height<=620-24);
  assert.equal(h.loads(),1);
});

test('shell focus scrolling and back navigation reset only the outer containers',()=>{
  const h=stageRuntime();
  h.stage.scrollTop=90;h.stage.scrollLeft=25;h.stageHandlers.scroll();
  assert.equal(h.stage.scrollTop,0);assert.equal(h.stage.scrollLeft,0);
  h.window.scrollY=72;h.window.scrollX=12;h.handlers.scroll();
  assert.equal(h.window.scrollY,0);assert.equal(h.window.scrollX,0);
  h.stage.scrollTop=80;h.window.scrollY=40;h.handlers.pageshow();h.flush();
  assert.equal(h.stage.scrollTop,0);assert.equal(h.window.scrollY,0);
  assert.equal(h.loads(),1);
});

test('server separates the outer page from its single authenticated app document',async t=>{
  const app=express();register(app);app.use(express.static(path.join(__dirname,'../public')));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin='http://127.0.0.1:'+server.address().port;
  for(const url of ['/','/index.html','/stage.html']){
    const body=await(await fetch(origin+url)).text();
    assert.match(body,/id="game-frame"/);assert.doesNotMatch(body,/src="main\.js/);
  }
  const body=await(await fetch(origin+'/app.html')).text();
  assert.match(body,/onclick="googleLogin\(\)"/);assert.match(body,/src="main\.js/);
  assert.doesNotMatch(body,/id="game-frame"/);
  assert.ok(body.indexOf('app-stage-bridge.js')<body.indexOf('cdn.tailwindcss.com'));
});

test('direct app navigation goes through the stage and retains link query and fragment',()=>{
  let target;const win={};win.parent=win;
  vm.runInNewContext(read('public/app-stage-bridge.js'),{window:win,URL,
    location:{href:'https://example.test/app.html?qa=1&invite=room123#friends',search:'?qa=1&invite=room123',hash:'#friends',replace:url=>{target=url;}}});
  assert.equal(target,'https://example.test/stage.html?qa=1&invite=room123#friends');
});

test('the embedded app retains its own layout document and mirrors its title without restarting',()=>{
  const classes=new Set(),styles=[];let sync;
  const parent={document:{title:''}};
  const document={title:'青雲問道',documentElement:{classList:{add:name=>classes.add(name)}},
    createElement:()=>({}),head:{appendChild:style=>styles.push(style)},querySelector:()=>({})};
  vm.runInNewContext(read('public/app-stage-bridge.js'),{window:{parent,frameElement:{id:'game-frame'}},document,
    MutationObserver:class{constructor(fn){sync=fn;}observe(){}},location:{replace(){throw Error('unexpected reload');}}});
  assert.equal(classes.has('game-stage-content'),true);assert.equal(styles.length,1);
  assert.equal(parent.document.title,'青雲問道');document.title='Qingyun';sync();assert.equal(parent.document.title,'Qingyun');
});
