// Renderer, camera, lights, environment and post-processing.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PALETTE } from './config.js';

export function createStage(canvas, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio ?? 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setClearColor(PALETTE.bg, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.bg);
  scene.fog = new THREE.Fog(PALETTE.bg, 7.5, 24);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.42;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(30, 1, 0.03, 80);
  camera.position.set(2.6, 1.75, 3.9);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.target.set(0.1, 1.12, 0);
  controls.minDistance = 0.18;
  controls.maxDistance = 11;
  controls.maxPolarAngle = Math.PI * 0.497;
  controls.zoomSpeed = 0.9;
  controls.rotateSpeed = 0.75;
  controls.panSpeed = 0.8;
  controls.screenSpacePanning = true;

  // lights: cool key from the front right, warm low fill from the rear left
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x0c1116, 0.62));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(3.2, 4.6, 4.4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fc4ff, 0.9);
  fill.position.set(-3.6, 2.4, -3.2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffe2c0, 0.55);
  rim.position.set(1.5, 3.0, -4.5);
  scene.add(rim);

  // post-processing
  const size = new THREE.Vector2(1, 1);
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: opts.samples ?? 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 1.25);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const stage = {
    renderer, scene, camera, controls, composer, bloom,
    bloomEnabled: opts.bloom ?? true,
    pixelWorld: { value: 1 }, // world units per pixel at unit distance
    viewH: 1,
    resize() {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      camera.aspect = w / h;
      // keep the rack comfortably framed on tall (phone) viewports
      camera.fov = w / h < 0.8 ? 44 : 30;
      camera.updateProjectionMatrix();
      renderer.getDrawingBufferSize(size);
      stage.viewH = size.y;
      stage.pixelWorld.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / size.y;
    },
    render() {
      if (stage.bloomEnabled) composer.render();
      else renderer.render(scene, camera);
    },
  };
  stage.resize();
  return stage;
}

// ---- camera tweening -------------------------------------------------------
const _v = new THREE.Vector3();
export class CameraPilot {
  constructor(stage) {
    this.stage = stage;
    this.active = null;
  }
  flyTo(pos, target, dur = 1.1) {
    const { camera, controls } = this.stage;
    this.active = {
      t: 0, dur,
      p0: camera.position.clone(), p1: new THREE.Vector3().fromArray(pos),
      t0: controls.target.clone(), t1: new THREE.Vector3().fromArray(target),
    };
  }
  cancel() {
    this.active = null;
  }
  update(dt) {
    const a = this.active;
    if (!a) return;
    a.t = Math.min(1, a.t + dt / a.dur);
    const k = a.t < 0.5 ? 4 * a.t * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 3) / 2;
    const { camera, controls } = this.stage;
    // interpolate on an arc around the target so the camera never cuts through the rack
    controls.target.lerpVectors(a.t0, a.t1, k);
    const o0 = _v.copy(a.p0).sub(a.t0);
    const r0 = o0.length();
    const o1 = a.p1.clone().sub(a.t1);
    const r1 = o1.length();
    const s0 = new THREE.Spherical().setFromVector3(o0);
    const s1 = new THREE.Spherical().setFromVector3(o1);
    let dTheta = s1.theta - s0.theta;
    if (dTheta > Math.PI) dTheta -= Math.PI * 2;
    if (dTheta < -Math.PI) dTheta += Math.PI * 2;
    const s = new THREE.Spherical(r0 + (r1 - r0) * k, s0.phi + (s1.phi - s0.phi) * k, s0.theta + dTheta * k);
    camera.position.setFromSpherical(s).add(controls.target);
    if (a.t >= 1) this.active = null;
  }
}
