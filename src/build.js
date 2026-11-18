// Small geometry / material helpers shared by the scene builders.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _c = new THREE.Color();

function paint(g, color) {
  _c.set(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// Collects coloured primitives and merges them into a single mesh.
export class Batch {
  constructor() {
    this.geos = [];
  }
  box(w, h, d, x, y, z, color) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    this.geos.push(paint(g, color));
    return this;
  }
  // cylinder along axis 'x' | 'y' | 'z'
  cyl(r, len, x, y, z, color, axis = 'y', seg = 14) {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    this.geos.push(paint(g, color));
    return this;
  }
  get empty() {
    return this.geos.length === 0;
  }
  geometry() {
    const g = mergeGeometries(this.geos, false);
    for (const x of this.geos) x.dispose();
    this.geos = [];
    return g;
  }
  mesh(material) {
    return new THREE.Mesh(this.geometry(), material);
  }
}

// ---- procedural textures ----------------------------------------------------
function canvasTex(w, h, draw, { repeat = true, aniso = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function hexVentTexture() {
  // one tile holds a 2x2 staggered hole cell
  return canvasTex(64, 110, (ctx, w, h) => {
    ctx.fillStyle = '#20262c';
    ctx.fillRect(0, 0, w, h);
    const hole = (cx, cy) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        const x = cx + Math.cos(a) * 24, y = cy + Math.sin(a) * 24;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = '#05070a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(160,180,200,0.22)';
      ctx.lineWidth = 2;
      ctx.stroke();
    };
    for (const [x, y] of [[0, 0], [64, 0], [32, 55], [0, 110], [64, 110]]) hole(x, y);
  });
}

export function floorTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#161d25';
    ctx.fillRect(0, 0, w, h);
    // faint speckle so the tile does not look flat
    for (let i = 0; i < 900; i++) {
      const v = 18 + Math.random() * 22;
      ctx.fillStyle = `rgba(${v + 10},${v + 16},${v + 24},0.35)`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
    ctx.strokeStyle = '#0a0f14';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(120,150,180,0.10)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(4, 4, w - 8, h - 8);
  });
}

export function shadowTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.85)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { repeat: false });
}

// Text label rendered to a texture; returns { texture, aspect }
export function textTexture(lines, { font = '600 44px "IBM Plex Sans", "Noto Sans SC", sans-serif', color = '#C9D4DC', bg = null, pad = 14, lineH = 54, align = 'left' } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = font;
  const arr = Array.isArray(lines) ? lines : [lines];
  let w = 0;
  for (const l of arr) w = Math.max(w, ctx.measureText(typeof l === 'string' ? l : l.text).width);
  c.width = Math.ceil(w + pad * 2);
  c.height = Math.ceil(lineH * arr.length + pad * 2 - (lineH - 44) * 0.6);
  const cx = c.getContext('2d');
  if (bg) {
    cx.fillStyle = bg;
    cx.fillRect(0, 0, c.width, c.height);
  }
  cx.textBaseline = 'middle';
  cx.textAlign = align;
  arr.forEach((l, i) => {
    const o = typeof l === 'string' ? { text: l } : l;
    cx.font = o.font ?? font;
    cx.fillStyle = o.color ?? color;
    const x = align === 'center' ? c.width / 2 : align === 'right' ? c.width - pad : pad;
    cx.fillText(o.text, x, pad + lineH * (i + 0.42));
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { texture: t, aspect: c.width / c.height };
}

// flat label plane, `h` metres tall, facing +z by default
export function labelPlane(lines, h, opts = {}) {
  const { texture, aspect } = textTexture(lines, opts);
  const m = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, opacity: opts.opacity ?? 1 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(h * aspect, h), m);
  mesh.userData.aspect = aspect;
  return mesh;
}

// ---- materials --------------------------------------------------------------
export function makeMaterials() {
  const vent = hexVentTexture();
  const M = {
    frame: new THREE.MeshStandardMaterial({ color: 0x14181d, metalness: 0.65, roughness: 0.5 }),
    frameLight: new THREE.MeshStandardMaterial({ color: 0x2b333b, metalness: 0.75, roughness: 0.42 }),
    chassis: new THREE.MeshStandardMaterial({ color: 0x5a646e, metalness: 0.85, roughness: 0.42 }),
    bezel: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.48 }),
    inner: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.5 }),
    guts: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.55 }),
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.05, roughness: 0.8 }),
    vent: new THREE.MeshStandardMaterial({ map: vent, metalness: 0.6, roughness: 0.55 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fc0dc, metalness: 0.2, roughness: 0.08, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }),
    cartShell: new THREE.MeshStandardMaterial({ color: 0x8fb5a6, metalness: 0.3, roughness: 0.15, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }),
    copper: new THREE.MeshStandardMaterial({ color: 0xd08a4e, metalness: 1.0, roughness: 0.28 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x7d8892, metalness: 0.8, roughness: 0.4, envMapIntensity: 0.6 }),
    gpu: new THREE.MeshStandardMaterial({ color: 0x55606b, metalness: 0.75, roughness: 0.42, emissive: 0x2e9e6b, emissiveIntensity: 0, envMapIntensity: 0.6 }),
    nvsw: new THREE.MeshStandardMaterial({ color: 0x4f6a5e, metalness: 0.75, roughness: 0.42, emissive: 0x2e9e6b, emissiveIntensity: 0, envMapIntensity: 0.6 }),
    led: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    cover: new THREE.MeshStandardMaterial({ color: 0xe0b98a, metalness: 0.1, roughness: 0.2, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
    ghost: new THREE.MeshStandardMaterial({ color: 0x36424e, metalness: 0.4, roughness: 0.6, transparent: true, opacity: 0.32, depthWrite: false }),
    edge: new THREE.LineBasicMaterial({ color: 0x5f7689, transparent: true, opacity: 0.0 }),
  };
  M.vent.userData.tile = [0.0052, 0.009]; // metres per texture repeat
  return M;
}

// plane with the hex vent texture tiled at real-world scale
export function ventPlane(M, w, h) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  const [tw, th] = M.vent.userData.tile;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tw, (uv.getY(i) * h) / th);
  return new THREE.Mesh(g, M.vent);
}
