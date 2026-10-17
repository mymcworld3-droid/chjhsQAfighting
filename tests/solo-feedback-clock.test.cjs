const {test}=require('node:test');
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/solo-cultivation-feedback.js'),'utf8').replace(/^export /gm,'');
function fixture({before=30,gain=5,reduced=false}={}) {
  let time=0,id=0,finishedAt=null;
  const frames=new Map(),timers=new Map(),elements=[];
  function node() {
    const selectors=new Map(),classes=new Set(),attributes=new Map();
    const el={style:{},isConnected:true,textContent:'',children:[],
      classList:{add:(...items)=>items.forEach(item=>classes.add(item)),remove:(...items)=>items.forEach(item=>classes.delete(item)),contains:item=>classes.has(item)},
      setAttribute:(key,value)=>attributes.set(key,String(value)),getAttribute:key=>attributes.get(key),
      getBoundingClientRect:()=>({left:100,top:500,width:10,height:10}),
      querySelector(selector){if(!selectors.has(selector))selectors.set(selector,node());return selectors.get(selector);},
      appendChild(child){this.children.push(child);},append(...children){this.children.push(...children);},
      remove(){this.isConnected=false;}};
    elements.push(el);return el;
  }
  const page=node();page.classList.add('active-page');const next=node();
  const context={performance:{now:()=>time},console,
    window:{innerWidth:390,innerHeight:844,matchMedia:()=>({matches:reduced}),addEventListener(){},removeEventListener(){},
      dispatchEvent(event){if(event.type==='xiuxian:solo-cultivation-feedback-end')finishedAt=time;}},
    document:{body:node(),createElement:node,createElementNS:node,getElementById:id=>id==='page-quiz'?page:next,addEventListener(){},removeEventListener(){}},
    MutationObserver:class{observe(){}disconnect(){}},CustomEvent:class{constructor(type){this.type=type;}},
    requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key),
    setTimeout:(fn,ms)=>{timers.set(++id,{fn,due:time+ms});return id;},clearTimeout:key=>timers.delete(key)};
  vm.runInNewContext(source+'\nthis.begin=beginSoloCultivationFeedback;',context);
  const session=context.begin({scoreBefore:before,source:node(),realms:[{name:'凡人',need:0},{name:'金丹',need:28},{name:'元嬰',need:68}]});
  const work=session.play({gain,totalScore:before+gain});
  async function advance(target) {
    time=target;
    const drawing=[...frames];frames.clear();drawing.forEach(([,fn])=>fn(time));
    for(let i=0;i<10;i++) {
      await Promise.resolve();
      const due=[...timers].filter(([,timer])=>timer.due<=time);
      if(!due.length)continue;
      due.forEach(([key,timer])=>{timers.delete(key);timer.fn();});
    }
  }
  return {advance,work,next,elements,active:()=>context.window.isSoloCultivationFeedbackActive(),finishedAt:()=>finishedAt,
    heads:()=>elements.filter(el=>el.getAttribute('class')==='solo-cultivation-orb'&&el.isConnected)};
}
test('equal elapsed time gives equal comet positions at 15, 30, 60 and 120 FPS',async()=>{
  const positions=[];
  for(const fps of [15,30,60,120]) {
    const f=fixture();
    for(let t=1000/fps;t<400;t+=1000/fps)await f.advance(t);
    await f.advance(400);
    positions.push(f.heads().map(el=>[el.getAttribute('cx'),el.getAttribute('cy')]));
    await f.advance(2000);await f.work;assert.equal(f.active(),false);
  }
  positions.slice(1).forEach(position=>assert.deepEqual(position,positions[0]));
});
test('a delayed first frame catches up immediately instead of restarting the flight and adding fresh waits',async()=>{
  for(const options of [{},{before:66,gain:5},{reduced:true}]) {
    const f=fixture(options);
    assert.equal(f.next.disabled,true);await f.advance(2500);await f.work;
    assert.equal(f.finishedAt(),2500);assert.equal(f.active(),false);assert.equal(f.next.disabled,undefined);
    assert.equal(f.heads().length,0);
  }
});
test('completion follows one duration at low and high refresh rates',async()=>{
  const completions=[];
  for(const fps of [15,30,60,120]) {
    const f=fixture();
    for(let t=1000/fps;f.active()&&t<2000;t+=1000/fps)await f.advance(t);
    await f.work;completions.push(f.finishedAt());
  }
  completions.forEach(time=>assert.ok(time>=1422&&time<1490,'completion '+time));
});
