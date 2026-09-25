const test=require('node:test');const assert=require('node:assert/strict');const {readFileSync}=require('node:fs');const {join}=require('node:path');const {execFileSync}=require('node:child_process');const base=join(__dirname,'../public');const read=p=>readFileSync(join(base,p),'utf8');const pages=read('cultivation/curriculum-pages.js'),scope=read('cultivation/curriculum-scope.js'),studio=read('cultivation/scope-fullscreen.js'),css=read('styles/curriculum-studio.css'),main=read('main.js');
test('paginated curriculum module loads after data selector and fullscreen wrapper',()=>{
  execFileSync(process.execPath,['--check',join(base,'cultivation/curriculum-pages.js')]);
  const pos=p=>main.indexOf("'./cultivation/"+p+".js'");
  assert.ok(pos('curriculum-scope')>=0&&pos('curriculum-scope')<pos('scope-fullscreen'));
  assert.ok(pos('scope-fullscreen')<pos('curriculum-pages'));
  assert.match(studio,/window\.resetCurriculumPages\?\.\(\)/);
});
test('three progressive pages go directly from subject to merged full-year chapters',()=>{
  assert.match(pages,/\['cs-grade','cs-subject'\]/);
  assert.match(pages,/\['選年級','選科目','選章節'\]/);
  assert.doesNotMatch(pages,/選學期|選版本|cs-cards-3|cs-cards-4/);
  assert.match(pages,/setPage\(Math\.min\(2,stage\+1\)\)/);
  assert.match(pages,/native\.dispatchEvent\(new Event\('change',\{bubbles:true\}\)\)/);
  assert.match(pages,/const last=\$\('cs-stage-2'\)/);
  assert.match(pages,/last\.append\(search,tools,chapter,add,custom,message\)/);
  assert.match(pages,/window\.openCurriculumPage=page/);
  assert.match(pages,/id="cs-prev" class="cs-back"/);
  assert.doesNotMatch(pages,/cs-page-tab-|cs-page-path|cs-page-progress|cs-page-tabs/);
  assert.match(pages,/if\(active===0\) window.closeCurriculumStudio\?\.\(\)/);
  assert.match(pages,/id="cs-stage-/);
  assert.match(pages,/id="cs-cards-/);
  assert.match(pages,/\$\('ss-tab-cart'\)\?\.click\(\)/);
  assert.match(scope,/curriculum:options-ready/);
  assert.match(scope,/function mergeYearUnits\(yearData\)/);
  assert.match(scope,/AUTO_TERM='全學年'/);
  assert.match(scope,/function addChecked\(\)/);
});
test('only one stage is visible while pages support scrolling, progress and mobile tiles',()=>{
  assert.match(pages,/item\.hidden = i!==active/);
  assert.match(pages,/setPage\(active-1\)/);
  assert.match(pages,/back\.textContent = active===0 \? '← 返回洞府' : '← 返回上一步'/);
  assert.doesNotMatch(css,/cs-page-tab|cs-page-path|cs-page-progress|cs-pages-top/);
  assert.match(css,/#scope-studio \.cs-scope \.cs-back/);
  assert.match(css,/#scope-studio \.cs-stage\[hidden\]\{display:none!important\}/);
  assert.match(css,/#scope-studio \.cs-choice-grid/);
  assert.match(css,/@media\(max-width:700px\)/);
  assert.match(css,/#scope-studio \.cs-scope \.cs-choice\.is-selected/);
});
