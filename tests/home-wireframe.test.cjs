'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(base,p),'utf8');
const html=read('public/index.html'),source=read('public/cultivation/home-wireframe.js');
function fixture(){
  let uid='a',profile={uid:'a',displayName:'雲游子',stats:{gold:12580000,totalScore:188,rankLevel:11}};
  const nodes=new Map();
  for(const id of ['home-art-name','home-art-gold','home-art-realm','home-art-power','xiuxian-realm','xiuxian-sub'])
    nodes.set(id,{textContent:'',setAttribute(name,value){this[name]=value;}});
  nodes.get('xiuxian-realm').textContent='化神';nodes.get('xiuxian-sub').textContent='神念通天';
  const actions=[];
  const window={getCurrentUserData:()=>profile,getCombatPower:()=>({total:3256880,complete:true}),getXiuxianRealmIndex:()=>11,
    switchToPage:id=>actions.push(id),loadLeaderboard:()=>actions.push('leaderboard'),loadStoreItems:()=>actions.push('store'),openDailyMeditation:()=>actions.push('meditation')};
  const document={getElementById:id=>nodes.get(id),querySelector:()=>null,readyState:'loading',addEventListener(){}};
  const ctx=vm.createContext({document,window,getMainUser:()=>uid?{uid}:null});
  vm.runInContext(source.replace(/^import .*$/gm,'')+'\nthis.api={update,activate};',ctx);
  return {ctx,nodes,actions,profile,setUid:value=>{uid=value;}};
}
test('homepage displays live balances and combat power, clearing stale values on account changes',()=>{
  const {ctx,nodes,profile,setUid}=fixture();ctx.api.update();
  assert.equal(nodes.get('home-art-gold').textContent,'12,580,000');
  assert.equal(nodes.get('home-art-power').textContent,'3,256,880');
  assert.equal(nodes.get('home-art-realm').textContent,'化神 · 神念通天');
  profile.stats.gold=7;ctx.api.update();assert.equal(nodes.get('home-art-gold').textContent,'7');
  setUid('b');ctx.api.update();assert.equal(nodes.get('home-art-gold').textContent,'—');assert.equal(nodes.get('home-art-name').textContent,'青雲修士');
  setUid('');ctx.api.update();assert.equal(nodes.get('home-art-power').textContent,'—');
});
test('homepage actions use existing meditation, leaderboard, store and navigation functions',()=>{
  const {ctx,actions}=fixture();
  for(const action of ['meditation','rank','store','settings','gameplay','social'])ctx.api.activate(action);
  assert.deepEqual(actions,['meditation','page-rank','leaderboard','store','page-store','page-settings','page-gameplay','page-social']);
});
test('all homepage images exist and both supplied background orientations are full resolution',()=>{
  const css=read('public/styles/home-wireframe.css');
  const files=[...html.matchAll(/(?:src)="assets\/home\/([^"?]+)"/g)].map(m=>m[1]);
  for(const file of [...files,'home-background-portrait.png','home-background-landscape.png','home-shortcut-frame.png'])
    assert.ok(fs.existsSync(path.join(base,'public/assets/home',file)),file);
  const dimensions=file=>{const b=fs.readFileSync(path.join(base,'public/assets/home',file));return [b.readUInt32BE(16),b.readUInt32BE(20)];};
  assert.deepEqual(dimensions('home-background-portrait.png'),[941,1672]);
  assert.deepEqual(dimensions('home-background-landscape.png'),[1671,941]);
  assert.match(css,/@media \(orientation:landscape\)/);
  assert.equal((html.match(/id="btn-home-start"/g)||[]).length,1);
  assert.match(html,/id="btn-home-start"[^>]+onclick="startQuizFlow\(\)"/);
  for(const id of ['quest-open','xiuxian-meditate','xiuxian-path','home-avatar-container','display-score'])
    assert.equal(html.split('id="'+id+'"').length-1,1,id);
});
