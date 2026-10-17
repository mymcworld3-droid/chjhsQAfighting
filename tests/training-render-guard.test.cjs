const {test}=require('node:test');
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/training-render-guard.js'),'utf8').replace(/^export /gm,'');
function runtime(saved,now=100000) {
  const handlers={};let record=saved;
  const context={Date:{now:()=>now},console:{warn(){}},performance:{getEntriesByType:()=>[{type:'reload'}]},document:{wasDiscarded:false},
    sessionStorage:{getItem:()=>record,setItem:(_,value)=>{record=value;}},window:{addEventListener:(type,fn)=>handlers[type]=fn}};
  vm.runInNewContext(source+'\nthis.api={trainingRenderProfile,markTrainingEntry,markTrainingStable,markTrainingExit};',context);
  return {api:context.api,handlers,record:()=>record,diagnostics:context.window.getTrainingRenderDiagnostics};
}
test('ordinary navigation, explicit reload and a stable map do not enable crash recovery',()=>{
  const f=runtime();assert.equal(f.api.trainingRenderProfile(),'balanced');f.api.markTrainingEntry();f.handlers.pagehide();
  assert.equal(runtime(f.record()).api.trainingRenderProfile(),'balanced','normal reload fires pagehide');
  f.api.markTrainingStable();assert.equal(runtime(f.record()).api.trainingRenderProfile(),'balanced');
  f.api.markTrainingEntry();f.api.markTrainingExit();assert.equal(runtime(f.record()).api.trainingRenderProfile(),'balanced');
});
test('an interrupted training entry uses the lighter renderer, without changing account or game progress',()=>{
  const first=runtime();first.api.markTrainingEntry();
  const recovered=runtime(first.record());
  assert.equal(recovered.api.trainingRenderProfile(),'safe');assert.equal(recovered.diagnostics().interruptedEntry,true);
  recovered.api.markTrainingEntry();recovered.api.markTrainingStable();
  assert.equal(runtime(recovered.record()).api.trainingRenderProfile(),'safe','keep the stable renderer for this tab');
  assert.deepEqual(Object.keys(JSON.parse(recovered.record())).sort(),['at','cleanExit','entering','safe']);
});
test('old interruption records and blocked storage cannot stop opening the map',()=>{
  const first=runtime();first.api.markTrainingEntry();assert.equal(runtime(first.record(),200000).api.trainingRenderProfile(),'balanced');
  const context={Date,console,performance:{},document:{},window:{addEventListener(){}},sessionStorage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}};
  vm.runInNewContext(source+'\nmarkTrainingEntry();markTrainingStable();markTrainingExit();',context);
});
