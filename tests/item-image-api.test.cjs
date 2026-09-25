const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const {
  MODEL,
  PROMPT_VERSION,
  buildItemImagePrompt,
  generateFluxImage
} = require('../item-image-api.cjs');

test('item image API uses Cloudflare FLUX Schnell with a fixed xianxia prompt', () => {
  assert.equal(MODEL, '@cf/black-forest-labs/flux-1-schnell');
  assert.equal(PROMPT_VERSION, 'xianxia-item-icon-v1');
  const material = buildItemImagePrompt('material', {
    name: '玄鐵',
    realm: '築基',
    category: '礦石',
    description: '沉重黑色礦石'
  });
  assert.match(material, /1:1 square inventory item image/);
  assert.match(material, /crafting MATERIAL/);
  assert.match(material, /rounded or clustered silhouette/);
  assert.match(material, /no text/i);

  const artifact = buildItemImagePrompt('artifact', {
    name: '青雲劍',
    realm: '金丹',
    category: '裝備法寶',
    weaponForm: '劍',
    effects: [{ type: 'equip_attack_flat', value: 80 }]
  });
  assert.match(artifact, /finished magical ARTIFACT/);
  assert.match(artifact, /Canonical artifact form: 劍/);
  assert.match(artifact, /equip_attack_flat 80/);
  assert.match(artifact, /exactly one complete artifact/);
});

test('Cloudflare image response keeps base64 intact and uses four steps', async () => {
  let request = null;
  const fakeFetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, result: { image: 'YWJj\nZA==' } })
    };
  };
  const result = await generateFluxImage('test prompt', {
    env: { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'secret' },
    fetchImpl: fakeFetch,
    timeoutMs: 200
  });
  assert.equal(result.base64, 'YWJjZA==');
  assert.match(request.url, /accounts\/acct\/ai\/run\/@cf\/black-forest-labs\/flux-1-schnell$/);
  assert.equal(request.options.headers.Authorization, 'Bearer secret');
  const body = JSON.parse(request.options.body);
  assert.equal(body.prompt, 'test prompt');
  assert.equal(body.steps, 4);
});

test('server and clients wire secure backfill and automatic generated-artifact images', () => {
  const server = read('server.js');
  const main = read('public/main.js');
  const admin = read('public/cultivation/admin-item-image-manager.js');
  const refinery = read('public/cultivation/refinery-ai-jobs.js');
  const artifactCatalog = read('public/cultivation/artifact-catalog.js');
  const materialCatalog = read('public/cultivation/material-catalog.js');
  assert.match(server, /registerItemImageApi\(app\)/);
  assert.match(main, /admin-item-image-manager\.js/);
  assert.match(admin, /補圖/);
  assert.match(admin, /Authorization: 'Bearer ' \+ token/);
  assert.match(refinery, /\/api\/item-image\/ensure-artifact/);
  assert.match(refinery, /if \(firstDiscovery && awardedId\)/);
  assert.match(artifactCatalog, /imageUrl/);
  assert.match(materialCatalog, /imageUrl/);
});

test('major inventory surfaces render generated images with icon fallback', () => {
  const bag = read('public/cultivation/unified-inventory-grid.js');
  const refinery = read('public/cultivation/cultivation-refinery-v2.js');
  const materials = read('public/cultivation/material-system.js');
  assert.match(bag, /function imageMarkup\(/);
  assert.match(bag, /imageUrl: item\?\.imageUrl \|\| ''/);
  assert.match(bag, /uib-icon img/);
  assert.match(refinery, /function itemImageMarkup\(/);
  assert.match(refinery, /m\.imageUrl \|\| ''/);
  assert.match(refinery, /refinery-mat-icon img/);
  assert.match(materials, /function itemImageMarkup\(/);
  assert.match(materials, /item\.imageUrl \|\| ''/);
  assert.match(materials, /material-store-icon img/);
});
