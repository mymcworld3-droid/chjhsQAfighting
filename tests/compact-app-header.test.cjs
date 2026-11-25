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
 assert.match(html,/interface-cleanup.css\?v=20261125-masa-calligraphy-v7/);
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
 assert.match(css,/@font-face\s*\{\s*font-family:"Qingyun Masa"/);
 assert.match(css,/masafont@2\.1\/webfont\/MasaFont-Regular\.woff2/);
 assert.match(css,/unicode-range:U\+9752,U\+96F2,U\+554F,U\+9053/);
 assert.match(css,/#brand-home > \.app-brand-wordmark \{[^}]*font-family:"Qingyun Masa"[^;]*!important/);
 assert.match(css,/\.app-brand-wordmark \{font-size:23px\}/);
 assert.match(html,/<link rel="preload" as="font"[^>]*MasaFont-Regular\.woff2" crossorigin>/);
 assert.match(html,/<span class="app-brand-wordmark" lang="zh-Hant">青雲問道<\/span>/);
 assert.doesNotMatch(html,/qingyun-wordmark\.svg/);
 assert.match(html,/aria-label="青雲問道，返回宗門"/);
});
