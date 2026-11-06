'use strict';

// AI-only permanent question bank, stored as one approved JSON file per question
// in the configured Google Drive folder. Not used by custom/static banks.
// This is a server integration, not the ChatGPT Google Drive connector.
const crypto = require('node:crypto');
const DEFAULT_FOLDER = '1Z8TgddizbBKYA2h1Ij6nPqXjhGUAVTqF';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

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
  const oauth = !!(env.AI_QUESTION_BANK_GOOGLE_CLIENT_ID &&
    env.AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET && env.AI_QUESTION_BANK_GOOGLE_REFRESH_TOKEN);
  const serviceJson = env.AI_QUESTION_BANK_SERVICE_ACCOUNT_JSON || env.FIREBASE_A_SERVICE_ACCOUNT_JSON || '';
  const enabled = env.AI_QUESTION_BANK_ENABLED === '1' && (oauth || !!serviceJson);
  const buckets = new Map();
  const inflight = new Map();
  const activity = [];
  let bearer = '', expiresAt = 0, active = 0;
  const LOW_WATER = 4;
  const CACHE_MS = 2 * 60 * 1000;
  const MAX_PER_HOUR = 24;

  async function accessToken() {
    if (!enabled) throw Error('AI question bank not enabled');
    if (bearer && now() + 60000 < expiresAt) return bearer;
    let form;
    if (oauth) {
      form = new URLSearchParams({
        client_id: env.AI_QUESTION_BANK_GOOGLE_CLIENT_ID,
        client_secret: env.AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET,
        refresh_token: env.AI_QUESTION_BANK_GOOGLE_REFRESH_TOKEN,
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
    if (!response.ok) throw Error('Google Drive OAuth token unavailable: ' + response.status);
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

  async function readBucket(target) {
    const id = scopeCode(target);
    const cached = buckets.get(id);
    if (cached && cached.until > now()) return cached.items;
    const prefix = 'aiq_' + id + '_';
    const query = "'" + folderId.replace(/'/g, "\\'") + "' in parents and trashed = false and name contains '" + prefix + "'";
    let page = '', files = [];
    for (let i = 0; i < 3; i++) {
      const args = new URLSearchParams({
        q:query,pageSize:'1000',fields:'nextPageToken,files(id,name,mimeType)',
        ...(page ? {pageToken:page} : {})
      });
      const response = await driveRequest(DRIVE + '?' + args.toString());
      const data = await response.json();
      files.push(...(Array.isArray(data.files) ? data.files.filter(f =>
        f.name?.startsWith(prefix) && f.mimeType === 'application/json') : []));
      page = data.nextPageToken || '';
      if (!page) break;
    }
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

  async function find(target, excluded = [], isSimilar = () => false) {
    if (!enabled) return {ready:false,question:null,count:0};
    try {
      const items = (await readBucket(target)).filter(entry => compatible(entry, target));
      const eligible = items.filter(entry => !excluded.some(q => isSimilar(entry.question.q, q)));
      const chosen = eligible.length ? eligible[crypto.randomInt(eligible.length)] : null;
      return {ready:true,question:chosen?.question || null,count:eligible.length,total:items.length};
    } catch (error) {
      logger.warn('[AI bank] read unavailable:', String(error.message).slice(0,120));
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
    const metadata = {name:'aiq_' + id + '_' + key.slice(0,24) + '.json',
      mimeType:'application/json',parents:[folderId],description:'AI question bank: one independent review'};
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
      .catch(err => logger.warn('[AI bank] background task failed:',String(err?.message || err).slice(0,120)))
      .finally(()=>{inflight.delete(job);active--;});
    inflight.set(job,work);
    return true;
  }

  return {enabled, LOW_WATER, find, publish, schedule, scopeCode, compatible};
}
module.exports = {createAIQuestionBank, scopeCode, fingerprint, compatible};
