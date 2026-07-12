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
  private lastBounce = 0;

  initOnGesture(): void {
    if (this.initialized) {
      if (this.context?.state === "suspended") {
        void this.context.resume();
      }
      return;
    }
    this.context = new AudioContext();
    this.initialized = true;
    this.playAmbientPulse();
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

  private playAmbientPulse(): void {
    if (!this.context) {
      return;
    }
    const pulse = (): void => {
      this.play({ freq: 66, duration: 1.8, type: "sine", gain: 0.008, slideTo: 50 });
      window.setTimeout(pulse, 2900);
    };
    pulse();
  }

  fire(): void {
    this.play({ freq: 220, duration: 0.12, type: "square", gain: 0.045, slideTo: 90 });
  }

  bounce(): void {
    // Throttled so a shell grazing a corner can't machine-gun the oscillators.
    if (!this.context) {
      return;
    }
    if (this.context.currentTime - this.lastBounce < 0.04) {
      return;
    }
    this.lastBounce = this.context.currentTime;
    this.play({ freq: 520, duration: 0.05, type: "triangle", gain: 0.02, slideTo: 340 });
  }

  explode(): void {
    this.play({ freq: 180, duration: 0.5, type: "sawtooth", gain: 0.06, slideTo: 36 });
  }

  spawn(): void {
    this.play({ freq: 160, duration: 0.16, type: "triangle", gain: 0.03, slideTo: 380 });
  }

  win(): void {
    this.play({ freq: 380, duration: 0.5, type: "square", gain: 0.05, slideTo: 1020 });
  }
}
