import type { InputManager, PlayerInput } from "./input";
import { ParticleSystem } from "./particles";
import { AudioSystem } from "./audio";
import { clamp, vec, type Vec } from "./vec";

export type GamePhase = "title" | "playing" | "roundEnd" | "matchEnd";
export type Mode = "open" | "maze";

const TANK_R = 15;
const BARREL_LEN = 22;
const TURN_SPEED = 3.1; // rad/s
const ACCEL = 520;
const MAX_SPEED = 195;
const REVERSE_SCALE = 0.55;

const SHELL_SPEED = 300;
const SHELL_R = 4;
const SHELL_LIFE = 4.2;
const MAX_BOUNCE = 6;
const FIRE_CD = 0.45;
const MAX_SHELLS = 2;
const SELF_GRACE = 0.32; // your own shell can't hit you for this long after firing

const WIN_ROUNDS = 3;
const MARGIN = 44;
const ROUND_PAUSE = 1.4;

type Rect = { x: number; y: number; w: number; h: number };

type Tank = {
  id: 1 | 2;
  hue: number;
  pos: Vec;
  angle: number;
  speed: number;
  cooldown: number;
  prevFire: boolean;
  alive: boolean;
  spawn: number; // brief invulnerable flicker after (re)spawn
  wins: number;
};

type Shell = {
  owner: 1 | 2;
  pos: Vec;
  vel: Vec;
  age: number;
  bounces: number;
};

export type Game = {
  phase: GamePhase;
  resize: (w: number, h: number) => void;
  startMatch: () => void;
  restartMatch: () => void;
  update: (
    dt: number,
    p1: PlayerInput,
    p2: PlayerInput,
    input: InputManager,
    audio: AudioSystem
  ) => void;
  render: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  applyShake: (ctx: CanvasRenderingContext2D) => void;
  getHud: () => { left: string; center: string; right: string };
  getOverlay: (helpHeld: boolean) => { title: string; body: string; visible: boolean };
};

const HELP_BODY =
  "Tank duel — bank ricocheting shells around cover to catch\n" +
  "your rival. Shells bounce off every wall a few times, so a\n" +
  "blind corner is never truly safe (yours can hit you too!).\n\n" +
  "P1  ·  W / S drive  ·  A / D rotate  ·  Left Shift fire\n" +
  "P2  ·  ↑ / ↓ drive  ·  ← / → rotate  ·  Right Shift fire\n\n" +
  "First to 3 rounds wins.";

export const createGame = (width: number, height: number): Game => {
  let w = width;
  let h = height;
  let phase: GamePhase = "title";
  let mode: Mode = "open";
  let roundCount = 0;
  let roundTimer = 0;
  let roundWinner: 1 | 2 | 0 | null = null; // 0 = trade / mutual
  let matchWinner: 1 | 2 | null = null;
  let shake = 0;

  const particles = new ParticleSystem();
  const shells: Shell[] = [];
  let obstacles: Rect[] = [];

  const tanks: Tank[] = [
    {
      id: 1,
      hue: 205,
      pos: vec(0, 0),
      angle: 0,
      speed: 0,
      cooldown: 0,
      prevFire: false,
      alive: true,
      spawn: 0,
      wins: 0
    },
    {
      id: 2,
      hue: 32,
      pos: vec(0, 0),
      angle: Math.PI,
      speed: 0,
      cooldown: 0,
      prevFire: false,
      alive: true,
      spawn: 0,
      wins: 0
    }
  ];

  const arena = (): Rect => ({
    x: MARGIN,
    y: MARGIN,
    w: w - MARGIN * 2,
    h: h - MARGIN * 2
  });

  // Symmetric cover so neither corner is favored. "Open" keeps sightlines wide;
  // "Maze" adds interior walls that reward bank shots.
  const buildObstacles = (): void => {
    const a = arena();
    const cx = a.x + a.w / 2;
    const cy = a.y + a.h / 2;
    const t = 20; // wall thickness
    const list: Rect[] = [];

    // Central block, always present.
    list.push({ x: cx - 55, y: cy - t / 2, w: 110, h: t });

    if (mode === "open") {
      // Two flanking pillars.
      list.push({ x: a.x + a.w * 0.26 - t / 2, y: cy - 45, w: t, h: 90 });
      list.push({ x: a.x + a.w * 0.74 - t / 2, y: cy - 45, w: t, h: 90 });
    } else {
      // Maze: rotationally-symmetric L-walls around the middle.
      const armH = Math.min(a.h * 0.3, 150);
      const armW = Math.min(a.w * 0.22, 190);
      list.push({ x: a.x + a.w * 0.22, y: a.y + a.h * 0.24, w: armW, h: t });
      list.push({ x: a.x + a.w * 0.22, y: a.y + a.h * 0.24, w: t, h: armH });
      list.push({ x: a.x + a.w * 0.78 - armW, y: a.y + a.h * 0.76 - t, w: armW, h: t });
      list.push({ x: a.x + a.w * 0.78 - t, y: a.y + a.h * 0.76 - armH, w: t, h: armH });
    }
    obstacles = list;
  };

  const spawnTank = (tank: Tank): void => {
    const a = arena();
    if (tank.id === 1) {
      tank.pos = vec(a.x + a.w * 0.12, a.y + a.h * 0.5);
      tank.angle = 0;
    } else {
      tank.pos = vec(a.x + a.w * 0.88, a.y + a.h * 0.5);
      tank.angle = Math.PI;
    }
    tank.speed = 0;
    tank.cooldown = 0;
    tank.prevFire = false;
    tank.alive = true;
    tank.spawn = 1.0;
  };

  const resetRound = (): void => {
    shells.length = 0;
    particles.clear();
    buildObstacles();
    for (const tank of tanks) {
      spawnTank(tank);
    }
    roundWinner = null;
  };

  const startMatchInternal = (): void => {
    phase = "playing";
    roundCount = 1;
    matchWinner = null;
    tanks[0].wins = 0;
    tanks[1].wins = 0;
    resetRound();
  };

  const rectContains = (r: Rect, x: number, y: number): boolean =>
    x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

  // Push a tank (circle) out of a wall along the shallowest axis and kill the
  // velocity component driving it into the wall, so it slides along cover.
  const resolveTankRect = (tank: Tank, r: Rect): void => {
    const nx = clamp(tank.pos.x, r.x, r.x + r.w);
    const ny = clamp(tank.pos.y, r.y, r.y + r.h);
    const dx = tank.pos.x - nx;
    const dy = tank.pos.y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 >= TANK_R * TANK_R) {
      return;
    }
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      const push = TANK_R - d;
      tank.pos.x += (dx / d) * push;
      tank.pos.y += (dy / d) * push;
    } else {
      // Center is inside the rect: eject via the nearest edge.
      const penL = tank.pos.x - r.x;
      const penR = r.x + r.w - tank.pos.x;
      const penT = tank.pos.y - r.y;
      const penB = r.y + r.h - tank.pos.y;
      const m = Math.min(penL, penR, penT, penB);
      if (m === penL) tank.pos.x = r.x - TANK_R;
      else if (m === penR) tank.pos.x = r.x + r.w + TANK_R;
      else if (m === penT) tank.pos.y = r.y - TANK_R;
      else tank.pos.y = r.y + r.h + TANK_R;
    }
  };

  const confineTank = (tank: Tank): void => {
    const a = arena();
    tank.pos.x = clamp(tank.pos.x, a.x + TANK_R, a.x + a.w - TANK_R);
    tank.pos.y = clamp(tank.pos.y, a.y + TANK_R, a.y + a.h - TANK_R);
    for (const r of obstacles) {
      resolveTankRect(tank, r);
    }
    // A second pass keeps a tank wedged into a corner of two walls from tunneling.
    tank.pos.x = clamp(tank.pos.x, a.x + TANK_R, a.x + a.w - TANK_R);
    tank.pos.y = clamp(tank.pos.y, a.y + TANK_R, a.y + a.h - TANK_R);
  };

  const fire = (tank: Tank, audio: AudioSystem): void => {
    const live = shells.reduce((n, s) => n + (s.owner === tank.id ? 1 : 0), 0);
    if (tank.cooldown > 0 || live >= MAX_SHELLS) {
      return;
    }
    const dir = vec(Math.cos(tank.angle), Math.sin(tank.angle));
    shells.push({
      owner: tank.id,
      pos: vec(tank.pos.x + dir.x * (BARREL_LEN + 2), tank.pos.y + dir.y * (BARREL_LEN + 2)),
      vel: vec(dir.x * SHELL_SPEED, dir.y * SHELL_SPEED),
      age: 0,
      bounces: 0
    });
    tank.cooldown = FIRE_CD;
    audio.fire();
  };

  const updateTank = (tank: Tank, input: PlayerInput, audio: AudioSystem, dt: number): void => {
    if (!tank.alive) {
      return;
    }
    tank.spawn = Math.max(0, tank.spawn - dt);
    tank.cooldown = Math.max(0, tank.cooldown - dt);

    tank.angle += input.x * TURN_SPEED * dt;

    const drive = input.y; // W/↑ = forward (negative screen-y is up, but drive is body-relative)
    if (drive < 0) {
      tank.speed += ACCEL * dt;
    } else if (drive > 0) {
      tank.speed -= ACCEL * dt;
    } else {
      // Coast to a stop.
      tank.speed *= Math.pow(0.86, dt * 60);
    }
    tank.speed = clamp(tank.speed, -MAX_SPEED * REVERSE_SCALE, MAX_SPEED);

    tank.pos.x += Math.cos(tank.angle) * tank.speed * dt;
    tank.pos.y += Math.sin(tank.angle) * tank.speed * dt;
    confineTank(tank);

    const firePressed = input.primary && !tank.prevFire;
    tank.prevFire = input.primary;
    if (firePressed) {
      fire(tank, audio);
    }
  };

  const reflectShellRect = (shell: Shell, r: Rect): boolean => {
    if (!rectContains(r, shell.pos.x, shell.pos.y)) {
      return false;
    }
    const penL = shell.pos.x - r.x;
    const penR = r.x + r.w - shell.pos.x;
    const penT = shell.pos.y - r.y;
    const penB = r.y + r.h - shell.pos.y;
    const m = Math.min(penL, penR, penT, penB);
    if (m === penL) {
      shell.pos.x = r.x;
      shell.vel.x = -Math.abs(shell.vel.x);
    } else if (m === penR) {
      shell.pos.x = r.x + r.w;
      shell.vel.x = Math.abs(shell.vel.x);
    } else if (m === penT) {
      shell.pos.y = r.y;
      shell.vel.y = -Math.abs(shell.vel.y);
    } else {
      shell.pos.y = r.y + r.h;
      shell.vel.y = Math.abs(shell.vel.y);
    }
    return true;
  };

  const endRound = (winner: 1 | 2 | 0, audio: AudioSystem): void => {
    roundWinner = winner;
    shake = Math.max(shake, 16);
    if (winner === 1) tanks[0].wins += 1;
    else if (winner === 2) tanks[1].wins += 1;
    matchWinner = tanks[0].wins >= WIN_ROUNDS ? 1 : tanks[1].wins >= WIN_ROUNDS ? 2 : null;
    phase = matchWinner !== null ? "matchEnd" : "roundEnd";
    roundTimer = ROUND_PAUSE;
    if (matchWinner !== null) {
      audio.win();
    }
  };

  const destroyTank = (tank: Tank, audio: AudioSystem): void => {
    tank.alive = false;
    particles.emit(vec(tank.pos.x, tank.pos.y), 46, tank.hue, 230);
    audio.explode();
  };

  return {
    get phase() {
      return phase;
    },

    resize(nw: number, nh: number): void {
      w = nw;
      h = nh;
      buildObstacles();
    },

    startMatch(): void {
      startMatchInternal();
    },

    restartMatch(): void {
      startMatchInternal();
    },

    update(dt, p1, p2, input, audio): void {
      particles.update(dt);
      shake = Math.max(0, shake - dt * 26);

      if (phase === "title") {
        if (input.consumePress("Digit1")) {
          mode = "open";
          buildObstacles();
        }
        if (input.consumePress("Digit2")) {
          mode = "maze";
          buildObstacles();
        }
        return;
      }

      if (phase === "roundEnd" || phase === "matchEnd") {
        roundTimer -= dt;
        // Let shells and particles keep animating through the pause.
        for (let i = shells.length - 1; i >= 0; i -= 1) {
          shells[i].age += dt;
          if (shells[i].age > SHELL_LIFE) shells.splice(i, 1);
        }
        if (roundTimer <= 0 && phase === "roundEnd") {
          phase = "playing";
          roundCount += 1;
          resetRound();
        }
        return;
      }

      updateTank(tanks[0], p1, audio, dt);
      updateTank(tanks[1], p2, audio, dt);

      const a = arena();
      const minX = a.x + SHELL_R;
      const maxX = a.x + a.w - SHELL_R;
      const minY = a.y + SHELL_R;
      const maxY = a.y + a.h - SHELL_R;

      let hit: 1 | 2 | 0 | null = null;

      for (let i = shells.length - 1; i >= 0; i -= 1) {
        const s = shells[i];
        s.age += dt;
        s.pos.x += s.vel.x * dt;
        s.pos.y += s.vel.y * dt;

        let bounced = false;
        if (s.pos.x < minX) {
          s.pos.x = minX;
          s.vel.x = Math.abs(s.vel.x);
          bounced = true;
        } else if (s.pos.x > maxX) {
          s.pos.x = maxX;
          s.vel.x = -Math.abs(s.vel.x);
          bounced = true;
        }
        if (s.pos.y < minY) {
          s.pos.y = minY;
          s.vel.y = Math.abs(s.vel.y);
          bounced = true;
        } else if (s.pos.y > maxY) {
          s.pos.y = maxY;
          s.vel.y = -Math.abs(s.vel.y);
          bounced = true;
        }
        for (const r of obstacles) {
          if (reflectShellRect(s, r)) {
            bounced = true;
          }
        }
        if (bounced) {
          s.bounces += 1;
          particles.emit(vec(s.pos.x, s.pos.y), 3, 45, 60);
          audio.bounce();
        }

        if (s.bounces > MAX_BOUNCE || s.age > SHELL_LIFE) {
          shells.splice(i, 1);
          continue;
        }

        // Impacts. A shell can kill its own tank once past the grace window,
        // which makes wild ricochets a genuine risk.
        for (const tank of tanks) {
          if (!tank.alive || tank.spawn > 0) continue;
          if (tank.id === s.owner && s.age < SELF_GRACE) continue;
          const dx = s.pos.x - tank.pos.x;
          const dy = s.pos.y - tank.pos.y;
          if (dx * dx + dy * dy <= (TANK_R + SHELL_R) * (TANK_R + SHELL_R)) {
            destroyTank(tank, audio);
            shells.splice(i, 1);
            // The tank that fired scores; a self-kill hands the round to the rival.
            hit = tank.id === 1 ? 2 : 1;
            break;
          }
        }
        if (hit !== null) break;
      }

      // If both tanks somehow fell on the same frame, it's a trade.
      if (!tanks[0].alive && !tanks[1].alive) {
        hit = 0;
      }
      if (hit !== null) {
        endRound(hit, audio);
      }
    },

    applyShake(ctx: CanvasRenderingContext2D): void {
      if (shake <= 0) return;
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    },

    render(ctx: CanvasRenderingContext2D, rw: number, rh: number): void {
      ctx.fillStyle = "#07080c";
      ctx.fillRect(0, 0, rw, rh);

      const a = arena();

      // Arena floor.
      ctx.fillStyle = "#0d1018";
      ctx.fillRect(a.x, a.y, a.w, a.h);

      // Floor grid.
      ctx.strokeStyle = "rgba(255,255,255,0.035)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = a.x; x <= a.x + a.w; x += 44) {
        ctx.moveTo(x + 0.5, a.y);
        ctx.lineTo(x + 0.5, a.y + a.h);
      }
      for (let y = a.y; y <= a.y + a.h; y += 44) {
        ctx.moveTo(a.x, y + 0.5);
        ctx.lineTo(a.x + a.w, y + 0.5);
      }
      ctx.stroke();

      // Arena wall.
      ctx.strokeStyle = "rgba(255,200,120,0.35)";
      ctx.lineWidth = 3;
      ctx.strokeRect(a.x, a.y, a.w, a.h);

      // Cover.
      for (const r of obstacles) {
        ctx.fillStyle = "rgba(120,140,180,0.28)";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = "rgba(180,200,240,0.5)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      }

      // Shells.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const s of shells) {
        ctx.fillStyle = "rgba(255,240,180,0.9)";
        ctx.shadowColor = "rgba(255,200,80,0.9)";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(s.pos.x, s.pos.y, SHELL_R, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Tanks.
      for (const tank of tanks) {
        if (!tank.alive) continue;
        const flick = tank.spawn > 0 && Math.floor(tank.spawn * 12) % 2 === 0;
        ctx.save();
        ctx.translate(tank.pos.x, tank.pos.y);
        ctx.rotate(tank.angle);
        ctx.globalAlpha = flick ? 0.45 : 1;

        // Barrel.
        ctx.strokeStyle = `hsl(${tank.hue}, 90%, 72%)`;
        ctx.lineWidth = 5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(BARREL_LEN, 0);
        ctx.stroke();

        // Hull.
        ctx.fillStyle = `hsl(${tank.hue}, 80%, 54%)`;
        ctx.shadowColor = `hsl(${tank.hue}, 90%, 50%)`;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(0, 0, TANK_R, 0, Math.PI * 2);
        ctx.fill();

        // Tread hint.
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, TANK_R - 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Label.
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.font = "bold 11px Trebuchet MS";
        ctx.textAlign = "center";
        ctx.fillText(`P${tank.id}`, tank.pos.x, tank.pos.y - TANK_R - 8);
      }

      particles.render(ctx);
    },

    getHud(): { left: string; center: string; right: string } {
      let center = "";
      if (phase === "playing") {
        center = `Round ${roundCount}`;
      } else if (phase === "roundEnd" && roundWinner !== null) {
        center = roundWinner === 0 ? "Trade!" : `P${roundWinner} takes the round`;
      }
      return {
        left: `P1  ${tanks[0].wins}`,
        center,
        right: `${tanks[1].wins}  P2`
      };
    },

    getOverlay(helpHeld: boolean): { title: string; body: string; visible: boolean } {
      if (phase === "title") {
        const pick = (m: Mode, label: string): string =>
          mode === m ? `▸ ${label} ◂` : label;
        return {
          title: "SALVO",
          body:
            `${pick("open", "1  Open — wide sightlines, light cover")}\n` +
            `${pick("maze", "2  Maze — interior walls, more bank shots")}\n\n` +
            HELP_BODY +
            "\n\nEnter to start  ·  R to restart  ·  Hold H for help",
          visible: true
        };
      }
      if (phase === "matchEnd" && matchWinner !== null) {
        return {
          title: `PLAYER ${matchWinner} WINS`,
          body: `Match  ${tanks[0].wins} — ${tanks[1].wins}\nPress R to restart.`,
          visible: true
        };
      }
      if (helpHeld) {
        return {
          title: "HOW TO PLAY",
          body: HELP_BODY + "\n\nRelease H to resume",
          visible: true
        };
      }
      return { title: "", body: "", visible: false };
    }
  };
};
