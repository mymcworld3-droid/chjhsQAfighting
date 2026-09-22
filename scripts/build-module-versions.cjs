#!/usr/bin/env node
'use strict';
// 更新靜態模組時執行 npm run build:module-versions。
// 檔案版號使用 Git blob SHA-1，與 GitHub API tree.sha 一致，逐檔更新而非全量清空。
const { readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, relative, extname } = require('node:path');
const { createHash } = require('node:crypto');

const root = join(__dirname, '..', 'public');
const output = join(root, 'module-versions.json');
const extensions = new Set(['.html', '.js', '.css', '.json', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const excluded = new Set(['sw.js', 'module-versions.json']);
const files = {};
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { walk(path); continue; }
    if (!entry.isFile() || !extensions.has(extname(path).toLowerCase())) continue;
    const name = relative(root, path).split('\\').join('/');
    if (excluded.has(name)) continue;
    const bytes = readFileSync(path);
    const gitSha = createHash('sha1')
      .update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
    files[name] = gitSha;
  }
}
walk(root);
const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en')));
const build = createHash('sha1').update(JSON.stringify(ordered)).digest('hex');
const result = JSON.stringify({ schema: 1, build, files: ordered }) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== result) {
    console.error('module-versions.json 已過期；請執行 npm run build:module-versions');
    process.exitCode = 1;
  } else console.log('module-versions.json 與靜態資源一致');
} else {
  writeFileSync(output, result);
  console.log('已更新 ' + Object.keys(ordered).length + ' 個靜態資源的版本號');
}
