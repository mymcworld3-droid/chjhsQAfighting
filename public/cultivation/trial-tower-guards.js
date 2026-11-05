// The tower preview and authoritative battle use the same floor definitions.
(function(root){
 'use strict';
 const MAX_FLOOR=100;
 const VERSION='novel-projections-v2-varied';
 const REALMS=[['煉氣期',0],['築基期',6],['金丹期',28],['元嬰期',68],['化神期',188],['合體期',642],['大乘期',1000],['半仙',1268],['真仙',1868],['超脫',2800]];
 // Tower realms describe scaled projections, not the characters' novel cultivation.
 const ROSTER=Object.freeze([
  ['tiger-demon','虎妖','山林妖患','以山神之名盤踞山林的虎妖。'],
  ['qin-yuanhao','秦元浩','延江舵執事','不朽教的延江舵執事。'],
  ['chu-helmsman','楚舵主','延江暗舵','策劃逆壽元陣的延江舵主。'],
  ['tang-yunsheng','唐雲生','不朽教巡察使','負責聯絡與監察教眾的不朽教巡察使。'],
  ['immortal-cult-master','不朽教教主','魔教之首','統領不朽教、圖謀復活不朽仙人的教主。'],
  ['liu-deputy','劉副教主','黃粱夢局','參與潛入問道宗計畫的不朽教副教主。'],
  ['gao-zhenglai','高正來','不朽教副教主','不朽教高層，曾參與問道宗的潛入行動。'],
  ['duan-qingshui','段清水','經藏潛影','潛入西天寺、圖謀偷學經文的修士。'],
  ['mo-xiaochou','莫笑愁','羅漢拳影','為偷學羅漢拳而潛入西天寺的修士。'],
  ['yang-kongtong','楊崆峒','無情教主','追求七情道果雛形的無情教教主。'],
  ['wu-youdao','武有道','第六任虞帝','企圖復興大虞王朝的第六任虞帝。'],
  ['wuji','巫祭尊者','荒州巫祭','與武有道一同行動、圖謀國運之力的古修士。'],
  ['xukong','虛空至尊','虛界之主','能將對手拉入虛界的古代半仙。'],
  ['mengyan','夢魘至尊','夢境天衰','掌握夢之道果雛形的古代半仙。'],
  ['wanfa','萬法道君','古法長生','自古代存續至今、身懷長生仙體的半仙。'],
  ['sichen','司辰神君','歲月之術','大乾神君，掌握歲月道果雛形。'],
  ['silei','司雷神君','雷霆神威','大乾神君，與司辰神君同屬古代勢力。'],
  ['guan-shanhai','關山海','大虞國師','曾與大夏交鋒的大虞初代國師。'],
  ['siming','司命','啟靈仙法','掌握啟靈道果的大乾仙人。'],
  ['zhongtian','中天帝君','大乾帝威','坐鎮太陽仙宮的大乾帝君。'],
  ['wu-yao','武堯','初代虞帝','掌握置換道果的初代虞帝。'],
  ['zuoshi','左史仙','洞見古今','以洞見道果成仙的不朽教創始人。'],
  ['yingtian-corpse','應天屍','古仙遺軀','應天仙遺體產生自主意識後形成的強敵。'],
  ['jimie','寂滅仙','灰豆豆','由信仰孕育而生的寂滅仙。'],
  ['transcendent','幕後黑手','因果之外','隱藏身分、斬斷因果的超脫者。']
 ].map(([id,name,epithet,description])=>Object.freeze({id,name,epithet,description,
  portrait:'assets/trial-tower/'+id+'.webp',thumbnail:'assets/trial-tower/'+id+'-thumb.webp'})));
 function enemy(floor){
  if(!Number.isInteger(floor)||floor<1||floor>MAX_FLOOR)throw new RangeError('試煉樓層須為 1～100');
  // Ten rotating opponents per chapter. A decade never repeats a character;
  // adjacent visible tiers also stay distinct across chapter boundaries.
  const tier=Math.floor((floor-1)/10),[realm,totalScore]=REALMS[tier];
  const first=Math.min(15,Math.floor((floor-1)/20)*5);
  const guard=ROSTER[first+(floor-1)%10];
  const atk=Math.round(90+floor*4+.25*floor**1.1),maxHp=Math.round(700+floor*50+2*floor**1.2);
  const type=['sword','ocean','thunder','reverse','xingchen'][(Math.ceil(floor/5)-1)%5];
  return {uid:'trial-guard-'+floor,guardId:guard.id,guardVersion:VERSION,realm,name:guard.name,epithet:guard.epithet,description:guard.description,portrait:guard.portrait,thumbnail:guard.thumbnail,atk,baseAtk:atk,hp:maxHp,maxHp,baseMaxHp:maxHp,
   totalScore,trainingAccessScore:totalScore,goldenCore:floor>=21?{type,name:{sword:'破鋒劍心丹',ocean:'大海無垠丹',thunder:'萬劫雷霆丹',reverse:'陰陽反轉丹',xingchen:'星辰吞月丹'}[type],grade:Math.max(3,9-Math.floor(floor/15))}:null,
   nascentSoul:null,innateAbility:null,innateAbilityState:null,coreShield:false,coreCorrectStreak:0,soulStarCorrectWindow:0,
   artifactBattle:{version:1,effects:[],openingShield:0},artifactShield:0,artifactFirstHitUsed:false,artifactCheatDeathUsed:false};
 }
 function nextFloor(best){return Math.min(MAX_FLOOR,Math.max(0,Math.floor(Number(best)||0))+1);}
 function nearby(floor){
  const first=Math.min(MAX_FLOOR-4,Math.max(1,Math.floor(Number(floor)||1)-2));
  return Array.from({length:5},(_,i)=>first+4-i);
 }
 const api=Object.freeze({VERSION,MAX_FLOOR,ROSTER,enemy,nextFloor,nearby});
 if(typeof module==='object'&&module.exports)module.exports=api;else root.QATrialTowerGuards=api;
})(globalThis);
