// Mouse test: drag a tray out by its latch, hover a GPU in x-ray, double-click a cable cartridge.
const { chromium } = require('playwright');
const out = process.argv[2] || '.';
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 6).join('\n')));
  await page.goto('http://127.0.0.1:8765/index.html?bloom=0&quality=low&warp=4&cam=1.1,1.5,1.9,0.1,1.3,0.45', { waitUntil: 'load' });
  await page.waitForFunction(() => (window.__frames || 0) > 4, null, { timeout: 200000 });
  const proj = (p) => page.evaluate((p) => window.__nvl._project(p), p);
  const wait = (ms) => page.waitForTimeout(ms);

  // 1. latch drag on slot-19 (right ear)
  const latch = await page.evaluate(() => { const u = window.__nvl.model.unitById.get('slot-19'); return [0.2138, u.y + 0.0222, 0.511]; });
  let s = await proj(latch);
  await page.mouse.move(s.x, s.y); await wait(300);
  console.log('hover latch:', await page.evaluate(() => { const h = window.__nvl.interaction.hover; return h && { type: h.type, latch: h.latch, id: h.unit && h.unit.id }; }), 'cursor', await page.evaluate(() => document.getElementById('stage').style.cursor));
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(s.x - i * 9, s.y + i * 9); await wait(60); }
  await wait(800);
  console.log('dragging:', await page.evaluate(() => { const u = window.__nvl.model.unitById.get('slot-19'); const a = window.__nvl; return { pull: +u.pull.toFixed(3), seated: u.seated, yanked: a.model.cables.filter((c) => c.home.unit === u && c.state !== 'plugged').length, links: a.model.countLinksUp() }; }));
  await page.screenshot({ path: `${out}/e1-latch.png` });
  await page.mouse.up();
  await wait(600);
  // push it back with the inspector button, then re-plug
  await page.click('#inspect [data-act="pull"]');
  await wait(3500);
  await page.click('#inspect [data-act="cables"]');
  await wait(5000);
  console.log('restored:', await page.evaluate(() => { const u = window.__nvl.model.unitById.get('slot-19'); const a = window.__nvl; return { pull: +u.pull.toFixed(3), seated: u.seated, open: a.cabling.summary().open.length }; }));

  // 2. x-ray + hover a GPU
  await page.evaluate(() => { const a = window.__nvl; a.setXray(true, true); a.setView('rear', true); });
  await wait(1500);
  const gp = await page.evaluate(() => { const a = window.__nvl; const u = a.model.compute[15]; return [-0.056, u.y + 0.024, -0.04]; });
  s = await proj(gp);
  await page.mouse.move(s.x, s.y); await wait(600);
  console.log('hover gpu:', await page.evaluate(() => { const h = window.__nvl.interaction.hover; return h && { type: h.type, id: h.id }; }), (await page.evaluate(() => document.getElementById('tooltip').innerText)).replace(/\n/g, ' | '));
  await page.screenshot({ path: `${out}/e2-hover.png` });
  await page.mouse.click(s.x, s.y); await wait(500);
  console.log('selected:', await page.evaluate(() => window.__nvl.selection));

  // 3. double-click cartridge handle (rear)
  await page.evaluate(() => { const a = window.__nvl; a.setXray(false, true); a.select(null); });
  await wait(800);
  const ch = await page.evaluate(() => { const a = window.__nvl; const [y0, y1] = a.rack.cartSpan; return [-0.158, (y0 + y1) / 2 + 0.3, -0.33 - 0.15 - 0.02]; });
  s = await proj(ch);
  await page.mouse.dblclick(s.x, s.y); await wait(5000);
  console.log('cartridge:', await page.evaluate(() => { const a = window.__nvl; return { seated: a.model.cart.map((c) => c.seated), links: a.model.countLinksUp(), shape: document.getElementById('mx-shape').textContent, alerts: a.sim.alerts.map((x) => x.title) }; }));
  await page.screenshot({ path: `${out}/e3-cart.png` });
  console.log(logs.length ? logs.join('\n') : 'no page errors');
  await browser.close();
})();
