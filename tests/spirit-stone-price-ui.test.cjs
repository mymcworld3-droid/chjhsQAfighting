'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const helper=read('public/cultivation/spirit-stone-ui.js');
const api=vm.runInNewContext(helper.replace(/^export /gm,'')+
  '\n({stoneCostMarkup,splitStoneText})');
test('original stamina spirit-stone artwork is reused on the main branch',()=>{
 const html=read('public/index.html');
 assert.match(html,/src="\/assets\/items\/gold.webp"/);
 assert.match(helper,/STONE_IMAGE='\/assets\/items\/gold.webp'/);
 assert.match(html,/styles\/spirit-stone-ui\.css\?v=20261125-stone-price-art-v1/);
 assert.match(read('public/main.js'),/import '\.\/cultivation\/spirit-stone-ui\.js\?v=20261125-stone-price-art-v1'/);
});
test('skill and weapon upgrades show label, image, and live server-quoted gold amount',()=>{
 const skill=read('public/cultivation/manual-skill-detail-view.js');
 const hero=read('public/cultivation/manual-hero-view.js');
 assert.match(skill,/強化 \$\{stoneCostMarkup\(upgrade\.gold\)\}/);
 assert.match(hero,/升級 \$\{stoneCostMarkup\(upgrade\.gold\)\}/);
 assert.match(skill,/data-skill-upgrade/);
 assert.match(hero,/data-manual-upgrade/);
 assert.match(skill,/Number\(gold\)<Number\(upgrade\.gold\)/);
 assert.match(hero,/Number\(state\.gold\|\|0\)<Number\(upgrade\.gold\|\|0\)/);
});
test('price formatting uses thousand separators and shows unknown prices safely',()=>{
 assert.match(api.stoneCostMarkup(200),/src="\/assets\/items\/gold.webp"/);
 assert.match(api.stoneCostMarkup(200),/>200<\/b>/);
 assert.match(api.stoneCostMarkup(12500),/>12,500<\/b>/);
 assert.match(api.stoneCostMarkup(undefined),/>—<\/b>/);
});
test('all gold-bearing buttons can adopt icon without altering payment rules',()=>{
 const values=['洗髓（100 靈石）','單抽 · 250 靈石','五連抽 · 1,250 靈石','購買 500 金幣','單抽 · — 靈石'];
 const expected=['100','250','1,250','500','—'];
 values.forEach((value,index)=>{
   const parts=api.splitStoneText(value);
   assert.equal(parts.find(part=>part.kind==='stone').value,expected[index]);
 });
 assert.equal(api.splitStoneText('強化消耗 2 體力'),null);
 assert.equal(api.splitStoneText('進階需要 5 煉器碎片'),null);
 const source=read('public/cultivation/player-marketplace.js');
 assert.match(source,/stoneCostMarkup\(price\)/);
 assert.match(source,/data-pm-buy/);
 assert.match(source,/gold\(data\(\)\) >= qty\(listing\.price\)/);
 assert.match(read('public/cultivation/soulbound-draw.js'),/單抽 · \$\{s\.prices\?\.single/);
 assert.match(read('public/cultivation/cultivation-training-v4.js'),/洗髓（100 靈石）/);
});
test('display-only decorator does not replace clickable buttons or handlers',()=>{
 assert.match(helper,/document\.createTreeWalker\(button,4\)/);
 assert.match(helper,/current\.replaceWith\(fragment\)/);
 assert.match(helper,/\.observe\(document\.body,\{subtree:true,childList:true,characterData:true\}\)/);
 assert.doesNotMatch(helper,/button\.outerHTML\s*=|button\.innerHTML\s*=/);
});
