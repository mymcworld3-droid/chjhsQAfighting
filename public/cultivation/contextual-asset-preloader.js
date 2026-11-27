/* Network warmup policy: only visible/currently equipped resources.
 * This UMD policy runs in the browser and in deterministic Node tests.
 * Nothing is requested merely by importing this file.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.QAContextualAssets=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
  'use strict';
  const WORLD=Object.freeze({
    ground:'/assets/world-map/ai/ground-atlas.webp',
    props:'/assets/world-map/ai/props-atlas.webp',
    monsters:'/assets/world-map/ai/creatures-atlas.webp',
    male:'/assets/world-map/players/player-male.webp',
    female:'/assets/world-map/players/player-female.webp',
    seals:'/assets/seals/seal-atlas.webp',
    guardian:'/assets/shrines/guardian-atlas.webp'
  });
  const WEAPONS=new Set(['sword-wind','sword-flight','sword-sky',
    'body-rock','body-dragon','body-tiger']);
  const DRAFTS=new Set(["sword-prism","body-bell","sword-weave","body-mirror","sword-time","body-gravity"]);
  const known=id=>WEAPONS.has(id)||DRAFTS.has(id);
  const unique=urls=>[...new Set(urls.filter(x=>typeof x==='string'&&
    /^\/(?:assets\/|styles\/)/.test(x)))];
  function weaponImages(ids){
    return unique((Array.isArray(ids)?ids:[]).slice(0,3)
      .filter(known).map(id=>'/assets/weapons/'+id+'-hd.webp'));
  }
  function genders(people){
    const found=new Set();
    for(const person of people||[]){
      if(!person||person.bot)continue;
      found.add(person.gender==='female'?'female':'male');
    }
    return [...found].map(gender=>WORLD[gender]);
  }
  function trialImages(state,uid){
    if(state?.status!=='active'||!Array.isArray(state.actors))return [];
    const hero=state.actors.find(actor=>actor?.uid===uid&&!actor.bot);
    return unique([
      WORLD.ground,WORLD.props,WORLD.monsters,
      ...genders(state.actors),
      ...(state.objective?.type==='sealing'?[WORLD.seals]:[]),
      ...(state.objective?.type==='defense'?[WORLD.guardian]:[]),
      ...weaponImages(hero?.manualWeaponIds)
    ]);
  }
  function dungeonImages(room,uid){
    if(room?.status!=='assembled'||!room.members?.[uid])return [];
    const members=Object.values(room.members);
    return unique([WORLD.ground,WORLD.monsters,...genders(members),
      ...weaponImages(room.members[uid]?.dungeonWeaponIds)]);
  }
  function manualImages(state){
    // The library renders only owned weapons. Do not fetch unowned artwork,
    // rare drops, or images for unrelated battle modes.
    return weaponImages((state?.library||[]).filter(book=>book.owned)
      .map(book=>book.id).slice(0,3));
  }
  function chosenSkills(weaponId,byBook,skillArt){
    if(!known(weaponId)||typeof skillArt!=='function')return [];
    const skills=byBook?.[weaponId]?.skills||[];
    return unique(skills.map(skill=>skillArt(skill)).filter(Boolean));
  }
  // Independent image requests are bounded; the browser cache and
  // service worker handle reuse across actual <img>/CSS usage.
  const seen=new Map();
  async function warmImage(src){
    if(seen.has(src))return seen.get(src);
    if(typeof Image!=='function')return false;
    const job=new Promise(resolve=>{
      const image=new Image();let finished=false;
      const done=ok=>{if(finished)return;finished=true;clearTimeout(timeout);
        image.onload=null;image.onerror=null;resolve(ok);};
      const timeout=setTimeout(()=>done(false),4500);
      image.decoding='async';
      image.fetchPriority='low';
      image.onload=()=>done(true);
      image.onerror=()=>done(false);
      image.src=src;
      if(image.complete&&image.naturalWidth>0)done(true);
    });
    seen.set(src,job);return job;
  }
  async function warmImages(urls,{signal,max=8}={}){
    const selected=unique(Array.isArray(urls)?urls:[]).slice(0,Math.max(0,Math.min(12,max)));
    let cursor=0;
    const workers=Array.from({length:Math.min(2,selected.length)},async()=>{
      const results=[];
      while(cursor<selected.length&&!signal?.aborted){
        const src=selected[cursor++];
        results.push({src,ok:await warmImage(src)});
      }
      return results;
    });
    return (await Promise.all(workers)).flat();
  }
  return Object.freeze({WORLD,weaponImages,trialImages,dungeonImages,manualImages,chosenSkills,warmImages});
});
