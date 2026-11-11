/* Home thumbnail is derived from the server-confirmed trial terrain or
   the same deterministic stage-layout generator; never invent a stage. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QAHomeTrialEcology=api;
})(globalThis,()=>{
  'use strict';
  const SCENES=Object.freeze({
    0:Object.freeze({id:'bamboo',name:'竹影溪谷',image:'assets/story/backgrounds/story-bg-06-bamboo-dream.png',filter:'bamboo'}),
    13:Object.freeze({id:'desert',name:'荒漠殘垣',image:'assets/story/backgrounds/story-bg-03-mountain-corridor.png',filter:'desert'}),
    14:Object.freeze({id:'snow',name:'雪嶺險徑',image:'assets/scenes/mountains-landscape-ai.webp',filter:'snow'}),
    2:Object.freeze({id:'water',name:'碧水庭苑',image:'assets/story/backgrounds/story-bg-01-sect-courtyard.png',filter:'water'}),
    16:Object.freeze({id:'ruins',name:'古陣遺墟',image:'assets/story/backgrounds/story-bg-02-spirit-root-hall.png',filter:'ruins'})
  });
  const DEFAULT=Object.freeze({id:'preview',name:'問道試煉',image:'assets/story/backgrounds/story-bg-06-bamboo-dream.png',filter:'bamboo'});
  const SAFE_MAPPINGS=Object.freeze({courtyard:2,bamboo:0,ruins:16});
  function resolveFromTerrain(terrain,title,stage){
    const item=SCENES[terrain]||DEFAULT;
    const stageNumber=Number.isSafeInteger(Number(stage))&&Number(stage)>0?Number(stage):null;
    return Object.freeze({...item,name:String(title||item.name).slice(0,40),stage:stageNumber});
  }
  function fromBattle(state){
    if(state?.mode!=='pve'||!state?.trial)return null;
    // Ground biome is authoritative even when the grid shape is courtyard/bamboo/ruins.
    const terrain=Number(state.trial.terrain);
    if(Number.isFinite(terrain)&&Object.hasOwn(SCENES,terrain))
      return resolveFromTerrain(terrain,state.trial.title,state.trial.stage);
    if(Number.isFinite(Number(state.terrain))&&Object.hasOwn(SCENES,Number(state.terrain)))
      return resolveFromTerrain(Number(state.terrain),state.trial.title,state.trial.stage);
    return resolveFromTerrain(SAFE_MAPPINGS[state.map],state.trial.title,state.trial.stage);
  }
  function fromProgress(progress,rules){
    if(!progress?.seed||!Number.isInteger(Number(progress.stage))||Number(progress.stage)<1||!rules?.stageLayout)return null;
    try{
      const layout=rules.stageLayout(String(progress.seed),Number(progress.stage),Number(progress.layoutVersion)||2);
      return resolveFromTerrain(layout.terrain,layout.title,layout.stage);
    }catch(_){return null;}
  }
  return Object.freeze({SCENES,DEFAULT,fromBattle,fromProgress,resolveFromTerrain});
});
