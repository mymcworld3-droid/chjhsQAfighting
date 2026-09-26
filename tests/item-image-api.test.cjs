const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const {
  MODEL,
  PROMPT_VERSION,
  buildItemImagePrompt,
  r2Config,
  signedR2PutRequest,
  uploadGeneratedImage,
  generateFluxImage
} = require('../item-image-api.cjs');

test('item image API uses Cloudflare FLUX Schnell with a fixed xianxia prompt', () => {
  assert.equal(MODEL, '@cf/black-forest-labs/flux-1-schnell');
  assert.equal(PROMPT_VERSION, 'xianxia-moba-item-icon-v2');
  const material = buildItemImagePrompt('material', {
    name: '玄鐵',
    realm: '築基',
    category: '礦石',
    description: '沉重黑色礦石'
  });
  assert.match(material, /1:1 square inventory icon/);
  assert.match(material, /crafting MATERIAL/);
  assert.match(material, /rounded or clustered silhouette/);
  assert.match(material, /text, letters, numbers/i);

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
  assert.match(artifact, /competitive MOBA equipment icon/);
  assert.match(artifact, /three-quarter angle/);
  assert.match(artifact, /78 to 86 percent/);
});

test('item image prompt stays within the Cloudflare model limit', () => {
  const prompt = buildItemImagePrompt('artifact', {
    name: '極長描述法寶',
    realm: '真仙',
    category: '裝備法寶',
    weaponForm: '劍',
    description: '甲'.repeat(2000),
    story: '乙'.repeat(2000),
    effects: [{ type: 'equip_attack_flat', value: 999 }]
  });
  assert.ok(prompt.length <= 2048);
});

test('R2 config reuses the Cloudflare account id but keeps separate S3 credentials', () => {
  const cfg = r2Config({
    CLOUDFLARE_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'test-key',
    R2_SECRET_ACCESS_KEY: 'test-value',
    R2_BUCKET_NAME: 'item-images',
    R2_PUBLIC_BASE_URL: 'https://pub-example.r2.dev/'
  });
  assert.equal(cfg.accountId, 'acct');
  assert.equal(cfg.accessKeyId, 'test-key');
  assert.equal(cfg.secretAccessKey, 'test-value');
  assert.equal(cfg.bucketName, 'item-images');
  assert.equal(cfg.publicBaseUrl, 'https://pub-example.r2.dev');
});

test('R2 upload signs a S3-compatible PUT and returns the permanent public URL', async () => {
  let request = null;
  const fakeFetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, text: async () => '' };
  };
  const result = await uploadGeneratedImage('artifact', 'seven-treasure-ruler', 'YWJj', {
    env: {
      CLOUDFLARE_ACCOUNT_ID: 'acct',
      R2_ACCESS_KEY_ID: 'test-key',
      R2_SECRET_ACCESS_KEY: 'test-value',
      R2_BUCKET_NAME: 'item-images',
      R2_PUBLIC_BASE_URL: 'https://pub-example.r2.dev'
    },
    fetchImpl: fakeFetch,
    now: () => new Date('2026-09-26T00:00:00.000Z')
  });
  assert.match(request.url, /^https:\/\/acct\.r2\.cloudflarestorage\.com\/item-images\/generated-items\/artifacts\/seven-treasure-ruler\//);
  assert.equal(request.options.method, 'PUT');
  assert.match(request.options.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=test-key\/20260926\/auto\/s3\/aws4_request,/);
  assert.equal(request.options.headers['Content-Type'], 'image/jpeg');
  assert.match(result.imageUrl, /^https:\/\/pub-example\.r2\.dev\/generated-items\/artifacts\/seven-treasure-ruler\//);
  assert.equal(result.bucketName, 'item-images');
});

test('R2 signer uses the auto region and S3 service', () => {
  const signed = signedR2PutRequest({
    accountId: 'acct',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-value',
    bucketName: 'bucket',
    key: 'generated-items/artifacts/a b.jpg',
    body: Buffer.from('abc'),
    now: new Date('2026-09-26T00:00:00.000Z')
  });
  assert.equal(signed.url, 'https://acct.r2.cloudflarestorage.com/bucket/generated-items/artifacts/a%20b.jpg');
  assert.match(signed.headers.Authorization, /20260926\/auto\/s3\/aws4_request/);
  assert.equal(signed.headers['x-amz-date'], '20260926T000000Z');
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
  assert.equal(Object.hasOwn(body, 'seed'), false);
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
