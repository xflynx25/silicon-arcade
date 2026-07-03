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
      this.play({ freq: 110, duration: 1.2, type: "sine", gain: 0.01, slideTo: 95 });
      window.setTimeout(pulse, 2500);
    };
    pulse();
  }

  collect(): void {
    this.play({ freq: 540, duration: 0.18, type: "triangle", gain: 0.04, slideTo: 820 });
  }

  danger(): void {
    this.play({ freq: 180, duration: 0.25, type: "sawtooth", gain: 0.045, slideTo: 80 });
  }

  score(): void {
    this.play({ freq: 360, duration: 0.35, type: "square", gain: 0.05, slideTo: 960 });
  }

  polarityFlip(): void {
    this.play({ freq: 220, duration: 0.11, type: "square", gain: 0.03, slideTo: 410 });
  }

  dash(): void {
    this.play({ freq: 140, duration: 0.09, type: "triangle", gain: 0.03, slideTo: 50 });
  }

  burst(): void {
    this.play({ freq: 320, duration: 0.28, type: "sawtooth", gain: 0.05, slideTo: 70 });
  }
}
