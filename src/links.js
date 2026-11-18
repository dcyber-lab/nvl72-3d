// Flow ribbons that live behind the front panel: the 1,296 NVLink lanes
// (GPU -> tray connector -> cable cartridge -> switch tray connector -> NVSwitch),
// coolant loops and manifolds, and the DC power path along the busbar.

import * as THREE from 'three';
import { Ribbon, makeRibbonMaterial, filletPath, pathLength } from './ribbon.js';
import { Z_REAR, CART_X, CART, BUSBAR_X, MANI_SUPPLY_X, MANI_RETURN_X, GPU_X, GPU_Z, NVSW_X, NVSW_Z, PALETTE, yOfU, uOfSlot } from './config.js';
import { YC } from './units.js';
import { N_LINK, N_GPU, N_NVSW } from './topology.js';

export function buildNvlink(model, flow, cartGroups) {
  const mat = makeRibbonMaterial({ jacket: 0x17573f, glowA: 0x4dffa6, glowB: 0xc8ff5a, radius: 0.0011, minPx: 1.15, spacing: 0.075, speed: 0.8, gain: 2.4, tail: 0.62 });
  const base = flow.alloc(N_LINK);
  const cartRib = cartGroups.map((_, k) => new Ribbon(mat, `nvlink-cart-${k + 1}`));
  const trayRib = model.compute.map((t) => new Ribbon(mat, `nvlink-${t.id}`));
  const swRib = model.switches.map((t) => new Ribbon(mat, `nvlink-${t.id}`));
  const cartPath = new Array(N_LINK); // world-space polyline of the cartridge part, for picking

  for (let g = 0; g < N_GPU; g++) {
    const tIdx = g >> 2, k = g & 3;
    const tray = model.compute[tIdx];
    for (let s = 0; s < N_NVSW; s++) {
      const l = g * N_NVSW + s;
      const c = s & 1;
      const sw = model.switches[s >> 1];
      const oxc = ((s >> 1) - 4) * 0.0042, oyc = c ? -0.0055 : 0.0055;
      const oxs = (tIdx - 8.5) * 0.0024, oys = c ? -0.0075 : 0.0075;
      const cx = CART_X[k];

      // inside the compute tray
      const a = filletPath([
        [GPU_X[k] + oxc * 1.7, 0.0235, GPU_Z - 0.045],
        [cx + oxc, YC + oyc, Z_REAR + 0.075],
        [cx + oxc, YC + oyc, Z_REAR - 0.02],
      ], 0.03, 4);
      const La = pathLength(a);
      trayRib[tIdx].add(a, base + l, 0);

      // inside the cable cartridge
      const yT = tray.y + YC + oyc, yS = sw.y + YC + oys;
      const span = Math.abs(tray.u - sw.u);
      const zl = CART.zFace - 0.022 - (0.104 * (span - 1)) / 17 - (c ? 0.004 : 0);
      const b = filletPath([
        [cx + oxc, yT, CART.zFace + 0.002],
        [cx + oxc, yT, zl],
        [cx + oxs, yS, zl],
        [cx + oxs, yS, CART.zFace + 0.002],
      ], 0.013, 4);
      const Lb = pathLength(b);
      cartRib[k].add(b, base + l, La + 0.01);
      cartPath[l] = b;

      // inside the switch tray
      const off = (g - 35.5) * 0.0014;
      const d = filletPath([
        [cx + oxs, YC + oys, Z_REAR - 0.02],
        [cx + oxs, YC + oys, Z_REAR + 0.07],
        [NVSW_X[c] + off, 0.0245, NVSW_Z - 0.09],
        [NVSW_X[c] + off, 0.0245, NVSW_Z - 0.054],
      ], 0.03, 4);
      swRib[s >> 1].add(d, base + l, La + Lb + 0.02);
    }
  }

  const meshes = [];
  cartRib.forEach((r, k) => {
    const m = r.finalize();
    cartGroups[k].add(m);
    meshes.push(m);
  });
  trayRib.forEach((r, i) => {
    const m = r.finalize();
    model.compute[i].group.add(m);
    meshes.push(m);
  });
  swRib.forEach((r, i) => {
    const m = r.finalize();
    model.switches[i].group.add(m);
    meshes.push(m);
  });
  return { base, meshes, cartPath, material: mat };
}

export function buildCooling(model, flow, root) {
  const mS = makeRibbonMaterial({ jacket: PALETTE.liqS, glowA: PALETTE.liqSGlow, radius: 0.0165, minPx: 2.5, spacing: 0.11, speed: 0.34, gain: 0.55, tail: 0.5 });
  const mR = makeRibbonMaterial({ jacket: PALETTE.liqR, glowA: PALETTE.liqRGlow, radius: 0.0165, minPx: 2.5, spacing: 0.11, speed: 0.34, gain: 0.55, tail: 0.5 });
  const tS = makeRibbonMaterial({ jacket: PALETTE.liqS, glowA: PALETTE.liqSGlow, radius: 0.0042, minPx: 1.2, spacing: 0.06, speed: 0.3, gain: 0.9, tail: 0.5 });
  const tR = makeRibbonMaterial({ jacket: PALETTE.liqR, glowA: PALETTE.liqRGlow, radius: 0.0042, minPx: 1.2, spacing: 0.06, speed: 0.3, gain: 0.9, tail: 0.5 });
  const zM = Z_REAR - 0.06;
  const yT = yOfU(uOfSlot(27) + 1) + 0.03;
  const idS = flow.alloc(1), idR = flow.alloc(1);
  const rs = new Ribbon(mS, 'manifold-supply');
  rs.add(filletPath([[MANI_SUPPLY_X, 0.0, -0.7], [MANI_SUPPLY_X, 0.07, -0.7], [MANI_SUPPLY_X, 0.07, zM], [MANI_SUPPLY_X, yT, zM]], 0.045, 6), idS);
  const rr = new Ribbon(mR, 'manifold-return');
  rr.add(filletPath([[MANI_RETURN_X, yT, zM], [MANI_RETURN_X, 0.07, zM], [MANI_RETURN_X, 0.07, -0.7], [MANI_RETURN_X, 0.0, -0.7]], 0.045, 6), idR);
  const pipeS = rs.finalize(), pipeR = rr.finalize();
  pipeS.userData.pick = { type: 'manifold', which: 'supply' };
  pipeR.userData.pick = { type: 'manifold', which: 'return' };
  root.add(pipeS, pipeR);

  // in-tray loops: cold in along the left wall, warm out along the right wall
  const meshes = [pipeS, pipeR];
  const trays = [...model.compute, ...model.switches];
  for (const t of trays) {
    const zFront = t.kind === 'compute' ? 0.225 : 0.075;
    const zBack = t.kind === 'compute' ? -0.118 : -0.125;
    t.flowSupply = flow.alloc(1);
    t.flowReturn = flow.alloc(1);
    const a = new Ribbon(tS, 'loop-supply');
    a.add(filletPath([[MANI_SUPPLY_X, YC, Z_REAR - 0.03], [MANI_SUPPLY_X, 0.031, Z_REAR + 0.03], [MANI_SUPPLY_X, 0.031, zFront], [0.19, 0.031, zFront]], 0.02, 4), t.flowSupply);
    const b = new Ribbon(tR, 'loop-return');
    b.add(filletPath([[-0.19, 0.031, zBack], [MANI_RETURN_X, 0.031, zBack], [MANI_RETURN_X, 0.031, Z_REAR + 0.03], [MANI_RETURN_X, YC, Z_REAR - 0.03]], 0.02, 4), t.flowReturn);
    const ma = a.finalize(), mb = b.finalize();
    t.group.add(ma, mb);
    meshes.push(ma, mb);
  }
  return { idS, idR, meshes };
}

export function buildPower(model, flow, root) {
  const mat = makeRibbonMaterial({ jacket: 0xa8662c, glowA: PALETTE.pwrGlow, radius: 0.0048, minPx: 1.6, spacing: 0.085, speed: 0.55, gain: 2.0, tail: 0.55 });
  const z = Z_REAR - 0.0465;
  const meshes = [];
  const idTop = flow.alloc(1), idBot = flow.alloc(1);
  const yMid = yOfU(uOfSlot(13)) + YC;
  const r = new Ribbon(mat, 'busbar-flow');
  r.add([BUSBAR_X, yOfU(42) + YC, z, BUSBAR_X, yMid + 0.01, z], idTop);
  r.add([BUSBAR_X, yOfU(6) + YC, z, BUSBAR_X, yMid - 0.01, z], idBot);
  const m = r.finalize();
  root.add(m);
  meshes.push(m);
  for (const u of model.units) {
    if (u.kind !== 'compute' && u.kind !== 'switch' && u.kind !== 'power') continue;
    u.flowPower = flow.alloc(1);
    const rb = new Ribbon(mat, 'feed');
    rb.add([BUSBAR_X, YC, Z_REAR - 0.03, BUSBAR_X, YC, Z_REAR + 0.085], u.flowPower);
    const mm = rb.finalize();
    u.group.add(mm);
    meshes.push(mm);
  }
  return { idTop, idBot, meshes };
}
