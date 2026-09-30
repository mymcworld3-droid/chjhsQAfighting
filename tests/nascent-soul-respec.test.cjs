const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=p=>fs.readFileSync(require('node:path').join(__dirname,'..',p),'utf8');
const rules=vm.runInNewContext(read('public/cultivation/nascent-soul-rules.js').replace(/^export /gm,'')+
  '\n({normalizeSpirit,normalizeSoulTree,soulSpentSpirit,soulAvailableSpirit,soulInvestmentSummary,resetSoulTree,allocateSoulNode})');
const tree=()=>({version:4,paths:{
  sword:{nodes:{leftMain:5,leftTop:2},baselineNodes:{},legacySpent:0},
  ocean:{nodes:{rightMain:5},baselineNodes:{},legacySpent:0}
}});
test('switching core preserves both trees and explains the shared balance',()=>{
  const before=tree(), raw=JSON.stringify(before);
  const summary=rules.soulInvestmentSummary(before,'ocean');
  assert.equal(summary.find(p=>p.type==='sword').spent,11);
  assert.equal(summary.find(p=>p.type==='sword').active,false);
  assert.equal(summary.find(p=>p.type==='ocean').spent,5);
  assert.equal(rules.soulAvailableSpirit(before,30),14);
  assert.equal(JSON.stringify(before),raw);
});
test('respec releases all paths without changing earned spirit and repeated reset returns zero',()=>{
  const before=tree(),raw=JSON.stringify(before), r=rules.resetSoulTree(before,30);
  assert.equal(r.released,16);assert.equal(r.returned,16);assert.equal(r.remaining,30);
  assert.equal(Object.keys(r.tree.paths).length,0);
  assert.equal(JSON.stringify(before),raw);
  assert.equal(rules.resetSoulTree(r.tree,30).returned,0);
  const next=rules.allocateSoulNode(r.tree,'ocean','leftMain',30);
  assert.equal(next.ok,true);assert.equal(next.remaining,29);
});
test('legacy paid baseline releases historical costs exactly once',()=>{
  for(const version of [2,3,4]){
    const legacy={version,paths:{sword:{nodes:{leftMain:5,leftTop:2},
      baselineNodes:{leftMain:5},legacySpent:25}}};
    const spent=rules.soulSpentSpirit(legacy);
    const result=rules.resetSoulTree(legacy,100);
    assert.equal(result.returned,spent);assert.equal(result.remaining,100);
    assert.equal(rules.resetSoulTree(result.tree,100).returned,0);
  }
});
test('damaged balance cannot mint spirit from costs greater than lifetime earnings',()=>{
  const r=rules.resetSoulTree(tree(),3);
  assert.equal(r.released,16);assert.equal(r.returned,3);assert.equal(r.remaining,3);
});
const training=read('public/cultivation/cultivation-training-v4.js');
const start=training.indexOf('  async function respecSoulTree() {');
const end=training.indexOf('  function bindSoulActions()',start);
async function run({confirm=true,concurrent=false,fail=false,accountChanged=false}={}){
  const remote={nascentSoulTree:tree(),stats:{totalScore:68,nascentSoulSpirit:30}};
  const local=JSON.parse(JSON.stringify(remote)),original=JSON.stringify(remote), writes=[],messages=[];
  let uid='test', calls=0;
  const context={
    ...rules,soulBusy:false,busy:false,NASCENT_SOUL_THRESHOLD:68,activeTab:'nascent-soul',
    currentScore:()=>68,getApp:()=>({}),getAuth:()=>({currentUser:{uid}}),
    getFirestore:()=>({}),doc:()=>({}),renderTrainingPage:()=>{},currentSoulType:()=>'ocean',
    selectedSoulNodeId:'leftMain',toast:x=>messages.push(x),console:{error:()=>{}},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
    window:{getCurrentUserData:()=>local,dispatchEvent:()=>{},
      openConfirm:async()=>{
        if(concurrent)remote.nascentSoulTree.paths.sword.nodes.leftMain=6;
        if(accountChanged)uid='other';
        return confirm;
      }},
    runTransaction:async(db,worker)=>{
      calls++;if(fail&&calls===2)throw new Error('offline');
      const staged=[];
      const result=await worker({get:async()=>({exists:()=>true,data:()=>remote}),
        update:(ref,patch)=>staged.push(patch)});
      for(const patch of staged){writes.push(patch);Object.assign(remote,patch);}
      return result;
    }
  };
  vm.createContext(context);
  vm.runInContext(training.slice(start,end)+'\nthis.runRespec=respecSoulTree;',context);
  await context.runRespec();
  return {remote,local,original,writes,messages,context};
}
test('confirmed transaction clears only tree, preserves earned balance and updates local projection',async()=>{
  const r=await run();
  assert.equal(r.writes.length,1);
  assert.deepEqual(Object.keys(r.writes[0]),['nascentSoulTree']);
  assert.equal(Object.keys(r.remote.nascentSoulTree.paths).length,0);
  assert.equal(Object.keys(r.local.nascentSoulTree.paths).length,0);
  assert.equal(r.remote.stats.nascentSoulSpirit,30);
  assert.equal(r.local.stats.nascentSoulSpirit,30);
  assert.equal(r.context.soulBusy,false);
});
test('cancelled confirmation preserves remote and local nodes without a write',async()=>{
  const r=await run({confirm:false});
  assert.equal(r.writes.length,0);assert.equal(JSON.stringify(r.remote),r.original);
  assert.equal(JSON.stringify(r.local),r.original);
});
test('new allocation during confirmation prevents resetting unseen investments',async()=>{
  const r=await run({concurrent:true});
  assert.equal(r.writes.length,0);assert.equal(r.remote.nascentSoulTree.paths.sword.nodes.leftMain,6);
  assert.match(r.messages.join(' '),/配點已變更/);
});
test('failed persistence never clears the local tree or reports success',async()=>{
  const r=await run({fail:true});
  assert.equal(r.writes.length,0);assert.equal(JSON.stringify(r.local),r.original);
  assert.equal(JSON.stringify(r.remote),r.original);assert.match(r.messages.join(' '),/重修未完成/);
});
test('account change during confirmation prevents a write to the former player',async()=>{
  const r=await run({accountChanged:true});
  assert.equal(r.writes.length,0);assert.equal(JSON.stringify(r.remote),r.original);
  assert.match(r.messages.join(' '),/登入帳號已變更/);
});
