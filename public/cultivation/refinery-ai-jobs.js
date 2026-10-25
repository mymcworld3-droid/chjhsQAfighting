import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import './forge-fragments.js';
import './refinery-errors.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, runTransaction } from '../data-store.js';
import {
  ARTIFACT_CATALOG,
  SUPPORTED_ARTIFACT_EFFECTS,
  getArtifactById,
  normalizeArtifactDefinition,
  validateArtifactCatalog,
  replaceArtifactCatalog,
  realmForScore,
  realmOrderByName
} from './artifact-catalog.js';
import {
  MATERIAL_CATALOG,
  ARTIFACT_RECIPES,
  getMaterialById,
  validateArtifactRecipes,
  repairArtifactRecipes,
  replaceArtifactRecipes,
  artifactRecipeDepth,
  raidRefinementKeyRequirement,
  MAX_ARTIFACT_RECIPE_NESTING
} from './material-catalog.js';
import {
  REFINERY_JOB_FIELD,
  calculateRefineryEconomy,
  baseRealmForgeGold,
  formatRefineryDuration
} from './refinery-economy.js';

(function () {
  'use strict';
  if(window.QA_WEAPON_SYSTEM_ENABLED)return;

  const ARTIFACT_CONFIG = ['gameConfig', 'artifactCatalogV1'];
  const MATERIAL_CONFIG = ['gameConfig', 'materialCatalogV1'];
  // 同一工作生成成功後若 Firestore 暫時中斷，可再次開爐而不重複呼叫生成服務。
  // 僅保存在本次頁面記憶體；實際領取狀態仍以 Firestore transaction 為準。
  const generatedCandidateCache = new Map();
  const generatedCandidatePromises = new Map();
  const backgroundGenerationAttempted = new Set();
  let generationOwnerUid = '';

  const data = () => window.getCurrentUserData?.() || null;
  const authUser = () => { try { return getAuth(getApp()).currentUser; } catch (_) { return null; } };
  const db = () => getFirestore(getApp());
  const clone = (v) => JSON.parse(JSON.stringify(v));

  function parseToken(token) {
    const text = String(token || '');
    if (text.startsWith('artifact:')) return { type: 'artifact', id: text.slice(9) };
    return { type: 'material', id: text.startsWith('material:') ? text.slice(9) : text };
  }

  function metaForToken(token) {
    const parsed = parseToken(token);
    const item = parsed.type === 'artifact' ? getArtifactById(parsed.id) : getMaterialById(parsed.id);
    return {
      type: parsed.type,
      id: parsed.id,
      name: item?.name || parsed.id,
      icon: item?.icon || (parsed.type === 'artifact' ? '◆' : '材'),
      realm: item?.realm || '凡人',
      category: parsed.type === 'artifact' ? '法寶素材' : (item?.category || '材料')
    };
  }

  function aggregateTokens(tokens = []) {
    const map = new Map();
    tokens.filter(Boolean).forEach((token) => {
      const parsed = parseToken(token);
      const key = parsed.type + ':' + parsed.id;
      const current = map.get(key) || { ...metaForToken(token), quantity: 0 };
      current.quantity += 1;
      map.set(key, current);
    });
    return [...map.values()];
  }

  function recipeFromIngredients(ingredients) {
    return ingredients.map((row) => row.type === 'artifact'
      ? { artifactId: row.id, quantity: row.quantity }
      : { materialId: row.id, quantity: row.quantity });
  }

  function recipeSignature(recipe = [], forgeMethod = '自由發揮') {
    return recipe.map((row) => ({
      key: row.artifactId ? 'artifact:' + row.artifactId : 'material:' + row.materialId,
      quantity: Math.max(0, Math.floor(Number(row.quantity) || 0))
    })).filter((row) => row.key && row.quantity)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((row) => row.key + ':' + row.quantity).join('|') +
      (forgeMethod && forgeMethod !== '自由發揮' ? '|method:' + forgeMethod : '');
  }

  function currentJob() {
    const job = data()?.[REFINERY_JOB_FIELD];
    return job && typeof job === 'object' && job.id ? job : null;
  }

  function cleanAdminGuidance(value, maxLength) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  function playerRealm() {
    return realmForScore(Math.max(0, Number(data()?.stats?.totalScore) || 0));
  }

  function highestIngredientRealm(ingredients) {
    let realm = '凡人';
    let order = 0;
    for (const row of ingredients) {
      const candidate = realmOrderByName(row.realm);
      if (candidate >= order) {
        order = candidate;
        realm = row.realm || realm;
      }
    }
    return order < 1 ? '煉氣' : realm;
  }

  function resultingDepth(recipe) {
    let depth = 0;
    for (const row of recipe) {
      if (!row.artifactId) continue;
      depth = Math.max(depth, 1 + artifactRecipeDepth(row.artifactId));
    }
    return depth;
  }

  function buildPlan(tokens, knownArtifactId = '', forgeMethod = '自由發揮') {
    const ingredients = aggregateTokens(tokens);
    const recipe = recipeFromIngredients(ingredients);
    const method = ['自由發揮','劍道鍛造','護體鑄造','符籙煉製','陣法刻印'].includes(forgeMethod)
      ? forgeMethod : '自由發揮';
    const total = ingredients.reduce((sum, row) => sum + row.quantity, 0);
    if (total < 2 || total > 8) return { valid: false, reason: '煉器需要 2 到 8 個素材。', total };

    let known = knownArtifactId ? getArtifactById(knownArtifactId) : null;
    const hasSoulboundBase = recipe.some((row) =>
      row.artifactId && isSoulboundSourceItem(row.artifactId));
    if (known?.equipSlot === '本命法寶' && !hasSoulboundBase) {
      return { valid:false, reason:'本命法寶原器需經抽取或碎片兌換取得，已有本命法寶可作素材精煉。', total };
    }
    const boundSources = soulboundSources(recipe);
    try { globalThis.QASoulboundPool.refineEffects([], boundSources); }
    catch (error) { return { valid:false, reason:error.message, total }; }
    if (known && !globalThis.QASoulboundPool.refinementCompatible(known, hasSoulboundBase, boundSources)) known = null;
    const targetRealm = known?.realm || highestIngredientRealm(ingredients);
    const pRealm = playerRealm().name;
    const depth = known ? artifactRecipeDepth(known.id) : resultingDepth(recipe);
    if (depth > MAX_ARTIFACT_RECIPE_NESTING) {
      return { valid: false, reason: '此組素材會形成第 ' + depth + ' 層套娃，最多只允許 ' + MAX_ARTIFACT_RECIPE_NESTING + ' 層。', total, depth };
    }
    const economy = calculateRefineryEconomy({
      targetRealm,
      playerRealm: pRealm,
      baseGold: known?.craft?.gold || baseRealmForgeGold(targetRealm),
      discovery: !known
    });
    const refinementStage = Math.min(3, depth + 1);
    const keyRequirement = raidRefinementKeyRequirement(refinementStage, targetRealm);
    return {
      valid: true,
      total,
      ingredients,
      recipe,
      signature: recipeSignature(recipe, known?.forgeMethod || method),
      forgeMethod: known?.forgeMethod || method,
      knownArtifactId: known?.id || '',
      discovery: !known,
      targetRealm,
      playerRealm: pRealm,
      depth,
      refinementStage,
      keyRequirement,
      ...economy
    };
  }

  function normalizeInventory(raw = {}) {
    const out = {};
    Object.entries(raw || {}).forEach(([id, value]) => {
      const qty = Math.max(0, Math.floor(Number(value) || 0));
      if (qty) out[id] = qty;
    });
    return out;
  }

  function consumeRecipe(raw, recipe) {
    // Admin materials are virtual in the refinery: never mint or save fake stock.
    // Only the authoritative Firestore user record can grant this privilege.
    const unlimitedMaterials = raw.isAdmin === true;
    const materialSystem = raw.materialSystem && typeof raw.materialSystem === 'object' ? clone(raw.materialSystem) : { inventory: {} };
    materialSystem.inventory = normalizeInventory(materialSystem.inventory);
    const artifactSystem = raw.artifactSystem && typeof raw.artifactSystem === 'object' ? clone(raw.artifactSystem) : { inventory: {}, equipped: {}, buffs: [] };
    artifactSystem.inventory = normalizeInventory(artifactSystem.inventory);
    artifactSystem.equipped = artifactSystem.equipped && typeof artifactSystem.equipped === 'object' ? artifactSystem.equipped : {};

    const equippedCounts = {};
    Object.values(artifactSystem.equipped).forEach((id) => {
      const key = String(id || '');
      if (key) equippedCounts[key] = (equippedCounts[key] || 0) + 1;
    });

    for (const row of recipe) {
      const need = Math.max(1, Math.floor(Number(row.quantity) || 1));
      if (row.materialId) {
        const have = Math.max(0, Number(materialSystem.inventory[row.materialId]) || 0);
        if (!unlimitedMaterials && have < need) throw new Error((getMaterialById(row.materialId)?.name || row.materialId) + ' 數量不足');
      } else if (row.artifactId) {
        const have = Math.max(0, Number(artifactSystem.inventory[row.artifactId]) || 0);
        const reserved = Math.max(0, Number(equippedCounts[row.artifactId]) || 0);
        if (have - reserved < need) throw new Error((getArtifactById(row.artifactId)?.name || row.artifactId) + ' 可用數量不足；已裝備法寶不會被消耗');
      }
    }

    for (const row of recipe) {
      const need = Math.max(1, Math.floor(Number(row.quantity) || 1));
      if (row.materialId) {
        if (unlimitedMaterials) continue;
        const remain = (Number(materialSystem.inventory[row.materialId]) || 0) - need;
        if (remain > 0) materialSystem.inventory[row.materialId] = remain;
        else delete materialSystem.inventory[row.materialId];
      } else if (row.artifactId) {
        const remain = (Number(artifactSystem.inventory[row.artifactId]) || 0) - need;
        if (remain > 0) artifactSystem.inventory[row.artifactId] = remain;
        else delete artifactSystem.inventory[row.artifactId];
      }
    }
    return { materialSystem, artifactSystem };
  }

  function consumeRefinementKey(materialSystem, requirement, unlimitedMaterials = false) {
    const materialId = String(requirement?.materialId || '');
    const need = Math.max(0, Math.floor(Number(requirement?.quantity) || 0));
    if (!materialId || !need || unlimitedMaterials) return materialSystem;
    const inventory = materialSystem?.inventory || {};
    const have = Math.max(0, Math.floor(Number(inventory[materialId]) || 0));
    const material = getMaterialById(materialId);
    if (have < need) {
      throw new Error((material?.name || '團本煉製關鍵道具') + ' 不足，需要 ' + need + '，目前只有 ' + have);
    }
    const remain = have - need;
    if (remain > 0) inventory[materialId] = remain;
    else delete inventory[materialId];
    return materialSystem;
  }

  async function startJob(tokens, knownArtifactId = '', adminOptions = {}) {
    if (currentJob()) throw new Error('目前已有一件法寶正在煉製，請等待完成後開爐取出。');
    const plan = buildPlan(tokens, knownArtifactId, adminOptions?.forgeMethod);
    if (!plan.valid) throw new Error(plan.reason);

    const user = authUser();
    if (!user) throw new Error('尚未登入');
    const now = Date.now();
    const canGuide = data()?.isAdmin === true && plan.discovery;
    const adminGenerationDirection = canGuide ? cleanAdminGuidance(adminOptions?.direction, 80) : '';
    const adminGenerationPrompt = canGuide ? cleanAdminGuidance(adminOptions?.prompt, 1200) : '';
    const job = {
      id: 'forge-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      status: 'refining',
      kind: plan.discovery ? 'discovery' : 'known',
      knownArtifactId: plan.knownArtifactId,
      targetRealm: plan.targetRealm,
      playerRealm: plan.playerRealm,
      depth: plan.depth,
      refinementStage: plan.refinementStage,
      keyRequirement: plan.keyRequirement,
      fragmentCost: plan.fragments,
      currency: 'forgeFragments',
      goldCost: 0,
      durationMs: plan.durationMs,
      startedAtMs: now,
      readyAtMs: now + plan.durationMs,
      signature: plan.signature,
      recipe: plan.recipe,
      ingredients: plan.ingredients,
      forgeMethod: plan.forgeMethod,
      adminGenerationDirection,
      adminGenerationPrompt
    };

    let committed = null;
    await runTransaction(db(), async (tx) => {
      const ref = doc(db(), 'users', user.uid);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('玩家資料不存在');
      const raw = snap.data() || {};
      // 配方是提供製作方法的知識，不是煉器許可證。
      // 玩家即使未持有配方，也能靠自行投入素材煉製。
      if (raw[REFINERY_JOB_FIELD]?.id) throw new Error('目前已有一件法寶正在煉製');
      const fragments = globalThis.QAForgeFragments.balance(raw);
      if (fragments < plan.fragments) throw new Error('煉器碎片不足，需要 ' + plan.fragments + '，目前只有 ' + fragments);

      const consumed = consumeRecipe(raw, plan.recipe);
      consumeRefinementKey(consumed.materialSystem, plan.keyRequirement, raw.isAdmin === true);
      committed = {
        materialSystem: consumed.materialSystem,
        artifactSystem: consumed.artifactSystem,
        fragments: fragments - plan.fragments,
        job
      };
      tx.update(ref, {
        materialSystem: consumed.materialSystem,
        artifactSystem: consumed.artifactSystem,
        'forgeFragments': committed.fragments,
        [REFINERY_JOB_FIELD]: job
      });
    });

    const local = data();
    if (authUser()?.uid !== user.uid) return job;
    if (local && committed && authUser()?.uid === user.uid) {
      local.materialSystem = committed.materialSystem;
      local.artifactSystem = committed.artifactSystem;
      local.stats = local.stats || {};
      local.forgeFragments = committed.fragments;
      local[REFINERY_JOB_FIELD] = job;
    }
    window.dispatchEvent(new CustomEvent('material-system-updated', { detail: committed?.materialSystem }));
    window.dispatchEvent(new CustomEvent('artifact-system-updated', { detail: committed?.artifactSystem }));
    window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', { detail: { forgeFragments: committed?.fragments, refineryJobStarted: job.id } }));
    window.dispatchEvent(new CustomEvent('xiuxian:refinery-job-updated', { detail: job }));
    return job;
  }

  function apiMaterials() {
    return MATERIAL_CATALOG.map((item) => ({
      id: item.id, name: item.name, icon: item.icon, realm: item.realm,
      category: item.category, description: item.description || '',
      story: item.story || '', weaponForm: item.weaponForm || '',
      weaponName: item.weaponName || '', buyGold: Number(item.buyGold) || 0
    }));
  }

  // Permanent soulbound originals may be absent from the stored admin catalog.
  function soulboundSources(recipe = [], catalog = ARTIFACT_CATALOG) {
    return recipe.filter(row => row.artifactId).map(row =>
      globalThis.QASoulboundPool.get(row.artifactId) || catalog.find(item => item.id === row.artifactId)
    ).filter(item => item?.equipSlot === '本命法寶');
  }

  function isSoulboundSourceItem(id, catalog = ARTIFACT_CATALOG) {
    return (globalThis.QASoulboundPool.get(id) || catalog.find(item => item.id === id))?.equipSlot === '本命法寶';
  }

  function apiArtifacts() {
    return ARTIFACT_CATALOG.map((item) => ({
      id: item.id, name: item.name, icon: item.icon, realm: item.realm, category: item.category,
      description: item.description, story: item.story || '', effects: item.effects,
      equipSlot: item.equipSlot || '', weaponForm:item.weaponForm || '',
      forgeMethod:item.forgeMethod || '自由發揮', coreEffect:item.coreEffect || '',
      refinementDepth: artifactRecipeDepth(item.id)
    }));
  }

  function generationError(message, code, extra = {}) {
    const error = new Error(message);
    error.code = code;
    error.refineryStage = 'generation';
    Object.assign(error, extra);
    return error;
  }

  async function ensureGeneratedArtifactImage(artifactId) {
    const user = authUser();
    if (!user || !artifactId || getArtifactById(artifactId)?.equipSlot !== '本命法寶') return null;
    const token = await user.getIdToken();
    const response = await fetch('/api/item-image/ensure-artifact', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify({ id: artifactId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.error || ('法寶圖片生成失敗 (' + response.status + ')'));
    }
    if (payload.item?.id) {
      const next = ARTIFACT_CATALOG.map((row) =>
        row.id === payload.item.id ? { ...row, ...payload.item } : row);
      replaceArtifactCatalog(next, 'ai-generated-image');
      return payload.item;
    }
    return null;
  }

  async function generateCandidate(job) {
    const started = Date.now();
    const requestId = globalThis.crypto?.randomUUID?.() || 'refinery-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    const metadata = () => ({ requestId, endpoint: '/api/generate-artifact', elapsedMs: Date.now() - started });
    let body;
    try {
      body = JSON.stringify({ selectedIngredients: job.ingredients, allMaterials: apiMaterials(), existingArtifacts: apiArtifacts(),
        targetRealm: job.targetRealm, forgeMethod: job.forgeMethod || '自由發揮',
        adminGenerationDirection: job.adminGenerationDirection || '', adminGenerationPrompt: job.adminGenerationPrompt || '',
        supportedEffects: SUPPORTED_ARTIFACT_EFFECTS, effectBoundsV2: window.getArtifactEffectBounds?.() || {} });
    } catch (cause) {
      throw generationError('無法準備煉器素材與設定', 'refinery-input', { ...metadata(), refineryStage: 'request-preparation', cause });
    }
    const controller = new AbortController();
    let timer;
    let timedOut = false;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { timedOut = true; controller.abort(); reject(generationError('煉器請求逾時', 'refinery-api-timeout', metadata())); }, 180000);
    });
    let response;
    let payload;
    try {
      response = await Promise.race([fetch('/api/generate-artifact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Refinery-Request-Id': requestId },
        body, signal: controller.signal
      }), timeout]);
      payload = await Promise.race([response.json(), timeout]);
    } catch (cause) {
      if (timedOut) throw generationError('煉器請求逾時', 'refinery-api-timeout', { ...metadata(), httpStatus: response?.status });
      if (cause?.code === 'refinery-api-timeout') throw cause;
      // Safari 的「Load failed」通常只是網路層 TypeError，不能據此判定材料或任務損毀。
      throw generationError(response ? '煉器推演服務回應格式不符' : '煉器推演服務無法連線', response ? 'refinery-api-invalid-response' : 'refinery-api-network', {
        ...metadata(), httpStatus: response?.status, cause
      });
    } finally { clearTimeout(timer); }
    if (!response.ok || !payload?.artifact) {
      const code = globalThis.QARefineryErrors?.TYPES[payload?.code] ? payload.code : response.ok ? 'refinery-ai-artifact' :
        [401, 403].includes(response.status) ? 'refinery-api-access' : response.status === 404 ? 'refinery-api-route' : response.status === 413 ? 'refinery-request-size' : 'refinery-api-response';
      throw generationError(payload?.error || '新法寶推演未完成', code, {
        ...metadata(), requestId: payload?.requestId || requestId, refineryStage: payload?.stage || 'generation',
        httpStatus: response.status,
        serverReason: String(payload?.reason || payload?.error || '').slice(0, 500), attempts: payload?.attempts || []
      });
    }
    if (typeof payload.artifact !== 'object' || Array.isArray(payload.artifact) || !payload.artifact.name || !Array.isArray(payload.artifact.effects) || !payload.artifact.effects.length) {
      throw generationError('生成結果缺少有效法寶名稱或效果', 'refinery-ai-artifact', { ...metadata(), httpStatus: response.status });
    }
    return { ...payload, requestId: payload.requestId || requestId };
  }

  function uniqueGeneratedId(items) {
    let id = 'ai-artifact-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const ids = new Set(items.map((item) => item.id));
    while (ids.has(id)) id += '-' + Math.random().toString(36).slice(2, 4);
    return id.slice(0, 64);
  }

  function findRecipeBySignature(recipes, signature, catalog = ARTIFACT_CATALOG) {
    for (const [artifactId, recipe] of Object.entries(recipes || {})) {
      const item = catalog.find((candidate) => candidate.id === artifactId);
      const hasSoulboundBase = (recipe || []).some(row => row.artifactId &&
        isSoulboundSourceItem(row.artifactId, catalog));
      if (!globalThis.QASoulboundPool.refinementCompatible(item, hasSoulboundBase, soulboundSources(recipe, catalog))) continue;
      // Use current recipe + saved method so edited recipes remain reproducible.
      const currentSignature = recipeSignature(recipe, item?.forgeMethod || '自由發揮');
      if (currentSignature === signature) return artifactId;
    }
    return '';
  }

  async function claimKnown(job) {
    const user = authUser();
    if (!user) throw new Error('尚未登入');
    let artifactSystem = null;
    await runTransaction(db(), async (tx) => {
      const ref = doc(db(), 'users', user.uid);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('玩家資料不存在');
      const raw = snap.data() || {};
      const fresh = raw[REFINERY_JOB_FIELD];
      if (!fresh?.id || fresh.id !== job.id) throw new Error('煉器任務已變更，請重新整理');
      if (Date.now() < Number(fresh.readyAtMs || 0)) throw new Error('法寶仍在煉製中，尚不可開爐');
      const item = getArtifactById(fresh.knownArtifactId);
      if (!item) throw new Error('此法寶已不存在，請聯絡管理員');
      const sources = soulboundSources(fresh.recipe);
      if (sources.length) globalThis.QASoulboundPool.assertRefinementImproves(item, sources);
      artifactSystem = raw.artifactSystem && typeof raw.artifactSystem === 'object' ? clone(raw.artifactSystem) : { inventory: {}, equipped: {}, buffs: [] };
      artifactSystem.inventory = normalizeInventory(artifactSystem.inventory);
      artifactSystem.inventory[item.id] = (Number(artifactSystem.inventory[item.id]) || 0) + Math.max(1, Math.floor(Number(item.craft?.yield) || 1));
      tx.update(ref, { artifactSystem, [REFINERY_JOB_FIELD]: null });
    });
    try {
      const local = data();
      if (local) { local.artifactSystem = artifactSystem; local[REFINERY_JOB_FIELD] = null; }
      window.dispatchEvent(new CustomEvent('artifact-system-updated', { detail: artifactSystem }));
      window.dispatchEvent(new CustomEvent('xiuxian:refinery-job-updated', { detail: null }));
      return getArtifactById(job.knownArtifactId);
    } catch (error) { error.refineryStage = 'client-sync'; error.refineryAwarded = true; throw error; }
  }

  async function claimDiscovery(job) {
    // Reuse the background request, if still pending, instead of calling twice.
    const pending = generatedCandidatePromises.get(job.id);
    if (pending) await pending.catch(() => null);
    const generated = generatedCandidateCache.get(job.id) || await generateCandidate(job);
    generatedCandidateCache.set(job.id, generated);
    const user = authUser();
    if (!user) throw new Error('尚未登入');

    let awardedId = '';
    let firstDiscovery = false;
    let committedArtifacts = null;
    let committedCatalog = null;
    let committedRecipes = null;
    let claimStage = 'catalog-read';

    await runTransaction(db(), async (tx) => {
      claimStage = 'catalog-read';
      const userRef = doc(db(), 'users', user.uid);
      const artifactRef = doc(db(), ...ARTIFACT_CONFIG);
      const materialRef = doc(db(), ...MATERIAL_CONFIG);
      const [userSnap, artifactSnap, materialSnap] = await Promise.all([
        tx.get(userRef), tx.get(artifactRef), tx.get(materialRef)
      ]);
      if (!userSnap.exists()) throw new Error('玩家資料不存在');
      const raw = userSnap.data() || {};
      const fresh = raw[REFINERY_JOB_FIELD];
      if (!fresh?.id || fresh.id !== job.id) throw new Error('煉器任務已變更，請重新整理');
      if (Date.now() < Number(fresh.readyAtMs || 0)) throw new Error('法寶仍在煉製中，尚不可開爐');

      const latestItems = artifactSnap.exists() && Array.isArray(artifactSnap.data()?.items) && artifactSnap.data().items.length
        ? clone(artifactSnap.data().items) : clone(ARTIFACT_CATALOG);
      const latestRecipes = materialSnap.exists() && materialSnap.data()?.recipes && typeof materialSnap.data().recipes === 'object'
        ? clone(materialSnap.data().recipes) : clone(ARTIFACT_RECIPES);
      claimStage = 'catalog-validation';
      const recipeRepair = repairArtifactRecipes(latestRecipes, {
        artifactIds: latestItems.map((item) => item?.id),
        materialIds: MATERIAL_CATALOG.map((item) => item?.id)
      });
      const cleanLatestRecipes = recipeRepair.recipes;

      awardedId = findRecipeBySignature(cleanLatestRecipes, fresh.signature, latestItems);
      // 讀取全站目前配方的同一筆 transaction 決定首發者。並發開爐時
      // Firestore 會重試衝突交易，只有第一筆成功登錄新配方的人擁有權。
      firstDiscovery = !awardedId;
      if (!awardedId) {
        claimStage = 'artifact-validation';
        const id = uniqueGeneratedId(latestItems);
        // Do not trust an AI-chosen slot at the final catalog commit.
        const realSoulboundSource = (fresh.recipe || []).some((row) =>
          row.artifactId && isSoulboundSourceItem(row.artifactId, latestItems));
        const generatedArtifact = { ...generated.artifact };
        if (realSoulboundSource) {
          generatedArtifact.equipSlot = '本命法寶';
          generatedArtifact.effects = globalThis.QASoulboundPool.refineEffects(generatedArtifact.effects, soulboundSources(fresh.recipe, latestItems));
          generatedArtifact.soulboundRefinementVersion = globalThis.QASoulboundPool.REFINEMENT_VERSION;
        }
        if (generatedArtifact.equipSlot === '本命法寶' && !realSoulboundSource) generatedArtifact.equipSlot = '輔助法寶';
        const candidate = normalizeArtifactDefinition({
          id,
          ...generatedArtifact,
          realm: fresh.targetRealm,
          craft: { gold: baseRealmForgeGold(fresh.targetRealm), yield: 1 },
          reviewStatus: 'pending',
          generatedByAI: true,
          generatedAtMs: Date.now(),
          recipeOwnerUid: user.uid,
          recipeOwnerName: String(raw.displayName || user.displayName || '無名修士').trim().slice(0, 36) || '無名修士',
          recipeDiscoveredAtMs: Date.now(),
          generationSignature: fresh.signature,
          generationMaterials: fresh.ingredients,
          aiProvider: generated.provider || '',
          aiModel: generated.model || ''
        });
        if (realSoulboundSource) globalThis.QASoulboundPool.assertRefinementImproves(candidate, soulboundSources(fresh.recipe, latestItems));
        committedCatalog = validateArtifactCatalog([candidate, ...latestItems]);
        if (realSoulboundSource) globalThis.QASoulboundPool.assertRefinementImproves(committedCatalog.find(item => item.id === candidate.id), soulboundSources(fresh.recipe, latestItems));
        const nextRecipes = { ...cleanLatestRecipes, [candidate.id]: fresh.recipe };
        committedRecipes = validateArtifactRecipes(nextRecipes);
        awardedId = candidate.id;

        tx.set(artifactRef, {
          version: 1,
          // Discovery only appends its own entry. Keep stored definitions intact;
          // normalizing other players' items is an administrator operation.
          items: raw.isAdmin === true ? committedCatalog : [candidate, ...(artifactSnap.data()?.items || [])],
          aiGeneratedAtMs: Date.now(),
          aiGeneratedArtifactId: candidate.id
        }, { merge: true });
        tx.set(materialRef, {
          recipes: raw.isAdmin === true ? committedRecipes : { ...(materialSnap.data()?.recipes || {}), [candidate.id]: fresh.recipe },
          aiGeneratedRecipeAtMs: Date.now(),
          aiGeneratedArtifactId: candidate.id,
          ...(raw.isAdmin === true ? { orphanRecipeCleanupRemovedIds: recipeRepair.removedRecipeIds.slice(0, 100) } : {})
        }, { merge: true });
      } else if (recipeRepair.changed && raw.isAdmin === true) {
        committedRecipes = cleanLatestRecipes;
        tx.set(materialRef, {
          recipes: committedRecipes,
          orphanRecipeCleanupAtMs: Date.now(),
          orphanRecipeCleanupRemovedIds: recipeRepair.removedRecipeIds.slice(0, 100)
        }, { merge: true });
      }

      const artifactSystem = raw.artifactSystem && typeof raw.artifactSystem === 'object' ? clone(raw.artifactSystem) : { inventory: {}, equipped: {}, buffs: [] };
      artifactSystem.inventory = normalizeInventory(artifactSystem.inventory);
      artifactSystem.inventory[awardedId] = (Number(artifactSystem.inventory[awardedId]) || 0) + 1;
      committedArtifacts = artifactSystem;
      tx.update(userRef, { artifactSystem, [REFINERY_JOB_FIELD]: null });
      claimStage = 'catalog-commit';
    }).catch(error => {
      error.refineryStage = error.refineryStage || claimStage;
      error.requestId = error.requestId || generated.requestId;
      throw error;
    });

    try {
    const local = data();
    if (local) { local.artifactSystem = committedArtifacts; local[REFINERY_JOB_FIELD] = null; }
    if (committedCatalog) replaceArtifactCatalog(committedCatalog, 'ai-generated');
    if (committedRecipes) replaceArtifactRecipes(committedRecipes, 'ai-generated');
    window.dispatchEvent(new CustomEvent('artifact-system-updated', { detail: committedArtifacts }));
    window.dispatchEvent(new CustomEvent('xiuxian:refinery-job-updated', { detail: null }));

    // 新配方第一次正式登錄後立刻補圖；圖片失敗不回滾已完成的煉器，
    // 管理員仍可在「物品補圖」面板重試。
    if (firstDiscovery && awardedId) {
      try { await ensureGeneratedArtifactImage(awardedId); }
      catch (error) { console.warn('[Refinery artifact image]', globalThis.QARefineryErrors?.describe(error, { phase: 'image', jobId: job.id, requestId: generated.requestId })); }
    }

    generatedCandidateCache.delete(job.id);
    generatedCandidatePromises.delete(job.id);
    backgroundGenerationAttempted.delete(job.id);
    const awarded = getArtifactById(awardedId) || committedCatalog?.find((item) => item.id === awardedId) || { id: awardedId, name: '新生法寶' };
    return { ...awarded, recipeFirstDiscovery: firstDiscovery };
    } catch (error) { error.refineryStage = 'client-sync'; error.refineryAwarded = true; error.requestId = generated.requestId; throw error; }
  }

  function requiresGeneratedCandidate(job) {
    if (!job) return false;
    const hasSoulboundBase = (job.recipe || []).some(row => row.artifactId && getArtifactById(row.artifactId)?.equipSlot === '本命法寶');
    const outdated = hasSoulboundBase && !globalThis.QASoulboundPool.refinementCompatible(getArtifactById(job.knownArtifactId), true, soulboundSources(job.recipe));
    return job.kind === 'discovery' || outdated;
  }

  // While the player is online, forge the AI candidate ahead of opening the
  // furnace. Awarding the item, registering a recipe and clearing the job must
  // STILL happen exclusively in the authoritative claim transaction.
  function preGenerateOnlineCandidate() {
    const user = authUser();
    if (!user) return;
    if (generationOwnerUid !== user.uid) {
      generatedCandidateCache.clear();
      generatedCandidatePromises.clear();
      backgroundGenerationAttempted.clear();
      generationOwnerUid = user.uid;
    }
    const job = currentJob();
    if (!job?.id || !requiresGeneratedCandidate(job)) return;
    if (backgroundGenerationAttempted.has(job.id) || generatedCandidateCache.has(job.id)) return;
    backgroundGenerationAttempted.add(job.id);
    const pending = generateCandidate(job)
      .then(result => {
        if (authUser()?.uid === user.uid && currentJob()?.id === job.id) generatedCandidateCache.set(job.id, result);
        return result;
      })
      .catch(error => {
        // Never alter an active forge job or claim outcome on a background error.
        console.warn('[Refinery pre-generation] retry on opening furnace:', globalThis.QARefineryErrors?.describe(error, { phase: 'generation', jobId: job.id }));
        return null;
      })
      .finally(() => generatedCandidatePromises.delete(job.id));
    generatedCandidatePromises.set(job.id, pending);
  }

  async function claimJob() {
    const job = currentJob();
    if (!job) throw new Error('目前沒有煉器任務');
    if (Date.now() < Number(job.readyAtMs || 0)) throw new Error('尚需 ' + formatRefineryDuration(Number(job.readyAtMs) - Date.now()));
    try { return await (requiresGeneratedCandidate(job) ? claimDiscovery(job) : claimKnown(job)); }
    catch (error) {
      error.refineryStage = error.refineryStage || 'inventory-commit';
      error.endpoint = error.endpoint || (db()?.__d1 ? '/api/data' : 'firestore');
      throw error;
    }
  }

  async function skipJobWait() {
    const user = authUser();
    if (!user) throw new Error('尚未登入');

    let updatedJob = null;
    await runTransaction(db(), async (tx) => {
      const ref = doc(db(), 'users', user.uid);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('玩家資料不存在');
      const raw = snap.data() || {};
      if (raw.isAdmin !== true) throw new Error('只有管理員可以跳過煉製時間');
      const fresh = raw[REFINERY_JOB_FIELD];
      if (!fresh?.id) throw new Error('目前沒有煉器任務');

      const now = Date.now();
      updatedJob = {
        ...fresh,
        readyAtMs: now,
        adminSkippedAtMs: now,
        adminSkippedBy: user.uid
      };
      tx.update(ref, { [REFINERY_JOB_FIELD]: updatedJob });
    });

    const local = data();
    if (local) local[REFINERY_JOB_FIELD] = updatedJob;
    window.dispatchEvent(new CustomEvent('xiuxian:refinery-job-updated', { detail: updatedJob }));
    return updatedJob;
  }

  // A login, restored account, freshly started job or administrator skip all
  // provide opportunities to precompute before the user taps 開爐.
  if (typeof window.addEventListener === 'function') {
    ['xiuxian:user-ready', 'xiuxian:user-data-ready', 'xiuxian:refinery-job-updated']
      .forEach(name => window.addEventListener(name, preGenerateOnlineCandidate));
    if (typeof document !== 'undefined' && document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', preGenerateOnlineCandidate, { once: true });
    else preGenerateOnlineCandidate();
  }

  window.getCultivationRefineryJob = currentJob;
  window.getCultivationRefineryPlan = buildPlan;
  window.startCultivationRefineryJob = startJob;
  window.claimCultivationRefineryJob = claimJob;
  window.skipCultivationRefineryWait = skipJobWait;
  window.formatCultivationRefineryDuration = formatRefineryDuration;
  window.getCultivationRefineryRecipeSignature = recipeSignature;
})();
