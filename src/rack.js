// Static rack hardware: frame, floor, cable ducts, and the rear blind-mate
// infrastructure (NVLink cable cartridges, DC busbar, liquid manifolds).

import * as THREE from 'three';
import { Batch, floorTexture, shadowTexture, textTexture, labelPlane } from './build.js';
import { U, RACK, Z_FRONT, Z_REAR, CART_X, CART, BUSBAR_X, MANI_SUPPLY_X, MANI_RETURN_X, DUCT_X, yOfU, uOfSlot, PALETTE, NETRACK_X, TRAY_Y_OVERHEAD, TRAY_H } from './config.js';
import { YC } from './units.js';

const H = RACK.H;
const yTop = yOfU(RACK.nU + 1);

export function buildFloor(scene) {
  const tex = floorTexture();
  tex.repeat.set(60, 60);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), new THREE.MeshStandardMaterial({ map: tex, metalness: 0.2, roughness: 0.85, color: 0x566270 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0.5, 0, 0);
  floor.name = 'floor';
  scene.add(floor);
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.6), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.9 }));
  sh.rotation.x = -Math.PI / 2;
  sh.position.set(0.5, 0.003, 0);
  scene.add(sh);
  return floor;
}

function frameGeometry(netrack = false) {
  const b = new Batch();
  const col = 0x161b20;
  b.box(RACK.W, 0.05, RACK.D, 0, 0.037, 0, 0x101418); // plinth
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box(0.038, H - 0.06, 0.038, sx * 0.281, 0.06 + (H - 0.06) / 2, sz * 0.515, col);
    b.box(0.07, 0.012, 0.07, sx * 0.25, 0.006, sz * 0.47, 0x0b0e11); // feet
  }
  // top: an open frame so the stack can be seen from above
  for (const sx of [-1, 1]) b.box(0.05, 0.034, RACK.D, sx * 0.275, H - 0.017, 0, col);
  for (const sz of [-1, 1]) b.box(RACK.W - 0.1, 0.034, 0.05, 0, H - 0.017, sz * 0.509, col);
  for (const sx of [-1, 1]) {
    b.box(0.03, 0.03, RACK.D - 0.076, sx * 0.285, H - 0.049, 0, col);
    b.box(0.03, 0.03, RACK.D - 0.076, sx * 0.285, 0.077, 0, col);
    // EIA rails, front and rear
    b.box(0.02, yTop - RACK.baseY, 0.024, sx * 0.2345, (yTop + RACK.baseY) / 2, Z_FRONT - 0.018, 0x2a3138);
    if (!netrack) b.box(0.02, yTop - RACK.baseY, 0.024, sx * 0.2345, (yTop + RACK.baseY) / 2, Z_REAR + 0.03, 0x2a3138);
  }
  for (const sz of [-1, 1]) {
    b.box(RACK.W - 0.076, 0.03, 0.03, 0, H - 0.049, sz * 0.519, col);
    b.box(RACK.W - 0.076, 0.03, 0.03, 0, 0.077, sz * 0.519, col);
  }
  return b.geometry();
}

function ductGeometry(side) {
  // open vertical finger duct in front of a corner post
  const b = new Batch();
  const h = yTop - RACK.baseY + 0.02;
  const yc = (yTop + RACK.baseY) / 2;
  const x = side * DUCT_X;
  b.box(0.062, h, 0.004, x, yc, 0.5365, 0x12161a);
  b.box(0.004, h, 0.07, x + side * 0.03, yc, 0.5705, 0x171c21);
  for (let u = 1; u <= RACK.nU + 1; u++) {
    b.box(0.004, 0.005, 0.07, x - side * 0.03, yOfU(u), 0.5705, 0x232a31);
  }
  b.box(0.062, 0.004, 0.07, x, RACK.baseY - 0.01, 0.5705, 0x171c21);
  return b.geometry();
}

function slotStrip(model, mirror) {
  // tall label strip listing every rack position
  const W = 220, rowH = 44;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = RACK.nU * rowH;
  const ctx = c.getContext('2d');
  ctx.textBaseline = 'middle';
  ctx.textAlign = mirror ? 'left' : 'right';
  for (const unit of model.units) {
    const y = c.height - (unit.u - 0.5) * rowH;
    let text = '', color = '#C9D4DC', font = '600 30px "JetBrains Mono", monospace';
    if (unit.kind === 'compute') text = String(unit.slot).padStart(2, '0');
    else if (unit.kind === 'switch') { text = String(unit.slot).padStart(2, '0'); color = '#6FD3A3'; }
    else if (unit.kind === 'power') { text = unit.id.toUpperCase().replace('PS-', 'PS '); color = '#E3A869'; font = '500 22px "JetBrains Mono", monospace'; }
    else if (unit.kind === 'mgmt') { text = `MGMT ${unit.mgmt + 1}`; color = '#9FB3C6'; font = '500 22px "JetBrains Mono", monospace'; }
    if (!text) continue;
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.fillText(text, mirror ? 10 : W - 10, y);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(mirror ? 0 : W - 4, y - 12, 4, 24);
    ctx.globalAlpha = 1;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const h = RACK.nU * U;
  const w = (h * W) / c.height;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
  m.userData.w = w;
  return m;
}

export function buildRack(model, M) {
  const root = new THREE.Group();
  root.name = 'rack';
  const picks = [];

  const frame = new THREE.Mesh(frameGeometry(), M.inner);
  frame.name = 'frame';
  root.add(frame);

  // glass side panels so the depth of the rack reads from 3/4 views
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(RACK.D - 0.08, H - 0.13), M.glass);
    p.rotation.y = Math.PI / 2;
    p.position.set(sx * 0.2995, 0.07 + (H - 0.1) / 2, 0);
    p.renderOrder = 5;
    root.add(p);
  }

  for (const s of [-1, 1]) root.add(new THREE.Mesh(ductGeometry(s), M.matte));

  // slot numbers, one strip readable from the front and one from the rear
  const front = slotStrip(model, false);
  front.position.set(-0.3 - front.userData.w / 2 - 0.012, RACK.baseY + (RACK.nU * U) / 2, 0.6);
  root.add(front);
  const rear = slotStrip(model, false);
  rear.rotation.y = Math.PI;
  rear.position.set(0.3 + rear.userData.w / 2 + 0.012, RACK.baseY + (RACK.nU * U) / 2, -0.535);
  root.add(rear);

  // ---- NVLink cable cartridges ----
  const y0 = yOfU(uOfSlot(1)) - 0.012;
  const y1 = yOfU(uOfSlot(27) + 1) + 0.012;
  const hC = y1 - y0;
  const cartGroups = [];
  for (let k = 0; k < 4; k++) {
    const g = new THREE.Group();
    g.name = `cartridge-${k + 1}`;
    const zc = CART.zFace - CART.D / 2;
    const b = new Batch();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.004, hC, 0.004, CART_X[k] + sx * (CART.W / 2 - 0.002), (y0 + y1) / 2, zc + sz * (CART.D / 2 - 0.002), 0x7b8791);
    b.box(CART.W, 0.006, CART.D, CART_X[k], y0 + 0.003, zc, 0x56616b);
    b.box(CART.W, 0.006, CART.D, CART_X[k], y1 - 0.003, zc, 0x56616b);
    for (let slot = 1; slot <= 27; slot++) {
      const y = yOfU(uOfSlot(slot)) + YC;
      const sw = slot >= 9 && slot <= 17;
      b.box(sw ? 0.05 : 0.044, sw ? 0.036 : 0.03, 0.01, CART_X[k], y, CART.zFace + 0.003, 0x1a1f24);
      b.box(CART.W - 0.004, 0.003, 0.006, CART_X[k], yOfU(uOfSlot(slot)), CART.zFace - 0.003, 0x56616b);
    }
    // pull handle on the service (rear) side
    b.box(0.006, 0.12, 0.022, CART_X[k], (y0 + y1) / 2 + 0.3, CART.zFace - CART.D - 0.011, 0x2e9e6b);
    b.box(0.006, 0.12, 0.022, CART_X[k], (y0 + y1) / 2 - 0.3, CART.zFace - CART.D - 0.011, 0x2e9e6b);
    const hw = b.mesh(M.inner);
    g.add(hw);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(CART.W - 0.001, hC - 0.012, CART.D - 0.001), M.cartShell);
    shell.position.set(CART_X[k], (y0 + y1) / 2, zc);
    shell.renderOrder = 4;
    shell.userData.pick = { type: 'cart', id: k };
    g.add(shell);
    picks.push(shell);
    const tag = labelPlane(`NVLink 线缆背板 ${k + 1}`, 0.016, { color: '#6FD3A3', font: '600 40px "IBM Plex Sans", "Noto Sans SC", sans-serif' });
    tag.rotation.set(0, Math.PI, Math.PI / 2);
    tag.position.set(CART_X[k], (y0 + y1) / 2, CART.zFace - CART.D - 0.002);
    g.add(tag);
    root.add(g);
    cartGroups.push(g);
    model.cart[k].group = g;
  }

  // ---- DC busbar ----
  const bb = new Batch();
  const by0 = yOfU(6) - 0.012, by1 = yOfU(43) + 0.012;
  for (const sx of [-1, 1]) bb.box(0.009, by1 - by0, 0.006, BUSBAR_X + sx * 0.0075, (by0 + by1) / 2, Z_REAR - 0.04, 0xd08a4e);
  const busbar = bb.mesh(M.copper);
  busbar.userData.pick = { type: 'busbar' };
  root.add(busbar);
  picks.push(busbar);
  const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.046, by1 - by0, 0.006), M.cover);
  shroud.position.set(BUSBAR_X, (by0 + by1) / 2, Z_REAR - 0.054);
  shroud.renderOrder = 4;
  shroud.userData.pick = { type: 'busbar' };
  root.add(shroud);
  picks.push(shroud);

  // ---- liquid manifold hardware (the pipes themselves are flow ribbons) ----
  const mb = new Batch();
  for (const x of [MANI_SUPPLY_X, MANI_RETURN_X]) {
    for (let slot = 1; slot <= 27; slot++) {
      const y = yOfU(uOfSlot(slot)) + YC;
      mb.cyl(0.0105, 0.022, x, y, Z_REAR - 0.045, 0xaab4bd, 'z', 12);
    }
    for (const y of [0.42, 1.12, 1.78]) mb.box(0.05, 0.012, 0.03, x, y, Z_REAR - 0.085, 0x2a3138);
  }
  root.add(mb.mesh(M.inner));

  return { root, picks, cartGroups, cartSpan: [y0, y1] };
}

// Ghosted neighbour rack that hosts the IB leaf and front-end Ethernet switches,
// plus the overhead tray the fibres travel in.
export function buildSurroundings(M) {
  const root = new THREE.Group();
  root.name = 'surroundings';
  const frame = new THREE.Mesh(frameGeometry(true), M.ghost);
  frame.position.x = NETRACK_X;
  frame.renderOrder = 2;
  root.add(frame);
  for (const s of [-1]) {
    const d = new THREE.Mesh(ductGeometry(s), M.matte);
    d.position.x = NETRACK_X;
    root.add(d);
  }
  // overhead ladder tray
  const b = new Batch();
  const x0 = -0.42, x1 = NETRACK_X + 0.36, y = TRAY_Y_OVERHEAD, zc = 0.572;
  for (const sz of [-1, 1]) b.box(x1 - x0, 0.03, 0.005, (x0 + x1) / 2, y + 0.012, zc + sz * 0.085, 0x39424b);
  for (let x = x0 + 0.05; x < x1; x += 0.11) b.box(0.008, 0.005, 0.17, x, y, zc, 0x39424b);
  for (const x of [x0 + 0.1, (x0 + x1) / 2, x1 - 0.1]) for (const sz of [-1, 1]) b.cyl(0.004, 1.4, x, y + 0.7, zc + sz * 0.085, 0x2b333b, 'y', 6);
  root.add(b.mesh(M.inner));
  return { root };
}

export { yTop };
