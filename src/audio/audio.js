// ─────────────────────────────────────────────────────────────────────────────
//  Procedural audio: a band-organ waltz for building, a frantic galop for
//  battles, and fully synthesised sound effects. No audio files needed.
// ─────────────────────────────────────────────────────────────────────────────

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioSys {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.mode = 'menu';
    this.rate = new Map();
    this.nextBeat = 0;
    this.beat = 0;
    this.bar = 0;
  }
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.music = ctx.createGain();
    this.sfx = ctx.createGain();
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    // small room reverb
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(1.6, 2.5);
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.22;
    this.verb.connect(this.verbGain).connect(this.master);
    this.noiseBuf = this.makeNoise();
    this.applyVolumes();
    this.nextBeat = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 40);
  }
  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    this.music.gain.value = (s.music ?? 0.5) * 0.55;
    this.sfx.gain.value = (s.sfx ?? 0.7) * 0.9;
  }
  impulse(sec, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }
  makeNoise() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  setMode(m) {
    if (m === this.mode) return;
    this.mode = m;
    this.beat = 0;
    this.bar = 0;
  }

  // ── music sequencer ──
  schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if ((this.settings.music ?? 0.5) <= 0.001) {
      this.nextBeat = ctx.currentTime + 0.1;
      return;
    }
    while (this.nextBeat < ctx.currentTime + 0.15) {
      this.playBeat(this.nextBeat);
      const bpm = this.mode === 'battle' ? 168 : this.mode === 'over' ? 100 : 152;
      this.nextBeat += 60 / bpm / (this.mode === 'battle' ? 2 : 1);
    }
  }
  playBeat(t) {
    if (this.mode === 'battle') this.galopBeat(t);
    else if (this.mode !== 'silent') this.waltzBeat(t);
  }
  // 3/4 waltz: I I V7 V7 I I IV IV | I I V7 V7 IV V7 I I  (in C, with a B section in F)
  waltzBeat(t) {
    const beat = this.beat % 3;
    const barIdx = this.bar % 32;
    const section = barIdx < 16 ? 'A' : 'B';
    const progA = ['C', 'C', 'G7', 'G7', 'G7', 'G7', 'C', 'C', 'F', 'F', 'C', 'Am', 'D7', 'G7', 'C', 'C'];
    const progB = ['F', 'F', 'C', 'C', 'G7', 'G7', 'C', 'C', 'F', 'Fm', 'C', 'A7', 'Dm', 'G7', 'C', 'C'];
    const chord = (section === 'A' ? progA : progB)[barIdx % 16];
    const CH = { C: [48, 52, 55], G7: [43, 47, 50, 53], F: [41, 45, 48], Am: [45, 48, 52], D7: [50, 54, 57, 48], Fm: [41, 44, 48], A7: [45, 49, 52, 55], Dm: [50, 53, 57] };
    const notes = CH[chord];
    if (beat === 0) this.tone(t, NOTE(notes[0] - 12), 0.32, 'triangle', 0.24, 0.01, 0.25);
    else {
      for (const n of notes.slice(1, 3)) this.tone(t, NOTE(n + 12), 0.18, 'square', 0.035, 0.005, 0.12, 1800);
    }
    // melody: deterministic motif per bar derived from chord tones
    const mel = this.melody(section, barIdx % 16, notes);
    const m = mel[beat];
    if (m) this.calliope(t, NOTE(m[0]), m[1] * (60 / 152), 0.085);
    if (beat === 2) {
      this.bar++;
    }
    this.beat++;
  }
  melody(section, bar, notes) {
    // Simple, singable motifs: [note, lengthInBeats] per beat (null = sustain)
    const top = notes.map((n) => n + 24);
    const hi = top[0] + (section === 'B' ? 5 : 0);
    const patterns = [
      [[top[0] + 12, 1], [top[1] + 12, 1], [top[2] + 12, 1]],
      [[top[2] + 12, 2], null, [top[1] + 12, 1]],
      [[top[1] + 12, 1], [top[0] + 12, 1], [top[1] + 12, 1]],
      [[top[2] + 12, 3], null, null],
      [[top[0] + 14, 1], [top[0] + 12, 1], [top[2] + 12, 1]],
      [[hi + 12, 2], null, [top[2] + 12, 1]],
    ];
    const idx = [0, 1, 2, 3, 0, 1, 4, 3, 5, 1, 2, 3, 0, 4, 2, 3][bar];
    return patterns[idx];
  }
  // 2/4 galop: oom-pah bass, driving snare, fast minor-key runs
  galopBeat(t) {
    const step = this.beat % 8; // eighth notes in a 4-beat phrase
    const barIdx = Math.floor(this.beat / 8) % 8;
    const prog = ['Am', 'Am', 'E7', 'E7', 'Am', 'Dm', 'E7', 'Am'];
    const CH = { Am: [45, 48, 52], E7: [40, 44, 47, 50], Dm: [50, 53, 45] };
    const notes = CH[prog[barIdx]];
    if (step % 4 === 0) {
      this.tone(t, NOTE(notes[0] - 12), 0.18, 'triangle', 0.26, 0.005, 0.15);
      this.kick(t, 0.5);
    }
    if (step % 4 === 2) {
      for (const n of notes) this.tone(t, NOTE(n + 12), 0.1, 'square', 0.03, 0.003, 0.08, 2000);
      this.snare(t, 0.22);
    }
    if (step % 2 === 1) this.hat(t, 0.05);
    // running melody
    const run = [0, 1, 2, 1, 2, 3, 2, 1];
    const scale = [notes[0], notes[1], notes[2], notes[0] + 12];
    const n = scale[run[step] % scale.length] + 24;
    this.calliope(t, NOTE(n), 0.14, 0.06);
    this.beat++;
  }
  calliope(t, f, dur, vol) {
    const ctx = this.ctx;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = 'square';
    o2.type = 'sine';
    o1.frequency.value = f;
    o2.frequency.value = f * 2;
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 5.8;
    lg.gain.value = f * 0.006;
    lfo.connect(lg);
    lg.connect(o1.frequency);
    lg.connect(o2.frequency);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'lowpass';
    f1.frequency.value = 2600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.setValueAtTime(vol, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    o1.connect(f1);
    o2.connect(g2).connect(f1);
    f1.connect(g);
    g.connect(this.music);
    g.connect(this.verb);
    o1.start(t);
    o2.start(t);
    lfo.start(t);
    const end = t + dur + 0.1;
    o1.stop(end);
    o2.stop(end);
    lfo.stop(end);
  }
  tone(t, f, dur, type, vol, att = 0.005, rel = 0.1, lp = 0, dest = null, f2 = 0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + rel);
    let node = o;
    if (lp) {
      const fl = ctx.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.value = lp;
      o.connect(fl);
      node = fl;
    }
    node.connect(g);
    g.connect(dest || this.music);
    o.start(t);
    o.stop(t + dur + rel + 0.05);
    return g;
  }
  noise(t, dur, vol, type = 'lowpass', freq = 1000, q = 1, dest = null, freq2 = 0) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freq2) f.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest || this.sfx);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
    return g;
  }
  kick(t, vol) {
    this.tone(t, 130, 0.12, 'sine', vol, 0.002, 0.05, 0, this.music, 45);
  }
  snare(t, vol) {
    this.noise(t, 0.12, vol, 'highpass', 1500, 0.7, this.music);
    this.tone(t, 220, 0.05, 'triangle', vol * 0.5, 0.001, 0.03, 0, this.music);
  }
  hat(t, vol) {
    this.noise(t, 0.04, vol, 'highpass', 7000, 0.5, this.music);
  }

  // ── SFX ──
  allow(key, gap) {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    const last = this.rate.get(key) || 0;
    if (now - last < gap) return false;
    this.rate.set(key, now);
    return true;
  }
  vol(view, x, z) {
    if (!view || x === undefined) return 1;
    const t = view.rig.target;
    const d = Math.hypot(t.x - x, t.z - z);
    const zoom = Math.max(0.25, Math.min(1, 60 / view.rig.dist));
    const v = Math.max(0, 1 - d / 95);
    return v * v * zoom;
  }
  ui(kind) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const S = this.sfx;
    switch (kind) {
      case 'click': this.tone(t, 900, 0.03, 'triangle', 0.12, 0.001, 0.03, 0, S); break;
      case 'tick': this.tone(t, 1300, 0.02, 'sine', 0.08, 0.001, 0.02, 0, S); break;
      case 'deploy': this.tone(t, 520, 0.05, 'triangle', 0.14, 0.002, 0.06, 0, S, 780); break;
      case 'build':
        this.noise(t, 0.12, 0.25, 'lowpass', 900, 1, S);
        [72, 76, 79, 84].forEach((n, i) => this.tone(t + i * 0.05, NOTE(n), 0.08, 'triangle', 0.1, 0.002, 0.1, 0, S));
        break;
      case 'demolish': this.noise(t, 0.35, 0.35, 'lowpass', 1200, 1, S, 150); break;
      case 'error': this.tone(t, 160, 0.14, 'square', 0.08, 0.002, 0.05, 900, S); break;
      case 'ready': [60, 64, 67, 72].forEach((n, i) => this.tone(t + i * 0.07, NOTE(n), 0.12, 'square', 0.07, 0.002, 0.1, 2500, S)); break;
    }
  }
  horn() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const brass = (n, t0, dur) => {
      const ctx = this.ctx;
      for (const det of [-6, 0, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = NOTE(n);
        o.detune.value = det;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(300, t0);
        f.frequency.linearRampToValueAtTime(2200, t0 + 0.25);
        f.frequency.linearRampToValueAtTime(900, t0 + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.09, t0 + 0.12);
        g.gain.setValueAtTime(0.09, t0 + dur - 0.2);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.3);
        o.connect(f).connect(g);
        g.connect(this.sfx);
        g.connect(this.verb);
        o.start(t0);
        o.stop(t0 + dur + 0.4);
      }
    };
    brass(50, t, 0.55);
    brass(57, t + 0.5, 1.3);
    brass(45, t + 0.5, 1.3);
  }
  fanfare(win) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (win) {
      [[60, 0, 0.15], [64, 0.15, 0.15], [67, 0.3, 0.15], [72, 0.45, 0.6], [67, 1.1, 0.15], [72, 1.25, 0.9]].forEach(([n, d, len]) => {
        this.tone(t + d, NOTE(n), len, 'sawtooth', 0.07, 0.01, 0.2, 2400, this.sfx);
        this.tone(t + d, NOTE(n - 12), len, 'square', 0.04, 0.01, 0.2, 1200, this.sfx);
      });
      this.noise(t + 0.4, 2.2, 0.12, 'bandpass', 1500, 0.4, this.sfx);
    } else {
      [[55, 0, 0.35], [54, 0.4, 0.35], [53, 0.8, 0.35], [52, 1.2, 1.2]].forEach(([n, d, len]) => {
        const g = this.tone(t + d, NOTE(n), len, 'sawtooth', 0.08, 0.02, 0.3, 900, this.sfx);
      });
    }
  }
  voice(t, f0, f1, dur, vol, vowel = 'a') {
    // comedic formant "aaah"
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 7;
    lg.gain.value = f0 * 0.04;
    lfo.connect(lg).connect(o.frequency);
    const F = vowel === 'a' ? [800, 1200] : vowel === 'o' ? [500, 900] : [350, 2300];
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const fq of F) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fq;
      bp.Q.value = 6;
      o.connect(bp).connect(g);
    }
    g.connect(this.sfx);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }
  onEvent(e, view) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const S = this.sfx;
    const v = this.vol(view, e.x, e.z);
    switch (e.type) {
      case 'hit':
        if (v < 0.03 || !this.allow('hit', 0.035)) return;
        this.noise(t, 0.08, 0.35 * v, 'lowpass', e.big ? 700 : 1400, 1, S);
        this.tone(t, e.big ? 110 : 160, 0.08, 'sine', 0.4 * v, 0.002, 0.04, 0, S, 50);
        break;
      case 'melee':
        if (v < 0.03 || !this.allow('melee', 0.06)) return;
        if (e.weapon === 'mop') this.noise(t, 0.1, 0.25 * v, 'bandpass', 2500, 2, S);
        else if (e.weapon === 'mallet') {
          this.tone(t, 90, 0.2, 'sine', 0.5 * v, 0.002, 0.1, 0, S, 40);
          this.tone(t, 1400, 0.25, 'triangle', 0.08 * v, 0.001, 0.2, 0, S, 1300);
        } else this.noise(t, 0.06, 0.3 * v, 'lowpass', 900, 1, S);
        break;
      case 'death': {
        if (v < 0.04 || !this.allow('death', 0.12)) return;
        const k = e.kind === 'giant' ? 0.45 : e.kind === 'clown' ? 1.6 : e.kind === 'mascot' ? 0.7 : 1 + Math.random() * 0.4;
        this.voice(t, 320 * k, 150 * k, 0.55, 0.22 * v, Math.random() < 0.5 ? 'a' : 'o');
        break;
      }
      case 'explosion':
        if (v < 0.03 || !this.allow('boom', 0.05)) return;
        this.noise(t, 0.6, 0.55 * v, 'lowpass', 2400, 0.8, S, 120);
        this.tone(t, 90, 0.35, 'sine', 0.7 * v, 0.002, 0.1, 0, S, 35);
        if (e.kind === 'popcorn' || e.kind === 'turretpop') for (let i = 0; i < 6; i++) this.noise(t + 0.05 + Math.random() * 0.4, 0.02, 0.2 * v, 'highpass', 3000, 1, S);
        break;
      case 'cannon':
        if (v < 0.03 || !this.allow('cannon', 0.1)) return;
        this.tone(t, 70, 0.4, 'sine', 0.8 * v, 0.002, 0.2, 0, S, 30);
        this.noise(t, 0.5, 0.5 * v, 'lowpass', 1500, 0.8, S, 100);
        if (Math.random() < 0.7) this.voice(t + 0.1, 500, 700, 0.9, 0.12 * v, 'e');
        break;
      case 'shot':
        if (v < 0.03 || !this.allow('shot' + e.kind, 0.07)) return;
        if (e.kind === 'jets') this.noise(t, 0.3, 0.2 * v, 'highpass', 2000, 0.5, S);
        else if (e.kind === 'firework') this.noise(t, 0.35, 0.18 * v, 'bandpass', 3000, 1, S, 8000);
        else this.tone(t, 180, 0.12, 'square', 0.18 * v, 0.002, 0.06, 900, S, 90);
        break;
      case 'throw':
        if (v < 0.05 || !this.allow('throw', 0.05)) return;
        this.noise(t, 0.12, 0.12 * v, 'bandpass', 900, 2, S, 2500);
        break;
      case 'impact':
        if (v < 0.05 || !this.allow('impact' + e.kind, 0.05)) return;
        if (e.kind === 'pie') this.noise(t, 0.2, 0.3 * v, 'lowpass', 1800, 2, S, 300);
        else if (e.kind === 'jet') this.noise(t, 0.2, 0.2 * v, 'highpass', 1500, 0.5, S);
        else this.tone(t, 900, 0.03, 'triangle', 0.1 * v, 0.001, 0.02, 0, S);
        break;
      case 'bump':
        if (v < 0.05 || !this.allow('bump', 0.08)) return;
        this.tone(t, 320, 0.25, 'sine', 0.35 * v, 0.002, 0.1, 0, S, 120);
        this.tone(t + 0.05, 600, 0.15, 'triangle', 0.1 * v, 0.002, 0.1, 0, S, 900);
        break;
      case 'coasterHit':
        if (v < 0.05 || !this.allow('chit', 0.1)) return;
        this.tone(t, 200, 0.2, 'square', 0.25 * v, 0.002, 0.1, 1200, S, 80);
        this.voice(t, 600, 300, 0.4, 0.18 * v, 'a');
        break;
      case 'shockwave':
        if (v < 0.03) return;
        this.tone(t, 60, 0.7, 'sine', 0.9 * v, 0.005, 0.3, 0, S, 30);
        this.noise(t, 0.8, 0.4 * v, 'lowpass', 600, 0.7, S, 80);
        break;
      case 'destroyed':
        if (v < 0.02) return;
        this.noise(t, 1.4, 0.7 * Math.max(0.3, v), 'lowpass', 1800, 0.6, S, 80);
        this.tone(t, 55, 1.0, 'sine', 0.8 * Math.max(0.3, v), 0.005, 0.4, 0, S, 25);
        break;
      case 'bhit':
        if (v < 0.05 || !this.allow('bhit', 0.09)) return;
        this.noise(t, 0.15, 0.25 * v, 'lowpass', 700, 1, S);
        break;
      case 'money':
        if (e.team !== 0 || v < 0.05 || !this.allow('money', 0.25)) return;
        this.tone(t, 2093, 0.08, 'sine', 0.06 * v, 0.001, 0.15, 0, S);
        this.tone(t + 0.06, 2637, 0.1, 'sine', 0.05 * v, 0.001, 0.2, 0, S);
        break;
      case 'thought':
        if (e.kind === 'panic' && v > 0.2 && this.allow('scream', 0.3)) this.voice(t, 700 + Math.random() * 300, 900, 0.5, 0.1 * v, 'a');
        if (e.kind === 'cannon' && v > 0.1 && this.allow('whee', 0.3)) this.voice(t, 500, 900, 0.8, 0.12 * v, 'e');
        break;
      case 'coasterDispatch':
        if (v < 0.1 || !this.allow('dispatch', 1)) return;
        for (let i = 0; i < 6; i++) this.tone(t + i * 0.18, 1200, 0.02, 'square', 0.05 * v, 0.001, 0.02, 3000, S);
        break;
      case 'fight':
        this.horn();
        break;
      case 'barrage':
        // rising whistle
        for (let i = 0; i < 3; i++) this.tone(t + i * 0.18, 700 + i * 120, 0.5, 'sine', 0.12, 0.02, 0.2, 0, S, 1800 + i * 200);
        break;
      case 'phase':
        if (e.phase === 'prep') this.setMode('prep');
        else if (e.phase === 'battle') this.setMode('battle');
        break;
      case 'roundEnd':
        if (this.allow('cheer', 1)) this.noise(t, 1.8, 0.14, 'bandpass', 1200, 0.3, S);
        break;
      case 'gameOver':
        this.setMode('over');
        break;
      case 'built':
        if (e.b && e.b.team === 1 && v > 0.1 && this.allow('ebuilt', 0.3)) this.noise(t, 0.1, 0.12 * v, 'lowpass', 900, 1, S);
        break;
    }
  }
}
