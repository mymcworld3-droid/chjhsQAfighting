'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('shop balance uses spirit stone art and trading stays hidden and disabled',()=>{
 const html=read('public/index.html'),main=read('public/main.js'),market=read('public/cultivation/player-marketplace.js'),api=read('d1-browser-api.cjs');
 const shop=html.slice(html.indexOf('id="page-store"'),html.indexOf('id="page-battle"'));
 assert.match(shop,/<img class="game-stone-icon" src="\/assets\/items\/gold\.webp"[^>]*>\s*<span id="store-user-points">/);
 assert.match(shop,/id="player-market-switch" hidden inert/);
 assert.match(shop,/id="player-market" class="hidden" hidden inert/);
 assert.match(main,/window\.QA_PLAYER_MARKET_ENABLED = false/);
 assert.match(main,/function loadPlayerMarketSafely\(\) \{\s*if \(window\.QA_PLAYER_MARKET_ENABLED !== true\) return Promise\.resolve\(false\)/);
 assert.match(market,/if \(window\.QA_PLAYER_MARKET_ENABLED !== true\) return;/);
 assert.match(api,/if\(col==='marketListings'\)throw fail\('玩家交易市集暫停開放'\);\s*if\(admin\)return/);
});
