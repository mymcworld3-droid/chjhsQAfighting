/* V2 W01-W07: canonical weapon artwork, identity, mastery and realm labels.
 * Callers supply authoritative account/room data. This module never grants XP. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.QAWeaponPresentation=api;})(globalThis,()=>{
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ids=new Set(['sword-wind','sword-flight','sword-sky','body-rock','body-dragon','body-tiger']);
  const art=id=>ids.has(id)?'/assets/weapons/'+id+'-hd.webp':'';
  const count=v=>Number.isFinite(Number(v))?Math.max(0,Math.trunc(Number(v))):0;
  const fmt=v=>count(v).toLocaleString('zh-TW');
  const levelText=book=>'Lv. '+Math.max(1,Math.min(20,count(book?.level)||1));
  const copiesText=book=>Object.entries(book?.weaponCopies||{}).map(([realm,quantity])=>realm+' × '+fmt(quantity)).join(' · ');
  function realmMarkup(name,{kind='weapon'}={}){
    const type=['weapon','character','difficulty'].includes(kind)?kind:'weapon';
    return '<span class="qy-realm-badge" data-qy-realm-kind="'+type+'">'+esc(name||'未定階')+'</span>';
  }
  function artMarkup(book,{className=''}={}){
    const url=art(book?.id);
    return url?'<span class="manual-weapon-art manual-weapon-art--'+esc(book.id)+' qy-weapon-art '+esc(className)+'" data-qy-weapon-art="'+esc(book.id)+'" role="img" aria-label="'+esc(book.name||'武器')+'" style="background-image:url(\''+url+'\')"></span>':'';
  }
  function identityMarkup(book,{size='small',slot}={}){
    if(!book)return '';
    const variant=['full','small','drop'].includes(size)?size:'small';
    return '<span class="qy-weapon-identity" data-qy-weapon-size="'+variant+'">'+artMarkup(book)+'<span><strong>'+esc(book.name||'武器')+'</strong><small>'+esc(book.school==='body'?'體修':book.school==='sword'?'劍修':book.weaponType||'武器')+' · '+realmMarkup(book.tierRealm)+'</small>'+(book.level!=null?'<small>'+levelText(book)+'</small>':'')+(slot===0||slot===1?'<small data-qy-weapon-slot="'+slot+'">武器'+(slot===0?'一':'二')+'</small>':'')+'</span></span>';
  }
  function mastery(book){
    const level=Math.max(1,Math.min(20,count(book?.level)||1)),current=count(book?.expInLevel),max=count(book?.expToNext);
    const known=book?.expInLevel!=null&&book?.expToNext!=null&&Number.isFinite(Number(book.expInLevel))&&Number.isFinite(Number(book.expToNext));
    return {level,current,max,maxed:level>=20,known,percent:level>=20?100:known&&max>0?Math.min(100,Math.floor(current/max*100)):null};
  }
  function masteryMarkup(book,{className=''}={}){
    const m=mastery(book),label=String(book?.name||'武器')+'熟練度';
    const next=m.maxed?'最高 Lv. '+m.level:m.percent===null?'':'Lv. '+m.level+' → Lv. '+(m.level+1)+' · 距 Lv. '+(m.level+1)+' 還差 '+fmt(Math.max(0,m.max-m.current))+' EXP';
    return '<span class="qy-weapon-mastery '+esc(className)+'" data-qy-weapon-mastery><span>'+levelText(book)+' · '+(m.maxed?'熟練度已滿':m.percent===null?'熟練度同步中':fmt(m.current)+' / '+fmt(m.max)+' EXP')+'</span><span data-qy-progress="linear" role="progressbar" aria-label="'+esc(label)+'" aria-valuemin="0" aria-valuemax="100" '+(m.percent===null?'aria-valuetext="熟練度尚未同步"':'aria-valuenow="'+m.percent+'"')+'><i style="width:'+(m.percent??0)+'%"></i></span>'+(next?'<small>'+next+'</small>':'')+'</span>';
  }
  function skillMarkup(skill,{description='',icon='',showLevel=true,cost=skill?.cost}={}){
    if(!skill)return '';
    return '<div class="manual-focus-skill-main qy-skill-details" data-qy-skill-details="'+esc(skill.id||'')+'">'+(icon?'<img class="manual-skill-art" src="'+esc(icon)+'" alt="" loading="lazy" decoding="async">':'')+'<div class="manual-focus-skill-info"><strong>'+esc(skill.name)+(showLevel&&skill.unlocked?' · Lv. '+fmt(skill.level):'')+'</strong><small>'+fmt(cost)+' 體力 · '+(skill.unlimited?'無固定射程':fmt(skill.range)+' 格')+'</small><p>'+esc(description)+'</p></div></div>';
  }
  function difficultyState({locked=false,clears=0,resume=false}={}){
    return resume?{key:'active',label:'進行中'}:locked?{key:'locked',label:'未解鎖'}:count(clears)?{key:'complete',label:'通關 '+fmt(clears)+' 次'}:{key:'ready',label:'可挑戰'};
  }
  return Object.freeze({art,artMarkup,identityMarkup,realmMarkup,levelText,copiesText,mastery,masteryMarkup,skillMarkup,difficultyState});
});
