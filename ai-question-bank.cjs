'use strict';

// AI-only permanent question bank, stored as one approved JSON file per question
// in the configured Google Drive folder. Not used by custom/static banks.
// This is a server integration, not the ChatGPT Google Drive connector.
const crypto = require('node:crypto');
const DEFAULT_FOLDER = '1Z8TgddizbBKYA2h1Ij6nPqXjhGUAVTqF';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// A raw, single-line JSON bundle avoids clipboard/encoding failures on tablets.
// Priority: JSON bundle > Base64 bundle > individual fields.
// Both bundles contain secrets and must be stored only in the deployment secret settings.
const OAUTH_JSON_ENV = 'AI_QUESTION_BANK_GOOGLE_OAUTH_JSON';
const OAUTH_BUNDLE_ENV = 'AI_QUESTION_BANK_GOOGLE_OAUTH_B64';

function validateOAuthCredentials(parsed) {
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
    ['client_id','client_secret','refresh_token'].every(
      name => typeof parsed[name] === 'string' && parsed[name].length > 0);
}

function resolveOAuthCredentials(env) {
  const rawJson = String(env[OAUTH_JSON_ENV] || '').trim();
  const bundle = String(env[OAUTH_BUNDLE_ENV] || '').trim();
  if (!rawJson && !bundle) return {source:'individual',credentials:{
    client_id: env.AI_QUESTION_BANK_GOOGLE_CLIENT_ID,
    client_secret: env.AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET,
    refresh_token: env.AI_QUESTION_BANK_GOOGLE_REFRESH_TOKEN
  }};
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (!validateOAuthCredentials(parsed)) throw Error('invalid fields');
      return {source:'json',credentials:{
        client_id:parsed.client_id,
        client_secret:parsed.client_secret,
        refresh_token:parsed.refresh_token
      }};
    } catch (_) {
      return {source:'invalid-json',credentials:{},error:
        'AI_QUESTION_BANK_GOOGLE_OAUTH_JSON must be a JSON object with string fields client_id, client_secret, refresh_token'};
    }
  }
  try {
    const parsed = JSON.parse(Buffer.from(bundle,'base64').toString('utf8'));
    if (!validateOAuthCredentials(parsed)) throw Error('missing or invalid required credential fields');
    return {source:'bundle',credentials:{
      client_id:parsed.client_id,
      client_secret:parsed.client_secret,
      refresh_token:parsed.refresh_token
    }};
  } catch (_) {
    return {source:'invalid-bundle',credentials:{},error:
      'AI_QUESTION_BANK_GOOGLE_OAUTH_B64 must be Base64-encoded JSON with client_id, client_secret, refresh_token'};
  }
}

const OAUTH_FIELDS = Object.freeze([
  'AI_QUESTION_BANK_GOOGLE_CLIENT_ID',
  'AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET',
  'AI_QUESTION_BANK_GOOGLE_REFRESH_TOKEN'
]);

// Reports names and status only. Never include credential values, prefixes or hashes.
function oauthConfigurationChecks(env) {
  const values = OAUTH_FIELDS.map(name => String(env[name] ?? ''));
  const missing = OAUTH_FIELDS.filter((_,i) => !values[i].trim());
  const issues = [];
  const [id,secret,refresh] = values;
  if (id.trim() && !id.trim().endsWith('.apps.googleusercontent.com'))
    issues.push('AI_QUESTION_BANK_GOOGLE_CLIENT_ID looks incorrectly formatted (Google OAuth client IDs end in .apps.googleusercontent.com)');
  for (const [index,value] of values.entries()) {
    if (value && value !== value.trim())
      issues.push(OAUTH_FIELDS[index] + ' contains leading or trailing whitespace');
    if (value.trim().startsWith('https://') || value.trim().startsWith('http://'))
      issues.push(OAUTH_FIELDS[index] + ' looks like a URL, not a credential');
    if (value.length >= 2 && (
      (value[0] === '"' && value[value.length-1] === '"') ||
      (value[0] === "'" && value[value.length-1] === "'")
    )) issues.push(OAUTH_FIELDS[index] + ' has extra surrounding quotes');
  }
  if (id && secret && id === secret)
    issues.push('AI_QUESTION_BANK_GOOGLE_CLIENT_ID and AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET are identical');
  if (secret && refresh && secret === refresh)
    issues.push('AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET and AI_QUESTION_BANK_GOOGLE_REFRESH_TOKEN are identical');
  return {missing,issues};
}

function oauthFailureHint(errorCode, status, mode) {
  if (mode === 'service-account') {
    return 'Check AI_QUESTION_BANK_SERVICE_ACCOUNT_JSON or the fallback FIREBASE_A_SERVICE_ACCOUNT_JSON.';
  }
  if (errorCode === 'invalid_client' || status === 401)
    return 'Check AI_QUESTION_BANK_GOOGLE_CLIENT_ID and AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET. Google cannot distinguish which field is incorrect; both must belong to the same OAuth client.';
  if (errorCode === 'invalid_grant')
    return 'Check AI_QUESTION_BANK_GOOGLE_REFRESH_TOKEN. It may be expired, revoked, copied incorrectly or from a different OAuth client.';
  if (errorCode === 'unauthorized_client')
    return 'Check Google OAuth application configuration and authorization status.';
  if (errorCode === 'invalid_scope')
    return 'Check Google Drive scope authorization in Google Cloud.';
  return 'Check Google Cloud OAuth configuration and Render environment variables.';
}

async function oauthTokenFailure(response, mode) {
  let code = '';
  try {
    const data = await response.json();
    const safeCodes = ['invalid_client','invalid_grant','unauthorized_client','invalid_scope','access_denied','invalid_request'];
    if (safeCodes.includes(data?.error)) code = data.error;
  } catch (_) { /* HTTP status is still enough for a safe diagnostic. */ }
  // Never display Google's error_description: it could contain sensitive data.
  return Error('Google Drive OAuth token unavailable: HTTP ' + response.status +
    (code ? ' (' + code + ')' : '') + '. ' + oauthFailureHint(code, Number(response.status), mode));
}


const trim = (s, size = 200) => String(s || '').normalize('NFC').trim().slice(0, size);
const normalize = s => trim(s, 240).toLocaleLowerCase('zh-TW').replace(/\s+/g, '');
const digest = s => crypto.createHash('sha256').update(s).digest('hex');
const scopeCode = input => digest(JSON.stringify([
  normalize(input.subject), normalize(input.level), normalize(input.topic)
])).slice(0, 18);
const fingerprint = input => digest(JSON.stringify([
  normalize(input?.q), normalize(input?.correct),
  (Array.isArray(input?.wrong) ? input.wrong : []).map(normalize).sort()
]));

function questionFolderSegments(target) {
  const level = trim(target?.level,100);
  const subject = trim(target?.subject,100);
  const topic = trim(target?.topic,160);
  const stage = level.includes('高中') || level.includes('高職') ? '高中' :
    level.includes('國中') ? '國中' :
    level.includes('國小') || level.includes('小學') ? '國小' :
    (level ? level : '未分類學制');
  const gradeMatch = level.match(/(?:高中|高職|國中|國小|小學)([一二三四五六123456])年級/);
  const gradePrefix = stage === '高中' ? '高' : stage === '國中' ? '國' : stage === '國小' ? '小' : '';
  const grade = gradeMatch ? gradePrefix + gradeMatch[1] :
    (stage === level ? '未分類年級' : level.replace(/年級/g,'').replace(/高中|高職/g,'高').replace(/國中/g,'國').replace(/國小|小學/g,'小') || '未分類年級');
  // Topics can be full syllabus paths. The final portion is the readable concept.
  const concept = topic.split(/[－—–]/).map(s=>s.trim()).filter(Boolean).at(-1) || '未分類觀念';
  const clean = s => trim(s.replaceAll('/', ' ').replaceAll('\\', ' ').replace(/\s+/g,' ').trim(),80) || '未分類';
  return [stage,subject || '未分類科目',grade,concept].map(clean);
}

const compatible = (entry, target) => {
  if (!entry || entry.status !== 'approved' || entry.reviewCount !== 1 ||
      !entry.question || !entry.catalog) return false;
  const c = entry.catalog;
  if (normalize(c.subject) !== normalize(target.subject) ||
      normalize(c.level) !== normalize(target.level) ||
      normalize(c.topic) !== normalize(target.topic) ||
      c.difficulty !== target.difficulty) return false;
  if (target.facetId) {
    if (c.facetId !== target.facetId || c.role !== target.role ||
        c.planVersion !== target.planVersion) return false;
    if (Array.isArray(target.forms) && !target.forms.includes(entry.question.question_form)) return false;
  }
  return true;
};

function createAIQuestionBank({env = process.env, fetcher = fetch, now = Date.now, logger = console} = {}) {
  const folderId = trim(env.AI_QUESTION_BANK_DRIVE_FOLDER_ID || DEFAULT_FOLDER, 160);
  const resolved = resolveOAuthCredentials(env);
  const oauthCredentials = resolved.credentials;
  const oauth = !!(oauthCredentials.client_id &&
    oauthCredentials.client_secret && oauthCredentials.refresh_token);
  const serviceJson = env.AI_QUESTION_BANK_SERVICE_ACCOUNT_JSON || env.FIREBASE_A_SERVICE_ACCOUNT_JSON || '';
  // A malformed explicit OAuth bundle must not silently fall back to an unrelated Firebase identity.
  const enabled = env.AI_QUESTION_BANK_ENABLED === '1' &&
    (oauth || (resolved.source === 'individual' && !!serviceJson));
  if (env.AI_QUESTION_BANK_ENABLED === '1') {
    if (resolved.source === 'json') logger.info?.('[AI bank] OAuth source: AI_QUESTION_BANK_GOOGLE_OAUTH_JSON (Base64 bundle and individual OAuth fields ignored)');
    if (resolved.source === 'bundle') logger.info?.('[AI bank] OAuth source: AI_QUESTION_BANK_GOOGLE_OAUTH_B64 (three individual OAuth fields ignored)');
    if (resolved.error) logger.warn('[AI bank] OAuth configuration: ' + resolved.error);
    const checks = oauthConfigurationChecks({
      AI_QUESTION_BANK_GOOGLE_CLIENT_ID:oauthCredentials.client_id,
      AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET:oauthCredentials.client_secret,
      AI_QUESTION_BANK_GOOGLE_REFRESH_TOKEN:oauthCredentials.refresh_token
    });
    if (checks.missing.length && !resolved.error) logger.warn('[AI bank] OAuth configuration: missing ' + checks.missing.join(', ') +
      (resolved.source === 'individual' && serviceJson ? ' (service account fallback available)' : ''));
    if (checks.issues.length) logger.warn('[AI bank] OAuth configuration: ' + checks.issues.join('; '));
    logger.info?.('[AI bank] Effective OAuth fields: ' + OAUTH_FIELDS.map((name,i) =>
      name + '=' + (String([oauthCredentials.client_id,oauthCredentials.client_secret,
        oauthCredentials.refresh_token][i] ?? '').trim() ? 'present' : 'MISSING')).join(', '));
    if (oauth) logger.info?.('[AI bank] Google OAuth refresh token configured (secret values hidden)');
    else if (enabled && serviceJson) logger.info?.('[AI bank] Google service-account mode configured (secret values hidden)');
    else logger.warn('[AI bank] disabled: no usable Google OAuth or service-account credentials');
  }
  const buckets = new Map();
  const folders = new Map();
  const folderFlights = new Map();
  const inflight = new Map();
  const activity = [];
  let bearer = '', expiresAt = 0, active = 0, unavailableUntil = 0;
  const LOW_WATER = 4;
  const CACHE_MS = 2 * 60 * 1000;
  const MAX_PER_HOUR = 24;

  async function accessToken() {
    if (!enabled) throw Error('AI question bank not enabled');
    if (bearer && now() + 60000 < expiresAt) return bearer;
    let form;
    if (oauth) {
      form = new URLSearchParams({
        client_id: oauthCredentials.client_id,
        client_secret: oauthCredentials.client_secret,
        refresh_token: oauthCredentials.refresh_token,
        grant_type: 'refresh_token'
      });
    } else {
      const service = JSON.parse(serviceJson);
      if (service.type !== 'service_account' || !service.client_email || !service.private_key)
        throw Error('Invalid Google Drive service account');
      const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
      const issued = Math.floor(now() / 1000);
      const unsigned = encode({alg:'RS256',typ:'JWT'}) + '.' + encode({
        iss:service.client_email, scope:'https://www.googleapis.com/auth/drive',
        aud:TOKEN_ENDPOINT, iat:issued, exp:issued + 3500
      });
      const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), service.private_key).toString('base64url');
      form = new URLSearchParams({
        grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion:unsigned + '.' + sig
      });
    }
    const response = await fetcher(TOKEN_ENDPOINT, {
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:form.toString(),signal:AbortSignal.timeout(15000)
    });
    if (!response.ok) throw await oauthTokenFailure(response, oauth ? 'oauth' : 'service-account');
    const data = await response.json();
    if (!data.access_token) throw Error('No Google Drive access token');
    bearer = data.access_token;
    expiresAt = now() + Math.max(300, Number(data.expires_in) || 3600) * 1000;
    return bearer;
  }

  async function driveRequest(url, options = {}) {
    const response = await fetcher(url, {
      ...options,
      headers:{Authorization:'Bearer ' + await accessToken(),...(options.headers || {})},
      signal:AbortSignal.timeout(20000)
    });
    if (!response.ok) throw Error('Google Drive API status: ' + response.status);
    return response;
  }

  const escapeDriveQuery = value => String(value).replace(/'/g,"\\'");
  async function listFolder(parentId, name) {
    const q = "'" + escapeDriveQuery(parentId) + "' in parents and trashed = false" +
      " and mimeType = 'application/vnd.google-apps.folder'" +
      " and name = '" + escapeDriveQuery(name) + "'";
    const params = new URLSearchParams({q,pageSize:'100',fields:'nextPageToken,files(id,name,mimeType)'});
    const response = await driveRequest(DRIVE + '?' + params.toString());
    const data = await response.json();
    return (data.files || []).find(file=>file.name === name &&
      file.mimeType === 'application/vnd.google-apps.folder')?.id || null;
  }

  // Folder writes are single-flight within one server instance. Reads never create folders.
  async function childFolder(parentId, name, create) {
    const key = parentId + '\0' + name;
    if (folders.has(key)) return folders.get(key);
    const waiting = folderFlights.get(key);
    if (waiting) return waiting;
    const work = (async()=>{
      let found = await listFolder(parentId,name);
      if (!found && create) {
        const response = await driveRequest(DRIVE + '?fields=id,name', {
          method:'POST',
          headers:{'Content-Type':'application/json; charset=UTF-8'},
          body:JSON.stringify({name,mimeType:'application/vnd.google-apps.folder',parents:[parentId]})
        });
        const created = await response.json();
        found = created.id;
        if (!found) throw Error('Google Drive did not return created folder ID');
        logger.info?.('[AI bank] organized folder created: ' + name);
      }
      if (found) folders.set(key,found);
      return found;
    })();
    folderFlights.set(key,work);
    try { return await work; }
    finally { if (folderFlights.get(key) === work) folderFlights.delete(key); }
  }

  async function targetFolder(target, create) {
    let current = folderId;
    for (const name of questionFolderSegments(target)) {
      current = await childFolder(current,name,create);
      if (!current) return null;
    }
    return current;
  }

  async function listQuestionFiles(parentId, prefix) {
    const q = "'" + escapeDriveQuery(parentId) + "' in parents and trashed = false" +
      " and mimeType = 'application/json' and name contains '" + prefix + "'";
    const files = [];
    let page = '';
    for (let i = 0; i < 3; i++) {
      const params = new URLSearchParams({
        q,pageSize:'1000',fields:'nextPageToken,files(id,name,mimeType)',
        ...(page ? {pageToken:page} : {})
      });
      const response = await driveRequest(DRIVE + '?' + params.toString());
      const data = await response.json();
      files.push(...(data.files || []).filter(file=>file.name?.startsWith(prefix) &&
        file.mimeType === 'application/json'));
      page = data.nextPageToken || '';
      if (!page) break;
    }
    return files;
  }

  async function readBucket(target) {
    const id = scopeCode(target);
    const cached = buckets.get(id);
    if (cached && cached.until > now()) return cached.items;
    const prefix = 'aiq_' + id + '_';
    // Read both the organized directory and the old root so migrations do not
    // temporarily hide questions or cause duplicate uploads.
    const organized = await targetFolder(target,false);
    const fileGroups = await Promise.all([
      listQuestionFiles(folderId,prefix),
      organized && organized !== folderId ? listQuestionFiles(organized,prefix) : Promise.resolve([])
    ]);
    const unique = new Map();
    for (const file of fileGroups.flat()) unique.set(file.id,file);
    const files = [...unique.values()];
    const items = [];
    for (let i = 0; i < files.length; i += 6) {
      const rows = await Promise.all(files.slice(i, i + 6).map(async file => {
        try {
          const response = await driveRequest(DRIVE + '/' + encodeURIComponent(file.id) + '?alt=media');
          const data = await response.json();
          return data?.status === 'approved' && data?.reviewCount === 1 ? data : null;
        } catch (_) { return null; }
      }));
      items.push(...rows.filter(Boolean));
    }
    buckets.set(id, {until:now() + CACHE_MS,items});
    while (buckets.size > 100) buckets.delete(buckets.keys().next().value);
    return items;
  }

  async function find(target, excluded = [], isSimilar = () => false, {deadlineMs=2500} = {}) {
    if (!enabled || now() < unavailableUntil) return {ready:false,question:null,count:0};
    try {
      // A cold Drive read must never make the player wait for a long Drive API
      // timeout. Let the original live generation path proceed quickly.
      let timeout;
      const items = (await Promise.race([
        readBucket(target),
        new Promise((_, reject) => {
          // Browser requests still use 2.5s. Server-only background refills
          // may wait for a cold Drive directory read without delaying a player.
          timeout = setTimeout(() => reject(Error('AI bank read deadline')),
            Math.min(120000,Math.max(500,Number(deadlineMs)||2500)));
        })
      ]).finally(() => clearTimeout(timeout))).filter(entry => compatible(entry, target));
      const eligible = items.filter(entry => !excluded.some(q => isSimilar(entry.question.q, q)));
      const chosen = eligible.length ? eligible[crypto.randomInt(eligible.length)] : null;
      return {ready:true,question:chosen?.question || null,count:eligible.length,total:items.length};
    } catch (error) {
      unavailableUntil = now() + 60000;
      const message = String(error.message || '');
      logger.warn('[AI bank] read unavailable:', message.slice(0,
        message.startsWith('Google Drive OAuth token unavailable:') ? 280 : 120));
      return {ready:false,question:null,count:0};
    }
  }

  async function publish(target, question, review) {
    if (!enabled || review?.approved !== true) return false;
    if (!question?.q || !question?.correct || !Array.isArray(question?.wrong) ||
        question.wrong.length !== 3 || !question.exp) return false;
    const id = scopeCode(target);
    const key = fingerprint(question);
    const items = await readBucket(target);
    if (items.some(entry => fingerprint(entry.question) === key)) return false;
    const doc = {
      schemaVersion:1,status:'approved',source:'ai',
      reviewCount:1,review:{approved:true,reason:trim(review.reason,300)},
      reviewedAt:new Date(now()).toISOString(),
      catalog:{
        subject:trim(target.subject),level:trim(target.level),topic:trim(target.topic),
        difficulty:target.difficulty,
        facetId:trim(target.facetId,80),role:trim(target.role,40),
        planVersion:trim(target.planVersion,80)
      },
      question:{
        q:question.q,correct:question.correct,wrong:question.wrong,exp:question.exp,
        subject:question.subject,sub_topic:question.sub_topic,
        knowledge_points:question.knowledge_points,
        concept_id:question.concept_id,template_id:question.template_id,
        question_form:question.question_form,cognitive_level:question.cognitive_level,
        reasoning_steps:question.reasoning_steps
      }
    };
    const boundary = 'aiquestionbank' + crypto.randomBytes(12).toString('hex');
    const destination = await targetFolder(target,true);
    if (!destination) throw Error('AI bank cannot resolve concept folder');
    const metadata = {name:'aiq_' + id + '_' + key.slice(0,24) + '.json',
      mimeType:'application/json',parents:[destination],description:'AI question bank: one independent review'};
    const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) + '\r\n--' + boundary +
      '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(doc) + '\r\n--' + boundary + '--\r\n';
    await driveRequest(UPLOAD + '?uploadType=multipart&fields=id,name', {
      method:'POST',headers:{'Content-Type':'multipart/related; boundary=' + boundary},body
    });
    items.push(doc);
    buckets.set(id,{items,until:now()+CACHE_MS});
    return true;
  }

  function schedule(target, run) {
    if (!enabled) return false;
    const job = digest(JSON.stringify([
      scopeCode(target),target.facetId || '',target.role || '',target.difficulty
    ]));
    const recent = activity.filter(t => now() - t < 60 * 60 * 1000);
    activity.splice(0, activity.length, ...recent);
    if (inflight.has(job) || active >= 2 || activity.length >= MAX_PER_HOUR) return false;
    active++;
    activity.push(now());
    const work = Promise.resolve().then(run)
      .catch(err => {
        const message = String(err?.message || err);
        logger.warn('[AI bank] background task failed:',message.slice(0,
          message.startsWith('Google Drive OAuth token unavailable:') ? 280 : 120));
      })
      .finally(()=>{inflight.delete(job);active--;});
    inflight.set(job,work);
    return true;
  }

  return {enabled, LOW_WATER, find, publish, schedule, scopeCode, compatible};
}
module.exports = {createAIQuestionBank, scopeCode, fingerprint, compatible, oauthConfigurationChecks, oauthFailureHint, resolveOAuthCredentials, questionFolderSegments};
