// CIPHER — a solo memory game for Silicon Arcade.
//
// Watch the machine flash a growing sequence across four glyph pads, then
// echo it back before the fuse burns out. Each round adds one step and tightens
// the timing. A single mistake — or a spent fuse — ends the run. No physics,
// no opponent: just you against a lengthening code.

import {
  getLeaderboard,
  qualifies,
  submitScore,
  type LeaderboardEntry
} from "@arcade/leaderboard";

const LEADERBOARD_GAME = "cipher";
const LEADERBOARD_BOARD = "default";
const NAME_MAX = 8;

type NameEntry = { active: boolean; chars: string[] };
type SubmitState = "idle" | "submitting" | "done" | "error";

const app = document.getElementById("app") as HTMLElement;
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d")!;
app.append(canvas);

// ---------------------------------------------------------------- layout ----
let W = 0;
let H = 0;
let DPR = 1;

const resize = (): void => {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = app.clientWidth;
  H = app.clientHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
};
window.addEventListener("resize", resize);
resize();

// The four pads, arranged in a diamond. Each owns a color, a tone, and a key.
type Pad = {
  hue: number;
  tone: number;
  keys: string[];
  glyph: string;
  lit: number; // 0..1 activation glow, decays each frame
};

const PADS: Pad[] = [
  { hue: 190, tone: 329.63, keys: ["arrowup", "w"], glyph: "△", lit: 0 },
  { hue: 330, tone: 440.0, keys: ["arrowright", "d"], glyph: "◇", lit: 0 },
  { hue: 45, tone: 523.25, keys: ["arrowdown", "s"], glyph: "▽", lit: 0 },
  { hue: 150, tone: 392.0, keys: ["arrowleft", "a"], glyph: "◻", lit: 0 }
];

// Diamond geometry, recomputed each frame from current size.
const padCenter = (i: number): { x: number; y: number; r: number } => {
  const cx = W / 2;
  const cy = H / 2 + 10;
  const span = Math.min(W, H) * 0.32;
  const r = Math.min(W, H) * 0.13;
  const angles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
  return { x: cx + Math.cos(angles[i]) * span, y: cy + Math.sin(angles[i]) * span, r };
};

// ----------------------------------------------------------------- audio ----
let actx: AudioContext | null = null;
// Must be called from within a user gesture so the browser unlocks playback —
// otherwise the first WATCH sequence (which beeps from rAF) stays silent.
const ensureAudio = (): void => {
  if (!actx) actx = new AudioContext();
  if (actx.state === "suspended") void actx.resume();
};
const beep = (freq: number, dur = 0.28, type: OscillatorType = "sine"): void => {
  ensureAudio();
  if (!actx) return;
  const t = actx.currentTime;
  const osc = actx.createOscillator();
  const gain = actx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(actx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
};

// ------------------------------------------------------------------ state ----
type Phase = "idle" | "show" | "recall" | "levelup" | "over";

let phase: Phase = "idle";
let sequence: number[] = [];
let showIndex = 0; // which step of the sequence is currently flashing
let showTimer = 0; // seconds until the next flash / gap toggle
let showOn = false; // is a pad currently lit during the show phase
let recallPos = 0; // how many correct inputs the player has given this round
let fuse = 1; // 1..0 countdown during recall; hitting 0 ends the run
let levelTimer = 0; // brief celebration pause between rounds, counted down by dt
let round = 0;
let best = Number(localStorage.getItem("cipher-best") || 0);
let flash = 0; // full-screen flash on error / level-up

// Leaderboard state (end-of-run)
let endHandled = false;
let endScore = 0;
let leaderboardActive = false;
let nameEntry: NameEntry | null = null;
let board: LeaderboardEntry[] = [];
let submitState: SubmitState = "idle";
let justSubmitted: { name: string; score: number } | null = null;

const gapFor = (r: number): number => Math.max(0.14, 0.42 - r * 0.02);
const litFor = (r: number): number => Math.max(0.16, 0.5 - r * 0.02);
const fuseFor = (len: number): number => 1.6 + len * 0.9; // seconds to echo the code

let fuseTotal = fuseFor(1);

const startGame = (): void => {
  ensureAudio(); // reached only from a gesture; unlocks the WATCH-phase tones
  sequence = [];
  round = 0;
  phase = "show";
  flash = 0;
  endHandled = false;
  leaderboardActive = false;
  nameEntry = null;
  board = [];
  submitState = "idle";
  justSubmitted = null;
  nextRound();
};

const beginEndSequence = (): void => {
  endHandled = true;
  endScore = Math.max(0, round - 1);
  submitState = "idle";
  justSubmitted = null;
  nameEntry = null;
  leaderboardActive = false;
  board = [];
  getLeaderboard(LEADERBOARD_GAME, LEADERBOARD_BOARD).then((state) => {
    if (phase !== "over") return;
    if (!state.enabled) return;
    leaderboardActive = true;
    board = state.entries;
    if (qualifies(state.entries, endScore)) {
      nameEntry = { active: true, chars: [] };
    }
  });
};

const confirmName = (): void => {
  const ne = nameEntry;
  if (!ne) return;
  const name = ne.chars.join("");
  nameEntry = null;
  submitState = "submitting";
  justSubmitted = { name, score: endScore };
  submitScore(LEADERBOARD_GAME, LEADERBOARD_BOARD, name, endScore).then((res) => {
    if (phase !== "over") return;
    if (res) {
      board = res.entries;
      submitState = "done";
    } else {
      submitState = "error";
    }
  });
};

const formatBoard = (): string => {
  const heading = "— CIPHER —";
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
    const score = `${e.score} steps`.padStart(10, " ");
    return `${marker}${rank}. ${name} ${score}`;
  });
  return `${heading}\n${rows.join("\n")}`;
};

const nextRound = (): void => {
  round += 1;
  sequence.push(Math.floor(Math.random() * 4));
  showIndex = 0;
  showTimer = 0.5;
  showOn = false;
  phase = "show";
  flash = 0.5;
};

const beginRecall = (): void => {
  phase = "recall";
  recallPos = 0;
  fuseTotal = fuseFor(sequence.length);
  fuse = 1;
};

const gameOver = (): void => {
  phase = "over";
  if (round - 1 > best) {
    best = round - 1;
    localStorage.setItem("cipher-best", String(best));
  }
  beep(110, 0.5, "sawtooth");
  if (!endHandled) beginEndSequence();
};

const press = (pad: number): void => {
  if (phase === "idle" || phase === "over") {
    if (phase === "over" && nameEntry?.active) return;
    startGame();
    return;
  }
  if (phase !== "recall") return;

  PADS[pad].lit = 1;
  beep(PADS[pad].tone, 0.22);

  if (pad === sequence[recallPos]) {
    recallPos += 1;
    fuse = Math.min(1, fuse + 0.12); // small reward for a correct hit
    if (recallPos >= sequence.length) {
      flash = 0.4;
      beep(880, 0.14, "triangle");
      phase = "levelup"; // freeze input during the brief celebration
      levelTimer = 0.48;
    }
  } else {
    flash = 1;
    gameOver();
  }
};

// ------------------------------------------------------------------ input ----
const handleNameKey = (e: KeyboardEvent): boolean => {
  const ne = nameEntry;
  if (!ne?.active || phase !== "over") return false;
  if (e.key === "Enter") {
    if (ne.chars.length >= 1) confirmName();
    e.preventDefault();
    return true;
  }
  if (e.key === "Backspace") {
    ne.chars.pop();
    e.preventDefault();
    return true;
  }
  if (ne.chars.length >= NAME_MAX) return true;
  const k = e.key.toUpperCase();
  if (k.length === 1 && k >= "A" && k <= "Z") {
    ne.chars.push(k);
    e.preventDefault();
    return true;
  }
  if (e.key.length === 1 && e.key >= "0" && e.key <= "9") {
    ne.chars.push(e.key);
    e.preventDefault();
    return true;
  }
  return true;
};

window.addEventListener("keydown", (e) => {
  if (phase === "over" && nameEntry?.active && handleNameKey(e)) return;

  const k = e.key.toLowerCase();
  if (k === " " || k === "enter") {
    if (phase === "idle" || (phase === "over" && !nameEntry?.active)) startGame();
    e.preventDefault();
    return;
  }
  const idx = PADS.findIndex((p) => p.keys.includes(k));
  if (idx >= 0) {
    press(idx);
    e.preventDefault();
  }
});

const pointerHit = (clientX: number, clientY: number): void => {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (phase === "idle" || phase === "over") {
    if (phase === "over" && nameEntry?.active) return;
    startGame();
    return;
  }
  for (let i = 0; i < 4; i++) {
    const c = padCenter(i);
    if (Math.hypot(x - c.x, y - c.y) <= c.r) {
      press(i);
      return;
    }
  }
};
canvas.addEventListener("pointerdown", (e) => pointerHit(e.clientX, e.clientY));

// ------------------------------------------------------------------- loop ----
let last = performance.now();

const update = (dt: number): void => {
  for (const p of PADS) p.lit = Math.max(0, p.lit - dt * 3.5);
  flash = Math.max(0, flash - dt * 2.5);

  if (phase === "show") {
    showTimer -= dt;
    if (showTimer <= 0) {
      if (showOn) {
        showOn = false;
        showTimer = gapFor(round);
        showIndex += 1;
        if (showIndex >= sequence.length) beginRecall();
      } else if (showIndex < sequence.length) {
        showOn = true;
        const pad = sequence[showIndex];
        PADS[pad].lit = 1;
        beep(PADS[pad].tone, litFor(round));
        showTimer = litFor(round);
      }
    }
  } else if (phase === "recall") {
    fuse -= dt / fuseTotal;
    if (fuse <= 0) {
      fuse = 0;
      flash = 1;
      gameOver();
    }
  } else if (phase === "levelup") {
    levelTimer -= dt;
    if (levelTimer <= 0) nextRound();
  }
};

const roundRect = (x: number, y: number, w: number, h: number, r: number): void => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

const render = (): void => {
  // background
  const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
  bg.addColorStop(0, "#0b1024");
  bg.addColorStop(1, "#05060d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // pads
  for (let i = 0; i < 4; i++) {
    const c = padCenter(i);
    const p = PADS[i];
    const glow = 30 + p.lit * 60;
    ctx.save();
    ctx.shadowBlur = glow;
    ctx.shadowColor = `hsla(${p.hue}, 90%, 60%, ${0.6 + p.lit * 0.4})`;
    const l = 24 + p.lit * 46;
    ctx.fillStyle = `hsl(${p.hue}, 80%, ${l}%)`;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = `hsla(${p.hue}, 90%, 75%, ${0.35 + p.lit * 0.6})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = `hsla(0,0%,100%,${0.5 + p.lit * 0.5})`;
    ctx.font = `${Math.round(c.r * 0.8)}px "Trebuchet MS", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(p.glyph, c.x, c.y + 2);
  }

  // fuse ring around the center during recall
  const cx = W / 2;
  const cy = H / 2 + 10;
  if (phase === "recall") {
    const rr = Math.min(W, H) * 0.06;
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
    const danger = fuse < 0.3;
    ctx.strokeStyle = danger ? "#ff5169" : "#5cf5ff";
    ctx.shadowBlur = 18;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + fuse * Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#e6ecff";
    ctx.font = `600 ${Math.round(rr * 0.9)}px "Trebuchet MS", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${recallPos}/${sequence.length}`, cx, cy + 1);
  }

  // HUD
  ctx.fillStyle = "#8ea0d8";
  ctx.font = "700 16px \"Trebuchet MS\", sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`ROUND ${Math.max(0, round)}`, 18, 16);
  ctx.textAlign = "right";
  ctx.fillText(`BEST ${best}`, W - 18, 16);

  // center prompts
  ctx.textAlign = "center";
  ctx.fillStyle = "#e6ecff";
  if (phase === "idle") {
    ctx.font = "800 40px \"Trebuchet MS\", sans-serif";
    ctx.fillText("CIPHER", cx, H * 0.18);
    ctx.font = "600 17px \"Trebuchet MS\", sans-serif";
    ctx.fillStyle = "#9fb0e6";
    ctx.fillText("Watch the code flash, then echo it back before the fuse burns.", cx, H * 0.18 + 42);
    ctx.fillText("Arrows / WASD or tap the pads.  Press SPACE to start.", cx, H * 0.18 + 66);
  } else if (phase === "show") {
    ctx.fillStyle = "#7fe9ff";
    ctx.font = "700 18px \"Trebuchet MS\", sans-serif";
    ctx.fillText("WATCH", cx, H * 0.12);
  } else if (phase === "recall") {
    ctx.fillStyle = fuse < 0.3 ? "#ff8a9a" : "#7fffcf";
    ctx.font = "700 18px \"Trebuchet MS\", sans-serif";
    ctx.fillText("ECHO", cx, H * 0.12);
  } else if (phase === "over") {
    const steps = Math.max(0, round - 1);
    if (nameEntry?.active) {
      const typed = nameEntry.chars.join("");
      const cursor = nameEntry.chars.length < NAME_MAX ? "_" : "";
      ctx.font = "800 38px \"Trebuchet MS\", sans-serif";
      ctx.fillStyle = "#ff5169";
      ctx.fillText("NEW HIGH SCORE!", cx, H * 0.14);
      ctx.fillStyle = "#e6ecff";
      ctx.font = "700 20px \"Trebuchet MS\", sans-serif";
      ctx.fillText(`You held ${steps} steps of the cipher`, cx, H * 0.14 + 36);
      ctx.font = "600 17px \"Trebuchet MS\", sans-serif";
      ctx.fillStyle = "#9fb0e6";
      ctx.fillText("Enter your initials:", cx, H * 0.14 + 64);
      ctx.fillStyle = "#e6ecff";
      ctx.font = "700 28px \"Trebuchet MS\", sans-serif";
      ctx.fillText(`${typed}${cursor}`, cx, H * 0.14 + 96);
      ctx.font = "600 14px \"Trebuchet MS\", sans-serif";
      ctx.fillStyle = "#9fb0e6";
      ctx.fillText("Type A–Z / 0–9  ·  Backspace  ·  Enter to save", cx, H * 0.14 + 128);
    } else if (!leaderboardActive) {
      ctx.font = "800 38px \"Trebuchet MS\", sans-serif";
      ctx.fillStyle = "#ff5169";
      ctx.fillText("BROKEN", cx, H * 0.18);
      ctx.fillStyle = "#e6ecff";
      ctx.font = "700 22px \"Trebuchet MS\", sans-serif";
      ctx.fillText(`You held ${steps} steps of the cipher`, cx, H * 0.18 + 40);
      ctx.fillStyle = "#9fb0e6";
      ctx.font = "600 16px \"Trebuchet MS\", sans-serif";
      ctx.fillText("Press SPACE or tap to try again", cx, H * 0.18 + 70);
    } else {
      ctx.font = "800 38px \"Trebuchet MS\", sans-serif";
      ctx.fillStyle = "#ff5169";
      ctx.fillText("BROKEN", cx, H * 0.1);
      ctx.fillStyle = "#e6ecff";
      ctx.font = "700 20px \"Trebuchet MS\", sans-serif";
      ctx.fillText(`You held ${steps} steps of the cipher`, cx, H * 0.1 + 32);
      if (submitState === "submitting") {
        ctx.fillStyle = "#9fb0e6";
        ctx.font = "600 14px \"Trebuchet MS\", sans-serif";
        ctx.fillText("Saving…", cx, H * 0.1 + 56);
      } else if (submitState === "error") {
        ctx.fillStyle = "#ff8a9a";
        ctx.font = "600 14px \"Trebuchet MS\", sans-serif";
        ctx.fillText("(couldn't reach leaderboard — score not saved)", cx, H * 0.1 + 56);
      }
      ctx.fillStyle = "#8ea0d8";
      ctx.font = "600 13px \"Trebuchet MS\", sans-serif";
      ctx.textAlign = "left";
      const boardLines = formatBoard().split("\n");
      let by = H * 0.1 + 76;
      for (const line of boardLines) {
        ctx.fillText(line, W * 0.5 - 140, by);
        by += 18;
      }
      ctx.textAlign = "center";
      ctx.fillStyle = "#9fb0e6";
      ctx.font = "600 16px \"Trebuchet MS\", sans-serif";
      ctx.fillText("Press SPACE or tap to try again", cx, H - 40);
    }
  }

  // flash overlay
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${flash * 0.35})`;
    ctx.fillRect(0, 0, W, H);
  }
};

const frame = (now: number): void => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
