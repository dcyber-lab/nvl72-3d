// Front-panel cabling: InfiniBand, Ethernet and out-of-band patch cords.
// Each cord is a static trunk (far switch -> overhead tray / cable manager ->
// vertical duct) plus a short "whip" from the duct to its plug. The whip is a
// Verlet rope while the plug is held or hanging free, and a dressed curve while
// it is seated in a port.

import * as THREE from 'three';
import { Batch } from './build.js';
import { Ribbon, makeRibbonMaterial, filletPath, pathLength } from './ribbon.js';
import { U, Z_FRONT, TRAY_W, TRAY_H, PALETTE, yOfU, NETRACK_X, TRAY_Y_OVERHEAD, DUCT_X } from './config.js';
import { PORT_DIM } from './topology.js';
import { hcmGeometry, YC } from './units.js';

const N = 22; // rope particles per whip
const NZ = 14; // duct lanes front-to-back
const LANE = 0.0045;
const SLACK = 0.17;
const hoverZ = (t) => Z_FRONT + PORT_DIM[t].insert + 0.024; // plane a held plug's reference point travels in
const out = (t) => PORT_DIM[t].plugL - PORT_DIM[t].insert;
const TAIL = { osfp: out('osfp') + 0.021, qsfp: out('qsfp') + 0.021, rj45: out('rj45') + 0.016 };
const NET_COLOR = { ib: PALETTE.ib, eth: PALETTE.eth, oob: 0x8793a0 };
const TYPE_NET = { osfp: 'ib', qsfp: 'eth', rj45: 'oob' };

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function plugGeometry(type, color) {
  const d = PORT_DIM[type];
  const o = out(type);
  const b = new Batch();
  if (type === 'rj45') {
    b.box(d.plugW, d.plugH, d.plugL, 0, 0, o - d.plugL / 2, 0xdfe6ec);
    b.box(d.plugW * 0.5, 0.002, d.plugL * 0.8, 0, d.plugH / 2 + 0.001, o - d.plugL / 2 + 0.003, 0xc3ccd4);
    b.box(d.plugW * 0.95, d.plugH * 0.95, 0.016, 0, 0, o + 0.008, color);
  } else {
    b.box(d.plugW, d.plugH, d.plugL, 0, 0, o - d.plugL / 2, 0xb7c0c9);
    b.box(d.plugW * 0.96, d.plugH * 0.94, 0.013, 0, 0, o + 0.0045, 0x1f252b);
    b.box(d.plugW * 0.5, 0.0016, 0.032, 0, d.plugH * 0.5 - 0.0006, o + 0.025, color);
    b.box(d.plugW * 0.5, 0.004, 0.003, 0, d.plugH * 0.5 - 0.0018, o + 0.0405, color);
    b.cyl(Math.min(d.plugH * 0.36, 0.0038), 0.014, 0, -d.plugH * 0.12, o + 0.016, 0x15191d, 'z', 8);
  }
  return b.geometry();
}

// ---- far-end devices in the neighbouring network rack -----------------------
const NET_DEVS = [
  { id: 'ib-leaf-1', u: 39, type: 'osfp', above: 40, name: 'IB Leaf 1', net: 'ib' },
  { id: 'ib-leaf-2', u: 37, type: 'osfp', above: 38, name: 'IB Leaf 2', net: 'ib' },
  { id: 'ib-leaf-3', u: 35, type: 'osfp', above: 36, name: 'IB Leaf 3', net: 'ib' },
  { id: 'ib-leaf-4', u: 33, type: 'osfp', above: 34, name: 'IB Leaf 4', net: 'ib' },
  { id: 'eth-a', u: 31, type: 'qsfp', above: 32, below: 30, name: '前端以太网交换机 A', net: 'eth' },
  { id: 'eth-b', u: 29, type: 'qsfp', above: 30, below: 28, name: '前端以太网交换机 B', net: 'eth' },
];

function netPort(dev, n) {
  // -> { x, y, top } in the device's local frame
  if (dev.type === 'osfp') {
    const top = n <= 16;
    return { x: -0.195 + ((n - 1) % 16) * 0.026, y: top ? 0.031 : 0.0125, top };
  }
  const top = ((n - 1) & 1) === 0;
  return { x: -0.187 + ((n - 1) >> 1) * 0.022, y: top ? 0.031 : 0.0125, top };
}

export function buildNetDevices(M, leds) {
  const root = new THREE.Group();
  root.name = 'net-devices';
  const devs = new Map();
  const picks = [];
  const body = new THREE.BoxGeometry(TRAY_W, TRAY_H, 0.5);
  body.translate(0, YC, Z_FRONT - 0.004 - 0.25);
  const hcm = hcmGeometry();
  const hcmUs = new Set();
  for (const d of NET_DEVS) {
    const g = new THREE.Group();
    g.position.set(NETRACK_X, yOfU(d.u), 0);
    const b = new Batch();
    b.box(TRAY_W, TRAY_H - 0.0008, 0.004, 0, YC, Z_FRONT - 0.002, d.net === 'ib' ? 0x18202c : 0x241d16);
    for (const sx of [-1, 1]) b.box(0.0195, TRAY_H - 0.003, 0.005, sx * 0.2316, YC, Z_FRONT - 0.0025, 0x2b323a);
    const nPorts = d.type === 'osfp' ? 32 : 36;
    const dim = PORT_DIM[d.type];
    d.ledIndex = [];
    for (let n = 1; n <= nPorts; n++) {
      const p = netPort(d, n);
      b.box(dim.w + 0.0022, dim.h + 0.0022, 0.003, p.x, p.y, Z_FRONT + 0.0004, 0x99a3ac);
      b.box(dim.w - 0.0012, dim.h - 0.0012, 0.0032, p.x, p.y, Z_FRONT + 0.0006, 0x05070a);
      d.ledIndex[n] = leds.add(null, NETRACK_X + p.x - dim.w / 2 + 0.0024, yOfU(d.u) + p.y + dim.h / 2 + 0.0026, Z_FRONT + 0.0012, 0.7);
    }
    b.box(TRAY_W - 0.02, 0.0018, 0.0012, 0, 0.0218, Z_FRONT + 0.0004, d.net === 'ib' ? PALETTE.ib : PALETTE.eth);
    const bezel = b.mesh(M.bezel);
    const chassis = new THREE.Mesh(body, M.chassis);
    bezel.userData.pick = chassis.userData.pick = { type: 'netdev', dev: d };
    g.add(bezel, chassis);
    picks.push(bezel, chassis);
    root.add(g);
    devs.set(d.id, d);
    for (const hu of [d.above, d.below]) {
      if (hu && !hcmUs.has(hu)) {
        hcmUs.add(hu);
        const h = new THREE.Mesh(hcm, M.matte);
        h.position.set(NETRACK_X, yOfU(hu), 0);
        root.add(h);
      }
    }
  }
  return { root, devs, picks };
}

// ---- the cabling system -----------------------------------------------------
export class Cabling {
  constructor(model, flow, M, leds, netDevs) {
    this.model = model;
    this.flow = flow;
    this.leds = leds;
    this.netDevs = netDevs;
    this.root = new THREE.Group();
    this.root.name = 'cabling';
    this.active = new Set(); // cables that need per-frame work
    this.queue = []; // timed actions (auto-wire, staggered unplug)
    this.time = 0;
    this.onEvent = () => {};
    const cables = model.cables;

    this.mat = {
      ib: makeRibbonMaterial({ jacket: 0x2f62d6, glowA: 0x6f9bff, glowB: 0xa9d4ff, radius: 0.0017, minPx: 1.3, spacing: 0.1, speed: 1.15, gain: 1.7, downMix: 0.5 }),
      eth: makeRibbonMaterial({ jacket: 0xc9731f, glowA: 0xffa23a, glowB: 0xffd98a, radius: 0.0019, minPx: 1.3, spacing: 0.1, speed: 1.05, gain: 1.6, downMix: 0.5 }),
      oob: makeRibbonMaterial({ jacket: 0x5d6975, glowA: 0xc3d0db, glowB: 0xf0f5f8, radius: 0.0021, minPx: 1.3, spacing: 0.075, speed: 0.7, gain: 1.5, downMix: 0.5 }),
    };

    // geometry bookkeeping per cable
    for (const c of cables) {
      c.flowId = flow.alloc(1);
      c.side = c.home.side;
      c.origin = new THREE.Vector3();
      c.tailDir = new THREE.Vector3(0, 0, 1);
      c.anchor = new THREE.Vector3();
      c.hl = 1;
    }
    this._assignLanes();
    this._buildTrunks();
    this._buildWhips();
    this._buildPlugs(M);
    for (const c of cables) this._seat(c, c.home, true);
    this.refreshVisuals();
  }

  // -- layout ------------------------------------------------------------------
  _assignLanes() {
    const cables = this.model.cables;
    // entry height: one level per cable inside its unit's opening
    const byUnitSide = new Map();
    for (const c of cables) {
      const k = `${c.home.unit.id}:${c.side}`;
      if (!byUnitSide.has(k)) byUnitSide.set(k, []);
      byUnitSide.get(k).push(c);
    }
    for (const list of byUnitSide.values()) {
      list.sort((a, b) => Math.abs(b.home.x) - Math.abs(a.home.x));
      list.forEach((c, i) => {
        c.entryY = c.home.unit.y + 0.0075 + i * 0.0056;
      });
    }
    for (const side of [-1, 1]) {
      const list = cables.filter((c) => c.side === side).sort((a, b) => a.entryY - b.entryY);
      list.forEach((c, n) => {
        c.lane = { x: side * (0.2862 - Math.floor(n / NZ) * LANE), z: 0.5425 + (n % NZ) * LANE };
        c.anchor.set(side * 0.2335, c.entryY, c.lane.z);
      });
    }
    // lanes in the network rack's duct: cables bound for the highest device peel off first
    const net = cables.filter((c) => !c.far.dev.startsWith('mgmt')).sort((a, b) => this.netDevs.get(b.far.dev).u - this.netDevs.get(a.far.dev).u || a.far.port - b.far.port);
    net.forEach((c, n) => {
      c.nlane = { x: NETRACK_X - 0.2862 + Math.floor(n / NZ) * LANE, z: 0.5425 + (n % NZ) * LANE, k: n };
    });
  }

  _farPoint(c) {
    // world position of the far-end port plus the cable manager it dresses through
    const f = c.far;
    if (f.dev.startsWith('mgmt')) {
      const unit = this.model.unitById.get(f.dev);
      const p = this.model.portByRef.get(`${f.dev}:p${f.port}`);
      const top = p.y > 0.02;
      const below = f.dev === 'mgmt-1';
      const hu = below ? unit.u - 1 : unit.u + 1;
      return { x: p.x, y: unit.y + p.y, type: 'rj45', hy: yOfU(hu), near: below ? !top : top, inRack: true, led: p.ledIndex };
    }
    const d = this.netDevs.get(f.dev);
    const p = netPort(d, f.port);
    const useAbove = p.top || !d.below;
    return { x: NETRACK_X + p.x, y: yOfU(d.u) + p.y, type: d.type, hy: yOfU(useAbove ? d.above : d.below), near: useAbove ? p.top : !p.top, inRack: false, led: d.ledIndex[f.port] };
  }

  _buildTrunks() {
    const ribs = { ib: new Ribbon(this.mat.ib, 'trunk-ib'), eth: new Ribbon(this.mat.eth, 'trunk-eth'), oob: new Ribbon(this.mat.oob, 'trunk-oob') };
    for (const c of this.model.cables) {
      const f = this._farPoint(c);
      c.farPoint = f;
      const n = c.far.port;
      const zh = Z_FRONT + TAIL[f.type] + 0.011 + (f.near ? 0 : 0.014) + (n % 3) * 0.0036;
      const yh = f.hy + 0.011 + (n % 5) * 0.0044;
      const pts = [[f.x, f.y, Z_FRONT + TAIL[f.type]], [f.x, f.y, zh], [f.x, yh, zh]];
      if (f.inRack) {
        pts.push([c.lane.x, yh, zh], [c.lane.x, yh, c.lane.z]);
      } else {
        const yo = TRAY_Y_OVERHEAD + 0.007 + (c.nlane.k % 6) * 0.0042;
        pts.push([c.nlane.x, yh, zh], [c.nlane.x, yh, c.nlane.z], [c.nlane.x, yo, c.nlane.z], [c.lane.x, yo, c.lane.z]);
      }
      pts.push([c.lane.x, c.entryY, c.lane.z], [c.anchor.x, c.anchor.y, c.anchor.z]);
      const flat = filletPath(pts, 0.014, 4);
      c.trunkLen = pathLength(flat);
      c.trunk = flat;
      ribs[c.net].add(flat, c.flowId, 0);
    }
    this.trunkMesh = {};
    for (const k of Object.keys(ribs)) {
      this.trunkMesh[k] = ribs[k].finalize();
      this.root.add(this.trunkMesh[k]);
    }
  }

  _buildWhips() {
    this.whipRib = { ib: new Ribbon(this.mat.ib, 'whip-ib'), eth: new Ribbon(this.mat.eth, 'whip-eth'), oob: new Ribbon(this.mat.oob, 'whip-oob') };
    for (const c of this.model.cables) {
      c.rope = { p: new Float32Array(N * 3), q: new Float32Array(N * 3), from: new Float32Array(N * 3), L: 0.4, seg: 0.02, still: 0, asleep: true };
      c.whip = this.whipRib[c.net].add(new Float32Array(N * 3), c.flowId, c.trunkLen);
    }
    this.whipMesh = {};
    for (const k of Object.keys(this.whipRib)) {
      const m = this.whipRib[k].finalize();
      m.frustumCulled = false;
      this.whipMesh[k] = m;
      this.root.add(m);
    }
  }

  _buildPlugs(M) {
    this.plugs = {};
    this.plugPick = {};
    this.farPlugs = {};
    this.pickList = [];
    const byType = { osfp: [], qsfp: [], rj45: [] };
    for (const c of this.model.cables) byType[c.type].push(c);
    for (const type of Object.keys(byType)) {
      const list = byType[type];
      const geo = plugGeometry(type, NET_COLOR[TYPE_NET[type]]);
      const mesh = new THREE.InstancedMesh(geo, M.bezel, list.length);
      mesh.frustumCulled = false;
      mesh.name = `plugs-${type}`;
      const d = PORT_DIM[type];
      // grab volume: the whole plug (nose to pull tab), a little fatter than the part itself
      const len = d.plugL + 0.055;
      const pg = new THREE.BoxGeometry(d.plugW * 2.0, d.plugH * 2.6, len);
      pg.translate(0, 0, len / 2 - d.insert);
      const pick = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ visible: false }), list.length);
      pick.frustumCulled = false;
      pick.userData.pickInst = (i) => ({ type: 'cable', cable: list[i], plug: true });
      list.forEach((c, i) => {
        c.plugMesh = mesh;
        c.plugPickMesh = pick;
        c.plugIndex = i;
      });
      this.plugs[type] = mesh;
      this.plugPick[type] = pick;
      this.pickList.push(pick);
      this.root.add(mesh, pick);
    }
    // far-end plugs never move
    const far = { osfp: [], qsfp: [], rj45: [] };
    for (const c of this.model.cables) far[c.farPoint.type].push(c);
    for (const type of Object.keys(far)) {
      const list = far[type];
      if (!list.length) continue;
      const net = type === 'rj45' ? 'oob' : type === 'osfp' ? 'ib' : 'eth';
      const mesh = new THREE.InstancedMesh(plugGeometry(type, NET_COLOR[net]), M.bezel, list.length);
      list.forEach((c, i) => {
        _m.makeTranslation(c.farPoint.x, c.farPoint.y, Z_FRONT);
        mesh.setMatrixAt(i, _m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.farPlugs[type] = mesh;
      this.root.add(mesh);
    }
    // hint frames shown on free compatible ports while a plug is held
    const hb = new Batch();
    hb.box(1, 0.1, 0.1, 0, 0.55, 0, 0xffffff).box(1, 0.1, 0.1, 0, -0.55, 0, 0xffffff).box(0.1, 1.2, 0.1, -0.55, 0, 0, 0xffffff).box(0.1, 1.2, 0.1, 0.55, 0, 0, 0xffffff);
    this.hints = new THREE.InstancedMesh(hb.geometry(), new THREE.MeshBasicMaterial({ color: 0xffffff }), 128);
    this.hints.count = 0;
    this.hints.frustumCulled = false;
    this.root.add(this.hints);
    this.hintPorts = [];
  }

  // -- helpers -----------------------------------------------------------------
  portPos(port, v) {
    return v.set(port.x, port.unit.y + port.y, Z_FRONT + port.unit.pull);
  }

  // dressed curve from the duct anchor to a plug seated at `origin`
  _dressed(c, origin, arr) {
    const a = c.anchor;
    const tz = TAIL[c.type];
    const px = origin.x, py = origin.y, pz = origin.z + tz;
    const dx = Math.abs(a.x - px);
    const bulge = 0.02 + 0.11 * dx;
    const c1x = a.x - c.side * Math.min(0.07, dx * 0.55), c1y = a.y, c1z = a.z + bulge * 0.35;
    const c2x = px, c2y = py, c2z = pz + bulge;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1), mt = 1 - t;
      const b0 = mt * mt * mt, b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t, b3 = t * t * t;
      arr[i * 3] = b0 * a.x + b1 * c1x + b2 * c2x + b3 * px;
      arr[i * 3 + 1] = b0 * a.y + b1 * c1y + b2 * c2y + b3 * py;
      arr[i * 3 + 2] = b0 * a.z + b1 * c1z + b2 * c2z + b3 * pz;
    }
    return arr;
  }

  _writeWhip(c) {
    this.whipRib[c.net].update(c.whip, c.rope.p, c.trunkLen);
  }

  _placePlug(c) {
    if (Math.abs(c.tailDir.z - 1) < 1e-6) _q.identity();
    else _q.setFromUnitVectors(Z_AXIS, c.tailDir);
    _m.compose(c.origin, _q, _one);
    c.plugMesh.setMatrixAt(c.plugIndex, _m);
    c.plugMesh.instanceMatrix.needsUpdate = true;
    c.plugPickMesh.setMatrixAt(c.plugIndex, _m);
    c.plugPickMesh.instanceMatrix.needsUpdate = true;
    c.plugPickMesh.boundingSphere = null; // recomputed lazily on the next raycast
  }

  _seat(c, port, instant) {
    // logical + geometric seating of a plug in a port
    if (c.port && c.port !== port) c.port.cable = null;
    c.port = port;
    port.cable = c;
    c.state = 'plugged';
    this.portPos(port, c.origin);
    c.tailDir.set(0, 0, 1);
    this._dressed(c, c.origin, c.rope.p);
    c.rope.L = pathLength(c.rope.p) + SLACK;
    c.rope.seg = c.rope.L / (N - 1);
    this._writeWhip(c);
    this._placePlug(c);
    if (!instant) this.onEvent({ type: 'plug', cable: c, port });
  }

  // -- public actions ----------------------------------------------------------
  unplug(c, { hold = false, silent = false } = {}) {
    if (c.state !== 'plugged') return false;
    const port = c.port;
    port.cable = null;
    c.lastPort = port;
    c.port = null;
    c.state = 'extracting';
    c.anim = { t: 0, dur: 0.16, z0: c.origin.z, z1: c.origin.z + PORT_DIM[c.type].insert + 0.02, then: hold ? 'held' : 'free' };
    this.active.add(c);
    if (!silent) this.onEvent({ type: 'unplug', cable: c, port });
    this.model.emit('cabling');
    return true;
  }

  plug(c, port) {
    if (port.cable && port.cable !== c) return false;
    if (port.type !== c.type) return false;
    if (c.port) c.port.cable = null;
    c.port = port;
    port.cable = c;
    c.state = 'inserting';
    c.rope.from.set(c.rope.p);
    c.anim = { t: 0, dur: 0.26, o0: c.origin.clone(), d0: c.tailDir.clone() };
    this.active.add(c);
    this.model.emit('cabling');
    return true;
  }

  startDrag(c) {
    if (c.state === 'plugged') this.unplug(c, { hold: true });
    else if (c.state === 'free') {
      c.state = 'held';
      c.rope.asleep = false;
      this.active.add(c);
    } else if (c.state === 'extracting') c.anim.then = 'held';
    else return false;
    this.dragging = c;
    c.target = c.origin.clone();
    c.target.z = hoverZ(c.type);
    this._showHints(c);
    return true;
  }

  // ray: THREE.Ray in world space
  dragTo(ray) {
    const c = this.dragging;
    if (!c) return null;
    const zPlane = hoverZ(c.type);
    const t = (zPlane - ray.origin.z) / ray.direction.z;
    if (!isFinite(t) || t <= 0) return this.snap;
    _v.copy(ray.direction).multiplyScalar(t).add(ray.origin);
    _v.y = Math.max(0.05, _v.y);
    // snap to the nearest free compatible port
    let best = null, bd = 0.03;
    for (const p of this.hintPorts) {
      const d = Math.hypot(p.x - _v.x, p.unit.y + p.y - _v.y);
      if (d < bd && Math.abs(p.unit.pull) < 0.02) {
        bd = d;
        best = p;
      }
    }
    if (best) _v.set(best.x, best.unit.y + best.y, Z_FRONT + PORT_DIM[c.type].insert * 0.72);
    // a cord cannot stretch: clamp the far end of the rope to what its length allows
    const seg = c.rope.seg, tz = TAIL[c.type] + seg;
    const ax = c.anchor.x - c.side * seg;
    _v2.set(_v.x - ax, _v.y - c.anchor.y, _v.z + tz - c.anchor.z);
    const dist = _v2.length();
    const reach = (c.rope.L - 2 * seg) * 0.985;
    c.taut = dist > reach;
    if (c.taut) {
      _v2.multiplyScalar(reach / dist);
      _v.set(ax + _v2.x, c.anchor.y + _v2.y, c.anchor.z + _v2.z - tz);
      if (best && Math.hypot(best.x - _v.x, best.unit.y + best.y - _v.y) > 0.01) best = null;
    }
    this.snap = best;
    c.target.copy(_v);
    return this.snap;
  }

  endDrag() {
    const c = this.dragging;
    if (!c) return;
    this.dragging = null;
    this._hideHints();
    const port = this.snap;
    this.snap = null;
    if (port && !port.cable) {
      if (c.state === 'extracting') {
        c.anim.then = 'free';
        c.pendingPort = port;
      } else this.plug(c, port);
    } else if (c.state === 'held') {
      c.state = 'free';
      c.rope.asleep = false;
      c.rope.still = 0;
      this.onEvent({ type: 'drop', cable: c });
    } else if (c.state === 'extracting') c.anim.then = 'free';
  }

  unplugUnit(unit, stagger = 0.05) {
    let i = 0;
    for (const c of this.model.cables) {
      if (c.port && c.port.unit === unit && c.state === 'plugged') this.queue.push({ at: this.time + i++ * stagger, fn: () => this.unplug(c, { silent: true }) });
    }
    return i;
  }

  replugUnit(unit, stagger = 0.07) {
    let i = 0;
    for (const c of this.model.cables) {
      if (c.home.unit === unit && c.port !== c.home) this.queue.push({ at: this.time + i++ * stagger, fn: () => this.rehome(c) });
    }
    return i;
  }

  rehome(c) {
    if (c.port === c.home && c.state === 'plugged') return;
    if (c.home.cable && c.home.cable !== c) return; // someone else sits in our port
    if (c.state === 'plugged') {
      // wrong port: lift out, then drop into the planned one
      c.port.cable = null;
      c.port = null;
    }
    if (Math.abs(c.home.unit.pull) > 0.02) return;
    c.rope.asleep = false;
    this.plug(c, c.home);
  }

  unplugAll(stagger = 0.012) {
    let i = 0;
    for (const c of this.model.cables) if (c.state === 'plugged') this.queue.push({ at: this.time + i++ * stagger, fn: () => this.unplug(c, { silent: true }) });
  }

  autoWire(stagger = 0.03) {
    let i = 0;
    const list = this.model.cables.filter((c) => !(c.port === c.home && c.state === 'plugged'));
    // first lift every misplaced plug out so that the planned ports are free
    for (const c of list) if (c.state === 'plugged') { c.port.cable = null; c.port = null; this._release(c); }
    list.sort((a, b) => a.home.unit.u - b.home.unit.u || a.home.x - b.home.x);
    for (const c of list) this.queue.push({ at: this.time + 0.1 + i++ * stagger, fn: () => this.rehome(c) });
    return list.length;
  }

  _release(c) {
    // hand a cord over to the rope solver from wherever it currently is
    c.rope.q.set(c.rope.p);
    c.rope.asleep = false;
    c.rope.still = 0;
    c.state = 'free';
    this.active.add(c);
  }

  // -- hints -------------------------------------------------------------------
  _showHints(c) {
    this.hintPorts = this.model.ports.filter((p) => p.type === c.type && !p.cable && !p.far && Math.abs(p.unit.pull) < 0.02);
    const d = PORT_DIM[c.type];
    this.hints.count = Math.min(128, this.hintPorts.length);
    for (let i = 0; i < this.hints.count; i++) {
      const p = this.hintPorts[i];
      _m.makeScale(d.w + 0.004, d.h + 0.004, 0.012);
      _m.setPosition(p.x, p.unit.y + p.y, Z_FRONT + 0.003);
      this.hints.setMatrixAt(i, _m);
    }
    this.hints.instanceMatrix.needsUpdate = true;
    this.hintType = c.type;
  }
  _hideHints() {
    this.hints.count = 0;
    this.hintPorts = [];
  }

  // -- per-frame ---------------------------------------------------------------
  update(dt, wall) {
    this.time += dt;
    if (this.queue.length) {
      const due = this.queue.filter((q) => q.at <= this.time);
      if (due.length) {
        this.queue = this.queue.filter((q) => q.at > this.time);
        for (const q of due) q.fn();
      }
    }
    if (this.hints.count) {
      // pulse the hint frames; the snapped one is solid white
      const k = 0.55 + 0.45 * Math.sin(wall * 7);
      const base = this.hintType === 'osfp' ? [0.5, 0.9, 3.0] : this.hintType === 'qsfp' ? [3.0, 1.5, 0.3] : [1.6, 1.9, 2.2];
      for (let i = 0; i < this.hints.count; i++) {
        const hot = this.hintPorts[i] === this.snap;
        this.hints.setColorAt(i, _c.setRGB(base[0] * (hot ? 2.2 : k), base[1] * (hot ? 2.2 : k), base[2] * (hot ? 2.2 : k)));
      }
      this.hints.instanceColor.needsUpdate = true;
    }
    const steps = Math.max(1, Math.min(2, Math.round(dt / (1 / 75))));
    for (const c of this.active) {
      let keep = true;
      if (c.state === 'extracting') {
        const a = c.anim;
        a.t = Math.min(1, a.t + dt / a.dur);
        const k = 1 - (1 - a.t) * (1 - a.t);
        c.origin.z = a.z0 + (a.z1 - a.z0) * k;
        this._dressed(c, c.origin, c.rope.p);
        if (a.t >= 1) {
          c.rope.q.set(c.rope.p);
          c.rope.asleep = false;
          c.rope.still = 0;
          c.state = a.then;
          if (c.pendingPort) {
            const p = c.pendingPort;
            c.pendingPort = null;
            if (!p.cable) this.plug(c, p);
          }
        }
      } else if (c.state === 'inserting') {
        const a = c.anim;
        a.t = Math.min(1, a.t + dt / a.dur);
        const k = a.t * a.t * (3 - 2 * a.t);
        this.portPos(c.port, _v);
        // approach in front of the port first, then push straight in
        const kz = Math.max(0, (a.t - 0.55) / 0.45);
        _v2.set(_v.x, _v.y, _v.z + (1 - kz * kz) * (PORT_DIM[c.type].insert + 0.012));
        c.origin.lerpVectors(a.o0, _v2, Math.min(1, k * 1.6));
        c.tailDir.copy(a.d0).lerp(Z_AXIS, Math.min(1, k * 2)).normalize();
        this._dressed(c, c.origin, _tmp);
        const p = c.rope.p, f = c.rope.from;
        for (let i = 0; i < N * 3; i++) p[i] = f[i] + (_tmp[i] - f[i]) * k;
        if (a.t >= 1) {
          this._seat(c, c.port, false);
          keep = false;
          this.model.emit('cabling');
        }
      } else if (c.state === 'held' || c.state === 'free') {
        if (c.state === 'held') {
          c.origin.lerp(c.target, 1 - Math.pow(0.0005, dt));
          c.tailDir.lerp(Z_AXIS, 0.3).normalize();
        }
        if (!c.rope.asleep) for (let s = 0; s < steps; s++) this._stepRope(c, dt / steps);
        if (c.state === 'free') {
          const p = c.rope.p, e = (N - 1) * 3;
          c.tailDir.set(p[e - 3] - p[e], p[e - 2] - p[e + 1], p[e - 1] - p[e + 2]).normalize();
          c.origin.set(p[e], p[e + 1], p[e + 2]).addScaledVector(c.tailDir, -TAIL[c.type]);
          if (c.rope.asleep) keep = false;
        }
      } else if (c.state === 'plugged') {
        // follows a moving tray; pops out when the cord runs out of slack
        this.portPos(c.port, c.origin);
        this._dressed(c, c.origin, c.rope.p);
        if (pathLength(c.rope.p) > c.rope.L + 0.02) {
          this.unplug(c, { silent: true });
          this.onEvent({ type: 'yank', cable: c });
        } else if (Math.abs(c.port.unit.pull - c.port.unit.pullTarget) < 1e-5) keep = false;
      }
      this._writeWhip(c);
      this._placePlug(c);
      if (!keep) this.active.delete(c);
    }
  }

  // called when a unit starts moving so its seated cords track the ports
  wakeUnit(unit) {
    for (const p of unit.ports || []) if (p.cable && p.cable.state === 'plugged') this.active.add(p.cable);
  }

  _stepRope(c, dt) {
    const r = c.rope, p = r.p, q = r.q;
    const held = c.state === 'held';
    const seg = r.seg;
    const a = c.anchor;
    // pinned start: leave the duct horizontally
    p[0] = a.x; p[1] = a.y; p[2] = a.z;
    p[3] = a.x - c.side * seg; p[4] = a.y; p[5] = a.z;
    const e = (N - 1) * 3;
    if (held) {
      const tz = TAIL[c.type];
      p[e] = c.origin.x; p[e + 1] = c.origin.y; p[e + 2] = c.origin.z + tz;
      p[e - 3] = c.origin.x; p[e - 2] = c.origin.y; p[e - 1] = c.origin.z + tz + seg;
    }
    const last = held ? N - 2 : N;
    const g = -6.2 * dt * dt;
    let moved = 0;
    for (let i = 2; i < last; i++) {
      const k = i * 3;
      const vx = (p[k] - q[k]) * 0.972, vy = (p[k + 1] - q[k + 1]) * 0.972, vz = (p[k + 2] - q[k + 2]) * 0.972;
      q[k] = p[k]; q[k + 1] = p[k + 1]; q[k + 2] = p[k + 2];
      p[k] += vx; p[k + 1] += vy + g * (i === N - 1 ? 1.6 : 1); p[k + 2] += vz;
      moved += Math.abs(vx) + Math.abs(vy) + Math.abs(vz);
    }
    for (let it = 0; it < 10; it++) {
      for (let i = 0; i < N - 1; i++) {
        const k = i * 3;
        let dx = p[k + 3] - p[k], dy = p[k + 4] - p[k + 1], dz = p[k + 5] - p[k + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
        const w0 = i < 2 || (held && i >= N - 2) ? 0 : 1;
        const w1 = i + 1 < 2 || (held && i + 1 >= N - 2) ? 0 : 1;
        if (w0 + w1 === 0) continue;
        const f = ((d - seg) / d) / (w0 + w1);
        dx *= f; dy *= f; dz *= f;
        if (w0) { p[k] += dx; p[k + 1] += dy; p[k + 2] += dz; }
        if (w1) { p[k + 3] -= dx; p[k + 4] -= dy; p[k + 5] -= dz; }
      }
      // bend stiffness: neighbours-of-neighbours may not fold closer than 1.55 seg
      for (let i = 0; i < N - 2; i++) {
        const k = i * 3;
        let dx = p[k + 6] - p[k], dy = p[k + 7] - p[k + 1], dz = p[k + 8] - p[k + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
        const min = seg * 1.55;
        if (d >= min) continue;
        const w0 = i < 2 || (held && i >= N - 2) ? 0 : 1;
        const w1 = i + 2 < 2 || (held && i + 2 >= N - 2) ? 0 : 1;
        if (w0 + w1 === 0) continue;
        const f = (((d - min) / d) * 0.5) / (w0 + w1);
        dx *= f; dy *= f; dz *= f;
        if (w0) { p[k] += dx; p[k + 1] += dy; p[k + 2] += dz; }
        if (w1) { p[k + 6] -= dx; p[k + 7] -= dy; p[k + 8] -= dz; }
      }
      // keep clear of the front panels and the floor
      for (let i = 2; i < last; i++) {
        const k = i * 3;
        if (Math.abs(p[k]) < 0.23 && p[k + 2] < Z_FRONT + 0.016) p[k + 2] = Z_FRONT + 0.016;
        if (p[k + 1] < 0.012) p[k + 1] = 0.012;
      }
    }
    if (!held) {
      if (moved < 0.00035) r.still++;
      else r.still = 0;
      if (r.still > 45) r.asleep = true;
    }
  }

  // -- state -> visuals --------------------------------------------------------
  // link state of a cord: 2 up, 1 miswired, 0 down
  linkState(c) {
    if (c.state !== 'plugged' || !c.port) return 0;
    const u = c.port.unit;
    if (!u.seated || u.fault === 'offline') return 0;
    return c.port === c.home ? 2 : 1;
  }

  refreshVisuals() {
    const { flow, leds } = this;
    for (const p of this.model.ports) if (p.ledIndex !== undefined && !p.far) leds.set(p.ledIndex, 0);
    for (const c of this.model.cables) {
      const s = this.linkState(c);
      flow.setState(c.flowId, s);
      const code = s === 2 ? 1 : s === 1 ? 2 : 0;
      if (c.port) leds.set(c.port.ledIndex, code);
      leds.set(c.farPoint.led, s === 2 ? 1 : s === 1 ? 2 : 0);
    }
  }

  summary() {
    let plugged = 0, ok = 0;
    const wrong = [], open = [];
    for (const c of this.model.cables) {
      if (c.state === 'plugged' || c.state === 'inserting') {
        plugged++;
        if (c.port === c.home) ok++;
        else wrong.push(c);
      } else open.push(c);
    }
    return { total: this.model.cables.length, plugged, ok, wrong, open };
  }

  setLayer(net, on) {
    this.trunkMesh[net].visible = on;
    this.whipMesh[net].visible = on;
    const type = net === 'ib' ? 'osfp' : net === 'eth' ? 'qsfp' : 'rj45';
    this.plugs[type].visible = on;
    if (this.farPlugs[type]) this.farPlugs[type].visible = on;
    this.layerOn = this.layerOn || { ib: true, eth: true, oob: true };
    this.layerOn[net] = on;
  }
}

const _tmp = new Float32Array(N * 3);
const _c = new THREE.Color();

export { NET_DEVS, TAIL };
