globalThis.QACombatCombo = require('../public/cultivation/combat-combo.js');
globalThis.QANascentGrowth = require('../public/cultivation/nascent-growth.js');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=p=>fs.readFileSync(require('node:path').join(__dirname,'..',p),'utf8');
const rules=vm.runInNewContext(read('public/cultivation/nascent-soul-rules.js').replace(/^import \{\} from .*;\n/gm,'').replace(/^export /gm,'')+
  '\n({normalizeSpirit,normalizeSoulTree,soulSpentSpirit,soulAvailableSpirit,soulInvestmentSummary,resetSoulTree,allocateSoulNode})');
const tree=()=>({version:4,paths:{
  sword:{nodes:{leftMain:5,leftTop:2},baselineNodes:{},legacySpent:0},
  ocean:{nodes:{rightMain:5},baselineNodes:{},legacySpent:0}
}});
test('investment summary accounts for all existing paths in the shared balance',()=>{
  const before=tree(), raw=JSON.stringify(before);
  const summary=rules.soulInvestmentSummary(before,'ocean');
  assert.equal(summary.find(p=>p.type==='sword').spent,11);
  assert.equal(summary.find(p=>p.type==='sword').active,false);
  assert.equal(summary.find(p=>p.type==='ocean').spent,5);
  assert.equal(rules.soulAvailableSpirit(before,30),14);
  assert.equal(JSON.stringify(before),raw);
});
test('respec releases all paths without changing earned spirit and repeated reset returns zero',()=>{
  const before=tree(),raw=JSON.stringify(before), r=rules.resetSoulTree(before,30);
  assert.equal(r.released,16);assert.equal(r.returned,16);assert.equal(r.remaining,30);
  assert.equal(Object.keys(r.tree.paths).length,0);
  assert.equal(JSON.stringify(before),raw);
  assert.equal(rules.resetSoulTree(r.tree,30).returned,0);
  const next=rules.allocateSoulNode(r.tree,'ocean','leftMain',30);
  assert.equal(next.ok,true);assert.equal(next.remaining,29);
});
test('legacy paid baseline releases historical costs exactly once',()=>{
  for(const version of [2,3,4]){
    const legacy={version,paths:{sword:{nodes:{leftMain:5,leftTop:2},
      baselineNodes:{leftMain:5},legacySpent:25}}};
    const spent=rules.soulSpentSpirit(legacy);
    const result=rules.resetSoulTree(legacy,100);
    assert.equal(result.returned,spent);assert.equal(result.remaining,100);
    assert.equal(rules.resetSoulTree(result.tree,100).returned,0);
  }
});
test('damaged balance cannot mint spirit from costs greater than lifetime earnings',()=>{
  const r=rules.resetSoulTree(tree(),3);
  assert.equal(r.released,16);assert.equal(r.returned,3);assert.equal(r.remaining,3);
});
test('new branch reset returns purchased fragments and retires legacy allocations',()=>{
 const Growth=globalThis.QANascentGrowth,p={stats:{nascentSoulSpirit:0},nascentSoulGrowth:{version:1,branches:{attack:3,vitality:2}},materialSystem:{inventory:{[Growth.ITEM_ID]:4}}};const result=Growth.reset(p);assert.equal(result.returned,9);assert.equal(result.fragments,13);Growth.apply(p,result);assert.equal(Growth.spent(p.nascentSoulGrowth),0);assert.equal(Growth.reset(p).returned,0);
});
