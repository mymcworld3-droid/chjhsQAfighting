'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {BOOKS,RELEASE_NEW_WEAPONS}=require('../public/cultivation/manual-rules.js');
const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/manual-art.js'),'utf8');
const {bookArt,skillArt}=new Function(source.replace(/^export const /gm,'const ')+'\nreturn {bookArt,skillArt};')();
const HD_WEAPONS=new Set(['sword-prism','sword-weave','sword-time','body-bell','body-mirror','body-gravity']);
const HD_SKILLS=new Set(["prism-reflect","prism-scatter","weave-mark","weave-thread","weave-domain","time-slash","time-double","time-union"]);
const BLACK_SKILLS=new Set(["bell-strike","bell-shock","bell-echo","mirror-strike","mirror-summon","mirror-swap","gravity-strike","gravity-core","gravity-crash"]);
function assertBlackSkillWebp(bytes){
  assert.equal(bytes.toString('ascii',0,4),'RIFF');
  assert.equal(bytes.readUInt32LE(4)+8,bytes.length);
  assert.equal(bytes.toString('ascii',8,16),'WEBPVP8 ');
  assert.equal(bytes.readUInt32LE(16)+20+(bytes.readUInt32LE(16)%2),bytes.length,'single opaque VP8 chunk');
  assert.equal(bytes.subarray(23,26).toString('hex'),'9d012a');
  assert.equal(bytes.readUInt16LE(26)&0x3fff,512);
  assert.equal(bytes.readUInt16LE(28)&0x3fff,512);
}
const presentation=require('../public/cultivation/weapon-presentation.js');
const imageExists=(url,kind)=>{
  assert.match(url,new RegExp('^/assets/'+kind+'/[a-z-]+\\.png$'));
  assert.ok(fs.existsSync(path.join(__dirname,'../public',url.slice(1))),url+' must exist');
};
test('each known manual has an actual book image',()=>{
  assert.equal(BOOKS.length,RELEASE_NEW_WEAPONS?12:6);
  for(const book of BOOKS){if(!book.release)imageExists(bookArt(book.id),'books');else{const url=bookArt(book.id);assert.equal(url,'/assets/weapons/'+book.id+'-hd.'+(HD_WEAPONS.has(book.id)?'webp':'svg'));assert.ok(fs.existsSync(path.join(__dirname,'../public',url.slice(1))));assert.equal(presentation.art(book.id),url);if(HD_WEAPONS.has(book.id)){const bytes=fs.readFileSync(path.join(__dirname,'../public',url.slice(1)));assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');assert.equal(bytes.toString('ascii',12,16),'VP8X');assert.ok(bytes[20]&16,'WebP alpha flag');assert.equal(bytes.readUIntLE(24,3)+1,1024);assert.equal(bytes.readUIntLE(27,3)+1,1024);}}}
});
test('all skills resolve to their approved artwork, including shared moves',()=>{
  const moves=new Set();
  for(const book of BOOKS)for(const skill of book.skills){
    moves.add(skill.moveId);
    if(!book.release)imageExists(skillArt(skill),'skills');else{const url=skillArt(skill);assert.equal(url,skill.id==='prism-slash'?'/assets/skills/wind-slash.png':'/assets/skills/'+skill.id+((HD_SKILLS.has(skill.id)||BLACK_SKILLS.has(skill.id))?'.webp':'.svg'));const file=path.join(__dirname,'../public',url.slice(1));assert.ok(fs.existsSync(file));if(BLACK_SKILLS.has(skill.id))assertBlackSkillWebp(fs.readFileSync(file));if(HD_SKILLS.has(skill.id)){const bytes=fs.readFileSync(file);assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');assert.equal(bytes.toString('ascii',12,16),'VP8X');assert.ok(bytes[20]&16,'WebP alpha flag');assert.equal(bytes.readUIntLE(24,3)+1,512);assert.equal(bytes.readUIntLE(27,3)+1,512);}}
  }
  assert.equal(moves.size,RELEASE_NEW_WEAPONS?31:13);
  assert.equal(skillArt('prism-slash'),skillArt('wind-slash'));
  assert.equal(skillArt('flight-slash'),skillArt('wind-slash'));
  assert.equal(skillArt('sky-pierce'),skillArt('wind-slash'));
  assert.equal(skillArt('dragon-strike'),skillArt('rock-fist'));
  assert.equal(skillArt('tiger-fist'),skillArt('rock-fist'));
  assert.equal(skillArt('flight-break'),skillArt('wind-thousand'));
  imageExists(skillArt('dragon-roar'),'skills');
});
test('manual artwork is wired to library, equipped slots and combat action UI',()=>{
  const training=fs.readFileSync(path.join(__dirname,'../public/cultivation/manual-training-page.js'),'utf8');
  const combat=fs.readFileSync(path.join(__dirname,'../public/cultivation/tactical-combat.js'),'utf8');
  const views=['manual-hero-view.js','manual-library-view.js','manual-loadout-view.js','manual-skill-detail-view.js']
    .map(name=>fs.readFileSync(path.join(__dirname,'../public/cultivation',name),'utf8')).join('\n');
  for(const token of ['bookArt(book.id)','skillArt(skill)','manual-slot-art','manual-weapon-art'])
    assert.ok(views.includes(token),token);
  assert.match(training,/renderManualHero\(current/);
  assert.match(training,/renderManualLoadout\(current/);
  for(const token of ['skillArt(option.skill)','showPvpSkill','skillArt(shown)'])
    assert.ok(combat.includes(token),token);
});

test('all nine black-background totem skills resolve even when new weapons are hidden',()=>{
  assert.equal(BLACK_SKILLS.size,9);
  for(const id of BLACK_SKILLS){
    const url='/assets/skills/'+id+'.webp';
    assert.equal(skillArt(id),url);
    assertBlackSkillWebp(fs.readFileSync(path.join(__dirname,'../public',url.slice(1))));
  }
});
