// The one new idea in GHOST: record a live player's transform every tick into
// a flat ring buffer, then freeze it into a Recording that a Ghost plays back
// verbatim. Because the shared loop.ts is a fixed-timestep accumulator, the
// live entity that was sampled and the Ghost that later replays it always
// advance by the same dt — so playback can never desync from what actually
// happened. A Ghost never re-simulates physics; it only ever reads a frame and
// writes it straight into x/y/angle/flags.

export const TICK_HZ = 120;
export const SAMPLE_EVERY = 2; // sample every 2nd tick (~60Hz) to halve buffer size
export const SAMPLE_SHIFT = 1; // log2(SAMPLE_EVERY), used to map playhead -> frame index
export const LAP_SECONDS = 12;
export const MAX_FRAMES = Math.ceil((TICK_HZ * LAP_SECONDS) / SAMPLE_EVERY);

const STRIDE = 4; // x, y, angle, flags

export const FLAG_PRIMARY = 1;
export const FLAG_SECONDARY = 2;

export const packFlags = (primary: boolean, secondary: boolean): number =>
  (primary ? FLAG_PRIMARY : 0) | (secondary ? FLAG_SECONDARY : 0);

export type Recording = {
  buf: Float32Array;
  len: number; // frames written
  hue: number;
  lap: number;
};

export class Recorder {
  private buf: Float32Array = new Float32Array(MAX_FRAMES * STRIDE);
  private len = 0;
  private tick = 0;
  private lap = 0;

  sample(x: number, y: number, angle: number, flags: number): void {
    if (this.tick % SAMPLE_EVERY === 0 && this.len < MAX_FRAMES) {
      const i = this.len * STRIDE;
      this.buf[i] = x;
      this.buf[i + 1] = y;
      this.buf[i + 2] = angle;
      this.buf[i + 3] = flags;
      this.len += 1;
    }
    this.tick += 1;
  }

  // Snapshot the current recording into an immutable Recording and start a
  // fresh one. The copy only happens once per lap (~every 12s), never per
  // tick, so it's not a hot-path allocation.
  freeze(hue: number): Recording {
    const rec: Recording = {
      buf: this.buf.slice(0, this.len * STRIDE),
      len: this.len,
      hue,
      lap: this.lap
    };
    this.lap += 1;
    this.len = 0;
    this.tick = 0;
    return rec;
  }

  reset(): void {
    this.len = 0;
    this.tick = 0;
    this.lap = 0;
  }
}

// Pure playback: on every tick, reads the next sampled frame from a frozen
// Recording and writes it directly into x/y/angle/flags. No physics, no
// randomness — a Ghost is deterministic by construction.
export class Ghost {
  x = 0;
  y = 0;
  angle = 0;
  flags = 0;
  prevFlags = 0;
  playhead = 0;

  constructor(public readonly rec: Recording) {
    if (rec.len > 0) {
      this.x = rec.buf[0];
      this.y = rec.buf[1];
      this.angle = rec.buf[2];
      this.flags = rec.buf[3];
    }
  }

  get finished(): boolean {
    return this.playhead >> SAMPLE_SHIFT >= this.rec.len - 1;
  }

  advance(): void {
    const frame = Math.min(this.playhead >> SAMPLE_SHIFT, Math.max(this.rec.len - 1, 0));
    const i = frame * 4;
    this.prevFlags = this.flags;
    if (this.rec.len > 0) {
      this.x = this.rec.buf[i];
      this.y = this.rec.buf[i + 1];
      this.angle = this.rec.buf[i + 2];
      this.flags = this.rec.buf[i + 3];
    }
    this.playhead += 1;
  }

  // Rising edge of a flag bit on this tick's advance — used to detect the
  // exact tick a ghost's original self pressed primary/secondary, so replayed
  // actions (a Duel strike, a Chase grab) fire on their original ticks.
  flagRose(bit: number): boolean {
    return (this.flags & bit) !== 0 && (this.prevFlags & bit) === 0;
  }

  // Look `ticks` ahead in the buffer without advancing — used for the Duel
  // telegraph flash (the whole recording is already known, so a "future"
  // strike can be foreseen exactly).
  peekFlagRises(bit: number, ticks: number): boolean {
    const nowFrame = Math.min(this.playhead >> SAMPLE_SHIFT, this.rec.len - 1);
    const futureFrame = Math.min((this.playhead + ticks) >> SAMPLE_SHIFT, this.rec.len - 1);
    if (futureFrame <= nowFrame) return false;
    for (let f = nowFrame; f <= futureFrame; f += 1) {
      const prevFlags = f === 0 ? 0 : this.rec.buf[(f - 1) * 4 + 3];
      const flags = this.rec.buf[f * 4 + 3];
      if ((flags & bit) !== 0 && (prevFlags & bit) === 0) {
        return true;
      }
    }
    return false;
  }

  resetPlayhead(): void {
    this.playhead = 0;
    if (this.rec.len > 0) {
      this.x = this.rec.buf[0];
      this.y = this.rec.buf[1];
      this.angle = this.rec.buf[2];
      this.flags = this.rec.buf[3];
    }
    this.prevFlags = 0;
  }
}

// Dev-only self-test: record a synthetic path tick-by-tick, freeze it, then
// drive a Ghost with the exact call pattern game.ts uses (one advance() per
// live tick, read immediately after) and assert it reproduces exactly what
// got stored in the frozen buffer for that tick's held frame (values are
// compared against the buffer itself, not the float64 inputs, since the
// buffer is a Float32Array and narrowing is expected — determinism means
// "plays back what was stored," not "survives a float32 round-trip
// losslessly"). Ghost.advance() sets its transform directly from the buffer
// with no other mutation, so this is true by construction — this test exists
// to catch a future edit that accidentally lets physics leak into playback.
if (import.meta.env.DEV) {
  const rec = new Recorder();
  const TOTAL_TICKS = 40;
  for (let tick = 0; tick < TOTAL_TICKS; tick += 1) {
    rec.sample(tick * 1.5, Math.sin(tick * 0.2) * 10, tick * 0.05, tick % 3 === 0 ? FLAG_PRIMARY : 0);
  }
  const frozen = rec.freeze(0);
  console.assert(frozen.len === Math.ceil(TOTAL_TICKS / SAMPLE_EVERY), "recorder: frozen length mismatch");
  const ghost = new Ghost(frozen);
  for (let tick = 0; tick < TOTAL_TICKS; tick += 1) {
    ghost.advance();
    const frame = Math.min((tick - (tick % SAMPLE_EVERY)) >> SAMPLE_SHIFT, frozen.len - 1);
    const i = frame * 4;
    const ex = frozen.buf[i];
    const ey = frozen.buf[i + 1];
    const ea = frozen.buf[i + 2];
    const ef = frozen.buf[i + 3];
    console.assert(
      ghost.x === ex && ghost.y === ey && ghost.angle === ea && ghost.flags === ef,
      `recorder: ghost playback desynced at tick ${tick}`
    );
  }
}
