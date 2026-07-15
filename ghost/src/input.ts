const BLOCKED_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  " ",
  "Enter"
]);

export type PlayerInput = {
  x: number;
  y: number;
  primary: boolean;
  secondary: boolean;
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

  consumeGlobal(): GlobalInput {
    const startPressed =
      this.consumePress("Enter") || this.consumePress("NumpadEnter");
    const restartPressed = this.consumePress("KeyR");
    return { startPressed, restartPressed };
  }

  // P1 secondary = held Space; P2 secondary = held Enter. main.ts only ever
  // consumes startPressed (Enter/NumpadEnter) while phase === "title", so a
  // held Enter during play is free to read as P2's secondary with no conflict.
  readPlayerOne(): PlayerInput {
    return {
      x: Number(isDown(this.held, "KeyD")) - Number(isDown(this.held, "KeyA")),
      y: Number(isDown(this.held, "KeyS")) - Number(isDown(this.held, "KeyW")),
      primary: isDown(this.held, "ShiftLeft"),
      secondary: isDown(this.held, "Space")
    };
  }

  readPlayerTwo(): PlayerInput {
    return {
      x:
        Number(isDown(this.held, "ArrowRight")) - Number(isDown(this.held, "ArrowLeft")),
      y: Number(isDown(this.held, "ArrowDown")) - Number(isDown(this.held, "ArrowUp")),
      primary: isDown(this.held, "ShiftRight") || isDown(this.held, "Slash"),
      secondary: isDown(this.held, "Enter") || isDown(this.held, "NumpadEnter")
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
