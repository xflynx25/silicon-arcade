type SfxConfig = {
  freq: number;
  duration: number;
  type: OscillatorType;
  gain: number;
  slideTo?: number;
};

export class AudioSystem {
  private context: AudioContext | null = null;
  private initialized = false;
  private beatTimer: number | null = null;
  private bpm = 100;
  private onBeat: (() => void) | null = null;

  initOnGesture(): void {
    if (this.initialized) {
      if (this.context?.state === "suspended") {
        void this.context.resume();
      }
      return;
    }
    this.context = new AudioContext();
    this.initialized = true;
  }

  setBeatCallback(cb: () => void): void {
    this.onBeat = cb;
  }

  setBpm(bpm: number): void {
    this.bpm = bpm;
    if (this.beatTimer !== null) {
      window.clearInterval(this.beatTimer);
      this.beatTimer = null;
    }
    if (!this.initialized) {
      return;
    }
    const intervalMs = (60 / bpm) * 1000;
    this.beatTimer = window.setInterval(() => {
      this.beatPulse();
      this.onBeat?.();
    }, intervalMs);
  }

  stopBeat(): void {
    if (this.beatTimer !== null) {
      window.clearInterval(this.beatTimer);
      this.beatTimer = null;
    }
  }

  private play(config: SfxConfig): void {
    if (!this.context) {
      return;
    }
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = config.type;
    osc.frequency.setValueAtTime(config.freq, now);
    if (config.slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(config.slideTo, now + config.duration);
    }

    gain.gain.setValueAtTime(config.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + config.duration);

    osc.connect(gain);
    gain.connect(this.context.destination);
    osc.start(now);
    osc.stop(now + config.duration);
  }

  private beatPulse(): void {
    this.play({ freq: 80, duration: 0.06, type: "sine", gain: 0.025 });
    window.setTimeout(() => {
      this.play({ freq: 160, duration: 0.04, type: "triangle", gain: 0.012 });
    }, 80);
  }

  resonance(quality: "perfect" | "good"): void {
    const freq = quality === "perfect" ? 660 : 440;
    this.play({ freq, duration: 0.2, type: "sine", gain: 0.045, slideTo: freq * 1.5 });
  }

  miss(): void {
    this.play({ freq: 120, duration: 0.25, type: "sawtooth", gain: 0.035, slideTo: 60 });
  }

  focus(): void {
    this.play({ freq: 300, duration: 0.3, type: "sine", gain: 0.03, slideTo: 180 });
  }

  ascend(): void {
    this.play({ freq: 220, duration: 0.5, type: "triangle", gain: 0.04, slideTo: 880 });
  }
}
