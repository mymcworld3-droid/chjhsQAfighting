'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createBankCatalog(publicDir) {
  const root = path.join(publicDir, 'banks');
  const cache = new Map();
  function files(dir = root) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return files(full);
      return entry.isFile() && entry.name.endsWith('.json')
        ? [path.relative(root, full).split(path.sep).join('/')] : [];
    }).sort();
  }
  function valid(q) {
    return q && typeof q.q === 'string' && q.q.trim() && typeof q.correct === 'string' && q.correct.trim()
      && Array.isArray(q.wrong) && q.wrong.length > 0 && q.wrong.every(v => typeof v === 'string' && v.trim())
      && new Set([q.correct, ...q.wrong]).size === q.wrong.length + 1;
  }
  function read(file) {
    const full = path.join(root, file);
    const stat = fs.statSync(full);
    const old = cache.get(file);
    if (old?.mtime === stat.mtimeMs && old.size === stat.size) return old.questions;
    const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
    const questions = Array.isArray(raw) ? raw.filter(valid) : [];
    cache.set(file, { mtime: stat.mtimeMs, size: stat.size, questions });
    return questions;
  }
  function imageExists(url) {
    if (typeof url !== 'string' || !/^\/assets\/banks\/[a-z0-9-]+\/[A-Za-z0-9-]+\.(?:png|jpe?g|webp)$/.test(url)) return false;
    return fs.existsSync(path.join(publicDir, url.slice(1)));
  }
  function ready(q) {
    return !q.reviewRequired && (!q.requiredImages?.length || q.requiredImages.every(imageExists));
  }
  function fingerprint(q) {
    if (q.source?.exam && Number.isInteger(q.source.question)) return `${q.source.exam}:${q.source.question}`;
    const normalize = v => String(v).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    return crypto.createHash('sha256').update(normalize(q.q) + '\0' + [q.correct, ...q.wrong].map(normalize).sort().join('\0')).digest('hex');
  }
  function load(source) {
    const all = files();
    const selected = typeof source === 'string' && source && !source.includes('..') && !source.includes('\\')
      ? all.filter(file => file === source || file.startsWith(source + '/')) : [];
    if (!selected.length) return { files: [], questions: [], total: 0, pendingImages: 0, pendingReview: 0, duplicates: 0 };
    const seen = new Set();
    const result = { files: selected, questions: [], total: 0, pendingImages: 0, pendingReview: 0, duplicates: 0 };
    for (const file of selected) {
      for (const q of read(file)) {
        const key = fingerprint(q);
        if (seen.has(key)) { result.duplicates++; continue; }
        seen.add(key); result.total++;
        if (q.reviewRequired) { result.pendingReview++; continue; }
        if (!ready(q)) { result.pendingImages++; continue; }
        result.questions.push(q);
      }
    }
    return result;
  }
  function list() {
    const paths = files();
    return { files: paths, banks: paths.map(file => {
      const data = load(file);
      return { file, total: data.total, available: data.questions.length, pendingImages: data.pendingImages, pendingReview: data.pendingReview };
    }) };
  }
  return { list, load };
}

function registerBankApi(app, publicDir) {
  const catalog = createBankCatalog(publicDir);
  app.get('/api/banks', (_req, res) => {
    try { res.set('Cache-Control', 'no-store'); res.json(catalog.list()); }
    catch (error) { console.error('[Banks]', error); res.status(500).json({ error: '題庫列表暫時無法讀取，請稍後再試。' }); }
  });
  app.get('/api/bank-questions', (req, res) => {
    try {
      const result = catalog.load(req.query.source);
      res.set('Cache-Control', 'no-store');
      if (!result.files.length) return res.status(404).json({ error: '找不到所選題庫，請重新選擇。' });
      if (!result.questions.length) return res.status(409).json({ ...result, error: '所選題庫正在等候補圖或校對，請先選擇其他題庫。' });
      res.json(result);
    } catch (error) { console.error('[Bank Questions]', error); res.status(500).json({ error: '題庫讀取失敗，請稍後重試。' }); }
  });
  return catalog;
}
module.exports = { createBankCatalog, registerBankApi };
