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
