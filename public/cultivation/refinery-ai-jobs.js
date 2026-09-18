import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, runTransaction } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
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
  replaceArtifactRecipes,
  artifactRecipeDepth,
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

  const ARTIFACT_CONFIG = ['gameConfig', 'artifactCatalogV1'];
  const MATERIAL_CONFIG = ['gameConfig', 'materialCatalogV1'];

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

  function recipeSignature(recipe = []) {
    return recipe.map((row) => ({
      key: row.artifactId ? 'artifact:' + row.artifactId : 'material:' + row.materialId,
      quantity: Math.max(0, Math.floor(Number(row.quantity) || 0))
    })).filter((row) => row.key && row.quantity)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((row) => row.key + ':' + row.quantity).join('|');
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
    return realm;
  }

  function resultingDepth(recipe) {
    let depth = 0;
    for (const row of recipe) {
      if (!row.artifactId) continue;
      depth = Math.max(depth, 1 + artifactRecipeDepth(row.artifactId));
    }
    return depth;
  }

  function buildPlan(tokens, knownArtifactId = '') {
    const ingredients = aggregateTokens(tokens);
    const recipe = recipeFromIngredients(ingredients);
    const total = ingredients.reduce((sum, row) => sum + row.quantity, 0);
    if (total < 2 || total > 8) return { valid: false, reason: '煉器需要 2 到 8 個素材。', total };

    const known = knownArtifactId ? getArtifactById(knownArtifactId) : null;
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
    return {
      valid: true,
      total,
      ingredients,
      recipe,
      signature: recipeSignature(recipe),
      knownArtifactId: known?.id || '',
      discovery: !known,
      targetRealm,
      playerRealm: pRealm,
      depth,
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
        if (have < need) throw new Error((getMaterialById(row.materialId)?.name || row.materialId) + ' 數量不足');
      } else if (row.artifactId) {
        const have = Math.max(0, Number(artifactSystem.inventory[row.artifactId]) || 0);
        const reserved = Math.max(0, Number(equippedCounts[row.artifactId]) || 0);
        if (have - reserved < need) throw new Error((getArtifactById(row.artifactId)?.name || row.artifactId) + ' 可用數量不足；已裝備法寶不會被消耗');
      }
    }

    for (const row of recipe) {
      const need = Math.max(1, Math.floor(Number(row.quantity) || 1));
      if (row.materialId) {
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

  async function startJob(tokens, knownArtifactId = '', adminOptions = {}) {
    if (currentJob()) throw new Error('目前已有一件法寶正在煉製，請等待完成後開爐取出。');
    const plan = buildPlan(tokens, knownArtifactId);
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
      goldCost: plan.gold,
      durationMs: plan.durationMs,
      startedAtMs: now,
      readyAtMs: now + plan.durationMs,
      signature: plan.signature,
      recipe: plan.recipe,
      ingredients: plan.ingredients,
      adminGenerationDirection,
      adminGenerationPrompt
    };

    let committed = null;
    await runTransaction(db(), async (tx) => {
      const ref = doc(db(), 'users', user.uid);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('玩家資料不存在');
      const raw = snap.data() || {};
      if (raw[REFINERY_JOB_FIELD]?.id) throw new Error('目前已有一件法寶正在煉製');
      const gold = Math.max(0, Number(raw.stats?.gold) || 0);
      if (gold < plan.gold) throw new Error('金幣不足，需要 ' + plan.gold + '，目前只有 ' + gold);

      const consumed = consumeRecipe(raw, plan.recipe);
      committed = {
        materialSystem: consumed.materialSystem,
        artifactSystem: consumed.artifactSystem,
        gold: gold - plan.gold,
        job
      };
      tx.update(ref, {
        materialSystem: consumed.materialSystem,
        artifactSystem: consumed.artifactSystem,
        'stats.gold': committed.gold,
        [REFINERY_JOB_FIELD]: job
      });
    });

    const local = data();
    if (local && committed) {
      local.materialSystem = committed.materialSystem;
      local.artifactSystem = committed.artifactSystem;
      local.stats = local.stats || {};
      local.stats.gold = committed.gold;
      local[REFINERY_JOB_FIELD] = job;
    }
    window.dispatchEvent(new CustomEvent('material-system-updated', { detail: committed?.materialSystem }));
    window.dispatchEvent(new CustomEvent('artifact-system-updated', { detail: committed?.artifactSystem }));
    window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', { detail: { gold: committed?.gold, refineryJobStarted: job.id } }));
    window.dispatchEvent(new CustomEvent('xiuxian:refinery-job-updated', { detail: job }));
    return job;
  }

  function apiMaterials() {
    return MATERIAL_CATALOG.map((item) => ({
      id: item.id, name: item.name, icon: item.icon, realm: item.realm,
      category: item.category, description: item.description || '', buyGold: Number(item.buyGold) || 0
    }));
  }

  function apiArtifacts() {
    return ARTIFACT_CATALOG.map((item) => ({
      id: item.id, name: item.name, realm: item.realm, category: item.category,
      description: item.description, effects: item.effects
    }));
  }

  async function generateCandidate(job) {
    const response = await fetch('/api/generate-artifact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedIngredients: job.ingredients,
        allMaterials: apiMaterials(),
        existingArtifacts: apiArtifacts(),
        targetRealm: job.targetRealm,
        adminGenerationDirection: job.adminGenerationDirection || '',
        adminGenerationPrompt: job.adminGenerationPrompt || '',
        supportedEffects: SUPPORTED_ARTIFACT_EFFECTS
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.artifact) throw new Error('新法寶推演失敗，請稍後再開爐');
    return payload;
  }

  function uniqueGeneratedId(items) {
    let id = 'ai-artifact-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const ids = new Set(items.map((item) => item.id));
    while (ids.has(id)) id += '-' + Math.random().toString(36).slice(2, 4);
    return id.slice(0, 64);
  }

  function findRecipeBySignature(recipes, signature) {
    for (const [artifactId, recipe] of Object.entries(recipes || {})) {
      if (recipeSignature(recipe) === signature) return artifactId;
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
      artifactSystem = raw.artifactSystem && typeof raw.artifactSystem === 'object' ? clone(raw.artifactSystem) : { inventory: {}, equipped: {}, buffs: [] };
      artifactSystem.inventory = normalizeInventory(artifactSystem.inventory);
      artifactSystem.inventory[item.id] = (Number(artifactSystem.inventory[item.id]) || 0) + Math.max(1, Math.floor(Number(item.craft?.yield) || 1));
      tx.update(ref, { artifactSystem, [REFINERY_JOB_FIELD]: null });
    });
    const local = data();
    if (local) { local.artifactSystem = artifactSystem; local[REFINERY_JOB_FIELD] = null; }
    window.dispatchEvent(new CustomEvent('artifact-system-updated', { detail: artifactSystem }));
    window.dispatchEvent(new CustomEvent('xiuxian:refinery-job-updated', { detail: null }));
    return getArtifactById(job.knownArtifactId);
  }

  async function claimDiscovery(job) {
    const generated = await generateCandidate(job);
    const user = authUser();
    if (!user) throw new Error('尚未登入');

    let awardedId = '';
    let committedArtifacts = null;
    let committedCatalog = null;
    let committedRecipes = null;

    await runTransaction(db(), async (tx) => {
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

      awardedId = findRecipeBySignature(latestRecipes, fresh.signature);
      if (!awardedId) {
        const id = uniqueGeneratedId(latestItems);
        const candidate = normalizeArtifactDefinition({
          id,
          ...generated.artifact,
          realm: fresh.targetRealm,
          craft: { gold: baseRealmForgeGold(fresh.targetRealm), yield: 1 },
          reviewStatus: 'pending',
          generatedByAI: true,
          generatedAtMs: Date.now(),
          generationSignature: fresh.signature,
          generationMaterials: fresh.ingredients,
          aiProvider: generated.provider || '',
          aiModel: generated.model || ''
        });
        committedCatalog = validateArtifactCatalog([candidate, ...latestItems]);
        const nextRecipes = { ...latestRecipes, [candidate.id]: fresh.recipe };
        committedRecipes = validateArtifactRecipes(nextRecipes);
        awardedId = candidate.id;

        tx.set(artifactRef, {
          version: 1,
          items: committedCatalog,
          aiGeneratedAtMs: Date.now(),
          aiGeneratedArtifactId: candidate.id
        }, { merge: true });
        tx.set(materialRef, {
          recipes: committedRecipes,
          aiGeneratedRecipeAtMs: Date.now(),
          aiGeneratedArtifactId: candidate.id
        }, { merge: true });
      }

      const artifactSystem = raw.artifactSystem && typeof raw.artifactSystem === 'object' ? clone(raw.artifactSystem) : { inventory: {}, equipped: {}, buffs: [] };
      artifactSystem.inventory = normalizeInventory(artifactSystem.inventory);
      artifactSystem.inventory[awardedId] = (Number(artifactSystem.inventory[awardedId]) || 0) + 1;
      committedArtifacts = artifactSystem;
      tx.update(userRef, { artifactSystem, [REFINERY_JOB_FIELD]: null });
    });

    const local = data();
    if (local) { local.artifactSystem = committedArtifacts; local[REFINERY_JOB_FIELD] = null; }
    if (committedCatalog) replaceArtifactCatalog(committedCatalog, 'ai-generated');
    if (committedRecipes) replaceArtifactRecipes(committedRecipes, 'ai-generated');
    window.dispatchEvent(new CustomEvent('artifact-system-updated', { detail: committedArtifacts }));
    window.dispatchEvent(new CustomEvent('xiuxian:refinery-job-updated', { detail: null }));
    return getArtifactById(awardedId) || committedCatalog?.find((item) => item.id === awardedId) || { id: awardedId, name: '新生法寶' };
  }

  async function claimJob() {
    const job = currentJob();
    if (!job) throw new Error('目前沒有煉器任務');
    if (Date.now() < Number(job.readyAtMs || 0)) throw new Error('尚需 ' + formatRefineryDuration(Number(job.readyAtMs) - Date.now()));
    return job.kind === 'discovery' ? claimDiscovery(job) : claimKnown(job);
  }

  window.getCultivationRefineryJob = currentJob;
  window.getCultivationRefineryPlan = buildPlan;
  window.startCultivationRefineryJob = startJob;
  window.claimCultivationRefineryJob = claimJob;
  window.formatCultivationRefineryDuration = formatRefineryDuration;
  window.getCultivationRefineryRecipeSignature = recipeSignature;
})();
