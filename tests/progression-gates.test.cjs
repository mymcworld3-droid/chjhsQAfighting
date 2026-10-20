const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const readRoot = name => readFileSync(join(__dirname, '../public', name), 'utf8');
const read = name => readFileSync(join(__dirname, '../public/cultivation', name), 'utf8');

const main = readRoot('main.js');
const theme = read('cultivation-theme.js');
const liveSync = read('xiuxian-live-sync.js');
const breakthrough = read('realm-breakthrough-feedback.js');
const progression = read('cultivation-progression-v2.js');
const inventory = read('cultivation-inventory.js');
const guard = read('golden-core-access-guard.js');
const foundationTraining = read('foundation-training-page.js');
const training = read('cultivation-training-v4.js');
const combat = read('cultivation-combat-stats.js');
const statusPanel = read('cultivation-status-panel.js');
const visual = read('cultivation-core-visual.js');
const equipWarning = read('cultivation-core-equip-warning.js');
const battleEffects = read('golden-core-battle-effects.js');
const legacy = readRoot('main-legacy.js');
const index = readRoot('index.html');
const startupScenes = ['loading-landscape-ai.webp', 'loading-portrait-ai.webp'].map(name =>
  readFileSync(join(__dirname, '../public/assets/scenes', name)));

test('login core is isolated from optional cultivation module failures', () => {
  const staticImports = main.match(/^import\s+['"][^'"]+['"];$/gm) || [];
  assert.deepEqual(staticImports, ["import './main-legacy.js?v=20261013-arrival1';", "import './cultivation/dongtian-entry.js';"]);
  const dongtianEntry = read('dongtian-entry.js');
  assert.doesNotMatch(dongtianEntry, /firebasejs|firebase-firestore|getFirestore|getAuth/);
  assert.match(main, /const XIUXIAN_FEATURE_MODULES = \[/);
  assert.match(main, /await import\(\`\$\{modulePath\}\?v=\$\{XIUXIAN_FEATURE_BUILD\}\`\)/);
  assert.match(main, /Failed to load optional module/);
  assert.match(main, /\.\/cultivation\/cultivation-theme\.js/);
});

test('Status opens at account creation, Foundation features at 6, Golden Core at 28', () => {
  assert.match(progression, /const FOUNDATION_SCORE = 6;/);
  assert.match(progression, /const GOLDEN_CORE_SCORE = 28;/);
  assert.match(guard, /const FOUNDATION_SCORE = 6;/);
  assert.match(guard, /const GOLDEN_CORE_SCORE = 28;/);
  assert.match(guard, /return !!data\(\)\?\.stats;/);
  assert.match(guard, /html:not\(\.training-access-ready\) #nav-training/);
  assert.doesNotMatch(guard, /html:not\(\.golden-core-access-ready\) #training-status-tab/);
  assert.doesNotMatch(readRoot('index.html'), /html:not\(\.golden-core-access-ready\) #training-status-tab/);
  assert.match(guard, /migrationReady\(\) && \(score\(\) >= GOLDEN_CORE_SCORE \|\| window\.getTrainingAccessScore\?\.\(\) >= GOLDEN_CORE_SCORE\)/);
  assert.match(guard, /\[data-training-tab="core"\]/);
  assert.match(statusPanel, /function ensureInitialStatusShell\(\)/);
  assert.match(statusPanel, /window\.isFoundationTrainingStage\?\.\(\) \|\| window\.isGoldenCoreUnlocked\?\.\(\)/);
  assert.match(statusPanel, /className = 'page-section hidden px-4 training-page training-page-v3 initial-status-page'/);
  assert.match(statusPanel, /if \(initialShell && button && !statusActive\) activateStatus\(\)/);

  assert.match(foundationTraining, /const GOLDEN_CORE_SCORE = 28;/);
  assert.match(foundationTraining, /value >= FOUNDATION_SCORE && value < GOLDEN_CORE_SCORE/);
  assert.doesNotMatch(foundationTraining, /return migrationReady\(\) && value >= FOUNDATION_SCORE/);
  assert.match(foundationTraining, /data-training-tab="bag"/);
  assert.match(foundationTraining, /data-training-tab="refinery"/);
  assert.match(foundationTraining, /if \(coreTab\) coreTab\.disabled = true/);
  assert.match(foundationTraining, /const preserveStatus = !!page\.querySelector\('#training-status-tab\.active'\)/);
  assert.match(foundationTraining, /if \(tabs && !tabs\.querySelector\('\[data-training-tab="bag"\]'\)\)/);

  const progressionIndex = main.indexOf("'./cultivation/cultivation-progression-v2.js'");
  const inventoryIndex = main.indexOf("'./cultivation/cultivation-inventory.js'");
  const guardIndex = main.indexOf("'./cultivation/golden-core-access-guard.js'");
  const foundationIndex = main.indexOf("'./cultivation/foundation-training-page.js'");
  const trainingIndex = main.indexOf("'./cultivation/cultivation-training-v4.js'");
  assert.ok(progressionIndex >= 0 && inventoryIndex > progressionIndex && guardIndex > inventoryIndex && foundationIndex > guardIndex && trainingIndex > foundationIndex,
    'migration, shared inventory, guard, Foundation page and full Golden Core UI load in order');
});

test('Golden Core UI and effects remain gated behind migration and 28 cultivation', () => {
  assert.match(training, /const GOLDEN_CORE_SCORE = 28;/);
  assert.match(guard, /function coreAllowed\(\)/);
  assert.match(guard, /if \(!coreAllowed\(\)\)/);
  assert.match(guard, /resolveGoldenCoreCultivationReward/);
  assert.match(guard, /getGoldenCoreState/);
  assert.match(guard, /if \(!coreAllowed\(\)\) return null;/);
});

test('compensation inventory rendering is idempotent and cannot self-trigger forever', () => {
  assert.match(progression, /const signature = `\$\{count\}:\$\{pillBusy \? 1 : 0\}`;/);
  assert.match(progression, /existing\?\.dataset\.signature === signature/);
  assert.match(progression, /card\.dataset\.signature = signature/);
});

test('revival pill is a cultivation backpack consumable, not a Golden Core', () => {
  assert.match(inventory, /const PILL_FIELD = 'revivalPills';/);
  assert.match(inventory, /const PILL_GAIN = 100;/);
  assert.match(inventory, /type:\s*'consumable'/);
  assert.match(inventory, /cultivationGain:\s*PILL_GAIN/);
  assert.doesNotMatch(inventory, /training-tab-content|data-training-tab="bag"/);
  assert.match(inventory, /window\.getCultivationInventoryItems/);
  assert.match(inventory, /'stats\.totalScore': newScore/);
  assert.match(inventory, /`stats\.\$\{PILL_FIELD\}`/);
  assert.match(progression, /修煉 → 背包/);
  assert.match(inventory, /window\.useRevivalPillItem = useRevivalPill/);
  assert.match(main, /cultivation\/cultivation-inventory\.js/);
  assert.doesNotMatch(inventory, /getGoldenCoreState/);
  assert.doesNotMatch(inventory, /cultivationTraining/);
});

test('multiplayer unlock remains Foundation Establishment at 6 cultivation', () => {
  assert.match(progression, /score\(\) < FOUNDATION_SCORE/);
  assert.match(progression, /startBattleMatchmaking/);
  assert.match(progression, /btn-social-nav/);
  assert.match(progression, /接受鬥法邀請/);
});

test('post-Golden-Core realm curve is consistent across active realm renderers', () => {
  const expected = [
    ['金丹', 28], ['元嬰', 68], ['化神', 188], ['煉虛', 428],
    ['合體', 788], ['渡劫', 1268], ['半仙', 1868], ['真仙', 1868]
  ];
  for (const source of [theme, liveSync, breakthrough]) {
    for (const [name, need] of expected) {
      assert.match(source, new RegExp(`name: '${name}'.*need: ${need}`), `${name} threshold ${need} is synchronized`);
    }
  }
  assert.match(training, /const REALM_THRESHOLDS = \[68, 188, 428, 788, 1268, 1868\];/);
});

test('legacy compensation formula and item are preserved', () => {
  assert.match(progression, /const LEGACY_HIGH_REALM_SCORE = 150;/);
  assert.match(progression, /Math\.ceil\(\(deducted \/ 2\) \/ PILL_GAIN\)/);
  assert.match(progression, /Math\.round\(\(deducted \/ 2\) \* 2\)/);
  assert.match(progression, /回魂聚靈丹/);
  assert.match(progression, /PILL_GAIN = 100/);
  assert.match(progression, /'stats\.totalScore': FOUNDATION_SCORE/);
});



test('combat base remains attack and HP while status reports equipped artifact effects in descending order', () => {
  assert.match(combat, /attack: 200/);
  assert.match(combat, /hp: 1000/);
  assert.match(combat, /maxHp: 1000/);
  assert.doesNotMatch(combat, /defense:/);
  assert.doesNotMatch(combat, /speed:/);
  assert.doesNotMatch(combat, /critRate:/);
  assert.doesNotMatch(combat, /critDamage:/);
  assert.match(statusPanel, /攻擊力/);
  assert.match(statusPanel, /生命值/);
  assert.match(statusPanel, /鬥法開始時為滿血/);
  assert.match(statusPanel, /window\.getArtifactBattleSnapshot\?\.\(\)/);
  assert.match(statusPanel, /連擊率/);
  assert.match(statusPanel, /減傷/);
  assert.match(statusPanel, /暴擊率/);
  assert.match(statusPanel, /sortValue/);
  assert.doesNotMatch(statusPanel, /防禦力/);
});

test('Golden Core visual and lower-quality equip warning remain active', () => {
  assert.match(visual, /core-quality-supreme/);
  assert.match(visual, /core-quality-rays/);
  assert.match(visual, /core-rune-ring/);
  assert.match(visual, /core-quality-sparks/);
  assert.match(equipWarning, /金丹品質下降/);
  assert.match(equipWarning, /if \(newGrade <= oldGrade\) return;/);
  assert.match(main, /cultivation\/cultivation-core-visual\.js/);
  assert.match(main, /cultivation\/cultivation-core-equip-warning\.js/);
  assert.match(main, /cultivation\/cultivation-status-panel\.js/);
  assert.match(main, /cultivation\/realm-breakthrough-feedback\.js/);
});


test('Golden Core roster matches the nine current pills and battle effects', () => {
  for (const name of [
    '大海無垠丹', '太初回元丹', '凝心靜音丹', '破境衝仙丹', '星辰吞月丹',
    '無垢清心丹', '萬劫雷霆丹', '陰陽反轉丹', '破鋒劍心丹'
  ]) assert.match(training, new RegExp(name));
  for (const oldName of ['破境拆牆丹', '無垢摸魚丹', '雷公安眠丹', '倒反天罡丹']) {
    assert.doesNotMatch(training, new RegExp(oldName));
  }
  assert.match(training, /chanceByGrade\(grade, 10, 5, 50\)/);
  assert.match(training, /breakthroughPercent\(grade\)/);
  assert.match(training, /chanceByGrade\(grade, 20, 5, 60\)/);
  assert.match(training, /bonusGain: 3/);
  assert.match(statusPanel, /sword: \{ icon: '⚔', tone: 'silver' \}/);
  assert.match(battleEffects, /extraDamage: 100/);
  assert.match(battleEffects, /extraDamage: 200/);
  assert.match(battleEffects, /答對蓄雷（60%），本回合反擊傷害 \+50%/);
  assert.match(battleEffects, /reflectDamage: reflected/);
  assert.match(main, /cultivation\/golden-core-battle-effects\.js/);
  assert.match(legacy, /goldenCore: window\.getEquippedGoldenCoreBattleSnapshot/);
  assert.match(legacy, /resolveGoldenCoreBattleAttack/);
  assert.match(legacy, /resolveGoldenCoreBattleCounter/);
});


test('game waits for every feature script before revealing the playable UI', () => {
  assert.match(main, /window\.waitForXiuxianFeatures = \(\) => xiuxianFeatureGate/);
  assert.match(main, /xiuxian:feature-load-progress/);
  assert.match(main, /if \(failures\.length\)/);
  assert.match(main, /window\.__xiuxianFeaturesReady = true/);
  assert.match(main, /new CustomEvent\('xiuxian:user-ready'\)/);
  assert.match(main, /xiuxian:user-data-ready/);

  assert.match(legacy, /function showGameStartupGate/);
  assert.match(legacy, /function waitForAllGameScripts/);
  assert.match(legacy, /window\.dispatchEvent\(new CustomEvent\('xiuxian:user-data-ready'\)\)/);
  assert.match(legacy, /featureGateResult = await waitForAllGameScripts\(\)/);
  assert.match(legacy, /if \(!featureGateResult\?\.ok\)/);
  assert.match(legacy, /hideGameStartupGate\(\)/);

  const waitPos = legacy.indexOf('featureGateResult = await waitForAllGameScripts()');
  const cloudEnterPos = legacy.indexOf('await enterHomeWithStartupCloudCurtain()', waitPos);
  const transitionFnPos = legacy.indexOf('async function enterHomeWithStartupCloudCurtain()');
  const revealPos = legacy.indexOf("document.getElementById('bottom-nav')?.classList.remove('hidden')", transitionFnPos);
  const homePos = legacy.indexOf("switchToPage('page-home')", transitionFnPos);
  assert.ok(waitPos >= 0 && cloudEnterPos > waitPos,
    'cloud transition is not entered until all feature modules finish loading');
  assert.ok(transitionFnPos >= 0 && revealPos > transitionFnPos && homePos > revealPos,
    'home and navigation are revealed only inside the covered cloud transition');
});


test('startup gate is a full-screen xianxia loading scene with real progress and rotating tips', () => {
  assert.match(legacy, /GAME_STARTUP_TIPS = \[/);
  assert.match(legacy, /width:100vw;height:100dvh/);
  assert.match(legacy, /assets\/scenes\/loading-landscape-ai\.webp/);
  assert.match(legacy, /<source media="\(orientation: portrait\)" srcset="assets\/scenes\/loading-portrait-ai\.webp"/);
  assert.match(legacy, /id="game-startup-gate-progress"/);
  assert.match(legacy, /id="game-startup-gate-percent"/);
  assert.match(legacy, /id="game-startup-gate-tip"/);
  assert.match(legacy, /function updateGameStartupProgress\(loaded = 0, total = 0\)/);
  assert.match(legacy, /Math\.round\(\(safeLoaded \/ safeTotal\) \* 100\)/);
  assert.match(legacy, /updateGameStartupProgress\(loaded, detail\.total\)/);
  assert.match(legacy, /修行小提示：/);
  assert.match(legacy, /洞天首次完整通關可獲得靈石/);
  assert.doesNotMatch(legacy, /第一煉|第二煉|第三煉|木材加工成木棍/);

  for (const scene of startupScenes) {
    assert.equal(scene.toString('ascii', 0, 4), 'RIFF');
    assert.equal(scene.toString('ascii', 8, 12), 'WEBP');
    assert.ok(scene.length > 1000, 'both loading orientations ship actual raster artwork');
  }
});


test('startup completion closes cloud banks before revealing home and opens them after home is ready', () => {
  assert.match(legacy, /id = 'startup-cloud-curtain'/);
  assert.match(legacy, /startup-cloud-left/);
  assert.match(legacy, /startup-cloud-right/);
  assert.match(legacy, /classList\.add\('is-closing'\)/);
  assert.match(legacy, /classList\.add\('is-closed'\)/);
  assert.match(legacy, /switchToPage\('page-home'\)/);
  assert.match(legacy, /classList\.add\('is-opening'\)/);
  assert.match(legacy, /await enterHomeWithStartupCloudCurtain\(\)/);
  assert.match(legacy, /xiuxian:startup-cloud-transition-completed/);

  const transitionStart = legacy.indexOf("curtain.classList.add('is-closing')");
  const coveredSwitch = legacy.indexOf('await onClosed()', transitionStart);
  const transitionOpen = legacy.indexOf("curtain.classList.add('is-opening')", transitionStart);
  assert.ok(transitionStart >= 0 && coveredSwitch > transitionStart && transitionOpen > coveredSwitch,
    'clouds close first, home is mounted while covered, then clouds open');
  assert.match(legacy, /enterHomeWithStartupCloudCurtain\(\)[\s\S]*?await playStartupCloudCurtain\(\(\) =>/);
});

test('startup cloud curtain uses two full-screen overlapping PNG layers and preloads them early', () => {
  assert.match(index, /rel="preload" as="image" href="assets\/cloud-left\.png" fetchpriority="high"/);
  assert.match(index, /rel="preload" as="image" href="assets\/cloud-right\.png" fetchpriority="high"/);
  assert.match(legacy, /STARTUP_CLOUD_ASSETS = Object\.freeze/);
  assert.match(legacy, /preloadStartupCloudImages\(\)/);
  assert.match(legacy, /image\.decode/);
  assert.match(legacy, /fetchPriority = 'high'/);
  assert.match(legacy, /waitForStartupCloudTransform/);
  assert.match(legacy, /transitionend/);
  assert.match(legacy, /object-fit:cover;object-position:center/);
  assert.doesNotMatch(legacy, /object-fit:fill/);
  assert.match(legacy, /#startup-cloud-curtain \.startup-cloud-half\{[\s\S]*?position:absolute;inset:0;width:100vw;height:100dvh/);
  assert.match(legacy, /startup-cloud-left\{\s*transform:translate3d\(-102vw,0,0\)/);
  assert.match(legacy, /startup-cloud-right\{\s*transform:translate3d\(102vw,0,0\)/);
  assert.match(legacy, /is-closed \.startup-cloud-left\{[\s\S]*?translate3d\(0,0,0\)/);
  assert.match(legacy, /is-closed \.startup-cloud-right\{[\s\S]*?translate3d\(0,0,0\)/);
  assert.match(legacy, /startup-cloud-mist\{[\s\S]*?opacity:0/);
  assert.match(legacy, /is-closed \.startup-cloud-mist\{opacity:\.96\}/);
  assert.match(legacy, /classList\.add\('has-image'\)/);
  assert.match(legacy, /image\.addEventListener\('error', markMissing/);
});

test('startup progress section is horizontally centered on the viewport', () => {
  assert.match(legacy, /\.game-startup-copy\{width:100%;max-width:760px;margin-left:auto;margin-right:auto/);
  assert.match(legacy, /\.game-startup-progress-wrap\{width:min\(720px,100%\);margin:clamp\(20px,3\.2vh,34px\) auto 0/);
});


test('grade and subject preferences are optional Dongfu settings, and navigation stays hidden during arrival', () => {
  const vm = require('node:vm');
  const source = legacy.slice(legacy.indexOf('function hasCompletedPlayerProfile('), legacy.indexOf('// --- 全域狀態變數 ---'));
  const nav = { classList: { remove() { this.visible = true; } } };
  const ctx = vm.createContext({ currentUserData: { stats: {}, profile: {} },
    auth: { currentUser: { uid: 'u' } }, window: {},
    document: { getElementById: id => id === 'bottom-nav' ? nav : null }
  });
  vm.runInContext(source, ctx);
  assert.equal(ctx.hasCompletedPlayerProfile(), true);
  ctx.ensureGameplayNavigationForReadyProfile();
  assert.equal(nav.classList.visible, true);
  nav.classList.visible = false;
  ctx.window.isFirstVisitActive = () => true;
  ctx.ensureGameplayNavigationForReadyProfile();
  assert.equal(nav.classList.visible, false);
  assert.doesNotMatch(legacy, /populateOnboardingInputs|submitOnboarding/);
});




test('Foundation refinery access does not depend on the legacy migration marker', () => {
  assert.match(foundationTraining, /築基期修煉頁：6～27 修為開放背包與煉器/);
  assert.match(foundationTraining, /return !!window\.getCurrentUserData\?\.\(\)\?\.stats[\s\S]*value >= FOUNDATION_SCORE && value < GOLDEN_CORE_SCORE/);
  assert.match(guard, /築基 6 開背包、煉器/);
  assert.doesNotMatch(guard, /function trainingAllowed\(\) \{\s*return migrationReady\(\)/);
  assert.match(guard, /function coreAllowed\(\) \{\s*return migrationReady\(\) && \(score\(\) >= GOLDEN_CORE_SCORE \|\| window\.getTrainingAccessScore\?\.\(\) >= GOLDEN_CORE_SCORE\)/);
});
