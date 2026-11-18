const { chromium } = require('playwright');
const out = process.argv[2];
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 6).join('\n')));
  await page.goto('http://127.0.0.1:8765/index.html?bloom=0&quality=low&warp=4&cam=0.25,1.62,1.25,0.08,1.5,0.5', { waitUntil: 'load' });
  await page.waitForFunction(() => (window.__frames || 0) > 4, null, { timeout: 90000 });
  const proj = (p) => page.evaluate((p) => window.__nvl._project(p), p);
  const wait = (ms) => page.waitForTimeout(ms);
  // free slot-22:ib3 programmatically, then drag slot-24's ib3 plug into it with the mouse
  const info = await page.evaluate(() => {
    const a = window.__nvl;
    const c = a.model.cables.find((x) => x.home.unit.id === 'slot-24' && x.home.key === 'ib3');
    const far = a.model.portByRef.get('slot-22:ib3');
    a.cabling.unplug(a.model.cables.find((x) => x.home === far));
    return { id: c.id, plug: [c.origin.x, c.origin.y, c.origin.z + 0.03], far: [far.x, far.unit.y + far.y, 0.5 + 0.08] };
  });
  await wait(2500);
  let s = await proj(info.plug), t = await proj(info.far);
  await page.mouse.move(s.x, s.y); await wait(250);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(s.x + ((t.x - s.x) * i) / 12, s.y + ((t.y - s.y) * i) / 12); await wait(70); }
  await wait(700);
  console.log('snap:', await page.evaluate(() => { const a = window.__nvl; return { snap: a.cabling.snap && a.cabling.snap.ref, state: a.cabling.dragging && a.cabling.dragging.state, hints: a.cabling.hints.count, taut: a.cabling.dragging && a.cabling.dragging.taut }; }));
  await page.screenshot({ path: `${out}/r1-snap.png` });
  await page.mouse.up();
  await wait(2500);
  await page.screenshot({ path: `${out}/r2-miswired.png` });
  console.log('result:', await page.evaluate((id) => { const a = window.__nvl; const c = a.model.cables[id]; const s = a.cabling.summary(); return { state: c.state, at: c.port && c.port.ref, ok: s.ok, wrong: s.wrong.length, open: s.open.length, alerts: a.sim.alerts.map((x) => x.title) }; }, info.id));
  // click the inspector button "插回规划端口"
  await page.click('#inspect [data-act="cable"]');
  await wait(2500);
  console.log('rehome:', await page.evaluate((id) => { const a = window.__nvl; const c = a.model.cables[id]; return { state: c.state, at: c.port && c.port.ref }; }, info.id));
  console.log(logs.length ? logs.join('\n') : 'no page errors');
  await browser.close();
})();
