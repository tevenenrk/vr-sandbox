// Pustynny kanion: teren z siatki wysokości (kratery), ściany (wgniecenia), skały, odłamki.
import * as THREE from 'three';
import { scene, state, smooth, makeCanvasTex } from './core.js';

const _v1 = new THREE.Vector3();

export const FOG_COLOR = new THREE.Color(0xd9b48c);
export const FOG_DENSITY = 0.0022;
export const SCALE = 3;               // kanion 3× większy (szerokość i wysokość)
export const ARENA_RADIUS = 112 * SCALE;

// ---------------------------------------------------------------------------
// Układ kanionu: otwarta niecka + kręte wąwozy (część wąskich = "zamknięte")
// ---------------------------------------------------------------------------
const BASIN = { x: 0, z: -10, r: 30 };
const CHANNELS = [
  { w: 16, pts: [[0, -10], [12, -45], [-4, -75], [-28, -100]] },
  { w: 13, pts: [[0, -10], [36, -6], [60, 14], [96, 4]] },
  { w: 17, pts: [[0, -10], [-30, 12], [-46, 46], [-80, 72]] },
  { w: 9, pts: [[-30, 12], [-66, -12], [-98, -30]] },           // wąski korytarz
  { w: 10, pts: [[36, -6], [52, -42], [82, -62]] },
  { w: 8, pts: [[12, -45], [44, -70], [60, -96]] },             // wąski korytarz
  { w: 12, pts: [[-46, 46], [-10, 70], [26, 96]] },
];
const WALL_H = 34;

function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
// ujemne = wewnątrz otwartej przestrzeni, dodatnie = odległość od krawędzi w głąb skały (w metrach)
function openness(x, z) { return SCALE * opennessUnit(x / SCALE, z / SCALE); }
function opennessUnit(x, z) {
  let d = Math.hypot(x - BASIN.x, z - BASIN.z) - BASIN.r;
  for (const c of CHANNELS) {
    for (let i = 0; i < c.pts.length - 1; i++) {
      const [ax, az] = c.pts[i], [bx, bz] = c.pts[i + 1];
      d = Math.min(d, distToSeg(x, z, ax, az, bx, bz) - c.w / 2);
    }
  }
  return d;
}
function baseHeight(wx, wz) {
  const x = wx / SCALE, z = wz / SCALE; // układ "jednostkowy", wynik skalowany
  const jag = Math.sin(x * 0.21 + z * 0.07) * 1.6 + Math.sin(z * 0.33 - x * 0.12) * 1.1 + Math.sin((x - z) * 0.6) * 0.4;
  const d = opennessUnit(x, z) + jag;
  const floor = (Math.sin(x * 0.09 + Math.sin(z * 0.06) * 2) * 0.5 + Math.sin(z * 0.13 + x * 0.04) * 0.35) * smooth(-6, 0, d) * 1.8
    + Math.sin(wx * 0.7) * Math.sin(wz * 0.6) * 0.05;
  // ściana z uskokami (warstwy skalne)
  const wallT = smooth(0, 8, d);
  const terraces = Math.floor(wallT * 4) / 4 * 0.25 + wallT * 0.75;
  const plateau = WALL_H + Math.sin(x * 0.05) * 3 + Math.sin(z * 0.07 + 1) * 2.5;
  let h = floor + terraces * plateau * SCALE;
  const r = Math.hypot(x, z);
  h = Math.max(h, smooth(104, 118, r) * plateau * SCALE);
  return h;
}

// ---------------------------------------------------------------------------
export const TER = { size: 240 * SCALE, segs: 360 };
TER.n = TER.segs + 1;
TER.step = TER.size / TER.segs;
TER.half = TER.size / 2;
TER.h = new Float32Array(TER.n * TER.n);

const terrainGeo = new THREE.PlaneGeometry(TER.size, TER.size, TER.segs, TER.segs);
terrainGeo.rotateX(-Math.PI / 2);
{
  const pos = terrainGeo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0xe0b47e), sandDark = new THREE.Color(0xc99862);
  const bands = [0xb5552f, 0xc9733f, 0x8f3d22, 0xd49a62, 0xa84b2a].map(c => new THREE.Color(c));
  const c = new THREE.Color();
  for (let iz = 0; iz < TER.n; iz++) {
    for (let ix = 0; ix < TER.n; ix++) {
      const i = iz * TER.n + ix;
      const x = ix * TER.step - TER.half, z = iz * TER.step - TER.half;
      pos.setX(i, x); pos.setZ(i, z);
      const h = baseHeight(x, z);
      TER.h[i] = h;
      pos.setY(i, h);
      c.copy(sand).lerp(sandDark, 0.5 + 0.5 * Math.sin(x * 0.3 + Math.sin(z * 0.2) * 3));
      if (h > 1.2) {
        const band = bands[Math.floor(Math.abs(h * 0.2 + Math.sin(x * 0.02) * 1.5)) % bands.length];
        c.lerp(band, smooth(1.2, 6, h));
        if (h > WALL_H * SCALE - 8) c.lerp(sandDark, 0.45); // piasek na płaskowyżu
      }
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
function hIdx(ix, iz) {
  ix = Math.max(0, Math.min(TER.segs, ix));
  iz = Math.max(0, Math.min(TER.segs, iz));
  return TER.h[iz * TER.n + ix];
}
function updateNormals(ix0, iz0, ix1, iz1) {
  const nrm = terrainGeo.attributes.normal;
  const s2 = TER.step * 2;
  for (let iz = Math.max(0, iz0); iz <= Math.min(TER.segs, iz1); iz++) {
    for (let ix = Math.max(0, ix0); ix <= Math.min(TER.segs, ix1); ix++) {
      _v1.set(hIdx(ix - 1, iz) - hIdx(ix + 1, iz), s2, hIdx(ix, iz - 1) - hIdx(ix, iz + 1)).normalize();
      nrm.setXYZ(iz * TER.n + ix, _v1.x, _v1.y, _v1.z);
    }
  }
  nrm.needsUpdate = true;
}
updateNormals(0, 0, TER.segs, TER.segs);

export function heightAt(x, z) {
  if (state.xrMode === 'ar') return 0;
  const fx = (x + TER.half) / TER.step, fz = (z + TER.half) / TER.step;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const a = hIdx(ix, iz), b = hIdx(ix + 1, iz), c = hIdx(ix, iz + 1), d = hIdx(ix + 1, iz + 1);
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
export function normalAt(x, z, out) {
  if (state.xrMode === 'ar') return out.set(0, 1, 0);
  const e = 0.8;
  return out.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
}
// punkt styku odcinka a→b z terenem (a nad terenem, b pod)
export function findSurface(a, b, out) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 10; i++) {
    const m = (lo + hi) / 2;
    out.lerpVectors(a, b, m);
    if (out.y > heightAt(out.x, out.z)) lo = m; else hi = m;
  }
  return out.lerpVectors(a, b, lo);
}

// --- kratery na dnie -----------------------------------------------------------
const SCORCH = new THREE.Color(0x3a2a20), GLASS = new THREE.Color(0x1a1412), RIM = new THREE.Color(0xf0c58e);
export function makeCrater(cx, cz, R) {
  if (state.xrMode === 'ar') return;
  const depth = R * 0.5;
  const ext = R * 2.6;
  const seed = Math.random() * 10;
  const ix0 = Math.floor((cx - ext + TER.half) / TER.step), ix1 = Math.ceil((cx + ext + TER.half) / TER.step);
  const iz0 = Math.floor((cz - ext + TER.half) / TER.step), iz1 = Math.ceil((cz + ext + TER.half) / TER.step);
  const pos = terrainGeo.attributes.position, col = terrainGeo.attributes.color;
  const c = new THREE.Color();
  for (let iz = Math.max(0, iz0); iz <= Math.min(TER.segs, iz1); iz++) {
    for (let ix = Math.max(0, ix0); ix <= Math.min(TER.segs, ix1); ix++) {
      const i = iz * TER.n + ix;
      const x = ix * TER.step - TER.half, z = iz * TER.step - TER.half;
      const d = Math.hypot(x - cx, z - cz) / R;
      if (d > 2.6) continue;
      c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
      if (d <= 1.6) {
        let delta = 0;
        if (d < 1) delta -= depth * (1 - d * d);
        delta += depth * 0.4 * Math.exp(-Math.pow((d - 1) / 0.24, 2));
        TER.h[i] = Math.max(-25, TER.h[i] + delta);
        pos.setY(i, TER.h[i]);
        if (d < 1.15) c.lerp(d < 0.45 ? GLASS : SCORCH, (1 - d / 1.15) * 0.9);
        else c.lerp(RIM, 0.3 * (1 - (d - 1.15) / 0.45));
      }
      // promienie wyrzuconego materiału wokół krateru
      if (d > 0.95) {
        const ang = Math.atan2(z - cz, x - cx);
        const ray = Math.pow(Math.abs(Math.sin(ang * 6 + seed) * Math.sin(ang * 3.7 + seed * 2)), 3);
        c.lerp(SCORCH, ray * 0.55 * (1 - (d - 0.95) / 1.65));
      }
      col.setXYZ(i, c.r, c.g, c.b);
    }
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
  updateNormals(ix0 - 1, iz0 - 1, ix1 + 1, iz1 + 1);
  for (const r of decoRocks) {
    if (Math.hypot(r.position.x - cx, r.position.z - cz) < R * 1.6) r.position.y = heightAt(r.position.x, r.position.z) + r.userData.lift;
  }
  // żarzące się dno, które powoli stygnie
  const glow = new THREE.Mesh(glowDiscGeo, new THREE.MeshBasicMaterial({ map: moltenTex, color: 0xff8a30, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, fog: false }));
  glow.position.set(cx, heightAt(cx, cz) + 0.06, cz);
  glow.scale.setScalar(R * 0.75);
  scene.add(glow);
  glows.push({ m: glow, life: 9 });
}
const glowDiscGeo = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
const moltenTex = (() => {
  const { ctx, tex } = makeCanvasTex(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,240,180,1)'); g.addColorStop(0.3, 'rgba(255,150,50,0.9)');
  g.addColorStop(0.65, 'rgba(200,60,10,0.45)'); g.addColorStop(1, 'rgba(120,20,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return tex;
})();
const glows = [];

// --- wgniecenia w ścianach (naklejka + odłamki) ---------------------------------
const craterTex = (() => {
  const { canvas, ctx, tex } = makeCanvasTex(256, 256);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(25,14,10,1)');
  g.addColorStop(0.35, 'rgba(55,30,20,0.97)');
  g.addColorStop(0.62, 'rgba(105,58,34,0.85)');
  g.addColorStop(0.8, 'rgba(160,100,60,0.5)');
  g.addColorStop(1, 'rgba(160,100,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(30,16,10,0.9)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 11; i++) {
    let a = (i / 11) * Math.PI * 2 + Math.random() * 0.4;
    let r = 50, x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x, y);
    while (r < 125) {
      r += 10 + Math.random() * 12; a += (Math.random() - 0.5) * 0.35;
      x = 128 + Math.cos(a) * r; y = 128 + Math.sin(a) * r;
      ctx.lineTo(x, y);
      ctx.lineWidth = Math.max(1, ctx.lineWidth - 0.5);
    }
    ctx.stroke();
  }
  void canvas;
  return tex;
})();
const decalGeo = new THREE.CircleGeometry(1, 28);
const decalMat = new THREE.MeshLambertMaterial({ map: craterTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
const decals = [];
export function wallDecal(point, normal, R) {
  if (state.xrMode === 'ar') return;
  const m = new THREE.Mesh(decalGeo, decalMat);
  m.position.copy(point).addScaledVector(normal, 0.12);
  m.lookAt(_v1.copy(m.position).add(normal));
  m.rotateZ(Math.random() * 6.28);
  m.scale.setScalar(R);
  m.renderOrder = 1;
  scene.add(m);
  decals.push(m);
  if (decals.length > 60) scene.remove(decals.shift());
}

// --- odłamki skał ---------------------------------------------------------------
export const debrisGeo = new THREE.DodecahedronGeometry(1, 0);
export const debrisMat = new THREE.MeshLambertMaterial({ color: 0xa0664a, flatShading: true });
const hotMat = new THREE.MeshLambertMaterial({ color: 0x5a2a18, emissive: 0xff6a20, flatShading: true });
const debris = [];
export function spawnDebris(pos, R, normal) {
  const n = Math.min(60, Math.round(10 + R * 7));
  const k = Math.sqrt(R);
  for (let i = 0; i < n; i++) {
    const hot = i % 3 === 0;
    const m = new THREE.Mesh(debrisGeo, hot ? hotMat : debrisMat);
    const s = (0.06 + Math.random() * 0.22) * Math.min(3.5, 0.6 + R * 0.4);
    m.scale.set(s, s * (0.6 + Math.random() * 0.6), s);
    m.position.copy(pos).addScaledVector(normal, 0.3);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2)
      .addScaledVector(normal, 1.6).normalize().multiplyScalar((3 + Math.random() * 7) * k * 0.8);
    vel.y += 2 * k;
    scene.add(m);
    debris.push({ m, vel, s, life: 8 + Math.random() * 4, resting: false, spin: Math.random() * 8, hot: hot ? 2.5 + Math.random() * 2 : 0 });
  }
  while (debris.length > 260) { const d = debris.shift(); scene.remove(d.m); }
}
export function updateWorld(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.life -= dt;
    if (!d.resting) {
      d.vel.y -= 9.8 * dt;
      d.m.position.addScaledVector(d.vel, dt);
      d.m.rotation.x += d.spin * dt; d.m.rotation.z += d.spin * 0.7 * dt;
      const g = heightAt(d.m.position.x, d.m.position.z) + d.s * 0.4;
      if (d.m.position.y < g) {
        d.m.position.y = g;
        if (Math.abs(d.vel.y) < 2) d.resting = true;
        d.vel.y = Math.abs(d.vel.y) * 0.25; d.vel.x *= 0.4; d.vel.z *= 0.4;
      }
    }
    if (d.hot > 0) { d.hot -= dt; if (d.hot <= 0) d.m.material = debrisMat; }
    if (d.life < 1) d.m.position.y -= dt * d.s;
    if (d.life <= 0) { scene.remove(d.m); debris.splice(i, 1); }
  }
  for (let i = glows.length - 1; i >= 0; i--) {
    const g = glows[i];
    g.life -= dt;
    g.m.material.opacity = Math.min(1, g.life / 6);
    g.m.material.color.setHex(g.life > 5 ? 0xff9a40 : 0xff6020);
    if (g.life <= 0) { scene.remove(g.m); g.m.material.dispose(); glows.splice(i, 1); }
  }
  hotMat.emissiveIntensity = 0.8 + Math.sin(performance.now() * 0.01) * 0.2;
}

// uderzenie w teren: dno → krater, ściana → wgniecenie. Zwraca normalną powierzchni.
export const CRATER_SCALE = 5;
export function impact(point, R, outNormal = new THREE.Vector3()) {
  R = Math.min(26, R * CRATER_SCALE);
  normalAt(point.x, point.z, outNormal);
  if (state.xrMode === 'ar') return outNormal;
  if (outNormal.y > 0.6) makeCrater(point.x, point.z, R);
  else wallBite(point, R, outNormal);
  spawnDebris(point, R, outNormal);
  return outNormal;
}

// trafienie w ścianę/pagórek: wyrwa w skale + osypisko głazów z góry
export function wallBite(point, R, normal) {
  if (state.xrMode === 'ar') return;
  const ext = R * 1.4;
  const ix0 = Math.floor((point.x - ext + TER.half) / TER.step), ix1 = Math.ceil((point.x + ext + TER.half) / TER.step);
  const iz0 = Math.floor((point.z - ext + TER.half) / TER.step), iz1 = Math.ceil((point.z + ext + TER.half) / TER.step);
  const pos = terrainGeo.attributes.position, col = terrainGeo.attributes.color;
  const c = new THREE.Color();
  let topH = point.y;
  for (let iz = Math.max(0, iz0); iz <= Math.min(TER.segs, iz1); iz++) {
    for (let ix = Math.max(0, ix0); ix <= Math.min(TER.segs, ix1); ix++) {
      const i = iz * TER.n + ix;
      const x = ix * TER.step - TER.half, z = iz * TER.step - TER.half;
      const d = Math.hypot(x - point.x, z - point.z) / R;
      if (d > 1.4) continue;
      const target = point.y - R * 0.35 * Math.max(0, 1 - d * d) + Math.max(0, d - 0.5) * R * 4;
      if (TER.h[i] > target) {
        topH = Math.max(topH, TER.h[i]);
        TER.h[i] = Math.max(-25, target);
        pos.setY(i, TER.h[i]);
        c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(SCORCH, (1 - d / 1.4) * 0.6);
        col.setXYZ(i, c.r, c.g, c.b);
      }
    }
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
  updateNormals(ix0 - 1, iz0 - 1, ix1 + 1, iz1 + 1);
  for (const r of decoRocks) {
    if (Math.hypot(r.position.x - point.x, r.position.z - point.z) < ext) r.position.y = heightAt(r.position.x, r.position.z) + r.userData.lift;
  }
  // głazy osypujące się z wyrwy
  const n = Math.min(35, Math.round(6 + R * 1.6));
  const span = Math.max(1, topH - point.y);
  for (let k = 0; k < n; k++) {
    const m = new THREE.Mesh(debrisGeo, k % 4 === 0 ? hotMat : debrisMat);
    const s = (0.3 + Math.random() * 0.9) * Math.min(3, 0.4 + R * 0.12);
    m.scale.set(s, s * (0.6 + Math.random() * 0.5), s);
    m.position.set(point.x + (Math.random() - 0.5) * R, point.y + Math.random() * Math.min(span, R * 3), point.z + (Math.random() - 0.5) * R)
      .addScaledVector(normal, -R * 0.2);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3).addScaledVector(normal, 2 + Math.random() * 5);
    scene.add(m);
    debris.push({ m, vel, s, life: 9 + Math.random() * 4, resting: false, spin: Math.random() * 4, hot: k % 4 === 0 ? 3 : 0 });
  }
}

// ---------------------------------------------------------------------------
// Otoczenie
// ---------------------------------------------------------------------------
export const env = new THREE.Group();
scene.add(env);
export const pillars = [];
const decoRocks = [];
{
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 zenith = vec3(0.20, 0.42, 0.78);
        vec3 horizon = vec3(0.93, 0.78, 0.60);
        vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.45, h));
        vec3 sunDir = normalize(vec3(0.5, 0.45, -0.8));
        float sd = max(dot(vDir, sunDir), 0.0);
        col += vec3(1.0, 0.85, 0.6) * pow(sd, 12.0) * 0.5 + vec3(1.0) * pow(sd, 900.0) * 3.0;
        if (h < 0.0) col = horizon * 0.85;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  env.add(sky);

  env.add(new THREE.Mesh(terrainGeo, new THREE.MeshLambertMaterial({ vertexColors: true })));
  const outer = new THREE.Mesh(new THREE.RingGeometry(TER.half - 4, 1700, 64, 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xc89a66 }));
  outer.position.y = WALL_H * SCALE - 3;
  env.add(outer);

  const pad = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.6, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xff8a3c, transparent: true, opacity: 0.6 }));
  pad.position.y = heightAt(0, 0) + 0.02;
  env.add(pad);

  // skalne słupy w niecce i wąwozach
  const pMat = new THREE.MeshLambertMaterial({ color: 0xb2643c, flatShading: true });
  const pTop = new THREE.MeshLambertMaterial({ color: 0xc98a5a, flatShading: true });
  for (let [x, z, r, h] of [[14, -24, 2.6, 13], [-16, -2, 2.2, 10], [6, 8, 1.6, 7], [-2, -60, 3, 16], [-58, 30, 2.5, 12], [70, 8, 2, 10], [24, 4, 1.8, 9], [-8, -30, 2, 11]]) {
    x *= SCALE; z *= SCALE; r *= 2.5; h *= SCALE;
    const base = heightAt(x, z) - 1;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 1.15, h, 9, 3), pMat);
    body.position.set(x, base + h / 2, z);
    body.rotation.y = Math.random() * 3;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.1, r * 0.8, 1.2, 9), pTop);
    top.position.set(x, base + h + 0.6, z);
    env.add(body, top);
    pillars.push({ x, z, r: r * 1.0, top: base + h + 1.2 });
  }
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x9c6a48, flatShading: true });
  let placed = 0;
  for (let i = 0; i < 900 && placed < 130; i++) {
    const x = (Math.random() - 0.5) * 600, z = (Math.random() - 0.5) * 600;
    if (openness(x, z) > -2 || Math.hypot(x, z) < 6) continue;
    const s = 0.4 + Math.random() * 2.2;
    const rock = new THREE.Mesh(debrisGeo, rockMat);
    rock.position.set(x, heightAt(x, z) + s * 0.3, z);
    rock.scale.set(s * (0.7 + Math.random()), s * (0.5 + Math.random()), s * (0.7 + Math.random()));
    rock.rotation.set(Math.random(), Math.random() * 3, Math.random());
    rock.userData.lift = s * 0.3;
    decoRocks.push(rock);
    env.add(rock);
    placed++;
  }
  env.add(new THREE.HemisphereLight(0xbfd9ff, 0xb07a4a, 1.3));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
  sun.position.set(50, 45, -80);
  env.add(sun);
}
export const arLight = new THREE.HemisphereLight(0xffffff, 0x444466, 1.6);
arLight.visible = false;
scene.add(arLight);

export function pillarHit(pos, r, outNormal) {
  if (state.xrMode === 'ar') return false;
  for (const p of pillars) {
    const dx = pos.x - p.x, dz = pos.z - p.z, d = Math.hypot(dx, dz);
    if (pos.y - r < p.top && d < p.r + r) {
      if (outNormal) outNormal.set(dx / (d || 1), 0, dz / (d || 1));
      return true;
    }
  }
  return false;
}
// czy punkt jest w otwartej przestrzeni (do wybierania miejsc dla przeciwnika/celów)
export function isOpen(x, z, margin = 3) { return state.xrMode === 'ar' || openness(x, z) < -margin; }

export function setWorldMode(mode) {
  const ar = mode === 'ar';
  env.visible = !ar;
  arLight.visible = ar;
  for (const d of decals) d.visible = !ar;
  scene.fog = ar ? null : new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
}
scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

// --- wspólny interfejs świata (ten sam co w planet.js) ---
export const MAX_Y = 280;
export function below(p, off = 0) { return p.y - off < heightAt(p.x, p.z); }
