const BLOCKED_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  " ",
  "Enter"
]);

export type PilotInput = {
  x: number;
  y: number;
  commit: boolean;
  brake: boolean;
};

export type NavigatorInput = {
  x: number;
  y: number;
  pingHeld: boolean;
};

export type GlobalInput = {
  startPressed: boolean;
  restartPressed: boolean;
};

const isDown = (set: Set<string>, code: string): boolean => set.has(code);

export class InputManager {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();

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
  }

  // Only call this outside "playing" — it eats Enter/R, and while playing the
  // Navigator needs Enter free to cycle ping types and R is not a mid-run key.
  consumeGlobal(): GlobalInput {
    const startPressed =
      this.consumePress("Enter") || this.consumePress("NumpadEnter");
    const restartPressed = this.consumePress("KeyR");
    return { startPressed, restartPressed };
  }

  // Pilot (P1): WASD move, LShift commit/interact, Space brake/hold.
  readPilot(): PilotInput {
    return {
      x: Number(isDown(this.held, "KeyD")) - Number(isDown(this.held, "KeyA")),
      y: Number(isDown(this.held, "KeyS")) - Number(isDown(this.held, "KeyW")),
      commit: isDown(this.held, "ShiftLeft"),
      brake: isDown(this.held, "Space")
    };
  }

  // Navigator (P2): arrow keys aim a cursor over the full map; no avatar control.
  readNavigator(): NavigatorInput {
    return {
      x:
        Number(isDown(this.held, "ArrowRight")) - Number(isDown(this.held, "ArrowLeft")),
      y: Number(isDown(this.held, "ArrowDown")) - Number(isDown(this.held, "ArrowUp")),
      pingHeld: isDown(this.held, "ShiftRight") || isDown(this.held, "Slash")
    };
  }

  consumePress(code: string): boolean {
    if (!this.pressed.has(code)) {
      return false;
    }
    this.pressed.delete(code);
    return true;
  }

  isHeld(code: string): boolean {
    return this.held.has(code);
  }

  endFrame(): void {
    this.pressed.clear();
  }
}
