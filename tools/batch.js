// usage: node tools/batch.js <outDir> <w> <h> name=query[::js] ...
const { chromium } = require('playwright');
(async () => {
  const [outDir, w, h, ...jobs] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const job of jobs) {
    const [name, rest] = [job.slice(0, job.indexOf('=')), job.slice(job.indexOf('=') + 1)];
    const [query, js, wait] = rest.split('::');
    const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
    const logs = [];
    page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
    page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n')));
    await page.goto(`http://127.0.0.1:8765/index.html?${query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => (window.__frames || 0) > 3, null, { timeout: 90000 }).catch(() => logs.push('[timeout] no frames'));
    if (js) { const r = await page.evaluate(js).catch((e) => 'EVAL ERROR ' + e.message); if (r !== undefined && r !== null) console.log(name, 'eval:', JSON.stringify(r)); }
    await page.waitForTimeout(+(wait || 1800));
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log(name, 'frames', await page.evaluate(() => window.__frames), logs.length ? '\n' + logs.slice(0, 8).join('\n') : '');
    await page.close();
  }
  await browser.close();
})();
