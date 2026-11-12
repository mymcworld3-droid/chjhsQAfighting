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
  assert.equal(context.QAManuals.BOOKS.length,4);
  vm.runInContext(read('tactical-rules.js'),context,{filename:'tactical-rules.js'});
  assert.ok(context.QATactical,'browser combat rules are initialized');
  assert.equal(context.QATactical.LIMITS.stamina,10);
  const hero={manualSkills:['wind-slash']};
  assert.equal(context.QATactical.manualSkillFor(hero,'wind-slash').name,'流風斬');
  assert.equal(context.QATactical.manualSkillFor(hero,'wind-thousand'),null);
  assert.equal(context.QATactical.CORES.thunder.branches.length,2);
});

test('Node and browser module registries expose the same manual skill',()=>{
  const manuals=require('../public/cultivation/manual-rules.js');
  const rules=require('../public/cultivation/tactical-rules.js');
  assert.equal(rules.manualSkillFor({manualSkills:['rock-fist']},'rock-fist').id,'rock-fist');
  assert.equal(manuals.BY_SKILL['rock-fist'].manualId,'body-rock');
});

test('tactical browser imports manuals before invoking combat rules',()=>{
  const combat=read('tactical-combat.js');
  const renderer=read('tactical-renderer.js');
  const first=src=>src.match(/^import\s+['"]([^'"]+)['"]/m)?.[1];
  assert.equal(first(combat),'./manual-rules.js');
  assert.equal(first(renderer),'./manual-rules.js');
});
