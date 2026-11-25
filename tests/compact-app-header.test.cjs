const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('corner masthead leaves the middle transparent and non-interactive',()=>{
 const css=read('public/styles/interface-cleanup.css'),html=read('public/index.html');
 const header=css.match(/html body\.ui-cleanup > header\.app-corner-header \{([^}]+)\}/)[1];
 assert.match(header,/height:0!important/);assert.match(header,/background:transparent!important/);
 assert.match(header,/pointer-events:none/);
 assert.match(css,/#brand-home \{[\s\S]*?pointer-events:auto/);
 assert.match(css,/--app-header-height:28px/);assert.match(css,/--app-header-height:26px/);
 assert.match(css,/--app-header-space:calc\(var\(--app-header-height\) \+ env\(safe-area-inset-top,0px\) \+ 3px\)/);
 assert.match(css,/body\.ui-cleanup > main \{margin-top:var\(--app-header-space\);padding-top:0/);
 assert.match(html,/<header class="app-corner-header /);
 assert.match(html,/id="brand-home"[^>]*onclick="returnToImmortalHome\(\)"/);
 assert.match(html,/id="user-info"/);
 assert.match(html,/interface-cleanup.css\?v=20261125-corner-header-v2/);
});
test('fullscreen and portrait exclusions also release the new scroller margin',()=>{
 const css=read('public/styles/interface-cleanup.css'),quiet=read('public/styles/xianxia-quiet.css'),training=read('public/styles/manual-training-layout.css');
 assert.match(css,/manual-detail-active\)>main\{margin-top:0\}/);
 assert.match(css,/#page-social\)\.active-page\)>main\{margin-top:0\}/);
 assert.match(quiet,/active-page\)\s*> header \{\s*display: none !important/);
 assert.match(training,/manual-detail-active\)>header\{\s*display:none!important/);
 assert.match(training,/manual-detail-active\)>main\{\s*padding:0!important/);
});
