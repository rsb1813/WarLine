// 소리: 파일 없이 합성한다. 거리에 따라 작아지고 먹먹해지며 좌우로 갈린다
export class Sound {
  vol = 0.8;
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private budget = 0;
  private budgetT = 0;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filt: BiquadFilterNode } | null = null;
  private wind: { gain: GainNode } | null = null;
  lx = 0;
  ly = 0;

  unlock() {
    if (this.ac) { if (this.ac.state === 'suspended') void this.ac.resume(); return; }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ac = new AC();
      this.ac = ac;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 6;
      this.master = ac.createGain();
      this.master.gain.value = this.vol;
      this.master.connect(comp).connect(ac.destination);
      const n = ac.sampleRate * 1.2;
      this.noise = ac.createBuffer(1, n, ac.sampleRate);
      const d = this.noise.getChannelData(0);
      let b0 = 0;
      for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; b0 = 0.97 * b0 + 0.03 * w; d[i] = i % 2 ? w : w * 0.6 + b0 * 2; }
      // 바람
      const src = ac.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
      const g = ac.createGain(); g.gain.value = 0.05;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      this.wind = { gain: g };
    } catch { this.ac = null; }
  }

  setVolume(v: number) {
    this.vol = v;
    if (this.master) this.master.gain.value = v;
  }

  private ok(): boolean {
    if (!this.ac || !this.master || this.vol <= 0) return false;
    const now = this.ac.currentTime;
    if (now - this.budgetT > 0.06) { this.budgetT = now; this.budget = 0; }
    return ++this.budget <= 7;
  }

  private place(x: number, y: number, maxD: number): { g: number; pan: number; cut: number } | null {
    const dx = x - this.lx, dy = y - this.ly;
    const d = Math.hypot(dx, dy);
    if (d > maxD) return null;
    const g = Math.pow(1 - d / maxD, 1.6);
    return { g, pan: Math.max(-1, Math.min(1, dx / 700)), cut: 18000 * Math.pow(1 - d / maxD, 2) + 600 };
  }

  private chain(gain: number, pan: number, cut: number, dur: number, at = 0): [AudioNode, GainNode] {
    const ac = this.ac!;
    const now = ac.currentTime + at;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut;
    const p = ac.createStereoPanner(); p.pan.value = pan;
    g.connect(f).connect(p).connect(this.master!);
    return [g, g];
  }

  private noiseBurst(gain: number, dur: number, band: number, q: number, pan: number, cut: number, at = 0) {
    const ac = this.ac!;
    const src = ac.createBufferSource();
    src.buffer = this.noise;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = band; bp.Q.value = q;
    const [inp] = this.chain(gain, pan, cut, dur, at);
    src.connect(bp).connect(inp);
    src.start(ac.currentTime + at, Math.random() * 0.8, dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType, slide: number, pan = 0, cut = 20000, at = 0) {
    const ac = this.ac!;
    const o = ac.createOscillator();
    const now = ac.currentTime + at;
    o.type = type;
    o.frequency.setValueAtTime(freq, now);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), now + dur);
    const [inp] = this.chain(gain, pan, cut, dur, at);
    o.connect(inp);
    o.start(now); o.stop(now + dur + 0.05);
  }

  /** 총소리. p는 [음높이, 길이, 묵직함] */
  shot(x: number, y: number, p: [number, number, number], supp: boolean, mine: boolean) {
    if (!this.ok()) return;
    const at = this.place(x, y, supp ? 700 : 1900);
    if (!at) return;
    const v = (mine ? 0.55 : 0.4) * at.g * (supp ? 0.35 : 1);
    this.noiseBurst(v, p[1] * (supp ? 0.6 : 1), 1800 * p[0], 0.7, at.pan, supp ? 1800 : at.cut);
    this.tone(150 * p[0], 0.08 + p[2] * 0.08, v * (0.5 + p[2] * 0.6), 'triangle', 0.4, at.pan, at.cut);
    if (!supp && at.g > 0.05) this.noiseBurst(v * 0.25, 0.35 + p[2] * 0.4, 500, 0.5, at.pan, 1400, 0.03);
  }

  big(x: number, y: number, kind: 'cannon' | 'tank' | 'rocket') {
    if (!this.ok()) return;
    const at = this.place(x, y, 2600);
    if (!at) return;
    const v = 0.6 * at.g;
    this.noiseBurst(v, kind === 'tank' ? 0.6 : 0.25, kind === 'cannon' ? 900 : 500, 0.6, at.pan, at.cut);
    this.tone(kind === 'tank' ? 60 : 90, kind === 'tank' ? 0.5 : 0.18, v, 'sine', 0.5, at.pan, at.cut);
  }

  boom(x: number, y: number, big: boolean) {
    if (!this.ok()) return;
    const at = this.place(x, y, 3200);
    if (!at) return;
    const v = (big ? 0.9 : 0.65) * at.g;
    this.noiseBurst(v, big ? 1.4 : 0.9, 240, 0.5, at.pan, Math.min(at.cut, 5000));
    this.noiseBurst(v * 0.5, 0.25, 1600, 0.6, at.pan, at.cut);
    this.tone(55, big ? 0.9 : 0.6, v, 'sine', 0.45, at.pan, 400);
  }

  crumble(x: number, y: number) {
    if (!this.ok()) return;
    const at = this.place(x, y, 2200);
    if (!at) return;
    for (let k = 0; k < 4; k++) this.noiseBurst(0.45 * at.g, 0.4, 300 + k * 200, 0.6, at.pan, at.cut, k * 0.09);
  }

  glass(x: number, y: number) {
    if (!this.ok()) return;
    const at = this.place(x, y, 900);
    if (!at) return;
    for (let k = 0; k < 3; k++) this.tone(2400 + Math.random() * 2000, 0.12, 0.08 * at.g, 'triangle', 1.2, at.pan, at.cut, k * 0.03);
  }

  whiz() { if (this.ok()) this.noiseBurst(0.18, 0.12, 3200, 3, (Math.random() - 0.5) * 1.6, 9000); }
  hit(kill: boolean) { if (this.ok()) { this.tone(kill ? 900 : 1700, kill ? 0.18 : 0.05, kill ? 0.22 : 0.12, kill ? 'triangle' : 'square', kill ? 1.5 : 1); if (kill) this.tone(1350, 0.2, 0.15, 'triangle', 1.2, 0, 20000, 0.06); } }
  hurt() { if (this.ok()) this.tone(140, 0.14, 0.22, 'sawtooth', 0.6, 0, 1200); }
  cap(mine: boolean) {
    if (!this.ac) return;
    const notes = mine ? [523, 659, 784] : [392, 330, 262];
    notes.forEach((n, k) => this.tone(n, 0.3, 0.14, 'triangle', 1, 0, 6000, k * 0.12));
  }
  ui() { if (this.ok()) this.tone(880, 0.05, 0.06, 'square', 1); }
  heal() { if (this.ok()) this.tone(620, 0.25, 0.12, 'sine', 1.5); }
  alarm() { if (this.ok()) { this.tone(440, 0.12, 0.12, 'square', 1); this.tone(440, 0.12, 0.12, 'square', 1, 0, 20000, 0.2); } }

  /** 내가 탄 차량 소리. kind가 null이면 끈다 */
  setEngine(kind: 'tank' | 'ifv' | 'jeep' | 'heli' | null, speed: number) {
    const ac = this.ac;
    if (!ac || !this.master) return;
    if (!kind) {
      if (this.engine) { const e = this.engine; e.gain.gain.setTargetAtTime(0, ac.currentTime, 0.2); setTimeout(() => { e.osc.stop(); e.osc2.stop(); }, 800); this.engine = null; }
      return;
    }
    if (!this.engine) {
      const osc = ac.createOscillator(), osc2 = ac.createOscillator(), gain = ac.createGain(), filt = ac.createBiquadFilter();
      osc.type = 'sawtooth'; osc2.type = kind === 'heli' ? 'square' : 'sawtooth';
      filt.type = 'lowpass'; filt.frequency.value = 400;
      gain.gain.value = 0;
      osc.connect(filt); osc2.connect(filt); filt.connect(gain).connect(this.master);
      osc.start(); osc2.start();
      this.engine = { osc, osc2, gain, filt };
    }
    const e = this.engine;
    const base = kind === 'tank' ? 38 : kind === 'ifv' ? 48 : kind === 'jeep' ? 70 : 18;
    const sp = Math.min(1, speed / 300);
    e.osc.frequency.setTargetAtTime(base * (1 + sp * 1.4), ac.currentTime, 0.15);
    e.osc2.frequency.setTargetAtTime(base * 1.5 * (1 + sp * 1.3), ac.currentTime, 0.15);
    e.filt.frequency.setTargetAtTime(kind === 'heli' ? 300 + sp * 300 : 260 + sp * 900, ac.currentTime, 0.2);
    e.gain.gain.setTargetAtTime(kind === 'heli' ? 0.12 : 0.08 + sp * 0.06, ac.currentTime, 0.2);
  }

  setWind(v: number) { if (this.wind && this.ac) this.wind.gain.gain.setTargetAtTime(v, this.ac.currentTime, 0.5); }

  close() { this.setEngine(null, 0); this.setWind(0); }
}
