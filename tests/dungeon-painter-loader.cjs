'use strict';
// The client painter is an ES module. Tests run the exact pure rendering
// helpers in Node while providing a fake camera/canvas for geometry asserts.
const fs=require('node:fs'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..','public',
  'cultivation',name),'utf8');
const boss=new Function(read('dungeon-boss-visuals.js').replace(/^export /gm,'')+
  '\nreturn {dungeonBossVisualPlan,drawBossTelegraph,drawBossAura,drawBossTransition};')();
const environment=new Function(
  read('dungeon-environment-effects.js').replace(/^export /gm,'')+
  '\nreturn {drawDungeonEnvironment,drawDungeonCastWindup};')();
const enemyVfx=new Function(
  read('dungeon-enemy-animation.js').replace(/^export /gm,'')+
  '\nreturn {dungeonWindupPose,dungeonHitPose,drawDungeonBeastWindup,drawDungeonEnemyImpacts};')();
function loadDungeonPainter(Camera){
  const source=read('dungeon-map-painter.js')
    .replace(/^import .*$/gm,'').replace(/^export /gm,'');
  return new Function('Camera','dungeonBossVisualPlan','drawBossTelegraph',
    'drawBossAura','drawBossTransition','drawDungeonEnvironment',
    'drawDungeonCastWindup','dungeonWindupPose','dungeonHitPose',
    'drawDungeonBeastWindup','drawDungeonEnemyImpacts',source+
    '\nreturn {BIOMES,BEAST_COLORS,hashCell,drawWorld,drawMinimap};')(
      Camera,boss.dungeonBossVisualPlan,boss.drawBossTelegraph,
      boss.drawBossAura,boss.drawBossTransition,
      environment.drawDungeonEnvironment,environment.drawDungeonCastWindup,
      enemyVfx.dungeonWindupPose,enemyVfx.dungeonHitPose,
      enemyVfx.drawDungeonBeastWindup,enemyVfx.drawDungeonEnemyImpacts);
}
module.exports={loadDungeonPainter};
