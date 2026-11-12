/* Shared immutable technique catalog. Rules run identically in the browser and server. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QAManuals=api;
})(globalThis,()=>{
  'use strict';
  const technique=(id,name,cost,range,kind,power,description,extra={})=>
    Object.freeze({id,name,cost,range,kind,power,description,cooldown:2,...extra});
  const book=(id,name,school,description,skills)=>Object.freeze({
    id,name,school,description,skills:Object.freeze(skills.map((skill,index)=>
      Object.freeze({...skill,manualId:id,killsRequired:[0,3,8][index]})))
  });
  const BOOKS=Object.freeze([
    book('sword-wind','流風劍訣','sword','以靈巧身法引動劍氣。',[
      technique('wind-slash','流風斬',3,3,'line',1.15,'沿直線三格斬擊。'),
      technique('wind-step','踏風劍影',3,3,'lunge',1.3,'突進至敵人身旁並斬擊。'),
      technique('wind-thousand','千風歸劍',4,4,'line',1.75,'凝聚風刃，穿透直線上的敵人。')
    ]),
    book('sword-sky','青霄劍典','sword','精煉劍意，破陣制敵。',[
      technique('sky-pierce','青霄一劍',3,3,'hit',1.35,'攻擊三格內單一敵人。'),
      technique('sky-cloud','劍雨流雲',4,3,'area',1.15,'對目標及鄰近敵人造成傷害。',{radius:1}),
      technique('sky-sever','斷空劍意',4,4,'hit',1.9,'劍意直達四格內敵人。')
    ]),
    book('body-rock','玄嶽鍛體訣','body','鍛筋煉骨，撼地破敵。',[
      technique('rock-fist','碎岩拳',2,1,'hit',1.2,'擊打相鄰敵人。'),
      technique('rock-quake','震嶽罡勁',3,1,'ring',1.1,'震擊身旁一圈敵人。'),
      technique('rock-break','崩山重拳',4,2,'hit',1.8,'重拳猛擊並將敵人擊退一格。',{push:1})
    ]),
    book('body-dragon','龍象真身訣','body','以血肉之軀凝聚龍象之力。',[
      technique('dragon-strike','龍象衝拳',3,2,'hit',1.3,'猛擊兩格內敵人。'),
      technique('dragon-guard','金剛護體',3,0,'counter',.55,'本回合減傷並於首次受擊反擊。'),
      technique('dragon-roar','龍象震天',4,1,'ring',1.65,'震盪周身一圈，擊退目標。',{push:1})
    ])
  ]);
  const BY_BOOK=Object.freeze(Object.fromEntries(BOOKS.map(book=>[book.id,book])));
  const BY_SKILL=Object.freeze(Object.fromEntries(BOOKS.flatMap(book=>book.skills.map(skill=>[skill.id,skill]))));
  const publicSkill=(skill,kills)=>({...skill,unlocked:kills>=skill.killsRequired});
  function normalize(raw){
    const books={};
    for(const [id,record] of Object.entries(raw?.books||{})){
      if(BY_BOOK[id])books[id]={kills:Math.max(0,Math.min(100000,Math.trunc(Number(record?.kills)||0)))};
    }
    const school=['sword','body'].includes(raw?.school)?raw.school:null;
    const equipped=[];
    for(const id of (Array.isArray(raw?.equipped)?raw.equipped:[])){
      const skill=BY_SKILL[id],kills=books[skill?.manualId]?.kills||0;
      if(skill&&books[skill.manualId]&&kills>=skill.killsRequired&&!equipped.includes(id)&&equipped.length<3)equipped.push(id);
    }
    return {version:1,school,books,equipped,dropMisses:Math.max(0,Math.min(3,Math.trunc(Number(raw?.dropMisses)||0))),starterClaimed:raw?.starterClaimed===true};
  }
  function unlocked(state,id){
    const s=normalize(state),skill=BY_SKILL[id];
    return !!skill&&!!s.books[skill.manualId]&&s.books[skill.manualId].kills>=skill.killsRequired;
  }
  function publicState(raw){
    const s=normalize(raw);
    return {...s,library:BOOKS.map(book=>{
      const own=s.books[book.id],kills=own?.kills||0;
      return {id:book.id,name:book.name,school:book.school,description:book.description,owned:!!own,kills,
        skills:book.skills.map(skill=>publicSkill(skill,kills))};
    })};
  }
  const starterFor=school=>school==='sword'?'sword-wind':school==='body'?'body-rock':null;
  return Object.freeze({BOOKS,BY_BOOK,BY_SKILL,normalize,unlocked,publicState,starterFor});
});