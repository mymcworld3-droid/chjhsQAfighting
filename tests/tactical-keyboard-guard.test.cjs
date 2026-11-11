'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const file=fs.readFileSync(path.join(__dirname,'../public/cultivation/tactical-keyboard-guard.js'),'utf8')
  .replace(/export (?=function )/g,'');
const stageSource=fs.readFileSync(path.join(__dirname,'../public/game-stage.js'),'utf8');

function geometry(){
  const context={};
  vm.runInNewContext(file+'\nthis.projectKeyboardViewport=projectKeyboardViewport;',context);
  return context.projectKeyboardViewport;
}

test('project a moving, scaled keyboard viewport into the fixed portrait game canvas',()=>{
  const project=geometry();
  const stage={designWidth:360,designHeight:640,scale:1.0833333333,left:0,top:75.33};
  const bounds=project({offsetLeft:0,offsetTop:0,width:390,height:500},stage,{width:360,height:640});
  assert.equal(bounds.keyboardVisible,true);
  assert.equal(bounds.left,0);
  assert.equal(Math.round(bounds.width),360);
  assert.equal(Math.round(bounds.height),392);
  const panned=project({offsetLeft:0,offsetTop:280,width:390,height:420},stage,{width:360,height:640});
  assert(panned.top>170);
  assert(panned.height>300);
  assert(panned.top+panned.height<=640,'input dock remains inside the iframe');
});

test('ordinary full-height viewport leaves editor dock inactive',()=>{
  const project=geometry();
  const stage={designWidth:360,designHeight:640,scale:1,left:0,top:0};
  const bounds=project({offsetLeft:0,offsetTop:0,width:360,height:640},stage,{width:360,height:640});
  assert.equal(bounds.keyboardVisible,false);
});

test('keyboard guard locks the outer iframe before focus and docks the helper above the keyboard',()=>{
  const names=new Set(),properties=new Map(),signals=[];
  const rootListeners={};
  const viewportHandlers={};
  const parentViewport={width:390,height:844,offsetTop:0,offsetLeft:0,
    addEventListener:(name,fn)=>viewportHandlers[name]=fn,
    removeEventListener:()=>{}};
  const stage={designWidth:360,designHeight:640,scale:1.0833333333,left:0,top:75.33};
  const parent={visualViewport:parentViewport,
    QAGameStage:{getState:()=>stage,setKeyboardEditing:value=>signals.push(value)},
    postMessage:()=>{}};
  const overlay={};
  const input={matches:()=>true,closest:()=>overlay};
  const root={isConnected:true,
    contains:node=>node===input||node===overlay,
    getBoundingClientRect:()=>({width:360,height:640}),
    classList:{add:name=>names.add(name),remove:(...arr)=>arr.forEach(name=>names.delete(name))},
    style:{setProperty:(name,value)=>properties.set(name,value),removeProperty:name=>properties.delete(name)},
    addEventListener:(name,fn)=>rootListeners[name]=fn,
    removeEventListener:()=>{}
  };
  const doc={activeElement:input};
  const win={parent,frameElement:{id:'game-frame'},location:{origin:'https://game.test'},
    visualViewport:{addEventListener(){},removeEventListener(){}},addEventListener(){},removeEventListener(){}};
  let frames=[],rafCounter=0;
  const ctx={window:win,document:doc,
    setTimeout,clearTimeout,
    requestAnimationFrame:fn=>{frames.push(fn);return ++rafCounter},
    cancelAnimationFrame(){},};
  vm.runInNewContext(file+'\nthis.installTacticalKeyboardGuard=installTacticalKeyboardGuard;',ctx);
  const guard=ctx.installTacticalKeyboardGuard(root);
  rootListeners.pointerdown({target:input});
  assert.equal(signals[0],true);
  assert(names.has('tc-typing-locked'));
  assert.equal(properties.get('--tc-locked-height'),'640px');
  parentViewport.height=480;
  viewportHandlers.resize();
  while(frames.length)frames.shift()();
  assert(names.has('tc-keyboard-visible'));
  assert(Number.parseFloat(properties.get('--tc-visible-height'))<480);
  guard.dispose();
  assert.equal(signals.at(-1),false);
});

test('outer stage code freezes its scaling, bypasses scroll-reset loops and checks message origin',()=>{
  assert.match(stageSource,/if \(keyboardEditing && state\) return/);
  assert.match(stageSource,/if \(keyboardEditing\) return/);
  assert.match(stageSource,/setKeyboardEditing\(active\)/);
  assert.match(stageSource,/event\.source!==frame\.contentWindow\|\|event\.origin!==location\.origin/);
});

test('typing overlay uses the keyboard-safe region, keeps composer visible and disables iOS zoom',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../public/styles/tactical-question-pair.css'),'utf8');
  const combat=fs.readFileSync(path.join(__dirname,'../public/cultivation/tactical-combat.js'),'utf8');
  assert.match(css,/#tactical-combat\.tc-keyboard-visible \.tc-quiz \.tc-tool-overlay:not\(\[hidden\]\)/);
  assert.match(css,/height:var\(--tc-visible-height,100%\)!important/);
  assert.match(css,/\.quiz-helper-prompts\{\s*display:none!important/);
  assert.match(css,/font-size:16px!important/);
  const opening=combat.slice(combat.indexOf('function openQuestionTool('),combat.indexOf('function closeQuestionTool('));
  assert.match(opening,/panel\.querySelector\?\.\('\[data-tool-close\]'\)\?\.focus\(\{preventScroll:true\}\)/);
  assert.doesNotMatch(opening,/helper-input.*\.focus\(/);
});
