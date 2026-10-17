const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/raid-mode.js'),'utf8');
const start=source.indexOf('  async function kickPartyMember('),end=source.indexOf('  function currentBossClock(',start);
function fixture() {
  const calls=[],toasts=[];let confirm;
  const state={roomId:'room12345',player:{uid:'a'},roomCommand:'',room:{status:'waiting',hostUid:'a',members:{a:{name:'甲'},b:{name:'乙'}}}};
  const context={state,window:{openConfirm:()=>new Promise(resolve=>{confirm=resolve;})},
    isHost:()=>state.room.hostUid===state.player.uid,renderLobby(){},toast:text=>toasts.push(text),
    kickRaidMember:async(id,uid)=>calls.push({id,uid})};
  vm.runInNewContext(source.slice(start,end)+'\nthis.kick=kickPartyMember;',context);
  return {state,context,calls,toasts,kick:context.kick,confirm:value=>confirm(value)};
}
test('kick requires confirmation, ignores double clicks and releases controls on cancel or completion',async()=>{
  const f=fixture();
  const cancelled=f.kick('b');assert.equal(f.state.roomCommand,'kick:b');assert.equal(f.calls.length,0);
  await f.kick('b');f.confirm(false);await cancelled;
  assert.equal(f.state.roomCommand,'');assert.equal(f.calls.length,0);
  const accepted=f.kick('b');f.confirm(true);await accepted;
  assert.deepEqual(f.calls,[{id:'room12345',uid:'b'}]);assert.equal(f.state.roomCommand,'');
  assert.match(f.toasts.at(-1),/已將「乙」踢出/);
});
test('member role, self-kicks, started rooms and changed rooms cannot send kick requests',async()=>{
  const f=fixture();await f.kick('a');assert.equal(f.state.roomCommand,'');
  f.state.player.uid='b';await f.kick('a');assert.equal(f.calls.length,0);
  f.state.player.uid='a';f.state.room.status='active';await f.kick('b');assert.equal(f.state.roomCommand,'');
  f.state.room.status='waiting';const pending=f.kick('b');f.state.roomId='different';f.confirm(true);await pending;
  assert.equal(f.calls.length,0);
});
test('server rejection is shown and allows another attempt',async()=>{
  const f=fixture();f.context.kickRaidMember=async()=>{throw Error('團本已開始');};
  const pending=f.kick('b');f.confirm(true);await pending;
  assert.equal(f.state.roomCommand,'');assert.equal(f.toasts.at(-1),'團本已開始');
});
