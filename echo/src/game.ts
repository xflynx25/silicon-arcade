import type { PlayerInput } from "./input";
import { ParticleSystem } from "./particles";
import { AudioSystem } from "./audio";
import { clamp, dist, len, normalize, sub, vec, type Vec } from "./vec";

export type GamePhase = "title" | "playing" | "waveClear" | "gameOver" | "victory";

type EnemyKind = "drifter" | "darter" | "husk";

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
};

const MAX_WAVES = 6;
const CORE_MAX_HEALTH = 100;
const CORE_RADIUS = 26;
const CORE_HEAL_PER_WAVE = 12;

const PLAYER_RADIUS = 13;
const PLAYER_ACCEL = 2600;
const PLAYER_DAMP = 8; // exponential velocity damping per second
const PLAYER_MAX_SPEED = 380;
const LIGHT_RADIUS = 118; // personal ambient light that dimly reveals nearby husks

const PING_COOLDOWN = 1.1;
const PING_MAX_RADIUS = 340;
const PING_DURATION = 0.7;
const PING_BAND = 28;
const PING_KNOCKBACK = 150;
const LIT_DURATION = 2.6;

const STRIKE_COOLDOWN = 0.7;
const STRIKE_RADIUS = 76;

const RESONANCE_RANGE = 280; // ping origins within this distance resonate
const RESONANCE_RADIUS = 210;

const ENEMY_BASE_SPEED = 46;
const WAVE_CLEAR_TIME = 2.2;

const HELP_BODY =
  "BLACKOUT — co-op survival in the dark. Defend the Core at the center.\n" +
  "Husks crawl in from the black, and you can barely see them.\n\n" +
  "· PING sends out a sonar ring — every husk it sweeps lights up, then fades.\n" +
  "· STRIKE destroys husks close to you; position using what your pings reveal.\n" +
  "· When both players' pings OVERLAP, they RESONATE — the whole arena flashes\n" +
  "  bright and everything caught in it is blasted apart.\n" +
  "· Let a husk reach the Core and it takes a bite. Survive all 6 waves.\n\n" +
  "P1  ·  W A S D move  ·  Left Shift ping  ·  Space strike\n" +
  "P2  ·  Arrow keys move  ·  Right Shift ping  ·  Enter strike";

export type Game = {
  phase: GamePhase;
  resize: (w: number, h: number) => void;
  startRound: () => void;
  restartRound: () => void;
  update: (dt: number, p1: PlayerInput, p2: PlayerInput, audio: AudioSystem) => void;
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
  for (let i = 0; i < drifters; i += 1) kinds.push("drifter");
  for (let i = 0; i < darters; i += 1) kinds.push("darter");
  for (let i = 0; i < husks; i += 1) kinds.push("husk");
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

  let wave = 1;
  let coreHealth = CORE_MAX_HEALTH;
  let coreFlash = 0; // red pulse when the core is bitten
  let corePulse = 0;
  let shake = 0;
  let waveTimer = 0;
  let nearestCoreThreat = Infinity;

  const players: [PlayerNode, PlayerNode] = [
    { pos: vec(w * 0.35, h * 0.5), vel: vec(), hue: 190, pingCooldown: 0, strikeCooldown: 0, score: 0 },
    { pos: vec(w * 0.65, h * 0.5), vel: vec(), hue: 315, pingCooldown: 0, strikeCooldown: 0, score: 0 }
  ];

  const enemies: Enemy[] = [];
  const pings: Ping[] = [];
  const strikes: Strike[] = [];
  const flashes: Flash[] = [];
  const particles = new ParticleSystem();

  const spawnQueue: EnemyKind[] = [];
  let spawnTimer = 0;
  let resonanceFlash = 0;

  const core = (): Vec => vec(cx, cy);

  const spawnInterval = (): number => Math.max(0.28, 0.72 - (wave - 1) * 0.05);

  const queueWave = (): void => {
    spawnQueue.push(...waveComposition(wave));
    spawnTimer = 0.4;
  };

  const spawnEnemy = (kind: EnemyKind): void => {
    const stats = enemyStats(kind, wave);
    const side = Math.floor(Math.random() * 4);
    let pos: Vec;
    const margin = 30;
    if (side === 0) pos = vec(Math.random() * w, -margin);
    else if (side === 1) pos = vec(w + margin, Math.random() * h);
    else if (side === 2) pos = vec(Math.random() * w, h + margin);
    else pos = vec(-margin, Math.random() * h);
    enemies.push({
      pos,
      vel: vec(),
      kind,
      hp: stats.hp,
      radius: stats.radius,
      speed: stats.speed,
      hue: stats.hue,
      coreDamage: stats.coreDamage,
      lit: 0
    });
  };

  const resetSession = (): void => {
    wave = 1;
    coreHealth = CORE_MAX_HEALTH;
    coreFlash = 0;
    shake = 0;
    nearestCoreThreat = Infinity;
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
    queueWave();
  };

  const pushEnemy = (enemy: Enemy, from: Vec, amount: number): void => {
    const dir = normalize(sub(enemy.pos, from));
    enemy.vel.x += dir.x * amount;
    enemy.vel.y += dir.y * amount;
  };

  const killEnemy = (enemy: Enemy, by: PlayerNode | null, audio: AudioSystem): void => {
    particles.emit(enemy.pos, enemy.kind === "husk" ? 22 : 12, enemy.hue, 180);
    if (by) {
      by.score += 1;
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

  const triggerResonance = (mid: Vec, by: PlayerNode, audio: AudioSystem): void => {
    resonanceFlash = 1;
    flashes.push({ pos: mid, life: 1, hue: 275 });
    shake = Math.max(shake, 9);
    audio.resonance();
    for (let i = enemies.length - 1; i >= 0; i -= 1) {
      const enemy = enemies[i];
      if (dist(enemy.pos, mid) <= RESONANCE_RADIUS + enemy.radius) {
        enemy.lit = LIT_DURATION;
        pushEnemy(enemy, mid, 260);
        if (damageEnemy(enemy, 2, by, audio)) {
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
    // resonance: does the other player have a fresh ping nearby?
    for (const other of pings) {
      if (other.player !== index && !other.resonated && other.life > 0.15) {
        if (dist(other.origin, origin) <= RESONANCE_RANGE) {
          other.resonated = true;
          const mid = vec((other.origin.x + origin.x) / 2, (other.origin.y + origin.y) / 2);
          triggerResonance(mid, player, audio);
          break;
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

  const updateEnemies = (dt: number, audio: AudioSystem): void => {
    const c = core();
    nearestCoreThreat = Infinity;
    for (let i = enemies.length - 1; i >= 0; i -= 1) {
      const enemy = enemies[i];
      enemy.lit = Math.max(0, enemy.lit - dt);
      const toCore = sub(c, enemy.pos);
      const d = len(toCore);
      const steer = d > 0.001 ? { x: toCore.x / d, y: toCore.y / d } : vec();
      enemy.pos.x += steer.x * enemy.speed * dt + enemy.vel.x * dt;
      enemy.pos.y += steer.y * enemy.speed * dt + enemy.vel.y * dt;
      const decay = Math.exp(-4 * dt);
      enemy.vel.x *= decay;
      enemy.vel.y *= decay;

      const coreDist = d - CORE_RADIUS;
      if (coreDist < nearestCoreThreat) {
        nearestCoreThreat = coreDist;
      }

      if (d <= CORE_RADIUS + enemy.radius) {
        coreHealth = Math.max(0, coreHealth - enemy.coreDamage);
        coreFlash = 1;
        shake = Math.max(shake, 8);
        particles.emit(enemy.pos, 16, 0, 200);
        audio.coreHit();
        enemies.splice(i, 1);
        if (coreHealth <= 0) {
          phase = "gameOver";
          audio.gameOver();
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

    startRound(): void {
      phase = "playing";
      resetSession();
    },

    restartRound(): void {
      phase = "playing";
      resetSession();
    },

    update(dt: number, p1: PlayerInput, p2: PlayerInput, audio: AudioSystem): void {
      particles.update(dt);
      shake = Math.max(0, shake - dt * 22);
      coreFlash = Math.max(0, coreFlash - dt * 2);
      corePulse = (corePulse + dt * 1.6) % (Math.PI * 2);
      resonanceFlash = Math.max(0, resonanceFlash - dt * 2.2);

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
      updatePings(dt);
      advanceSpawns(dt);
      updateEnemies(dt, audio);

      if (phase !== "playing") {
        return; // core died mid-update
      }

      if (spawnQueue.length === 0 && enemies.length === 0) {
        if (wave >= MAX_WAVES) {
          phase = "victory";
          audio.victory();
        } else {
          wave += 1;
          coreHealth = Math.min(CORE_MAX_HEALTH, coreHealth + CORE_HEAL_PER_WAVE);
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
      // The dark.
      ctx.fillStyle = "#03040a";
      ctx.fillRect(0, 0, rw, rh);

      const c = core();

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
        const grad = ctx.createRadialGradient(player.pos.x, player.pos.y, 0, player.pos.x, player.pos.y, LIGHT_RADIUS);
        grad.addColorStop(0, `hsla(${player.hue}, 90%, 60%, 0.12)`);
        grad.addColorStop(1, `hsla(${player.hue}, 90%, 60%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(player.pos.x, player.pos.y, LIGHT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }

      // Resonance / flash washes.
      if (resonanceFlash > 0) {
        ctx.fillStyle = `hsla(275, 100%, 75%, ${resonanceFlash * 0.16})`;
        ctx.fillRect(0, 0, rw, rh);
      }
      for (const flash of flashes) {
        const r = RESONANCE_RADIUS * (1.1 - flash.life * 0.4);
        const grad = ctx.createRadialGradient(flash.pos.x, flash.pos.y, 0, flash.pos.x, flash.pos.y, r);
        grad.addColorStop(0, `hsla(${flash.hue}, 100%, 80%, ${flash.life * 0.5})`);
        grad.addColorStop(1, `hsla(${flash.hue}, 100%, 80%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(flash.pos.x, flash.pos.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Ping rings.
      for (const ping of pings) {
        const t = clamp(ping.life / PING_DURATION, 0, 1);
        ctx.strokeStyle = `hsla(${ping.hue}, 100%, 70%, ${t * 0.7})`;
        ctx.shadowColor = `hsla(${ping.hue}, 100%, 60%, ${t})`;
        ctx.shadowBlur = 16;
        ctx.lineWidth = 2 + t * 2;
        ctx.beginPath();
        ctx.arc(ping.origin.x, ping.origin.y, ping.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // Enemies — only visible where lit or inside a player's light bubble.
      for (const enemy of enemies) {
        let vis = enemy.lit > 0 ? clamp(enemy.lit / LIT_DURATION, 0, 1) : 0;
        for (const player of players) {
          const d = dist(enemy.pos, player.pos);
          if (d < LIGHT_RADIUS) {
            vis = Math.max(vis, (1 - d / LIGHT_RADIUS) * 0.75);
          }
        }
        if (vis < 0.03) {
          continue;
        }
        ctx.fillStyle = `hsla(${enemy.hue}, 90%, 60%, ${vis})`;
        ctx.shadowColor = `hsla(${enemy.hue}, 100%, 55%, ${vis})`;
        ctx.shadowBlur = 14 * vis;
        ctx.beginPath();
        ctx.arc(enemy.pos.x, enemy.pos.y, enemy.radius, 0, Math.PI * 2);
        ctx.fill();
        if (enemy.kind === "husk") {
          ctx.strokeStyle = `hsla(${enemy.hue}, 100%, 80%, ${vis})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(enemy.pos.x, enemy.pos.y, enemy.radius + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;

      // Strike bursts.
      for (const strike of strikes) {
        const t = clamp(strike.life / 0.28, 0, 1);
        ctx.strokeStyle = `hsla(${strike.hue}, 100%, 75%, ${t})`;
        ctx.lineWidth = 3 * t + 1;
        ctx.beginPath();
        ctx.arc(strike.pos.x, strike.pos.y, strike.radius * (1.2 - t * 0.2), 0, Math.PI * 2);
        ctx.stroke();
      }

      // Core.
      const threatWarning = nearestCoreThreat < 160 && phase === "playing";
      const corePulseScale = 1 + Math.sin(corePulse) * 0.06;
      const healthT = coreHealth / CORE_MAX_HEALTH;
      const coreHue = 200 - (1 - healthT) * 200; // blue -> red as it fails
      const coreColor = coreFlash > 0.01 ? `hsla(0, 100%, 65%, 1)` : `hsla(${coreHue}, 90%, 62%, 1)`;
      ctx.fillStyle = coreColor;
      ctx.shadowColor = coreColor;
      ctx.shadowBlur = 30 + coreFlash * 30 + (threatWarning ? 14 : 0);
      ctx.beginPath();
      ctx.arc(c.x, c.y, CORE_RADIUS * corePulseScale, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (threatWarning) {
        ctx.strokeStyle = `hsla(0, 100%, 60%, ${0.3 + Math.sin(corePulse * 3) * 0.2})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, CORE_RADIUS + 12, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Players.
      for (const player of players) {
        ctx.fillStyle = `hsl(${player.hue}, 100%, 65%)`;
        ctx.shadowColor = `hsl(${player.hue}, 100%, 55%)`;
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(player.pos.x, player.pos.y, PLAYER_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
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

      // Core health bar.
      const barW = rw - 80;
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(40, rh - 34, barW, 8);
      ctx.fillStyle = `hsla(${coreHue}, 90%, 60%, 0.9)`;
      ctx.fillRect(40, rh - 34, barW * healthT, 8);
    },

    getHud(): { left: string; center: string; right: string } {
      let center = "";
      if (phase === "playing") {
        center = `Wave ${wave}/${MAX_WAVES}  ·  Core ${Math.ceil(coreHealth)}  ·  Husks ${enemies.length + spawnQueue.length}`;
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
      if (phase === "title") {
        return {
          title: "ECHO",
          body: HELP_BODY + "\n\nEnter to start  ·  R to restart  ·  Hold H for help",
          visible: true
        };
      }
      if (phase === "gameOver") {
        return {
          title: "THE DARK TOOK THE CORE",
          body:
            `Held to wave ${wave} of ${MAX_WAVES}\n` +
            `Husks banished — P1 ${players[0].score} · P2 ${players[1].score}\n` +
            "Press R to try again.",
          visible: true
        };
      }
      if (phase === "victory") {
        return {
          title: "DAWN — THE CORE HELD",
          body:
            `All ${MAX_WAVES} waves survived.\n` +
            `Husks banished — P1 ${players[0].score} · P2 ${players[1].score}\n` +
            "Press R to play again.",
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
