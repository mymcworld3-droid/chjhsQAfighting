'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/cultivation/innate-ability-effects.js'),'utf8');
function runtime({reduced=false,portrait=true}={}) {
  const animations=[],timers=new Map();let serial=0;
  function element(tag) {
    return {tag,children:[],attrs:{},style:{},dataset:{},removed:false,
      setAttribute(k,v){this.attrs[k]=v;},appendChild(child){this.children.push(child);},remove(){this.removed=true;},
      animate(frames,options){const a={frames,options,currentTime:0,cancelled:false,cancel(){this.cancelled=true;}};animations.push(a);return a;}};
  }
  const context={document:{createElementNS:(_ns,tag)=>element(tag)},matchMedia:()=>({matches:reduced}),
    setTimeout(fn,delay){const id=++serial;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);}};
  vm.createContext(context);vm.runInContext(source.replace(/^export /gm,'')+'\nthis.create=createInnateAbilityEffect;',context);
  const stage=element('stage');stage.getBoundingClientRect=()=>({left:20,top:30,width:portrait?400:800,height:portrait?650:400});
  const sourceRect={left:40,top:portrait?510:210,width:80,height:120};
  const targetRect={left:portrait?300:620,top:70,width:90,height:140};
  return {create:(kind,extra={})=>context.create(stage,{kind,source:{getBoundingClientRect:()=>sourceRect},target:{getBoundingClientRect:()=>targetRect},...extra}),
    stage,animations,timers};
}
function nodes(root,predicate){return [root,...root.children.flatMap(child=>nodes(child,predicate))].filter(predicate);}
test('vital energy gathers around the caster into one green orb, seeks to elapsed time, then cleans up',()=>{
  const r=runtime(),effect=r.create('vital-orb',{elapsedMs:400});
  assert.equal(nodes(effect,x=>x.attrs.class==='ia-vital-orb').length,1);
  assert.equal(nodes(effect,x=>x.attrs.class==='ia-vital-wisp').length,10);
  assert.equal(effect.style.pointerEvents,'none');assert.equal(effect.attrs['aria-hidden'],'true');
  assert.ok(r.animations.every(a=>a.currentTime===400&&a.options.duration===1450));
  assert.equal([...r.timers.values()][0].delay,1080);
  effect.dispose();assert.equal(r.timers.size,0);assert.ok(effect.removed);assert.ok(r.animations.every(a=>a.cancelled));
});
test('triple beam has exactly three six-sided red barriers, charge and a layered beam in both orientations',()=>{
  for(const portrait of [true,false]) {
    const r=runtime({portrait}),effect=r.create('triple-beam');
    const hexes=nodes(effect,x=>x.attrs.class==='ia-fire-hexagon');assert.equal(hexes.length,3);
    assert.ok(hexes.every(x=>x.attrs.points.split(' ').length===6&&x.attrs.stroke==='#ff6338'));
    assert.equal(nodes(effect,x=>x.attrs.class==='ia-fire-beam').length,3);
    assert.equal(nodes(effect,x=>x.attrs.class==='ia-beam-charge').length,1);
    assert.match(effect.children[0].attrs.transform,/translate\(60 540\)|translate\(60 240\)/);
    assert.ok(r.animations.every(a=>a.options.duration===1450));
  }
});
test('reduced-motion effects omit gathering particles; expired and unknown effects never mount',()=>{
  const r=runtime({reduced:true});
  assert.equal(nodes(r.create('vital-orb'),x=>x.attrs.class==='ia-vital-wisp').length,0);
  const count=r.stage.children.length;
  assert.equal(r.create('vital-orb',{elapsedMs:1450}),null);assert.equal(r.create('untrusted-kind'),null);
  assert.equal(r.stage.children.length,count);
  const timer=[...r.timers.values()][0];timer.fn();assert.ok(r.stage.children[0].removed);
});
