import type { InputManager, PlayerInput } from "./input";
import { ParticleSystem } from "./particles";
import { AudioSystem } from "./audio";
import { CONTROLS, MODE_HELP, MODE_LABEL, MODE_TITLE_LINE, type ModeId } from "./modes";

export type GamePhase = "title" | "playing" | "matchEnd";
export type Mode = ModeId;

// ---- tuning -------------------------------------------------------------
const TARGET_CELLS = 26; // grid resolution along the shorter screen axis
const MIN_CELL = 16;
const MAX_CELL = 34;

const BASE_SPEED = 8.2; // cells per second
const BOOST_SPEED = 12.6;
const BOOST_DRAIN = 0.55; // meter/second while boosting
const BOOST_REGEN = 0.32; // meter/second while not boosting
const BOOST_MIN = 0.12; // need at least this much to kick a boost

const HOME_R = 1; // home block half-size (1 => 3x3)
const RESPAWN_TIME = 1.4;
const TERRITORY_TIME = 90;
const CONQUEST_TARGET = 0.6;

// Player colors, kept clearly distinct from each other.
const P1_HUE = 152; // spring green
const P2_HUE = 330; // magenta

type Player = {
  hue: number;
  col: number;
  row: number;
  dir: { dx: number; dy: number };
  queued: { dx: number; dy: number } | null;
  progress: number; // 0..1 toward the next cell
  boost: number; // 0..1 meter
  alive: boolean;
  respawn: number;
  trail: number[]; // cell indices laid since leaving home
  cells: number; // owned-cell count (for HUD)
  homeCol: number;
  homeRow: number;
};

export type Game = {
  phase: GamePhase;
  resize: (w: number, h: number) => void;
  startRound: () => void;
  restartRound: () => void;
  update: (
    dt: number,
    p1: PlayerInput,
    p2: PlayerInput,
    input: InputManager,
    audio: AudioSystem
  ) => void;
  render: (ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number) => void;
  applyShake: (ctx: CanvasRenderingContext2D) => void;
  getHud: () => { left: string; center: string; right: string };
  getOverlay: (helpHeld: boolean) => { title: string; body: string; visible: boolean };
};

const formatTime = (t: number): string => {
  const total = Math.max(0, Math.ceil(t));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export const createGame = (width: number, height: number): Game => {
  let w = width;
  let h = height;
  let phase: GamePhase = "title";
  let mode: Mode = "territory";

  // Grid geometry (rebuilt on startRound; recentered on resize).
  let cell = MAX_CELL;
  let cols = 1;
  let rows = 1;
  let offX = 0;
  let offY = 0;

  // Grids. owner: -1 empty, 0 = P1, 1 = P2. trail: same encoding for live lines.
  let owner = new Int8Array(0);
  let trail = new Int8Array(0);

  const particles = new ParticleSystem();
  let shake = 0;

  // Round state
  let timeLeft = TERRITORY_TIME;
  let winner = -1; // -1 draw, 0 P1, 1 P2

  const players: Player[] = [
    makePlayer(P1_HUE),
    makePlayer(P2_HUE)
  ];

  function makePlayer(hue: number): Player {
    return {
      hue,
      col: 0,
      row: 0,
      dir: { dx: 1, dy: 0 },
      queued: null,
      progress: 0,
      boost: 1,
      alive: true,
      respawn: 0,
      trail: [],
      cells: 0,
      homeCol: 0,
      homeRow: 0
    };
  }

  const idx = (c: number, r: number): number => r * cols + c;
  const inBounds = (c: number, r: number): boolean =>
    c >= 0 && c < cols && r >= 0 && r < rows;

  // --- geometry -----------------------------------------------------------
  const layoutGrid = (): void => {
    cell = Math.round(Math.min(w, h) / TARGET_CELLS);
    cell = Math.max(MIN_CELL, Math.min(MAX_CELL, cell));
    cols = Math.max(8, Math.floor(w / cell));
    rows = Math.max(8, Math.floor(h / cell));
    offX = Math.floor((w - cols * cell) / 2);
    offY = Math.floor((h - rows * cell) / 2);
  };

  // Recenter the already-built grid without disturbing play.
  const recenter = (): void => {
    offX = Math.floor((w - cols * cell) / 2);
    offY = Math.floor((h - rows * cell) / 2);
  };

  const resize = (nw: number, nh: number): void => {
    w = nw;
    h = nh;
    if (phase === "playing" || phase === "matchEnd") {
      recenter();
    } else {
      layoutGrid();
    }
  };

  // --- home / spawning ----------------------------------------------------
  const grantHome = (p: Player, index: 0 | 1): void => {
    const cc = Math.round(cols * (index === 0 ? 0.16 : 0.84));
    const cr = Math.round(rows * 0.5);
    p.homeCol = cc;
    p.homeRow = cr;
    for (let dr = -HOME_R; dr <= HOME_R; dr += 1) {
      for (let dc = -HOME_R; dc <= HOME_R; dc += 1) {
        const c = cc + dc;
        const r = cr + dr;
        if (!inBounds(c, r)) continue;
        owner[idx(c, r)] = index;
        trail[idx(c, r)] = -1;
      }
    }
    p.col = cc;
    p.row = cr;
    p.dir = { dx: index === 0 ? 1 : -1, dy: 0 };
    p.queued = null;
    p.progress = 0;
    p.alive = true;
    p.trail.length = 0;
    recount();
  };

  const clearTrail = (index: 0 | 1): void => {
    const p = players[index];
    for (const i of p.trail) {
      if (trail[i] === index) trail[i] = -1;
    }
    p.trail.length = 0;
  };

  const headPos = (p: Player): { x: number; y: number } => {
    // Interpolated pixel position of the rider between cells.
    const t = p.alive ? p.progress : 0;
    const c = p.col + p.dir.dx * t;
    const r = p.row + p.dir.dy * t;
    return {
      x: offX + (c + 0.5) * cell,
      y: offY + (r + 0.5) * cell
    };
  };

  const recount = (): void => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < owner.length; i += 1) {
      if (owner[i] === 0) a += 1;
      else if (owner[i] === 1) b += 1;
    }
    players[0].cells = a;
    players[1].cells = b;
  };

  // Flood-fill capture: after adding the trail to ownership, any region of
  // non-owned cells that can't reach the grid edge is enclosed → claimed.
  const capture = (index: 0 | 1): void => {
    const p = players[index];
    if (p.trail.length === 0) return;

    for (const i of p.trail) {
      owner[i] = index;
      trail[i] = -1;
    }
    p.trail.length = 0;

    const total = cols * rows;
    const reach = new Uint8Array(total); // 1 = can reach the outside
    const stack: number[] = [];
    const pushOutside = (c: number, r: number): void => {
      if (!inBounds(c, r)) return;
      const i = idx(c, r);
      if (reach[i] || owner[i] === index) return;
      reach[i] = 1;
      stack.push(i);
    };
    for (let c = 0; c < cols; c += 1) {
      pushOutside(c, 0);
      pushOutside(c, rows - 1);
    }
    for (let r = 0; r < rows; r += 1) {
      pushOutside(0, r);
      pushOutside(cols - 1, r);
    }
    while (stack.length) {
      const i = stack.pop() as number;
      const c = i % cols;
      const r = (i - c) / cols;
      pushOutside(c - 1, r);
      pushOutside(c + 1, r);
      pushOutside(c, r - 1);
      pushOutside(c, r + 1);
    }

    let claimed = 0;
    for (let i = 0; i < total; i += 1) {
      if (owner[i] !== index && reach[i] === 0) {
        owner[i] = index;
        claimed += 1;
      }
    }

    recount();
    const at = headPos(p);
    particles.emit({ x: at.x, y: at.y }, 18, p.hue, 180);
    shake = Math.min(10, shake + 3 + Math.min(6, claimed * 0.05));
  };

  const sendHome = (index: 0 | 1, audio: AudioSystem): void => {
    const p = players[index];
    if (!p.alive) return;
    clearTrail(index);
    p.alive = false;
    p.respawn = RESPAWN_TIME;
    const at = headPos(p);
    particles.emit({ x: at.x, y: at.y }, 26, p.hue, 240);
    shake = Math.min(12, shake + 6);
    audio.crash();
  };

  // A rider commits onto the cell ahead. Returns nothing; mutates state.
  const stepPlayer = (index: 0 | 1, audio: AudioSystem): void => {
    const p = players[index];
    const other = (1 - index) as 0 | 1;
    const nc = p.col + p.dir.dx;
    const nr = p.row + p.dir.dy;

    if (!inBounds(nc, nr)) {
      sendHome(index, audio); // walls are lethal
      return;
    }

    const i = idx(nc, nr);
    p.col = nc;
    p.row = nr;

    // Trail collisions resolve first.
    const t = trail[i];
    if (t === index) {
      sendHome(index, audio); // crossed your own line
      return;
    }
    if (t === other) {
      // Cut the rival's line — sendHome erases their whole run and resets them.
      sendHome(other, audio);
      audio.cut();
    }

    // Ownership logic.
    if (owner[i] === index) {
      if (p.trail.length > 0) {
        capture(index);
        audio.claim();
      }
    } else {
      // Empty or enemy land: extend the line.
      trail[i] = index;
      p.trail.push(i);
      audio.step();
    }

    // Apply a queued turn now that we're aligned on a cell.
    if (p.queued) {
      p.dir = p.queued;
      p.queued = null;
    }
  };

  // Translate held input into a queued perpendicular turn (snake-style).
  const steer = (p: Player, inp: PlayerInput): void => {
    if (!p.alive) return;
    const candidates: { dx: number; dy: number }[] = [];
    if (inp.x > 0) candidates.push({ dx: 1, dy: 0 });
    if (inp.x < 0) candidates.push({ dx: -1, dy: 0 });
    if (inp.y > 0) candidates.push({ dx: 0, dy: 1 });
    if (inp.y < 0) candidates.push({ dx: 0, dy: -1 });
    for (const cand of candidates) {
      // Only accept turns perpendicular to the current heading.
      if (cand.dx * p.dir.dx + cand.dy * p.dir.dy === 0) {
        p.queued = cand;
      }
    }
  };

  const advance = (index: 0 | 1, inp: PlayerInput, dt: number, audio: AudioSystem): void => {
    const p = players[index];
    if (!p.alive) {
      p.respawn -= dt;
      if (p.respawn <= 0) grantHome(p, index);
      return;
    }

    steer(p, inp);

    // Boost meter.
    const boosting = inp.primary && p.boost > BOOST_MIN;
    if (boosting) p.boost = Math.max(0, p.boost - BOOST_DRAIN * dt);
    else p.boost = Math.min(1, p.boost + BOOST_REGEN * dt);
    const speed = boosting ? BOOST_SPEED : BASE_SPEED;

    p.progress += speed * dt;
    // Guard against huge dt spikes stepping many cells (they can't anyway).
    let steps = 0;
    while (p.progress >= 1 && p.alive && steps < 4) {
      p.progress -= 1;
      stepPlayer(index, audio);
      steps += 1;
    }
    if (!p.alive) p.progress = 0;
  };

  const checkEnd = (audio: AudioSystem): void => {
    if (mode === "conquest") {
      const total = cols * rows;
      const share0 = players[0].cells / total;
      const share1 = players[1].cells / total;
      if (share0 >= CONQUEST_TARGET || share1 >= CONQUEST_TARGET) {
        winner = share0 >= share1 ? 0 : 1;
        phase = "matchEnd";
        audio.win();
      }
    } else if (timeLeft <= 0) {
      if (players[0].cells > players[1].cells) winner = 0;
      else if (players[1].cells > players[0].cells) winner = 1;
      else winner = -1;
      phase = "matchEnd";
      audio.win();
    }
  };

  // --- lifecycle ----------------------------------------------------------
  const initRound = (): void => {
    layoutGrid();
    owner = new Int8Array(cols * rows).fill(-1);
    trail = new Int8Array(cols * rows).fill(-1);
    for (const p of players) {
      p.boost = 1;
      p.trail.length = 0;
    }
    grantHome(players[0], 0);
    grantHome(players[1], 1);
    recount();
    particles.clear();
    timeLeft = TERRITORY_TIME;
    winner = -1;
    shake = 0;
    phase = "playing";
  };

  // Enter from the title, and R for an immediate rematch, both start a fresh
  // round of the currently selected mode (mirrors the other cabinets).
  const startRound = (): void => initRound();
  const restartRound = (): void => initRound();

  const update = (
    dt: number,
    p1: PlayerInput,
    p2: PlayerInput,
    input: InputManager,
    audio: AudioSystem
  ): void => {
    if (phase === "title") {
      if (input.consumePress("Digit1")) mode = "territory";
      if (input.consumePress("Digit2")) mode = "conquest";
    }

    particles.update(dt);
    shake = Math.max(0, shake - dt * 24);

    if (phase !== "playing") return;

    advance(0, p1, dt, audio);
    advance(1, p2, dt, audio);

    if (mode === "territory") timeLeft = Math.max(0, timeLeft - dt);
    checkEnd(audio);
  };

  // --- rendering ----------------------------------------------------------
  const cellColor = (hue: number, a: number, light = 52): string =>
    `hsla(${hue}, 78%, ${light}%, ${a})`;

  const render = (ctx: CanvasRenderingContext2D, vw: number, vh: number): void => {
    ctx.fillStyle = "#03080a";
    ctx.fillRect(0, 0, vw, vh);

    if (phase === "title") {
      renderTitleBackdrop(ctx, vw, vh);
      particles.render(ctx);
      return;
    }

    const gw = cols * cell;
    const gh = rows * cell;

    // Play-field backing.
    ctx.fillStyle = "rgba(255,255,255,0.015)";
    ctx.fillRect(offX, offY, gw, gh);

    // Owned cells.
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const o = owner[idx(c, r)];
        if (o < 0) continue;
        ctx.fillStyle = cellColor(players[o].hue, 0.3);
        ctx.fillRect(offX + c * cell, offY + r * cell, cell, cell);
      }
    }

    // Faint grid lines.
    ctx.strokeStyle = "rgba(120,180,160,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= cols; c += 1) {
      ctx.moveTo(offX + c * cell + 0.5, offY);
      ctx.lineTo(offX + c * cell + 0.5, offY + gh);
    }
    for (let r = 0; r <= rows; r += 1) {
      ctx.moveTo(offX, offY + r * cell + 0.5);
      ctx.lineTo(offX + gw, offY + r * cell + 0.5);
    }
    ctx.stroke();

    // Live trails (brighter, glowing).
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const index of [0, 1] as const) {
      const p = players[index];
      if (p.trail.length === 0) continue;
      ctx.fillStyle = cellColor(p.hue, 0.5, 60);
      for (const i of p.trail) {
        const c = i % cols;
        const r = (i - c) / cols;
        ctx.fillRect(offX + c * cell + 2, offY + r * cell + 2, cell - 4, cell - 4);
      }
    }
    ctx.restore();

    // Border.
    ctx.strokeStyle = "rgba(120,255,200,0.28)";
    ctx.lineWidth = 2;
    ctx.strokeRect(offX + 1, offY + 1, gw - 2, gh - 2);

    // Riders.
    for (const index of [0, 1] as const) {
      const p = players[index];
      if (!p.alive) {
        // Ghost countdown at home while respawning.
        const hx = offX + (p.homeCol + 0.5) * cell;
        const hy = offY + (p.homeRow + 0.5) * cell;
        ctx.save();
        ctx.globalAlpha = 0.4 + 0.3 * Math.sin(p.respawn * 10);
        ctx.strokeStyle = cellColor(p.hue, 1, 60);
        ctx.lineWidth = 2;
        ctx.strokeRect(hx - cell, hy - cell, cell * 2, cell * 2);
        ctx.restore();
        continue;
      }
      const at = headPos(p);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = cellColor(p.hue, 0.35, 60);
      ctx.beginPath();
      ctx.arc(at.x, at.y, cell * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = cellColor(p.hue, 1, 66);
      const s = cell * 0.7;
      ctx.fillRect(at.x - s / 2, at.y - s / 2, s, s);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(at.x - s * 0.18, at.y - s * 0.18, s * 0.36, s * 0.36);
    }

    particles.render(ctx);
  };

  // A quiet animated grid behind the title / mode select.
  let titleT = 0;
  const renderTitleBackdrop = (ctx: CanvasRenderingContext2D, vw: number, vh: number): void => {
    titleT += 0.016;
    const g = 46;
    ctx.strokeStyle = "rgba(90,255,180,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const shift = (titleT * 12) % g;
    for (let x = -g + shift; x < vw + g; x += g) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, vh);
    }
    for (let y = -g + shift; y < vh + g; y += g) {
      ctx.moveTo(0, y);
      ctx.lineTo(vw, y);
    }
    ctx.stroke();
  };

  const applyShake = (ctx: CanvasRenderingContext2D): void => {
    if (shake <= 0) return;
    const dx = (Math.random() - 0.5) * shake;
    const dy = (Math.random() - 0.5) * shake;
    ctx.translate(dx, dy);
  };

  // --- HUD / overlay ------------------------------------------------------
  const pct = (index: 0 | 1): string => {
    const total = Math.max(1, cols * rows);
    return `${Math.round((players[index].cells / total) * 100)}%`;
  };

  const getHud = (): { left: string; center: string; right: string } => {
    if (phase !== "playing") return { left: "", center: "", right: "" };
    const center =
      mode === "territory"
        ? formatTime(timeLeft)
        : `HOLD ${Math.round(CONQUEST_TARGET * 100)}%`;
    return {
      left: `P1  ${pct(0)}`,
      center,
      right: `${pct(1)}  P2`
    };
  };

  const getOverlay = (helpHeld: boolean): { title: string; body: string; visible: boolean } => {
    if (phase === "playing") {
      if (helpHeld) {
        return { title: MODE_LABEL[mode], body: `${MODE_HELP[mode]}\n\n${CONTROLS}`, visible: true };
      }
      return { title: "", body: "", visible: false };
    }

    if (phase === "matchEnd") {
      const title =
        winner === -1 ? "DEAD HEAT" : winner === 0 ? "PLAYER 1 CLAIMS IT" : "PLAYER 2 CLAIMS IT";
      const body =
        `P1 ${pct(0)}   ·   P2 ${pct(1)}\n\n` +
        "Press R to play again";
      return { title, body, visible: true };
    }

    // Title / mode select.
    const line = (m: Mode): string => (mode === m ? "▶" : " ") + MODE_TITLE_LINE[m];
    const body =
      "A light-cycle land grab.  Leave your territory to draw a\n" +
      "line, loop back in to claim everything you enclosed —\n" +
      "and cut across your rival's line to send them home.\n\n" +
      `${line("territory")}\n${line("conquest")}\n\n` +
      "1 / 2 pick a mode   ·   Enter start   ·   hold H for help\n\n" +
      CONTROLS;
    return { title: "LATTICE", body, visible: true };
  };

  return {
    get phase() {
      return phase;
    },
    resize,
    startRound,
    restartRound,
    update,
    render,
    applyShake,
    getHud,
    getOverlay
  };
};
