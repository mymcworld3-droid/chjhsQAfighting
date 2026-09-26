'use strict';

const { randomUUID } = require('node:crypto');
const { adminProject, PROJECT_IDS } = require('./firebase-admin-projects.cjs');
const { getStorage } = require('firebase-admin/storage');

const MODEL = '@cf/black-forest-labs/flux-1-schnell';
const PROMPT_VERSION = 'xianxia-item-icon-v1';
const PROMPT_MAX = 2048;
const DEFAULT_BUCKET = 'question-learning.firebasestorage.app';
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
    apiToken: clean(env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN || env.CLOUDFLARE_AI_TOKEN, 4096),
    bucketName: clean(env.FIREBASE_A_STORAGE_BUCKET || env.FIREBASE_STORAGE_BUCKET || DEFAULT_BUCKET, 240)
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
    'Create a 1:1 square inventory item image for a Chinese xianxia cultivation RPG.',
    'Use one consistent premium game-art direction: refined Chinese fantasy, elegant ancient craftsmanship, realistic material texture, subtle ink-painting influence, restrained spiritual glow, crisp readable silhouette.',
    'The item must be centered, fully visible, not cropped, with roughly ten percent empty margin around it.',
    'Use a simple dark neutral studio-like background with a faint atmospheric aura; do not draw a scene.',
    'Do not include any people, hands, faces, text, letters, numbers, labels, watermark, logo, UI border, inventory frame, duplicated object, split panel, or caption.'
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
    'This is a finished magical ARTIFACT. Show exactly one complete artifact with a distinctive silhouette and visible craftsmanship.',
    'Its shape must match the artifact type instead of becoming a generic glowing orb. Swords remain swords, shields remain shields, talismans remain talismans, arrays remain array plates, mirrors remain mirrors, bells remain bells, cauldrons remain cauldrons.',
    'Higher cultivation realms may look more refined and spiritually powerful, but keep the design readable rather than filling the image with effects.',
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
  storageFactory = getStorage,
  project = adminProject('A')
} = {}) {
  const cfg = imageConfig(env);
  const bucket = storageFactory(project.app).bucket(cfg.bucketName);
  const safeId = clean(id, 80).replace(/[^a-zA-Z0-9_-]+/g, '-') || 'item';
  const storagePath = 'generated-items/' + CONFIGS[kind].folder + '/' + safeId + '/' + Date.now() + '-' + randomUUID() + '.jpg';
  const downloadToken = randomUUID();
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new Error('生成圖片解碼失敗');

  await bucket.file(storagePath).save(buffer, {
    resumable: false,
    validation: false,
    metadata: {
      contentType: 'image/jpeg',
      cacheControl: 'public,max-age=31536000,immutable',
      metadata: { firebaseStorageDownloadTokens: downloadToken }
    }
  });

  const imageUrl =
    'https://firebasestorage.googleapis.com/v0/b/' + encodeURIComponent(bucket.name) +
    '/o/' + encodeURIComponent(storagePath) +
    '?alt=media&token=' + encodeURIComponent(downloadToken);
  return { imageUrl, storagePath };
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
  storageFactory = getStorage
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
      env, storageFactory, project
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
        storageFactory: options.storageFactory || getStorage
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
        storageFactory: options.storageFactory || getStorage
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
  generateFluxImage,
  generateCatalogItemImage,
  createAdminItemImageHandler,
  createArtifactAutoImageHandler,
  registerItemImageApi
};
