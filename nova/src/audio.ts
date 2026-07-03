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
  private lastRam = 0;

  initOnGesture(): void {
    if (this.initialized) {
      if (this.context?.state === "suspended") {
        void this.context.resume();
      }
      return;
    }
    this.context = new AudioContext();
    this.initialized = true;
    this.playAmbientHum();
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

  // Low deep-space drone with a slow beat — the star's gravity well.
  private playAmbientHum(): void {
    if (!this.context) {
      return;
    }
    const pulse = (): void => {
      this.play({ freq: 48, duration: 2.4, type: "sine", gain: 0.01, slideTo: 40 });
      window.setTimeout(pulse, 3600);
    };
    pulse();
  }

  // Flare burst — a rising whoosh as the comet lunges.
  flare(): void {
    this.play({ freq: 90, duration: 0.22, type: "sawtooth", gain: 0.04, slideTo: 240 });
  }

  shield(): void {
    this.play({ freq: 620, duration: 0.14, type: "square", gain: 0.035, slideTo: 900 });
  }

  // Glancing contact — bounce without a kill.
  ram(): void {
    if (!this.context) {
      return;
    }
    if (this.context.currentTime - this.lastRam < 0.06) {
      return;
    }
    this.lastRam = this.context.currentTime;
    this.play({ freq: 180, duration: 0.1, type: "triangle", gain: 0.04, slideTo: 300 });
  }

  // A comet shatters — the kill impact.
  shatter(): void {
    this.play({ freq: 340, duration: 0.55, type: "square", gain: 0.05, slideTo: 44 });
  }

  // Burned up in the corona.
  burn(): void {
    this.play({ freq: 520, duration: 0.6, type: "sawtooth", gain: 0.045, slideTo: 70 });
  }
}
