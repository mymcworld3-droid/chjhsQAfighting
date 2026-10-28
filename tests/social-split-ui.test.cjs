const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const main=fs.readFileSync(require.resolve('../public/main-legacy.js'),'utf8');
function element(hidden=false){const classes=new Set(hidden?['hidden']:[]);return {attributes:{},classList:{contains:x=>classes.has(x),toggle(x,on){if(on)classes.add(x);else classes.delete(x);}},setAttribute(k,v){this.attributes[k]=v;}};}
test('social tabs display one independent panel and acknowledge only their own public feed',()=>{
  const nodes=new Map(),events=[];for(const name of ['friends','chat','shares','classes']){nodes.set('section-'+name,element(name!=='friends'));nodes.set('tab-btn-'+name,element());}
  const context={window:{QAFriendChat:{ackGlobalChat:()=>events.push('ack-chat'),ackScopeShares:()=>events.push('ack-shares'),updateBadges(){}},QAClassrooms:{open:()=>events.push('classes')}},
    document:{getElementById:id=>nodes.get(id)},beginSceneTransition:()=>()=>{},loadFriendList:()=>events.push('friends'),listenToGlobalChat:kind=>events.push('listen-'+kind),chatUnsub:()=>events.push('stop')};
  const a=main.indexOf('window.switchSocialTab ='),b=main.indexOf('function listenToGlobalChat(',a);
  vm.runInNewContext(main.slice(a,b),context);
  for(const name of ['shares','chat','classes','friends']){
    context.window.switchSocialTab(name);
    assert.deepEqual([...nodes].filter(([id,el])=>id.startsWith('section-')&&!el.classList.contains('hidden')).map(([id])=>id),['section-'+name]);
    assert.equal(nodes.get('tab-btn-'+name).attributes['aria-selected'],'true');
  }
  assert.deepEqual(events,['stop','listen-shares','ack-shares','listen-chat','ack-chat','classes','friends']);
});
test('chat and scope unread state, seen markers and acknowledgements remain independent',async()=>{
  const nodes=new Map(),callbacks=new Map(),storage=new Map([['xiuxian-global-chat-seen:alice','c0'],['xiuxian-scope-shares-seen:alice','s0']]);
  let uid='alice',stops=0;
  const context={document:{visibilityState:'visible',addEventListener(){},getElementById:id=>nodes.get(id),querySelectorAll:()=>[]},window:{addEventListener(){}},
    getMainUser:()=>({uid}),getProjectServices:async()=>({db:{}}),subscribeSocialFeed:(_db,kind,_n,next)=>{callbacks.set(kind,next);return()=>{stops++;};},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},console,setInterval:()=>1,clearInterval(){}};
  const source=fs.readFileSync(require.resolve('../public/cultivation/alliance-friend-chat.js'),'utf8').replace(/^import .*;\n/gm,'');
  vm.runInNewContext(source+'\nthis.api={state,listenGlobal,stopGlobalListener,ackGlobalChat,ackScopeShares};',context);
  const api=context.api;api.state.uid='alice';nodes.set('page-social',element());nodes.get('page-social').classList.toggle('active-page',true);
  nodes.set('section-chat',element(true));nodes.set('section-shares',element(true));
  await api.listenGlobal();
  callbacks.get('chat')([{id:'c1',data:()=>({uid:'bob'})}]);callbacks.get('shares')([{id:'s1',data:()=>({uid:'bob'})}]);
  assert(api.state.globalUnread);assert(api.state.scopeUnread);
  api.ackGlobalChat();assert(!api.state.globalUnread);assert(api.state.scopeUnread);assert.equal(storage.get('xiuxian-scope-shares-seen:alice'),'s0');
  api.ackScopeShares();assert(!api.state.scopeUnread);assert.equal(storage.get('xiuxian-scope-shares-seen:alice'),'s1');
  nodes.get('section-chat').classList.toggle('hidden',false);
  callbacks.get('shares')([{id:'s2',data:()=>({uid:'bob'})}]);assert(api.state.scopeUnread);assert(!api.state.globalUnread);
  uid='other';callbacks.get('shares')([{id:'old-account',data:()=>({uid:'bob'})}]);assert.equal(api.state.scopeLatest,'s2');
  api.stopGlobalListener();assert.equal(stops,2);
});
