const test=require('node:test'),assert=require('node:assert/strict');const {audit}=require('../scripts/audit-high-school-publisher-coverage.cjs');
test('high school publisher inventory covers selectable supplements and flags missing slots without claiming current editions',()=>{
 const r=audit();assert.equal(r.expected,285);assert.ok(r.covered>=247,JSON.stringify(r.missing));assert.ok(r.selectableBooks>=249);assert.ok(r.items>=3752);assert.deepEqual(r.duplicates,[]);assert.deepEqual(r.unguided,[]);assert.equal(r.covered+r.missing.length,r.expected);assert.ok(r.extra.every(b=>b.slot===null),JSON.stringify(r.extra));
});
