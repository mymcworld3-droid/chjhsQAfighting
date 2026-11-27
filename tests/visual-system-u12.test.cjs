'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..','public',p),'utf8');
const format=read('styles/content-format.css'),quiet=read('styles/xianxia-quiet.css'),review=read('styles/interface-cleanup-pages.css'),header=read('styles/interface-cleanup.css'),index=read('index.html');
test('U12 central palette and aliases distinguish jade from gold',()=>{
  const palette=Object.fromEntries([...format.matchAll(/(--qy-[\w-]+):\s*([^;]+);/g)].map(m=>[m[1],m[2].trim()]));
  for(const key of ['ink','surface','inset','jade','gold','paper','muted','line','space-1','space-2','space-3','space-4','space-5','font-body','font-title','font-number','font-code','question','option','reading-line'])assert.ok(palette['--qy-'+key],key);
  assert.notEqual(palette['--qy-jade'],palette['--qy-gold']);
  for(const key of ['ink','surface','jade','gold','paper','muted','line'])assert.match(quiet,new RegExp('--xq-'+key+':\\s*var\\(--qy-'+key+'\\)'));
  for(const key of ['surface','inset','gold','paper','muted','line'])assert.match(review,new RegExp('--review-'+key+':\\s*var\\(--qy-'+key+'\\)'));
  assert.match(header,/--ui-panel-radius:var\(--qy-radius-panel\)/);
});
test('U12 color tokens and body, title, number and code roles load before their consumers',()=>{
  const links=[...index.matchAll(/<link[^>]+href="([^"]+)"[^>]*>/g)].map(m=>m[1]);
  assert.ok(links.findIndex(s=>s.startsWith('styles/math-colors.css')) < links.findIndex(s=>s.startsWith('styles/content-format.css')));
  for(const file of ['xianxia-quiet','interface-cleanup','interface-cleanup-pages'])assert.ok(links.findIndex(s=>s.startsWith('styles/content-format.css'))<links.findIndex(s=>s.startsWith('styles/'+file+'.css')));
  assert.match(format,/--ui-font: var\(--qy-font-body\)/);
  assert.match(format,/--ui-title-font: var\(--qy-font-title\)/);
  assert.match(format,/font-family:var\(--qy-font-number\) !important/);
  assert.match(format,/tabular-nums lining-nums/);
  assert.match(format,/font-family:var\(--qy-font-code\) !important/);
  assert.match(header,/unicode-range:U\+9752,U\+96F2,U\+554F,U\+9053/);
});
test('math and icon fonts are excluded from the ordinary text rule and inherit semantic colors',()=>{
  const broad=format.slice(format.indexOf('body.xianxia-theme :not(:where('),format.indexOf('/* Avatars'));
  for(const value of ['.fa-solid','mjx-container *','.MathJax_Display *','.katex *','math *','.quiz-math-fallback *'])assert.ok(broad.includes(value),value);
  const math=read('styles/math-colors.css');
  assert.match(math,/@layer math-colors/);
  assert.match(math,/color:\s*inherit !important/);
  assert.match(math,/fill:\s*currentColor !important/);
});
test('responsive reading tokens and active reward, classroom, dungeon and practice roles are included',()=>{
  for(const value of ['.mr-reward-amount','.cc-stat','.tc-result-stats b','.manual-native-level','.dv-today-score strong','#weapon-dungeons-panel h2','.cc-question','#question-text','.dt-explain','#feedback-text'])assert.ok(format.includes(value),value);
  assert.match(format,/@media \(orientation:landscape\) and \(max-height:540px\)/);
  assert.match(format,/--ui-action-height: 44px/);
  assert.match(format,/font-size: var\(--qy-question\) !important/);
  assert.match(format,/font-size: var\(--qy-option\) !important/);
});
