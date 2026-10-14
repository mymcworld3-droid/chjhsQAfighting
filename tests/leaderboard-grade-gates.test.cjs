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

test('ordinary board has no realm entry gate or manual school-cohort switch', () => {
  assert.doesNotMatch(html, /id="leaderboard-groups"|data-leaderboard-group|selectLeaderboardGroup/);
  assert.doesNotMatch(html, /上榜資格：渡劫期以上/);
  assert.doesNotMatch(legacy, /LEADERBOARD_MIN_SCORE|selectLeaderboardGroup/);
  assert.match(legacy, /leaderboardEducationGroup\(currentUserData\?\.profile\?\.educationLevel\)/);
  assert.match(legacy, /leaderboardEducationGroup\(entry\.data\(\)\.profile\?\.educationLevel\) === group/);
  assert.match(legacy, /orderBy\('stats\.totalScore', 'desc'\)/);
  assert.match(legacy, /startAfter\(cursor\)/);
});

test('without grade the player is invited to settings, with no unrelated group shown', () => {
  assert.match(legacy, /if \(!group\) \{/);
  assert.match(legacy, /id="leaderboard-set-grade"/);
  assert.match(five, /id="five-set-grade"/);
  assert.match(five, /function currentGroup\(\)/);
});

test('Alliance entry with missing education level still offers a clickable settings redirect', () => {
  assert.match(legacy, /pageId === 'page-social' && window\.promptXiuxianEducationLevel\(\)/);
  assert.match(legacy, /id="xep-go"/);
  assert.match(legacy, /window\.switchToPage\('page-settings'\)/);
  assert.match(progress, /window\.promptXiuxianEducationLevel\?\.\(\)/);
});

test('two scoped Five Immortals sets, with score and grade verified before writing', () => {
  assert.equal(cleanup.TRIBULATION_SCORE,1268);
  assert.equal(cleanup.seatId('elementary','ru-xian'),'elementary__ru-xian');
  assert.equal(cleanup.seatId('junior','ru-xian'),'junior__ru-xian');
  assert.match(five,/seatId\(cohort, item\.id\)/);
  assert.match(five,/seatId\(cohort, role\.id\)/);
  assert.match(five,/latestUser\.stats\?\.totalScore[\s\S]*TRIBULATION_SCORE/);
  assert.match(five,/latestUser\.profile\?\.educationLevel\) !== cohort/);
  assert.match(five,/fs\.where\('cohort', '==', cohort\)/);
  assert.match(five,/const ELEMENTARY_QUIZ_LEVEL = '國小高年級'/);
  assert.match(read('server.js'), /registerImmortalsCleanupApi\(app\)/);
});

test('historical shared seats migrate to the correct cohort and ineligible seats are removed', async () => {
  const rows = new Map([
    ['ru-xian',{uid:'valid', challengeScore:8}],
    ['fa-xian',{uid:'low'}],
    ['suan-xian',{uid:'missing'}],
    ['junior__wai-xian',{uid:'other',cohort:'junior',challengeScore:3}],
    ['elementary__xuan-xian',{uid:'other',cohort:'elementary'}],
    ['unrelated',{uid:'low'}]
  ]);
  const users = new Map([
    ['valid',{stats:{totalScore:1268},profile:{educationLevel:'國中一年級'}}],
    ['other',{stats:{totalScore:9000},profile:{educationLevel:'國中三年級'}}],
    ['low',{stats:{totalScore:1267},profile:{educationLevel:'國小高年級'}}]
  ]);
  const db = {
    collection(name) { return {
      doc(id) {return {name,id}},
      get:async() => ({docs:[...rows].map(([id,data])=>({id,ref:{name,id},data:()=>data}))})
    } },
    async runTransaction(fn) {
      return fn({
        async get(ref) {
          const data=ref.name==='users'?users.get(ref.id):rows.get(ref.id);
          return {ref,exists:data!==undefined,data:()=>data};
        },
        delete(ref) {rows.delete(ref.id)},
        set(ref,data) {rows.set(ref.id,data)}
      });
    }
  };
  assert.equal(cleanup.invalidSeat({uid:'valid'},users.get('valid')),false);
  assert.equal(cleanup.invalidSeat({uid:'valid'},users.get('valid'),'elementary__ru-xian'),true);
  assert.equal(await cleanup.pruneInvalidSeats(db),4);
  assert.equal(rows.get('junior__ru-xian')?.uid,'valid');
  assert.equal(rows.get('junior__ru-xian')?.cohort,'junior');
  assert.equal(rows.get('junior__wai-xian')?.uid,'other');
  assert.deepEqual([...rows.keys()].sort(),['junior__ru-xian','junior__wai-xian','unrelated'].sort());
});

test('pruning requires a verified bearer token', async () => {
  const handler=cleanup.createHandler({resolve:()=>{throw new Error('must not touch data')},logger:{warn(){}}});
  let status=0,payload;
  const res={set(){},status(code){status=code;return this},json(body){payload=body;return body}};
  await handler({get:()=>''},res);
  assert.equal(status,401);
  assert.equal(payload.ok,false);
});
