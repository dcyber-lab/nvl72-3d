// Walks the guided tour and the assembly replay, saving one screenshot per step.
const { chromium } = require('playwright');
const [out, base = 'http://127.0.0.1:8765/index.html'] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push('[error] ' + m.text()); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 6).join('\n')));
  page.on('requestfailed', (r) => logs.push('[requestfailed] ' + r.url()));
  await page.goto(`${base}?bloom=0&quality=low&warp=3`, { waitUntil: 'load' });
  await page.waitForFunction(() => (window.__frames || 0) > 4, null, { timeout: 90000 });
  await page.click('#t-tour');
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(i === 1 ? 9000 : 5200);
    await page.screenshot({ path: `${out}/t${i + 1}.png` });
    const st = await page.evaluate(() => { const a = window.__nvl; return { step: a.tour.i, xray: a.xray, links: a.model.countLinksUp(), sel: a.selection, alerts: a.sim.alerts.map((x) => x.title) }; });
    console.log('step', i + 1, JSON.stringify(st));
    if (i < 7) await page.click('#tour-next');
  }
  await page.click('#tour-next');
  await page.waitForTimeout(1500);
  console.log('tour active after end:', await page.evaluate(() => window.__nvl.tour.active));
  console.log(logs.length ? logs.join('\n') : 'no page errors');
  await browser.close();
})();
