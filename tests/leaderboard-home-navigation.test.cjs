'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('rank returns to home and highlights the home navigation',()=>{
 assert.match(read('public/index.html'),/id="leaderboard-back-home" onclick="switchToPage\('page-home'\)"[^>]*>.*返回主頁<\/button>/);
 assert.match(read('public/styles/interface-cleanup-pages.css'),/#leaderboard-back-home/);
 assert.match(read('public/main-legacy.js'),/\['page-rank','page-path'\]\.includes\(pageId\) \? 'page-home' : pageId/);
});
