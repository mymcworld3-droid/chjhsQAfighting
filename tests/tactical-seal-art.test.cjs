'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const R=require('../public/cultivation/tactical-rules.js');
const source=fs.readFileSync(path.join(root,'public/cultivation/tactical-renderer.js'),'utf8');
const atlasPath=path.join(root,'public/assets/seals/seal-atlas.webp');

test('AI-generated seal atlas exists and has 4 × 3 transparent WebP frames',()=>{
  const b=fs.readFileSync(atlasPath);
  assert(b.length>10000 && b.length<250000,'compressed atlas must be real artwork, not an empty placeholder');
  assert.equal(b.toString('ascii',0,4),'RIFF');
  assert.equal(b.toString('ascii',8,12),'WEBP');
  assert.equal(b.toString('ascii',12,16),'VP8X');
  const width=b.readUIntLE(24,3)+1,height=b.readUIntLE(27,3)+1;
  assert.deepEqual([width,height],[512,384]);
  assert.equal(b[20]&0x10,0x10,'image must contain transparency');
});

test('seal renderer lazily loads the atlas once and preserves a readable fallback',()=>{
  assert(source.includes("const SEAL_ATLAS='/assets/seals/seal-atlas.webp'"));
  assert(source.includes('ensureSealAtlas(){'));
  assert(source.includes('if(this.images.seals||this.destroyed)return'));
  assert(source.includes('if(markers.some(p=>p.seal))this.ensureSealAtlas()'));
  assert(source.includes("const painted=column>=0&&this.sprite('seals'"));
  assert(source.includes("if(!painted){"));
  assert(source.includes("c.fillText(p.label,x,y)"));
  // Stage-six guardian art is skipped in the old circular-marker loop too.
  // All live v4 seals must still skip the old markers, avoiding two icons.
  assert(source.includes("if(p.seal||objective?.type==='defense'&&s.trial?.layoutVersion===4)continue;"));
});

test('all four art columns use the canonical seeded seal order',()=>{
  assert.deepEqual(R.SEAL_KINDS,['shield','hazard','rage','maze']);
  assert(source.includes('R.SEAL_KINDS.indexOf(seal.kind)'));
  assert(source.includes('column*SEAL_FRAME_SIZE'));
  assert(source.includes('row*SEAL_FRAME_SIZE'));
  assert(source.includes('seal.broken||seal.hp<=0?2:seal.hp<seal.maxHp?1:0'));
});

test('seal pillars remain below hero and beast artwork while combat warnings remain visible',()=>{
  const draw=source.slice(source.indexOf('  draw(){'));
  const effect=draw.indexOf("if(scene)this.drawEffect(scene,progress,false);");
  const sealDraw=draw.indexOf("this.sprite('seals'");
  const actors=draw.indexOf('const actors=scene?A.sample(scene,progress):s.actors;');
  const contours=draw.indexOf('Threats.drawContours(c,this.threatPlan,viewport);');
  const attackPreview=draw.indexOf('for(const p of preview.cells)');
  assert(contours>=0&&attackPreview>=0&&effect>=0&&sealDraw>=0&&actors>=0);
  assert(attackPreview<sealDraw&&contours<sealDraw);
  assert(effect<sealDraw&&sealDraw<actors);
  assert.equal(draw.indexOf("this.sprite('seals'",actors),-1,'never paint seal sprites over actors');
});

test('v3 sealing remains the original activation-mode label and receives no new v4 sprite',()=>{
  const old=R.stageLayout('legacy-art',8,3);
  const s={trial:{layoutVersion:3},objective:old.objective,width:old.width,height:old.height};
  assert.equal(R.sealInfos(s).length,0);
  assert(source.includes("if(objective?.type==='sealing'&&s.trial?.layoutVersion===4)"));
});
