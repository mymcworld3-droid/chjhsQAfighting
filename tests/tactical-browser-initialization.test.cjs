'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const dir=path.join(__dirname,'..','public','cultivation');
const read=name=>fs.readFileSync(path.join(dir,name),'utf8');

test('tactical manuals and combat rules bootstrap without Node globals in a browser realm',()=>{
  // Importing the modules from the real browser has no Node module/require.
  // Their browser UMD code must not refer to the outer wrapper's local root.
  const context=vm.createContext({});
  vm.runInContext(read('manual-rules.js'),context,{filename:'manual-rules.js'});
  assert.ok(context.QAManuals,'catalog is available after import');
  assert.equal(context.QAManuals.BOOKS.length,context.QAManuals.RELEASE_NEW_WEAPONS?12:6);
  vm.runInContext(read('tactical-rules.js'),context,{filename:'tactical-rules.js'});
  assert.ok(context.QATactical,'browser combat rules are initialized');
  assert.equal(context.QATactical.LIMITS.stamina,10);
  const hero={manualSkills:['wind-slash'],trainingAccessScore:1};
  assert.equal(context.QATactical.manualSkillFor(hero,'wind-slash').name,'流風斬');
  assert.equal(context.QATactical.manualSkillFor(hero,'wind-thousand'),null);
  assert.equal(context.QATactical.CORES.thunder.branches.length,2);
});

test('Node and browser module registries expose the same manual skill',()=>{
  const manuals=require('../public/cultivation/manual-rules.js');
  const rules=require('../public/cultivation/tactical-rules.js');
  assert.equal(rules.manualSkillFor({manualSkills:['rock-fist'],trainingAccessScore:1},'rock-fist').id,'rock-fist');
  assert.equal(manuals.BY_SKILL['rock-fist'].manualId,'body-rock');
});

test('tactical browser imports manuals before invoking combat rules, allowing presentation imports first',()=>{
  for(const name of ['tactical-combat.js','tactical-renderer.js']){
    const imports=[...read(name).matchAll(/^import\s+(?:[^'"\n]*from\s*)?['"]([^'"]+)['"]/gm)].map(m=>m[1]);
    const manual=imports.findIndex(p=>/^\.\/manual-rules\.js(?:\?v=[\w-]+)?$/.test(p));
    const rules=imports.findIndex(p=>/^\.\/tactical-rules\.js(?:\?v=[\w-]+)?$/.test(p));
    assert.ok(manual>=0&&rules>manual,name);
  }
});
