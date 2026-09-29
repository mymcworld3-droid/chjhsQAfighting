// Isolated visual audit. This only changes DOM state in the local browser run;
// it does not grant a player session or call privileged server endpoints.
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '../public');
const output = path.resolve(process.env.LAYOUT_OUTPUT || 'layout-screenshots');
const pages = ['onboarding', 'home', 'training', 'quiz', 'store', 'cards', 'battle', 'rank', 'settings', 'history', 'admin'];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(filename);
    res.setHeader('Content-Type', types[path.extname(filename)] || 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});

(async () => {
  await mkdir(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const results = [];
  try {
    for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const page = await context.newPage();
      // Keep the static UI intact. The application module requires a real
      // Firebase player and removes some legacy pages during guest startup.
      await page.route('**/main.js*', route => route.abort());
      await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: path.join(output, `${viewport.name}-login.png`), animations: 'disabled' });
      for (const id of pages) {
        await page.evaluate(id => {
          document.body.classList.add('xianxia-theme');
          document.documentElement.classList.add('training-access-ready', 'golden-core-access-ready');
          document.getElementById('login-screen')?.classList.add('hidden');
          document.getElementById('bottom-nav')?.classList.remove('hidden');
          document.querySelectorAll('.page-section').forEach(element => {
            element.classList.add('hidden'); element.classList.remove('active-page');
            element.style.display = 'none';
          });
          const target = document.getElementById(`page-${id}`);
          if (!target) throw new Error(`Missing static page: ${id}`);
          target.classList.remove('hidden'); target.classList.add('active-page');
          target.style.display = 'block';
          if (id === 'quiz') {
            document.getElementById('quiz-container').classList.remove('hidden');
            document.getElementById('quiz-badge').textContent = '數學｜一次函數';
            document.getElementById('question-text').textContent = '若 f(x) = 2x + 3，則 f(4) 的值為何？';
            const options = document.getElementById('options-container');
            options.replaceChildren();
            ['7', '9', '11', '13'].forEach((answer, index) => {
              const button = document.createElement('button');
              button.className = 'w-full text-left p-4 bg-slate-700 rounded-lg border border-slate-600 flex items-center gap-3 mb-2';
              const letter = document.createElement('span');
              letter.className = 'bg-slate-800 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-blue-400 shrink-0';
              letter.textContent = String.fromCharCode(65 + index);
              const value = document.createElement('span'); value.className = 'flex-1 quiz-rich-option'; value.textContent = answer;
              button.append(letter, value); options.append(button);
            });
          }
          document.querySelector('main').scrollTop = 0;
        }, id);
        await page.screenshot({ path: path.join(output, `${viewport.name}-${id}.png`), animations: 'disabled' });
        const measurements = await page.evaluate(id => {
          const target = document.getElementById(`page-${id}`);
          const rect = target.getBoundingClientRect();
          return { visible: rect.width > 0 && rect.height > 0, width: Math.round(rect.width), contentWidth: target.scrollWidth,
            viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, contentHeight: target.scrollHeight,
            text: (target.innerText || '').trim().slice(0, 180) };
        }, id);
        results.push({ viewport: viewport.name, page: id, ...measurements });
      }
      await context.close();
    }
    await writeFile(path.join(output, 'measurements.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results.map(({ viewport, page, visible, width, contentWidth, viewportWidth, documentWidth }) => ({ viewport, page, visible, width, contentWidth, viewportWidth, documentWidth })), null, 2));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
