// Stability test for the rope solver: unplug every cord, let them settle, auto-wire, replay assembly.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 420, height: 300 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 6).join('\n')));
  await page.goto('http://127.0.0.1:8765/index.html?bloom=0&quality=low&warp=3', { waitUntil: 'load' });
  await page.waitForFunction(() => (window.__frames || 0) > 4, null, { timeout: 200000 });
  const st = () => page.evaluate(() => {
    const a = window.__nvl; const s = a.cabling.summary();
    let nan = 0, oob = 0, asleep = 0, minY = 9, maxZ = -9;
    for (const c of a.model.cables) {
      const p = c.rope.p;
      for (let i = 0; i < p.length; i += 3) {
        if (!isFinite(p[i]) || !isFinite(p[i + 1]) || !isFinite(p[i + 2])) nan++;
        if (Math.abs(p[i]) > 0.8 || p[i + 1] < 0 || p[i + 2] > 1.4 || p[i + 2] < 0.3) oob++;
        minY = Math.min(minY, p[i + 1]); maxZ = Math.max(maxZ, p[i + 2]);
      }
      if (c.rope.asleep) asleep++;
    }
    return { frames: window.__frames, ok: s.ok, open: s.open.length, wrong: s.wrong.length, active: a.cabling.active.size, asleep, nan, oob, minY: +minY.toFixed(3), maxZ: +maxZ.toFixed(3), links: a.model.countLinksUp() };
  });
  const f0 = await page.evaluate(() => window.__frames); const t0 = Date.now();
  await page.waitForTimeout(3000);
  console.log('fps ~', (((await page.evaluate(() => window.__frames)) - f0) / ((Date.now() - t0) / 1000)).toFixed(1));
  await page.evaluate(() => window.__nvl.unplugAll());
  await page.waitForTimeout(14000);
  console.log('all unplugged:', JSON.stringify(await st()));
  await page.evaluate(() => window.__nvl.autoWire());
  await page.waitForTimeout(22000);
  console.log('auto-wired:   ', JSON.stringify(await st()));
  await page.evaluate(() => window.__nvl.assemble());
  await page.waitForTimeout(40000);
  console.log('assembled:    ', JSON.stringify(await st()));
  console.log(logs.length ? logs.join('\n') : 'no page errors');
  await browser.close();
})();
