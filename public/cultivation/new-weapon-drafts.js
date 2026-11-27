/* V1 private weapon definitions. Deliberately NOT part of QAManuals.BOOKS,
 * BY_BOOK or BY_SKILL. Never use this catalog for rewards, ownership, equip
 * authorization or cast authorization until phase 19 explicitly publishes it. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./manual-rules.js'));
  else root.QANewWeaponDrafts=factory(root.QAManuals);
})(globalThis,Manuals=>{
  'use strict';
  const freeze=o=>{if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
  const skill=(id,name,cost,range,kind,power,description,extra={})=>({id,name,cost,range,kind,power,description,cooldown:0,...extra});
  const book=(id,name,school,tierRealm,description,skills,extra={})=>({id,name,school,weaponType:school==='body'?'totem':'sword',tierRealm,description,
    release:'development',...extra,skills:skills.map((s,i)=>({...s,moveId:s.id,manualId:id,school,levelRequired:[1,5,10][i]}))});
  const BOOKS=freeze([
    book('sword-prism','折光靈劍','sword','煉氣','以地形碰撞、法線反射與漫射攻擊敵人。',[
      skill('prism-slash','流光斬',2,3,'prism-slash',1.2,'沿指定方向攻擊直線三格，遇障礙停止。'),
      skill('prism-reflect','折壁穿斬',4,null,'prism-reflect',1.6,'劍氣延伸至碰撞面，再沿法線向可通行側延伸三格。',{unlimited:true,reflectionRange:3,powers:{initial:1.6,reflected:1},maxTargetPower:2.6}),
      skill('prism-scatter','漫光斬',4,null,'prism-scatter',1,'碰撞後向左右九十度與一百三十五度漫射，最多兩層。',{unlimited:true,branchTurns:[-3,-2,2,3],maxDepth:2,maxRays:21,powers:{initial:1,first:.7,second:.35},maxTargetPower:2.4})
    ]),
    book('body-bell','鳴鐘圖騰','body','煉氣','以正方形震波與逐層擊退連續命中。',[
      skill('bell-strike','鳴拳',2,2,'bell-strike',1.3,'攻擊前方直線兩格。'),
      skill('bell-shock','震鐘',3,0,'bell-shock',1.65,'以自身為中心攻擊二格正方形，不含自己，向外擊退一格。',{radius:2,push:1,excludeCenter:true}),
      skill('bell-echo','回響',4,0,'bell-echo',.65,'依次攻擊四層正方形外圈，每層結算後擊退一格。',{rings:4,push:1,maxTargetPower:2.6})
    ]),
    book('sword-weave','織界靈劍','sword','築基','以劍痕、兩點連線及封閉劍陣布置戰場。',[
      skill('weave-mark','刻界',2,3,'weave-mark',1.5,'直線攻擊三格，在有效指定位置留下劍痕。',{maxMarks:3,objectType:'mark'}),
      skill('weave-thread','牽絲',3,null,'weave-thread',2.25,'選取兩道劍痕或本體與一道劍痕，攻擊完整合法連線。',{endpointCount:2,allowOwnerEndpoint:true}),
      skill('weave-domain','織界',4,0,'weave-domain',2.4,'至少兩道劍痕；兩點連線、三點共線或三角封閉區域皆可攻擊。',{minMarks:2,powers:{two:2.4,collinear:2.8,polygon:3.2},maxTargetPower:3.2})
    ]),
    book('body-mirror','蜃影圖騰','body','築基','以地圖中心點對稱蜃影同步複製合法體術。',[
      skill('mirror-strike','虛形拳',2,2,'mirror-strike',1.6,'攻擊前方兩格；已啟用蜃影時同步複製。'),
      skill('mirror-summon','金蟬脫殼',4,0,'mirror-summon',2.8,'啟用唯一蜃影，於點對稱位置釋放九格攻擊。',{radius:1,objectType:'mirror',noMirrorCopy:true}),
      skill('mirror-swap','虛實互換',4,0,'mirror-swap',1.6,'與蜃影合法換位，兩處各釋放九格攻擊。',{radius:1,hits:2,maxTargetPower:3.2,noMirrorCopy:true})
    ],{mirrorCopyFactor:.3}),
    book('sword-time','歲輪天劍','sword','金丹','保留施放位置的時間殘影，與本體多重合擊。',[
      skill('time-slash','刻時斬',2,3,'time-slash',1.9,'攻擊直線三格，於施放原點留下殘影。',{maxEchoes:2,objectType:'echo'}),
      skill('time-double','昔影重斬',4,4,'time-double',2,'本體與最新殘影各自向同一目標出劍。',{minEchoes:1,maxSources:2,maxTargetPower:4}),
      skill('time-union','三世歸一',6,4,'time-union',2,'本體與所有殘影合擊，之後消耗所有殘影。',{minEchoes:1,maxSources:3,maxTargetPower:6,consumeEchoes:true})
    ]),
    book('body-gravity','星隕圖騰','body','金丹','以持續右旋吸引的星核布置高傷害墜擊。',[
      skill('gravity-strike','沉星拳',2,2,'gravity-strike',2,'攻擊前方直線兩格。'),
      skill('gravity-core','引力星核',4,2,'gravity-core',.8,'在空地放置星核，吸引曼哈頓三格內敵人並逐次造成傷害。',{radius:3,maxTriggers:5,push:1,maxTargetPower:4,objectType:'core',noMirrorCopy:true}),
      skill('gravity-crash','萬象星隕',5,2,'gravity-crash',5.5,'躍至合法星核落點並引爆，依曼哈頓距離結算一次最高傷害。',{radius:3,powers:{near:5.5,middle:3,outer:1.5},maxTargetPower:5.5,consumeCore:true,noMirrorCopy:true})
    ])
  ]);
  const BY_BOOK=freeze(Object.fromEntries(BOOKS.map(b=>[b.id,b])));
  const BY_SKILL=freeze(Object.fromEntries(BOOKS.flatMap(b=>b.skills.map(s=>[s.id,s]))));
  const skillAtLevel=(id,level,stars)=>Object.hasOwn(BY_SKILL,id)?Manuals.skillAtLevel(BY_SKILL[id],level,stars):null;
  const mastered=(id,exp)=>Object.hasOwn(BY_SKILL,id)&&Manuals.levelForExp(exp)>=BY_SKILL[id].levelRequired;
  return Object.freeze({BOOKS,BY_BOOK,BY_SKILL,skillAtLevel,mastered});
});
