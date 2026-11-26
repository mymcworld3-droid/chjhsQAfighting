'use strict';
const crypto=require('node:crypto');
const Manuals=require('./public/cultivation/manual-rules.js');
function roll(room,uid,record,randomInt=crypto.randomInt){
  const info=room.weaponDungeon,value=randomInt(100);
  // Exactly one roll: 30% current, 20% next, 50% no weapon. No pity or reroll.
  if(value>=50)return null;
  const realm=value<30?info.realm:info.nextRealm;
  const pool=Manuals.BOOKS.filter(book=>book.tierRealm===realm);
  // Never manufacture a different realm version of an existing weapon.
  if(!pool.length)return null;
  const book=pool[randomInt(pool.length)],old=record.books[book.id];
  const previousRefinement=Manuals.refinementFor(old);
  const quantity=old?Manuals.copyCount(old)+1:1;
  const refinement=old?Math.min(Manuals.MAX_REFINEMENT,previousRefinement+1):0;
  record.books[book.id]={...(old||{exp:0}),tierRealm:book.tierRealm,copies:{[book.tierRealm]:quantity},refinement};
  const drop={id:book.id,name:book.name,tierRealm:book.tierRealm,quantity:1,duplicate:!!old,retainedRealm:book.tierRealm,previousRefinement,refinement};
  room.manualDrops||={};room.manualDrops[uid]=drop;
  return drop;
}
module.exports={roll};
