// Sanity checks for the wiring rule and the traffic model (no browser needed).
import { Model, N_LINK, gpuName, swName, gpuOf, linkOf, swPortOfLink, gpuPortOfLink, trayIndexOfSlot } from '../src/topology.js';
import { Sim } from '../src/sim.js';

const model = new Model();
const cabling = { linkState: (c) => (c.port === c.home ? 2 : 0), summary: () => ({ total: model.cables.length, plugged: model.cables.length, ok: model.cables.length, wrong: [], open: [] }) };
const sim = new Sim(model, cabling);
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const run = (sec = 1) => { for (let i = 0; i < sec * 20; i++) sim.step(0.05, (sim.time || 0)); };

// wiring rule from the deck: slot 27 gpu-03 -> NVSwitch port 71 on every switch
const g = gpuOf(trayIndexOfSlot(27), 3);
assert(gpuName(g) === 'slot-27.gpu-03', `name ${gpuName(g)}`);
assert(swPortOfLink(linkOf(g, 0)) === 71 && swPortOfLink(linkOf(g, 17)) === 71, 'slot-27.gpu-03 uses switch port 71 everywhere');
// GPU port p -> slot 9 + floor((p-1)/2), odd -> swt-01
assert(swName(7 - 1) === 'slot-12.swt-01' && gpuPortOfLink(linkOf(g, 6)) === 7, 'port 7 -> slot-12.swt-01');
assert(swName(8 - 1) === 'slot-12.swt-02', 'port 8 -> slot-12.swt-02');
assert(swName(0) === 'slot-09.swt-01' && swName(17) === 'slot-17.swt-02', 'switch naming');
// example from the deck: NVSwitch port 62 <-> slot 25 gpu-02 port 1
assert(gpuName(61) === 'slot-25.gpu-02' && swPortOfLink(linkOf(61, 0)) === 62, 'slot-25.gpu-02 <-> switch port 62');
assert(model.cables.length === 233, `233 front cables (${model.cables.length})`);
assert(model.cables.filter((c) => c.net === 'ib').length === 72 && model.cables.filter((c) => c.net === 'eth').length === 72 && model.cables.filter((c) => c.net === 'oob').length === 89, 'cable counts 72/72/89');
const used = new Set(model.cables.filter((c) => c.far.dev.startsWith('mgmt')).map((c) => c.far.dev + ':' + c.far.port));
assert(used.size === 89, 'no management switch port is used twice');

sim.burst = false;
sim.pattern = 'all2all'; sim.intensity = 1; sim.dirty = true; run();
assert(Math.abs(sim.stats.nvGbps - 518400) < 1, `all-to-all at 100% fills every link: ${(sim.stats.nvGbps / 1000).toFixed(1)} Tb/s`);
assert(Math.abs(sim.tx[100] - 1) < 1e-6 && Math.abs(sim.rx[900] - 1) < 1e-6, 'every link at 100% both ways');

sim.pattern = 'pair'; sim.pairA = 0; sim.pairB = 71; sim.dirty = true; run();
assert(Math.abs(sim.stats.nvGbps - 14400) < 1, `pair: 2 x 7.2 Tb/s = ${(sim.stats.nvGbps / 1000).toFixed(1)} Tb/s`);

sim.pattern = 'incast'; sim.incastTarget = 38; sim.dirty = true; run();
assert(Math.abs(sim.stats.nvGbps - 7200) < 1, `incast is capped by the target's 18 downlinks: ${(sim.stats.nvGbps / 1000).toFixed(1)} Tb/s`);
assert(sim.stats.congested > 0, `incast congests ${sim.stats.congested} ports`);

// fault shapes
sim.pattern = 'all2all'; sim.dirty = true;
model.unitById.get('slot-27').fault = 'offline'; model.recomputePhys(0, true); run();
assert(model.countLinksUp() === 1224, `tray offline: ${model.countLinksUp()} links`);
let sh = sim.shape();
assert(sh.trays.length === 1 && sh.rows.length === 4 && sh.cells === 0, 'shape = 4 rows / 1 compute tray');
assert(Math.abs(sim.stats.nvGbps - 68 * 7200) < 1, `68 GPUs still fill their links: ${(sim.stats.nvGbps / 1000).toFixed(1)} Tb/s`);
model.clearFaults(0); model.recomputePhys(0, true);
for (let l = 0; l < N_LINK; l++) model.linkState[l] = model.linkPhys[l] ? 2 : 0;

model.unitById.get('slot-13').fault = 'failed'; model.recomputePhys(0, true); sim.dirty = true; run();
sh = sim.shape();
assert(model.countLinksUp() === 1152 && sh.swTrays.length === 1 && sh.cols.length === 2, `switch tray: ${model.countLinksUp()} links, 2 columns`);
assert(Math.abs(sim.stats.nvGbps - 72 * 16 * 400) < 1, `each GPU keeps 16/18: ${(sim.stats.nvGbps / 1000).toFixed(1)} Tb/s`);
model.clearFaults(0); model.recomputePhys(0, true);
for (let l = 0; l < N_LINK; l++) model.linkState[l] = model.linkPhys[l] ? 2 : 0;

model.gpuFault[70] = 1; model.recomputePhys(0, true); sim.dirty = true; run();
sh = sim.shape();
assert(model.countLinksUp() === 1278 && sh.rows.length === 1 && sh.trays.length === 0, 'GPU reset: 1 row, 18 links');
model.clearFaults(0); model.recomputePhys(0, true);
for (let l = 0; l < N_LINK; l++) model.linkState[l] = model.linkPhys[l] ? 2 : 0;

model.linkFault[61 * 18 + 6] = 1; model.recomputePhys(0, true); sim.dirty = true; run();
sh = sim.shape();
assert(model.countLinksUp() === 1295 && sh.cells === 1, 'single link: 1 cell');
// a pair flow between the degraded GPU and another keeps 17 of 18 paths
sim.pattern = 'pair'; sim.pairA = 61; sim.pairB = 3; sim.dirty = true; run();
assert(Math.abs(sim.stats.nvGbps - 2 * 17 * 400) < 1, `degraded pair: ${(sim.stats.nvGbps / 1000).toFixed(1)} Tb/s (17/18)`);
model.clearFaults(0);

// power: 8 shelves, full load
for (let l = 0; l < N_LINK; l++) model.linkState[l] = 2;
sim.pattern = 'all2all'; sim.intensity = 1; sim.dirty = true; run(12);
console.log('     power at full load', sim.stats.powerKW.toFixed(1), 'kW of', sim.stats.capKW, '· return', sim.stats.returnC.toFixed(1), '°C');
assert(sim.stats.powerKW > 112 && sim.stats.powerKW < 124, 'full-load rack power is about 120 kW');
for (const s of model.shelves.slice(0, 5)) s.seated = false;
run(12);
assert(sim.stats.cap < 1 && sim.stats.powerKW <= 99.5, `3 shelves: capped to ${sim.stats.powerKW.toFixed(1)} kW (cap ${(sim.stats.cap * 100).toFixed(0)}%)`);
console.log('alerts:', sim.alerts.map((a) => a.title).join(' | '));
