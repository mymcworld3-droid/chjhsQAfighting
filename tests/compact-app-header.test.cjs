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
 assert.match(css,/--app-header-height:34px/);assert.match(css,/--app-header-height:31px/);
 assert.match(css,/--app-header-space:calc\(var\(--app-header-height\) \+ env\(safe-area-inset-top,0px\) \+ 3px\)/);
 assert.match(css,/body\.ui-cleanup > main \{margin-top:var\(--app-header-space\);padding-top:0/);
 assert.match(html,/<header class="app-corner-header /);
 assert.match(html,/id="brand-home"[^>]*onclick="returnToImmortalHome\(\)"/);
 assert.match(html,/id="user-info"/);
 assert.match(html,/interface-cleanup.css\?v=20261125-brush-wordmark-v5/);
});
test('fullscreen and portrait exclusions also release the new scroller margin',()=>{
 const css=read('public/styles/interface-cleanup.css'),quiet=read('public/styles/xianxia-quiet.css'),training=read('public/styles/manual-training-layout.css');
 assert.match(css,/manual-detail-active\)>main\{margin-top:0\}/);
 assert.match(css,/#page-social\)\.active-page\)>main\{margin-top:0\}/);
 assert.match(quiet,/active-page\)\s*> header \{\s*display: none !important/);
 assert.match(training,/manual-detail-active\)>header\{\s*display:none!important/);
 assert.match(training,/manual-detail-active\)>main\{\s*padding:0!important/);
});

test('frameless wordmark keeps a small clickable footprint without decorative panels',()=>{
 const css=read('public/styles/interface-cleanup.css'),html=read('public/index.html');
 const button=css.match(/html body\.ui-cleanup > header\.app-corner-header #brand-home \{([^}]+)\}/)[1];
 assert.match(button,/width:max-content/);
 assert.match(button,/border:0;border-radius:0;background:transparent!important/);
 assert.match(button,/font-family:"Yuji Boku"/);
 assert.match(button,/font-size:26px;font-weight:400/);
 assert.match(html,/family=Yuji\+Boku&amp;text=%E9%9D%92%E9%9B%B2%E5%95%8F%E9%81%93&amp;display=swap/);
 assert.match(css,/#brand-home \{font-size:23px/);
 assert.doesNotMatch(html,/<svg class="app-brand-cloud"/);
 assert.match(html,/class="app-brand-wordmark"><span data-i18n="app_name">青雲問道/);
 assert.match(html,/aria-label="青雲問道，返回宗門"/);
});
