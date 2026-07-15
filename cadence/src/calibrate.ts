// First-run (and reachable-from-title) latency calibration. Non-negotiable for
// a fair rhythm game: every setup has a different audio/display latency, and
// without correcting for it players blame themselves for a judge that was
// simply never honest. The player taps along to a bare metronome for a
// handful of beats; we average (pressTime - nearestBeatTime), discard
// outliers, and persist the offset. clock.judge() subtracts it on every hit.
import type { BeatClock } from "./clock";

const STORAGE_KEY = "cadence.latencyOffset";
const TAP_TARGET = 8;
// A tap further than this from any beat is almost certainly a mis-tap (wrong
// beat entirely, or a stray keypress) rather than signal about latency —
// reject it instead of letting it skew the average.
const OUTLIER_REJECT_SEC = 0.18;

export function loadStoredOffset(): number {
  const raw = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(raw) ? raw : 0;
}

function saveOffset(offset: number): void {
  localStorage.setItem(STORAGE_KEY, offset.toFixed(4));
}

export function hasCalibrated(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

export type CalibrationPhase = "idle" | "running" | "done";

export class Calibrator {
  phase: CalibrationPhase = "idle";
  result = 0;
  private diffs: number[] = [];
  private clock: BeatClock | null = null;

  begin(clock: BeatClock): void {
    this.phase = "running";
    this.diffs = [];
    this.clock = clock;
  }

  cancel(): void {
    this.phase = "idle";
    this.diffs = [];
    this.clock = null;
  }

  get tapsCollected(): number {
    return this.diffs.length;
  }

  get tapsTarget(): number {
    return TAP_TARGET;
  }

  // Call with audioCtx.currentTime at the moment of a raw keypress.
  registerTap(now: number): void {
    if (this.phase !== "running" || !this.clock) {
      return;
    }
    const nearestBeat = Math.round(this.clock.beatOfTime(now));
    const nearestBeatTime = this.clock.timeOfBeat(nearestBeat);
    const diff = now - nearestBeatTime;
    if (Math.abs(diff) <= OUTLIER_REJECT_SEC) {
      this.diffs.push(diff);
    }
    if (this.diffs.length >= TAP_TARGET) {
      this.finish();
    }
  }

  private finish(): void {
    const sorted = [...this.diffs].sort((a, b) => a - b);
    // Trim the extremes before averaging so one fumbled tap can't skew the
    // whole calibration.
    const trimmed = sorted.length > 4 ? sorted.slice(1, -1) : sorted;
    const avg = trimmed.reduce((sum, v) => sum + v, 0) / Math.max(1, trimmed.length);
    this.result = avg;
    this.phase = "done";
    saveOffset(avg);
  }
}
