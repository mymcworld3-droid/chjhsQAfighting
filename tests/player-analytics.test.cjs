const test = require('node:test');
const assert = require('node:assert/strict');
const register = require('../player-analytics-api.cjs');
const { dayOf, plusDays, percent, buildReport, daysWith, recordEvent } = register.__test;

test('Taiwan calendar boundary and day addition are stable at midnight', () => {
  assert.equal(dayOf(new Date('2026-10-15T16:05:00Z')), '2026-10-16');
  assert.equal(dayOf(new Date('2026-10-15T15:59:59Z')), '2026-10-15');
  assert.equal(plusDays('2026-10-16', -7), '2026-10-09');
  assert.equal(percent(0, 0), null);
  assert.equal(percent(1, 3), 33.3);
});
test('90-day activity list is unique and sorted', () => {
  const days = daysWith(['2026-01-01', '2026-10-16', '2026-10-15'], '2026-10-16');
  assert.deepEqual(days, ['2026-10-15', '2026-10-16']);
});
test('fixed matured D1 and D7 cohorts exclude too-recent players', () => {
  const now = new Date('2026-10-16T04:00:00Z');
  const players = [
    { uid: 'a', firstDay: '2026-10-15', cohortEligible: true, firstQuestionAt: new Date('2026-10-15T04:00:00Z'), firstThreeAt: new Date('2026-10-15T06:00:00Z'), seenDays: ['2026-10-15','2026-10-16'], socialDays: ['2026-10-15'] },
    { uid: 'b', firstDay: '2026-10-09', cohortEligible: true, firstQuestionAt: now, seenDays: ['2026-10-09','2026-10-16'], socialDays: [] },
    { uid: 'c', firstDay: '2026-10-16', cohortEligible: true, firstQuestionAt: now, seenDays: ['2026-10-16'], socialDays: [] },
    { uid: 'd', firstDay: '2026-10-14', cohortEligible: true, seenDays: ['2026-10-14'], socialDays: [] },
    { uid: 'old', firstDay: '2026-10-09', cohortEligible: false, seenDays: ['2026-10-09', '2026-10-16'] }
  ];
  const daily = [
    { uid: 'a', day: '2026-10-16', answers: 2, starts: 2, social: 1, loadFailures: 1, soloAnswers: 1, raidAnswers: 1, appLoads: 1, appFailures: 1 },
    { uid: 'b', day: '2026-10-16', answers: 3, starts: 1, social: 0, loadFailures: 0, duelAnswers: 3, appLoads: 1 }
  ];
  const report = buildReport({
    visitors: [{firstDay:'2026-10-16',started:true,firstStartDay:'2026-10-16'}, {firstDay:'2026-10-15',started:false,firstStartDay:null}],
    players, days:daily, events:[], now, range:7, truncated:false
  });
  assert.deepEqual(report.visitors, { total:2, started:1, rate:50 });
  assert.deepEqual(report.firstThree, { completed:1, started:1, rate:100 });
  assert.deepEqual(report.d1, { returned:1, eligible:3, rate:33.3 });
  assert.deepEqual(report.d7, { returned:1, eligible:1, rate:100 });
  assert.deepEqual(report.weekly, { answers:5, active:2, solo:1, raid:1, duel:3, meditation:0 });
  assert.deepEqual({ participants:report.social.participants, rate:report.social.rate }, { participants:1, rate:50 });
  assert.deepEqual(report.loading, { success:3, failed:1, rate:25, appLoads:2, appFailures:1, appRate:50 });
  assert.equal(report.social.cohortD1Social.rate, 100);
  assert.equal(report.social.cohortD1Other.rate, 0);
});

function fakeFirestore() {
  const buckets = new Map();
  const access = (collection, id) => {
    if (!buckets.has(collection)) buckets.set(collection, new Map());
    const bucket = buckets.get(collection);
    return { bucket, id,
      async get() { return snap(bucket.get(id)); }
    };
  };
  const snap = data => ({ exists: !!data, data: () => structuredClone(data) });
  const db = {
    collection(name) { return { doc(id) { return access(name, id); } }; },
    async runTransaction(fn) {
      const tx = {
        get(ref) { return ref.get(); },
        set(ref, data, opts) { ref.bucket.set(ref.id, opts?.merge ? { ...ref.bucket.get(ref.id), ...data } : data); },
        update(ref, data) { ref.bucket.set(ref.id, { ...ref.bucket.get(ref.id), ...data }); },
        create(ref, data) { if (ref.bucket.has(ref.id)) throw Error('already exists'); ref.bucket.set(ref.id, data); }
      };
      return fn(tx);
    }
  };
  return { db, buckets };
}
test('event retries with identical id are deduplicated and skip never counts', async () => {
  const { db, buckets } = fakeFirestore();
  const a = { auth: { async getUser() { return { metadata: { creationTime: '2026-10-16T00:00:00Z' } }; } } };
  const now = new Date('2026-10-16T10:00:00Z');
  const params = [db, a, 'uid1', 'a'.repeat(32), { type:'answer_completed',mode:'solo',eventId:'question123' }, '2026-10-16', now];
  assert.deepEqual(await recordEvent(...params), { duplicate:false });
  assert.deepEqual(await recordEvent(...params), { duplicate:true });
  const daily = [...buckets.get('playerAnalyticsDaily').values()][0];
  assert.equal(daily.answers, 1);
  const player = buckets.get('playerAnalyticsPlayers').get('uid1');
  assert.equal(player.totalAnswers, 1);
  assert.ok(player.firstQuestionAt); // successful answer also implies a loaded question
  assert.equal(buckets.get('playerAnalyticsEvents').size, 1);
});
test('admin report rejects non-admin tokens and missing tokens', async () => {
  const routes = new Map();
  const db = { collection(name) {
    assert.equal(name, 'users');
    return { doc() { return { async get() { return { data:()=>({ isAdmin:false }) }; } }; } };
  } };
  const a = { db, auth: { async verifyIdToken() {
    return { uid:'uid123', aud:'question-learning', iss:'https://securetoken.google.com/question-learning' };
  } } };
  register({ post(path, handler) { routes.set(path, handler); } }, { resolve:()=>a, logger:{ error(){} } });
  async function request(token) {
    const result = { code:200, payload:null,
      set(){}, status(n){ this.code=n; return this; }, json(v){ this.payload=v; return this; }
    };
    await routes.get('/api/admin/player-analytics')({
      get(name) { return name === 'authorization' ? token : ''; },
      body:{ range:7 }
    }, result);
    return result;
  }
  assert.equal((await request('')).code, 401);
  assert.equal((await request('Bearer fake-token')).code, 403);
});
