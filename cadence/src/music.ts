// Scale/chord engine + layered generative synth. Every on-beat hit maps to a
// consonant scale degree — you cannot play a wrong note, only a wrong time.
// Built on the same oscillator pattern as audio.ts, but scheduled *ahead* onto
// the BeatClock's step grid instead of fired on demand.
import { BEATS_PER_BAR, STEPS_PER_BEAT, type ClockListener } from "./clock";

export type ScaleName = "cMinorPentatonic";

// Semitone offsets from the root, forgiving by construction — a pentatonic
// scale has no interval that reads as a "wrong note" against the others.
const SCALES: Record<ScaleName, number[]> = {
  cMinorPentatonic: [0, 3, 5, 7, 10]
};

const ROOT_MIDI = 48; // C3

const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

export function freqForDegree(scale: ScaleName, degreeIndex: number, octave = 0): number {
  const intervals = SCALES[scale];
  const len = intervals.length;
  const wrapped = ((degreeIndex % len) + len) % len;
  const extraOctave = Math.floor(degreeIndex / len);
  const midi = ROOT_MIDI + (octave + extraOctave) * 12 + intervals[wrapped];
  return midiToFreq(midi);
}

export type LayerName = "bass" | "arp" | "pad";
const LAYER_ORDER: LayerName[] = ["bass", "arp", "pad"];

export class MusicEngine {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly scale: ScaleName;
  private readonly activeLayers = new Set<LayerName>();
  private padArpStep = 0;
  unsubscribe: (() => void) | null = null;

  constructor(ctx: AudioContext, scale: ScaleName = "cMinorPentatonic") {
    this.ctx = ctx;
    this.scale = scale;
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);
  }

  // Sustained accuracy unlocks layers in order (bass, then arp, then pad); a
  // miss drops the top layer so the track visibly/audibly thins.
  setLayerLevel(level: number): void {
    const clamped = Math.max(0, Math.min(LAYER_ORDER.length, Math.round(level)));
    this.activeLayers.clear();
    for (let i = 0; i < clamped; i += 1) {
      this.activeLayers.add(LAYER_ORDER[i]);
    }
  }

  hasLayer(name: LayerName): boolean {
    return this.activeLayers.has(name);
  }

  private tone(freq: number, time: number, dur: number, type: OscillatorType, gain: number, slideTo?: number): void {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(slideTo, time + dur);
    }
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + Math.min(0.01, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  // Kick + hat pulse from the clock's downbeats — the always-on floor the
  // rest of the track builds on top of.
  private playKick(time: number): void {
    this.tone(120, time, 0.16, "sine", 0.5, 42);
  }

  private playHat(time: number): void {
    this.tone(6000, time, 0.03, "square", 0.045);
  }

  private playBass(time: number, degree: number): void {
    this.tone(freqForDegree(this.scale, degree, -1), time, 0.32, "triangle", 0.16);
  }

  private playArp(time: number, degree: number): void {
    this.tone(freqForDegree(this.scale, degree, 0), time, 0.14, "square", 0.06);
  }

  private playPad(time: number, degree: number): void {
    this.tone(freqForDegree(this.scale, degree, 1), time, 0.9, "sine", 0.05);
  }

  // Register with clock.subscribe(music.onStep) — schedules the generative
  // backing track ahead of the audio thread alongside player-triggered notes.
  onStep: ClockListener = (stepIndex, time) => {
    const stepsPerBar = STEPS_PER_BEAT * BEATS_PER_BAR;
    if (stepIndex % stepsPerBar === 0) {
      this.playKick(time);
    }
    if (stepIndex % STEPS_PER_BEAT === 0) {
      this.playHat(time);
      if (this.activeLayers.has("bass")) {
        const barBeat = Math.floor(stepIndex / STEPS_PER_BEAT) % BEATS_PER_BAR;
        this.playBass(time, [0, 2, 1, 3][barBeat]);
      }
    }
    if (this.activeLayers.has("arp") && stepIndex % (STEPS_PER_BEAT / 2) === 0) {
      this.padArpStep += 1;
      this.playArp(time, this.padArpStep);
    }
    if (this.activeLayers.has("pad") && stepIndex % stepsPerBar === 0) {
      const bar = Math.floor(stepIndex / stepsPerBar);
      this.playPad(time, (bar % 3) * 2);
    }
  };

  // A hit note is always a consonant scale degree — timing is the only thing
  // being judged, never pitch.
  playHitNote(degreeIndex: number, time: number, accent: boolean): void {
    this.tone(freqForDegree(this.scale, degreeIndex, accent ? 1 : 0), time, accent ? 0.22 : 0.12, "sawtooth", accent ? 0.12 : 0.08);
  }

  playMissTick(time: number): void {
    this.tone(140, time, 0.08, "square", 0.05, 90);
  }

  // A bare metronome click — used by the calibration tap-test, deliberately
  // undressed by any scale/layer so the player is judging pure timing.
  playClick(time: number, strong: boolean): void {
    this.tone(strong ? 1200 : 800, time, 0.05, "square", strong ? 0.12 : 0.08);
  }
}
