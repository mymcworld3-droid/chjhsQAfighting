'use strict';

/**
 * Same deployment identity and cache policy across every game branch.
 * Do not cache HTML or the Service Worker: that is the main cause of old screens
 * reappearing after a successful branch deployment.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const PUBLIC_DIR = path.join(__dirname, 'public');
const NO_STORE = 'no-store, max-age=0, must-revalidate';
const REVALIDATE = 'no-cache, must-revalidate';
const GUARD_SCRIPT = '<script defer src="/deploy-guard.js"></script>';
const IGNORE = new Set(['sw.js', 'module-versions.json']);

function fromGit(args) {
  try {
    return String(execFileSync('git', args, {
      cwd: __dirname,
      encoding: 'utf8',
      timeout: 1200,
      stdio: ['ignore', 'pipe', 'ignore']
    })).trim();
  } catch (_) { return ''; }
}

function localFingerprint() {
  const hash = crypto.createHash('sha256');
  const paths = ['server.js', 'package.json', 'public/module-versions.json', 'public/index.html'];
  for (const item of paths) {
    try {
      hash.update(item);
      hash.update(fs.readFileSync(path.join(__dirname, item)));
    } catch (_) { /* optional file */ }
  }
  return hash.digest('hex');
}

function identity(env = process.env) {
  const commit = String(env.RENDER_GIT_COMMIT || env.GITHUB_SHA || env.GIT_COMMIT ||
    fromGit(['rev-parse', 'HEAD']) || '').trim();
  const branch = String(env.RENDER_GIT_BRANCH || env.GITHUB_HEAD_REF ||
    env.GITHUB_REF_NAME || env.GIT_BRANCH || fromGit(['branch', '--show-current']) || 'unknown').trim();
  const expectedBranch = String(env.EXPECTED_GIT_BRANCH || '').trim();
  const revision = /^[a-f0-9]{40}$/i.test(commit) ? commit : localFingerprint();
  return {
    branch,
    commit: /^[a-f0-9]{40}$/i.test(commit) ? commit : '',
    revision,
    expectedBranch: expectedBranch || null,
    branchMatchesExpected: expectedBranch && branch !== 'unknown' ? branch === expectedBranch : null
  };
}

function cachePolicy(urlPath) {
  const pathname = String(urlPath || '/').split('?')[0];
  if (pathname === '/' || /^\/(?:index|app|stage|maintenance)\.html$/i.test(pathname) ||
      /^\/(?:sw\.js|module-versions\.json|api\/deploy-info)$/i.test(pathname)) return NO_STORE;
  if (pathname.startsWith('/api/')) return null;
  if (/\.(?:js|mjs|css|json|png|webp|svg|gif|jpe?g|ico|woff2?)$/i.test(pathname))
    return REVALIDATE;
  return null;
}

function injectGuard(html) {
  const source = String(html || '');
  if (source.includes('src="/deploy-guard.js"')) return source;
  return source.replace(/<\/head\s*>/i, GUARD_SCRIPT + '\n</head>');
}

function sendPage(filename) {
  if (!/^(index|stage|maintenance)\.html$/.test(filename)) throw Error('Unexpected HTML page');
  const absolutePath = path.join(PUBLIC_DIR, filename);
  return (_req, res) => {
    res.set('Cache-Control', NO_STORE);
    res.type('html').send(injectGuard(fs.readFileSync(absolutePath, 'utf8')));
  };
}

function registerDeploymentGuard(app) {
  const current = identity();
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const policy = cachePolicy(req.path);
      if (policy) res.set('Cache-Control', policy);
    }
    next();
  });
  app.get('/api/deploy-info', (_req, res) => {
    res.set('Cache-Control', NO_STORE);
    res.json(current);
  });
  console.info('[Deployment]', JSON.stringify({
    branch: current.branch,
    commit: current.commit ? current.commit.slice(0, 12) : '(git unavailable)',
    revision: current.revision.slice(0, 12),
    expectedBranch: current.expectedBranch,
    branchMatchesExpected: current.branchMatchesExpected
  }));
  if (current.branchMatchesExpected === false) {
    console.error('[Deployment] WRONG BRANCH: expected', current.expectedBranch, 'got', current.branch);
  }
}

module.exports = registerDeploymentGuard;
module.exports.cachePolicy = cachePolicy;
module.exports.injectGuard = injectGuard;
module.exports.sendPage = sendPage;
module.exports.identity = identity;
module.exports.NO_STORE = NO_STORE;
module.exports.REVALIDATE = REVALIDATE;
