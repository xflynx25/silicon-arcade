// Rhythm-appropriate input: movement keys become lane keys. Fewer inputs than
// the action games, by design — a rhythm judge only cares about press *edges*
// (when did the key go down?), never held state, so lanes are always read as
// one-shot presses consumed the same frame.

const BLOCKED_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  " ",
  "Enter"
]);

// Lane order mirrors the spatial layout of the keys themselves so the two
// player's lanes read as mirror images of each other.
export const P1_LANE_CODES = ["KeyA", "KeyS", "KeyD", "KeyW"];
export const P2_LANE_CODES = ["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp"];
export const LANE_COUNT = 4;

export type PlayerInput = {
  lanePressed: boolean[]; // edge-triggered — true only on the frame the key went down
  accentHeld: boolean;
};

export type GlobalInput = {
  startPressed: boolean;
  restartPressed: boolean;
  calibratePressed: boolean;
};

const isDown = (set: Set<string>, code: string): boolean => set.has(code);

export class InputManager {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly released = new Set<string>();

  private readonly downHandler = (event: KeyboardEvent): void => {
    if (BLOCKED_KEYS.has(event.key)) {
      event.preventDefault();
    }
    if (!this.held.has(event.code)) {
      this.pressed.add(event.code);
    }
    this.held.add(event.code);
  };

  private readonly upHandler = (event: KeyboardEvent): void => {
    if (this.held.has(event.code)) {
      this.released.add(event.code);
    }
    this.held.delete(event.code);
  };

  attach(): void {
    window.addEventListener("keydown", this.downHandler, { passive: false });
    window.addEventListener("keyup", this.upHandler);
  }

  detach(): void {
    window.removeEventListener("keydown", this.downHandler);
    window.removeEventListener("keyup", this.upHandler);
    this.held.clear();
    this.pressed.clear();
    this.released.clear();
  }

  consumeGlobal(): GlobalInput {
    const startPressed = this.consumePress("Enter") || this.consumePress("NumpadEnter");
    const restartPressed = this.consumePress("KeyR");
    const calibratePressed = this.consumePress("KeyC");
    return { startPressed, restartPressed, calibratePressed };
  }

  readPlayerOne(): PlayerInput {
    return {
      lanePressed: P1_LANE_CODES.map((code) => this.consumePress(code)),
      accentHeld: isDown(this.held, "ShiftLeft")
    };
  }

  readPlayerTwo(): PlayerInput {
    return {
      lanePressed: P2_LANE_CODES.map((code) => this.consumePress(code)),
      accentHeld: isDown(this.held, "ShiftRight")
    };
  }

  consumePress(code: string): boolean {
    if (!this.pressed.has(code)) {
      return false;
    }
    this.pressed.delete(code);
    return true;
  }

  consumeRelease(code: string): boolean {
    if (!this.released.has(code)) {
      return false;
    }
    this.released.delete(code);
    return true;
  }

  isHeld(code: string): boolean {
    return this.held.has(code);
  }

  // A bare, unconsumed tap — used by the calibration tap-test, which judges
  // off any key rather than a specific lane.
  anyTapPressed(): boolean {
    if (this.pressed.size === 0) {
      return false;
    }
    this.pressed.clear();
    return true;
  }

  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
  }
}
