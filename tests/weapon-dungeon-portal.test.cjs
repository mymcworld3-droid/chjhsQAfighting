'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/cultivation/tactical-combat.js'),'utf8');
const W=require('../public/cultivation/weapon-dungeon-rules.js');
function harness({reduced=false}={}){
 const calls=[],timers=[],nodes=[];let current=true;
 const context={QAWeaponDungeons:W,window:{matchMedia:()=>({matches:reduced})},setTimeout:(fn,ms)=>{timers.push({fn,ms});},
 document:{body:{append:n=>nodes.push(n)},createElement:()=>{const labels=new Map();return {classList:{add:c=>calls.push(c)},setAttribute(){},querySelector:k=>{if(!labels.has(k))labels.set(k,{});return labels.get(k)},remove(){calls.push('remove')}}}}};
 vm.createContext(context);vm.runInContext('let dungeonPortal=null;\n'+source.slice(source.indexOf('function removeDungeonPortal(){'),source.indexOf('async function enterTrial(e,account){')),context);
 return {calls,timers,nodes,stop:()=>{current=false;context.removeDungeonPortal()},run:(reveal=async()=>calls.push('reveal'),resume=false)=>context.playDungeonPortal(reveal,{isCurrent:()=>current,selection:{dungeonId:W.ID,difficulty:0,...(resume?{resumeRoomId:'room'}:{})}}),tick:async()=>{timers.shift().fn();await new Promise(resolve=>setImmediate(resolve));}};
}
test('portal covers entry until server reveal then fades and cleans up',async()=>{
 const h=harness(),p=h.run();
 assert.equal(h.nodes.length,1);assert.equal(h.timers[0].ms,420);
 assert.equal(h.nodes[0].querySelector('.wd-portal-title strong').textContent,'尖峰石域');
 await h.tick();assert.deepEqual(h.calls,['reveal','is-revealing']);assert.equal(h.timers[0].ms,260);
 await h.tick();await p;assert.equal(h.calls.at(-1),'remove');
});
test('resume is shorter and cancelled sessions never reveal',async()=>{
 const h=harness(),p=h.run(undefined,true);assert.equal(h.timers[0].ms,160);
 h.stop();await h.tick();await p;assert.ok(!h.calls.includes('reveal'));
});
test('reduced motion immediately reveals with no overlay or timers',async()=>{
 const h=harness({reduced:true});await h.run();assert.equal(h.nodes.length,0);assert.equal(h.timers.length,0);assert.deepEqual(h.calls,['reveal']);
});
test('a failed server reveal removes the portal and propagates the error',async()=>{
 const h=harness(),p=h.run(async()=>{throw Error('failed')});const rejected=assert.rejects(p,/failed/);await h.tick();await rejected;assert.equal(h.calls.at(-1),'remove');
});
