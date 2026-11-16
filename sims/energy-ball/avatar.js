// Ciało gracza widoczne z pierwszej osoby: tułów, ręce (za kontrolerami), nogi (kopnięcia).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { scene, UP, glowTex, makeLimb, makeJoint, setLimb, solveIK, twoBone } from './core.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _pole = new THREE.Vector3();
const _right = new THREE.Vector3(), _q = new THREE.Quaternion();

const fistGeo = new RoundedBoxGeometry(0.085, 0.095, 0.1, 3, 0.03);
const thumbGeo = new RoundedBoxGeometry(0.03, 0.03, 0.06, 2, 0.012);
const bootGeo = new RoundedBoxGeometry(0.11, 0.1, 0.26, 3, 0.035);

const ARM_L1 = 0.29, ARM_L2 = 0.27, LEG_L1 = 0.44, LEG_L2 = 0.44;

export class Avatar {
  constructor() {
    const lam = (color) => new THREE.MeshLambertMaterial({ color, emissive: 0x000000 });
    this.suit = lam(0x22305e);
    this.skin = lam(0xe2ad85);
    this.band = lam(0xf4f4f4);
    this.boot = lam(0x2a2a32);
    this.belt = lam(0x101318);
    this.mats = [this.suit, this.skin, this.band, this.boot, this.belt];
    this.group = new THREE.Group();
    scene.add(this.group);

    this.torso = makeLimb(this.suit, 0.15);
    this.chest = makeJoint(this.suit, 0.16);
    this.waist = makeLimb(this.belt, 0.145);
    this.group.add(this.torso, this.chest, this.waist);

    this.arms = {};
    for (const side of ['left', 'right']) {
      const fistMat = this.skin.clone();
      const a = {
        upper: makeLimb(this.suit, 0.052), elbow: makeJoint(this.suit, 0.05), shoulder: makeJoint(this.suit, 0.065),
        fore: makeLimb(this.skin, 0.04), band: makeLimb(this.band, 0.047),
        fist: new THREE.Mesh(fistGeo, fistMat), fistMat,
      };
      const thumb = new THREE.Mesh(thumbGeo, fistMat);
      thumb.position.set(side === 'left' ? 0.045 : -0.045, 0.02, -0.01);
      a.fist.add(thumb);
      this.group.add(a.upper, a.elbow, a.shoulder, a.fore, a.band, a.fist);
      this.arms[side] = a;
    }
    this.legs = {};
    for (const side of ['left', 'right']) {
      const l = {
        thigh: makeLimb(this.suit, 0.075), knee: makeJoint(this.suit, 0.065), shin: makeLimb(this.suit, 0.058),
        boot: new THREE.Mesh(bootGeo, this.boot), hip: makeJoint(this.suit, 0.08),
      };
      this.group.add(l.thigh, l.knee, l.shin, l.boot, l.hip);
      this.legs[side] = l;
    }
    this.bodyFwd = new THREE.Vector3(0, 0, -1);
    this.neck = new THREE.Vector3();
    this.hips = new THREE.Vector3();
    this.footPos = { left: new THREE.Vector3(), right: new THREE.Vector3() };
    this.guardK = { left: 0, right: 0 };
    this.wrist = { left: new THREE.Vector3(), right: new THREE.Vector3() };
    this.modelMats = [];
    this.rig = null;
    this.usePrims = true;
    // blask naładowanego ciosu (pięść / stopa)
    this.glows = {};
    for (const k of ['left', 'right', 'footL', 'footR']) {
      const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false }));
      g.renderOrder = 21;
      g.visible = false;
      scene.add(g);
      this.glows[k] = g;
    }
    this.legGuardK = { left: 0, right: 0 };
    this.guardPos = new THREE.Vector3();

    // głowa — widoczna tylko w ujęciach z trzeciej osoby (własna postać: krótkie włosy, czerwona opaska)
    this.headG = new THREE.Group();
    const headM = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), this.skin);
    headM.scale.set(0.95, 1.1, 1);
    const hairMat = new THREE.MeshLambertMaterial({ color: 0x2a1c14 });
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.118, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hairMat);
    hair.position.y = 0.015; hair.scale.set(1, 1.05, 1.06);
    const bandMat = new THREE.MeshLambertMaterial({ color: 0xc8202a });
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.014, 6, 24), bandMat);
    band.rotation.x = Math.PI / 2; band.position.y = 0.03;
    const tail1 = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.12, 0.008), bandMat); tail1.position.set(0.02, -0.03, -0.12); tail1.rotation.z = 0.3;
    const tail2 = tail1.clone(); tail2.position.x = -0.02; tail2.rotation.z = -0.25;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x101010 });
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), eyeMat); e.position.set(sx * 0.038, 0.0, -0.1); this.headG.add(e); }
    this.headG.add(headM, hair, band, tail1, tail2);
    this.headG.visible = false;
    this.group.add(this.headG);
    this.primParts = this.group.children.filter(c => c !== this.headG);
  }

  // P: { head, headFwdFlat, hands: {left, right}, flyDir, kick: {left:{t,target}, right}, glow, glowColor, dt }
  // ciało gracza z modelu postaci (szkielet Mixamo). hue: przesunięcie barwy nasyconych czerwieni stroju
  setModel(scene, { hue = 0 } = {}) {
    const bones = {};
    scene.traverse((o) => {
      if (o.isBone) bones[o.name.replace(/^mixamorig[:_]?/i, '')] = o;
      if (o.isMesh) {
        o.frustumCulled = false;
        o.material = o.material.clone();
        if (hue) tintMaterial(o.material, hue);
        this.modelMats.push(o.material);
      }
    });
    const need = ['Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
    if (need.some(n => !bones[n])) return false;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const k = 1.8 / Math.max(0.01, size.y);
    scene.scale.multiplyScalar(k);
    scene.position.set(-center.x * k, -box.min.y * k, -center.z * k);
    const wrap = new THREE.Group();
    wrap.add(scene);
    this.group.add(wrap);
    wrap.updateMatrixWorld(true);
    this.neckOffset = bones.Neck.getWorldPosition(new THREE.Vector3());
    const rest = [];
    scene.traverse((o) => { if (o.isBone) rest.push([o, o.quaternion.clone()]); });
    this.rig = { bones, rest, wrap };
    // ukryj proste kształty — zostają tylko efekty
    for (const p of this.primParts) p.visible = false;
    this.usePrims = false;
    return true;
  }
  applyRig(P, fwd) {
    const { bones, rest, wrap } = this.rig;
    for (const [b, q] of rest) b.quaternion.copy(q);
    bones.Head.scale.setScalar(P.showHead ? 1 : 0.001); // z pierwszej osoby bez głowy (nie zasłania widoku)
    wrap.quaternion.setFromUnitVectors(_c.set(0, 0, 1), fwd);
    wrap.position.copy(this.neck).sub(_a.copy(this.neckOffset).applyQuaternion(wrap.quaternion));
    wrap.updateMatrixWorld(true);
    _right.crossVectors(fwd, UP).normalize();
    for (const side of ['left', 'right']) {
      const S = side === 'left' ? 'Left' : 'Right', sgn = side === 'left' ? -1 : 1;
      const h = P.hands[side];
      if (h && h.valid && this.wrist[side]) {
        _pole.copy(UP).multiplyScalar(-1).addScaledVector(_right, 0.6 * sgn).addScaledVector(fwd, -0.4);
        twoBone(bones[S + 'Arm'], bones[S + 'ForeArm'], bones[S + 'Hand'], this.wrist[side], _pole);
      }
      _pole.copy(fwd).addScaledVector(UP, 0.2);
      twoBone(bones[S + 'UpLeg'], bones[S + 'Leg'], bones[S + 'Foot'], this.footPos[side], _pole);
    }
  }

  update(P) {
    const dt = P.dt;
    // tułów obraca się za głową z opóźnieniem
    const ang = this.bodyFwd.angleTo(P.headFwdFlat);
    this.bodyFwd.lerp(P.headFwdFlat, 1 - Math.exp(-dt * (ang > 1 ? 10 : 3))).normalize();
    const fwd = this.bodyFwd;
    _right.crossVectors(fwd, UP).normalize();

    this.neck.copy(P.head).addScaledVector(UP, -0.21).addScaledVector(fwd, -0.11);
    this.hips.copy(this.neck).addScaledVector(UP, -0.56);
    setLimb(this.torso, this.neck, _a.copy(this.hips).addScaledVector(UP, 0.12));
    this.chest.position.copy(this.neck).addScaledVector(UP, -0.1);
    this.chest.scale.set(0.2, 0.14, 0.15);
    setLimb(this.waist, _a.copy(this.hips).addScaledVector(UP, 0.14), this.hips);

    // ręce
    for (const side of ['left', 'right']) {
      const a = this.arms[side], h = P.hands[side];
      const sgn = side === 'left' ? -1 : 1;
      const S = _a.copy(this.neck).addScaledVector(UP, -0.06).addScaledVector(_right, 0.2 * sgn);
      a.shoulder.position.copy(S);
      const vis = h && h.valid;
      for (const k of ['upper', 'elbow', 'fore', 'band', 'fist']) a[k].visible = !!vis;
      if (!vis) continue;
      a.fist.visible = !h.isHand;
      // garda przy bloku: ręka przechodzi w charakterystyczną pozycję dla chronionej ćwiartki
      this.guardK[side] += ((h.blockZone ? 1 : 0) - this.guardK[side]) * (1 - Math.exp(-dt * 16));
      if (this.guardK[side] > 0.01) {
        const z = h.blockZone || h.lastZone;
        const G = this.guardPos.copy(P.head);
        if (z === 'high') G.addScaledVector(UP, 0.1).addScaledVector(fwd, 0.3).addScaledVector(_right, 0.07 * sgn);
        else if (z === 'low') G.addScaledVector(UP, -0.55).addScaledVector(fwd, 0.33).addScaledVector(_right, 0.08 * sgn);
        else G.addScaledVector(_right, z === 'left' ? -0.25 : 0.25).addScaledVector(fwd, 0.22).addScaledVector(UP, -0.08);
        h.fistPos.lerp(G, this.guardK[side]);
        if (h.blockZone) h.lastZone = h.blockZone;
      }
      a.fist.position.copy(h.fistPos);
      a.fist.quaternion.copy(h.quat);
      // nadgarstek: za pięścią (w stronę łokcia)
      const W = _b.set(0, 0, 0.075).applyQuaternion(h.quat).add(h.fistPos);
      if (h.isHand) W.copy(h.wristPos);
      this.wrist[side].copy(W);
      _pole.copy(UP).multiplyScalar(-1).addScaledVector(_right, 0.6 * sgn).addScaledVector(fwd, -0.4);
      const E = solveIK(S, W, ARM_L1, ARM_L2, _pole, _c);
      setLimb(a.upper, S, E);
      a.elbow.position.copy(E);
      setLimb(a.fore, E, W);
      const bandStart = _pole.copy(W).lerp(E, 0.22);
      setLimb(a.band, bandStart, W);
      a.fistMat.emissive.copy(P.glowColor).multiplyScalar(P.glow * 0.5 + h.charge * 0.9);
      this.chargeGlow(this.glows[side], _c.copy(h.fistPos).lerp(P.head, 0.12), h.charge, P.t);
    }

    // nogi
    const flying = P.flyDir && P.flySpeed > 1;
    for (const side of ['left', 'right']) {
      const l = this.legs[side];
      const sgn = side === 'left' ? -1 : 1;
      const H = _a.copy(this.hips).addScaledVector(_right, 0.1 * sgn);
      l.hip.position.copy(H);
      const foot = this.footPos[side];
      const k = P.kick[side];
      if (flying) {
        _c.copy(P.flyDir); _c.y = 0;
        foot.copy(H).addScaledVector(UP, -0.78).addScaledVector(_c.normalize(), -0.3 * Math.min(1, P.flySpeed / 8));
      } else {
        foot.copy(H).addScaledVector(UP, -0.85).addScaledVector(fwd, 0.06).addScaledVector(_right, 0.04 * sgn);
      }
      // blok dołem: kolano w górę
      this.legGuardK[side] += ((P.legGuard && P.legGuard[side] ? 1 : 0) - this.legGuardK[side]) * (1 - Math.exp(-dt * 14));
      if (this.legGuardK[side] > 0.01) foot.lerp(_b.copy(H).addScaledVector(fwd, 0.3).addScaledVector(UP, -0.35), this.legGuardK[side]);
      if (k && k.t >= 0) {
        // kopnięcie: podciągnięcie kolana (okrężne — z boku), wyprost do celu, chwila, powrót
        const p = k.t / k.dur, h = k.hit / k.dur, hold = h + 0.12;
        const round = k.style === 'round';
        _b.copy(H).addScaledVector(UP, round ? 0.3 : 0.2);
        if (round) _b.addScaledVector(_right, 0.5 * sgn).addScaledVector(fwd, 0.05);
        else _b.addScaledVector(fwd, 0.35);
        const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
        if (p < h * 0.55) foot.lerp(_b, ease(p / (h * 0.55)));
        else if (p < h) {
          const e = ease((p - h * 0.55) / (h * 0.45));
          if (round) {
            // łuk: z boku do celu przez punkt wysunięty do przodu
            _c.copy(_b).lerp(k.target, 0.5).addScaledVector(fwd, 0.35);
            foot.copy(_b).multiplyScalar((1 - e) * (1 - e)).addScaledVector(_c, 2 * (1 - e) * e).addScaledVector(k.target, e * e);
          }
          else foot.copy(_b).lerp(k.target, e);
        } else if (p < hold) foot.copy(k.target);
        else foot.lerp(k.target, Math.max(0, 1 - (p - hold) / (1 - hold)));
      }
      _pole.copy(fwd).addScaledVector(UP, 0.2);
      const K = solveIK(H, foot, LEG_L1, LEG_L2, _pole, _c);
      setLimb(l.thigh, H, K);
      l.knee.position.copy(K);
      setLimb(l.shin, K, foot);
      l.boot.position.copy(foot);
      _b.subVectors(foot, K).normalize();
      // but: czubek do przodu, przy kopnięciu wzdłuż goleni
      _pole.copy(fwd).lerp(_b, k && k.t >= 0 ? 0.8 : 0.1).normalize();
      l.boot.quaternion.setFromUnitVectors(_c.set(0, 0, 1), _pole);
      l.boot.position.addScaledVector(_pole, 0.05);
    }

    // świecenie przy aurze / formach
    for (const m of this.mats) m.emissive.copy(P.glowColor).multiplyScalar(P.glow * 0.35);
    if (P.kickCharge) {
      this.chargeGlow(this.glows.footL, this.footPos.left, P.kickCharge.left, P.t);
      this.chargeGlow(this.glows.footR, this.footPos.right, P.kickCharge.right, P.t);
    }
    if (this.rig) {
      this.applyRig(P, fwd);
      for (const m of this.modelMats) if (m.emissive) m.emissive.copy(P.glowColor).multiplyScalar(P.glow * 0.15);
    }
    this.headG.visible = !!P.showHead && !this.rig;
    if (!this.usePrims) for (const p of this.primParts) p.visible = false;
    if (P.showHead) {
      this.headG.position.copy(P.head).addScaledVector(UP, -0.02);
      this.headG.quaternion.setFromUnitVectors(_c.set(0, 0, -1), fwd);
    }
  }
}
void _q;

// blask ładowania: biały → żółty (średni cios) → pulsujący pomarańczowy (mocny cios)
Avatar.prototype.chargeGlow = function (g, pos, c, t) {
  g.visible = c > 0.02;
  if (!g.visible) { g.material.opacity = 0; return; }
  g.position.copy(pos);
  let col = 0xffffff, size = 0.07 + c * 0.12, op = 0.35 + c * 0.4;
  if (c >= 0.7) { col = 0xff7a20; size = 0.22 + Math.sin((t || 0) * 18) * 0.04; op = 0.95; }
  else if (c >= 0.35) { col = 0xffe040; size = 0.13 + c * 0.1; op = 0.75; }
  g.material.color.setHex(col);
  g.material.opacity = op;
  g.scale.setScalar(size);
};

// przesunięcie barwy tylko mocno nasyconych czerwieni (strój), skóra i złote zdobienia bez zmian
export function tintMaterial(mat, hue) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uHue = { value: hue };
    sh.fragmentShader = 'uniform float uHue;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 c = diffuseColor.rgb;
        float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
        float sat = mx > 0.0001 ? (mx - mn) / mx : 0.0;
        float redness = smoothstep(0.0, 0.25, c.r - max(c.g, c.b) * 1.15);
        float m = smoothstep(0.45, 0.7, sat) * redness;
        const vec3 k = vec3(0.57735);
        float ca = cos(uHue), sa = sin(uHue);
        vec3 shifted = c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
        diffuseColor.rgb = mix(c, shifted, m);
      }`);
  };
  mat.needsUpdate = true;
}
