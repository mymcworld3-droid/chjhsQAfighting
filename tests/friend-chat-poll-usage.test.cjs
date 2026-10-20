'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');

function harness(){
  const calls=[],errors=[];
  let latest='m1',friends=true;
  const title={textContent:''};
  const document={visibilityState:'visible',addEventListener(){},getElementById:id=>id==='alliance-chat-title'?title:null,querySelectorAll:()=>[]};
  const context=vm.createContext({document,window:{addEventListener(){}},console,setInterval,clearInterval,
    getMainUser:()=>({uid:'alice'}),
    authenticatedMainFetch:async(url,options)=>{
      const action=url.split('/').at(-1);calls.push(action);
      if(action==='inbox')return {ok:true,json:async()=>({ok:true,conversations:friends?[{peerUid:'bob',lastMessageId:latest,unread:latest==='m1'?0:1}]:[]})};
      if(action==='thread')return {ok:friends,json:async()=>friends?{ok:true,peerName:'道友',lastMessageId:latest,messages:[]}:{error:'只有互為仙盟好友才能私聊'}};
      if(action==='read')return {ok:true,json:async()=>({ok:true,cleared:true})};
      throw Error('unexpected request');
    }});
  const source=fs.readFileSync(require.resolve('../public/cultivation/alliance-friend-chat.js'),'utf8').replace(/^import .*;\n/gm,'');
  vm.runInContext(source+'\nrender=()=>{};reportError=message=>captureError(message);this.api={state,poll};',context);
  context.captureError=message=>errors.push(message);
  context.api.state.uid='alice';context.api.state.peer='bob';context.api.state.lastMessageId='m1';
  return {...context.api,document,calls,errors,setLatest:id=>{latest=id;},revoke:()=>{friends=false;}};
}
test('unchanged open chat polls only inbox; a new message loads history and acknowledges once',async()=>{
  const h=harness();await h.poll();assert.deepEqual(h.calls,['inbox']);
  h.calls.length=0;h.setLatest('m2');await h.poll();
  assert.deepEqual(h.calls,['inbox','thread','read']);assert.equal(h.state.lastMessageId,'m2');
  assert.equal(h.state.conversations.get('bob').unread,0);
});
test('removed friendship is rechecked and a hidden page makes no polling request',async()=>{
  const h=harness();h.revoke();await h.poll();
  assert.deepEqual(h.calls,['inbox','thread']);assert.equal(h.errors.at(-1),'只有互為仙盟好友才能私聊');
  h.calls.length=0;h.document.visibilityState='hidden';await h.poll();assert.equal(h.calls.length,0);
});
