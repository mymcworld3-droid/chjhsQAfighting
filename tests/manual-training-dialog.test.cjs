'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/cultivation/manual-training-page.js'),'utf8');
function fixture(){
  const context=vm.createContext({
    globalThis:{QAManuals:{REALMS:[],BY_SKILL:{},totalExpForLevel:()=>0}},window:{},
    renderManualHero:state=>({bookId:state.library.find(x=>x.owned)?.id||'',html:'<section class="manual-hero">training details</section>'}),
    renderManualExpedition:()=>'<aside>expedition</aside>',nextManualExpedition:()=>null,
    filterOwnedManuals:state=>state.library.filter(x=>x.owned),
    renderManualCollectionSummary:()=>'<button>weapon</button>',renderManualCollectionHeader:()=>'',
    renderManualLoadout:()=>'<section>equipment</section>',bookArt:()=>'',skillArt:()=>''
  });
  const code=source.replace(/^import .*;\n/gm,'').split("if(document.readyState==='loading')")[0];
  vm.runInContext(code,context);
  vm.runInContext("current={library:[{id:'sword-wind',name:'流風靈劍',owned:true,skills:[]}],loadouts:[],weaponIds:['sword-wind',null]}",context);
  return {context,run:code=>vm.runInContext(code,context)};
}
test('weapon details are a hidden page section, never a modal',()=>{
  const f=fixture(),html=f.run('markup()');
  assert.match(html,/<section id="manual-training-screen"[^>]*hidden>/);
  assert.match(html,/manual-hero/);assert.match(html,/expedition/);
  assert.doesNotMatch(html,/<dialog id="manual-training/);
  assert.match(html,/equipment/);
  const active=f.run('trainingDialogOpen=true;markup()');
  assert.doesNotMatch(active,/<section id="manual-training-screen"[^>]*hidden>/);
});
test('opening replaces the collection, refresh does not reset scrolling, and return restores position and focus',()=>{
  const f=fixture();
  f.run(`let focused=0,active=false;
    const page={scrollTop:180,scrollLeft:0},main={scrollTop:220,scrollLeft:0};
    const screen={hidden:true,querySelector:()=>({focus(){}})};
    root={parentElement:page,querySelector:selector=>selector==='[data-manual-training-screen]'?screen:null,querySelectorAll:()=>[],
      closest:selector=>selector==='main'?main:page,
      classList:{contains:()=>active,toggle(name,value){active=value;}}};
    trainingDialogTrigger={isConnected:true,focus(){focused++;}};
    trainingDialogOpen=true;syncTrainingDialog();`);
  assert.equal(f.run('active'),true);assert.equal(f.run('screen.hidden'),false);
  assert.equal(f.run('page.scrollTop'),0);assert.equal(f.run('main.scrollTop'),0);
  f.run('main.scrollTop=42;syncTrainingDialog()');assert.equal(f.run('main.scrollTop'),42);
  f.run('closeTrainingDialog()');
  assert.equal(f.run('active'),false);assert.equal(f.run('screen.hidden'),true);
  assert.equal(f.run('page.scrollTop'),180);assert.equal(f.run('main.scrollTop'),220);
  assert.equal(f.run('focused'),1);
});
test('departure clears detail state without focusing a hidden page',()=>{
  const f=fixture();
  f.run(`let active=false,focused=0;
    const screen={hidden:true,querySelector:()=>null};
    root={querySelector:selector=>selector==='[data-manual-training-screen]'?screen:null,querySelectorAll:()=>[],closest:()=>null,
      classList:{contains:()=>active,toggle(name,value){active=value;}}};
    trainingDialogTrigger={isConnected:true,focus(){focused++;}};
    trainingDialogOpen=true;syncTrainingDialog();closeTrainingDialog({restoreFocus:false});`);
  assert.equal(f.run('trainingDialogOpen'),false);
  assert.equal(f.run('screen.hidden'),true);assert.equal(f.run('focused'),0);
});
test('reward overlay remains in the shared page layer',()=>{
  const f=fixture();
  f.run(`
    setTimeout=()=>1;clearTimeout=()=>{};renderManualCelebration=()=>'<button>繼續修煉</button>';
    const host={parentElement:null,replaceChildren(){this.innerHTML='';}};
    root={closest:()=>({}),append(node){node.parentElement=this;},querySelector:()=>host};
    trainingDialogOpen=true;showManualCelebration({kind:'manual-upgrade'});`);
  assert.equal(f.run('host.parentElement===root'),true);
  assert.match(f.run('host.innerHTML'),/繼續修煉/);
});
