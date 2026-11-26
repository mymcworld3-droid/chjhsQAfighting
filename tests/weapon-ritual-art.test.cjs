'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p));
test('weapon ritual uses two registered transparent PNG layers and keeps only rim animated',()=>{
 const ui=read('public/cultivation/manual-hero-view.js').toString(),css=read('public/styles/manual-training-layout.css').toString();
 for(const filename of ['qingyun_misty_brown_disc.png','qingyun_gold_frame.png']){
  const p='public/assets/ui/'+filename,b=read(p);
  assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(b.readUInt32BE(16),1280);assert.equal(b.readUInt32BE(20),1280);
  assert.equal(b[25],6);assert.ok(ui.includes('/assets/ui/'+filename));
 }
 assert.match(ui,/class="manual-ritual-disc"/);
 assert.match(ui,/class="manual-ritual-wheel"/);
 assert.doesNotMatch(ui,/<svg class="manual-ritual-seal"/);
 assert.match(css,/manual-ritual-disc\{z-index:0;transform:none;animation:none\}/);
 assert.match(css,/transform-origin:50% 50%/);
 assert.match(css,/manual-ritual-wheel\{animation:none!important;transform:none!important\}/);
});
