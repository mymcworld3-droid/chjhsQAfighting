'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPresentation}=require('../public/cultivation/shared-dialogs.js');
function fixture(){
 const ids=new Map(),timers=[];
 function el(tag){
  const handlers={},attrs={},children=[];
  const n={tag,handlers,attrs,dataset:{},children,textContent:'',isConnected:false,open:false,
   setAttribute(k,v){attrs[k]=v;},addEventListener(k,f){handlers[k]=f;},
   appendChild(v){v.parent=this;v.isConnected=true;children.push(v);if(v.id)ids.set(v.id,v);return v;},
   remove(){this.isConnected=false;if(this.parent){const i=this.parent.children.indexOf(this);if(i>=0)this.parent.children.splice(i,1);}},focus(){this.focused=true;}};
  Object.defineProperty(n,'firstElementChild',{get:()=>children[0]});
  if(tag==='dialog'){const fields=Object.fromEntries(['h2','p','[data-qy-cancel]','[data-qy-accept]'].map(k=>[k,el('field')]));
   n.querySelector=k=>fields[k];n.showModal=()=>{n.open=true;};n.close=()=>{n.open=false;handlers.close?.();};}
  return n;
 }
 const body=el('body'),trigger=el('button');trigger.isConnected=true;
 const host={document:{body,activeElement:trigger,createElement:el,getElementById:k=>ids.get(k)},setTimeout:f=>timers.push(f),confirm:()=>true};
 return {api:createPresentation(host),body,host,trigger,timers,dialog:()=>body.children.find(n=>n.tag==='dialog')};
}
test('confirmation is single-flight, plain text and restores focus',async()=>{
 const f=fixture(),p=f.api.confirmAction('<img src=x>',{title:'確認購買'}),d=f.dialog();
 assert.equal(d.querySelector('p').textContent,'<img src=x>');assert.equal(d.querySelector('[data-qy-cancel]').focused,true);
 assert.equal(await f.api.confirmAction('duplicate'),false);
 d.querySelector('[data-qy-accept]').handlers.click();d.querySelector('[data-qy-accept]').handlers.click();
 assert.equal(await p,true);assert.equal(f.dialog(),undefined);assert.equal(f.trigger.focused,true);
});
test('cancel, Escape, close and stale account do not confirm',async()=>{
 for(const method of ['cancel','escape','close','stale','account']){
  const f=fixture();let current=true;const p=f.api.confirmAction('刪除',{kind:'danger',isCurrent:()=>current}),d=f.dialog();
  assert.equal(d.dataset.kind,'danger');
  if(method==='cancel')d.querySelector('[data-qy-cancel]').handlers.click();
  if(method==='escape'){let prevented=false;d.handlers.cancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);}
  if(method==='close')d.close();
  if(method==='stale'){current=false;d.querySelector('[data-qy-accept]').handlers.click();}
  if(method==='account')f.api.cancelPending();
  assert.equal(await p,false);assert.equal(f.dialog(),undefined);
 }
});
test('native fallback fails closed and rechecks owner',async()=>{
 const f=fixture();f.host.document.createElement=()=>({});
 assert.equal(await f.api.confirmAction('確認'),true);
 f.host.confirm=()=>false;assert.equal(await f.api.confirmAction('確認'),false);
 assert.equal(await f.api.confirmAction('過期',{isCurrent:()=>false}),false);
 f.host.confirm=()=>{throw Error('unavailable');};assert.equal(await f.api.confirmAction('確認'),false);
});
test('notices are bounded, plain text, and independent of confirmations',async()=>{
 const f=fixture(),pending=f.api.confirmAction('確認');
 for(let i=0;i<4;i++)assert.equal(f.api.notify('<b>'+i+'</b>',{kind:'success'}),true);
 const region=f.host.document.getElementById('qy-notice-region');
 assert.equal(region.children.length,3);assert.equal(region.children[2].textContent,'<b>3</b>');assert.equal(f.dialog().open,true);
 for(const fn of f.timers)fn();assert.equal(region.children.length,0);
 f.api.cancelPending();assert.equal(await pending,false);
});
