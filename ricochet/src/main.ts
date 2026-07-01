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
    if (global.startPressed && game.phase === "title") {
      audio.initOnGesture();
      game.startRound();
    }
    if (global.restartPressed) {
      game.restartRound();
    }

    const p1 = input.readPlayerOne();
    const p2 = input.readPlayerTwo();
    game.update(dt, p1, p2, audio);

    hud.setHud(game.getHud());
    hud.setOverlay(game.getOverlay());
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
