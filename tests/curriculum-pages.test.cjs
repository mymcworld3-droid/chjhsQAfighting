const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const base = join(__dirname, '../public');
const read = p => readFileSync(join(base, p), 'utf8');
const pages = read('cultivation/curriculum-pages.js'), scope = read('cultivation/curriculum-scope.js');
const studio = read('cultivation/scope-fullscreen.js'), css = read('styles/curriculum-studio.css'), main = read('main.js');

test('same-page curriculum loads after the data selector and fullscreen wrapper', () => {
  execFileSync(process.execPath, ['--check', join(base, 'cultivation/curriculum-pages.js')]);
  const pos = p => main.indexOf("'./cultivation/" + p + ".js'");
  assert.ok(pos('curriculum-scope') >= 0 && pos('curriculum-scope') < pos('scope-fullscreen'));
  assert.ok(pos('scope-fullscreen') < pos('curriculum-pages'));
  assert.match(studio, /window\.resetCurriculumPages\?\.\(\)/);
  assert.match(pages, /root\.insertBefore\(native, \$\('cs-stage-2'\)\)/);
  assert.match(pages, /stage\.append\(tools, chapter, message\)/);
  assert.doesNotMatch(pages, /cs-prev|cs-next|STEP 0|cs-range-grade|cs-range-subject/);
  assert.match(pages, /<details id="cs-custom-range"/);
  assert.match(pages, /window\.restoreCurriculumContext\?\.\(\)/);
});

test('chapter names are large selection targets and detailed topics are separate disclosures', () => {
  assert.match(scope, /summary=document\.createElement\('label'\);summary\.className='cs-chapter-pick'/);
  assert.match(scope, /topics=document\.createElement\('details'\)/);
  assert.match(scope, /box\.indeterminate=/);
  assert.match(pages, /data-cs-term="第一學期"/);
  assert.match(pages, /data-cs-term="第二學期"/);
  assert.match(css, /\.cs-fields\.cs-simple-fields\{[^}]*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.cs-chapter-pick\{[^}]*min-height:60px/);
  assert.match(studio, /'儲存範圍（' \+ selected\.length/);
  assert.match(studio, /sourceMode === 'focused' && !selected\.length/);
  assert.match(studio, /\.inert = saving/);
});

function filteredSelection({ term = 'all', query = '', selected = [] } = {}) {
  const units = [
    { term:'第一學期', unit:'速率', details:['最高點速率'] },
    { term:'第一學期', unit:'張力', details:['最低點張力'] },
    { term:'第二學期', unit:'速率與能量', details:['跨位置速率'] }
  ];
  const path = '物理/高中二年級/全學年/物理';
  const window = { soloSelectedUnits:selected };
  const context = vm.createContext({ units, termFilter:term, window,
    el:() => ({value:query}), currentPath:() => path,
    detailFor:u => u.term + ' · ' + u.unit,
    chapterItem:i => ({path, detail:units[i].term + ' · ' + units[i].unit, sub_topics:units[i].details}),
    selectedUnits:() => window.soloSelectedUnits,
    notifySelectionList(){}, status(){}, applyVisibleSelectionState(){} });
  const start = scope.indexOf('function visibleUnitIndices()'), end = scope.indexOf('function clearCurrentSelection()', start);
  vm.runInContext(scope.slice(start, end) + '\nthis.selectAll=selectAllCurrentChapters;this.visible=visibleUnitIndices;', context);
  return { window, context, path };
}

test('semester and keyword filters combine, and selecting visible chapters preserves hidden and cross-subject selections', () => {
  const path = '物理/高中二年級/全學年/物理';
  const hidden = {path, detail:'第二學期 · 速率與能量－跨位置速率', sub_topics:['跨位置速率']};
  const other = {path:'數學/八年級全學年', detail:'第一學期 · 平方根', sub_topics:[]};
  const p = filteredSelection({term:'第一學期', query:'速率', selected:[hidden, other]});
  assert.deepEqual(Array.from(p.context.visible()), [0]);
  p.context.selectAll();
  assert.equal(p.window.soloSelectedUnits.length, 3);
  assert.equal(p.window.soloSelectedUnits[0], hidden);
  assert.equal(p.window.soloSelectedUnits[1], other);
  assert.equal(p.window.soloSelectedUnits[2].detail, '第一學期 · 速率');
  p.context.selectAll();
  assert.equal(p.window.soloSelectedUnits.length, 3, 'repeated selection is idempotent');
});

test('selecting a visible whole chapter replaces its points and enforces the shared 24-scope limit', () => {
  const path = '物理/高中二年級/全學年/物理';
  const selected = [
    ...Array.from({length:23}, (_,i) => ({path:'其他科目', detail:'章節'+i, sub_topics:[]})),
    {path, detail:'第一學期 · 速率－最高點速率', sub_topics:['最高點速率']}
  ];
  const p = filteredSelection({selected}); p.context.selectAll();
  assert.equal(p.window.soloSelectedUnits.length, 24);
  assert.equal(p.window.soloSelectedUnits[23].detail, '第一學期 · 速率');
  assert.equal(p.window.soloSelectedUnits.filter(u => u.detail.includes('最高點速率')).length, 0);
  const empty = filteredSelection({query:'找不到', selected}); empty.context.selectAll();
  assert.deepEqual(Array.from(empty.window.soloSelectedUnits), selected, 'empty search never clears selected scopes');
});

function restoreContext(path, profile) {
  const grades=['國小一年級','國小二年級','國小三年級','國小四年級','國小五年級','國小六年級','國中一年級','國中二年級','國中三年級','高中一年級','高中二年級','高中三年級'];
  const context = vm.createContext({ window:{}, grades, grade:'國中一年級', subject:'數學',
    selectedUnits:() => path ? [{path}] : [], el:() => ({value:profile}),
    subjectOptions:g => g.startsWith('國小') ? ['國語','數學'] : g === '高中二年級' ? ['國文','數學A','數學B','物理'] : ['國文','數學','物理'],
    resetFilters(){}, render(){} });
  const start=scope.indexOf('window.restoreCurriculumContext='), end=scope.indexOf('window.addCurrentUnitToSelection=',start);
  vm.runInContext(scope.slice(start,end)+'\nwindow.restoreCurriculumContext();',context);
  return [context.grade, context.subject];
}

test('reopening restores saved legacy and split-course grades before falling back to profile', () => {
  assert.deepEqual(restoreContext('物理/八年級全學年','國中一年級'), ['國中二年級','物理']);
  assert.deepEqual(restoreContext('數學/高中二年級/全學年/數學B','高中職'), ['高中二年級','數學B']);
  assert.deepEqual(restoreContext('國文/國小三年級/自訂/國語','國小高年級'), ['國小三年級','國語']);
  assert.deepEqual(restoreContext('', '國小高年級'), ['國小五年級','數學']);
  assert.deepEqual(restoreContext('', ''), ['國中一年級','數學']);
});
