'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'../',p),'utf8');
test('native main cultivation excludes stamina artwork and modal',()=>{
 const page=read('public/cultivation/manual-training-page.js'),gallery=read('public/cultivation/manual-library-view.js');
 const equipment=read('public/cultivation/manual-loadout-view.js'),css=read('public/styles/manual-training-weapons.css');
 assert.match(page,/manual-training-layout\.css/);assert.match(page,/manual-training-screen/);
 assert.doesNotMatch(page,/manual-training-art\.css|scene-art-shell\.css|manual-art-navigation/);
 assert.doesNotMatch(page,/<dialog id="manual-training-dialog"/);
 assert.match(gallery,/manual-native-card/);assert.doesNotMatch(gallery,/manual-art-card/);
 assert.match(equipment,/manual-weapon-dialog/);
 assert.match(css,/assets\/weapons\/sword-wind-hd\.webp/);
 assert.doesNotMatch(css,/assets\/training\/art-ui/);
});
test('native sorting, left-right carousel, and multiplayer gear fix remain intact',()=>{
 const page=read('public/cultivation/manual-training-page.js'),gallery=read('public/cultivation/manual-library-view.js'),hero=read('public/cultivation/manual-hero-view.js');
 assert.match(page,/data\.manualBrowseWeapon/);assert.match(page,/leaveDungeonAndRetryEquipment/);
 assert.match(gallery,/sortedOwnedWeapons/);assert.match(hero,/sortedOwnedWeapons/);
 assert.match(hero,/data-manual-browse-weapon/);
});
