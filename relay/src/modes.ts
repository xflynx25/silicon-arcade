export type GameMode = "escort" | "defuse";

export const ROLE_HELP =
  "PILOT (P1, warm) drives but is half-blind — you only see a fog bubble\n" +
  "around you. NAVIGATOR (P2, cool) sees everything but cannot move.\n" +
  "Talk out loud — the Navigator's pings are a small hint channel, not\n" +
  "a replacement for describing what they see.";

export const ESCORT_HELP =
  "ESCORT — descend through a blind hazard maze to the exit before time runs out.\n\n" +
  ROLE_HELP +
  "\n\nPILOT   WASD move\n" +
  "NAVIGATOR   Arrows aim cursor  ·  Right Shift drop ping  ·  Enter cycle ping type\n" +
  "  (go-here waypoint / danger arrow / wait)\n\n" +
  "Reach the glowing exit at the bottom of each maze to descend deeper.\n" +
  "Score = depth reached.";

export const DEFUSE_HELP =
  "DEFUSE — a symbol appears on the Pilot's panel; only the Navigator's manual\n" +
  "says what input sequence it means. Navigator: find the matching symbol in\n" +
  "your manual and read the arrows aloud. Pilot: enter them and commit.\n\n" +
  "PILOT   WASD enter arrows (Up/Left/Down/Right)  ·  Left Shift commit  ·  Space clear\n" +
  "NAVIGATOR   Arrows scroll the manual\n\n" +
  "Wrong or late entries cost a strike — three strikes ends the run.\n" +
  "Score = panels defused.";

export type EscortWaveConfig = {
  roomCount: number;
  gapWidth: number;
  mineCount: number;
  gateRoomChance: number;
  gatePeriod: number;
  gateOpenFraction: number;
  timeLimit: number;
  fogRadius: number;
};

export function escortWaveConfig(wave: number): EscortWaveConfig {
  const w = wave - 1;
  return {
    roomCount: Math.min(9, 5 + Math.floor(w / 2)),
    gapWidth: Math.max(70, 150 - w * 8),
    mineCount: Math.min(10, 2 + w),
    gateRoomChance: Math.min(0.6, 0.15 + w * 0.06),
    gatePeriod: Math.max(2.2, 4 - w * 0.15),
    gateOpenFraction: 0.45,
    timeLimit: Math.max(35, 70 - w * 3),
    fogRadius: Math.max(90, 150 - w * 5)
  };
}

export type Direction = "up" | "down" | "left" | "right";

export type DefuseSymbol = {
  glyph: string;
  sequence: Direction[];
};

// A fixed symbol -> sequence manual. The Navigator's screen lists all of
// these (unordered relative to "which one is active"); the Pilot only ever
// sees the current glyph, never the mapping — so the two must talk.
export const DEFUSE_SYMBOLS: DefuseSymbol[] = [
  { glyph: "△", sequence: ["up", "up", "right"] },
  { glyph: "▽", sequence: ["down", "left", "down"] },
  { glyph: "◇", sequence: ["left", "right", "up"] },
  { glyph: "☆", sequence: ["up", "down", "left", "right"] },
  { glyph: "□", sequence: ["right", "right", "down"] },
  { glyph: "⊕", sequence: ["down", "up"] },
  { glyph: "⊗", sequence: ["left", "left", "down", "right"] },
  { glyph: "⚙", sequence: ["up", "left", "down", "right"] },
  { glyph: "✦", sequence: ["right", "up", "left"] },
  { glyph: "◉", sequence: ["down", "right", "up", "left"] }
];

export function defuseTimeLimit(wave: number): number {
  return Math.max(6, 14 - wave * 0.5);
}

export const DIRECTION_ARROW: Record<Direction, string> = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→"
};
