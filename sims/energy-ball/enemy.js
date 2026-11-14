// Przeciwnik: lata po kanionie, strzela, wchodzi w walkę wręcz, reaguje na ciosy,
// upada, wbija się w ściany i wraca.
import * as THREE from 'three';
import { scene, UP, glowTex, makeLimb, makeJoint, setLimb, solveIK, makeCanvasTex, rand, clamp } from './core.js';
import { heightAt, findSurface, impact, wallDecal, spawnDebris, pillarHit, isOpen, ARENA_RADIUS } from './world.js';
import { boom } from './fx.js';
import { sfx } from './audio.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _n = new THREE.Vector3(), _pn = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const Z = new THREE.Vector3(0, 0, 1);

const ZONES = ['high', 'left', 'right', 'low'];
const ZONE_NAMES = { high: 'z góry', left: 'z lewej', right: 'z prawej', low: 'dołem' };

// reakcje na trafienie: przesunięcie i obrót ciała (w układzie rywala, przód = +Z do gracza)
const REACTIONS = {
  head_back: { rx: -0.45, py: 0.05, pz: -0.18 },
  uppercut: { rx: -0.8, py: 0.35, pz: -0.1 },
  crush: { rx: 0.6, py: -0.45, pz: -0.05, knees: 0.35 },
  fold: { rx: 0.7, py: -0.1, pz: -0.3, arms: 1 },
  hookL: { ry: 0.7, rz: -0.35, px: 0.18 },
  hookR: { ry: -0.7, rz: 0.35, px: -0.18 },
};

export class Enemy {
  constructor() {
    this.root = new THREE.Group();
    this.body = new THREE.Group();      // warstwa animacji reakcji
    this.root.add(this.body);
    scene.add(this.root);
    const lam = (color, emissive = 0) => new THREE.MeshLambertMaterial({ color, emissive });
    this.armor = lam(0x8a1a32);
    this.suit = lam(0x24252d);
    this.skin = lam(0x9d8ad8);
    this.mats = [this.armor, this.suit, this.skin];
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3030 });
    const B = this.body;

    const torso = makeLimb(this.suit, 0.16); setLimb(torso, _v1.set(0, 0, 0), _v2.set(0, 0.55, 0));
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.27), this.armor); chest.position.set(0, 0.4, 0.01);
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.18, 0.1, 12), this.armor); belt.position.y = 0.03;
    const neck = makeLimb(this.skin, 0.06); setLimb(neck, _v1.set(0, 0.52, 0), _v2.set(0, 0.64, 0));
    this.head = new THREE.Group();
    this.head.position.y = 0.64;
    const headM = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 14), this.skin); headM.position.y = 0.08; headM.scale.set(1, 1.1, 1);
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.125, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), this.armor); helm.position.y = 0.1;
    this.head.add(headM, helm);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), eyeMat); eye.position.set(s * 0.043, 0.095, 0.105); eye.scale.set(1.4, 0.7, 0.5);
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16, 8), this.armor); horn.position.set(s * 0.09, 0.22, -0.02); horn.rotation.z = -s * 0.5;
      this.head.add(eye, horn);
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), this.armor); pad.position.set(s * 0.25, 0.53, 0); pad.scale.set(1, 0.7, 1);
      B.add(pad);
    }
    B.add(torso, chest, belt, neck, this.head);

    this.limbs = {};
    for (const side of ['left', 'right']) {
      const s = side === 'left' ? 1 : -1;
      const L = {
        s,
        upper: makeLimb(this.suit, 0.05), elbow: makeJoint(this.suit, 0.05), fore: makeLimb(this.skin, 0.042),
        fist: makeJoint(this.armor, 0.055),
        thigh: makeLimb(this.suit, 0.07), knee: makeJoint(this.armor, 0.065), shin: makeLimb(this.suit, 0.055),
        boot: makeJoint(this.armor, 0.07),
        fistT: new THREE.Vector3(s * 0.17, 0.45, 0.3), footT: new THREE.Vector3(s * 0.12, -0.78, -0.1),
      };
      B.add(L.upper, L.elbow, L.fore, L.fist, L.thigh, L.knee, L.shin, L.boot);
      this.limbs[side] = L;
    }

    this.auraMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xff3048, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.35, depthWrite: false });
    this.aura = new THREE.Sprite(this.auraMat);
    this.aura.position.y = 0.3; this.aura.scale.set(1.6, 2.4, 1);
    this.root.add(this.aura);

    const hb = makeCanvasTex(256, 40);
    this.hb = hb;
    this.hpSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: hb.tex, depthWrite: false, transparent: true }));
    this.hpSprite.position.y = 1.15; this.hpSprite.scale.set(0.6, 0.094, 1);
    this.root.add(this.hpSprite);

    this.markMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xff2020, blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false, depthTest: false });
    this.marker = new THREE.Sprite(this.markMat);
    this.marker.renderOrder = 20;
    scene.add(this.marker);

    this.pos = this.root.position;
    this.vel = new THREE.Vector3();
    this.level = 1;
    this.maxHp = 120;
    this.flash = 0;
    this.recoil = new THREE.Vector3();
    this.chestW = new THREE.Vector3();
    this.headW = new THREE.Vector3();
    this.reaction = null;
    this.guardT = 0;
    this.pendingLaunch = null;
    this.spawn(true);
  }

  spawn(first = false) {
    this.hp = this.maxHp;
    this.state = 'fly';
    this.timer = 0;
    this.vel.set(0, 0, 0);
    this.wp = new THREE.Vector3();
    this.wpT = 0;
    this.blastT = rand(3, 5);
    this.rushT = rand(6, 10);
    this.engageCD = 2;
    this.attack = null;
    this.atkT = rand(1, 1.6);
    this.combo = 0;
    this.meleeT = 0;
    this.spin = new THREE.Vector3();
    this.root.visible = true;
    this.root.quaternion.identity();
    this.reaction = null;
    this.pendingLaunch = null;
    if (first) this.pos.set(6, heightAt(6, -32) + 5, -32);
    else {
      for (let i = 0; i < 30; i++) {
        const a = Math.random() * Math.PI * 2, d = rand(25, 50);
        const x = Math.sin(a) * d, z = -10 + Math.cos(a) * d;
        if (isOpen(x, z, 4)) { this.pos.set(x, heightAt(x, z) + 6, z); break; }
      }
    }
    this.drawHp();
  }

  drawHp() {
    const { ctx, tex } = this.hb;
    ctx.clearRect(0, 0, 256, 40);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, 256, 40);
    ctx.fillStyle = '#ff3a4a'; ctx.fillRect(4, 4, 248 * Math.max(0, this.hp / this.maxHp), 32);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillText(`Rywal  poz. ${this.level}`, 10, 29);
    tex.needsUpdate = true;
  }

  get hittable() { return this.root.visible && this.state !== 'ko' && this.state !== 'gone'; }
  get radius() { return 0.55; }
  chest(out) { return out.set(0, 0.35, 0).applyMatrix4(this.body.matrixWorld); }

  faceTowards(target, dt, rate = 8) {
    _v1.subVectors(target, this.pos); _v1.y = 0;
    if (_v1.lengthSq() < 1e-4) return;
    _m.lookAt(_v1.normalize(), _v2.set(0, 0, 0), UP);
    _q.setFromRotationMatrix(_m);
    this.root.quaternion.slerp(_q, 1 - Math.exp(-dt * rate));
  }

  pickWaypoint(head) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, d = rand(9, 22);
      const x = head.x + Math.sin(a) * d, z = head.z + Math.cos(a) * d;
      if (Math.hypot(x, z) > ARENA_RADIUS - 8 || !isOpen(x, z, 2)) continue;
      const g = heightAt(x, z);
      this.wp.set(x, Math.max(g + 2.5, head.y + rand(-1, 6)), z);
      this.wpT = rand(2.5, 4.5);
      return;
    }
    this.wp.set(head.x, head.y + 3, head.z);
    this.wpT = 2;
  }

  // --- trafienia ---------------------------------------------------------------
  damage(d) {
    this.hp -= d;
    this.flash = 1;
    this.drawHp();
    if (this.hp <= 0 && this.state !== 'ko') {
      this.hp = 0;
      this.drawHp();
      this.state = 'ko';
      this.timer = 0;
      this.attack = null;
      this.markMat.opacity = 0;
      if (this.vel.lengthSq() < 4) this.vel.set(0, 3, 0);
      this.onKO && this.onKO();
      return true;
    }
    return false;
  }
  react(type, amp = 1) {
    if (!REACTIONS[type]) type = 'head_back';
    this.reaction = { type, t: 0, dur: 0.32 + amp * 0.18, amp };
  }
  hitByBall(dmg, dir, strong, ctx) {
    if (!this.hittable) return;
    const wasMelee = this.state === 'melee';
    if (this.damage(dmg)) { this.vel.copy(dir).multiplyScalar(strong ? 25 : 10); if (wasMelee) ctx.meleeEnd(); return; }
    this.react('head_back', strong ? 1.5 : 1);
    if (strong) this.launch(_v1.copy(dir).multiplyScalar(22).addScaledVector(UP, 4), ctx);
    else if (!wasMelee) { this.state = 'falling'; this.timer = 0; this.vel.copy(dir).multiplyScalar(8).addScaledVector(UP, -2); this.spinRandom(4); }
    else this.recoil.addScaledVector(dir, 0.25);
  }
  // cios wręcz: reakcja zależna od kierunku; przy mocnym ciosie wyrzut po krótkiej chwili
  hitMelee(dmg, dir, launchVel, ctx, reaction = 'head_back', strong = false) {
    if (!this.hittable) return;
    const wasMelee = this.state === 'melee';
    if (this.damage(dmg)) { this.vel.copy(launchVel || _v1.copy(dir).multiplyScalar(8)); if (wasMelee) ctx.meleeEnd(); return; }
    this.react(reaction, strong ? 1.7 : 1);
    this.attack = null;
    this.markMat.opacity = 0;
    if (launchVel) {
      if (wasMelee) this.pendingLaunch = { v: launchVel.clone(), t: 0.09 };
      else this.launch(launchVel, ctx);
    } else if (wasMelee) {
      this.recoil.addScaledVector(dir, strong ? 0.45 : 0.22);
      this.atkT = Math.max(this.atkT, 0.5); // chwila oszołomienia
    } else { this.state = 'falling'; this.timer = 0; this.vel.copy(dir).multiplyScalar(6); }
  }
  launch(v, ctx) {
    const wasMelee = this.state === 'melee';
    this.state = 'launched';
    this.timer = 0;
    this.vel.copy(v);
    this.attack = null;
    this.pendingLaunch = null;
    this.markMat.opacity = 0;
    this.spinRandom(10);
    if (wasMelee) ctx.meleeEnd();
    this.engageCD = 2.5;
  }
  spinRandom(s) { this.spin.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(s); }
  blocksHit(charge) {
    if (this.state !== 'melee' || this.reaction) return false;
    const b = Math.random() < (charge < 0.35 ? 0.3 : 0.1);
    if (b) this.guardT = 0.4;
    return b;
  }

  // --- fizyka lotu balistycznego i zderzenia ------------------------------------
  ballistic(dt, gravity, ctx) {
    _v3.copy(this.pos);
    this.vel.y -= gravity * dt;
    this.pos.addScaledVector(this.vel, dt);
    const speed = this.vel.length();
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > ARENA_RADIUS) { this.pos.x *= ARENA_RADIUS / r; this.pos.z *= ARENA_RADIUS / r; this.vel.x *= -0.3; this.vel.z *= -0.3; }
    if (this.pos.y - 0.3 < heightAt(this.pos.x, this.pos.z)) {
      _v2.copy(this.pos); _v2.y -= 0.3; _v3.y -= 0.3;
      const hitP = findSurface(_v3, _v2, _v1);
      this.slam(hitP, null, speed, ctx);
      return true;
    }
    if (pillarHit(this.pos, 0.35, _pn)) {
      _v1.copy(this.pos).addScaledVector(_pn, -0.2);
      this.slam(_v1, _pn, speed, ctx);
      return true;
    }
    return false;
  }
  slam(point, normalOverride, speed, ctx) {
    let n;
    if (speed > 11) {
      const R = 1.3 + speed * 0.07;
      if (normalOverride) { n = _n.copy(normalOverride); wallDecal(point, n, R * 0.9); spawnDebris(point, R, n); }
      else n = impact(point, R, _n);
      boom(point, 0.5 + speed * 0.03, { ground: n.y > 0.6, color: 0xff7a30, hot: 0xffe0a0, spark: 0xffd090 });
      sfx.explode(point, 0.6 + speed * 0.03);
      ctx.onSlam && ctx.onSlam(point, speed);
      if (this.state !== 'ko') this.damage(Math.min(25, speed * 0.4));
    } else {
      n = _n.set(0, 1, 0);
      sfx.punch(0.3, point);
    }
    if (normalOverride) n.copy(normalOverride);
    this.vel.set(0, 0, 0);
    if (this.state === 'ko') { this.pos.copy(point).addScaledVector(n, 0.25); this.lieDown(); return; }
    if (n.y > 0.6) {
      this.state = 'down';
      this.timer = 0;
      this.pos.copy(point).addScaledVector(n, 0.25);
      this.lieDown();
    } else {
      this.state = 'embedded';
      this.timer = 0;
      this.pos.copy(point).addScaledVector(n, 0.05);
      _q.setFromUnitVectors(Z, _v2.copy(n).setY(0).normalize());
      this.root.quaternion.copy(_q);
      this.wallN = n.clone();
    }
  }
  lieDown() {
    _q.setFromUnitVectors(UP, _v2.set(1, 0, 0));
    _q2.setFromAxisAngle(UP, Math.random() * 6.28);
    this.root.quaternion.copy(_q2).multiply(_q);
  }

  // --- AI ------------------------------------------------------------------------
  update(dt, t, ctx) {
    this.timer += dt;
    this.engageCD -= dt;
    this.guardT = Math.max(0, this.guardT - dt);
    this.flash = Math.max(0, this.flash - dt * 4);
    this.recoil.multiplyScalar(Math.pow(0.03, dt));
    const head = ctx.head;
    const dist = this.pos.distanceTo(head);
    const lvl = this.level;

    if (this.pendingLaunch) {
      this.pendingLaunch.t -= dt;
      if (this.pendingLaunch.t <= 0) this.launch(this.pendingLaunch.v, ctx);
    }

    switch (this.state) {
      case 'fly': {
        this.wpT -= dt;
        if (this.wpT <= 0 || this.pos.distanceTo(this.wp) < 2) this.pickWaypoint(head);
        _v1.subVectors(this.wp, this.pos).normalize().multiplyScalar(8 + lvl);
        this.vel.lerp(_v1, 1 - Math.exp(-dt * 1.5));
        this.moveFlying(dt);
        this.faceTowards(head, dt, 4);
        this.blastT -= dt;
        if (this.blastT <= 0 && dist > 6 && dist < 45) {
          this.blastT = rand(3.2, 5.5) / (1 + lvl * 0.1);
          this.limbs.right.fistT.set(-0.25, 0.5, 0.55);
          this.limbs.right.fist.getWorldPosition(_v2);
          _v1.copy(head).addScaledVector(UP, -0.2).sub(_v2).normalize();
          ctx.fireBlast(_v2.clone(), _v1.clone());
        }
        this.rushT -= dt;
        if (this.rushT <= 0) { this.state = 'rush'; this.timer = 0; }
        if (dist < 2.8 && this.engageCD <= 0) this.enterMelee(ctx);
        break;
      }
      case 'rush': {
        _v1.subVectors(head, this.pos).normalize().multiplyScalar(15 + lvl);
        this.vel.lerp(_v1, 1 - Math.exp(-dt * 3));
        this.moveFlying(dt);
        this.faceTowards(head, dt, 8);
        if (dist < 2.6) this.enterMelee(ctx);
        if (this.timer > 6) { this.state = 'fly'; this.rushT = rand(6, 10); }
        break;
      }
      case 'melee': this.updateMelee(dt, t, ctx); break;
      case 'falling':
        this.root.rotateOnAxis(_v1.copy(this.spin).normalize(), this.spin.length() * dt);
        this.ballistic(dt, 9.8, ctx);
        break;
      case 'launched':
        this.root.rotateOnAxis(_v1.copy(this.spin).normalize(), this.spin.length() * dt);
        this.vel.multiplyScalar(Math.pow(0.85, dt));
        this.ballistic(dt, this.timer > 0.35 ? 6 : 0, ctx);
        if (this.timer > 6 && this.state === 'launched') this.recover();
        break;
      case 'down':
        if (this.timer > 2.2) this.recover();
        break;
      case 'embedded':
        if (this.timer > 2.4) { this.pos.addScaledVector(this.wallN, 0.8); this.recover(); }
        break;
      case 'recover':
        this.pos.y += 4 * dt;
        this.root.quaternion.slerp(_q.identity(), 1 - Math.exp(-dt * 5));
        this.faceTowards(head, dt, 3);
        if (this.timer > 1.2) { this.state = 'fly'; this.wpT = 0; this.rushT = rand(4, 8); this.engageCD = 1.5; }
        break;
      case 'ko':
        if (this.vel.lengthSq() > 0.01) this.ballistic(dt, 9.8, ctx);
        if (this.timer > 3) {
          boom(this.pos, 1.4, { color: 0xff4060, hot: 0xffd0d0, spark: 0xffc0c0 });
          sfx.explode(this.pos, 1.4);
          this.root.visible = false;
          this.state = 'gone';
          this.timer = 0;
        }
        break;
      case 'gone':
        if (this.timer > 3) { this.level++; this.maxHp = 120 + (this.level - 1) * 30; this.spawn(); }
        break;
    }
    this.pose(dt, t, ctx);
  }

  moveFlying(dt) {
    this.pos.addScaledVector(this.vel, dt);
    const g = heightAt(this.pos.x, this.pos.z);
    _v2.copy(this.pos).addScaledVector(this.vel, 0.7);
    if (heightAt(_v2.x, _v2.z) > this.pos.y - 1) this.vel.y += 25 * dt;
    if (this.pos.y < g + 1.3) this.pos.y += (g + 1.3 - this.pos.y) * (1 - Math.exp(-dt * 8));
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > ARENA_RADIUS - 4) { this.pos.x *= (ARENA_RADIUS - 4) / r; this.pos.z *= (ARENA_RADIUS - 4) / r; }
    if (pillarHit(this.pos, 0.6, _n)) this.pos.addScaledVector(_n, 0.3);
    this.pos.y = Math.min(this.pos.y, 80);
  }

  recover() { this.state = 'recover'; this.timer = 0; this.vel.set(0, 0, 0); this.reaction = null; }

  enterMelee(ctx) {
    this.state = 'melee';
    this.timer = 0;
    this.meleeT = 0;
    this.atkT = rand(0.9, 1.4);
    this.attack = null;
    this.combo = 0;
    this.vel.set(0, 0, 0);
    ctx.meleeStart();
  }
  leaveMelee(ctx) {
    this.state = 'fly';
    this.attack = null;
    this.pendingLaunch = null;
    this.markMat.opacity = 0;
    this.engageCD = 4;
    this.wpT = 0;
    ctx.meleeEnd();
  }

  attackPoint(zone, ctx, out) {
    out.copy(ctx.head);
    switch (zone) {
      case 'high': return out.addScaledVector(UP, 0.08).addScaledVector(ctx.bodyFwd, 0.28);
      case 'left': return out.addScaledVector(ctx.right, -0.3).addScaledVector(UP, -0.12).addScaledVector(ctx.bodyFwd, 0.18);
      case 'right': return out.addScaledVector(ctx.right, 0.3).addScaledVector(UP, -0.12).addScaledVector(ctx.bodyFwd, 0.18);
      default: return out.addScaledVector(UP, -0.55).addScaledVector(ctx.bodyFwd, 0.32);
    }
  }

  updateMelee(dt, t, ctx) {
    this.meleeT += dt;
    // ruch w walce: krążenie na boki, kołysanie, odskok po trafieniu
    const sway = Math.sin(this.meleeT * 1.3) * 0.32 + Math.sin(this.meleeT * 3.1) * 0.06;
    const dash = this.attack && !this.attack.struck ? -0.15 * Math.min(1, this.attack.t / this.attack.dur) : 0;
    _v1.copy(ctx.anchor || ctx.head).addScaledVector(ctx.bodyFwd, 1.25 + dash).addScaledVector(ctx.right, sway)
      .addScaledVector(UP, -0.68 + Math.sin(this.meleeT * 2.4) * 0.05).add(this.recoil);
    const g = heightAt(_v1.x, _v1.z);
    if (_v1.y < g + 0.85) _v1.y = g + 0.85;
    this.pos.lerp(_v1, 1 - Math.exp(-dt * 7));
    this.faceTowards(ctx.head, dt, 10);
    if (this.pendingLaunch) return;
    if (this.pos.distanceTo(ctx.head) > 4.5 || this.meleeT > 30) { this.leaveMelee(ctx); return; }

    const tele = Math.max(0.42, 0.8 - this.level * 0.05) * (this.combo > 0 ? 0.7 : 1);
    if (!this.attack) {
      this.atkT -= dt;
      if (this.atkT <= 0 && !this.reaction) {
        const zone = ZONES[Math.floor(Math.random() * ZONES.length)];
        const hand = zone === 'left' ? 'right' : zone === 'right' ? 'left' : (Math.random() < 0.5 ? 'left' : 'right');
        this.attack = { zone, t: 0, dur: tele, hand, struck: false };
        if (this.combo === 0 && Math.random() < 0.25 + this.level * 0.05) this.combo = 1 + Math.floor(Math.random() * 2);
        sfx.warn();
        ctx.announce && ctx.announce(`Cios ${ZONE_NAMES[zone]}! Blokuj (X/A)`);
      }
    } else {
      const A = this.attack;
      A.t += dt;
      const target = this.attackPoint(A.zone, ctx, _v2);
      this.marker.position.copy(target);
      const k = Math.min(1, A.t / A.dur);
      this.marker.scale.setScalar(0.12 + 0.18 * k);
      this.markMat.opacity = 0.35 + 0.5 * k * (0.6 + 0.4 * Math.sin(A.t * 40));
      if (!A.struck && A.t >= A.dur) {
        A.struck = true;
        this.markMat.opacity = 0;
        if (ctx.checkBlock(target)) {
          ctx.onBlocked(target.clone());
          this.recoil.addScaledVector(ctx.bodyFwd, 0.3);
          this.react('head_back', 0.6);
          this.combo = 0;
        } else {
          ctx.hurtPlayer(7 + this.level * 1.5, target.clone());
        }
      }
      if (A.t > A.dur + 0.22) {
        this.attack = null;
        if (this.combo > 0) { this.combo--; this.atkT = 0.12; }
        else this.atkT = rand(0.9, 1.8) / (1 + this.level * 0.08);
      }
    }
  }

  // --- animacja proceduralna ----------------------------------------------------
  pose(dt, t, ctx) {
    const st = this.state;
    const lerpK = 1 - Math.exp(-dt * 12);

    // warstwa reakcji (ciało odchyla się, kuli, skręca)
    let R = null, amp = 0;
    if (this.reaction) {
      const r = this.reaction;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) this.reaction = null;
      else { R = REACTIONS[r.type]; amp = r.amp * (k < 0.15 ? k / 0.15 : Math.pow(1 - (k - 0.15) / 0.85, 1.5)); }
    }
    const tgt = _e.set(R ? (R.rx || 0) * amp : 0, R ? (R.ry || 0) * amp : 0, R ? (R.rz || 0) * amp : 0);
    _q.setFromEuler(tgt);
    this.body.quaternion.slerp(_q, R ? 0.6 : lerpK);
    _v3.set(R ? (R.px || 0) * amp : 0, R ? (R.py || 0) * amp : 0, R ? (R.pz || 0) * amp : 0);
    this.body.position.lerp(_v3, R ? 0.6 : lerpK);
    this.head.rotation.x = R ? (R.rx || 0) * amp * 0.6 : this.head.rotation.x * (1 - lerpK);

    for (const side of ['left', 'right']) {
      const L = this.limbs[side], s = L.s;
      const fist = _v1, foot = _v2;
      let snap = false;
      if (st === 'embedded' || st === 'down' || st === 'ko') {
        fist.set(s * 0.6, 0.55, -0.05); foot.set(s * 0.35, -0.7, 0);
      } else if (st === 'launched' || st === 'falling') {
        fist.set(s * 0.45, 0.75, -0.1); foot.set(s * 0.25, -0.7, -0.2);
      } else if (st === 'melee') {
        fist.set(s * 0.17, 0.48 + Math.sin(t * 5 + s) * 0.03, 0.3);
        foot.set(s * 0.13, -0.78, 0.05);
        if (this.guardT > 0) fist.set(-s * 0.04, 0.62, 0.3); // garda: skrzyżowane ręce
        if (R && R.arms) fist.set(s * 0.25, 0.15, 0.15);
        if (R && R.knees) foot.y += R.knees * amp;
        const A = this.attack;
        if (A && A.hand === side) {
          const k = A.t / A.dur;
          if (k < 1) {
            const wind = A.zone === 'high' ? _v3.set(s * 0.25, 0.85, -0.15) : A.zone === 'low' ? _v3.set(s * 0.3, 0.15, -0.15) : _v3.set(s * 0.4, 0.5, -0.2);
            fist.lerp(wind, Math.min(1, k * 1.6));
          } else {
            this.root.worldToLocal(this.attackPoint(A.zone, ctx, _v3));
            fist.copy(_v3).clampLength(0, 1.4);
            fist.y = clamp(fist.y, -0.2, 1.0);
            snap = true;
          }
        }
      } else {
        fist.set(s * 0.22, 0.25, 0.12); foot.set(s * 0.12, -0.75, -0.25);
      }
      L.fistT.lerp(fist, snap ? 1 : lerpK);
      L.footT.lerp(foot, lerpK);
      const S = _v3.set(s * 0.24, 0.5, 0);
      const E = solveIK(S, L.fistT, 0.28, 0.27, _n.set(s * 0.6, -1, -0.5), new THREE.Vector3());
      setLimb(L.upper, S, E); L.elbow.position.copy(E); setLimb(L.fore, E, L.fistT); L.fist.position.copy(L.fistT);
      const H = new THREE.Vector3(s * 0.1, -0.02, 0);
      const K = solveIK(H, L.footT, 0.42, 0.42, _n.set(0, 0.2, 1), new THREE.Vector3());
      setLimb(L.thigh, H, K); L.knee.position.copy(K); setLimb(L.shin, K, L.footT); L.boot.position.copy(L.footT);
    }
    const flying = st === 'fly' || st === 'rush';
    this.auraMat.opacity = flying ? 0.35 + (st === 'rush' ? 0.3 : 0) : st === 'melee' ? 0.25 : 0.1;
    for (const m of this.mats) m.emissive.setRGB(this.flash, this.flash * 0.9, this.flash * 0.8);
    this.hpSprite.visible = this.root.visible && st !== 'gone' && st !== 'melee';
    this.root.updateMatrixWorld();
    this.chest(this.chestW);
    this.headW.set(0, 0.72, 0).applyMatrix4(this.body.matrixWorld);
  }
}
