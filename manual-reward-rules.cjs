'use strict';
// Ordinary trials drop eligible native 煉氣 weapons, missing first, then copies.
// Called only after a server-verified win, in the same A transaction as the
// reward receipt. The returned state must be saved even when a roll misses.
const crypto=require('node:crypto');
const Manuals=require('./public/cultivation/manual-rules.js');
function roll(s,uid,raw,randomInt=crypto.randomInt){
  const state=raw?.version===2?raw:Manuals.normalize(raw);
  const ordinaryTrial=s?.mode==='pve'&&!!s.trial&&!s.weaponDungeon;
  const eligible=Manuals.BOOKS.filter(book=>!ordinaryTrial||book.tierRealm==='煉氣');
  const missing=eligible.filter(book=>!state.books[book.id]);
  const duplicatePool=ordinaryTrial&&!missing.length;
  const available=duplicatePool?eligible:missing;
  if(!available.length)return {state,changed:false,drop:null};
  // A first-stage beginner without any scripture must have a real, usable
  // skill to equip at the end of onboarding. Grant exactly one starter book
  // inside the same idempotent server victory transaction (no client loot).
  if(s?.mode==='pve'&&s.trial?.stage===1&&s.trial.layoutVersion===4&&
     !Object.keys(state.books).length){
    const starter=Manuals.starterFor(state.school)||'sword-wind';
    state.books[starter]={exp:0};state.dropMisses=0;
    s.manualDrops||={};s.manualDrops[uid]={id:starter,name:Manuals.BY_BOOK[starter].name};
    return {state,changed:true,drop:starter,dropName:Manuals.BY_BOOK[starter].name};
  }
  if(state.dropMisses<3&&randomInt(100)>=30){
    state.dropMisses++;
    return {state,changed:true,drop:null};
  }
  const sameSchool=available.filter(book=>book.school===state.school);
  const pool=!duplicatePool&&sameSchool.length&&randomInt(100)<70?sameSchool:available;
  const picked=pool[randomInt(pool.length)];
  const old=state.books[picked.id];
  const previousRefinement=Manuals.refinementFor(old);
  const refinement=old?Math.min(Manuals.MAX_REFINEMENT,previousRefinement+1):0;
  const quantity=old?Manuals.copyCount(old)+1:1;
  state.books[picked.id]=old?{...old,tierRealm:picked.tierRealm,copies:{[picked.tierRealm]:quantity},refinement}:{exp:0};
  state.dropMisses=0;
  if(s){s.manualDrops||={};s.manualDrops[uid]={id:picked.id,name:picked.name,...(ordinaryTrial?{tierRealm:picked.tierRealm,quantity:1,duplicate:!!old,retainedRealm:picked.tierRealm,previousRefinement,refinement}:{})};}
  return {state,changed:true,drop:picked.id,dropName:picked.name};
}
module.exports={roll};
