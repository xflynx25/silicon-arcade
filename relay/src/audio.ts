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

  // The shared rising-tension pad: one persistent oscillator whose gain/pitch
  // is smoothly ramped by setTension() rather than retriggered per frame, so
  // both players hear one continuous, cheap drone instead of stacked voices.
  private tensionOsc: OscillatorNode | null = null;
  private tensionGain: GainNode | null = null;
  private tension = 0;

  initOnGesture(): void {
    if (this.initialized) {
      if (this.context?.state === "suspended") {
        void this.context.resume();
      }
      return;
    }
    this.context = new AudioContext();
    this.initialized = true;
    this.startTensionPad();
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

  private startTensionPad(): void {
    if (!this.context) {
      return;
    }
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(70, this.context.currentTime);
    gain.gain.setValueAtTime(0.0001, this.context.currentTime);
    osc.connect(gain);
    gain.connect(this.context.destination);
    osc.start();
    this.tensionOsc = osc;
    this.tensionGain = gain;
  }

  // level: 0 (no nearby hazard, silent) .. 1 (hazard right on top of the Pilot).
  setTension(level: number): void {
    if (!this.context || !this.tensionOsc || !this.tensionGain) {
      return;
    }
    const clamped = Math.max(0, Math.min(1, level));
    if (Math.abs(clamped - this.tension) < 0.002) {
      return;
    }
    this.tension = clamped;
    const now = this.context.currentTime;
    const targetGain = Math.max(0.0001, clamped * clamped * 0.05);
    const targetFreq = 70 + clamped * 90;
    this.tensionGain.gain.exponentialRampToValueAtTime(targetGain, now + 0.4);
    this.tensionOsc.frequency.linearRampToValueAtTime(targetFreq, now + 0.4);
  }

  // Navigator drops a ping.
  ping(): void {
    this.play({ freq: 480, duration: 0.12, type: "triangle", gain: 0.035, slideTo: 620 });
  }

  // Pilot reaches a waypoint ping — the "locked" chime.
  locked(): void {
    this.play({ freq: 660, duration: 0.16, type: "sine", gain: 0.05, slideTo: 990 });
    window.setTimeout(() => this.play({ freq: 990, duration: 0.2, type: "sine", gain: 0.04 }), 90);
  }

  // Pilot clips a wall/mine/closed gate.
  bump(): void {
    this.play({ freq: 160, duration: 0.2, type: "sawtooth", gain: 0.045, slideTo: 70 });
  }

  waveClear(): void {
    this.play({ freq: 420, duration: 0.3, type: "square", gain: 0.05, slideTo: 840 });
  }

  correct(): void {
    this.play({ freq: 540, duration: 0.16, type: "triangle", gain: 0.045, slideTo: 900 });
  }

  wrong(): void {
    this.play({ freq: 220, duration: 0.28, type: "sawtooth", gain: 0.05, slideTo: 90 });
  }

  gameOver(): void {
    this.play({ freq: 200, duration: 0.6, type: "sawtooth", gain: 0.05, slideTo: 40 });
  }
}
