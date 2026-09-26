'use strict';

const { adminProject, PROJECT_IDS } = require('./firebase-admin-projects.cjs');
const { FieldValue } = require('firebase-admin/firestore');

const CONFIG_COLLECTION = 'gameConfig';
const ARTIFACT_CONFIG_DOC = 'artifactCatalogV1';
const MATERIAL_CONFIG_DOC = 'materialCatalogV1';
const ARTIFACT_SCHEMA_VERSION = 2;
const RECIPE_SCHEMA_VERSION = 2;
const MAX_BATCH_USER_WRITES = 440;
const MIN_COMPENSATION_PER_COPY = 100;
const REFINERY_JOB_FIELD = 'refineryJobV1';

function safeId(value) {
  const id = String(value || '').trim();
  return id && id.length <= 160 && !id.includes('/') ? id : '';
}

function tokenFrom(req) {
  const header = String(req.get?.('authorization') || '');
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(header);
  return match ? match[1] : '';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function compensationPerCopy(item) {
  return Math.max(
    MIN_COMPENSATION_PER_COPY,
    Math.max(0, Math.floor(Number(item?.craft?.gold) || 0))
  );
}

function recipeTotal(recipe = []) {
  return (Array.isArray(recipe) ? recipe : []).reduce(
    (sum, row) => sum + Math.max(0, Math.floor(Number(row?.quantity) || 0)),
    0
  );
}

function buildRecipesAfterDeletion(recipes, itemId) {
  const source = recipes && typeof recipes === 'object' && !Array.isArray(recipes) ? recipes : {};
  const invalidRecipeIds = new Set([itemId]);
  let changed = true;
  while (changed) {
    changed = false;
    Object.entries(source).forEach(([artifactId, recipe]) => {
      if (invalidRecipeIds.has(artifactId)) return;
      const dependsOnInvalid = (Array.isArray(recipe) ? recipe : []).some(
        row => row?.artifactId && invalidRecipeIds.has(String(row.artifactId))
      );
      if (dependsOnInvalid) {
        invalidRecipeIds.add(artifactId);
        changed = true;
      }
    });
  }

  const next = {};
  Object.entries(source).forEach(([artifactId, recipe]) => {
    if (invalidRecipeIds.has(artifactId)) return;
    const copied = clone(recipe);
    if (recipeTotal(copied) >= 2) next[artifactId] = copied;
  });
  return { recipes: next, invalidatedRecipeIds: [...invalidRecipeIds] };
}

function jobReferencesArtifact(job, itemId) {
  if (!job || typeof job !== 'object' || !job.id) return false;
  if (String(job.knownArtifactId || '') === itemId) return true;
  if ((Array.isArray(job.ingredients) ? job.ingredients : []).some(
    row => row?.type === 'artifact' && String(row.id || '') === itemId
  )) return true;
  return (Array.isArray(job.recipe) ? job.recipe : []).some(
    row => String(row?.artifactId || '') === itemId
  );
}

function cleanPlayerForDeletion(raw, item, compensationEach) {
  const itemId = item.id;
  const artifactSystem = raw?.artifactSystem && typeof raw.artifactSystem === 'object'
    ? clone(raw.artifactSystem)
    : { inventory: {}, equipped: {}, buffs: {} };
  artifactSystem.inventory = artifactSystem.inventory && typeof artifactSystem.inventory === 'object'
    ? { ...artifactSystem.inventory } : {};
  artifactSystem.equipped = artifactSystem.equipped && typeof artifactSystem.equipped === 'object'
    ? { ...artifactSystem.equipped } : {};
  artifactSystem.buffs = artifactSystem.buffs && typeof artifactSystem.buffs === 'object'
    ? { ...artifactSystem.buffs } : {};

  const heldCopies = Math.max(0, Math.floor(Number(artifactSystem.inventory[itemId]) || 0));
  delete artifactSystem.inventory[itemId];

  Object.entries(artifactSystem.equipped).forEach(([slot, equippedId]) => {
    if (String(equippedId || '') === itemId) delete artifactSystem.equipped[slot];
  });
  Object.entries(artifactSystem.buffs).forEach(([key, buff]) => {
    if (String(buff?.artifactId || '') === itemId || String(key).startsWith(itemId + ':')) {
      delete artifactSystem.buffs[key];
    }
  });

  let canceledJob = false;
  let deletedJobInputs = 0;
  let jobGoldRefund = 0;
  const materialSystem = raw?.materialSystem && typeof raw.materialSystem === 'object'
    ? clone(raw.materialSystem) : { inventory: {} };
  materialSystem.inventory = materialSystem.inventory && typeof materialSystem.inventory === 'object'
    ? { ...materialSystem.inventory } : {};

  const job = raw?.[REFINERY_JOB_FIELD];
  if (jobReferencesArtifact(job, itemId)) {
    canceledJob = true;
    jobGoldRefund = Math.max(0, Math.floor(Number(job?.goldCost) || 0));
    (Array.isArray(job?.ingredients) ? job.ingredients : []).forEach(row => {
      const qty = Math.max(0, Math.floor(Number(row?.quantity) || 0));
      if (!qty) return;
      if (row?.type === 'artifact') {
        const sourceId = String(row.id || '');
        if (sourceId === itemId) deletedJobInputs += qty;
        else if (sourceId) {
          artifactSystem.inventory[sourceId] =
            Math.max(0, Number(artifactSystem.inventory[sourceId]) || 0) + qty;
        }
      } else {
        const materialId = String(row?.id || '');
        if (materialId) {
          materialSystem.inventory[materialId] =
            Math.max(0, Number(materialSystem.inventory[materialId]) || 0) + qty;
        }
      }
    });
  }

  const compensatedCopies = heldCopies + deletedJobInputs;
  const compensationGold = compensatedCopies * compensationEach;
  const oldGold = Math.max(0, Math.floor(Number(raw?.stats?.gold) || 0));
  const newGold = oldGold + compensationGold + jobGoldRefund;
  const changed = heldCopies > 0 || deletedJobInputs > 0 || canceledJob ||
    Object.keys(raw?.artifactSystem?.equipped || {}).length !== Object.keys(artifactSystem.equipped).length ||
    Object.keys(raw?.artifactSystem?.buffs || {}).length !== Object.keys(artifactSystem.buffs).length;

  return {
    changed,
    heldCopies,
    deletedJobInputs,
    compensatedCopies,
    compensationGold,
    jobGoldRefund,
    newGold,
    artifactSystem,
    materialSystem,
    canceledJob
  };
}

async function verifiedAdmin(req, resolve) {
  const token = tokenFrom(req);
  if (!token) {
    const error = new Error('請先登入管理員帳號。');
    error.status = 401;
    throw error;
  }
  const a = resolve('A');
  let decoded;
  try { decoded = await a.auth.verifyIdToken(token, true); }
  catch (_) {
    const error = new Error('登入已失效，請重新登入。');
    error.status = 401;
    throw error;
  }
  if (!decoded?.uid || decoded.aud !== PROJECT_IDS.A ||
      decoded.iss !== 'https://securetoken.google.com/' + PROJECT_IDS.A) {
    const error = new Error('主專案身分驗證失敗。');
    error.status = 401;
    throw error;
  }
  const adminSnap = await a.db.collection('users').doc(decoded.uid).get();
  if (!adminSnap.exists || adminSnap.data()?.isAdmin !== true) {
    const error = new Error('此帳號沒有管理員權限。');
    error.status = 403;
    throw error;
  }
  return { a, uid: decoded.uid, admin: adminSnap.data() || {} };
}

async function buildDeletionPlan(a, itemId) {
  const artifactRef = a.db.collection(CONFIG_COLLECTION).doc(ARTIFACT_CONFIG_DOC);
  const materialRef = a.db.collection(CONFIG_COLLECTION).doc(MATERIAL_CONFIG_DOC);
  const [artifactSnap, materialSnap, usersSnap] = await Promise.all([
    artifactRef.get(),
    materialRef.get(),
    a.db.collection('users').get()
  ]);

  const artifactData = artifactSnap.exists ? artifactSnap.data() || {} : {};
  const items = Array.isArray(artifactData.items) ? artifactData.items.map(clone) : [];
  if (!items.length) {
    const error = new Error('伺服器找不到法寶目錄，請先重新整理管理員法寶資料。');
    error.status = 409;
    throw error;
  }
  const item = items.find(row => String(row?.id || '') === itemId);
  if (!item) {
    const error = new Error('找不到要刪除的法寶，可能已被其他管理員刪除。');
    error.status = 404;
    throw error;
  }
  if (items.length <= 1) {
    const error = new Error('至少需要保留 1 件法寶，不能刪除最後一件法寶。');
    error.status = 409;
    throw error;
  }

  const materialData = materialSnap.exists ? materialSnap.data() || {} : {};
  const recipePlan = buildRecipesAfterDeletion(materialData.recipes || {}, itemId);
  const compensationEach = compensationPerCopy(item);
  const affected = [];
  let totalHeldCopies = 0;
  let totalDeletedJobInputs = 0;
  let totalCompensationGold = 0;
  let canceledJobs = 0;

  usersSnap.docs.forEach(userSnap => {
    const raw = userSnap.data() || {};
    const cleanup = cleanPlayerForDeletion(raw, item, compensationEach);
    if (!cleanup.changed) return;
    affected.push({ ref: userSnap.ref, uid: userSnap.id, cleanup });
    totalHeldCopies += cleanup.heldCopies;
    totalDeletedJobInputs += cleanup.deletedJobInputs;
    totalCompensationGold += cleanup.compensationGold + cleanup.jobGoldRefund;
    if (cleanup.canceledJob) canceledJobs += 1;
  });

  if (affected.length > MAX_BATCH_USER_WRITES) {
    const error = new Error(
      '受影響玩家有 ' + affected.length + ' 人，超過單次安全刪除上限 ' +
      MAX_BATCH_USER_WRITES + ' 人；未進行任何刪除。'
    );
    error.status = 409;
    throw error;
  }

  return {
    item,
    nextItems: items.filter(row => String(row?.id || '') !== itemId),
    recipePlan,
    affected,
    compensationEach,
    totalHeldCopies,
    totalDeletedJobInputs,
    totalCompensationGold,
    canceledJobs,
    artifactRef,
    materialRef
  };
}

function publicPlan(plan) {
  return {
    item: { id: plan.item.id, name: plan.item.name || plan.item.id },
    affectedPlayers: plan.affected.length,
    compensationEach: plan.compensationEach,
    totalHeldCopies: plan.totalHeldCopies,
    totalDeletedJobInputs: plan.totalDeletedJobInputs,
    totalCompensationGold: plan.totalCompensationGold,
    canceledJobs: plan.canceledJobs,
    invalidatedRecipeIds: plan.recipePlan.invalidatedRecipeIds
  };
}

async function commitDeletion(a, uid, admin, plan) {
  const batch = a.db.batch();
  const audit = {
    updatedBy: uid,
    updatedByName: admin.displayName || admin.name || '管理員',
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtMs: Date.now()
  };

  batch.set(plan.artifactRef, {
    version: 1,
    artifactCatalogSchemaVersion: ARTIFACT_SCHEMA_VERSION,
    items: plan.nextItems,
    deletedArtifactId: plan.item.id,
    ...audit
  }, { merge: true });

  batch.set(plan.materialRef, {
    version: 1,
    artifactRecipeSchemaVersion: RECIPE_SCHEMA_VERSION,
    recipes: plan.recipePlan.recipes,
    deletedArtifactId: plan.item.id,
    ...audit
  }, { merge: true });

  let self = null;
  plan.affected.forEach(({ ref, uid: affectedUid, cleanup }) => {
    const patch = {
      artifactSystem: cleanup.artifactSystem,
      'stats.gold': cleanup.newGold
    };
    if (cleanup.canceledJob) {
      patch.materialSystem = cleanup.materialSystem;
      patch[REFINERY_JOB_FIELD] = null;
    }
    batch.update(ref, patch);
    if (affectedUid === uid) {
      self = {
        artifactSystem: cleanup.artifactSystem,
        materialSystem: cleanup.canceledJob ? cleanup.materialSystem : null,
        refineryJobCanceled: cleanup.canceledJob,
        gold: cleanup.newGold,
        compensationGold: cleanup.compensationGold
      };
    }
  });

  await batch.commit();
  return self;
}

function createAdminArtifactDeleteHandler({
  resolve = role => adminProject(role),
  logger = console
} = {}) {
  return async function adminArtifactDeleteHandler(req, res) {
    res.set?.('Cache-Control', 'no-store');
    try {
      const itemId = safeId(req.body?.itemId);
      const action = String(req.body?.action || 'preview');
      if (!itemId) return res.status(400).json({ error: '法寶 ID 無效。' });
      if (action !== 'preview' && action !== 'delete') {
        return res.status(400).json({ error: '未知的法寶刪除操作。' });
      }

      const { a, uid, admin } = await verifiedAdmin(req, resolve);
      const plan = await buildDeletionPlan(a, itemId);
      if (action === 'preview') {
        return res.status(200).json({ ok: true, preview: publicPlan(plan) });
      }

      const self = await commitDeletion(a, uid, admin, plan);
      return res.status(200).json({
        ok: true,
        deletedArtifactId: itemId,
        items: plan.nextItems,
        recipes: plan.recipePlan.recipes,
        summary: publicPlan(plan),
        self
      });
    } catch (error) {
      const status = Number(error?.status) || 500;
      if (status >= 500) logger.error('[Admin artifact delete API]', error?.stack || error?.message || error);
      else logger.warn('[Admin artifact delete API]', error?.message || error);
      return res.status(status).json({
        error: status >= 500 ? '法寶刪除服務暫時無法使用，請稍後再試。' : error.message
      });
    }
  };
}

module.exports = function registerAdminArtifactDeleteApi(app, options = {}) {
  app.post('/api/admin/artifacts/delete', createAdminArtifactDeleteHandler(options));
};
module.exports.__test = {
  safeId,
  buildRecipesAfterDeletion,
  jobReferencesArtifact,
  cleanPlayerForDeletion,
  createAdminArtifactDeleteHandler
};
