'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {syncProgress,syncBadge,syncState}=require('../public/cultivation/shared-feedback.js');
function node(attrs={},extra={}){
 const map=new Map(Object.entries(attrs));
 return {map,textContent:'',getAttribute:k=>map.get(k)??null,hasAttribute:k=>map.has(k),setAttribute:(k,v)=>map.set(k,v),...extra};
}
test('home progress mirrors the owner without writing its fill',()=>{
 const track=node(),fill=node({},{id:'xiuxian-progress',style:{width:'47.5%'},parentElement:track});
 syncProgress(fill);assert.equal(track.getAttribute('aria-valuenow'),'47.5');
 assert.equal(track.getAttribute('role'),'progressbar');assert.equal(fill.style.width,'47.5%');
 fill.style.width='110%';syncProgress(fill);assert.equal(track.getAttribute('aria-valuenow'),'100');assert.equal(fill.style.width,'110%');
});
test('segmented progress retains its authoritative counts and semantic text',()=>{
 const n=node({'aria-label':'境界征服','aria-valuenow':'2','aria-valuemax':'6','data-qy-progress':'segmented'},{textContent:'2 / 6'});
 syncProgress(n);assert.equal(n.getAttribute('role'),'progressbar');assert.equal(n.getAttribute('aria-valuenow'),'2');assert.equal(n.textContent,'2 / 6');
});
test('shared status does not replace owner messages or retry semantics',()=>{
 for(const key of ['loading','syncing','preparing','empty','error','retry']){
  const n=node({'data-qy-state':key},{textContent:'原有訊息'});
  syncState(n);assert.equal(n.getAttribute('role'),'status');assert.equal(n.getAttribute('aria-live'),'polite');assert.equal(n.textContent,'原有訊息');
 }
 const n=node({'data-qy-state':'error','role':'alert'});syncState(n);assert.equal(n.getAttribute('role'),'alert');
});
test('counts and dots follow owner text without changing visibility or content',()=>{
 for(const [value,kind] of [['4','count'],['99+','count'],['•','dot'],['','dot'],['0','dot']]){
  const n=node({},{textContent:value,hidden:true});syncBadge(n);assert.equal(n.getAttribute('data-qy-badge'),kind);assert.equal(n.hidden,true);assert.equal(n.textContent,value);
 }
});
