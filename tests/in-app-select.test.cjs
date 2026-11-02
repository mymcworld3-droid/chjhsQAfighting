'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/cultivation/in-app-select.js'),'utf8');

function runtime() {
  const handlers=new Map();
  const document={readyState:'loading',addEventListener:(type,fn)=>{if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);}};
  const context=vm.createContext({document,window:{},Event:class{constructor(type,options){this.type=type;Object.assign(this,options);}}});
  const hooks=`globalThis.api = {choose, close, targetSelect, enhance, releaseField, setCurrent: value => {current=value;},
    replaceOpen: fn => {open=fn;}, replaceClose: fn => {close=fn;}};`;
  vm.runInContext(source.replace(/\}\)\(\);\s*$/,hooks+'})();'),context);
  return {api:context.api,handlers,context};
}
function selectMock(options=[{value:'a'},{value:'b'}]) {
  const events=[];
  const select={tagName:'SELECT',options,selectedIndex:0,isConnected:true,multiple:false,size:0,
    matches:()=>false,getClientRects:()=>[{}],closest:selector=>selector==='select'?select:null,
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

test('mouse and touch use only the click activation path, so touchend cannot open a second picker',()=>{
  const {api,handlers}=runtime();const opened=[];api.replaceOpen(select=>opened.push(select));
  const {select}=selectMock();
  for(const type of ['pointerdown','mousedown','touchstart','click']) {
    let prevented=false;handlers.get(type).forEach(fn=>fn({target:select,preventDefault(){prevented=true;}}));
    assert.equal(prevented,true,type);
  }
  assert.equal(handlers.has('touchend'),false,'no parallel touchend opener or later synthetic click replay');
  assert.equal(opened.length,1);assert.ok(opened.every(value=>value===select));
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

test('closing returns focus to the button, avoiding native-select focus after a choice or cancellation',()=>{
  const {api,context}=runtime(),{select}=selectMock();let focus=0;
  select.focus=()=>assert.fail('native select must never receive focus');
  const trigger={removeAttribute(){},setAttribute(){},focus(){focus++;}};
  context.window.removeEventListener=()=>{};
  api.setCurrent({select,trigger,dialog:{open:true,close(){},remove(){}},attributes:[],
    optionsObserver:{disconnect(){}},pageObserver:{disconnect(){}}});
  api.close();assert.equal(focus,1);
});

test('reloading the enhancer with a new module URL cannot install a second set of activation handlers',()=>{
  const {handlers,context}=runtime();
  const before=[...handlers].map(([key,list])=>[key,list.length]);
  vm.runInContext(source,context);
  assert.deepEqual([...handlers].map(([key,list])=>[key,list.length]),before);
});

test('enhancement makes the source inert, syncs programmatic values and restores the native control when released',()=>{
  const {api,context}=runtime();
  function node(tagName) {
    const attrs=new Map(),css=new Map();
    const result={tagName,children:[],className:'',textContent:'',hidden:false,disabled:false,
      append(child){this.children.push(child);},remove(){this.removed=true;},
      getAttribute:name=>attrs.get(name)??null,hasAttribute:name=>attrs.has(name),
      setAttribute:(name,value)=>attrs.set(name,String(value)),removeAttribute:name=>attrs.delete(name),
      style:{*[Symbol.iterator](){yield* css.keys();},getPropertyValue:name=>css.get(name)?.[0]||'',
        getPropertyPriority:name=>css.get(name)?.[1]||'',setProperty:(name,value,priority)=>css.set(name,[value,priority]),removeProperty:name=>css.delete(name)}};
    return result;
  }
  class NativeSelect {
    constructor(){Object.assign(this,node('SELECT'));this.index=0;this.options=[{value:'a',label:'A'},{value:'b',label:'B'}];}
    get value(){return this.options[this.index].value;}
    set value(value){this.index=this.options.findIndex(option=>option.value===value);}
    get selectedIndex(){return this.index;}
    set selectedIndex(index){this.index=index;}
  }
  const select=new NativeSelect(),classes=new Set(['input-cyber']);
  select.classList={*[Symbol.iterator](){yield* classes;},contains:name=>classes.has(name),add:name=>classes.add(name),remove:name=>classes.delete(name)};
  Object.assign(select,{isConnected:true,multiple:false,size:0,title:'Grade',matches:()=>select.disabled,
    after(button){this.nextElementSibling=button;}});
  context.HTMLSelectElement=NativeSelect;
  context.getComputedStyle=()=>({display:'block',getPropertyValue:name=>name==='min-height'?'44px':''});
  context.document.createElement=node;
  const trigger=api.enhance(select);
  assert.equal(trigger.tagName,'button');assert.equal(trigger.type,'button');
  assert.equal(select.getAttribute('inert'),'');assert.equal(select.getAttribute('aria-hidden'),'true');assert.equal(select.getAttribute('tabindex'),'-1');
  assert.equal(trigger.children[0].textContent,'A');
  select.value='b';assert.equal(select.selectedIndex,1);assert.equal(trigger.children[0].textContent,'B');
  select.selectedIndex=0;assert.equal(select.value,'a');assert.equal(trigger.children[0].textContent,'A');
  assert.equal(api.enhance(select),trigger,'one button per source, even on repeated enhancement');
  select.disabled=true;select.hidden=true;api.enhance(select);assert.equal(trigger.disabled,true);assert.equal(trigger.hidden,true);
  api.releaseField(select);assert.equal(trigger.removed,true);assert.equal(select.getAttribute('inert'),null);
  assert.equal(select.getAttribute('aria-hidden'),null);assert.equal(select.getAttribute('tabindex'),null);
  assert.equal(Object.hasOwn(select,'value'),false);select.value='b';assert.equal(select.value,'b');
});
