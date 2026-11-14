// Kula Energii — arena w kanionie (WebXR, Meta Quest, kontrolery lub dłonie)
//
// Poza walką:
//   • chwyt jednej ręki → kula w tej dłoni, puść → strzał
//   • chwyt obu + dłonie blisko → fala energii, puść → strzał
//   • chwyt obu + ręce w górę → wielka kula nad głową, puść → rzut
//   • chwyt obu + ręce w dół → ładowanie aury
//   • oba spusty → lot w kierunku, w który celujesz
// W walce wręcz (włącza się sama, gdy jesteś blisko rywala) — tylko ręce i nogi:
//   • spust → pięść, chwyt → kopnięcie (im dłużej trzymasz, tym mocniej; cios wychodzi po puszczeniu)
//   • ciosy są animowane i nie da się ich zadawać szybciej niż trwa animacja
//   • X / A → blok ręką (trzymaj ją tam, skąd leci cios)
//   • oba spusty z rękami w górze, puść ruchem w dół → młot
// Paski: życie, stamina (zużywają ją ataki i lot), KI (ładuje je tylko aura — szybciej przy małym życiu).
// Pełne KI → Y = wyższy poziom (mocniejsze ciosy, szybciej spada stamina). Przytrzymaj Y → niższy poziom.

import * as THREE from 'three';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { renderer, scene, rig, camera, state, UP, clamp, rand, makeCanvasTex, glowTex } from './core.js';
import { sfx, HUM_KAME, HUM_SMALL, HUM_GIANT, HUM_AURA } from './audio.js';
import { EnergyBall, Beam, KAME_STYLE, SMALL_STYLE, GIANT_STYLE, RED_STYLE, Aura, Trail, boom, hitSpark, fadeBall, updateFx } from './fx.js';
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
  dmgMul: [1, 1.5, 2.1, 2.8],       // siła ciosów na poziomach
  staMul: [1, 1.25, 1.5, 1.75],     // koszt staminy na poziomach (rośnie wolniej niż siła — opłaca się)
  upkeep: [0, 0.6, 1.2, 1.8],       // stały spadek staminy na poziomie (na sekundę)
  sizeMul: [1, 1.15, 1.3, 1.5],
  formBase: [0, 0.55, 0.8, 1],
  staRegen: 14,                      // odnawianie staminy (na sekundę) po chwili bez ataku
  kiRate: 0.11,                      // ładowanie KI aurą (na sekundę) przy pełnym życiu
};
// ciosy: czas trwania animacji, moment trafienia, koszt staminy, obrażenia, doskok kamery, "zamrożenie" przy trafieniu
const STYLE = {
  jab: { dur: 0.36, hit: 0.14, cost: 6, dmg: 4, wind: 0.07, lunge: 0.12, stop: 0.05 },
  power: { dur: 0.64, hit: 0.32, cost: 13, dmg: 11, wind: 0.2, lunge: 0.3, stop: 0.12 },
  kick: { dur: 0.52, hit: 0.22, cost: 8, dmg: 6, lunge: 0.15, stop: 0.06 },
  round: { dur: 0.8, hit: 0.4, cost: 15, dmg: 13, lunge: 0.25, stop: 0.13 },
  hammer: { dur: 0.9, hit: 0.46, cost: 22, dmg: 16, wind: 0.1, lunge: 0.2, stop: 0.16 },
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
    kick: { t: -1, dur: 0.5, hit: 0.2, target: new THREE.Vector3(), style: 'front' },
    yT: -1, yDone: false,
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
    st.back = !!(b[5] && b[5].pressed);  // Y (lewy) = poziom, B (prawy) = powrót
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
  st.back = left ? !!keys.KeyT : false;
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
const P = {
  hp: 100, maxHp: 100, sta: 100, maxSta: 100, exhausted: false, lastAct: 9, ki: 0, form: 0, inMelee: false,
  flash: 0, flashColor: new THREE.Color(1, 0, 0), msg: '', msgT: 0, hitStop: 0, slowmo: 0,
};
const stats = { hits: 0, shots: 0, kos: 0, craters: 0 };
function msg(text, time = 1.6) { P.msg = text; P.msgT = time; }
const dmgMul = () => CFG.dmgMul[P.form];
const staMul = () => CFG.staMul[P.form];
const sizeMul = () => CFG.sizeMul[P.form];
// zużycie staminy; zwraca false, gdy brakuje sił
function spend(cost) {
  cost *= staMul();
  P.lastAct = 0;
  if (P.exhausted || P.sta < cost * 0.5) { P.sta = Math.max(0, P.sta - cost * 0.5); msg('Brak staminy!', 0.9); return false; }
  P.sta = Math.max(0, P.sta - cost);
  return true;
}

const aura = new Aura(debrisGeo, debrisMat);
const avatar = new Avatar();
const FLY = { speed: 0, dir: new THREE.Vector3(0, 0, -1), want: false };

function addKi(x) {
  const was = P.ki;
  P.ki = Math.min(1, P.ki + x);
  if (was < 1 && P.ki >= 1) {
    sfx.ding();
    msg(P.form < 3 ? `KI pełne! Y → poziom ${P.form + 1}` : 'KI pełne (najwyższy poziom)', 3);
  }
}
function levelUp() {
  if (P.form >= 3) { msg('To już najwyższy poziom', 1.2); return; }
  if (P.ki < 1) { msg('Naładuj KI aurą: ręce w dół + oba chwyty', 2); return; }
  P.ki = 0;
  transform(P.form + 1);
}
function levelDown() {
  if (P.form <= 0) return;
  P.form--;
  aura.form = P.form;
  sfx.fizzle();
  msg(`Poziom ${P.form}`, 1.5);
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
  msg(`POZIOM ${n}!  Siła ×${CFG.dmgMul[n]}`, 2.5);
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
  anchor: new THREE.Vector3(),   // głowa bez doskoku kamery (rywal trzyma dystans od tego punktu)
  bodyFwd: avatar.bodyFwd,
  right: new THREE.Vector3(),
  checkBlock(point) {
    if (!renderer.xr.isPresenting) return !!(keys.KeyZ || keys.KeyC);
    return inputs.some(st => st.blocking && st.pos.distanceTo(point) < 0.42);
  },
  onBlocked(point) {
    sfx.block(point);
    hitSpark(point, 0.4, 0xfff0c0);
    P.sta = Math.max(0, P.sta - 4 * staMul());
    P.hitStop = 0.05;
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
    if (K.mode !== 'none' && K.mode !== 'wait') { cancelKi(); K.mode = 'wait'; }
    msg('WALKA WRĘCZ!', 1.5);
    sfx.warn();
  },
  meleeEnd() { P.inMelee = false; },
  announce(text) { if (P.msgT <= 0.3) msg(text, 0.7); },
  onSlam(point, speed) { pulseAll(Math.min(1, speed / 30), 150); },
};
enemy.onKO = () => { stats.kos++; P.inMelee = false; P.slowmo = 1.2; msg('NOKAUT!', 2.5); };

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
  if (st.grp && st.valid && (st.ball || !P.exhausted)) {
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
    if (c < 0.1 || !spend(6 + 6 * c)) { fizzleBall(b); return; }
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
  if (c < CFG.minKame || !spend(14 + 22 * c)) { fizzleBall(b); return; }
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
  if (b.radius < CFG.giantMin || !spend(35)) { fizzleBall(b); return; }
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
  // im mniej życia, tym szybciej rośnie KI
  addKi(dt * CFG.kiRate * (1 + 3 * (1 - P.hp / P.maxHp)));
  if (Math.random() < dt * 6) pulseAll(0.2 + aura.level * 0.4, 50);
}

function updateKi(dt) {
  const L = side('left'), R = side('right');
  // w walce wręcz tylko ręce i nogi — żadnych kul
  if (P.inMelee) {
    if (K.mode !== 'none' && K.mode !== 'wait') { cancelKi(); K.mode = 'wait'; }
    if (K.mode === 'wait' && !L.grp && !R.grp) K.mode = 'none';
    return;
  }
  const both = L.valid && R.valid && L.grp && R.grp;
  if ((K.mode === 'none' || K.mode === 'single') && both) {
    if (F.downApart) { mergeSingles(); K.mode = 'aura'; }
    else if (P.exhausted) { /* bez sił — tylko aura */ }
    else if (F.up) { mergeSingles(); startGiant(); K.mode = 'giant'; }
    else if (F.d < CFG.closeDist) { startKame(mergeSingles()); K.mode = 'kame'; }
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
// aktualny cios gracza (animacja blokuje kolejne do końca) + jeden zapamiętany następny
const SK = { cur: null, queue: null, camOff: new THREE.Vector3(), camGoal: new THREE.Vector3() };
const trails = { left: new Trail(0xffe7a0), right: new Trail(0xffe7a0), footL: new Trail(0xffd27a), footR: new Trail(0xffd27a) };
const ease = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
const easeIn = (x) => { x = clamp(x, 0, 1); return x * x; };
const REACT_BY_ZONE = { over: 'crush', upper: 'uppercut', hookL: 'hookL', hookR: 'hookR', straight: 'head_back', fold: 'fold' };
const ZONE_TEXT = { over: 'z góry', upper: 'podbródkowy', hookL: 'sierpowy', hookR: 'sierpowy', straight: 'prosty', fold: 'kopnięcie' };

function startStrike(kind, st, c) {
  if (SK.cur) { SK.queue = { kind, st, c }; return; }
  let style = kind === 'punch' ? (c >= 0.7 ? 'power' : 'jab') : kind === 'kick' ? (c >= 0.65 ? 'round' : 'kick') : 'hammer';
  if (!spend(STYLE[style].cost * (1 + c * 0.5))) {
    c = Math.min(c, 0.25);
    if (style === 'power') style = 'jab';
    if (style === 'round') style = 'kick';
  }
  const S = STYLE[style];
  const E = enemy.chestW, Hd = enemy.headW;
  const reach = CFG.reach + (kind === 'kick' ? 0.3 : 0) + (kind === 'hammer' ? 0.4 : 0);
  const inReach = enemy.hittable && E.distanceTo(F.head) < reach;
  const toPlayer = _v2.subVectors(F.head, E).setY(0).normalize().clone();

  // strefa ciosu: skąd idzie ręka względem rywala
  let zone;
  if (kind === 'hammer') zone = 'over';
  else if (kind === 'kick') zone = style === 'round' ? (st.handedness === 'left' ? 'hookL' : 'hookR') : 'fold';
  else {
    const lat = _v1.subVectors(st.pos, F.head).dot(F.right);
    if (st.pos.y > Hd.y - 0.02) zone = 'over';
    else if (st.pos.y < E.y - 0.1) zone = 'upper';
    else if (Math.abs(lat) > 0.28) zone = lat < 0 ? 'hookL' : 'hookR';
    else zone = 'straight';
  }
  // cel na ciele rywala
  const target = new THREE.Vector3();
  if (inReach) {
    switch (zone) {
      case 'over': target.copy(Hd).addScaledVector(UP, 0.1); break;
      case 'upper': target.copy(Hd).addScaledVector(UP, -0.1).addScaledVector(toPlayer, 0.08); break;
      case 'hookL': target.copy(Hd).addScaledVector(F.right, -0.12); if (kind === 'kick') target.addScaledVector(UP, -0.05); break;
      case 'hookR': target.copy(Hd).addScaledVector(F.right, 0.12); if (kind === 'kick') target.addScaledVector(UP, -0.05); break;
      case 'fold': target.copy(E).addScaledVector(UP, -0.18).addScaledVector(toPlayer, 0.12); break;
      default: (style === 'jab' ? target.copy(Hd) : target.copy(E)).addScaledVector(toPlayer, 0.1);
    }
  } else if (kind === 'kick') target.copy(avatar.hips).addScaledVector(avatar.bodyFwd, 0.85).addScaledVector(UP, style === 'round' ? 0.6 : 0.25);
  else target.copy(st.pos).addScaledVector(st.aim, 0.55);

  // zamach i łuk ciosu
  const start = st.pos.clone();
  const wind = start.clone().addScaledVector(F.fwdFlat, -(S.wind || 0.05));
  const ctrl = new THREE.Vector3();
  switch (zone) {
    case 'over': wind.addScaledVector(UP, style === 'jab' ? 0.15 : 0.32); break;
    case 'upper': wind.addScaledVector(UP, -0.2); break;
    case 'hookL': wind.addScaledVector(F.right, -0.25); break;
    case 'hookR': wind.addScaledVector(F.right, 0.25); break;
    default: if (style === 'power') wind.addScaledVector(F.right, st.handedness === 'left' ? -0.12 : 0.12).addScaledVector(UP, 0.05);
  }
  ctrl.copy(wind).lerp(target, 0.5);
  if (zone === 'over') ctrl.addScaledVector(UP, 0.25);
  if (zone === 'upper') ctrl.addScaledVector(UP, -0.15);
  if (zone === 'hookL') ctrl.addScaledVector(F.right, -0.3);
  if (zone === 'hookR') ctrl.addScaledVector(F.right, 0.3);

  SK.cur = { kind, style, S, st, c, zone, t: 0, start, wind, ctrl, target, inReach, hit: false, side: st.handedness, both: kind === 'hammer' };
  if (kind === 'kick') {
    st.kick.t = 0; st.kick.dur = S.dur; st.kick.hit = S.hit; st.kick.style = style === 'round' ? 'round' : 'front';
    st.kick.target.copy(target);
  }
  sfx.whoosh(style === 'jab' || style === 'kick' ? c * 0.6 : 0.9);
}

// pozycja pięści w danej chwili animacji
function strikeFist(cur, out, live) {
  const S = cur.S, t = cur.t, w = S.hit * 0.4;
  if (t < w) return out.lerpVectors(cur.start, cur.wind, ease(t / w));
  if (t < S.hit) {
    const e = easeIn((t - w) / (S.hit - w));
    return out.copy(cur.wind).multiplyScalar((1 - e) * (1 - e)).addScaledVector(cur.ctrl, 2 * (1 - e) * e).addScaledVector(cur.target, e * e);
  }
  const hold = S.hit + (cur.style === 'jab' ? 0.05 : 0.12);
  if (t < hold) return out.copy(cur.target);
  return out.lerpVectors(cur.target, live, ease((t - hold) / (S.dur - hold)));
}
// "kamera" ciosu: doskok do przodu, przy ciosie z góry wzniesienie i zejście
function strikeCam(cur, out) {
  const S = cur.S, t = cur.t, h = S.hit;
  const f = S.lunge * (t < h ? ease(t / h) : Math.max(0, 1 - (t - h) / (S.dur - h))) * (cur.inReach ? 1 : 0.4);
  let u = 0;
  if (cur.zone === 'over') {
    const big = cur.style === 'jab' ? 0.08 : 0.22;
    if (t < h * 0.7) u = big * ease(t / (h * 0.7));
    else if (t < h) u = big - (big + 0.1) * ((t - h * 0.7) / (h * 0.3));
    else u = -0.1 * Math.max(0, 1 - (t - h) / (S.dur - h));
  } else if (cur.zone === 'upper') {
    u = t < h ? -0.07 * ease(t / h) : 0.16 * Math.sin(Math.PI * clamp((t - h) / (S.dur - h), 0, 1));
  }
  return out.copy(F.fwdFlat).multiplyScalar(f).addScaledVector(UP, u);
}

function resolveStrike(cur) {
  if (!cur.inReach || !enemy.hittable || enemy.chestW.distanceTo(F.head) > CFG.reach + 1.2) { sfx.whoosh(0.2); return; }
  const c = cur.c, dm = dmgMul();
  const strong = cur.style === 'power' || cur.style === 'round' || cur.style === 'hammer';
  const hitPos = (cur.zone === 'fold' || (cur.zone === 'straight' && cur.style !== 'jab')) ? enemy.chestW.clone() : enemy.headW.clone();
  if (cur.style !== 'hammer' && enemy.blocksHit(c)) {
    sfx.block(hitPos); hitSpark(hitPos, 0.3, 0xffd0a0); msg('Rywal zablokował', 0.8);
    P.hitStop = 0.05;
    pulse(cur.st, 0.3, 40);
    return;
  }
  const away = _v1.subVectors(enemy.chestW, F.head).setY(0).normalize().clone();
  const juggle = enemy.state !== 'melee';
  const dmg = cur.S.dmg * (0.6 + c * 0.8) * dm;
  let launch = null;
  if ((strong && (c >= 0.7 || cur.style === 'hammer')) || (juggle && c >= 0.3)) {
    const d = new THREE.Vector3();
    switch (cur.zone) {
      case 'over': d.copy(away).multiplyScalar(0.3).addScaledVector(UP, -1); break;
      case 'upper': d.copy(away).multiplyScalar(0.35).addScaledVector(UP, 1); break;
      case 'hookL': d.copy(away).multiplyScalar(0.6).addScaledVector(F.right, 0.9).addScaledVector(UP, 0.15); break;
      case 'hookR': d.copy(away).multiplyScalar(0.6).addScaledVector(F.right, -0.9).addScaledVector(UP, 0.15); break;
      case 'fold': d.copy(away).addScaledVector(UP, 0.3); break;
      default: d.copy(away).addScaledVector(UP, 0.12);
    }
    launch = d.normalize().multiplyScalar((16 + c * 26) * Math.sqrt(dm) * (cur.style === 'hammer' ? 1.3 : 1));
  }
  enemy.hitMelee(dmg, away, launch, ctx, REACT_BY_ZONE[cur.zone] || 'head_back', strong);
  hitSpark(hitPos, strong ? 1 : 0.45, strong ? 0xffe080 : 0xffffff);
  if (strong) boom(hitPos, 0.35 + c * 0.3, { light: true, color: 0xffb040, hot: 0xffffff, spark: 0xfff0c0, smoke: false });
  sfx.punch(Math.min(1, c + (strong ? 0.3 : 0)), hitPos);
  pulse(cur.st, 0.4 + c * 0.6, 60 + c * 140);
  if (cur.style === 'hammer') pulseAll(1, 250);
  P.hitStop = cur.S.stop * (launch ? 1.5 : 1);
  stats.hits++;
  if (launch) {
    P.slowmo = 0.45;
    msg(cur.style === 'hammer' ? 'MŁOT!' : `${ZONE_TEXT[cur.zone]} — odleciał!`, 1.2);
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
    // pięść: spust (ładowanie trwa także w czasie animacji poprzedniego ciosu)
    if (st.trig && !st.pTrig) st.punchC = 0;
    if (st.trig && st.punchC >= 0) st.punchC = Math.min(1, st.punchC + dt / CFG.punchTime);
    if (FLY.want) st.punchC = -1;
    if (!st.trig && st.pTrig) {
      if (HAM.armed) {
        if (!HAM.done) {
          HAM.done = true;
          const c = Math.max(L.punchC, R.punchC, 0);
          if (F.mid.y < HAM.armY - 0.15 || F.vm.y < -0.6) startStrike('hammer', L, c);
          else startStrike('punch', st, c);
          L.punchC = R.punchC = -1;
        }
      } else if (st.punchC >= 0) startStrike('punch', st, st.punchC);
      st.punchC = -1;
    }
    // kopnięcie: chwyt (tylko w walce wręcz)
    if (P.inMelee && K.mode === 'none') {
      if (st.grp && !st.pGrp) st.kickC = 0;
      if (st.grp && st.kickC >= 0) st.kickC = Math.min(1, st.kickC + dt / CFG.kickTime);
      if (!st.grp && st.pGrp && st.kickC >= 0) { startStrike('kick', st, st.kickC); st.kickC = -1; }
    } else st.kickC = -1;
    st.blocking = st.blk && st.valid;
    if (st.kick.t >= 0) { st.kick.t += dt; if (st.kick.t > st.kick.dur) st.kick.t = -1; }
  }
  if (HAM.armed && !L.trig && !R.trig) HAM.armed = false;

  // animacja bieżącego ciosu
  const cur = SK.cur;
  if (cur) {
    cur.t += dt;
    if (!cur.hit && cur.t >= cur.S.hit) { cur.hit = true; resolveStrike(cur); }
    if (cur.t >= cur.S.dur) {
      SK.cur = null;
      if (SK.queue) { const q = SK.queue; SK.queue = null; startStrike(q.kind, q.st, q.c); }
    }
  }
  // przesunięcie kamery za ciosem (dodawane do pozycji gracza i zdejmowane po ciosie)
  if (SK.cur) strikeCam(SK.cur, SK.camGoal); else SK.camGoal.set(0, 0, 0);
  _v1.copy(SK.camOff).lerp(SK.camGoal, 1 - Math.exp(-dt * 25));
  rig.position.add(_v2.subVectors(_v1, SK.camOff));
  SK.camOff.copy(_v1);
  ctx.anchor.copy(F.head).sub(SK.camOff);
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
  const target = want ? (P.exhausted ? 4 : CFG.flySpeeds[P.form]) : 0;
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
    if (st.handedness === 'right' && st.back && !st.pBack) {
      if (enemy.state === 'melee') enemy.leaveMelee(ctx);
      resetRig();
      msg('Powrót na start', 1);
    }
  }
}
// Y (lewy kontroler, na komputerze T): krótko → wyższy poziom, przytrzymaj → niższy
function updateLevelButton(dt) {
  const st = side('left');
  if (st.back && !st.pBack) { st.yT = 0; st.yDone = false; }
  if (st.back && st.yT >= 0) {
    st.yT += dt;
    if (st.yT > 1.2 && !st.yDone) { st.yDone = true; levelDown(); }
  }
  if (!st.back && st.pBack && st.yT >= 0) { if (!st.yDone) levelUp(); st.yT = -1; }
}

// ---------------------------------------------------------------------------
// Pociski
// ---------------------------------------------------------------------------
function ballDamage(p) {
  const fm = dmgMul();
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
  const red = p.ball.o === RED_STYLE;
  boom(pos, size, { ground: floor, color: red ? 0xff3a3a : 0x3aa8ff, hot: red ? 0xffd0c0 : 0xd8f4ff, spark: red ? 0xffb0b0 : 0xbff0ff });
  if (size > 0.8) P.hitStop = Math.max(P.hitStop, Math.min(0.12, size * 0.03));
  sfx.explode(pos, size);
  pulseAll(Math.min(1, 0.2 + size * 0.15), 80 + size * 60);
  for (const t of targets) {
    if (t.alive && t.group.position.distanceTo(pos) < blast + t.radius) { t.destroy(pos); stats.hits++; }
  }
  if (!p.hitEnemy && enemy.hittable && enemy.chestW.distanceTo(pos) < blast) {
    const dir = _v1.subVectors(enemy.chestW, pos).normalize().clone();
    enemy.hitByBall(ballDamage(p) * 0.6, dir, p.kind === 'giant', ctx);
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
      sfx.block(pos); hitSpark(pos, 0.4, 0xffd0d0); msg('Odbite!', 1);
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
    const key = `${Math.round(P.hp)}|${Math.round(P.sta)}|${P.exhausted}|${Math.round(P.ki * 100)}|${P.form}|${Math.round(enemy.hp)}|${P.inMelee}|${P.msgT > 0 ? P.msg : ''}`;
    if (key === last) return;
    last = key;
    g.clearRect(0, 0, 512, 256);
    g.fillStyle = 'rgba(10,12,24,0.78)';
    g.beginPath(); if (g.roundRect) g.roundRect(2, 2, 508, 252, 22); else g.rect(2, 2, 508, 252); g.fill();
    bar(10, `ŻYCIE ${Math.round(P.hp)}`, P.hp / P.maxHp, '#58e07a');
    bar(50, P.exhausted ? 'STAMINA — ZMĘCZONY' : `STAMINA ${Math.round(P.sta)}`, P.sta / P.maxSta, P.exhausted ? '#ff8a5c' : '#5cc8ff');
    bar(90, P.ki >= 1 ? (P.form < 3 ? `KI PEŁNE → Y = poziom ${P.form + 1}` : 'KI PEŁNE') : `KI ${Math.round(P.ki * 100)}%`, P.ki, P.ki >= 1 ? '#fff07a' : '#ffd34d');
    g.fillStyle = '#ffcf7a'; g.font = 'bold 28px system-ui, sans-serif';
    g.fillText(`Poziom ${P.form}   KO: ${stats.kos}`, 18, 160);
    g.fillStyle = '#ff8a95'; g.font = '24px system-ui, sans-serif';
    g.fillText(`Rywal: ${Math.max(0, Math.round(enemy.hp))}/${enemy.maxHp}${P.inMelee ? '   ⚔ WALKA' : ''}`, 18, 194);
    if (P.msgT > 0) { g.fillStyle = '#ffffff'; g.font = 'bold 28px system-ui, sans-serif'; g.fillText(P.msg, 18, 236); }
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
    'Oba spusty → lot tam, gdzie celujesz',
  ]);
  sec(390, 'Walka wręcz — tylko ręce i nogi', [
    'Spust → pięść,  chwyt → kopnięcie',
    'Trzymaj dłużej = mocniejszy cios (inny ruch)',
    'Ręka nad nim = z góry, pod nim = podbródkowy',
    'X / A → blok: ręka tam, skąd leci cios',
    'Oba spusty w górze, puść w dół → młot',
  ]);
  sec(670, 'Aura, KI i poziomy', [
    'Chwyt obu, ręce w dół → aura ładuje KI',
    '(im mniej życia, tym szybciej)',
    'Pełne KI → Y = wyższy poziom, trzymaj Y = niższy',
    'B → powrót na start,  prawa gałka → obrót',
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

const DESK_HELP = 'Podgląd: lewa ręka <kbd>Q</kbd> spust, <kbd>A</kbd> chwyt, <kbd>Z</kbd> blok; prawa <kbd>E</kbd>, <kbd>D</kbd>, <kbd>C</kbd>. Pozy: <kbd>1</kbd> dłonie razem, <kbd>2</kbd> w górę, <kbd>3</kbd> w dół. <kbd>Spacja</kbd> fala, <kbd>T</kbd> poziom (przytrzymaj = niżej), <kbd>R</kbd> powrót, mysz — rozglądanie.';
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

let gameTime = 0;
function frame() {
  const realDt = Math.min(clock.getDelta(), 0.05);
  // zamrożenie przy trafieniu i krótkie spowolnienie po mocnym ciosie
  let scale = 1;
  if (P.hitStop > 0) { P.hitStop -= realDt; scale = 0.06; }
  else if (P.slowmo > 0) { P.slowmo -= realDt; scale = 0.35; }
  const dt = realDt * scale;
  gameTime += dt;
  const t = gameTime;
  const xr = renderer.xr.isPresenting;

  computeHead();
  for (const st of inputs) { if (xr) readXRInput(st); else readDeskInput(st, realDt); trackVelocity(st, clock.elapsedTime); }
  computeHands();
  ctx.right.copy(F.right);

  updateKi(dt);
  updateCombat(dt);
  moveRig(dt);
  if (xr) updateButtonsXR();
  updateLevelButton(realDt);
  computeHead();
  ctx.anchor.copy(F.head).sub(SK.camOff);

  // stamina: odnawia się po chwili bez ataku (szybko przy aurze), wyższy poziom ją powoli zjada
  P.lastAct += dt;
  if (aura.powering) P.sta += 30 * dt;
  else {
    if (FLY.speed > 1) { P.sta -= 3 * staMul() * dt; P.lastAct = Math.min(P.lastAct, 0.5); }
    else if (P.lastAct > 0.8) P.sta += CFG.staRegen * dt;
    P.sta -= CFG.upkeep[P.form] * dt;
  }
  P.sta = clamp(P.sta, 0, P.maxSta);
  if (P.sta <= 1 && !P.exhausted) { P.exhausted = true; msg('Zmęczony! Odpocznij albo naładuj aurę', 2); }
  if (P.exhausted && P.sta > 30) P.exhausted = false;

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
    const cur = SK.cur;
    if (cur && cur.kind !== 'kick' && (cur.side === s || cur.both)) {
      strikeFist(cur, h.fistPos, st.pos);
      if (cur.both) h.fistPos.addScaledVector(F.right, s === 'left' ? -0.06 : 0.06);
    }
    h.charge = Math.max(st.punchC, st.kickC, 0);
    kickForAvatar[s] = st.kick;
  }
  avatar.update({ dt: realDt, head: F.head, headFwdFlat: F.fwdFlat, hands: handsForAvatar, flyDir: FLY.dir, flySpeed: FLY.speed, kick: kickForAvatar, glow: aura.level, glowColor: GOLD });
  // smugi za pięścią i stopą przy mocnych ciosach
  const cur = SK.cur;
  const swing = cur && cur.style !== 'jab' && cur.style !== 'kick' && cur.t > cur.S.hit * 0.35 && cur.t < cur.S.hit + 0.08;
  trails.left.update(dt, handsForAvatar.left.fistPos, swing && cur.kind !== 'kick' && (cur.side === 'left' || cur.both), 0.14);
  trails.right.update(dt, handsForAvatar.right.fistPos, swing && cur.kind !== 'kick' && (cur.side === 'right' || cur.both), 0.14);
  trails.footL.update(dt, avatar.footPos.left, swing && cur.kind === 'kick' && cur.side === 'left', 0.18);
  trails.footR.update(dt, avatar.footPos.right, swing && cur.kind === 'kick' && cur.side === 'right', 0.18);

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
window.__sim = { P, K, F, FLY, HAM, SK, enemy, inputs, stats, aura, avatar, rig, keys, desk, applyDesktopCamera, projectiles, eShots, heightAt, ctx, addKi, levelUp, boom, impact };
