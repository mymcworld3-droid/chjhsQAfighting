'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(base,p),'utf8');
const html=read('public/index.html');
const css=read('public/styles/home-wireframe.css');
const js=read('public/cultivation/home-wireframe.js');
const battle=read('public/cultivation/tactical-combat.js');
const Ecology=require('../public/cultivation/home-trial-ecology.js');
const Rules=require('../public/cultivation/tactical-rules.js');

test('homepage retains original player realm card, six shortcuts and main PvE action',()=>{
  assert.match(html,/id="xiuxian-panel"/);
  assert.match(html,/class="home-wireframe-rail is-left"/);
  assert.match(html,/class="home-wireframe-rail is-right"/);
  for(const action of ['path','rank','store','quest','meditation','learning']){
    assert.equal(html.split('data-home-action="'+action+'"').length-1,1,action);
    assert.match(js,new RegExp("case '"+action+"'"));
  }
  for(const id of ['quest-open','xiuxian-meditate','sect-learning-entry','xiuxian-path','btn-home-start','quest-spotlight']){
    assert.equal(html.split('id="'+id+'"').length-1,1,id);
  }
  assert.match(html,/id="btn-home-start"[^>]+onclick="startQuizFlow\(\)"/);
  assert.match(js,/window\.switchToPage\?\.\('page-store'\)/);
  assert.doesNotMatch(html,/data-target="page-store"/);
  assert.doesNotMatch(html,/id="btn-home-pvp"|>鬥法論道<|我的訂正進度|home-correction-panel|home-correction-meter|home-correction-open/);
  assert.doesNotMatch(css,/btn-home-pvp|home-correction-card/);
  assert.doesNotMatch(js,/home-correction-progress|home-correction-panel/);
});

test('the four-point Learning shortcut opens the full-width list of learning features',()=>{
  assert.match(html,/data-home-action="learning"[^>]*><span class="home-learning-star"[^>]*>✦<\/span><span>學習/);
  assert.doesNotMatch(html,/data-home-action="raid"|id="sect-raid-entry"/);
  assert.doesNotMatch(read('public/main.js'),/cultivation\/raid-mode\.js/);

  let destination;
  const window={switchToPage:page=>{destination=page;}};
  const document={readyState:'loading',addEventListener(){}};
  vm.runInNewContext(js.replace(/^import .*$/gm,'')+"\nactivate('learning');",{document,window});
  assert.equal(destination,'page-learning');

  const page=html.match(/<section id="page-learning"[\s\S]+?<\/section>/)?.[0];
  assert.match(page,/class="page-section hidden"/);
  assert.match(page,/switchToPage\('page-home'\)/);
  assert.match(page,/<button class="learning-feature" id="daily-english-vocabulary"[^>]+onclick="switchToPage\('page-daily-vocabulary'\)"/);
  assert.match(page,/<strong>每日英文單字<\/strong>/);
  assert.match(html,/<section id="page-daily-vocabulary" class="page-section hidden"/);
  assert.match(html,/<script type="module" src="cultivation\/daily-vocabulary-page\.js\?/);
  assert.match(read('public/styles/learning-page.css'),/\.learning-feature\s*\{[^}]*width: 100%;/);
});

test('shortcut columns are in the page grid instead of viewport-fixed overlays',()=>{
  assert.match(css,/\.home-wireframe-rail\{[^}]*position:relative!important/);
  assert.doesNotMatch(css,/position:fixed!important/);
  assert.match(css,/\.home-wireframe-rail\.is-left\{grid-area:left\}/);
  assert.match(css,/\.home-wireframe-rail\.is-right\{grid-area:right\}/);
  assert.match(css,/visibility:hidden!important;pointer-events:none!important/);
});

test('cultivation card uses the exact current main scenic background treatment',()=>{
  assert.match(css,/background:#22251e!important/);
  assert.match(css,/linear-gradient\(90deg,rgba\(22,25,20,\.91\),rgba\(28,32,24,\.55\)\)/);
  assert.match(css,/var\(--xq-scene-art\) 62% center\/cover!important/);
  assert.match(css,/filter:saturate\(\.5\) sepia\(\.15\)!important;opacity:1!important/);
  assert.doesNotMatch(css,/xiuxian-panel::before\{background:none/);
});

test('large circle displays current question-trial terrain image instead of a realm emblem',()=>{
  assert.match(html,/id="home-trial-ecology-image"/);
  assert.match(html,/id="home-trial-ecology-name"/);
  assert.match(html,/id="home-trial-ecology-stage"/);
  assert.doesNotMatch(html,/home-disc-symbol|走入宗門|生態觀景/);
  assert.match(css,/\.home-realm-disc img\{/);
  assert.match(css,/object-fit:cover/);
  assert.match(js,/Ecology\.fromBattle\(data\.state\)/);
  assert.match(js,/Ecology\.fromProgress\(info,Tactical\)/);
  assert.match(battle,/xiuxian:tactical-trial-updated/);
  assert.match(battle,/detail:\{uid,trial:next\.trial,terrain:next\.terrain,map:next\.map\}/);
});

test('each of the five real game biomes resolves to existing CG art',()=>{
  const biomeToId={0:'bamboo',13:'desert',14:'snow',2:'water',16:'ruins'};
  for(const [terrain,id] of Object.entries(biomeToId)){
    const view=Ecology.fromBattle({mode:'pve',trial:{stage:7,title:'真實關卡地形'},terrain:Number(terrain),map:'courtyard'});
    assert.equal(view.id,id);
    assert.equal(view.stage,7);
    assert.equal(view.name,'真實關卡地形');
    assert.equal(fs.existsSync(path.join(base,'public',view.image)),true,view.image);
  }
  assert.equal(Ecology.fromBattle({mode:'pvp',trial:{stage:4},terrain:2}),null);
  assert.equal(Ecology.fromBattle({mode:'pve'}),null);
});

test('saved stage is deterministically reconstructed using the same trial generator',()=>{
  const seed='home-ecology-stage-test';
  for(const stage of [1,2,3,12]){
    const ground=Rules.stageLayout(seed,stage,2);
    const picture=Ecology.fromProgress({seed,stage},Rules);
    assert.equal(picture.stage,stage);
    assert.equal(picture.name,ground.title);
    assert.equal(picture.id,Ecology.resolveFromTerrain(ground.terrain).id);
  }
  assert.equal(Ecology.fromProgress({},Rules),null);
  assert.equal(Ecology.fromProgress({seed:'',stage:1},Rules),null);
  assert.equal(Ecology.fromProgress({seed,stage:0},Rules),null);
});

test('daily task, JSON/AI bank, and original battle systems stay mounted',()=>{
  assert.match(html,/class="home-daily-progress"/);
  assert.match(html,/id="quest-spotlight-slot"/);
  assert.match(read('public/cultivation/quest-system.js'),/recommendedDailyQuest\(\)/);
  assert.match(read('public/main.js'),/\.\/cultivation\/home-wireframe\.js/);
  assert.ok(read('ai-question-bank.cjs').length>100);
  assert.ok(read('daily-meditation-api.cjs').length>100);
  assert.match(battle,/window\.startBattleMatchmaking=\(\)=>open\('pvp'\)/);
  assert.doesNotMatch(js,/runTransaction|\.update\(/);
});

test('landscape uses realm, central scene and CTA, and two right shortcut columns',()=>{
  const landscape=css.slice(css.indexOf('@media (orientation:landscape){'));
  assert.match(landscape,/"realm emblem shortcuts"/);
  assert.match(css,/\.home-trial-column\{\s*grid-area:emblem;display:flex/);
  assert.match(css,/\.home-profile-column\{\s*grid-area:realm;display:flex/);
  assert.match(css,/--home-scene-size:min\(460px,52dvh,40vw\)/);
  assert.match(landscape,/flex-direction:column;align-items:center;text-align:center/);
  assert.match(landscape,/@media \(orientation:landscape\) and \(max-height:460px\)/);
  assert.equal((html.match(/id="btn-home-start"/g)||[]).length,1);
  assert.match(html,/id="btn-home-start"[^>]+onclick="startQuizFlow\(\)"/);
  assert.match(html,/id="btn-home-free-quiz"[^>]+onclick="startFreeQuizFlow\(\)"/);
});

test('portrait anchors all four diamonds at the upper right of the profile, not beside the trial scene',()=>{
  const v6=css.slice(css.indexOf('/* v6: Screenshot-informed placement.'));
  const portrait=v6.slice(v6.indexOf('@media (orientation:portrait){'));
  assert.ok(v6.length>1000);
  assert.match(portrait,/"stones stones stones"\s*"realm left right"\s*"daily daily daily"/);
  assert.match(portrait,/"emblem emblem emblem"\s*"practice practice practice"\s*"wide wide wide"/);
  assert.ok(portrait.indexOf('"realm left right"')<portrait.indexOf('"emblem emblem emblem"'),
    'the command cluster must appear before the central trial scene');
  assert.match(portrait,/\.home-profile-column\{\s*display:contents!important/);
  assert.match(portrait,/\.home-shortcut-column>\.home-wireframe-rail\.is-left\{\s*grid-area:left!important/);
  assert.match(portrait,/\.home-shortcut-column>\.home-wireframe-rail\.is-right\{\s*grid-area:right!important/);
  assert.match(portrait,/\.home-practice\{\s*grid-area:practice!important/);
  assert.match(portrait,/\.home-shortcut-column>\.home-wide-actions\{\s*grid-area:wide!important/);
  assert.doesNotMatch(v6,/position:fixed!important/);
  assert.doesNotMatch(js,/document\.body\.appendChild\(homeLeftRail\)|home-rails-portal|syncPortraitRails/);
  assert.match(html,/home-wireframe\.css\?v=20261125-upper-right-diamonds-v6/);
});

test('daily progress, records and independent correction host follow realm in both orientations',()=>{
  const column=html.match(/<div class="home-profile-column">([\s\S]*?)<div id="home-learning-slot"><\/div>\s*<\/div>/)?.[1];
  assert.ok(column);
  assert.ok(column.indexOf('id="xiuxian-panel"')<column.indexOf('class="home-daily-progress"'));
  assert.ok(column.indexOf('class="home-daily-progress"')<column.indexOf('class="home-records"'));
  const growth=read('public/cultivation/player-growth-feedback.js');
  assert.match(growth,/getElementById\('home-learning-slot'\)/);
  assert.match(growth,/host\.appendChild\(slot\)/);
  assert.match(css,/#home-learning-slot:empty\{display:none\}/);
});

test('landscape centerline uses equal side tracks and shared shortcut grid',()=>{
  assert.match(css,/grid-template-columns:minmax\(0,1fr\) minmax\(0,1\.6fr\) minmax\(0,1fr\)!important/);
  assert.match(css,/\.home-trial-column>\.home-practice\{\s*align-self:center!important;margin-inline:auto!important;\s*width:100%!important;max-width:var\(--home-scene-size\)/);
  assert.match(css,/\.home-shortcut-column\{\s*grid-area:shortcuts;display:grid;\s*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.home-shortcut-column>\.home-wireframe-rail\{\s*grid-area:auto!important;display:grid!important;\s*grid-template-rows:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/\.home-shortcut-column\{display:contents\}/);
  const rail=html.match(/<div class="home-shortcut-column">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(rail);
  assert.equal((rail.match(/data-home-action="/g)||[]).length,6);
});


test('the four secondary homepage actions are diamonds and meditation/learning are wide rectangles',()=>{
  const diamonds=['path','rank','store','quest'],wide=['meditation','learning'];
  for(const action of diamonds){
    const markup=html.match(new RegExp('<button class="home-wireframe-shortcut ([^"]+)"[^>]*data-home-action="'+action+'"'));
    assert.ok(markup,'shortcut '+action+' exists');
    assert.equal(markup[1],'home-shortcut--diamond',action+' is a diamond');
    assert.match(js,new RegExp("case '"+action+"'"),action+' keeps its navigation handler');
  }
  for(const action of wide){
    const markup=html.match(new RegExp('<button class="home-wireframe-shortcut ([^"]+)"[^>]*data-home-action="'+action+'"'));
    assert.ok(markup,'shortcut '+action+' exists');
    assert.equal(markup[1],'home-shortcut--wide',action+' is a wide rectangle');
  }
  assert.equal((html.match(/home-shortcut--diamond"/g)||[]).length,4);
  assert.equal((html.match(/home-shortcut--wide"/g)||[]).length,2);
  assert.match(css,/\.home-shortcut--diamond::before\s*\{[^}]*transform:rotate\(45deg\)/s);
  assert.match(css,/\.home-shortcut--wide\s*\{[^}]*width:100%!important/s);
  assert.match(css,/\.home-shortcut--wide\s*\{[^}]*max-width:175px!important/s);
  assert.match(css,/@media \(orientation:landscape\)\s*\{\s*body\.ui-cleanup #page-home \.home-shortcut-column\{/);
  assert.match(css,/@media \(orientation:portrait\)\s*\{\s*body\.ui-cleanup #page-home \.home-shortcut-column\{/);
  assert.match(css,/pointer-events:none;/);
  assert.match(css,/touch-action:manipulation/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});


test('landscape groups currency first, a two-by-two diamond grid, and two daily wide actions',()=>{
  assert.match(html,/<output id="home-spirit-stones"[^>]*aria-live="polite"/);
  assert.match(html,/<strong id="home-spirit-stones-count">—<\/strong>/);
  assert.match(html,/class="home-wide-actions" role="group"/);
  assert.match(css,/"stones stones"\s*"left right"\s*"\. \."\s*"wide wide"!important/);
  assert.match(css,/grid-template-rows:repeat\(2,minmax\(0,1fr\)\)!important/);
  const left=html.match(/<aside class="home-wireframe-rail is-left"[^>]*>([\s\S]*?)<\/aside>/)?.[1];
  const right=html.match(/<aside class="home-wireframe-rail is-right"[^>]*>([\s\S]*?)<\/aside>/)?.[1];
  const wide=html.match(/<div class="home-wide-actions"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  assert.ok(left&&right&&wide);
  assert.deepEqual([...left.matchAll(/data-home-action="([^"]+)"/g)].map(m=>m[1]),['path','rank']);
  assert.deepEqual([...right.matchAll(/data-home-action="([^"]+)"/g)].map(m=>m[1]),['quest','store']);
  assert.deepEqual([...wide.matchAll(/data-home-action="([^"]+)"/g)].map(m=>m[1]),['meditation','learning']);
  assert.match(css,/"stones stones stones"\s*"realm left right"[\s\S]*"emblem emblem emblem"\s*"practice practice practice"\s*"wide wide wide"/);
  assert.match(css,/#page-home \.home-shortcut-column>\.home-spirit-stones\{\s*grid-area:stones!important/);
  assert.match(html,/home-wireframe\.css\?v=20261125-upper-right-diamonds-v6/);
  assert.match(read('public/main.js'),/modulePath === '\.\/cultivation\/home-wireframe\.js'/);
});

test('spirit-stone readout formats actual signed-in stats, tracks changes, and clears on account switch',()=>{
  assert.match(js,/player\?\.stats\?\.gold/);
  const amount={textContent:'—'},host={dataset:{}};
  let player={uid:'u1',stats:{gold:5602}},user={uid:'u1'};
  const document={readyState:'loading',addEventListener(){},
    getElementById(id){return id==='home-spirit-stones-count'?amount:id==='home-spirit-stones'?host:null;}};
  const context=vm.createContext({document,getMainUser:()=>user,
    window:{getCurrentUserData:()=>player},globalThis:{QAHomeTrialEcology:{},QATactical:{}}});
  vm.runInContext(js.replace(/^import .*$/gm,''),context);
  const refresh=()=>vm.runInContext('refreshSpiritStones()',context);
  refresh();assert.equal(amount.textContent,'5,602');assert.equal(host.dataset.balanceLoaded,'true');
  player.stats.gold=0;refresh();assert.equal(amount.textContent,'0');
  player.stats.gold=1234567;refresh();assert.equal(amount.textContent,'1,234,567');
  user={uid:'u2'};refresh();assert.equal(amount.textContent,'—');assert.equal(host.dataset.balanceLoaded,'false');
  player={uid:'u2',stats:{gold:84}};refresh();assert.equal(amount.textContent,'84');
  user=null;refresh();assert.equal(amount.textContent,'—');
  player={uid:'u2',stats:{}};user={uid:'u2'};refresh();assert.equal(amount.textContent,'—');
});
