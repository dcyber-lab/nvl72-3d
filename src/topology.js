// Logical model of one NVL72 rack: units, GPUs, NVSwitch ASICs, the 1,296
// NVLink links, front-panel ports and the cabling plan. No rendering here.

import { uOfSlot, yOfU, Z_FRONT, PORT_Y, U } from './config.js';

export const N_COMPUTE = 18;
export const N_SWTRAY = 9;
export const N_GPU = 72;
export const N_NVSW = 18;
export const N_LINK = N_GPU * N_NVSW; // 1,296
export const N_CART = 4;

export const COMPUTE_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
export const SWITCH_SLOTS = [9, 10, 11, 12, 13, 14, 15, 16, 17];
export const LEADER_SLOT = 9; // switch tray that runs NMX-C / NMX-T

export const slotOfTrayIndex = (t) => COMPUTE_SLOTS[t];
export const trayIndexOfSlot = (slot) => (slot <= 8 ? slot - 1 : slot - 10);
export const isComputeSlot = (slot) => slot <= 8 || slot >= 18;

// ---- wiring rule -----------------------------------------------------------
// GPU g = 4*trayIndex + (nn-1), NVSwitch s = 2*(swSlot-9) + (k-1).
// GPU port p (1..18) lands on NVSwitch s = p-1, i.e. slot 9+floor((p-1)/2),
// odd p -> swt-01, even p -> swt-02. On the switch side the port number is
// 4*trayIndex + nn, i.e. g+1. One link per (GPU, NVSwitch) pair.
export const gpuOf = (trayIndex, nn) => trayIndex * 4 + (nn - 1);
export const gpuTray = (g) => g >> 2;
export const gpuNN = (g) => (g & 3) + 1;
export const gpuSlot = (g) => COMPUTE_SLOTS[g >> 2];
export const swTrayOf = (s) => s >> 1;
export const swSlot = (s) => 9 + (s >> 1);
export const swK = (s) => (s & 1) + 1;
export const linkOf = (g, s) => g * N_NVSW + s;
export const linkGpu = (l) => Math.floor(l / N_NVSW);
export const linkSw = (l) => l % N_NVSW;
export const gpuPortOfLink = (l) => (l % N_NVSW) + 1;
export const swPortOfLink = (l) => Math.floor(l / N_NVSW) + 1;
export const cartOfLink = (l) => Math.floor(l / N_NVSW) & 3; // cartridge follows gpu-NN

const pad2 = (n) => String(n).padStart(2, '0');
export const gpuName = (g) => `slot-${pad2(gpuSlot(g))}.gpu-${pad2(gpuNN(g))}`;
export const swName = (s) => `slot-${pad2(swSlot(s))}.swt-${pad2(swK(s))}`;
export const slotName = (slot) => `slot-${pad2(slot)}`;

// ---- units in the rack -----------------------------------------------------
// kind: compute | switch | power | mgmt | blank
function buildUnits() {
  // U positions follow NVIDIA's published GB200 NVL72 elevation: U1-5 blank,
  // U6-9 power, U11-18 compute, U19-27 NVLink switches, U28-37 compute,
  // U39-42 power, U44-45 management switches.
  const units = [];
  const add = (o) => {
    o.y = yOfU(o.u);
    o.pull = 0; // metres pulled out of the rack (front)
    o.pullTarget = 0;
    o.seated = true;
    o.fault = null; // 'offline' for compute, 'failed' for switch
    units.push(o);
    return o;
  };
  for (let u = 1; u <= 5; u++) add({ id: `blank-${u}`, kind: 'blank', u });
  for (let i = 0; i < 4; i++) add({ id: `ps-b${i + 1}`, kind: 'power', u: 6 + i, name: `电源架 B${i + 1}`, shelf: i });
  add({ id: 'blank-10', kind: 'blank', u: 10 });
  for (let slot = 1; slot <= 27; slot++) {
    if (isComputeSlot(slot)) {
      add({ id: slotName(slot), kind: 'compute', u: uOfSlot(slot), slot, trayIndex: trayIndexOfSlot(slot), name: `计算托盘 ${slotName(slot)}` });
    } else {
      add({ id: slotName(slot), kind: 'switch', u: uOfSlot(slot), slot, swTray: slot - 9, name: `NVLink 交换托盘 ${slotName(slot)}`, leader: slot === LEADER_SLOT });
    }
  }
  add({ id: 'blank-38', kind: 'blank', u: 38 });
  for (let i = 0; i < 4; i++) add({ id: `ps-t${i + 1}`, kind: 'power', u: 39 + i, name: `电源架 T${i + 1}`, shelf: 4 + i });
  add({ id: 'hcm-43', kind: 'blank', hcm: true, u: 43 });
  add({ id: 'mgmt-1', kind: 'mgmt', u: 44, name: '管理交换机 1 · SN2201', mgmt: 0 });
  add({ id: 'mgmt-2', kind: 'mgmt', u: 45, name: '管理交换机 2 · SN2201', mgmt: 1 });
  add({ id: 'hcm-46', kind: 'blank', hcm: true, u: 46 });
  for (let u = 47; u <= 48; u++) add({ id: `blank-${u}`, kind: 'blank', u });
  return units;
}

// ---- front panel ports -----------------------------------------------------
// type: physical form factor (osfp | qsfp | rj45); net: ib | eth | oob
// Compute tray: two I/O bays (BlueField-3 + two ConnectX-7 OSFP cages each)
// flanking the E1.S drive cage, as on the NVIDIA reference tray.
// `side` is the cable duct the patch cord dresses into (-1 left, +1 right).
const COMPUTE_PORTS = [
  { key: 'bf1m', type: 'rj45', net: 'oob', label: 'BlueField-3 #1 BMC', x: -0.196, side: -1 },
  { key: 'bf1p1', type: 'qsfp', net: 'eth', label: 'BlueField-3 #1 P1', x: -0.174, side: -1 },
  { key: 'bf1p2', type: 'qsfp', net: 'eth', label: 'BlueField-3 #1 P2', x: -0.152, side: -1 },
  { key: 'ib1', type: 'osfp', net: 'ib', label: 'ConnectX-7 P1', x: -0.124, side: -1 },
  { key: 'ib2', type: 'osfp', net: 'ib', label: 'ConnectX-7 P2', x: -0.098, side: -1 },
  { key: 'pxe', type: 'rj45', net: 'none', label: '主机 1GbE（PXE，未接线）', x: -0.074, side: -1 },
  { key: 'bmc', type: 'rj45', net: 'oob', label: 'BMC', x: 0.045, side: 1 },
  { key: 'bf2m', type: 'rj45', net: 'oob', label: 'BlueField-3 #2 BMC', x: 0.092, side: 1 },
  { key: 'bf2p1', type: 'qsfp', net: 'eth', label: 'BlueField-3 #2 P1', x: 0.114, side: 1 },
  { key: 'bf2p2', type: 'qsfp', net: 'eth', label: 'BlueField-3 #2 P2', x: 0.136, side: 1 },
  { key: 'ib3', type: 'osfp', net: 'ib', label: 'ConnectX-7 P3', x: 0.164, side: 1 },
  { key: 'ib4', type: 'osfp', net: 'ib', label: 'ConnectX-7 P4', x: 0.19, side: 1 },
];
const SWITCH_PORTS = [
  { key: 'mgmt0', type: 'rj45', net: 'oob', label: 'NVOS mgmt0', x: -0.176, side: -1 },
  { key: 'mgmt1', type: 'rj45', net: 'oob', label: 'NVOS mgmt1', x: -0.158, side: -1 },
  { key: 'bmc', type: 'rj45', net: 'oob', label: 'BMC', x: -0.134, side: -1 },
  { key: 'con', type: 'rj45', net: 'none', label: '串口 RS-232（115200，未接线）', x: -0.11, side: -1 },
];
const POWER_PORTS = [{ key: 'pmc', type: 'rj45', net: 'oob', label: '电源管理控制器 PMC', x: -0.196, side: -1 }];

export const PORT_DIM = {
  osfp: { w: 0.0235, h: 0.0135, plugW: 0.0218, plugH: 0.0118, plugL: 0.094, insert: 0.058, name: 'OSFP' },
  qsfp: { w: 0.0195, h: 0.0095, plugW: 0.018, plugH: 0.008, plugL: 0.078, insert: 0.05, name: 'QSFP112' },
  rj45: { w: 0.0145, h: 0.0125, plugW: 0.0112, plugH: 0.0078, plugL: 0.036, insert: 0.014, name: 'RJ45' },
};

function mgmtPorts() {
  const out = [];
  for (let n = 1; n <= 48; n++) {
    const col = (n - 1) >> 1;
    const top = (n - 1) % 2 === 0;
    out.push({
      key: `p${n}`, type: 'rj45', net: 'oob', label: `swp${n}`, far: true,
      x: -0.196 + col * 0.0152 + Math.floor(col / 6) * 0.004,
      y: top ? 0.0305 : 0.0125,
    });
  }
  for (let i = 0; i < 4; i++) {
    out.push({ key: `up${i + 1}`, type: 'qsfp', net: 'oob', label: `上联 swp${49 + i}`, far: true, x: 0.182 + (i >> 1) * 0.0225, y: i % 2 === 0 ? 0.031 : 0.0125 });
  }
  return out;
}

// ---- model -----------------------------------------------------------------
export class Model {
  constructor() {
    this.units = buildUnits();
    this.unitById = new Map(this.units.map((u) => [u.id, u]));
    this.compute = this.units.filter((u) => u.kind === 'compute').sort((a, b) => a.trayIndex - b.trayIndex);
    this.switches = this.units.filter((u) => u.kind === 'switch').sort((a, b) => a.swTray - b.swTray);
    this.shelves = this.units.filter((u) => u.kind === 'power').sort((a, b) => a.shelf - b.shelf);
    this.mgmt = this.units.filter((u) => u.kind === 'mgmt');

    // ports
    this.ports = [];
    this.portByRef = new Map();
    for (const unit of this.units) {
      const defs = unit.kind === 'compute' ? COMPUTE_PORTS : unit.kind === 'switch' ? SWITCH_PORTS : unit.kind === 'power' ? POWER_PORTS : unit.kind === 'mgmt' ? mgmtPorts() : [];
      unit.ports = [];
      for (const d of defs) {
        const port = { ...d, id: this.ports.length, unit, ref: `${unit.id}:${d.key}`, y: d.y ?? PORT_Y, cable: null, led: 0 };
        this.ports.push(port);
        this.portByRef.set(port.ref, port);
        unit.ports.push(port);
      }
    }

    // fault flags
    this.gpuFault = new Uint8Array(N_GPU); // 1 = reset / failed
    this.swFault = new Uint8Array(N_NVSW);
    this.linkFault = new Uint8Array(N_LINK); // 1 = pair/connector fault, 2 = degraded (errors)
    this.cart = Array.from({ length: N_CART }, (_, i) => ({ id: i, name: `线缆背板 ${i + 1}`, seated: true, pull: 0, pullTarget: 0 }));
    this.telemetryDown = false;
    this.powerOff = false; // true while no power shelf is seated

    // link state machine: 0 down, 1 training, 2 up
    this.linkPhys = new Uint8Array(N_LINK);
    this.linkState = new Uint8Array(N_LINK);
    this.linkTrain = new Float32Array(N_LINK);
    this.linkDowned = new Uint32Array(N_LINK);

    this.cables = [];
    this._buildCablePlan();
    this.listeners = new Map();
    this.recomputePhys(0, true);
  }

  on(evt, fn) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, []);
    this.listeners.get(evt).push(fn);
  }
  emit(evt, payload) {
    const l = this.listeners.get(evt);
    if (l) for (const fn of l) fn(payload);
  }

  portWorld(port, out) {
    out.x = port.x;
    out.y = port.unit.y + port.y;
    out.z = Z_FRONT + port.unit.pull;
    return out;
  }

  // ---- cabling plan --------------------------------------------------------
  _buildCablePlan() {
    const add = (net, type, a, far, label) => {
      const portA = this.portByRef.get(a);
      const c = { id: this.cables.length, net, type, home: portA, far, label, port: null, state: 'plugged' };
      this.cables.push(c);
      c.port = portA;
      portA.cable = c;
      return c;
    };
    for (const tray of this.compute) {
      const t = tray.trayIndex;
      // Scale-out: rail-optimised, CX-7 port i -> IB leaf i
      for (let i = 1; i <= 4; i++) add('ib', 'osfp', `${tray.id}:ib${i}`, { dev: `ib-leaf-${i}`, port: t + 1 }, `IB 400G · ${tray.id} P${i}`);
      // Scale-in: each DPU dual-homed to the two front-end switches
      for (let b = 1; b <= 2; b++) for (let p = 1; p <= 2; p++) add('eth', 'qsfp', `${tray.id}:bf${b}p${p}`, { dev: p === 1 ? 'eth-a' : 'eth-b', port: t * 2 + b }, `ETH · ${tray.id} BF3-${b} P${p}`);
      // Out-of-band
      add('oob', 'rj45', `${tray.id}:bmc`, { dev: 'mgmt-1', port: t + 1 }, `OOB · ${tray.id} BMC`);
      add('oob', 'rj45', `${tray.id}:bf1m`, { dev: 'mgmt-2', port: t + 1 }, `OOB · ${tray.id} BF3-1 BMC`);
      add('oob', 'rj45', `${tray.id}:bf2m`, { dev: 'mgmt-2', port: 18 + t + 1 }, `OOB · ${tray.id} BF3-2 BMC`);
    }
    for (const sw of this.switches) {
      const i = sw.swTray;
      add('oob', 'rj45', `${sw.id}:mgmt0`, { dev: 'mgmt-1', port: 19 + i }, `OOB · ${sw.id} mgmt0`);
      add('oob', 'rj45', `${sw.id}:bmc`, { dev: 'mgmt-1', port: 28 + i }, `OOB · ${sw.id} BMC`);
      add('oob', 'rj45', `${sw.id}:mgmt1`, { dev: 'mgmt-2', port: 37 + i }, `OOB · ${sw.id} mgmt1`);
    }
    for (const ps of this.shelves) add('oob', 'rj45', `${ps.id}:pmc`, { dev: 'mgmt-1', port: 37 + ps.shelf }, `OOB · ${ps.id} PMC`);
    // mark the management switch ports that the far ends occupy
    for (const c of this.cables) {
      if (c.far.dev.startsWith('mgmt-')) {
        const p = this.portByRef.get(`${c.far.dev}:p${c.far.port}`);
        p.farCable = c;
      }
    }
  }

  cablesOfUnit(unit) {
    return this.cables.filter((c) => c.home.unit === unit);
  }

  // A cable is "correct" when it sits in its planned port.
  cableOk(c) {
    return c.port === c.home && c.state === 'plugged';
  }

  // ---- physical link availability -----------------------------------------
  gpuAlive(g) {
    const tray = this.compute[g >> 2];
    return tray.seated && !tray.fault && !this.gpuFault[g] && !this.powerOff;
  }
  swAlive(s) {
    const tray = this.switches[s >> 1];
    return tray.seated && !tray.fault && !this.swFault[s] && !this.powerOff;
  }

  recomputePhys(now, instant = false) {
    const gAlive = new Uint8Array(N_GPU);
    const sAlive = new Uint8Array(N_NVSW);
    for (let g = 0; g < N_GPU; g++) gAlive[g] = this.gpuAlive(g) ? 1 : 0;
    for (let s = 0; s < N_NVSW; s++) sAlive[s] = this.swAlive(s) ? 1 : 0;
    let changed = false;
    for (let l = 0; l < N_LINK; l++) {
      const g = (l / N_NVSW) | 0;
      const s = l % N_NVSW;
      const phys = gAlive[g] && sAlive[s] && this.cart[g & 3].seated && this.linkFault[l] !== 1 ? 1 : 0;
      if (phys !== this.linkPhys[l]) {
        this.linkPhys[l] = phys;
        changed = true;
        if (phys) {
          if (instant) this.linkState[l] = 2;
          else {
            this.linkState[l] = 1;
            this.linkTrain[l] = now + 0.9 + Math.random() * 1.3;
          }
        } else {
          if (this.linkState[l] === 2 && !instant) this.linkDowned[l]++;
          this.linkState[l] = 0;
        }
      }
    }
    if (changed) this.emit('links');
    return changed;
  }

  // advance link training; returns true when any link came up
  stepLinks(now) {
    let any = false;
    for (let l = 0; l < N_LINK; l++) {
      if (this.linkState[l] === 1 && now >= this.linkTrain[l]) {
        this.linkState[l] = 2;
        any = true;
      }
    }
    if (any) this.emit('links');
    return any;
  }

  countLinksUp() {
    let n = 0;
    for (let l = 0; l < N_LINK; l++) if (this.linkState[l] === 2) n++;
    return n;
  }
  gpuLinksUp(g) {
    let n = 0;
    for (let s = 0; s < N_NVSW; s++) if (this.linkState[g * N_NVSW + s] === 2) n++;
    return n;
  }
  swLinksUp(s) {
    let n = 0;
    for (let g = 0; g < N_GPU; g++) if (this.linkState[g * N_NVSW + s] === 2) n++;
    return n;
  }
  gpusInDomain() {
    let n = 0;
    for (let g = 0; g < N_GPU; g++) if (this.gpuLinksUp(g) > 0) n++;
    return n;
  }

  // ---- faults --------------------------------------------------------------
  clearFaults(now) {
    this.gpuFault.fill(0);
    this.swFault.fill(0);
    this.linkFault.fill(0);
    for (const u of this.units) u.fault = null;
    this.telemetryDown = false;
    this.recomputePhys(now);
    this.emit('faults');
  }
}

export { U, COMPUTE_PORTS, SWITCH_PORTS, POWER_PORTS };
