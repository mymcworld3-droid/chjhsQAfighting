const {test}=require('node:test');
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
test('mobile styles cannot override every animation duration or make home crests and breakthrough effects run at another speed',()=>{
  const style=read('style.css');
  assert.doesNotMatch(style,/\*\s*\{\s*animation-duration:\s*0?\.5s\s*!important/);
  assert.match(read('realm-icons.css'),/animation: var\(--realm-entry\) var\(--realm-entry-time\)/);
  assert.match(read('cultivation/realm-breakthrough-feedback.js'),/CONTINUE_AFTER_MS = 1000/);
  assert.match(read('realm-breakthrough-feedback.css'),/\.realm-breakthrough-continue\[aria-hidden="false"\]/);
});
