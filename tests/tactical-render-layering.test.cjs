'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('attack range outlines, selected target frames and danger hints paint below all actor sprites and HP bars',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../public/cultivation/tactical-renderer.js'),'utf8');
  const draw=source.slice(source.indexOf('  draw(){'));
  const actorStart=draw.indexOf('    const actors=scene?A.sample(scene,progress):s.actors;');
  const actorDraw=draw.indexOf('    for(const a of positions){');
  const actorEnd=draw.indexOf('    for(const a of positions){',actorDraw+10);
  assert.ok(actorStart>0&&actorDraw>actorStart&&actorEnd>actorDraw);
  const overlays=[
    'for(const p of this.range)fill(p,aimedPath?',
    "for(const p of preview.cells)fill(p,'#ef39398c'",
    'Threats.drawGround(c,this.threatPlan,',
    'Threats.drawContours(c,this.threatPlan,viewport);',
    'Threats.drawGuidance(c,this.threatPlan,viewport,reduced);',
    'Targets.drawFocus(c,this.hoverPlan||this.targetPlan,',
    "if(this.selection&&!animating)fill(this.selection,'#fff0','#fff1ba');"
  ];
  for(const item of overlays){
    const i=draw.indexOf(item);
    assert.ok(i>0&&i<actorStart,
      'tactical overlay must paint before player and monster sprites: '+item);
    assert.equal(draw.indexOf(item,actorStart),-1,
      'never repaint tactical frames on top of sprites: '+item);
  }
  assert.ok(draw.indexOf("if(scene)this.drawEffect(scene,progress,false);")<actorStart,
    'under-sprite effect pass is retained');
  assert.ok(draw.indexOf('const drawn=a.bot?this.sprite(',actorDraw)>actorDraw,
    'hero and beast atlas sprites still paint after all range frames');
  assert.ok(draw.indexOf("c.strokeText(hpText",actorDraw)>actorDraw,
    'HP labels still paint after all range frames');
  assert.ok(draw.indexOf('Impact.drawHitEffects(c,scene,progress,viewport,A);',actorEnd)>actorEnd,
    'existing committed impact effects stay on top of sprites');
});
