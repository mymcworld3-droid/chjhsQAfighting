'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {BOOKS}=require('../public/cultivation/manual-rules.js');
const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/manual-art.js'),'utf8');
const {bookArt,skillArt}=new Function(source.replace(/^export const /gm,'const ')+'\nreturn {bookArt,skillArt};')();
const imageExists=(url,kind)=>{
  assert.match(url,new RegExp('^/assets/'+kind+'/[a-z-]+\\.png$'));
  assert.ok(fs.existsSync(path.join(__dirname,'../public',url.slice(1))),url+' must exist');
};
test('each known manual has an actual book image',()=>{
  assert.equal(BOOKS.length,6);
  for(const book of BOOKS)imageExists(bookArt(book.id),'books');
});
test('all thirteen unique skills resolve to uploaded paintings, including shared moves',()=>{
  const moves=new Set();
  for(const book of BOOKS)for(const skill of book.skills){
    moves.add(skill.moveId);
    imageExists(skillArt(skill),'skills');
  }
  assert.equal(moves.size,13);
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
