'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('duel and tower render the same arena structure with isolated IDs',async()=>{
 const source=fs.readFileSync('public/cultivation/duel-arena-view.js','utf8');
 const {duelArenaMarkup}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const duel=duelArenaMarkup(),tower=duelArenaMarkup({prefix:'tt',maxRounds:24});
 assert.equal(tower.replaceAll('id="tt-','id="bv2-').replace('1 / 24','1 / 15'),duel);
 const ids=[...tower.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);assert.ok(ids.every(id=>id.startsWith('tt-')));
 assert.ok(tower.includes('bv2-stage-aura'));assert.ok(tower.includes('bv2-stage-motes'));
 const battle=fs.readFileSync('public/cultivation/battle-mode-v2.js','utf8'),trial=fs.readFileSync('public/cultivation/martial-trial.js','utf8');
 assert.match(battle,/duelArenaMarkup\(\{maxRounds:BATTLE_V2.maxRounds\}\)/);assert.match(trial,/duelArenaMarkup\(\{prefix:'tt',maxRounds:state.maxRounds\}\)/);
});
