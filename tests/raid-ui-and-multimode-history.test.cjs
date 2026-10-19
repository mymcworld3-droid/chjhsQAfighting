'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
test('raid generator returns to quick simple baseline rather than full standardized learning difficulty',()=>{
 const raid=read('public/cultivation/raid-question.js'),server=read('server.js');
 assert.match(raid,/quizMode: 'raid-quick-simple'/);
 assert.doesNotMatch(raid,/quizMode: 'raid-standard'/);
 assert.match(server,/if \(raidQuickSimple\) difficulty = 'easy'/);
 assert.match(server,/const raidTicketMode = raidQuickSimple \|\|/);
 assert.match(raid,/if \(body\?\.raidQuestion\)/);
});
test('raid presents an Enlightenment-style study panel, vertical four choices and review without changing authoritative settlement',()=>{
 const ui=read('public/cultivation/raid-mode.js'),css=read('public/styles/raid-mode.css');
 assert.match(ui,/enlightenment-panel raid-study-panel/);
 assert.match(ui,/enlightenment-options raid-options/);
 assert.doesNotMatch(ui,/quiz-helper|question-helper/);
 assert.match(ui,/enlightenment-question/);
 assert.match(ui,/question\.ans = Number\(resolution\.correctIndex\)/);
 assert.match(ui,/question\.exp = String\(resolution\.explanation/);
 assert.match(css,/#page-raid \.raid-study-panel \.raid-options\{display:grid;grid-template-columns:1fr/);
 assert.match(css,/position:sticky;top:0/);
});
test('raid, duel and Immortal summit write detailed exam history through one idempotent helper',()=>{
 const repo=read('public/cultivation/data/player-repository.js');
 const raid=read('public/cultivation/raid-mode.js');
 const duel=read('public/cultivation/battle-mode-v2.js');
 const immortal=read('public/cultivation/five-immortals.js');
 assert.match(repo,/async saveExamAnswer\(key, value/);
 assert.match(repo,/doc\(db,'exam_logs',stable\)/);
 assert.match(repo,/const existing=await tx.get\(ref\)/);
 assert.match(repo,/if\(existing.exists\(\)\) return false/);
 for(const field of ['question','options','correctIdx','userIdx','isCorrect','explanation','timestamp','mode','uid'])
   assert.match(repo,new RegExp(field));
 assert.match(raid,/saveExamAnswer\('raid_'/);
 assert.match(duel,/saveExamAnswer\(key/);
 assert.match(duel,/persistSettledAnswer\(room\)/);
 assert.match(duel,/if \(!\['settled','finished'\]\.includes/);
 assert.match(immortal,/saveExamAnswer\(key/);
 assert.match(immortal,/preserveChallengeAnswer\(q, choice, serial\)/);
});
test('history UI remains compatible and classifies game modes by recognizable captions',()=>{
 const view=read('public/cultivation/quiz-history-view.js');
 assert.match(view,/log\?\.rankAtTime/);
 assert.match(view,/history-quiz-options/);
 assert.match(view,/history-quiz-explanation/);
});
