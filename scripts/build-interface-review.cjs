// Build a static screenshot gallery and render its two portrait contact sheets.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const directory = path.resolve(__dirname, '../docs/design/interface-cleanup');
const groups = [
  ['日常與交流', 'overview-pages.jpg', [
    ['settings', '設定'], ['store', '坊市'], ['market', '玩家交易'],
    ['social', '仙盟好友'], ['chat', '全服聊天'], ['history', '答題紀錄'],
    ['rank', '九州仙榜'], ['raid', '秘境試煉'], ['quiz', '問道答題'], ['battle', '論道鬥法']
  ]],
  ['修煉與成長', 'overview-training.jpg', [
    ['training-map', '修煉地圖'], ['core', '金丹'], ['nascent', '元嬰／化神節點'],
    ['nascent-detail', '節點詳情'], ['refinery', '煉器'], ['equipment', '裝備'],
    ['bag', '背包'], ['contract', '契器台'], ['status', '狀態']
  ]]
];
const styles = `*{box-sizing:border-box}body{margin:0;background:#131410;color:#ece4d0;font:15px/1.6 system-ui,'Microsoft JhengHei',sans-serif}header,main{max-width:1440px;margin:auto;padding:28px}header{border-bottom:1px solid #cab17930}h1{margin:5px 0;font-size:27px;font-weight:500}h2{font-size:19px;font-weight:500;margin:12px 0 20px}p{color:#aaa48f;margin:8px 0}a{color:inherit}small{color:#a69c82}nav{display:flex;gap:12px;margin-top:22px}button{font:inherit;cursor:pointer;padding:9px 20px;color:#c5baa0;background:transparent;border:1px solid #cab17940;border-radius:6px}button[aria-pressed=true]{color:#e4cc95;background:#cab17918}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}figure{margin:0;background:#1b1c16;border:1px solid #cab17925;border-radius:8px;overflow:hidden}figcaption{padding:12px 16px;border-bottom:1px solid #cab17925;display:flex;justify-content:space-between;gap:8px}img{display:block;width:100%;height:auto}section{margin:0 0 40px}body[data-view=portrait] .grid{grid-template-columns:repeat(4,minmax(0,1fr))}@media(max-width:780px){header,main{padding:18px}.grid,body[data-view=portrait] .grid{grid-template-columns:repeat(2,minmax(0,1fr))}figcaption{font-size:12px;padding:10px}h1{font-size:23px}}`;
const figure = ([name, label], view = 'landscape', embedded = false) => {
  const filename = `${name}-${view}.jpg`;
  const src = embedded ? `data:image/jpeg;base64,${fs.readFileSync(path.join(directory, filename)).toString('base64')}` : filename;
  return `<figure><figcaption><span>${label}</span><small>${view === 'portrait' ? '直式' : '橫式'}</small></figcaption><a href="${filename}" target="_blank" rel="noopener"><img src="${src}" data-name="${name}" alt="${label}的${view === 'portrait' ? '直式' : '橫式'}遊戲截圖"></a></figure>`;
};
const sections = [['宗門首頁', '', [['home', '首頁']]], ...groups];
const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>青雲問道 · 畫面整理預覽</title><style>${styles}</style><body data-view="landscape"><header><small>青雲問道 · 整理分支預覽</small><h1>讓每一頁都更容易看懂</h1><p>統一資訊層級、間距與操作區。點擊截圖可查看原尺寸。</p><p>本機 Chromium 實際畫面，使用示例玩家資料。分支：design/interface-cleanup-20261023。</p><nav aria-label="截圖方向"><button type="button" data-view="landscape" aria-pressed="true">橫式</button><button type="button" data-view="portrait" aria-pressed="false">直式</button></nav></header><main>${sections.map(([label, , pages]) => `<section><h2>${label}</h2><div class="grid">${pages.map(p => figure(p)).join('')}</div></section>`).join('')}</main><script>document.querySelectorAll('button[data-view]').forEach(button=>button.addEventListener('click',()=>{const view=button.dataset.view;document.body.dataset.view=view;document.querySelectorAll('button[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelectorAll('img[data-name]').forEach(img=>{const file=img.dataset.name+'-'+view+'.jpg';img.src=file;img.parentElement.href=file;img.closest('figure').querySelector('small').textContent=view==='portrait'?'直式':'橫式';});}));</script></body></html>`;
fs.writeFileSync(path.join(directory, 'index.html'), html);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.UI_CAPTURE_BROWSER || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
    const fontDirectory = path.join(process.env.UI_CAPTURE_DEPS || '/tmp/ui-preview/node_modules', '@fontsource/noto-sans-tc');
    const fontCss = fs.readFileSync(path.join(fontDirectory, '400.css'), 'utf8').replace(/url\(\.\/(.*?)\)/g, (_, filename) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(fontDirectory, filename)).toString('base64')})`);
    for (const [label, filename, pages] of groups) {
      await page.setContent(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><style>${fontCss}${styles}body{font-family:'Noto Sans TC',sans-serif}header,main{padding:22px}.grid{gap:16px}figcaption{font-size:14px;padding:9px 12px}h1{font-size:25px}header p{font-size:12px}main{padding-top:18px}</style><body data-view="portrait"><header><small>青雲問道 · 畫面整理預覽</small><h1>${label}</h1><p>直式實際截圖 · 示範玩家資料 · 點開圖庫可切換橫式</p></header><main><div class="grid">${pages.map(p => figure(p, 'portrait', true)).join('')}</div></main></body></html>`);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(directory, filename), fullPage: true, type: 'jpeg', quality: 90 });
    }
    await page.goto('file://' + path.join(directory, 'index.html'));
    await page.getByRole('button', { name: '直式', exact: true }).click();
    if (await page.locator('img[src$="-portrait.jpg"]').count() !== 20) throw Error('Gallery view switch failed');
    console.log('Gallery and two screenshot overviews created; direction switch verified.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
