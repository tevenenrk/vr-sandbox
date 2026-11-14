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
