// 程序化音效（无需音频文件）
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;

  init() {
    if (this.ctx) return;
    try {
      const AC = (window.AudioContext || (window as any).webkitAudioContext);
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
    } catch {}
  }

  setEnabled(v: boolean) { this.enabled = v; if (this.master) this.master.gain.value = v ? 0.6 : 0; }

  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, slide = 0) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol = 0.2, filterFreq = 1000) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t);
  }

  collect()    { this.tone(880, 0.12, 'triangle', 0.25, 400); }
  combo(n: number) { this.tone(660 + n * 100, 0.15, 'square', 0.18); }
  click()      { this.tone(440, 0.06, 'square', 0.15); }
  caught()     { this.tone(120, 0.6, 'sawtooth', 0.4, -80); this.noise(0.5, 0.2, 600); }
  doorCreak()  { this.tone(180, 1.2, 'sawtooth', 0.18, -60); }
  heartbeat()  { this.tone(60, 0.15, 'sine', 0.4); setTimeout(() => this.tone(50, 0.15, 'sine', 0.35), 180); }
  thunder()    { this.noise(1.5, 0.4, 200); }
  putDown()    { this.tone(330, 0.18, 'sine', 0.18, -120); }
  pickUp()     { this.tone(220, 0.12, 'sine', 0.18, 200); }
  warning()    { this.tone(440, 0.08, 'square', 0.18); }
  win()        { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 'triangle', 0.25), i * 120)); }
}

export const audio = new AudioSystem();
