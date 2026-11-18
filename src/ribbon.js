// Camera-facing "impostor tube" ribbons with animated packet pulses.
// Every cable, NVLink lane, busbar feed and coolant pipe in the scene is drawn
// with this one technique: a quad strip that is expanded in view space, shaded
// as a round tube, and animated from a tiny per-flow data texture.

import * as THREE from 'three';

export const FLOW_W = 2048;

// state byte: 0 down, 128 training, 255 up.  highlight byte: 0 dim, 128 normal, 255 highlighted
export class FlowTable {
  constructor() {
    this.data = new Uint8Array(FLOW_W * 4);
    this.tex = new THREE.DataTexture(this.data, FLOW_W, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    this.next = 0;
    this.dirty = true;
  }
  alloc(n = 1) {
    const i = this.next;
    this.next += n;
    if (this.next > FLOW_W) throw new Error('flow table full');
    for (let k = i; k < i + n; k++) {
      this.data[k * 4 + 2] = 255;
      this.data[k * 4 + 3] = 128;
    }
    this.dirty = true;
    return i;
  }
  setUtil(i, a, b) {
    const d = this.data;
    const va = a <= 0 ? 0 : a >= 1 ? 255 : (a * 255 + 0.5) | 0;
    const vb = b <= 0 ? 0 : b >= 1 ? 255 : (b * 255 + 0.5) | 0;
    if (d[i * 4] !== va || d[i * 4 + 1] !== vb) {
      d[i * 4] = va;
      d[i * 4 + 1] = vb;
      this.dirty = true;
    }
  }
  setState(i, s) {
    const v = s === 2 ? 255 : s === 1 ? 128 : 0;
    if (this.data[i * 4 + 2] !== v) {
      this.data[i * 4 + 2] = v;
      this.dirty = true;
    }
  }
  setHl(i, h) {
    const v = h === 2 ? 255 : h === 0 ? 0 : 128;
    if (this.data[i * 4 + 3] !== v) {
      this.data[i * 4 + 3] = v;
      this.dirty = true;
    }
  }
  commit() {
    if (this.dirty) {
      this.tex.needsUpdate = true;
      this.dirty = false;
    }
  }
}

const VERT = /* glsl */ `
uniform sampler2D uFlow;
uniform float uPixelWorld;
uniform float uRadius;
uniform float uMinPx;
attribute vec3 aTangent;
attribute vec3 aParams; // side, u, id
varying float vSide;
varying float vU;
varying float vId;
varying float vCover;
varying vec4 vFlow;
varying vec3 vSideDir;
varying vec3 vView;
#include <fog_pars_vertex>
void main() {
  vec4 flow = texelFetch(uFlow, ivec2(int(aParams.z + 0.5), 0), 0);
  vFlow = flow;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec3 t = normalize((modelViewMatrix * vec4(aTangent, 0.0)).xyz);
  vec3 toCam = normalize(-mvPosition.xyz);
  vec3 side = cross(t, toCam);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  float wmul = flow.a > 0.75 ? 2.0 : (flow.a < 0.25 ? 0.7 : 1.0);
  float r = uRadius * wmul;
  float minR = uMinPx * (flow.a > 0.75 ? 1.6 : 1.0) * 0.5 * uPixelWorld * (-mvPosition.z);
  vCover = clamp(r / max(minR, 1e-6), 0.0, 1.0);
  r = max(r, minR);
  mvPosition.xyz += side * aParams.x * r;
  vSide = aParams.x;
  vU = aParams.y;
  vId = aParams.z;
  vSideDir = side;
  vView = toCam;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform vec3 uJacket;
uniform vec3 uGlowA;
uniform vec3 uGlowB;
uniform float uSpacing;
uniform float uPhase;   // (time * speed / spacing) mod 512, computed on the CPU in double precision
uniform float uGain;
uniform float uHeat;
uniform float uTime;
uniform float uTail;
uniform float uDownMix;
varying float vSide;
varying float vU;
varying float vId;
varying float vCover;
varying vec4 vFlow;
varying vec3 vSideDir;
varying vec3 vView;
#include <fog_pars_fragment>

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
vec3 heat(float x) {
  // sequential: red and amber stay reserved for "down" and "training"
  vec3 c0 = vec3(0.012, 0.045, 0.075);
  vec3 c1 = vec3(0.02, 0.26, 0.15);
  vec3 c2 = vec3(0.40, 1.0, 0.66);
  return x < 0.5 ? mix(c0, c1, x / 0.5) : mix(c1, c2, (x - 0.5) / 0.5);
}
void main() {
  float s = clamp(vSide, -1.0, 1.0);
  float nz = sqrt(1.0 - s * s);
  vec3 n = normalize(vSideDir * s + vView * nz);
  vec3 L = normalize(vec3(0.38, 0.78, 0.5));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(reflect(-L, n), vView), 0.0), 26.0);

  float tx = vFlow.r;
  float rx = vFlow.g;
  bool down = vFlow.b < 0.25;
  bool training = vFlow.b >= 0.25 && vFlow.b < 0.75;
  float hl = vFlow.a;

  vec3 jacket = uJacket;
  if (uHeat > 0.5) jacket = mix(jacket * 0.35, heat(max(tx, rx)), 0.9);
  if (down) jacket = mix(uJacket * 0.4, vec3(0.30, 0.03, 0.025), uDownMix);
  if (training) jacket = mix(jacket, vec3(0.85, 0.45, 0.05), 0.55);
  vec3 col = jacket * (0.30 + 0.22 * nz + 0.9 * diff) + spec * 0.2;

  vec3 glow = vec3(0.0);
  // vId is constant per cable but still goes through the interpolator: round it before hashing
  float seed = hash11(floor(vId + 0.5) * 1.37 + 3.1);
  if (!down && !training) {
    float xa = vU / uSpacing - uPhase + floor(seed * 400.0);
    float ca = floor(xa);
    float fa = xa - ca;
    float onA = step(hash11(mod(ca, 512.0) + seed * 311.0), tx - 0.002);
    float shA = smoothstep(0.82 - uTail, 0.82, fa) * (1.0 - smoothstep(0.84, 0.98, fa));
    float xb = vU / uSpacing + uPhase + floor(seed * 250.0) + 0.5;
    float cb = floor(xb);
    float fb = xb - cb;
    float onB = step(hash11(mod(cb, 512.0) + seed * 173.0 + 7.0), rx - 0.002);
    float shB = (1.0 - smoothstep(0.18, 0.18 + uTail, fb)) * smoothstep(0.02, 0.16, fb);
    glow = uGlowA * onA * shA + uGlowB * onB * shB;
  } else if (training) {
    float w = 0.5 + 0.5 * sin(uTime * 10.0 + vU * 40.0);
    glow = vec3(1.0, 0.55, 0.08) * w * 0.5;
  } else {
    float w = 0.5 + 0.5 * sin(uTime * 3.0 + seed * 6.28);
    glow = vec3(1.0, 0.08, 0.04) * w * 0.12;
  }
  col += glow * uGain * (0.5 + 0.5 * nz);

  if (hl < 0.25) col *= 0.16;
  else if (hl > 0.75) col = col * 1.25 + jacket * 0.35 + vec3(0.08);
  col *= mix(0.5, 1.0, vCover);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// Uniform objects shared by every ribbon material
export const ribbonShared = {
  uFlow: { value: null },
  uPixelWorld: { value: 0.001 },
  uHeat: { value: 0 },
  uTime: { value: 0 },
};

const materials = [];

export function makeRibbonMaterial({ jacket, glowA, glowB, radius, minPx = 1.4, spacing = 0.06, speed = 0.9, gain = 3.2, tail = 0.6, downMix = 1 }) {
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uFlow: ribbonShared.uFlow,
      uPixelWorld: ribbonShared.uPixelWorld,
      uHeat: ribbonShared.uHeat,
      uTime: ribbonShared.uTime,
      uJacket: { value: new THREE.Color(jacket) },
      uGlowA: { value: new THREE.Color(glowA) },
      uGlowB: { value: new THREE.Color(glowB ?? glowA) },
      uRadius: { value: radius },
      uMinPx: { value: minPx },
      uSpacing: { value: spacing },
      uPhase: { value: 0 },
      uGain: { value: gain },
      uTail: { value: tail },
      uDownMix: { value: downMix },
    },
    side: THREE.DoubleSide,
  });
  m.userData.speed = speed;
  m.userData.spacing = spacing;
  materials.push(m);
  return m;
}

// advance packet phase for every ribbon material (simTime in seconds)
export function tickRibbons(simTime, wallTime) {
  ribbonShared.uTime.value = wallTime % 1000;
  for (const m of materials) {
    m.uniforms.uPhase.value = ((simTime * m.userData.speed) / m.userData.spacing) % 512;
  }
}

// ---- geometry ---------------------------------------------------------------
const _t = new THREE.Vector3();

export class Ribbon {
  // paths are appended, then finalize() bakes one BufferGeometry.
  constructor(material, name = 'ribbon') {
    this.material = material;
    this.name = name;
    this.paths = [];
    this.nSamples = 0;
    this.mesh = null;
  }

  // points: flat number[] or Float32Array [x,y,z,...]; returns a handle
  add(points, id, u0 = 0) {
    const n = points.length / 3;
    const h = { offset: this.nSamples, n, id, u0, length: 0, points };
    this.paths.push(h);
    this.nSamples += n;
    return h;
  }

  finalize() {
    const N = this.nSamples;
    this.pos = new Float32Array(N * 2 * 3);
    this.tan = new Float32Array(N * 2 * 3);
    this.par = new Float32Array(N * 2 * 3);
    let nIdx = 0;
    for (const h of this.paths) nIdx += (h.n - 1) * 6;
    const index = N * 2 > 65535 ? new Uint32Array(nIdx) : new Uint16Array(nIdx);
    let k = 0;
    for (const h of this.paths) {
      for (let i = 0; i < h.n - 1; i++) {
        const a = (h.offset + i) * 2;
        index[k++] = a; index[k++] = a + 1; index[k++] = a + 2;
        index[k++] = a + 1; index[k++] = a + 3; index[k++] = a + 2;
      }
      this._write(h, h.points, h.u0);
      h.points = null;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aTangent', new THREE.BufferAttribute(this.tan, 3));
    g.setAttribute('aParams', new THREE.BufferAttribute(this.par, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeBoundingSphere();
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = this.name;
    this.mesh.matrixAutoUpdate = true;
    return this.mesh;
  }

  _write(h, pts, u0) {
    const { pos, tan, par } = this;
    let u = u0;
    for (let i = 0; i < h.n; i++) {
      const i3 = i * 3;
      const ip = Math.max(0, i - 1) * 3;
      const inx = Math.min(h.n - 1, i + 1) * 3;
      _t.set(pts[inx] - pts[ip], pts[inx + 1] - pts[ip + 1], pts[inx + 2] - pts[ip + 2]);
      if (_t.lengthSq() < 1e-14) _t.set(0, 1, 0);
      _t.normalize();
      if (i > 0) {
        const dx = pts[i3] - pts[i3 - 3], dy = pts[i3 + 1] - pts[i3 - 2], dz = pts[i3 + 2] - pts[i3 - 1];
        u += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      const o = (h.offset + i) * 6;
      for (let sgn = 0; sgn < 2; sgn++) {
        const q = o + sgn * 3;
        pos[q] = pts[i3]; pos[q + 1] = pts[i3 + 1]; pos[q + 2] = pts[i3 + 2];
        tan[q] = _t.x; tan[q + 1] = _t.y; tan[q + 2] = _t.z;
        par[q] = sgn === 0 ? -1 : 1; par[q + 1] = u; par[q + 2] = h.id;
      }
    }
    h.length = u - u0;
    return u;
  }

  // rewrite one path in place (same sample count)
  update(h, pts, u0 = h.u0) {
    h.u0 = u0;
    this._write(h, pts, u0);
    const g = this.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aTangent.needsUpdate = true;
    g.attributes.aParams.needsUpdate = true;
  }
}

// ---- path helpers -----------------------------------------------------------
// Polyline through `pts` ([x,y,z][]) with each interior corner replaced by a
// quadratic fillet of the given radius. Returns a flat number[].
export function filletPath(pts, radius = 0.02, arcSeg = 5) {
  const out = [];
  const n = pts.length;
  const push = (x, y, z) => out.push(x, y, z);
  push(pts[0][0], pts[0][1], pts[0][2]);
  for (let i = 1; i < n - 1; i++) {
    const p = pts[i], a = pts[i - 1], b = pts[i + 1];
    const ax = a[0] - p[0], ay = a[1] - p[1], az = a[2] - p[2];
    const bx = b[0] - p[0], by = b[1] - p[1], bz = b[2] - p[2];
    const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
    if (la < 1e-9 || lb < 1e-9) continue;
    const r = Math.min(radius, la * 0.48, lb * 0.48);
    const sx = p[0] + (ax / la) * r, sy = p[1] + (ay / la) * r, sz = p[2] + (az / la) * r;
    const ex = p[0] + (bx / lb) * r, ey = p[1] + (by / lb) * r, ez = p[2] + (bz / lb) * r;
    for (let k = 0; k <= arcSeg; k++) {
      const t = k / arcSeg, mt = 1 - t;
      push(mt * mt * sx + 2 * mt * t * p[0] + t * t * ex, mt * mt * sy + 2 * mt * t * p[1] + t * t * ey, mt * mt * sz + 2 * mt * t * p[2] + t * t * ez);
    }
  }
  push(pts[n - 1][0], pts[n - 1][1], pts[n - 1][2]);
  return out;
}

export function pathLength(flat) {
  let L = 0;
  for (let i = 3; i < flat.length; i += 3) L += Math.hypot(flat[i] - flat[i - 3], flat[i + 1] - flat[i - 2], flat[i + 2] - flat[i - 1]);
  return L;
}

// point + tangent at arc length s along a flat polyline (for placing labels, sparks ...)
export function pointAt(flat, s, out) {
  let acc = 0;
  for (let i = 3; i < flat.length; i += 3) {
    const d = Math.hypot(flat[i] - flat[i - 3], flat[i + 1] - flat[i - 2], flat[i + 2] - flat[i - 1]);
    if (acc + d >= s || i === flat.length - 3) {
      const t = d > 0 ? Math.min(1, (s - acc) / d) : 0;
      out.set(flat[i - 3] + (flat[i] - flat[i - 3]) * t, flat[i - 2] + (flat[i + 1] - flat[i - 2]) * t, flat[i - 1] + (flat[i + 2] - flat[i - 1]) * t);
      return out;
    }
    acc += d;
  }
  return out;
}
