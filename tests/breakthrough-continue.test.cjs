const {test}=require('node:test');
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/realm-breakthrough-feedback.js'),'utf8');
function fixture() {
  let time=0,id=0,score=27;
  const timers=new Map(),nodes=new Map(),windowListeners=new Map();
  function surface() {
    const listeners=new Map();
    return {listeners,addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
      removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
      fire(type,key){const event={key,prevented:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
        for(const fn of listeners.get(type)||[]) {fn(event);if(event.stopped)break;}return event;}};
  }
  function element() {
    const classes=new Set(),attributes=new Map(),children=new Map();
    return {isConnected:true,style:{},setAttribute:(k,v)=>attributes.set(k,v),getAttribute:k=>attributes.get(k),
      classList:{add:(...values)=>values.forEach(v=>classes.add(v)),contains:v=>classes.has(v)},
      querySelector(key){if(!children.has(key))children.set(key,element());return children.get(key);},
      focus(){},remove(){this.isConnected=false;if(nodes.get(this.id)===this)nodes.delete(this.id);}};
  }
  const doc=Object.assign(surface(),{readyState:'complete',activeElement:element(),querySelector:()=>true,
    getElementById:id=>nodes.get(id),createElement:element,body:{appendChild(node){nodes.set(node.id,node);}}});
  const parentDoc=surface();
  const window={parent:{document:parentDoc},getCurrentUserData:()=>({stats:{totalScore:score}}),limitImmortalRank:i=>i,
    addEventListener:(type,fn)=>windowListeners.set(type,fn),removeEventListener(){},dispatchEvent(){}};
  vm.runInNewContext(source,{window,document:doc,navigator:{},performance:{now:()=>time},CustomEvent:class{},
    setInterval(){},setTimeout:(fn,ms)=>{timers.set(++id,{fn,due:time+ms});return id;},clearTimeout:key=>timers.delete(key)});
  function advance(target) {time=target;for(const [key,timer] of [...timers])if(timer.due<=time){timers.delete(key);timer.fn();}}
  return {doc,parentDoc,advance,window,nodes,timers,
    trigger(value=28){score=value;windowListeners.get('xiuxian:stats-updated')();},
    overlay:()=>nodes.get('realm-breakthrough-feedback')};
}
test('breakthrough blocks early clicks, waits indefinitely for input, and allows clicks on the card or anywhere in the document',()=>{
  for(const target of ['card','background','screen']) {
    const f=fixture();f.trigger();const overlay=f.overlay();
    f.advance(999);assert.equal(f.doc.fire('click').prevented,true);assert.equal(overlay.classList.contains('leaving'),false);
    f.advance(1000);assert.equal(overlay.querySelector('.realm-breakthrough-continue').getAttribute('aria-hidden'),'false');
    f.advance(10000);assert.equal(f.overlay(),overlay,'there is no automatic dismissal');
    // All targets are handled by the same document capture listener, not a backdrop-only check.
    assert.equal(f.doc.fire('click',target).prevented,true);assert.ok(overlay.classList.contains('leaving'));
    f.advance(10240);assert.equal(f.overlay(),undefined);assert.equal(f.doc.listeners.get('click').size,0);
  }
});
test('black margins of the parent stage and keyboard confirmation also dismiss without activating the page underneath',()=>{
  for(const type of ['click','keydown']) {
    const f=fixture();f.trigger();f.advance(1000);
    assert.equal(f.parentDoc.fire(type,'Enter').prevented,true);f.advance(1240);
    assert.equal(f.overlay(),undefined);assert.equal(f.parentDoc.listeners.get(type).size,0);
  }
});
test('a late timer cannot extend the one-second input lock and replacing a leaving overlay cannot dispose its successor',()=>{
  const f=fixture();f.trigger();const first=f.overlay();f.advance(1000);f.doc.fire('click');
  f.trigger(68);const second=f.overlay();assert.notEqual(second,first);assert.equal(first.isConnected,false);
  f.advance(1240);assert.equal(f.overlay(),second);
  f.doc.fire('click');assert.equal(second.classList.contains('leaving'),false,'new popup gets its own first second');
  f.advance(2000);f.doc.fire('click');f.advance(2240);assert.equal(f.overlay(),undefined);
});
