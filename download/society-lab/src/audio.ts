/**
 * AudioManager — Web Audio 合成音效与氛围
 * 零音频文件：全部由振荡器与噪声实时合成。
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  muted = false;

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AC = (window.AudioContext || (window as any).webkitAudioContext);
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.85;
      this.master.connect(this.ctx.destination);
      this.startAmbient();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
    }
  }

  /** 温暖的环境底噪（五度双振荡器 + 低通） */
  private startAmbient() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0.028;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    for (const [freq, type] of [[110, 'sine'], [165.2, 'sine'], [220.5, 'triangle']] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const og = ctx.createGain();
      og.gain.value = 0.5;
      osc.connect(og).connect(filter);
      osc.start();
    }
    // 缓慢呼吸
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain).connect(g.gain);
    lfo.start();
    filter.connect(g).connect(this.master);
    this.ambientGain = g;

    // 雨声（噪声 + 带通，默认静音，下雨时渐入）
    const rainBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = rainBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = rainBuffer;
    rainSrc.loop = true;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 900;
    rainFilter.Q.value = 0.6;
    const rg = ctx.createGain();
    rg.gain.value = 0;
    rainSrc.connect(rainFilter).connect(rg).connect(this.master);
    rainSrc.start();
    this.rainGain = rg;
  }

  setRainIntensity(v: number) {
    if (this.rainGain && this.ctx) {
      this.rainGain.gain.setTargetAtTime(Math.min(0.06, v * 0.06), this.ctx.currentTime, 0.8);
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, sweep?: number) {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(30, sweep), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  click() { this.tone(660, 0.06, 'square', 0.05); }
  hover() { this.tone(440, 0.03, 'sine', 0.02); }

  /** 神力释放：低频扫上 */
  power() {
    this.tone(160, 0.5, 'sine', 0.12, 0, 520);
    this.tone(320, 0.35, 'triangle', 0.05, 0.05, 700);
  }

  /** 事件提示：双音上行 */
  chime(severity = 0.3) {
    const base = severity > 0.6 ? 392 : 523;
    this.tone(base, 0.22, 'sine', 0.09);
    this.tone(base * 1.25, 0.3, 'sine', 0.07, 0.12);
    if (severity > 0.6) this.tone(base * 0.75, 0.4, 'triangle', 0.06, 0.2);
  }

  /** 时代变迁：三音号角 */
  eraFanfare() {
    this.tone(262, 0.35, 'triangle', 0.1);
    this.tone(330, 0.35, 'triangle', 0.1, 0.18);
    this.tone(392, 0.55, 'triangle', 0.12, 0.36);
    this.tone(524, 0.7, 'sine', 0.1, 0.55);
  }

  /** 建造完成：木鱼感 */
  buildDone() { this.tone(880, 0.09, 'square', 0.045); this.tone(1174, 0.1, 'square', 0.04, 0.08); }

  /** 人口里程碑 */
  milestone() {
    this.tone(523, 0.25, 'sine', 0.08);
    this.tone(659, 0.25, 'sine', 0.08, 0.13);
    this.tone(784, 0.4, 'sine', 0.09, 0.26);
  }
}
