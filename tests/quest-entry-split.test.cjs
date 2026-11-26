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
