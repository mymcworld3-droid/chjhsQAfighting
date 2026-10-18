'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/cultivation/in-app-select.js'),'utf8');

function runtime() {
  const handlers=new Map();
  const document={addEventListener:(type,fn)=>{if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);}};
  const context=vm.createContext({document,window:{},Event:class{constructor(type,options){this.type=type;Object.assign(this,options);}}});
  const hooks=`globalThis.api = {choose, close, targetSelect, setCurrent: value => {current=value;},
    replaceOpen: fn => {open=fn;}, replaceClose: fn => {close=fn;}};`;
  vm.runInContext(source.replace(/\}\)\(\);\s*$/,hooks+'})();'),context);
  return {api:context.api,handlers,context};
}
function selectMock(options=[{value:'a'},{value:'b'}]) {
  const events=[];
  const select={options,selectedIndex:0,isConnected:true,multiple:false,size:0,
    matches:()=>false,getClientRects:()=>[{}],closest:()=>select,
    dispatchEvent(event){events.push([event.type,this.options[this.selectedIndex].value,event.bubbles]);}};
  return {select,events};
}

test('in-app choices update the original select before exactly one input/change event, preserving existing listeners',()=>{
  const {api}=runtime(),{select,events}=selectMock();let closed=0;
  api.replaceClose(()=>{closed++;assert.equal(select.selectedIndex,1);});
  api.setCurrent({select});api.choose(1);
  assert.equal(closed,1);assert.deepEqual(events,[['input','b',true],['change','b',true]]);
  events.length=0;api.choose(1);assert.equal(events.length,0,'selecting the current option is not a new change');
});

test('hidden or disabled options and disabled groups cannot be selected, including after asynchronous updates',()=>{
  const {api}=runtime(),{select,events}=selectMock([{value:'a'},{value:'b',disabled:true},
    {value:'c',hidden:true},{value:'d',parentElement:{disabled:true}},{value:'e',parentElement:{hidden:true}}]);
  let closed=0;api.replaceClose(()=>closed++);api.setCurrent({select});
  for(const index of [1,2,3,4,90])api.choose(index);
  assert.equal(select.selectedIndex,0);assert.equal(closed,0);assert.deepEqual(events,[]);
  select.matches=()=>true;api.choose(0);assert.equal(closed,1,'a disabled source closes without committing');
  select.matches=()=>false;select.isConnected=false;api.choose(0);assert.equal(closed,2);
});

test('delegated activation suppresses native mouse/touch pickers and supports controls created after boot',()=>{
  const {api,handlers}=runtime();const opened=[];api.replaceOpen(select=>opened.push(select));
  const {select}=selectMock();
  for(const type of ['pointerdown','mousedown','touchstart','touchend','click']) {
    let prevented=false;handlers.get(type).forEach(fn=>fn({target:select,preventDefault(){prevented=true;}}));
    assert.equal(prevented,true,type);
  }
  assert.equal(opened.length,2);assert.ok(opened.every(value=>value===select));
  let prevented=false;handlers.get('click').forEach(fn=>fn({target:{closest:()=>null},preventDefault(){prevented=true;}}));
  assert.equal(prevented,false,'other buttons keep their default behavior');
  select.multiple=true;assert.equal(api.targetSelect({target:select}),null);
  select.multiple=false;select.size=5;assert.equal(api.targetSelect({target:select}),null,'list boxes are not dropdowns');
});

test('keyboard activation opens the internal menu while Tab and browser shortcuts keep their meaning',()=>{
  const {api,handlers}=runtime(),{select}=selectMock();let count=0;api.replaceOpen(()=>count++);
  for(const key of ['ArrowDown','ArrowUp','Enter',' ','F4','Home','End']) {
    let prevented=false;handlers.get('keydown')[0]({target:select,key,preventDefault(){prevented=true;}});
    assert.equal(prevented,true,key);
  }
  assert.equal(count,7);
  for(const extra of [{key:'Tab'},{key:'ArrowDown',ctrlKey:true},{key:'ArrowDown',metaKey:true}]) {
    handlers.get('keydown')[0]({target:select,...extra,preventDefault(){assert.fail('unexpected keyboard interception');}});
  }
  assert.equal(count,7);
});

test('cancelling restores source accessibility attributes and focus without changing its value',()=>{
  const {api,context}=runtime(),{select,events}=selectMock();const attrs=new Map();let focus=0,removed=0,disconnected=0;
  select.removeAttribute=key=>attrs.delete(key);select.setAttribute=(key,value)=>attrs.set(key,value);select.focus=()=>focus++;
  context.window.removeEventListener=()=>{};
  const dialog={open:true,close(){this.open=false;},remove(){removed++;}};
  api.setCurrent({select,dialog,attributes:[['aria-haspopup',null],['aria-expanded',null],['aria-controls','original']],
    optionsObserver:{disconnect(){disconnected++;}},pageObserver:{disconnect(){disconnected++;}}});
  api.close();assert.equal(select.selectedIndex,0);assert.deepEqual(events,[]);assert.equal(focus,1);
  assert.equal(attrs.get('aria-controls'),'original');assert.equal(disconnected,2);assert.equal(removed,1);
  api.close();assert.equal(removed,1,'closing twice cannot affect another control');
});
