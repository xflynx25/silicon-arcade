// The new arcade engine primitive CADENCE exists to prove out: a sample-
// accurate beat clock driven off audioCtx.currentTime, not requestAnimationFrame.
//
// requestAnimationFrame is used only to *draw*. It never decides whether a hit
// landed or when a note plays — both are anchored to the WebAudio clock, which
// keeps its own time regardless of frame drops ("A Tale of Two Clocks").
//
// The lookahead scheduler wakes on a plain setInterval every ~25ms and, each
// wake, walks the fixed 16th-note step grid forward until it has scheduled
// every step whose audio time falls within the next ~100ms — far enough ahead
// that osc.start(when) always lands on a sample-accurate future time, never
// "now" (which would be audibly late/jittery on a busy main thread).

export const STEPS_PER_BEAT = 4; // 16th-note grid resolution — the finest unit notes/VFX schedule against
export const BEATS_PER_BAR = 4;
export const STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR;

export const MIN_BPM = 60;
export const MAX_BPM = 140;

const LOOKAHEAD_SEC = 0.1; // schedule this far into the future
const TICK_MS = 25; // how often the scheduler wakes to top up the lookahead window

export type ClockListener = (stepIndex: number, time: number) => void;

// A lone tap's honesty lives or dies by these two numbers. Perfect is tight
// enough to reward real precision; good is forgiving enough that an early
// player doesn't feel punished for holding a beat at all. Both are exercised
// directly by the calibration tap-test, which is how they got tuned.
export type Judgement = "perfect" | "good" | "miss";
export const PERFECT_WINDOW = 0.035; // seconds, ±
export const GOOD_WINDOW = 0.075; // seconds, ±
export const MISS_WINDOW = 0.15; // beyond this a press isn't considered an attempt on the note at all

export class BeatClock {
  readonly audioCtx: AudioContext;
  private _bpm: number;
  private startTime = 0; // audioCtx time corresponding to beat 0
  private running = false;
  private timerId: number | null = null;
  private nextStepIndex = 0;
  private listeners: ClockListener[] = [];

  constructor(audioCtx: AudioContext, bpm: number) {
    this.audioCtx = audioCtx;
    this._bpm = bpm;
  }

  get bpm(): number {
    return this._bpm;
  }

  // Re-anchors startTime so currentBeat is continuous across a tempo change —
  // a BPM change re-times the whole game for free, per the beat/bar model.
  setBpm(next: number): void {
    const clamped = Math.max(MIN_BPM, Math.min(MAX_BPM, next));
    if (this.running) {
      const beat = this.beatOfTime(this.audioCtx.currentTime);
      this._bpm = clamped;
      this.startTime = this.audioCtx.currentTime - beat * this.beatDuration;
    } else {
      this._bpm = clamped;
    }
  }

  get beatDuration(): number {
    return 60 / this._bpm;
  }

  get stepDuration(): number {
    return this.beatDuration / STEPS_PER_BEAT;
  }

  beatOfTime(t: number): number {
    return (t - this.startTime) / this.beatDuration;
  }

  timeOfBeat(beat: number): number {
    return this.startTime + beat * this.beatDuration;
  }

  stepOfTime(t: number): number {
    return this.beatOfTime(t) * STEPS_PER_BEAT;
  }

  timeOfStep(step: number): number {
    return this.timeOfBeat(step / STEPS_PER_BEAT);
  }

  get currentBeat(): number {
    return this.running ? this.beatOfTime(this.audioCtx.currentTime) : 0;
  }

  get currentBar(): number {
    return Math.floor(this.currentBeat / BEATS_PER_BAR);
  }

  get isRunning(): boolean {
    return this.running;
  }

  // Called once per scheduled step (every 16th note) with the exact audio time
  // it lands on — listeners use this to queue osc.start(time) calls or compute
  // note target times. Never draw from here; this can fire ~100ms ahead of when
  // the beat is actually heard.
  subscribe(fn: ClockListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    // A tiny lead so the very first step is still schedulable (a `when` of
    // exactly `currentTime` can be missed by the audio thread).
    this.startTime = this.audioCtx.currentTime + 0.05;
    this.nextStepIndex = 0;
    this.timerId = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private tick(): void {
    const horizon = this.audioCtx.currentTime + LOOKAHEAD_SEC;
    while (this.timeOfStep(this.nextStepIndex) < horizon) {
      const time = this.timeOfStep(this.nextStepIndex);
      const step = this.nextStepIndex;
      for (const fn of this.listeners) {
        fn(step, time);
      }
      this.nextStepIndex += 1;
    }
  }
}

// Diffs a keypress against a single target time (already offset-corrected by
// the caller) and returns the judgement, or null if the press is too far from
// the target to plausibly be an attempt on it at all.
export function judgeOffset(diffSeconds: number): Judgement | null {
  const abs = Math.abs(diffSeconds);
  if (abs <= PERFECT_WINDOW) {
    return "perfect";
  }
  if (abs <= GOOD_WINDOW) {
    return "good";
  }
  if (abs <= MISS_WINDOW) {
    return "miss";
  }
  return null;
}

// pressTime/targetTime are both audioCtx.currentTime-space seconds;
// calibrationOffset is `cadence.latencyOffset` (see calibrate.ts) and is
// subtracted from the press so a consistently-late setup judges fairly.
export function judge(pressTime: number, targetTime: number, calibrationOffset: number): Judgement | null {
  return judgeOffset(pressTime - calibrationOffset - targetTime);
}
