'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const W=require('../public/world/world-core.js');
function view(){
  const context={QAGridWorld:W},source=fs.readFileSync(path.join(__dirname,'../public/world/world-view.js'),'utf8').replace(/^import .*;\n/gm,'').replace('export class WorldView','this.View=class WorldView');
  vm.runInNewContext(source,context);const v=Object.create(context.View.prototype);
  Object.assign(v,{world:W,visible:true,online:true,seq:0,uid:'u',sessionId:'session',players:[{uid:'u',route:{path:[W.SPAWN],startedAtMs:0,stepMs:W.STEP_MS}}],now:()=>100000,renderer:{set(){}},closePanel(){},set(){},message(){}});return v;
}
test('partial movement keeps the final destination and deferred interaction without a fog-boundary message',async()=>{
  const v=view(),target={x:540,y:500};v.checkArrival=()=>{};v.message=()=>assert.fail('fog is not a movement warning');
  v.api=async()=>({partial:true,self:v.players[0]});await v.move(target,'test-object',true);
  assert.deepEqual(JSON.parse(JSON.stringify(v.navigation)),{target,objectId:'test-object',after:true});assert.equal(v.pending,null);
});
test('arrival automatically continues one segment at a time and preserves the original goal',async()=>{
  const v=view();v.navigation={target:{x:900,y:500},objectId:null,after:null};let calls=0,resolve;
  v.move=async(target)=>{calls++;assert.equal(target.x,900);await new Promise(r=>{resolve=r;});};
  v.checkArrival();v.checkArrival();assert.equal(calls,1);assert.equal(v.navigation,null);assert.equal(v.continuing,true);
  resolve();await new Promise(r=>setImmediate(r));assert.equal(v.continuing,false);
});
test('stop and leaving the active view prevent any pending segment from restarting movement',async()=>{
  const v=view();v.navigation={target:{x:900,y:500}};v.api=async()=>({self:v.players[0]});await v.action('stop');assert.equal(v.navigation,null);
  v.navigation={target:{x:900,y:500}};v.visible=false;v.move=()=>assert.fail('inactive view must not restart a route');v.checkArrival();
});
