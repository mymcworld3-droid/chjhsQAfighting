'use strict';

const { randomUUID, createHash, createHmac } = require('node:crypto');
const { adminProject, PROJECT_IDS } = require('./firebase-admin-projects.cjs');

const MODEL = '@cf/black-forest-labs/flux-1-schnell';
const PROMPT_VERSION = 'xianxia-moba-item-icon-v4';
const PROMPT_MAX = 2048;
const CONFIGS = Object.freeze({
  artifact: { doc: 'artifactCatalogV1', folder: 'artifacts' },
  material: { doc: 'materialCatalogV1', folder: 'materials' }
});
const IMAGE_FIELDS = Object.freeze([
  'imageUrl','imageStatus','imageModel','imagePromptVersion','imageStoragePath',
  'imageUpdatedAtMs','imageError','imageJobId'
]);

function clean(value, max = 240) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function finalizePrompt(parts) {
  return clean((Array.isArray(parts) ? parts : []).filter(Boolean).join(' '), PROMPT_MAX);
}

function itemKind(value) {
  const kind = String(value || '').toLowerCase();
  return Object.hasOwn(CONFIGS, kind) ? kind : '';
}

function imageConfig(env = process.env) {
  return {
    accountId: clean(env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID || env.CLOUDFLARE_AI_ACCOUNT_ID, 160),
    apiToken: clean(env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN || env.CLOUDFLARE_AI_TOKEN, 4096)
  };
}

function r2Config(env = process.env) {
  return {
    accountId: clean(env.R2_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID || env.CLOUDFLARE_AI_ACCOUNT_ID, 160),
    accessKeyId: clean(env.R2_ACCESS_KEY_ID, 512),
    secretAccessKey: clean(env.R2_SECRET_ACCESS_KEY, 4096),
    bucketName: clean(env.R2_BUCKET_NAME || env.R2_BUCKET, 160),
    publicBaseUrl: clean(env.R2_PUBLIC_BASE_URL || env.R2_PUBLIC_URL, 700).replace(/\/+$/, '')
  };
}

function sha256(value, encoding = 'hex') {
  return createHash('sha256').update(value).digest(encoding);
}

function hmac(key, value, encoding) {
  return createHmac('sha256', key).update(value).digest(encoding);
}

function encodeR2Key(key) {
  return String(key || '').split('/').map((part) => encodeURIComponent(part)).join('/');
}

function formatAmzDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function signedR2PutRequest({ accountId, accessKeyId, secretAccessKey, bucketName, key, body, now = new Date() }) {
  const encodedBucket = encodeURIComponent(bucketName);
  const encodedKey = encodeR2Key(key);
  const host = accountId + '.r2.cloudflarestorage.com';
  const url = 'https://' + host + '/' + encodedBucket + '/' + encodedKey;
  const payloadHash = sha256(body);
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const canonicalHeaders =
    'host:' + host + '\n' +
    'x-amz-content-sha256:' + payloadHash + '\n' +
    'x-amz-date:' + amzDate + '\n';
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'PUT',
    '/' + encodedBucket + '/' + encodedKey,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const scope = dateStamp + '/auto/s3/aws4_request';
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256(canonicalRequest)
  ].join('\n');
  const dateKey = hmac('AWS4' + secretAccessKey, dateStamp);
  const regionKey = hmac(dateKey, 'auto');
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = hmac(signingKey, stringToSign, 'hex');
  const authorization =
    'AWS4-HMAC-SHA256 Credential=' + accessKeyId + '/' + scope +
    ', SignedHeaders=' + signedHeaders +
    ', Signature=' + signature;

  return {
    url,
    headers: {
      Authorization: authorization,
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public,max-age=31536000,immutable',
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate
    }
  };
}
function effectSummary(item = {}) {
  return (Array.isArray(item.effects) ? item.effects : []).slice(0, 3).map((effect) => {
    const type = clean(effect?.type, 48);
    if (!type) return '';
    if (Number.isFinite(Number(effect?.value))) return type + ' ' + Number(effect.value);
    if (Number.isFinite(Number(effect?.multiplier))) return type + ' x' + Number(effect.multiplier);
    return type;
  }).filter(Boolean).join(', ');
}

function buildItemImagePrompt(kind, item = {}) {
  const name = clean(item.name || (kind === 'artifact' ? 'Unnamed magical artifact' : 'Unnamed crafting material'), 80);
  const realm = clean(item.realm || '凡人', 30);
  const category = clean(item.category || (kind === 'artifact' ? '法寶' : '材料'), 50);
  const description = clean(item.description || '', 420);
  const story = clean(item.story || '', 360);
  const weaponForm = clean(item.weaponForm || '', 40);
  const effects = effectSummary(item);

  const common = [
    'Create a 1:1 square fantasy MOBA equipment icon for a Chinese xianxia cultivation RPG.',
    'Match the visual language of polished competitive mobile MOBA item icons: one oversized item, saturated jewel-tone colors, strong blue purple or black background contrast, bright magical highlights, glossy metal and crystal rendering, painterly fantasy shading, crisp glowing edges, and immediate thumbnail readability.',
    'Show exactly one item. Make it large and dominant, filling about 82 to 92 percent of the square while remaining fully visible and uncropped.',
    'Use a simple dark navy, indigo, violet, or black gradient background with a localized aura directly behind the object. No environment and no scenery.',
    'The item must float by itself in the center. No table, altar, rack, stand, shelf, tray, platform, holder, pedestal, mount, display base, shadow-catching floor, or supporting object.',
    'Use strong directional highlights and a luminous edge glow so the object pops clearly from the dark background. Keep the background simple and the item visually dominant.',
    'Do not include text, letters, numbers, labels, watermark, logo, UI frame, inventory border, duplicated object, split panel, character, hand, or caption.'
  ];

  if (kind === 'material') {
    return finalizePrompt([
      ...common,
      'This is a crafting MATERIAL, not a finished weapon or magical artifact.',
      'Give the object a compact, naturally rounded or clustered silhouette suitable for a circular material slot.',
      'Make its physical substance unmistakable at small icon size: ore should read as ore, spirit wood as wood, crystal as crystal, beast material as organic material, talisman material as paper or fiber.',
      'Do not turn it into a sword, accessory, treasure chest, bottle, or finished equipment unless the category itself explicitly requires that form.',
      'Item name: ' + name + '.',
      'Cultivation realm: ' + realm + '.',
      'Material category: ' + category + '.',
      weaponForm ? 'Prepared weapon-form cue: ' + weaponForm + '.' : '',
      description ? 'Material description: ' + description + '.' : '',
      story ? 'Lore mood only, without literal text: ' + story + '.' : ''
    ]);
  }

  return finalizePrompt([
    ...common,
    'This is a finished magical ARTIFACT. Render it as a polished in-game equipment icon, not a product photograph and not a full illustration.',
    'Use a bold diagonal or three-quarter presentation when suitable, similar to high-end MOBA equipment icons: the main silhouette should be obvious within a fraction of a second.',
    'Use vivid saturated colors with one dominant magical color family and bright complementary highlights. Favor gold, orange, red, cyan, electric blue, violet, emerald, or white energy depending on the artifact.',
    'Use compact exaggerated fantasy proportions, ornate xianxia craftsmanship, sharp metallic edges, jade or crystal inlays, engraved motifs, luminous runes, magical seams, and concentrated energy glow.',
    'Give the artifact bright rim light, specular shine, bloom around magical parts, and a localized aura behind it. Keep these effects tight around the item rather than filling the entire background.',
    'Do not make the object tiny, distant, flat, gray, muddy, muted, photorealistic, or displayed on furniture. It must look like a vibrant game equipment icon.',
    'Keep the silhouette instantly recognizable at thumbnail size. Swords remain swords, shields remain shields, talismans remain talismans, mirrors remain mirrors, bells remain bells, cauldrons remain cauldrons, boots remain boots, and array artifacts remain compact mystical devices.',
    'Item name: ' + name + '.',
    'Cultivation realm: ' + realm + '.',
    'Artifact category: ' + category + '.',
    weaponForm ? 'Canonical artifact form: ' + weaponForm + '.' : '',
    effects ? 'Mechanical theme to express visually: ' + effects + '.' : '',
    description ? 'Artifact description: ' + description + '.' : '',
    story ? 'Lore mood only, without literal text: ' + story + '.' : ''
  ]);
}

function cloudflareError(payload, status) {
  const message = payload?.errors?.[0]?.message || payload?.error || payload?.result?.error;
  return clean(message || ('Cloudflare image request failed (' + status + ')'), 360);
}

async function generateFluxImage(prompt, { env = process.env, fetchImpl = fetch, timeoutMs = 45000 } = {}) {
  const config = imageConfig(env);
  if (!config.accountId || !config.apiToken) {
    const missing = [
      !config.accountId ? 'CLOUDFLARE_ACCOUNT_ID' : '',
      !config.apiToken ? 'CLOUDFLARE_API_TOKEN' : ''
    ].filter(Boolean).join('、');
    const error = new Error('Render 尚缺少 ' + missing);
    error.status = 503;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(
      'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(config.accountId) +
        '/ai/run/@cf/black-forest-labs/flux-1-schnell',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + config.apiToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt,
          steps: 4
        }),
        signal: controller.signal
      }
    );
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeout = new Error('Cloudflare 生圖逾時，請稍後重試');
      timeout.status = 504;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    const error = new Error(cloudflareError(payload, response.status));
    error.status = response.status || 502;
    throw error;
  }
  const base64 = String(payload?.result?.image || payload?.image || '').replace(/\s+/g, '').slice(0, 20 * 1024 * 1024);
  if (!base64) {
    const error = new Error('Cloudflare 未回傳圖片資料');
    error.status = 502;
    throw error;
  }
  return { base64, mimeType: 'image/jpeg' };
}

async function uploadGeneratedImage(kind, id, base64, {
  env = process.env,
  fetchImpl = fetch,
  now = () => new Date()
} = {}) {
  const cfg = r2Config(env);
  const missing = [
    !cfg.accountId ? 'R2_ACCOUNT_ID（或 CLOUDFLARE_ACCOUNT_ID）' : '',
    !cfg.accessKeyId ? 'R2_ACCESS_KEY_ID' : '',
    !cfg.secretAccessKey ? 'R2_SECRET_ACCESS_KEY' : '',
    !cfg.bucketName ? 'R2_BUCKET_NAME' : '',
    !cfg.publicBaseUrl ? 'R2_PUBLIC_BASE_URL' : ''
  ].filter(Boolean);

  if (missing.length) {
    const error = new Error('Render 尚缺少 Cloudflare R2 設定：' + missing.join('、'));
    error.status = 503;
    throw error;
  }
  if (!/^https:\/\//i.test(cfg.publicBaseUrl)) {
    const error = new Error('R2_PUBLIC_BASE_URL 必須是 https:// 開頭的公開 R2 網址或自訂網域');
    error.status = 503;
    throw error;
  }

  const safeId = clean(id, 80).replace(/[^a-zA-Z0-9_-]+/g, '-') || 'item';
  const storagePath =
    'generated-items/' + CONFIGS[kind].folder + '/' + safeId + '/' +
    Date.now() + '-' + randomUUID() + '.jpg';
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    const error = new Error('生成圖片解碼失敗');
    error.status = 502;
    throw error;
  }

  const signed = signedR2PutRequest({
    accountId: cfg.accountId,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    bucketName: cfg.bucketName,
    key: storagePath,
    body: buffer,
    now: now()
  });

  let response;
  try {
    response = await fetchImpl(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      body: buffer
    });
  } catch (error) {
    const wrapped = new Error('Cloudflare R2 上傳連線失敗：' + clean(error?.message || 'network error', 260));
    wrapped.status = 502;
    throw wrapped;
  }

  if (!response.ok) {
    const detail = clean(await response.text().catch(() => ''), 320);
    const error = new Error(
      'Cloudflare R2 上傳失敗 (' + response.status + ')' +
      (detail ? '：' + detail : '')
    );
    error.status = response.status === 401 || response.status === 403 ? 502 : (response.status || 502);
    throw error;
  }

  const imageUrl = cfg.publicBaseUrl + '/' + encodeR2Key(storagePath);
  return { imageUrl, storagePath, bucketName: cfg.bucketName };
}
async function authenticatedPlayer(req, { resolve = role => adminProject(role) } = {}) {
  const bearer = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization') || ''));
  if (!bearer) {
    const error = new Error('請先登入');
    error.status = 401;
    throw error;
  }
  const project = resolve('A');
  let verified;
  try { verified = await project.auth.verifyIdToken(bearer[1], true); }
  catch (_) {
    const error = new Error('登入已失效，請重新登入');
    error.status = 401;
    throw error;
  }
  if (!verified?.uid || (verified.aud && verified.aud !== PROJECT_IDS.A) ||
      (verified.iss && verified.iss !== 'https://securetoken.google.com/' + PROJECT_IDS.A)) {
    const error = new Error('登入專案驗證失敗');
    error.status = 401;
    throw error;
  }
  const userSnap = await project.db.collection('users').doc(verified.uid).get();
  if (!userSnap.exists) {
    const error = new Error('玩家資料不存在');
    error.status = 404;
    throw error;
  }
  return { project, uid: verified.uid, data: userSnap.data() || {} };
}

function stripImageRuntimeFields(item = {}) {
  const next = { ...item };
  delete next.imageJobId;
  delete next.imageError;
  return next;
}

async function reserveImageJob({ project, kind, id, overwrite = false, requesterUid = '', admin = false }) {
  const cfg = CONFIGS[kind];
  const ref = project.db.collection('gameConfig').doc(cfg.doc);
  const jobId = randomUUID();
  let reserved = null;

  await project.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      const error = new Error('找不到 ' + cfg.doc + ' 設定');
      error.status = 404;
      throw error;
    }
    const data = snap.data() || {};
    const items = Array.isArray(data.items) ? data.items.map((row) => ({ ...row })) : [];
    const index = items.findIndex((row) => String(row?.id || '') === id);
    if (index < 0) {
      const error = new Error('找不到物品：' + id);
      error.status = 404;
      throw error;
    }

    const current = items[index] || {};
    if (!admin) {
      if (kind !== 'artifact' || current.generatedByAI !== true ||
          String(current.recipeOwnerUid || '') !== requesterUid) {
        const error = new Error('只有此 AI 法寶的配方首發者可自動補圖');
        error.status = 403;
        throw error;
      }
    }
    if (current.imageUrl && !overwrite) {
      reserved = { skipped: true, item: current, ref };
      return;
    }
    if (current.imageStatus === 'generating' && current.imageJobId && !overwrite) {
      const error = new Error('此物品正在生成圖片');
      error.status = 409;
      throw error;
    }

    items[index] = {
      ...current,
      imageStatus: 'generating',
      imageJobId: jobId,
      imageError: '',
      imagePromptVersion: PROMPT_VERSION,
      imageModel: MODEL
    };
    tx.set(ref, {
      items,
      itemImageJobAtMs: Date.now(),
      itemImageJobItemId: id
    }, { merge: true });
    reserved = { skipped: false, item: current, ref, jobId };
  });
  return reserved;
}

async function finishImageJob({ project, reserved, kind, id, imageUrl, storagePath }) {
  let output = null;
  await project.db.runTransaction(async (tx) => {
    const snap = await tx.get(reserved.ref);
    if (!snap.exists) throw new Error('物品設定已不存在');
    const data = snap.data() || {};
    const items = Array.isArray(data.items) ? data.items.map((row) => ({ ...row })) : [];
    const index = items.findIndex((row) => String(row?.id || '') === id);
    if (index < 0) throw new Error('物品已被刪除');
    const current = items[index] || {};
    if (current.imageJobId !== reserved.jobId) {
      const error = new Error('圖片任務已被新的生成要求取代');
      error.status = 409;
      throw error;
    }
    output = stripImageRuntimeFields({
      ...current,
      imageUrl,
      imageStatus: 'ready',
      imageModel: MODEL,
      imagePromptVersion: PROMPT_VERSION,
      imageStoragePath: storagePath,
      imageUpdatedAtMs: Date.now()
    });
    items[index] = output;
    tx.set(reserved.ref, {
      items,
      itemImageUpdatedAtMs: Date.now(),
      itemImageUpdatedId: id
    }, { merge: true });
  });
  return output;
}

async function failImageJob({ project, reserved, id, error }) {
  if (!reserved?.ref || reserved.skipped) return;
  try {
    await project.db.runTransaction(async (tx) => {
      const snap = await tx.get(reserved.ref);
      if (!snap.exists) return;
      const data = snap.data() || {};
      const items = Array.isArray(data.items) ? data.items.map((row) => ({ ...row })) : [];
      const index = items.findIndex((row) => String(row?.id || '') === id);
      if (index < 0 || items[index]?.imageJobId !== reserved.jobId) return;
      items[index] = {
        ...items[index],
        imageStatus: 'error',
        imageError: clean(error?.message || '圖片生成失敗', 260),
        imageUpdatedAtMs: Date.now()
      };
      delete items[index].imageJobId;
      tx.set(reserved.ref, { items }, { merge: true });
    });
  } catch (_) {}
}

async function generateCatalogItemImage({
  project,
  kind,
  id,
  overwrite = false,
  requesterUid = '',
  admin = false,
  env = process.env,
  fetchImpl = fetch,
  storageFetchImpl = fetch
}) {
  const normalizedKind = itemKind(kind);
  const normalizedId = clean(id, 80);
  if (!normalizedKind || !normalizedId) {
    const error = new Error('缺少合法的 kind 或 id');
    error.status = 400;
    throw error;
  }

  const reserved = await reserveImageJob({
    project,
    kind: normalizedKind,
    id: normalizedId,
    overwrite: !!overwrite,
    requesterUid,
    admin
  });
  if (reserved.skipped) return { skipped: true, item: reserved.item };

  try {
    const prompt = buildItemImagePrompt(normalizedKind, reserved.item);
    const generated = await generateFluxImage(prompt, { env, fetchImpl });
    const uploaded = await uploadGeneratedImage(normalizedKind, normalizedId, generated.base64, {
      env, fetchImpl: storageFetchImpl
    });
    const item = await finishImageJob({
      project, reserved, kind: normalizedKind, id: normalizedId,
      imageUrl: uploaded.imageUrl, storagePath: uploaded.storagePath
    });
    return { skipped: false, item, model: MODEL, promptVersion: PROMPT_VERSION };
  } catch (error) {
    await failImageJob({ project, reserved, id: normalizedId, error });
    throw error;
  }
}

function createAdminItemImageHandler(options = {}) {
  return async function adminItemImageHandler(req, res) {
    res.set?.('Cache-Control', 'no-store');
    try {
      const auth = await authenticatedPlayer(req, options);
      if (auth.data?.isAdmin !== true) {
        return res.status(403).json({ ok: false, error: '僅管理員可以執行補圖' });
      }
      const result = await generateCatalogItemImage({
        project: auth.project,
        kind: req.body?.kind,
        id: req.body?.id,
        overwrite: req.body?.overwrite === true,
        requesterUid: auth.uid,
        admin: true,
        env: options.env || process.env,
        fetchImpl: options.fetchImpl || fetch,
        storageFetchImpl: options.storageFetchImpl || fetch
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        ok: false,
        error: clean(error?.message || '補圖失敗', 360)
      });
    }
  };
}

function createArtifactAutoImageHandler(options = {}) {
  return async function artifactAutoImageHandler(req, res) {
    res.set?.('Cache-Control', 'no-store');
    try {
      const auth = await authenticatedPlayer(req, options);
      const result = await generateCatalogItemImage({
        project: auth.project,
        kind: 'artifact',
        id: req.body?.id,
        overwrite: false,
        requesterUid: auth.uid,
        admin: auth.data?.isAdmin === true,
        env: options.env || process.env,
        fetchImpl: options.fetchImpl || fetch,
        storageFetchImpl: options.storageFetchImpl || fetch
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        ok: false,
        error: clean(error?.message || '法寶自動補圖失敗', 360)
      });
    }
  };
}

function registerItemImageApi(app, options = {}) {
  app.post('/api/admin/item-image', createAdminItemImageHandler(options));
  app.post('/api/item-image/ensure-artifact', createArtifactAutoImageHandler(options));
}

module.exports = {
  MODEL,
  PROMPT_VERSION,
  buildItemImagePrompt,
  imageConfig,
  r2Config,
  signedR2PutRequest,
  uploadGeneratedImage,
  generateFluxImage,
  generateCatalogItemImage,
  createAdminItemImageHandler,
  createArtifactAutoImageHandler,
  registerItemImageApi
};
