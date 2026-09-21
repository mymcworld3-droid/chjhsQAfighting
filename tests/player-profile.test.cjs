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
  vm.runInNewContext(source.slice(from,to)+'\nthis.profile={projectProfile,profileMarkup,safeImage};', context);
  return context.profile;
}

test('ranking, friends and chat avatars and names open the same UID-backed read-only profile', () => {
  assert.match(legacy,/data-xiuxian-profile="\$\{escapeHtml\(doc\.id\)\}"/);
  assert.match(legacy,/data-xiuxian-profile="\$\{escapeHtml\(d\.id\)\}"/);
  assert.match(legacy,/const chatProfile = msg\.uid \?/);
  assert.match(legacy,/class="xpp-profile-trigger" \$\{chatProfile\}/);
  assert.match(source, /document\.addEventListener\('click'/);
  assert.match(source, /openPlayerProfileByUid\(button\.dataset\.xiuxianProfile/);
  assert.match(source, /getDoc\(doc\(getFirestore\(getApp\(\)\), 'users', uid\)\)/);
  assert.match(source, /\+\+requestToken/);
  assert.match(main,/cultivation\/combat-power\.js'[\s\S]*cultivation\/player-profile\.js'/);
});

test('remote equipped Golden Core, quality, four equipped artifacts and total accuracy appear in public projection', () => {
  const {projectProfile, profileMarkup} = profileModule();
  const raw = {
    displayName:'道友',
    equipped:{avatar:'assets/avatar.png'},
    stats:{totalScore:45,totalCorrect:7,totalAnswered:10,attack:200,maxHp:1000},
    cultivationTraining:{core:{type:'sword',grade:1}, equippedCore:{type:'taichu',grade:3}},
    artifactSystem:{equipped:{'本命法寶':'sword','護身法寶':'missing'},inventory:{sword:1,missing:0}}
  };
  const p=projectProfile('other-user',raw,false);
  assert.equal(p.name,'道友');
  assert.equal(p.accuracy,'70.0%');
  assert.equal(p.core.grade,3,'use attuned core not washed candidate');
  assert.equal(p.power.core,16000);
  assert.equal(p.power.equipment,900);
  assert.equal(p.power.total,17500);
  assert.equal(p.slots.length,4);
  assert.equal(p.slots[0].item.name,'測試仙劍');
  assert.equal(p.slots[1].item,null);
  const html=profileMarkup(p);
  assert.match(html,/太初回元丹/);
  assert.match(html,/70\.0%/);
  assert.match(html,/17,500/);
  assert.match(html,/測試仙劍/);
  assert.match(html,/尚未裝備/);
  assert.doesNotMatch(html,/sword.*grade:1/);
});

test('no answers and no equipped Golden Core show accurate empty states', () => {
  const {projectProfile, profileMarkup}=profileModule();
  const p=projectProfile('uid',{stats:{totalScore:15,totalAnswered:0,totalCorrect:0}},false);
  assert.equal(p.accuracy,'尚無紀錄');
  assert.equal(p.core,null);
  assert.equal(p.power.core,0);
  assert.match(profileMarkup(p),/目前沒有調御中的本命金丹/);
  assert.equal(p.slots.every(x=>x.item===null),true);
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
  assert.equal(profile.realm,'登仙');
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
