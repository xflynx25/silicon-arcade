import type { PlayerInput } from "./input";
import type { InputManager } from "./input";
import { ParticleSystem } from "./particles";
import { AudioSystem } from "./audio";
import { clamp, dist, len, lerp, normalize, sub, vec, type Vec } from "./vec";
import { type ModeId, MODE_LABEL, MODE_DESCRIPTION, MODE_HELP } from "./modes";
import {
  getLeaderboard,
  qualifies,
  submitScore,
  type LeaderboardEntry
} from "@arcade/leaderboard";

const LEADERBOARD_GAME = "echo";
const NAME_MAX = 8;

type NameEntry = { active: boolean; chars: string[] };
type SubmitState = "idle" | "submitting" | "done" | "error";

export type GamePhase = "title" | "playing" | "waveClear" | "gameOver" | "victory";

type EnemyKind = "drifter" | "darter" | "husk" | "siren" | "brood" | "brute";

type Enemy = {
  pos: Vec;
  vel: Vec; // knockback velocity, decays; steering is applied separately
  kind: EnemyKind;
  hp: number;
  radius: number;
  speed: number;
  hue: number;
  coreDamage: number;
  lit: number; // seconds of remaining reveal from a ping
  targetBase: number; // index of the base this foe is committed to (sirens lock on)
  channeling: boolean; // siren currently draining a base from range
};

type Base = {
  pos: Vec;
  hp: number;
  maxHp: number;
  radius: number;
  alive: boolean;
  flash: number; // red pulse when bitten
  heal: number; // green pulse while being repaired
  threat: number; // distance from the nearest committed foe (for the warning ring)
};

type Ping = {
  origin: Vec;
  radius: number;
  life: number;
  player: 1 | 2;
  hue: number;
  resonated: boolean;
};

type Strike = {
  pos: Vec;
  radius: number;
  life: number;
  hue: number;
};

type Flash = {
  pos: Vec;
  life: number;
  hue: number;
  radius: number;
};

const MAX_WAVES = 6;
const CORE_MAX_HEALTH = 100;
const GRID_NODE_HEALTH = 70;
const CORE_RADIUS = 26;
const NODE_RADIUS = 20;
const CORE_HEAL_PER_WAVE = 12;

const PLAYER_RADIUS = 13;
const PLAYER_ACCEL = 2600;
const PLAYER_DAMP = 8; // exponential velocity damping per second
const PLAYER_MAX_SPEED = 380;
const LIGHT_RADIUS_BASE = 118; // personal ambient light, shrinks as waves escalate
const LIGHT_RADIUS_MIN = 74;

const REPAIR_MARGIN = 30; // how far past a base's rim a player can still repair it
const REPAIR_RATE = 12; // hp per second restored while a player hugs a hurt base

const PING_COOLDOWN = 1.1;
const PING_MAX_RADIUS = 340;
const PING_DURATION = 0.7;
const PING_BAND = 28;
const PING_KNOCKBACK = 150;
const LIT_DURATION = 2.6;

const STRIKE_COOLDOWN = 0.7;
const STRIKE_RADIUS = 76;

// Resonance now rewards spreading out: pings closer than MIN_SEP don't connect at
// all, and blast size/damage scale with how far apart the two origins are.
const RESONANCE_MIN_SEP = 120;
const RESONANCE_MAX_SEP = 520;
const RESONANCE_MIN_RADIUS = 120;
const RESONANCE_MAX_RADIUS = 320;
const RESONANCE_COOLDOWN = 0.6;

const SIEGE_RANGE = 240; // sirens stop and channel once this close to their base
const SIEGE_DPS = 7; // hp/s a channeling siren drains from range

const ENEMY_BASE_SPEED = 46;
const WAVE_CLEAR_TIME = 2.2;

export type Game = {
  phase: GamePhase;
  resize: (w: number, h: number) => void;
  selectMode: (id: ModeId) => void;
  startRound: () => void;
  restartRound: () => void;
  update: (dt: number, p1: PlayerInput, p2: PlayerInput, input: InputManager, audio: AudioSystem) => void;
  render: (ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number) => void;
  applyShake: (ctx: CanvasRenderingContext2D) => void;
  getHud: () => { left: string; center: string; right: string };
  getOverlay: (helpHeld: boolean) => { title: string; body: string; visible: boolean };
};

type PlayerNode = {
  pos: Vec;
  vel: Vec;
  hue: number;
  pingCooldown: number;
  strikeCooldown: number;
  score: number;
};

const enemyStats = (
  kind: EnemyKind,
  wave: number
): { hp: number; radius: number; speed: number; hue: number; coreDamage: number } => {
  const speedMult = 1 + (wave - 1) * 0.08;
  switch (kind) {
    case "darter":
      return {
        hp: 1,
        radius: 8,
        speed: ENEMY_BASE_SPEED * 1.95 * speedMult,
        hue: 45,
        coreDamage: 6
      };
    case "husk":
      return {
        hp: 2,
        radius: 18,
        speed: ENEMY_BASE_SPEED * 0.62 * speedMult,
        hue: 300,
        coreDamage: 16
      };
    case "siren":
      return {
        hp: 3,
        radius: 12,
        speed: ENEMY_BASE_SPEED * 1.15 * speedMult,
        hue: 150,
        coreDamage: 6
      };
    case "brood":
      return {
        hp: 2,
        radius: 14,
        speed: ENEMY_BASE_SPEED * 0.92 * speedMult,
        hue: 265,
        coreDamage: 8
      };
    case "brute":
      return {
        hp: 7,
        radius: 24,
        speed: ENEMY_BASE_SPEED * 0.5 * speedMult,
        hue: 350,
        coreDamage: 24
      };
    default:
      return {
        hp: 1,
        radius: 12,
        speed: ENEMY_BASE_SPEED * speedMult,
        hue: 8,
        coreDamage: 8
      };
  }
};

const waveComposition = (wave: number): EnemyKind[] => {
  const kinds: EnemyKind[] = [];
  const drifters = 4 + wave * 2;
  const darters = wave >= 2 ? Math.floor(wave * 1.2) : 0;
  const husks = wave >= 3 ? Math.floor((wave - 2) * 1.4) : 0;
  const sirens = wave >= 2 ? Math.min(1 + Math.floor((wave - 2) / 2), 3) : 0;
  const broods = wave >= 3 ? Math.floor((wave - 1) * 0.7) : 0;
  const brutes = wave >= 4 ? wave - 3 : 0;
  for (let i = 0; i < drifters; i += 1) kinds.push("drifter");
  for (let i = 0; i < darters; i += 1) kinds.push("darter");
  for (let i = 0; i < husks; i += 1) kinds.push("husk");
  for (let i = 0; i < sirens; i += 1) kinds.push("siren");
  for (let i = 0; i < broods; i += 1) kinds.push("brood");
  for (let i = 0; i < brutes; i += 1) kinds.push("brute");
  // shuffle so kinds interleave in the spawn queue
  for (let i = kinds.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  return kinds;
};

export const createGame = (width: number, height: number): Game => {
  let w = width;
  let h = height;
  let phase: GamePhase = "title";
  let cx = w * 0.5;
  let cy = h * 0.5;
  let selectedMode: ModeId = "core";

  let wave = 1;
  let corePulse = 0;
  let shake = 0;
  let waveTimer = 0;

  const players: [PlayerNode, PlayerNode] = [
    { pos: vec(w * 0.35, h * 0.5), vel: vec(), hue: 190, pingCooldown: 0, strikeCooldown: 0, score: 0 },
    { pos: vec(w * 0.65, h * 0.5), vel: vec(), hue: 315, pingCooldown: 0, strikeCooldown: 0, score: 0 }
  ];

  let bases: Base[] = [];
  const enemies: Enemy[] = [];
  const pings: Ping[] = [];
  const strikes: Strike[] = [];
  const flashes: Flash[] = [];
  const particles = new ParticleSystem();

  const spawnQueue: EnemyKind[] = [];
  let spawnTimer = 0;
  let resonanceFlash = 0;
  let resonanceCooldown = 0;

  // Leaderboard state (game over / victory)
  let endHandled = false;
  let endScore = 0;
  let endBoardKey = "";
  let leaderboardActive = false;
  let nameEntry: NameEntry | null = null;
  let board: LeaderboardEntry[] = [];
  let submitState: SubmitState = "idle";
  let justSubmitted: { name: string; score: number } | null = null;

  const beginEndSequence = (): void => {
    const boardKey = selectedMode;
    endHandled = true;
    endScore = wave;
    endBoardKey = boardKey;
    submitState = "idle";
    justSubmitted = null;
    nameEntry = null;
    leaderboardActive = false;
    board = [];
    getLeaderboard(LEADERBOARD_GAME, boardKey).then((state) => {
      if ((phase !== "gameOver" && phase !== "victory") || endBoardKey !== boardKey) return;
      if (!state.enabled) return;
      leaderboardActive = true;
      board = state.entries;
      if (qualifies(state.entries, endScore)) {
        nameEntry = { active: true, chars: [] };
      }
    });
  };

  const updateNameEntry = (input: InputManager): void => {
    const ne = nameEntry;
    if (!ne) return;
    if (input.consumePress("Enter") || input.consumePress("NumpadEnter")) {
      if (ne.chars.length >= 1) confirmName();
      return;
    }
    if (input.consumePress("Backspace")) {
      ne.chars.pop();
      return;
    }
    if (ne.chars.length >= NAME_MAX) return;
    for (let c = 65; c <= 90; c += 1) {
      if (input.consumePress(`Key${String.fromCharCode(c)}`)) {
        ne.chars.push(String.fromCharCode(c));
        return;
      }
    }
    for (let d = 0; d <= 9; d += 1) {
      if (input.consumePress(`Digit${d}`) || input.consumePress(`Numpad${d}`)) {
        ne.chars.push(String(d));
        return;
      }
    }
  };

  const confirmName = (): void => {
    const ne = nameEntry;
    if (!ne) return;
    const name = ne.chars.join("");
    nameEntry = null;
    submitState = "submitting";
    justSubmitted = { name, score: endScore };
    const boardKey = endBoardKey;
    submitScore(LEADERBOARD_GAME, boardKey, name, endScore).then((res) => {
      if (endBoardKey !== boardKey) return;
      if (res) {
        board = res.entries;
        submitState = "done";
      } else {
        submitState = "error";
      }
    });
  };

  const formatBoard = (): string => {
    const heading = `— ECHO · ${MODE_LABEL[selectedMode]} —`;
    if (board.length === 0) {
      return `${heading}\n(no scores yet — be the first!)`;
    }
    const rows = board.slice(0, 10).map((e, i) => {
      const mine =
        justSubmitted !== null &&
        e.name === justSubmitted.name &&
        Math.abs(e.score - justSubmitted.score) < 0.05;
      const marker = mine ? "▶ " : "  ";
      const rank = String(i + 1).padStart(2, " ");
      const name = e.name.padEnd(NAME_MAX, " ");
      const score = `Wave ${Math.round(e.score)}`.padStart(10, " ");
      return `${marker}${rank}. ${name} ${score}`;
    });
    return `${heading}\n${rows.join("\n")}`;
  };

  const resetLeaderboardState = (): void => {
    endHandled = false;
    leaderboardActive = false;
    nameEntry = null;
    board = [];
    submitState = "idle";
    justSubmitted = null;
  };

  const buildEndOverlay = (
    title: string,
    header: string,
    footer: string
  ): { title: string; body: string; visible: boolean } => {
    if (!leaderboardActive) {
      return { title, body: `${header}\n${footer}`, visible: true };
    }
    if (nameEntry?.active) {
      const typed = nameEntry.chars.join("");
      const cursor = nameEntry.chars.length < NAME_MAX ? "_" : "";
      return {
        title: "NEW HIGH SCORE!",
        body:
          `${header}\n\nEnter your initials:\n\n    ${typed}${cursor}\n\n` +
          `Type A–Z / 0–9  ·  Backspace  ·  Enter to save`,
        visible: true
      };
    }
    const status =
      submitState === "submitting"
        ? "\nSaving…"
        : submitState === "error"
          ? "\n(couldn't reach leaderboard — score not saved)"
          : "";
    return {
      title,
      body: `${header}${status}\n\n${formatBoard()}\n\n${footer}`,
      visible: true
    };
  };

  const makeBase = (pos: Vec, maxHp: number, radius: number): Base => ({
    pos,
    hp: maxHp,
    maxHp,
    radius,
    alive: true,
    flash: 0,
    heal: 0,
    threat: Infinity
  });

  const buildBases = (): Base[] => {
    if (selectedMode === "grid") {
      const r = Math.min(w, h) * 0.28;
      const angles = [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6];
      return angles.map((a) =>
        makeBase(vec(cx + Math.cos(a) * r, cy + Math.sin(a) * r), GRID_NODE_HEALTH, NODE_RADIUS)
      );
    }
    return [makeBase(vec(cx, cy), CORE_MAX_HEALTH, CORE_RADIUS)];
  };

  const nearestBaseIndex = (pos: Vec): number => {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < bases.length; i += 1) {
      if (!bases[i].alive) continue;
      const d = dist(pos, bases[i].pos);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  const lightRadius = (): number => Math.max(LIGHT_RADIUS_MIN, LIGHT_RADIUS_BASE - (wave - 1) * 8);

  const spawnInterval = (): number => Math.max(0.28, 0.72 - (wave - 1) * 0.05);

  const queueWave = (): void => {
    spawnQueue.push(...waveComposition(wave));
    spawnTimer = 0.4;
  };

  const addEnemy = (kind: EnemyKind, pos: Vec): void => {
    const stats = enemyStats(kind, wave);
    enemies.push({
      pos,
      vel: vec(),
      kind,
      hp: stats.hp,
      radius: stats.radius,
      speed: stats.speed,
      hue: stats.hue,
      coreDamage: stats.coreDamage,
      lit: 0,
      targetBase: Math.max(0, nearestBaseIndex(pos)),
      channeling: false
    });
  };

  const spawnEnemy = (kind: EnemyKind): void => {
    const side = Math.floor(Math.random() * 4);
    let pos: Vec;
    const margin = 30;
    if (side === 0) pos = vec(Math.random() * w, -margin);
    else if (side === 1) pos = vec(w + margin, Math.random() * h);
    else if (side === 2) pos = vec(Math.random() * w, h + margin);
    else pos = vec(-margin, Math.random() * h);
    addEnemy(kind, pos);
  };

  const resetSession = (): void => {
    resetLeaderboardState();
    wave = 1;
    shake = 0;
    bases = buildBases();
    players[0].pos = vec(w * 0.35, h * 0.5);
    players[0].vel = vec();
    players[0].pingCooldown = 0;
    players[0].strikeCooldown = 0;
    players[0].score = 0;
    players[1].pos = vec(w * 0.65, h * 0.5);
    players[1].vel = vec();
    players[1].pingCooldown = 0;
    players[1].strikeCooldown = 0;
    players[1].score = 0;
    enemies.length = 0;
    pings.length = 0;
    strikes.length = 0;
    flashes.length = 0;
    spawnQueue.length = 0;
    resonanceFlash = 0;
    resonanceCooldown = 0;
    queueWave();
  };

  const pushEnemy = (enemy: Enemy, from: Vec, amount: number): void => {
    const dir = normalize(sub(enemy.pos, from));
    enemy.vel.x += dir.x * amount;
    enemy.vel.y += dir.y * amount;
  };

  const killEnemy = (enemy: Enemy, by: PlayerNode | null, audio: AudioSystem): void => {
    particles.emit(enemy.pos, enemy.kind === "husk" || enemy.kind === "brute" ? 24 : 12, enemy.hue, 180);
    if (by) {
      by.score += 1;
    }
    // Broods burst into a spray of fast darters where they died — killing one
    // point-blank at a base dumps the swarm right onto it.
    if (enemy.kind === "brood") {
      for (let i = 0; i < 3; i += 1) {
        const off = vec(enemy.pos.x + (Math.random() - 0.5) * 18, enemy.pos.y + (Math.random() - 0.5) * 18);
        addEnemy("darter", off);
      }
    }
    audio.hit();
  };

  const damageEnemy = (
    enemy: Enemy,
    amount: number,
    by: PlayerNode | null,
    audio: AudioSystem
  ): boolean => {
    enemy.hp -= amount;
    enemy.lit = Math.max(enemy.lit, 0.6);
    if (enemy.hp <= 0) {
      killEnemy(enemy, by, audio);
      return true;
    }
    return false;
  };

  const triggerResonance = (
    mid: Vec,
    radius: number,
    damage: number,
    knockback: number,
    by: PlayerNode,
    audio: AudioSystem
  ): void => {
    resonanceFlash = clamp(radius / RESONANCE_MAX_RADIUS, 0.5, 1);
    flashes.push({ pos: mid, life: 1, hue: 275, radius });
    shake = Math.max(shake, 6 + resonanceFlash * 5);
    audio.resonance();
    for (let i = enemies.length - 1; i >= 0; i -= 1) {
      const enemy = enemies[i];
      if (dist(enemy.pos, mid) <= radius + enemy.radius) {
        enemy.lit = LIT_DURATION;
        pushEnemy(enemy, mid, knockback);
        if (damageEnemy(enemy, damage, by, audio)) {
          enemies.splice(i, 1);
        }
      }
    }
  };

  const firePing = (player: PlayerNode, index: 1 | 2, audio: AudioSystem): void => {
    if (player.pingCooldown > 0) {
      return;
    }
    player.pingCooldown = PING_COOLDOWN;
    const origin = vec(player.pos.x, player.pos.y);
    // resonance: does the other player have a fresh ping far enough away?
    if (resonanceCooldown <= 0) {
      for (const other of pings) {
        if (other.player !== index && !other.resonated && other.life > 0.15) {
          const sep = dist(other.origin, origin);
          if (sep >= RESONANCE_MIN_SEP && sep <= RESONANCE_MAX_SEP) {
            other.resonated = true;
            const t = clamp((sep - RESONANCE_MIN_SEP) / (RESONANCE_MAX_SEP - RESONANCE_MIN_SEP), 0, 1);
            const radius = lerp(RESONANCE_MIN_RADIUS, RESONANCE_MAX_RADIUS, t);
            const damage = 2 + Math.floor(t * 3); // 2 -> 5 with separation
            const knockback = lerp(200, 340, t);
            const mid = vec((other.origin.x + origin.x) / 2, (other.origin.y + origin.y) / 2);
            triggerResonance(mid, radius, damage, knockback, player, audio);
            resonanceCooldown = RESONANCE_COOLDOWN;
            break;
          }
        }
      }
    }
    pings.push({ origin, radius: 0, life: PING_DURATION, player: index, hue: player.hue, resonated: false });
    audio.ping();
  };

  const fireStrike = (player: PlayerNode, audio: AudioSystem): void => {
    if (player.strikeCooldown > 0) {
      return;
    }
    player.strikeCooldown = STRIKE_COOLDOWN;
    strikes.push({ pos: vec(player.pos.x, player.pos.y), radius: STRIKE_RADIUS, life: 0.28, hue: player.hue });
    audio.strike();
    let struck = false;
    for (let i = enemies.length - 1; i >= 0; i -= 1) {
      const enemy = enemies[i];
      if (dist(enemy.pos, player.pos) <= STRIKE_RADIUS + enemy.radius) {
        struck = true;
        enemy.lit = Math.max(enemy.lit, LIT_DURATION * 0.5);
        pushEnemy(enemy, player.pos, 120);
        if (damageEnemy(enemy, 1, player, audio)) {
          enemies.splice(i, 1);
        }
      }
    }
    if (struck) {
      shake = Math.max(shake, 4);
    }
  };

  const updatePlayer = (
    player: PlayerNode,
    input: PlayerInput,
    index: 1 | 2,
    dt: number,
    audio: AudioSystem
  ): void => {
    player.pingCooldown = Math.max(0, player.pingCooldown - dt);
    player.strikeCooldown = Math.max(0, player.strikeCooldown - dt);

    player.vel.x += input.x * PLAYER_ACCEL * dt;
    player.vel.y += input.y * PLAYER_ACCEL * dt;
    const damp = Math.exp(-PLAYER_DAMP * dt);
    player.vel.x *= damp;
    player.vel.y *= damp;
    const speed = len(player.vel);
    if (speed > PLAYER_MAX_SPEED) {
      const s = PLAYER_MAX_SPEED / speed;
      player.vel.x *= s;
      player.vel.y *= s;
    }
    player.pos.x = clamp(player.pos.x + player.vel.x * dt, PLAYER_RADIUS, w - PLAYER_RADIUS);
    player.pos.y = clamp(player.pos.y + player.vel.y * dt, PLAYER_RADIUS, h - PLAYER_RADIUS);

    if (input.primary) {
      firePing(player, index, audio);
    }
    if (input.secondary) {
      fireStrike(player, audio);
    }
  };

  const repairBases = (dt: number): void => {
    for (const base of bases) {
      if (!base.alive || base.hp >= base.maxHp) continue;
      for (const player of players) {
        if (dist(player.pos, base.pos) <= base.radius + REPAIR_MARGIN) {
          base.hp = Math.min(base.maxHp, base.hp + REPAIR_RATE * dt);
          base.heal = 1;
          break;
        }
      }
    }
  };

  const killBase = (base: Base, audio: AudioSystem): void => {
    base.alive = false;
    base.hp = 0;
    base.flash = 1;
    shake = Math.max(shake, 12);
    particles.emit(base.pos, 30, 0, 240);
    phase = "gameOver";
    audio.gameOver();
    if (!endHandled) beginEndSequence();
  };

  const updateEnemies = (dt: number, audio: AudioSystem): void => {
    for (const base of bases) {
      base.threat = Infinity;
      base.flash = Math.max(0, base.flash - dt * 2);
      base.heal = Math.max(0, base.heal - dt * 3);
    }

    for (let i = enemies.length - 1; i >= 0; i -= 1) {
      const enemy = enemies[i];

      // (re)acquire a target base if the committed one is gone
      if (enemy.targetBase < 0 || !bases[enemy.targetBase] || !bases[enemy.targetBase].alive) {
        enemy.targetBase = nearestBaseIndex(enemy.pos);
      } else if (enemy.kind !== "siren") {
        // non-sirens always chase whatever base is nearest right now
        enemy.targetBase = nearestBaseIndex(enemy.pos);
      }
      const base = bases[enemy.targetBase];
      if (!base) {
        continue;
      }

      const toBase = sub(base.pos, enemy.pos);
      const d = len(toBase);
      const dir = d > 0.001 ? { x: toBase.x / d, y: toBase.y / d } : vec();

      enemy.channeling = false;
      if (enemy.kind === "siren" && d <= SIEGE_RANGE) {
        // Parked at range, draining from afar — self-revealed while it wails.
        enemy.channeling = true;
        enemy.lit = Math.max(enemy.lit, 0.25);
        base.hp -= SIEGE_DPS * dt;
        // only knockback moves it now (no steering)
        enemy.pos.x += enemy.vel.x * dt;
        enemy.pos.y += enemy.vel.y * dt;
      } else {
        enemy.lit = Math.max(0, enemy.lit - dt);
        enemy.pos.x += dir.x * enemy.speed * dt + enemy.vel.x * dt;
        enemy.pos.y += dir.y * enemy.speed * dt + enemy.vel.y * dt;
      }

      const decay = Math.exp(-4 * dt);
      enemy.vel.x *= decay;
      enemy.vel.y *= decay;

      base.threat = Math.min(base.threat, d - base.radius);

      if (base.hp <= 0) {
        killBase(base, audio);
        return;
      }

      if (d <= base.radius + enemy.radius) {
        base.hp -= enemy.coreDamage;
        base.flash = 1;
        shake = Math.max(shake, 8);
        particles.emit(enemy.pos, 16, 0, 200);
        audio.coreHit();
        enemies.splice(i, 1);
        if (base.hp <= 0) {
          killBase(base, audio);
          return;
        }
      }
    }
  };

  const updatePings = (dt: number): void => {
    for (let i = pings.length - 1; i >= 0; i -= 1) {
      const ping = pings[i];
      ping.life -= dt;
      ping.radius = PING_MAX_RADIUS * (1 - Math.max(0, ping.life) / PING_DURATION);
      for (const enemy of enemies) {
        const band = Math.abs(dist(enemy.pos, ping.origin) - ping.radius);
        if (band < PING_BAND + enemy.radius) {
          enemy.lit = LIT_DURATION;
          pushEnemy(enemy, ping.origin, PING_KNOCKBACK * dt);
        }
      }
      if (ping.life <= 0) {
        pings.splice(i, 1);
      }
    }
  };

  const advanceSpawns = (dt: number): void => {
    if (spawnQueue.length === 0) {
      return;
    }
    spawnTimer -= dt;
    while (spawnTimer <= 0 && spawnQueue.length > 0) {
      const kind = spawnQueue.shift() as EnemyKind;
      spawnEnemy(kind);
      spawnTimer += spawnInterval();
    }
  };

  const lowestBaseFrac = (): number => {
    let lo = 1;
    for (const base of bases) {
      lo = Math.min(lo, Math.max(0, base.hp) / base.maxHp);
    }
    return lo;
  };

  return {
    get phase() {
      return phase;
    },

    resize(nw: number, nh: number): void {
      w = nw;
      h = nh;
      cx = w * 0.5;
      cy = h * 0.5;
    },

    selectMode(id: ModeId): void {
      if (phase === "title") {
        selectedMode = id;
      }
    },

    startRound(): void {
      phase = "playing";
      resetSession();
    },

    restartRound(): void {
      if (nameEntry?.active) return;
      phase = "playing";
      resetSession();
    },

    update(dt: number, p1: PlayerInput, p2: PlayerInput, input: InputManager, audio: AudioSystem): void {
      particles.update(dt);
      shake = Math.max(0, shake - dt * 22);
      corePulse = (corePulse + dt * 1.6) % (Math.PI * 2);
      resonanceFlash = Math.max(0, resonanceFlash - dt * 2.2);
      resonanceCooldown = Math.max(0, resonanceCooldown - dt);

      if (phase === "gameOver" || phase === "victory") {
        if (nameEntry?.active) {
          updateNameEntry(input);
        }
        return;
      }

      for (let i = strikes.length - 1; i >= 0; i -= 1) {
        strikes[i].life -= dt;
        if (strikes[i].life <= 0) strikes.splice(i, 1);
      }
      for (let i = flashes.length - 1; i >= 0; i -= 1) {
        flashes[i].life -= dt * 1.6;
        if (flashes[i].life <= 0) flashes.splice(i, 1);
      }

      if (phase === "waveClear") {
        waveTimer -= dt;
        updatePings(dt);
        if (waveTimer <= 0) {
          phase = "playing";
          queueWave();
        }
        return;
      }

      if (phase !== "playing") {
        return;
      }

      updatePlayer(players[0], p1, 1, dt, audio);
      updatePlayer(players[1], p2, 2, dt, audio);
      repairBases(dt);
      updatePings(dt);
      advanceSpawns(dt);
      updateEnemies(dt, audio);

      if (phase !== "playing") {
        return; // a base fell mid-update
      }

      if (spawnQueue.length === 0 && enemies.length === 0) {
        if (wave >= MAX_WAVES) {
          phase = "victory";
          audio.victory();
          if (!endHandled) beginEndSequence();
        } else {
          wave += 1;
          for (const base of bases) {
            if (base.alive) base.hp = Math.min(base.maxHp, base.hp + CORE_HEAL_PER_WAVE);
          }
          phase = "waveClear";
          waveTimer = WAVE_CLEAR_TIME;
          audio.waveClear();
        }
      }
    },

    applyShake(ctx: CanvasRenderingContext2D): void {
      if (shake <= 0) {
        return;
      }
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    },

    render(ctx: CanvasRenderingContext2D, rw: number, rh: number): void {
      const light = lightRadius();

      // The dark.
      ctx.fillStyle = "#03040a";
      ctx.fillRect(0, 0, rw, rh);

      // Faint arena vignette ring so the space reads as bounded.
      ctx.save();
      ctx.strokeStyle = "rgba(80, 110, 200, 0.06)";
      ctx.lineWidth = 2;
      ctx.strokeRect(6, 6, rw - 12, rh - 12);
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      // Personal light bubbles.
      for (const player of players) {
        const grad = ctx.createRadialGradient(player.pos.x, player.pos.y, 0, player.pos.x, player.pos.y, light);
        grad.addColorStop(0, `hsla(${player.hue}, 90%, 60%, 0.12)`);
        grad.addColorStop(1, `hsla(${player.hue}, 90%, 60%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(player.pos.x, player.pos.y, light, 0, Math.PI * 2);
        ctx.fill();
      }

      // Resonance / flash washes.
      if (resonanceFlash > 0) {
        ctx.fillStyle = `hsla(275, 100%, 75%, ${resonanceFlash * 0.16})`;
        ctx.fillRect(0, 0, rw, rh);
      }
      for (const flash of flashes) {
        const r = flash.radius * (1.05 - flash.life * 0.35);
        const grad = ctx.createRadialGradient(flash.pos.x, flash.pos.y, 0, flash.pos.x, flash.pos.y, r);
        grad.addColorStop(0, `hsla(${flash.hue}, 100%, 80%, ${flash.life * 0.5})`);
        grad.addColorStop(1, `hsla(${flash.hue}, 100%, 80%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(flash.pos.x, flash.pos.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Siren drain beams — a wailing line from foe to the base it's bleeding.
      for (const enemy of enemies) {
        if (!enemy.channeling) continue;
        const base = bases[enemy.targetBase];
        if (!base) continue;
        const pulse = 0.4 + Math.sin(corePulse * 4) * 0.2;
        ctx.strokeStyle = `hsla(${enemy.hue}, 100%, 70%, ${pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(enemy.pos.x, enemy.pos.y);
        ctx.lineTo(base.pos.x, base.pos.y);
        ctx.stroke();
      }

      // Ping rings — no shadowBlur; expanding blurred strokes tank the frame.
      for (const ping of pings) {
        const t = clamp(ping.life / PING_DURATION, 0, 1);
        ctx.strokeStyle = `hsla(${ping.hue}, 100%, 70%, ${t * 0.55})`;
        ctx.lineWidth = 1.5 + t;
        ctx.beginPath();
        ctx.arc(ping.origin.x, ping.origin.y, ping.radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Enemies — only visible where lit or inside a player's light bubble.
      for (const enemy of enemies) {
        let vis = enemy.lit > 0 ? clamp(enemy.lit / LIT_DURATION, 0, 1) : 0;
        for (const player of players) {
          const d = dist(enemy.pos, player.pos);
          if (d < light) {
            vis = Math.max(vis, (1 - d / light) * 0.75);
          }
        }
        if (vis < 0.03) {
          continue;
        }
        ctx.fillStyle = `hsla(${enemy.hue}, 90%, 60%, ${vis * 0.35})`;
        ctx.beginPath();
        ctx.arc(enemy.pos.x, enemy.pos.y, enemy.radius * 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `hsla(${enemy.hue}, 90%, 60%, ${vis})`;
        ctx.beginPath();
        ctx.arc(enemy.pos.x, enemy.pos.y, enemy.radius, 0, Math.PI * 2);
        ctx.fill();
        if (enemy.kind === "husk" || enemy.kind === "brute" || enemy.kind === "siren") {
          ctx.strokeStyle = `hsla(${enemy.hue}, 100%, 80%, ${vis})`;
          ctx.lineWidth = enemy.kind === "brute" ? 3 : 2;
          ctx.beginPath();
          ctx.arc(enemy.pos.x, enemy.pos.y, enemy.radius + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      // Strike bursts.
      for (const strike of strikes) {
        const t = clamp(strike.life / 0.28, 0, 1);
        ctx.strokeStyle = `hsla(${strike.hue}, 100%, 75%, ${t * 0.6})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(strike.pos.x, strike.pos.y, strike.radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Bases — cheap dual-disc glow instead of shadowBlur.
      for (const base of bases) {
        const healthT = Math.max(0, base.hp) / base.maxHp;
        const baseHue = 200 - (1 - healthT) * 200; // blue -> red as it fails
        const pulseScale = 1 + Math.sin(corePulse) * 0.06;
        const radius = base.radius * pulseScale;
        if (!base.alive) {
          ctx.strokeStyle = "hsla(0, 60%, 40%, 0.5)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(base.pos.x, base.pos.y, base.radius, 0, Math.PI * 2);
          ctx.stroke();
          continue;
        }
        const color = base.flash > 0.01 ? `hsla(0, 100%, 65%, 1)` : `hsla(${baseHue}, 90%, 62%, 1)`;
        ctx.fillStyle = `hsla(${baseHue}, 90%, 62%, ${0.18 + base.flash * 0.2})`;
        ctx.beginPath();
        ctx.arc(base.pos.x, base.pos.y, radius * 1.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(base.pos.x, base.pos.y, radius, 0, Math.PI * 2);
        ctx.fill();
        // health ring
        ctx.strokeStyle = `hsla(${baseHue}, 90%, 70%, 0.85)`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(base.pos.x, base.pos.y, base.radius + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * healthT);
        ctx.stroke();
        // repair pulse
        if (base.heal > 0.01) {
          ctx.strokeStyle = `hsla(140, 100%, 70%, ${base.heal * 0.7})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(base.pos.x, base.pos.y, base.radius + 12, 0, Math.PI * 2);
          ctx.stroke();
        }
        // threat warning
        if (base.threat < 160 && phase === "playing") {
          ctx.strokeStyle = `hsla(0, 100%, 60%, ${0.3 + Math.sin(corePulse * 3) * 0.2})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(base.pos.x, base.pos.y, base.radius + 16, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Players.
      for (const player of players) {
        ctx.fillStyle = `hsla(${player.hue}, 100%, 60%, 0.22)`;
        ctx.beginPath();
        ctx.arc(player.pos.x, player.pos.y, PLAYER_RADIUS * 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `hsl(${player.hue}, 100%, 65%)`;
        ctx.beginPath();
        ctx.arc(player.pos.x, player.pos.y, PLAYER_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        // ping-ready ring
        const pingReady = player.pingCooldown <= 0;
        const frac = pingReady ? 1 : 1 - player.pingCooldown / PING_COOLDOWN;
        ctx.strokeStyle = pingReady
          ? `hsla(${player.hue}, 100%, 80%, 0.9)`
          : `hsla(${player.hue}, 70%, 55%, 0.4)`;
        ctx.lineWidth = pingReady ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.arc(player.pos.x, player.pos.y, PLAYER_RADIUS + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        ctx.stroke();
      }

      particles.render(ctx);
      ctx.restore();

      // Lowest-base health bar.
      const barW = rw - 80;
      const lo = lowestBaseFrac();
      const barHue = 200 - (1 - lo) * 200;
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(40, rh - 34, barW, 8);
      ctx.fillStyle = `hsla(${barHue}, 90%, 60%, 0.9)`;
      ctx.fillRect(40, rh - 34, barW * lo, 8);
    },

    getHud(): { left: string; center: string; right: string } {
      let center = "";
      if (phase === "playing") {
        const foes = enemies.length + spawnQueue.length;
        if (selectedMode === "grid") {
          const nodes = bases.map((b) => (b.alive ? Math.ceil(b.hp) : "✕")).join(" · ");
          center = `Wave ${wave}/${MAX_WAVES}  ·  Nodes ${nodes}  ·  Foes ${foes}`;
        } else {
          center = `Wave ${wave}/${MAX_WAVES}  ·  Core ${Math.ceil(bases[0]?.hp ?? 0)}  ·  Foes ${foes}`;
        }
      } else if (phase === "waveClear") {
        center = `Wave ${wave} cleared — brace for ${wave + 1}`;
      }
      return {
        left: `P1 ${players[0].score}`,
        center,
        right: `P2 ${players[1].score}`
      };
    },

    getOverlay(helpHeld: boolean): { title: string; body: string; visible: boolean } {
      const pick =
        `${selectedMode === "core" ? "▸" : " "} 1 ${MODE_LABEL.core}` +
        `     ${selectedMode === "grid" ? "▸" : " "} 2 ${MODE_LABEL.grid}\n` +
        `${MODE_DESCRIPTION[selectedMode]}`;
      if (phase === "title") {
        return {
          title: "ECHO",
          body:
            pick +
            "\n\n" +
            MODE_HELP[selectedMode] +
            "\n\n1 / 2 pick mode  ·  Enter to start  ·  R to restart  ·  Hold H for help",
          visible: true
        };
      }
      if (phase === "gameOver") {
        const what = selectedMode === "grid" ? "A NODE WENT DARK" : "THE DARK TOOK THE CORE";
        const header =
          `${MODE_LABEL[selectedMode]} — held to wave ${wave} of ${MAX_WAVES}\n` +
          `Foes banished — P1 ${players[0].score} · P2 ${players[1].score}`;
        const footer = "Press R to try again.";
        return buildEndOverlay(what, header, footer);
      }
      if (phase === "victory") {
        const header =
          `${MODE_LABEL[selectedMode]} — all ${MAX_WAVES} waves survived.\n` +
          `Foes banished — P1 ${players[0].score} · P2 ${players[1].score}`;
        const footer = "Press R to play again.";
        return buildEndOverlay("DAWN — THE GRID HELD", header, footer);
      }
      if (helpHeld) {
        return {
          title: "HOW TO PLAY",
          body: MODE_HELP[selectedMode] + "\n\nRelease H to resume",
          visible: true
        };
      }
      return { title: "", body: "", visible: false };
    }
  };
};
