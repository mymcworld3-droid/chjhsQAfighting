'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');

function runtime(quota=false) {
  let now=1000000,attempts=0;
  const timers=new Map();let timerId=0;
  const document={visibilityState:'visible',readyState:'loading',addEventListener(){}};
  const player={uid:'alice',stats:{totalScore:6}};
  const context={document,Date:class extends Date {static now(){return now;}},console:{warn(){},error(){}},
    localStorage:{getItem(){return null;},setItem(){}},
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,at:now+delay});return id;},
    clearTimeout(id){timers.delete(id);},
    QATrainingAccessRules:require('../public/cultivation/training-access-rules.js'),
    getCurrentUserData:()=>player,getMainUser:()=>({uid:'alice'}),
    getApp:()=>({}),getAuth:()=>({currentUser:{uid:'alice'}}),getFirestore:()=>({}),
    getProjectServices:async()=>({db:{}}),doc:()=>({}),
    runTransaction:async()=>{attempts++;throw Object.assign(Error('unavailable'),{code:quota?'resource-exhausted':'unavailable'});},
    updateDoc:async()=>{attempts++;throw Object.assign(Error('unavailable'),{code:quota?'resource-exhausted':'unavailable'});},
    addEventListener(){},dispatchEvent(){}};
  context.window=context;vm.createContext(context);
  return {context,document,timers,attempts:()=>attempts,advance:ms=>{now+=ms;},
    async flush(){for(let i=0;i<12;i++)await Promise.resolve();},
    load(file,suffix=''){
      const source=fs.readFileSync(require.resolve('../public/cultivation/'+file),'utf8').replace(/^import .*;\n/gm,'');
      vm.runInContext(source+suffix,context);
    }};
}

test('unlock sync honors backoff despite bursts of stats events and pauses hidden-page retries',async()=>{
  const h=runtime();h.load('training-access.js','\nthis.syncAccess=sync;');await h.flush();
  assert.equal(h.attempts(),1);
  for(let i=0;i<100;i++)h.context.syncAccess();await h.flush();assert.equal(h.attempts(),1);
  h.advance(5000);h.context.syncAccess();await h.flush();assert.equal(h.attempts(),2);
  h.advance(5000);h.context.syncAccess();await h.flush();assert.equal(h.attempts(),2);
  h.advance(5000);h.document.visibilityState='hidden';h.context.syncAccess();await h.flush();assert.equal(h.attempts(),2);
  h.document.visibilityState='visible';h.context.syncAccess();await h.flush();assert.equal(h.attempts(),3);
});
test('quota exhaustion starts with a one-minute unlock cooldown and doubles it',async()=>{
  const h=runtime(true);h.load('training-access.js','\nthis.syncAccess=sync;');await h.flush();
  h.advance(59000);h.context.syncAccess();await h.flush();assert.equal(h.attempts(),1);
  h.advance(1000);h.context.syncAccess();await h.flush();assert.equal(h.attempts(),2);
  h.advance(60000);h.context.syncAccess();await h.flush();assert.equal(h.attempts(),2);
  h.advance(60000);h.context.syncAccess();await h.flush();assert.equal(h.attempts(),3);
});
test('legacy migration no longer retries on every half-second UI tick',async()=>{
  const h=runtime();
  let source=fs.readFileSync(require.resolve('../public/cultivation/cultivation-progression-v2.js'),'utf8').replace(/^import .*;\n/gm,'');
  source=source.replace(/\}\)\(\);\s*$/, 'window.migrate=ensureLegacyMigration;})();');
  vm.runInContext(source,h.context);
  await h.context.migrate();assert.equal(h.attempts(),1);
  for(let i=0;i<9;i++){h.advance(500);await h.context.migrate();}
  assert.equal(h.attempts(),1);
  h.advance(500);await h.context.migrate();assert.equal(h.attempts(),2);
  h.advance(5000);await h.context.migrate();assert.equal(h.attempts(),2);
  h.advance(5000);await h.context.migrate();assert.equal(h.attempts(),3);
});
