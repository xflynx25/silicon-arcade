import type { ModeId } from "./modes";

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
  rot: number;
  primary: boolean;
  secondary: boolean;
};

export type GlobalInput = {
  startPressed: boolean;
  restartPressed: boolean;
  selectMode: ModeId | null;
  winScoreDelta: number;
  countDelta: number;
  sizeDelta: number;
  driftDelta: number;
  disappearDelta: number;
  disappearJumpToggled: boolean;
  rangeDelta: number;
  freeMoveToggled: boolean;
  uncappedSpeedToggled: boolean;
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
    let selectMode: ModeId | null = null;
    if (this.consumePress("Digit1")) {
      selectMode = "duel";
    } else if (this.consumePress("Digit2")) {
      selectMode = "rally";
    } else if (this.consumePress("Digit3")) {
      selectMode = "goals";
    }
    let winScoreDelta = 0;
    if (this.consumePress("BracketLeft")) {
      winScoreDelta -= 1;
    }
    if (this.consumePress("BracketRight")) {
      winScoreDelta += 1;
    }
    // Shift+key decreases, plain key increases (matches the "G / g" hint)
    const countDelta = this.consumeAdjust("KeyN");
    const sizeDelta = this.consumeAdjust("KeyG");
    const driftDelta = this.consumeAdjust("KeyM");
    const disappearDelta = this.consumeAdjust("KeyD");
    const disappearJumpToggled = this.consumePress("KeyJ");
    let rangeDelta = 0;
    if (this.consumePress("Comma")) {
      rangeDelta -= 1;
    }
    if (this.consumePress("Period")) {
      rangeDelta += 1;
    }
    const freeMoveToggled = this.consumePress("KeyF");
    const uncappedSpeedToggled = this.consumePress("KeyU");
    return {
      startPressed,
      restartPressed,
      selectMode,
      winScoreDelta,
      countDelta,
      sizeDelta,
      driftDelta,
      disappearDelta,
      disappearJumpToggled,
      rangeDelta,
      freeMoveToggled,
      uncappedSpeedToggled
    };
  }

  readPlayerOne(): PlayerInput {
    return {
      x: Number(isDown(this.held, "KeyD")) - Number(isDown(this.held, "KeyA")),
      y: Number(isDown(this.held, "KeyS")) - Number(isDown(this.held, "KeyW")),
      rot: Number(isDown(this.held, "KeyE")) - Number(isDown(this.held, "KeyQ")),
      primary: isDown(this.held, "ShiftLeft"),
      secondary: isDown(this.held, "Space")
    };
  }

  readPlayerTwo(): PlayerInput {
    return {
      x:
        Number(isDown(this.held, "ArrowRight")) - Number(isDown(this.held, "ArrowLeft")),
      y: Number(isDown(this.held, "ArrowDown")) - Number(isDown(this.held, "ArrowUp")),
      rot: Number(isDown(this.held, "Period")) - Number(isDown(this.held, "Comma")),
      primary: isDown(this.held, "ShiftRight") || isDown(this.held, "Slash"),
      secondary: isDown(this.held, "Enter") || isDown(this.held, "NumpadEnter")
    };
  }

  // consume a press as +1, or -1 when a Shift key is held
  private consumeAdjust(code: string): number {
    if (!this.consumePress(code)) {
      return 0;
    }
    return this.held.has("ShiftLeft") || this.held.has("ShiftRight") ? -1 : 1;
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
