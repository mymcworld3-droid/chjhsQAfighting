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
test('owned weapon training appears only inside an initially closed dialog',()=>{
  const f=fixture(),html=f.run('markup()');
  const dialog=html.match(/<dialog\b[\s\S]*?<\/dialog>/)?.[0];
  assert(dialog);assert.match(dialog,/manual-hero/);assert.match(dialog,/expedition/);
  assert.doesNotMatch(dialog,/\bopen(?:\s|=|>)/);
  assert.doesNotMatch(html.replace(dialog,''),/manual-hero|expedition|manual-xp-reference/);
  assert.match(html.replace(dialog,''),/equipment/);
});
test('opening is modal, data refresh keeps it open, and close restores collection focus',()=>{
  const f=fixture();
  f.run(`let opened=0,closed=0,focused=0;
    const dialog={open:false,showModal(){this.open=true;opened++;},close(){this.open=false;closed++;}};
    root={querySelector:()=>dialog,closest:()=>({})};
    trainingDialogTrigger={isConnected:true,focus(){focused++;}};
    trainingDialogOpen=true;syncTrainingDialog();syncTrainingDialog();`);
  assert.equal(f.run('opened'),1);
  f.run('closeTrainingDialog()');
  assert.equal(f.run('closed'),1);assert.equal(f.run('focused'),1);
  assert.equal(f.run('trainingDialogOpen'),false);
});
test('cancel and page departure dismiss the dialog without leaving it above other pages',()=>{
  const f=fixture();
  f.run(`let prevented=false;
    const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}};
    root={querySelector:()=>dialog,closest:()=>null};
    trainingDialogOpen=true;syncTrainingDialog();dialog.oncancel({preventDefault(){prevented=true;}});`);
  assert.equal(f.run('prevented'),true);assert.equal(f.run('dialog.open'),false);
  f.run('trainingDialogOpen=true;syncTrainingDialog();closeTrainingDialog({restoreFocus:false});');
  assert.equal(f.run('trainingDialogOpen'),false);
});
test('upgrade celebrations share the native training dialog top layer and return outside when it closes',()=>{
  const f=fixture();
  f.run(`
    setTimeout=()=>1;clearTimeout=()=>{};renderManualCelebration=()=>'<button>繼續修煉</button>';
    const host={parentElement:null,replaceChildren(){this.innerHTML='';}};
    const dialog={open:true,append(node){node.parentElement=this;}};
    root={closest:()=>({}),append(node){node.parentElement=this;},querySelector(selector){
      return selector==='[data-manual-celebration-host]'?host:dialog;
    }};
    showManualCelebration({kind:'manual-upgrade'});
  `);
  assert.equal(f.run('host.parentElement===dialog'),true);
  assert.match(f.run('host.innerHTML'),/繼續修煉/);
  f.run("dialog.open=false;showManualCelebration({kind:'discovery'});");
  assert.equal(f.run('host.parentElement===root'),true);
});

test('weapon picker opens once, closes without page movement, and restores its equipment button',()=>{
  const f=fixture();
  f.run(`
    let opened=0,closed=0,focusOptions=null;
    const picker={open:false,showModal(){this.open=true;opened++;},close(){this.open=false;closed++;}};
    root={querySelector:()=>picker,closest:()=>({})};
    pickerDialogTrigger={isConnected:true,focus(options){focusOptions=options;}};
    pickerSlot=1;syncWeaponPicker();syncWeaponPicker();closeWeaponPicker();
  `);
  assert.equal(f.run('opened'),1);assert.equal(f.run('closed'),1);
  assert.equal(f.run('pickerSlot'),null);
  assert.equal(f.run('focusOptions.preventScroll'),true);
});
