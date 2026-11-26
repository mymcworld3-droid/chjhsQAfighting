// Read-only stage layout. Server pathRows is authoritative; grouping never changes claim order.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.QAPathJourney=api;})(globalThis,()=>{
 const milestones=[
 ['path-qi-five','煉氣','seedling'],['path-foundation','築基','mountain'],['path-golden','金丹','sun'],
 ['path-nascent','元嬰','fire'],['path-spirit','化神','eye'],['path-void','煉虛','moon'],
 ['path-union','合體','yin-yang'],['path-mahayana','渡劫','bolt'],['path-tribulation','半仙','feather'],
 ['path-immortal','仙道精進','crown']
 ];
 function journey(snapshot,catalog){
  const byId=new Map((snapshot?.pathRows||[snapshot?.path].filter(Boolean)).map(q=>[q.id,q]));
  const groups=[];let pending=[];
  for(const q of catalog||[]){
   pending.push(q.id);
   const m=milestones.find(item=>item[0]===q.id);
   if(!m)continue;
   const rows=pending.map(id=>byId.get(id)).filter(Boolean);
   if(rows.length)groups.push({id:m[0],name:m[1],icon:m[2],target:q.target,rows,
    claimed:rows.filter(q=>q.claimed).length,done:rows.every(q=>q.claimed)});
   pending=[];
  }
  const active=groups.find(g=>g.rows.some(q=>q.id===snapshot?.path?.id))||groups.at(-1)||null;
  return {groups,activeId:active?.id||null};
 }
 return Object.freeze({journey});
});
