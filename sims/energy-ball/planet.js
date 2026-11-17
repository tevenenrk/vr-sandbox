// Tryb „Mała planeta”: kula z terenem i oceanem, miasteczka, drzewa, ludzie twojej wielkości,
// statki na orbicie. Wszystko da się zniszczyć — a w pełni naładowana wielka kula rozsadza planetę.
// Planeta obraca się pod graczem (gracz zawsze „na górze”), dzięki temu cała mechanika z osią Y działa bez zmian.
import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, rand, clamp, smooth, glowTex } from './core.js';
import { boom } from './fx.js';
import { sfx } from './audio.js';

export const R0 = 160;                       // promień planety
const SEA = R0 - 0.8;                        // poziom oceanu
export const CENTER = new THREE.Vector3(0, -R0, 0);
export const ARENA_RADIUS = 1e6;
export const MAX_Y = 70;                     // maksymalna wysokość lotu nad planetą
export const FOG_DENSITY = 0;

const Y = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();

export const planet = new THREE.Group();     // wszystko, co jest na planecie i obraca się z nią
planet.position.copy(CENTER);
export const env = new THREE.Group();        // kosmos (nie obraca się)
env.visible = false;
planet.visible = false;
scene.add(env, planet);
export const stats = { buildings: 0, buildings0: 1, people: 0, people0: 1, ships: 0, destroyed: 0 };
let alive = true;

// ---------------------------------------------------------------------------
// Teren: szum 3D na kierunku + kratery
// ---------------------------------------------------------------------------
function hash(x, y, z) { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let xf = x - xi, yf = y - yi, zf = z - zi;
  xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf); zf = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(hash(xi, yi, zi), hash(xi + 1, yi, zi), xf), l(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), xf), yf),
    l(l(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), xf), l(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), xf), yf), zf);
}
function fbm(x, y, z) { let a = 0.5, f = 1, s = 0; for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, y * f, z * f); f *= 2.03; a *= 0.5; } return s; }
function baseH(d) {
  const n = fbm(d.x * 2.2 + 5.1, d.y * 2.2 + 1.3, d.z * 2.2 - 3.7);
  let h = (n - 0.47) * 24;
  if (h > 2) h += (fbm(d.x * 6 + 11, d.y * 6, d.z * 6) - 0.45) * 14 * smooth(2, 8, h);
  return h;
}
const craters = [];
function craterSum(d) {
  let s = 0;
  for (const c of craters) {
    const dot = d.x * c.c.x + d.y * c.c.y + d.z * c.c.z;
    if (dot < c.cosExt) continue;
    const k = Math.acos(Math.min(1, dot)) * R0 / c.R;
    if (k < 1) s -= c.D * (1 - k * k);
    s += c.D * 0.4 * Math.exp(-Math.pow((k - 1) / 0.24, 2));
  }
  return s;
}
function radiusLocal(d) { return R0 + baseH(d) + craterSum(d); }
// kierunek w układzie planety dla punktu w świecie
function localDir(p, out) {
  out.subVectors(p, planet.position);
  _qi.copy(planet.quaternion).invert();
  return out.applyQuaternion(_qi).normalize();
}

// --- siatka planety ---
let geo, dirs, base, radii, colors;
const surfMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x000000 });
const surface = new THREE.Mesh(undefined, surfMat);
planet.add(surface);
const C_SAND = new THREE.Color(0xd9c48c), C_GRASS = new THREE.Color(0x5d9a3c), C_GRASS2 = new THREE.Color(0x3f7a30),
  C_ROCK = new THREE.Color(0x8a7866), C_SNOW = new THREE.Color(0xf4f6f8), C_SEABED = new THREE.Color(0x5f7d6e),
  C_SCORCH = new THREE.Color(0x2e221a), C_GLASS = new THREE.Color(0x16110e);
function buildSurface() {
  let g = new THREE.IcosahedronGeometry(1, 56);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-5);
  const pos = g.attributes.position;
  dirs = new Float32Array(pos.count * 3);
  base = new Float32Array(pos.count);
  radii = new Float32Array(pos.count);
  colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    _v1.fromBufferAttribute(pos, i).normalize();
    dirs[i * 3] = _v1.x; dirs[i * 3 + 1] = _v1.y; dirs[i * 3 + 2] = _v1.z;
    const h = baseH(_v1);
    base[i] = h;
    radii[i] = R0 + h;
    pos.setXYZ(i, _v1.x * radii[i], _v1.y * radii[i], _v1.z * radii[i]);
    if (h < -0.8) c.copy(C_SEABED);
    else if (h < 0.5) c.copy(C_SAND);
    else if (h < 6) c.copy(C_GRASS).lerp(C_GRASS2, vnoise(_v1.x * 20, _v1.y * 20, _v1.z * 20));
    else if (h < 11) c.copy(C_ROCK);
    else c.copy(C_SNOW);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  if (geo) geo.dispose();
  geo = g;
  surface.geometry = g;
}

const ocean = new THREE.Mesh(new THREE.SphereGeometry(SEA, 72, 48), new THREE.MeshPhongMaterial({ color: 0x2a6fb8, transparent: true, opacity: 0.86, shininess: 90, specular: 0x88aaff }));
planet.add(ocean);
const atmo = new THREE.Mesh(new THREE.SphereGeometry(R0 * 1.16, 64, 40), new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color(0x6fb4ff) } },
  vertexShader: /* glsl */`varying vec3 vN; varying vec3 vV;
    void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */`uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
    void main() { float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); gl_FragColor = vec4(uColor, pow(f, 2.5) * 0.7); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
}));
planet.add(atmo);

// ---------------------------------------------------------------------------
// Kosmos: gwiazdy, słońce, światło
// ---------------------------------------------------------------------------
{
  const n = 2500, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    _v1.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(2600);
    p[i * 3] = _v1.x; p[i * 3 + 1] = _v1.y; p[i * 3 + 2] = _v1.z;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  env.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, fog: false })));
  const sunDir = new THREE.Vector3(0.6, 0.55, -0.6).normalize();
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff2d0, fog: false, depthWrite: false }));
  sun.position.copy(sunDir).multiplyScalar(2400); sun.scale.setScalar(420);
  env.add(sun);
  const dl = new THREE.DirectionalLight(0xfff4e0, 2.6); dl.position.copy(sunDir).multiplyScalar(100);
  env.add(dl);
  env.add(new THREE.HemisphereLight(0x8fb0ff, 0x101018, 0.55));
  env.add(new THREE.AmbientLight(0x404660, 0.5));
}

// ---------------------------------------------------------------------------
// Miasteczka, drzewa, ludzie (instancje — lekkie dla gogli)
// ---------------------------------------------------------------------------
function placeOn(d, yaw, sx, sy, sz, out, lift = 0) {
  const r = radiusLocal(d) + lift;
  _q.setFromUnitVectors(Y, d);
  _qi.setFromAxisAngle(Y, yaw);
  _q.multiply(_qi);
  return out.compose(_v1.copy(d).multiplyScalar(r), _q, _s.set(sx, sy, sz));
}
const houseGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const roofGeo = new THREE.ConeGeometry(0.78, 0.55, 4).rotateY(Math.PI / 4).translate(0, 1.27, 0);
const towerTex = (() => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d'); g.fillStyle = '#7d8794'; g.fillRect(0, 0, 64, 128);
  for (let y = 6; y < 124; y += 12) for (let x = 6; x < 60; x += 14) { g.fillStyle = Math.random() < 0.6 ? '#ffe9a8' : '#2c3442'; g.fillRect(x, y, 8, 7); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const MAXB = 140, MAXT = 260, MAXP = 170;
const houses = new THREE.InstancedMesh(houseGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), MAXB);
const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), MAXB);
const towers = new THREE.InstancedMesh(houseGeo, new THREE.MeshLambertMaterial({ map: towerTex, emissive: 0x2a2410, emissiveMap: towerTex }), 40);
const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 1.4, 6).translate(0, 0.7, 0);
const crownGeo = new THREE.ConeGeometry(1.3, 3.6, 7).translate(0, 3.0, 0);
const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x6b4a2e }), MAXT);
const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), MAXT);
const personGeo = mergeGeometries([
  new THREE.CapsuleGeometry(0.21, 0.85, 3, 8).translate(0, 0.66, 0),
  new THREE.SphereGeometry(0.17, 10, 8).translate(0, 1.43, 0),
]);
const people = new THREE.InstancedMesh(personGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), MAXP);
for (const m of [houses, roofs, towers, trunks, crowns, people]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); planet.add(m); }
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

const items = { houses: [], towers: [], trees: [], people: [] };
const towns = [];
function randLandDir(minH = 0.5, maxH = 5, near = null, spread = 0) {
  for (let i = 0; i < 200; i++) {
    if (near) { _v2.copy(near).add(_v3.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(spread)).normalize(); }
    else _v2.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
    const h = baseH(_v2);
    if (h > minH && h < maxH) return _v2.clone();
  }
  return null;
}
function populate() {
  for (const k in items) items[k].length = 0;
  towns.length = 0;
  for (let i = 0; i < 9; i++) { const d = randLandDir(0.8, 4); if (d) towns.push(d); }
  let hi = 0, ti = 0;
  const houseCols = [0xf2e6d0, 0xe8d2b0, 0xd9e4ee, 0xf0d8d8, 0xe6efd8], roofCols = [0xb2442e, 0x8a3a24, 0x4a5a7a, 0x6a4a3a];
  for (const town of towns) {
    const nH = 12 + Math.floor(Math.random() * 6);
    for (let k = 0; k < nH && hi < MAXB; k++) {
      const d = randLandDir(0.4, 6, town, 0.12);
      if (!d) continue;
      const w = rand(4, 7), h = rand(3.5, 6), dp = rand(4, 7), yaw = rand(0, 6.28);
      items.houses.push({ d, yaw, w, h, dp, alive: true, i: hi });
      houses.setColorAt(hi, new THREE.Color(houseCols[hi % houseCols.length]));
      roofs.setColorAt(hi, new THREE.Color(roofCols[hi % roofCols.length]));
      hi++;
    }
    const nT = 1 + Math.floor(Math.random() * 3);
    for (let k = 0; k < nT && ti < 40; k++) {
      const d = randLandDir(0.4, 6, town, 0.06);
      if (!d) continue;
      items.towers.push({ d, yaw: rand(0, 6.28), w: rand(6, 9), h: rand(14, 32), alive: true, i: ti });
      ti++;
    }
  }
  houses.count = hi; roofs.count = hi; towers.count = ti;
  let tr = 0;
  for (let k = 0; k < MAXT; k++) {
    const d = randLandDir(0.6, 9);
    if (!d || towns.some(t => t.dot(d) > 0.996)) continue;
    const s = rand(0.8, 1.6);
    items.trees.push({ d, yaw: rand(0, 6.28), s, alive: true, i: tr });
    crowns.setColorAt(tr, new THREE.Color().setHSL(rand(0.27, 0.36), rand(0.4, 0.6), rand(0.22, 0.34)));
    tr++;
  }
  trunks.count = crowns.count = tr;
  const clothes = [0xc0392b, 0x2e86de, 0xf1c40f, 0x27ae60, 0x8e44ad, 0xe67e22, 0xecf0f1, 0x34495e];
  for (let k = 0; k < MAXP; k++) {
    const town = towns[k % towns.length];
    const d = randLandDir(0.3, 7, town, 0.1) || randLandDir();
    const h = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)); h.addScaledVector(d, -h.dot(d)).normalize();
    items.people.push({ d, h, i: k, state: 'walk', speed: rand(0.9, 1.6), panic: 0, phase: rand(0, 6), pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), t: 0, home: town });
    people.setColorAt(k, new THREE.Color(clothes[k % clothes.length]));
  }
  people.count = MAXP;
  for (const m of [houses, roofs, crowns, people]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  refreshStatic();
  stats.buildings0 = items.houses.length + items.towers.length;
  stats.people0 = MAXP;
}
function refreshStatic() {
  for (const b of items.houses) {
    if (!b.alive) { houses.setMatrixAt(b.i, ZERO); roofs.setMatrixAt(b.i, ZERO); continue; }
    placeOn(b.d, b.yaw, b.w, b.h, b.dp, _m, -0.4); houses.setMatrixAt(b.i, _m); roofs.setMatrixAt(b.i, placeOn(b.d, b.yaw, b.w, b.h, b.dp, _m, -0.4));
  }
  for (const b of items.towers) towers.setMatrixAt(b.i, b.alive ? placeOn(b.d, b.yaw, b.w, b.h, b.w, _m, -0.5) : ZERO);
  for (const t of items.trees) {
    if (!t.alive) { trunks.setMatrixAt(t.i, ZERO); crowns.setMatrixAt(t.i, ZERO); continue; }
    placeOn(t.d, t.yaw, t.s, t.s, t.s, _m, -0.2); trunks.setMatrixAt(t.i, _m); crowns.setMatrixAt(t.i, _m);
  }
  for (const m of [houses, roofs, towers, trunks, crowns]) m.instanceMatrix.needsUpdate = true;
  stats.buildings = items.houses.filter(b => b.alive).length + items.towers.filter(b => b.alive).length;
}

// ---------------------------------------------------------------------------
// Odłamki skał (w układzie planety, grawitacja do środka) i głazy unoszone aurą
// ---------------------------------------------------------------------------
export const debrisGeo = new THREE.DodecahedronGeometry(1, 0);
export const debrisMat = new THREE.MeshLambertMaterial({ color: 0x8a6a4e, flatShading: true });
const hotMat = new THREE.MeshLambertMaterial({ color: 0x5a2a18, emissive: 0xff6a20, flatShading: true });
const debris = [];
function addDebris(local, vel, s, hot = false, life = 8) {
  const m = new THREE.Mesh(debrisGeo, hot ? hotMat : debrisMat);
  m.scale.set(s, s * rand(0.6, 1.1), s);
  m.position.copy(local);
  planet.add(m);
  debris.push({ m, vel, s, life, hot: hot ? 2.5 : 0, spin: rand(0, 6), resting: false });
  while (debris.length > 240) { const d = debris.shift(); planet.remove(d.m); }
}
function updateDebris(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.life -= dt;
    if (!d.resting) {
      _v1.copy(d.m.position).normalize();
      d.vel.addScaledVector(_v1, -9.8 * dt);
      d.m.position.addScaledVector(d.vel, dt);
      d.m.rotation.x += d.spin * dt; d.m.rotation.z += d.spin * 0.7 * dt;
      if (alive) {
        const r = radiusLocal(_v1.copy(d.m.position).normalize()) + d.s * 0.4;
        if (d.m.position.length() < r) {
          d.m.position.setLength(r);
          const vn = d.vel.dot(_v1);
          d.vel.addScaledVector(_v1, -vn * 1.25).multiplyScalar(0.4);
          if (Math.abs(vn) < 2) d.resting = true;
        }
      }
    }
    if (d.hot > 0) { d.hot -= dt; if (d.hot <= 0) d.m.material = debrisMat; }
    if (d.life < 1) d.m.scale.multiplyScalar(Math.pow(0.05, dt));
    if (d.life <= 0) { planet.remove(d.m); debris.splice(i, 1); }
  }
}
export function spawnDebris(pos, R, normal) {
  const local = planet.worldToLocal(pos.clone());
  const up = local.clone().normalize();
  const n = Math.min(45, Math.round(8 + R * 3));
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).addScaledVector(up, 1.6).normalize().multiplyScalar(rand(4, 12) * Math.sqrt(R / 3));
    addDebris(local.clone().addScaledVector(up, 0.5), v, rand(0.15, 0.6) * Math.min(4, 0.6 + R * 0.12), i % 3 === 0);
  }
  void normal;
}

// głazy podnoszone przez aurę przy ziemi
const lev = [];
let auraCraterT = 0, auraR = 0;
export function auraTick(head, dt, level, active) {
  if (!alive) return;
  const g = heightAt(head.x, head.z);
  const near = active && head.y - g < 14 && g > -1e8;
  if (near) {
    // krater pod stopami rośnie od samej poświaty
    auraCraterT -= dt;
    auraR = Math.min(28, auraR + dt * (2 + level * 4));
    if (auraCraterT <= 0) {
      auraCraterT = 0.45;
      const p = _v3.set(head.x, g, head.z);
      crater(p, Math.max(4, auraR), 0.12, false);
      if (lev.length < 40) {
        for (let k = 0; k < 3; k++) {
          const a = rand(0, 6.28), r = rand(3, 10);
          const w = _v1.set(head.x + Math.cos(a) * r, 0, head.z + Math.sin(a) * r);
          w.y = heightAt(w.x, w.z);
          if (w.y < -1e8) continue;
          const local = planet.worldToLocal(w.clone());
          const m = new THREE.Mesh(debrisGeo, debrisMat);
          const s = rand(0.25, 1.1);
          m.scale.setScalar(s);
          m.position.copy(local);
          planet.add(m);
          lev.push({ m, s, a, r, h: 0, top: rand(2, 9), sp: rand(0.6, 1.4) });
        }
      }
    }
  } else auraR = Math.max(0, auraR - dt * 6);
  // unoszenie (w kierunku "w górę" od środka planety) i wolne krążenie
  for (let i = lev.length - 1; i >= 0; i--) {
    const L = lev[i];
    if (active) {
      L.h = Math.min(L.top, L.h + dt * L.sp * (0.6 + level));
      _v1.copy(L.m.position).normalize();
      const r0 = radiusLocal(_v1);
      L.m.position.setLength(r0 + L.s * 0.5 + L.h);
      L.m.rotation.x += dt * L.sp; L.m.rotation.y += dt * L.sp * 1.3;
    } else {
      // aura zgasła → głazy spadają
      addDebris(L.m.position.clone(), new THREE.Vector3(), L.s, false, 7);
      planet.remove(L.m);
      lev.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Kratery i niszczenie
// ---------------------------------------------------------------------------
function crater(pointWorld, Rm, depthK = 0.5, scorch = true) {
  if (!alive) return;
  const c = localDir(pointWorld, new THREE.Vector3());
  const D = Rm * depthK;
  const ext = Math.min(Math.PI, Rm * 1.6 / R0);
  craters.push({ c, R: Rm, D, cosExt: Math.cos(ext) });
  if (craters.length > 300) craters.splice(0, 1);
  const pos = geo.attributes.position, col = geo.attributes.color;
  const cosExt = Math.cos(ext);
  const cc = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const dx = dirs[i * 3], dy = dirs[i * 3 + 1], dz = dirs[i * 3 + 2];
    const dot = dx * c.x + dy * c.y + dz * c.z;
    if (dot < cosExt) continue;
    const k = Math.acos(Math.min(1, dot)) * R0 / Rm;
    let delta = 0;
    if (k < 1) delta -= D * (1 - k * k);
    delta += D * 0.4 * Math.exp(-Math.pow((k - 1) / 0.24, 2));
    radii[i] = Math.max(R0 * 0.35, radii[i] + delta);
    pos.setXYZ(i, dx * radii[i], dy * radii[i], dz * radii[i]);
    if (scorch && k < 1.15) {
      cc.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(k < 0.45 ? C_GLASS : C_SCORCH, (1 - k / 1.15) * 0.85);
      col.setXYZ(i, cc.r, cc.g, cc.b);
    } else if (!scorch && k < 1) {
      cc.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(C_ROCK, 0.15);
      col.setXYZ(i, cc.r, cc.g, cc.b);
    }
  }
  pos.needsUpdate = true; col.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  destroyNear(c, Rm * 1.25, pointWorld);
}
// zniszcz budynki, drzewa, ludzi w promieniu (kierunek c w układzie planety)
function destroyNear(c, Rm, pointWorld) {
  const cosA = Math.cos(Rm / R0);
  const cosFlee = Math.cos((Rm + 45) / R0);
  const cLocal = c.clone().multiplyScalar(R0);
  let changed = false;
  for (const list of [items.houses, items.towers, items.trees]) {
    for (const b of list) {
      if (!b.alive || b.d.dot(c) < cosA) continue;
      b.alive = false; changed = true;
      const p = b.d.clone().multiplyScalar(radiusLocal(b.d) + 2);
      const n = list === items.trees ? 2 : 5;
      for (let k = 0; k < n; k++) {
        const v = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).addScaledVector(b.d, 1.5).normalize().multiplyScalar(rand(5, 14));
        addDebris(p.clone(), v, rand(0.4, 1.2), Math.random() < 0.3);
      }
      if (list === items.towers) stats.destroyed++;
    }
  }
  for (const pr of items.people) {
    if (pr.state === 'dead' || pr.state === 'gone') continue;
    const dot = pr.d.dot(c);
    if (dot >= cosA && pr.state !== 'fly') {
      pr.state = 'fly'; pr.t = 0;
      pr.pos.copy(pr.d).multiplyScalar(radiusLocal(pr.d) + 0.3);
      _v1.subVectors(pr.pos, cLocal).normalize();
      pr.vel.copy(_v1).multiplyScalar(rand(6, 14)).addScaledVector(pr.d, rand(8, 16));
      pr.spin.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
    } else if (dot >= cosFlee && pr.state === 'walk') {
      pr.panic = rand(5, 9);
      // uciekaj od wybuchu (kierunek styczny do powierzchni)
      _v1.subVectors(pr.d, c);
      pr.h.copy(_v1).addScaledVector(pr.d, -_v1.dot(pr.d));
      if (pr.h.lengthSq() < 1e-8) pr.h.set(1, 0, 0).addScaledVector(pr.d, -pr.d.x);
      pr.h.normalize();
    }
  }
  if (changed) refreshStatic();
  void pointWorld;
}
export function impact(point, R, outNormal = new THREE.Vector3()) {
  if (!alive) return outNormal.set(0, 1, 0);
  const Rm = Math.min(60, R * 5);
  crater(point, Rm);
  spawnDebris(point, Math.min(Rm, 30), outNormal);
  return outNormal.subVectors(point, planet.position).normalize();
}
export function wallDecal() { /* na planecie wszystko jest "dnem" */ }
export function pillarHit() { return false; }
export function isOpen() { return true; }

// ---------------------------------------------------------------------------
// Zapytania o teren (gracz zawsze w okolicy "góry" planety)
// ---------------------------------------------------------------------------
export function heightAt(x, z) {
  if (!alive) return -1e9;
  _v1.set(x, planet.position.y + R0, z); // przybliżony punkt na powierzchni nad (x, z)
  const r = radiusLocal(localDir(_v1, _v3));
  const h2 = r * r - x * x - z * z;
  if (h2 <= 0) return -1e9;
  return planet.position.y + Math.sqrt(h2);
}
export function below(p, off = 0) {
  if (!alive) return false;
  const dist = _v1.subVectors(p, planet.position).length();
  return dist - off < radiusLocal(localDir(p, _v2));
}
export function normalAt(x, z, out) { return out.set(x, heightAt(x, z) - planet.position.y, z).normalize(); }
export function findSurface(a, b, out) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) {
    const m = (lo + hi) / 2;
    out.lerpVectors(a, b, m);
    if (below(out)) hi = m; else lo = m;
  }
  return out.lerpVectors(a, b, lo);
}

// ---------------------------------------------------------------------------
// Statki na orbicie (własne projekty: spodek i myśliwiec)
// ---------------------------------------------------------------------------
function makeSaucer() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.SphereGeometry(3, 24, 10), new THREE.MeshLambertMaterial({ color: 0x9aa4b2 }));
  hull.scale.set(1, 0.28, 1);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x7fdcff, emissive: 0x1a5070 }));
  dome.position.y = 0.5;
  g.add(hull, dome);
  for (let i = 0; i < 8; i++) {
    const l = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: i % 2 ? 0xffd040 : 0x60ffb0, blending: THREE.AdditiveBlending, depthWrite: false }));
    l.position.set(Math.cos(i / 8 * 6.28) * 2.9, 0, Math.sin(i / 8 * 6.28) * 2.9); l.scale.setScalar(0.9);
    g.add(l);
  }
  return g;
}
function makeFighter() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xc8ccd4 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.9, 5, 8).rotateX(Math.PI / 2), mat);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(6, 0.15, 1.6), new THREE.MeshLambertMaterial({ color: 0x8a2a3a }));
  wing.position.z = -0.8;
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.2, 1.2), mat); fin.position.set(0, 0.6, -1.6);
  const eng = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x6fd0ff, blending: THREE.AdditiveBlending, depthWrite: false }));
  eng.position.z = -2.7; eng.scale.setScalar(1.8);
  g.add(body, wing, fin, eng);
  return g;
}
const ships = [];
function spawnShip(s) {
  s.axis = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
  s.base = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)); s.base.addScaledVector(s.axis, -s.base.dot(s.axis)).normalize();
  s.alt = rand(25, 150); s.ang = rand(0, 6.28); s.speed = rand(0.02, 0.05) * (Math.random() < 0.5 ? 1 : -1);
  s.alive = true; s.wreck = null; s.respawn = 0;
  s.mesh.visible = true;
}
function initShips() {
  for (const s of ships) planet.remove(s.mesh);
  ships.length = 0;
  for (let i = 0; i < 10; i++) {
    const s = { mesh: i % 3 === 0 ? makeSaucer() : makeFighter(), radius: 5 };
    planet.add(s.mesh);
    spawnShip(s);
    ships.push(s);
  }
}
const _sp = new THREE.Vector3(), _sf = new THREE.Vector3();
function updateShips(dt) {
  let n = 0;
  for (const s of ships) {
    if (s.alive) {
      n++;
      s.ang += s.speed * dt;
      _sp.copy(s.base).applyAxisAngle(s.axis, s.ang).multiplyScalar(R0 + s.alt);
      _sf.crossVectors(s.axis, _sp).normalize().multiplyScalar(Math.sign(s.speed));
      s.mesh.position.copy(_sp);
      _m.lookAt(_v1.set(0, 0, 0), _sf, _v2.copy(_sp).normalize());
      s.mesh.quaternion.setFromRotationMatrix(_m);
      s.mesh.rotateY(Math.PI); // +Z w przód
    } else if (s.wreck) {
      // wrak spada na planetę, dymiąc
      const w = s.wreck;
      _v1.copy(s.mesh.position).normalize();
      w.vel.addScaledVector(_v1, -12 * dt);
      s.mesh.position.addScaledVector(w.vel, dt);
      s.mesh.rotateX(dt * 3); s.mesh.rotateZ(dt * 2);
      w.smoke -= dt;
      if (w.smoke <= 0) { w.smoke = 0.12; boom(planet.localToWorld(s.mesh.position.clone()), 0.5, { light: false, fire: false, sparks: false, smoke: true, dome: false, flash: 0.2, color: 0x553322 }); }
      if (alive && s.mesh.position.length() < radiusLocal(_v1) + 1) {
        const p = planet.localToWorld(s.mesh.position.clone());
        impact(p, 3);
        boom(p, 2, { big: true, ground: true, color: 0xff7a30, hot: 0xffe0a0, spark: 0xffd090 });
        sfx.explode(p, 2);
        s.wreck = null; s.mesh.visible = false; s.respawn = rand(8, 15);
      } else if (!alive && s.mesh.position.length() < 30) { s.wreck = null; s.mesh.visible = false; s.respawn = 10; }
    } else {
      s.respawn -= dt;
      if (s.respawn <= 0 && alive) spawnShip(s);
    }
  }
  stats.ships = n;
}
// trafienie statku pociskiem (pozycja w świecie). Zwraca true, jeśli trafiono.
export function hitShips(posWorld, r) {
  for (const s of ships) {
    if (!s.alive) continue;
    s.mesh.getWorldPosition(_v1);
    if (_v1.distanceTo(posWorld) < s.radius + r) {
      s.alive = false;
      boom(_v1.clone(), 1.6, { big: true, color: 0xff8a30, hot: 0xffffff, spark: 0xffd090 });
      sfx.explode(_v1, 2);
      _sf.crossVectors(s.axis, s.mesh.position).normalize().multiplyScalar(Math.sign(s.speed) * (R0 + s.alt) * Math.abs(s.speed) * 0.4);
      s.wreck = { vel: _sf.clone().addScaledVector(_v2.copy(s.mesh.position).normalize(), -6), smoke: 0 };
      stats.destroyed++;
      return true;
    }
  }
  return false;
}
// najbliższy statek w stożku przed pociskiem (do naprowadzania kul)
export function nearestShip(pos, dir, cosMax, out) {
  let best = null, bd = Infinity;
  for (const s of ships) {
    if (!s.alive) continue;
    s.mesh.getWorldPosition(_v1);
    _v2.subVectors(_v1, pos);
    const d = _v2.length();
    if (d < 1 || d > 400 || _v2.dot(dir) / d < cosMax) continue;
    if (d < bd) { bd = d; best = out.copy(_v1); }
  }
  return best;
}
// cele do wspomagania celowania
export function aimTargets(out) {
  out.length = 0;
  for (const s of ships) if (s.alive) out.push(s.mesh.getWorldPosition(new THREE.Vector3()));
  return out;
}

// ---------------------------------------------------------------------------
// Ludzie: spacer po planecie, ucieczka przed wybuchami, wyrzucanie w powietrze
// ---------------------------------------------------------------------------
const _pq = new THREE.Quaternion(), _pm = new THREE.Matrix4(), _pf = new THREE.Vector3();
function updatePeople(dt, t) {
  let alivePeople = 0;
  for (const p of items.people) {
    if (p.state === 'walk') {
      alivePeople++;
      const sp = p.speed * (p.panic > 0 ? 3.2 : 1);
      p.panic = Math.max(0, p.panic - dt);
      p.d.addScaledVector(p.h, sp * dt / R0).normalize();
      p.h.addScaledVector(p.d, -p.h.dot(p.d)).normalize();
      if (Math.random() < dt * 0.4) p.h.applyAxisAngle(p.d, rand(-0.8, 0.8));
      if (baseH(p.d) + craterSum(p.d) < -0.6) p.h.negate();       // nie wchodź do wody
      const r = radiusLocal(p.d);
      _pf.copy(p.h);
      _m.lookAt(_v1.set(0, 0, 0), _pf, p.d);
      _pq.setFromRotationMatrix(_m);
      const bob = Math.abs(Math.sin(t * (p.panic > 0 ? 14 : 8) + p.phase)) * 0.08;
      _pm.compose(_v2.copy(p.d).multiplyScalar(r - 0.05 + bob), _pq, _s.set(1, 1, 1));
      people.setMatrixAt(p.i, _pm);
    } else if (p.state === 'fly') {
      p.t += dt;
      _v1.copy(p.pos).normalize();
      p.vel.addScaledVector(_v1, -9.8 * dt);
      p.pos.addScaledVector(p.vel, dt);
      _pq.setFromEuler(new THREE.Euler(p.spin.x * p.t, p.spin.y * p.t, p.spin.z * p.t));
      _pm.compose(p.pos, _pq, _s.set(1, 1, 1));
      people.setMatrixAt(p.i, _pm);
      if (alive && p.t > 0.3 && p.pos.length() < radiusLocal(_v1) + 0.2) { p.state = 'dead'; p.t = 0; }
      if (p.t > 12) { p.state = 'dead'; p.t = 0; }
    } else if (p.state === 'dead') {
      p.t += dt;
      if (p.t > 3) { p.state = 'gone'; p.t = 0; people.setMatrixAt(p.i, ZERO); }
    } else if (p.state === 'gone') {
      // po chwili z domów wychodzą nowi mieszkańcy
      p.t += dt;
      if (p.t > 25 && alive) {
        const d = randLandDir(0.3, 7, p.home, 0.1);
        if (d) { p.d.copy(d); p.state = 'walk'; p.panic = 0; }
      }
    }
  }
  people.instanceMatrix.needsUpdate = true;
  stats.people = alivePeople;
}

// ---------------------------------------------------------------------------
// Zniszczenie planety (w pełni naładowana wielka kula)
// ---------------------------------------------------------------------------
const DS = { on: false, t: 0, chunks: [], core: null, ring: null, cracks: null, point: new THREE.Vector3() };
const coreMat = new THREE.MeshBasicMaterial({ color: 0xffd090, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const ringMat = new THREE.MeshBasicMaterial({ color: 0xffc080, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
export function isAlive() { return alive; }
export function destroyPlanet(pointWorld) {
  if (!alive || DS.on) return;
  DS.on = true; DS.t = 0; DS.burst = false;
  DS.point.copy(pointWorld);
  // świecące pęknięcia po powierzchni
  const segs = [];
  for (let k = 0; k < 34; k++) {
    let d = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
    const axis = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
    for (let j = 0; j < 14; j++) {
      const n = d.clone().applyAxisAngle(axis, rand(0.04, 0.09)).applyAxisAngle(d, rand(-0.3, 0.3)).normalize();
      for (const off of [0.6, 1.0, 1.4]) segs.push(...d.clone().multiplyScalar(Math.max(radiusLocal(d), SEA) + off).toArray(), ...n.clone().multiplyScalar(Math.max(radiusLocal(n), SEA) + off).toArray());
      d = n;
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
  DS.cracks = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffb050, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: false, fog: false }));
  planet.add(DS.cracks);
  sfx.transform(3);
}
function burst() {
  DS.burst = true;
  alive = false;
  for (const o of [surface, ocean, atmo, houses, roofs, towers, trunks, crowns, people, DS.cracks]) o.visible = false;
  for (const L of lev) planet.remove(L.m);
  lev.length = 0;
  const center = planet.position.clone();
  boom(center.clone().addScaledVector(_v1.subVectors(DS.point, center).normalize(), R0 * 0.6), 22, { big: true, color: 0xff8030, hot: 0xffffff, spark: 0xffd090 });
  sfx.explode(DS.point, 8); sfx.explode(center, 8);
  // odłamki planety
  const chunkMat = [new THREE.MeshLambertMaterial({ color: 0x6a5a48, emissive: 0x401000, flatShading: true }),
    new THREE.MeshLambertMaterial({ color: 0x4a7a38, emissive: 0x301000, flatShading: true }),
    new THREE.MeshLambertMaterial({ color: 0x3a3030, emissive: 0x802000, flatShading: true })];
  const geoC = new THREE.DodecahedronGeometry(1, 1);
  for (let k = 0; k < 70; k++) {
    const d = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
    const m = new THREE.Mesh(geoC, chunkMat[k % 3]);
    const s = rand(5, 22);
    m.scale.set(s, s * rand(0.5, 1), s * rand(0.6, 1));
    m.position.copy(center).addScaledVector(d, R0 * rand(0.35, 0.9));
    scene.add(m);
    DS.chunks.push({ m, vel: d.multiplyScalar(rand(12, 55)), spin: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(0.8) });
  }
  DS.core = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), coreMat);
  DS.core.position.copy(center); scene.add(DS.core);
  DS.ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 160), ringMat);
  DS.ring.position.copy(center);
  DS.ring.lookAt(_v1.copy(center).add(new THREE.Vector3(rand(-0.3, 0.3), 1, rand(-0.3, 0.3)).normalize()));
  scene.add(DS.ring);
  // statki też lecą
  for (const s of ships) if (s.alive) { s.alive = false; s.mesh.visible = false; s.respawn = 999; }
}
function regenerate() {
  for (const c of DS.chunks) scene.remove(c.m);
  DS.chunks.length = 0;
  if (DS.core) scene.remove(DS.core);
  if (DS.ring) scene.remove(DS.ring);
  if (DS.cracks) { planet.remove(DS.cracks); DS.cracks.geometry.dispose(); }
  DS.on = false;
  craters.length = 0;
  for (const d of debris) planet.remove(d.m);
  debris.length = 0;
  buildSurface();
  populate();
  initShips();
  alive = true;
  for (const o of [surface, ocean, atmo, houses, roofs, towers, trunks, crowns, people]) o.visible = true;
  planet.scale.setScalar(0.02);
  DS.grow = 0;
}
function updateDestruction(dt) {
  if (DS.grow !== undefined && DS.grow < 1) {
    DS.grow = Math.min(1, DS.grow + dt / 2.5);
    planet.scale.setScalar(Math.max(0.02, 1 - Math.pow(1 - DS.grow, 3)));
  }
  if (!DS.on) return;
  DS.t += dt;
  if (!DS.burst) {
    const k = Math.min(1, DS.t / 2.2);
    surfMat.emissive.setRGB(1, 0.35, 0.08).multiplyScalar(k * 0.8);
    ocean.material.emissive.setRGB(1, 0.3, 0.05).multiplyScalar(k * 0.9);
    atmo.material.uniforms.uColor.value.setRGB(0.43 + k * 0.57, 0.7 - k * 0.3, 1 - k * 0.8);
    DS.cracks.material.opacity = k;
    planet.position.copy(CENTER).add(_v1.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(k * 1.2));
    if (DS.t >= 2.2) { planet.position.copy(CENTER); surfMat.emissive.setRGB(0, 0, 0); ocean.material.emissive.setRGB(0, 0, 0); atmo.material.uniforms.uColor.value.setHex(0x6fb4ff); burst(); }
    return;
  }
  const bt = DS.t - 2.2;
  for (const c of DS.chunks) {
    c.m.position.addScaledVector(c.vel, dt);
    c.m.rotation.x += c.spin.x * dt; c.m.rotation.y += c.spin.y * dt;
    if (bt > 14) c.m.scale.multiplyScalar(Math.pow(0.2, dt));
  }
  const ce = 1 - Math.pow(1 - Math.min(1, bt / 2.5), 2);
  DS.core.scale.setScalar(20 + ce * 150);
  coreMat.opacity = Math.max(0, 1 - bt / 3);
  DS.ring.scale.setScalar(10 + bt * 260);
  ringMat.opacity = Math.max(0, 0.9 - bt / 9);
  if (bt > 17) regenerate();
}
export function destructionText() {
  if (!DS.on) return '';
  return DS.burst ? (DS.t - 2.2 > 12 ? 'Nowa planeta za chwilę…' : 'PLANETA ZNISZCZONA!') : 'Planeta pęka!';
}

// ---------------------------------------------------------------------------
// Obrót planety pod graczem: gracz zostaje "na górze". Zwraca kwaternion obrotu (do przeniesienia
// na obiekty w świecie: pociski, wybuchy) albo null.
// ---------------------------------------------------------------------------
const _rq = new THREE.Quaternion();
export function recenter(head) {
  if (!alive || DS.on) return null;
  _v1.subVectors(head, planet.position);
  if (_v1.lengthSq() < 1) return null;
  _v1.normalize();
  if (_v1.y > 0.99999) return null;
  _rq.setFromUnitVectors(_v1, Y);
  planet.quaternion.premultiply(_rq);
  return _rq;
}

export function updateWorld(dt) {
  const t = performance.now() / 1000;
  if (alive) { updatePeople(dt, t); }
  updateShips(dt);
  updateDebris(dt);
  updateDestruction(dt);
}
export function setWorldMode() {
  env.visible = true; planet.visible = true;
  scene.fog = null;
  scene.background = new THREE.Color(0x02030a);
}

// --- start: planeta z miasteczkiem dokładnie pod graczem ---
export function init() {
  buildSurface();
  populate();
  initShips();
  if (towns[0]) {
    _q.setFromUnitVectors(towns[0], Y);
    planet.quaternion.copy(_q);
  }
  setWorldMode();
}
