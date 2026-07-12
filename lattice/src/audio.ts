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
  private lastStep = 0;

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

  // Faint circuit-room hum under everything.
  private playAmbientHum(): void {
    if (!this.context) {
      return;
    }
    const pulse = (): void => {
      this.play({ freq: 54, duration: 2.2, type: "sine", gain: 0.009, slideTo: 46 });
      window.setTimeout(pulse, 3400);
    };
    pulse();
  }

  // Soft tick as a rider crosses onto a new cell while trailing.
  step(): void {
    if (!this.context) {
      return;
    }
    if (this.context.currentTime - this.lastStep < 0.03) {
      return;
    }
    this.lastStep = this.context.currentTime;
    this.play({ freq: 320, duration: 0.03, type: "square", gain: 0.012 });
  }

  // A loop is closed and territory claimed — a rising shimmer.
  claim(): void {
    this.play({ freq: 300, duration: 0.28, type: "triangle", gain: 0.045, slideTo: 720 });
  }

  // You cut across the rival's line — sharp snap.
  cut(): void {
    this.play({ freq: 900, duration: 0.16, type: "sawtooth", gain: 0.05, slideTo: 180 });
  }

  // A rider is sent home (hit a wall, self-crash, or got cut).
  crash(): void {
    this.play({ freq: 220, duration: 0.5, type: "square", gain: 0.05, slideTo: 40 });
  }

  win(): void {
    this.play({ freq: 420, duration: 0.6, type: "triangle", gain: 0.05, slideTo: 880 });
  }
}
