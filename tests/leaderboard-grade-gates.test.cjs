const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const read = path => readFileSync(join(__dirname, '..', path), 'utf8');

const { __test: cleanup } = require('../world-immortals-cleanup-api.cjs');
const legacy = read('public/main-legacy.js');
const html = read('public/index.html');
const progress = read('public/cultivation/cultivation-progression-v2.js');
const five = read('public/cultivation/five-immortals.js');

test('two Immortal Board groups are selectable and below-Tribulation accounts are omitted', () => {
  assert.match(html, /data-leaderboard-group="elementary"[^>]*>國小以下<\/button>/);
  assert.match(html, /data-leaderboard-group="junior"[^>]*>國中以上<\/button>/);
  assert.match(legacy, /const LEADERBOARD_MIN_SCORE = 1268/);
  assert.match(legacy, /where\('stats\.totalScore', '>=', LEADERBOARD_MIN_SCORE\)/);
  assert.match(legacy, /leaderboardEducationGroup\(data\.profile\?\.educationLevel\)/);
  assert.match(legacy, /startAfter\(cursor\)/);
  assert.match(legacy, /if \(score < LEADERBOARD_MIN_SCORE\) continue/);
});

test('Alliance entry with missing education level offers a clickable settings redirect', () => {
  assert.match(legacy, /pageId === 'page-social' && window\.promptXiuxianEducationLevel\(\)/);
  assert.match(legacy, /id="xep-go"/);
  assert.match(legacy, /window\.switchToPage\('page-settings'\)/);
  assert.match(legacy, /document\.getElementById\('set-level'\)\?\.focus\(\)/);
  assert.match(progress, /window\.promptXiuxianEducationLevel\?\.\(\)/);
});

test('existing Five Immortals seats are pruned by verified server transaction', async () => {
  assert.equal(cleanup.TRIBULATION_SCORE,1268);
  assert.equal(cleanup.invalidSeat({uid:'low'}, {stats:{totalScore:1267}}),true);
  assert.equal(cleanup.invalidSeat({uid:'qualified'}, {stats:{totalScore:1268}}),false);
  assert.equal(cleanup.invalidSeat({uid:'deleted'}, null),true);
  assert.match(read('server.js'), /registerImmortalsCleanupApi\(app\)/);
  assert.match(five, /\/api\/immortals\/prune-ineligible/);
  const rows = new Map([
    ['ru-xian',{uid:'valid'}],['fa-xian',{uid:'low'}],
    ['suan-xian',{uid:'vanished'}],['unrelated',{uid:'low'}]
  ]);
  const users = new Map([['valid',{stats:{totalScore:1268}}],['low',{stats:{totalScore:1267}}]]);
  const db = {
    collection(name) {
      return {
        doc(id) { return {name,id} },
        get:async()=>({docs:[...rows].map(([id,data])=>({id,ref:{name,id},data:()=>data}))})
      };
    },
    async runTransaction(fn) {
      return fn({
        async get(ref) {
          const data=ref.name==='users'?users.get(ref.id):rows.get(ref.id);
          return {ref,exists:data!==undefined,data:()=>data};
        },
        delete(ref) { rows.delete(ref.id); }
      });
    }
  };
  assert.equal(await cleanup.pruneInvalidSeats(db), 2);
  assert.deepEqual([...rows.keys()],['ru-xian','unrelated']);
});

test('pruning requires a valid bearer token instead of permitting unauthenticated deletes', async () => {
  const handler = cleanup.createHandler({resolve:()=>{throw new Error('must not touch data')},logger:{warn(){}}});
  let status = 0, payload;
  const res = {set(){},status(code){status=code;return this},json(body){payload=body;return body}};
  await handler({get:()=>''},res);
  assert.equal(status,401);
  assert.equal(payload.ok,false);
});
