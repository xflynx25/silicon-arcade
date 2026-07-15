// Fire-and-forget UI blips (menu moves, name entry, errors) — plays sounds
// *now*, on demand. This is deliberately separate from clock.ts/music.ts,
// which own the scheduled-ahead musical timeline; see the plan doc for why.
// Also the sole owner of the page's one AudioContext — clock.ts is handed
// `audio.context` once a user gesture has unlocked it.

type SfxConfig = {
  freq: number;
  duration: number;
  type: OscillatorType;
  gain: number;
  slideTo?: number;
};

export class AudioSystem {
  private ctx: AudioContext | null = null;

  get context(): AudioContext | null {
    return this.ctx;
  }

  initOnGesture(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") {
        void this.ctx.resume();
      }
      return;
    }
    this.ctx = new AudioContext();
  }

  private play(config: SfxConfig): void {
    if (!this.ctx) {
      return;
    }
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = config.type;
    osc.frequency.setValueAtTime(config.freq, now);
    if (config.slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(config.slideTo, now + config.duration);
    }

    gain.gain.setValueAtTime(config.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + config.duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + config.duration);
  }

  menuMove(): void {
    this.play({ freq: 480, duration: 0.05, type: "square", gain: 0.03 });
  }

  menuConfirm(): void {
    this.play({ freq: 560, duration: 0.1, type: "square", gain: 0.04, slideTo: 880 });
  }

  error(): void {
    this.play({ freq: 180, duration: 0.18, type: "sawtooth", gain: 0.045, slideTo: 90 });
  }
}
