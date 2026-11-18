// 3D bodies of everything that occupies a rack unit: compute trays, NVLink
// switch trays, power shelves, management switches, blanks and cable managers.

import * as THREE from 'three';
import { Batch, ventPlane } from './build.js';
import { U, Z_FRONT, Z_REAR, TRAY_W, TRAY_H, PORT_Y, CART_X, BUSBAR_X, MANI_SUPPLY_X, MANI_RETURN_X, GPU_X, GPU_Z, NVSW_X, NVSW_Z, PALETTE } from './config.js';
import { PORT_DIM, gpuOf } from './topology.js';

const PLATE = 0x1a1f24;
const HOLE = 0x05070a;
const CAGE = 0x99a3ac;
const PCB = 0x0c2b22;
const SILVER = 0xb9c2ca;
const BODY_D = Z_FRONT - 0.004 - Z_REAR;
const BODY_ZC = (Z_FRONT - 0.004 + Z_REAR) / 2;
const YC = TRAY_H / 2 + 0.0008;

// ---- LEDs (one instanced mesh for the whole scene) --------------------------
export class Leds {
  constructor(max = 900) {
    const g = new THREE.BoxGeometry(0.0034, 0.0022, 0.0016);
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(g, m, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'leds';
    this.items = [];
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
  }
  add(unit, x, y, z = Z_FRONT + 0.0012, scale = 1) {
    const i = this.items.length;
    const it = { i, unit, x, y, z, scale, code: -1 };
    this.items.push(it);
    this.mesh.count = this.items.length;
    this._place(it);
    this.set(i, 0);
    return i;
  }
  _place(it) {
    this._m.makeScale(it.scale, it.scale, 1);
    this._m.setPosition(it.x, (it.unit ? it.unit.y : 0) + it.y, it.z + (it.unit ? it.unit.pull : 0));
    this.mesh.setMatrixAt(it.i, this._m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  moveUnit(unit) {
    for (const it of this.items) if (it.unit === unit) this._place(it);
  }
  // code: 0 off, 1 green, 2 amber, 3 red, 4 blue, 5 white
  set(i, code, gain = 1) {
    const it = this.items[i];
    if (!it) return;
    const key = code * 100 + Math.round(gain * 20);
    if (it.code === key) return;
    it.code = key;
    const c = this._c;
    if (code === 0) c.setRGB(0.035, 0.045, 0.05);
    else if (code === 1) c.setRGB(0.04, 1.7, 0.42);
    else if (code === 2) c.setRGB(3.0, 1.35, 0.1);
    else if (code === 3) c.setRGB(3.2, 0.22, 0.1);
    else if (code === 4) c.setRGB(0.25, 0.9, 3.2);
    else c.setRGB(2.2, 2.3, 2.4);
    if (code !== 0) c.multiplyScalar(gain);
    this.mesh.setColorAt(i, c);
    this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---- shared pieces ----------------------------------------------------------
function cage(b, type, x, y) {
  const d = PORT_DIM[type];
  b.box(d.w + 0.0022, d.h + 0.0022, 0.003, x, y, Z_FRONT + 0.0004, CAGE);
  b.box(d.w - 0.0012, d.h - 0.0012, 0.0032, x, y, Z_FRONT + 0.0006, HOLE);
}

function ears(b, accent) {
  for (const sx of [-1, 1]) {
    b.box(0.0195, TRAY_H - 0.003, 0.005, sx * 0.2316, YC, Z_FRONT - 0.0025, 0x2b323a);
    b.box(0.0075, TRAY_H - 0.013, 0.013, sx * 0.2138, YC, Z_FRONT + 0.0045, accent);
    b.cyl(0.0034, 0.004, sx * 0.2345, YC + 0.011, Z_FRONT + 0.0015, 0x8a97a3, 'z', 10);
    b.cyl(0.0034, 0.004, sx * 0.2345, YC - 0.011, Z_FRONT + 0.0015, 0x8a97a3, 'z', 10);
  }
}

function plate(b, color = PLATE) {
  b.box(TRAY_W, TRAY_H - 0.0008, 0.004, 0, YC, Z_FRONT - 0.002, color);
}

function rearMating(b, { nvlink = true, wide = false, liquid = true }) {
  // blind-mate hardware on the rear edge of a tray
  if (nvlink) {
    for (const cx of CART_X) {
      const w = wide ? 0.05 : 0.044;
      const h = wide ? 0.036 : 0.03;
      b.box(w, h, 0.02, cx, YC, Z_REAR - 0.009, 0x15191d);
      b.box(w - 0.006, h - 0.008, 0.004, cx, YC, Z_REAR - 0.0195, 0xc8a13a);
      b.cyl(0.0022, 0.03, cx - w / 2 - 0.004, YC, Z_REAR - 0.012, 0x8f9aa3, 'z', 8);
      b.cyl(0.0022, 0.03, cx + w / 2 + 0.004, YC, Z_REAR - 0.012, 0x8f9aa3, 'z', 8);
    }
  }
  // busbar clip
  b.box(0.03, 0.036, 0.03, BUSBAR_X, YC, Z_REAR - 0.012, 0xc98a4b);
  b.box(0.008, 0.038, 0.036, BUSBAR_X, YC, Z_REAR - 0.016, 0x0c0f12);
  if (liquid) {
    b.cyl(0.0075, 0.036, MANI_SUPPLY_X, YC, Z_REAR - 0.016, PALETTE.liqS, 'z', 12);
    b.cyl(0.0095, 0.008, MANI_SUPPLY_X, YC, Z_REAR - 0.004, SILVER, 'z', 12);
    b.cyl(0.0075, 0.036, MANI_RETURN_X, YC, Z_REAR - 0.016, PALETTE.liqR, 'z', 12);
    b.cyl(0.0095, 0.008, MANI_RETURN_X, YC, Z_REAR - 0.004, SILVER, 'z', 12);
  }
}

// ---- per-kind geometry (built once, shared by all units of the kind) --------
function portKeys(b, ports) {
  // cages plus a thin network-colour key under each cabled port
  for (const p of ports) {
    cage(b, p.type, p.x, p.y ?? PORT_Y);
    const col = p.net === 'ib' ? PALETTE.ib : p.net === 'eth' ? PALETTE.eth : p.net === 'oob' ? PALETTE.oob : 0x39424b;
    const d = PORT_DIM[p.type];
    b.box(d.w, 0.0018, 0.0012, p.x, (p.y ?? PORT_Y) - d.h / 2 - 0.0042, Z_FRONT + 0.0004, col);
  }
}

function computeGeo(ports) {
  const b = new Batch();
  plate(b);
  ears(b, 0x9aa6b1);
  // E1.S NVMe bays in the centre section
  for (let i = 0; i < 8; i++) {
    const x = -0.056 + i * 0.0115;
    b.box(0.0098, 0.034, 0.0026, x, YC, Z_FRONT + 0.0008, 0x2d343b);
    b.box(0.0098, 0.0045, 0.004, x, YC + 0.0148, Z_FRONT + 0.0016, 0x3b8f6b);
    b.box(0.006, 0.02, 0.0028, x, YC - 0.003, Z_FRONT + 0.001, 0x15191d);
  }
  b.box(0.0068, 0.0125, 0.003, 0.0625, PORT_Y, Z_FRONT + 0.0006, HOLE); // USB-A
  b.box(0.0078, 0.0052, 0.003, 0.0738, PORT_Y, Z_FRONT + 0.0006, HOLE); // mini-DisplayPort
  portKeys(b, ports);
  // bay dividers
  for (const x of [-0.0855, 0.0822]) b.box(0.0012, TRAY_H - 0.008, 0.0016, x, YC, Z_FRONT + 0.0005, 0x39424b);
  // vent slits top and bottom
  for (let i = 0; i < 26; i++) {
    const x = -0.203 + i * 0.016;
    b.box(0.011, 0.0018, 0.0012, x, 0.0388, Z_FRONT + 0.0003, HOLE);
    b.box(0.011, 0.0016, 0.0012, x, 0.0042, Z_FRONT + 0.0003, HOLE);
  }
  const bezel = b.geometry();

  // internals
  const n = new Batch();
  for (const sx of [-1, 1]) {
    n.box(0.206, 0.0022, 0.47, sx * 0.107, 0.0052, 0.02, PCB); // "Bianca" compute board
    n.box(0.078, 0.014, 0.078, sx * 0.107, 0.0135, 0.165, 0x8d98a2); // Grace CPU cold plate
    n.box(0.05, 0.003, 0.05, sx * 0.107, 0.0212, 0.165, 0xd8dee3);
    for (let k = 0; k < 6; k++) n.box(0.006, 0.02, 0.07, sx * 0.107 + (k - 2.5) * 0.0105 + (k > 2 ? 0.05 : -0.05), 0.0165, 0.165, 0x1c2228); // LPDDR banks
    for (let k = 0; k < 5; k++) n.box(0.012, 0.008, 0.012, sx * 0.107 - 0.07 + k * 0.035, 0.0105, 0.075, 0x2a3036); // VRM inductors
    for (let k = 0; k < 5; k++) n.box(0.012, 0.008, 0.012, sx * 0.107 - 0.07 + k * 0.035, 0.0105, -0.145, 0x2a3036);
  }
  n.box(0.43, 0.0022, 0.125, 0, 0.0052, 0.425, PCB); // front I/O boards
  for (let i = 0; i < 8; i++) { // fan wall
    n.box(0.046, 0.036, 0.03, -0.189 + i * 0.054, 0.0215, 0.315, 0x14181c);
    n.cyl(0.0155, 0.031, -0.189 + i * 0.054, 0.0215, 0.315, 0x3a434c, 'z', 16);
  }
  for (const p of ports) if (p.type === 'osfp') n.box(0.022, 0.012, 0.075, p.x, PORT_Y, 0.455, 0x8f9aa3); // ConnectX-7 cages
  for (const x of [-0.174, 0.114]) n.box(0.066, 0.016, 0.105, x, PORT_Y, 0.44, 0x333c45); // BlueField-3 cards
  n.box(0.094, 0.034, 0.105, -0.016, 0.0215, 0.44, 0x252b31); // drive cage
  n.box(0.07, 0.02, 0.09, BUSBAR_X, 0.016, Z_REAR + 0.06, 0x23292f); // power distribution board
  rearMating(n, { nvlink: true });
  const inner = n.geometry();
  return { bezel, inner };
}

function switchGeo(ports) {
  const b = new Batch();
  plate(b);
  ears(b, PALETTE.nv);
  portKeys(b, ports);
  b.box(0.0068, 0.0125, 0.003, -0.089, PORT_Y, Z_FRONT + 0.0006, HOLE); // USB
  b.box(0.012, 0.007, 0.002, -0.198, PORT_Y + 0.004, Z_FRONT + 0.0006, 0x0a0d10); // UID / reset
  b.box(0.302, 0.0024, 0.0016, 0.055, 0.0046, Z_FRONT + 0.0005, PALETTE.nv); // NVLink identity bar
  b.box(0.302, 0.0024, 0.0016, 0.055, 0.0392, Z_FRONT + 0.0005, PALETTE.nv);
  const bezel = b.geometry();

  const n = new Batch();
  n.box(0.43, 0.0022, 0.66, 0, 0.0052, 0.03, PCB);
  for (let i = 0; i < 6; i++) {
    n.box(0.058, 0.036, 0.03, -0.18 + i * 0.072, 0.0215, 0.405, 0x14181c);
    n.cyl(0.0155, 0.031, -0.18 + i * 0.072, 0.0215, 0.405, 0x3a434c, 'z', 16);
  }
  n.box(0.095, 0.01, 0.095, -0.13, 0.0115, 0.3, 0x1f3f5a); // COMe module running NVOS
  n.box(0.04, 0.006, 0.04, -0.13, 0.0185, 0.3, 0x2a2f35);
  n.box(0.04, 0.006, 0.04, 0.02, 0.0095, 0.31, 0x2a2f35); // BMC
  for (let k = 0; k < 8; k++) n.box(0.012, 0.008, 0.012, -0.175 + k * 0.05, 0.0105, 0.12, 0x2a3036);
  for (let k = 0; k < 8; k++) n.box(0.012, 0.008, 0.012, -0.175 + k * 0.05, 0.0105, -0.19, 0x2a3036);
  n.box(0.07, 0.02, 0.07, BUSBAR_X, 0.016, Z_REAR + 0.05, 0x23292f);
  rearMating(n, { nvlink: true, wide: true });
  const inner = n.geometry();
  return { bezel, inner };
}

const PSU_X = [-0.142, -0.076, -0.01, 0.056, 0.122, 0.188];
function powerGeo(ports) {
  const b = new Batch();
  plate(b, 0x16191d);
  ears(b, 0xb9773b);
  portKeys(b, ports);
  for (const x of PSU_X) {
    b.box(0.0625, 0.0385, 0.003, x, YC, Z_FRONT + 0.0006, 0x242a30);
    b.box(0.0055, 0.03, 0.013, x + 0.0245, YC, Z_FRONT + 0.006, 0xc27a34);
    b.box(0.014, 0.0045, 0.0026, x + 0.012, YC - 0.014, Z_FRONT + 0.0012, 0x0a0d10);
  }
  const bezel = b.geometry();
  const n = new Batch();
  for (const x of PSU_X) n.box(0.061, 0.037, 0.5, x, YC, 0.24, 0x4a535c);
  n.box(0.43, 0.03, 0.2, 0, YC, -0.16, 0x2b3239);
  rearMating(n, { nvlink: false, liquid: false });
  const inner = n.geometry();
  return { bezel, inner };
}

function mgmtGeo(ports) {
  const b = new Batch();
  plate(b, 0x1d252d);
  ears(b, 0x5d7f9c);
  for (const p of ports) cage(b, p.type, p.x, p.y);
  b.box(0.37, 0.0016, 0.0012, -0.011, 0.0216, Z_FRONT + 0.0004, 0x51606d);
  const bezel = b.geometry();
  const n = new Batch();
  n.box(0.42, 0.0022, 0.36, 0, 0.0052, 0.3, PCB);
  n.box(0.05, 0.012, 0.05, 0, 0.012, 0.28, 0x8d98a2);
  const inner = n.geometry();
  return { bezel, inner };
}

function blankGeo() {
  const b = new Batch();
  b.box(TRAY_W + 0.039, TRAY_H - 0.0008, 0.003, 0, YC, Z_FRONT - 0.0015, 0x15191e);
  for (let i = 0; i < 9; i++) b.box(0.03, 0.0016, 0.0012, -0.18 + i * 0.045, YC, Z_FRONT + 0.0003, 0x0a0d10);
  for (const sx of [-1, 1]) b.cyl(0.0034, 0.004, sx * 0.2345, YC, Z_FRONT + 0.0015, 0x8a97a3, 'z', 10);
  return { bezel: b.geometry(), inner: null };
}

// horizontal cable manager (finger duct) used above/below the management switches
export function hcmGeometry() {
  const b = new Batch();
  b.box(TRAY_W + 0.039, TRAY_H - 0.0008, 0.003, 0, YC, Z_FRONT - 0.0015, 0x12161a);
  for (let i = 0; i < 27; i++) {
    const x = -0.2145 + i * 0.0165;
    b.box(0.0035, 0.004, 0.096, x, 0.004, Z_FRONT + 0.048, 0x1d2329);
    b.box(0.0035, 0.004, 0.096, x, TRAY_H - 0.003, Z_FRONT + 0.048, 0x1d2329);
  }
  b.box(TRAY_W - 0.004, 0.003, 0.004, 0, 0.004, Z_FRONT + 0.096, 0x262d34);
  b.box(TRAY_W - 0.004, 0.003, 0.004, 0, TRAY_H - 0.003, Z_FRONT + 0.096, 0x262d34);
  return b.geometry();
}

// ---- assemble ---------------------------------------------------------------
export function buildUnits(model, M, leds) {
  const root = new THREE.Group();
  root.name = 'units';
  const geo = {
    compute: computeGeo(model.compute[0].ports),
    switch: switchGeo(model.switches[0].ports),
    power: powerGeo(model.shelves[0].ports),
    mgmt: mgmtGeo(model.mgmt[0].ports),
    blank: blankGeo(),
    hcm: { bezel: hcmGeometry(), inner: null },
  };
  const bodyGeo = new THREE.BoxGeometry(TRAY_W, TRAY_H, BODY_D);
  bodyGeo.translate(0, YC, BODY_ZC);
  const shortGeo = new THREE.BoxGeometry(TRAY_W, TRAY_H, 0.43);
  shortGeo.translate(0, YC, Z_FRONT - 0.004 - 0.215);
  const edgeGeo = new THREE.EdgesGeometry(bodyGeo);
  const edgeShortGeo = new THREE.EdgesGeometry(shortGeo);
  const gpuGeo = new THREE.BoxGeometry(0.086, 0.015, 0.086);
  const gpuLidGeo = new THREE.BoxGeometry(0.058, 0.003, 0.058);
  const swGeo = new THREE.BoxGeometry(0.112, 0.016, 0.112);

  const out = { root, gpuMesh: [], swMesh: [], picks: [], unitGroup: new Map(), chassis: [], edges: [] };

  for (const unit of model.units) {
    const g = new THREE.Group();
    g.name = unit.id;
    g.position.set(0, unit.y, unit.pull);
    unit.group = g;
    out.unitGroup.set(unit.id, g);
    root.add(g);
    const kind = unit.hcm ? 'hcm' : unit.kind;
    unit.visualKind = kind;
    const gk = geo[kind];

    const bezel = new THREE.Mesh(gk.bezel, kind === 'hcm' || kind === 'blank' ? M.matte : M.bezel);
    bezel.userData.pick = { type: 'unit', unit, bezel: true };
    g.add(bezel);
    out.picks.push(bezel);

    if (kind !== 'blank' && kind !== 'hcm') {
      const body = new THREE.Mesh(kind === 'mgmt' ? shortGeo : bodyGeo, M.chassis);
      body.userData.pick = { type: 'unit', unit };
      g.add(body);
      out.picks.push(body);
      out.chassis.push(body);
      const e = new THREE.LineSegments(kind === 'mgmt' ? edgeShortGeo : edgeGeo, M.edge);
      e.visible = false;
      g.add(e);
      out.edges.push(e);
      if (gk.inner) g.add(new THREE.Mesh(gk.inner, M.guts));
    }

    if (kind === 'switch') {
      const v = ventPlane(M, 0.296, 0.027);
      v.position.set(0.055, YC, Z_FRONT + 0.0004);
      g.add(v);
      for (let k = 1; k <= 2; k++) {
        const s = unit.swTray * 2 + (k - 1);
        const mesh = new THREE.Mesh(swGeo, M.nvsw.clone());
        mesh.position.set(NVSW_X[k - 1], 0.0145, NVSW_Z);
        mesh.userData.pick = { type: 'nvsw', id: s };
        g.add(mesh);
        out.swMesh[s] = mesh;
        out.picks.push(mesh);
      }
    }
    if (kind === 'compute') {
      for (let nn = 1; nn <= 4; nn++) {
        const id = gpuOf(unit.trayIndex, nn);
        const mesh = new THREE.Mesh(gpuGeo, M.gpu.clone());
        mesh.position.set(GPU_X[nn - 1], 0.0142, GPU_Z);
        mesh.userData.pick = { type: 'gpu', id };
        const lid = new THREE.Mesh(gpuLidGeo, M.steel);
        lid.position.y = 0.009;
        lid.userData.pick = mesh.userData.pick;
        mesh.add(lid);
        out.picks.push(lid);
        g.add(mesh);
        out.gpuMesh[id] = mesh;
        out.picks.push(mesh);
      }
    }
    if (kind === 'power') {
      for (const x of PSU_X) {
        const v = ventPlane(M, 0.034, 0.03);
        v.position.set(x - 0.009, YC, Z_FRONT + 0.0023);
        g.add(v);
      }
      unit.psuLeds = PSU_X.map((x) => leds.add(unit, x + 0.012, YC + 0.013));
    }

    // LEDs: one per port plus power / health on the left ear
    if (unit.ports) {
      for (const p of unit.ports) {
        const d = PORT_DIM[p.type];
        p.ledIndex = leds.add(unit, p.x - d.w / 2 + 0.0024, p.y + d.h / 2 + 0.0034, Z_FRONT + 0.0012, p.unit.kind === 'mgmt' ? 0.7 : 1);
      }
    }
    if (kind !== 'blank' && kind !== 'hcm') {
      unit.ledPower = leds.add(unit, 0.2135, YC + 0.0125, Z_FRONT + 0.0112, 1.1);
      unit.ledHealth = leds.add(unit, 0.2135, YC - 0.0125, Z_FRONT + 0.0112, 1.1);
    }
  }
  return out;
}

export { YC, BODY_D, BODY_ZC, PSU_X };
