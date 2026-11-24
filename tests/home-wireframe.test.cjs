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
test('home 修行 always opens the current page even without an auxiliary nav',()=>{
  const {ctx,actions}=fixture();
  ctx.api.activate('training');
  assert.deepEqual(actions,['page-training']);
  const nav={disabled:false,hidden:false,click(){actions.push('nav-training-click')}};
  ctx.document.getElementById=id=>id==='nav-training'?nav:null;
  ctx.api.activate('training');
  assert.deepEqual(actions,['page-training','nav-training-click']);
});

test('homepage actions use existing meditation, leaderboard, store and navigation functions',()=>{
  const {ctx,actions}=fixture();
  for(const action of ['meditation','rank','store','settings','gameplay','social'])ctx.api.activate(action);
  assert.deepEqual(actions,['meditation','page-rank','leaderboard','store','page-store','page-settings','page-gameplay','page-social']);
});
test('all homepage images exist and both supplied background orientations are full resolution',()=>{
  const css=read('public/styles/home-wireframe.css');
  const files=[...html.matchAll(/(?:src)="assets\/home\/([^"?]+)"/g)].map(m=>m[1]);
  for(const file of [...files,'home-background-portrait.png','home-background-landscape.png','home-scene-portrait.webp','home-scene-landscape.webp','home-shortcut-frame.png'])
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


test('home artwork scales HUD groups uniformly and never distorts the source images',()=>{
  const css=read('public/styles/home-wireframe.css');
  assert.match(css,/background-size:cover/);
  assert.doesNotMatch(css,/center center\/100% 100% no-repeat/);
  for(const group of ['player','wallet','tools','tasks','meditation','trial']){
    const name='home-art-'+group;
    assert.match(css,new RegExp('\\.'+name+'\\s*\\{[^}]*transform:scale\\(var\\(--ha-'+group+'-fit\\)\\)','s'));
  }
  assert.match(css,/\.home-art-trial img\s*\{[^}]*object-fit:contain/);
  assert.match(css,/\.home-art-avatar\s*\{[^}]*aspect-ratio:1/);
  assert.match(html,/home-wireframe\.css\?v=20261124-independent-shell-v4/);
});

test('player name and combat-power ink wash extend behind the avatar',()=>{
  const css=read('public/styles/home-wireframe.css');
  assert.match(css,/\.home-art-player::before\s*\{/);
  assert.match(css,/\.home-art-player::after\s*\{/);
  assert.match(css,/\.home-art-identity\s*\{[^}]*background:none/s);
  assert.match(css,/\.home-art-power::before\s*\{[^}]*clip-path:polygon/s);
  assert.match(css,/\.home-art-power::after\s*\{[^}]*filter:blur/s);
});


test('stone wallet is slim in both orientations with fit-preserving icon',()=>{
  const css=read('public/styles/home-wireframe.css');
  const overrides=css.slice(css.indexOf('/* Compact homepage HUD: match'));
  assert.match(overrides,/\.home-art-wallet\s*\{[^}]*height:3\.6%;[^}]*min-height:0/s);
  assert.match(overrides,/@media \(orientation:landscape\)\s*\{[^]*?\.home-art-wallet\s*\{[^}]*height:4\.15%;min-height:0/s);
  assert.match(overrides,/\.home-art-coin\s*\{[^}]*object-fit:contain/s);
  assert.match(overrides,/\.home-art-wallet button\s*\{[^}]*min-height:0/s);
});

test('daily quest card uses compact font, rows, header and actions',()=>{
  const css=read('public/styles/home-wireframe.css');
  const overrides=css.slice(css.indexOf('/* Compact homepage HUD: match'));
  assert.match(overrides,/\.home-art-tasks header\s*\{[^}]*margin-bottom:2px/s);
  assert.match(overrides,/\.home-art-task\s*\{[^}]*padding:1px 0;[^}]*line-height:1\.2/s);
  assert.match(overrides,/\.home-art-task button\s*\{[^}]*padding:1px 3px/s);
  assert.match(overrides,/@media \(orientation:landscape\)\s*\{[^]*?\.home-art-task\s*\{[^}]*font-size:clamp\(10px,\.93vw,15px\)/s);
});
