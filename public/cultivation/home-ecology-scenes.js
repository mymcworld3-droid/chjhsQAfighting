/* CG habitat choices reuse the project's own existing illustrated places. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QAHomeEcologyScenes=api;
})(globalThis,()=>{
  'use strict';
  const scenes=Object.freeze([
    Object.freeze({
      id:'sect',name:'問道宗 · 雲海',region:'青雲主峰',type:'sect',
      landscape:'assets/scenes/mountains-landscape-ai.webp',
      portrait:'assets/scenes/mountains-portrait-ai.webp',
      alt:'青雲主峰層疊山巒與繚繞雲海的宗門場景',
      detail:'雲海繞峰，山間靈氣流轉。從這裡前往宗門各處修行。',
      action:'走入宗門'
    }),
    Object.freeze({
      id:'courtyard',name:'問道宗 · 演武庭',region:'宗門庭院',type:'trial',
      landscape:'assets/story/backgrounds/story-bg-01-sect-courtyard.png',
      portrait:'assets/story/backgrounds/story-bg-01-sect-courtyard.png',
      alt:'問道宗石階與演武庭院的場景插畫',
      detail:'石階沉靜，演武庭正等待新的問道試煉。',
      action:'前往試煉'
    }),
    Object.freeze({
      id:'bamboo',name:'後山 · 青竹幽徑',region:'後山竹林',type:'trial',
      landscape:'assets/story/backgrounds/story-bg-06-bamboo-dream.png',
      portrait:'assets/story/backgrounds/story-bg-06-bamboo-dream.png',
      alt:'後山青竹林間的修仙場景插畫',
      detail:'青竹輕搖，竹徑深處藏著尚未探索的試煉。',
      action:'探索竹徑'
    }),
    Object.freeze({
      id:'mountain',name:'山門 · 雲崖古道',region:'山間古道',type:'trial',
      landscape:'assets/story/backgrounds/story-bg-03-mountain-corridor.png',
      portrait:'assets/story/backgrounds/story-bg-03-mountain-corridor.png',
      alt:'山間長廊與古道的仙俠場景插畫',
      detail:'沿山崖石道前行，迎接下一場問道之旅。',
      action:'前往試煉'
    })
  ]);
  const find=id=>scenes.find(s=>s.id===id)||scenes[0];
  const next=(id,delta=1)=>scenes[(scenes.indexOf(find(id))+delta%scenes.length+scenes.length)%scenes.length];
  const forBattleMap=id=>({courtyard:'courtyard',bamboo:'bamboo',ruins:'mountain'})[id]||'sect';
  return Object.freeze({SCENES:scenes,find,next,forBattleMap});
});
