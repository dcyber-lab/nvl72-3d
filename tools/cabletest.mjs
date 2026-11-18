// Regression checks for the cable state machine and rope solver (no browser needed):
//   node --experimental-loader ./tools/three-loader.mjs tools/cabletest.mjs
import * as THREE from 'three';
import { Model } from '../src/topology.js';
import { FlowTable } from '../src/ribbon.js';
import { Leds } from '../src/units.js';
import { Cabling, buildNetDevices } from '../src/cables.js';

const model = new Model();
const flow = new FlowTable();
const leds = new Leds();
const mat = new THREE.MeshBasicMaterial();
const M = { bezel: mat, chassis: mat, matte: mat };
const net = buildNetDevices(M, leds);
const cab = new Cabling(model, flow, M, leds, net.devs);
const events = [];
cab.onEvent = (e) => events.push(e.type);

let t = 0, failed = 0;
const step = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) { t += 1 / 60; cab.update(1 / 60, t); } };
const ok = (c, m) => { if (c) console.log('ok  ', m); else { failed++; console.error('FAIL', m); } };
const invariants = (label) => {
  const bad = [];
  for (const p of model.ports) if (p.cable && p.cable.port !== p) bad.push(`port ${p.ref} lists ${p.cable.label} which is elsewhere`);
  for (const c of model.cables) {
    if (c.port && c.port.cable !== c) bad.push(`${c.label} thinks it is in ${c.port.ref}`);
    if ((c.state === 'plugged' || c.state === 'inserting') && !c.port) bad.push(`${c.label} is ${c.state} with no port`);
    if ((c.state === 'free' || c.state === 'held' || c.state === 'extracting') && c.port) bad.push(`${c.label} is ${c.state} but holds ${c.port.ref}`);
    for (const v of c.rope.p) if (!Number.isFinite(v)) { bad.push(`${c.label} rope NaN`); break; }
  }
  ok(bad.length === 0, `${label}: bookkeeping consistent${bad.length ? ' — ' + bad.slice(0, 3).join('; ') : ''}`);
};
const cable = (unit, key) => model.cables.find((c) => c.home.unit.id === unit && c.home.key === key);
const port = (ref) => model.portByRef.get(ref);
const setPull = (id, v) => { const u = model.unitById.get(id); u.pull = u.pullTarget = v; cab.wakeUnit(u); };
const rayAt = (x, y) => new THREE.Ray(new THREE.Vector3(x, y, 3), new THREE.Vector3(0, 0, -1));

invariants('initial');
ok(cab.summary().ok === 233, 'all 233 cords start in their planned ports');

// 1. unplug / dangle / re-home
const a = cable('slot-24', 'ib3');
const L0 = a.rope.L;
cab.unplug(a); step(1.5);
ok(a.state === 'free' && !a.port && !port('slot-24:ib3').cable, 'unplugged cord is free and its port is empty');
cab.rehome(a); step(1);
ok(a.state === 'plugged' && a.port === a.home, 're-homed cord is seated again');
invariants('after re-home');

// 2. drag with the pointer API into a neighbour's port (mis-wire), then back
const b = cable('slot-23', 'ib3');
cab.unplug(b); step(1);
ok(cab.startDrag(a), 'drag starts on a seated plug');
step(0.4);
const target = port('slot-23:ib3');
for (let i = 0; i < 20; i++) { cab.dragTo(rayAt(target.x, target.unit.y + target.y)); step(0.03); }
ok(cab.snap === target, 'plug snaps to the free same-type port');
cab.endDrag(); step(1);
ok(a.state === 'plugged' && a.port === target && target.cable === a, 'cord is seated in the other tray (mis-wired)');
ok(cab.linkState(a) === 1, 'mis-wired cord reports "wrong peer"');
ok(a.rope.L === L0, 'cord length did not change by re-seating elsewhere');
invariants('mis-wired');

// 3. type compatibility: an OSFP plug must not go into an RJ45 or QSFP port
ok(cab.plug(a, port('slot-23:pxe')) === false && cab.plug(a, port('slot-23:bf1p1')) === false, 'OSFP plug is refused by RJ45 and QSFP112 ports');

// 4. review finding: re-home while the home tray is out must not orphan the cord
setPull('slot-24', 0.5); step(1.2);
const yanked = model.cables.filter((c) => c.home.unit.id === 'slot-24' && c.state !== 'plugged').length;
ok(yanked >= 10 && events.includes('yank'), `pulling a cabled tray yanks its cords (${yanked})`);
ok(cab.rehome(a) === false && a.state === 'plugged' && a.port === target, 're-home is refused while the home tray is out, cord stays where it is');
cab.replugUnit(model.unitById.get('slot-24')); step(1.5);
invariants('re-plug requested while tray is out');
ok(model.cables.filter((c) => c.home.unit.id === 'slot-24' && c !== a).every((c) => c.state === 'free'), 'nothing is plugged into a tray that is out of the rack');
// the tray starts sliding back: a re-plug queued now waits for it to arrive
{ const u = model.unitById.get('slot-24'); u.pullTarget = 0; cab.replugUnit(u); for (let i = 0; i < 60; i++) { u.pull *= 0.9; if (u.pull < 0.001) u.pull = 0; cab.wakeUnit(u); step(1 / 60); } u.pull = 0; }
step(3);
ok(model.cables.filter((c) => c.home.unit.id === 'slot-24').every((c) => c.state === 'plugged' && c.port === c.home), 'queued re-plug completes once the tray is back');
ok(b.state === 'free', 'the displaced cord is still dangling');
cab.rehome(b); step(1);
invariants('tray restored');
ok(cab.summary().ok === 233, 'everything is back in place');

// 5. reach: a cord cannot be dragged further than its length
cab.startDrag(a); step(0.4);
for (let i = 0; i < 30; i++) { cab.dragTo(rayAt(-0.2, 0.3)); step(0.03); }
const tail = a.rope.p.slice(-3), anchor = a.anchor;
const dist = Math.hypot(tail[0] - anchor.x, tail[1] - anchor.y, tail[2] - anchor.z);
ok(dist <= a.rope.L + 1e-6 && a.taut, `held plug stops at the cord's reach (${dist.toFixed(3)} m of ${a.rope.L.toFixed(3)} m)`);
cab.endDrag(); step(2.5);
ok(a.state === 'free', 'released away from any port: cord hangs free');
const speed = Math.hypot(a.rope.p[63] - a.rope.q[63], a.rope.p[64] - a.rope.q[64], a.rope.p[65] - a.rope.q[65]);
ok(speed < 0.01, `released cord settles (tip moves ${(speed * 1000).toFixed(2)} mm per step)`);
cab.rehome(a); step(1);

// 6. unplug everything, auto-wire back
cab.unplugAll(); step(6);
ok(cab.summary().open.length === 233, 'all cords unplugged');
invariants('all unplugged');
let lowest = 9;
for (const c of model.cables) for (let i = 1; i < c.rope.p.length; i += 3) lowest = Math.min(lowest, c.rope.p[i]);
ok(lowest >= 0.011, `no cord sinks through the floor (lowest point ${lowest.toFixed(3)} m)`);
cab.autoWire(0.02); step(9);
ok(cab.summary().ok === 233 && cab.active.size === 0 && cab.queue.length === 0, 'auto-wire restores all 233 cords and the solver goes idle');
invariants('auto-wired');

// 7. auto-wire also fixes mis-wired cords
cab.unplug(b); step(1); cab.unplug(a); step(1); cab.plug(a, port('slot-23:ib3')); step(1);
ok(cab.summary().wrong.length === 1, 'one cord mis-wired again');
cab.autoWire(0.02); step(3);
ok(cab.summary().ok === 233, 'auto-wire lifts the misplaced cord and re-homes both');
invariants('final');
console.log(failed ? `${failed} FAILED` : 'all cable checks passed');
process.exitCode = failed ? 1 : 0;
