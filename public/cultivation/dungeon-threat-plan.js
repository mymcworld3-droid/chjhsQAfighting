// Read-only adapter from C-room telegraphs to the exact warning renderer
// shared with 問道試煉. A client cannot create attacks or alter hit tiles.
const key=p=>p.x+','+p.y;
const legal=(map,p)=>Number.isInteger(p?.x)&&Number.isInteger(p?.y)&&
  p.x>=0&&p.y>=0&&p.x<map?.width&&p.y<map?.height&&
  map.tiles?.[p.y*map.width+p.x]>0;
export function dungeonThreatPlan(map,enemies=[],members=[],uid='',rangeTiles=[],mode='move'){
  const empty={cells:[],byKey:Object.create(null),playerThreatened:false,
    attackers:0,landingHints:[],player:null,description:''};
  if(!map)return empty;
  const byKey=Object.create(null);
  let attackers=0;
  for(const enemy of enemies||[]){
    const attack=enemy?.attack;
    if(!Array.isArray(attack?.cells)||!attack.cells.length||
       (attack.from&&enemy.position&&
        (attack.from.x!==enemy.position.x||attack.from.y!==enemy.position.y)))
      continue;
    attackers++;
    for(const p of attack.cells){
      if(!legal(map,p))continue;
      const k=key(p),record=byKey[k]||(byKey[k]={
        x:p.x,y:p.y,attackers:[],boss:false,hazard:false});
      if(!record.attackers.includes(enemy.id))record.attackers.push(enemy.id);
      if(enemy.kind==='boss'||enemy.kind==='guardian')record.boss=true;
    }
  }
  const cells=Object.values(byKey).sort((a,b)=>a.y-b.y||a.x-b.x);
  const me=(members||[]).find(m=>m.uid===uid);
  const player=legal(map,me?.position)?{...me.position}:null;
  const playerThreatened=!!player&&!!byKey[key(player)];
  const landingHints=[];
  if(playerThreatened&&mode==='move'){
    const candidates=(rangeTiles||[]).filter(p=>legal(map,p)&&!byKey[key(p)])
      .sort((a,b)=>Math.abs(a.x-player.x)+Math.abs(a.y-player.y)-
        Math.abs(b.x-player.x)-Math.abs(b.y-player.y)||
        a.y-b.y||a.x-b.x);
    for(const p of candidates){
      if(landingHints.length===2)break;
      const dx=Math.sign(p.x-player.x),dy=Math.sign(p.y-player.y);
      if(landingHints.some(q=>Math.sign(q.x-player.x)===dx&&
        Math.sign(q.y-player.y)===dy))continue;
      landingHints.push({x:p.x,y:p.y,
        cost:Math.abs(p.x-player.x)+Math.abs(p.y-player.y)});
    }
  }
  return {cells,byKey,attackers,playerThreatened,landingHints,player,
    description:cells.length?'目前有 '+cells.length+' 個預告危險格'+
      (playerThreatened?'，角色所在位置受到攻擊預告':''):
      '目前沒有已標示的敵方攻擊預告'};
}
