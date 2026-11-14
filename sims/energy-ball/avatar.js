// Ciało gracza widoczne z pierwszej osoby: tułów, ręce (za kontrolerami), nogi (kopnięcia).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { scene, UP, makeLimb, makeJoint, setLimb, solveIK } from './core.js';

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
  }

  // P: { head, headFwdFlat, hands: {left, right}, flyDir, kick: {left:{t,target}, right}, glow, glowColor, dt }
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
      a.fist.position.copy(h.fistPos);
      a.fist.quaternion.copy(h.quat);
      // nadgarstek: za pięścią (w stronę łokcia)
      const W = _b.set(0, 0, 0.075).applyQuaternion(h.quat).add(h.fistPos);
      if (h.isHand) W.copy(h.wristPos);
      _pole.copy(UP).multiplyScalar(-1).addScaledVector(_right, 0.6 * sgn).addScaledVector(fwd, -0.4);
      const E = solveIK(S, W, ARM_L1, ARM_L2, _pole, _c);
      setLimb(a.upper, S, E);
      a.elbow.position.copy(E);
      setLimb(a.fore, E, W);
      const bandStart = _pole.copy(W).lerp(E, 0.22);
      setLimb(a.band, bandStart, W);
      a.fistMat.emissive.copy(P.glowColor).multiplyScalar(P.glow * 0.5 + h.charge * 0.9);
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
  }
}
void _q;
