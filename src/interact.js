// Pointer interaction: picking, hover, click-to-select, dragging plugs with
// rope physics and sliding trays in and out of the rack.

import * as THREE from 'three';
import { Z_FRONT } from './config.js';
import { PORT_DIM, N_LINK } from './topology.js';

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();

// closest approach between a ray (o, unit d) and segment a-b -> [distance, t along ray]
function raySeg(o, d, ax, ay, az, bx, by, bz, out) {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const wx = ax - o.x, wy = ay - o.y, wz = az - o.z;
  const a = ux * ux + uy * uy + uz * uz;
  const b = ux * d.x + uy * d.y + uz * d.z;
  const dd = ux * wx + uy * wy + uz * wz;
  const e = d.x * wx + d.y * wy + d.z * wz;
  const D = a - b * b;
  let s = D > 1e-12 ? (b * e - dd) / D : 0;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  let t = e + s * b;
  if (t < 0) {
    t = 0;
    s = a > 1e-12 ? -dd / a : 0;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
  }
  const px = ax + s * ux - (o.x + t * d.x), py = ay + s * uy - (o.y + t * d.y), pz = az + s * uz - (o.z + t * d.z);
  out[0] = Math.sqrt(px * px + py * py + pz * pz);
  out[1] = t;
}

function shown(o) {
  for (let x = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}

export function portAt(unit, x, yLocal) {
  if (!unit.ports) return null;
  for (const p of unit.ports) {
    const d = PORT_DIM[p.type];
    if (Math.abs(x - p.x) <= d.w / 2 + 0.0022 && Math.abs(yLocal - p.y) <= d.h / 2 + 0.003) return p;
  }
  return null;
}

export class Interaction {
  constructor(app) {
    this.app = app;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.hover = null;
    this.down = null;
    this.drag = null;
    this._lastHover = 0;
    this._res = [0, 0];
    const el = app.stage.renderer.domElement;
    this.el = el;
    el.addEventListener('pointerdown', (e) => this.onDown(e), { capture: true });
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e, true));
    el.addEventListener('pointerleave', () => { if (!this.drag) this.setHover(null); });
    el.addEventListener('dblclick', (e) => this.onDbl(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setRay(x, y) {
    const r = this.el.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.app.stage.camera);
    return this.raycaster.ray;
  }

  pick(x, y, { lines = true } = {}) {
    const app = this.app;
    const ray = this.setRay(x, y);
    const hits = this.raycaster.intersectObjects(app.pickables, false);
    let first = null, solidT = Infinity;
    for (const h of hits) {
      const o = h.object;
      if (!shown(o)) continue;
      const pk = o.userData.pickInst ? o.userData.pickInst(h.instanceId) : o.userData.pick;
      if (!pk) continue;
      if (pk.type === 'cable' && !app.layers[pk.cable.net]) continue;
      const seeThrough = pk.shell || (pk.type === 'unit' && !pk.bezel && (app.xray || pk.unit.pull > 0.06));
      if (seeThrough) {
        if (!first) first = { t: h.distance, pk, point: h.point, soft: true };
        continue;
      }
      if (!first || first.soft) {
        // a solid object behind something see-through wins only when it is inside / right behind it
        if (!first || h.distance - first.t < 1.2) first = { t: h.distance, pk, point: h.point };
      }
      solidT = h.distance;
      break;
    }
    let res = null;
    if (first) {
      const pk = first.pk;
      if (pk.type === 'unit' && pk.bezel) {
        const port = portAt(pk.unit, first.point.x, first.point.y - pk.unit.y);
        res = port ? { type: 'port', port, unit: pk.unit, t: first.t } : { type: 'unit', unit: pk.unit, t: first.t, latch: Math.abs(first.point.x) > 0.204 && first.point.z > Z_FRONT - 0.01 };
      } else res = { ...pk, t: first.t };
    }
    // a tray's latch stays grabbable even though patch cords cross in front of it
    if (lines && !(res && res.type === 'unit' && res.latch && this.app.canPull(res.unit))) {
      const lh = this.pickLines(ray, solidT);
      if (lh && (!res || lh.t < res.t + (first && first.soft ? 2 : 0.004))) res = lh;
    }
    return res;
  }

  pickLines(ray, maxT) {
    const app = this.app;
    const o = _o.copy(ray.origin), d = _d.copy(ray.direction);
    const pw = app.stage.pixelWorld.value;
    const res = this._res;
    let best = null, bestScore = Infinity;
    const test = (flat, n, tol, make, dz = 0) => {
      for (let i = 0; i < n - 1; i++) {
        const k = i * 3;
        raySeg(o, d, flat[k], flat[k + 1], flat[k + 2] + dz, flat[k + 3], flat[k + 4], flat[k + 5] + dz, res);
        const t = res[1];
        if (t <= 0.02 || t >= maxT) continue;
        const lim = Math.max(tol, pw * t * 3.2);
        if (res[0] < lim) {
          const score = t + res[0] * 40; // nearer and better-centred wins
          if (score < bestScore) {
            bestScore = score;
            best = make(t);
          }
        }
      }
    };
    for (const c of app.model.cables) {
      if (!app.layers[c.net]) continue;
      const mk = (t) => ({ type: 'cable', cable: c, t });
      test(c.trunk, c.trunk.length / 3, 0.003, mk);
      test(c.rope.p, c.rope.p.length / 3, 0.003, mk);
    }
    if (app.layers.nv) {
      const paths = app.nv.cartPath;
      for (let l = 0; l < N_LINK; l++) {
        const cart = app.model.cart[Math.floor(l / 18) & 3];
        const p = paths[l];
        test(p, p.length / 3, 0.0015, (t) => ({ type: 'link', id: l, t }), -cart.pull);
      }
    }
    return best;
  }

  setHover(h, x, y) {
    const same = (a, b) => a === b || (a && b && a.type === b.type && a.id === b.id && a.unit === b.unit && a.cable === b.cable && a.port === b.port && a.which === b.which && a.dev === b.dev);
    if (!same(h, this.hover)) {
      this.hover = h;
      this.app.onHover(h);
    }
    this.app.ui.tooltip(h, x, y);
    let cur = 'default';
    if (h) cur = h.type === 'cable' && h.plug ? 'grab' : h.type === 'unit' && h.latch && this.app.canPull(h.unit) ? 'ew-resize' : 'pointer';
    this.el.style.cursor = cur;
  }

  onDown(e) {
    if (e.button !== 0) return;
    const app = this.app;
    app.pilot.cancel();
    const h = this.pick(e.clientX, e.clientY, { lines: false });
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), hit: h, moved: false };
    if (h && h.type === 'cable' && h.plug && (h.cable.state === 'plugged' || h.cable.state === 'free')) {
      // the plug is only pulled once the pointer actually moves; a plain click selects the cord
      this.drag = { kind: 'plug', cable: h.cable, started: false };
      app.stage.controls.enabled = false;
      this.el.setPointerCapture(e.pointerId);
      this.el.style.cursor = 'grabbing';
      e.preventDefault();
    } else if (h && h.type === 'unit' && h.latch && app.canPull(h.unit)) {
      const u = h.unit;
      const cam = app.stage.camera;
      _p0.set(0, u.y + 0.02, Z_FRONT + u.pull).project(cam);
      _p1.set(0, u.y + 0.02, Z_FRONT + u.pull + 0.1).project(cam);
      const r = this.el.getBoundingClientRect();
      const dx = ((_p1.x - _p0.x) * r.width) / 2, dy = (-(_p1.y - _p0.y) * r.height) / 2;
      const len2 = dx * dx + dy * dy;
      this.drag = { kind: 'tray', unit: u, start: u.pull, dx, dy, len2, x: e.clientX, y: e.clientY };
      app.select({ type: 'unit', id: u.id });
      app.stage.controls.enabled = false;
      this.el.setPointerCapture(e.pointerId);
      app.ui.tooltip(null);
      e.preventDefault();
    }
  }

  onMove(e) {
    const app = this.app;
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) this.down.moved = true;
    if (this.drag) {
      if (this.drag.kind === 'plug') {
        const g = this.drag;
        if (!g.started && this.down && this.down.moved) {
          g.started = app.cabling.startDrag(g.cable);
          if (g.started) {
            app.ui.tooltip(null);
            app.onGrab(g.cable);
          }
        }
        if (g.started) app.cabling.dragTo(this.setRay(e.clientX, e.clientY));
      } else {
        const g = this.drag;
        const mx = e.clientX - g.x, my = e.clientY - g.y;
        let dp;
        if (g.len2 > 150) dp = ((mx * g.dx + my * g.dy) / g.len2) * 0.1;
        else dp = my * 0.0022; // looking straight at the front: drag down to pull
        app.setPull(g.unit, Math.max(0, Math.min(0.62, g.start + dp)), true);
      }
      return;
    }
    if (e.buttons) return; // orbiting
    const now = performance.now();
    if (now - this._lastHover < 45) return;
    this._lastHover = now;
    if (e.pointerType === 'touch') return;
    this.setHover(this.pick(e.clientX, e.clientY), e.clientX, e.clientY);
  }

  onUp(e, cancelled = false) {
    const app = this.app;
    const dn = this.down;
    this.down = null;
    if (this.drag) {
      const g = this.drag;
      this.drag = null;
      app.stage.controls.enabled = true;
      try { this.el.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
      this.el.style.cursor = 'default';
      if (g.kind === 'plug') {
        if (g.started) app.cabling.endDrag();
        else app.select({ type: 'cable', id: g.cable.id });
      } else {
        const u = g.unit;
        app.setPull(u, u.pull < 0.045 ? 0 : u.pull, false);
        app.ui.renderInspector();
      }
      return;
    }
    if (cancelled || !dn || dn.moved || e.button !== 0) return;
    const h = this.pick(e.clientX, e.clientY);
    app.select(h ? app.entityOf(h) : null);
  }

  onDbl(e) {
    const h = this.pick(e.clientX, e.clientY, { lines: false });
    if (!h) return;
    const app = this.app;
    if ((h.type === 'unit' || h.type === 'port') && app.canPull(h.unit)) app.togglePull(h.unit);
    else if (h.type === 'cart') app.toggleCart(h.id);
    else if (h.type === 'gpu' || h.type === 'nvsw') app.focus({ type: h.type, id: h.id });
  }
}
