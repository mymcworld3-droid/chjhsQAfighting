'use strict';
const crypto=require('node:crypto');
const Manuals=require('./public/cultivation/manual-rules.js');
const Dungeon=require('./public/cultivation/weapon-dungeon-rules.js');
function roll(room,uid,record,randomInt=crypto.randomInt){
  const info=room.weaponDungeon,value=randomInt(100);
  // Exactly one roll: 30% current, 20% next, 50% no weapon. No pity or reroll.
  if(value>=50)return null;
  const realm=value<30?info.realm:info.nextRealm;
  const sameTier=Manuals.BOOKS.filter(book=>book.tierRealm===realm);
  const pool=sameTier.length?sameTier:Manuals.BOOKS;
  const book=pool[randomInt(pool.length)],old=record.books[book.id];
  const copies={...(old?.copies||{})};
  if(old&&!Object.keys(copies).length)copies[old.tierRealm||book.tierRealm]=1;
  copies[realm]=(copies[realm]||0)+1;
  const oldTier=old?.tierRealm||book.tierRealm;
  const best=old&&Dungeon.WEAPON_REALMS.indexOf(oldTier)>Dungeon.WEAPON_REALMS.indexOf(realm)?oldTier:realm;
  record.books[book.id]={...(old||{exp:0}),tierRealm:best,copies};
  const drop={id:book.id,name:book.name,tierRealm:realm,quantity:1,duplicate:!!old,retainedRealm:best};
  room.manualDrops||={};room.manualDrops[uid]=drop;
  return drop;
}
module.exports={roll};
