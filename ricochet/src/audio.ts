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
      this.play({ freq: 90, duration: 1.4, type: "sine", gain: 0.008, slideTo: 70 });
      window.setTimeout(pulse, 3000);
    };
    pulse();
  }

  bounce(): void {
    this.play({ freq: 280, duration: 0.08, type: "triangle", gain: 0.035, slideTo: 420 });
  }

  smash(): void {
    this.play({ freq: 160, duration: 0.12, type: "square", gain: 0.04, slideTo: 520 });
  }

  spin(): void {
    this.play({ freq: 440, duration: 0.15, type: "sine", gain: 0.03, slideTo: 680 });
  }

  score(): void {
    this.play({ freq: 320, duration: 0.4, type: "square", gain: 0.05, slideTo: 880 });
  }
}
