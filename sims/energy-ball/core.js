// Wspólne elementy: renderer, scena, kamera w "rigu" gracza, pomocnicze funkcje.
import * as THREE from 'three';

export const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
export const rig = new THREE.Group();
scene.add(rig);
export const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.02, 4000);
rig.add(camera);

export const state = { xrMode: null };
export const UP = new THREE.Vector3(0, 1, 0);
export const clamp = THREE.MathUtils.clamp;
export const rand = (a, b) => a + Math.random() * (b - a);

export function randomDir(out) {
  const u = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(a), u, s * Math.sin(a));
}
export function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0.0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.42, 'rgba(255,255,255,0.28)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.07)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export const glowTex = makeGlowTexture();

// --- kończyny: walec wzdłuż +Z od 0 do 1, ustawiany między dwoma punktami ---
const limbGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
limbGeo.rotateX(Math.PI / 2);
limbGeo.translate(0, 0, 0.5);
const jointGeo = new THREE.SphereGeometry(1, 12, 8);
export function makeLimb(mat, r) {
  const m = new THREE.Mesh(limbGeo, mat);
  m.userData.r = r;
  m.frustumCulled = false;
  return m;
}
export function makeJoint(mat, r) {
  const m = new THREE.Mesh(jointGeo, mat);
  m.scale.setScalar(r);
  m.frustumCulled = false;
  return m;
}
const _dir = new THREE.Vector3(), _Z = new THREE.Vector3(0, 0, 1);
// a, b w układzie rodzica siatki
export function setLimb(m, a, b) {
  _dir.subVectors(b, a);
  const len = _dir.length();
  m.position.copy(a);
  if (len > 1e-5) m.quaternion.setFromUnitVectors(_Z, _dir.divideScalar(len));
  m.scale.set(m.userData.r, m.userData.r, Math.max(1e-3, len));
}

// prosty IK dwóch kości (ramię/noga): S = bark/biodro, T = cel, pole = kierunek zgięcia
const _d = new THREE.Vector3(), _b = new THREE.Vector3();
export function solveIK(S, T, L1, L2, pole, outMid) {
  _d.subVectors(T, S);
  const dist = _d.length() || 1e-4;
  _d.divideScalar(dist);
  const dc = clamp(dist, 0.02, L1 + L2 - 1e-3);
  const cosA = (L1 * L1 + dc * dc - L2 * L2) / (2 * L1 * dc);
  const a = Math.acos(clamp(cosA, -1, 1));
  _b.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_b.lengthSq() < 1e-6) _b.set(0, -1, 0);
  _b.normalize();
  return outMid.copy(S).addScaledVector(_d, Math.cos(a) * L1).addScaledVector(_b, Math.sin(a) * L1);
}

// tekst na płótnie → tekstura (tablice, paski życia)
export function makeCanvasTex(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { canvas, ctx: canvas.getContext('2d'), tex };
}
