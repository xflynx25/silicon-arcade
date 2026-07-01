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
  private lastCollision = 0;

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
      this.play({ freq: 70, duration: 1.6, type: "sine", gain: 0.009, slideTo: 55 });
      window.setTimeout(pulse, 2800);
    };
    pulse();
  }

  dash(): void {
    this.play({ freq: 130, duration: 0.14, type: "sawtooth", gain: 0.04, slideTo: 60 });
  }

  parry(): void {
    this.play({ freq: 520, duration: 0.12, type: "square", gain: 0.035, slideTo: 780 });
  }

  collision(): void {
    // Throttle: contact resolves over several frames, so cap the retrigger rate
    // to avoid stacking dozens of oscillators (which also caused audio crackle).
    if (!this.context) {
      return;
    }
    if (this.context.currentTime - this.lastCollision < 0.06) {
      return;
    }
    this.lastCollision = this.context.currentTime;
    this.play({ freq: 200, duration: 0.1, type: "triangle", gain: 0.04, slideTo: 320 });
  }

  knockout(): void {
    this.play({ freq: 280, duration: 0.5, type: "square", gain: 0.05, slideTo: 40 });
  }
}
