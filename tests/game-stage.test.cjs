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
