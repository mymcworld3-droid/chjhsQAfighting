'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const ui=read('public/cultivation/quest-system.js');
test('仙道 and regular tasks use separate entry views and preserve atlas access',()=>{
  assert.match(read('public/index.html'),/data-home-action="path" aria-label="仙道"[^>]*>.*<span>仙道<\/span>/);
  assert.match(read('public/cultivation/home-wireframe.js'),/case 'path':return window.openCultivationPathQuests/);
  assert.match(ui,/entry.addEventListener\('click', \(\) => openView\('tasks'\)\)/);
  assert.match(ui,/window.openCultivationPathQuests = \(\) => openView\('path'\)/);
  assert.match(ui,/\$\('quest-tab-path'\)\.hidden = !pathMode/);
  assert.match(ui,/\$\('quest-tab-daily'\)\.hidden = pathMode/);
  assert.match(ui,/\$\('quest-tab-weekly'\)\.hidden = pathMode/);
  assert.match(ui,/\$\('xiuxian-path'\)\?\.click\(\)/);
  assert.match(ui,/const available = dailyReady \|\| weeklyReady/);
  assert.match(ui,/\$\('home-path-ready-dot'\)\.hidden = !pathReady/);
});

test('仙道 uses a dedicated page route, while normal tasks retain their dialog',()=>{
 assert.match(read('public/index.html'),/id="page-path" class="page-section hidden/);
 assert.match(ui,/window.switchToPage\?\.\('page-path'\)/);
 assert.match(ui,/if \(!pathMode && !dialog.open\) dialog.showModal\(\)/);
 assert.match(ui,/pathPage\?\.append\(panel\)/);
 assert.match(ui,/此境界解鎖玩法/);
});

test('realm summary shows unlocks directly below the stage status without duplicate stage-goal card',()=>{
 assert.doesNotMatch(ui,/class="path-stage-progress"|階段目標|目標修為 \$\{group.target\}/);
 assert.match(ui,/class="path-stage-status[^\n]*\n\s*<div class="path-unlocks">/);
});

test('portrait uses one shared scroll area for the realm rail and detail while landscape retains three columns',()=>{
 const css=read('public/styles/quest-system.css');
 assert.match(ui,/class="path-stage-detail"/);
 assert.match(css,/\.path-stage-detail\{display:contents\}/);
 assert.match(css,/#page-path \.path-journey\{\s*grid-template-rows:auto;[^}]*overflow-y:auto/);
 assert.match(css,/#page-path \.path-stage-rail\{grid-column:1;grid-row:1;overflow:visible/);
 assert.match(css,/#page-path \.path-stage-tasks\{overflow:visible/);
 assert.match(ui,/journey\.scrollTop=sharedScroll/);
});

test('path title, atlas and refresh share one heading row without a stray tab count',()=>{
 assert.match(ui,/<div class="quest-heading-actions"><button[^>]*id="quest-atlas-open"[^\n]*id="quest-refresh"[^\n]*<\/header>/);
 assert.doesNotMatch(ui,/<div class="quest-scroll"[^>]*><button[^>]*id="quest-atlas-open"/);
 const css=read('public/styles/quest-system.css');
 assert.match(css,/\.quest-dialog-path \.quest-tabs\{display:none!important\}/);
 assert.match(css,/#page-path \.quest-heading\{flex-wrap:nowrap/);
});

test('confirmed path claims open the shared reward modal instead of adding inline cards',async()=>{
 const vm=require('node:vm');
 async function run(kind,{awarded=true,fail=false,stale=false,shown=true,supplemental=false}={}){
  const calls=[],reward={gold:120,weaponDungeonTicket:1};
  let uid='u1';
  const context=vm.createContext({
   busy:false,snapshot:{date:'2026-11-27',weeklyKey:'2026-11-23'},
   dirty:false,reconcileAccount:()=>uid,getMainUser:()=>({uid}),
   render(){},visible:()=>true,invalidate(){},pathVisible:()=>kind==='path',
   status:(...args)=>calls.push(['status',...args]),rewardText:()=> '120 靈石',
   $:id=>id==='quest-reward-receipt'?{id}:null,window:{},console,
   request:async(path,body)=>{calls.push(['request',path,body]);if(fail)throw Error('未入帳');if(stale)uid='u2';return {awarded,reward,quests:{path:{id:'next'},date:'2026-11-27',weeklyKey:'2026-11-23'}};},
   QARewardPresentation:{show:options=>{calls.push(['modal',options]);return shown;},animateInline:(host,options)=>{calls.push(['inline',host,options]);return true;},celebrate:()=>calls.push(['sound'])}
  });
  const body=ui.slice(ui.indexOf('  async function claim(q, kind)'),ui.indexOf('  function go(',ui.indexOf('  async function claim(q, kind)')));
  assert.ok(body.includes('presentation.show'));
  vm.runInContext(body+'\nthis.claim=claim;',context);
  await context.claim({id:'mission',title:'初戰靈獸',supplemental},kind);
  return calls;
 }
 const pathCalls=await run('path');
 const modal=pathCalls.find(c=>c[0]==='modal')[1];
 assert.equal(modal.title,'仙道任務完成');assert.equal(modal.subtitle,'初戰靈獸');
 assert.equal(modal.reward.gold,120);assert.equal(modal.reward.weaponDungeonTicket,1);
 assert.equal(modal.isCurrent(),true);
 assert.equal(pathCalls.filter(c=>c[0]==='request').length,1);
 assert.equal(pathCalls.some(c=>c[0]==='inline'),false);
 assert.equal(pathCalls.some(c=>c[0]==='status'&&c[2]?.gold),false);
 for(const kind of ['daily','weekly','commission']){
  const calls=await run(kind);assert.equal(calls.some(c=>c[0]==='modal'),false);
  assert.equal(calls.some(c=>c[0]==='inline'),true);
 }
 for(const opt of [{awarded:false},{fail:true},{stale:true}]){
  const calls=await run('path',opt);assert.equal(calls.some(c=>c[0]==='modal'),false);
 }
 const fallback=await run('path',{shown:false});
 assert.ok(fallback.some(c=>c[0]==='status'&&c[1].startsWith('已獲得')));
 assert.equal(fallback.some(c=>c[0]==='inline'),false);
 const supplemental=await run('path',{supplemental:true});
 assert.equal(supplemental.find(c=>c[0]==='modal')[1].note,'獎勵已入帳。');
});
