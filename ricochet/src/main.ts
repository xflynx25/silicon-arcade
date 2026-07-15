import { AudioSystem } from "./audio";
import { createGame, type Game } from "./game";
import { InputManager } from "./input";
import { createFixedLoop } from "./loop";
import { Hud } from "./ui";

const app = document.getElementById("app");
if (!app) {
  throw new Error("Missing #app element");
}

const canvas = document.createElement("canvas");
app.prepend(canvas);

const ctx = canvas.getContext("2d");
if (!ctx) {
  throw new Error("Missing 2D canvas context");
}

const input = new InputManager();
const hud = new Hud(app);
const audio = new AudioSystem();

let width = 0;
let height = 0;
let game: Game = createGame(window.innerWidth, window.innerHeight);

const resize = (): void => {
  const dpr = window.devicePixelRatio || 1;
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  game.resize(width, height);
};

window.addEventListener("resize", resize);
resize();

input.attach();

window.addEventListener(
  "keydown",
  () => {
    audio.initOnGesture();
  },
  { once: true }
);

createFixedLoop({
  update(dt: number): void {
    const global = input.consumeGlobal();
    if (global.selectMode && game.phase === "title") {
      game.selectMode(global.selectMode);
    }
    if (global.winScoreDelta !== 0) {
      game.cycleWinScore(global.winScoreDelta);
    }
    if (global.countDelta !== 0) {
      game.adjustSetting("count", global.countDelta);
    }
    if (global.sizeDelta !== 0) {
      game.adjustSetting("size", global.sizeDelta);
    }
    if (global.driftDelta !== 0) {
      game.adjustSetting("drift", global.driftDelta);
    }
    if (global.disappearDelta !== 0) {
      game.adjustSetting("disappear", global.disappearDelta);
    }
    if (global.disappearJumpToggled) {
      game.toggleDisappearJump();
    }
    if (global.rangeDelta !== 0) {
      game.adjustSetting("range", global.rangeDelta);
    }
    if (global.freeMoveToggled) {
      game.toggleFreeMove();
    }
    if (global.uncappedSpeedToggled) {
      game.toggleUncappedSpeed();
    }
    if (global.startPressed && game.phase === "title") {
      audio.initOnGesture();
      game.startRound();
    }
    if (global.restartPressed) {
      game.restartRound();
    }

    const p1 = input.readPlayerOne();
    const p2 = input.readPlayerTwo();
    game.update(dt, p1, p2, input, audio);

    hud.setHud(game.getHud());
    hud.setOverlay(game.getOverlay(input.isHeld("KeyH")));
    input.endFrame();
  },
  render(): void {
    ctx.save();
    game.applyShake(ctx);
    ctx.clearRect(0, 0, width, height);
    game.render(ctx, width, height, 0);
    ctx.restore();
  }
}).start();
