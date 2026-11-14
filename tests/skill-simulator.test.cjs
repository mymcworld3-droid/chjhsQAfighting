'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../public/cultivation/tactical-rules.js'),Manuals=require('../public/cultivation/manual-rules.js');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/cultivation/skill-simulator.js'),'utf8');
function boot(){
  class Element{
    constructor(){this.listeners={};this.dataset={};this.value='';this.children=[];this.hidden=false;this.disabled=false;this.checked=false;this.textContent='';}
    addEventListener(name,fn){this.listeners[name]=fn;}
    setAttribute(name,value){this[name]=value;}
    replaceChildren(...children){this.children=children;this.value=children[0]?.value||'';}
    fire(name='click'){return this.listeners[name]?.({target:this});}
  }
  const ids=['battle','school','skill','reset','reset-view','next-turn','cast-self','free-cast',
    'message','actor-status','battle-status','tool-hint','glyph','skill-name','skill-stats','skill-description','skill-count'];
  const els=Object.fromEntries(ids.map(id=>[id,new Element()]));
  els.school.value='sword';els['free-cast'].checked=true;
  const tools=['cast','hero','monster','block'].map(tool=>{const b=new Element();b.dataset.tool=tool;return b;});
  let render;
  class TacticalRenderer{
    constructor(canvas,onTile,onActivity){this.select=onTile;this.onActivity=onActivity;this.isAnimating=false;render=this;}
    update(state,uid,mode){this.state=state;this.uid=uid;this.mode=mode;}
    resetView(){this.didReset=true;}
  }
  const document={
    querySelector:selector=>els[selector.slice(1)],
    querySelectorAll:selector=>selector==='[data-tool]'?tools:[],
    getElementById:id=>els[id],createElement:()=>new Element()
  };
  const context={document,TacticalRenderer,structuredClone,console};
  context.globalThis=context;context.QATactical=R;context.QAManuals=Manuals;
  vm.runInNewContext(source.replace(/^import .*;$/gm,''),context);
  return {els,tools,get renderer(){return render;}};
}
test('simulator offers all distinct techniques, casts against the real rules and places pieces',()=>{
  const app=boot(),{els,tools}=app;
  assert.equal(els.skill.children.length,6);
  assert.equal(app.renderer.mode,'manual:wind-slash');
  const before=app.renderer.state.actors.find(actor=>actor.uid==='practice-beast-1').hp;
  app.renderer.select({x:4,y:4});
  assert(app.renderer.state.actors.find(actor=>actor.uid==='practice-beast-1').hp<before);
  tools.find(button=>button.dataset.tool==='monster').fire();
  app.renderer.select({x:9,y:7});
  assert(R.at(app.renderer.state,{x:9,y:7})?.bot);
  app.renderer.select({x:9,y:7});
  assert.equal(R.at(app.renderer.state,{x:9,y:7}),undefined);
  tools.find(button=>button.dataset.tool==='block').fire();
  app.renderer.select({x:9,y:7});
  assert(R.blocked(app.renderer.state,{x:9,y:7}));
  tools.find(button=>button.dataset.tool==='hero').fire();
  app.renderer.select({x:2,y:4});
  assert.equal(app.renderer.state.actors[0].x,2);
  els.school.value='body';els.school.fire('change');
  assert.equal(els.skill.children.length,7);
  assert.equal(app.renderer.mode,'manual:rock-fist');
  els.skill.value='dragon-roar';els.skill.fire('change');
  assert.equal(els['cast-self'].hidden,false);
  els['cast-self'].fire();
  assert.equal(R.focusTurns(app.renderer.state.actors[0]),2);
  els.reset.fire();
  assert.equal(app.renderer.state.actors[0].x,3);
  assert.equal(R.focusTurns(app.renderer.state.actors[0]),0);
});
test('summoned sword can be moved through a second cast in free mode',()=>{
  const app=boot(),{els}=app;
  els.skill.value='flight-summon';els.skill.fire('change');
  app.renderer.select({x:4,y:4});
  assert.equal(app.renderer.state.actors[0].flyingSword.x,4);
  app.renderer.select({x:7,y:4});
  assert.equal(app.renderer.state.actors[0].flyingSword.x,7);
});
