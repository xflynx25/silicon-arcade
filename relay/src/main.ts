import { AudioSystem } from "./audio";
import { InputManager } from "./input";
import { createFixedLoop } from "./loop";
import { RelayGame } from "./game";
import { Hud } from "./ui";

const host = document.getElementById("app");
if (!host) {
  throw new Error("Expected #app container to exist.");
}

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
if (!ctx) {
  throw new Error("Expected 2D rendering context to exist.");
}
host.append(canvas);

const input = new InputManager();
input.attach();
const hud = new Hud(host);
const audio = new AudioSystem();
const game = new RelayGame(canvas, ctx, hud, input, audio);

const resize = (): void => {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.floor(window.innerWidth * dpr);
  const height = Math.floor(window.innerHeight * dpr);
  canvas.width = width;
  canvas.height = height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  game.resize(window.innerWidth, window.innerHeight);
};

window.addEventListener("resize", resize);
resize();

const loop = createFixedLoop({
  update: (dt) => game.update(dt),
  render: (alpha) => game.render(alpha)
});
loop.start();
