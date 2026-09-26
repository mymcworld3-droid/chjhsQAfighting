const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const configSource = readFileSync(join(__dirname, '../public/firebase-projects-config.js'), 'utf8');
const helperSource = readFileSync(join(__dirname, '../public/cultivation/firebase-projects.js'), 'utf8');
const legacySource = readFileSync(join(__dirname, '../public/main-legacy.js'), 'utf8');
const caveSource = readFileSync(join(__dirname, '../public/cultivation/dongtian.js'), 'utf8');
const battleSource = readFileSync(join(__dirname, '../public/cultivation/battle-mode-v2.js'), 'utf8');

function simulate(config = {}) {
  const apps = [{ name: '[DEFAULT]', options: { projectId: 'question-learning' } }];
  const mock = {
    initializeApp(options, name) {
      const app = { name, options };
      apps.push(app);
      return app;
    },
    getApp(name = '[DEFAULT]') {
      const app = apps.find(a => a.name === name);
      if (!app) throw new Error('app not initialized: ' + name);
      return app;
    },
    getApps() { return apps; },
    getAuth(app) { return { app, currentUser: null }; },
    getFirestore(app) { return { app }; }
  };
  const code = helperSource
    .replace(/^import .*?;\s*$/gm, '')
    .replace(/^export /gm, '') +
    '\nthis.getServices = getFirebaseProjectServices;' +
    '\nthis.getStatus = firebaseProjectStatus;';
  const ctx = vm.createContext({ ...mock, firebaseProjectConfigs: config, Object });
  vm.runInContext(code, ctx, { filename: 'firebase-projects.js' });
  return { ...ctx, apps };
}

test('secondary Firebase configuration supports filled BD and C Web SDK values without server secrets', () => {
  assert.match(configSource, /export const firebaseProjectConfigs/);
  assert.match(configSource, /BD:\s*\{/);
  assert.match(configSource, /C:\s*\{/);
  const config = vm.runInNewContext(
    configSource.replace(/^export\s+/m, '') + '\nfirebaseProjectConfigs',
  );
  for (const role of ['BD', 'C']) {
    for (const field of ['apiKey', 'authDomain', 'projectId', 'appId']) {
      assert.ok(typeof config[role][field] === 'string', role + '.' + field + ' should be editable');
    }
  }
  assert.notEqual(config.BD.projectId, config.C.projectId);
  assert.doesNotMatch(configSource, /-----BEGIN PRIVATE KEY-----|serviceAccount|client_secret/);
});

test('project helper does not initialize BD or C just by importing it', () => {
  const harness = simulate({ BD: {}, C: {} });
  assert.equal(harness.apps.length, 1);
  const status = harness.getStatus();
  assert.equal(status.A.configured, true);
  assert.equal(status.BD.configured, false);
  assert.equal(status.C.configured, false);
  assert.throws(() => harness.getServices('BD'), /尚未設定/);
  assert.equal(harness.apps.length, 1);
});

test('configured named apps remain distinct, reuse app instances, and have no auto login', () => {
  const options = projectId => ({
    apiKey: 'public-api', authDomain: projectId + '.firebaseapp.com',
    projectId, appId: '1:99:web:foo'
  });
  const harness = simulate({ BD: options('xiuxian-bd'), C: options('xiuxian-c') });
  const bd = harness.getServices('BD');
  assert.equal(bd.app.name, 'xiuxian-bd');
  assert.equal(bd.db.app.options.projectId, 'xiuxian-bd');
  assert.equal(bd.auth.currentUser, null);
  const c = harness.getServices('C');
  assert.equal(c.app.name, 'xiuxian-battle');
  assert.equal(c.db.app.options.projectId, 'xiuxian-c');
  assert.equal(harness.getServices('BD').app, bd.app);
  assert.equal(harness.getServices('A').app.name, '[DEFAULT]');
  assert.equal(harness.apps.length, 3);
});

test('helper rejects reusing one project ID across A, BD and C', () => {
  const options = projectId => ({
    apiKey: 'public-api', authDomain: projectId + '.firebaseapp.com',
    projectId, appId: '1:99:web:foo'
  });
  const duplicate = simulate({ BD: options('xiuxian-bd'), C: options('xiuxian-bd') });
  assert.throws(() => duplicate.getServices('BD'), /三個不同/);
  const sameAsMain = simulate({ BD: options('question-learning'), C: options('xiuxian-c') });
  assert.throws(() => sameAsMain.getServices('BD'), /三個不同/);
});

test('config scaffold leaves existing main authentication, cave and battle routing intact', () => {
  assert.match(legacySource, /const app = initializeApp\(firebaseConfig\)/);
  assert.match(caveSource, /const db = getFirestore\(getApp\(\)\)/);
  assert.match(battleSource, /function db\(\) \{ return getFirestore\(getApp\(\)\); \}/);
  assert.doesNotMatch(caveSource, /getFirebaseProjectServices\('BD'\)/);
  assert.doesNotMatch(battleSource, /getFirebaseProjectServices\('C'\)/);
});


test('secondary auth mutations are serialized so sign-in and sign-out cannot race', () => {
  assert.match(helperSource, /const secondaryAuthQueues = new Map\(\)/);
  assert.match(helperSource, /function queueSecondaryAuthOperation\(role, task\)/);
  assert.match(helperSource, /previous\.catch\(\(\) => \{\}\)\.then\(task\)/);
  assert.match(helperSource, /return queueSecondaryAuthOperation\(role, async \(\) => \{/);
  assert.match(helperSource, /if \(currentSecondaryUid\) await signOut\(services\.auth\)/);
  assert.match(helperSource, /await signInWithCustomToken\(services\.auth, payload\.tokens\[role\]\)/);
  assert.match(helperSource, /const latestMainUid = getAuth\(getApp\(\)\)\.currentUser\?\.uid \|\| ''/);
});

test('startup authenticates BD then C sequentially and does not use Promise.all for secondary auth', () => {
  const bd = "await ensureSecondaryFirebaseAuth('BD');";
  const c = "await ensureSecondaryFirebaseAuth('C');";
  assert.ok(legacySource.includes(bd));
  assert.ok(legacySource.includes(c));
  assert.ok(legacySource.indexOf(bd) < legacySource.indexOf(c));
  assert.doesNotMatch(
    legacySource,
    /Promise\.all\(\[\s*ensureSecondaryFirebaseAuth\('BD'\),\s*ensureSecondaryFirebaseAuth\('C'\)/s
  );
});
