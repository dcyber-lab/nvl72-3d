// NVL72 interactive rack — application wiring and frame loop.

import * as THREE from 'three';
import { createStage, CameraPilot } from './stage.js';
import { makeMaterials } from './build.js';
import { Model, N_LINK, N_GPU, N_NVSW, PORT_DIM, gpuName, swName, slotName } from './topology.js';
import { Leds, buildUnits, YC, BODY_D, BODY_ZC } from './units.js';
import { buildFloor, buildRack, buildSurroundings } from './rack.js';
import { FlowTable, ribbonShared, tickRibbons } from './ribbon.js';
import { buildNvlink, buildCooling, buildPower } from './links.js';
import { Cabling, buildNetDevices } from './cables.js';
import { Sim } from './sim.js';
import { Interaction } from './interact.js';
import { createUI } from './ui.js';
import { createTour } from './tour.js';
import { Z_FRONT, Z_REAR, TRAY_W, TRAY_H, CART_X, CART, GPU_X, GPU_Z, NVSW_X, NVSW_Z, NETRACK_X, MANI_SUPPLY_X, MANI_RETURN_X, BUSBAR_X, yOfU, uOfSlot, SHELF_KW, TRAY_Y_OVERHEAD } from './config.js';

const q = new URLSearchParams(location.search);

class Fx {
  // short additive flashes used when blind-mate connectors engage or part
  constructor(scene) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.pool = [];
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      s.visible = false;
      scene.add(s);
      this.pool.push({ s, t: 1, dur: 1 });
    }
    this.i = 0;
  }
  flash(x, y, z, color, size = 0.07, dur = 0.4, delay = 0) {
    const p = this.pool[this.i++ % this.pool.length];
    p.s.position.set(x, y, z);
    p.s.material.color.set(color).multiplyScalar(3);
    p.size = size;
    p.t = -delay;
    p.dur = dur;
    p.s.visible = true;
    p.s.material.opacity = 0;
  }
  update(dt) {
    for (const p of this.pool) {
      if (!p.s.visible) continue;
      p.t += dt;
      if (p.t < 0) continue;
      const k = p.t / p.dur;
      if (k >= 1) { p.s.visible = false; continue; }
      p.s.material.opacity = (1 - k) * (1 - k);
      p.s.scale.setScalar(p.size * (0.5 + 1.4 * k));
    }
  }
}

function boxHelper(color) {
  const m = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }));
  m.visible = false;
  m.renderOrder = 20;
  m.frustumCulled = false;
  return m;
}

class App {
  constructor() {
    const canvas = document.getElementById('stage');
    this.lowQ = q.get('quality') === 'low';
    this.stage = createStage(canvas, { bloom: q.get('bloom') !== '0' && !this.lowQ, maxPixelRatio: this.lowQ ? 1 : 2, samples: this.lowQ ? 0 : 4 });
    const { scene } = this.stage;
    this.M = makeMaterials();
    this.M.chassisOpen = this.M.chassis.clone();
    Object.assign(this.M.chassisOpen, { transparent: true, opacity: 0.14, depthWrite: false, metalness: 0.3, roughness: 0.75, envMapIntensity: 0.25 });
    this.model = new Model();
    this.flow = new FlowTable();
    ribbonShared.uFlow.value = this.flow.tex;
    ribbonShared.uPixelWorld = this.stage.pixelWorld;

    this.layers = { nv: true, ib: true, eth: true, oob: true, pwr: true, liq: true };
    this.xray = false;
    this.labelsOn = false;
    this.paused = false;
    this.heat = false;
    this.speed = 1;
    this.view = 'overview';
    this.selection = null;
    this.simTime = 0;
    this.animTime = 0; // packet animation clock, scaled by the speed slider
    this.moving = new Set();
    this.timers = [];

    buildFloor(scene);
    this.leds = new Leds();
    this.units = buildUnits(this.model, this.M, this.leds);
    this.rack = buildRack(this.model, this.M);
    this.around = buildSurroundings(this.M);
    this.netDev = buildNetDevices(this.M, this.leds);
    scene.add(this.units.root, this.rack.root, this.around.root, this.netDev.root, this.leds.mesh);
    this.nv = buildNvlink(this.model, this.flow, this.rack.cartGroups);
    this.cool = buildCooling(this.model, this.flow, this.rack.root);
    this.pwr = buildPower(this.model, this.flow, this.rack.root);
    this.cabling = new Cabling(this.model, this.flow, this.M, this.leds, this.netDev.devs);
    scene.add(this.cabling.root);
    this.sim = new Sim(this.model, this.cabling);
    this.fx = new Fx(scene);
    this.selBox = boxHelper(0xf2f5f3);
    this.hovBox = boxHelper(0x6fd3a3);
    this.hovBox.material.opacity = 0.6;
    scene.add(this.selBox, this.hovBox);

    // invisible proxies so the fat manifold ribbons can be picked
    const prox = new THREE.MeshBasicMaterial({ visible: false });
    for (const [x, which] of [[MANI_SUPPLY_X, 'supply'], [MANI_RETURN_X, 'return']]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.9, 8), prox);
      m.position.set(x, 1.02, Z_REAR - 0.06);
      m.userData.pick = { type: 'manifold', id: which, which };
      scene.add(m);
      this.rack.picks.push(m);
    }
    this.pickables = [...this.units.picks, ...this.rack.picks, ...this.cabling.pickList, ...this.netDev.picks];

    this.baseHlLink = new Uint8Array(N_LINK).fill(1);
    this.baseHlCable = new Uint8Array(this.model.cables.length).fill(1);
    this.hoverFlow = -1;

    this.pilot = new CameraPilot(this.stage);
    this.ui = createUI(this);
    this.tour = createTour(this);
    this.interaction = new Interaction(this);
    this._wireEvents();
    this._labels();

    // start with the fabric training up so the first seconds show links coming alive
    for (let l = 0; l < N_LINK; l++) {
      this.model.linkState[l] = 1;
      this.model.linkTrain[l] = 0.5 + Math.floor(l / 18 / 4) * 0.06 + Math.random() * 0.5;
    }
    this.sim.applyScenario('train');
    this.ui.syncTraffic();
    this.ui.syncCabling();
    this.ui.syncLayers();
    this.ui.syncToggles();
    this.ui.renderInspector();
    this.onLayout();
    this._applyQuery();

    this._last = performance.now();
    this._uiT = 0;
    this._slow = 0;
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---- events from the model / cabling / sim ---------------------------------
  _wireEvents() {
    const { model, cabling, sim, ui } = this;
    model.on('links', () => { this._linksDirty = true; });
    model.on('cabling', () => { this._cablingDirty = true; });
    cabling.onEvent = (e) => {
      if (e.type === 'yank') ui.toast('线缆被拉脱', `${e.cable.label}：托盘拉出前应先拔掉前面板线缆`, 'crit');
      else if (e.type === 'plug') {
        const ok = e.port === e.cable.home;
        const p = e.port;
        this.fx.flash(p.x, p.unit.y + p.y, Z_FRONT + 0.012, ok ? 0x4fd69a : 0xf2b23e, 0.05, 0.35);
        if (!ok) ui.toast('接线与规划不符', `${e.cable.label} 插入了 ${p.unit.id} · ${p.label}`, 'crit');
      }
    };
    sim.onAlert = (a, raised) => {
      if (this._quiet) return;
      if (raised) ui.toast(a.sev === 'info' ? '提示' : '告警', `${a.title}`, a.sev === 'info' ? 'info' : 'crit');
    };
    window.addEventListener('resize', () => { this.stage.resize(); this.onLayout(true); });
    window.addEventListener('keydown', (e) => {
      if (e.target.closest('input, dialog, select, textarea')) return;
      const k = e.key.toLowerCase();
      if (k === 'x') this.setXray(!this.xray);
      else if (k === 'l') this.setLabels(!this.labelsOn);
      else if (k === ' ') { e.preventDefault(); this.setPaused(!this.paused); }
      else if (k === 'escape') this.tour.active ? this.tour.stop() : this.select(null);
      else if (k === 'f' && this.selection) this.focus(this.selection);
      else if (k >= '1' && k <= '5') this.setView(['overview', 'front', 'rear', 'side', 'inside'][+k - 1]);
      else if (k === 'arrowright' && this.tour.active) this.tour.next();
      else if (k === 'arrowleft' && this.tour.active) this.tour.prev();
    });
  }

  _applyQuery() {
    if (q.get('xray') === '1') this.setXray(true, true);
    if (q.get('labels') === '1') this.setLabels(true);
    const v = q.get('view');
    this.setView(v || 'overview', true);
    const cam = q.get('cam');
    if (cam) {
      const a = cam.split(',').map(Number);
      this.stage.camera.position.set(a[0], a[1], a[2]);
      this.stage.controls.target.set(a[3] ?? 0, a[4] ?? 1.1, a[5] ?? 0);
    }
    if (q.get('warp')) {
      // fast-forward the simulation (handy for deep links and automated screenshots)
      const n = Math.round(+q.get('warp') / 0.05);
      for (let i = 0; i < n; i++) { this.simTime += 0.05; this.sim.step(0.05, this.simTime); this.cabling.update(0.05, this.simTime); }
    }
    if (q.get('pattern')) this.setPattern(q.get('pattern'));
    if (q.get('heat') === '1') this.setHeat(true);
    if (q.get('sel')) {
      const [type, id] = q.get('sel').split(':');
      this.select({ type, id: isNaN(+id) ? id : +id });
    }
    if (q.get('fault')) this.after(1.6, () => this.inject(q.get('fault')));
    if (q.get('tour')) this.after(0.4, () => this.tour.start(+q.get('tour') - 1 || 0));
    if (q.get('tab')) this.ui.setTab(q.get('tab'));
  }

  after(sec, fn) {
    this.timers.push({ at: this.wall + sec, fn });
  }
  get wall() {
    return performance.now() / 1000;
  }

  // ---- layout ---------------------------------------------------------------
  onLayout(refit = false) {
    const narrow = this.ui.isNarrow();
    const cam = this.stage.camera;
    const w = window.innerWidth, h = window.innerHeight;
    let l = 0, r = 0, t = 56, b = 0;
    if (narrow) {
      t = 100;
      b = 46 + (document.body.dataset.tab ? Math.min(h * 0.44, document.getElementById(document.body.dataset.tab === 'traffic' || document.body.dataset.tab === 'fault' || document.body.dataset.tab === 'cabling' ? 'left' : 'right').offsetHeight || h * 0.44) : 0);
    } else {
      l = document.getElementById('left').offsetWidth + 16;
      r = document.getElementById('right').offsetWidth + 16;
      b = 76;
    }
    const tourEl = document.getElementById('tour');
    if (!tourEl.hidden) b += tourEl.offsetHeight + 14; // keep the subject clear of the tour card
    cam.setViewOffset(w, h, (r - l) / 2, (b - t) / 2, w, h);
    cam.updateProjectionMatrix();
    this.insets = { l, r, t, b };
    // keep a named view framed when the free area changes (sheet opened, window resized)
    if (refit && this.view && this.pilot) this.setView(this.view);
  }

  // ---- entities --------------------------------------------------------------
  entityOf(h) {
    switch (h.type) {
      case 'unit': return h.unit.kind === 'blank' && !h.unit.hcm ? null : { type: 'unit', id: h.unit.id };
      case 'port': return { type: 'port', id: h.port.id };
      case 'cable': return { type: 'cable', id: h.cable.id };
      case 'netdev': return { type: 'netdev', id: h.dev.id };
      case 'manifold': return { type: 'manifold', id: h.which };
      case 'busbar': return { type: 'busbar', id: 0 };
      default: return { type: h.type, id: h.id };
    }
  }

  boxOf(ent, out) {
    // world-space centre + size of an entity's outline box; false when it has none
    const m = this.model;
    switch (ent.type) {
      case 'unit': {
        const u = m.unitById.get(ent.id);
        if (!u) return false;
        const short = u.kind === 'mgmt';
        out.c.set(0, u.y + YC, (short ? Z_FRONT - 0.215 : BODY_ZC) + u.pull);
        out.s.set(TRAY_W + 0.05, TRAY_H + 0.003, (short ? 0.44 : BODY_D + 0.03));
        return true;
      }
      case 'gpu': {
        const u = m.compute[ent.id >> 2];
        out.c.set(GPU_X[ent.id & 3], u.y + 0.016, GPU_Z + u.pull);
        out.s.set(0.094, 0.026, 0.094);
        return true;
      }
      case 'nvsw': {
        const u = m.switches[ent.id >> 1];
        out.c.set(NVSW_X[ent.id & 1], u.y + 0.016, NVSW_Z + u.pull);
        out.s.set(0.12, 0.026, 0.12);
        return true;
      }
      case 'port': {
        const p = m.ports[ent.id];
        const d = PORT_DIM[p.type];
        out.c.set(p.x, p.unit.y + p.y, Z_FRONT + p.unit.pull + 0.003);
        out.s.set(d.w + 0.005, d.h + 0.005, 0.008);
        return true;
      }
      case 'cart': {
        const [y0, y1] = this.rack.cartSpan;
        out.c.set(CART_X[ent.id], (y0 + y1) / 2, CART.zFace - CART.D / 2 - m.cart[ent.id].pull);
        out.s.set(CART.W + 0.008, y1 - y0 + 0.006, CART.D + 0.008);
        return true;
      }
      case 'netdev': {
        const d = this.cabling.netDevs.get(ent.id);
        out.c.set(NETRACK_X, yOfU(d.u) + YC, Z_FRONT - 0.25);
        out.s.set(TRAY_W + 0.05, TRAY_H + 0.003, 0.52);
        return true;
      }
      default:
        return false;
    }
  }

  // ---- selection + highlight --------------------------------------------------
  select(ent, { focus = false, reveal = false } = {}) {
    if (ent && ent.type === 'unit') {
      const u = this.model.unitById.get(ent.id);
      if (!u || (u.kind === 'blank' && !u.hcm)) ent = null;
    }
    this.selection = ent;
    if (ent && reveal && (ent.type === 'gpu' || ent.type === 'nvsw' || ent.type === 'link') && !this.xray) this.setXray(true);
    this.applyHighlight();
    this.ui.renderInspector();
    this.ui.drawMatrix();
    if (ent && this.ui.isNarrow() && document.body.dataset.tab !== 'matrix') this.ui.setTab('inspect');
    if (ent && focus) this.focus(ent);
  }

  applyHighlight() {
    const { model, flow } = this;
    const sel = this.selection;
    const L = this.baseHlLink, C = this.baseHlCable;
    let any = false;
    const fl = new Uint8Array(N_LINK), fc = new Uint8Array(C.length);
    const gpuLinks = (g) => { for (let s = 0; s < N_NVSW; s++) fl[g * N_NVSW + s] = 1; any = true; };
    const swLinks = (s) => { for (let g = 0; g < N_GPU; g++) fl[g * N_NVSW + s] = 1; any = true; };
    if (sel) {
      switch (sel.type) {
        case 'gpu': gpuLinks(sel.id); break;
        case 'nvsw': swLinks(sel.id); break;
        case 'link': fl[sel.id] = 1; any = true; break;
        case 'cart': for (let g = sel.id; g < N_GPU; g += 4) gpuLinks(g); break;
        case 'cable': fc[sel.id] = 1; any = true; break;
        case 'port': { const p = model.ports[sel.id]; const c = p.cable || p.farCable; if (c) { fc[c.id] = 1; any = true; } break; }
        case 'netdev': for (const c of model.cables) if (c.far.dev === sel.id) { fc[c.id] = 1; any = true; } break;
        case 'unit': {
          const u = model.unitById.get(sel.id);
          if (u.kind === 'compute') for (let k = 0; k < 4; k++) gpuLinks(u.trayIndex * 4 + k);
          if (u.kind === 'switch') { swLinks(u.swTray * 2); swLinks(u.swTray * 2 + 1); }
          for (const c of model.cables) if (c.home.unit === u || c.far.dev === u.id) { fc[c.id] = 1; any = true; }
          break;
        }
        default:
      }
    }
    for (let l = 0; l < N_LINK; l++) {
      L[l] = any ? (fl[l] ? 2 : 0) : 1;
      flow.setHl(this.nv.base + l, L[l]);
    }
    for (const c of model.cables) {
      C[c.id] = any ? (fc[c.id] ? 2 : 0) : 1;
      flow.setHl(c.flowId, C[c.id]);
    }
    this.hoverFlow = -1;
  }

  onHover(h) {
    const { flow, model } = this;
    if (this.hoverFlow >= 0) {
      const f = this.hoverFlow;
      if (f < N_LINK) flow.setHl(this.nv.base + f, this.baseHlLink[f]);
      else flow.setHl(model.cables[f - N_LINK].flowId, this.baseHlCable[f - N_LINK]);
      this.hoverFlow = -1;
    }
    this.hoverEnt = null;
    if (!h) return;
    if (h.type === 'link') {
      flow.setHl(this.nv.base + h.id, 2);
      this.hoverFlow = h.id;
    } else if (h.type === 'cable' || (h.type === 'port' && h.port && h.port.cable)) {
      const c = h.type === 'cable' ? h.cable : h.port.cable;
      flow.setHl(c.flowId, 2);
      this.hoverFlow = N_LINK + c.id;
      if (h.type === 'port') this.hoverEnt = { type: 'port', id: h.port.id };
    } else if (h.unit || h.type === 'gpu' || h.type === 'nvsw' || h.type === 'cart' || h.type === 'netdev') {
      this.hoverEnt = this.entityOf(h);
    }
  }

  onGrab(c) {
    this.select({ type: 'cable', id: c.id });
  }

  // ---- camera ----------------------------------------------------------------
  // distance at which a w x h metre subject fits the part of the viewport the panels leave free
  fitDistance(w, h) {
    const cam = this.stage.camera;
    const W = window.innerWidth, H = window.innerHeight;
    const ins = this.insets || { l: 0, r: 0, t: 0, b: 0 };
    const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const fw = Math.max(0.3, (W - ins.l - ins.r) / W), fh = Math.max(0.3, (H - ins.t - ins.b) / H);
    return Math.max(h / (2 * tan * fh), w / (2 * tan * cam.aspect * fw));
  }

  setView(name, instant = false) {
    // [direction from target, target, subject width, subject height]
    const V = {
      overview: [[0.5, 0.15, 0.85], [0.42, 1.2, 0.1], 2.5, 2.75],
      front: [[0.0, 0.03, 1.0], [0.42, 1.22, 0.3], 2.45, 2.75],
      rear: [[-0.5, 0.12, -0.86], [0.0, 1.1, -0.2], 1.5, 2.55],
      side: [[-1.0, 0.05, 0.06], [0.0, 1.12, 0.02], 1.35, 2.55],
      inside: [[-0.58, 0.5, -0.64], [0.0, 1.12, -0.05], 1.5, 2.3],
    }[name];
    if (!V) return;
    this.view = name;
    if (name === 'inside' && !this.xray) this.setXray(true);
    const d = this.fitDistance(V[2], V[3]);
    const dir = new THREE.Vector3().fromArray(V[0]).normalize();
    const pos = [V[1][0] + dir.x * d, V[1][1] + dir.y * d, V[1][2] + dir.z * d];
    if (instant) {
      this.stage.camera.position.fromArray(pos);
      this.stage.controls.target.fromArray(V[1]);
    } else this.pilot.flyTo(pos, V[1], 1.25);
    this.ui.syncToggles();
  }

  // fly so that a w x h metre subject around `target` is framed from direction `dir`
  frameView(dir, target, w, h, dur = 1.3) {
    const d = this.fitDistance(w, h);
    const v = new THREE.Vector3().fromArray(dir).normalize();
    this.flyTo([target[0] + v.x * d, target[1] + v.y * d, target[2] + v.z * d], target, dur);
  }

  flyTo(pos, target, dur = 1.2) {
    this.view = null;
    this.pilot.flyTo(pos, target, dur);
    this.ui.syncToggles();
  }

  focus(ent) {
    const m = this.model;
    switch (ent.type) {
      case 'unit': {
        const u = m.unitById.get(ent.id);
        this.frameView([0.42, 0.22, 0.88], [0.0, u.y + 0.02, 0.4], 0.95, 0.6);
        break;
      }
      case 'gpu': {
        const u = m.compute[ent.id >> 2];
        if (!this.xray) this.setXray(true);
        this.frameView([-0.55, 0.42, -0.72], [0.0, (u.y + m.switches[4].y) / 2, -0.2], 1.1, Math.max(0.9, Math.abs(u.y - m.switches[4].y) + 0.75));
        break;
      }
      case 'nvsw': {
        const u = m.switches[ent.id >> 1];
        if (!this.xray) this.setXray(true);
        this.frameView([-0.55, 0.36, -0.75], [0.0, u.y + 0.05, -0.2], 1.15, 1.75);
        break;
      }
      case 'link': {
        if (!this.xray) this.setXray(true);
        const g = Math.floor(ent.id / 18), s = ent.id % 18;
        const ya = m.compute[g >> 2].y, yb = m.switches[s >> 1].y;
        this.frameView([CART_X[g & 3] < 0 ? 0.5 : -0.5, 0.3, -0.8], [CART_X[g & 3], (ya + yb) / 2, -0.3], 0.9, Math.abs(ya - yb) + 0.6);
        break;
      }
      case 'cart':
        this.frameView([CART_X[ent.id] < 0 ? 0.42 : -0.42, 0.14, -0.9], [CART_X[ent.id], 1.14, -0.4], 1.0, 1.7);
        break;
      case 'cable': {
        const c = m.cables[ent.id];
        const p = c.port || c.home;
        this.frameView([c.side * 0.3, 0.2, 0.93], [p.x * 0.8 + c.side * 0.05, p.unit.y + 0.02, 0.52], 0.75, 0.5);
        break;
      }
      case 'port': {
        const p = m.ports[ent.id];
        this.frameView([p.x > 0 ? 0.25 : -0.25, 0.2, 0.94], [p.x, p.unit.y + 0.02, 0.5], 0.6, 0.42);
        break;
      }
      case 'netdev': {
        const d = this.cabling.netDevs.get(ent.id);
        this.frameView([0.35, 0.2, 0.9], [NETRACK_X, yOfU(d.u), 0.5], 0.95, 0.6);
        break;
      }
      case 'busbar':
      case 'manifold':
        this.setView('rear');
        break;
      default:
    }
  }

  // ---- display toggles --------------------------------------------------------
  setXray(on, instant = false) {
    this.xray = on;
    this._xrayT = instant ? (on ? 1 : 0) : this._xrayT ?? 0;
    if (instant) this._applyXray(this._xrayT);
    this.ui.syncToggles();
  }

  _applyXray(k) {
    // X-ray is a schematic mode: chassis skins fade out completely (stacked translucent
    // skins would otherwise add up to a white haze), leaving outlines, chips and flows.
    const { M } = this;
    const solid = k <= 0.001;
    const set = (m, opacity, hideAtZero = false) => {
      m.transparent = !solid;
      m.depthWrite = solid;
      m.opacity = opacity;
      m.visible = !(hideAtZero && opacity <= 0.002);
      m.needsUpdate = true;
    };
    set(M.chassis, 1 - k, true);
    set(M.guts, 1 - 0.87 * k);
    // darken and matte the internals so 27 stacked layers read as a faint ghost, not a glare
    M.guts.color.setScalar(1 - 0.72 * k);
    M.guts.metalness = 0.45 - 0.4 * k;
    M.guts.envMapIntensity = 1 - 0.9 * k;
    set(M.bezel, 1 - 0.62 * k);
    set(M.matte, 1 - 0.6 * k);
    set(M.vent, 1 - 0.75 * k);
    M.bezel.depthWrite = true;
    M.matte.depthWrite = true;
    M.edge.opacity = 0.42 * k;
    for (const e of this.units.edges) e.visible = k > 0.02;
  }

  setLabels(on) {
    this.labelsOn = on;
    this.ui.syncToggles();
  }

  setPaused(on) {
    this.paused = on;
    this.ui.syncToggles();
  }

  setHeat(on) {
    this.heat = on;
    ribbonShared.uHeat.value = on ? 1 : 0;
    this.ui.syncTraffic();
  }

  setPattern(p) {
    this.sim.pattern = p;
    this.sim.scenario = null;
    if (p !== 'idle' && this.sim.intensity < 0.05) this.sim.intensity = 0.8;
    this.sim.dirty = true;
    this.ui.syncTraffic();
  }

  setLayer(k, on) {
    this.layers[k] = on;
    if (k === 'nv') for (const m of this.nv.meshes) m.visible = on;
    else if (k === 'liq') for (const m of this.cool.meshes) m.visible = on;
    else if (k === 'pwr') for (const m of this.pwr.meshes) m.visible = on;
    else this.cabling.setLayer(k, on);
    this.ui.syncLayers();
  }

  // ---- trays, cartridges, cabling --------------------------------------------
  canPull(u) {
    return u.kind === 'compute' || u.kind === 'switch' || u.kind === 'power';
  }

  setPull(u, v, direct = false) {
    u.pullTarget = v;
    if (direct) u.pull = v;
    this.moving.add(u);
    if (direct) this._applyPull(u);
  }

  togglePull(u) {
    if (u.pullTarget > 0.02) {
      this.setPull(u, 0);
    } else {
      // a technician unplugs the front-panel cords before sliding a tray out
      const n = this.cabling.unplugUnit(u, 0.045);
      this.after(n * 0.045 + (n ? 0.3 : 0), () => this.setPull(u, 0.56));
    }
    this.ui.renderInspector();
  }

  _applyPull(u) {
    u.group.position.z = u.pull;
    this.leds.moveUnit(u);
    this.cabling.wakeUnit(u);
    const seated = u.pull < 0.012;
    if (seated !== u.seated) {
      u.seated = seated;
      this._onSeat(u);
    }
    // show the internals of a tray that is out of the rack
    const open = u.pull > 0.05 && !this.xray;
    if (u._open !== open) {
      u._open = open;
      for (const ch of u.group.children) if (ch.material === this.M.chassis || ch.material === this.M.chassisOpen) ch.material = open ? this.M.chassisOpen : this.M.chassis;
    }
  }

  _onSeat(u) {
    const now = this.simTime;
    this.model.recomputePhys(now);
    this._cablingDirty = true;
    const y = u.y + YC, z = Z_REAR - 0.02 + (u.seated ? 0 : u.pull);
    const col = u.seated ? 0x7cf2b8 : 0xff7a62;
    if (u.kind !== 'power') for (let k = 0; k < 4; k++) this.fx.flash(CART_X[k], y, z, col, 0.09, 0.5, k * 0.03);
    this.fx.flash(BUSBAR_X, y, z, 0xffd79a, 0.08, 0.5);
    if (u.kind !== 'power') {
      this.fx.flash(MANI_SUPPLY_X, y, z, 0xa5e2ff, 0.07, 0.5, 0.05);
      this.fx.flash(MANI_RETURN_X, y, z, 0xffb9ad, 0.07, 0.5, 0.05);
    }
    if (!this._quiet) {
      if (u.kind === 'power') this.ui.toast(u.seated ? '已对接' : '已脱开', `${u.name}：汇流排${u.seated ? '取电夹闭合' : '取电夹脱开'}`, u.seated ? 'ok' : 'crit');
      else this.ui.toast(u.seated ? '盲插对接' : '盲插脱开', `${u.id}：NVLink × 4、汇流排、液冷快接头${u.seated ? '，链路重新训练' : ''}`, u.seated ? 'ok' : 'crit');
    }
    this.ui.renderInspector();
  }

  toggleCart(k) {
    const c = this.model.cart[k];
    c.pullTarget = c.pullTarget > 0.01 ? 0 : 0.27;
    this.moving.add(c);
    this.ui.renderInspector();
  }

  _applyCart(c) {
    c.group.position.z = -c.pull;
    const seated = c.pull < 0.008;
    if (seated !== c.seated) {
      c.seated = seated;
      this.model.recomputePhys(this.simTime);
      for (const t of [...this.model.compute, ...this.model.switches]) this.fx.flash(CART_X[c.id], t.y + YC, Z_REAR - 0.03, seated ? 0x7cf2b8 : 0xff7a62, 0.06, 0.45, Math.random() * 0.12);
      if (!this._quiet) this.ui.toast(seated ? '背板对接' : '背板脱开', `${c.name}：324 条 NVLink ${seated ? '重新训练' : '断开'}`, seated ? 'ok' : 'crit');
      this.ui.renderInspector();
    }
  }

  unplugAll() {
    this.cabling.unplugAll();
    this.ui.toast('接线', '全部 233 根前面板线缆已拔出', 'info');
  }

  autoWire() {
    const n = this.cabling.autoWire(0.028);
    this.ui.toast('接线', n ? `按接线表自动接回 ${n} 根线缆` : '全部线缆都已在规划端口上', 'ok');
  }

  assemble() {
    // replay: empty slots -> trays slide in and blind-mate -> cords get patched -> links train
    const { model, cabling } = this;
    this._quiet = true;
    this.clearFaults(true);
    this.select(null);
    this.setView('overview');
    for (const c of model.cables) if (c.state === 'plugged') cabling.unplug(c, { silent: true });
    const units = model.units.filter((u) => this.canPull(u));
    for (const u of units) {
      this.setPull(u, 0.62, true);
      u.group.visible = false;
    }
    for (const c of model.cart) { c.pull = c.pullTarget = 0.27; this._applyCart(c); c.pullTarget = 0; this.moving.add(c); }
    units.sort((a, b) => a.u - b.u);
    units.forEach((u, i) => this.after(0.9 + i * 0.085, () => { u.group.visible = true; this.setPull(u, 0); }));
    const tEnd = 0.9 + units.length * 0.085 + 0.9;
    this.after(tEnd, () => cabling.autoWire(0.02));
    this.after(tEnd + 6.2, () => { this._quiet = false; this.ui.toast('装配完成', '盲插对接、前面板接线、链路训练均已完成', 'ok'); });
  }

  // ---- faults ----------------------------------------------------------------
  inject(kind) {
    const { model, sim, ui } = this;
    const sel = this.selection;
    const now = this.simTime;
    let ent = null;
    switch (kind) {
      case 'link': {
        let l = sel && sel.type === 'link' ? sel.id : sel && sel.type === 'gpu' ? sel.id * 18 + 6 : sel && sel.type === 'nvsw' ? 41 * 18 + sel.id : 61 * 18 + 6;
        if (model.linkFault[l] === 1) l = (l + 19 * 37) % N_LINK;
        model.linkFault[l] = 1;
        ent = { type: 'link', id: l };
        break;
      }
      case 'gpu': {
        const g = sel && sel.type === 'gpu' ? sel.id : sel && sel.type === 'unit' && model.unitById.get(sel.id).kind === 'compute' ? model.unitById.get(sel.id).trayIndex * 4 + 2 : 70;
        model.gpuFault[g] = 1;
        ent = { type: 'gpu', id: g };
        break;
      }
      case 'tray': {
        const u = sel && sel.type === 'unit' && model.unitById.get(sel.id).kind === 'compute' ? model.unitById.get(sel.id) : sel && sel.type === 'gpu' ? model.compute[sel.id >> 2] : model.unitById.get(slotName(27));
        u.fault = 'offline';
        ent = { type: 'unit', id: u.id };
        break;
      }
      case 'nvsw': {
        const s = sel && sel.type === 'nvsw' ? sel.id : sel && sel.type === 'unit' && model.unitById.get(sel.id).kind === 'switch' ? model.unitById.get(sel.id).swTray * 2 : 8;
        model.swFault[s] = 1;
        ent = { type: 'nvsw', id: s };
        break;
      }
      case 'swtray': {
        const u = sel && sel.type === 'unit' && model.unitById.get(sel.id).kind === 'switch' ? model.unitById.get(sel.id) : sel && sel.type === 'nvsw' ? model.switches[sel.id >> 1] : model.unitById.get(slotName(13));
        u.fault = 'failed';
        ent = { type: 'unit', id: u.id };
        break;
      }
      case 'cart': {
        const k = sel && sel.type === 'cart' ? sel.id : 2;
        if (model.cart[k].pullTarget < 0.01) this.toggleCart(k);
        ent = { type: 'cart', id: k };
        break;
      }
      case 'ber': {
        const l = sel && sel.type === 'link' ? sel.id : 45 * 18 + 4;
        model.linkFault[l] = 2;
        ent = { type: 'link', id: l };
        break;
      }
      case 'telemetry':
        model.telemetryDown = !model.telemetryDown;
        if (!model.telemetryDown) ui.toast('恢复', '采集恢复，矩阵重新有数据', 'ok');
        break;
      case 'leak': {
        const u = sel && sel.type === 'unit' ? model.unitById.get(sel.id) : model.unitById.get(slotName(20));
        u.leak = true;
        ent = { type: 'unit', id: u.id };
        break;
      }
      default:
        return;
    }
    model.recomputePhys(now);
    sim.dirty = true;
    if (ent) this.select(ent, { reveal: true });
    else { ui.renderInspector(); ui.drawMatrix(); }
    model.emit('faults');
  }

  clearFaults(silent = false) {
    const { model } = this;
    model.clearFaults(this.simTime);
    for (const u of model.units) u.leak = false;
    for (const c of model.cart) if (c.pullTarget > 0.01) { c.pullTarget = 0; this.moving.add(c); }
    this.sim.dirty = true;
    this.ui.renderInspector();
    if (!silent) this.ui.toast('恢复', '已清除全部注入的故障，链路重新训练', 'ok');
  }

  // inspector buttons
  act(name) {
    const { model, sim, cabling } = this;
    const sel = this.selection;
    if (!sel) return;
    const now = this.simTime;
    const u = sel.type === 'unit' ? model.unitById.get(sel.id) : null;
    switch (name) {
      case 'pull': this.togglePull(u); return;
      case 'cables': {
        const cs = model.cables.filter((c) => c.home.unit === u);
        if (cs.some((c) => c.port !== c.home || c.state !== 'plugged')) cabling.replugUnit(u);
        else cabling.unplugUnit(u);
        this.after(0.9, () => this.ui.renderInspector());
        return;
      }
      case 'offline': u.fault = u.fault ? null : 'offline'; break;
      case 'swfail': u.fault = u.fault ? null : 'failed'; break;
      case 'gpureset': model.gpuFault[sel.id] ^= 1; break;
      case 'nvswfail': model.swFault[sel.id] ^= 1; break;
      case 'linkcut': model.linkFault[sel.id] = model.linkFault[sel.id] === 1 ? 0 : 1; break;
      case 'linkber': model.linkFault[sel.id] = model.linkFault[sel.id] === 2 ? 0 : 2; break;
      case 'pairA': sim.pairA = sel.id; if (sim.pairB === sel.id) sim.pairB = (sel.id + 36) % 72; this.setPattern('pair'); break;
      case 'pairB': sim.pairB = sel.id; if (sim.pairA === sel.id) sim.pairA = (sel.id + 36) % 72; this.setPattern('pair'); break;
      case 'incast': sim.incastTarget = sel.id; this.setPattern('incast'); break;
      case 'cable': {
        const c = model.cables[sel.id];
        if (c.state === 'plugged' && c.port === c.home) cabling.unplug(c);
        else cabling.rehome(c);
        this.after(0.5, () => this.ui.renderInspector());
        return;
      }
      case 'cart': this.toggleCart(sel.id); return;
      default: return;
    }
    model.recomputePhys(now);
    sim.dirty = true;
    this._cablingDirty = true;
    this.ui.renderInspector();
  }

  // ---- annotations -----------------------------------------------------------
  _labels() {
    const yS = (slot) => yOfU(uOfSlot(slot)) + YC;
    const x = 0.305, zf = 0.6, zr = -0.54;
    this.ui.setLabelDefs([
      { text: '管理交换机 × 2', sub: 'SN2201 · 带外 1GbE', pos: [x, yOfU(45), zf], face: 'front', color: 'var(--oob)' },
      { text: '电源架 × 4', sub: '每架 6 × 5.5 kW，输出约 50 V 直流', pos: [x, yOfU(41), zf], face: 'front', color: 'var(--pwr)' },
      { text: '计算托盘 × 10', sub: 'slot 18–27 · 每个 4 块 GPU', pos: [x, yS(22.5), zf], face: 'front', color: '#c9d4dc' },
      { text: 'NVLink 交换托盘 × 9', sub: 'slot 9–17 · 每个 2 颗 NVSwitch', pos: [x, yS(13) + 0.02, zf], face: 'front', color: 'var(--nv)' },
      { text: '计算托盘 × 8', sub: 'slot 1–8', pos: [x, yS(4.5), zf], face: 'front', color: '#c9d4dc' },
      { text: '电源架 × 4', sub: '上下共 8 架，N+N 冗余', pos: [x, yOfU(8), zf], face: 'front', color: 'var(--pwr)' },
      { text: '架顶走线槽', sub: 'InfiniBand 与以太网去往网络柜', pos: [0.55, TRAY_Y_OVERHEAD + 0.03, 0.57], face: 'front', color: 'var(--ib)' },
      { text: 'IB Leaf × 4', sub: 'Scale-out · 光模块与光纤', pos: [NETRACK_X + 0.24, yOfU(37), 0.52], face: 'front', color: 'var(--ib)' },
      { text: '前端以太网交换机 × 2', sub: 'Scale-in · 存储与带内管理', pos: [NETRACK_X + 0.24, yOfU(30.5), 0.52], face: 'front', color: 'var(--eth)' },
      { text: '线缆背板 × 4', sub: '无源铜缆 5,184 对，盲插', pos: [CART_X[0] - 0.03, yS(21), zr], face: 'rear', color: 'var(--nv)' },
      { text: '汇流排', sub: '约 50 V 直流 · 1,400 A', pos: [BUSBAR_X, yOfU(8.5), Z_REAR - 0.06], face: 'rear', color: 'var(--pwr)', right: true },
      { text: '回液歧管', sub: '温水回 CDU', pos: [MANI_RETURN_X, yS(8), Z_REAR - 0.08], face: 'rear', color: '#ff9d8f', right: true },
      { text: '供液歧管', sub: '冷板液冷：CPU、GPU、NVSwitch', pos: [MANI_SUPPLY_X, yS(3), Z_REAR - 0.08], face: 'rear', color: 'var(--liq)' },
      { text: '交换托盘后部', sub: '每个背板位 36 口', pos: [CART_X[1], yS(13), Z_REAR - 0.03], face: 'rear', color: 'var(--nv)', right: true },
    ]);
    this._proj = new THREE.Vector3();
  }

  _project = (pos) => {
    const v = this._proj.set(pos[0], pos[1], pos[2]).project(this.stage.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  };

  // ---- frame -----------------------------------------------------------------
  frame(nowMs) {
    requestAnimationFrame((t) => this.frame(t));
    const wall = nowMs / 1000;
    const dtRaw = (nowMs - this._last) / 1000;
    this._last = nowMs;
    const dt = Math.min(0.05, Math.max(0, dtRaw));
    const { stage, model, sim, cabling, flow, ui } = this;

    // timers
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= wall);
      if (due.length) {
        this.timers = this.timers.filter((t) => t.at > wall);
        for (const t of due) t.fn();
      }
    }

    // moving trays and cartridges
    for (const m of this.moving) {
      const d = m.pullTarget - m.pull;
      if (Math.abs(d) < 0.0004) m.pull = m.pullTarget;
      else m.pull += d * (1 - Math.exp(-dt * 9));
      if (m.group && m.kind) this._applyPull(m);
      else this._applyCart(m);
      if (m.pull === m.pullTarget) this.moving.delete(m);
    }

    // x-ray cross-fade
    const xt = this.xray ? 1 : 0;
    if (this._xrayT === undefined) this._xrayT = 0;
    if (this._xrayT !== xt) {
      this._xrayT += Math.sign(xt - this._xrayT) * Math.min(Math.abs(xt - this._xrayT), dt * 3.2);
      this._applyXray(this._xrayT);
    }

    // simulation
    const sdt = this.paused ? 0 : dt * Math.min(1.5, Math.max(0.4, this.speed));
    this.simTime += sdt;
    if (!this.paused) sim.step(sdt, this.simTime);
    cabling.update(dt, wall);
    if (this._linksDirty) {
      this._linksDirty = false;
      this._cablingDirty = true;
      ui.renderInspector();
    }
    if (this._cablingDirty) {
      this._cablingDirty = false;
      cabling.refreshVisuals();
      ui.syncCabling();
    }

    // flows -> data texture
    const base = this.nv.base;
    for (let l = 0; l < N_LINK; l++) {
      flow.setUtil(base + l, sim.tx[l], sim.rx[l]);
      flow.setState(base + l, model.linkState[l]);
    }
    for (const c of model.cables) flow.setUtil(c.flowId, sim.cableIn[c.id], sim.cableOut[c.id]);
    const st = sim.stats;
    flow.setUtil(this.cool.idS, 0.7, 0);
    flow.setUtil(this.cool.idR, 0.7, 0);
    for (const t of model.compute) {
      const on = t.seated ? 0.6 : 0;
      flow.setUtil(t.flowSupply, on, 0);
      flow.setUtil(t.flowReturn, on, 0);
      flow.setUtil(t.flowPower, t.seated ? Math.min(1, (t.kw || 0) / 5.8) : 0, 0);
    }
    for (const t of model.switches) {
      const on = t.seated ? 0.6 : 0;
      flow.setUtil(t.flowSupply, on, 0);
      flow.setUtil(t.flowReturn, on, 0);
      flow.setUtil(t.flowPower, t.seated ? Math.min(1, (t.kw || 0) / 1.35) * 0.5 : 0, 0);
    }
    const share = st.shelves ? Math.min(1, st.powerKW / st.shelves / SHELF_KW) : 0;
    for (const s of model.shelves) flow.setUtil(s.flowPower, 0, s.seated ? share : 0);
    const topOn = model.shelves.filter((s) => s.shelf >= 4 && s.seated).length, botOn = model.shelves.filter((s) => s.shelf < 4 && s.seated).length;
    flow.setUtil(this.pwr.idTop, topOn ? Math.min(1, (st.powerKW / 120) * 0.9) : 0, 0);
    flow.setUtil(this.pwr.idBot, botOn ? Math.min(1, (st.powerKW / 120) * 0.9) : 0, 0);
    flow.commit();

    // low-rate visual state
    this._uiT -= dt;
    if (this._uiT <= 0) {
      this._uiT = 0.2;
      this._slowVisuals(wall);
      ui.syncKpis();
      ui.syncInspector();
      ui.syncAlerts();
      ui.drawMatrix();
    }

    // outline boxes
    this._box(this.selBox, this.selection);
    this._box(this.hovBox, this.hoverEnt && !(this.selection && this.hoverEnt.type === this.selection.type && this.hoverEnt.id === this.selection.id) ? this.hoverEnt : null);

    this.fx.update(dt);
    this.pilot.update(dt);
    stage.controls.update();
    if (!this.paused) this.animTime += dt * this.speed;
    tickRibbons(this.animTime, wall);
    ui.placeLabels(this._project, stage.camera.position.z, this.labelsOn);
    stage.render();

    // adaptive quality: drop bloom, then resolution, if the device cannot keep up
    if (dtRaw > 0.045) this._slow++;
    else this._slow = Math.max(0, this._slow - 2);
    if (this._slow > 90 && !this._degraded) {
      this._degraded = 1;
      stage.bloomEnabled = false;
    } else if (this._slow > 240 && this._degraded === 1) {
      this._degraded = 2;
      stage.renderer.setPixelRatio(1);
      stage.resize();
      this.onLayout();
    }
    window.__frames = (window.__frames || 0) + 1;
    if (window.__frames === 3) ui.boot();
  }

  _box(mesh, ent) {
    if (!ent || !this.boxOf(ent, (this._bx ||= { c: new THREE.Vector3(), s: new THREE.Vector3() }))) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    mesh.position.copy(this._bx.c);
    mesh.scale.copy(this._bx.s);
  }

  _slowVisuals(wall) {
    const { model, sim, leds, units } = this;
    const blink = Math.floor(wall * 3) % 2 === 0;
    for (let g = 0; g < N_GPU; g++) {
      const mat = units.gpuMesh[g].material;
      if (model.gpuFault[g]) {
        mat.emissive.setHex(0xff2a10);
        mat.emissiveIntensity = blink ? 1.4 : 0.35;
      } else {
        mat.emissive.setHex(0x2e9e6b);
        mat.emissiveIntensity = model.gpuLinksUp(g) ? 0.08 + 1.5 * sim.gpuLoad[g] : 0;
      }
    }
    for (let s = 0; s < N_NVSW; s++) {
      const mat = units.swMesh[s].material;
      const tray = model.switches[s >> 1];
      if (model.swFault[s] || tray.fault) {
        mat.emissive.setHex(0xff2a10);
        mat.emissiveIntensity = blink ? 1.4 : 0.35;
      } else {
        mat.emissive.setHex(0x2e9e6b);
        mat.emissiveIntensity = tray.seated ? 0.1 + 1.6 * (sim.swThrough[s] / (144 * 400)) : 0;
      }
    }
    for (const u of model.units) {
      if (u.ledPower === undefined) continue;
      const on = u.seated && u.fault !== 'offline';
      leds.set(u.ledPower, on ? 1 : 0);
      let h = on ? 1 : 0;
      if (u.fault === 'failed' || u.leak) h = blink ? 3 : 0;
      else if (on && u.kind === 'compute') {
        let up = 0, bad = false;
        for (let k = 0; k < 4; k++) { up += model.gpuLinksUp(u.trayIndex * 4 + k); bad ||= !!model.gpuFault[u.trayIndex * 4 + k]; }
        h = bad ? 3 : up < 72 ? 2 : 1;
      } else if (on && u.kind === 'switch') {
        const up = model.swLinksUp(u.swTray * 2) + model.swLinksUp(u.swTray * 2 + 1);
        h = model.swFault[u.swTray * 2] || model.swFault[u.swTray * 2 + 1] ? 3 : up < 144 ? 2 : u.leader ? 4 : 1;
      }
      leds.set(u.ledHealth, h);
      if (u.psuLeds) for (const i of u.psuLeds) leds.set(i, u.seated ? 1 : 0);
    }
  }
}

function boot() {
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) {
    document.querySelector('#boot div').innerHTML = '<b>NVL72</b>这个页面需要 WebGL 2。请换用较新的 Chrome、Edge、Firefox 或 Safari，并确认已开启硬件加速。';
    return;
  }
  try {
    window.__nvl = new App();
  } catch (err) {
    console.error(err);
    document.querySelector('#boot div').innerHTML = `<b>NVL72</b>初始化失败：${String(err && err.message ? err.message : err).replace(/[<>&]/g, '')}`;
  }
}
boot();
