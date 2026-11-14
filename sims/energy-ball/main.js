// Kula Energii — arena w kanionie (WebXR, Meta Quest, kontrolery lub dłonie)
//
// Poza walką:
//   • chwyt jednej ręki → kula w tej dłoni, puść → strzał
//   • chwyt obu + dłonie blisko → fala energii, puść → strzał
//   • chwyt obu + ręce w górę → wielka kula nad głową, puść → rzut
//   • chwyt obu + ręce w dół → ładowanie aury
//   • oba spusty → lot w kierunku, w który celujesz
// W walce wręcz (włącza się sama, gdy jesteś blisko rywala):
//   • spust → pięść, chwyt → kopnięcie (im dłużej trzymasz, tym mocniej; cios wychodzi po puszczeniu)
//   • X / A → blok ręką (trzymaj ją tam, skąd leci cios)
//   • oba spusty z rękami w górze, puść ruchem w dół → młot

import * as THREE from 'three';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { renderer, scene, rig, camera, state, UP, clamp, rand, makeCanvasTex, glowTex } from './core.js';
import { sfx, HUM_KAME, HUM_SMALL, HUM_GIANT, HUM_AURA } from './audio.js';
import { EnergyBall, Beam, KAME_STYLE, SMALL_STYLE, GIANT_STYLE, RED_STYLE, Aura, boom, hitSpark, fadeBall, updateFx } from './fx.js';
import { heightAt, findSurface, impact, pillarHit, wallDecal, spawnDebris, updateWorld, setWorldMode, debrisGeo, debrisMat, isOpen, ARENA_RADIUS } from './world.js';
import { Avatar } from './avatar.js';
import { Enemy } from './enemy.js';

const CFG = {
  closeDist: 0.25,       // dłonie bliżej → fala energii zamiast dwóch kul
  keepDist: 0.45,
  fizzleTime: 0.55,
  kameTime: 2.5,
  smallTime: 1.3,
  minKame: 0.12,
  upAbove: 0.1,          // dłonie wyżej niż głowa + tyle = "ręce w górę"
  downBelow: 0.5,        // dłonie niżej niż głowa − tyle = "ręce w dół"
  giantGrow: 0.55,
  giantMax: 6,
  giantMin: 0.6,
  punchTime: 1.0,        // czas do pełnej mocy ciosu
  kickTime: 1.2,
  reach: 2.4,            // zasięg ciosów od głowy do klatki rywala
  aim: THREE.MathUtils.degToRad(12),
  aimEnemy: THREE.MathUtils.degToRad(18),
  flySpeeds: [7, 10, 13, 16],
  formMul: [1, 1.3, 1.6, 2],
  sizeMul: [1, 1.15, 1.3, 1.5],
  formBase: [0, 0.55, 0.8, 1],
};

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const clock = new THREE.Clock();
const GOLD = new THREE.Color(0xffb020);

// ---------------------------------------------------------------------------
// Kamera na komputerze
// ---------------------------------------------------------------------------
const desk = { yaw: 0, pitch: -0.05 };
function applyDesktopCamera() {
  camera.position.set(0, 1.6, 0);
  camera.rotation.set(desk.pitch, desk.yaw, 0, 'YXZ');
}
applyDesktopCamera();
const START = new THREE.Vector3(0, heightAt(0, 0), 0);
rig.position.copy(START);

// ---------------------------------------------------------------------------
// Wejście (kontrolery / dłonie / klawiatura)
// ---------------------------------------------------------------------------
const handFactory = new XRHandModelFactory();
function makeInput(i) {
  const controller = renderer.xr.getController(i);
  const grip = renderer.xr.getControllerGrip(i);
  const hand = renderer.xr.getHand(i);
  rig.add(controller, grip, hand);
  hand.add(handFactory.createHandModel(hand, 'mesh'));
  const st = {
    i, controller, grip, hand,
    connected: false, isHand: false, handedness: i === 0 ? 'left' : 'right', gamepad: null,
    valid: false, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), aim: new THREE.Vector3(0, 0, -1),
    wrist: new THREE.Vector3(), vel: new THREE.Vector3(), hist: [],
    trig: false, grp: false, blk: false, back: false, pTrig: false, pGrp: false, pBack: false,
    selecting: false, blocking: false,
    ball: null, ballC: 0, ballHum: null,
    punchC: -1, kickC: -1,
    strike: { t: -1, target: new THREE.Vector3(), hit: true, kind: '', c: 0, hitAt: 0.07 },
    kick: { t: -1, target: new THREE.Vector3() },
    turnLatch: false, deskLocal: new THREE.Vector3(i === 0 ? -0.2 : 0.2, -0.3, -0.42),
  };
  controller.addEventListener('connected', (e) => {
    st.connected = true;
    st.isHand = !!e.data.hand;
    st.handedness = e.data.handedness;
    st.gamepad = e.data.gamepad || null;
    st.hist.length = 0;
  });
  controller.addEventListener('disconnected', () => { st.connected = false; st.valid = false; st.selecting = false; st.hist.length = 0; });
  controller.addEventListener('selectstart', () => { st.selecting = true; });
  controller.addEventListener('selectend', () => { st.selecting = false; });
  return st;
}
const inputs = [makeInput(0), makeInput(1)];
const side = (s) => inputs.find(st => st.handedness === s) || (s === 'left' ? inputs[0] : inputs[1]);

const _w = new THREE.Vector3(), _m = new THREE.Vector3(), _tip = new THREE.Vector3();
function readXRInput(st) {
  st.valid = false;
  if (!st.connected) return;
  st.controller.getWorldQuaternion(_q);
  st.aim.set(0, 0, -1).applyQuaternion(_q);
  if (st.isHand) {
    const j = st.hand.joints;
    const w = j['wrist'], mid = j['middle-finger-phalanx-proximal'];
    if (!(w && mid && w.visible && mid.visible && st.hand.visible)) return;
    w.getWorldPosition(_w); mid.getWorldPosition(_m);
    let sum = 0, cnt = 0;
    for (const n of ['index-finger-tip', 'middle-finger-tip', 'ring-finger-tip']) {
      if (j[n] && j[n].visible) { j[n].getWorldPosition(_tip); sum += _tip.distanceTo(_w); cnt++; }
    }
    st.wrist.copy(_w);
    st.pos.addVectors(_w, _m).multiplyScalar(0.5);
    w.getWorldQuaternion(st.quat);
    st.trig = st.selecting;
    st.grp = cnt > 0 && sum / cnt < 0.11; // pięść = chwyt
    st.blk = false; st.back = false;
    st.valid = true;
  } else if (st.grip.visible) {
    st.grip.getWorldPosition(st.pos);
    st.grip.getWorldQuaternion(st.quat);
    const b = st.gamepad ? st.gamepad.buttons : [];
    st.trig = !!(b[0] && b[0].pressed);
    st.grp = !!(b[1] && b[1].pressed);
    st.blk = !!(b[4] && b[4].pressed);   // X (lewy) / A (prawy)
    st.back = !!(b[5] && b[5].pressed);  // Y (lewy) / B (prawy)
    st.valid = true;
  }
}

// --- klawiatura (podgląd na komputerze) ---
const keys = {};
const DESK_POSES = {
  neutral: [-0.2, -0.3, -0.42, 0.2, -0.3, -0.42],
  together: [-0.06, -0.28, -0.4, 0.06, -0.28, -0.4],
  up: [-0.22, 0.38, -0.15, 0.22, 0.38, -0.15],
  down: [-0.3, -0.78, -0.02, 0.3, -0.78, -0.02],
};
function readDeskInput(st, dt) {
  const left = st.i === 0;
  st.handedness = left ? 'left' : 'right';
  st.isHand = false;
  st.valid = true;
  const pose = keys.Space || keys.Digit1 ? 'together' : keys.Digit2 ? 'up' : keys.Digit3 ? 'down' : 'neutral';
  const P = DESK_POSES[pose], o = left ? 0 : 3;
  st.deskLocal.lerp(_v1.set(P[o], P[o + 1], P[o + 2]), 1 - Math.exp(-dt * 10));
  st.pos.copy(F.head).addScaledVector(F.right, st.deskLocal.x).addScaledVector(UP, st.deskLocal.y).addScaledVector(F.fwdFlat, -st.deskLocal.z);
  camera.getWorldQuaternion(st.quat);
  st.aim.copy(F.fwd);
  st.trig = !!keys[left ? 'KeyQ' : 'KeyE'];
  st.grp = !!(keys[left ? 'KeyA' : 'KeyD'] || keys.Space);
  st.blk = !!keys[left ? 'KeyZ' : 'KeyC'];
  st.back = false;
}

function trackVelocity(st, now) {
  if (!st.valid) { st.hist.length = 0; st.vel.set(0, 0, 0); return; }
  st.hist.push({ t: now, p: st.pos.clone() });
  while (st.hist.length > 2 && now - st.hist[0].t > 0.1) st.hist.shift();
  const h0 = st.hist[0], dt = now - h0.t;
  if (dt > 0.02) st.vel.subVectors(st.pos, h0.p).divideScalar(dt); else st.vel.set(0, 0, 0);
}

function pulse(st, intensity, ms) {
  const a = st && st.gamepad && st.gamepad.hapticActuators && st.gamepad.hapticActuators[0];
  if (a && a.pulse) a.pulse(Math.min(1, intensity), ms).catch(() => {});
}
function pulseAll(i, ms) { for (const st of inputs) pulse(st, i, ms); }

// dane klatki
const F = {
  head: new THREE.Vector3(), fwd: new THREE.Vector3(), fwdFlat: new THREE.Vector3(), right: new THREE.Vector3(),
  d: Infinity, mid: new THREE.Vector3(), vm: new THREE.Vector3(), up: false, downApart: false,
};
function computeHead() {
  camera.getWorldPosition(F.head);
  camera.getWorldDirection(F.fwd);
  F.fwdFlat.set(F.fwd.x, 0, F.fwd.z);
  if (F.fwdFlat.lengthSq() < 1e-4) F.fwdFlat.set(0, 0, -1);
  F.fwdFlat.normalize();
  F.right.crossVectors(F.fwdFlat, UP).normalize();
}
function computeHands() {
  const a = side('left'), b = side('right');
  F.up = F.downApart = false;
  F.d = Infinity;
  if (a.valid && b.valid) {
    F.d = a.pos.distanceTo(b.pos);
    F.mid.addVectors(a.pos, b.pos).multiplyScalar(0.5);
    F.vm.addVectors(a.vel, b.vel).multiplyScalar(0.5);
    const hy = F.head.y;
    F.up = a.pos.y > hy + CFG.upAbove && b.pos.y > hy + CFG.upAbove;
    F.downApart = a.pos.y < hy - CFG.downBelow && b.pos.y < hy - CFG.downBelow && F.d > 0.25;
  } else F.vm.set(0, 0, 0);
}

// ---------------------------------------------------------------------------
// Gracz: życie, ki, formy, komunikaty
// ---------------------------------------------------------------------------
const P = { hp: 100, maxHp: 100, ki: 0, form: 0, inMelee: false, flash: 0, flashColor: new THREE.Color(1, 0, 0), msg: '', msgT: 0 };
const stats = { hits: 0, shots: 0, kos: 0, craters: 0 };
function msg(text, time = 1.6) { P.msg = text; P.msgT = time; }
const formMul = () => CFG.formMul[P.form];
const sizeMul = () => CFG.sizeMul[P.form];

const aura = new Aura(debrisGeo, debrisMat);
const avatar = new Avatar();
const FLY = { speed: 0, dir: new THREE.Vector3(0, 0, -1), want: false };

function addKi(x) {
  if (P.form >= 3) { P.ki = Math.min(1, P.ki + x); return; }
  P.ki += x;
  if (P.ki >= 1) { P.ki = 0; transform(P.form + 1); }
}
function transform(n) {
  P.form = n;
  aura.form = n;
  aura.level = 1;
  const feet = _v1.copy(F.head); feet.y = heightAt(feet.x, feet.z);
  const near = F.head.y - feet.y < 3;
  boom(near ? feet : _v2.copy(F.head).addScaledVector(UP, -1), 1.4 + n * 0.5, { color: 0xffc040, spark: 0xfff0a0, ground: near });
  if (near) impact(feet, 2 + n, _n);
  sfx.transform(n);
  P.flash = 0.8; P.flashColor.setHex(0xffd060);
  pulseAll(1, 500);
  msg(`FORMA ${n}!  Siła ×${CFG.formMul[n]}`, 2.5);
  if (enemy.hittable && (enemy.state === 'melee' || enemy.chestW.distanceTo(F.head) < 4)) {
    _v1.subVectors(enemy.chestW, F.head).setY(0).normalize().multiplyScalar(22).addScaledVector(UP, 6);
    enemy.launch(_v1.clone(), ctx);
  }
}
function hurtPlayer(dmg) {
  P.hp -= dmg;
  P.flash = 0.7; P.flashColor.setHex(0xff2020);
  sfx.hurt();
  pulseAll(1, 180);
  if (P.hp <= 0) {
    P.hp = P.maxHp;
    P.ki = 0;
    msg('Padłeś! Wracasz na start', 2.5);
    if (enemy.state === 'melee') enemy.leaveMelee(ctx);
    resetRig();
  } else msg('Trafiony!', 0.8);
}
function resetRig() {
  rig.position.copy(START);
  rig.rotation.set(0, 0, 0);
  FLY.speed = 0;
}

// ---------------------------------------------------------------------------
// Przeciwnik i kontekst dla jego AI
// ---------------------------------------------------------------------------
const enemy = new Enemy();
const eShots = [];
const ctx = {
  head: F.head,
  bodyFwd: avatar.bodyFwd,
  right: new THREE.Vector3(),
  checkBlock(point) {
    if (!renderer.xr.isPresenting) return !!(keys.KeyZ || keys.KeyC);
    return inputs.some(st => st.blocking && st.pos.distanceTo(point) < 0.42);
  },
  onBlocked(point) {
    sfx.block(point);
    hitSpark(point, 0.4, 0xfff0c0);
    addKi(0.04);
    pulseAll(0.5, 60);
    msg('Blok!', 0.8);
  },
  hurtPlayer(dmg) { hurtPlayer(dmg); },
  fireBlast(origin, dir) {
    const b = new EnergyBall(RED_STYLE);
    b.radius = 0.14; b.power = 0.5; b.gathering = false;
    b.group.position.copy(origin);
    eShots.push({ ball: b, vel: dir.multiplyScalar(12 + enemy.level), age: 0 });
    sfx.smallShot();
  },
  meleeStart() {
    P.inMelee = true;
    FLY.speed = 0;
    if (K.mode === 'single' || K.mode === 'giant' || K.mode === 'aura') { cancelKi(); K.mode = 'wait'; }
    msg('WALKA WRĘCZ!', 1.5);
    sfx.warn();
  },
  meleeEnd() { P.inMelee = false; },
  announce(text) { if (P.msgT <= 0.3) msg(text, 0.7); },
};
enemy.onKO = () => { stats.kos++; P.inMelee = false; addKi(0.3); msg('NOKAUT!', 2.5); };

// ---------------------------------------------------------------------------
// Ataki energią
// ---------------------------------------------------------------------------
const K = { mode: 'none', kame: null, kameC: 0, apartT: 0, hum: null, full: false, giant: null, giantHum: null, auraHum: null };
const projectiles = [];
const beams = [];

function aimAssist(dir, origin) {
  let best = null, bestAng = Infinity;
  const consider = (p, maxAng) => {
    _v1.subVectors(p, origin).normalize();
    const ang = Math.acos(clamp(_v1.dot(dir), -1, 1));
    if (ang < maxAng && ang < bestAng) { bestAng = ang; best = p; }
  };
  if (enemy.hittable) consider(enemy.chestW, CFG.aimEnemy);
  for (const t of targets) if (t.alive) consider(t.group.position, CFG.aim);
  if (best) dir.lerp(_v1.subVectors(best, origin).normalize(), 0.75).normalize();
  return dir;
}

function stopHum(h) { if (h) h.stop(); return null; }
function fizzleBall(ball) {
  if (!ball) return;
  boom(ball.group.position, Math.max(0.12, ball.radius), { light: false });
  fadeBall(ball);
  sfx.fizzle();
}
function cancelKi() {
  for (const st of inputs) { if (st.ball) { fizzleBall(st.ball); st.ball = null; st.ballHum = stopHum(st.ballHum); } }
  if (K.kame) { fizzleBall(K.kame); K.kame = null; }
  if (K.giant) { fizzleBall(K.giant); K.giant = null; }
  K.hum = stopHum(K.hum); K.giantHum = stopHum(K.giantHum); K.auraHum = stopHum(K.auraHum);
  aura.powering = false;
}
// scal kule z obu dłoni (zwraca największe naładowanie)
function mergeSingles() {
  let c = 0;
  for (const st of inputs) {
    if (st.ball) { c = Math.max(c, st.ballC); fadeBall(st.ball); st.ball = null; st.ballHum = stopHum(st.ballHum); }
  }
  return c;
}

// --- kula z jednej dłoni ---
function updateSingle(st, dt) {
  if (st.grp && st.valid) {
    if (!st.ball) {
      st.ball = new EnergyBall(SMALL_STYLE);
      st.ball.radius = 0.01;
      st.ballC = 0;
      st.ballHum = sfx.hum(HUM_SMALL);
      st.ball.group.position.copy(st.pos);
    }
    st.ballC = Math.min(1, st.ballC + dt * (1 + P.form * 0.3) / CFG.smallTime);
    const b = st.ball;
    b.radius = THREE.MathUtils.lerp(b.radius, (0.03 + 0.07 * st.ballC) * sizeMul(), 1 - Math.exp(-dt * 10));
    b.power = st.ballC;
    b.group.position.lerp(_v1.copy(st.pos).addScaledVector(st.aim, 0.06 + b.radius), 1 - Math.exp(-dt * 30));
    if (st.ballHum) st.ballHum.update(st.ballC);
  } else if (st.ball) {
    const b = st.ball, c = st.ballC;
    st.ball = null;
    st.ballHum = stopHum(st.ballHum);
    if (c < 0.1) { fizzleBall(b); return; }
    b.gathering = false;
    const dir = aimAssist(st.aim.clone(), b.group.position);
    projectiles.push({ kind: 'small', ball: b, vel: dir.multiplyScalar(20 + c * 6), charge: c, age: 0, origin: b.group.position.clone(), prev: new THREE.Vector3() });
    stats.shots++;
    sfx.smallShot();
    pulse(st, 0.4 + c * 0.4, 80);
  }
}

// --- fala energii (obie dłonie razem) ---
function startKame(c0) {
  K.kame = new EnergyBall(KAME_STYLE);
  K.kame.radius = 0.02;
  K.kame.group.position.copy(F.mid);
  K.kameC = c0 * 0.5;
  K.apartT = 0;
  K.full = false;
  K.hum = sfx.hum(HUM_KAME);
}
function kameRadius(c) { return (0.035 + 0.15 * Math.pow(c, 0.8)) * sizeMul(); }
function updateKame(dt) {
  const b = K.kame;
  if (F.d < CFG.keepDist) {
    K.apartT = 0;
    K.kameC = Math.min(1, K.kameC + dt * (1 + P.form * 0.35) / CFG.kameTime);
    b.group.position.lerp(F.mid, 1 - Math.exp(-dt * 25));
    b.radius = THREE.MathUtils.lerp(b.radius, kameRadius(K.kameC), 1 - Math.exp(-dt * 10));
    b.power = K.kameC;
    b.opacity = 1;
    if (K.kameC >= 1 && !K.full) { K.full = true; sfx.ding(); pulseAll(0.3, 60); }
  } else {
    K.apartT += dt;
    b.group.position.lerp(F.mid, 1 - Math.exp(-dt * 10));
    b.radius *= Math.pow(0.4, dt);
    b.opacity = Math.max(0.2, 1 - K.apartT / CFG.fizzleTime);
    if (K.apartT > CFG.fizzleTime) { fizzleBall(b); K.kame = null; K.hum = stopHum(K.hum); K.mode = 'wait'; return; }
  }
  if (K.hum) K.hum.update(K.kameC, K.apartT > 0 ? 0.5 : 1);
}
function fireKame() {
  const b = K.kame, c = K.kameC;
  K.kame = null;
  K.hum = stopHum(K.hum);
  if (!b) return;
  if (c < CFG.minKame) { fizzleBall(b); return; }
  const L = side('left'), R = side('right');
  const dir = _v1.addVectors(L.aim, R.aim);
  if (dir.lengthSq() < 0.1) dir.copy(F.fwd);
  dir.normalize().lerp(F.fwd, 0.3).normalize();
  const origin = b.group.position.clone();
  const d = dir.clone();
  aimAssist(d, origin);
  b.gathering = false;
  b.power = Math.max(b.power, 0.4);
  const speed = 10 + c * 9;
  const beam = new Beam(b.radius * 0.8, origin);
  const p = { kind: 'kame', ball: b, beam, vel: d.multiplyScalar(speed), speed, charge: c, age: 0, origin, prev: new THREE.Vector3() };
  projectiles.push(p);
  beams.push({ beam, proj: p, age: 0 });
  stats.shots++;
  sfx.fire(c);
  pulseAll(0.6 + c * 0.4, 150 + c * 200);
}

// --- wielka kula (ręce w górę) ---
function giantPos(out) {
  const r = K.giant ? K.giant.radius : 0.3;
  return out.copy(F.head).addScaledVector(F.fwdFlat, 0.4 + r * 0.3).addScaledVector(UP, 0.7 + r);
}
function startGiant() {
  K.giant = new EnergyBall(GIANT_STYLE);
  K.giant.radius = 0.15;
  giantPos(K.giant.group.position);
  K.giantHum = sfx.hum(HUM_GIANT);
}
function growGiant(dt) {
  const b = K.giant;
  const max = CFG.giantMax * sizeMul();
  b.radius = Math.min(max, b.radius + dt * CFG.giantGrow * (1 + P.form * 0.4) * (0.6 + b.radius * 0.25));
  b.power = b.radius / max;
  b.group.position.lerp(giantPos(_v3), 1 - Math.exp(-dt * 4));
  if (K.giantHum) K.giantHum.update(b.power);
  if (Math.random() < dt * 4) pulseAll(0.15 + b.power * 0.3, 40);
}
function throwGiant() {
  const b = K.giant;
  K.giant = null;
  K.giantHum = stopHum(K.giantHum);
  if (!b) return;
  if (b.radius < CFG.giantMin) { fizzleBall(b); return; }
  b.gathering = false;
  const dir = F.fwd.clone();
  if (dir.y > 0.2) dir.y = 0.2;
  dir.normalize();
  aimAssist(dir, b.group.position);
  projectiles.push({ kind: 'giant', ball: b, beam: null, vel: dir.multiplyScalar(8 + P.form * 2), speed: 8, charge: b.power, age: 0, origin: b.group.position.clone(), prev: new THREE.Vector3() });
  stats.shots++;
  sfx.fire(1, true);
  pulseAll(1, 400);
}

// --- aura (ręce w dół) ---
function powering(dt) {
  aura.powering = true;
  if (!K.auraHum) K.auraHum = sfx.hum(HUM_AURA);
  if (K.auraHum) K.auraHum.update(aura.level);
  addKi(dt * 0.1);
  if (Math.random() < dt * 6) pulseAll(0.2 + aura.level * 0.4, 50);
}

function updateKi(dt) {
  const L = side('left'), R = side('right');
  const both = L.valid && R.valid && L.grp && R.grp;
  if ((K.mode === 'none' || K.mode === 'single') && both) {
    if (F.up && !P.inMelee) { mergeSingles(); startGiant(); K.mode = 'giant'; }
    else if (F.d < CFG.closeDist) { startKame(mergeSingles()); K.mode = 'kame'; }
    else if (F.downApart && !P.inMelee) { mergeSingles(); K.mode = 'aura'; }
  }
  switch (K.mode) {
    case 'none':
    case 'single':
      if (!P.inMelee) { updateSingle(L, dt); updateSingle(R, dt); }
      K.mode = (L.ball || R.ball) ? 'single' : 'none';
      break;
    case 'kame':
      if (!(L.grp && R.grp)) { fireKame(); K.mode = 'wait'; } else updateKame(dt);
      break;
    case 'giant':
      if (!(L.grp && R.grp)) { throwGiant(); K.mode = 'wait'; } else growGiant(dt);
      break;
    case 'aura':
      if (!(L.grp && R.grp)) { aura.powering = false; K.auraHum = stopHum(K.auraHum); K.mode = 'wait'; } else powering(dt);
      break;
    case 'wait':
      if (!L.grp && !R.grp) K.mode = 'none';
      break;
  }
}

// ---------------------------------------------------------------------------
// Walka wręcz: pięści, kopnięcia, młot, blok
// ---------------------------------------------------------------------------
const HAM = { armed: false, armY: 0, done: false };

function doStrike(kind, st, c) {
  const E = enemy.chestW;
  const reach = kind === 'kick' ? CFG.reach + 0.3 : CFG.reach + (kind === 'hammer' ? 0.4 : 0);
  const inReach = enemy.hittable && E.distanceTo(F.head) < reach;
  const S = st.strike;
  S.kind = kind; S.c = c; S.t = 0; S.hit = !inReach; S.hitAt = kind === 'kick' ? 0.13 : 0.07;
  if (inReach) S.target.copy(E);
  else S.target.copy(st.pos).addScaledVector(st.aim, 0.5);
  if (kind === 'kick') {
    st.kick.t = 0;
    if (inReach) st.kick.target.copy(E).addScaledVector(UP, -0.15);
    else st.kick.target.copy(avatar.hips).addScaledVector(avatar.bodyFwd, 0.85).addScaledVector(UP, 0.25);
  }
  sfx.whoosh(c);
}
function resolveStrike(st) {
  const S = st.strike;
  if (!enemy.hittable) return;
  const E = enemy.chestW;
  if (E.distanceTo(F.head) > CFG.reach + 1) return;
  const c = S.c, fm = formMul();
  if (S.kind !== 'hammer' && enemy.blocksHit(c)) {
    sfx.block(E); hitSpark(E, 0.3, 0xffd0a0); addKi(0.01); msg('Rywal zablokował', 0.8);
    pulse(st, 0.3, 40);
    return;
  }
  const dir = _v1.subVectors(E, F.head).setY(0).normalize().clone();
  let dmg, launch = null;
  const juggle = enemy.state !== 'melee';
  if (S.kind === 'hammer') {
    dmg = (10 + 15 * c) * fm;
    launch = _v2.copy(dir).multiplyScalar(0.25).addScaledVector(UP, -1).normalize().multiplyScalar((30 + c * 25) * fm).clone();
  } else if (S.kind === 'kick') {
    dmg = (4 + 12 * c) * fm;
    if (c >= 0.65 || (juggle && c >= 0.3)) launch = _v2.copy(dir).addScaledVector(UP, 0.4).normalize().multiplyScalar((18 + c * 32) * fm).clone();
  } else {
    dmg = (3 + 9 * c) * fm;
    // ręka niżej niż klatka rywala → wybicie w górę, wyżej → w dół
    const vert = clamp((E.y - st.pos.y) * 2.5, -0.85, 0.9);
    if (c >= 0.7 || (juggle && c >= 0.3)) launch = _v2.copy(dir).addScaledVector(UP, vert).normalize().multiplyScalar((14 + c * 30) * fm).clone();
  }
  const hitPos = E.clone();
  enemy.hitMelee(dmg, dir, launch, ctx);
  hitSpark(hitPos, 0.3 + c * 0.7, launch ? 0xffe080 : 0xffffff);
  sfx.punch(c, hitPos);
  pulse(st, 0.4 + c * 0.6, 60 + c * 140);
  if (S.kind === 'hammer') pulseAll(1, 250);
  addKi(0.03 + c * 0.07);
  stats.hits++;
  if (launch) {
    boom(hitPos, 0.4 + c * 0.4, { light: false, color: 0xffd070, spark: 0xfff0c0 });
    msg(S.kind === 'hammer' ? 'MŁOT!' : 'Odleciał!', 1.2);
  }
}

function updateCombat(dt) {
  const L = side('left'), R = side('right');
  const enemyNear = enemy.hittable && enemy.chestW.distanceTo(F.head) < CFG.reach + 0.6;
  const bothTrig = L.valid && R.valid && L.trig && R.trig;
  if (bothTrig && F.up && (P.inMelee || enemyNear) && !HAM.armed) { HAM.armed = true; HAM.done = false; HAM.armY = F.mid.y; }
  if (HAM.armed && L.trig && R.trig) HAM.armY = Math.max(HAM.armY, F.mid.y);
  FLY.want = bothTrig && !P.inMelee && !HAM.armed && state.xrMode !== 'ar';

  for (const st of [L, R]) {
    // pięść: spust
    if (st.trig && !st.pTrig) st.punchC = 0;
    if (st.trig && st.punchC >= 0) st.punchC = Math.min(1, st.punchC + dt / CFG.punchTime);
    if (FLY.want) st.punchC = -1;
    if (!st.trig && st.pTrig) {
      if (HAM.armed) {
        if (!HAM.done) {
          HAM.done = true;
          const c = Math.max(L.punchC, R.punchC, 0);
          if (F.mid.y < HAM.armY - 0.15 || F.vm.y < -0.6) {
            doStrike('hammer', L, c);
            R.strike.t = 0; R.strike.hit = true; R.strike.kind = 'hammer'; R.strike.target.copy(L.strike.target);
          } else { doStrike('punch', L, c); doStrike('punch', R, c); }
          L.punchC = R.punchC = -1;
        }
      } else if (st.punchC >= 0) doStrike('punch', st, st.punchC);
      st.punchC = -1;
    }
    // kopnięcie: chwyt (tylko w walce wręcz)
    if (P.inMelee && K.mode === 'none') {
      if (st.grp && !st.pGrp) st.kickC = 0;
      if (st.grp && st.kickC >= 0) st.kickC = Math.min(1, st.kickC + dt / CFG.kickTime);
      if (!st.grp && st.pGrp && st.kickC >= 0) { doStrike('kick', st, st.kickC); st.kickC = -1; }
    } else st.kickC = -1;
    st.blocking = st.blk && st.valid;

    const S = st.strike;
    if (S.t >= 0) {
      S.t += dt;
      if (!S.hit && S.t >= S.hitAt) { S.hit = true; resolveStrike(st); }
      if (S.t > 0.32) S.t = -1;
    }
    if (st.kick.t >= 0) { st.kick.t += dt * 1.6; if (st.kick.t > 0.8) st.kick.t = -1; }
  }
  if (HAM.armed && !L.trig && !R.trig) HAM.armed = false;
}

// ---------------------------------------------------------------------------
// Lot, obrót, powrót
// ---------------------------------------------------------------------------
function moveRig(dt) {
  const want = FLY.want;
  if (want) {
    const L = side('left'), R = side('right');
    _v1.addVectors(L.aim, R.aim);
    if (_v1.lengthSq() < 0.05) _v1.copy(F.fwd);
    FLY.dir.lerp(_v1.normalize(), 1 - Math.exp(-dt * 6)).normalize();
  }
  const target = want ? CFG.flySpeeds[P.form] : 0;
  FLY.speed += (target - FLY.speed) * (1 - Math.exp(-dt * (want ? 2.5 : 4)));
  if (FLY.speed > 0.01) {
    const step = _v2.copy(FLY.dir).multiplyScalar(FLY.speed * dt);
    const nx = F.head.x + step.x, nz = F.head.z + step.z, ny = F.head.y + step.y;
    const g = heightAt(nx, nz);
    if (g > ny - 0.4) {
      const climb = g - (ny - 0.4);
      if (climb < 1.2) step.y += climb;               // łagodne zbocze — wznieś się
      else { step.x = 0; step.z = 0; FLY.speed *= 0.6; } // ściana — stop
    }
    if (pillarHit(_v3.set(nx, ny - 0.5, nz), 0.4, _n)) { step.x = 0; step.z = 0; }
    rig.position.add(step);
    const r = Math.hypot(rig.position.x, rig.position.z);
    if (r > ARENA_RADIUS - 3) { rig.position.x *= (ARENA_RADIUS - 3) / r; rig.position.z *= (ARENA_RADIUS - 3) / r; }
    rig.position.y = Math.min(rig.position.y, 90);
    camera.getWorldPosition(_v1);
    const g2 = heightAt(_v1.x, _v1.z);
    if (_v1.y < g2 + 0.4) rig.position.y += g2 + 0.4 - _v1.y;
  }
  sfx.wind(FLY.speed);
}
function updateButtonsXR() {
  for (const st of inputs) {
    const gp = st.gamepad;
    if (!gp || st.isHand || !st.connected) continue;
    if (st.handedness === 'right' && gp.axes.length >= 4) {
      const x = gp.axes[2];
      if (Math.abs(x) > 0.7 && !st.turnLatch) {
        st.turnLatch = true;
        const ang = x > 0 ? -Math.PI / 6 : Math.PI / 6;
        camera.getWorldPosition(_v1);
        rig.position.sub(_v1).applyAxisAngle(UP, ang).add(_v1);
        rig.rotateY(ang);
      } else if (Math.abs(x) < 0.3) st.turnLatch = false;
    }
    if (st.back && !st.pBack) {
      if (enemy.state === 'melee') enemy.leaveMelee(ctx);
      resetRig();
      msg('Powrót na start', 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Pociski
// ---------------------------------------------------------------------------
function ballDamage(p) {
  const fm = formMul();
  if (p.kind === 'giant') return (45 + p.ball.radius * 8) * fm;
  if (p.kind === 'kame') return (10 + 30 * p.charge) * fm;
  return (5 + 10 * p.charge) * fm;
}
function detonate(p, pos, surface) {
  const r = p.ball.radius;
  let size, blast, crater;
  if (p.kind === 'giant') { size = r * 1.3; blast = r * 2.5; crater = r * 1.9; }
  else if (p.kind === 'kame') { size = (0.35 + p.charge * 1.3) * sizeMul(); blast = (0.5 + p.charge * 2.2) * sizeMul(); crater = (0.8 + p.charge * 2.4) * sizeMul(); }
  else { size = 0.25 + p.charge * 0.4; blast = 0.4 + p.charge * 0.6; crater = 0.6 + p.charge * 0.9; }
  let floor = false;
  if (surface) {
    if (surface.wallN) { wallDecal(pos, surface.wallN, crater * 0.9); spawnDebris(pos, crater, surface.wallN); }
    else { impact(pos, crater, _n); floor = _n.y > 0.6; }
    stats.craters++;
  }
  boom(pos, size, { ground: floor, color: p.ball.o === RED_STYLE ? 0xff3a3a : 0x3aa8ff });
  sfx.explode(pos, size);
  pulseAll(Math.min(1, 0.2 + size * 0.15), 80 + size * 60);
  for (const t of targets) {
    if (t.alive && t.group.position.distanceTo(pos) < blast + t.radius) { t.destroy(pos); stats.hits++; addKi(0.02); }
  }
  if (!p.hitEnemy && enemy.hittable && enemy.chestW.distanceTo(pos) < blast) {
    const dir = _v1.subVectors(enemy.chestW, pos).normalize().clone();
    enemy.hitByBall(ballDamage(p) * 0.6, dir, p.kind === 'giant', ctx);
    addKi(0.03);
  }
  fadeBall(p.ball);
}

function updateProjectiles(dt, t) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.age += dt;
    const pos = p.ball.group.position;
    p.prev.copy(pos);
    pos.addScaledVector(p.vel, dt);
    p.ball.update(dt, t);
    const r = p.ball.radius;
    let done = false;

    if (enemy.hittable && pos.distanceTo(enemy.chestW) < enemy.radius + r) {
      const dir = p.vel.clone().normalize();
      const strong = p.kind === 'giant' || (p.kind === 'kame' && p.charge > 0.45);
      enemy.hitByBall(ballDamage(p), dir, strong, ctx);
      p.hitEnemy = true;
      stats.hits++;
      addKi(p.kind === 'small' ? 0.03 : p.kind === 'kame' ? 0.08 : 0.15);
      msg(strong ? 'Potężne trafienie!' : 'Trafienie!', 1);
      detonate(p, pos, null);
      done = true;
    }
    if (!done) {
      for (const tg of targets) {
        if (tg.alive && tg.group.position.distanceTo(pos) < tg.radius + r) {
          if (p.kind === 'giant') { tg.destroy(pos); stats.hits++; }
          else { detonate(p, pos, null); done = true; break; }
        }
      }
    }
    if (!done && pos.y - r * 0.5 < heightAt(pos.x, pos.z)) {
      _v2.copy(pos); _v2.y -= r * 0.5; _v3.copy(p.prev); _v3.y -= r * 0.5;
      const hitP = findSurface(_v3, _v2, new THREE.Vector3());
      detonate(p, hitP, {});
      done = true;
    }
    if (!done && pillarHit(pos, r * 0.6, _n)) { detonate(p, pos.clone(), { wallN: _n.clone() }); done = true; }
    if (!done && (pos.distanceTo(p.origin) > 130 || p.age > 15)) { fadeBall(p.ball); done = true; }
    if (done) { projectiles.splice(i, 1); p.dead = true; }
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
    if (p.dead && (B.beam.opacity <= 0 || B.beam.head.distanceTo(B.beam.tail) < 0.02)) { B.beam.dispose(); beams.splice(i, 1); }
  }

  // pociski rywala
  const torso = _v3.copy(F.head).addScaledVector(UP, -0.5).clone();
  for (let i = eShots.length - 1; i >= 0; i--) {
    const s = eShots[i];
    s.age += dt;
    const pos = s.ball.group.position;
    pos.addScaledVector(s.vel, dt);
    s.ball.update(dt, t);
    // blok = odbicie z powrotem w rywala
    const deskBlock = !renderer.xr.isPresenting && (keys.KeyZ || keys.KeyC) && pos.distanceTo(F.head) < 1.0;
    if (deskBlock || inputs.some(st => st.blocking && st.pos.distanceTo(pos) < 0.45)) {
      const dir = _v1.subVectors(enemy.chestW, pos).normalize().clone();
      projectiles.push({ kind: 'small', ball: s.ball, vel: dir.multiplyScalar(22), charge: 0.7, age: 0, origin: pos.clone(), prev: new THREE.Vector3() });
      sfx.block(pos); hitSpark(pos, 0.4, 0xffd0d0); addKi(0.05); msg('Odbite!', 1);
      eShots.splice(i, 1);
      continue;
    }
    let gone = false;
    if (pos.distanceTo(F.head) < 0.32 || pos.distanceTo(torso) < 0.4) {
      boom(pos, 0.3, { light: false, color: 0xff3a3a, spark: 0xffb0b0 });
      hurtPlayer(9 + enemy.level);
      gone = true;
    } else if (pos.y < heightAt(pos.x, pos.z)) {
      impact(pos, 0.8, _n);
      boom(pos, 0.35, { color: 0xff3a3a, spark: 0xffb0b0, ground: _n.y > 0.6 });
      sfx.explode(pos, 0.4);
      gone = true;
    } else if (s.age > 7) gone = true;
    if (gone) { fadeBall(s.ball); eShots.splice(i, 1); }
  }
}

// ---------------------------------------------------------------------------
// Kryształy do ćwiczeń
// ---------------------------------------------------------------------------
const crystalGeo = new THREE.OctahedronGeometry(0.32, 0);
const crystalEdges = new THREE.EdgesGeometry(crystalGeo);
const shardGeo = new THREE.TetrahedronGeometry(0.07, 0);
const TARGET_COLORS = [0xff4fd8, 0x40e0ff, 0x6dff8a, 0xb18cff, 0xff6a5c];
const shards = [];
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
  place() {
    for (let tries = 0; tries < 30; tries++) {
      if (state.xrMode === 'ar') {
        const ang = (Math.random() * 2 - 1) * 0.85, dist = 2.5 + Math.random() * 4;
        this.base.set(Math.sin(ang) * dist, 0.9 + Math.random() * 2.2, -Math.cos(ang) * dist);
        break;
      }
      const ang = Math.random() * Math.PI * 2, dist = 6 + Math.random() * 20;
      const x = Math.sin(ang) * dist, z = -10 + Math.cos(ang) * dist;
      if (!isOpen(x, z, 2)) continue;
      this.base.set(x, heightAt(x, z) + 1.2 + Math.random() * 4, z);
      if (!pillarHit(this.base, 1)) break;
    }
    this.group.position.copy(this.base);
  }
  update(dt, t) {
    if (!this.alive) {
      this.respawn -= dt;
      if (this.respawn <= 0) { this.alive = true; this.spawnAnim = 0; this.place(); this.group.visible = true; }
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
    this.respawn = 3 + Math.random() * 2;
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(shardGeo, this.mat);
      m.position.copy(this.group.position);
      const vel = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 5))
        .addScaledVector(_v1.subVectors(this.group.position, from).normalize(), 3).add(_v2.set(0, 2.5, 0));
      m.scale.setScalar(rand(0.6, 1.8));
      scene.add(m);
      shards.push({ m, vel, life: rand(2, 3) });
    }
  }
}
const targets = [];
for (let i = 0; i < 6; i++) targets.push(new Target(i));
function placeAllTargets() { for (const t of targets) { t.alive = true; t.group.visible = true; t.spawnAnim = 0; t.place(); } }
placeAllTargets();
function updateShards(dt) {
  for (let i = shards.length - 1; i >= 0; i--) {
    const s = shards[i];
    s.life -= dt;
    s.vel.y -= 9.8 * dt;
    s.m.position.addScaledVector(s.vel, dt);
    const g = heightAt(s.m.position.x, s.m.position.z) + 0.04;
    if (s.m.position.y < g) { s.m.position.y = g; s.vel.multiplyScalar(0.5); s.vel.y = Math.abs(s.vel.y) * 0.5; }
    s.m.rotation.x += dt * 6; s.m.rotation.y += dt * 4;
    if (s.life < 0.5) s.m.scale.multiplyScalar(Math.pow(0.02, dt));
    if (s.life <= 0) { scene.remove(s.m); shards.splice(i, 1); }
  }
}

// ---------------------------------------------------------------------------
// HUD na nadgarstku + tablica z instrukcją + błysk obrażeń
// ---------------------------------------------------------------------------
const hud = (() => {
  const { ctx: g, tex } = makeCanvasTex(512, 256);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true }));
  sprite.renderOrder = 30;
  let last = '';
  function bar(y, label, v, color) {
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(16, y, 480, 34);
    g.fillStyle = color; g.fillRect(16, y, 480 * clamp(v, 0, 1), 34);
    g.fillStyle = '#10131c'; g.font = 'bold 24px system-ui, sans-serif'; g.fillText(label, 26, y + 26);
  }
  function draw() {
    const key = `${Math.round(P.hp)}|${Math.round(P.ki * 100)}|${P.form}|${Math.round(enemy.hp)}|${P.inMelee}|${P.msgT > 0 ? P.msg : ''}`;
    if (key === last) return;
    last = key;
    g.clearRect(0, 0, 512, 256);
    g.fillStyle = 'rgba(10,12,24,0.78)';
    g.beginPath(); if (g.roundRect) g.roundRect(2, 2, 508, 252, 22); else g.rect(2, 2, 508, 252); g.fill();
    bar(14, `ŻYCIE ${Math.round(P.hp)}`, P.hp / P.maxHp, '#58e07a');
    bar(56, P.form >= 3 ? 'KI — MAKS' : `KI → forma ${P.form + 1}`, P.ki, '#ffd34d');
    g.fillStyle = '#ffcf7a'; g.font = 'bold 30px system-ui, sans-serif';
    g.fillText(`Forma ${P.form}   KO: ${stats.kos}`, 18, 130);
    g.fillStyle = '#ff8a95'; g.font = '26px system-ui, sans-serif';
    g.fillText(`Rywal: ${Math.max(0, Math.round(enemy.hp))}/${enemy.maxHp}${P.inMelee ? '   ⚔ WALKA' : ''}`, 18, 172);
    if (P.msgT > 0) { g.fillStyle = '#ffffff'; g.font = 'bold 32px system-ui, sans-serif'; g.fillText(P.msg, 18, 228); }
    tex.needsUpdate = true;
  }
  return { sprite, draw };
})();
function placeHud() {
  if (renderer.xr.isPresenting) {
    const L = side('left');
    if (hud.sprite.parent !== L.grip) { L.grip.add(hud.sprite); hud.sprite.position.set(0, 0.09, 0.05); hud.sprite.scale.set(0.16, 0.08, 1); }
  } else if (hud.sprite.parent !== camera) {
    camera.add(hud.sprite); hud.sprite.position.set(-0.36, -0.22, -0.7); hud.sprite.scale.set(0.3, 0.15, 1);
  }
}

{
  const { ctx: g, tex } = makeCanvasTex(1024, 900);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.23), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  mesh.position.set(-1.7, 1.7, -2.0);
  mesh.lookAt(0, 1.6, 0);
  rig.add(mesh);
  g.fillStyle = 'rgba(14,12,26,0.82)';
  g.beginPath(); if (g.roundRect) g.roundRect(4, 4, 1016, 892, 36); else g.rect(4, 4, 1016, 892); g.fill();
  g.strokeStyle = 'rgba(255,190,110,0.6)'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#9fe6ff'; g.font = 'bold 56px system-ui, sans-serif';
  g.fillText('⚡ KULA ENERGII — KANION', 40, 80);
  const sec = (y, title, lines) => {
    g.fillStyle = '#ffcf7a'; g.font = 'bold 36px system-ui, sans-serif'; g.fillText(title, 40, y);
    g.fillStyle = '#e8f4ff'; g.font = '31px system-ui, sans-serif';
    lines.forEach((l, i) => g.fillText(l, 52, y + 46 + i * 42));
  };
  sec(150, 'Energia (chwyt = dolny przycisk)', [
    'Chwyt 1 ręki → kula w dłoni, puść → strzał',
    'Chwyt obu, dłonie razem → fala energii',
    'Chwyt obu, ręce w górę → wielka kula',
    'Chwyt obu, ręce w dół → ładowanie aury',
    'Oba spusty → lot tam, gdzie celujesz',
  ]);
  sec(430, 'Walka wręcz (gdy rywal jest blisko)', [
    'Spust → pięść,  chwyt → kopnięcie',
    'Trzymaj dłużej = mocniej, cios po puszczeniu',
    'X / A → blok: ręka tam, skąd leci cios',
    'Oba spusty w górze, puść w dół → młot',
  ]);
  sec(670, 'Inne', [
    'Ciosy i trafienia ładują KI → kolejne formy',
    'Prawa gałka → obrót,  B / Y → powrót na start',
  ]);
  tex.needsUpdate = true;
}

const flashMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false });
const flashSphere = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), flashMat);
flashSphere.renderOrder = 40;
camera.add(flashSphere);

const ballLight = new THREE.PointLight(0x7fd0ff, 0, 0, 2);
scene.add(ballLight);
function updateBallLight() {
  const b = K.kame || K.giant || side('right').ball || side('left').ball || (projectiles.length ? projectiles[projectiles.length - 1].ball : null);
  if (b) {
    ballLight.position.copy(b.group.position);
    ballLight.intensity = (0.6 + b.power * 4) * b.opacity * (1 + b.radius * b.radius * 3);
  } else ballLight.intensity = 0;
}

// dłonie z modelu (hand tracking) świecą przy aurze
function updateHandGlow() {
  const k = aura.level * 0.5;
  for (const st of inputs) {
    if (!st.isHand) continue;
    st.hand.traverse((o) => { if (o.isMesh && o.material && o.material.emissive) o.material.emissive.copy(GOLD).multiplyScalar(k); });
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
  state.xrMode = mode;
  setWorldMode(mode);
  renderer.setClearColor(0x000000, mode === 'ar' ? 0 : 1);
}
async function startSession(mode) {
  sfx.init();
  const type = mode === 'ar' ? 'immersive-ar' : 'immersive-vr';
  try {
    const session = await navigator.xr.requestSession(type, { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    setMode(mode);
    START.set(0, heightAt(0, 0), 0);
    resetRig();
    await renderer.xr.setSession(session);
    placeAllTargets();
    overlay.style.display = 'none';
    session.addEventListener('end', () => {
      setMode(null);
      START.set(0, heightAt(0, 0), 0);
      resetRig();
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

const DESK_HELP = 'Podgląd: lewa ręka <kbd>Q</kbd> spust, <kbd>A</kbd> chwyt, <kbd>Z</kbd> blok; prawa <kbd>E</kbd>, <kbd>D</kbd>, <kbd>C</kbd>. Pozy: <kbd>1</kbd> dłonie razem, <kbd>2</kbd> w górę, <kbd>3</kbd> w dół. <kbd>Spacja</kbd> fala, <kbd>R</kbd> powrót, mysz — rozglądanie.';
(async () => {
  if (!('xr' in navigator)) { info.innerHTML = 'Ta przeglądarka nie obsługuje WebXR.<br>' + DESK_HELP; return; }
  const [vr, ar] = await Promise.all([
    navigator.xr.isSessionSupported('immersive-vr').catch(() => false),
    navigator.xr.isSessionSupported('immersive-ar').catch(() => false),
  ]);
  btnVR.disabled = !vr;
  btnAR.disabled = !ar;
  if (vr || ar) info.textContent = 'Gotowe! Najlepiej grać na kontrolerach (dłonie też działają: pięść = chwyt, szczypnięcie = spust).';
  else info.innerHTML = 'Brak urządzenia VR.<br>' + DESK_HELP;
})();

// klawiatura i mysz (podgląd)
window.addEventListener('keydown', (e) => {
  if (['Space', 'KeyQ', 'KeyE', 'KeyA', 'KeyD'].includes(e.code)) sfx.init();
  if (e.code === 'Space') e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'KeyR' && !renderer.xr.isPresenting) { if (enemy.state === 'melee') enemy.leaveMelee(ctx); resetRig(); }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; sfx.init(); });
window.addEventListener('pointermove', (e) => {
  if (!drag || renderer.xr.isPresenting) return;
  desk.yaw -= (e.clientX - drag.x) * 0.004;
  desk.pitch = clamp(desk.pitch - (e.clientY - drag.y) * 0.004, -1.4, 1.4);
  drag = { x: e.clientX, y: e.clientY };
  applyDesktopCamera();
});
window.addEventListener('pointerup', () => { drag = null; });
window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Pętla główna
// ---------------------------------------------------------------------------
const handsForAvatar = {
  left: { valid: false, isHand: false, fistPos: new THREE.Vector3(), quat: new THREE.Quaternion(), wristPos: new THREE.Vector3(), charge: 0 },
  right: { valid: false, isHand: false, fistPos: new THREE.Vector3(), quat: new THREE.Quaternion(), wristPos: new THREE.Vector3(), charge: 0 },
};
const kickForAvatar = { left: null, right: null };

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const xr = renderer.xr.isPresenting;

  computeHead();
  for (const st of inputs) { if (xr) readXRInput(st); else readDeskInput(st, dt); trackVelocity(st, t); }
  computeHands();
  ctx.right.copy(F.right);

  updateKi(dt);
  updateCombat(dt);
  moveRig(dt);
  if (xr) updateButtonsXR();
  computeHead();

  enemy.update(dt, t, ctx);
  if (K.kame) K.kame.update(dt, t);
  if (K.giant) K.giant.update(dt, t);
  for (const st of inputs) if (st.ball) st.ball.update(dt, t);
  updateProjectiles(dt, t);
  for (const tg of targets) tg.update(dt, t);
  updateShards(dt);
  updateWorld(dt);
  updateFx(dt, t);

  // aura: poziom zależy od formy, ładowanie podbija do maksimum
  const goal = aura.powering ? 1 : CFG.formBase[P.form];
  aura.level += (goal - aura.level) * (1 - Math.exp(-dt * (goal > aura.level ? 0.8 : 0.3)));
  aura.form = P.form;
  aura.update(dt, t, F.head, heightAt(F.head.x, F.head.z));

  // ciało gracza
  for (const s of ['left', 'right']) {
    const st = side(s), h = handsForAvatar[s];
    h.valid = st.valid; h.isHand = st.isHand;
    h.quat.copy(st.quat);
    h.wristPos.copy(st.wrist);
    h.fistPos.copy(st.pos);
    const S = st.strike;
    if (S.t >= 0 && S.kind !== 'kick') {
      const e = S.t < 0.08 ? S.t / 0.08 : Math.max(0, 1 - (S.t - 0.08) / 0.22);
      _v1.subVectors(S.target, st.pos).clampLength(0, 1.1);
      h.fistPos.addScaledVector(_v1, e * 0.9);
    }
    h.charge = Math.max(st.punchC, st.kickC, 0);
    kickForAvatar[s] = st.kick;
  }
  avatar.update({ dt, head: F.head, headFwdFlat: F.fwdFlat, hands: handsForAvatar, flyDir: FLY.dir, flySpeed: FLY.speed, kick: kickForAvatar, glow: aura.level, glowColor: GOLD });

  // regeneracja, komunikaty, błysk
  if (!P.inMelee) P.hp = Math.min(P.maxHp, P.hp + dt * 3);
  P.msgT = Math.max(0, P.msgT - dt);
  P.flash = Math.max(0, P.flash - dt * 1.5);
  flashMat.color.copy(P.flashColor);
  flashMat.opacity = P.flash * 0.45;
  flashSphere.visible = P.flash > 0.01;

  placeHud();
  hud.draw();
  updateHandGlow();
  updateBallLight();
  sfx.updateListener(camera);

  for (const st of inputs) { st.pTrig = st.trig; st.pGrp = st.grp; st.pBack = st.back; }
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);

// do testów w konsoli
window.__sim = { P, K, F, FLY, HAM, enemy, inputs, stats, aura, avatar, rig, keys, desk, applyDesktopCamera, projectiles, eShots, heightAt, ctx, addKi };
