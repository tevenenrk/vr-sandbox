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
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { net, joinRoom, leaveRoom, send } from './net.js';
import { renderer, scene, rig, camera, state, UP, clamp, rand, makeCanvasTex, glowTex } from './core.js';
import { sfx, music, HUM_KAME, HUM_SMALL, HUM_GIANT, HUM_AURA, HUM_STRUGGLE } from './audio.js';
import { explosions, fading, boomLight, meleeSpark, teleportFlash, EnergyBall, Beam, KAME_STYLE, SMALL_STYLE, GIANT_STYLE, RED_STYLE, RED_KAME_STYLE, CLASH_STYLE, Aura, Trail, SpeedLines, boom, hitSpark, fadeBall, updateFx } from './fx.js';
import * as canyonWorld from './world.js';
import * as planetWorld from './planet.js';
import { Avatar } from './avatar.js';
import { Enemy, AGGR } from './enemy.js';

// tryb: kanion (domyślnie) albo mała planeta (?mode=planet)
const MODE = new URLSearchParams(location.search).get('mode') === 'planet' ? 'planet' : 'canyon';
const W = MODE === 'planet' ? planetWorld : canyonWorld;
if (MODE === 'planet') { canyonWorld.env.visible = false; planetWorld.init(); }

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
  flySpeeds: [10, 14, 18, 22],
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
const START = new THREE.Vector3(0, W.heightAt(0, 0), 0);
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
  if (!left && keys.KeyX) { st.trig = true; st.grp = true; } // prawa: SPUST+CHWYT naraz (teleport za rywalem)
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

const aura = new Aura(W.debrisGeo, W.debrisMat);
const avatar = new Avatar();
const FLY = { speed: 0, dir: new THREE.Vector3(0, 0, -1), want: false, turbo: false, prevBoth: false, lastTap: -9 };
const speedLines = new SpeedLines();

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
  const n = P.form + 1;
  EV.level++;
  send({ t: 'lvl', form: n });
  startCutscene('player', () => transform(n, CS.head));
}
function levelDown() {
  if (P.form <= 0) return;
  P.form--;
  aura.form = P.form;
  sfx.fizzle();
  msg(`Poziom ${P.form}`, 1.5);
}
function transform(n, head = F.head) {
  P.form = n;
  aura.form = n;
  aura.level = 1;
  const feet = _v1.copy(head); feet.y = W.heightAt(feet.x, feet.z);
  const near = head.y - feet.y < 3;
  boom(near ? feet : _v2.copy(head).addScaledVector(UP, -1), 1.4 + n * 0.5, { big: true, color: 0xffc040, hot: 0xfff0c0, spark: 0xfff0a0, ground: near });
  if (near) netImpact(feet, 1 + n * 0.5, _n);
  sfx.transform(n);
  P.flash = 0.8; P.flashColor.setHex(0xffd060);
  pulseAll(1, 500);
  msg(`POZIOM ${n}!  Siła ×${CFG.dmgMul[n]}`, 2.5);
  if (enemy.hittable && (enemy.state === 'melee' || enemy.chestW.distanceTo(head) < 4)) {
    _v1.subVectors(enemy.chestW, head).setY(0).normalize().multiplyScalar(22).addScaledVector(UP, 6);
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
    if (net.connected) send({ t: 'ko' });
    PK.v.set(0, 0, 0);
    msg('Padłeś! Wracasz na start', 2.5);
    if (enemy.state === 'melee') enemy.leaveMelee(ctx);
    resetRig();
  } else msg('Trafiony!', 0.8);
}
function resetRig() {
  if (MODE === 'planet') START.set(0, Math.max(W.heightAt(0, 0), W.CENTER.y + W.R0) + 1, 0);
  rig.position.copy(START);
  rig.rotation.set(0, 0, 0);
  FLY.speed = 0;
}

// ćwiartka ciała, w której jest ręka (względem głowy i tułowia)
function handZone(st) {
  _v3.subVectors(st.pos, F.head);
  if (_v3.y > 0.02) return 'high';
  if (_v3.y < -0.42) return 'low';
  return _v3.dot(F.right) < 0 ? 'left' : 'right';
}
// liczniki zdarzeń (do trybu treningu)
const EV = { small: 0, kame: 0, giant: 0, flyTime: 0, turbo: 0, level: 0, tp: 0, tpStrike: 0, melee: 0, strong: 0, block: 0, hammer: 0, struggle: 0, bothTrig: 0 };

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
  // blok chroni ćwiartkę ciała, w której jest blokująca ręka (góra / lewo / prawo / dół)
  checkBlock(point, zone) {
    return inputs.some(st => st.blocking && st.blockZone === zone);
  },
  onBlocked(point) {
    sfx.block(point);
    meleeSpark(point, 0.5, 0xbfe8ff);
    EV.block++;
    blockFlash = 1;
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
const K = { mode: 'none', eBall: null, kame: null, kameC: 0, apartT: 0, hum: null, full: false, giant: null, giantHum: null, auraHum: null };
const projectiles = [];
const beams = [];

const aimList = [];
function aimAssist(dir, origin) {
  let best = null, bestAng = Infinity;
  const consider = (p, maxAng) => {
    _v1.subVectors(p, origin).normalize();
    const ang = Math.acos(clamp(_v1.dot(dir), -1, 1));
    if (ang < maxAng && ang < bestAng) { bestAng = ang; best = p; }
  };
  if (enemy.hittable) consider(enemy.chestW, CFG.aimEnemy);
  for (const t of targets) if (t.alive) consider(t.group.position, CFG.aim);
  if (W.aimTargets) for (const sp of W.aimTargets(aimList)) consider(sp, CFG.aimEnemy);
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
  if (K.eBall) { fizzleBall(K.eBall); K.eBall = null; enemy.endStruggle(); }
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
    netShot(projectiles[projectiles.length - 1]);
    stats.shots++;
    EV.small++;
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
    if (K.apartT > CFG.fizzleTime) { fizzleBall(b); K.kame = null; K.hum = stopHum(K.hum); K.mode = 'wait'; enemyReleaseCharge(); return; }
  }
  if (K.hum) K.hum.update(K.kameC, K.apartT > 0 ? 0.5 : 1);
}
function fireKame() {
  const b = K.kame, c = K.kameC;
  K.kame = null;
  K.hum = stopHum(K.hum);
  if (!b) return;
  if (c < CFG.minKame || !spend(14 + 22 * c)) { fizzleBall(b); enemyReleaseCharge(); return; }
  EV.kame++;
  if (K.eBall && enemy.state === 'charging') { const eb = K.eBall; K.eBall = null; startStruggle(b, c, eb); return; }
  if (net.connected && RK.ball && RK.c >= 0 && remoteFacing()) {
    // drugi gracz właśnie ładuje falę → pojedynek
    const eb = RK.ball; RK.ball = null;
    send({ t: 'struggle', o: b.group.position.toArray(), c });
    startStruggle(b, c, eb, true);
    return;
  }
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
  netShot(p);
  beams.push({ beam, proj: p, age: 0 });
  stats.shots++;
  sfx.fire(c);
  pulseAll(0.6 + c * 0.4, 150 + c * 200);
}

// --- rywal odpowiada falą: ładuje razem z graczem, wypuszcza razem z nim ---
function enemyMayMirror() {
  if (net.connected || !enemy.canCharge() || state.xrMode === 'ar' || (TR.on && !TR.allowMirror)) return false;
  const d = enemy.chestW.distanceTo(F.head);
  if (d < 6 || d > 70) return false;
  _v1.subVectors(enemy.chestW, F.head).setY(0).normalize();
  return _v1.dot(F.fwdFlat) > 0.4;
}
function updateEnemyCharge(dt) {
  // rywal zaczyna ładować, gdy gracz ładuje falę i patrzy w jego stronę
  if (K.mode === 'kame' && !K.eBall && enemyMayMirror()) {
    enemy.startCharging();
    K.eBall = new EnergyBall(RED_KAME_STYLE);
    K.eBall.radius = 0.03;
    enemy.handsCenter(K.eBall.group.position);
    msg('Rywal też ładuje falę!', 1.5);
  }
  if (!K.eBall || BS.active) return;
  if (enemy.state !== 'charging') { fizzleBall(K.eBall); K.eBall = null; return; }
  const b = K.eBall;
  b.radius = THREE.MathUtils.lerp(b.radius, Math.max(0.06, kameRadius(Math.max(K.kameC, 0.3)) * 1.05), 1 - Math.exp(-dt * 6));
  b.power = Math.max(0.3, K.kameC);
  enemy.handsCenter(_v1);
  b.group.position.lerp(_v1, 1 - Math.exp(-dt * 20));
  b.update(dt, gameTime);
}
// gracz przestał ładować bez strzału → rywal wypuszcza swoją falę jako zwykły pocisk
function enemyReleaseCharge() {
  if (!K.eBall) return;
  const b = K.eBall;
  K.eBall = null;
  b.gathering = false;
  const dir = _v1.subVectors(F.head, b.group.position).normalize().clone();
  eShots.push({ ball: b, vel: dir.multiplyScalar(15), age: 0 });
  sfx.fire(0.6);
  enemy.endStruggle();
}

// --- pojedynek fal ---
// Siła każdej strony = naładowanie fali × poziom mocy × stamina + szybkość klikania.
// Z komputerem liczy to ta przeglądarka; we dwoje liczy gospodarz i rozsyła wynik.
const BS = { active: false, u: 0.5, t: 0, mash: 0, c: 0, extend: 0, pOrigin: new THREE.Vector3(), eOrigin: new THREE.Vector3(), clashPos: new THREE.Vector3(), spark: 0, mp: false, rf: 1, sendT: 0, uTarget: 0.5 };
function beamForce(c, form, sta, mashRate) {
  return (0.6 + 0.8 * c) * (1 + 0.35 * form) * (0.55 + 0.45 * sta) + mashRate * 0.15;
}
function startStruggle(pBall, c, eBall, mp = false) {
  BS.active = true;
  BS.mp = mp;
  BS.u = 0.5; BS.uTarget = 0.5; BS.t = 0; BS.mash = 0; BS.c = c; BS.extend = 0; BS.spark = 0; BS.rf = 1; BS.sendT = 0;
  BS.pOrigin.copy(pBall.group.position);
  BS.eOrigin.copy(eBall.group.position);
  BS.pBall = pBall; BS.eBall = eBall;
  pBall.gathering = false; eBall.gathering = false;
  pBall.power = 1; eBall.power = 1;
  BS.pBeam = new Beam(Math.max(0.08, pBall.radius * 0.85), BS.pOrigin);
  BS.eBeam = new Beam(Math.max(0.08, eBall.radius * 0.85), BS.eOrigin, 0xffecec, 0xff3a3a);
  BS.clash = new EnergyBall(CLASH_STYLE);
  BS.clash.radius = 0.2;
  BS.clash.group.position.lerpVectors(BS.pOrigin, BS.eOrigin, 0.5);
  BS.hum = sfx.hum(HUM_STRUGGLE);
  if (!mp) enemy.startStruggle();
  FLY.speed = 0;
  K.mode = 'struggle';
  sfx.fire(1); sfx.fire(1, true);
  pulseAll(1, 300);
  msg('POJEDYNEK FAL! Klikaj spust!', 3);
}
function updateStruggle(dt) {
  BS.t += dt;
  BS.extend = Math.min(1, BS.extend + dt / 0.35);
  // każde wciśnięcie spustu dodaje siły (i trochę kosztuje staminy)
  for (const st of inputs) {
    if (st.trig && !st.pTrig) { BS.mash += 1; pulse(st, 0.6, 35); P.lastAct = 0; P.sta = Math.max(0, P.sta - 0.6); }
  }
  BS.mash *= Math.exp(-dt * 2);
  const pF = beamForce(BS.c, P.form, P.sta / P.maxSta, BS.mash * 2);
  let eF;
  if (BS.mp) {
    eF = BS.rf;
    BS.sendT -= dt;
    if (BS.sendT <= 0) {
      BS.sendT = 0.1;
      send({ t: 'sf', f: pF });
      if (net.role === 'host') send({ t: 'su', u: BS.u });
    }
    if (net.role === 'host') { if (BS.extend >= 1) BS.u = clamp(BS.u + (pF - eF) * 0.25 * dt, 0, 1); }
    else BS.u += (BS.uTarget - BS.u) * (1 - Math.exp(-dt * 10));
  } else {
    const surge = Math.sin(BS.t * 1.7) * 0.12 + Math.sin(BS.t * 4.3) * 0.08 + (Math.sin(BS.t * 0.6) > 0.85 ? 0.25 : 0);
    eF = enemy.beamForce() * (1 + surge);
    if (BS.extend >= 1) BS.u = clamp(BS.u + (pF - eF) * 0.25 * dt, 0, 1);
  }
  BS.pF = pF; BS.eF = eF;
  // punkt zderzenia przesuwa się w stronę słabszego
  BS.clashPos.lerpVectors(BS.pOrigin, BS.eOrigin, BS.u);
  BS.pBeam.head.lerpVectors(BS.pOrigin, BS.clashPos, BS.extend);
  BS.eBeam.head.lerpVectors(BS.eOrigin, BS.clashPos, BS.extend);
  const wob = 1 + Math.sin(BS.t * 30) * 0.08;
  BS.pBeam.radius = Math.max(0.08, BS.pBall.radius * 0.85) * wob * (0.8 + pF * 0.12);
  BS.eBeam.radius = Math.max(0.08, BS.eBall.radius * 0.85) * wob * (0.8 + eF * 0.12);
  BS.pBeam.update(gameTime); BS.eBeam.update(gameTime);
  BS.pBall.group.position.copy(BS.pOrigin); BS.pBall.update(dt, gameTime);
  BS.eBall.group.position.copy(BS.eOrigin); BS.eBall.update(dt, gameTime);
  BS.clash.group.position.copy(BS.clashPos);
  BS.clash.radius = (0.35 + (pF + eF) * 0.09) * (1 + Math.sin(BS.t * 18) * 0.12) * BS.extend;
  BS.clash.power = 1;
  BS.clash.update(dt, gameTime);
  BS.spark -= dt;
  if (BS.spark <= 0 && BS.extend >= 1) { BS.spark = 0.09; hitSpark(BS.clashPos, 0.5 + Math.random() * 0.4, Math.random() < 0.5 ? 0xd8b0ff : 0xffffff); }
  if (BS.hum) BS.hum.update(clamp(0.4 + Math.abs(pF - eF) * 0.3, 0, 1));
  if (Math.random() < dt * 8) pulseAll(0.25 + Math.min(0.5, BS.mash * 0.05), 30);
  P.msg = BS.u > 0.5 ? 'Przepychasz! Klikaj dalej!' : 'Rywal napiera! Klikaj spust!'; P.msgT = 0.3;
  // rozstrzygnięcie: z komputerem tutaj, we dwoje — gospodarz
  if (BS.mp && net.role !== 'host') return;
  let res = null;
  if (!BS.mp && !enemy.hittable) res = 'draw';
  else if (BS.u >= 0.985) res = 'win';
  else if (BS.u <= 0.015) res = 'lose';
  else if (BS.t > 25) res = 'draw';
  if (res) {
    if (BS.mp) send({ t: 'se', r: res === 'win' ? 'lose' : res === 'lose' ? 'win' : 'draw' });
    endStruggle(res);
  }
}
function endStruggle(result) {
  if (!BS.active) return;
  BS.active = false;
  EV.struggle++;
  for (const b of [BS.pBeam, BS.eBeam]) b.dispose();
  fadeBall(BS.pBall); fadeBall(BS.eBall); fadeBall(BS.clash);
  BS.hum = stopHum(BS.hum);
  K.mode = 'wait';
  const away = _v1.subVectors(BS.eOrigin, BS.pOrigin).normalize().clone();
  if (result === 'win') {
    const pos = BS.mp ? BS.eOrigin.clone() : enemy.chestW.clone();
    boom(pos, 2.2 + BS.c, { big: true, color: 0x3aa8ff });
    sfx.explode(pos, 3);
    if (!BS.mp) { enemy.endStruggle(); enemy.hitByBall((40 + 30 * BS.c) * dmgMul(), away, true, ctx); }
    stats.hits++;
    msg('WYGRAŁEŚ POJEDYNEK!', 2.5);
  } else if (result === 'lose') {
    const pos = BS.pOrigin.clone().addScaledVector(away, 0.6);
    boom(pos, 1.6, { big: true, color: 0xff3a3a, hot: 0xffd0c0, spark: 0xffb0b0 });
    sfx.explode(pos, 2.5);
    if (!BS.mp) enemy.endStruggle();
    hurtPlayer(BS.mp ? 35 : 30 * enemy.A.dmg);
    rig.position.addScaledVector(away.setY(0).normalize(), -3);
    if (P.hp > 0) msg('Przegrałeś pojedynek!', 2.5);
  } else {
    boom(BS.clashPos.clone(), 2, { big: true, color: 0xc88cff, hot: 0xffffff, spark: 0xe0c0ff });
    sfx.explode(BS.clashPos, 2.5);
    if (!BS.mp) { enemy.endStruggle(); if (enemy.hittable) enemy.damage(10); }
    hurtPlayer(8);
    msg('Remis — fale się zniosły', 2);
  }
  P.hitStop = 0.15;
  pulseAll(1, 400);
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
  EV.giant++;
  b.gathering = false;
  const dir = F.fwd.clone();
  if (dir.y > 0.2) dir.y = 0.2;
  dir.normalize();
  aimAssist(dir, b.group.position);
  netShot(projectiles[projectiles.push({ kind: 'giant', ball: b, beam: null, vel: dir.multiplyScalar(8 + P.form * 2), speed: 8, charge: b.power, age: 0, origin: b.group.position.clone(), prev: new THREE.Vector3() }) - 1]);
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
  if (K.mode === 'struggle') { if (BS.active) updateStruggle(dt); return; }
  updateEnemyCharge(dt);
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
      if (!(L.grp && R.grp)) { fireKame(); if (K.mode !== 'struggle') K.mode = 'wait'; } else updateKame(dt);
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
  // nie szybciej niż animacja, a w zwarciu dopiero gdy rywal wróci po poprzednim ciosie
  if (SK.cur || (P.inMelee && !enemy.readyForHit())) { SK.queue = { kind, st, c, t: clock.elapsedTime }; return; }
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
  const bh = cur.style !== 'hammer' ? enemy.blocksHit(c, P.form) : false;
  if (bh === 'pierced') msg('Przebiłeś blok!', 1);
  if (bh === true) {
    sfx.block(hitPos); hitSpark(hitPos, 0.3, 0xffd0a0); msg('Rywal zablokował', 0.8);
    P.hitStop = 0.05;
    pulse(cur.st, 0.3, 40);
    return;
  }
  const away = _v1.subVectors(enemy.chestW, F.head).setY(0).normalize().clone();
  const juggle = enemy.state !== 'melee';
  // siła: słaby (krótka reakcja), średni (odrzut na kilka metrów), mocny (wyrzut)
  const tier = (c >= 0.7 || cur.style === 'hammer' || cur.forceLaunch) ? 'strong' : c >= 0.35 ? 'medium' : 'weak';
  const dmg = cur.S.dmg * (0.6 + c * 0.8) * dm;
  let launch = null;
  if (cur.forceLaunch) launch = cur.forceLaunch;
  else if (tier === 'strong' || (juggle && c >= 0.3)) {
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
  const knock = launch ? 0 : tier === 'medium' ? (cur.kind === 'kick' ? 3.2 : 2.6) : 0.35;
  enemy.hitMelee(bh === 'pierced' ? dmg * 0.8 : dmg, away, launch, ctx, REACT_BY_ZONE[cur.zone] || 'head_back', strong, knock, { zone: cur.zone, charged: c >= 0.7 });
  meleeSpark(hitPos, tier === 'strong' ? 1 : tier === 'medium' ? 0.6 : 0.3, launch ? 0xffe080 : 0xffffff);
  EV.melee++;
  if (launch) EV.strong++;
  if (cur.style === 'hammer') EV.hammer++;
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

// sygnał, że cios jest naładowany: wibracja i dźwięk przy progu średniego i mocnego ciosu
function chargeTick(st, a, b) {
  if (a < 0.35 && b >= 0.35) { pulse(st, 0.3, 40); sfx.tone({ type: 'sine', f0: 660, f1: 660, gain: 0.05, dur: 0.12 }); }
  if (a < 0.7 && b >= 0.7) { pulse(st, 0.8, 90); sfx.tone({ type: 'triangle', f0: 990, f1: 1320, gain: 0.08, dur: 0.18 }); }
}
function updateCombat(dt) {
  const L = side('left'), R = side('right');
  const enemyNear = enemy.hittable && enemy.chestW.distanceTo(F.head) < CFG.reach + 0.6;
  const bothTrig = L.valid && R.valid && L.trig && R.trig;
  if (bothTrig && F.up && (P.inMelee || enemyNear) && !HAM.armed) { HAM.armed = true; HAM.done = false; HAM.armY = F.mid.y; }
  if (HAM.armed && L.trig && R.trig) HAM.armY = Math.max(HAM.armY, F.mid.y);
  FLY.want = bothTrig && !P.inMelee && !HAM.armed && state.xrMode !== 'ar' && K.mode !== 'struggle';
  // dwa szybkie kliknięcia obu spustów → turbo lot (na komputerze także Shift)
  if (bothTrig && !FLY.prevBoth) {
    const now = clock.elapsedTime;
    if (now - FLY.lastTap < 0.5 && FLY.want) { FLY.turbo = true; EV.turbo++; sfx.fire(0.4); msg('TURBO!', 0.8); }
    EV.bothTrig++;
    FLY.lastTap = now;
  }
  if (!FLY.want) FLY.turbo = false;
  if (FLY.want && keys.ShiftLeft) FLY.turbo = true;
  FLY.prevBoth = bothTrig;
  if (K.mode === 'struggle') { for (const st of [L, R]) { st.punchC = -1; st.kickC = -1; } return; }

  for (const st of [L, R]) {
    // pięść: spust (ładowanie trwa także w czasie animacji poprzedniego ciosu)
    if (st.trig && !st.pTrig) st.punchC = 0;
    if (st.trig && st.punchC >= 0) { const pc = st.punchC; st.punchC = Math.min(1, st.punchC + dt / CFG.punchTime); chargeTick(st, pc, st.punchC); }
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
      if (st.grp && st.kickC >= 0) { const kc = st.kickC; st.kickC = Math.min(1, st.kickC + dt / CFG.kickTime); chargeTick(st, kc, st.kickC); }
      if (!st.grp && st.pGrp && st.kickC >= 0) { startStrike('kick', st, st.kickC); st.kickC = -1; }
    } else st.kickC = -1;
    st.blocking = st.blk && st.valid;
    st.blockZone = st.blocking ? handZone(st) : null;
    if (st.blocking && !st.pBlk) sfx.shieldUp();
    st.pBlk = st.blocking;
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
    }
  }
  if (!SK.cur && SK.queue) {
    const q = SK.queue;
    if (clock.elapsedTime - q.t > 1.5) SK.queue = null;
    else if (!P.inMelee || enemy.readyForHit()) { SK.queue = null; startStrike(q.kind, q.st, q.c); }
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
  const target = want ? (P.exhausted ? 4 : CFG.flySpeeds[P.form] * (FLY.turbo ? 2.6 : 1)) : 0;
  FLY.speed += (target - FLY.speed) * (1 - Math.exp(-dt * (want ? 2.5 : 4)));
  if (want) EV.flyTime += dt;
  if (FLY.speed > 0.01) {
    const step = _v2.copy(FLY.dir).multiplyScalar(FLY.speed * dt);
    const nx = F.head.x + step.x, nz = F.head.z + step.z, ny = F.head.y + step.y;
    const g = W.heightAt(nx, nz);
    if (g > ny - 0.4) {
      const climb = g - (ny - 0.4);
      if (climb < 1.2) step.y += climb;               // łagodne zbocze — wznieś się
      else { step.x = 0; step.z = 0; FLY.speed *= 0.6; } // ściana — stop
    }
    if (W.pillarHit(_v3.set(nx, ny - 0.5, nz), 0.4, _n)) { step.x = 0; step.z = 0; }
    rig.position.add(step);
    const r = Math.hypot(rig.position.x, rig.position.z);
    if (r > W.ARENA_RADIUS - 3) { rig.position.x *= (W.ARENA_RADIUS - 3) / r; rig.position.z *= (W.ARENA_RADIUS - 3) / r; }
    rig.position.y = Math.min(rig.position.y, W.MAX_Y);
    camera.getWorldPosition(_v1);
    const g2 = W.heightAt(_v1.x, _v1.z);
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
    // kliknięcie lewej gałki → agresja rywala, prawej → muzyka
    const stick = !!(gp.buttons[3] && gp.buttons[3].pressed);
    if (stick && !st.pStick) { if (st.handedness === 'left') cycleAggr(); else toggleMusic(); }
    st.pStick = stick;
    if (st.handedness === 'right' && st.back && !st.pBack) {
      if (trainingSkip()) { st.pBack = st.back; continue; }
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
  // w pełni naładowana wielka kula rozsadza całą planetę
  if (MODE === 'planet' && surface && p.kind === 'giant' && p.charge >= 0.95 && W.isAlive()) {
    W.destroyPlanet(pos);
    msg('PLANETA PĘKA!', 3);
    P.slowmo = 1.5;
  }
  if (surface) {
    if (surface.wallN) { W.wallDecal(pos, surface.wallN, crater * 0.9); W.spawnDebris(pos, crater, surface.wallN); }
    else { netImpact(pos, crater, _n); floor = _n.y > 0.6; }
    stats.craters++;
  }
  const red = p.ball.o === RED_STYLE;
  boom(pos, size, { big: true, ground: floor, color: red ? 0xff3a3a : 0x3aa8ff, hot: red ? 0xffd0c0 : 0xd8f4ff, spark: red ? 0xffb0b0 : 0xbff0ff });
  netBoom(p, pos, size, red, floor);
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
    // na planecie kule lekko naprowadzają się na statki
    if (W.nearestShip && p.kind !== 'giant') {
      _v1.copy(p.vel).normalize();
      const tgt = W.nearestShip(pos, _v1, 0.94, _v3);
      if (tgt) {
        const sp = p.vel.length();
        _v2.subVectors(tgt, pos).normalize();
        _v1.lerp(_v2, 1 - Math.exp(-dt * 2.5)).normalize();
        p.vel.copy(_v1).multiplyScalar(sp);
      }
    }
    if (!done && W.hitShips && W.hitShips(pos, r)) {
      stats.hits++;
      msg('Statek zestrzelony!', 1.2);
      if (p.kind !== 'giant') { if (p.beam) p.dead = true; fadeBall(p.ball); done = true; }
    }
    if (!done && W.below(pos, r * 0.5)) {
      _v2.copy(pos); _v2.y -= r * 0.5; _v3.copy(p.prev); _v3.y -= r * 0.5;
      const hitP = W.findSurface(_v3, _v2, new THREE.Vector3());
      detonate(p, hitP, {});
      done = true;
    }
    if (!done && W.pillarHit(pos, r * 0.6, _n)) { detonate(p, pos.clone(), { wallN: _n.clone() }); done = true; }
    if (!done && (pos.distanceTo(p.origin) > (MODE === 'planet' ? 700 : 130) || p.age > 15)) { fadeBall(p.ball); done = true; }
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
    if (deskBlock || (inputs.some(st => st.blocking) && pos.distanceTo(F.head) < 1.1)) {
      const dir = _v1.subVectors(enemy.chestW, pos).normalize().clone();
      projectiles.push({ kind: 'small', ball: s.ball, vel: dir.multiplyScalar(22), charge: 0.7, age: 0, origin: pos.clone(), prev: new THREE.Vector3() });
      sfx.block(pos); hitSpark(pos, 0.4, 0xffd0d0); msg('Odbite!', 1);
      eShots.splice(i, 1);
      continue;
    }
    let gone = false;
    const sr = s.ball.radius;
    if (pos.distanceTo(F.head) < 0.25 + sr || pos.distanceTo(torso) < 0.3 + sr) {
      boom(pos, 0.3, { light: false, color: 0xff3a3a, spark: 0xffb0b0 });
      hurtPlayer((9 + enemy.level) * enemy.A.dmg * (sr > 0.2 ? 2 : 1));
      gone = true;
    } else if (pos.y < W.heightAt(pos.x, pos.z)) {
      W.impact(pos, 0.8, _n);
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
      if (!W.isOpen(x, z, 2)) continue;
      this.base.set(x, W.heightAt(x, z) + 1.2 + Math.random() * 4, z);
      if (!W.pillarHit(this.base, 1)) break;
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
    const g = W.heightAt(s.m.position.x, s.m.position.z) + 0.04;
    if (s.m.position.y < g) { s.m.position.y = g; s.vel.multiplyScalar(0.5); s.vel.y = Math.abs(s.vel.y) * 0.5; }
    s.m.rotation.x += dt * 6; s.m.rotation.y += dt * 4;
    if (s.life < 0.5) s.m.scale.multiplyScalar(Math.pow(0.02, dt));
    if (s.life <= 0) { scene.remove(s.m); shards.splice(i, 1); }
  }
}

// ---------------------------------------------------------------------------
// HUD na nadgarstku + tablica z instrukcją + błysk obrażeń
// ---------------------------------------------------------------------------
let infoPanel = null;
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
    const key = `${MODE === 'planet' ? W.stats.buildings + '|' + W.stats.people + '|' + W.stats.ships + '|' + W.stats.destroyed : ''}|${Math.round(P.hp)}|${Math.round(P.sta)}|${P.exhausted}|${Math.round(P.ki * 100)}|${P.form}|${Math.round(enemy.hp)}|${P.inMelee}|${BS.active ? Math.round(BS.u * 50) : -1}|${enemy.aggr}|${P.msgT > 0 ? P.msg : ''}`;
    if (key === last) return;
    last = key;
    g.clearRect(0, 0, 512, 256);
    g.fillStyle = 'rgba(10,12,24,0.78)';
    g.beginPath(); if (g.roundRect) g.roundRect(2, 2, 508, 252, 22); else g.rect(2, 2, 508, 252); g.fill();
    bar(8, `ŻYCIE ${Math.round(P.hp)}`, P.hp / P.maxHp, '#58e07a');
    bar(44, P.exhausted ? 'STAMINA — ZMĘCZONY' : `STAMINA ${Math.round(P.sta)}`, P.sta / P.maxSta, P.exhausted ? '#ff8a5c' : '#5cc8ff');
    bar(80, P.ki >= 1 ? (P.form < 3 ? `KI PEŁNE → Y = poziom ${P.form + 1}` : 'KI PEŁNE') : `KI ${Math.round(P.ki * 100)}%`, P.ki, P.ki >= 1 ? '#fff07a' : '#ffd34d');
    if (MODE === 'planet') {
      const ps = W.stats;
      bar(116, `MIASTA ${Math.round(ps.buildings / ps.buildings0 * 100)}%   LUDZIE ${ps.people}`, ps.buildings / ps.buildings0, '#7fd06a');
    } else bar(116, `RYWAL ${Math.max(0, Math.round(enemy.hp))}/${enemy.maxHp}`, enemy.hp / enemy.maxHp, '#ff4a5a');
    g.fillStyle = '#ffcf7a'; g.font = 'bold 24px system-ui, sans-serif';
    if (MODE === 'planet') g.fillText(`Poz. ${P.form}   Statki: ${W.stats.ships}   Zniszczone: ${W.stats.destroyed}`, 18, 178);
    else g.fillText(`Poz. ${P.form}  KO: ${stats.kos}  ${AGGR[enemy.aggr].name}${P.inMelee ? '  ⚔' : ''}`, 18, 178);
    if (BS.active) {
      // pasek pojedynku: niebieski = ty, czerwony = rywal
      g.fillStyle = '#ff3a3a'; g.fillRect(16, 196, 480, 22);
      g.fillStyle = '#3aa8ff'; g.fillRect(16, 196, 480 * BS.u, 22);
      g.fillStyle = '#ffffff'; g.fillRect(16 + 480 * BS.u - 3, 192, 6, 30);
    }
    if (P.msgT > 0) { g.fillStyle = '#ffffff'; g.font = 'bold 26px system-ui, sans-serif'; g.fillText(P.msg, 18, BS.active ? 246 : 232); }
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
  infoPanel = mesh;
  g.fillStyle = 'rgba(14,12,26,0.82)';
  g.beginPath(); if (g.roundRect) g.roundRect(4, 4, 1016, 892, 36); else g.rect(4, 4, 1016, 892); g.fill();
  g.strokeStyle = 'rgba(255,190,110,0.6)'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#9fe6ff'; g.font = 'bold 56px system-ui, sans-serif';
  g.fillText(MODE === 'planet' ? '🪐 KULA ENERGII — PLANETA' : '⚡ KULA ENERGII — KANION', 40, 80);
  const sec = (y, title, lines) => {
    g.fillStyle = '#ffcf7a'; g.font = 'bold 36px system-ui, sans-serif'; g.fillText(title, 40, y);
    g.fillStyle = '#e8f4ff'; g.font = '31px system-ui, sans-serif';
    lines.forEach((l, i) => g.fillText(l, 52, y + 46 + i * 42));
  };
  sec(150, 'Energia (chwyt = dolny przycisk)', [
    'Chwyt 1 ręki → kula w dłoni, puść → strzał',
    'Chwyt obu, dłonie razem → fala energii',
    'Chwyt obu, ręce w górę → wielka kula',
    'Oba spusty → lot,  2× szybko → TURBO',
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
    'Prawy przy czole + SPUST+CHWYT → teleport (KI)',
    'B → powrót,  gałki: obrót / klik: agresja, muzyka',
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
  W.setWorldMode(mode);
  renderer.setClearColor(0x000000, mode === 'ar' ? 0 : 1);
}
async function startSession(mode) {
  startAudio();
  const type = mode === 'ar' ? 'immersive-ar' : 'immersive-vr';
  try {
    const session = await navigator.xr.requestSession(type, { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    setMode(mode);
    START.set(0, W.heightAt(0, 0), 0);
    resetRig();
    await renderer.xr.setSession(session);
    placeAllTargets();
    overlay.style.display = 'none';
    session.addEventListener('end', () => {
      setMode(null);
      START.set(0, W.heightAt(0, 0), 0);
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
const btnTrain = document.getElementById('btn-train');
if (btnTrain) btnTrain.addEventListener('click', async () => {
  startAudio();
  if (!btnVR.disabled) { await startSession('vr'); if (renderer.xr.isPresenting) startTraining(); }
  else { overlay.style.display = 'none'; startTraining(); }
});

const DESK_HELP = 'Podgląd: lewa ręka <kbd>Q</kbd> spust, <kbd>A</kbd> chwyt, <kbd>Z</kbd> blok; prawa <kbd>E</kbd>, <kbd>D</kbd>, <kbd>C</kbd>. Pozy: <kbd>1</kbd> dłonie razem, <kbd>2</kbd> w górę, <kbd>3</kbd> w dół. <kbd>Spacja</kbd> fala, <kbd>T</kbd> poziom (przytrzymaj = niżej), <kbd>R</kbd> powrót, mysz — rozglądanie.';
(async () => {
  if (!('xr' in navigator)) { info.innerHTML = 'Ta przeglądarka nie obsługuje WebXR.<br>' + DESK_HELP; return; }
  const [vr, ar] = await Promise.all([
    navigator.xr.isSessionSupported('immersive-vr').catch(() => false),
    navigator.xr.isSessionSupported('immersive-ar').catch(() => false),
  ]);
  btnVR.disabled = !vr;
  btnAR.disabled = !ar || MODE === 'planet';
  if (vr || ar) info.textContent = 'Gotowe! Najlepiej grać na kontrolerach (dłonie też działają: pięść = chwyt, szczypnięcie = spust).';
  else info.innerHTML = 'Brak urządzenia VR.<br>' + DESK_HELP;
})();

// --- ustawienia: agresja rywala i muzyka (zapamiętywane w przeglądarce) ---
function loadSetting(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }
function saveSetting(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bez zapisu */ } }
const aggrBtns = [...document.querySelectorAll('#aggr button')];
const musicBtn = document.getElementById('music-btn');
function setAggr(i, announce = true) {
  enemy.setAggr(i);
  saveSetting('aggr', enemy.aggr);
  aggrBtns.forEach((b) => b.classList.toggle('on', +b.dataset.a === enemy.aggr));
  if (announce) msg(`Rywal: ${AGGR[enemy.aggr].name}`, 1.5);
}
function cycleAggr() { setAggr((enemy.aggr + 1) % AGGR.length); }
function setMusic(on) {
  music.setOn(on);
  saveSetting('music', on);
  if (musicBtn) musicBtn.textContent = on ? 'Muzyka: wł.' : 'Muzyka: wył.';
}
function toggleMusic() { setMusic(!music.on); msg(music.on ? 'Muzyka włączona' : 'Muzyka wyłączona', 1); }
aggrBtns.forEach((b) => b.addEventListener('click', () => setAggr(+b.dataset.a, false)));
if (musicBtn) musicBtn.addEventListener('click', () => { sfx.init(); music.start(); toggleMusic(); });
setAggr(loadSetting('aggr', 2), false);
setMusic(loadSetting('music', true));
function startAudio() { sfx.init(); music.start(); }

// --- własny model rywala: wybierany z pliku, zapamiętywany w przeglądarce (IndexedDB) ---
const rivalInfo = document.getElementById('rival-info');
const gltfLoader = new GLTFLoader();
function idb(mode, fn) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('kula-energii', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction('files', mode);
          const r = fn(tx.objectStore('files'));
          tx.oncomplete = () => resolve(r && 'result' in r ? r.result : null);
          tx.onerror = () => resolve(null);
        } catch { resolve(null); }
      };
    } catch { resolve(null); }
  });
}
function loadRival(buffer, label) {
  return new Promise((resolve) => {
    gltfLoader.parse(buffer, '', (gltf) => {
      const r = enemy.setModel(gltf.scene);
      if (r.ok) rivalInfo.textContent = `Model rywala: ${label}`;
      else rivalInfo.textContent = `Ten model nie ma szkieletu Mixamo (brak kości: ${r.missing.slice(0, 4).join(', ')}…)`;
      resolve(r.ok);
    }, (err) => { rivalInfo.textContent = 'Nie udało się wczytać modelu: ' + (err && err.message || err); resolve(false); });
  });
}
document.getElementById('rival-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  rivalInfo.textContent = 'Wczytuję…';
  const buf = await file.arrayBuffer();
  if (await loadRival(buf, file.name)) await idb('readwrite', (st) => { st.put(buf, 'rival'); st.put(file.name, 'rivalName'); });
});
document.getElementById('rival-clear').addEventListener('click', async () => {
  await idb('readwrite', (st) => { st.delete('rival'); st.delete('rivalName'); });
  useDefaultRival();
});
// domyślna postać (models/fighter.glb): rywal w oryginalnych kolorach, gracz w przebarwionym stroju
let fighterScene = null;
function useDefaultRival() {
  if (fighterScene) { enemy.setModel(cloneSkinned(fighterScene)); rivalInfo.textContent = 'Rywal: domyślna postać.'; }
  else enemy.clearModel();
}
(async () => {
  try {
    const gltf = await gltfLoader.loadAsync('models/fighter.glb');
    fighterScene = gltf.scene;
    avatar.setModel(cloneSkinned(fighterScene), { hue: 3.6 });
  } catch (e) { console.warn('Brak modelu postaci', e); }
  const buf = await idb('readonly', (st) => st.get('rival'));
  if (buf) { const name = await idb('readonly', (st) => st.get('rivalName')); loadRival(buf, name || 'zapisany'); return; }
  useDefaultRival();
})();

// klawiatura i mysz (podgląd)
window.addEventListener('keydown', (e) => {
  if (['Space', 'KeyQ', 'KeyE', 'KeyA', 'KeyD'].includes(e.code)) startAudio();
  if (e.code === 'KeyG' && !e.repeat) cycleAggr();
  if (e.code === 'KeyN' && !e.repeat) trainingSkip();
  if (e.code === 'KeyM' && !e.repeat) toggleMusic();
  if (e.code === 'Space') e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'KeyR' && !renderer.xr.isPresenting) { if (enemy.state === 'melee') enemy.leaveMelee(ctx); resetRig(); }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; startAudio(); });
window.addEventListener('pointermove', (e) => {
  if (!drag || renderer.xr.isPresenting) return;
  desk.yaw -= (e.clientX - drag.x) * 0.004;
  desk.pitch = clamp(desk.pitch - (e.clientY - drag.y) * 0.004, -1.4, 1.4);
  drag = { x: e.clientX, y: e.clientY };
  applyDesktopCamera();
});
window.addEventListener('pointerup', () => { drag = null; });
window.addEventListener('wheel', (e) => { if (TP.aiming) TP.dist = clamp(TP.dist - e.deltaY * 0.05, 3, 220); }, { passive: true });
window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Teleport: prawy kontroler przy czole + SPUST i CHWYT prawej ręki → lewą ręką wskaż miejsce,
// lewa gałka = odległość, puść prawą → teleport. Dwa szybkie SPUST+CHWYT prawej, gdy rywal leci
// po mocnym ciosie → teleport tuż przed niego i automatyczny cios w innym kierunku.
// ---------------------------------------------------------------------------
const TP = { aiming: false, dist: 15, point: new THREE.Vector3(), ground: false, comboPrev: false, lastCombo: -9, vPrev: false };
const tpCost = () => 0.25 * [1, 0.85, 0.7, 0.6][P.form];
const TPS_COST = 0.3;
const tpLineGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
const tpLineMat = new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.9, depthTest: false, fog: false });
const tpLine = new THREE.Line(tpLineGeo, tpLineMat);
const tpDropGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
const tpDrop = new THREE.Line(tpDropGeo, tpLineMat);
const tpRingMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false, blending: THREE.AdditiveBlending, fog: false });
const tpRing = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.55, 40).rotateX(-Math.PI / 2), tpRingMat);
for (const o of [tpLine, tpDrop, tpRing]) { o.visible = false; o.frustumCulled = false; o.renderOrder = 30; scene.add(o); }

function foreheadStance(R) {
  if (!renderer.xr.isPresenting) return !!keys.KeyV;
  const fh = _v1.copy(F.head).addScaledVector(UP, 0.06).addScaledVector(F.fwdFlat, 0.08);
  return R.valid && R.pos.distanceTo(fh) < 0.2;
}
function setLine(geo, a, b) {
  const p = geo.attributes.position.array;
  p[0] = a.x; p[1] = a.y; p[2] = a.z; p[3] = b.x; p[4] = b.y; p[5] = b.z;
  geo.attributes.position.needsUpdate = true;
}
function updateTeleport(dt) {
  const L = side('left'), R = side('right');
  const xr = renderer.xr.isPresenting;
  const combo = R.valid && R.trig && R.grp;
  const stance = foreheadStance(R);
  if (!TP.aiming && combo && !TP.comboPrev && K.mode !== 'struggle') {
    if (stance) {
      if (P.ki >= tpCost()) { TP.aiming = true; TP.dist = 15; sfx.shieldUp(); }
      else msg(`Za mało KI na teleport (potrzeba ${Math.round(tpCost() * 100)}%)`, 1.5);
    } else {
      const now = clock.elapsedTime;
      if (now - TP.lastCombo < 0.5) tryTeleportStrike();
      TP.lastCombo = now;
    }
  }
  // na komputerze: przytrzymaj V, kółko myszy = odległość, puść V = teleport
  if (!xr && keys.KeyV && !TP.vPrev && !TP.aiming) {
    if (P.ki >= tpCost()) { TP.aiming = true; TP.dist = 15; } else msg('Za mało KI na teleport', 1.2);
  }
  TP.comboPrev = combo;
  // prawa ręka zarezerwowana: bez kul i ciosów
  if (combo || TP.aiming || (stance && (R.trig || R.grp))) {
    R.trig = R.grp = false; R.punchC = -1; R.kickC = -1;
    if (R.ball) { fadeBall(R.ball); R.ball = null; R.ballHum = stopHum(R.ballHum); }
  }
  if (TP.aiming) {
    L.trig = L.grp = false;
    const gp = L.gamepad;
    const y = gp && gp.axes && gp.axes.length >= 4 ? gp.axes[3] : 0;
    if (Math.abs(y) > 0.15) TP.dist = clamp(TP.dist - y * 45 * dt, 3, 220);
    const origin = xr && L.valid ? L.pos : F.head, dir = xr && L.valid ? L.aim : F.fwd;
    // wzdłuż promienia aż do terenu
    let d = TP.dist; TP.ground = false;
    for (let s = 1; s <= TP.dist; s += 1.5) {
      _v2.copy(origin).addScaledVector(dir, s);
      if (_v2.y < W.heightAt(_v2.x, _v2.z)) { d = s; TP.ground = true; break; }
    }
    TP.point.copy(origin).addScaledVector(dir, d);
    const g = W.heightAt(TP.point.x, TP.point.z);
    if (TP.ground || TP.point.y < g + 0.3) { TP.point.y = g + 0.05; TP.ground = true; }
    const r = Math.hypot(TP.point.x, TP.point.z);
    if (r > W.ARENA_RADIUS - 4) { TP.point.x *= (W.ARENA_RADIUS - 4) / r; TP.point.z *= (W.ARENA_RADIUS - 4) / r; }
    setLine(tpLineGeo, origin, TP.point);
    _v3.copy(TP.point); _v3.y = g;
    setLine(tpDropGeo, TP.point, _v3);
    tpRing.position.copy(TP.ground ? TP.point : _v3).y += 0.06;
    tpRing.scale.setScalar(1 + Math.sin(clock.elapsedTime * 8) * 0.08);
    tpLine.visible = tpRing.visible = true;
    tpDrop.visible = !TP.ground;
    const released = xr ? !combo : !keys.KeyV;
    if (released) doTeleport();
  }
  TP.vPrev = !!keys.KeyV;
}
function moveHeadTo(dest) {
  camera.getWorldPosition(_v1);
  rig.position.add(_v2.subVectors(dest, _v1));
  computeHead();
  for (const st of inputs) { if (renderer.xr.isPresenting) readXRInput(st); else readDeskInput(st, 1); st.hist.length = 0; }
}
function doTeleport() {
  TP.aiming = false;
  tpLine.visible = tpRing.visible = tpDrop.visible = false;
  if (P.ki < tpCost()) { msg('Za mało KI', 1); return; }
  P.ki -= tpCost();
  teleportFlash(_v1.copy(F.head).addScaledVector(UP, -0.5));
  sfx.teleport();
  const dest = TP.point.clone();
  if (TP.ground) dest.y += 1.65;
  dest.y = Math.max(dest.y, W.heightAt(dest.x, dest.z) + 1.65);
  if (enemy.state === 'melee') enemy.leaveMelee(ctx);
  FLY.speed = 0;
  const from = F.head.clone();
  moveHeadTo(dest);
  send({ t: 'tp', a: from.toArray(), b: F.head.toArray() });
  teleportFlash(_v1.copy(F.head).addScaledVector(UP, -0.5));
  EV.tp++;
}
function tryTeleportStrike() {
  if (enemy.state !== 'launched' || !enemy.hittable) { msg('Teleport za rywalem: najpierw wyrzuć go mocnym ciosem', 1.5); return; }
  if (P.ki < TPS_COST) { msg('Za mało KI (potrzeba 30%)', 1.2); return; }
  P.ki -= TPS_COST;
  const flyDir = enemy.vel.lengthSq() > 1 ? enemy.vel.clone().normalize() : F.fwd.clone();
  teleportFlash(_v1.copy(F.head).addScaledVector(UP, -0.5));
  sfx.teleport();
  // stań przed lecącym rywalem, twarzą do niego
  const dest = enemy.pos.clone().addScaledVector(flyDir, 2).addScaledVector(UP, 0.35);
  dest.y = Math.max(dest.y, W.heightAt(dest.x, dest.z) + 1.2);
  _v1.subVectors(enemy.pos, dest).setY(0).normalize();
  const ang = Math.atan2(F.fwdFlat.x * _v1.z - F.fwdFlat.z * _v1.x, F.fwdFlat.dot(_v1));
  camera.getWorldPosition(_v2);
  rig.position.sub(_v2).applyAxisAngle(UP, -ang).add(_v2);
  rig.rotateY(-ang);
  moveHeadTo(dest);
  teleportFlash(_v1.copy(F.head).addScaledVector(UP, -0.4));
  enemy.vel.set(0, 0, 0);
  enemy.timer = 0;
  // nowy kierunek: inny niż dotychczasowy lot (w górę, w dół albo w bok)
  const options = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), F.right.clone(), F.right.clone().negate()]
    .filter(d => d.dot(flyDir) < 0.3);
  const nd = options[Math.floor(Math.random() * options.length)].clone().addScaledVector(F.fwdFlat, 0.3).normalize();
  SK.cur = null; SK.queue = null;
  const R = side('right');
  startStrike('punch', R, 1);
  if (SK.cur) SK.cur.forceLaunch = nd.multiplyScalar(32 * Math.sqrt(dmgMul()));
  P.slowmo = 0.6;
  EV.tpStrike++;
  msg('TELEPORT + CIOS!', 1.5);
}

// ---------------------------------------------------------------------------
// Przerywnik przy zmianie poziomu (5 s, kamera z trzeciej osoby krąży wokół postaci)
// ---------------------------------------------------------------------------
const CS = { active: false, t: 0, dur: 5, who: '', center: new THREE.Vector3(), saveRigPos: new THREE.Vector3(), saveRigRotY: 0, a0: 0, mid: false, onMid: null, head: new THREE.Vector3(), fwd: new THREE.Vector3() };
const _eul = new THREE.Euler();
function startCutscene(who, onMid) {
  if (CS.active) { if (onMid) onMid(); return; }
  cancelKi(); if (K.mode !== 'none') K.mode = 'wait';
  if (TP.aiming) { TP.aiming = false; tpLine.visible = tpRing.visible = tpDrop.visible = false; }
  SK.cur = null; SK.queue = null; FLY.speed = 0;
  if (enemy.state === 'melee') enemy.leaveMelee(ctx);
  CS.active = true; CS.t = 0; CS.mid = false; CS.who = who; CS.onMid = onMid;
  CS.saveRigPos.copy(rig.position); CS.saveRigRotY = rig.rotation.y;
  CS.head.copy(F.head); CS.fwd.copy(F.fwdFlat);
  if (who === 'player') { CS.center.copy(F.head).addScaledVector(UP, -0.55); CS.a0 = Math.atan2(F.fwdFlat.x, F.fwdFlat.z); }
  else {
    enemy.root.updateMatrixWorld(true);
    enemy.chest(CS.center);
    _v1.set(0, 0, 1).applyQuaternion(enemy.root.quaternion);
    CS.a0 = Math.atan2(_v1.x, _v1.z);
  }
  sfx.hum && (CS.hum = sfx.hum(HUM_AURA));
}
function updateCutscene(realDt) {
  CS.t += realDt;
  const k = Math.min(1, CS.t / CS.dur);
  const ang = CS.a0 + (k - 0.15) * 1.7;
  const dist = (CS.who === 'player' ? 3.0 : 4.2) - k * 0.7;
  const O = _v1.set(Math.sin(ang) * dist, 0.25 + Math.sin(k * Math.PI) * 0.7, Math.cos(ang) * dist).add(CS.center);
  O.y = Math.max(O.y, W.heightAt(O.x, O.z) + 0.6);
  _eul.setFromQuaternion(camera.quaternion, 'YXZ');
  const look = _v2.subVectors(CS.center, O);
  const yaw = Math.atan2(-look.x, -look.z);
  rig.rotation.set(0, yaw - _eul.y, 0);
  rig.position.copy(O).sub(_v3.copy(camera.position).applyAxisAngle(UP, rig.rotation.y));
  if (CS.who === 'player') aura.powering = true; else enemy.powerup = Math.min(1, 0.2 + k * 2);
  if (CS.hum) CS.hum.update(Math.min(1, k * 1.5));
  if (Math.random() < realDt * 10) pulseAll(0.2 + k * 0.5, 40);
  if (!CS.mid && CS.t >= 2.3) { CS.mid = true; if (CS.onMid) CS.onMid(); }
  const f = CS.t < 0.3 ? 1 - CS.t / 0.3 : CS.t > CS.dur - 0.3 ? (CS.t - (CS.dur - 0.3)) / 0.3 : 0;
  P.flash = f; P.flashColor.setHex(0x000000);
  if (CS.t >= CS.dur) {
    CS.active = false;
    rig.position.copy(CS.saveRigPos);
    rig.rotation.set(0, CS.saveRigRotY, 0);
    aura.powering = false;
    enemy.powerup = 0;
    CS.hum = stopHum(CS.hum);
    P.flash = 0;
  }
}
function enemyPowerUpScene() {
  startCutscene('enemy', () => {
    enemy.powerUp();
    const pos = enemy.pos.clone();
    boom(pos, 1.6, { big: true, color: 0xff2a4a, hot: 0xffd0d0, spark: 0xffb0c0, ground: false });
    const g = W.heightAt(pos.x, pos.z);
    if (pos.y - g < 4) W.impact(_v1.set(pos.x, g, pos.z), 1.5, _n);
    sfx.transform(enemy.form + 1);
    msg(`Rywal: forma ${enemy.form}! Silniejsze ciosy`, 3);
  });
}

// ---------------------------------------------------------------------------
// Tryb treningu: kolejne zadania z panelem przed graczem
// ---------------------------------------------------------------------------
const TR = { on: false, step: 0, t: 0, base: null, allowMirror: true };
const evd = (k) => EV[k] - TR.base[k];
function placeEnemyAhead(d, up = 3) {
  enemy.state = 'fly'; enemy.root.visible = true; enemy.attack = null;
  if (enemy.hp <= 0) enemy.spawn();
  enemy.pos.copy(F.head).addScaledVector(F.fwdFlat, d);
  enemy.pos.y = Math.max(enemy.pos.y + up, W.heightAt(enemy.pos.x, enemy.pos.z) + 1.5);
  enemy.wp.copy(enemy.pos); enemy.wpT = 6; enemy.engageCD = 1;
}
const STEPS = [
  { t: 'Witaj w treningu!', d: 'Na lewym nadgarstku masz paski: życie, stamina, KI, rywal.\nTen panel pokazuje zadania. B = pomiń zadanie.\nWciśnij oba SPUSTY, aby zacząć.',
    setup() { enemy.setTraining('idle'); TR.allowMirror = false; placeEnemyAhead(45, 8); }, done: () => evd('bothTrig') > 0 && TR.t > 1 },
  { t: 'Kula z jednej dłoni', d: 'Trzymaj CHWYT (dolny przycisk) jednej ręki —\nw dłoni rośnie kula. Puść, aby strzelić.\nStrzel 2 razy.', done: () => evd('small') >= 2 },
  { t: 'Fala energii', d: 'Trzymaj oba CHWYTY z dłońmi blisko siebie.\nPuść, aby wystrzelić falę.', done: () => evd('kame') >= 1 },
  { t: 'Wielka kula', d: 'Oba CHWYTY z rękami NAD GŁOWĄ —\nrośnie wielka kula. Puść, aby rzucić.', done: () => evd('giant') >= 1 },
  { t: 'Lot', d: 'Trzymaj oba SPUSTY — lecisz tam,\ngdzie celują kontrolery. Leć 3 sekundy.', done: () => evd('flyTime') >= 3 },
  { t: 'Turbo', d: 'Kliknij szybko 2× oba SPUSTY i trzymaj — TURBO.', done: () => evd('turbo') >= 1 },
  { t: 'Aura i KI', d: 'Opuść ręce w dół i trzymaj oba CHWYTY.\nAura ładuje KI — im mniej życia, tym szybciej.\nNaładuj KI do pełna.',
    setup() { P.hp = Math.min(P.hp, 40); P.ki = Math.min(P.ki, 0.4); }, done: () => P.ki >= 1 },
  { t: 'Wyższy poziom', d: 'KI pełne! Wciśnij Y (górny przycisk lewego\nkontrolera) — przemiana na wyższy poziom.\nPrzytrzymanie Y cofa poziom.',
    setup() { if (P.form >= 3) P.form = 2; P.ki = 1; }, done: () => evd('level') >= 1 && !CS.active },
  { t: 'Teleport', d: 'Przyłóż prawy kontroler do czoła i przytrzymaj\nSPUST + CHWYT prawej ręki. Lewą ręką wskaż miejsce\n(lewa gałka = odległość). Puść prawą — teleport.',
    setup() { P.ki = 1; }, done: () => evd('tp') >= 1 },
  { t: 'Walka wręcz', d: 'Rywal podleci. SPUST = pięść, CHWYT = kopnięcie.\nSłaby cios go zachwieje, średni odrzuci.\nZadaj 4 ciosy.',
    setup() { enemy.setTraining('dummy'); placeEnemyAhead(8, 0); }, done: () => evd('melee') >= 4 },
  { t: 'Mocny cios', d: 'Przytrzymaj SPUST lub CHWYT ok. 1 s (pięść świeci)\ni puść — mocny cios wyrzuci rywala.', done: () => evd('strong') >= 1 },
  { t: 'Teleport za rywalem', d: 'Wyrzuć rywala mocnym ciosem, a gdy leci —\nkliknij 2× szybko SPUST + CHWYT prawej ręki.\nTeleportujesz się przed niego i uderzysz.',
    setup() { P.ki = 1; }, done: () => evd('tpStrike') >= 1 },
  { t: 'Blok', d: 'Rywal atakuje powoli — czerwony znacznik pokazuje skąd.\nTrzymaj X (lewa) lub A (prawa) z ręką w tej ćwiartce:\nnad głową, z boku albo nisko. Zablokuj 3 ciosy.',
    setup() { enemy.setTraining('attacker'); if (enemy.state !== 'melee') placeEnemyAhead(6, 0); }, done: () => evd('block') >= 3 },
  { t: 'Młot', d: 'Przytrzymaj oba SPUSTY z rękami nad głową,\npotem szybko opuść ręce i puść.',
    setup() { enemy.setTraining('dummy'); if (enemy.state !== 'melee') placeEnemyAhead(6, 0); }, done: () => evd('hammer') >= 1 },
  { t: 'Pojedynek fal', d: 'Odsuń się od rywala (min. 6 m), patrz na niego\ni naładuj falę — rywal też ładuje. Po puszczeniu\nKLIKAJ SPUST jak najszybciej!',
    setup() { enemy.setTraining('idle'); TR.allowMirror = true; if (enemy.state === 'melee') enemy.leaveMelee(ctx); placeEnemyAhead(25, 2); }, done: () => evd('struggle') >= 1 },
  { t: 'Trening ukończony!', d: 'Brawo! B = koniec treningu.\nAgresję rywala zmienisz kliknięciem lewej gałki.', done: () => false },
];
const trainPanel = (() => {
  const { ctx: g, tex } = makeCanvasTex(1024, 400);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.43), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  mesh.visible = false;
  mesh.renderOrder = 28;
  scene.add(mesh);
  let last = '';
  function draw() {
    const S = STEPS[TR.step];
    const key = TR.step + S.t;
    if (key === last) return;
    last = key;
    g.clearRect(0, 0, 1024, 400);
    g.fillStyle = 'rgba(8,16,30,0.86)';
    g.beginPath(); if (g.roundRect) g.roundRect(4, 4, 1016, 392, 30); else g.rect(4, 4, 1016, 392); g.fill();
    g.strokeStyle = 'rgba(120,220,255,0.7)'; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#7fd8ff'; g.font = 'bold 30px system-ui, sans-serif';
    g.fillText(`TRENING  ${TR.step + 1}/${STEPS.length}`, 36, 56);
    g.fillStyle = '#ffffff'; g.font = 'bold 52px system-ui, sans-serif';
    g.fillText(S.t, 36, 122);
    g.fillStyle = '#dfefff'; g.font = '34px system-ui, sans-serif';
    S.d.split('\n').forEach((l, i) => g.fillText(l, 36, 190 + i * 50));
    tex.needsUpdate = true;
  }
  return { mesh, draw };
})();
function startTraining() {
  if (MODE === 'planet') { msg('Trening jest w trybie kanionu', 2); return; }
  if (net.connected) { msg('Trening niedostępny w grze we dwoje', 2); return; }
  TR.on = true;
  enterStep(0);
  msg('Tryb treningu', 2);
}
function stopTraining() {
  TR.on = false;
  trainPanel.mesh.visible = false;
  enemy.setTraining(null);
  TR.allowMirror = true;
  msg('Koniec treningu — walka!', 2);
}
function enterStep(i) {
  TR.step = i; TR.t = 0; TR.base = { ...EV };
  const S = STEPS[i];
  if (S.setup) S.setup();
  sfx.ding();
}
function updateTraining(dt) {
  if (!TR.on) return;
  TR.t += dt;
  const S = STEPS[TR.step];
  if (S.done && S.done()) { msg(`✔ ${S.t}`, 1.5); if (TR.step < STEPS.length - 1) enterStep(TR.step + 1); }
  trainPanel.draw();
  // panel lekko nad i przed graczem, podąża powoli
  const m = trainPanel.mesh;
  _v1.copy(F.head).addScaledVector(F.fwdFlat, 1.6).addScaledVector(UP, 0.42).addScaledVector(F.right, -0.25);
  if (!m.visible) m.position.copy(_v1);
  m.visible = true;
  m.position.lerp(_v1, 1 - Math.exp(-dt * 2.5));
  m.lookAt(F.head);
}
function trainingSkip() {
  if (!TR.on) return false;
  if (TR.step >= STEPS.length - 1) stopTraining();
  else { msg('Pominięto', 1); enterStep(TR.step + 1); }
  return true;
}

// ---------------------------------------------------------------------------
// Gra we dwoje (kod pokoju). Każdy liczy swoje ciało, ciosy i pociski; trafienia, kratery
// i wybuchy są przesyłane do drugiej osoby. Rywal na ekranie = drugi gracz.
// ---------------------------------------------------------------------------
const RK = { ball: null, c: -1, pos: new THREE.Vector3() };   // fala ładowana przez drugiego gracza
const remoteShots = new Map();
let shotId = 1, poseT = 0;
const SPAWN_GUEST = new THREE.Vector3(0, 0, -90);
const roomStatus = document.getElementById('room-status');

function remoteFacing() {
  const d = enemy.chestW.distanceTo(F.head);
  if (d < 6 || d > 90) return false;
  _v1.subVectors(enemy.chestW, F.head).setY(0).normalize();
  return _v1.dot(F.fwdFlat) > 0.3;
}
// krater + powiadomienie drugiej osoby
function netImpact(point, R, out = _n) {
  W.impact(point, R, out);
  send({ t: 'crater', p: point.toArray(), R });
  return out;
}
function netShot(p) {
  if (!net.connected) return;
  p.id = shotId++;
  send({ t: 'shot', id: p.id, k: p.kind, p: p.ball.group.position.toArray(), v: p.vel.toArray(), r: p.ball.radius, c: p.charge });
}
function netBoom(p, pos, size, red, floor) {
  if (!net.connected || !p.id) return;
  send({ t: 'boom', id: p.id, p: pos.toArray(), s: size, red, g: floor });
}
ctx.netHit = (m) => {
  m.form = P.form;
  send({ t: 'hit', ...m });
};
ctx.playerForm = () => P.form;
ctx.onPierced = (point) => {
  sfx.punch(0.8, point);
  meleeSpark(point, 0.7, 0xff9040);
  P.flash = 0.5; P.flashColor.setHex(0xff6020);
  msg('Blok przebity!', 1);
};

// odrzut / wyrzut gracza po trafieniu przez drugą osobę
const PK = { v: new THREE.Vector3(), slam: false };
function launchPlayer(v, slam) {
  PK.v.copy(v); PK.slam = slam;
  FLY.speed = 0;
}
function updatePlayerKnock(dt) {
  if (PK.v.lengthSq() < 0.04) { PK.v.set(0, 0, 0); return; }
  const speed = PK.v.length();
  rig.position.addScaledVector(PK.v, dt);
  PK.v.multiplyScalar(Math.pow(PK.slam ? 0.55 : 0.02, dt));
  if (PK.slam) PK.v.y -= 6 * dt;
  camera.getWorldPosition(_v1);
  const g = W.heightAt(_v1.x, _v1.z);
  if (_v1.y < g + 0.5) {
    rig.position.y += g + 0.5 - _v1.y;
    if (PK.slam && speed > 11) {
      _v2.set(_v1.x, g, _v1.z);
      netImpact(_v2, 1.2 + speed * 0.06);
      boom(_v2, 0.5 + speed * 0.03, { big: true, ground: true, color: 0xff7a30, hot: 0xffe0a0, spark: 0xffd090 });
      sfx.explode(_v2, 1);
      hurtPlayer(Math.min(20, speed * 0.3));
    }
    PK.v.set(0, 0, 0);
  }
}

function onNet(m) {
  switch (m.t) {
    case 'hello':
      if (TR.on) stopTraining();
      cancelKi(); K.mode = 'wait';
      for (const s of eShots) fadeBall(s.ball);
      eShots.length = 0;
      enemy.setRemote(true);
      P.hp = P.maxHp; P.sta = P.maxSta;
      if (net.role === 'guest') {
        START.set(SPAWN_GUEST.x, W.heightAt(SPAWN_GUEST.x, SPAWN_GUEST.z), SPAWN_GUEST.z);
        resetRig();
        rig.rotation.set(0, Math.PI, 0);
      } else { START.set(0, W.heightAt(0, 0), 0); resetRig(); }
      msg('Połączono! Walka 1 na 1', 3);
      sfx.ding();
      break;
    case 'bye':
      enemy.setRemote(false);
      if (BS.active && BS.mp) endStruggle('draw');
      if (RK.ball) { fadeBall(RK.ball); RK.ball = null; }
      for (const [, r] of remoteShots) { fadeBall(r.ball); if (r.beam) r.beam.dispose(); }
      remoteShots.clear();
      START.set(0, W.heightAt(0, 0), 0);
      msg('Koniec gry we dwoje', 2);
      break;
    case 'pose':
      enemy.applyRemote(m);
      RK.c = m.kc;
      if (m.kc >= 0 && m.kp && !BS.active) {
        if (!RK.ball) { RK.ball = new EnergyBall(RED_KAME_STYLE); RK.ball.radius = 0.03; }
        RK.pos.fromArray(m.kp);
        RK.ball.radius = kameRadius(Math.max(0.05, m.kc));
        RK.ball.power = m.kc;
      } else if (RK.ball && !BS.active) { fadeBall(RK.ball); RK.ball = null; }
      break;
    case 'shot': {
      const style = m.k === 'giant' ? GIANT_STYLE : m.k === 'kame' ? RED_KAME_STYLE : RED_STYLE;
      const b = new EnergyBall(style);
      b.radius = m.r; b.power = m.c; b.gathering = false;
      b.group.position.fromArray(m.p);
      const r = { ball: b, vel: new THREE.Vector3().fromArray(m.v), age: 0, beam: null };
      if (m.k === 'kame') r.beam = new Beam(m.r * 0.8, b.group.position, 0xffecec, 0xff3a3a);
      remoteShots.set(m.id, r);
      sfx.fire(m.c, m.k === 'giant');
      break;
    }
    case 'boom': {
      const r = remoteShots.get(m.id);
      if (r) { fadeBall(r.ball); if (r.beam) r.beam.dispose(); remoteShots.delete(m.id); }
      const pos = new THREE.Vector3().fromArray(m.p);
      boom(pos, m.s, { big: true, ground: m.g, color: 0xff3a3a, hot: 0xffd0c0, spark: 0xffb0b0 });
      sfx.explode(pos, m.s);
      break;
    }
    case 'crater': W.impact(new THREE.Vector3().fromArray(m.p), m.R, _n); break;
    case 'hit': onNetHit(m); break;
    case 'blocked':
      sfx.block(enemy.chestW); meleeSpark(enemy.chestW, 0.4, 0xbfe8ff);
      enemy.guardT = 0.4;
      msg('Zablokował!', 0.8);
      break;
    case 'ko': stats.kos++; P.slowmo = 1; msg('NOKAUT!', 2.5); break;
    case 'lvl':
      startCutscene('enemy', () => {
        boom(enemy.pos.clone(), 1.6, { big: true, color: 0xff2a4a, hot: 0xffd0d0, spark: 0xffb0c0 });
        sfx.transform(m.form);
        msg(`Rywal: poziom ${m.form}!`, 3);
      });
      break;
    case 'tp':
      teleportFlash(new THREE.Vector3().fromArray(m.a));
      teleportFlash(new THREE.Vector3().fromArray(m.b));
      sfx.teleport();
      break;
    case 'struggle':
      // drugi gracz wypuścił falę, gdy ja ładuję → pojedynek
      if (K.mode === 'kame' && K.kame) {
        const b = K.kame, c = K.kameC;
        K.kame = null; K.hum = stopHum(K.hum);
        const eb = RK.ball || new EnergyBall(RED_KAME_STYLE);
        RK.ball = null;
        eb.group.position.fromArray(m.o);
        eb.radius = Math.max(eb.radius, 0.08);
        startStruggle(b, c, eb, true);
      }
      break;
    case 'sf': BS.rf = m.f; break;
    case 'su': BS.uTarget = 1 - m.u; break;
    case 'se': endStruggle(m.r); break;
  }
}
function onNetHit(m) {
  const dmg = m.dmg;
  const dir = new THREE.Vector3().fromArray(m.dir || [0, 0, 1]);
  // blok: chroni ćwiartkę, chyba że naładowany cios kogoś z wyższego poziomu
  const zone = m.ball ? null : ({ over: 'high', upper: 'low', hookL: 'right', hookR: 'left', straight: 'high', fold: 'low' })[m.zone] || 'high';
  if (zone && inputs.some(st => st.blocking && st.blockZone === zone)) {
    if (m.charged && m.form > P.form) {
      ctx.onPierced(F.head);
      hurtPlayer(dmg * 0.6);
    } else {
      send({ t: 'blocked' });
      sfx.block(F.head); blockFlash = 1; EV.block++;
      msg('Blok!', 0.8);
      return;
    }
  } else hurtPlayer(dmg);
  if (m.launch) launchPlayer(new THREE.Vector3().fromArray(m.launch), true);
  else if (m.knock) launchPlayer(dir.setY(0).normalize().multiplyScalar(m.knock * 4), false);
  else if (m.strong) launchPlayer(dir.multiplyScalar(18), true);
  P.hitStop = 0.08;
}
function sendPose(dt) {
  poseT -= dt;
  if (poseT > 0) return;
  poseT = 0.05;
  const r2 = (v) => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];
  send({
    t: 'pose', h: r2(F.head), f: [F.fwdFlat.x, F.fwdFlat.z],
    lh: r2(handsForAvatar.left.fistPos), rh: r2(handsForAvatar.right.fistPos),
    lf: r2(avatar.footPos.left), rf: r2(avatar.footPos.right),
    v: r2(PK.v), st: PK.v.length() > 6 ? 'launched' : 'fly', au: aura.level,
    hp: Math.max(0, P.hp), mhp: P.maxHp, fm: P.form,
    kc: K.mode === 'kame' && K.kame ? K.kameC : -1, kp: K.kame ? r2(K.kame.group.position) : null,
  });
}
function updateRemote(dt, t) {
  if (RK.ball && !BS.active) { RK.ball.group.position.lerp(RK.pos, 1 - Math.exp(-dt * 20)); RK.ball.update(dt, t); }
  for (const [id, r] of remoteShots) {
    r.age += dt;
    r.ball.group.position.addScaledVector(r.vel, dt);
    r.ball.update(dt, t);
    if (r.beam) { r.beam.head.copy(r.ball.group.position); r.beam.update(t); }
    if (r.age > 15) { fadeBall(r.ball); if (r.beam) r.beam.dispose(); remoteShots.delete(id); }
  }
}
document.getElementById('room-join').addEventListener('click', () => {
  startAudio();
  const code = document.getElementById('room-code').value;
  joinRoom(code, (t) => { roomStatus.textContent = t; msg(t, 2); }, onNet);
});
document.getElementById('room-leave').addEventListener('click', () => { leaveRoom(); roomStatus.textContent = 'Rozłączono.'; });

// ---------------------------------------------------------------------------
// Tryb planety: planeta obraca się pod graczem; obiekty w świecie (pociski, wybuchy)
// przenosimy tym samym obrotem, żeby nic nie "skakało"
// ---------------------------------------------------------------------------
function recenterWorld() {
  computeHead();
  const q = W.recenter(F.head);
  if (!q) return;
  const C = W.CENTER;
  const rot = (v) => v.sub(C).applyQuaternion(q).add(C);
  rot(rig.position);
  for (const p of projectiles) { rot(p.ball.group.position); p.vel.applyQuaternion(q); rot(p.origin); rot(p.prev); }
  for (const B of beams) { rot(B.beam.tail); rot(B.beam.head); }
  for (const e of explosions) rot(e.group.position);
  for (const b of fading) rot(b.group.position);
  for (const b of [K.kame, K.giant, side('left').ball, side('right').ball]) if (b) rot(b.group.position);
  rot(boomLight.position);
  computeHead();
}
document.querySelectorAll('.modebtn').forEach((el) => el.classList.toggle('on', el.dataset.m === MODE));
if (MODE === 'planet') {
  document.title = 'Mała Planeta VR';
  const p = document.querySelector('#overlay > p');
  if (p) p.textContent = 'Lecisz nad małą planetą z miasteczkami, ludźmi i statkami na orbicie. Aura przy ziemi kruszy grunt, fala robi wielkie kratery, a w pełni naładowana wielka kula rozsadza całą planetę.';
  enemy.state = 'gone'; enemy.root.visible = false; enemy.timer = -1e9;
  for (const t of targets) { t.alive = false; t.group.visible = false; }
  for (const id of ['room-code', 'room-join', 'room-leave', 'room-status', 'aggr']) { const el = document.getElementById(id); if (el) (el.closest('.room-row') || el).style.display = 'none'; }
  resetRig();
}

// ---------------------------------------------------------------------------
// Pętla główna
// ---------------------------------------------------------------------------
const handsForAvatar = {
  left: { valid: false, isHand: false, fistPos: new THREE.Vector3(), quat: new THREE.Quaternion(), wristPos: new THREE.Vector3(), charge: 0 },
  right: { valid: false, isHand: false, fistPos: new THREE.Vector3(), quat: new THREE.Quaternion(), wristPos: new THREE.Vector3(), charge: 0 },
};
const kickForAvatar = { left: null, right: null };

// tarcze bloku (świecą w chronionej ćwiartce)
let blockFlash = 0;
const shields = {};
for (const s of ['left', 'right']) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x8fdcff, blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  m.renderOrder = 22;
  scene.add(m);
  shields[s] = m;
}
const legGuard = { left: false, right: false };
const kickCharge = { left: 0, right: 0 };

// klatka w czasie przerywnika: rozgrywka zatrzymana, tylko przemiana i kamera
function cutsceneFrame(realDt) {
  const xr = renderer.xr.isPresenting;
  for (const st of inputs) { if (xr) readXRInput(st); else readDeskInput(st, realDt); }
  updateCutscene(realDt);
  const t = clock.elapsedTime;
  enemy.flash = 0;
  if (infoPanel) infoPanel.visible = !CS.active;
  hud.sprite.visible = !CS.active;
  trainPanel.mesh.visible = TR.on && !CS.active;
  if (CS.active && CS.who === 'player') {
    aura.level += (1 - aura.level) * (1 - Math.exp(-realDt * 2));
    aura.update(realDt, t, CS.head, W.heightAt(CS.head.x, CS.head.z));
  } else aura.update(realDt, t, CS.head, W.heightAt(CS.head.x, CS.head.z));
  enemy.pose(realDt, t, ctx);
  // postać gracza w pozie ładowania (pięści przy biodrach)
  _v3.crossVectors(CS.fwd, UP).normalize();
  for (const s of ['left', 'right']) {
    const h = handsForAvatar[s], sg = s === 'left' ? -1 : 1;
    h.valid = true; h.isHand = false; h.blockZone = null; h.charge = CS.who === 'player' ? 0.6 : 0;
    h.fistPos.copy(CS.head).addScaledVector(_v3, 0.3 * sg).addScaledVector(UP, -0.78).addScaledVector(CS.fwd, 0.06);
    if (CS.who === 'player') h.fistPos.x += (Math.random() - 0.5) * 0.01;
    h.quat.setFromUnitVectors(_v1.set(0, 0, -1), CS.fwd);
  }
  avatar.update({ dt: realDt, head: CS.head, headFwdFlat: CS.fwd, hands: handsForAvatar, flyDir: null, flySpeed: 0, kick: { left: null, right: null }, glow: aura.level, glowColor: GOLD, showHead: true });
  updateFx(realDt, t);
  W.updateWorld(realDt);
  flashMat.color.copy(P.flashColor);
  flashMat.opacity = P.flash;
  flashSphere.visible = P.flash > 0.01;
  hud.draw();
  sfx.updateListener(camera);
  for (const st of inputs) { st.pTrig = st.trig; st.pGrp = st.grp; st.pBack = st.back; }
  if (!CS.active) computeHead();
  renderer.render(scene, camera);
}

let gameTime = 0;
function frame() {
  if (CS.active) { cutsceneFrame(Math.min(clock.getDelta(), 0.05)); return; }
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

  if (net.connected) P.inMelee = enemy.hittable && enemy.chestW.distanceTo(F.head) < 3;
  updateTeleport(realDt);
  updateKi(dt);
  updateCombat(dt);
  moveRig(dt);
  if (MODE === 'planet') recenterWorld();
  if (xr) updateButtonsXR();
  updateLevelButton(realDt);
  updateTraining(realDt);
  // rywal przechodzi na wyższą formę, gdy traci życie
  if (!BS.active && !P.inMelee && enemy.wantsPowerUp()) enemyPowerUpScene();
  computeHead();
  ctx.anchor.copy(F.head).sub(SK.camOff);

  // stamina: odnawia się po chwili bez ataku (szybko przy aurze), wyższy poziom ją powoli zjada
  P.lastAct += dt;
  if (aura.powering) P.sta += 30 * dt;
  else {
    if (FLY.speed > 1) { P.sta -= (FLY.turbo ? 9 : 3) * staMul() * dt; P.lastAct = Math.min(P.lastAct, 0.5); }
    else if (P.lastAct > 0.8) P.sta += CFG.staRegen * dt;
    P.sta -= CFG.upkeep[P.form] * dt;
  }
  P.sta = clamp(P.sta, 0, P.maxSta);
  if (P.sta <= 1 && !P.exhausted) { P.exhausted = true; msg('Zmęczony! Odpocznij albo naładuj aurę', 2); }
  if (P.exhausted && P.sta > 30) P.exhausted = false;

  if (MODE !== 'planet') enemy.update(dt, t, ctx);
  else {
    W.auraTick(F.head, dt, aura.level, aura.powering);
    const dtxt = W.destructionText();
    if (dtxt) msg(dtxt, 0.3);
  }
  updatePlayerKnock(dt);
  updateRemote(dt, t);
  if (net.connected) sendPose(realDt);
  if (K.kame) K.kame.update(dt, t);
  if (K.giant) K.giant.update(dt, t);
  for (const st of inputs) if (st.ball) st.ball.update(dt, t);
  updateProjectiles(dt, t);
  if (MODE !== 'planet') for (const tg of targets) tg.update(dt, t);
  updateShards(dt);
  W.updateWorld(dt);
  updateFx(dt, t);

  // aura: poziom zależy od formy, ładowanie podbija do maksimum
  const goal = aura.powering ? 1 : CFG.formBase[P.form];
  aura.level += (goal - aura.level) * (1 - Math.exp(-dt * (goal > aura.level ? 0.8 : 0.3)));
  aura.form = P.form;
  aura.update(dt, t, F.head, W.heightAt(F.head.x, F.head.z));

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
    h.charge = Math.max(st.punchC, 0);
    kickCharge[s] = Math.max(st.kickC, 0);
    h.blockZone = st.blocking && !(cur && (cur.side === s || cur.both)) ? st.blockZone : null;
    legGuard[s] = h.blockZone === 'low';
    kickForAvatar[s] = st.kick;
  }
  avatar.update({ dt: realDt, t: clock.elapsedTime, head: F.head, headFwdFlat: F.fwdFlat, hands: handsForAvatar, flyDir: FLY.dir, flySpeed: FLY.speed, kick: kickForAvatar, kickCharge, glow: aura.level, glowColor: GOLD, legGuard });
  // tarcza w ćwiartce bloku
  blockFlash = Math.max(0, blockFlash - realDt * 3);
  for (const s of ['left', 'right']) {
    const h = handsForAvatar[s], sh = shields[s];
    const on = !!h.blockZone;
    sh.material.opacity += ((on ? 0.35 + blockFlash * 0.6 : 0) - sh.material.opacity) * (1 - Math.exp(-realDt * 15));
    sh.visible = sh.material.opacity > 0.01;
    if (sh.visible) {
      sh.position.copy(h.fistPos).addScaledVector(F.fwdFlat, 0.1);
      sh.scale.setScalar(0.42 + blockFlash * 0.25 + Math.sin(clock.elapsedTime * 10) * 0.02);
    }
  }
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
  speedLines.update(realDt, FLY.turbo ? clamp(FLY.speed / 25, 0, 1) : clamp((FLY.speed - 9) / 12, 0, 0.4), FLY.speed);
  music.intensity = BS.active ? 2 : (P.inMelee || enemy.state === 'rush' || enemy.state === 'charging' || FLY.turbo) ? 1 : 0;

  for (const st of inputs) { st.pTrig = st.trig; st.pGrp = st.grp; st.pBack = st.back; }
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);

// do testów w konsoli
window.__sim = { net, onNet, RK, PK, remoteShots, TP, CS, TR, EV, STEPS, startTraining, BS, music, P, K, F, FLY, HAM, SK, enemy, inputs, stats, aura, avatar, rig, keys, desk, applyDesktopCamera, projectiles, eShots, heightAt: W.heightAt, ctx, addKi, levelUp, boom, impact: W.impact, W, MODE };
