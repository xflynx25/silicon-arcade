import type { InputManager, PlayerInput } from "./input";
import { ParticleSystem } from "./particles";
import { AudioSystem } from "./audio";
import { clamp, vec, type Vec } from "./vec";

export type GamePhase = "title" | "playing" | "roundEnd" | "matchEnd";

const TANK_R = 15;
const BARREL_LEN = 22;
const TURN_SPEED = 3.1; // rad/s
const ACCEL = 520;
const MAX_SPEED = 195;
const REVERSE_SCALE = 0.55;

const SHELL_SPEED = 300;
const SHELL_R = 4;
const FIRE_CD = 0.45;
const MAX_SHELLS = 2;
const SELF_GRACE = 0.32; // your own shell can't hit you for this long after firing

const WIN_ROUNDS = 3;
const MARGIN = 44;
const ROUND_PAUSE = 1.4;
const WALL_T = 20; // wall thickness

// Powerups. Buffs are timed; a shield is a one-shot flag.
const BUFF_DUR = 8;
const SCOPE_DUR = 10;
const RAPID_FIRE_SCALE = 0.4; // fire cooldown multiplier while rapid
const BOOST_SPEED_SCALE = 1.4;
const BOOST_ACCEL_SCALE = 1.3;
const MULTI_CAP = 3; // simultaneous own shells while triple-shot is active
const MULTI_SPREAD = 0.16; // rad between the three barrels
const POWER_SPAWN_CD = 6.5; // seconds between pickup spawns
const MAX_PICKUPS = 3;
const PICKUP_R = 13;

type Rect = { x: number; y: number; w: number; h: number };

// Symmetric arena layouts. Each builds cover from the current arena rect so it
// scales with the window, and every layout is symmetric so neither side is
// favored. Kept as plain rects — cheap to collide and draw.
type MapDef = { name: string; build: (a: Rect) => Rect[] };

const MAPS: MapDef[] = [
  {
    name: "Open",
    build: (a) => {
      const cx = a.x + a.w / 2;
      const cy = a.y + a.h / 2;
      return [
        { x: cx - 55, y: cy - WALL_T / 2, w: 110, h: WALL_T },
        { x: a.x + a.w * 0.26 - WALL_T / 2, y: cy - 45, w: WALL_T, h: 90 },
        { x: a.x + a.w * 0.74 - WALL_T / 2, y: cy - 45, w: WALL_T, h: 90 }
      ];
    }
  },
  {
    name: "Pillars",
    build: (a) => {
      const list: Rect[] = [];
      for (const fx of [0.28, 0.72]) {
        for (const fy of [0.3, 0.7]) {
          list.push({ x: a.x + a.w * fx - 17, y: a.y + a.h * fy - 17, w: 34, h: 34 });
        }
      }
      return list;
    }
  },
  {
    name: "Cross",
    build: (a) => {
      const cx = a.x + a.w / 2;
      const cy = a.y + a.h / 2;
      const armW = Math.min(a.w * 0.44, 320);
      const armH = Math.min(a.h * 0.5, 240);
      return [
        { x: cx - armW / 2, y: cy - WALL_T / 2, w: armW, h: WALL_T },
        { x: cx - WALL_T / 2, y: cy - armH / 2, w: WALL_T, h: armH }
      ];
    }
  },
  {
    name: "Maze",
    build: (a) => {
      const cx = a.x + a.w / 2;
      const cy = a.y + a.h / 2;
      const armH = Math.min(a.h * 0.3, 150);
      const armW = Math.min(a.w * 0.22, 190);
      return [
        { x: cx - 55, y: cy - WALL_T / 2, w: 110, h: WALL_T },
        { x: a.x + a.w * 0.22, y: a.y + a.h * 0.24, w: armW, h: WALL_T },
        { x: a.x + a.w * 0.22, y: a.y + a.h * 0.24, w: WALL_T, h: armH },
        { x: a.x + a.w * 0.78 - armW, y: a.y + a.h * 0.76 - WALL_T, w: armW, h: WALL_T },
        { x: a.x + a.w * 0.78 - WALL_T, y: a.y + a.h * 0.76 - armH, w: WALL_T, h: armH }
      ];
    }
  },
  {
    name: "Bunker",
    build: (a) => {
      const cx = a.x + a.w / 2;
      const cy = a.y + a.h / 2;
      const span = Math.min(a.w * 0.24, 220);
      const gate = Math.min(a.h * 0.3, 170);
      return [
        // Top & bottom center walls funnel play toward the middle.
        { x: cx - span / 2, y: a.y + a.h * 0.22, w: span, h: WALL_T },
        { x: cx - span / 2, y: a.y + a.h * 0.78 - WALL_T, w: span, h: WALL_T },
        // Central gate posts.
        { x: cx - WALL_T / 2, y: cy - gate / 2, w: WALL_T, h: gate }
      ];
    }
  }
];

// Ricochet rules. "Infinite" removes the bounce cap so shells only die of age,
// with a longer fuse to keep the chaos alive.
type RuleDef = { name: string; blurb: string; bounceCap: number; shellLife: number };

const RULES: RuleDef[] = [
  { name: "Standard", blurb: "shells fade after 6 bounces", bounceCap: 6, shellLife: 4.2 },
  { name: "Ricochet+", blurb: "14 bounces, longer fuse", bounceCap: 14, shellLife: 6 },
  { name: "Infinite", blurb: "no bounce cap — pure chaos", bounceCap: Infinity, shellLife: 9 }
];

type PowerKind = "rapid" | "multi" | "boost" | "scope" | "shield";

type PowerMeta = { hue: number; glyph: string; label: string };

const POWERS: Record<PowerKind, PowerMeta> = {
  rapid: { hue: 50, glyph: "»", label: "Rapid fire" },
  multi: { hue: 25, glyph: "≡", label: "Triple shot" },
  boost: { hue: 140, glyph: "▲", label: "Speed boost" },
  scope: { hue: 190, glyph: "◎", label: "Aim scope" },
  shield: { hue: 210, glyph: "◈", label: "Shield" }
};

const POWER_KINDS = Object.keys(POWERS) as PowerKind[];

type Pickup = { kind: PowerKind; pos: Vec; age: number };

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
  // Powerup state.
  rapid: number;
  multi: number;
  boost: number;
  scope: number;
  shield: boolean;
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
  "your rival. Shells bounce off every wall, so a blind corner\n" +
  "is never truly safe (yours can hit you too!).\n\n" +
  "P1  ·  W / S drive  ·  A / D rotate  ·  Left Shift fire\n" +
  "P2  ·  ↑ / ↓ drive  ·  ← / → rotate  ·  Right Shift fire\n\n" +
  "Grab glowing pickups:\n" +
  "  »  Rapid fire   ≡  Triple shot   ▲  Speed boost\n" +
  "  ◎  Aim scope    ◈  Shield (blocks one hit)\n\n" +
  "First to 3 rounds wins.";

export const createGame = (width: number, height: number): Game => {
  let w = width;
  let h = height;
  let phase: GamePhase = "title";
  let mapIdx = 0;
  let ruleIdx = 0;
  let powerupsOn = true;
  let roundCount = 0;
  let roundTimer = 0;
  let roundWinner: 1 | 2 | 0 | null = null; // 0 = trade / mutual
  let matchWinner: 1 | 2 | null = null;
  let shake = 0;
  let powerTimer = POWER_SPAWN_CD;

  const particles = new ParticleSystem();
  const shells: Shell[] = [];
  const pickups: Pickup[] = [];
  let obstacles: Rect[] = [];

  const makeTank = (id: 1 | 2, hue: number, angle: number): Tank => ({
    id,
    hue,
    pos: vec(0, 0),
    angle,
    speed: 0,
    cooldown: 0,
    prevFire: false,
    alive: true,
    spawn: 0,
    wins: 0,
    rapid: 0,
    multi: 0,
    boost: 0,
    scope: 0,
    shield: false
  });

  const tanks: Tank[] = [makeTank(1, 205, 0), makeTank(2, 32, Math.PI)];

  const arena = (): Rect => ({
    x: MARGIN,
    y: MARGIN,
    w: w - MARGIN * 2,
    h: h - MARGIN * 2
  });

  const currentRule = (): RuleDef => RULES[ruleIdx];

  const buildObstacles = (): void => {
    obstacles = MAPS[mapIdx].build(arena());
  };

  const clearBuffs = (tank: Tank): void => {
    tank.rapid = 0;
    tank.multi = 0;
    tank.boost = 0;
    tank.scope = 0;
    tank.shield = false;
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
    clearBuffs(tank);
  };

  const resetRound = (): void => {
    shells.length = 0;
    pickups.length = 0;
    particles.clear();
    powerTimer = POWER_SPAWN_CD;
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

  const spawnShell = (tank: Tank, angle: number): void => {
    const dir = vec(Math.cos(angle), Math.sin(angle));
    shells.push({
      owner: tank.id,
      pos: vec(tank.pos.x + dir.x * (BARREL_LEN + 2), tank.pos.y + dir.y * (BARREL_LEN + 2)),
      vel: vec(dir.x * SHELL_SPEED, dir.y * SHELL_SPEED),
      age: 0,
      bounces: 0
    });
  };

  const fire = (tank: Tank, audio: AudioSystem): void => {
    const cap = tank.multi > 0 ? MULTI_CAP : MAX_SHELLS;
    const live = shells.reduce((n, s) => n + (s.owner === tank.id ? 1 : 0), 0);
    if (tank.cooldown > 0 || live >= cap) {
      return;
    }
    if (tank.multi > 0) {
      spawnShell(tank, tank.angle - MULTI_SPREAD);
      spawnShell(tank, tank.angle);
      spawnShell(tank, tank.angle + MULTI_SPREAD);
    } else {
      spawnShell(tank, tank.angle);
    }
    tank.cooldown = tank.rapid > 0 ? FIRE_CD * RAPID_FIRE_SCALE : FIRE_CD;
    audio.fire();
  };

  const updateTank = (tank: Tank, input: PlayerInput, audio: AudioSystem, dt: number): void => {
    if (!tank.alive) {
      return;
    }
    tank.spawn = Math.max(0, tank.spawn - dt);
    tank.cooldown = Math.max(0, tank.cooldown - dt);
    tank.rapid = Math.max(0, tank.rapid - dt);
    tank.multi = Math.max(0, tank.multi - dt);
    tank.boost = Math.max(0, tank.boost - dt);
    tank.scope = Math.max(0, tank.scope - dt);

    tank.angle += input.x * TURN_SPEED * dt;

    const maxSpeed = tank.boost > 0 ? MAX_SPEED * BOOST_SPEED_SCALE : MAX_SPEED;
    const accel = tank.boost > 0 ? ACCEL * BOOST_ACCEL_SCALE : ACCEL;
    const drive = input.y; // W/↑ = forward
    if (drive < 0) {
      tank.speed += accel * dt;
    } else if (drive > 0) {
      tank.speed -= accel * dt;
    } else {
      // Coast to a stop.
      tank.speed *= Math.pow(0.86, dt * 60);
    }
    tank.speed = clamp(tank.speed, -maxSpeed * REVERSE_SCALE, maxSpeed);

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

  // True if a point sits clear of every wall (with a small margin) and both
  // tanks — used to place pickups on open floor.
  const isOpenSpot = (x: number, y: number): boolean => {
    for (const r of obstacles) {
      if (
        x > r.x - PICKUP_R &&
        x < r.x + r.w + PICKUP_R &&
        y > r.y - PICKUP_R &&
        y < r.y + r.h + PICKUP_R
      ) {
        return false;
      }
    }
    for (const tank of tanks) {
      const dx = x - tank.pos.x;
      const dy = y - tank.pos.y;
      if (dx * dx + dy * dy < 70 * 70) {
        return false;
      }
    }
    return true;
  };

  const spawnPickup = (): void => {
    const a = arena();
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const x = a.x + PICKUP_R + Math.random() * (a.w - PICKUP_R * 2);
      const y = a.y + PICKUP_R + Math.random() * (a.h - PICKUP_R * 2);
      if (isOpenSpot(x, y)) {
        const kind = POWER_KINDS[(Math.random() * POWER_KINDS.length) | 0];
        pickups.push({ kind, pos: vec(x, y), age: 0 });
        return;
      }
    }
  };

  const applyPickup = (tank: Tank, kind: PowerKind): void => {
    if (kind === "rapid") tank.rapid = BUFF_DUR;
    else if (kind === "multi") tank.multi = BUFF_DUR;
    else if (kind === "boost") tank.boost = BUFF_DUR;
    else if (kind === "scope") tank.scope = SCOPE_DUR;
    else tank.shield = true;
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

  // Simulate a shell's ricochet path for the aim scope. Bounded step count and
  // bounce count keep it cheap; only runs for a tank holding the scope buff.
  const predictPath = (start: Vec, angle: number): Vec[] => {
    const a = arena();
    const minX = a.x + SHELL_R;
    const maxX = a.x + a.w - SHELL_R;
    const minY = a.y + SHELL_R;
    const maxY = a.y + a.h - SHELL_R;
    const pts: Vec[] = [vec(start.x, start.y)];
    let px = start.x;
    let py = start.y;
    let vx = Math.cos(angle);
    let vy = Math.sin(angle);
    const step = 9;
    let bounces = 0;
    for (let i = 0; i < 150 && bounces <= 4; i += 1) {
      px += vx * step;
      py += vy * step;
      let b = false;
      if (px < minX) {
        px = minX;
        vx = Math.abs(vx);
        b = true;
      } else if (px > maxX) {
        px = maxX;
        vx = -Math.abs(vx);
        b = true;
      }
      if (py < minY) {
        py = minY;
        vy = Math.abs(vy);
        b = true;
      } else if (py > maxY) {
        py = maxY;
        vy = -Math.abs(vy);
        b = true;
      }
      for (const r of obstacles) {
        if (px > r.x && px < r.x + r.w && py > r.y && py < r.y + r.h) {
          const penL = px - r.x;
          const penR = r.x + r.w - px;
          const penT = py - r.y;
          const penB = r.y + r.h - py;
          const m = Math.min(penL, penR, penT, penB);
          if (m === penL) {
            px = r.x;
            vx = -Math.abs(vx);
          } else if (m === penR) {
            px = r.x + r.w;
            vx = Math.abs(vx);
          } else if (m === penT) {
            py = r.y;
            vy = -Math.abs(vy);
          } else {
            py = r.y + r.h;
            vy = Math.abs(vy);
          }
          b = true;
        }
      }
      pts.push(vec(px, py));
      if (b) bounces += 1;
    }
    return pts;
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
          mapIdx = (mapIdx + 1) % MAPS.length;
          buildObstacles();
        }
        if (input.consumePress("Digit2")) {
          ruleIdx = (ruleIdx + 1) % RULES.length;
        }
        if (input.consumePress("Digit3")) {
          powerupsOn = !powerupsOn;
        }
        return;
      }

      const rule = currentRule();

      if (phase === "roundEnd" || phase === "matchEnd") {
        roundTimer -= dt;
        // Let shells and particles keep animating through the pause.
        for (let i = shells.length - 1; i >= 0; i -= 1) {
          shells[i].age += dt;
          if (shells[i].age > rule.shellLife) shells.splice(i, 1);
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

      // Pickups: spawn on a timer, animate, and hand out on contact.
      if (powerupsOn) {
        powerTimer -= dt;
        if (powerTimer <= 0) {
          if (pickups.length < MAX_PICKUPS) {
            spawnPickup();
          }
          powerTimer = POWER_SPAWN_CD;
        }
        for (let i = pickups.length - 1; i >= 0; i -= 1) {
          const pk = pickups[i];
          pk.age += dt;
          for (const tank of tanks) {
            if (!tank.alive) continue;
            const dx = pk.pos.x - tank.pos.x;
            const dy = pk.pos.y - tank.pos.y;
            if (dx * dx + dy * dy <= (TANK_R + PICKUP_R) * (TANK_R + PICKUP_R)) {
              applyPickup(tank, pk.kind);
              particles.emit(vec(pk.pos.x, pk.pos.y), 16, POWERS[pk.kind].hue, 150);
              audio.bounce();
              pickups.splice(i, 1);
              break;
            }
          }
        }
      }

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

        if (s.bounces > rule.bounceCap || s.age > rule.shellLife) {
          shells.splice(i, 1);
          continue;
        }

        // Impacts. A shell can kill its own tank once past the grace window,
        // which makes wild ricochets a genuine risk. A shield eats one hit.
        for (const tank of tanks) {
          if (!tank.alive || tank.spawn > 0) continue;
          if (tank.id === s.owner && s.age < SELF_GRACE) continue;
          const dx = s.pos.x - tank.pos.x;
          const dy = s.pos.y - tank.pos.y;
          if (dx * dx + dy * dy <= (TANK_R + SHELL_R) * (TANK_R + SHELL_R)) {
            shells.splice(i, 1);
            if (tank.shield) {
              tank.shield = false;
              particles.emit(vec(tank.pos.x, tank.pos.y), 20, POWERS.shield.hue, 170);
              audio.bounce();
              break;
            }
            destroyTank(tank, audio);
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

      // Aim scopes (drawn under shells/tanks so they read as guide lines).
      for (const tank of tanks) {
        if (!tank.alive || tank.scope <= 0) continue;
        const dir = vec(Math.cos(tank.angle), Math.sin(tank.angle));
        const start = vec(tank.pos.x + dir.x * (BARREL_LEN + 2), tank.pos.y + dir.y * (BARREL_LEN + 2));
        const path = predictPath(start, tank.angle);
        ctx.save();
        ctx.setLineDash([6, 7]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `hsla(${tank.hue}, 90%, 70%, 0.5)`;
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i += 1) {
          ctx.lineTo(path[i].x, path[i].y);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Pickups.
      for (const pk of pickups) {
        const meta = POWERS[pk.kind];
        const bob = Math.sin(pk.age * 3) * 2;
        const py = pk.pos.y + bob;
        const pulse = 0.6 + 0.4 * Math.sin(pk.age * 4);
        ctx.save();
        ctx.shadowColor = `hsla(${meta.hue}, 95%, 60%, ${pulse})`;
        ctx.shadowBlur = 14;
        ctx.fillStyle = `hsla(${meta.hue}, 85%, 55%, 0.9)`;
        ctx.beginPath();
        ctx.arc(pk.pos.x, py, PICKUP_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(10,12,18,0.95)";
        ctx.font = "bold 15px Trebuchet MS";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(meta.glyph, pk.pos.x, py + 1);
        ctx.restore();
      }
      ctx.textBaseline = "alphabetic";

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

        // Shield ring.
        if (tank.shield) {
          ctx.save();
          ctx.strokeStyle = `hsla(${POWERS.shield.hue}, 95%, 70%, 0.9)`;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(tank.pos.x, tank.pos.y, TANK_R + 5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Active buff pips above the hull.
        const active: PowerKind[] = [];
        if (tank.rapid > 0) active.push("rapid");
        if (tank.multi > 0) active.push("multi");
        if (tank.boost > 0) active.push("boost");
        if (tank.scope > 0) active.push("scope");
        if (active.length > 0) {
          const gap = 8;
          let bx = tank.pos.x - ((active.length - 1) * gap) / 2;
          const by = tank.pos.y - TANK_R - 20;
          for (const kind of active) {
            ctx.fillStyle = `hsl(${POWERS[kind].hue}, 90%, 60%)`;
            ctx.beginPath();
            ctx.arc(bx, by, 3, 0, Math.PI * 2);
            ctx.fill();
            bx += gap;
          }
        }

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
        const rule = currentRule();
        return {
          title: "SALVO",
          body:
            `1  Arena  ·  ▸ ${MAPS[mapIdx].name} ◂  (${mapIdx + 1}/${MAPS.length})\n` +
            `2  Ricochet  ·  ▸ ${rule.name} ◂  — ${rule.blurb}\n` +
            `3  Powerups  ·  ▸ ${powerupsOn ? "On" : "Off"} ◂\n\n` +
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
