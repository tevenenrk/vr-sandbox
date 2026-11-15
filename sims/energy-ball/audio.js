// Dźwięki syntezowane w Web Audio — bez plików.
import * as THREE from 'three';

const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3();
const _q = new THREE.Quaternion();

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
  // krótki szum przez filtr z obwiednią
  burst({ type = 'lowpass', f0 = 1000, f1 = 200, q = 1, gain = 0.5, dur = 0.3, out } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime;
    const nz = this.noiseSrc();
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, now); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    nz.connect(f).connect(g).connect(out || this.master);
    nz.start(now); nz.stop(now + dur + 0.05);
  }
  tone({ type = 'sine', f0 = 200, f1 = 60, gain = 0.5, dur = 0.3, out, delay = 0 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, now); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g).connect(out || this.master);
    o.start(now); o.stop(now + dur + 0.05);
  }
  // ciągły dźwięk ładowania
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
    const dur = 0.9 + level * 0.8 + (deep ? 0.8 : 0);
    this.burst({ type: 'bandpass', f0: deep ? 1200 : 3500, f1: deep ? 120 : 350, q: 0.9, gain: 0.5 + level * 0.5, dur });
    this.tone({ f0: deep ? 90 : 160, f1: deep ? 25 : 38, gain: 0.6 + level * 0.4, dur: 0.8 });
  }
  smallShot() {
    this.burst({ type: 'bandpass', f0: 4000, f1: 800, q: 1.5, gain: 0.3, dur: 0.35 });
    this.tone({ type: 'triangle', f0: 900, f1: 300, gain: 0.15, dur: 0.25 });
  }
  explode(pos, size) {
    if (!this.ctx) return;
    const out = this.spatial(pos);
    const dur = 1.0 + Math.min(size, 8) * 0.5;
    this.burst({ f0: 2500, f1: 70, gain: 1.4 * Math.min(2.5, 0.5 + size), dur, out });
    this.tone({ f0: 90, f1: 22, gain: 1.0, dur, out });
  }
  fizzle() { this.burst({ type: 'highpass', f0: 2500, f1: 2500, gain: 0.25, dur: 0.4 }); }
  ding() {
    for (const [f, v] of [[880, 0.12], [1320, 0.08], [1760, 0.05]]) this.tone({ f0: f, f1: f, gain: v, dur: 0.6 });
  }
  punch(power, pos) {
    if (!this.ctx) return;
    const out = pos ? this.spatial(pos) : undefined;
    this.burst({ f0: 1400, f1: 120, gain: 0.5 + power * 0.7, dur: 0.18 + power * 0.15, out });
    this.tone({ f0: 160, f1: 45, gain: 0.6 + power * 0.5, dur: 0.2 + power * 0.15, out });
    if (power > 0.7) this.burst({ type: 'bandpass', f0: 3000, f1: 400, gain: 0.4, dur: 0.5, out });
  }
  block(pos) {
    if (!this.ctx) return;
    const out = pos ? this.spatial(pos) : undefined;
    this.burst({ type: 'bandpass', f0: 2600, f1: 1800, q: 4, gain: 0.5, dur: 0.15, out });
    this.tone({ type: 'triangle', f0: 1250, f1: 1150, gain: 0.18, dur: 0.25, out });
    this.tone({ type: 'triangle', f0: 1870, f1: 1800, gain: 0.1, dur: 0.2, out });
  }
  whoosh(power) { this.burst({ type: 'bandpass', f0: 500, f1: 2600, q: 1.2, gain: 0.12 + power * 0.25, dur: 0.18 }); }
  warn() { this.tone({ type: 'square', f0: 520, f1: 780, gain: 0.06, dur: 0.12 }); }
  hurt() {
    this.tone({ type: 'sawtooth', f0: 260, f1: 90, gain: 0.25, dur: 0.25 });
    this.burst({ f0: 900, f1: 100, gain: 0.6, dur: 0.25 });
  }
  transform(form) {
    if (!this.ctx) return;
    this.tone({ type: 'sawtooth', f0: 80, f1: 500 + form * 150, gain: 0.25, dur: 0.9 });
    this.tone({ type: 'sawtooth', f0: 81, f1: 505 + form * 150, gain: 0.2, dur: 0.9 });
    this.burst({ f0: 3000, f1: 60, gain: 1.4, dur: 2.0 });
    this.tone({ f0: 70, f1: 22, gain: 1.0, dur: 1.6, delay: 0.1 });
  }
  wind(speed) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windG.gain.setTargetAtTime(Math.min(0.35, speed / 16 * 0.3), t, 0.1);
    this.windF.frequency.setTargetAtTime(300 + speed * 70, t, 0.1);
  }
  updateListener(cam) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    cam.getWorldPosition(_p);
    cam.getWorldDirection(_f);
    _u.set(0, 1, 0).applyQuaternion(cam.getWorldQuaternion(_q));
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(_p.x, t); l.positionY.setValueAtTime(_p.y, t); l.positionZ.setValueAtTime(_p.z, t);
      l.forwardX.setValueAtTime(_f.x, t); l.forwardY.setValueAtTime(_f.y, t); l.forwardZ.setValueAtTime(_f.z, t);
      l.upX.setValueAtTime(_u.x, t); l.upY.setValueAtTime(_u.y, t); l.upZ.setValueAtTime(_u.z, t);
    } else if (l.setPosition) {
      l.setPosition(_p.x, _p.y, _p.z);
      l.setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z);
    }
  }
}
export const sfx = new Sfx();
export const HUM_KAME = { f0: 70, f1: 220, c0: 400, c1: 3600, g0: 0.08, g1: 0.22, l0: 9, l1: 23, n0: 1800, n1: 4300 };
export const HUM_SMALL = { f0: 160, f1: 320, c0: 900, c1: 3000, g0: 0.03, g1: 0.08, l0: 14, l1: 26, n0: 3000, n1: 5000 };
export const HUM_GIANT = { f0: 38, f1: 95, c0: 220, c1: 1600, g0: 0.1, g1: 0.3, l0: 3, l1: 8, n0: 400, n1: 1400, noise: 0.35 };
export const HUM_AURA = { f0: 45, f1: 70, c0: 300, c1: 1500, g0: 0.05, g1: 0.25, l0: 14, l1: 24, n0: 600, n1: 1300, noise: 0.5 };
export const HUM_STRUGGLE = { f0: 55, f1: 130, c0: 500, c1: 3800, g0: 0.12, g1: 0.3, l0: 18, l1: 32, n0: 1500, n1: 5000, noise: 0.6 };

// ---------------------------------------------------------------------------
// Muzyka walki — własny, prosty podkład generowany na żywo (perkusja, bas, arpeggio).
// intensity: 0 spokój, 1 walka, 2 pojedynek fal
// ---------------------------------------------------------------------------
class Music {
  constructor() { this.on = true; this.intensity = 0; this.started = false; this.vol = 0.2; }
  start() {
    const c = sfx.ctx;
    if (!c || this.started) return;
    this.started = true;
    this.out = c.createGain();
    this.out.gain.value = this.on ? this.vol : 0;
    this.out.connect(sfx.master);
    this.bpm = 146;
    this.step = 0;
    this.next = c.currentTime + 0.15;
    this.timer = setInterval(() => this.schedule(), 25);
  }
  setOn(v) {
    this.on = v;
    if (this.out) this.out.gain.setTargetAtTime(v ? this.vol : 0, sfx.ctx.currentTime, 0.2);
  }
  schedule() {
    const c = sfx.ctx;
    if (!c || c.state !== 'running' || !this.on) { if (c) this.next = Math.max(this.next, c.currentTime + 0.05); return; }
    const spb = 60 / this.bpm / 4;
    while (this.next < c.currentTime + 0.12) {
      this.play(this.step, this.next, spb);
      this.next += spb;
      this.step = (this.step + 1) % 64;
    }
  }
  play(s, t, spb) {
    const bar = Math.floor(s / 16), i = s % 16, I = this.intensity;
    // akordy: d-moll, B-dur, C-dur, A-dur (i–VI–VII–V)
    const roots = [0, -4, -2, -5], minor = bar === 0;
    const root = 73.42 * Math.pow(2, roots[bar] / 12);
    // perkusja
    if (i % 4 === 0 || (I >= 1 && (i === 10 || i === 14))) this.kick(t);
    if (i === 4 || i === 12) this.snare(t, 0.8);
    if (I >= 2 && i >= 13) this.snare(t, 0.45);
    if (i % 2 === 0 || I >= 1) this.hat(t, i % 4 === 2 ? 0.6 : 0.3);
    // bas szesnastkowy
    const bp = [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 12, 10, 7];
    if (I >= 1 || i % 2 === 0) this.bass(t, root * Math.pow(2, bp[i] / 12), spb * 0.9);
    // arpeggio w walce
    if (I >= 1 && i % 2 === 0) {
      const chord = minor ? [0, 3, 7, 12] : [0, 4, 7, 12];
      const k = (i / 2 + (bar % 2) * 2) % 4;
      this.lead(t, root * 4 * Math.pow(2, chord[k] / 12), spb * 1.8, I >= 2 ? 0.1 : 0.07);
    }
    // akcent na początku taktu
    if (i === 0 && I >= 1) this.stab(t, root * 2, minor);
  }
  env(g, t, v, d) { g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); }
  kick(t) {
    const c = sfx.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    this.env(g, t, 0.9, 0.2);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.22);
  }
  snare(t, v) {
    const c = sfx.ctx, n = sfx.noiseSrc(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
    this.env(g, t, 0.5 * v, 0.14);
    n.connect(f).connect(g).connect(this.out); n.start(t); n.stop(t + 0.16);
    const o = c.createOscillator(), og = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    this.env(og, t, 0.3 * v, 0.09);
    o.connect(og).connect(this.out); o.start(t); o.stop(t + 0.1);
  }
  hat(t, v) {
    const c = sfx.ctx, n = sfx.noiseSrc(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'highpass'; f.frequency.value = 7000;
    this.env(g, t, 0.18 * v, 0.04);
    n.connect(f).connect(g).connect(this.out); n.start(t); n.stop(t + 0.05);
  }
  bass(t, fr, d) {
    const c = sfx.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = fr;
    f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(250, t + d); f.Q.value = 5;
    this.env(g, t, 0.28, d);
    o.connect(f).connect(g).connect(this.out); o.start(t); o.stop(t + d + 0.02);
  }
  lead(t, fr, d, v) {
    const c = sfx.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'square'; o.frequency.value = fr;
    f.type = 'lowpass'; f.frequency.value = 2600;
    this.env(g, t, v, d);
    o.connect(f).connect(g).connect(this.out); o.start(t); o.stop(t + d + 0.02);
  }
  stab(t, fr, minor) {
    for (const st of minor ? [0, 3, 7] : [0, 4, 7]) {
      const c = sfx.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = 'sawtooth'; o.frequency.value = fr * Math.pow(2, st / 12);
      this.env(g, t, 0.06, 0.35);
      o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.37);
    }
  }
}
export const music = new Music();
