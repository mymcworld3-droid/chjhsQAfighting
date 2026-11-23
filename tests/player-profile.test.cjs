const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = pathName => fs.readFileSync(path.join(__dirname, '..', pathName), 'utf8');
const source = read('public/cultivation/player-profile.js');
const coreSource = read('public/cultivation/cultivation-training-v4.js');
const legacy = read('public/main-legacy.js');
const main = read('public/main.js');
const style = read('public/styles/player-profile.css');

function profileModule() {
  const from = source.indexOf('  function esc(value) {');
  const to = source.indexOf('  async function openPlayerProfileByUid(uid) {', from);
  assert.ok(from > 0 && to > from);
  const slots = ['本命法寶','護身法寶','佩飾法寶','輔助法寶'];
  const items = {
    sword: {id:'sword',name:'測試仙劍',realm:'元嬰',equipSlot:'本命法寶',effects:[{type:'equip_attack_flat',value:100}]}
  };
  const context = {
    window: {
      getGoldenCorePublicDetails: c => ({...c, name:'太初回元丹', effect:'每次悟道回元',equipped:true}),
      calculateCombatPower: ({core,equipped,inventory}) => {
        const corePower = core ? 4000+(9-core.grade)*2000 : 0;
        const equipment = equipped['本命法寶']==='sword'&&inventory.sword>0 ? 900:0;
        return {total:600+corePower+equipment,base:600,core:corePower,equipment,items:[]};
      },
      calculateArtifactPower: item => item?.id==='sword'?900:0
    },
    ARTIFACT_EQUIP_SLOTS:slots, getArtifactById: id=>items[id] || null,
    realmForScore: score=>({name:score>=868?'真仙':score>=28?'金丹':'築基'}),
    Number, String, Math, Set, Object
  };
  vm.runInNewContext(read('public/cultivation/profile-avatar.js').replace(/^export /gm, ''), context);
  vm.runInNewContext(source.slice(from,to)+'\nthis.profile={projectProfile,profileMarkup,safeImage};', context);
  return context.profile;
}

test('ranking, friends and chat avatars and names open the same UID-backed read-only profile', () => {
  assert.match(legacy,/data-xiuxian-profile="\$\{escapeHtml\(record\.id\)\}"/);
  assert.match(legacy,/data-xiuxian-profile="\$\{escapeHtml\(d\.id\)\}"/);
  assert.match(legacy,/const chatProfile = msg\.uid \?/);
  assert.match(legacy,/class="xpp-profile-trigger" \$\{chatProfile\}/);
  assert.match(source, /document\.addEventListener\('click'/);
  assert.match(source, /openPlayerProfileByUid\(button\.dataset\.xiuxianProfile/);
  assert.match(source, /getDoc\(doc\(getFirestore\(getApp\(\)\), 'users', uid\)\)/);
  assert.match(source, /\+\+requestToken/);
  assert.match(main,/cultivation\/combat-power\.js'[\s\S]*cultivation\/player-profile\.js'/);
});

test('public player profile ignores retired core, nascent and artifact data', () => {
  const {projectProfile, profileMarkup} = profileModule();
  const data = {
    displayName:'道友', stats:{totalScore:45,totalCorrect:7,totalAnswered:10,attack:200,maxHp:1000},
    cultivationTraining:{equippedCore:{type:'taichu',grade:3}},
    artifactSystem:{equipped:{'本命法寶':'sword'},inventory:{sword:1}}
  };
  const profile=projectProfile('other-user',data,false);
  assert.equal(profile.name,'道友');
  assert.equal(profile.accuracy,'70.0%');
  assert.equal(profile.combat.attack,200);
  assert.equal(profile.combat.maxHp,1000);
  const html=profileMarkup(profile);
  assert.match(html,/角色戰鬥數值/);
  assert.match(html,/70\\.0%/);
  assert.doesNotMatch(html,/太初回元丹|測試仙劍|已裝備法寶|本命金丹|綜合戰力/);
});

test('zero answers still shows no learning record without old core empty state', () => {
  const {projectProfile,profileMarkup}=profileModule();
  const p=projectProfile('uid',{stats:{totalScore:15,totalAnswered:0,totalCorrect:0}},false);
  assert.equal(p.accuracy,'尚無紀錄');
  assert.doesNotMatch(profileMarkup(p),/目前沒有調御中的本命金丹/);
});

test('player-generated names and effect text are escaped and private fields are not rendered', () => {
  const {projectProfile,profileMarkup,safeImage}=profileModule();
  const profile=projectProfile('other',{
    displayName:'<img src=x onerror=alert(1)>',
    email:'secret@example.com',
    friendCode:'SUPERSECRET',
    profile:{privateThing:'PRIVATESECRET'},
    equipped:{avatar:'javascript:alert(1)'},
    stats:{totalAnswered:1,totalCorrect:999,totalScore:900}
  },false);
  const html=profileMarkup(profile);
  assert.equal(profile.accuracy,'100.0%');
  assert.equal(profile.realm,'半仙');
  assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/<img src=x|secret@example|SUPERSECRET|PRIVATESECRET/);
  assert.equal(profile.avatar,'');
  assert.equal(safeImage('https://example.com/a.png'),'https://example.com/a.png');
  assert.equal(safeImage('data:text/html,x'),'');
  assert.equal(safeImage('//example.com/a.png'),'');
  assert.equal(safeImage('assets/a.png'),'assets/a.png');
  assert.match(source,/uid\.includes\('\/'\)/);
});

test('responsive dialog supports keyboard Escape, close button, loading and error feedback', () => {
  assert.match(source,/aria-modal="true"/);
  assert.match(source,/正在讀取修士資料/);
  assert.match(source,/無法讀取修士資料/);
  assert.match(source,/if \(event\.key === 'Escape'/);
  assert.match(style,/\.xpp-equipment\{display:grid/);
  assert.match(style,/@media\(max-width:500px\)/);
  assert.match(coreSource,/window\.getGoldenCorePublicDetails = function/);
});
