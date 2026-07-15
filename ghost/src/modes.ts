export type ModeId = "chase" | "haunt" | "duel";

export const MODE_LABEL: Record<ModeId, string> = {
  chase: "CHASE",
  haunt: "HAUNT",
  duel: "DUEL"
};

export const MODE_DESCRIPTION: Record<ModeId, string> = {
  chase: "co-op relay, carry the orb with your past selves",
  haunt: "competitive, dodge every ghost you've ever been",
  duel: "competitive, fight your own echoes — best of 5"
};

export const MODE_HELP: Record<ModeId, string> = {
  chase:
    "Co-op relay — carry the glowing orb to the goal.\n" +
    "It's heavy: the more hands on it (yours, your\n" +
    "partner's, or a past-lap ghost still holding Grab)\n" +
    "the faster it moves. Reach the goal to bank a lap\n" +
    "and start a fresh one before the match clock runs out.",
  haunt:
    "Free-for-all — collect drifting sparks for points.\n" +
    "Touching ANY ghost (yours or your rival's) drops\n" +
    "your streak and stuns you briefly. Every lap adds\n" +
    "more ghosts, so late laps are a minefield of habits.\n" +
    "Higher score when the laps run out wins.",
  duel:
    "Fight your echoes — Strike (primary) to hit your\n" +
    "rival, Parry (secondary) to block. Every 12s your\n" +
    "last lap freezes into a ghost that keeps striking on\n" +
    "the exact ticks it originally did — watch for the\n" +
    "telegraph flash. Getting hit (by rival or any ghost)\n" +
    "loses the round. Best of 5 wins the match."
};

export const CONTROLS =
  "P1  ·  WASD move  ·  Left Shift primary  ·  Space secondary\n" +
  "P2  ·  Arrows move  ·  Right Shift primary  ·  Enter secondary\n" +
  "Any time  ·  [ / ]  adjust Echo Depth (1-5 live ghosts)";

export const ECHO_DEPTH_MIN = 1;
export const ECHO_DEPTH_MAX = 5;
export const ECHO_DEPTH_DEFAULT = 3;

export const CHASE_MATCH_SECONDS = 90;
export const HAUNT_LAPS = 5;
export const DUEL_WIN_ROUNDS = 3; // best of 5

// per-ghost hue spread so consecutive laps read as visually distinct echoes
export const hueForLap = (lap: number): number => (lap * 47) % 360;
