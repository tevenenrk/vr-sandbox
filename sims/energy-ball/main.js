// Kula Energii — symulator gestów dłoni (WebXR, Meta Quest)
// Złącz dłonie → kula się ładuje; pchnij dłonie do przodu → wystrzał.

import * as THREE from 'three';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

// ---------------------------------------------------------------------------
// Ustawienia gestu (w metrach / sekundach / m/s)
// ---------------------------------------------------------------------------
const CFG = {
  chargeStartDist: 0.20,   // dłonie bliżej niż to → zaczyna się ładowanie
  chargeHoldTime: 0.18,    // tyle trzeba je przytrzymać razem, żeby pojawiła się kula
  chargeKeepDist: 0.42,    // dopóki dłonie są bliżej, kula dalej się ładuje
  fizzleTime: 0.55,        // po tylu sekundach rozsuniętych dłoni kula gaśnie
  chargeTime: 2.5,         // czas do pełnego naładowania
  minChargeToFire: 0.12,   // minimalne naładowanie, żeby strzelić
  fireSpeedMid: 1.1,       // prędkość środka dłoni do przodu potrzebna do strzału
  fireSpeedEach: 0.55,     // każda dłoń musi iść do przodu co najmniej tak szybko
  fireMaxHandDist: 0.5,    // dłonie muszą być blisko siebie w momencie pchnięcia
  aimAssistAngle: THREE.MathUtils.degToRad(12),
};

// ---------------------------------------------------------------------------
// Renderer, scena, kamera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const SKY_FOG = new THREE.Color(0x2a1d3d);
scene.fog = new THREE.FogExp2(SKY_FOG, 0.018);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.02, 1200);
const desk = { yaw: 0, pitch: -0.05 };
function applyDesktopCamera() {
  camera.position.set(0, 1.6, 0);
  camera.rotation.set(desk.pitch, desk.yaw, 0, 'YXZ');
}
applyDesktopCamera();

let xrMode = null; // null | 'vr' | 'ar'

const clock = new THREE.Clock();

// Wspólne obiekty pomocnicze (bez alokacji w pętli)
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();

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

const CORE_COLOR = new THREE.Color(0xeafcff);
const EDGE_COLOR = new THREE.Color(0x3fb4ff);

const ballMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uPower: { value: 0 },
    uOpacity: { value: 1 },
    uCore: { value: CORE_COLOR.clone() },
    uEdge: { value: EDGE_COLOR.clone() },
  },
  vertexShader: /* glsl */`
    uniform float uTime;
    uniform float uPower;
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
    uTime: { value: 0 },
    uOpacity: { value: 1 },
    uLen: { value: 1 },
    uCore: { value: CORE_COLOR.clone() },
    uEdge: { value: EDGE_COLOR.clone() },
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
beamGeo.translate(0, 0, 0.5); // oś wzdłuż +Z od 0 do 1

function randomDir(out) {
  const u = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(a), u, s * Math.sin(a));
}

// ---------------------------------------------------------------------------
// Kula energii
// ---------------------------------------------------------------------------
const PARTICLES = 140;
const ARCS = 4;
const ARC_PTS = 9;

class EnergyBall {
  constructor() {
    this.group = new THREE.Group();
    this.radius = 0.02;
    this.power = 0;
    this.opacity = 1;
    this.gathering = true;
    this.arcTimer = 0;

    this.mat = ballMaterial.clone();
    this.shell = new THREE.Mesh(sphereGeo, this.mat);
    this.shell.renderOrder = 2;

    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
    this.core = new THREE.Mesh(coreGeo, this.coreMat);
    this.core.renderOrder = 1;

    this.glowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0x3aa8ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.glow = new THREE.Sprite(this.glowMat);
    this.glow2Mat = new THREE.SpriteMaterial({ map: glowTex, color: 0xd8f6ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.glow2 = new THREE.Sprite(this.glow2Mat);
    this.glow.renderOrder = 3; this.glow2.renderOrder = 3;

    // cząsteczki zasysane do kuli
    this.pPos = new Float32Array(PARTICLES * 3);
    this.pSpeed = new Float32Array(PARTICLES);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pMat = new THREE.PointsMaterial({ map: glowTex, color: 0x9fe6ff, size: 0.02, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.points = new THREE.Points(pg, this.pMat);
    this.points.frustumCulled = false;
    for (let i = 0; i < PARTICLES; i++) this.respawnParticle(i, true);

    // wyładowania elektryczne
    this.arcMat = new THREE.LineBasicMaterial({ color: 0xcff4ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
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

  respawnParticle(i, initial) {
    randomDir(_v1).multiplyScalar(this.radius + 0.1 + Math.random() * (initial ? 0.35 : 0.3));
    this.pPos[i * 3] = _v1.x; this.pPos[i * 3 + 1] = _v1.y; this.pPos[i * 3 + 2] = _v1.z;
    this.pSpeed[i] = 0.25 + Math.random() * 0.5;
  }

  regenArcs() {
    const r = this.radius;
    const intensity = 0.3 + this.power;
    for (const l of this.arcs) {
      l.visible = Math.random() < intensity;
      if (!l.visible) continue;
      const pos = l.geometry.attributes.position.array;
      const a = randomDir(_v1).clone();
      const b = randomDir(_v2).lerp(a, 0.35).normalize();
      for (let k = 0; k < ARC_PTS; k++) {
        const t = k / (ARC_PTS - 1);
        _v3.copy(a).lerp(b, t).normalize();
        const rad = r * (1.0 + Math.sin(t * Math.PI) * (0.5 + this.power * 0.6));
        _v3.multiplyScalar(rad);
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
    const r = this.radius;
    const pulse = 1 + Math.sin(t * (14 + this.power * 16)) * (0.04 + this.power * 0.06);
    this.shell.scale.setScalar(r * pulse);
    this.core.scale.setScalar(r * 0.55);
    this.glow.scale.setScalar(r * (5.5 + this.power * 3) * pulse);
    this.glow2.scale.setScalar(r * 2.4);

    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uPower.value = this.power;
    this.mat.uniforms.uOpacity.value = this.opacity;
    this.coreMat.opacity = this.opacity;
    this.glowMat.opacity = this.opacity * (0.75 + this.power * 0.25);
    this.glow2Mat.opacity = this.opacity * 0.9;
    this.arcMat.opacity = this.opacity * 0.9;

    // cząsteczki
    this.points.visible = this.gathering && this.opacity > 0.05;
    if (this.points.visible) {
      const swirl = 2.5 + this.power * 4;
      for (let i = 0; i < PARTICLES; i++) {
        const ix = i * 3;
        _v1.set(this.pPos[ix], this.pPos[ix + 1], this.pPos[ix + 2]);
        const d = _v1.length();
        if (d < r * 0.9) { this.respawnParticle(i, false); continue; }
        // ruch do środka + zawirowanie wokół osi Y
        const inward = this.pSpeed[i] * (1 + this.power * 1.5) * dt;
        _v2.copy(_v1).multiplyScalar(-inward / d);
        _v3.set(-_v1.z, 0, _v1.x).multiplyScalar(swirl * dt);
        _v1.add(_v2).add(_v3);
        this.pPos[ix] = _v1.x; this.pPos[ix + 1] = _v1.y; this.pPos[ix + 2] = _v1.z;
      }
      this.points.geometry.attributes.position.needsUpdate = true;
      this.pMat.size = 0.012 + this.power * 0.012;
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

// ---------------------------------------------------------------------------
// Promień (fala energii ciągnąca się za kulą)
// ---------------------------------------------------------------------------
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
// Wybuch
// ---------------------------------------------------------------------------
const boomLight = new THREE.PointLight(0x9fdcff, 0, 0, 2);
scene.add(boomLight);
const ringGeo = new THREE.RingGeometry(0.8, 1, 64);

class Explosion {
  constructor(pos, size, withLight = true) {
    this.size = size;
    this.t = 0;
    this.life = 1.6;
    this.group = new THREE.Group();
    this.group.position.copy(pos);

    this.flashMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.flash = new THREE.Sprite(this.flashMat);
    this.cloudMat = new THREE.SpriteMaterial({ map: glowTex, color: 0x3aa8ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.cloud = new THREE.Sprite(this.cloudMat);

    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring2 = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring2.rotation.x = -Math.PI / 2; // poziomy pierścień uderzeniowy

    const n = Math.round(60 + size * 90);
    this.n = n;
    this.sPos = new Float32Array(n * 3);
    this.sVel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      randomDir(_v1).multiplyScalar((1.5 + Math.random() * 5) * (0.4 + size));
      this.sVel[i * 3] = _v1.x; this.sVel[i * 3 + 1] = _v1.y + 1.2; this.sVel[i * 3 + 2] = _v1.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3));
    this.sMat = new THREE.PointsMaterial({ map: glowTex, color: 0xbff0ff, size: 0.06 + size * 0.05, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.sparks = new THREE.Points(g, this.sMat);
    this.sparks.frustumCulled = false;

    this.group.add(this.cloud, this.flash, this.ring, this.ring2, this.sparks);
    scene.add(this.group);

    if (withLight) {
      boomLight.position.copy(pos);
      boomLight.intensity = 60 * size + 10;
    }
  }

  update(dt) {
    this.t += dt;
    const t = this.t, s = this.size;
    const e = 1 - Math.pow(1 - Math.min(1, t / 0.3), 3);
    this.flash.scale.setScalar(s * (0.5 + 3.5 * e));
    this.flashMat.opacity = Math.max(0, 1 - t / 0.45);
    this.cloud.scale.setScalar(s * (1 + 6 * e));
    this.cloudMat.opacity = Math.max(0, 0.9 - t / 1.1);

    this.ring.quaternion.copy(camera.quaternion);
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
    this.sMat.opacity = Math.max(0, 1 - t / this.life);
    return t < this.life;
  }

  dispose() {
    scene.remove(this.group);
    this.flashMat.dispose(); this.cloudMat.dispose(); this.ringMat.dispose();
    this.sMat.dispose(); this.sparks.geometry.dispose();
  }
}

// ---------------------------------------------------------------------------
// Otoczenie (tryb VR) — wieczorny płaskowyż
// ---------------------------------------------------------------------------
const env = new THREE.Group();
scene.add(env);

{
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {},
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
        vec3 zenith = vec3(0.03, 0.04, 0.12);
        vec3 mid = vec3(0.16, 0.10, 0.28);
        vec3 horizon = vec3(0.85, 0.40, 0.30);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
        col = mix(col, zenith, smoothstep(0.15, 0.7, h));
        // poświata zachodzącego słońca
        vec3 sunDir = normalize(vec3(0.3, 0.05, -1.0));
        float sun = pow(max(dot(vDir, sunDir), 0.0), 18.0);
        col += vec3(1.0, 0.55, 0.3) * sun * 0.6;
        if (h < 0.0) col = mix(horizon * 0.5, vec3(0.05, 0.03, 0.08), smoothstep(0.0, -0.2, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  env.add(sky);

  // gwiazdy
  const starCount = 900;
  const sp = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    randomDir(_v1);
    _v1.y = Math.abs(_v1.y) * 0.9 + 0.08;
    _v1.normalize().multiplyScalar(450);
    sp[i * 3] = _v1.x; sp[i * 3 + 1] = _v1.y; sp[i * 3 + 2] = _v1.z;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 }));
  env.add(stars);

  // podłoże
  const groundGeo = new THREE.CircleGeometry(300, 64);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ color: 0x3b2f45, roughness: 0.95, metalness: 0 }));
  env.add(ground);

  // krąg pod stopami
  const pad = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.6, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.35 }));
  pad.position.y = 0.005;
  env.add(pad);

  // skały i góry
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x5a4660, roughness: 0.9, flatShading: true });
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 18 + Math.random() * 40;
    const s = 0.8 + Math.random() * 2.8;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), rockMat);
    rock.position.set(Math.sin(a) * d, s * 0.4, Math.cos(a) * d);
    rock.scale.set(s * (0.6 + Math.random()), s * (0.8 + Math.random() * 2.5), s * (0.6 + Math.random()));
    rock.rotation.set(Math.random(), Math.random() * 3, Math.random() * 0.3);
    env.add(rock);
  }
  const mountMat = new THREE.MeshStandardMaterial({ color: 0x2c2238, roughness: 1, flatShading: true });
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + Math.random() * 0.2;
    const d = 140 + Math.random() * 60;
    const h = 25 + Math.random() * 55;
    const m = new THREE.Mesh(new THREE.ConeGeometry(h * 0.9, h, 6 + Math.floor(Math.random() * 3)), mountMat);
    m.position.set(Math.sin(a) * d, h / 2 - 2, Math.cos(a) * d);
    m.rotation.y = Math.random() * 3;
    env.add(m);
  }

  env.add(new THREE.HemisphereLight(0x8fa6ff, 0x3a2030, 1.0));
  const sunLight = new THREE.DirectionalLight(0xffa070, 1.0);
  sunLight.position.set(30, 10, -100);
  env.add(sunLight);
}

// W trybie AR (passthrough) też potrzebujemy światła dla celów i dłoni
const arLight = new THREE.HemisphereLight(0xffffff, 0x444466, 1.6);
arLight.visible = false;
scene.add(arLight);

// ---------------------------------------------------------------------------
// Cele — unoszące się kryształy
// ---------------------------------------------------------------------------
const crystalGeo = new THREE.OctahedronGeometry(0.32, 0);
const crystalEdges = new THREE.EdgesGeometry(crystalGeo);
const shardGeo = new THREE.TetrahedronGeometry(0.07, 0);
const TARGET_COLORS = [0xff4fd8, 0xffb13b, 0x6dff8a, 0xb18cff, 0xff6a5c];

class Target {
  constructor(i) {
    const color = new THREE.Color(TARGET_COLORS[i % TARGET_COLORS.length]);
    this.color = color;
    this.mat = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.25), emissive: color, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.2, flatShading: true });
    this.group = new THREE.Group();
    this.mesh = new THREE.Mesh(crystalGeo, this.mat);
    this.mesh.scale.set(1, 1.5, 1);
    const edges = new THREE.LineSegments(crystalEdges, new THREE.LineBasicMaterial({ color: color.clone().lerp(new THREE.Color(1, 1, 1), 0.6) }));
    edges.scale.copy(this.mesh.scale);
    this.mesh.add(edges);
    edges.scale.set(1.01, 1.01, 1.01);
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
      const ang = (Math.random() * 2 - 1) * (ar ? 0.85 : 1.0);
      const dist = ar ? 2.5 + Math.random() * 4 : 5 + Math.random() * 11;
      this.base.set(Math.sin(ang) * dist, (ar ? 0.9 : 1.0) + Math.random() * 2.2, -Math.cos(ang) * dist);
      if (others.every(o => o === this || o.base.distanceTo(this.base) > 1.4)) break;
    }
    this.group.position.copy(this.base);
  }
  update(dt, t) {
    if (!this.alive) {
      this.respawn -= dt;
      if (this.respawn <= 0) {
        this.alive = true;
        this.spawnAnim = 0;
        this.place(targets);
        this.group.visible = true;
      }
      return;
    }
    this.spawnAnim = Math.min(1, this.spawnAnim + dt * 2);
    const k = 1 - Math.pow(1 - this.spawnAnim, 3);
    this.group.scale.setScalar(k);
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
for (let i = 0; i < 8; i++) targets.push(new Target(i));
function placeAllTargets() { for (const t of targets) { t.alive = true; t.group.visible = true; t.spawnAnim = 0; t.place(targets); } }
placeAllTargets();

// odłamki zniszczonych kryształów
const shards = [];
function spawnShards(pos, from, mat) {
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(shardGeo, mat);
    m.position.copy(pos);
    randomDir(_v1);
    _v2.subVectors(pos, from).normalize();
    const vel = _v1.multiplyScalar(2 + Math.random() * 3).addScaledVector(_v2, 3).add(new THREE.Vector3(0, 2.5, 0)).clone();
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
    if (s.m.position.y < 0.04) { s.m.position.y = 0.04; s.vel.y *= -0.35; s.vel.x *= 0.7; s.vel.z *= 0.7; }
    s.m.rotation.x += s.spin.x * dt; s.m.rotation.y += s.spin.y * dt;
    if (s.life < 0.5) s.m.scale.multiplyScalar(Math.pow(0.02, dt));
    if (s.life <= 0) { scene.remove(s.m); shards.splice(i, 1); }
  }
}

// ---------------------------------------------------------------------------
// Tablica z instrukcją i wynikiem
// ---------------------------------------------------------------------------
const stats = { hits: 0, shots: 0, best: 0 };
const panel = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 600;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.82),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  mesh.position.set(-1.5, 1.75, -2.3);
  mesh.lookAt(0, 1.6, 0);
  scene.add(mesh);
  let last = '';
  function draw(status) {
    const key = `${status}|${stats.hits}|${stats.shots}|${stats.best}`;
    if (key === last) return;
    last = key;
    ctx.clearRect(0, 0, 1024, 600);
    ctx.fillStyle = 'rgba(10,14,32,0.82)';
    ctx.strokeStyle = 'rgba(120,200,255,0.55)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(4, 4, 1016, 592, 36); else ctx.rect(4, 4, 1016, 592);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#9fe6ff';
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.fillText('⚡ KULA ENERGII', 48, 100);
    ctx.fillStyle = '#e8f4ff';
    ctx.font = '38px system-ui, sans-serif';
    ctx.fillText('1. Złącz dłonie — pojawi się kula', 48, 180);
    ctx.fillText('2. Trzymaj — kula rośnie', 48, 232);
    ctx.fillText('3. Pchnij dłonie do przodu — strzał!', 48, 284);
    ctx.fillStyle = '#ffcf7a';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.fillText(`Trafienia: ${stats.hits}    Strzały: ${stats.shots}`, 48, 380);
    ctx.fillText(`Najmocniejszy: ${Math.round(stats.best * 100)}%`, 48, 440);
    ctx.fillStyle = '#b8ffcf';
    ctx.font = '36px system-ui, sans-serif';
    ctx.fillText(status, 48, 530);
    tex.needsUpdate = true;
  }
  return { mesh, draw };
})();

// ---------------------------------------------------------------------------
// Dźwięk (syntezowany w Web Audio — bez plików)
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
  }
  noiseSrc(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = loop;
    return s;
  }
  startCharge() {
    if (!this.ctx) return;
    this.stopCharge(true);
    const c = this.ctx, now = c.currentTime;
    const out = c.createGain(); out.gain.setValueAtTime(0, now); out.gain.linearRampToValueAtTime(0.1, now + 0.25);
    const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 400; filter.Q.value = 6;
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 70;
    const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 70.7;
    const trem = c.createGain(); trem.gain.value = 0.7;
    const lfo = c.createOscillator(); lfo.frequency.value = 9;
    const lfoGain = c.createGain(); lfoGain.gain.value = 0.3;
    lfo.connect(lfoGain).connect(trem.gain);
    const nz = this.noiseSrc(true);
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 1.2;
    const ng = c.createGain(); ng.gain.value = 0.15;
    o1.connect(filter); o2.connect(filter); nz.connect(nf).connect(ng).connect(filter);
    filter.connect(trem).connect(out).connect(this.master);
    o1.start(); o2.start(); lfo.start(); nz.start();
    this.charge = { out, filter, o1, o2, lfo, nz, nf, ng };
  }
  updateCharge(level) {
    const ch = this.charge;
    if (!ch) return;
    const now = this.ctx.currentTime;
    ch.o1.frequency.setTargetAtTime(70 + level * 150, now, 0.05);
    ch.o2.frequency.setTargetAtTime(70.7 + level * 152, now, 0.05);
    ch.filter.frequency.setTargetAtTime(400 + level * 3200, now, 0.05);
    ch.lfo.frequency.setTargetAtTime(9 + level * 14, now, 0.05);
    ch.nf.frequency.setTargetAtTime(1800 + level * 2500, now, 0.05);
    ch.out.gain.setTargetAtTime(0.08 + level * 0.14, now, 0.08);
  }
  stopCharge(immediate = false) {
    const ch = this.charge;
    if (!ch) return;
    this.charge = null;
    const now = this.ctx.currentTime;
    const t = immediate ? 0.03 : 0.15;
    ch.out.gain.cancelScheduledValues(now);
    ch.out.gain.setValueAtTime(ch.out.gain.value, now);
    ch.out.gain.linearRampToValueAtTime(0, now + t);
    for (const n of [ch.o1, ch.o2, ch.lfo, ch.nz]) n.stop(now + t + 0.05);
  }
  spatial(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 2; p.rolloffFactor = 0.6;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(this.master);
    return p;
  }
  fire(level) {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime;
    const dur = 0.9 + level * 0.8;
    const nz = this.noiseSrc();
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(3500, now); bp.frequency.exponentialRampToValueAtTime(350, now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.5 + level * 0.5, now + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    nz.connect(bp).connect(g).connect(this.master);
    nz.start(now); nz.stop(now + dur + 0.1);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(160, now); o.frequency.exponentialRampToValueAtTime(38, now + 0.7);
    const og = c.createGain();
    og.gain.setValueAtTime(0.6 + level * 0.4, now); og.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    o.connect(og).connect(this.master);
    o.start(now); o.stop(now + 0.85);
  }
  explode(pos, size) {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime;
    const out = this.spatial(pos);
    const dur = 1.0 + size * 0.8;
    const nz = this.noiseSrc();
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2500, now); lp.frequency.exponentialRampToValueAtTime(90, now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(1.4 * (0.5 + size), now); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    nz.connect(lp).connect(g).connect(out);
    nz.start(now); nz.stop(now + dur + 0.1);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, now); o.frequency.exponentialRampToValueAtTime(25, now + 0.9);
    const og = c.createGain();
    og.gain.setValueAtTime(1.0, now); og.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
    o.connect(og).connect(out);
    o.start(now); o.stop(now + 1.05);
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

// ---------------------------------------------------------------------------
// Wejście: dłonie (hand tracking) lub kontrolery
// ---------------------------------------------------------------------------
const handFactory = new XRHandModelFactory();
const controllerFactory = new XRControllerModelFactory();

function makeInput(i) {
  const controller = renderer.xr.getController(i);
  const grip = renderer.xr.getControllerGrip(i);
  const hand = renderer.xr.getHand(i);
  scene.add(controller, grip, hand);
  grip.add(controllerFactory.createControllerModel(grip));
  hand.add(handFactory.createHandModel(hand, 'mesh'));

  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x5cc8ff, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.5, depthWrite: false }));
  marker.scale.setScalar(0.05);
  marker.visible = false;
  scene.add(marker);

  const st = {
    controller, grip, hand, marker,
    connected: false, isHand: false, handedness: 'none', gamepad: null,
    pos: new THREE.Vector3(), normal: new THREE.Vector3(0, 0, -1), vel: new THREE.Vector3(),
    valid: false, hist: [],
  };
  controller.addEventListener('connected', (e) => {
    st.connected = true;
    st.isHand = !!e.data.hand;
    st.handedness = e.data.handedness;
    st.gamepad = e.data.gamepad || null;
    st.hist.length = 0;
  });
  controller.addEventListener('disconnected', () => {
    st.connected = false; st.valid = false; st.hist.length = 0;
  });
  return st;
}
const inputs = [makeInput(0), makeInput(1)];

const _w = new THREE.Vector3(), _m = new THREE.Vector3(), _im = new THREE.Vector3(), _pm = new THREE.Vector3();
function updateInput(st, now) {
  st.valid = false;
  if (st.connected) {
    if (st.isHand) {
      const j = st.hand.joints;
      const w = j['wrist'], mid = j['middle-finger-phalanx-proximal'], im = j['index-finger-metacarpal'], pm = j['pinky-finger-metacarpal'];
      if (w && mid && im && pm && w.visible && mid.visible && st.hand.visible) {
        w.getWorldPosition(_w); mid.getWorldPosition(_m); im.getWorldPosition(_im); pm.getWorldPosition(_pm);
        // środek dłoni i kierunek, w który "patrzy" wewnętrzna strona dłoni
        st.normal.crossVectors(_im.sub(_w), _pm.sub(_w)).normalize();
        if (st.handedness === 'left') st.normal.negate();
        st.pos.addVectors(_w, _m).multiplyScalar(0.5).addScaledVector(st.normal, 0.03);
        st.valid = true;
      }
    } else if (st.grip.visible) {
      st.grip.getWorldPosition(st.pos);
      st.normal.set(0, 0, -1).applyQuaternion(st.controller.getWorldQuaternion(_q));
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
    if (a && a.pulse) a.pulse(intensity, ms).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Logika gestu: ładowanie → wystrzał
// ---------------------------------------------------------------------------
const G = { phase: 'idle', closeT: 0, apartT: 0, charge: 0, ball: null, cool: 0, fullDinged: false };
const projectiles = [];
const beams = [];
const explosions = [];
const fading = []; // kule, które gasną
const ballLight = new THREE.PointLight(0x7fd0ff, 0, 0, 2);
scene.add(ballLight);

function ballRadius(charge) { return 0.035 + 0.15 * Math.pow(charge, 0.8); }

function startCharge(pos) {
  G.phase = 'charging';
  G.charge = 0;
  G.apartT = 0;
  G.fullDinged = false;
  G.ball = new EnergyBall();
  G.ball.radius = 0.005;
  G.ball.group.position.copy(pos);
  sfx.startCharge();
}

function fizzle() {
  if (G.ball) {
    fading.push(G.ball);
    explosions.push(new Explosion(G.ball.group.position, 0.12, false));
  }
  G.ball = null;
  G.phase = 'cooldown';
  G.cool = 0;
  sfx.stopCharge();
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
  if (best) {
    _aim.subVectors(best.group.position, origin).normalize();
    dir.lerp(_aim, 0.75).normalize();
  }
  return dir;
}

function fire(dir) {
  const ball = G.ball;
  const charge = G.charge;
  G.ball = null;
  G.phase = 'cooldown';
  G.cool = 0;
  sfx.stopCharge(true);
  if (!ball) return;
  const origin = ball.group.position.clone();
  aimAssist(dir, origin);
  ball.gathering = false;
  ball.power = Math.max(ball.power, 0.4);
  const speed = 9 + charge * 9;
  const beam = new Beam(ball.radius * 0.8, origin);
  const p = { ball, beam, dir: dir.clone(), vel: dir.clone().multiplyScalar(speed), speed, charge, age: 0, origin };
  projectiles.push(p);
  beams.push({ beam, proj: p, age: 0 });
  stats.shots++;
  stats.best = Math.max(stats.best, charge);
  sfx.fire(charge);
  pulse(0.6 + charge * 0.4, 150 + charge * 200);
}

const _fwd = new THREE.Vector3(), _fwdFlat = new THREE.Vector3(), _mid = new THREE.Vector3(), _vm = new THREE.Vector3(), _palm = new THREE.Vector3();
function updateGesture(dt) {
  const a = inputs[0], b = inputs[1];
  const both = a.valid && b.valid;
  let d = Infinity;
  if (both) { d = a.pos.distanceTo(b.pos); _mid.addVectors(a.pos, b.pos).multiplyScalar(0.5); }

  // podświetlenie znaczników dłoni, gdy są wystarczająco blisko
  const near = both && d < CFG.chargeStartDist;
  for (const st of inputs) st.marker.material.color.setHex(near ? 0xffffff : 0x5cc8ff);

  switch (G.phase) {
    case 'idle':
      if (near) {
        G.closeT += dt;
        if (G.closeT > CFG.chargeHoldTime) startCharge(_mid);
      } else G.closeT = 0;
      break;

    case 'charging': {
      const ball = G.ball;
      if (both && d < CFG.chargeKeepDist) {
        G.apartT = 0;
        G.charge = Math.min(1, G.charge + dt / CFG.chargeTime);
        ball.group.position.lerp(_mid, 1 - Math.exp(-dt * 25));
        ball.radius = THREE.MathUtils.lerp(ball.radius, ballRadius(G.charge), 1 - Math.exp(-dt * 10));
        ball.power = G.charge;
        ball.opacity = 1;
        if (G.charge >= 1 && !G.fullDinged) { G.fullDinged = true; sfx.ding(); pulse(0.3, 60); }
      } else {
        G.apartT += dt;
        if (both) ball.group.position.lerp(_mid, 1 - Math.exp(-dt * 10));
        ball.radius *= Math.pow(0.4, dt);
        ball.opacity = Math.max(0.2, 1 - G.apartT / CFG.fizzleTime);
      }
      sfx.updateCharge(G.charge * (G.apartT > 0 ? 0.5 : 1));

      // pchnięcie do przodu = wystrzał
      if (both && G.charge >= CFG.minChargeToFire && d < CFG.fireMaxHandDist) {
        camera.getWorldDirection(_fwd);
        _fwdFlat.copy(_fwd); _fwdFlat.y *= 0.4; _fwdFlat.normalize();
        _vm.addVectors(a.vel, b.vel).multiplyScalar(0.5);
        const vMid = _vm.dot(_fwdFlat);
        const vMin = Math.min(a.vel.dot(_fwdFlat), b.vel.dot(_fwdFlat));
        if (vMid > CFG.fireSpeedMid && vMin > CFG.fireSpeedEach) {
          const dir = _vm.clone().normalize().lerp(_fwd, 0.3).normalize();
          _palm.addVectors(a.normal, b.normal);
          if (_palm.lengthSq() > 0.3) {
            _palm.normalize();
            if (_palm.dot(dir) > 0.4) dir.lerp(_palm, 0.25).normalize();
          }
          fire(dir);
          break;
        }
      }
      if (G.apartT > CFG.fizzleTime) fizzle();
      break;
    }

    case 'cooldown':
      G.cool += dt;
      if ((G.cool > 0.35 && (!both || d > 0.28)) || G.cool > 1.6) { G.phase = 'idle'; G.closeT = 0; }
      break;
  }
}

// --- sterowanie na komputerze (podgląd bez gogli) --------------------------
const deskInput = { charging: false };
function deskBallPos(out) {
  camera.getWorldDirection(_v1);
  return out.copy(camera.position).addScaledVector(_v1, 0.6).add(_v2.set(0, -0.15, 0));
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
  if (G.charge < CFG.minChargeToFire) { fizzle(); return; }
  camera.getWorldDirection(_v1);
  fire(_v1.clone());
}
function updateDesktop(dt) {
  if (!deskInput.charging || G.phase !== 'charging') return;
  G.charge = Math.min(1, G.charge + dt / CFG.chargeTime);
  const ball = G.ball;
  ball.group.position.copy(deskBallPos(_v3));
  ball.radius = THREE.MathUtils.lerp(ball.radius, ballRadius(G.charge), 1 - Math.exp(-dt * 10));
  ball.power = G.charge;
  if (G.charge >= 1 && !G.fullDinged) { G.fullDinged = true; sfx.ding(); }
  sfx.updateCharge(G.charge);
}
window.addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) deskStart(); } });
window.addEventListener('keyup', (e) => { if (e.code === 'Space') deskRelease(); });
const chargeBtn = document.getElementById('charge-btn');
chargeBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); deskStart(); });
chargeBtn.addEventListener('pointerup', deskRelease);
chargeBtn.addEventListener('pointerleave', deskRelease);
if (matchMedia('(pointer: coarse)').matches) chargeBtn.style.display = 'block';

// rozglądanie się myszą / palcem
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
window.addEventListener('pointermove', (e) => {
  if (!drag || renderer.xr.isPresenting) return;
  desk.yaw -= (e.clientX - drag.x) * 0.004;
  desk.pitch = THREE.MathUtils.clamp(desk.pitch - (e.clientY - drag.y) * 0.004, -1.2, 1.2);
  drag = { x: e.clientX, y: e.clientY };
  applyDesktopCamera();
});
window.addEventListener('pointerup', () => { drag = null; });

// ---------------------------------------------------------------------------
// Pociski, promienie, wybuchy
// ---------------------------------------------------------------------------
function detonate(p, pos) {
  const size = 0.35 + p.charge * 1.3;
  explosions.push(new Explosion(pos, size));
  sfx.explode(pos, size);
  const blast = 0.5 + p.charge * 2.2;
  for (const t of targets) {
    if (t.alive && t.group.position.distanceTo(pos) < blast + t.radius) {
      t.destroy(pos);
      stats.hits++;
    }
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

    let hit = false;
    for (const tg of targets) {
      if (tg.alive && tg.group.position.distanceTo(pos) < tg.radius + p.ball.radius) { hit = true; break; }
    }
    if (!hit && pos.y < p.ball.radius * 0.5) { pos.y = p.ball.radius * 0.5; hit = true; }
    const far = pos.distanceTo(p.origin) > 70;

    if (hit || far) {
      if (hit) detonate(p, pos); else fading.push(p.ball);
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
      // ogon promienia dogania głowę
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

// światło kuli oświetla dłonie i otoczenie
function updateBallLight() {
  const b = G.ball || (projectiles.length ? projectiles[projectiles.length - 1].ball : null);
  if (b) {
    ballLight.position.copy(b.group.position);
    ballLight.intensity = (0.6 + b.power * 4) * b.opacity;
  } else ballLight.intensity = 0;
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
  scene.fog = ar ? null : new THREE.FogExp2(SKY_FOG, 0.018);
  scene.background = null;
  renderer.setClearColor(0x000000, ar ? 0 : 1);
}

async function startSession(mode) {
  sfx.init();
  const type = mode === 'ar' ? 'immersive-ar' : 'immersive-vr';
  try {
    const session = await navigator.xr.requestSession(type, {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    });
    setMode(mode);
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

(async () => {
  if (!('xr' in navigator)) {
    info.innerHTML = 'Ta przeglądarka nie obsługuje WebXR. Otwórz stronę w przeglądarce gogli Quest.<br>Podgląd na komputerze: przytrzymaj <kbd>Spacja</kbd>, puść — strzał. Przeciągnij myszą, by się rozejrzeć.';
    return;
  }
  const [vr, ar] = await Promise.all([
    navigator.xr.isSessionSupported('immersive-vr').catch(() => false),
    navigator.xr.isSessionSupported('immersive-ar').catch(() => false),
  ]);
  btnVR.disabled = !vr;
  btnAR.disabled = !ar;
  if (vr || ar) info.textContent = 'Gotowe! Odłóż kontrolery, żeby gogle przełączyły się na śledzenie dłoni.';
  else info.innerHTML = 'Brak urządzenia VR. Podgląd: przytrzymaj <kbd>Spacja</kbd>, puść — strzał. Przeciągnij myszą, by się rozejrzeć.';
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
  if (!renderer.xr.isPresenting) {
    return G.phase === 'charging' ? `Ładowanie ${Math.round(G.charge * 100)}% — puść Spację!` : 'Komputer: przytrzymaj Spację';
  }
  const tracked = inputs.filter(s => s.valid).length;
  if (G.phase === 'charging') return `Ładowanie ${Math.round(G.charge * 10) * 10}% — pchnij do przodu!`;
  if (tracked < 2) return 'Pokaż obie dłonie przed sobą';
  return 'Złącz dłonie, żeby zacząć';
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (renderer.xr.isPresenting) {
    for (const st of inputs) updateInput(st, t);
    updateGesture(dt);
  } else {
    for (const st of inputs) st.marker.visible = false;
    updateDesktop(dt);
  }

  if (G.ball) G.ball.update(dt, t);
  updateProjectiles(dt, t);
  for (const tg of targets) tg.update(dt, t);
  updateShards(dt);
  updateBallLight();
  panel.draw(statusText());
  sfx.updateListener(camera);

  renderer.render(scene, camera);
});

// do testów w konsoli
window.__sim = { G, stats, targets, projectiles, inputs, updateGesture, deskStart, deskRelease };
