'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const helper=read('public/cultivation/spirit-stone-ui.js');
const api=vm.runInNewContext(helper.replace(/^export /gm,'')+
  '\n({stoneCostMarkup,splitStoneText,formatResourceAmount,cultivationMarkup,weaponDungeonTicketMarkup})');
test('original stamina spirit-stone artwork is reused on the main branch',()=>{
 const html=read('public/index.html');
 assert.match(html,/src="\/assets\/items\/gold.webp"/);
 assert.match(helper,/STONE_IMAGE='\/assets\/items\/gold.webp'/);
 assert.match(html,/styles\/spirit-stone-ui\.css\?v=20261125-stone-reward-icon-v2/);
 assert.match(read('public/main.js'),/import '\.\/cultivation\/spirit-stone-ui\.js\?v=20261125-stone-reward-icon-v2'/);
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
 assert.match(helper,/document\.createTreeWalker\(root,4\)/);
 assert.match(helper,/node\.replaceWith\(fragment\)/);
 assert.match(helper,/\.observe\(document\.body,\{subtree:true,childList:true,characterData:true\}\)/);
 assert.doesNotMatch(helper,/button\.outerHTML\s*=|button\.innerHTML\s*=/);
});

test('amounts earned or spent in either word order become image followed by signed amount',()=>{
 for(const [label,expected] of [
  ['靈石 +30','+30'],['+30 靈石','+30'],['已發放：+30 靈石','+30'],
  ['獲得 30 靈石','30'],['現有靈石：5,602','5,602'],
  ['靈石 -50','-50'],['靈石 ×3','×3'],['洗髓（100 靈石）','100']
 ]){
  const parts=api.splitStoneText(label),money=parts?.find(part=>part.kind==='stone');
  assert.ok(money,label);
  assert.equal(money.value,expected,label);
  assert.match(api.stoneCostMarkup(money.value),new RegExp('>'+expected.replace('-','−').replace(/[+*]/g,'\\expected.replace(/[+*]/g,'\\$&').replace('×','×')')+'<\\/b>'));
 }
 assert.equal(api.splitStoneText('靈石不足，請先完成任務'),null);
 assert.equal(api.splitStoneText('答案為 30 修為'),null);
 assert.match(api.stoneCostMarkup('+30'),/>\+30<\/b>/);
});
test('reward and wallet surfaces use the original bitmap without changing earnings',()=>{
 const vocab=read('public/cultivation/daily-vocabulary-page.js');
 const meditation=read('public/cultivation/daily-meditation.js');
 const medal=read('public/cultivation/daily-meditation-rewards.js');
 const core=read('public/cultivation/cultivation-training-v4.js');
 const draw=read('public/cultivation/soulbound-draw.js');
 assert.match(vocab,/stoneCostMarkup\('\+'\+reward\.gold\)/);
 assert.match(vocab,/stoneCostMarkup\(rules\.DAILY_REWARD\.gold\)/);
 assert.match(meditation,/label==='個人靈石'/);
 assert.match(meditation,/stoneCostMarkup\(value\)/);
 assert.match(meditation,/if\(id==='gold'\)/);
 assert.match(medal,/item\.key==='gold'/);
 assert.match(core,/stoneCostMarkup\(Growth\.count\(/);
 assert.match(draw,/stoneCostMarkup\(s\.balance\)/);
 assert.match(helper,/const excluded=.*#page-quiz/);
 assert.match(helper,/\.observe\(document\.body,\{subtree:true,childList:true,characterData:true\}\)/);
});
test('DOM replacement is text-only and places stone art before reward amount',()=>{
 const inserted=[];
 const document={
  createDocumentFragment:()=>({children:[],append(...nodes){this.children.push(...nodes);}}),
  createTextNode:value=>({nodeType:3,nodeValue:value}),
  createElement:tag=>({
   tagName:tag.toUpperCase(),className:'',children:[],
   setAttribute(){},append(...nodes){this.children.push(...nodes);}
  })
 };
 const runtime=vm.runInNewContext(helper.replace(/^export /gm,'')+'\n({decorateStoneContent})',{document});
 const parent={closest:selector=>selector.includes('.quest-reward')?{}:null};
 const textNode={nodeType:3,isConnected:true,nodeValue:'獎勵：靈石 +30',parentElement:parent,
   replaceWith(fragment){inserted.push(...fragment.children);}};
 assert.equal(runtime.decorateStoneContent(textNode),1);
 const display=inserted.find(node=>node.className==='game-stone-cost');
 assert.ok(display);
 assert.equal(display.children[0].src,'/assets/items/gold.webp');
 assert.equal(display.children[1].textContent,'+30');
 assert.equal(display.children[2].textContent,' 靈石');
});

test('shared resource amounts have consistent signs, thousand separators and distinct accessible artwork',()=>{
 assert.equal(api.formatResourceAmount('＋1250'),'+1,250');
 assert.equal(api.formatResourceAmount(-1250),'−1,250');
 assert.equal(api.formatResourceAmount(undefined),'—');
 assert.match(api.cultivationMarkup('+20'),/cultivation\.svg.*>\+20<\/b>.*修為/);
 assert.match(api.weaponDungeonTicketMarkup(3,{max:5}),/weapon-dungeon-ticket\.svg.*>3 \/ 5<\/b>.*副本券/);
 assert.doesNotMatch(api.weaponDungeonTicketMarkup(1),/raid-ticket|draw-ticket|gold\.webp/);
});
test('legacy conversion is not performed in arbitrary player text or excluded content',()=>{
 const document={};
 const runtime=vm.runInNewContext(helper.replace(/^export /gm,'')+'\n({decorateStoneContent})',{document});
 for(const closest of [()=>null,selector=>selector.includes('#chat-messages')||selector.includes('.quest-reward')?{}:null]){
  const node={nodeType:3,isConnected:true,nodeValue:'題目：30 金幣',parentElement:{closest},replaceWith(){assert.fail('must preserve content');}};
  assert.equal(runtime.decorateStoneContent(node),0);
 }
});
