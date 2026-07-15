import { clamp, dist, vec, type Vec } from "./vec";
import type { NavigatorInput } from "./input";

export type PingKind = "waypoint" | "danger" | "wait";

export type Ping = {
  kind: PingKind;
  pos: Vec;
  age: number;
};

const PING_TYPES: PingKind[] = ["waypoint", "danger", "wait"];
const PING_TTL = 6.5;
// Bandwidth cap: only this many pings alive at once. This budget IS the game —
// it forces the Navigator to choose what's worth saying with a ping and leave
// the rest to talking out loud.
const MAX_PINGS = 2;
const CURSOR_SPEED = 640;

// Navigator signalling: a cursor moved over the full map, and a small set of
// typed pings dropped at the cursor. Everything else must be spoken aloud.
export class CommsSystem {
  cursor: Vec = vec(0, 0);
  pendingKind: PingKind = "waypoint";
  private readonly pings: Ping[] = [];
  private dropHeld = false;
  private droppedThisFrame = false;

  reset(worldWidth: number, worldHeight: number): void {
    this.cursor = vec(worldWidth * 0.5, worldHeight * 0.5);
    this.pendingKind = "waypoint";
    this.pings.length = 0;
    this.dropHeld = false;
    this.droppedThisFrame = false;
  }

  cycleKind(): void {
    const i = PING_TYPES.indexOf(this.pendingKind);
    this.pendingKind = PING_TYPES[(i + 1) % PING_TYPES.length];
  }

  update(dt: number, input: NavigatorInput, worldWidth: number, worldHeight: number): void {
    this.droppedThisFrame = false;
    this.cursor.x = clamp(this.cursor.x + input.x * CURSOR_SPEED * dt, 8, worldWidth - 8);
    this.cursor.y = clamp(this.cursor.y + input.y * CURSOR_SPEED * dt, 8, worldHeight - 8);

    // Edge-triggered so holding RShift doesn't spam pings every frame.
    if (input.pingHeld && !this.dropHeld) {
      this.drop();
    }
    this.dropHeld = input.pingHeld;

    for (let i = this.pings.length - 1; i >= 0; i -= 1) {
      const p = this.pings[i];
      p.age += dt;
      if (p.age >= PING_TTL) {
        this.pings.splice(i, 1);
      }
    }
  }

  private drop(): void {
    if (this.pings.length >= MAX_PINGS) {
      this.pings.shift(); // retire the oldest to make room
    }
    this.pings.push({ kind: this.pendingKind, pos: vec(this.cursor.x, this.cursor.y), age: 0 });
    this.droppedThisFrame = true;
  }

  // Consumed once by the caller to trigger the ping SFX exactly on the frame
  // a ping is placed, without CommsSystem needing an AudioSystem reference.
  consumeDropped(): boolean {
    const dropped = this.droppedThisFrame;
    this.droppedThisFrame = false;
    return dropped;
  }

  all(): readonly Ping[] {
    return this.pings;
  }

  // Waypoint pings resolve when the Pilot walks into them — pops the ping and
  // reports it so the caller can play the "locked" chime / award progress.
  consumeReachedWaypoints(pilotPos: Vec, radius: number): number {
    let reached = 0;
    for (let i = this.pings.length - 1; i >= 0; i -= 1) {
      const p = this.pings[i];
      if (p.kind === "waypoint" && dist(p.pos, pilotPos) <= radius) {
        this.pings.splice(i, 1);
        reached += 1;
      }
    }
    return reached;
  }
}
