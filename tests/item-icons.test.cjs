'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Icons=require('../public/cultivation/item-icons.js'),Pool=require('../public/cultivation/soulbound-pool.js');
const root=path.join(__dirname,'../public');
function loadCatalog(name,injected,names){
  const source=fs.readFileSync(path.join(root,'cultivation',name),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
  const context=vm.createContext({...injected,QAItemIcons:Icons,QASoulboundPool:Pool});
  vm.runInContext(source+'\nglobalThis.result={'+names.join(',')+'};',context);return context.result;
}
test('every built-in item has a valid local image, including legacy artifacts and every soulbound realm',()=>{
  const artifacts=loadCatalog('artifact-catalog.js',{},['ARTIFACT_CATALOG','ARTIFACT_REALMS','getArtifactById']);
  const materials=loadCatalog('material-catalog.js',artifacts,['MATERIAL_CATALOG','RAID_REFINEMENT_KEYS']);
  const rows=[...artifacts.ARTIFACT_CATALOG,...materials.MATERIAL_CATALOG,...Object.values(Icons.catalog)];
  for(const item of rows){
    assert.match(item.imageUrl,/^\/assets\/.*\.webp$/,item.id);
    assert(fs.existsSync(path.join(root,item.imageUrl)),item.id+' missing image');
  }
  const ii=materials.MATERIAL_CATALOG.find(x=>x.id==='raid-refine-key-ii'),iii=materials.MATERIAL_CATALOG.find(x=>x.id==='raid-refine-key-iii');
  assert.equal(ii.name,'二階升級石');assert.equal(iii.name,'三階升級石');assert.notEqual(ii.imageUrl,iii.imageUrl);
  assert.equal(materials.RAID_REFINEMENT_KEYS[2],ii.id);assert.equal(materials.RAID_REFINEMENT_KEYS[3],iii.id);
});
test('all new artwork is compact WebP with distinct contents',()=>{
  const hashes=new Set();let bytes=0;
  for(const item of Object.values(Icons.catalog)){
    const data=fs.readFileSync(path.join(root,item.imageUrl));
    assert.equal(data.toString('ascii',0,4),'RIFF');assert.equal(data.toString('ascii',8,12),'WEBP');
    assert(data.length<60000,item.id+' exceeds icon budget');bytes+=data.length;
    hashes.add(require('node:crypto').createHash('sha256').update(data).digest('hex'));
  }
  assert.equal(hashes.size,Object.keys(Icons.catalog).length);assert(bytes<1000000);
});
test('shared resource aliases distinguish essence, forge fragments and both tickets',()=>{
  assert.equal(Icons.url('raidTickets'),Icons.url('raid-ticket'));
  assert.equal(Icons.url('drawTickets'),Icons.url('draw-ticket'));
  assert.equal(Icons.url('fragments'),Icons.url('nascent-soul-essence'));
  assert.equal(Icons.url('forgeFragments'),Icons.url('forge-fragment'));
  assert.notEqual(Icons.url('fragments'),Icons.url('forgeFragments'));
  assert.notEqual(Icons.url('raidTickets'),Icons.url('drawTickets'));
});
test('image lookup preserves legitimate existing art and cannot turn unknown IDs or unsafe URLs into executable markup',()=>{
  assert.equal(Icons.url({id:'gold',imageUrl:'https://example.test/custom.webp'}),'https://example.test/custom.webp');
  assert.equal(Icons.url({id:'gold',imageUrl:'javascript:alert(1)'}),Icons.url('gold'));
  for(const id of ['unknown-id','constructor','toString','__proto__'])assert.equal(Icons.url(id),Icons.url('treasure-pouch'));
  const markup=Icons.markup('gold',{size:1000000,alt:'" onerror="alert(1) <script>'});
  assert.match(markup,/width="128"/);assert(!markup.includes('<script>'));assert(!markup.includes('alt="" onerror='));
  assert.match(markup,/&quot;/);
});
