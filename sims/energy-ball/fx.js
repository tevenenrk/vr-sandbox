// Efekty: kule energii, promień, wybuchy, aura.
import * as THREE from 'three';
import { scene, camera, glowTex, randomDir, rand } from './core.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();

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
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
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
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});

const sphereGeo = new THREE.SphereGeometry(1, 32, 20);
const coreGeo = new THREE.SphereGeometry(1, 16, 12);
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
beamGeo.rotateX(Math.PI / 2);
beamGeo.translate(0, 0, 0.5);

// ---------------------------------------------------------------------------
const ARCS = 4, ARC_PTS = 9;
export const KAME_STYLE = { core: 0xeafcff, edge: 0x3fb4ff, glow: 0x3aa8ff, pcol: 0x9fe6ff, particles: 140, gatherMin: 0.1, gatherMax: 0.35, pSpeed: 1, pSize: 0.012, swirl: 2.5, glowScale: 5.5 };
export const SMALL_STYLE = { core: 0xf4fdff, edge: 0x56c8ff, glow: 0x4ab4ff, pcol: 0xbff0ff, particles: 50, gatherMin: 0.05, gatherMax: 0.2, pSpeed: 0.8, pSize: 0.01, swirl: 3, glowScale: 5 };
export const GIANT_STYLE = { core: 0xffffff, edge: 0x7fd4ff, glow: 0x6cc4ff, pcol: 0x9fe6ff, particles: 260, gatherMin: 3, gatherMax: 16, pSpeed: 9, pSize: 0.12, swirl: 0.5, glowScale: 3.2 };
export const RED_STYLE = { core: 0xffe6e6, edge: 0xff3a3a, glow: 0xff2a2a, pcol: 0xff8080, arc: 0xffc0c0, particles: 0, gatherMin: 0.1, gatherMax: 0.2, pSpeed: 1, pSize: 0.01, swirl: 2, glowScale: 5 };
export const RED_KAME_STYLE = { core: 0xffeaea, edge: 0xff3a3a, glow: 0xff2a2a, pcol: 0xff9090, arc: 0xffc0c0, particles: 120, gatherMin: 0.15, gatherMax: 0.45, pSpeed: 1.2, pSize: 0.014, swirl: 2.5, glowScale: 5.5 };
export const CLASH_STYLE = { core: 0xffffff, edge: 0xc88cff, glow: 0xe0b0ff, pcol: 0xffffff, arc: 0xffffff, particles: 60, gatherMin: 0.3, gatherMax: 1.2, pSpeed: 3, pSize: 0.03, swirl: 4, glowScale: 6 };

export class EnergyBall {
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
    this.pPos = new Float32Array(Math.max(1, this.pn) * 3);
    this.pSpeed = new Float32Array(Math.max(1, this.pn));
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pMat = new THREE.PointsMaterial({ map: glowTex, color: o.pcol, size: o.pSize, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false });
    this.points = new THREE.Points(pg, this.pMat);
    this.points.frustumCulled = false;
    for (let i = 0; i < this.pn; i++) this.respawnParticle(i);

    this.arcMat = new THREE.LineBasicMaterial({ color: o.arc || 0xcff4ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
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

    this.points.visible = this.pn > 0 && this.gathering && this.opacity > 0.05;
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

export class Beam {
  constructor(radius, tail, core = 0xeafcff, edge = 0x3fb4ff) {
    this.mat = beamMaterial.clone();
    this.mat.uniforms.uCore.value.setHex(core);
    this.mat.uniforms.uEdge.value.setHex(edge);
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
export const boomLight = new THREE.PointLight(0xffd0a0, 0, 0, 2);
scene.add(boomLight);
const ringGeo = new THREE.RingGeometry(0.8, 1, 64);
const waveGeo = new THREE.RingGeometry(0.55, 1, 64).rotateX(-Math.PI / 2);
const fireGeo = new THREE.SphereGeometry(1, 28, 18);

const NOISE_GLSL = /* glsl */`
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }`;
// kula ognia/energii: turbulentna powierzchnia, białe jądro → kolor → ciemniejsze brzegi
const fireMaterial = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uK: { value: 0 }, uHot: { value: new THREE.Color() }, uCool: { value: new THREE.Color() }, uOpacity: { value: 1 }, uSeed: { value: 0 } },
  vertexShader: NOISE_GLSL + /* glsl */`
    uniform float uTime; uniform float uSeed;
    varying vec3 vN; varying vec3 vV; varying float vNz;
    void main() {
      float n = vnoise(position * 2.6 + vec3(uSeed, -uTime * 2.5, uSeed)) * 0.65 + vnoise(position * 6.0 + vec3(0.0, -uTime * 4.0, 0.0)) * 0.35;
      vNz = n;
      vec3 p = position + normal * (n - 0.45) * 0.55;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    uniform float uK; uniform vec3 uHot; uniform vec3 uCool; uniform float uOpacity;
    varying vec3 vN; varying vec3 vV; varying float vNz;
    void main() {
      float f = abs(dot(normalize(vN), normalize(vV)));
      float heat = clamp(f * 1.25 - uK * 1.1 + (vNz - 0.5) * 0.9 + 0.15, 0.0, 1.0);
      vec3 col = mix(uCool, uHot, heat);
      col = mix(col, vec3(1.0), pow(heat, 4.0) * (1.0 - uK));
      float a = clamp((0.2 + f * 0.8) * uOpacity * (0.5 + vNz * 0.8), 0.0, 1.0);
      gl_FragColor = vec4(col, a);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
// przezroczysta fala uderzeniowa (świeci tylko na krawędzi)
const domeMaterial = new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 1 } },
  vertexShader: /* glsl */`
    varying vec3 vN; varying vec3 vV;
    void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */`
    uniform vec3 uColor; uniform float uOpacity;
    varying vec3 vN; varying vec3 vV;
    void main() { float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float a = pow(f, 3.0) * uOpacity; gl_FragColor = vec4(uColor * (1.0 + f), a); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
// miękka tekstura dymu
const smokeTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const x = 64 + (Math.random() - 0.5) * 50, y = 64 + (Math.random() - 0.5) * 50, r = 22 + Math.random() * 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();

export class Explosion {
  // color = kolor energii, hot = kolor jądra; ground = przy ziemi (fala kurzu); smoke = słup dymu
  constructor(pos, size, { light = true, ground = false, color = 0x3aa8ff, hot = 0xd8f4ff, spark = 0xbff0ff, sparks = true, smoke, fire = true, dome, flash = 1 } = {}) {
    this.flashK = flash;
    this.size = size;
    this.t = 0;
    smoke = smoke ?? (ground || size > 0.9);
    dome = dome ?? size > 0.35;
    this.life = smoke ? 5.5 : 1.6;
    this.group = new THREE.Group();
    this.group.position.copy(pos);

    this.flashMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    this.flash = new THREE.Sprite(this.flashMat);
    this.cloudMat = new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    this.cloud = new THREE.Sprite(this.cloudMat);
    this.ringMat = new THREE.MeshBasicMaterial({ color: spark, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring2 = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring2.rotation.x = -Math.PI / 2;
    this.ring2.visible = !ground && size < 2;
    this.group.add(this.cloud, this.flash, this.ring, this.ring2);

    if (fire) {
      this.fireMat = fireMaterial.clone();
      this.fireMat.uniforms.uHot.value.setHex(hot);
      this.fireMat.uniforms.uCool.value.setHex(color);
      this.fireMat.uniforms.uSeed.value = Math.random() * 50;
      this.fire = new THREE.Mesh(fireGeo, this.fireMat);
      this.fire.renderOrder = 2;
      this.group.add(this.fire);
    }
    if (dome) {
      this.domeMat = domeMaterial.clone();
      this.domeMat.uniforms.uColor.value.setHex(spark);
      this.dome = new THREE.Mesh(fireGeo, this.domeMat);
      this.group.add(this.dome);
    }
    if (ground) {
      this.waveMat = new THREE.MeshBasicMaterial({ map: smokeTex, color: 0xd8b48a, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      this.wave = new THREE.Mesh(waveGeo, this.waveMat);
      this.wave.position.y = 0.15;
      this.group.add(this.wave);
    }

    this.n = sparks ? Math.round(30 + Math.min(size, 6) * 90) : 0;
    if (this.n) {
      this.sPos = new Float32Array(this.n * 3);
      this.sVel = new Float32Array(this.n * 3);
      for (let i = 0; i < this.n; i++) {
        randomDir(_v1).multiplyScalar((2 + Math.random() * 7) * (0.4 + size));
        this.sVel[i * 3] = _v1.x; this.sVel[i * 3 + 1] = Math.abs(_v1.y) * (ground ? 1.3 : 0.6) + 1.5; this.sVel[i * 3 + 2] = _v1.z;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3));
      this.sMat = new THREE.PointsMaterial({ map: glowTex, color: spark, size: 0.06 + size * 0.06, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      this.sparks = new THREE.Points(g, this.sMat);
      this.sparks.frustumCulled = false;
      this.group.add(this.sparks);
    }
    // słup dymu (unosi się i rozlewa jak grzyb)
    this.smoke = [];
    if (smoke) {
      const n = Math.round(6 + Math.min(size, 7) * 2.6);
      for (let i = 0; i < n; i++) {
        const m = new THREE.SpriteMaterial({ map: smokeTex, color: 0x6e5a4a, transparent: true, depthWrite: false, opacity: 0 });
        const s = new THREE.Sprite(m);
        const central = i < n * 0.45;
        const a = Math.random() * Math.PI * 2, r = Math.random() * size * 0.6;
        s.position.set(Math.cos(a) * r, size * 0.2, Math.sin(a) * r);
        s.userData = {
          vel: new THREE.Vector3(Math.cos(a) * (central ? 0.3 : 1.6), central ? rand(1.4, 2.6) : rand(0.3, 0.9), Math.sin(a) * (central ? 0.3 : 1.6)).multiplyScalar(Math.sqrt(size) * 1.2),
          life: rand(3, 5.2), s0: size * rand(0.8, 1.4), grow: size * rand(1.5, 3.2), rot: rand(-0.5, 0.5),
        };
        this.smoke.push(s);
        this.group.add(s);
      }
    }
    scene.add(this.group);
    if (light) {
      boomLight.color.setHex(hot === 0xd8f4ff ? 0xbfe6ff : hot);
      boomLight.position.copy(pos);
      boomLight.intensity = 90 * size + 15;
    }
  }
  update(dt) {
    this.t += dt;
    const t = this.t, s = this.size;
    const e = 1 - Math.pow(1 - Math.min(1, t / 0.3), 3);
    this.flash.scale.setScalar(s * (0.5 + 4 * e) * this.flashK);
    this.flashMat.opacity = Math.max(0, 1 - t / 0.35) * Math.min(1, this.flashK);
    this.cloud.scale.setScalar(s * (1 + 6 * e) * Math.max(0.4, this.flashK));
    this.cloudMat.opacity = Math.max(0, 0.9 - t / 1.1) * Math.min(1, this.flashK);
    this.ring.quaternion.copy(camera.getWorldQuaternion(_q));
    const rs = s * (0.3 + t * 10);
    this.ring.scale.setScalar(rs);
    this.ring2.scale.setScalar(rs * 1.4);
    this.ringMat.opacity = Math.max(0, 0.9 - t / 0.6);
    if (this.fire) {
      const fe = 1 - Math.pow(1 - Math.min(1, t / 0.55), 2);
      this.fire.scale.setScalar(s * (0.35 + 1.5 * fe));
      this.fire.position.y = s * 0.6 * Math.min(1, t / 1.2);
      this.fireMat.uniforms.uTime.value = t;
      this.fireMat.uniforms.uK.value = Math.min(1, t / 1.0);
      this.fireMat.uniforms.uOpacity.value = Math.max(0, 1 - t / 1.1);
      this.fire.visible = t < 1.1;
    }
    if (this.dome) {
      const de = 1 - Math.pow(1 - Math.min(1, t / 0.45), 2);
      this.dome.scale.setScalar(s * (0.6 + 6.5 * de));
      this.domeMat.uniforms.uOpacity.value = Math.max(0, 0.9 - t / 0.5);
      this.dome.visible = t < 0.5;
    }
    if (this.wave) {
      const we = 1 - Math.pow(1 - Math.min(1, t / 1.6), 2);
      this.wave.scale.setScalar(s * (1 + 10 * we));
      this.waveMat.opacity = Math.max(0, 0.75 * (1 - t / 1.8));
      this.wave.visible = t < 1.8;
    }
    if (this.n) {
      const p = this.sPos, v = this.sVel;
      const drag = Math.pow(0.4, dt);
      for (let i = 0; i < this.n * 3; i += 3) {
        v[i + 1] -= 6 * dt;
        v[i] *= drag; v[i + 1] *= drag; v[i + 2] *= drag;
        p[i] += v[i] * dt; p[i + 1] += v[i + 1] * dt; p[i + 2] += v[i + 2] * dt;
      }
      this.sparks.geometry.attributes.position.needsUpdate = true;
      this.sMat.opacity = Math.max(0, 1 - t / 1.8);
      this.sparks.visible = t < 1.8;
    }
    for (const sm of this.smoke) {
      const u = sm.userData;
      const k = Math.min(1, t / u.life);
      sm.position.addScaledVector(u.vel, dt);
      u.vel.multiplyScalar(Math.pow(0.55, dt));
      sm.scale.setScalar(u.s0 + u.grow * Math.sqrt(k));
      sm.material.rotation += u.rot * dt;
      sm.material.opacity = Math.min(1, t * 3) * 0.6 * (1 - k);
      sm.material.color.setHex(t < 0.6 ? 0x9a7656 : 0x5e534c);
    }
    return t < this.life;
  }
  dispose() {
    scene.remove(this.group);
    this.flashMat.dispose(); this.cloudMat.dispose(); this.ringMat.dispose();
    if (this.fireMat) this.fireMat.dispose();
    if (this.domeMat) this.domeMat.dispose();
    if (this.waveMat) this.waveMat.dispose();
    if (this.n) { this.sMat.dispose(); this.sparks.geometry.dispose(); }
    for (const s of this.smoke) s.material.dispose();
  }
}

// smuga za pięścią / stopą przy ciosach
export class Trail {
  constructor(color = 0xffe7a0) {
    this.items = [];
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, fog: false }));
      s.visible = false;
      scene.add(s);
      this.items.push({ s, life: 0 });
    }
    this.i = 0;
  }
  update(dt, pos, active, size = 0.12) {
    if (active) {
      const it = this.items[this.i];
      this.i = (this.i + 1) % this.items.length;
      it.s.position.copy(pos);
      it.life = 1;
      it.size = size;
      it.s.visible = true;
    }
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt * 5;
      it.s.material.opacity = Math.max(0, it.life) * 0.7;
      it.s.scale.setScalar((it.size || 0.1) * (0.5 + it.life));
      if (it.life <= 0) it.s.visible = false;
    }
  }
}

// wspólne listy efektów
export const explosions = [];
export const fading = [];
// big: wybuch od trafienia w teren/rywala — kilka razy większy błysk i kula ognia
export function boom(pos, size, opts) {
  if (opts && opts.big) size = Math.min(22, size * 4);
  const e = new Explosion(pos, size, opts);
  explosions.push(e);
  return e;
}

// smugi pędu przy turbo locie (przyczepione do kamery)
export class SpeedLines {
  constructor() {
    this.n = 90;
    this.data = [];
    const pos = new Float32Array(this.n * 6);
    for (let i = 0; i < this.n; i++) this.data.push(this.spawn({}, true));
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.lines = new THREE.LineSegments(this.geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 25;
    camera.add(this.lines);
  }
  spawn(d, initial) {
    const a = Math.random() * Math.PI * 2, r = 0.7 + Math.random() * 2.2;
    d.x = Math.cos(a) * r; d.y = Math.sin(a) * r * 0.8;
    d.z = initial ? -Math.random() * 14 : -14;
    d.len = 0.6 + Math.random() * 1.6;
    return d;
  }
  update(dt, k, speed) {
    this.mat.opacity = k * 0.55;
    this.lines.visible = k > 0.02;
    if (!this.lines.visible) return;
    const p = this.geo.attributes.position.array;
    for (let i = 0; i < this.n; i++) {
      const d = this.data[i];
      d.z += speed * dt * 1.5;
      if (d.z > 0.5) this.spawn(d, false);
      p[i * 6] = d.x; p[i * 6 + 1] = d.y; p[i * 6 + 2] = d.z;
      p[i * 6 + 3] = d.x; p[i * 6 + 4] = d.y; p[i * 6 + 5] = d.z - d.len * (0.5 + k);
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
// iskra trafienia w walce wręcz — wyraźna, ale nie zasłania widoku
export function meleeSpark(pos, power, color = 0xffffff) {
  return boom(pos, 0.12 + power * 0.22, { light: false, color, spark: color, hot: 0xffffff, fire: false, smoke: false, dome: false, flash: 0.35 });
}
// błysk teleportu
export function teleportFlash(pos) {
  return boom(pos, 0.5, { light: true, color: 0x9fdcff, hot: 0xffffff, spark: 0xe8f8ff, fire: false, smoke: false, dome: true, flash: 0.6 });
}
export function hitSpark(pos, power, color = 0xffffff) {
  return boom(pos, 0.15 + power * 0.35, { light: false, color, spark: color, hot: 0xffffff, fire: power > 0.6, smoke: false, dome: power > 0.5 });
}
export function fadeBall(ball) { if (ball) fading.push(ball); }
export function updateFx(dt, t) {
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

// ---------------------------------------------------------------------------
// Aura mocy wokół gracza — formy: 0 brak, 1 złota, 2 złota z błyskawicami, 3 wielkie płomienie
const AURA_PARTS = 300;
const FORM_COLORS = [0xffd34d, 0xffd34d, 0xffe066, 0xfff0a0];
export class Aura {
  constructor(debrisGeo, debrisMat) {
    this.level = 0;
    this.form = 0;
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

    this.pd = [];
    this.pPos = new Float32Array(AURA_PARTS * 3);
    for (let i = 0; i < AURA_PARTS; i++) this.pd.push({ a: Math.random() * 6.283, r: 0.3 + Math.random() * 0.45, y: Math.random() * 2.9, sp: 1.5 + Math.random() * 2.5 });
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pMat = new THREE.PointsMaterial({ map: glowTex, color: 0xffe07a, size: 0.05, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.points = new THREE.Points(pg, this.pMat);
    this.points.frustumCulled = false;
    this.group.add(this.points);

    this.boltMat = new THREE.LineBasicMaterial({ color: 0xe8f6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.bolts = [];
    for (let i = 0; i < 5; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(10 * 3), 3));
      const l = new THREE.Line(g, this.boltMat);
      l.frustumCulled = false;
      this.bolts.push(l);
      this.group.add(l);
    }
    this.boltT = 0;

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

  update(dt, t, head, groundY) {
    const L = this.level, F = this.form;
    this.group.visible = L > 0.01;
    for (const p of this.pebbles) p.visible = false;
    if (!this.group.visible) { this.light.intensity = 0; return; }
    const feetY = head.y - 1.62;
    this.group.position.set(head.x, feetY, head.z);
    const boost = this.powering ? 1 : 0.6;
    const big = 1 + (F >= 3 ? 0.45 : F >= 2 ? 0.2 : 0);
    this.shellMat.uniforms.uTime.value = t;
    this.shellMat.uniforms.uLevel.value = L * boost;
    this.shellMat.uniforms.uColor.value.setHex(FORM_COLORS[F]);
    this.shell.scale.set((1 + L * 0.25) * big, (1 + L * 0.15) * (F >= 3 ? 1.25 : 1), (1 + L * 0.25) * big);

    for (let i = 0; i < AURA_PARTS; i++) {
      const p = this.pd[i];
      p.y += p.sp * dt * (0.6 + L + F * 0.3);
      p.a += dt * 0.6;
      if (p.y > 2.9 * (F >= 3 ? 1.25 : 1)) { p.y = Math.random() * 0.3; p.a = Math.random() * 6.283; }
      const rr = p.r * (1 + L * 0.3) * big * (1 - p.y / 4.2);
      this.pPos[i * 3] = Math.cos(p.a) * rr;
      this.pPos[i * 3 + 1] = p.y;
      this.pPos[i * 3 + 2] = Math.sin(p.a) * rr;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.pMat.opacity = Math.min(1, L * 1.5) * boost;

    this.boltT -= dt;
    if (this.boltT <= 0) {
      this.boltT = 0.06;
      const chance = F >= 2 ? 0.25 + F * 0.15 : (L > 0.85 && this.powering ? 0.3 : 0);
      for (const b of this.bolts) {
        b.visible = Math.random() < chance;
        if (!b.visible) continue;
        const arr = b.geometry.attributes.position.array;
        const a = Math.random() * 6.283, y0 = 0.4 + Math.random() * 1.2;
        for (let k = 0; k < 10; k++) {
          const rr = 0.5 * big + (Math.random() - 0.5) * 0.25;
          const aa = a + (Math.random() - 0.5) * 0.4;
          arr[k * 3] = Math.cos(aa) * rr; arr[k * 3 + 1] = y0 + k * 0.09; arr[k * 3 + 2] = Math.sin(aa) * rr;
        }
        b.geometry.attributes.position.needsUpdate = true;
      }
    }
    this.boltMat.opacity = L;

    if (this.powering && feetY - groundY < 1.5) {
      for (const p of this.pebbles) {
        const u = p.userData;
        u.t += dt * u.sp;
        if (u.t > 3) { u.t = 0; u.a = Math.random() * 6.283; }
        p.visible = true;
        p.position.set(head.x + Math.cos(u.a) * u.r, groundY + u.t * 0.6 + Math.sin(t * 3 + u.a) * 0.05, head.z + Math.sin(u.a) * u.r);
        p.rotation.x += dt * 2; p.rotation.y += dt * 3;
      }
    }
    this.light.intensity = L * (this.powering ? 5 : 2.5);
  }
}
