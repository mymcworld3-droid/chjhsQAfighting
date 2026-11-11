'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const base=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(base,p),'utf8');
const html=read('public/index.html');
const css=read('public/styles/home-wireframe.css');
const js=read('public/cultivation/home-wireframe.js');
const learning=require('../public/cultivation/home-correction-progress.js');

test('hand-drawn homepage has original player card, two rectangular shortcut rails, circle and large question button',()=>{
  assert.match(html,/id="xiuxian-panel"/);
  assert.match(html,/class="home-wireframe-rail is-left"/);
  assert.match(html,/class="home-wireframe-rail is-right"/);
  assert.match(html,/id="home-realm-emblem"/);
  assert.match(html,/class="home-realm-disc"/);
  assert.match(css,/border-radius:12px/);
  assert.doesNotMatch(css,/clip-path|polygon/);
  assert.match(css,/grid-template-areas:/);
  assert.match(css,/"left realm emblem right"/);
  assert.match(css,/"realm realm realm"/);
  assert.ok(html.indexOf('id="xiuxian-panel"')<html.indexOf('id="home-realm-emblem"'));
  assert.ok(html.indexOf('id="home-realm-emblem"')<html.indexOf('id="btn-home-start"'));
  assert.doesNotMatch(html,/走入宗門|生態觀景|home-ecology/);
});

test('six real shortcuts remain rectangular and existing actions keep unique handlers',()=>{
  for(const action of ['path','rank','share','quest','meditation','raid','correction']){
    assert.equal(html.split('data-home-action="'+action+'"').length-1,1);
    assert.match(js,new RegExp("case '"+action+"'"));
  }
  for(const id of ['quest-open','xiuxian-meditate','sect-raid-entry','xiuxian-path','btn-home-start','btn-home-pvp','quest-spotlight']){
    assert.equal(html.split('id="'+id+'"').length-1,1,id);
  }
  assert.match(html,/id="btn-home-start"[^>]+onclick="startQuizFlow\(\)"/);
  assert.match(js,/window\.startQuizFlow\?\.\(\)/);
  assert.match(js,/window\.switchToPage\?\.\('page-social'\)/);
  assert.match(js,/\.click\(\)/);
});

test('left-lower daily panel contains live official task card and correction bar, without fake progress',()=>{
  assert.match(html,/class="home-daily-progress"/);
  assert.match(html,/id="quest-spotlight-slot"/);
  assert.match(html,/id="home-correction-panel"/);
  assert.match(html,/id="home-correction-meter"/);
  assert.match(html,/id="home-correction-fill"/);
  assert.ok(html.indexOf('class="home-daily-progress"')<html.indexOf('id="home-correction-panel"'));
  assert.match(read('public/cultivation/quest-system.js'),/function recommendedDailyQuest\(\)/);
  assert.match(read('public/cultivation/quest-system.js'),/const item = recommendedDailyQuest\(\)/);
  assert.match(css,/border-left:3px solid/);
  assert.match(css,/grid-area:correction/);
  assert.doesNotMatch(js,/authenticatedMainFetch|runTransaction|\.update\(/);
});

test('real mistake history, bounded to last saved records, drives correction fraction',()=>{
  assert.deepEqual(learning.summarize({soloLearningV1:{mistakes:{}}}),
    {total:0,completed:0,pending:0,percent:0,label:'目前沒有待訂正的錯題'});
  const p=learning.summarize({soloLearningV1:{mistakes:{
    'q:old':{recovered:true},'q:new':{recovered:false},'q:third':{recovered:true}
  }}});
  assert.equal(p.total,3);assert.equal(p.completed,2);assert.equal(p.pending,1);assert.equal(p.percent,67);
  assert.equal(learning.summarize({}).total,0);
  assert.equal(learning.summarize({soloLearningV1:{mistakes:[]}}).total,0);
  assert.match(js,/soloLearningV1|Progress\.summarize/);
});

test('module and CSS use new version while original question-bank and daily meditation are intact',()=>{
  const main=read('public/main.js');
  assert.match(main,/\.\/cultivation\/home-wireframe\.js/);
  assert.doesNotMatch(main,/home-ecology-dashboard/);
  assert.match(html,/styles\/home-wireframe\.css/);
  assert.doesNotMatch(html,/home-ecology-dashboard\.css/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.ok(read('ai-question-bank.cjs').length>100);
  assert.ok(read('daily-meditation-api.cjs').length>100);
});
