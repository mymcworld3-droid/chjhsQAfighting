const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('global header uses a single compact row and shared safe-area offset',()=>{
 const css=read('public/styles/interface-cleanup.css');
 assert.match(css,/--app-header-height:42px/);
 assert.match(css,/--app-header-height:40px/);
 assert.match(css,/--app-header-space:calc\(var\(--app-header-height\) \+ env\(safe-area-inset-top,0px\) \+ 6px\)/);
 assert.match(css,/body\.ui-cleanup > main \{padding-top:var\(--app-header-space\)/);
 assert.match(css,/body\.ui-cleanup > header \.xianxia-brand small \{display:none\}/);
 assert.doesNotMatch(css,/padding-top:(84|72)px/);
 const html=read('public/index.html');
 assert.match(html,/id="brand-home"[^>]*onclick="returnToImmortalHome\(\)"/);
 assert.match(html,/id="user-info"/);
 assert.match(html,/interface-cleanup.css\?v=20261125-compact-header-v1/);
 assert.match(read('public/styles/page-layout-unified.css'),/100dvh - var\(--app-header-space,92px\)/);
});
test('existing fullscreen and portrait header exclusions remain in place',()=>{
 const quiet=read('public/styles/xianxia-quiet.css'),training=read('public/styles/manual-training-layout.css');
 assert.match(quiet,/active-page\)\s*> header \{\s*display: none !important/);
 assert.match(training,/manual-detail-active\)>header\{\s*display:none!important/);
 assert.match(training,/manual-detail-active\)>main\{\s*padding:0!important/);
});
