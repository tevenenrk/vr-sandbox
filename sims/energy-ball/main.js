// Kula Energii — symulator gestów dłoni (WebXR, Meta Quest)
//  • Złącz dłonie → kula się ładuje; pchnij dłonie do przodu → wystrzał.
//  • Ręce w dół + zaciśnięte pięści → aura mocy.
//  • Ręce w górę → nad głową rośnie wielka kula; zamach do przodu → rzut.
//  • Oba spusty (albo szczypnięcie obiema dłońmi) → lot w kierunku, w który celujesz.
//  • Uderzenia w ziemię zostawiają kratery.

import * as THREE from 'three';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

// ---------------------------------------------------------------------------
// Ustawienia gestów (metry / sekundy / m/s)
// ---------------------------------------------------------------------------
const CFG = {
  // mała kula (dłonie razem)
  chargeStartDist: 0.20,
  chargeHoldTime: 0.18,
  chargeKeepDist: 0.42,
  fizzleTime: 0.55,
  chargeTime: 2.5,
  minChargeToFire: 0.12,
  fireSpeedMid: 1.1,
  fireSpeedEach: 0.55,
  fireMaxHandDist: 0.5,
  aimAssistAngle: THREE.MathUtils.degToRad(12),
  // wielka kula (ręce w górę)
  giantAboveHead: 0.12,     // dłonie wyżej niż głowa + tyle
  giantHoldTime: 0.35,
  giantGrowRate: 0.55,      // m promienia na sekundę
  giantMaxRadius: 6,
  giantMinThrow: 0.6,
  giantThrowSpeed: 1.3,     // prędkość zamachu do przodu
  giantDropTime: 1.5,       // tyle można trzymać ręce opuszczone bez rzutu
  // aura (ręce w dół + pięści)
  auraBelowHead: 0.5,
  auraHoldTime: 0.3,
  auraBuildTime: 2.5,
  auraDecay: 0.05,          // na sekundę po zejściu z pozy
  fistDist: 0.11,           // średnia odległość czubków palców od nadgarstka
  // lot
  flySpeed: 7,
  flySpeedAura: 14,
  arenaRadius: 68,
};

// ---------------------------------------------------------------------------
// Renderer, scena, kamera, "rig" gracza (do latania)
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color(0xd9b48c);
const FOG_DENSITY = 0.009;
scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

const rig = new THREE.Group();
scene.add(rig);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.02, 1200);
rig.add(camera);
const desk = { yaw: 0, pitch: -0.05 };
function applyDesktopCamera() {
  camera.position.set(0, 1.6, 0);
  camera.rotation.set(desk.pitch, desk.yaw, 0, 'YXZ');
}
applyDesktopCamera();

let xrMode = null; // null | 'vr' | 'ar'
const clock = new THREE.Clock();
const UP = new THREE.Vector3(0, 1, 0);

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();

function randomDir(out) {
  const u = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(a), u, s * Math.sin(a));
}
const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------
// Tekstury i materiały efektów
// ---------------------------------------------------------------------------
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
const glowTex = makeGlowTexture();

const ballMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 }, uPower: { value: 0 }, uOpacity: { value: 1 },
    uCore: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() },
  },
  vertexShader: /* glsl */`
    uniform float uTime; uniform float uPower;
    varying vec3 vN; varying vec3 vV; varying vec3 vP;
    void main() {
      vP = position;
      vec3 p = position;
      float w = sin(p.x*10.0 + uTime*7.0) * sin(p.y*11.0 - uTime*6.0) * sin(p.z*9.0 + uTime*8.0);
      p += normal * w * (0.04 + uPower*0.05);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    uniform float uTime; uniform float uPower; uniform float uOpacity;
    uniform vec3 uCore; uniform vec3 uEdge;
    varying vec3 vN; varying vec3 vV; varying vec3 vP;
    void main() {
      float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
      float fres = pow(f, 1.4);
      float s1 = sin(vP.x*14.0 + uTime*9.0 + sin(vP.y*12.0 - uTime*5.0)*2.0)*0.5 + 0.5;
      float s2 = sin(vP.z*16.0 - uTime*11.0 + sin(vP.x*10.0 + uTime*4.0)*2.0)*0.5 + 0.5;
      float s = s1 * s2;
      vec3 col = mix(uCore, uEdge, fres);
      col += uEdge * s * (0.5 + uPower*0.5);
      col *= 1.0 + uPower*0.5;
      float a = clamp((0.45 + fres*0.55 + s*0.3) * uOpacity, 0.0, 1.0);
      gl_FragColor = vec4(col, a);
    }`,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

const beamMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 }, uOpacity: { value: 1 }, uLen: { value: 1 },
    uCore: { value: new THREE.Color(0xeafcff) }, uEdge: { value: new THREE.Color(0x3fb4ff) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main() {
      vUv = uv;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    uniform float uTime; uniform float uOpacity; uniform float uLen;
    uniform vec3 uCore; uniform vec3 uEdge;
    varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main() {
      float facing = abs(dot(normalize(vN), normalize(vV)));
      float core = pow(facing, 2.5);
      float along = vUv.y * uLen;
      float n1 = sin(along*5.0 - uTime*32.0 + vUv.x*6.2831*2.0)*0.5 + 0.5;
      float n2 = sin(along*2.1 - uTime*19.0 - vUv.x*6.2831*3.0)*0.5 + 0.5;
      vec3 col = mix(uEdge, uCore, core) + uEdge * n1 * n2 * 0.6;
      float tail = smoothstep(0.0, min(0.35, 0.8 / max(uLen, 0.01)), vUv.y);
      float a = clamp((0.15 + 0.85*facing + n1*n2*0.2) * uOpacity * tail, 0.0, 1.0);
      gl_FragColor = vec4(col, a);
    }`,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

const sphereGeo = new THREE.SphereGeometry(1, 32, 20);
const coreGeo = new THREE.SphereGeometry(1, 16, 12);
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
beamGeo.rotateX(Math.PI / 2);
beamGeo.translate(0, 0, 0.5);

// ---------------------------------------------------------------------------
// Teren pustynnej areny (wysokości w siatce — można w nim robić kratery)
// ---------------------------------------------------------------------------
const TER = { size: 160, segs: 192 };
TER.n = TER.segs + 1;
TER.step = TER.size / TER.segs;
TER.half = TER.size / 2;
TER.h = new Float32Array(TER.n * TER.n);

function baseHeight(x, z) {
  const r = Math.hypot(x, z);
  const dunes = Math.sin(x * 0.08 + Math.sin(z * 0.05) * 2) * 1.3 + Math.sin(z * 0.11 + x * 0.03) * 0.9 + Math.sin((x + z) * 0.21) * 0.3;
  let h = dunes * smooth(16, 38, r) * (1 + 1.5 * smooth(40, 62, r));
  const ang = Math.atan2(z, x);
  h += smooth(60, 76, r) * (16 + 5 * Math.sin(ang * 5) + 3 * Math.sin(ang * 13));
  h += Math.sin(x * 0.7) * Math.sin(z * 0.6) * 0.06; // drobne zmarszczki piasku
  return h;
}

const terrainGeo = new THREE.PlaneGeometry(TER.size, TER.size, TER.segs, TER.segs);
terrainGeo.rotateX(-Math.PI / 2);
{
  // po obrocie: indeks = iz*n + ix, x = ix*step - half, z = iz*step - half
  const pos = terrainGeo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0xe0b47e), sandDark = new THREE.Color(0xc4935c), rock = new THREE.Color(0xa65f3c);
  const c = new THREE.Color();
  for (let iz = 0; iz < TER.n; iz++) {
    for (let ix = 0; ix < TER.n; ix++) {
      const i = iz * TER.n + ix;
      const x = ix * TER.step - TER.half, z = iz * TER.step - TER.half;
      pos.setX(i, x); pos.setZ(i, z);
      const h = baseHeight(x, z);
      TER.h[i] = h;
      pos.setY(i, h);
      const r = Math.hypot(x, z);
      c.copy(sand).lerp(sandDark, 0.5 + 0.5 * Math.sin(x * 0.3 + Math.sin(z * 0.2) * 3));
      c.lerp(rock, smooth(58, 70, r) * (0.6 + 0.4 * Math.sin(h * 1.7)));
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

// wysokość terenu w dowolnym punkcie (interpolacja dwuliniowa)
function heightAt(x, z) {
  if (xrMode === 'ar') return 0;
  const fx = (x + TER.half) / TER.step, fz = (z + TER.half) / TER.step;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const a = hIdx(ix, iz), b = hIdx(ix + 1, iz), c = hIdx(ix, iz + 1), d = hIdx(ix + 1, iz + 1);
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

const SCORCH = new THREE.Color(0x3a2a20), GLASS = new THREE.Color(0x1a1412), RIM = new THREE.Color(0xf0c58e);
function makeCrater(cx, cz, R) {
  if (xrMode === 'ar') return;
  const depth = R * 0.42;
  const ext = R * 1.6;
  const ix0 = Math.floor((cx - ext + TER.half) / TER.step), ix1 = Math.ceil((cx + ext + TER.half) / TER.step);
  const iz0 = Math.floor((cz - ext + TER.half) / TER.step), iz1 = Math.ceil((cz + ext + TER.half) / TER.step);
  const pos = terrainGeo.attributes.position, col = terrainGeo.attributes.color;
  const c = new THREE.Color();
  for (let iz = Math.max(0, iz0); iz <= Math.min(TER.segs, iz1); iz++) {
    for (let ix = Math.max(0, ix0); ix <= Math.min(TER.segs, ix1); ix++) {
      const i = iz * TER.n + ix;
      const x = ix * TER.step - TER.half, z = iz * TER.step - TER.half;
      const d = Math.hypot(x - cx, z - cz) / R;
      if (d > 1.6) continue;
      let delta = 0;
      if (d < 1) delta -= depth * (1 - d * d);
      delta += depth * 0.32 * Math.exp(-Math.pow((d - 1) / 0.22, 2)); // wał wokół krateru
      TER.h[i] = Math.max(-25, TER.h[i] + delta);
      pos.setY(i, TER.h[i]);
      // kolory: osmalone dno, jaśniejszy wał
      c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
      if (d < 1.15) c.lerp(d < 0.45 ? GLASS : SCORCH, (1 - d / 1.15) * 0.85);
      else c.lerp(RIM, 0.25 * (1 - (d - 1.15) / 0.45));
      col.setXYZ(i, c.r, c.g, c.b);
    }
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
  updateNormals(ix0 - 1, iz0 - 1, ix1 + 1, iz1 + 1);
  // kamienie leżące w zasięgu krateru opadają na nowy teren
  for (const r of decoRocks) {
    if (Math.hypot(r.position.x - cx, r.position.z - cz) < R * 1.6) r.position.y = heightAt(r.position.x, r.position.z) + r.userData.lift;
  }
}

// ---------------------------------------------------------------------------
// Otoczenie (VR): niebo, teren, mesy, skały
// ---------------------------------------------------------------------------
const env = new THREE.Group();
scene.add(env);
const mesas = [];
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
        vec3 sunDir = normalize(vec3(0.5, 0.35, -0.8));
        float sd = max(dot(vDir, sunDir), 0.0);
        col += vec3(1.0, 0.85, 0.6) * pow(sd, 12.0) * 0.5 + vec3(1.0) * pow(sd, 900.0) * 3.0;
        if (h < 0.0) col = horizon * 0.85;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  env.add(sky);

  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  env.add(terrain);

  // pas piasku poza areną aż po horyzont
  const outer = new THREE.Mesh(new THREE.RingGeometry(78, 480, 48, 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xc89a66 }));
  outer.position.y = 14;
  env.add(outer);

  const pad = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.6, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xff8a3c, transparent: true, opacity: 0.6 }));
  pad.position.y = 0.02;
  env.add(pad);

  // mesy (płaskie skalne wieże) — można wokół nich latać
  const mesaMat = new THREE.MeshLambertMaterial({ color: 0xb2643c, flatShading: true });
  const mesaTop = new THREE.MeshLambertMaterial({ color: 0xc98a5a, flatShading: true });
  const spots = [[28, -30, 5, 14], [-34, -22, 6, 18], [40, 14, 4, 11], [-20, 38, 5.5, 16], [10, 46, 3.5, 9], [-44, 8, 3, 8], [6, -50, 4.5, 20]];
  for (const [x, z, r, h] of spots) {
    const base = baseHeight(x, z) - 1;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r * 1.15, h, 9, 3), mesaMat);
    body.position.set(x, base + h / 2, z);
    body.rotation.y = Math.random() * 3;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.85, 0.8, 9), mesaTop);
    top.position.set(x, base + h + 0.4, z);
    top.rotation.y = body.rotation.y;
    env.add(body, top);
    mesas.push({ x, z, r: r * 1.0, top: base + h + 0.8 });
  }
  // rozrzucone kamienie
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x9c6a48, flatShading: true });
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, d = 12 + Math.random() * 48;
    const x = Math.sin(a) * d, z = Math.cos(a) * d;
    const s = 0.3 + Math.random() * 1.2;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), rockMat);
    rock.position.set(x, baseHeight(x, z) + s * 0.3, z);
    rock.scale.set(s * (0.7 + Math.random()), s * (0.5 + Math.random()), s * (0.7 + Math.random()));
    rock.rotation.set(Math.random(), Math.random() * 3, Math.random());
    rock.userData.lift = s * 0.3;
    decoRocks.push(rock);
    env.add(rock);
  }

  env.add(new THREE.HemisphereLight(0xbfd9ff, 0xb07a4a, 1.3));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
  sun.position.set(50, 35, -80);
  env.add(sun);
}
const arLight = new THREE.HemisphereLight(0xffffff, 0x444466, 1.6);
arLight.visible = false;
scene.add(arLight);

function mesaHit(pos, r) {
  if (xrMode === 'ar') return false;
  for (const m of mesas) {
    if (pos.y - r < m.top && Math.hypot(pos.x - m.x, pos.z - m.z) < m.r + r) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Kula energii (mała i wielka — różne parametry)
// ---------------------------------------------------------------------------
const ARCS = 4, ARC_PTS = 9;
const KAME_STYLE = { core: 0xeafcff, edge: 0x3fb4ff, glow: 0x3aa8ff, particles: 140, gatherMin: 0.1, gatherMax: 0.35, pSpeed: 1, pSize: 0.012, swirl: 2.5, glowScale: 5.5 };
const GIANT_STYLE = { core: 0xffffff, edge: 0x7fd4ff, glow: 0x6cc4ff, particles: 260, gatherMin: 3, gatherMax: 16, pSpeed: 9, pSize: 0.12, swirl: 0.5, glowScale: 3.2 };

class EnergyBall {
  constructor(style = KAME_STYLE) {
    const o = this.o = style;
    this.group = new THREE.Group();
    this.radius = 0.02;
    this.power = 0;
    this.opacity = 1;
    this.gathering = true;
    this.arcTimer = 0;

    this.mat = ballMaterial.clone();
    this.mat.uniforms.uCore.value.setHex(o.core);
    this.mat.uniforms.uEdge.value.setHex(o.edge);
    this.shell = new THREE.Mesh(sphereGeo, this.mat);
    this.shell.renderOrder = 2;
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, fog: false });
    this.core = new THREE.Mesh(coreGeo, this.coreMat);
    this.core.renderOrder = 1;
    this.glowMat = new THREE.SpriteMaterial({ map: glowTex, color: o.glow, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    this.glow = new THREE.Sprite(this.glowMat);
    this.glow2Mat = new THREE.SpriteMaterial({ map: glowTex, color: 0xd8f6ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    this.glow2 = new THREE.Sprite(this.glow2Mat);
    this.glow.renderOrder = 3; this.glow2.renderOrder = 3;

    this.pn = o.particles;
    this.pPos = new Float32Array(this.pn * 3);
    this.pSpeed = new Float32Array(this.pn);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pMat = new THREE.PointsMaterial({ map: glowTex, color: 0x9fe6ff, size: o.pSize, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false });
    this.points = new THREE.Points(pg, this.pMat);
    this.points.frustumCulled = false;
    for (let i = 0; i < this.pn; i++) this.respawnParticle(i);

    this.arcMat = new THREE.LineBasicMaterial({ color: 0xcff4ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.arcs = [];
    for (let i = 0; i < ARCS; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_PTS * 3), 3));
      const l = new THREE.Line(g, this.arcMat);
      l.frustumCulled = false;
      this.arcs.push(l);
      this.group.add(l);
    }
    this.group.add(this.core, this.shell, this.glow, this.glow2, this.points);
    scene.add(this.group);
  }

  respawnParticle(i) {
    const o = this.o;
    randomDir(_v1).multiplyScalar(this.radius + o.gatherMin + Math.random() * (o.gatherMax - o.gatherMin));
    this.pPos[i * 3] = _v1.x; this.pPos[i * 3 + 1] = _v1.y; this.pPos[i * 3 + 2] = _v1.z;
    this.pSpeed[i] = o.pSpeed * (0.25 + Math.random() * 0.5);
  }

  regenArcs() {
    const r = this.radius;
    for (const l of this.arcs) {
      l.visible = Math.random() < 0.3 + this.power;
      if (!l.visible) continue;
      const pos = l.geometry.attributes.position.array;
      const a = randomDir(_v1).clone();
      const b = randomDir(_v2).lerp(a, 0.35).normalize();
      for (let k = 0; k < ARC_PTS; k++) {
        const t = k / (ARC_PTS - 1);
        _v3.copy(a).lerp(b, t).normalize().multiplyScalar(r * (1.0 + Math.sin(t * Math.PI) * (0.5 + this.power * 0.6)));
        if (k > 0 && k < ARC_PTS - 1) {
          _v3.x += (Math.random() - 0.5) * r * 0.35;
          _v3.y += (Math.random() - 0.5) * r * 0.35;
          _v3.z += (Math.random() - 0.5) * r * 0.35;
        }
        pos[k * 3] = _v3.x; pos[k * 3 + 1] = _v3.y; pos[k * 3 + 2] = _v3.z;
      }
      l.geometry.attributes.position.needsUpdate = true;
    }
  }

  update(dt, t) {
    const r = this.radius, o = this.o;
    const pulse = 1 + Math.sin(t * (14 + this.power * 16)) * (0.04 + this.power * 0.06);
    this.shell.scale.setScalar(r * pulse);
    this.core.scale.setScalar(r * 0.55);
    this.glow.scale.setScalar(r * (o.glowScale + this.power * 3) * pulse);
    this.glow2.scale.setScalar(r * 2.4);
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uPower.value = this.power;
    this.mat.uniforms.uOpacity.value = this.opacity;
    this.coreMat.opacity = this.opacity;
    this.glowMat.opacity = this.opacity * (0.75 + this.power * 0.25);
    this.glow2Mat.opacity = this.opacity * 0.9;
    this.arcMat.opacity = this.opacity * 0.9;

    this.points.visible = this.gathering && this.opacity > 0.05;
    if (this.points.visible) {
      for (let i = 0; i < this.pn; i++) {
        const ix = i * 3;
        _v1.set(this.pPos[ix], this.pPos[ix + 1], this.pPos[ix + 2]);
        const d = _v1.length();
        if (d < r * 0.9) { this.respawnParticle(i); continue; }
        const inward = this.pSpeed[i] * (1 + this.power * 1.5) * dt;
        _v2.copy(_v1).multiplyScalar(-inward / d);
        _v3.set(-_v1.z, 0, _v1.x).multiplyScalar(o.swirl * dt);
        _v1.add(_v2).add(_v3);
        this.pPos[ix] = _v1.x; this.pPos[ix + 1] = _v1.y; this.pPos[ix + 2] = _v1.z;
      }
      this.points.geometry.attributes.position.needsUpdate = true;
      this.pMat.size = o.pSize * (1 + this.power);
      this.pMat.opacity = this.opacity;
    }
    this.arcTimer -= dt;
    if (this.arcTimer <= 0) { this.arcTimer = 0.045; this.regenArcs(); }
  }

  dispose() {
    scene.remove(this.group);
    this.mat.dispose(); this.coreMat.dispose(); this.glowMat.dispose(); this.glow2Mat.dispose();
    this.pMat.dispose(); this.points.geometry.dispose(); this.arcMat.dispose();
    for (const l of this.arcs) l.geometry.dispose();
  }
}

class Beam {
  constructor(radius, tail) {
    this.mat = beamMaterial.clone();
    this.mesh = new THREE.Mesh(beamGeo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.radius = radius;
    this.tail = tail.clone();
    this.head = tail.clone();
    this.opacity = 1;
    scene.add(this.mesh);
  }
  update(t) {
    const len = this.head.distanceTo(this.tail);
    this.mesh.visible = len > 0.01 && this.opacity > 0.01;
    if (!this.mesh.visible) return;
    this.mesh.position.copy(this.tail);
    this.mesh.lookAt(this.head);
    this.mesh.scale.set(this.radius, this.radius, len);
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uLen.value = len;
    this.mat.uniforms.uOpacity.value = this.opacity;
  }
  dispose() { scene.remove(this.mesh); this.mat.dispose(); }
}

// ---------------------------------------------------------------------------
// Wybuchy, pył, odłamki skał
// ---------------------------------------------------------------------------
const boomLight = new THREE.PointLight(0x9fdcff, 0, 0, 2);
scene.add(boomLight);
const ringGeo = new THREE.RingGeometry(0.8, 1, 64);

class Explosion {
  constructor(pos, size, { light = true, ground = false } = {}) {
    this.size = size;
    this.t = 0;
    this.life = ground ? 3.5 : 1.6;
    this.group = new THREE.Group();
    this.group.position.copy(pos);

    this.flashMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    this.flash = new THREE.Sprite(this.flashMat);
    this.cloudMat = new THREE.SpriteMaterial({ map: glowTex, color: 0x3aa8ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    this.cloud = new THREE.Sprite(this.cloudMat);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring2 = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring2.rotation.x = -Math.PI / 2;

    const n = Math.round(60 + Math.min(size, 6) * 80);
    this.n = n;
    this.sPos = new Float32Array(n * 3);
    this.sVel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      randomDir(_v1).multiplyScalar((1.5 + Math.random() * 5) * (0.4 + size));
      this.sVel[i * 3] = _v1.x; this.sVel[i * 3 + 1] = Math.abs(_v1.y) * (ground ? 1 : 0.5) + 1.2; this.sVel[i * 3 + 2] = _v1.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3));
    this.sMat = new THREE.PointsMaterial({ map: glowTex, color: 0xbff0ff, size: 0.06 + size * 0.05, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.sparks = new THREE.Points(g, this.sMat);
    this.sparks.frustumCulled = false;
    this.group.add(this.cloud, this.flash, this.ring, this.ring2, this.sparks);

    // chmura piasku przy uderzeniu w ziemię
    this.dust = [];
    if (ground) {
      for (let i = 0; i < 9; i++) {
        const m = new THREE.SpriteMaterial({ map: glowTex, color: 0xc9a27a, transparent: true, depthWrite: false, opacity: 0 });
        const s = new THREE.Sprite(m);
        const a = (i / 9) * Math.PI * 2;
        s.userData = { a, sp: 0.6 + Math.random() * 0.8, up: Math.random() };
        this.dust.push(s);
        this.group.add(s);
      }
    }
    scene.add(this.group);
    if (light) {
      boomLight.position.copy(pos);
      boomLight.intensity = 60 * size + 10;
    }
  }

  update(dt) {
    this.t += dt;
    const t = this.t, s = this.size;
    const e = 1 - Math.pow(1 - Math.min(1, t / 0.3), 3);
    this.flash.scale.setScalar(s * (0.5 + 3.5 * e));
    this.flashMat.opacity = Math.max(0, 0.9 - t / 0.45);
    this.cloud.scale.setScalar(s * (1 + 6 * e));
    this.cloudMat.opacity = Math.max(0, 0.9 - t / 1.1);
    this.ring.quaternion.copy(camera.getWorldQuaternion(_q));
    const rs = s * (0.3 + t * 9);
    this.ring.scale.setScalar(rs);
    this.ring2.scale.setScalar(rs * 1.3);
    this.ringMat.opacity = Math.max(0, 0.9 - t / 0.6);

    const p = this.sPos, v = this.sVel;
    const drag = Math.pow(0.35, dt);
    for (let i = 0; i < this.n * 3; i += 3) {
      v[i + 1] -= 5 * dt;
      v[i] *= drag; v[i + 1] *= drag; v[i + 2] *= drag;
      p[i] += v[i] * dt; p[i + 1] += v[i + 1] * dt; p[i + 2] += v[i + 2] * dt;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sMat.opacity = Math.max(0, 1 - t / 1.6);

    for (const d of this.dust) {
      const u = d.userData;
      const k = 1 - Math.exp(-t * 1.8);
      const rr = s * (0.6 + 2.6 * k * u.sp);
      d.position.set(Math.cos(u.a) * rr, s * (0.2 + k * (0.6 + u.up)), Math.sin(u.a) * rr);
      d.scale.setScalar(s * (1.5 + 3 * k));
      d.material.opacity = Math.min(1, t * 4) * Math.max(0, 0.75 * (1 - t / this.life));
    }
    return t < this.life;
  }

  dispose() {
    scene.remove(this.group);
    this.flashMat.dispose(); this.cloudMat.dispose(); this.ringMat.dispose();
    this.sMat.dispose(); this.sparks.geometry.dispose();
    for (const d of this.dust) d.material.dispose();
  }
}

const debris = [];
const debrisGeo = new THREE.DodecahedronGeometry(1, 0);
const debrisMat = new THREE.MeshLambertMaterial({ color: 0xa0764e, flatShading: true });
function spawnDebris(pos, R) {
  const n = Math.min(40, Math.round(8 + R * 5));
  const k = Math.sqrt(R);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(debrisGeo, debrisMat);
    const s = (0.06 + Math.random() * 0.2) * Math.min(3, 0.6 + R * 0.35);
    m.scale.set(s, s * (0.6 + Math.random() * 0.6), s);
    const a = Math.random() * Math.PI * 2;
    m.position.set(pos.x + Math.cos(a) * R * 0.4 * Math.random(), heightAt(pos.x, pos.z) + 0.2, pos.z + Math.sin(a) * R * 0.4 * Math.random());
    const out = (2 + Math.random() * 5) * k;
    const vel = new THREE.Vector3(Math.cos(a) * out, (3 + Math.random() * 7) * k * 0.8, Math.sin(a) * out);
    scene.add(m);
    debris.push({ m, vel, s, life: 6 + Math.random() * 3, resting: false, spin: Math.random() * 8 });
  }
  while (debris.length > 220) { const d = debris.shift(); scene.remove(d.m); }
}
function updateDebris(dt) {
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
    if (d.life < 1) d.m.position.y -= dt * d.s;
    if (d.life <= 0) { scene.remove(d.m); debris.splice(i, 1); }
  }
}

// ---------------------------------------------------------------------------
// Aura mocy wokół gracza
// ---------------------------------------------------------------------------
const AURA_PARTS = 260;
class Aura {
  constructor() {
    this.level = 0;
    this.powering = false;
    this.group = new THREE.Group();
    scene.add(this.group);

    const prof = [[0.16, 0], [0.42, 0.3], [0.62, 1.0], [0.6, 1.6], [0.42, 2.25], [0.0, 2.95]].map(([x, y]) => new THREE.Vector2(x, y));
    this.shellMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uColor: { value: new THREE.Color(0xffd34d) }, uHot: { value: new THREE.Color(0xfff6d0) } },
      vertexShader: /* glsl */`
        uniform float uTime;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          vUv = uv;
          vec3 p = position;
          float ang = uv.x * 6.2831;
          float w = sin(uTime*9.0 + p.y*5.0 + ang*5.0) * 0.08 + sin(uTime*14.0 - p.y*9.0 + ang*3.0) * 0.05;
          p.xz *= 1.0 + w * smoothstep(0.2, 2.5, p.y);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform float uLevel; uniform vec3 uColor; uniform vec3 uHot;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          float ang = vUv.x * 6.2831;
          float y = vUv.y;
          float f = sin(ang*9.0 + sin(y*5.0 - uTime*7.0)*1.6)*0.5 + 0.5;
          float f2 = sin(y*9.0 - uTime*15.0 + ang*3.0)*0.5 + 0.5;
          float streak = pow(f, 3.0) * (0.4 + 0.6*f2);
          float edge = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
          float hfade = smoothstep(0.0, 0.25, y) * (1.0 - smoothstep(0.65, 1.0, y));
          vec3 col = mix(uColor, uHot, streak);
          float a = clamp((streak*0.8 + edge*0.6) * hfade * uLevel * 0.7, 0.0, 1.0);
          gl_FragColor = vec4(col, a);
        }`,
      side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.shell = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), this.shellMat);
    this.shell.frustumCulled = false;
    this.group.add(this.shell);

    // iskry unoszące się w górę
    this.pd = [];
    this.pPos = new Float32Array(AURA_PARTS * 3);
    for (let i = 0; i < AURA_PARTS; i++) this.pd.push({ a: Math.random() * 6.283, r: 0.3 + Math.random() * 0.45, y: Math.random() * 2.9, sp: 1.5 + Math.random() * 2.5 });
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pMat = new THREE.PointsMaterial({ map: glowTex, color: 0xffe07a, size: 0.05, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.points = new THREE.Points(pg, this.pMat);
    this.points.frustumCulled = false;
    this.group.add(this.points);

    // wyładowania przy pełnej mocy
    this.boltMat = new THREE.LineBasicMaterial({ color: 0xfff4c0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.bolts = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(10 * 3), 3));
      const l = new THREE.Line(g, this.boltMat);
      l.frustumCulled = false;
      this.bolts.push(l);
      this.group.add(l);
    }
    this.boltT = 0;

    // kamyki unoszące się z ziemi podczas ładowania
    this.pebbles = [];
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(debrisGeo, debrisMat);
      m.scale.setScalar(0.03 + Math.random() * 0.05);
      m.userData = { a: Math.random() * 6.283, r: 0.8 + Math.random() * 1.2, t: Math.random() * 3, sp: 0.4 + Math.random() * 0.5 };
      m.visible = false;
      this.pebbles.push(m);
      scene.add(m);
    }

    this.light = new THREE.PointLight(0xffc040, 0, 0, 2);
    this.light.position.set(0, 1.2, 0);
    this.group.add(this.light);
  }

  update(dt, t, head) {
    const L = this.level;
    this.group.visible = L > 0.01;
    for (const p of this.pebbles) p.visible = false;
    if (!this.group.visible) { this.light.intensity = 0; return; }
    const feetY = head.y - 1.62;
    this.group.position.set(head.x, feetY, head.z);
    const boost = this.powering ? 1 : 0.55;
    this.shellMat.uniforms.uTime.value = t;
    this.shellMat.uniforms.uLevel.value = L * boost;
    this.shell.scale.set(1 + L * 0.25, 1 + L * 0.15, 1 + L * 0.25);

    for (let i = 0; i < AURA_PARTS; i++) {
      const p = this.pd[i];
      p.y += p.sp * dt * (0.6 + L);
      p.a += dt * 0.6;
      if (p.y > 2.9) { p.y = Math.random() * 0.3; p.a = Math.random() * 6.283; }
      const rr = p.r * (1 + L * 0.3) * (1 - p.y / 4);
      this.pPos[i * 3] = Math.cos(p.a) * rr;
      this.pPos[i * 3 + 1] = p.y;
      this.pPos[i * 3 + 2] = Math.sin(p.a) * rr;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.pMat.opacity = Math.min(1, L * 1.5) * boost;

    this.boltT -= dt;
    if (this.boltT <= 0) {
      this.boltT = 0.06;
      for (const b of this.bolts) {
        b.visible = L > 0.6 && Math.random() < (L - 0.5) * 1.2;
        if (!b.visible) continue;
        const arr = b.geometry.attributes.position.array;
        const a = Math.random() * 6.283, y0 = 0.4 + Math.random() * 1.2;
        for (let k = 0; k < 10; k++) {
          const rr = 0.5 + (Math.random() - 0.5) * 0.25;
          const aa = a + (Math.random() - 0.5) * 0.4;
          arr[k * 3] = Math.cos(aa) * rr; arr[k * 3 + 1] = y0 + k * 0.09; arr[k * 3 + 2] = Math.sin(aa) * rr;
        }
        b.geometry.attributes.position.needsUpdate = true;
      }
    }
    this.boltMat.opacity = L;

    // kamyki tylko przy ziemi i podczas ładowania
    const ground = heightAt(head.x, head.z);
    if (this.powering && feetY - ground < 1.5 && xrMode !== 'ar') {
      for (const p of this.pebbles) {
        const u = p.userData;
        u.t += dt * u.sp;
        if (u.t > 3) { u.t = 0; u.a = Math.random() * 6.283; }
        p.visible = true;
        p.position.set(head.x + Math.cos(u.a) * u.r, ground + u.t * 0.6 + Math.sin(t * 3 + u.a) * 0.05, head.z + Math.sin(u.a) * u.r);
        p.rotation.x += dt * 2; p.rotation.y += dt * 3;
      }
    }
    this.light.intensity = L * (this.powering ? 5 : 2.5);
  }
}
const aura = new Aura();

// ---------------------------------------------------------------------------
// Cele — unoszące się kryształy
// ---------------------------------------------------------------------------
const crystalGeo = new THREE.OctahedronGeometry(0.32, 0);
const crystalEdges = new THREE.EdgesGeometry(crystalGeo);
const shardGeo = new THREE.TetrahedronGeometry(0.07, 0);
const TARGET_COLORS = [0xff4fd8, 0x40e0ff, 0x6dff8a, 0xb18cff, 0xff6a5c];

class Target {
  constructor(i) {
    const color = new THREE.Color(TARGET_COLORS[i % TARGET_COLORS.length]);
    this.mat = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.25), emissive: color, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.2, flatShading: true });
    this.group = new THREE.Group();
    this.mesh = new THREE.Mesh(crystalGeo, this.mat);
    this.mesh.scale.set(1, 1.5, 1);
    const edges = new THREE.LineSegments(crystalEdges, new THREE.LineBasicMaterial({ color: color.clone().lerp(new THREE.Color(1, 1, 1), 0.6) }));
    edges.scale.setScalar(1.01);
    this.mesh.add(edges);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.45, depthWrite: false }));
    glow.scale.setScalar(1.6);
    this.group.add(this.mesh, glow);
    this.radius = 0.38;
    this.base = new THREE.Vector3();
    this.phase = Math.random() * 10;
    this.alive = true;
    this.respawn = 0;
    this.spawnAnim = 1;
    scene.add(this.group);
  }
  place(others) {
    for (let tries = 0; tries < 30; tries++) {
      const ar = xrMode === 'ar';
      if (ar) {
        const ang = (Math.random() * 2 - 1) * 0.85, dist = 2.5 + Math.random() * 4;
        this.base.set(Math.sin(ang) * dist, 0.9 + Math.random() * 2.2, -Math.cos(ang) * dist);
      } else {
        const ang = Math.random() * Math.PI * 2, dist = 7 + Math.random() * 40;
        const x = Math.sin(ang) * dist, z = -Math.cos(ang) * dist;
        this.base.set(x, heightAt(x, z) + 1.2 + Math.random() * 5, z);
      }
      if (!mesaHit(this.base, 1) && others.every(o => o === this || o.base.distanceTo(this.base) > 2)) break;
    }
    this.group.position.copy(this.base);
  }
  update(dt, t) {
    if (!this.alive) {
      this.respawn -= dt;
      if (this.respawn <= 0) { this.alive = true; this.spawnAnim = 0; this.place(targets); this.group.visible = true; }
      return;
    }
    this.spawnAnim = Math.min(1, this.spawnAnim + dt * 2);
    this.group.scale.setScalar(1 - Math.pow(1 - this.spawnAnim, 3));
    this.group.position.set(this.base.x, this.base.y + Math.sin(t * 1.3 + this.phase) * 0.15, this.base.z);
    this.mesh.rotation.y += dt * 0.8;
  }
  destroy(from) {
    this.alive = false;
    this.group.visible = false;
    this.respawn = 2.5 + Math.random() * 1.5;
    spawnShards(this.group.position, from, this.mat);
  }
}

const targets = [];
for (let i = 0; i < 14; i++) targets.push(new Target(i));
function placeAllTargets() { for (const t of targets) { t.alive = true; t.group.visible = true; t.spawnAnim = 0; t.place(targets); } }
placeAllTargets();

const shards = [];
function spawnShards(pos, from, mat) {
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(shardGeo, mat);
    m.position.copy(pos);
    randomDir(_v1);
    _v2.subVectors(pos, from).normalize();
    const vel = _v1.multiplyScalar(2 + Math.random() * 3).addScaledVector(_v2, 3).add(_v3.set(0, 2.5, 0)).clone();
    m.scale.setScalar(0.6 + Math.random() * 1.2);
    scene.add(m);
    shards.push({ m, vel, spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10), life: 2.2 + Math.random() });
  }
}
function updateShards(dt) {
  for (let i = shards.length - 1; i >= 0; i--) {
    const s = shards[i];
    s.life -= dt;
    s.vel.y -= 9.8 * dt;
    s.m.position.addScaledVector(s.vel, dt);
    const g = heightAt(s.m.position.x, s.m.position.z) + 0.04;
    if (s.m.position.y < g) { s.m.position.y = g; s.vel.y *= -0.35; s.vel.x *= 0.7; s.vel.z *= 0.7; }
    s.m.rotation.x += s.spin.x * dt; s.m.rotation.y += s.spin.y * dt;
    if (s.life < 0.5) s.m.scale.multiplyScalar(Math.pow(0.02, dt));
    if (s.life <= 0) { scene.remove(s.m); shards.splice(i, 1); }
  }
}

// ---------------------------------------------------------------------------
// Tablica z instrukcją i wynikiem (leci razem z graczem)
// ---------------------------------------------------------------------------
const stats = { hits: 0, shots: 0, best: 0, craters: 0 };
const panel = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 760;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.04),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  mesh.position.set(-1.6, 1.7, -2.2);
  mesh.lookAt(0, 1.6, 0);
  rig.add(mesh);
  let last = '';
  function draw(status) {
    const key = `${status}|${stats.hits}|${stats.shots}|${stats.best}|${stats.craters}`;
    if (key === last) return;
    last = key;
    ctx.clearRect(0, 0, 1024, 760);
    ctx.fillStyle = 'rgba(14,12,26,0.8)';
    ctx.strokeStyle = 'rgba(255,190,110,0.6)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(4, 4, 1016, 752, 36); else ctx.rect(4, 4, 1016, 752);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#9fe6ff';
    ctx.font = 'bold 60px system-ui, sans-serif';
    ctx.fillText('⚡ KULA ENERGII', 44, 88);
    ctx.fillStyle = '#e8f4ff';
    ctx.font = '34px system-ui, sans-serif';
    const lines = [
      '• Dłonie razem → kula, pchnij → strzał',
      '• Ręce w dół + pięści → aura mocy',
      '• Ręce w górę → wielka kula, zamach → rzut',
      '• Oba spusty / szczypnięcie → lot',
      '• Prawa gałka → obrót,  B/Y → powrót',
    ];
    lines.forEach((l, i) => ctx.fillText(l, 44, 160 + i * 50));
    ctx.fillStyle = '#ffcf7a';
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.fillText(`Trafienia: ${stats.hits}   Strzały: ${stats.shots}   Kratery: ${stats.craters}`, 44, 465);
    ctx.fillText(`Najmocniejszy strzał: ${Math.round(stats.best * 100)}%`, 44, 525);
    ctx.fillStyle = '#b8ffcf';
    ctx.font = '36px system-ui, sans-serif';
    ctx.fillText(status, 44, 620);
    // pasek aury
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(44, 660, 936, 30);
    ctx.fillStyle = '#ffd34d';
    ctx.fillRect(44, 660, 936 * aura.level, 30);
    ctx.fillStyle = '#1a1208';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillText('AURA', 54, 684);
    tex.needsUpdate = true;
  }
  return { mesh, draw };
})();

// ---------------------------------------------------------------------------
// Dźwięk (syntezowany — bez plików)
// ---------------------------------------------------------------------------
class Sfx {
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // wiatr podczas lotu
    const wn = this.noiseSrc(true);
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 500; this.windF.Q.value = 0.7;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    wn.connect(this.windF).connect(this.windG).connect(this.master);
    wn.start();
  }
  noiseSrc(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = loop;
    return s;
  }
  // ciągły dźwięk ładowania; p: zakresy częstotliwości/głośności dla poziomu 0..1
  hum(p) {
    if (!this.ctx) return null;
    const c = this.ctx, now = c.currentTime;
    const out = c.createGain(); out.gain.setValueAtTime(0, now);
    const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 6;
    const o1 = c.createOscillator(); o1.type = 'sawtooth';
    const o2 = c.createOscillator(); o2.type = 'sawtooth';
    const trem = c.createGain(); trem.gain.value = 0.7;
    const lfo = c.createOscillator();
    const lfoGain = c.createGain(); lfoGain.gain.value = 0.3;
    lfo.connect(lfoGain).connect(trem.gain);
    const nz = this.noiseSrc(true);
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 1.2;
    const ng = c.createGain(); ng.gain.value = p.noise ?? 0.15;
    o1.connect(filter); o2.connect(filter); nz.connect(nf).connect(ng).connect(filter);
    filter.connect(trem).connect(out).connect(this.master);
    o1.start(); o2.start(); lfo.start(); nz.start();
    const L = (a, b, k) => a + (b - a) * k;
    const h = {
      update(level, gain = 1) {
        const t = c.currentTime;
        o1.frequency.setTargetAtTime(L(p.f0, p.f1, level), t, 0.05);
        o2.frequency.setTargetAtTime(L(p.f0, p.f1, level) * 1.01, t, 0.05);
        filter.frequency.setTargetAtTime(L(p.c0, p.c1, level), t, 0.05);
        lfo.frequency.setTargetAtTime(L(p.l0, p.l1, level), t, 0.05);
        nf.frequency.setTargetAtTime(L(p.n0, p.n1, level), t, 0.05);
        out.gain.setTargetAtTime(L(p.g0, p.g1, level) * gain, t, 0.08);
      },
      stop(fast = false) {
        const t = c.currentTime, d = fast ? 0.03 : 0.2;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.linearRampToValueAtTime(0, t + d);
        for (const n of [o1, o2, lfo, nz]) n.stop(t + d + 0.05);
      },
    };
    h.update(0);
    return h;
  }
  spatial(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 3; p.rolloffFactor = 0.5;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(this.master);
    return p;
  }
  fire(level, deep = false) {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime;
    const dur = 0.9 + level * 0.8 + (deep ? 0.8 : 0);
    const nz = this.noiseSrc();
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(deep ? 1200 : 3500, now); bp.frequency.exponentialRampToValueAtTime(deep ? 120 : 350, now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.5 + level * 0.5, now + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    nz.connect(bp).connect(g).connect(this.master);
    nz.start(now); nz.stop(now + dur + 0.1);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(deep ? 90 : 160, now); o.frequency.exponentialRampToValueAtTime(deep ? 25 : 38, now + 0.7);
    const og = c.createGain();
    og.gain.setValueAtTime(0.6 + level * 0.4, now); og.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    o.connect(og).connect(this.master);
    o.start(now); o.stop(now + 0.85);
  }
  explode(pos, size) {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime;
    const out = this.spatial(pos);
    const dur = 1.0 + Math.min(size, 8) * 0.5;
    const nz = this.noiseSrc();
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2500, now); lp.frequency.exponentialRampToValueAtTime(70, now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(1.4 * Math.min(2.5, 0.5 + size), now); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    nz.connect(lp).connect(g).connect(out);
    nz.start(now); nz.stop(now + dur + 0.1);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, now); o.frequency.exponentialRampToValueAtTime(22, now + dur * 0.8);
    const og = c.createGain();
    og.gain.setValueAtTime(1.0, now); og.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(og).connect(out);
    o.start(now); o.stop(now + dur + 0.05);
  }
  fizzle() {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime;
    const nz = this.noiseSrc();
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const g = c.createGain();
    g.gain.setValueAtTime(0.25, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    nz.connect(hp).connect(g).connect(this.master);
    nz.start(now); nz.stop(now + 0.45);
  }
  ding() {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime;
    for (const [f, v] of [[880, 0.12], [1320, 0.08], [1760, 0.05]]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(v, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      o.connect(g).connect(this.master); o.start(now); o.stop(now + 0.65);
    }
  }
  wind(speed) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windG.gain.setTargetAtTime(Math.min(0.35, speed / 14 * 0.3), t, 0.1);
    this.windF.frequency.setTargetAtTime(300 + speed * 70, t, 0.1);
  }
  updateListener(cam) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    cam.getWorldPosition(_v1);
    cam.getWorldDirection(_v2);
    _v3.set(0, 1, 0).applyQuaternion(cam.getWorldQuaternion(_q));
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(_v1.x, t); l.positionY.setValueAtTime(_v1.y, t); l.positionZ.setValueAtTime(_v1.z, t);
      l.forwardX.setValueAtTime(_v2.x, t); l.forwardY.setValueAtTime(_v2.y, t); l.forwardZ.setValueAtTime(_v2.z, t);
      l.upX.setValueAtTime(_v3.x, t); l.upY.setValueAtTime(_v3.y, t); l.upZ.setValueAtTime(_v3.z, t);
    } else if (l.setPosition) {
      l.setPosition(_v1.x, _v1.y, _v1.z);
      l.setOrientation(_v2.x, _v2.y, _v2.z, _v3.x, _v3.y, _v3.z);
    }
  }
}
const sfx = new Sfx();
const HUM_KAME = { f0: 70, f1: 220, c0: 400, c1: 3600, g0: 0.08, g1: 0.22, l0: 9, l1: 23, n0: 1800, n1: 4300 };
const HUM_GIANT = { f0: 38, f1: 95, c0: 220, c1: 1600, g0: 0.1, g1: 0.3, l0: 3, l1: 8, n0: 400, n1: 1400, noise: 0.35 };
const HUM_AURA = { f0: 45, f1: 70, c0: 300, c1: 1500, g0: 0.05, g1: 0.25, l0: 14, l1: 24, n0: 600, n1: 1300, noise: 0.5 };

// ---------------------------------------------------------------------------
// Wejście: dłonie (hand tracking) lub kontrolery
// ---------------------------------------------------------------------------
const handFactory = new XRHandModelFactory();
const controllerFactory = new XRControllerModelFactory();

function makeInput(i) {
  const controller = renderer.xr.getController(i);
  const grip = renderer.xr.getControllerGrip(i);
  const hand = renderer.xr.getHand(i);
  rig.add(controller, grip, hand);
  grip.add(controllerFactory.createControllerModel(grip));
  hand.add(handFactory.createHandModel(hand, 'mesh'));

  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x5cc8ff, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.5, depthWrite: false }));
  marker.scale.setScalar(0.05);
  marker.visible = false;
  scene.add(marker);

  const st = {
    controller, grip, hand, marker,
    connected: false, isHand: false, handedness: 'none', gamepad: null,
    selecting: false, squeezing: false, fist: false,
    pos: new THREE.Vector3(), normal: new THREE.Vector3(0, 0, -1), vel: new THREE.Vector3(),
    valid: false, hist: [], btnPrev: false, turnLatch: false,
  };
  controller.addEventListener('connected', (e) => {
    st.connected = true;
    st.isHand = !!e.data.hand;
    st.handedness = e.data.handedness;
    st.gamepad = e.data.gamepad || null;
    st.hist.length = 0;
  });
  controller.addEventListener('disconnected', () => {
    st.connected = false; st.valid = false; st.selecting = false; st.squeezing = false; st.hist.length = 0;
  });
  controller.addEventListener('selectstart', () => { st.selecting = true; });
  controller.addEventListener('selectend', () => { st.selecting = false; });
  controller.addEventListener('squeezestart', () => { st.squeezing = true; });
  controller.addEventListener('squeezeend', () => { st.squeezing = false; });
  return st;
}
const inputs = [makeInput(0), makeInput(1)];

const _w = new THREE.Vector3(), _m = new THREE.Vector3(), _im = new THREE.Vector3(), _pm = new THREE.Vector3(), _tip = new THREE.Vector3();
const TIPS = ['index-finger-tip', 'middle-finger-tip', 'ring-finger-tip'];
function updateInput(st, now) {
  st.valid = false;
  if (st.connected) {
    if (st.isHand) {
      const j = st.hand.joints;
      const w = j['wrist'], mid = j['middle-finger-phalanx-proximal'], im = j['index-finger-metacarpal'], pm = j['pinky-finger-metacarpal'];
      if (w && mid && im && pm && w.visible && mid.visible && st.hand.visible) {
        w.getWorldPosition(_w); mid.getWorldPosition(_m); im.getWorldPosition(_im); pm.getWorldPosition(_pm);
        // pięść = czubki palców blisko nadgarstka
        let sum = 0, cnt = 0;
        for (const n of TIPS) { if (j[n] && j[n].visible) { j[n].getWorldPosition(_tip); sum += _tip.distanceTo(_w); cnt++; } }
        st.fist = cnt > 0 && sum / cnt < CFG.fistDist;
        st.normal.crossVectors(_im.sub(_w), _pm.sub(_w)).normalize();
        if (st.handedness === 'left') st.normal.negate();
        st.pos.addVectors(_w, _m).multiplyScalar(0.5).addScaledVector(st.normal, 0.03);
        st.valid = true;
      }
    } else if (st.grip.visible) {
      st.grip.getWorldPosition(st.pos);
      st.normal.set(0, 0, -1).applyQuaternion(st.controller.getWorldQuaternion(_q));
      st.fist = st.squeezing;
      st.valid = true;
    }
  }
  if (st.valid) {
    st.hist.push({ t: now, p: st.pos.clone() });
    while (st.hist.length > 2 && now - st.hist[0].t > 0.1) st.hist.shift();
    const h0 = st.hist[0];
    const dt = now - h0.t;
    if (dt > 0.02) st.vel.subVectors(st.pos, h0.p).divideScalar(dt); else st.vel.set(0, 0, 0);
  } else {
    st.hist.length = 0;
    st.vel.set(0, 0, 0);
  }
  st.marker.visible = st.valid && st.isHand;
  st.marker.position.copy(st.pos);
}

function pulse(intensity, ms) {
  for (const st of inputs) {
    const a = st.gamepad && st.gamepad.hapticActuators && st.gamepad.hapticActuators[0];
    if (a && a.pulse) a.pulse(Math.min(1, intensity), ms).catch(() => {});
  }
}

// dane wspólne dla wszystkich gestów w danej klatce
const F = {
  both: false, d: Infinity, mid: new THREE.Vector3(), head: new THREE.Vector3(),
  fwd: new THREE.Vector3(), fwdFlat: new THREE.Vector3(), vm: new THREE.Vector3(),
  up: false, down: false,
};
function computeFrame() {
  camera.getWorldPosition(F.head);
  camera.getWorldDirection(F.fwd);
  F.fwdFlat.set(F.fwd.x, 0, F.fwd.z);
  if (F.fwdFlat.lengthSq() < 1e-4) F.fwdFlat.set(0, 0, -1);
  F.fwdFlat.normalize();
  const a = inputs[0], b = inputs[1];
  F.both = a.valid && b.valid;
  F.d = Infinity; F.up = false; F.down = false;
  if (F.both) {
    F.d = a.pos.distanceTo(b.pos);
    F.mid.addVectors(a.pos, b.pos).multiplyScalar(0.5);
    F.vm.addVectors(a.vel, b.vel).multiplyScalar(0.5);
    const hy = F.head.y;
    F.up = a.pos.y > hy + CFG.giantAboveHead && b.pos.y > hy + CFG.giantAboveHead;
    F.down = a.pos.y < hy - CFG.auraBelowHead && b.pos.y < hy - CFG.auraBelowHead && a.fist && b.fist && F.d > 0.2;
  } else F.vm.set(0, 0, 0);
}

// ---------------------------------------------------------------------------
// Gest 1: mała kula (dłonie razem → pchnięcie)
// ---------------------------------------------------------------------------
const G = { phase: 'idle', closeT: 0, apartT: 0, charge: 0, ball: null, cool: 0, fullDinged: false, hum: null };
const projectiles = [];
const beams = [];
const explosions = [];
const fading = [];
const ballLight = new THREE.PointLight(0x7fd0ff, 0, 0, 2);
scene.add(ballLight);

function ballRadius(charge) { return (0.035 + 0.15 * Math.pow(charge, 0.8)) * (1 + aura.level * 0.4); }

function startCharge(pos) {
  G.phase = 'charging';
  G.charge = 0; G.apartT = 0; G.fullDinged = false;
  G.ball = new EnergyBall(KAME_STYLE);
  G.ball.radius = 0.005;
  G.ball.group.position.copy(pos);
  G.hum = sfx.hum(HUM_KAME);
}
function stopHum(obj, fast) { if (obj.hum) { obj.hum.stop(fast); obj.hum = null; } }

function fizzleBall(obj) {
  if (obj.ball) {
    fading.push(obj.ball);
    explosions.push(new Explosion(obj.ball.group.position, Math.max(0.12, obj.ball.radius), { light: false }));
  }
  obj.ball = null;
  obj.phase = 'cooldown';
  obj.cool = 0;
  stopHum(obj);
  sfx.fizzle();
}

const _aim = new THREE.Vector3();
function aimAssist(dir, origin) {
  let best = null, bestAng = CFG.aimAssistAngle;
  for (const t of targets) {
    if (!t.alive) continue;
    _aim.subVectors(t.group.position, origin).normalize();
    const ang = Math.acos(THREE.MathUtils.clamp(_aim.dot(dir), -1, 1));
    if (ang < bestAng) { bestAng = ang; best = t; }
  }
  if (best) dir.lerp(_aim.subVectors(best.group.position, origin).normalize(), 0.75).normalize();
  return dir;
}

function fireKame(dir) {
  const ball = G.ball, charge = G.charge;
  G.ball = null; G.phase = 'cooldown'; G.cool = 0;
  stopHum(G, true);
  if (!ball) return;
  const origin = ball.group.position.clone();
  aimAssist(dir, origin);
  ball.gathering = false;
  ball.power = Math.max(ball.power, 0.4);
  const speed = 9 + charge * 9;
  const beam = new Beam(ball.radius * 0.8, origin);
  const p = { kind: 'kame', ball, beam, vel: dir.clone().multiplyScalar(speed), speed, charge, age: 0, origin };
  projectiles.push(p);
  beams.push({ beam, proj: p, age: 0 });
  stats.shots++;
  stats.best = Math.max(stats.best, charge);
  sfx.fire(charge);
  pulse(0.6 + charge * 0.4, 150 + charge * 200);
}

function updateKame(dt) {
  const a = inputs[0], b = inputs[1];
  const near = F.both && F.d < CFG.chargeStartDist && !F.up;
  for (const st of inputs) st.marker.material.color.setHex(near ? 0xffffff : 0x5cc8ff);

  switch (G.phase) {
    case 'idle':
      if (near && GI.phase === 'idle') {
        G.closeT += dt;
        if (G.closeT > CFG.chargeHoldTime) startCharge(F.mid);
      } else G.closeT = 0;
      break;
    case 'charging': {
      const ball = G.ball;
      if (F.both && F.d < CFG.chargeKeepDist) {
        G.apartT = 0;
        G.charge = Math.min(1, G.charge + dt * (1 + aura.level) / CFG.chargeTime);
        ball.group.position.lerp(F.mid, 1 - Math.exp(-dt * 25));
        ball.radius = THREE.MathUtils.lerp(ball.radius, ballRadius(G.charge), 1 - Math.exp(-dt * 10));
        ball.power = G.charge;
        ball.opacity = 1;
        if (G.charge >= 1 && !G.fullDinged) { G.fullDinged = true; sfx.ding(); pulse(0.3, 60); }
      } else {
        G.apartT += dt;
        if (F.both) ball.group.position.lerp(F.mid, 1 - Math.exp(-dt * 10));
        ball.radius *= Math.pow(0.4, dt);
        ball.opacity = Math.max(0.2, 1 - G.apartT / CFG.fizzleTime);
      }
      if (G.hum) G.hum.update(G.charge, G.apartT > 0 ? 0.5 : 1);

      if (F.both && G.charge >= CFG.minChargeToFire && F.d < CFG.fireMaxHandDist) {
        _v1.copy(F.fwd); _v1.y *= 0.4; _v1.normalize();
        const vMid = F.vm.dot(_v1);
        const vMin = Math.min(a.vel.dot(_v1), b.vel.dot(_v1));
        if (vMid > CFG.fireSpeedMid && vMin > CFG.fireSpeedEach) {
          const dir = F.vm.clone().normalize().lerp(F.fwd, 0.3).normalize();
          _v2.addVectors(a.normal, b.normal);
          if (_v2.lengthSq() > 0.3) {
            _v2.normalize();
            if (_v2.dot(dir) > 0.4) dir.lerp(_v2, 0.25).normalize();
          }
          fireKame(dir);
          break;
        }
      }
      if (G.apartT > CFG.fizzleTime) fizzleBall(G);
      break;
    }
    case 'cooldown':
      G.cool += dt;
      if ((G.cool > 0.35 && (!F.both || F.d > 0.28)) || G.cool > 1.6) { G.phase = 'idle'; G.closeT = 0; }
      break;
  }
}

// ---------------------------------------------------------------------------
// Gest 2: wielka kula nad głową (ręce w górę → zamach)
// ---------------------------------------------------------------------------
const GI = { phase: 'idle', upT: 0, downT: 0, ball: null, cool: 0, hum: null };

function giantMax() { return CFG.giantMaxRadius * (1 + aura.level * 0.5); }
function giantTargetPos(out) {
  const r = GI.ball ? GI.ball.radius : 0.3;
  return out.copy(F.head).addScaledVector(F.fwdFlat, 0.4 + r * 0.3).addScaledVector(UP, 0.7 + r);
}
function startGiant() {
  GI.phase = 'charging';
  GI.downT = 0;
  GI.ball = new EnergyBall(GIANT_STYLE);
  GI.ball.radius = 0.15;
  giantTargetPos(GI.ball.group.position);
  GI.hum = sfx.hum(HUM_GIANT);
}
function growGiant(dt) {
  const ball = GI.ball;
  const max = giantMax();
  ball.radius = Math.min(max, ball.radius + dt * CFG.giantGrowRate * (1 + aura.level) * (0.6 + ball.radius * 0.25));
  ball.power = ball.radius / max;
  ball.group.position.lerp(giantTargetPos(_v3), 1 - Math.exp(-dt * 4));
  if (GI.hum) GI.hum.update(ball.power);
  if (Math.random() < dt * 4) pulse(0.15 + ball.power * 0.3, 40);
}
function throwGiant(dir) {
  const ball = GI.ball;
  GI.ball = null; GI.phase = 'cooldown'; GI.cool = 0;
  stopHum(GI, true);
  if (!ball) return;
  ball.gathering = false;
  const speed = 8 + aura.level * 4;
  const charge = ball.power;
  projectiles.push({ kind: 'giant', ball, beam: null, vel: dir.clone().multiplyScalar(speed), speed, charge, age: 0, origin: ball.group.position.clone() });
  stats.shots++;
  stats.best = Math.max(stats.best, charge);
  sfx.fire(1, true);
  pulse(1, 400);
}
function updateGiant(dt) {
  switch (GI.phase) {
    case 'idle':
      if (F.up && G.phase !== 'charging') {
        GI.upT += dt;
        if (GI.upT > CFG.giantHoldTime) startGiant();
      } else GI.upT = 0;
      break;
    case 'charging':
      if (F.up) { GI.downT = 0; growGiant(dt); }
      else {
        GI.downT += dt;
        GI.ball.group.position.lerp(giantTargetPos(_v3), 1 - Math.exp(-dt * 4));
        if (GI.hum) GI.hum.update(GI.ball.power, 0.6);
      }
      // zamach do przodu = rzut
      if (F.both && GI.ball.radius >= CFG.giantMinThrow && F.vm.dot(F.fwdFlat) > CFG.giantThrowSpeed && F.vm.y < 0.8) {
        _v1.copy(F.fwd);
        if (_v1.y > 0.2) _v1.y = 0.2; // nie rzucaj w niebo
        throwGiant(_v1.normalize());
        break;
      }
      if (GI.downT > CFG.giantDropTime) fizzleBall(GI);
      break;
    case 'cooldown':
      GI.cool += dt;
      if (GI.cool > 1 && !F.up) { GI.phase = 'idle'; GI.upT = 0; }
      break;
  }
}

// ---------------------------------------------------------------------------
// Gest 3: aura (ręce w dół + pięści)
// ---------------------------------------------------------------------------
const AU = { poseT: 0, hum: null };
function setPowering(on, dt) {
  aura.powering = on;
  if (on) {
    aura.level = Math.min(1, aura.level + dt / CFG.auraBuildTime);
    if (!AU.hum) AU.hum = sfx.hum(HUM_AURA);
    if (Math.random() < dt * 6) pulse(0.2 + aura.level * 0.4, 50);
  } else {
    aura.level = Math.max(0, aura.level - dt * CFG.auraDecay);
  }
  if (AU.hum) {
    if (on) AU.hum.update(aura.level);
    else { AU.hum.stop(); AU.hum = null; }
  }
}
function updateAuraPose(dt) {
  const pose = F.down && G.phase !== 'charging' && GI.phase !== 'charging';
  AU.poseT = pose ? AU.poseT + dt : 0;
  setPowering(AU.poseT > CFG.auraHoldTime, dt);
}

// ---------------------------------------------------------------------------
// Lot (oba spusty / szczypnięcie obiema dłońmi), obrót, powrót
// ---------------------------------------------------------------------------
const FLY = { speed: 0, dir: new THREE.Vector3(0, 0, -1) };
const _fd = new THREE.Vector3();
function moveRig(dt, wantFly, dirNow) {
  const target = wantFly ? CFG.flySpeed + (CFG.flySpeedAura - CFG.flySpeed) * aura.level : 0;
  FLY.speed += (target - FLY.speed) * (1 - Math.exp(-dt * (wantFly ? 2.5 : 4)));
  if (wantFly) FLY.dir.lerp(dirNow, 1 - Math.exp(-dt * 6)).normalize();
  if (FLY.speed > 0.01) {
    rig.position.addScaledVector(FLY.dir, FLY.speed * dt);
    // granice areny i ziemia
    const r = Math.hypot(rig.position.x, rig.position.z);
    if (r > CFG.arenaRadius) { rig.position.x *= CFG.arenaRadius / r; rig.position.z *= CFG.arenaRadius / r; }
    camera.getWorldPosition(_v1);
    const ground = heightAt(_v1.x, _v1.z);
    const headAbove = _v1.y - rig.position.y;
    if (_v1.y < ground + 0.4) rig.position.y = ground + 0.4 - headAbove;
    rig.position.y = Math.min(rig.position.y, 60);
  }
  sfx.wind(FLY.speed);
}
function updateFlightXR(dt) {
  if (xrMode === 'ar') { sfx.wind(0); return; }
  const want = inputs.every(s => s.connected && s.selecting);
  if (want) {
    _fd.set(0, 0, 0);
    for (const s of inputs) _fd.add(_v1.set(0, 0, -1).applyQuaternion(s.controller.getWorldQuaternion(_q)));
    if (_fd.lengthSq() < 0.01) camera.getWorldDirection(_fd);
    _fd.normalize();
  }
  moveRig(dt, want, _fd);

  for (const s of inputs) {
    const gp = s.gamepad;
    if (!gp || s.isHand) continue;
    // obrót prawą gałką co 30°
    if (s.handedness === 'right' && gp.axes.length >= 4) {
      const x = gp.axes[2];
      if (Math.abs(x) > 0.7 && !s.turnLatch) {
        s.turnLatch = true;
        const ang = x > 0 ? -Math.PI / 6 : Math.PI / 6;
        camera.getWorldPosition(_v1);
        rig.position.sub(_v1).applyAxisAngle(UP, ang).add(_v1);
        rig.rotateY(ang);
      } else if (Math.abs(x) < 0.3) s.turnLatch = false;
    }
    // B / Y — powrót na środek areny
    const pressed = (gp.buttons[5] && gp.buttons[5].pressed) || false;
    if (pressed && !s.btnPrev) { rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); FLY.speed = 0; }
    s.btnPrev = pressed;
  }
}

// ---------------------------------------------------------------------------
// Podgląd na komputerze
// ---------------------------------------------------------------------------
const keys = {};
const deskInput = { charging: false, giant: false };
function deskBallPos(out) {
  camera.getWorldDirection(_v1);
  camera.getWorldPosition(out);
  return out.addScaledVector(_v1, 0.6).add(_v2.set(0, -0.15, 0));
}
function deskStart() {
  if (renderer.xr.isPresenting || deskInput.charging) return;
  sfx.init();
  if (G.phase === 'cooldown') G.phase = 'idle';
  if (G.phase !== 'idle') return;
  deskInput.charging = true;
  startCharge(deskBallPos(_v3));
}
function deskRelease() {
  if (!deskInput.charging) return;
  deskInput.charging = false;
  if (G.phase !== 'charging') return;
  if (G.charge < CFG.minChargeToFire) { fizzleBall(G); return; }
  camera.getWorldDirection(_v1);
  fireKame(_v1.clone());
}
function deskGiantStart() {
  if (renderer.xr.isPresenting || deskInput.giant) return;
  sfx.init();
  if (GI.phase === 'cooldown') GI.phase = 'idle';
  if (GI.phase !== 'idle' || G.phase === 'charging') return;
  deskInput.giant = true;
  computeFrame();
  startGiant();
}
function deskGiantRelease() {
  if (!deskInput.giant) return;
  deskInput.giant = false;
  if (GI.phase !== 'charging') return;
  if (GI.ball.radius < CFG.giantMinThrow) { fizzleBall(GI); return; }
  camera.getWorldDirection(_v1);
  if (_v1.y > 0.2) _v1.y = 0.2;
  throwGiant(_v1.normalize());
}
function updateDesktop(dt) {
  computeFrame();
  if (deskInput.charging && G.phase === 'charging') {
    G.charge = Math.min(1, G.charge + dt * (1 + aura.level) / CFG.chargeTime);
    const ball = G.ball;
    ball.group.position.copy(deskBallPos(_v3));
    ball.radius = THREE.MathUtils.lerp(ball.radius, ballRadius(G.charge), 1 - Math.exp(-dt * 10));
    ball.power = G.charge;
    if (G.charge >= 1 && !G.fullDinged) { G.fullDinged = true; sfx.ding(); }
    if (G.hum) G.hum.update(G.charge);
  }
  if (deskInput.giant && GI.phase === 'charging') growGiant(dt);
  if (GI.phase === 'cooldown') GI.cool += dt;
  setPowering(!!keys.KeyQ, dt);
  const fly = !!keys.KeyF;
  if (fly) camera.getWorldDirection(_fd);
  moveRig(dt, fly, _fd);
}
window.addEventListener('keydown', (e) => {
  if (e.repeat) { if (e.code === 'Space') e.preventDefault(); return; }
  keys[e.code] = true;
  if (e.code === 'Space') { e.preventDefault(); deskStart(); }
  if (e.code === 'KeyE') deskGiantStart();
  if (e.code === 'KeyQ' || e.code === 'KeyF') sfx.init();
  if (e.code === 'KeyR') { rig.position.set(0, 0, 0); FLY.speed = 0; }
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Space') deskRelease();
  if (e.code === 'KeyE') deskGiantRelease();
});
const chargeBtn = document.getElementById('charge-btn');
chargeBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); deskStart(); });
chargeBtn.addEventListener('pointerup', deskRelease);
chargeBtn.addEventListener('pointerleave', deskRelease);
if (matchMedia('(pointer: coarse)').matches) chargeBtn.style.display = 'block';

let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
window.addEventListener('pointermove', (e) => {
  if (!drag || renderer.xr.isPresenting) return;
  desk.yaw -= (e.clientX - drag.x) * 0.004;
  desk.pitch = THREE.MathUtils.clamp(desk.pitch - (e.clientY - drag.y) * 0.004, -1.4, 1.4);
  drag = { x: e.clientX, y: e.clientY };
  applyDesktopCamera();
});
window.addEventListener('pointerup', () => { drag = null; });

// ---------------------------------------------------------------------------
// Pociski, promienie, wybuchy, kratery
// ---------------------------------------------------------------------------
function detonate(p, pos, ground) {
  const r = p.ball.radius;
  let size, blast, crater;
  if (p.kind === 'giant') {
    size = r * 1.3; blast = r * 2.5; crater = r * 1.9;
  } else {
    const k = 1 + aura.level * 0.4;
    size = (0.35 + p.charge * 1.3) * k; blast = (0.5 + p.charge * 2.2) * k; crater = (0.8 + p.charge * 2.4) * k;
  }
  if (ground && xrMode !== 'ar') {
    pos.y = heightAt(pos.x, pos.z);
    makeCrater(pos.x, pos.z, crater);
    spawnDebris(pos, crater);
    stats.craters++;
  }
  explosions.push(new Explosion(pos, size, { ground: ground && xrMode !== 'ar' }));
  sfx.explode(pos, size);
  pulse(0.4 + size * 0.15, 120 + size * 60);
  for (const t of targets) {
    if (t.alive && t.group.position.distanceTo(pos) < blast + t.radius) { t.destroy(pos); stats.hits++; }
  }
  fading.push(p.ball);
}

function updateProjectiles(dt, t) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.age += dt;
    const pos = p.ball.group.position;
    pos.addScaledVector(p.vel, dt);
    p.ball.update(dt, t);
    const r = p.ball.radius;

    let hit = false, ground = false;
    for (const tg of targets) {
      if (tg.alive && tg.group.position.distanceTo(pos) < tg.radius + r) {
        if (p.kind === 'giant') { tg.destroy(pos); stats.hits++; } // wielka kula przebija się dalej
        else { hit = true; break; }
      }
    }
    const touch = p.kind === 'giant' ? r * 0.5 : r * 0.5;
    if (!hit && pos.y - touch < heightAt(pos.x, pos.z)) { hit = true; ground = true; }
    if (!hit && mesaHit(pos, r * 0.6)) hit = true;
    const far = pos.distanceTo(p.origin) > 120 || p.age > 15;

    if (hit || far) {
      if (hit) detonate(p, pos, ground); else fading.push(p.ball);
      projectiles.splice(i, 1);
      p.dead = true;
    }
  }

  for (let i = beams.length - 1; i >= 0; i--) {
    const B = beams[i];
    B.age += dt;
    const p = B.proj;
    if (!p.dead) B.beam.head.copy(p.ball.group.position);
    const hold = 0.35 + p.charge * 0.7;
    if (B.age > hold || p.dead) {
      const tailSpeed = p.speed * (p.dead ? 2.2 : 1.25);
      _v1.subVectors(B.beam.head, B.beam.tail);
      const rem = _v1.length();
      if (rem <= tailSpeed * dt) B.beam.tail.copy(B.beam.head);
      else B.beam.tail.addScaledVector(_v1.divideScalar(rem), tailSpeed * dt);
    }
    if (p.dead) B.beam.opacity = Math.max(0, B.beam.opacity - dt * 3);
    B.beam.update(t);
    if (p.dead && (B.beam.opacity <= 0 || B.beam.head.distanceTo(B.beam.tail) < 0.02)) {
      B.beam.dispose();
      beams.splice(i, 1);
    }
  }

  for (let i = fading.length - 1; i >= 0; i--) {
    const b = fading[i];
    b.opacity -= dt * 4;
    b.radius *= Math.pow(0.2, dt);
    b.update(dt, t);
    if (b.opacity <= 0) { b.dispose(); fading.splice(i, 1); }
  }
  for (let i = explosions.length - 1; i >= 0; i--) {
    if (!explosions[i].update(dt)) { explosions[i].dispose(); explosions.splice(i, 1); }
  }
  boomLight.intensity *= Math.pow(0.004, dt);
}

function updateBallLight() {
  const b = G.ball || GI.ball || (projectiles.length ? projectiles[projectiles.length - 1].ball : null);
  if (b) {
    ballLight.position.copy(b.group.position);
    ballLight.intensity = (0.6 + b.power * 4) * b.opacity * (1 + b.radius * b.radius * 3);
  } else ballLight.intensity = 0;
}

// dłonie świecą, gdy aura jest aktywna
const _gold = new THREE.Color(0xffb020);
function updateHandGlow() {
  const k = aura.level * (aura.powering ? 0.7 : 0.35);
  for (const st of inputs) {
    st.hand.traverse((o) => {
      if (o.isMesh && o.material && o.material.emissive) o.material.emissive.copy(_gold).multiplyScalar(k);
    });
  }
}

// ---------------------------------------------------------------------------
// Sesje XR
// ---------------------------------------------------------------------------
const btnVR = document.getElementById('btn-vr');
const btnAR = document.getElementById('btn-ar');
const info = document.getElementById('xrinfo');
const overlay = document.getElementById('overlay');

function setMode(mode) {
  xrMode = mode;
  const ar = mode === 'ar';
  env.visible = !ar;
  arLight.visible = ar;
  scene.fog = ar ? null : new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
  renderer.setClearColor(0x000000, ar ? 0 : 1);
}

async function startSession(mode) {
  sfx.init();
  const type = mode === 'ar' ? 'immersive-ar' : 'immersive-vr';
  try {
    const session = await navigator.xr.requestSession(type, { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    setMode(mode);
    rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
    await renderer.xr.setSession(session);
    placeAllTargets();
    overlay.style.display = 'none';
    session.addEventListener('end', () => {
      setMode(null);
      overlay.style.display = '';
      applyDesktopCamera();
      placeAllTargets();
    });
  } catch (err) {
    info.textContent = 'Nie udało się uruchomić sesji: ' + err.message;
  }
}
btnVR.addEventListener('click', () => startSession('vr'));
btnAR.addEventListener('click', () => startSession('ar'));

const DESK_HELP = 'Podgląd na komputerze: <kbd>Spacja</kbd> mała kula, <kbd>E</kbd> wielka kula, <kbd>Q</kbd> aura, <kbd>F</kbd> lot, <kbd>R</kbd> powrót. Przeciągnij myszą, by się rozejrzeć.';
(async () => {
  if (!('xr' in navigator)) { info.innerHTML = 'Ta przeglądarka nie obsługuje WebXR.<br>' + DESK_HELP; return; }
  const [vr, ar] = await Promise.all([
    navigator.xr.isSessionSupported('immersive-vr').catch(() => false),
    navigator.xr.isSessionSupported('immersive-ar').catch(() => false),
  ]);
  btnVR.disabled = !vr;
  btnAR.disabled = !ar;
  if (vr || ar) info.textContent = 'Gotowe! Odłóż kontrolery, żeby gogle przełączyły się na dłonie (albo graj na kontrolerach).';
  else info.innerHTML = 'Brak urządzenia VR.<br>' + DESK_HELP;
})();

window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Pętla główna
// ---------------------------------------------------------------------------
function statusText() {
  if (GI.phase === 'charging') return `Wielka kula ${Math.round(GI.ball.power * 100)}% — zamach do przodu!`;
  if (G.phase === 'charging') return `Ładowanie ${Math.round(G.charge * 10) * 10}% — pchnij do przodu!`;
  if (aura.powering) return `AURA ${Math.round(aura.level * 100)}%`;
  if (FLY.speed > 0.5) return 'Lecisz!';
  if (!renderer.xr.isPresenting) return 'Komputer: Spacja / E / Q / F';
  if (inputs.filter(s => s.valid).length < 2) return 'Pokaż obie dłonie przed sobą';
  return 'Złącz dłonie, unieś je albo opuść';
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (renderer.xr.isPresenting) {
    for (const st of inputs) updateInput(st, t);
    computeFrame();
    updateAuraPose(dt);
    updateGiant(dt);
    updateKame(dt);
    updateFlightXR(dt);
  } else {
    for (const st of inputs) st.marker.visible = false;
    updateDesktop(dt);
  }

  if (G.ball) G.ball.update(dt, t);
  if (GI.ball) GI.ball.update(dt, t);
  updateProjectiles(dt, t);
  for (const tg of targets) tg.update(dt, t);
  updateShards(dt);
  updateDebris(dt);
  camera.getWorldPosition(_v1);
  aura.update(dt, t, _v1);
  updateHandGlow();
  updateBallLight();
  panel.draw(statusText());
  sfx.updateListener(camera);

  renderer.render(scene, camera);
});

// do testów w konsoli
window.__sim = { G, GI, F, aura, stats, targets, projectiles, inputs, rig, computeFrame, updateKame, updateGiant, updateAuraPose, heightAt, makeCrater, deskStart, deskRelease, deskGiantStart, deskGiantRelease, desk, applyDesktopCamera };
