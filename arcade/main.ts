// Silicon Arcade launcher.
//
// Renders the cabinet grid and boots a selected game inside an iframe.
// Quitting removes the iframe entirely, which destroys the game's window,
// its requestAnimationFrame loop, every event listener, and its AudioContext —
// so the next game boots exactly as if you had just run `pnpm dev`.

type Game = {
  id: string;
  name: string;
  tag: string;
  summary: string;
  accent: string;
  glyph: string;
};

const GAMES: Game[] = [
  {
    id: "tether",
    name: "TETHER",
    tag: "Co-opetition",
    summary:
      "Two spirits linked by an elastic tether — swing, slingshot, and reel in orbs together.",
    accent: "#38f5ff",
    glyph: `<circle cx="14" cy="20" r="6"/><circle cx="42" cy="36" r="6"/><path d="M18.5 23.5 Q28 40 37.5 32.5"/>`
  },
  {
    id: "polarity",
    name: "POLARITY",
    tag: "Competitive duel",
    summary:
      "Magnetic ships flip polarity to grab a shared charged core and shove it through the rival's gate.",
    accent: "#b46bff",
    glyph: `<path d="M14 14v16a14 14 0 0 0 28 0V14"/><path d="M8 14h12M36 14h12"/><path d="M8 30h12M36 30h12"/>`
  },
  {
    id: "ricochet",
    name: "RICOCHET",
    tag: "Duel · Rally · Goals",
    summary:
      "Tilt neon paddles to deflect the ball — smash lunge, curve spin, and three selectable modes.",
    accent: "#4d9bff",
    glyph: `<path d="M10 12v16M46 28v16"/><path d="M10 20 L28 34 L46 24" /><circle cx="28" cy="34" r="3.5"/>`
  },
  {
    id: "echo",
    name: "ECHO",
    tag: "Co-op survival",
    summary:
      "Defend the Core in the dark — ping to reveal the husks, strike to destroy them, resonate together.",
    accent: "#a074ff",
    glyph: `<circle cx="28" cy="28" r="4"/><path d="M28 16a12 12 0 0 1 0 24"/><path d="M28 8a20 20 0 0 1 0 40"/>`
  },
  {
    id: "vortex",
    name: "VORTEX",
    tag: "Sumo knockout",
    summary:
      "Charge-dash ships in a shrinking arena — knock your opponent clean out into the void.",
    accent: "#2ee6d6",
    glyph: `<path d="M28 28 m0 0 a4 4 0 1 1 6 2 a10 10 0 1 1 -14 -4 a16 16 0 1 1 22 6"/>`
  },
  {
    id: "nova",
    name: "NOVA",
    tag: "Orbital duel · Co-op",
    summary:
      "Comets ride a star's gravity — slingshot for speed, then ram to shatter your rival.",
    accent: "#ff8a3d",
    glyph: `<circle cx="28" cy="28" r="5"/><path d="M28 6v10M28 40v10M6 28h10M40 28h10M13 13l7 7M43 43l-7-7M43 13l-7 7M13 43l7-7"/>`
  },
  {
    id: "lattice",
    name: "LATTICE",
    tag: "Territory duel",
    summary:
      "Ride the grid leaving a light trail — loop back to claim the ground you enclose, cut your rival to reset them.",
    accent: "#4dffb0",
    glyph: `<path d="M10 10h22v22H10z"/><path d="M32 24h14v22H24V32"/><path d="M10 10l14 14"/>`
  },
  {
    id: "salvo",
    name: "SALVO",
    tag: "Tank duel",
    summary:
      "Steer armored tanks around cover and fire ricocheting shells — bank shots off the walls to catch your rival.",
    accent: "#ffb638",
    glyph: `<rect x="12" y="26" width="24" height="16" rx="3"/><path d="M24 34h20"/><circle cx="47" cy="34" r="3"/><path d="M14 46h20"/>`
  }
];

const grid = document.getElementById("grid") as HTMLElement;
const stage = document.getElementById("stage") as HTMLElement;
const frameHost = document.getElementById("frame-host") as HTMLElement;
const nowPlaying = document.getElementById("now-playing") as HTMLElement;
const exitBtn = document.getElementById("exit") as HTMLButtonElement;

const lbOpenBtn = document.getElementById("lb-open") as HTMLButtonElement;
const lbOverlay = document.getElementById("lb-overlay") as HTMLElement;
const lbCloseBtn = document.getElementById("lb-close") as HTMLButtonElement;
const lbGameTabs = document.getElementById("lb-game-tabs") as HTMLElement;
const lbBoardTabs = document.getElementById("lb-board-tabs") as HTMLElement;
const lbRows = document.getElementById("lb-rows") as HTMLElement;
const lbEmpty = document.getElementById("lb-empty") as HTMLElement;
const lbLoading = document.getElementById("lb-loading") as HTMLElement;

let activeFrame: HTMLIFrameElement | null = null;

const boot = (game: Game): void => {
  quit(); // never stack two games

  const frame = document.createElement("iframe");
  frame.className = "game-frame";
  frame.title = game.name;
  frame.src = `/${game.id}/index.html`;
  frame.allow = "autoplay; fullscreen; gamepad";
  frameHost.append(frame);
  activeFrame = frame;

  nowPlaying.textContent = game.name;
  stage.style.setProperty("--accent", game.accent);
  document.body.classList.add("playing");
  stage.hidden = false;

  // Give the game the keyboard immediately, and let Esc quit even while the
  // iframe holds focus — the parent-window listener below never sees keys typed
  // inside a focused same-origin child, so we hook the child window too.
  frame.addEventListener("load", () => {
    frame.contentWindow?.focus();
    try {
      frame.contentWindow?.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "Escape") {
          e.preventDefault();
          quit();
        }
      });
    } catch {
      // cross-origin child: fall back to the parent-window listener
    }
  });
};

const quit = (): void => {
  if (activeFrame) {
    // Blank first so the game's audio/RAF stop before the element is dropped,
    // then remove the element to destroy its JS realm entirely.
    activeFrame.src = "about:blank";
    activeFrame.remove();
    activeFrame = null;
  }
  frameHost.replaceChildren();
  stage.hidden = true;
  document.body.classList.remove("playing");
  window.focus();
};

const buildCard = (game: Game): HTMLElement => {
  const card = document.createElement("button");
  card.className = "card";
  card.type = "button";
  card.style.setProperty("--accent", game.accent);
  card.setAttribute("aria-label", `Launch ${game.name}`);
  card.innerHTML = `
    <span class="card-glow" aria-hidden="true"></span>
    <span class="badge">2P</span>
    <span class="glyph" aria-hidden="true">
      <svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="3"
           stroke-linecap="round" stroke-linejoin="round">${game.glyph}</svg>
    </span>
    <span class="name">${game.name}</span>
    <span class="tag">${game.tag}</span>
    <span class="summary">${game.summary}</span>
    <span class="cta">Insert coin <span class="arrow">›</span></span>
  `;
  card.addEventListener("click", () => boot(game));
  return card;
};

for (const game of GAMES) {
  grid.append(buildCard(game));
}

exitBtn.addEventListener("click", quit);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && activeFrame) {
    e.preventDefault();
    quit();
  }
});

// ---------------------------------------------------------------------------
// Leaderboards — read-only view of every game's boards, gated on the same
// /api/leaderboard "enabled" flag the games themselves check. Games opt in by
// adding an entry here; each board id must match what the game submits under
// (see e.g. tether/src/game.ts's per-difficulty boards).

type LeaderboardEntry = { name: string; score: number; date: string };
type BoardDef = { id: string; label: string };
type LeaderboardGame = { id: string; name: string; accent: string; boards: BoardDef[]; formatScore: (score: number) => string };

const LEADERBOARD_GAMES: LeaderboardGame[] = [
  {
    id: "tether",
    name: "TETHER",
    accent: "#38f5ff",
    boards: [
      { id: "easy", label: "Easy" },
      { id: "normal", label: "Normal" },
      { id: "hard", label: "Hard" }
    ],
    formatScore: (score) => `${score.toFixed(1)}s`
  }
];

let lbActiveGame = LEADERBOARD_GAMES[0];
let lbActiveBoard = lbActiveGame?.boards[0];
let lbRequestId = 0;

async function fetchBoard(game: string, board: string): Promise<{ enabled: boolean; entries: LeaderboardEntry[] }> {
  try {
    const res = await fetch(`/api/leaderboard?game=${encodeURIComponent(game)}&board=${encodeURIComponent(board)}`, {
      cache: "no-store"
    });
    if (!res.ok) return { enabled: false, entries: [] };
    const data = await res.json();
    if (data?.enabled === false) return { enabled: false, entries: [] };
    return { enabled: true, entries: Array.isArray(data?.entries) ? (data.entries as LeaderboardEntry[]) : [] };
  } catch {
    return { enabled: false, entries: [] };
  }
}

function renderTabs(host: HTMLElement, items: { id: string; label: string }[], activeId: string, onSelect: (id: string) => void): void {
  host.replaceChildren();
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `lb-tab${item.id === activeId ? " active" : ""}`;
    btn.textContent = item.label;
    btn.addEventListener("click", () => onSelect(item.id));
    host.append(btn);
  }
}

async function loadLbBoard(): Promise<void> {
  if (!lbActiveGame || !lbActiveBoard) return;
  const requestId = ++lbRequestId;
  lbRows.replaceChildren();
  lbEmpty.hidden = true;
  lbLoading.hidden = false;

  const game = lbActiveGame;
  const board = lbActiveBoard;
  const { entries } = await fetchBoard(game.id, board.id);
  if (requestId !== lbRequestId) return; // superseded by a newer tab switch

  lbLoading.hidden = true;
  if (entries.length === 0) {
    lbEmpty.hidden = false;
    return;
  }
  for (const [i, entry] of entries.entries()) {
    const row = document.createElement("tr");
    const date = new Date(entry.date);
    const dateLabel = Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
    row.innerHTML = `<td>${i + 1}</td><td>${entry.name}</td><td>${game.formatScore(entry.score)}</td><td>${dateLabel}</td>`;
    lbRows.append(row);
  }
}

function renderLbTabs(): void {
  if (!lbActiveGame) return;
  renderTabs(
    lbGameTabs,
    LEADERBOARD_GAMES.map((g) => ({ id: g.id, label: g.name })),
    lbActiveGame.id,
    (id) => {
      const g = LEADERBOARD_GAMES.find((game) => game.id === id);
      if (!g) return;
      lbActiveGame = g;
      lbActiveBoard = g.boards[0];
      renderLbTabs();
      loadLbBoard();
    }
  );
  lbBoardTabs.hidden = lbActiveGame.boards.length <= 1;
  if (lbActiveBoard) {
    renderTabs(lbBoardTabs, lbActiveGame.boards, lbActiveBoard.id, (id) => {
      const b = lbActiveGame.boards.find((board) => board.id === id);
      if (!b) return;
      lbActiveBoard = b;
      renderLbTabs();
      loadLbBoard();
    });
  }
}

function openLeaderboards(): void {
  lbOverlay.hidden = false;
  renderLbTabs();
  loadLbBoard();
}

function closeLeaderboards(): void {
  lbOverlay.hidden = true;
}

lbOpenBtn.addEventListener("click", openLeaderboards);
lbCloseBtn.addEventListener("click", closeLeaderboards);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !lbOverlay.hidden) {
    e.preventDefault();
    closeLeaderboards();
  }
});

// Only reveal the entry point once we know a Blob store (or the local dev
// plugin) is actually serving leaderboard data — no store linked means the
// button never appears, matching the in-game "no leaderboard UI at all" rule.
if (lbActiveGame && lbActiveBoard) {
  fetchBoard(lbActiveGame.id, lbActiveBoard.id).then(({ enabled }) => {
    if (enabled) lbOpenBtn.hidden = false;
  });
}
