'use strict';
const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),catalog=require('../public/high_school_unit_name/humanities.json');
const index=require('../question-references/index.json'),range=require('../public/cultivation/curriculum-range-rules.js');
const opportunity=require('../public/cultivation/opportunity-rules.js'),tower=require('../trial-tower-scope.cjs');
test('retired IT curriculum, reference index, and selection menus are absent',()=>{
 assert.equal(Object.hasOwn(catalog.subjects,'資訊科技'),false);
 assert.equal(Object.hasOwn(index,'資訊科技'),false);
 assert.equal(fs.existsSync(path.join(root,'question-references','資訊科技')),false);
 const ui=fs.readFileSync(path.join(root,'public/cultivation/curriculum-scope.js'),'utf8');
 assert.doesNotMatch(ui.split('const highSubjectList=')[1].split('const elementarySubjectList=')[0],/資訊科技/);
 assert.doesNotMatch(ui.split('const files=')[1].split('const grades=')[0],/資訊科技/);
});
test('old IT scope is not importable, saved or assigned to opportunities or trials',()=>{
 const unit={path:'資訊科技/高中一年級/自訂/資訊科技',detail:'舊範圍',sub_topics:[]};
 assert.equal(range.readSharedSelection(JSON.stringify({schema:'qingyun-study-scopes',version:1,units:[unit]})).ok,false);
 assert.deepEqual(range.mergeSelection([],[unit]).units,[]);
 const player={profile:{educationLevel:'高中一年級'},gameSettings:{sourceMode:'focused',focusedUnits:[unit]}};
 assert.deepEqual(opportunity.normalizeScope(player).units,[]);
 assert.throws(()=>tower.snapshot(player),/有效的修習範圍/);
});
